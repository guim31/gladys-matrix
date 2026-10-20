// -----------------------------------------------------------------------------
// Reading a /sync answer: the invitations received and the messages of the
// joined rooms, flattened and sorted, with only what the integration uses.
// Everything the server sends besides (state, receipts, typing...) is ignored.
// -----------------------------------------------------------------------------

// The filter sent with every sync: no presence, no account data, no typing,
// only the events read below. The server may ignore parts of it: the parsing
// does not rely on it.
export const SYNC_FILTER = JSON.stringify({
  presence: { not_types: ['*'] },
  account_data: { not_types: ['*'] },
  room: {
    account_data: { not_types: ['*'] },
    ephemeral: { not_types: ['*'] },
    state: { types: [], lazy_load_members: true },
    timeline: { limit: 30, types: ['m.room.message', 'm.room.encrypted'] },
  },
});

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const events = (block) => (Array.isArray(block?.events) ? block.events.filter(isObject) : []);

/**
 * @typedef {object} IncomingMessage
 * @property {string} roomId
 * @property {string} eventId
 * @property {string} sender
 * @property {number} ts origin_server_ts, in milliseconds
 * @property {string} msgtype m.text, m.notice, m.emote, m.image...
 * @property {string} body
 * @property {boolean} edit an edit (m.replace) of an earlier message
 */

/**
 * @param {object} response the JSON of GET /sync
 * @returns {{
 *   nextBatch: string|null,
 *   invites: Array<{ roomId: string, inviter: string|null }>,
 *   messages: IncomingMessage[],
 *   encrypted: Array<{ roomId: string, sender: string, ts: number }>,
 * }}
 */
export function parseSync(response, botUserId) {
  const rooms = isObject(response?.rooms) ? response.rooms : {};
  const invites = [];
  for (const [roomId, room] of Object.entries(isObject(rooms.invite) ? rooms.invite : {})) {
    const own = events(room?.invite_state).find(
      (event) => event.type === 'm.room.member' && event.state_key === botUserId,
    );
    invites.push({ roomId, inviter: typeof own?.sender === 'string' ? own.sender : null });
  }

  const messages = [];
  const encrypted = [];
  for (const [roomId, room] of Object.entries(isObject(rooms.join) ? rooms.join : {})) {
    for (const event of events(room?.timeline)) {
      if (typeof event.sender !== 'string' || event.sender === botUserId) {
        continue; // its own messages: never an input, so no loop
      }
      const ts = Number.isFinite(event.origin_server_ts) ? event.origin_server_ts : 0;
      if (event.type === 'm.room.encrypted') {
        encrypted.push({ roomId, sender: event.sender, ts });
        continue;
      }
      const content = isObject(event.content) ? event.content : {};
      if (event.type !== 'm.room.message' || typeof content.body !== 'string') {
        continue; // a redacted message has no body
      }
      messages.push({
        roomId,
        eventId: typeof event.event_id === 'string' ? event.event_id : '',
        sender: event.sender,
        ts,
        msgtype: typeof content.msgtype === 'string' ? content.msgtype : '',
        body: content.body,
        edit: content['m.relates_to']?.rel_type === 'm.replace',
      });
    }
  }
  messages.sort((a, b) => a.ts - b.ts);

  return {
    nextBatch: typeof response?.next_batch === 'string' ? response.next_batch : null,
    invites,
    messages,
    encrypted,
  };
}

/**
 * The text a user typed, without the quote of the message answered: a reply
 * still carries the "> <@user> quoted text" fallback in its body.
 * @param {string} body
 */
export function stripReplyFallback(body) {
  const lines = body.split('\n');
  if (!lines[0]?.startsWith('> ')) {
    return body.trim();
  }
  let index = 0;
  while (index < lines.length && lines[index].startsWith('>')) {
    index += 1;
  }
  return lines.slice(index).join('\n').trim();
}
