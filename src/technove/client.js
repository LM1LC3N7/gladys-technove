// -----------------------------------------------------------------------------
// The TechnoVE local API: one read (GET /station/get/info) and three commands,
// ported from python-technove (MIT). Reads are never retried here (the app
// spaces its new tries); commands are never retried at all (a command may
// have reached the station: sending it twice is the station's call, not ours).
//
// The answer comes from the network: only own fields of a plain object are
// read, each with its exact type (a missing or mistyped value is undefined,
// never python-technove's default such as `false` or `0`, so that a command
// is refused rather than decided on a guess).
// -----------------------------------------------------------------------------

import { CURRENT, LIMITS, PATHS, STATUS, STATUS_CODES } from '../constants.js';
import { ERROR_KINDS, StationError, request as httpRequest } from './http.js';

const own = (object, key) => (Object.hasOwn(object, key) ? object[key] : undefined);
const number = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : undefined);
const bool = (value) => (typeof value === 'boolean' ? value : undefined);

/** A short text from the station, without control characters. */
function text(value) {
  if (typeof value !== 'string') {
    return undefined;
  }
  // eslint-disable-next-line no-control-regex
  const clean = value.replace(/[\u0000-\u001f\u007f]/g, '').trim();
  return clean === '' ? undefined : clean.slice(0, LIMITS.textLength);
}

/** The MAC address (`id`) as 12 lower-case hex digits, else undefined. */
export function macOf(value) {
  if (typeof value !== 'string') {
    return undefined;
  }
  const mac = value.replace(/[:.-]/g, '').toLowerCase();
  return /^[0-9a-f]{12}$/.test(mac) ? mac : undefined;
}

/** The status: an ASCII code (67) as python-technove reads it, or its letter ("C"). */
export function statusOf(value) {
  let code = value;
  if (typeof value === 'string' && /^[A-Z]$/.test(value)) {
    code = value.charCodeAt(0);
  }
  if (Number.isInteger(code) && Object.hasOwn(STATUS_CODES, code)) {
    return STATUS_CODES[code];
  }
  return STATUS.UNKNOWN;
}

/**
 * The answer of /station/get/info -> the station as the rest of the code
 * reads it (pure). Throws a protocol error when it is not a JSON object.
 */
export function parseInfo(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new StationError(ERROR_KINDS.PROTOCOL, 'Not a JSON object');
  }
  const maxStationCurrent = number(own(data, 'maxStationCurrent'));
  return {
    mac: macOf(own(data, 'id')),
    name: text(own(data, 'name')),
    version: text(own(data, 'version')),
    status: statusOf(own(data, 'status')),
    current: number(own(data, 'current')),
    voltageIn: number(own(data, 'voltageIn')),
    voltageOut: number(own(data, 'voltageOut')),
    energySession: number(own(data, 'energySession')),
    maxCurrent: number(own(data, 'maxCurrent')),
    // The rating bounds the commands: trusted only as an integer of 8 to 80 A.
    maxStationCurrent:
      Number.isInteger(maxStationCurrent) &&
      maxStationCurrent >= CURRENT.min &&
      maxStationCurrent <= CURRENT.ratingMax
        ? maxStationCurrent
        : undefined,
    autoCharge: bool(own(data, 'auto_charge')),
    sessionActive: bool(own(data, 'isSessionActive')),
    inSharingMode: bool(own(data, 'inSharingMode')),
    sharingConflict: bool(own(data, 'conflictInSharingConfig')),
  };
}

/** Retry-After (seconds or an HTTP date) in ms, else undefined. */
export function retryAfterOf(header, now = Date.now()) {
  const value = Array.isArray(header) ? header[0] : header;
  if (typeof value !== 'string' || value.trim() === '') {
    return undefined;
  }
  if (/^\s*\d+\s*$/.test(value)) {
    return Number(value) * 1000;
  }
  const at = Date.parse(value);
  return Number.isNaN(at) ? undefined : Math.max(0, at - now);
}

/** The error of a non-2xx answer. */
function statusError(response, now) {
  if (response.status === 429) {
    return new StationError(ERROR_KINDS.RATE_LIMITED, 'HTTP 429', {
      status: 429,
      retryAfter: retryAfterOf(response.headers?.['retry-after'], now),
    });
  }
  return new StationError(ERROR_KINDS.HTTP, `HTTP ${response.status}`, {
    status: response.status,
  });
}

/** The reason of an error for a log or a message: its kind and status, never the answer. */
export function errorReason(err) {
  if (err?.kind === ERROR_KINDS.HTTP || err?.kind === ERROR_KINDS.RATE_LIMITED) {
    return `HTTP ${err.status}`;
  }
  return err?.kind ?? 'error';
}

export const COMMANDS = {
  START: 'start',
  STOP: 'stop',
  MAX_CURRENT: 'max_current',
};

export class TechnoveClient {
  constructor({ transport = httpRequest, now = Date.now } = {}) {
    this.transport = transport;
    this.now = now;
  }

  /** GET /station/get/info -> parseInfo(). */
  async read({ host, port }, { timeoutMs }) {
    const response = await this.transport({
      host,
      port,
      method: 'GET',
      path: PATHS.info,
      timeoutMs,
    });
    if (response.status < 200 || response.status > 299) {
      throw statusError(response, this.now());
    }
    let data;
    try {
      data = JSON.parse(response.body);
    } catch {
      throw new StationError(ERROR_KINDS.PROTOCOL, 'Not JSON');
    }
    return parseInfo(data);
  }

  /**
   * One command, never retried. `startBy`: refused unsent (LATE) after it.
   * `current`: the maximum current, already checked by the caller.
   */
  async command({ host, port }, command, { current, startBy, timeoutMs }) {
    let request;
    if (command === COMMANDS.START) {
      request = { method: 'GET', path: PATHS.start };
    } else if (command === COMMANDS.STOP) {
      request = { method: 'GET', path: PATHS.stop };
    } else if (command === COMMANDS.MAX_CURRENT && Number.isInteger(current)) {
      // The body of python-technove, its leading space in " stationNumber" included.
      request = {
        method: 'POST',
        path: PATHS.maxCurrent,
        body: JSON.stringify({ ' stationNumber': 1, current }),
      };
    } else {
      throw Object.assign(new Error(`Unknown command ${command}`), { notSent: true });
    }
    if (this.now() > startBy) {
      throw new StationError(ERROR_KINDS.LATE, 'Too late to send');
    }
    const response = await this.transport({ host, port, ...request, timeoutMs });
    if (response.status < 200 || response.status > 299) {
      throw statusError(response, this.now());
    }
  }
}
