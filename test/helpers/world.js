// -----------------------------------------------------------------------------
// The integration wired to the fake Gladys of the SDK and to a fake Matrix
// homeserver (a `fetch` replacement answering with the real Conduit answers of
// test/fixtures/matrix/). No network, a virtual clock, manual sleeps.
// -----------------------------------------------------------------------------

import { readFileSync } from 'node:fs';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { registerHandlers } from '../../src/app.js';

export const fixture = (name) =>
  JSON.parse(readFileSync(new URL(`../fixtures/matrix/${name}.json`, import.meta.url), 'utf8'));

export const HOMESERVER = 'https://matrix.test';
export const BOT = '@gladys:matrix.test';
export const ALICE = '@alice:matrix.test';
export const MALLORY = '@mallory:matrix.test';
export const PASSWORD = 'pass-gladys-123';
export const ROOM = fixture('alias').room_id; // #maison:matrix.test
export const ALIAS = '#maison:matrix.test';
export const PRIVATE_ROOM = '!private-alice:matrix.test';
export const START = Date.parse('2026-10-20T10:00:00Z');

export const BASE_CONFIG = {
  homeserver_url: HOMESERVER,
  bot_user: 'gladys',
  password: PASSWORD,
  rooms: ALIAS,
  allowed_users: ALICE,
  language: 'en',
};

const json = (status, body) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** A fake homeserver: just enough of the client-server API, recorded. */
export function createFakeHomeserver() {
  const server = {
    down: null, // an error code (ECONNREFUSED...) makes every request fail
    tokens: new Set(),
    logins: 0,
    aliases: new Map([[ALIAS, ROOM]]),
    joined: new Set(),
    joinable: new Set([ROOM]),
    sent: [], // { roomId, content }
    created: [], // createRoom bodies
    uploads: [],
    requests: [], // { method, path, since }
    syncs: [], // queued sync bodies (without next_batch)
    batch: 0,
    waiters: [],
    forbidSend: new Set(),
    syncError: null, // { status, body } answered once by the next sync
  };

  /** Queues a sync answer; a long poll waiting for one resolves. */
  server.push = (rooms) => {
    server.syncs.push(rooms);
    server.waiters.splice(0).forEach((wake) => wake());
  };

  server.fetch = async (url, init = {}) => {
    const { pathname, searchParams } = new URL(url);
    const method = init.method ?? 'GET';
    const path = decodeURIComponent(pathname.replace(/^\/_matrix\/(client|media)\/v3/, ''));
    server.requests.push({ method, path, since: searchParams.get('since') });
    if (server.down) {
      throw new TypeError('fetch failed', { cause: { code: server.down } });
    }
    const token = (init.headers?.authorization ?? '').replace(/^Bearer /, '');
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : init.body;

    if (method === 'POST' && path === '/login') {
      if (body.identifier?.user !== 'gladys' || body.password !== PASSWORD) {
        return json(403, fixture('login-wrong'));
      }
      server.logins += 1;
      const answer = { ...fixture('login'), access_token: `token-${server.logins}` };
      server.tokens.add(answer.access_token);
      return json(200, answer);
    }
    if (!server.tokens.has(token)) {
      return json(401, fixture('whoami-unknown'));
    }
    if (path === '/account/whoami') {
      return json(200, fixture('whoami'));
    }
    if (path === '/joined_rooms') {
      return json(200, { joined_rooms: [...server.joined] });
    }
    if (path.startsWith('/directory/room/')) {
      const roomId = server.aliases.get(path.slice('/directory/room/'.length));
      return roomId
        ? json(200, { room_id: roomId, servers: ['matrix.test'] })
        : json(404, fixture('alias-unknown'));
    }
    if (method === 'POST' && path.startsWith('/join/')) {
      const target = path.slice('/join/'.length);
      const roomId = server.aliases.get(target) ?? target;
      if (!server.joinable.has(roomId)) {
        return json(403, fixture('send-notjoined'));
      }
      server.joined.add(roomId);
      return json(200, { room_id: roomId });
    }
    const send = path.match(/^\/rooms\/([^/]+)\/send\/m\.room\.message\/(.+)$/);
    if (method === 'PUT' && send) {
      const roomId = send[1];
      if (!server.joined.has(roomId) || server.forbidSend.has(roomId)) {
        return json(403, fixture('send-notjoined'));
      }
      server.sent.push({ roomId, content: body });
      return json(200, { event_id: `$event-${server.sent.length}` });
    }
    if (method === 'POST' && path === '/createRoom') {
      server.created.push(body);
      const roomId = `!created-${server.created.length}:matrix.test`;
      server.joined.add(roomId);
      return json(200, { room_id: roomId });
    }
    if (method === 'POST' && path === '/upload') {
      server.uploads.push({ size: init.body.length, type: init.headers['content-type'] });
      return json(200, { content_uri: 'mxc://matrix.test/upload1' });
    }
    if (path === '/sync') {
      if (server.syncError) {
        const { status, body: error } = server.syncError;
        server.syncError = null;
        return json(status, error);
      }
      if (searchParams.get('since') && server.syncs.length === 0) {
        // Long poll: held until something is pushed or the request is aborted.
        await new Promise((resolve, reject) => {
          server.waiters.push(resolve);
          init.signal?.addEventListener('abort', () => reject(init.signal.reason));
        });
      }
      const rooms = searchParams.get('since') ? server.syncs.shift() : {};
      server.batch += 1;
      return json(200, { next_batch: `s${server.batch}`, rooms });
    }
    return json(404, { errcode: 'M_UNRECOGNIZED', error: 'Unrecognized request' });
  };
  return server;
}

