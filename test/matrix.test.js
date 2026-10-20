// -----------------------------------------------------------------------------
// The Matrix side alone: configuration parsing, the client against recorded
// Conduit answers, the sync parser, the Markdown rendering, the widget.
// -----------------------------------------------------------------------------

import test from 'node:test';
import assert from 'node:assert/strict';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import { DEFAULT_CONFIG, normalizeConfig, parseHomeserver, parseList } from '../src/config.js';
import { ERROR_KINDS, MatrixClient, MatrixError } from '../src/matrix/client.js';
import { markdownToHtml, parseImage, textContent } from '../src/matrix/format.js';
import { parseSync, stripReplyFallback } from '../src/matrix/sync.js';
import { CONNECTION, buildWidgetContent } from '../src/widgets.js';
import { BOT, fixture } from './helpers/world.js';

// --- Configuration ---------------------------------------------------------------

test('normalizeConfig: defaults, lists, allowed people as Matrix ids only', () => {
  assert.deepEqual(normalizeConfig(), { ...DEFAULT_CONFIG, rooms: [], allowed_users: [] });
  const config = normalizeConfig({
    rooms: ' #home:example.org, !abc:example.org\n#home:example.org ',
    allowed_users: '@alice:example.org; bob, @carol:example.org:8448',
    command_prefix: '  ',
    language: 'it',
  });
  assert.deepEqual(config.rooms, ['#home:example.org', '!abc:example.org']);
  assert.deepEqual(config.allowed_users, ['@alice:example.org', '@carol:example.org:8448']);
  assert.equal(config.command_prefix, '!');
  assert.equal(config.language, 'fr');
  assert.equal(normalizeConfig({ command_prefix: '/' }).command_prefix, '/');
  assert.deepEqual(parseList(undefined), []);
});

test('parseHomeserver: https implied, no credentials in the address', () => {
  assert.equal(parseHomeserver('matrix.org').href, 'https://matrix.org/');
  assert.equal(parseHomeserver('http://192.0.2.10:8008/').href, 'http://192.0.2.10:8008/');
  assert.equal(parseHomeserver('ftp://matrix.org'), null);
  assert.equal(parseHomeserver('https://user:pw@matrix.org'), null);
  assert.equal(parseHomeserver(''), null);
});

// --- Client ------------------------------------------------------------------------

/** A fetch answering one recorded body, and recording the request. */
function answering(status, body, calls = []) {
  return async (url, init) => {
    calls.push({ url: String(url), init });
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });
  };
}

const homeserver = new URL('https://matrix.test');

test('client: login keeps the token, a wrong password is a bad login', async () => {
  const calls = [];
  const client = new MatrixClient({ homeserver, fetch: answering(200, fixture('login'), calls) });
  const session = await client.login('gladys', 'secret', 'GLADYSDEV1');
  assert.equal(session.user_id, BOT);
  assert.equal(client.accessToken, fixture('login').access_token);
  const body = JSON.parse(calls[0].init.body);
  assert.deepEqual(body.identifier, { type: 'm.id.user', user: 'gladys' });
  assert.equal(body.device_id, 'GLADYSDEV1');
  assert.equal(calls[0].init.headers.authorization, undefined);

  const refused = new MatrixClient({ homeserver, fetch: answering(403, fixture('login-wrong')) });
  await assert.rejects(refused.login('gladys', 'nope'), { kind: ERROR_KINDS.BAD_LOGIN });
});

