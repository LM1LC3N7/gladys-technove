// -----------------------------------------------------------------------------
// End to end: the real SDK wiring (src/handlers.js) against the SDK's fake
// Gladys and fake stations behind the transport. Timers and Date are mocked:
// the tests move the clock.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEVICE_TRANSPORTS } from '@gladysassistant/integration-sdk';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { TechnoveApp } from '../src/app.js';
import { ACTIONS, MINUTE, SECOND, TIMINGS } from '../src/constants.js';
import { CHARGING_STATE, CONNECTOR_STATUS } from '../src/devices.js';
import { registerHandlers } from '../src/handlers.js';
import { memoryStore } from '../src/store.js';
import { HOST, MAC, NOW, fakeStations, info, settle } from './fixtures/fakeStation.js';

const CONFIG = { addresses: HOST };
const ALLOWED = { addresses: HOST, allow_commands: true };
const DEVICE = `ext:test-integration:technove:${MAC}`;
const feature = (role) => `${DEVICE}:${role}`;

async function setup(
  t,
  {
    config = CONFIG,
    server = fakeStations(),
    store = memoryStore(),
    create = true,
    logs = [],
  } = {},
) {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: NOW });
  const gladys = createFakeGladys({ config });
  const app = new TechnoveApp({
    gladys,
    logger: recorder(logs),
    transport: server.transport,
    now: () => Date.now(),
    store,
  });
  registerHandlers(gladys, app);
  await gladys.connect();
  await settle();
  t.after(() => app.stop());
  const advance = async (ms, step = SECOND) => {
    for (let elapsed = 0; elapsed < ms; elapsed += step) {
      t.mock.timers.tick(Math.min(step, ms - elapsed));
      await settle();
    }
  };
  if (create && gladys.fake.discoveredDevices.length > 0) {
    await gladys.fake.deviceCreated(gladys.fake.discoveredDevices[0]);
    await settle();
  }
  const press = async (role, value = 1, wait = 5 * SECOND) => {
    const device = gladys.fake.devices.find((d) => d.external_id === DEVICE);
    const target = device.features.find((f) => f.external_id === feature(role));
    const ack = gladys.fake.setValue(device, target, value);
    await settle();
    await advance(wait, 100);
    return ack;
  };
  return { gladys, app, server, store, advance, logs, press, station: server.stations[HOST] };
}

const recorder = (logs) =>
  Object.fromEntries(
    ['debug', 'info', 'warn', 'error'].map((level) => [
      level,
      (...args) => logs.push(args.map((a) => (a instanceof Error ? a.stack : String(a))).join(' ')),
    ]),
  );

const last = (gladys, role) => gladys.fake.lastState(feature(role));
const message = (gladys) => gladys.fake.connectionStatus?.message ?? {};
const deviceOf = (gladys) => gladys.fake.discoveredDevices.at(-1);
const sent = (server) => server.commands().map((r) => `${r.method} ${r.path}`);

test('without an address, the status asks for it and nothing is requested', async (t) => {
  const server = fakeStations();
  const { gladys } = await setup(t, { config: {}, server });
  assert.equal(server.requests.length, 0);
  assert.equal(gladys.fake.connectionStatus.connected, false);
  assert.match(message(gladys).fr, /adresse IP/);
  const ack = await gladys.fake.action(ACTIONS.TEST_CONNECTION);
  assert.match(ack.data.message.en, /IP address/);
  assert.equal(server.requests.length, 0);
});

