// -----------------------------------------------------------------------------
// Integration configuration (the `config_schema` of the manifest), normalized
// so the rest of the code never deals with `undefined`, stray spaces or a
// half-typed address.
// -----------------------------------------------------------------------------

export const LANGUAGES = ['en', 'fr', 'de', 'es'];

// Defaults: they MUST stay consistent with the `default` values declared in the
// `config_schema` of the manifest (test/manifest.test.js).
export const DEFAULT_CONFIG = {
  homeserver_url: '',
  bot_user: '',
  password: '',
  access_token: '',
  rooms: '',
  allowed_users: '',
  command_prefix: '!',
  language: 'fr',
};

const trimmed = (value) => (typeof value === 'string' ? value.trim() : '');

// A Matrix user id: @localpart:server (the server may carry a port).
const USER_ID = /^@[^\s:@]+:[^\s]+$/;
// A room: !opaque:server (or a bare !opaque since room version 12) or #alias:server.
const ROOM_ID = /^![^\s]+$/;
const ROOM_ALIAS = /^#[^\s:#]+:[^\s]+$/;

export const isUserId = (value) => USER_ID.test(value);
export const isRoomId = (value) => ROOM_ID.test(value);
export const isRoomAlias = (value) => ROOM_ALIAS.test(value);

/** Splits a list typed in a text field: commas, semicolons, spaces or new lines. */
export function parseList(value) {
  const items = trimmed(value)
    .split(/[\s,;]+/)
    .map((item) => item.trim())
    .filter((item) => item !== '');
  return [...new Set(items)];
}

/**
 * The homeserver address as a URL, or null when it is empty or not understood.
 * A bare host name gets https://, the only scheme a public homeserver speaks.
 * @param {string} value
 * @returns {URL|null}
 */
export function parseHomeserver(value) {
  const text = trimmed(value).replace(/\/+$/, '');
  if (text === '') {
    return null;
  }
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
      return null;
    }
    url.search = '';
    url.hash = '';
    return url;
  } catch {
    return null;
  }
}

/**
 * Merge the user config with the defaults.
 * @param {Record<string, unknown>} [raw] config returned by the SDK
 */
export function normalizeConfig(raw = {}) {
  const config = raw ?? {};
  const prefix = trimmed(config.command_prefix);
  return {
    homeserver_url: trimmed(config.homeserver_url),
    bot_user: trimmed(config.bot_user),
    password: typeof config.password === 'string' ? config.password : '',
    access_token: trimmed(config.access_token),
    rooms: parseList(config.rooms),
    allowed_users: parseList(config.allowed_users).filter(isUserId),
    // One to three characters, no space: "!" by default, "/" for the habits of Telegram.
    command_prefix: prefix === '' || prefix.length > 3 ? DEFAULT_CONFIG.command_prefix : prefix,
    language: LANGUAGES.includes(config.language) ? config.language : DEFAULT_CONFIG.language,
  };
}
