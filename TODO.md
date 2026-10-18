# TODO — TechnoVE v1

Handoff document: what is done, what was decided, what comes next. Keep it
up to date at the end of every milestone.

## Working method

- One milestone at a time, one commit per milestone, tests green before moving on.
- After each milestone: `npm run format:check`, `npm run lint`, `npm test`
  (Node 22 and 24), `npm run audit`, `npx github:GladysAssistant/integration-store .`,
  then update README, `docs/en.md`, `docs/fr.md`, `CHANGELOG.md` and this file.
- No forum topic of its own, no forum post from a module session: the batch
  reserved in /t/10385 (post #262, lot 7) gets one recap message there.
- The `gladys-assistant-integration` topic is added at the first real release only.

## Status

- [x] **Milestone 1 — core** (2026-10-18): local API read of up to four
      stations, one device per MAC, status/connector/charging state,
      estimated power, current, voltages, session energy (plain sensor),
      maximum current, session/auto-charge/sharing flags (read only),
      start/stop buttons and maximum current select behind `allow_commands`
      (off), per-station polling and backoff, 429 pause persisted, test
      button, docs en/fr, cover. Tested against made-up answers only.
- [ ] **Milestone 2 — real station**: run against a real TechnoVE station
      (see "To check"), turn the answers (anonymized) into fixtures.
- [ ] **Milestone 3 — more**: lifetime energy (`energyTotal`, as a plain
      `charge-energy-added-total` sensor, never an index), Wi-Fi signal,
      high-tariff schedule switch and automatic charge (as selects or
      buttons behind the option, never switches), mDNS discovery if the
      station announces itself.

## To check on a real station

- The real answer of `/station/get/info`: types (`status` an integer ASCII
  code, as python-technove reads it?), units (`energySession` in kWh,
  `current` in A, `voltageIn`/`voltageOut` in V), `id` really the MAC.
- `isSessionActive`: is it what `/station/control/start` and `stop` change
  (as Home Assistant's "charging enabled" switch reads it)? What do start
  and stop answer (status code, body), and how long until the info shows it?
- `/station/control/partage`: the body key `" stationNumber"` with its
  leading space (kept as python-technove sends it); the answer; what it does
  while unplugged or in load sharing.
- Statuses S (outside the activation period) and T (high tariff): is a
  vehicle plugged in? (Mapped here to connector "unavailable" and charging
  state "idle".) Does a start override them?
- The power: is `voltageOut × current` close to what the station delivers?
- Rate limits and how the station copes with a read every 10 s.

## Decisions

- **Version 0.1.0 set by hand** in `package.json`, `package-lock.json`, the
  manifest and the `docker_image` tag (`ghcr.io/lm1lc3n7/gladys-technove:0.1.0`);
  the first patch release gives 0.1.1. `test/manifest.test.js` checks the
  four agree.
- **Own client on `node:http`, no Python**: python-technove 2.1.3 (MIT, the
  library of Home Assistant) ported to ~200 lines; no npm client exists.
  Credited in README and `THIRD_PARTY_NOTICES.md` (full MIT notices of
  python-technove and of python-wled, which its request code is based on),
  shipped in the image with `LICENSE` (the standard Apache-2.0 text without
  any name). Runtime dependency: the SDK only. Reference cloned read only in
  `_ref/python-technove` (tag v2.1.3, 097e36d).
- **Addresses** typed by the user (IPv4 or host name, optional port), up to
  four (load sharing links several stations); one device per MAC (the `id`
  of the API), never per IP: a station moving to a new address keeps its
  device. Two addresses answering the same MAC: one device, the first
  address. An answer without a valid MAC never becomes a device (status
  says so).
- **Polling**: every 30 s by default (10 s – 10 min), per station; failures
  30 s, 1, 2, 5 min, never shorter than the interval; no retry inside a
  cycle (python-technove retries 3 times with backoff: not kept). Offline:
  status "Station unreachable", connector UNAVAILABLE, badge unreachable,
  other features keep their last value.
- **429**: unlikely from a LAN device, handled anyway (wave 2 lesson):
  `Retry-After` bounded to 1 min – 6 h, 5 min without it; every path
  (polling, button, commands); persisted in `/data`, bounded to 6 h at a
  restart; a reconnection to Gladys never clears it.
- **Features and units** (core `DEVICE_FEATURE_UNITS_BY_CATEGORY`): power,
  current, input and output voltage on `energy-sensor` (W/A/V, instantaneous);
  session energy on `electrical-vehicle-charge/last-charge-energy-added`
  (kWh) — **a plain sensor, never an index** (wave 2 lesson: the core would
  add it to the energy tab and count each value), no
  `publishEnergyConsumption`, no daily consumption; maximum current on
  `electrical-vehicle-charge/target-current` (A, read only); connector and
  charging state on `charging-station` (values copied from the core). The
  session/auto-charge/sharing flags are `unknown/binary` read only. All fixed
  at creation.
- **Power estimated** as `current × voltageOut` (`voltageIn` when the output
  is 0 or missing): the API gives no power and the brief asks for one; named
  "Power (estimated)". Lifetime energy (`energyTotal`) not published in v1
  (out of the brief).
- **Statuses** (python-technove's Status): A unplugged → AVAILABLE/IDLE;
  B plugged waiting → OCCUPIED, EV_CONNECTED (PAUSED_BY_CHARGER when charging
  is not allowed); C charging, D ventilation → OCCUPIED/CHARGING; E, F, H
  faults → FAULTED/IDLE; S, T schedule → UNAVAILABLE/IDLE (assumption, to
  check); other codes → "Unknown state", no connector published.
- **Commands** (`allow_commands`, off by default, only `true` allows): start
  and stop as two `button/push` features (value 1 only), the maximum current
  as a `text/select` of whole amperes from 8 A to `maxStationCurrent` (the
  options are built from the rating read when the device is published; the
  value is checked again against the rating read just before sending). Never
  a switch nor a writable binary (lot 6 lesson: "turn everything off",
  Google Home, Alexa, HomeKit, MCP, `switch.*` scenes). A select rather than
  a numeric `target-current` command: its widget is known to work in Gladys
  and the value is constrained twice.
- **Command rules** (lot 6 and wave 2/3 lessons): the value is validated
  strictly (null, '', ' ', true, 12.5, '1e1' are refused); the option is
  checked on arrival and again right before sending; the station is read
  again (1.5 s at most) and the command decided on that read only, never
  merged with memory; a missing value refuses (`auto_charge`,
  `isSessionActive`, `inSharingMode`, `maxStationCurrent`); start and stop
  refused while automatic charging is on (as python-technove), start refused
  on a fault or an unknown status; the maximum current refused in load
  sharing (as python-technove), and the rating trusted only as an integer of
  8–80 A. Nothing sent when already so (unless a guard holds). Sent within
  3.5 s of the click or refused unsent; answered by 4.3 s. Outcomes: 2xx →
  success; nothing accepted the connection → "not sent"; connected then
  silent, a 5xx or a broken answer → **"sent, without confirmation"** (never
  "not sent"), guard set; 4xx → "refused by the station"; 429 → pause. Reads
  5 s and 20 s after every command (spaced, not a burst). One command at a
  time per station (a promise chain; a later one keeps its own deadline).
  The ack never waits for Gladys: the fresh read is published in the
  background.
- **Guards** (wave 2/3 lessons): after a command that may have been applied,
  a guard per station and kind (session, current) keeps the start state and
  the wanted one; while it holds (until a read shows a move then the wanted
  state, or 90 s), a command of that kind is always sent, never answered
  "already so" on a state that may not show the previous command yet. A
  read equal to the start state never lifts it.
- **Hostile answers**: 64 KB at most; only own fields of a plain object are
  read, each with its exact type (`Object.hasOwn`); the config takes only its
  known keys; feature ids are matched by a strict pattern and a fixed role
  list (`__proto__`, `constructor` refused). Logs carry error kinds and HTTP
  statuses only.
- **Reconnection to Gladys** (`connected`): republishes status, devices,
  states and badge (the core keeps them in memory); never clears the pause;
  a changed address list or interval restarts the stations.
- **gladys_version >= 5.1.0** (as the sibling local modules); **category
  `energy`**, transport `local`.
- **Not checked here (PIPELINE step 1, main session)**: duplicates in the
  store, the core and the forum were checked when the batch was reserved
  (post #262). No Docker on this PC: the image was not built locally.
