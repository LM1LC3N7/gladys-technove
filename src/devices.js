// -----------------------------------------------------------------------------
// A station -> one Gladys device and its states (pure).
//
// `ext:<selector>:technove:<mac>`: one device per station, keyed by its MAC
// address (the `id` of the API, 12 lower-case hex digits), never by its IP
// address (it may change) nor its name. The feature roles (the last part of
// their external ids) are published forever: never rename them. Every role
// is always built, so a republished device never loses a feature.
//
// No switch, no writable binary: a "turn everything off" (Google Home, Alexa,
// HomeKit, MCP, `switch.*` scenes) must never reach a charge command. The
// session state is read only (`unknown/binary`); starting and stopping are
// two `button/push` features, the maximum current a `text/select` of the
// whole amperes the station accepts. All three refuse unless the
// configuration allows the commands (src/app.js).
//
// Categories and units are those the core lists
// (DEVICE_FEATURE_UNITS_BY_CATEGORY): W, A and V on `energy-sensor`
// (instantaneous readings, never an index); kWh and A on
// `electrical-vehicle-charge`. The energy of the session is a plain sensor
// (`last-charge-energy-added`): never an `index`/`energy` feature, so the
// energy tab never counts it (the station is already behind the main meter).
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES as C,
  DEVICE_FEATURE_TYPES as T,
  DEVICE_FEATURE_UNITS as U,
} from '@gladysassistant/integration-sdk';
import { CURRENT, FEATURES, STATUS } from './constants.js';
import { DEVICE_NAME, FEATURE_NAMES, STATUS_NAMES, word } from './i18n.js';

/** CHARGING_STATION_CONNECTOR_STATUS of the core (server/utils/constants.js). */
export const CONNECTOR_STATUS = {
  AVAILABLE: 0,
  OCCUPIED: 1,
  RESERVED: 2,
  UNAVAILABLE: 3,
  FAULTED: 4,
};

/** CHARGING_STATION_CHARGING_STATE of the core (OCPP 2.0.1 chargingState). */
export const CHARGING_STATE = {
  CHARGING: 0,
  EV_CONNECTED: 1,
  PAUSED_BY_VEHICLE: 2,
  PAUSED_BY_CHARGER: 3,
  IDLE: 4,
  DISCHARGING: 5,
};

const sensor = (definition) => ({
  read_only: true,
  has_feedback: false,
  keep_history: true,
  ...definition,
});
const binary = sensor({ category: C.UNKNOWN, type: T.SENSOR.BINARY, min: 0, max: 1 });
const button = {
  category: C.BUTTON,
  type: T.BUTTON.PUSH,
  min: 0,
  max: 1,
  read_only: false,
  has_feedback: false,
  keep_history: false,
};

/** The features, by role, in display order (set-max-current gets its options in buildDevice). */
export const DEFINITIONS = {
  [FEATURES.STATUS]: sensor({ category: C.TEXT, type: T.TEXT.TEXT, min: 0, max: 0 }),
  [FEATURES.CONNECTOR]: sensor({
    category: C.CHARGING_STATION,
    type: T.CHARGING_STATION.CONNECTOR_STATUS,
    min: 0,
    max: 4,
  }),
  [FEATURES.CHARGING_STATE]: sensor({
    category: C.CHARGING_STATION,
    type: T.CHARGING_STATION.CHARGING_STATE,
    min: 0,
    max: 5,
  }),
  [FEATURES.POWER]: sensor({
    category: C.ENERGY_SENSOR,
    type: T.ENERGY_SENSOR.POWER,
    unit: U.WATT,
    min: 0,
    max: 25_000,
  }),
  [FEATURES.CURRENT]: sensor({
    category: C.ENERGY_SENSOR,
    type: T.ENERGY_SENSOR.CURRENT,
    unit: U.AMPERE,
    min: 0,
    max: 100,
  }),
  [FEATURES.VOLTAGE_IN]: sensor({
    category: C.ENERGY_SENSOR,
    type: T.ENERGY_SENSOR.VOLTAGE,
    unit: U.VOLT,
    min: 0,
    max: 500,
  }),
  [FEATURES.VOLTAGE_OUT]: sensor({
    category: C.ENERGY_SENSOR,
    type: T.ENERGY_SENSOR.VOLTAGE,
    unit: U.VOLT,
    min: 0,
    max: 500,
  }),
  [FEATURES.SESSION_ENERGY]: sensor({
    category: C.ELECTRICAL_VEHICLE_CHARGE,
    type: T.ELECTRICAL_VEHICLE_CHARGE.LAST_CHARGE_ENERGY_ADDED,
    unit: U.KILOWATT_HOUR,
    min: 0,
    max: 1000,
  }),
  [FEATURES.MAX_CURRENT]: sensor({
    category: C.ELECTRICAL_VEHICLE_CHARGE,
    type: T.ELECTRICAL_VEHICLE_CHARGE.TARGET_CURRENT,
    unit: U.AMPERE,
    min: 0,
    max: CURRENT.ratingMax,
  }),
  [FEATURES.CHARGING_ENABLED]: binary,
  [FEATURES.AUTO_CHARGE]: binary,
  [FEATURES.SHARING_MODE]: binary,
  [FEATURES.SHARING_CONFLICT]: binary,
  [FEATURES.START]: button,
  [FEATURES.STOP]: button,
  [FEATURES.SET_MAX_CURRENT]: {
    category: C.TEXT,
    type: T.TEXT.SELECT,
    min: 0,
    max: 0,
    read_only: false,
    has_feedback: true,
    keep_history: false,
  },
};