test('one read: the device, its features, then its states', async (t) => {
  const { gladys, server } = await setup(t);
  assert.deepEqual(
    server.reads().map((r) => `${r.method} ${r.host}:${r.port}${r.path}`),
    [`GET ${HOST}:80/station/get/info`],
  );
  const device = deviceOf(gladys);
  assert.equal(device.external_id, DEVICE);
  assert.equal(device.name, 'Garage');
  assert.deepEqual(device.params, [
    { name: 'mac_address', value: MAC },
    { name: 'firmware', value: '1.10.3' },
    { name: 'max_station_current', value: '48' },
  ]);
  assert.deepEqual(
    device.features.map((f) => [
      f.external_id.slice(DEVICE.length + 1),
      f.category,
      f.type,
      f.unit,
      f.read_only,
    ]),
    [
      ['status', 'text', 'text', undefined, true],
      ['connector-status', 'charging-station', 'connector-status', undefined, true],
      ['charging-state', 'charging-station', 'charging-state', undefined, true],
      ['power', 'energy-sensor', 'power', 'watt', true],
      ['current', 'energy-sensor', 'current', 'ampere', true],
      ['voltage-in', 'energy-sensor', 'voltage', 'volt', true],
      ['voltage-out', 'energy-sensor', 'voltage', 'volt', true],
      [
        'session-energy',
        'electrical-vehicle-charge',
        'last-charge-energy-added',
        'kilowatt-hour',
        true,
      ],
      ['max-current', 'electrical-vehicle-charge', 'target-current', 'ampere', true],
      ['charging-enabled', 'unknown', 'binary', undefined, true],
      ['auto-charge', 'unknown', 'binary', undefined, true],
      ['sharing-mode', 'unknown', 'binary', undefined, true],
      ['sharing-conflict', 'unknown', 'binary', undefined, true],
      ['start-charge', 'button', 'push', undefined, false],
      ['stop-charge', 'button', 'push', undefined, false],
      ['set-max-current', 'text', 'select', undefined, false],
    ],
  );
  const select = device.features.at(-1);
  assert.equal(select.supported_options[0].value, '8');
  assert.equal(select.supported_options.at(-1).value, '48');
  assert.equal(select.supported_options.length, 41);

  assert.equal(last(gladys, 'status'), 'En charge');
  assert.equal(last(gladys, 'connector-status'), CONNECTOR_STATUS.OCCUPIED);
  assert.equal(last(gladys, 'charging-state'), CHARGING_STATE.CHARGING);
  assert.equal(last(gladys, 'power'), 7140);
  assert.equal(last(gladys, 'current'), 30);
  assert.equal(last(gladys, 'voltage-in'), 240);
  assert.equal(last(gladys, 'voltage-out'), 238);
  assert.equal(last(gladys, 'session-energy'), 12.5);
  assert.equal(last(gladys, 'max-current'), 32);
  assert.equal(last(gladys, 'set-max-current'), '32');
  assert.equal(last(gladys, 'charging-enabled'), 1);
  assert.equal(last(gladys, 'auto-charge'), 0);
  assert.equal(last(gladys, 'sharing-mode'), 0);
  assert.equal(last(gladys, 'sharing-conflict'), 0);
  assert.equal(gladys.fake.connectionStatus.connected, true);
  assert.match(message(gladys).fr, /Garage : En charge, 7140 W, maximum 32 A/);
  assert.deepEqual(gladys.fake.transports.at(-1), {
    device_external_id: DEVICE,
    transport: DEVICE_TRANSPORTS.LOCAL,
  });
});

test('the session energy is a plain sensor: never an index, never a consumption', async (t) => {
  const { gladys, advance } = await setup(t);
  await advance(2 * MINUTE, 10 * SECOND);
  for (const f of deviceOf(gladys).features) {
    assert.ok(
      !(f.category === 'energy-sensor' && ['energy', 'index'].includes(f.type)),
      `${f.external_id} is an energy index`,
    );
    assert.notEqual(f.type, 'daily-consumption');
  }
  assert.deepEqual(gladys.fake.publishedEnergyConsumption, []);
});

test('statuses: plugged in and waiting, unplugged, faults, schedule', async (t) => {
  const { gladys, advance, station } = await setup(t);
  station.info = info({ status: 66, current: 0, isSessionActive: false });
  await advance(30 * SECOND);
  assert.equal(last(gladys, 'status'), 'Branchée, en attente');
  assert.equal(last(gladys, 'connector-status'), CONNECTOR_STATUS.OCCUPIED);
  assert.equal(last(gladys, 'charging-state'), CHARGING_STATE.PAUSED_BY_CHARGER);
  assert.equal(last(gladys, 'power'), 0);
  station.info = info({ status: 65, current: 0 });
  await advance(30 * SECOND);
  assert.equal(last(gladys, 'status'), 'Débranchée');
  assert.equal(last(gladys, 'connector-status'), CONNECTOR_STATUS.AVAILABLE);
  assert.equal(last(gladys, 'charging-state'), CHARGING_STATE.IDLE);
  station.info = info({ status: 72, current: 0 });
  await advance(30 * SECOND);
  assert.equal(last(gladys, 'status'), 'Défaut de terre');
  assert.equal(last(gladys, 'connector-status'), CONNECTOR_STATUS.FAULTED);
  station.info = info({ status: 84, current: 0 });
  await advance(30 * SECOND);
  assert.equal(last(gladys, 'status'), 'Période de tarif élevé');
  assert.equal(last(gladys, 'connector-status'), CONNECTOR_STATUS.UNAVAILABLE);
  station.info = info({ status: 90 });
  await advance(30 * SECOND);
  assert.equal(last(gladys, 'status'), 'État inconnu');
});

