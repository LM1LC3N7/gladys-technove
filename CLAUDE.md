# CLAUDE.md

Project rules for coding assistants (Claude Code reads this file) and for
human contributors. Read **[TODO.md](./TODO.md) first**: status, decisions
already taken and the next milestones.

## What this is

A Gladys Assistant **external integration** of type `device`: a Node.js
service (Node 22+, ESM, no build step) in its own sandboxed Docker container,
talking to Gladys through `@gladysassistant/integration-sdk` (v0.15), its only
runtime dependency (HTTP goes through `node:http`). It reads TechnoVE EV
charging stations over their local API (no cloud, no account) and shows each
on one Gladys device; start, stop and the maximum current can be changed
behind an off-by-default option. Unofficial API, never tested with a real
station, not affiliated with TechnoVE.

## Commands

```bash
npm install
npm test                                  # node --test, the built-in runner
node --test test/app.test.js              # one file
npm run lint                              # ESLint
npm run format:check                      # Prettier, as the CI runs it
npm run format                            # Prettier, fix in place
npm run audit                             # npm audit --omit=dev
npm run cover                             # cover.png (800x534), plain Node
npx github:GladysAssistant/integration-store .   # store admission checks
```

Run `format:check`, `lint`, `test` (Node 22 and 24) and `audit` before every
commit.

## Architecture

```
index.js                  SDK bootstrap only
src/handlers.js           every SDK handler -> the app (shared with the tests)
src/app.js                TechnoveApp: per-station timers, failures, 429 pause, devices,
                          states, badge, status, the test button, the three commands, guards
src/technove/client.js    read and commands (python-technove), parsing (own fields, exact types)
src/technove/http.js      the only network access (node:http, bounded), error kinds
src/devices.js            -> the Gladys device and its states (pure)
src/publisher.js          states within 300/min
src/store.js              /data/technove-state.json: the 429 pause (bounded to 6 h)
src/config.js             config_schema normalized (addresses, allow_commands, interval, language)
src/constants.js          paths, status codes, current bounds, feature roles, limits, timings
src/i18n.js               runtime texts, feature and status names (en/fr)
test/fixtures/            fake stations behind the transport; Gladys is the SDK's fake
scripts/cover.mjs         cover.png generator
```

## Rules

- **External ids are forever**: device `technove:<mac>`, features `status`,
  `connector-status`, `charging-state`, `power`, `current`, `voltage-in`,
  `voltage-out`, `session-energy`, `max-current`, `charging-enabled`,
  `auto-charge`, `sharing-mode`, `sharing-conflict`, `start-charge`,
  `stop-charge`, `set-max-current`. Every role is always built: a
  republished device never loses a feature.
- Manifest keys (`addresses`, `allow_commands`, `poll_interval`, `language`,
  the action `test_connection`) are frozen.
- **Commands**: never a switch nor a writable binary (a "turn everything
  off" must not reach them), refused unless `allow_commands` (checked on
  arrival and again right before sending); decided on a fresh read only,
  refused when a value is missing; never sent after 3.5 s; a silence or a
  5xx is "sent, without confirmation"; never retried; one at a time per
  station; the ack never waits for Gladys.
- **Energy**: the session energy is a plain sensor; never an
  `index`/`energy` feature, never `publishEnergyConsumption`.
- **Answers are hostile**: own fields only, exact types, 64 KB at most;
  never log the text of an answer.
- Units only from the core's `DEVICE_FEATURE_UNITS_BY_CATEGORY`.
- Files are UTF-8 without BOM (`test/encoding.test.js`); tests never touch
  the network.
- Code, comments, README in English; `docs/en.md` and `docs/fr.md` kept in sync.
- Every user-visible change adds a line under `## [Unreleased]` in
  `CHANGELOG.md`; versions belong to the Release workflow.
