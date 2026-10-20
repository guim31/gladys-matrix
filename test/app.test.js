// -----------------------------------------------------------------------------
// The integration end to end: the fake Gladys of the SDK on one side, a fake
// homeserver answering like Conduit on the other.
// -----------------------------------------------------------------------------

import test from 'node:test';
import assert from 'node:assert/strict';
import { GladysApiError } from '@gladysassistant/integration-sdk';
import {
  ACTION_KEY,
  LOST_AFTER_MS,
  MEMBERS_CACHE_MS,
  MAX_MESSAGE_AGE_MS,
  SCENE_ACTION_KEY,
  TRIGGERS,
  parseCommand,
} from '../src/app.js';
import { WIDGET_KEY } from '../src/widgets.js';
import {
  ALIAS,
  ALICE,
  BASE_CONFIG,
  BOT,
  MALLORY,
  PRIVATE_ROOM,
  ROOM,
  START,
  createFakeHomeserver,
  createWorld,
  invitation,
  joinedRoom,
  message,
  settle,
} from './helpers/world.js';

async function connected(t, options) {
  const world = await createWorld(options);
  t.after(() => world.app.stop());
  assert.equal(world.app.connection, 'connected');
  return world;
}

/** Pushes a sync answer and waits for the loop to handle it. */
async function deliver(world, rooms) {
  world.server.push(rooms);
  await settle();
}

test('not configured: says what is missing, never calls the homeserver', async (t) => {
  const server = createFakeHomeserver();
  const world = await createWorld({ config: {}, server });
  t.after(() => world.app.stop());
  assert.equal(world.app.connection, 'not_configured');
  assert.equal(world.fake.connectionStatus.connected, false);
  assert.match(world.fake.connectionStatus.message.en, /address of the homeserver/);
  assert.deepEqual(server.requests, []);

  await world.fake.configUpdated({ homeserver_url: 'ftp://matrix.test' });
  assert.match(world.fake.connectionStatus.message.fr, /adresse du serveur incomprise/);
  await world.fake.configUpdated({ homeserver_url: 'matrix.test' }); // https:// is implied
  assert.match(world.fake.connectionStatus.message.de, /Zugriffstoken oder Benutzername/);
  assert.deepEqual(server.requests, []);
});

test('password login: the token is kept in /data, the watched room joined by its alias', async (t) => {
  const world = await connected(t);
  assert.equal(world.server.logins, 1);
  assert.equal(world.store.data.session.access_token, 'token-1');
  assert.equal(world.store.data.session.device_id, 'GLADYSDEV1');
  assert.ok(world.server.joined.has(ROOM));
  assert.deepEqual(world.fake.connectionStatus, { connected: true });
  assert.equal(JSON.stringify(world.store.data).includes(BASE_CONFIG.password), false);

  // A restart reuses the stored session and resumes the sync where it stopped.
  const since = world.store.data.since;
  assert.ok(since);
  await world.app.stop();
  const before = world.server.requests.length;
  const again = await connected(t, { server: world.server, stored: world.store.data });
  assert.equal(again.server.logins, 1, 'no second login');
  const syncs = again.server.requests.slice(before).filter((request) => request.path === '/sync');
  assert.equal(syncs[0].since, since);
});

test('a revoked session logs in again, a wrong password is said and retried slowly', async (t) => {
  const server = createFakeHomeserver();
  server.tokens.add('old-token');
  const world = await connected(t, {
    server,
    stored: { account: undefined, session: { access_token: 'revoked', device_id: 'GLADYSDEV1' } },
  });
  assert.equal(server.logins, 1);

  const wrong = await createWorld({ config: { ...BASE_CONFIG, password: 'nope' } });
  t.after(() => wrong.app.stop());
  assert.equal(wrong.app.connection, 'disconnected');
  assert.match(wrong.fake.connectionStatus.message.en, /user name or password of the bot refused/);
  assert.equal(wrong.sleeps[0].ms, 5 * 60 * 1000);
  assert.deepEqual(wrong.fake.sceneEvents, [], 'never connected: nothing was lost');
  assert.equal(world.app.connection, 'connected');
});