test('a station that stops answering: offline states, badge, spaced new tries', async (t) => {
  const { gladys, server, advance, station } = await setup(t);
  station.down = true;
  await advance(30 * SECOND);
  assert.equal(last(gladys, 'status'), 'Borne injoignable');
  assert.equal(last(gladys, 'connector-status'), CONNECTOR_STATUS.UNAVAILABLE);
  assert.equal(last(gladys, 'power'), 7140, 'the last power is kept');
  assert.equal(gladys.fake.transports.at(-1).transport, DEVICE_TRANSPORTS.UNREACHABLE);
  assert.equal(gladys.fake.connectionStatus.connected, false);
  assert.match(message(gladys).en, /No answer from 192\.168\.1\.50/);
  // Never read again sooner than the interval: 30 s, 1 min, 2 min, 5 min.
  const before = server.reads().length;
  await advance(29 * SECOND);
  assert.equal(server.reads().length, before);
  await advance(SECOND);
  assert.equal(server.reads().length, before + 1);
  await advance(59 * SECOND);
  assert.equal(server.reads().length, before + 1);
  await advance(SECOND);
  assert.equal(server.reads().length, before + 2);
  station.down = false;
  await advance(2 * MINUTE);
  assert.equal(last(gladys, 'status'), 'En charge');
  assert.equal(gladys.fake.transports.at(-1).transport, DEVICE_TRANSPORTS.LOCAL);
  assert.equal(gladys.fake.connectionStatus.connected, true);
});

test('commands are refused while the option is off (the default): nothing is sent', async (t) => {
  const { server, press } = await setup(t);
  for (const [role, value] of [
    ['start-charge', 1],
    ['stop-charge', 1],
    ['set-max-current', '16'],
  ]) {
    const ack = await press(role, value);
    assert.equal(ack.success, false, role);
    assert.match(ack.error, /Autoriser les commandes/);
  }
  assert.deepEqual(sent(server), []);
});

test('read-only features and foreign ids refuse every value', async (t) => {
  const { gladys, server, app } = await setup(t, { config: ALLOWED });
  for (const role of ['status', 'charging-enabled', 'max-current', 'power']) {
    const device = gladys.fake.devices[0];
    const ack = await gladys.fake.setValue(
      device,
      device.features.find((f) => f.external_id === feature(role)),
      1,
    );
    assert.equal(ack.success, false, role);
  }
  for (const id of [`${DEVICE}:__proto__`, `${DEVICE}:constructor`, 'ext:x:technove:zz:start']) {
    await assert.rejects(app.setValue({}, { external_id: id }, 1), /lecture seule/);
  }
  assert.equal({}.polluted, undefined);
  assert.deepEqual(sent(server), []);
});

test('stop: decided on a fresh read, then GET /station/control/stop', async (t) => {
  const { gladys, server, press } = await setup(t, { config: ALLOWED });
  const reads = server.reads().length;
  const ack = await press('stop-charge');
  assert.equal(ack.success, true, ack.error);
  // The fresh read, then the first follow-up 5 s later.
  assert.equal(server.reads().length, reads + 2);
  const order = server.requests.slice(reads).map((r) => r.path);
  assert.deepEqual(order.slice(0, 2), ['/station/get/info', '/station/control/stop']);
  assert.deepEqual(sent(server), ['GET /station/control/stop']);
  assert.equal(last(gladys, 'charging-enabled'), 0);
});

test('start: already allowed on the fresh read -> nothing sent; otherwise sent', async (t) => {
  const { server, press, station } = await setup(t, { config: ALLOWED });
  let ack = await press('start-charge');
  assert.equal(ack.success, true);
  assert.deepEqual(sent(server), [], 'already charging: nothing sent');
  // The memory says "active", the station says otherwise: the fresh read decides.
  station.info.isSessionActive = false;
  station.info.status = 66;
  ack = await press('start-charge', '1');
  assert.equal(ack.success, true, ack.error);
  assert.deepEqual(sent(server), ['GET /station/control/start']);
});

