# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

## [0.1.2] - 2026-10-23

## [0.1.1] - 2026-10-18

### Added

- TechnoVE stations read over their local API (no cloud, no account), up to
  four stations by IP address: one device each, keyed by its MAC address.
- Status (unplugged, plugged in and waiting, charging, faults, schedule),
  connector and charging state (charging-station category), estimated power,
  current, input and output voltage, energy of the session (a plain sensor,
  never an energy index), maximum current, charging allowed, automatic
  charging, load sharing and its conflict (read only).
- Start and stop buttons and a maximum current list (8 A to the rating of
  the station), refused unless "Allow the commands" is on (off by default);
  each command reads the station first and is answered within Gladys' 5 s.
- Reads every 30 s (configurable); failures retried after 30 s to 5 minutes;
  a 429 pauses every path, kept in `/data`.
- A created device that no configured station gives any more (address
  removed, or no answer since the start) shows "Station unreachable", its
  connector unavailable and an unreachable badge; the status names it.
- A stop is never blocked by a command in flight; any other command is
  refused at once while one runs.
- A stop sent again after a command in flight keeps the station busy until
  it is done (a newer start is refused meanwhile); it is cancelled by a newer
  command, never sent during a 429 pause, and its own 429 pauses every path.
  With a station no longer read, the status never starts with "Connected".
- A 429 pause is never shorter than the refresh interval; a fifth address is
  reported ("four at most") instead of being dropped silently; readings
  outside the bounds of their feature are not published.
- "Test the connection" button; documentation in English and French;
  `LICENSE` and `THIRD_PARTY_NOTICES.md` shipped in the image.

[Unreleased]: https://github.com/LM1LC3N7/gladys-technove/compare/v0.1.2...HEAD
[0.1.2]: https://github.com/LM1LC3N7/gladys-technove/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/LM1LC3N7/gladys-technove/releases/tag/v0.1.1