/** A timeline event, shaped like the ones of sync-message.json. */
export function message(sender, body, { ts = START, msgtype = 'm.text', id, relates } = {}) {
  const content = { msgtype, body };
  if (relates) {
    content['m.relates_to'] = relates;
  }
  return {
    content,
    event_id: id ?? `$${Math.random().toString(36).slice(2)}`,
    origin_server_ts: ts,
    sender,
    type: 'm.room.message',
  };
}

/** The `rooms` block of a sync answer with these events in one joined room. */
export const joinedRoom = (roomId, events) => ({ join: { [roomId]: { timeline: { events } } } });

/** The `rooms` block of an invitation, shaped like sync-invite.json. */
export function invitation(roomId, inviter) {
  return {
    invite: {
      [roomId]: {
        invite_state: {
          events: [
            {
              content: { membership: 'invite' },
              sender: inviter,
              state_key: BOT,
              type: 'm.room.member',
            },
          ],
        },
      },
    },
  };
}

export function createMemoryStore(initial = {}) {
  return {
    data: structuredClone(initial),
    writes: 0,
    async load() {
      return structuredClone(this.data);
    },
    async save(data) {
      this.data = structuredClone(data);
      this.writes += 1;
    },
    async flush() {},
  };
}

/** Lets pending promises and fetches settle. */
export async function settle(rounds = 20) {
  for (let i = 0; i < rounds; i += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

export async function createWorld({
  config = BASE_CONFIG,
  stored = {},
  server = createFakeHomeserver(),
  linkedUser,
} = {}) {
  const gladys = createFakeGladys({ config, linkedUser });
  const store = createMemoryStore(stored);
  const clock = { time: START };
  const sleeps = [];
  const app = registerHandlers(gladys, {
    fetch: server.fetch,
    store,
    now: () => clock.time,
    sleep: (ms, signal) =>
      new Promise((resolve) => {
        const entry = { ms, resolve };
        sleeps.push(entry);
        signal.addEventListener('abort', resolve);
      }),
  });
  /** Ends the oldest pending sleep, moving the clock forward by its length. */
  const wake = async () => {
    await settle();
    const entry = sleeps.shift();
    if (!entry) {
      throw new Error('nothing is sleeping');
    }
    clock.time += entry.ms;
    entry.resolve();
    await settle();
    return entry.ms;
  };
  await gladys.connect();
  await settle();
  return { gladys, fake: gladys.fake, server, store, clock, sleeps, wake, app };
}