test('start is refused on a fault, an unknown state, automatic charging or a missing value', async (t) => {
  const { server, press, station } = await setup(t, { config: ALLOWED });
  const cases = [
    [{ status: 72, isSessionActive: false }, /Défaut de terre/],
    [{ status: 70, isSessionActive: false }, /Défaut de la borne/],
    [{ status: 99, isSessionActive: false }, /inconnu/],
    [{ auto_charge: true, isSessionActive: false, status: 66 }, /charge automatique/],
    [{ isSessionActive: 'yes', status: 66 }, /n'a pas donné/],
    [{ auto_charge: undefined, isSessionActive: false, status: 66 }, /n'a pas donné/],
  ];
  for (const [over, pattern] of cases) {
    station.info = info(over);
    const ack = await press('start-charge');
    assert.equal(ack.success, false, JSON.stringify(over));
    assert.match(ack.error, pattern);
  }
  assert.deepEqual(sent(server), []);
});

test('button values are strict', async (t) => {
  const { server, press } = await setup(t, { config: ALLOWED });
  for (const value of [0, 2, '', ' ', null, true, '1.0', 'on']) {
    const ack = await press('stop-charge', value);
    assert.equal(ack.success, false, JSON.stringify(value));
  }
  assert.deepEqual(sent(server), []);
});

test('maximum current: strict value, bounds of the station read just before', async (t) => {
  const { gladys, server, press, station } = await setup(t, { config: ALLOWED });
  for (const value of ['', ' ', null, true, '12.5', 12.5, 'abc', '-8', '1e1', [16]]) {
    const ack = await press('set-max-current', value);
    assert.equal(ack.success, false, JSON.stringify(value));
    assert.match(ack.error, /nombre entier/);
  }
  for (const value of [0, 7, '7', 81, 100]) {
    const ack = await press('set-max-current', value);
    assert.equal(ack.success, false, JSON.stringify(value));
    assert.match(ack.error, /entre 8 et 80 A/);
  }
  // Within 8..80 but above this station's rating (48 A, read again just before).
  let ack = await press('set-max-current', '50');
  assert.equal(ack.success, false);
  assert.match(ack.error, /entre 8 et 48 A/);
  station.info.maxStationCurrent = 40;
  ack = await press('set-max-current', 42);
  assert.match(ack.error, /entre 8 et 40 A/);
  station.info.maxStationCurrent = 'big';
  ack = await press('set-max-current', 16);
  assert.match(ack.error, /courant nominal/);
  station.info.maxStationCurrent = 48;
  assert.deepEqual(sent(server), []);

  ack = await press('set-max-current', '32');
  assert.equal(ack.success, true);
  assert.deepEqual(sent(server), [], 'already 32 A: nothing sent');

  ack = await press('set-max-current', ' 16 ');
  assert.equal(ack.success, true, ack.error);
  const [request] = server.commands();
  assert.equal(request.method, 'POST');
  assert.equal(request.path, '/station/control/partage');
  assert.deepEqual(JSON.parse(request.body), { ' stationNumber': 1, current: 16 });
  assert.equal(last(gladys, 'max-current'), 16);
  assert.equal(last(gladys, 'set-max-current'), '16');
});

test('maximum current is refused in load sharing mode', async (t) => {
  const { gladys, server, press, station } = await setup(t, { config: ALLOWED });
  station.info.inSharingMode = true;
  station.info.conflictInSharingConfig = true;
  const ack = await press('set-max-current', 16);
  assert.equal(ack.success, false);
  assert.match(ack.error, /partage de charge/);
  assert.deepEqual(sent(server), []);
  assert.equal(last(gladys, 'sharing-mode'), 1);
  assert.equal(last(gladys, 'sharing-conflict'), 1);
});

test('the option turned off during the fresh read: refused, not sent', async (t) => {
  const { gladys, server, station } = await setup(t, { config: ALLOWED });
  station.readDelay = 800;
  const device = gladys.fake.devices[0];
  const ack = gladys.fake.setValue(
    device,
    device.features.find((f) => f.external_id === feature('stop-charge')),
    1,
  );
  await settle();
  await gladys.fake.configUpdated({ addresses: HOST, allow_commands: false });
  t.mock.timers.tick(1000);
  await settle();
  const result = await ack;
  assert.equal(result.success, false);
  assert.match(result.error, /Autoriser les commandes/);
  assert.deepEqual(sent(server), []);
});

test('a slow fresh read: refused, never sent late', async (t) => {
  const { server, press, station } = await setup(t, { config: ALLOWED });
  station.readDelay = 2_000;
  const ack = await press('stop-charge');
  assert.equal(ack.success, false);
  assert.match(ack.error, /relu juste avant \(timeout\)/);
  assert.deepEqual(sent(server), []);
});

test('a 5xx answer: "sent, without confirmation", then spaced reads', async (t) => {
  const { server, press, station, advance } = await setup(t, { config: ALLOWED });
  station.commandStatus = 500;
  const reads = server.reads().length;
  const ack = await press('stop-charge', 1, 0);
  assert.equal(ack.success, false);
  assert.match(ack.error, /envoyée, sans confirmation \(HTTP 500\)/);
  assert.deepEqual(sent(server), ['GET /station/control/stop']);
  assert.equal(server.reads().length, reads + 1);
  await advance(4 * SECOND);
  assert.equal(server.reads().length, reads + 1, 'no burst of reads');
  await advance(SECOND);
  assert.equal(server.reads().length, reads + 2, 'a read 5 s after');
  await advance(15 * SECOND);
  assert.equal(server.reads().length, reads + 3, 'and 20 s after');
});

test('connected but silent: "sent, without confirmation"; unreachable: "not sent"', async (t) => {
  const { press, station } = await setup(t, { config: ALLOWED });
  station.commandDelay = 10_000;
  let ack = await press('stop-charge');
  assert.equal(ack.success, false);
  assert.match(ack.error, /envoyée, sans confirmation \(timeout\)/);
  station.commandDelay = 0;
  station.info.isSessionActive = true;
  station.info.status = 67;
  // Down between the read and the command: nothing accepted the connection.
  station.downPaths = ['/station/control/stop'];
  ack = await press('stop-charge');
  assert.equal(ack.success, false);
  assert.match(ack.error, /n'a pas pu être jointe \(unreachable\) : commande non envoyée/);
});

test('a 4xx answer: refused by the station, never "sent"', async (t) => {
  const { press, station } = await setup(t, { config: ALLOWED });
  station.commandStatus = 400;
  const ack = await press('stop-charge');
  assert.equal(ack.success, false);
  assert.match(ack.error, /a refusé la commande \(HTTP 400\)/);
});

test('the ack never waits for Gladys: states hanging, the command still answers', async (t) => {
  const { gladys, server, press } = await setup(t, { config: ALLOWED });
  gladys.publishChangedStates = () => new Promise(() => {});
  gladys.publishDiscoveredDevices = () => new Promise(() => {});
  gladys.setConnectionStatus = () => new Promise(() => {});
  gladys.publishTransports = () => new Promise(() => {});
  const ack = await press('stop-charge', 1, 0);
  assert.equal(ack.success, true, ack.error);
  assert.deepEqual(sent(server), ['GET /station/control/stop']);
});

test('a guard: a command not shown yet is never answered "already so"', async (t) => {
  const { server, press, station } = await setup(t, { config: ALLOWED });
  station.info = info({ isSessionActive: false, status: 66, current: 0 });
  station.applies = false;
  let ack = await press('start-charge', 1, 0);
  assert.equal(ack.success, true);
  // The station still shows "not allowed" (the start state): the stop is
  // sent anyway, never "already stopped".
  ack = await press('stop-charge', 1, 0);
  assert.equal(ack.success, true);
  assert.deepEqual(sent(server), ['GET /station/control/start', 'GET /station/control/stop']);
  // Still within the guard: sent again. After it (90 s), the dedup is back.
  await press('stop-charge', 1, TIMINGS.guard + SECOND);
  assert.equal(sent(server).length, 3);
  ack = await press('stop-charge', 1, 0);
  assert.equal(ack.success, true);
  assert.equal(sent(server).length, 3, 'deduped once the guard is gone');
});

/** Sends `role` at once (no clock move), for the concurrency tests. */
const send = (gladys, role, value = 1) => {
  const device = gladys.fake.devices[0];
  return gladys.fake.setValue(
    device,
    device.features.find((f) => f.external_id === feature(role)),
    value,
  );
};
const run = async (t, ms, step = 100) => {
  for (let elapsed = 0; elapsed < ms; elapsed += step) {
    t.mock.timers.tick(step);
    await settle();
  }
};

test('a busy station refuses another command at once', async (t) => {
  const { gladys, server, station } = await setup(t, { config: ALLOWED });
  station.info = info({ isSessionActive: false, status: 66, current: 0 });
  station.commandDelay = 300;
  const first = send(gladys, 'start-charge');
  await settle();
  const second = await send(gladys, 'set-max-current', 20);
  assert.equal(second.success, false);
  assert.match(second.error, /encore en cours/);
  await run(t, 2000);
  assert.equal((await first).success, true);
  assert.deepEqual(sent(server), ['GET /station/control/start']);
});

test('a stop waits for a quick command in flight, then goes once', async (t) => {
  const { gladys, server, station } = await setup(t, { config: ALLOWED });
  station.info = info({ isSessionActive: false, status: 66, current: 0 });
  station.pathDelays = { '/station/control/start': 300 };
  const start = send(gladys, 'start-charge');
  await run(t, 100);
  const stop = send(gladys, 'stop-charge');
  await run(t, 3000);
  assert.equal((await start).success, true);
  const ack = await stop;
  assert.equal(ack.success, true, ack.error);
  assert.deepEqual(sent(server), ['GET /station/control/start', 'GET /station/control/stop']);
});

test('a stop is never blocked by a slow start: it goes, and again after it', async (t) => {
  const { gladys, server, station } = await setup(t, { config: ALLOWED });
  station.info = info({ isSessionActive: false, status: 66, current: 0 });
  // The start answers after 4 s; the station applies it only then.
  station.pathDelays = { '/station/control/start': 4000 };
  const start = send(gladys, 'start-charge');
  await run(t, 500);
  const stop = send(gladys, 'stop-charge');
  await run(t, 3500);
  const ack = await stop;
  assert.equal(ack.success, true, ack.error);
  assert.deepEqual(sent(server), ['GET /station/control/start', 'GET /station/control/stop']);
  await run(t, 1000);
  assert.equal((await start).success, true);
  await run(t, 500);
  assert.deepEqual(sent(server), [
    'GET /station/control/start',
    'GET /station/control/stop',
    'GET /station/control/stop',
  ]);
});

test('a stop to send again holds the station; a newer command cancels it', async (t) => {
  const { gladys, server, station } = await setup(t, { config: ALLOWED });
  station.info = info({ isSessionActive: false, status: 66, current: 0 });
  station.pathDelays = { '/station/control/start': 4100 };
  const start = send(gladys, 'start-charge');
  await run(t, 500);
  const stop = send(gladys, 'stop-charge');
  await run(t, 3000);
  assert.equal((await stop).success, true);
  // The stop still waits to be sent again: a newer start is refused...
  const newer = await send(gladys, 'start-charge');
  assert.equal(newer.success, false);
  assert.match(newer.error, /encore en cours/);
  await run(t, 3000);
  const started = await start;
  assert.equal(started.success, true, started.error);
  // ...and, being newer, cancels the stop sent again.
  assert.deepEqual(sent(server), ['GET /station/control/start', 'GET /station/control/stop']);
  // Released once the stop is done: a start goes again.
  station.pathDelays = {};
  station.info.isSessionActive = false;
  const later = send(gladys, 'start-charge');
  await run(t, 2000);
  assert.equal((await later).success, true, (await later).error);
  assert.equal(sent(server).at(-1), 'GET /station/control/start');
});

test('a stop sent again: never during a pause, and a 429 pauses', async (t) => {
  const store = memoryStore();
  const { gladys, app, server, station } = await setup(t, { config: ALLOWED, store });
  station.info = info({ isSessionActive: false, status: 66, current: 0 });
  station.pathDelays = { '/station/control/start': 4100 };
  // The stop sent again answers 429.
  let start = send(gladys, 'start-charge');
  await run(t, 500);
  let stop = send(gladys, 'stop-charge');
  await run(t, 3000);
  assert.equal((await stop).success, true);
  station.pathStatus = { '/station/control/stop': 429 };
  station.headers = { 'retry-after': '120' };
  await run(t, 3000);
  await start;
  assert.equal(sent(server).filter((s) => s.endsWith('stop')).length, 2);
  assert.ok(app.paused, 'the 429 of the stop sent again pauses');
  assert.ok(store.data.pause.until > Date.now());
  // During a pause, nothing is sent again.
  station.pathStatus = {};
  app.pausedUntil = 0;
  station.info = info({ isSessionActive: false, status: 66, current: 0 });
  start = send(gladys, 'start-charge');
  await run(t, 500);
  stop = send(gladys, 'stop-charge');
  await run(t, 3000);
  assert.equal((await stop).success, true);
  app.pausedUntil = Date.now() + 10 * MINUTE;
  const count = server.commands().length;
  await run(t, 3000);
  await start;
  assert.equal(server.commands().length, count, 'nothing sent again during the pause');
});

test('with an orphan, a status shown as not connected never says "Connected"', async (t) => {
  const { gladys, advance } = await setup(t);
  await gladys.fake.deviceCreated({
    name: 'Old',
    external_id: 'ext:test-integration:technove:ffffffffffff',
    features: [],
  });
  await advance(30 * SECOND);
  assert.equal(gladys.fake.connectionStatus.connected, false);
  assert.doesNotMatch(message(gladys).fr, /^Connecté/);
  assert.doesNotMatch(message(gladys).en, /^Connected/);
  assert.match(message(gladys).fr, /^Garage : En charge.*Plus lue : Old \(ffffffffffff\)/);
});

test('a start whose read is under way gives way to a stop', async (t) => {
  const { gladys, server, station } = await setup(t, { config: ALLOWED });
  station.info = info({ isSessionActive: false, status: 66, current: 0 });
  station.readDelay = 800;
  const start = send(gladys, 'start-charge');
  await run(t, 200);
  const stop = send(gladys, 'stop-charge');
  await run(t, 4000);
  const refused = await start;
  assert.equal(refused.success, false);
  assert.match(refused.error, /arrêt de cette borne est arrivé/);
  assert.equal((await stop).success, true);
  assert.deepEqual(sent(server), [], 'stopped already, the start never left');
});

test('an error before the transport is "not sent"', async (t) => {
  const { app, press } = await setup(t, { config: ALLOWED });
  app.client.command = async () => {
    throw Object.assign(new Error('boom'), { notSent: true });
  };
  const ack = await press('stop-charge');
  assert.match(ack.error, /commande non envoyée/);
  app.client.command = async () => {
    throw new Error('boom');
  };
  const other = await press('stop-charge');
  assert.match(other.error, /envoyée, sans confirmation/);
});

test('a fresh read without a MAC refuses the command', async (t) => {
  const { server, press, station } = await setup(t, { config: ALLOWED });
  station.info.id = 'nope';
  const ack = await press('stop-charge');
  assert.equal(ack.success, false);
  assert.match(ack.error, /n'a pas donné/);
  assert.deepEqual(sent(server), []);
});

test('a 429 pause never reads sooner than the interval', async (t) => {
  const server = fakeStations();
  const { advance, station } = await setup(t, {
    server,
    config: { addresses: HOST, poll_interval: 600 },
  });
  station.readStatus = 429;
  station.headers = { 'retry-after': '60' };
  await advance(600 * SECOND, 10 * SECOND);
  const reads = server.reads().length;
  station.readStatus = undefined;
  await advance(599 * SECOND, 10 * SECOND);
  assert.equal(server.reads().length, reads, 'no read before 600 s');
  await advance(2 * SECOND);
  assert.equal(server.reads().length, reads + 1);
});

test('a created device no station gives any more: unreachable, and said so', async (t) => {
  const { gladys } = await setup(t);
  assert.equal(last(gladys, 'status'), 'En charge');
  // The address is removed from the configuration.
  await gladys.fake.configUpdated({ addresses: '' });
  await settle();
  assert.equal(last(gladys, 'status'), 'Borne injoignable');
  assert.equal(last(gladys, 'connector-status'), CONNECTOR_STATUS.UNAVAILABLE);
  assert.equal(gladys.fake.transports.at(-1).transport, DEVICE_TRANSPORTS.UNREACHABLE);
  assert.equal(gladys.fake.connectionStatus.connected, false);
  assert.match(message(gladys).fr, /Plus lue : Garage \(a1b2c3d4e5f6\)/);
});

test('a station never answering since the start: its created device is unreachable', async (t) => {
  const server = fakeStations({ [HOST]: { info: info(), down: true } });
  const gladys = createFakeGladys({ config: CONFIG, devices: [] });
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: NOW });
  // The device was created before (another run): Gladys serves it.
  gladys.fake.devices = [
    {
      name: 'Garage',
      external_id: DEVICE,
      features: [{ external_id: feature('status') }, { external_id: feature('connector-status') }],
    },
  ];
  const app = new TechnoveApp({
    gladys,
    logger: recorder([]),
    transport: server.transport,
    now: () => Date.now(),
    store: memoryStore(),
  });
  registerHandlers(gladys, app);
  t.after(() => app.stop());
  await gladys.connect();
  await settle();
  t.mock.timers.tick(SECOND);
  await settle();
  assert.equal(last(gladys, 'status'), 'Borne injoignable');
  assert.equal(last(gladys, 'connector-status'), CONNECTOR_STATUS.UNAVAILABLE);
  assert.equal(gladys.fake.transports.at(-1).transport, DEVICE_TRANSPORTS.UNREACHABLE);
  assert.match(message(gladys).en, /Not read any more: Garage/);
});

test('one MAC on two addresses: the address online wins', async (t) => {
  const server = fakeStations({
    [HOST]: { info: info({ name: 'First' }) },
    '192.168.1.51': { info: info({ name: 'Second' }) },
  });
  const { gladys, advance } = await setup(t, {
    server,
    config: { addresses: `${HOST}, 192.168.1.51` },
  });
  assert.equal(deviceOf(gladys).name, 'First');
  server.stations[HOST].down = true;
  await advance(30 * SECOND);
  assert.equal(gladys.fake.discoveredDevices.length, 1);
  assert.equal(deviceOf(gladys).name, 'Second');
  assert.equal(last(gladys, 'status'), 'En charge');
  assert.equal(gladys.fake.transports.at(-1).transport, DEVICE_TRANSPORTS.LOCAL);
});

test('values outside the bounds of their feature are dropped', async (t) => {
  const server = fakeStations({
    [HOST]: {
      info: info({ current: 500, voltageIn: 9999, energySession: -1, maxCurrent: 120 }),
    },
  });
  const { gladys } = await setup(t, { server });
  for (const role of ['current', 'voltage-in', 'session-energy', 'max-current', 'power']) {
    assert.equal(last(gladys, role), undefined, role);
  }
  assert.equal(last(gladys, 'voltage-out'), 238);
});

test('an unknown rating offers 8 to 32 A only, and refuses the command', async (t) => {
  const server = fakeStations({ [HOST]: { info: info({ maxStationCurrent: undefined }) } });
  const { gladys, press } = await setup(t, { server, config: ALLOWED });
  const select = deviceOf(gladys).features.find(
    (f) => f.external_id === feature('set-max-current'),
  );
  assert.equal(select.supported_options.at(-1).value, '32');
  const ack = await press('set-max-current', 16);
  assert.match(ack.error, /courant nominal/);
});

test('a 429: every path pauses, kept across a reconnection and in /data', async (t) => {
  const store = memoryStore();
  const { gladys, app, server, press, station, advance } = await setup(t, {
    config: ALLOWED,
    store,
  });
  station.readStatus = 429;
  station.headers = { 'retry-after': '600' };
  await advance(30 * SECOND);
  assert.equal(store.data.pause.until, NOW + 30 * SECOND + 10 * MINUTE);
  assert.match(message(gladys).fr, /ralentir/);
  station.readStatus = undefined;
  const reads = server.reads().length;
  const ack = await press('stop-charge');
  assert.equal(ack.success, false);
  assert.match(ack.error, /en pause/);
  const test1 = await gladys.fake.action(ACTIONS.TEST_CONNECTION);
  assert.match(test1.data.message.en, /slow down/);
  await gladys.connect();
  await settle();
  await advance(5 * MINUTE, 10 * SECOND);
  assert.equal(server.reads().length, reads, 'nothing read during the pause');
  assert.ok(app.paused);
  await advance(6 * MINUTE, 10 * SECOND);
  assert.ok(server.reads().length > reads);
  assert.equal(gladys.fake.connectionStatus.connected, true);
});

test('a pause in /data holds after a restart, bounded to 6 h', async (t) => {
  const store = memoryStore({ pause: { until: NOW + 48 * 60 * MINUTE } });
  const server = fakeStations();
  const { app } = await setup(t, { store, server });
  assert.equal(server.requests.length, 0);
  assert.equal(app.pausedUntil, NOW + 6 * 60 * MINUTE);
});

test('a reconnection to Gladys resends status, device, states and badge', async (t) => {
  const { gladys, server } = await setup(t);
  const devices = gladys.fake.bodies('POST', '/discovered_device').length;
  const statuses = gladys.fake.connectionStatuses.length;
  const reads = server.reads().length;
  await gladys.connect();
  await settle();
  assert.equal(gladys.fake.bodies('POST', '/discovered_device').length, devices + 1);
  assert.equal(gladys.fake.connectionStatuses.length, statuses + 1);
  assert.equal(server.reads().length, reads, 'no new read, no restart');
});

test('the test button reads now, at most every 10 s', async (t) => {
  const { gladys, server, advance } = await setup(t);
  const reads = server.reads().length;
  let ack = await gladys.fake.action(ACTIONS.TEST_CONNECTION);
  assert.match(ack.data.message.fr, /Garage : En charge/);
  assert.equal(server.reads().length, reads + 1);
  ack = await gladys.fake.action(ACTIONS.TEST_CONNECTION);
  assert.match(ack.data.message.en, /less than 10 s/);
  assert.equal(server.reads().length, reads + 1);
  await advance(10 * SECOND);
  ack = await gladys.fake.action(ACTIONS.TEST_CONNECTION);
  assert.match(ack.data.message.en, /Garage: Charging/);
  assert.equal(server.reads().length, reads + 2);
});

test('two stations (load sharing): two devices; an invalid address is reported', async (t) => {
  const server = fakeStations({
    [HOST]: { info: info({ inSharingMode: true }) },
    '192.168.1.51': { info: info({ id: '11:22:33:44:55:66', name: '', inSharingMode: true }) },
  });
  const { gladys } = await setup(t, {
    server,
    config: { addresses: `${HOST}, 192.168.1.51; bad_host 300.1.1.1` },
  });
  const devices = gladys.fake.discoveredDevices;
  assert.deepEqual(
    devices.map((d) => [d.external_id, d.name]),
    [
      [DEVICE, 'Garage'],
      ['ext:test-integration:technove:112233445566', 'Borne TechnoVE 5566'],
    ],
  );
  assert.match(message(gladys).fr, /Adresse ignorée : bad_host, 300\.1\.1\.1\./);
  assert.equal(gladys.fake.connectionStatus.connected, true);
});

test('an answer without a valid MAC never becomes a device', async (t) => {
  const server = fakeStations({ [HOST]: { info: info({ id: 'unknown' }) } });
  const { gladys } = await setup(t, { server });
  assert.deepEqual(gladys.fake.discoveredDevices, []);
  assert.match(message(gladys).en, /without a valid MAC/);
});

test('hostile answers: no prototype pollution, no crash, logs carry no answer text', async (t) => {
  const logs = [];
  const body =
    '{"__proto__":{"polluted":1},"constructor":{"prototype":{"polluted":1}},"id":"a1b2c3d4e5f6","status":"__proto__","current":"30","name":"x\\u0000y"}';
  const server = fakeStations({ [HOST]: { info: {}, body } });
  const { gladys } = await setup(t, { server, logs });
  assert.equal({}.polluted, undefined);
  assert.equal(Object.prototype.polluted, undefined);
  assert.equal(last(gladys, 'status'), 'État inconnu');
  assert.equal(last(gladys, 'current'), undefined, 'a text is not a number');
  assert.equal(deviceOf(gladys).name, 'xy');
  server.stations[HOST].body = 'not json SECRET-TEXT';
  t.mock.timers.tick(30 * SECOND);
  await settle();
  assert.ok(!logs.join('\n').includes('SECRET-TEXT'));
});