export const ROLES = Object.keys(DEFINITIONS);
export const COMMAND_ROLES = [FEATURES.START, FEATURES.STOP, FEATURES.SET_MAX_CURRENT];

export const stationIds = (gladys, mac) => gladys.externalIds('technove', mac);

/** The MAC and the role of one of our feature external ids, else undefined. */
export function parseFeatureId(externalId) {
  if (typeof externalId !== 'string') {
    return undefined;
  }
  const match = /:technove:([0-9a-f]{12}):([a-z-]+)$/.exec(externalId);
  return match && ROLES.includes(match[2]) ? { mac: match[1], role: match[2] } : undefined;
}

/**
 * The highest current the select offers: the rating of the station, else
 * 32 A (an unknown rating never offers more; the command is refused anyway
 * until the station gives its rating).
 */
export const currentCeiling = (station) => station.maxStationCurrent ?? CURRENT.unknownRatingMax;

export function currentOptions(ceiling) {
  const options = [];
  for (let amps = CURRENT.min; amps <= ceiling; amps += 1) {
    options.push({ value: String(amps), label: `${amps} A`, sort_order: amps - CURRENT.min });
  }
  return options;
}

export const deviceName = (station, language) =>
  station.name ?? `${word(DEVICE_NAME, language)} ${station.mac.slice(-4)}`;

/** The Gladys device of one station (read at least once: its MAC is known). */
export function buildDevice(gladys, station, language) {
  const ids = stationIds(gladys, station.mac);
  const params = [{ name: 'mac_address', value: station.mac }];
  if (station.version) {
    params.push({ name: 'firmware', value: station.version });
  }
  if (station.maxStationCurrent !== undefined) {
    params.push({ name: 'max_station_current', value: String(station.maxStationCurrent) });
  }
  return {
    name: deviceName(station, language),
    external_id: ids.device,
    model: 'TechnoVE',
    should_poll: false,
    features: ROLES.map((role) => ({
      name: word(FEATURE_NAMES[role], language),
      external_id: ids.feature(role),
      ...DEFINITIONS[role],
      ...(role === FEATURES.SET_MAX_CURRENT
        ? { supported_options: currentOptions(currentCeiling(station)) }
        : {}),
    })),
    params,
  };
}

/** The connector, as the core's charging-station category reads it (undefined: unknown). */
export function connectorOf(status) {
  switch (status) {
    case STATUS.OFFLINE:
      return CONNECTOR_STATUS.UNAVAILABLE;
    case STATUS.UNPLUGGED:
      return CONNECTOR_STATUS.AVAILABLE;
    case STATUS.PLUGGED_WAITING:
    case STATUS.PLUGGED_CHARGING:
    case STATUS.VENTILATION_REQUIRED:
      return CONNECTOR_STATUS.OCCUPIED;
    case STATUS.PILOT_FAULT:
    case STATUS.EVSE_FAULT:
    case STATUS.GROUND_FAULT:
      return CONNECTOR_STATUS.FAULTED;
    case STATUS.OUT_OF_ACTIVATION_PERIOD:
    case STATUS.HIGH_TARIFF_PERIOD:
      // The station holds the charge by its schedule: not available to charge now.
      return CONNECTOR_STATUS.UNAVAILABLE;
    default:
      return undefined;
  }
}

