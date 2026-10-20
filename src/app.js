// -----------------------------------------------------------------------------
// The integration: a Matrix bot account wired to Gladys.
//
// - A sync loop (long polling, resumed from the stored `since` after a
//   restart) reads what reaches the bot. Only the people of the "allowed"
//   list are ever answered or obeyed; everybody else is ignored, invitations
//   included.
// - Watched rooms (configuration): every message fires `message_received`,
//   a message starting with the command prefix also fires `command_received`.
// - Any other room an allowed person invited the bot into is a private
//   conversation with Gladys (manifest `type: "communication"`): a link code
//   links the Matrix account to a Gladys user, then the messages go to the
//   brain (publishMessage) and the answers come back through onSendMessage.
// - Scene action `send_message`: a message in any room the bot can write in.
// - Triggers `connection_lost` / `connection_restored`, the connection status
//   of the Configuration screen, the widget and the `test_connection` action.
// -----------------------------------------------------------------------------

import { createHash } from 'node:crypto';
import { createLogger } from '@gladysassistant/integration-sdk';
import { isRoomAlias, isRoomId, normalizeConfig, parseHomeserver } from './config.js';
import { ERROR_KINDS, MatrixClient, MatrixError, TRANSIENT_KINDS } from './matrix/client.js';
import { parseImage, textContent } from './matrix/format.js';
import { SYNC_FILTER, parseSync, stripReplyFallback } from './matrix/sync.js';
import { createFailureLog } from './log.js';
import { Store } from './store.js';
import { BOT_TEXT, REPORT_TEXT, ROOMS_STATUS, each, errorText, errorTexts, pick } from './texts.js';
import { CONNECTION, TEST_ACTION, WIDGET_KEY, buildWidgetContent } from './widgets.js';

const logger = createLogger({ name: 'matrix' });

export const ACTION_KEY = 'test_connection';
export const SCENE_ACTION_KEY = 'send_message';
export const TRIGGERS = {
  MESSAGE: 'message_received',
  COMMAND: 'command_received',
  LOST: 'connection_lost',
  RESTORED: 'connection_restored',
};

// Messages older than this when the bot reads them (missed while Gladys or
// the container was down) are skipped: a "!open garage" from two hours ago
// must not run now.
export const MAX_MESSAGE_AGE_MS = 5 * 60 * 1000;
// The connection is declared lost after failures lasting this long, never on one blip.
export const LOST_AFTER_MS = 60 * 1000;
export const RETRY_DELAYS_MS = [2000, 5000, 10_000, 30_000, 60_000];
// A refused token without a password to log in again: retry slowly.
export const CREDENTIALS_RETRY_MS = 5 * 60 * 1000;
export const SYNC_TIMEOUT_MS = 30_000;
export const RECENT_KEPT = 5;
// Gladys waits 5 s for the ack of a message: answer before, even if the homeserver is slow.
export const MESSAGE_TIMEOUT_MS = 4000;
// Gladys link codes: 8 characters of an alphabet without 0/O/1/I/L.
const LINK_CODE = /^[A-HJ-KM-NP-Z2-9]{8}$/i;
const MAX_TEXT_LENGTH = 4096; // the limit of publishMessage

const fingerprint = (...parts) =>
  createHash('sha256').update(parts.join('|')).digest('hex').slice(0, 16);

/** Parses a command: "!lights off" → { command: "lights", args: "off" }. */
export function parseCommand(text, prefix) {
  if (!text.startsWith(prefix)) {
    return null;
  }
  const rest = text.slice(prefix.length);
  const match = rest.match(/^(\S+)(?:\s+([\s\S]*))?$/);
  if (!match) {
    return null;
  }
  return { command: match[1].toLowerCase(), args: (match[2] ?? '').trim() };
}

/**
 * @param {import('@gladysassistant/integration-sdk').GladysIntegration} gladys
 * @param {object} [options] replaced by the tests
 * @param {typeof fetch} [options.fetch]
 * @param {{ load(): Promise<object>, save(data: object): Promise<void>, flush(): Promise<void> }} [options.store]
 * @param {() => number} [options.now] milliseconds
 * @param {(ms: number, signal: AbortSignal) => Promise<void>} [options.sleep]
 */
