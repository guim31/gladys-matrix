// -----------------------------------------------------------------------------
// Texts the integration writes outside the widget (src/widgets.js): the
// connection status, the "Test the connection" report, the errors, and what
// the bot answers in Matrix. Four languages, the four of the Gladys interface;
// German says "du", Spanish "usted". test/i18n.test.js checks every table.
// -----------------------------------------------------------------------------

import { ERROR_KINDS } from './matrix/client.js';

export const LANGUAGE_FALLBACK = 'en';

export const pick = (text, language) => text[language] ?? text[LANGUAGE_FALLBACK];

/** Applies `render` to each language of a table of functions. */
export const each = (table, render) =>
  Object.fromEntries(Object.entries(table).map(([lang, value]) => [lang, render(value, lang)]));

// One short explanation per error kind (src/matrix/client.js).
export const ERROR_TEXT = {
  [ERROR_KINDS.NOT_CONFIGURED]: {
    en: 'enter the address of the homeserver and the bot account in the configuration',
    fr: "saisissez l'adresse du serveur et le compte du robot dans la configuration",
    de: 'gib die Adresse des Servers und das Bot-Konto in der Konfiguration ein',
    es: 'introduzca la dirección del servidor y la cuenta del bot en la configuración',
  },
  [ERROR_KINDS.INVALID_URL]: {
    en: 'homeserver address not understood, e.g. https://matrix.example.org',
    fr: 'adresse du serveur incomprise, ex. https://matrix.example.org',
    de: 'Serveradresse nicht verstanden, z. B. https://matrix.example.org',
    es: 'dirección del servidor no válida, p. ej. https://matrix.example.org',
  },
  [ERROR_KINDS.NO_CREDENTIALS]: {
    en: 'enter an access token, or the user name and password of the bot',
    fr: "saisissez un jeton d'accès, ou l'identifiant et le mot de passe du robot",
    de: 'gib ein Zugriffstoken oder Benutzername und Passwort des Bots ein',
    es: 'introduzca un token de acceso, o el usuario y la contraseña del bot',
  },
  [ERROR_KINDS.UNREACHABLE]: {
    en: 'the homeserver does not answer',
    fr: 'le serveur Matrix ne répond pas',
    de: 'der Matrix-Server antwortet nicht',
    es: 'el servidor Matrix no responde',
  },
  [ERROR_KINDS.TIMEOUT]: {
    en: 'the homeserver answers too slowly',
    fr: 'le serveur Matrix répond trop lentement',
    de: 'der Matrix-Server antwortet zu langsam',
    es: 'el servidor Matrix responde demasiado lento',
  },
  [ERROR_KINDS.NOT_MATRIX]: {
    en: 'no Matrix server at this address: check it (client API, not the Element page)',
    fr: "pas de serveur Matrix à cette adresse : vérifiez-la (API client, pas la page d'Element)",
    de: 'kein Matrix-Server unter dieser Adresse: prüfe sie (Client-API, nicht die Element-Seite)',
    es: 'no hay servidor Matrix en esta dirección: revísela (API cliente, no la página de Element)',
  },
  [ERROR_KINDS.BAD_LOGIN]: {
    en: 'user name or password of the bot refused',
    fr: 'identifiant ou mot de passe du robot refusé',
    de: 'Benutzername oder Passwort des Bots abgelehnt',
    es: 'usuario o contraseña del bot rechazados',
  },
  [ERROR_KINDS.TOKEN]: {
    en: 'access token refused (expired or revoked): enter a new one',
    fr: "jeton d'accès refusé (expiré ou révoqué) : saisissez-en un nouveau",
    de: 'Zugriffstoken abgelehnt (abgelaufen oder widerrufen): Gib ein neues ein',
    es: 'token de acceso rechazado (caducado o revocado): introduzca uno nuevo',
  },
  [ERROR_KINDS.FORBIDDEN]: {
    en: 'refused by the homeserver: is the bot a member of the room?',
    fr: 'refusé par le serveur : le robot est-il membre du salon ?',
    de: 'vom Server abgelehnt: Ist der Bot Mitglied des Raums?',
    es: 'rechazado por el servidor: ¿es el bot miembro de la sala?',
  },
  [ERROR_KINDS.NOT_FOUND]: {
    en: 'room or alias not found on the homeserver',
    fr: 'salon ou alias introuvable sur le serveur',
    de: 'Raum oder Alias auf dem Server nicht gefunden',
    es: 'sala o alias no encontrado en el servidor',
  },
  [ERROR_KINDS.RATE_LIMITED]: {
    en: 'too many requests: the homeserver asks to slow down',
    fr: 'trop de requêtes : le serveur demande de ralentir',
    de: 'zu viele Anfragen: Der Server bittet um eine Pause',
    es: 'demasiadas solicitudes: el servidor pide ir más despacio',
  },
  [ERROR_KINDS.SERVER]: {
    en: 'the homeserver answered with an error',
    fr: 'le serveur Matrix a répondu par une erreur',
    de: 'der Matrix-Server hat mit einem Fehler geantwortet',
    es: 'el servidor Matrix ha respondido con un error',
  },
};

/** The explanation of an error, in one language. */
export function errorText(err, language) {
  const text = ERROR_TEXT[err?.kind] ?? ERROR_TEXT[ERROR_KINDS.SERVER];
  return pick(text, language);
}

