// -----------------------------------------------------------------------------
// A small client of the Matrix client-server API (/_matrix/client/v3), the
// handful of endpoints a bot needs: login, whoami, sync (long polling), join,
// alias resolution, send, room creation and media upload. Built on fetch,
// injected by the tests. No end-to-end encryption.
//
// Every failure is a MatrixError with a `kind` (below), so the callers and the
// texts never parse a server message. The access token never appears in an
// error message nor in a log line.
// -----------------------------------------------------------------------------

import { randomUUID } from 'node:crypto';

export const ERROR_KINDS = {
  NOT_CONFIGURED: 'not_configured',
  INVALID_URL: 'invalid_url',
  NO_CREDENTIALS: 'no_credentials',
  UNREACHABLE: 'unreachable',
  TIMEOUT: 'timeout',
  NOT_MATRIX: 'not_matrix',
  BAD_LOGIN: 'bad_login',
  TOKEN: 'token',
  FORBIDDEN: 'forbidden',
  NOT_FOUND: 'not_found',
  REJECTED: 'rejected',
  RATE_LIMITED: 'rate_limited',
  SERVER: 'server',
};

// Failures that say nothing about the configuration: the network or the server
// will come back, the sync loop retries.
export const TRANSIENT_KINDS = new Set([
  ERROR_KINDS.UNREACHABLE,
  ERROR_KINDS.TIMEOUT,
  ERROR_KINDS.RATE_LIMITED,
  ERROR_KINDS.SERVER,
]);

export class MatrixError extends Error {
  /**
   * @param {string} kind one of ERROR_KINDS
   * @param {string} message English, without secret
   * @param {object} [details]
   * @param {number} [details.status] HTTP status
   * @param {string} [details.errcode] Matrix error code (M_FORBIDDEN...)
   * @param {number} [details.retryAfterMs] wait asked by a 429
   */
  constructor(kind, message, { status, errcode, retryAfterMs, cause } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = 'MatrixError';
    this.kind = kind;
    this.status = status;
    this.errcode = errcode;
    this.retryAfterMs = retryAfterMs;
  }
}

const CLIENT_PATH = '/_matrix/client/v3';
const MEDIA_PATH = '/_matrix/media/v3';
export const REQUEST_TIMEOUT_MS = 15_000;
// The longest wait a 429 is honored with inside one call; beyond, the caller decides.
const MAX_INLINE_RETRY_MS = 10_000;

function kindOf(status, errcode) {
  if (errcode === 'M_UNKNOWN_TOKEN' || errcode === 'M_MISSING_TOKEN' || status === 401) {
    return ERROR_KINDS.TOKEN;
  }
  if (errcode === 'M_LIMIT_EXCEEDED' || status === 429) {
    return ERROR_KINDS.RATE_LIMITED;
  }
  if (errcode === 'M_NOT_FOUND' || status === 404) {
    return ERROR_KINDS.NOT_FOUND;
  }
  if (errcode === 'M_FORBIDDEN' || status === 403) {
    return ERROR_KINDS.FORBIDDEN;
  }
  // Any other 4xx (a message too large, a malformed request): refused as is.
  return status >= 500 ? ERROR_KINDS.SERVER : ERROR_KINDS.REJECTED;
}

const sleep = (ms, signal) =>
  new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      resolve();
    });
  });

export class MatrixClient {
  /**
   * @param {object} options
   * @param {URL} options.homeserver base address of the homeserver
   * @param {string} [options.accessToken]
   * @param {typeof fetch} [options.fetch]
   */
  constructor({ homeserver, accessToken = '', fetch: fetchImpl = globalThis.fetch }) {
    this.base = homeserver;
    this.accessToken = accessToken;
    this.fetch = fetchImpl;
  }

  url(prefix, path, query) {
    const url = new URL(this.base.href.replace(/\/$/, '') + prefix + path);
    for (const [key, value] of Object.entries(query ?? {})) {
      for (const item of Array.isArray(value) ? value : [value]) {
        if (item !== undefined && item !== null) {
          url.searchParams.append(key, String(item));
        }
      }
    }
    return url;
  }

