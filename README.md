# Matrix for Gladys Assistant

An external integration for [Gladys Assistant](https://gladysassistant.com)
that connects a bot account of [Matrix](https://matrix.org), the open and
decentralized messaging network, to Gladys: talk to Gladys from Element or any
Matrix client, receive the messages of Gladys there, write in Matrix rooms
from your scenes, and start scenes on a message or a command such as
`!lights off`. Works with your own homeserver on the local network (Synapse,
Conduit, conduwuit, Dendrite…) or a public one such as matrix.org.

> **Developed without the hardware: feedback welcome.** The integration was
> tested against a real Conduit 0.10 homeserver (the
> `matrixconduit/matrix-conduit` Docker image), in both directions, but not
> inside a real Gladys nor with every Matrix client. Please report what works
> and what does not in the
> [issues](https://github.com/guim31/gladys-matrix/issues) or on the
> [Gladys forum](https://community.gladysassistant.com).

## Features

- **A two-way chat channel**, like the Telegram bot of Gladys (manifest
  `type: "communication"`, `messaging.receive: true`): each Gladys user links
  their Matrix account with a code from the Configuration screen, then talks
  to Gladys in a private room with the bot. The answers of Gladys, the
  _Send Message_ scene action and the system messages arrive there, Markdown
  rendered; camera images arrive as images.
- **Allowed people only**: the bot ignores the messages and the invitations of
  everyone who is not in the list, which is empty by default.
- **Scene triggers**: _Matrix message received_ (in a watched room, filtered
  by room and sender), _Matrix command received_ (prefix + word, e.g.
  `!garage close`, with the arguments as a variable), _Matrix connection lost_,
  _Matrix connection restored_.
- **Scene action** _Send a Matrix message_: Markdown and scene variables, to a
  room by alias or id, optionally as a discreet notice. Outputs: sent, event
  id, error.
- **Dashboard widget** _Matrix_: connection, bot account, watched rooms, the
  last messages of the watched rooms, a _Test the connection_ button.
- Password login (the token is kept in `/data`) or an access token; the sync
  resumes after a restart, and messages older than 5 minutes are not run.
- Four languages (English, French, German, Spanish).

Compared with [Apprise for Gladys](https://github.com/guim31/gladys-apprise),
which sends notifications to Matrix among 100 other services, this
integration also receives: conversations with Gladys, commands and triggers.

## Requirements

- Gladys Assistant **5.1.0** or later.
- A dedicated Matrix account for the bot, on a homeserver Gladys can reach.
- **Unencrypted rooms**: end-to-end encryption is not supported.

## Installation

In Gladys: **Integrations → Install from GitHub**, then enter
`https://github.com/guim31/gladys-matrix`. Fill in the homeserver address, the
bot account and the allowed people, click **Test the connection**, then each
user links their account. The full documentation is in
[docs/en.md](docs/en.md) (also in [French](docs/fr.md),
[German](docs/de.md) and [Spanish](docs/es.md)).

## How it works

- Client-server API v3: `POST /login` (password, device id reused),
  `GET /account/whoami`, `GET /sync` in long polling (30 s, a filter, the
  position kept in `/data`), `POST /join`, `GET /directory/room/{alias}`,
  `PUT /rooms/{id}/send/m.room.message/{txn}`, `POST /createRoom` (a direct,
  unencrypted room for a person Gladys writes to first),
  `POST /_matrix/media/v3/upload` for camera images. A 429 is honored.
- Rooms listed in the configuration are watched (triggers only); a room with
  only one allowed person and the bot is a private conversation with Gladys
  (`linkContact`, `publishMessage`, `onSendMessage`); any other room is
  ignored, so Gladys never answers where others can read.
- Only `m.text` messages count: notices (other bots), edits and the bot's own
  messages are ignored, so a scene answering a message cannot loop.

## Limits

- No end-to-end encryption (no Olm/Megolm library: too heavy for the sandbox
  and its 256 MB). The bot says it once in an encrypted room.
- Text only: images, files and voice messages sent to the bot are ignored.
- One bot account per Gladys.

## Development

```bash
npm install
npm test            # node --test, against the fake Gladys of the SDK and a fake homeserver
npm run lint
npm run format:check
npx -y github:GladysAssistant/integration-store --skip-image-check .
```

## Credits

- The [Matrix specification](https://spec.matrix.org) (Apache-2.0) of the
  client-server API. The test fixtures are answers recorded from a
  [Conduit](https://conduit.rs) homeserver (Apache-2.0) running in Docker.
- The [Home Assistant `matrix` integration](https://github.com/home-assistant/core/tree/dev/homeassistant/components/matrix)
  (Apache-2.0), built on [matrix-nio](https://github.com/matrix-nio/matrix-nio)
  (ISC): the shape of the configuration (homeserver, bot account, rooms,
  commands with a prefix). No code was copied.
- The logo on the cover is the Matrix logo from
  [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Matrix_logo.svg)
  (public domain, a trademark of The Matrix.org Foundation).
- The `/data` store and the quiet logs come from
  [gladys-gotify](https://github.com/guim31/gladys-gotify); the tests follow
  [gladys-wled](https://github.com/guim31/gladys-wled).

## Disclaimer

This project is not affiliated with, endorsed or sponsored by The Matrix.org
Foundation. Matrix is a trademark of The Matrix.org Foundation C.I.C.

## License

Apache-2.0