export function registerHandlers(gladys, options = {}) {
  const {
    fetch: fetchImpl = globalThis.fetch,
    store = new Store(),
    now = () => Date.now(),
    sleep = (ms, signal) =>
      new Promise((resolve) => {
        const timer = setTimeout(resolve, ms);
        signal.addEventListener('abort', () => {
          clearTimeout(timer);
          resolve();
        });
      }),
  } = options;

  let data = {}; // persisted: see save()
  const loaded = store.load().then((stored) => {
    data = stored ?? {};
  });

  let config = normalizeConfig({});
  let client = null;
  let userId = null;
  let configError = new MatrixError(ERROR_KINDS.NOT_CONFIGURED, 'Not configured yet');
  let connection = CONNECTION.NOT_CONFIGURED;
  let lastError = null;
  let roomEntries = new Map(); // room id → the entry typed in the configuration
  let roomFailures = []; // entries that could not be joined
  let controller = null; // aborts the running loop
  let running = null; // the running loop
  let stopped = false;
  let lastStatus = null;
  const aliasCache = new Map();
  const statusLog = createFailureLog(logger, { recovered: 'Connection status published again' });
  const syncLog = createFailureLog(logger, { recovered: 'Matrix sync works again' });
  const brainLog = createFailureLog(logger, { recovered: 'Messages reach Gladys again' });

  function save() {
    return store.save(data);
  }

  // --- Gladys side effects, never fatal --------------------------------------

  async function publishStatus(connected, message) {
    const key = JSON.stringify([connected, message ?? null]);
    if (key === lastStatus || !gladys.connected) {
      return;
    }
    try {
      await gladys.setConnectionStatus(connected, message);
      lastStatus = key;
      statusLog.ok();
    } catch (err) {
      statusLog.fail(`Cannot publish the connection status: ${err.message}`);
    }
  }

  async function fire(key, payload) {
    try {
      await gladys.publishSceneEvent(key, payload);
    } catch (err) {
      logger.warn(`Cannot fire the "${key}" trigger: ${err.message}`);
    }
  }

  function refreshWidget() {
    try {
      gladys.requestWidgetRefresh(WIDGET_KEY);
    } catch (err) {
      logger.debug(`Widget refresh not requested: ${err.message}`);
    }
  }

  function setConnection(next) {
    if (connection !== next) {
      connection = next;
      refreshWidget();
    }
  }

  // --- Connection ----------------------------------------------------------------

  /** Logs in (or checks the token), then joins the watched rooms. */
  async function connect(signal) {
    // A hash only: the token itself is in the configuration, never twice on disk.
    const account = config.access_token
      ? fingerprint(client.base.href, 'token', config.access_token)
      : fingerprint(client.base.href, 'login', config.bot_user);
    if (data.account !== account) {
      // Another server or another account: nothing stored applies any more.
      data = { account, recent: data.recent ?? [] };
      await save();
    }
    if (config.access_token) {
      client.accessToken = config.access_token;
      ({ user_id: userId } = await client.whoami({ signal }));
    } else {
      let identified = false;
      if (data.session?.access_token) {
        client.accessToken = data.session.access_token;
        try {
          ({ user_id: userId } = await client.whoami({ signal }));
          identified = true;
        } catch (err) {
          if (!(err instanceof MatrixError) || err.kind !== ERROR_KINDS.TOKEN) {
            throw err;
          }
          logger.info('Stored Matrix session expired, logging in again');
        }
      }
      if (!identified) {
        const session = await client.login(
          config.bot_user,
          config.password,
          data.session?.device_id,
        );
        userId = session.user_id;
        data.session = { access_token: session.access_token, device_id: session.device_id };
        await save();
      }
    }
    await joinWatchedRooms();
  }

  async function resolveRoom(entry) {
    if (isRoomId(entry)) {
      return entry;
    }
    if (!isRoomAlias(entry)) {
      throw new MatrixError(ERROR_KINDS.NOT_FOUND, `Not a room id nor an alias: ${entry}`);
    }
    if (!aliasCache.has(entry)) {
      aliasCache.set(entry, await client.resolveAlias(entry));
    }
    return aliasCache.get(entry);
  }

  async function joinWatchedRooms() {
    const entries = new Map();
    const failures = [];
    let joined = [];
    try {
      joined = await client.joinedRooms();
    } catch (err) {
      logger.debug(`Joined rooms not listed: ${err.message}`);
    }
    for (const entry of config.rooms) {
      try {
        const roomId = await resolveRoom(entry);
        if (!joined.includes(roomId)) {
          await client.join(roomId);
          logger.info(`Joined the watched room ${entry}`);
        }
        entries.set(roomId, entry);
      } catch (err) {
        if (TRANSIENT_KINDS.has(err.kind)) {
          throw err;
        }
        failures.push(entry);
        logger.warn(`Cannot join the watched room ${entry}: ${err.message}`);
      }
    }
    roomEntries = entries;
    roomFailures = failures;
  }

  const roomsStatus = () =>
    roomFailures.length > 0
      ? each(ROOMS_STATUS, (text) => text(roomFailures.join(', ')))
      : undefined;

  async function markConnected() {
    const wasLost = connection === CONNECTION.DISCONNECTED;
    lastError = null;
    setConnection(CONNECTION.CONNECTED);
    await publishStatus(true, roomsStatus());
    if (wasLost) {
      logger.info('Matrix connection restored');
      await fire(TRIGGERS.RESTORED, { user: userId ?? '' });
    }
  }

  // --- The sync loop -------------------------------------------------------------

  async function loop(signal) {
    let failingSince = null;
    let attempt = 0;
    let connected = false;
    while (!signal.aborted) {
      try {
        if (!connected) {
          if (connection !== CONNECTION.DISCONNECTED) {
            setConnection(CONNECTION.CONNECTING);
          }
          await connect(signal);
          connected = true;
          logger.info(`Connected to Matrix as ${userId}`);
          await markConnected();
        }
        const since = data.since;
        const response = await client.sync({
          since,
          timeoutMs: SYNC_TIMEOUT_MS,
          filter: SYNC_FILTER,
          signal,
        });
        if (signal.aborted) {
          return;
        }
        const parsed = parseSync(response, userId);
        // The first sync of an account is history: only the invitations count.
        await handleSync(parsed, { history: !since });
        if (parsed.nextBatch) {
          data.since = parsed.nextBatch;
          save();
        }
        attempt = 0;
        syncLog.ok();
        if (failingSince !== null || connection !== CONNECTION.CONNECTED) {
          failingSince = null;
          await markConnected();
        }
      } catch (err) {
        if (signal.aborted) {
          return;
        }
        const error =
          err instanceof MatrixError ? err : new MatrixError(ERROR_KINDS.SERVER, err.message);
        const transient = TRANSIENT_KINDS.has(error.kind);
        lastError = error;
        let delay = RETRY_DELAYS_MS[Math.min(attempt, RETRY_DELAYS_MS.length - 1)];
        attempt += 1;
        if (error.kind === ERROR_KINDS.TOKEN && !config.access_token && data.session) {
          // The stored session was revoked: log in again at once.
          delete data.session;
          connected = false;
          delay = 0;
        } else if (!transient && error.kind !== ERROR_KINDS.TOKEN && connected && data.since) {
          // A sync position the server does not know any more (reset, purge).
          logger.warn(`Sync refused (${error.message}), starting from now`);
          delete data.since;
          delay = 0;
        } else if (!transient) {
          // The configuration is wrong: say it, and retry slowly in case the server is the cause.
          connected = false;
          delay = CREDENTIALS_RETRY_MS;
        } else if (error.kind === ERROR_KINDS.RATE_LIMITED && error.retryAfterMs > delay) {
          delay = error.retryAfterMs;
        }
        failingSince ??= now();
        syncLog.fail(`Matrix sync failed: ${error.message}`);
        const permanent = !transient && delay !== 0;
        if (permanent || now() - failingSince >= LOST_AFTER_MS) {
          if (connection !== CONNECTION.DISCONNECTED) {
            const wasConnected = connection === CONNECTION.CONNECTED;
            setConnection(CONNECTION.DISCONNECTED);
            logger.warn(`Matrix connection lost: ${error.message}`);
            if (wasConnected) {
              await fire(TRIGGERS.LOST, { error: errorText(error, config.language) });
            }
          }
          await publishStatus(false, errorTexts(error));
        }
        if (delay > 0) {
          await sleep(delay, signal);
        }
      }
    }
  }

  async function handleSync(parsed, { history }) {
    for (const invite of parsed.invites) {
      if (!config.allowed_users.includes(invite.inviter)) {
        logger.debug(`Invitation to ${invite.roomId} ignored: ${invite.inviter} is not allowed`);
        continue;
      }
      try {
        await client.join(invite.roomId);
        logger.info(`Joined a room ${invite.inviter} invited the bot into`);
      } catch (err) {
        logger.warn(`Cannot join the room ${invite.inviter} invited the bot into: ${err.message}`);
      }
    }
    if (history) {
      return;
    }
    const oldest = now() - MAX_MESSAGE_AGE_MS;
    for (const event of parsed.encrypted) {
      if (!config.allowed_users.includes(event.sender) || event.ts < oldest) {
        continue;
      }
      data.warnedRooms ??= [];
      if (data.warnedRooms.includes(event.roomId)) {
        continue;
      }
      data.warnedRooms.push(event.roomId);
      save();
      logger.info(`Encrypted message from ${event.sender}: the bot cannot read this room`);
      await reply(event.roomId, pick(BOT_TEXT, config.language).encrypted);
    }
    for (const message of parsed.messages) {
      if (!config.allowed_users.includes(message.sender)) {
        logger.debug(`Message from ${message.sender} ignored: not an allowed person`);
        continue;
      }
      if (message.edit || message.msgtype !== 'm.text') {
        continue; // edits would run a command twice; notices are what bots write
      }
      if (message.ts < oldest) {
        logger.debug(`Message of ${new Date(message.ts).toISOString()} skipped: too old`);
        continue;
      }
      const text = stripReplyFallback(message.body);
      if (text === '') {
        continue;
      }
      if (roomEntries.has(message.roomId)) {
        await handleRoomMessage(message, text);
      } else {
        await handleConversation(message, text);
      }
    }
  }

  async function handleRoomMessage(message, text) {
    const room = roomEntries.get(message.roomId);
    const at = new Date(message.ts || now()).toISOString();
    data.recent = [
      { room, sender: message.sender, text: text.slice(0, 500), at },
      ...(data.recent ?? []),
    ].slice(0, RECENT_KEPT);
    save();
    refreshWidget();
    logger.debug(`Message from ${message.sender} in ${room}`);
    const common = {
      room,
      room_id: message.roomId,
      sender: message.sender,
      text: text.slice(0, 1000),
    };
    await fire(TRIGGERS.MESSAGE, common);
    const command = parseCommand(text, config.command_prefix);
    if (command) {
      await fire(TRIGGERS.COMMAND, {
        ...common,
        command: command.command,
        arguments: command.args.slice(0, 1000),
      });
    }
  }

  async function reply(roomId, text) {
    try {
      await client.sendMessage(roomId, textContent(text, { notice: true }));
    } catch (err) {
      logger.warn(`Cannot answer in Matrix: ${err.message}`);
    }
  }

  async function handleConversation(message, text) {
    const { sender, roomId } = message;
    if (data.contactRooms?.[sender] !== roomId) {
      data.contactRooms = { ...data.contactRooms, [sender]: roomId };
      save();
    }
    if (LINK_CODE.test(text)) {
      try {
        const user = await gladys.linkContact(text.toUpperCase(), sender, sender);
        logger.info(`Matrix account ${sender} linked to a Gladys user`);
        const language = BOT_TEXT[user?.language] ? user.language : config.language;
        await reply(roomId, pick(BOT_TEXT, language).linked(user?.first_name || sender));
        return;
      } catch (err) {
        if (err?.status !== 404) {
          logger.warn(`Cannot link ${sender}: ${err.message}`);
          await reply(roomId, pick(BOT_TEXT, config.language).unavailable);
          return;
        }
        // Not a valid code: maybe a word that looks like one, for the brain.
      }
    }
    try {
      await gladys.publishMessage(sender, text.slice(0, MAX_TEXT_LENGTH), {
        createdAt: new Date(message.ts || now()),
      });
      brainLog.ok();
      logger.debug(`Message from ${sender} passed to Gladys`);
    } catch (err) {
      if (err?.status === 404) {
        logger.info(`Message from ${sender}, whose account is not linked: instructions sent`);
        await reply(roomId, pick(BOT_TEXT, config.language).notLinked);
        return;
      }
      brainLog.fail(`Cannot pass a message to Gladys: ${err.message}`);
      await reply(roomId, pick(BOT_TEXT, config.language).unavailable);
    }
  }

  // --- Configuration -------------------------------------------------------------

  async function stopLoop() {
    controller?.abort();
    controller = null;
    await running;
    running = null;
  }

  async function applyConfig(raw) {
    await loaded;
    await stopLoop();
    config = normalizeConfig(raw);
    client = null;
    userId = null;
    lastError = null;
    roomEntries = new Map();
    roomFailures = [];
    aliasCache.clear();
    const homeserver = parseHomeserver(config.homeserver_url);
    const hasCredentials =
      config.access_token !== '' || (config.bot_user !== '' && config.password !== '');
    if (!config.homeserver_url) {
      configError = new MatrixError(ERROR_KINDS.NOT_CONFIGURED, 'No homeserver address');
    } else if (!homeserver) {
      configError = new MatrixError(ERROR_KINDS.INVALID_URL, 'Homeserver address not understood');
    } else if (!hasCredentials) {
      configError = new MatrixError(ERROR_KINDS.NO_CREDENTIALS, 'No access token nor password');
    } else {
      configError = null;
    }
    if (configError) {
      setConnection(CONNECTION.NOT_CONFIGURED);
      await publishStatus(false, errorTexts(configError));
      return;
    }
    client = new MatrixClient({ homeserver, fetch: fetchImpl });
    if (stopped) {
      return;
    }
    controller = new AbortController();
    running = loop(controller.signal).catch((err) => logger.error('Matrix loop stopped', err));
  }

  function requireConnected() {
    if (!client) {
      throw configError;
    }
    if (!userId) {
      throw lastError ?? new MatrixError(ERROR_KINDS.UNREACHABLE, 'Not connected to Matrix yet');
    }
    return client;
  }

  // --- Sending -------------------------------------------------------------------

  /** Sends to a room by id or alias, joining it first when the bot is not in it yet. */
  async function sendToRoom(entry, content) {
    const matrix = requireConnected();
    const roomId = await resolveRoom(entry);
    try {
      return { roomId, eventId: await matrix.sendMessage(roomId, content) };
    } catch (err) {
      if (err.kind !== ERROR_KINDS.FORBIDDEN) {
        throw err;
      }
      await matrix.join(roomId); // invited, or a public room: fails otherwise
      return { roomId, eventId: await matrix.sendMessage(roomId, content) };
    }
  }

  async function sendImage(roomId, file) {
    const image = parseImage(file);
    if (!image || !client) {
      return;
    }
    try {
      const url = await client.upload(image.buffer, image.contentType, `gladys.${image.extension}`);
      await client.sendMessage(roomId, {
        msgtype: 'm.image',
        body: `gladys.${image.extension}`,
        url,
        info: { mimetype: image.contentType, size: image.buffer.length },
      });
    } catch (err) {
      logger.warn(`Image not sent to Matrix: ${err.message}`);
    }
  }

  async function roomForContact(contactId) {
    const known = data.contactRooms?.[contactId];
    if (known) {
      return known;
    }
    const roomId = await requireConnected().createDirectRoom(contactId, 'Gladys');
    logger.info(`Opened a private room with ${contactId}`);
    data.contactRooms = { ...data.contactRooms, [contactId]: roomId };
    save();
    return roomId;
  }

  async function testConnection() {
    if (!client) {
      return each(REPORT_TEXT, (text, lang) => text.failed(errorText(configError, lang)));
    }
    try {
      const { user_id: user } = await client.whoami();
      const lines = (text) => [
        text.connected(user),
        config.rooms.length > 0 ? text.rooms(roomEntries.size, config.rooms.length) : text.noRooms,
        config.allowed_users.length > 0 ? text.users(config.allowed_users.length) : text.noUsers,
      ];
      return each(REPORT_TEXT, (text) => lines(text).join(' '));
    } catch (err) {
      return each(REPORT_TEXT, (text, lang) => text.failed(errorText(err, lang)));
    }
  }

  // --- Handlers ------------------------------------------------------------------

  gladys.onSendMessage(async (contact, message) => {
    const contactId = typeof contact?.id === 'string' ? contact.id : '';
    if (!config.allowed_users.includes(contactId)) {
      // Linked once, then removed from the allowed people: nothing goes out to them.
      logger.debug(
        `Message to ${contactId || 'an unknown contact'} not sent: not an allowed person`,
      );
      return;
    }
    const text = typeof message?.text === 'string' ? message.text : '';
    try {
      const matrix = requireConnected();
      let roomId = await roomForContact(contactId);
      if (text.trim() !== '') {
        try {
          await withTimeout(matrix.sendMessage(roomId, textContent(text)), MESSAGE_TIMEOUT_MS);
        } catch (err) {
          if (err.kind !== ERROR_KINDS.FORBIDDEN) {
            throw err;
          }
          // The person left that room: open a new one.
          delete data.contactRooms[contactId];
          roomId = await roomForContact(contactId);
          await withTimeout(matrix.sendMessage(roomId, textContent(text)), MESSAGE_TIMEOUT_MS);
        }
      }
      if (message?.file) {
        sendImage(roomId, message.file); // after the ack: an upload takes longer than 5 s
      }
    } catch (err) {
      logger.warn(`Message not delivered to ${contactId}: ${err.message}`);
      throw new Error(`Matrix: ${errorText(err, 'en')}`, { cause: err });
    }
  });

  gladys.onSceneAction(SCENE_ACTION_KEY, async (fields) => {
    const room = typeof fields?.room === 'string' ? fields.room.trim() : '';
    const text = typeof fields?.message === 'string' ? fields.message : '';
    if (room === '' || text.trim() === '') {
      throw new Error('Matrix: the room and the message are required');
    }
    try {
      const { eventId } = await sendToRoom(
        room,
        textContent(text, { notice: fields.notice === true }),
      );
      logger.info(`Scene message sent to ${room}`);
      return { sent: true, event_id: eventId, error: '' };
    } catch (err) {
      logger.warn(`Scene message not sent to ${room}: ${err.message}`);
      return { sent: false, event_id: '', error: errorText(err, config.language) };
    }
  });

  gladys.onAction(ACTION_KEY, () => testConnection());

  gladys.onWidgetGet(WIDGET_KEY, async ({ language }) => {
    await loaded;
    return buildWidgetContent(
      {
        connection,
        userId,
        rooms: { joined: roomEntries.size, total: config.rooms.length },
        recent: data.recent ?? [],
      },
      language,
    );
  });

  gladys.onWidgetAction(WIDGET_KEY, async (actionKey) => {
    if (actionKey !== TEST_ACTION) {
      throw new Error(`Unknown widget action "${actionKey}"`);
    }
    const report = await testConnection();
    return each(report, (text) => (text.length > 200 ? `${text.slice(0, 199)}…` : text));
  });

  gladys.onConfigUpdated((raw) => applyConfig(raw));

  gladys.on('connected', () => {
    lastStatus = null; // a new connection: publish the status again
    return applyConfig(gladys.config).catch((err) =>
      logger.error('Cannot apply the configuration', err),
    );
  });

  return {
    get config() {
      return config;
    },
    get connection() {
      return connection;
    },
    get data() {
      return data;
    },
    async stop() {
      stopped = true;
      await stopLoop();
      await store.flush();
    },
  };
}

function withTimeout(promise, ms) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(
        () => reject(new MatrixError(ERROR_KINDS.TIMEOUT, `No answer within ${ms} ms`)),
        ms,
      );
    }),
  ]).finally(() => clearTimeout(timer));
}