  /**
   * One request. Resolves with the JSON body of a 2xx answer.
   * @param {string} method
   * @param {string} path below /_matrix/client/v3 (or `prefix`)
   * @param {object} [options]
   */
  async request(
    method,
    path,
    {
      body,
      query,
      prefix = CLIENT_PATH,
      timeoutMs = REQUEST_TIMEOUT_MS,
      signal,
      auth = true,
      raw,
    } = {},
  ) {
    const headers = {};
    if (auth) {
      if (!this.accessToken) {
        throw new MatrixError(ERROR_KINDS.NO_CREDENTIALS, 'No access token');
      }
      headers.authorization = `Bearer ${this.accessToken}`;
    }
    let payload;
    if (raw) {
      headers['content-type'] = raw.contentType;
      payload = raw.data;
    } else if (body !== undefined) {
      headers['content-type'] = 'application/json';
      payload = JSON.stringify(body);
    }
    for (let attempt = 0; ; attempt += 1) {
      let response;
      try {
        response = await this.fetch(this.url(prefix, path, query), {
          method,
          headers,
          body: payload,
          // A fresh timeout per attempt: the wait of a 429 does not eat the next one.
          signal: signal
            ? AbortSignal.any([AbortSignal.timeout(timeoutMs), signal])
            : AbortSignal.timeout(timeoutMs),
        });
      } catch (err) {
        if (signal?.aborted) {
          throw err; // stopped by the caller: not a failure of the server
        }
        if (err?.name === 'TimeoutError') {
          throw new MatrixError(ERROR_KINDS.TIMEOUT, `No answer within ${timeoutMs} ms`);
        }
        throw new MatrixError(
          ERROR_KINDS.UNREACHABLE,
          `Homeserver unreachable: ${err?.cause?.code ?? err?.message}`,
        );
      }
      let data;
      const text = await response.text().catch(() => '');
      try {
        data = text ? JSON.parse(text) : {};
      } catch {
        data = null;
      }
      if (response.ok) {
        if (data === null) {
          throw new MatrixError(
            ERROR_KINDS.NOT_MATRIX,
            `Not a Matrix answer (HTTP ${response.status})`,
          );
        }
        return data;
      }
      const errcode = typeof data?.errcode === 'string' ? data.errcode : undefined;
      if (data === null && response.status === 404) {
        // A web server that is not a homeserver: the address is wrong.
        throw new MatrixError(ERROR_KINDS.NOT_MATRIX, 'No Matrix API at this address (HTTP 404)', {
          status: 404,
        });
      }
      const kind = kindOf(response.status, errcode);
      const retryAfterMs = Number(
        data?.retry_after_ms ?? response.headers?.get?.('retry-after') * 1000,
      );
      if (kind === ERROR_KINDS.RATE_LIMITED && attempt === 0) {
        const wait = Number.isFinite(retryAfterMs) && retryAfterMs > 0 ? retryAfterMs : 1000;
        if (wait <= MAX_INLINE_RETRY_MS) {
          await sleep(wait, signal);
          if (signal?.aborted) {
            throw signal.reason;
          }
          continue;
        }
      }
      // The server message (M_FORBIDDEN: ...) never carries the token.
      const reason = typeof data?.error === 'string' ? data.error.slice(0, 200) : '';
      throw new MatrixError(
        kind,
        `${method} ${path.split('?')[0]}: HTTP ${response.status} ${errcode ?? ''} ${reason}`.trim(),
        {
          status: response.status,
          errcode,
          retryAfterMs: Number.isFinite(retryAfterMs) ? retryAfterMs : undefined,
        },
      );
    }
  }

  /** The account behind the token: `{ user_id, device_id }`. */
  whoami(options) {
    return this.request('GET', '/account/whoami', options);
  }