/**
 * The charging state (OCPP's chargingState). Not charging and nothing known
 * to be plugged in: IDLE, so a scene never keeps reading "charging" after
 * the car left.
 */
export function chargingStateOf(station) {
  switch (station.status) {
    case STATUS.PLUGGED_CHARGING:
    case STATUS.VENTILATION_REQUIRED:
      return CHARGING_STATE.CHARGING;
    case STATUS.PLUGGED_WAITING:
      return station.sessionActive === false
        ? CHARGING_STATE.PAUSED_BY_CHARGER
        : CHARGING_STATE.EV_CONNECTED;
    case STATUS.UNKNOWN:
      return undefined;
    default:
      return CHARGING_STATE.IDLE;
  }
}

/**
 * The power, in W: the API gives none, it is the current times the output
 * voltage (the input voltage when the output one is 0 or missing).
 */
export function powerOf(station) {
  if (station.current === undefined || station.current < 0) {
    return undefined;
  }
  const volts = station.voltageOut > 0 ? station.voltageOut : station.voltageIn;
  if (volts === undefined || volts < 0) {
    return undefined;
  }
  return Math.round(station.current * volts);
}

const round = (value, digits) => Math.round(value * 10 ** digits) / 10 ** digits;
const flag = (value) => (value === undefined ? undefined : value ? 1 : 0);

/**
 * The current values of one station's device. Offline: only the status and
 * the connector (Gladys keeps the last value of the others).
 */
export function deviceStates(ids, station, { online, language }) {
  if (!online) {
    return [
      { role: FEATURES.STATUS, text: word(STATUS_NAMES[STATUS.OFFLINE], language) },
      { role: FEATURES.CONNECTOR, state: CONNECTOR_STATUS.UNAVAILABLE },
    ].map(({ role, ...value }) => ({ device_feature_external_id: ids.feature(role), ...value }));
  }
  const states = [];
  // A value outside the bounds of its feature is dropped (Gladys keeps the last one).
  const add = (role, state) => {
    const { min, max } = DEFINITIONS[role];
    if (state !== undefined && Number.isFinite(state) && state >= min && state <= max) {
      states.push({ role, state });
    }
  };
  states.push({ role: FEATURES.STATUS, text: word(STATUS_NAMES[station.status], language) });
  add(FEATURES.CONNECTOR, connectorOf(station.status));
  add(FEATURES.CHARGING_STATE, chargingStateOf(station));
  add(FEATURES.POWER, powerOf(station));
  if (station.current !== undefined && station.current >= 0) {
    add(FEATURES.CURRENT, round(station.current, 1));
  }
  if (station.voltageIn !== undefined && station.voltageIn >= 0) {
    add(FEATURES.VOLTAGE_IN, Math.round(station.voltageIn));
  }
  if (station.voltageOut !== undefined && station.voltageOut >= 0) {
    add(FEATURES.VOLTAGE_OUT, Math.round(station.voltageOut));
  }
  if (station.energySession !== undefined && station.energySession >= 0) {
    add(FEATURES.SESSION_ENERGY, round(station.energySession, 3));
  }
  if (station.maxCurrent !== undefined && station.maxCurrent >= 0) {
    add(FEATURES.MAX_CURRENT, station.maxCurrent);
    if (
      Number.isInteger(station.maxCurrent) &&
      station.maxCurrent >= CURRENT.min &&
      station.maxCurrent <= currentCeiling(station)
    ) {
      states.push({ role: FEATURES.SET_MAX_CURRENT, text: String(station.maxCurrent) });
    }
  }
  add(FEATURES.CHARGING_ENABLED, flag(station.sessionActive));
  add(FEATURES.AUTO_CHARGE, flag(station.autoCharge));
  add(FEATURES.SHARING_MODE, flag(station.inSharingMode));
  add(FEATURES.SHARING_CONFLICT, flag(station.sharingConflict));
  return states.map(({ role, ...value }) => ({
    device_feature_external_id: ids.feature(role),
    ...value,
  }));
}