test('client: errors are typed and never carry the token', async () => {
  const token = 'syt_very_secret';
  const cases = [
    [401, fixture('whoami-unknown'), ERROR_KINDS.TOKEN],
    [404, fixture('alias-unknown'), ERROR_KINDS.NOT_FOUND],
    [403, fixture('send-notjoined'), ERROR_KINDS.FORBIDDEN],
    [502, 'Bad gateway', ERROR_KINDS.SERVER],
    [404, '<html>Not found</html>', ERROR_KINDS.NOT_MATRIX],
    [200, '<html>Element</html>', ERROR_KINDS.NOT_MATRIX],
  ];
  for (const [status, body, kind] of cases) {
    const client = new MatrixClient({
      homeserver,
      accessToken: token,
      fetch: answering(status, body),
    });
    const err = await client.whoami().catch((error) => error);
    assert.ok(err instanceof MatrixError, `${status}`);
    assert.equal(err.kind, kind, `${status} ${body}`);
    assert.equal(err.message.includes(token), false);
  }
  const down = new MatrixClient({
    homeserver,
    accessToken: token,
    fetch: async () => {
      throw new TypeError('fetch failed', { cause: { code: 'ECONNREFUSED' } });
    },
  });
  await assert.rejects(down.whoami(), { kind: ERROR_KINDS.UNREACHABLE, message: /ECONNREFUSED/ });
  const none = new MatrixClient({ homeserver, fetch: answering(200, {}) });
  await assert.rejects(none.whoami(), { kind: ERROR_KINDS.NO_CREDENTIALS });
});

test('client: a short 429 is waited for once, then the call goes through', async () => {
  let calls = 0;
  const client = new MatrixClient({
    homeserver,
    accessToken: 't',
    fetch: async () => {
      calls += 1;
      return calls === 1
        ? new Response(JSON.stringify({ errcode: 'M_LIMIT_EXCEEDED', retry_after_ms: 5 }), {
            status: 429,
          })
        : new Response(JSON.stringify(fixture('send')), { status: 200 });
    },
  });
  assert.equal(
    await client.sendMessage('!r:matrix.test', { msgtype: 'm.text', body: 'x' }),
    fixture('send').event_id,
  );
  assert.equal(calls, 2);
  const limited = new MatrixClient({
    homeserver,
    accessToken: 't',
    fetch: answering(429, { errcode: 'M_LIMIT_EXCEEDED', retry_after_ms: 60_000 }),
  });
  await assert.rejects(limited.whoami(), { kind: ERROR_KINDS.RATE_LIMITED, retryAfterMs: 60_000 });
});

test('client: paths are encoded, the sync asks for a long poll only with a position', async () => {
  const calls = [];
  const client = new MatrixClient({
    homeserver,
    accessToken: 't',
    fetch: answering(200, { room_id: '!x' }, calls),
  });
  await client.resolveAlias('#maison:matrix.test');
  await client.join('!q7FH:matrix.test');
  await client.sync({ filter: '{}' });
  await client.sync({ since: 's1', timeoutMs: 30_000 });
  assert.equal(
    calls[0].url,
    'https://matrix.test/_matrix/client/v3/directory/room/%23maison%3Amatrix.test',
  );
  assert.equal(
    calls[1].url,
    'https://matrix.test/_matrix/client/v3/join/!q7FH%3Amatrix.test?server_name=matrix.test&via=matrix.test',
  );
  assert.match(calls[2].url, /\/sync\?timeout=0&filter=%7B%7D&set_presence=offline$/);
  assert.match(calls[3].url, /\/sync\?since=s1&timeout=30000&set_presence=offline$/);
});

// --- Sync --------------------------------------------------------------------------

test('parseSync: the invitation of a real Conduit answer, with its inviter', () => {
  const parsed = parseSync(fixture('sync-invite'), BOT);
  assert.equal(parsed.nextBatch, '261');
  assert.deepEqual(parsed.invites, [
    { roomId: fixture('alias').room_id, inviter: '@alice:matrix.test' },
  ]);
  assert.deepEqual(parsed.messages, []);
});

