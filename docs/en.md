# Matrix

Talk to Gladys from [Matrix](https://matrix.org), the open and decentralized messaging network (Element,
FluffyChat, Cinny…), the way the Telegram bot of Gladys works: ask a question, run a scene, receive the
messages of Gladys. The integration also writes in Matrix rooms from your scenes, and starts scenes when a
message or a command such as `!lights off` is written in a room it watches. It uses a dedicated bot account,
on your own homeserver (Synapse, Conduit, conduwuit, Dendrite…) or on a public one such as matrix.org.

> **Developed without the hardware: feedback welcome.** The integration was tested against a real Conduit
> 0.10 homeserver, but not inside a real Gladys nor with every Matrix client. Please report what works and
> what does not in the [issues](https://github.com/guim31/gladys-matrix/issues) or on the
> [Gladys forum](https://community.gladysassistant.com).

## What you need

- Gladys Assistant **5.1.0** or later.
- A **dedicated Matrix account for the bot** (for example `@gladys:example.org`), on a homeserver Gladys
  can reach: your own server on the local network, or a public one on the Internet. Do not use your
  personal account: the bot answers in its name.
- **Rooms without end-to-end encryption.** The bot cannot read encrypted rooms (Element encrypts private
  rooms and direct messages by default: turn the option off when you create the room, it cannot be
  changed afterwards).
- The Matrix id of each person allowed to talk to the bot, such as `@alice:example.org`.

## Set up

1. Create the bot account (on matrix.org: an ordinary registration; on your server: as you create the
   other accounts).
2. In Gladys, **Integrations → Matrix → Configuration**:
   - **Homeserver address**: the client API of the server, for example `https://matrix.org` or
     `http://192.168.1.20:8008`. For a server behind its domain name, it is often `https://matrix.` followed
     by the domain.
   - **Bot user name** and **Bot password**: the bot logs in once and keeps its access token in the data
     of the integration. Or fill in **Access token (instead of the password)** with a token of the bot
     account: the user name and the password are then not used.
   - **Allowed people**: the Matrix ids the bot listens to, separated by commas. **Empty, the bot answers
     nobody**: it ignores the messages and the invitations of everyone who is not in this list.
   - **Watched rooms**: the rooms whose messages start scenes, by alias (`#home:example.org`) or by id
     (`!abc…:example.org`, in the room settings, "Advanced"), separated by commas. Invite the bot to a
     private room first: it joins the rooms of this list by itself.
   - **Command prefix**: `!` by default.
   - **Language of the bot**: the language of what the bot writes before a person is linked.
3. Click **Test the connection**: the report gives the account of the bot, the watched rooms it joined and
   the number of allowed people. The connection status of the page says it too.

### Link your Matrix account to talk to Gladys

Each Gladys user who wants to talk to Gladys from Matrix does it once:

1. In Matrix, create a **private room without encryption** and invite the bot (allowed people only: the
   bot ignores the invitations of everyone else). It joins at once.
2. In Gladys, **Integrations → Matrix → Configuration**, block "Link my account": click **Generate a link
   code**.
3. Send the code (8 characters) to the bot in that room. The bot confirms: your Matrix account is linked
   to your Gladys user. You can unlink it from the same block.

## What the bot does

- **In a private room** (a room with only you and the bot, not a watched room; in a group room that is not watched, the bot stays silent): it passes your messages to
  Gladys, with the authority of the linked Gladys user, exactly like the Telegram bot: "What is the
  temperature in the living room?", "Turn off the lights". The answers of Gladys come back in this room.
  The messages Gladys sends to you (the **Send Message** scene action, the system messages) arrive
  there too, Markdown rendered. If Gladys writes to a linked person before any conversation, the bot opens
  an unencrypted private room with them. A camera image sent by a scene arrives as an image.
- **In a watched room**: every message of an allowed person starts the **Matrix message received**
  trigger, and a message starting with the prefix also starts **Matrix command received**. The bot never
  answers there by itself: what happens is up to your scenes.
- **What it ignores**: everyone who is not an allowed person, its own messages, edits of a message,
  notices (what other bots write), and the messages older than 5 minutes when it reads them (written while
  Gladys or the bot was stopped: a "!open garage" from two hours ago does not run now).
- **In an encrypted room**: it cannot read the message and says so once in that room.

## Dashboard

The **Matrix** widget shows whether the bot is connected, its account, the watched rooms it is in, the last
5 messages received in the watched rooms (author, text, date) and a **Test the connection** button. The
private conversations with Gladys are never shown: everyone who sees the dashboard sees the widget.

## Scenes

### Triggers

- **Matrix message received**: an allowed person wrote in a watched room. Filters (empty = any): **Room**
  (written as in the configuration, for example `#home:example.org`) and **Sender** (`@alice:example.org`).
  Variables: Message, Sender, Room, Room id.
- **Matrix command received**: an allowed person wrote a command in a watched room: the prefix, then a
  word, then optional arguments, for example `!lights off kitchen`. Filter **Command**: the word **without
  the prefix, in lower case** (`lights`); and Room, Sender. Variables: Command (`lights`), Arguments
  (`off kitchen`), Message, Sender, Room, Room id. The same message also starts **Matrix message
  received**.
- **Matrix connection lost**: the bot cannot reach the homeserver any more, for a minute, or its
  credentials are refused. Variable: Error. Started once, until the connection comes back.
- **Matrix connection restored**: the bot reaches the homeserver again after a lost connection.
  Variable: Bot account.

### Actions

- **Send a Matrix message**: writes a message in a room, by alias or id. The message accepts the scene
  variables and Markdown (`**bold**`, `_italic_`, lists, links). **Discreet (notice, no ping)** sends a
  notice, which Matrix clients show without an alert. The bot must be in the room, or be able to join it
  (invited, or a public room). Results: Sent (yes/no), Event id, Error. A failed message does not stop
  the scene: test **Sent** with a condition if needed.

To write to one Gladys user rather than to a room, use the **Send Message** action of Gladys: it reaches
their linked Matrix account.

### Scene ideas

- **Garage by command**: trigger **Matrix command received**, command `garage`, room `#home:example.org`;
  then a condition on the variable Arguments equal to `close`, and the action that closes the garage.
- **Doorbell in the family room**: trigger on the doorbell, then **Send a Matrix message** to
  `#home:example.org`: "Someone rang at {{ time }}", followed by the core action that sends the camera
  image to a user.
- **Alert when the bot is cut off**: trigger **Matrix connection lost**, then a notification through
  another channel (Gotify, ntfy, SMS) with the Error variable.

## Troubleshooting

- **"no Matrix server at this address"**: the address is the one of the client API, not the page of the
  Element web client. Open `https://<address>/_matrix/client/versions` in a browser: it must answer a list
  of versions.
- **"user name or password of the bot refused"**: check them by logging in with the bot account in
  Element. An account protected by single sign-on (SSO) only has no password: use an access token.
- **"access token refused"**: the token was revoked (logout of that session) or expired. Enter a new one,
  or the user name and the password.
- **A watched room is not joined**: the status of the page and the test name it. Invite the bot to the
  room (or make it public), then save the configuration again.
- **The bot does not answer me**: is your Matrix id in **Allowed people**, written exactly (with the `@`
  and the server)? Is the room unencrypted? In a private room, is your account linked (the bot then gives
  you the instructions)?
- **A command does not start the scene**: the Command filter is the word without the prefix, in lower
  case: `lights`, not `!Lights`.
- More details in the logs of the integration with `LOG_LEVEL=debug`.

## Limits

- **No end-to-end encryption**: the bot reads and writes in unencrypted rooms only. Its messages travel
  encrypted between your client, the homeserver and Gladys (HTTPS), but are stored readable by the
  homeserver.
- A person linked to Gladys can do from Matrix everything their Gladys user can do: keep the list of
  allowed people short, and protect the bot account (a strong password, no reuse).
- One bot account per Gladys. The bot reads the messages with a 30-second long poll: a command takes
  effect in about one second.
- Images, files and voice messages sent to the bot are ignored; only text counts.
- The bot account uses the rate limits of its homeserver: matrix.org slows down the accounts that send a
  lot, keep the messages of your scenes reasonable.
- Not affiliated with the Matrix.org Foundation. Matrix is a trademark of The Matrix.org Foundation C.I.C.