test('an access token replaces the password', async (t) => {
  const server = createFakeHomeserver();
  server.tokens.add('syt_given');
  const world = await connected(t, {
    server,
    config: { homeserver_url: 'https://matrix.test/', access_token: 'syt_given', rooms: ROOM },
  });
  assert.equal(server.logins, 0);
  assert.equal(world.store.data.session, undefined);
  assert.ok(server.joined.has(ROOM));
});

test('a message in a watched room fires the triggers, a command too', async (t) => {
  const world = await connected(t);
  await deliver(world, joinedRoom(ROOM, [message(ALICE, '!Lumieres off salon')]));
  const common = { room: ALIAS, room_id: ROOM, sender: ALICE, text: '!Lumieres off salon' };
  assert.deepEqual(world.fake.sceneEvents, [
    { key: TRIGGERS.MESSAGE, data: common },
    { key: TRIGGERS.COMMAND, data: { ...common, command: 'lumieres', arguments: 'off salon' } },
  ]);
  const widget = await world.fake.widgetGet(WIDGET_KEY, { language: 'en', settings: {} });
  const [card] = widget.data.content.components[1].items;
  assert.equal(card.title, ALICE);
  assert.equal(card.badge.text, '#maison');
});

test('the bot obeys nobody else, and skips edits, notices, its own and old messages', async (t) => {
  const world = await connected(t);
  await deliver(
    world,
    joinedRoom(ROOM, [
      message(MALLORY, '!garage open'),
      message(BOT, '!garage open'),
      message(ALICE, '!garage open', { msgtype: 'm.notice' }),
      message(ALICE, '* !garage open', { relates: { rel_type: 'm.replace', event_id: '$x' } }),
      message(ALICE, '!garage open', { ts: START - MAX_MESSAGE_AGE_MS - 1 }),
    ]),
  );
  assert.deepEqual(world.fake.sceneEvents, []);
  assert.deepEqual(world.server.sent, []);
});

test('the first sync of an account is history: no trigger for what was there before', async (t) => {
  const server = createFakeHomeserver();
  const world = await createWorld({ server });
  t.after(() => world.app.stop());
  assert.ok(server.requests.some((request) => request.path === '/sync' && request.since === null));
  assert.deepEqual(world.fake.sceneEvents, []);
});

test('invitations: accepted from an allowed person only', async (t) => {
  const world = await connected(t);
  world.server.joinable.add(PRIVATE_ROOM).add('!mallory:matrix.test');
  await deliver(world, invitation(PRIVATE_ROOM, ALICE));
  await deliver(world, invitation('!mallory:matrix.test', MALLORY));
  assert.ok(world.server.joined.has(PRIVATE_ROOM));
  assert.equal(world.server.joined.has('!mallory:matrix.test'), false);
});

test('private conversation: the link code links the account, then messages go to Gladys', async (t) => {
  const world = await connected(t, {
    linkedUser: { selector: 'alice', first_name: 'Alice', language: 'fr' },
  });
  world.server.joined.add(PRIVATE_ROOM);
  await deliver(world, joinedRoom(PRIVATE_ROOM, [message(ALICE, 'abcd2345')]));
  assert.equal(world.fake.contacts[0].contact_id, ALICE);
  assert.match(world.server.sent[0].content.body, /^Bonjour Alice/);
  assert.equal(world.server.sent[0].content.msgtype, 'm.notice');
  assert.deepEqual(world.fake.sceneEvents, [], 'a private conversation fires no trigger');

  await deliver(world, joinedRoom(PRIVATE_ROOM, [message(ALICE, 'Turn on the kitchen light')]));
  assert.deepEqual(world.fake.messages, [
    {
      contact_id: ALICE,
      text: 'Turn on the kitchen light',
      created_at: new Date(START).toISOString(),
    },
  ]);

  // The answer of Gladys comes back in the same room, Markdown rendered.
  const ack = await world.fake.sendMessage({ id: ALICE }, { text: 'It is **21 °C**', file: null });
  assert.equal(ack.success, true);
  const answer = world.server.sent.at(-1);
  assert.equal(answer.roomId, PRIVATE_ROOM);
  assert.deepEqual(answer.content, {
    msgtype: 'm.text',
    body: 'It is **21 °C**',
    format: 'org.matrix.custom.html',
    formatted_body: '<p>It is <strong>21 °C</strong></p>',
  });
});

