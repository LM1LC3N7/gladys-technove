// -----------------------------------------------------------------------------
// The client (pure parsing, the requests it builds) and the real HTTP
// transport against a loopback server (127.0.0.1 only: no network).
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { STATUS } from '../src/constants.js';
import {
  COMMANDS,
  TechnoveClient,
  macOf,
  parseInfo,
  retryAfterOf,
  statusOf,
} from '../src/technove/client.js';
import { ERROR_KINDS, request } from '../src/technove/http.js';
import { info } from './fixtures/fakeStation.js';

test('the status: ASCII codes as python-technove, the letter too, else unknown', () => {
  assert.equal(statusOf(65), STATUS.UNPLUGGED);
  assert.equal(statusOf(66), STATUS.PLUGGED_WAITING);
  assert.equal(statusOf(67), STATUS.PLUGGED_CHARGING);
  assert.equal(statusOf(68), STATUS.VENTILATION_REQUIRED);
  assert.equal(statusOf(69), STATUS.PILOT_FAULT);
  assert.equal(statusOf(70), STATUS.EVSE_FAULT);
  assert.equal(statusOf(72), STATUS.GROUND_FAULT);
  assert.equal(statusOf(83), STATUS.OUT_OF_ACTIVATION_PERIOD);
  assert.equal(statusOf(84), STATUS.HIGH_TARIFF_PERIOD);
  assert.equal(statusOf('C'), STATUS.PLUGGED_CHARGING);
  for (const value of [42, 71, null, undefined, ['A'], 'c', 'CC', '67', 67.5, '__proto__', {}]) {
    assert.equal(statusOf(value), STATUS.UNKNOWN, JSON.stringify(value));
  }
});

test('the MAC address', () => {
  assert.equal(macOf('A1:B2:C3:D4:E5:F6'), 'a1b2c3d4e5f6');
  assert.equal(macOf('a1-b2-c3-d4-e5-f6'), 'a1b2c3d4e5f6');
  for (const value of ['unknown', '', 'a1b2c3d4e5', 'g1b2c3d4e5f6', 12, null]) {
    assert.equal(macOf(value), undefined, String(value));
  }
});

test('parseInfo: exact types only, never a default that could decide a command', () => {
  const station = parseInfo(info());
  assert.deepEqual(station, {
    mac: 'a1b2c3d4e5f6',
    name: 'Garage',
    version: '1.10.3',
    status: STATUS.PLUGGED_CHARGING,
    current: 30,
    voltageIn: 240,
    voltageOut: 238,
    energySession: 12.5,
    maxCurrent: 32,
    maxStationCurrent: 48,
    autoCharge: false,
    sessionActive: true,
    inSharingMode: false,
    sharingConflict: false,
  });
  const empty = parseInfo({});
  assert.equal(empty.autoCharge, undefined);
  assert.equal(empty.sessionActive, undefined);
  assert.equal(empty.inSharingMode, undefined);
  assert.equal(empty.maxStationCurrent, undefined);
  assert.equal(empty.status, STATUS.UNKNOWN);
  const odd = parseInfo(
    info({ auto_charge: 'false', isSessionActive: 1, current: '30', maxStationCurrent: 48.5 }),
  );
  assert.equal(odd.autoCharge, undefined);
  assert.equal(odd.sessionActive, undefined);
  assert.equal(odd.current, undefined);
  assert.equal(odd.maxStationCurrent, undefined);
  for (const rating of [0, 7, 81, 1000, -16, NaN]) {
    assert.equal(parseInfo(info({ maxStationCurrent: rating })).maxStationCurrent, undefined);
  }
  for (const value of [null, [], 'text', 3]) {
    assert.throws(() => parseInfo(value), { kind: ERROR_KINDS.PROTOCOL });
  }
});

