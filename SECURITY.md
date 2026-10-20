# Security policy

## Reporting a vulnerability

Please do **not** report a security problem in a public issue, pull request or
forum post.

Report it privately through GitHub instead: open the **Security** tab of this
repository, then **Report a vulnerability**.

No such button? Private reporting is not enabled yet: open an issue that only
asks the maintainers for a private contact, without any detail of the problem,
and send the report there.

Include, when you can:

- the version of the integration and of Gladys;
- what an attacker can do, and the steps to reproduce it;
- the log lines that help (remove tokens, passwords and addresses first).

The fix ships as a new version of the integration, and the advisory is
published once users can update.

## Supported versions

Only the latest release receives security fixes: update the integration from
Gladys before reporting a problem.

## Scope

In scope: the code of this repository and the Docker image it publishes.

What the integration keeps and where:

- The configuration (homeserver address, bot user name, password, access
  token, allowed people, watched rooms) is stored by Gladys; the password and
  the token are `secret` fields.
- `/data/matrix-state.json` holds the access token obtained by password login
  and its device id, the sync position, the private room of each linked
  person, the rooms already warned about encryption, and the last 5 messages
  of the watched rooms (for the widget). No message of a private conversation
  is stored.
- The integration only talks to the configured homeserver (HTTPS or HTTP) and
  to Gladys. It never logs a token nor a password.

The bot passes the messages of a linked person to Gladys with the authority of
that Gladys user, and only for the Matrix ids of the allowed list. Messages
are not end-to-end encrypted: the homeserver can read them.

Out of scope: Gladys Assistant itself (see its
[security policy](https://github.com/GladysAssistant/Gladys/security/policy)),
and the third-party services and devices the integration talks to (the
homeserver and the Matrix clients).