test('an account not linked yet gets the instructions; Gladys down gets an apology', async (t) => {
  const world = await connected(t);
  world.server.joined.add(PRIVATE_ROOM);
  t.mock.method(world.gladys, 'publishMessage', async () => {
    throw new GladysApiError(404, 'NOT_FOUND', 'CONTACT_NOT_FOUND');
  });
  t.mock.method(world.gladys, 'linkContact', async () => {
    throw new GladysApiError(404, 'NOT_FOUND', 'INVALID_LINK_CODE');
  });
  await deliver(world, joinedRoom(PRIVATE_ROOM, [message(ALICE, 'Hello')]));
  assert.match(world.server.sent[0].content.body, /Generate a link code/);
  // A wrong code is a message like any other: the same instructions.
  await deliver(world, joinedRoom(PRIVATE_ROOM, [message(ALICE, 'ZZZZ9999')]));
  assert.match(world.server.sent[1].content.body, /Generate a link code/);

  world.gladys.publishMessage.mock.mockImplementation(async () => {
    throw new GladysApiError(500, 'SERVER_ERROR', 'down');
  });
  await deliver(world, joinedRoom(PRIVATE_ROOM, [message(ALICE, 'Hello')]));
  assert.match(world.server.sent[2].content.body, /try again later/);
});

test('a message of Gladys to a person without a room opens an unencrypted one', async (t) => {
  const world = await connected(t);
  await world.fake.sendMessage({ id: ALICE }, { text: 'Backup failed', file: null });
  assert.equal(world.server.created.length, 1);
  assert.deepEqual(world.server.created[0].invite, [ALICE]);
  assert.equal(world.server.created[0].is_direct, true);
  assert.equal('initial_state' in world.server.created[0], false, 'no m.room.encryption');
  assert.equal(world.server.sent[0].roomId, '!created-1:matrix.test');
  assert.equal(world.server.sent[0].content.body, 'Backup failed');
  assert.equal(world.store.data.contactRooms[ALICE], '!created-1:matrix.test');

  // The person left that room (seen once the member list is a minute old): a new one is opened.
  world.server.members.set('!created-1:matrix.test', [BOT]);
  world.clock.time += MEMBERS_CACHE_MS;
  await world.fake.sendMessage({ id: ALICE }, { text: 'Again', file: null });
  assert.equal(world.server.sent.at(-1).roomId, '!created-2:matrix.test');

  // A camera image follows the text.
  await world.fake.sendMessage(
    { id: ALICE },
    { text: 'Doorbell', file: 'image/jpg;base64,/9j/4AAQ' },
  );
  await settle();
  assert.deepEqual(world.server.uploads, [{ size: 6, type: 'image/jpeg' }]);
  assert.equal(world.server.sent.at(-1).content.msgtype, 'm.image');
});

test('nothing goes out to a contact who is not, or no longer, an allowed person', async (t) => {
  const world = await connected(t);
  const ack = await world.fake.sendMessage({ id: MALLORY }, { text: 'secret', file: null });
  assert.equal(ack.success, true);
  assert.deepEqual(world.server.sent, []);
  assert.deepEqual(world.server.created, []);
});

test('scene action: sends to the room, reports a failure as outputs', async (t) => {
  const world = await connected(t);
  let ack = await world.fake.sceneAction(SCENE_ACTION_KEY, {
    room: ALIAS,
    message: 'Alarm _on_',
    notice: true,
  });
  assert.deepEqual(ack.data.outputs, { sent: true, event_id: '$event-1', error: '' });
  assert.deepEqual(world.server.sent[0], {
    roomId: ROOM,
    content: {
      msgtype: 'm.notice',
      body: 'Alarm _on_',
      format: 'org.matrix.custom.html',
      formatted_body: '<p>Alarm <em>on</em></p>',
    },
  });

  ack = await world.fake.sceneAction(SCENE_ACTION_KEY, {
    room: '#nowhere:matrix.test',
    message: 'x',
  });
  assert.deepEqual(ack.data.outputs, {
    sent: false,
    event_id: '',
    error: 'room or alias not found on the homeserver',
  });

  // A room the bot was invited to but not in yet: joined, then written to.
  world.server.joinable.add('!other:matrix.test');
  ack = await world.fake.sceneAction(SCENE_ACTION_KEY, {
    room: '!other:matrix.test',
    message: 'Hi',
  });
  assert.equal(ack.data.outputs.sent, true);

  ack = await world.fake.sceneAction(SCENE_ACTION_KEY, { room: ' ', message: 'x' });
  assert.equal(ack.success, false);
});

