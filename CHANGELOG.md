# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

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
- "Test the connection" button; documentation in English and French;
  `LICENSE` and `THIRD_PARTY_NOTICES.md` shipped in the image.
