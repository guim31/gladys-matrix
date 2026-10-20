# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

### Added

- Talk to Gladys from Matrix: each Gladys user links their Matrix account with
  a code, then writes to the bot in a private room; the answers of Gladys, the
  _Send Message_ scene action and the system messages arrive there, Markdown
  rendered, camera images included.
- A list of allowed people: the bot ignores everyone else, invitations
  included. Empty by default.
- Watched rooms and the _Matrix message received_ and _Matrix command
  received_ triggers (`!lights off`: command `lights`, arguments `off`).
- The _Send a Matrix message_ scene action (Markdown, scene variables,
  optional discreet notice), with the outputs sent, event id and error.
- The _Matrix connection lost_ and _Matrix connection restored_ triggers, and
  the connection status of the Configuration screen.
- The _Matrix_ dashboard widget and the _Test the connection_ action.
- Password login (token kept in `/data`) or an access token; the sync resumes
  after a restart, messages older than 5 minutes are skipped.
- English, French, German and Spanish.

[Unreleased]: https://github.com/guim31/gladys-matrix/commits/main