test('connection lost after a minute of failures, restored once it answers again', async (t) => {
  const world = await connected(t);
  world.server.down = 'ECONNREFUSED';
  world.server.push({}); // ends the long poll in progress: the next request fails
  await settle();
  assert.equal(world.app.connection, 'connected', 'one failure is not a loss');
  let waited = 0;
  while (waited < LOST_AFTER_MS) {
    waited += await world.wake();
  }
  assert.equal(world.app.connection, 'disconnected');
  assert.deepEqual(world.fake.sceneEvents, [
    { key: TRIGGERS.LOST, data: { error: 'the homeserver does not answer' } },
  ]);
  assert.equal(world.fake.connectionStatus.connected, false);
  await world.wake();
  assert.equal(world.fake.sceneEvents.length, 1, 'fired once');

  world.server.down = null;
  world.server.push({});
  await world.wake();
  assert.equal(world.app.connection, 'connected');
  assert.deepEqual(world.fake.sceneEvents.at(-1), { key: TRIGGERS.RESTORED, data: { user: BOT } });
  assert.deepEqual(world.fake.connectionStatus, { connected: true });
});

test('a sync position the server forgot restarts from now', async (t) => {
  const world = await connected(t);
  world.server.syncError = { status: 400, body: { errcode: 'M_UNKNOWN', error: 'Invalid since' } };
  world.server.push({});
  await settle();
  const fresh = world.server.requests.filter((r) => r.path === '/sync' && r.since === null);
  assert.equal(fresh.length, 2, 'the first sync, then the one after the refusal');
  assert.equal(world.app.connection, 'connected');
});

test('an encrypted room gets one explanation, never more', async (t) => {
  const world = await connected(t);
  world.server.joined.add(PRIVATE_ROOM);
  const encrypted = {
    type: 'm.room.encrypted',
    sender: ALICE,
    origin_server_ts: START,
    content: {},
  };
  await deliver(world, joinedRoom(PRIVATE_ROOM, [encrypted, encrypted]));
  await deliver(world, joinedRoom(PRIVATE_ROOM, [encrypted]));
  assert.equal(world.server.sent.length, 1);
  assert.match(world.server.sent[0].content.body, /encrypted/);
});

test('test action and widget button: the account, the rooms, the allowed people', async (t) => {
  const world = await connected(t);
  const ack = await world.fake.action(ACTION_KEY, {});
  assert.equal(
    ack.data.message.en,
    'Connected as @gladys:matrix.test. Watched rooms joined: 1/1. Allowed people: 1.',
  );
  const button = await world.fake.widgetAction(
    WIDGET_KEY,
    'test',
    {},
    { settings: {}, values: {} },
  );
  assert.match(button.data.message.fr, /^Connecté en tant que/);

  const empty = await createWorld({ config: {} });
  t.after(() => empty.app.stop());
  const report = await empty.fake.action(ACTION_KEY, {});
  assert.match(report.data.message.es, /^Fallo de conexión/);
});

test('parseCommand: prefix, word in lower case, the rest as arguments', () => {
  assert.deepEqual(parseCommand('!Lights off now', '!'), { command: 'lights', args: 'off now' });
  assert.deepEqual(parseCommand('!status', '!'), { command: 'status', args: '' });
  assert.deepEqual(parseCommand('/lumières on', '/'), { command: 'lumières', args: 'on' });
  assert.equal(parseCommand('! lights', '!'), null);
  assert.equal(parseCommand('lights', '!'), null);
});

