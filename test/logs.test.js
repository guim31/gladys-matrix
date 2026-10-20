// -----------------------------------------------------------------------------
// What reaches `docker logs`: the lifecycle at info level, everything per
// message at debug level, repeated failures once, never a token nor a password.
// -----------------------------------------------------------------------------

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BASE_CONFIG,
  ALICE,
  PRIVATE_ROOM,
  ROOM,
  createWorld,
  joinedRoom,
  message,
  settle,
} from './helpers/world.js';

/**
 * Captures the lines of the SDK logger (console.log for debug/info,
 * console.error for warn/error), at every level.
 */
function captureLogs(t) {
  const previous = process.env.LOG_LEVEL;
  process.env.LOG_LEVEL = 'debug';
  const lines = [];
  // The SDK logger writes `[time] [LEVEL] [name]` then the arguments.
  const capture = (prefix, ...args) => {
    const [, level, name] = /\[(DEBUG|INFO|WARN|ERROR)\](?: \[([^\]]+)\])?/.exec(prefix) ?? [];
    const text = args.map((arg) => (arg instanceof Error ? arg.message : String(arg))).join(' ');
    lines.push({ level: level?.toLowerCase(), name, text });
  };
  t.mock.method(console, 'log', capture);
  t.mock.method(console, 'error', capture);
  t.after(() => {
    if (previous === undefined) {
      delete process.env.LOG_LEVEL;
    } else {
      process.env.LOG_LEVEL = previous;
    }
  });
  return {
    lines,
    at: (...levels) => lines.filter((line) => levels.includes(line.level)).map((l) => l.text),
    clear: () => lines.splice(0),
  };
}

test('a normal cycle writes nothing at info level', async (t) => {
  const logs = captureLogs(t);
  const world = await createWorld({
    linkedUser: { selector: 'alice', first_name: 'Alice', language: 'en' },
  });
  t.after(() => world.app.stop());
  assert.ok(logs.at('info').some((line) => line.startsWith('Connected to Matrix as')));
  logs.clear();
  world.server.joined.add(PRIVATE_ROOM);
  world.server.push(joinedRoom(ROOM, [message(ALICE, '!lights off'), message(ALICE, 'hello')]));
  await settle();
  world.server.push(joinedRoom(PRIVATE_ROOM, [message(ALICE, 'What is the temperature?')]));
  await settle();
  await world.fake.sendMessage({ id: ALICE }, { text: '21 °C', file: null });
  await world.fake.widgetGet('matrix', { language: 'en', settings: {} });
  assert.equal(world.fake.sceneEvents.length, 3);
  assert.equal(world.fake.messages.length, 1);
  assert.deepEqual(logs.at('info', 'warn', 'error'), []);
  assert.ok(logs.at('debug').length > 0, 'the details are at debug level');
});

test('a homeserver down: one line when it starts, none per retry', async (t) => {
  const logs = captureLogs(t);
  const world = await createWorld();
  t.after(() => world.app.stop());
  logs.clear();
  world.server.down = 'ECONNREFUSED';
  world.server.push({});
  await settle();
  for (let i = 0; i < 8; i += 1) {
    await world.wake();
  }
  const failures = logs.at('warn', 'error').filter((line) => line.startsWith('Matrix sync failed'));
  assert.equal(failures.length, 1);
  assert.equal(
    logs.at('warn').filter((line) => line.startsWith('Matrix connection lost')).length,
    1,
  );
});

test('no log line ever holds the password or a token', async (t) => {
  const logs = captureLogs(t);
  const world = await createWorld({ config: { ...BASE_CONFIG, password: 'wrong-password' } });
  t.after(() => world.app.stop());
  const tokens = await createWorld({
    config: { ...BASE_CONFIG, password: '', access_token: 'syt_secret_token' },
  });
  t.after(() => tokens.app.stop());
  const all = logs.lines.map((line) => line.text).join('\n');
  assert.ok(all.length > 0);
  for (const secret of ['wrong-password', 'syt_secret_token', 'token-1', BASE_CONFIG.password]) {
    assert.equal(all.includes(secret), false, secret);
  }
});
