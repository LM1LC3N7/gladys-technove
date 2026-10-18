# gladys-technove

[Gladys Assistant](https://gladysassistant.com) external integration for
**TechnoVE** EV charging stations (Quebec) through their local API: status,
connector and charging state, power (estimated), current, voltages, energy
of the session, maximum current and load sharing (read only); start, stop
and the maximum current behind an off-by-default option. **Unofficial API,
never tested with a real station. Not affiliated with TechnoVE.**

User documentation: [docs/en.md](docs/en.md) · [docs/fr.md](docs/fr.md).

## How it works

```
Gladys ⇄ SDK ⇄ src/handlers.js ⇄ src/app.js (TechnoveApp)
                                  ├─ src/technove/client.js  read, commands, parsing (own fields, exact types)
                                  ├─ src/technove/http.js    the only network access (node:http, bounded)
                                  ├─ src/devices.js          the device and its states (pure)
                                  ├─ src/publisher.js        states within 300/min
                                  └─ src/store.js            /data/technove-state.json (429 pause)
```

- **Reads**: `GET http://<station>/station/get/info` every 30 s (configurable,
  10 s – 10 min), each station on its own timer; failures
  retried after 30 s, 1, 2, 5 min, never under the interval.
- **Device**: `ext:<selector>:technove:<mac>` (the `id` of the API), never the
  IP address. Readings on `energy-sensor` (W, A, V), the session energy on
  `electrical-vehicle-charge/last-charge-energy-added` (kWh, a plain sensor:
  never an index, never `publishEnergyConsumption`), the connector and the
  charging state on the core's `charging-station` category.
- **Commands** (`allow_commands`, off by default): two `button/push`
  features (start, stop) and a `text/select` (8 A to `maxStationCurrent`),
  never a switch nor a writable binary. Each command reads the station
  first and decides on that read only, checks the option again right before
  sending, leaves within 3.5 s of the click or is refused unsent, and is
  answered by 4.3 s; a silence or a 5xx is "sent, without confirmation",
  followed by reads 5 s and 20 s later. One at a time per station; never
  retried. The ack never waits for a publication to Gladys.
- **Guards**: after a command, until a read shows it (or 90 s), a new
  command of the same kind is sent even when the station still shows the
  wanted state; a read equal to the start state lifts nothing.
- **Hostile answers**: 64 KB at most, only own fields read with their exact
  type (no prototype pollution; a missing value refuses a command), no
  answer text in the logs.

## Credits

The local API, its fields, the status codes and the commands are ported from
[python-technove](https://github.com/Moustachauve/pytechnove) (Christophe
Gagnier, MIT, 2.1.3). See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
Modelled on the sibling integrations
[gladys-ohme](https://github.com/LM1LC3N7/gladys-ohme) (charging station) and
[gladys-devialet](https://github.com/LM1LC3N7/gladys-devialet) (local HTTP).

## Development

```bash
npm install
npm test                                        # node --test, no network
npm run lint && npm run format:check
npm run audit                                   # npm audit --omit=dev
npm run cover                                   # cover.png, plain Node
npx github:GladysAssistant/integration-store .  # store admission checks
```

Tests never touch the network: the stations are a fake behind the injected
transport, Gladys is the SDK's fake; `test/client.test.js` runs the real
transport against a loopback server.

## Releasing

**Actions → Release → Run workflow** (patch / minor / major): bumps the
version in `package.json` and the manifest, rolls `CHANGELOG.md`, tags, builds
the multi-arch image to GHCR and publishes the GitHub Release.

## License

Apache-2.0 (`LICENSE`). The ported logic comes from MIT projects, credited in
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) (also shipped in the Docker
image).