// --- Regressions found in review ------------------------------------------------------

test('two configurations saved in a row leave one sync loop, and stop() stops it', async (t) => {
  const world = await connected(t);
  await Promise.all([
    world.fake.configUpdated({ ...BASE_CONFIG }),
    world.fake.configUpdated({ ...BASE_CONFIG }),
  ]);
  await settle();
  await deliver(world, joinedRoom(ROOM, [message(ALICE, 'hello')]));
  assert.equal(world.fake.sceneEvents.length, 1, 'one loop: one trigger');
  await world.app.stop();
  const syncs = world.server.requests.filter((request) => request.path === '/sync').length;
  world.server.push({});
  world.server.push({});
  await settle();
  assert.equal(world.server.requests.filter((request) => request.path === '/sync').length, syncs);
});

test('a group room that is not watched is never a conversation with Gladys', async (t) => {
  const world = await connected(t, { config: { ...BASE_CONFIG, rooms: '' } });
  world.server.members.set(ROOM, [BOT, ALICE, '@bob:matrix.test']);
  await deliver(world, joinedRoom(ROOM, [message(ALICE, 'What time is it?')]));
  assert.deepEqual(world.fake.messages, []);
  assert.deepEqual(world.server.sent, [], 'no answer, no instructions');
  assert.equal(world.store.data.contactRooms, undefined);
});

test('a failure right after a recovery is not a loss; no restored without a loss', async (t) => {
  // The homeserver is slow to come up at start: no lost, then no restored.
  const server = createFakeHomeserver();
  server.down = 'ECONNREFUSED';
  const world = await createWorld({ server });
  t.after(() => world.app.stop());
  let waited = 0;
  while (waited < 2 * LOST_AFTER_MS) {
    waited += await world.wake();
  }
  server.down = null;
  await world.wake();
  assert.equal(world.app.connection, 'connected');
  assert.deepEqual(world.fake.sceneEvents, []);
  // One failed sync just after: still connected, nothing fired.
  server.down = 'ECONNREFUSED';
  server.push({});
  await settle();
  assert.equal(world.app.connection, 'connected');
  assert.deepEqual(world.fake.sceneEvents, []);
});

test('a message of Gladys right after the start waits for the login', async (t) => {
  const server = createFakeHomeserver();
  const world = await createWorld({ server, config: {} });
  t.after(() => world.app.stop());
  world.server.joined.add(PRIVATE_ROOM);
  const configured = world.fake.configUpdated({ ...BASE_CONFIG });
  const sent = world.fake.sendMessage({ id: ALICE }, { text: 'Gladys was updated', file: null });
  await configured;
  const ack = await sent;
  assert.equal(ack.success, true);
  assert.equal(world.server.sent.at(-1).content.body, 'Gladys was updated');
});

test('a message refused as too large does not open a new room each time', async (t) => {
  const world = await connected(t);
  await world.fake.sendMessage({ id: ALICE }, { text: 'first', file: null });
  world.server.rejectSend = true;
  const ack = await world.fake.sendMessage({ id: ALICE }, { text: 'x'.repeat(100), file: null });
  assert.equal(ack.success, false);
  assert.match(ack.error, /request refused/);
  assert.equal(world.server.created.length, 1);
});

test('the scene data stays within 1000 characters, a broken event never blocks the sync', async (t) => {
  const world = await connected(t);
  const long = `!${'a'.repeat(1500)} ${'b'.repeat(1500)}`;
  const broken = {
    type: 'm.room.message',
    sender: ALICE,
    origin_server_ts: 9e15,
    content: { msgtype: 'm.text', body: '!x' },
  };
  await deliver(world, joinedRoom(ROOM, [broken, message(ALICE, long)]));
  const command = world.fake.sceneEvents.find((event) => event.key === TRIGGERS.COMMAND);
  assert.equal(command.data.command.length, 1000);
  assert.equal(command.data.arguments.length, 1000);
  assert.equal(command.data.text.length, 1000);
  assert.equal(world.fake.sceneEvents.length, 2, 'the broken event is skipped as too old');
});