test('parseSync: the message of a real Conduit answer, without the membership events', () => {
  const parsed = parseSync(fixture('sync-message'), BOT);
  assert.deepEqual(parsed.messages, [
    {
      roomId: fixture('alias').room_id,
      eventId: '$Wr_w4FD9LTb13meHKiw876q0WdOCjrXZsBkURhBZ1xs',
      sender: '@alice:matrix.test',
      ts: 1792522107139,
      msgtype: 'm.text',
      body: '!lumieres off',
      edit: false,
    },
  ]);
  assert.deepEqual(parseSync(null, BOT), {
    nextBatch: null,
    invites: [],
    messages: [],
    encrypted: [],
  });
});

test('stripReplyFallback: a reply keeps what the person typed', () => {
  assert.equal(
    stripReplyFallback('> <@bob:matrix.test> Lights?\n> on\n\n!lights off'),
    '!lights off',
  );
  assert.equal(stripReplyFallback('  hello  '), 'hello');
});

// --- Format --------------------------------------------------------------------------

test('markdownToHtml: what Gladys writes, rendered; HTML typed in a message escaped', () => {
  assert.equal(
    markdownToHtml(
      '**Living room**: 21 °C\n- door _open_\n- `alarm` off\n\n[Gladys](https://gladysassistant.com)',
    ),
    '<p><strong>Living room</strong>: 21 °C</p><ul><li>door <em>open</em></li><li><code>alarm</code> off</li></ul>' +
      '<p><a href="https://gladysassistant.com">Gladys</a></p>',
  );
  assert.equal(
    markdownToHtml('<script>x</script> & co'),
    '<p>&lt;script&gt;x&lt;/script&gt; &amp; co</p>',
  );
  assert.equal(markdownToHtml('[x](javascript:alert(1))'), '<p>[x](javascript:alert(1))</p>');
  assert.equal(
    markdownToHtml('# Title\n1. one\n2. two'),
    '<h3>Title</h3><ol><li>one</li><li>two</li></ol>',
  );
  assert.equal(markdownToHtml('```\n**raw**\n```'), '<pre><code>**raw**</code></pre>');
  assert.equal(markdownToHtml('snake_case_name'), '<p>snake_case_name</p>');
});

test('textContent: plain text stays plain, Markdown gets its HTML', () => {
  assert.deepEqual(textContent('Hello, porte-fenêtre ouverte !'), {
    msgtype: 'm.text',
    body: 'Hello, porte-fenêtre ouverte !',
  });
  assert.equal(textContent('**x**', { notice: true }).msgtype, 'm.notice');
  assert.equal(textContent('**x**').formatted_body, '<p><strong>x</strong></p>');
  assert.equal(textContent('a'.repeat(20_000)).body.length, 16_000);
});

test('parseImage: the "image/jpg;base64,..." of Gladys', () => {
  const image = parseImage('image/jpg;base64,/9j/4AAQ');
  assert.equal(image.contentType, 'image/jpeg');
  assert.equal(image.extension, 'jpg');
  assert.equal(image.buffer.length, 6);
  assert.equal(parseImage('data:image/png;base64,iVBORw0KGgo=').extension, 'png');
  assert.equal(parseImage('text/plain;base64,aGk='), null);
  assert.equal(parseImage(null), null);
});

// --- Widget --------------------------------------------------------------------------

test('the widget fits the budget of the core in every state', () => {
  const recent = Array.from({ length: 5 }, (_, i) => ({
    room: '#a-very-long-room-name:example.org',
    sender: '@alice:example.org',
    text: 'x'.repeat(500),
    at: new Date(Date.UTC(2026, 9, 20, 10, i)).toISOString(),
  }));
  for (const connection of Object.values(CONNECTION)) {
    for (const items of [[], recent]) {
      for (const language of ['en', 'fr', 'de', 'es']) {
        const content = buildWidgetContent(
          {
            connection,
            userId: connection === CONNECTION.CONNECTED ? BOT : null,
            rooms: { joined: 1, total: 2 },
            recent: items,
          },
          language,
        );
        assert.deepEqual(validateWidgetContent(content), [], `${connection} ${language}`);
      }
    }
  }
});