  /**
   * Password login. Resolves with `{ user_id, access_token, device_id }` and
   * keeps the token for the next calls.
   */
  async login(user, password, deviceId, { signal } = {}) {
    try {
      const data = await this.request('POST', '/login', {
        auth: false,
        signal,
        body: {
          type: 'm.login.password',
          identifier: { type: 'm.id.user', user },
          password,
          initial_device_display_name: 'Gladys Assistant',
          ...(deviceId ? { device_id: deviceId } : {}),
        },
      });
      if (typeof data.access_token !== 'string' || typeof data.user_id !== 'string') {
        throw new MatrixError(ERROR_KINDS.NOT_MATRIX, 'Login answer without a token');
      }
      this.accessToken = data.access_token;
      return data;
    } catch (err) {
      if (err instanceof MatrixError && err.kind === ERROR_KINDS.FORBIDDEN) {
        throw new MatrixError(ERROR_KINDS.BAD_LOGIN, 'Wrong user name or password', {
          status: err.status,
          errcode: err.errcode,
        });
      }
      throw err;
    }
  }

  /**
   * One long-polling sync. `timeoutMs` is how long the server may hold the
   * request when nothing happens; the HTTP timeout leaves it 15 s more.
   */
  sync({ since, timeoutMs = 30_000, filter, signal } = {}) {
    return this.request('GET', '/sync', {
      query: { since, timeout: since ? timeoutMs : 0, filter, set_presence: 'offline' },
      timeoutMs: (since ? timeoutMs : 0) + REQUEST_TIMEOUT_MS + 15_000,
      signal,
    });
  }

  /**
   * Joins a room by id or alias (an invitation, or a public room). Resolves
   * with its id. A room id of another server tells which server to ask
   * (server_name, and `via` since Matrix 1.12).
   */
  async join(roomIdOrAlias, { signal } = {}) {
    const server = roomIdOrAlias.startsWith('!') ? roomIdOrAlias.split(':').slice(1).join(':') : '';
    const data = await this.request('POST', `/join/${encodeURIComponent(roomIdOrAlias)}`, {
      body: {},
      query: server ? { server_name: server, via: server } : undefined,
      signal,
    });
    return data.room_id;
  }

  /** The id of a room alias (#name:server). */
  async resolveAlias(alias, { signal } = {}) {
    const data = await this.request('GET', `/directory/room/${encodeURIComponent(alias)}`, {
      signal,
    });
    return data.room_id;
  }

  /** The rooms the bot is in. */
  async joinedRooms({ signal } = {}) {
    const data = await this.request('GET', '/joined_rooms', { signal });
    return Array.isArray(data.joined_rooms) ? data.joined_rooms : [];
  }

  /** The members of a room who joined or are invited (not those who left). */
  async members(roomId, { signal } = {}) {
    const data = await this.request('GET', `/rooms/${encodeURIComponent(roomId)}/members`, {
      query: { not_membership: 'leave' },
      signal,
    });
    const chunk = Array.isArray(data.chunk) ? data.chunk : [];
    return chunk
      .filter((event) => ['join', 'invite'].includes(event?.content?.membership))
      .map((event) => ({ userId: event.state_key, membership: event.content.membership }));
  }

  /** Sends one m.room.message. Resolves with the event id. */
  async sendMessage(roomId, content, { txnId = randomUUID(), signal } = {}) {
    const data = await this.request(
      'PUT',
      `/rooms/${encodeURIComponent(roomId)}/send/m.room.message/${encodeURIComponent(txnId)}`,
      { body: content, signal },
    );
    return data.event_id;
  }

  /**
   * Opens a direct, UNENCRYPTED room with one user (the bot cannot read an
   * encrypted one). Resolves with its id.
   */
  async createDirectRoom(userId, name, { signal } = {}) {
    const data = await this.request('POST', '/createRoom', {
      signal,
      body: {
        preset: 'trusted_private_chat',
        is_direct: true,
        invite: [userId],
        ...(name ? { name } : {}),
      },
    });
    return data.room_id;
  }

  /** Uploads a file to the media repository. Resolves with its mxc:// address. */
  async upload(buffer, contentType, fileName) {
    const data = await this.request('POST', '/upload', {
      prefix: MEDIA_PATH,
      query: { filename: fileName },
      raw: { data: buffer, contentType },
      timeoutMs: 30_000,
    });
    if (typeof data.content_uri !== 'string') {
      throw new MatrixError(ERROR_KINDS.NOT_MATRIX, 'Upload answer without a content_uri');
    }
    return data.content_uri;
  }
}
