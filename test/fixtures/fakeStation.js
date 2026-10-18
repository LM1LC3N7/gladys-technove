// -----------------------------------------------------------------------------
// Fake TechnoVE stations behind the transport the integration is given: the
// answer of /station/get/info shaped like python-technove's test fixtures
// and models (made up, never captured from a real station), and the three
// commands, which change the station like it is expected to. Records every
// request. No network. Delays use setTimeout, so the mocked clock drives
// them.
// -----------------------------------------------------------------------------

import { ERROR_KINDS, StationError } from '../../src/technove/http.js';

export const HOST = '192.168.1.50';
export const MAC = 'a1b2c3d4e5f6';
export const NOW = Date.UTC(2026, 9, 18, 18, 0, 0);

/** A charging station: 30 A at 238 V, 12.5 kWh this session, 32 A max of 48 A. */
export const info = (over = {}) => ({
  auto_charge: false,
  conflictInSharingConfig: false,
  current: 30,
  energySession: 12.5,
  energyTotal: 1234.5,
  highChargePeriodActive: false,
  id: 'A1:B2:C3:D4:E5:F6',
  inSharingMode: false,
  isBatteryProtected: false,
  isSessionActive: true,
  isStaticIp: false,
  isUpToDate: true,
  lastCharge: '',
  maxChargePourcentage: 0.9,
  maxCurrent: 32,
  maxStationCurrent: 48,
  name: 'Garage',
  network_ssid: 'home',
  normalPeriodActive: false,
  rssi: -60,
  status: 67,
  time: 1_760_000_000,
  version: '1.10.3',
  voltageIn: 240,
  voltageOut: 238,
  ...over,
});

const answer = (status, body = '', headers = {}) => ({
  status,
  headers,
  body: typeof body === 'string' ? body : JSON.stringify(body),
});

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * `stations`: host -> { info, ... }. Per station, the test may set:
 * `down` (nothing answers: 'unreachable'), `silent` (connected, no answer),
 * `readDelay` / `commandDelay` (ms), `readStatus` / `commandStatus` (HTTP),
 * `applies` (false: a command changes nothing), `body` (raw info answer).
 */
export function fakeStations(stations = { [HOST]: { info: info() } }) {
  const server = {
    stations,
    /** { host, port, method, path, body, timeoutMs } */
    requests: [],
    reads: () => server.requests.filter((r) => r.path === '/station/get/info'),
    commands: () => server.requests.filter((r) => r.path !== '/station/get/info'),
    async transport({ host, port, method, path, body, timeoutMs }) {
      server.requests.push({ host, port, method, path, body, timeoutMs });
      const station = server.stations[host];
      if (!station || station.down || station.downPaths?.includes(path)) {
        throw new StationError(ERROR_KINDS.UNREACHABLE, 'Unreachable: ECONNREFUSED');
      }
      const isRead = path === '/station/get/info';
      const delay = isRead ? station.readDelay : station.commandDelay;
      if (station.silent || (delay ?? 0) >= timeoutMs) {
        await wait(timeoutMs);
        throw new StationError(ERROR_KINDS.TIMEOUT, 'Connected but silent: timeout');
      }
      if (delay) {
        await wait(delay);
      }
      if (isRead) {
        if (station.readStatus) {
          return answer(station.readStatus, 'error', station.headers);
        }
        return answer(200, station.body ?? station.info);
      }
      if (station.commandStatus) {
        return answer(station.commandStatus, 'error', station.headers);
      }
      if (station.applies !== false) {
        if (path === '/station/control/start') {
          station.info.isSessionActive = true;
        } else if (path === '/station/control/stop') {
          station.info.isSessionActive = false;
          if (station.info.status === 67) {
            station.info.status = 66;
          }
          station.info.current = 0;
        } else if (path === '/station/control/partage') {
          station.info.maxCurrent = JSON.parse(body).current;
        }
      }
      return answer(200, 'ok');
    },
  };
  return server;
}

export const settle = async (rounds = 20) => {
  for (let i = 0; i < rounds; i += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
};