test('parseInfo reads own fields only', () => {
  const inherited = Object.create({ isSessionActive: true, auto_charge: false, status: 67 });
  const station = parseInfo(inherited);
  assert.equal(station.sessionActive, undefined);
  assert.equal(station.autoCharge, undefined);
  assert.equal(station.status, STATUS.UNKNOWN);
  const parsed = parseInfo(JSON.parse('{"__proto__":{"isSessionActive":true}}'));
  assert.equal(parsed.sessionActive, undefined);
  assert.equal({}.isSessionActive, undefined);
});

test('Retry-After: seconds or a date', () => {
  assert.equal(retryAfterOf('120'), 120_000);
  assert.equal(retryAfterOf(new Date(10_000).toUTCString(), 4_000), 6_000);
  assert.equal(retryAfterOf('soon'), undefined);
  assert.equal(retryAfterOf(undefined), undefined);
});

test('the commands python-technove sends, never sent late', async () => {
  const requests = [];
  let now = 1000;
  const client = new TechnoveClient({
    transport: async (r) => {
      requests.push(r);
      return { status: 200, headers: {}, body: 'ok' };
    },
    now: () => now,
  });
  const address = { host: '10.0.0.2', port: 80 };
  await client.command(address, COMMANDS.START, { startBy: 2000, timeoutMs: 500 });
  await client.command(address, COMMANDS.STOP, { startBy: 2000, timeoutMs: 500 });
  await client.command(address, COMMANDS.MAX_CURRENT, {
    current: 24,
    startBy: 2000,
    timeoutMs: 500,
  });
  assert.deepEqual(
    requests.map((r) => [r.method, r.path, r.body]),
    [
      ['GET', '/station/control/start', undefined],
      ['GET', '/station/control/stop', undefined],
      ['POST', '/station/control/partage', '{" stationNumber":1,"current":24}'],
    ],
  );
  now = 2001;
  await assert.rejects(client.command(address, COMMANDS.STOP, { startBy: 2000, timeoutMs: 500 }), {
    kind: ERROR_KINDS.LATE,
  });
  assert.equal(requests.length, 3);
  await assert.rejects(
    client.command(address, COMMANDS.MAX_CURRENT, { current: '24', startBy: 9e9, timeoutMs: 1 }),
    /Unknown command/,
  );
});

test('the real transport against a loopback server', async (t) => {
  const seen = [];
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => {
      body += c;
    });
    req.on('end', () => {
      seen.push({ method: req.method, url: req.url, body, type: req.headers['content-type'] });
      if (req.url === '/station/get/info') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(info()));
      } else if (req.url === '/big') {
        res.writeHead(200);
        res.end('x'.repeat(70 * 1024));
      } else if (req.url === '/silent') {
        // Never answers.
      } else if (req.url === '/429') {
        res.writeHead(429, { 'Retry-After': '30' });
        res.end();
      } else {
        res.writeHead(200);
        res.end('ok');
      }
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const { port } = server.address();
  const host = '127.0.0.1';
  const client = new TechnoveClient({ transport: request });
  const station = await client.read({ host, port }, { timeoutMs: 2000 });
  assert.equal(station.mac, 'a1b2c3d4e5f6');
  await client.command({ host, port }, COMMANDS.MAX_CURRENT, {
    current: 20,
    startBy: Date.now() + 1000,
    timeoutMs: 2000,
  });
  assert.deepEqual(seen.at(-1), {
    method: 'POST',
    url: '/station/control/partage',
    body: '{" stationNumber":1,"current":20}',
    type: 'application/json',
  });
  await assert.rejects(request({ host, port, path: '/big', timeoutMs: 2000 }), {
    kind: ERROR_KINDS.PROTOCOL,
  });
  await assert.rejects(request({ host, port, path: '/silent', timeoutMs: 200 }), {
    kind: ERROR_KINDS.TIMEOUT,
  });
  const limited = await request({ host, port, path: '/429', timeoutMs: 2000 });
  assert.equal(limited.status, 429);
  assert.equal(limited.headers['retry-after'], '30');
});

test('nothing listening: unreachable (nothing was sent)', async () => {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  await assert.rejects(request({ host: '127.0.0.1', port, path: '/', timeoutMs: 2000 }), {
    kind: ERROR_KINDS.UNREACHABLE,
  });
});