/** The explanation of an error, in the four languages. */
export const errorTexts = (err) =>
  each(ERROR_TEXT[err?.kind] ?? ERROR_TEXT[ERROR_KINDS.SERVER], (text) => text);

// The connection status of the Configuration screen when some watched rooms
// could not be joined (the bot works in the others).
export const ROOMS_STATUS = {
  en: (failed) => `Connected, but these rooms could not be joined: ${failed}`,
  fr: (failed) => `Connecté, mais ces salons n'ont pas pu être rejoints : ${failed}`,
  de: (failed) => `Verbunden, aber diese Räume konnten nicht betreten werden: ${failed}`,
  es: (failed) => `Conectado, pero no se ha podido entrar en estas salas: ${failed}`,
};

// The report of the "Test the connection" action (and of the widget button).
export const REPORT_TEXT = {
  en: {
    connected: (user) => `Connected as ${user}.`,
    rooms: (joined, total) => `Watched rooms joined: ${joined}/${total}.`,
    noRooms: 'No watched room yet.',
    users: (count) => `Allowed people: ${count}.`,
    noUsers: 'No allowed person: the bot answers nobody.',
    failed: (error) => `Connection failed: ${error}.`,
  },
  fr: {
    connected: (user) => `Connecté en tant que ${user}.`,
    rooms: (joined, total) => `Salons surveillés rejoints : ${joined}/${total}.`,
    noRooms: 'Aucun salon surveillé pour l’instant.',
    users: (count) => `Personnes autorisées : ${count}.`,
    noUsers: 'Aucune personne autorisée : le robot ne répond à personne.',
    failed: (error) => `Échec de la connexion : ${error}.`,
  },
  de: {
    connected: (user) => `Verbunden als ${user}.`,
    rooms: (joined, total) => `Beobachtete Räume betreten: ${joined}/${total}.`,
    noRooms: 'Noch kein beobachteter Raum.',
    users: (count) => `Erlaubte Personen: ${count}.`,
    noUsers: 'Keine erlaubte Person: Der Bot antwortet niemandem.',
    failed: (error) => `Verbindung fehlgeschlagen: ${error}.`,
  },
  es: {
    connected: (user) => `Conectado como ${user}.`,
    rooms: (joined, total) => `Salas vigiladas en las que ha entrado: ${joined}/${total}.`,
    noRooms: 'Todavía no hay ninguna sala vigilada.',
    users: (count) => `Personas autorizadas: ${count}.`,
    noUsers: 'Ninguna persona autorizada: el bot no responde a nadie.',
    failed: (error) => `Fallo de conexión: ${error}.`,
  },
};

// What the bot writes in Matrix, in a private conversation.
export const BOT_TEXT = {
  en: {
    linked: (name) =>
      `Hello ${name}! Your Matrix account is now linked to Gladys: write to me here.`,
    notLinked:
      'Your Matrix account is not linked to Gladys yet. In Gladys, open Integrations → Matrix → Configuration, click "Generate a link code", then send me the code here.',
    unavailable: 'Gladys cannot read your message right now, please try again later.',
    encrypted:
      'This room is encrypted and I cannot read it. Talk to me in a room without end-to-end encryption.',
  },
  fr: {
    linked: (name) => `Bonjour ${name} ! Votre compte Matrix est lié à Gladys : écrivez-moi ici.`,
    notLinked:
      'Votre compte Matrix n’est pas encore lié à Gladys. Dans Gladys, ouvrez Intégrations → Matrix → Configuration, cliquez sur « Générer un code de liaison », puis envoyez-moi le code ici.',
    unavailable: 'Gladys ne peut pas lire votre message pour l’instant, réessayez plus tard.',
    encrypted:
      'Ce salon est chiffré et je ne peux pas le lire. Parlez-moi dans un salon sans chiffrement de bout en bout.',
  },
  de: {
    linked: (name) =>
      `Hallo ${name}! Dein Matrix-Konto ist jetzt mit Gladys verknüpft: Schreib mir hier.`,
    notLinked:
      'Dein Matrix-Konto ist noch nicht mit Gladys verknüpft. Öffne in Gladys Integrationen → Matrix → Konfiguration, klicke auf „Verknüpfungscode generieren“ und schick mir dann den Code hier.',
    unavailable: 'Gladys kann deine Nachricht gerade nicht lesen, versuch es später noch einmal.',
    encrypted:
      'Dieser Raum ist verschlüsselt und ich kann ihn nicht lesen. Schreib mir in einem Raum ohne Ende-zu-Ende-Verschlüsselung.',
  },
  es: {
    linked: (name) => `¡Hola ${name}! Su cuenta Matrix está vinculada a Gladys: escríbame aquí.`,
    notLinked:
      'Su cuenta Matrix aún no está vinculada a Gladys. En Gladys, abra Integraciones → Matrix → Configuración, pulse «Generar un código de vinculación» y envíeme el código aquí.',
    unavailable: 'Gladys no puede leer su mensaje en este momento, inténtelo más tarde.',
    encrypted:
      'Esta sala está cifrada y no puedo leerla. Hábleme en una sala sin cifrado de extremo a extremo.',
  },
};
