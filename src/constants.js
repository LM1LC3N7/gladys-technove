// -----------------------------------------------------------------------------
// TechnoVE local API constants, manifest keys, limits and timings.
//
// The local API of a TechnoVE station is plain HTTP on port 80, without
// authentication, as python-technove (MIT, Moustachauve/pytechnove 2.1.3)
// reads it: GET /station/get/info for everything, GET /station/control/start
// and /station/control/stop, POST /station/control/partage for the maximum
// current. Undocumented by TechnoVE.
// -----------------------------------------------------------------------------

export const DEFAULT_PORT = 80;

export const PATHS = {
  info: '/station/get/info',
  start: '/station/control/start',
  stop: '/station/control/stop',
  maxCurrent: '/station/control/partage',
};

/**
 * The maximum current: never below 8 A (python-technove's MIN_CURRENT: the
 * station ignores a lower value), never above what the station itself
 * reports (`maxStationCurrent`), and that rating is only trusted up to 80 A
 * (the SAE J1772 level 2 ceiling).
 */
export const CURRENT = {
  min: 8,
  ratingMax: 80,
};

/**
 * The `status` of the API: the ASCII code of a letter (SAE J1772 states A to
 * F, TechnoVE's own H, S and T), as python-technove's Status enum.
 */
export const STATUS_CODES = {
  65: 'unplugged', // A
  66: 'plugged_waiting', // B
  67: 'plugged_charging', // C
  68: 'ventilation_required', // D
  69: 'pilot_fault', // E
  70: 'evse_fault', // F
  72: 'ground_fault', // H
  83: 'out_of_activation_period', // S
  84: 'high_tariff_period', // T
};

/** Our statuses: python-technove's, plus `unknown` and `offline` (no answer). */
export const STATUS = {
  UNPLUGGED: 'unplugged',
  PLUGGED_WAITING: 'plugged_waiting',
  PLUGGED_CHARGING: 'plugged_charging',
  VENTILATION_REQUIRED: 'ventilation_required',
  PILOT_FAULT: 'pilot_fault',
  EVSE_FAULT: 'evse_fault',
  GROUND_FAULT: 'ground_fault',
  OUT_OF_ACTIVATION_PERIOD: 'out_of_activation_period',
  HIGH_TARIFF_PERIOD: 'high_tariff_period',
  UNKNOWN: 'unknown',
  OFFLINE: 'offline',
};

/** The statuses that refuse a start: a fault, or a state we cannot read. */
export const FAULTS = new Set([STATUS.PILOT_FAULT, STATUS.EVSE_FAULT, STATUS.GROUND_FAULT]);

/** Feature roles (the last part of the feature external ids): frozen. */
export const FEATURES = {
  STATUS: 'status',
  CONNECTOR: 'connector-status',
  CHARGING_STATE: 'charging-state',
  POWER: 'power',
  CURRENT: 'current',
  VOLTAGE_IN: 'voltage-in',
  VOLTAGE_OUT: 'voltage-out',
  SESSION_ENERGY: 'session-energy',
  MAX_CURRENT: 'max-current',
  CHARGING_ENABLED: 'charging-enabled',
  AUTO_CHARGE: 'auto-charge',
  SHARING_MODE: 'sharing-mode',
  SHARING_CONFLICT: 'sharing-conflict',
  START: 'start-charge',
  STOP: 'stop-charge',
  SET_MAX_CURRENT: 'set-max-current',
};

export const ACTIONS = {
  TEST_CONNECTION: 'test_connection',
};

/** The value a `button/push` feature sends (BUTTON_PUSH.PRESSED of the core). */
export const PRESSED = 1;

/** The poll interval of the configuration, in seconds. */
export const POLL_INTERVAL = {
  min: 10,
  max: 600,
  default: 30,
};

export const LIMITS = {
  /** Gladys: 300 states per minute. */
  statesPerMinute: 300,
  statesPerRequest: 100,
  /** Stations of one integration (the sharing mode links two to four). */
  addresses: 4,
  /** The info answer is about one kilobyte. */
  responseBytes: 64 * 1024,
  /** Longest text kept from an answer (name, version). */
  textLength: 60,
};

export const SECOND = 1_000;
export const MINUTE = 60 * SECOND;
export const HOUR = 60 * MINUTE;

export const TIMINGS = {
  /** A read of the polling (python-technove waits 8 s; a LAN station answers in well under 1 s). */
  readTimeout: 5 * SECOND,
  /** Failed reads: 30 s, 1, 2, then 5 minutes, never shorter than the interval. */
  backoff: [30 * SECOND, MINUTE, 2 * MINUTE, 5 * MINUTE],
  /** 429 (unexpected from a station, handled anyway): Retry-After bounded to 1 min .. 6 h, 5 min without. */
  rateLimitMin: MINUTE,
  rateLimitMax: 6 * HOUR,
  rateLimitDefault: 5 * MINUTE,
  /** The publisher sends what is pending every second; unchanged states again every 30 min. */
  flushInterval: SECOND,
  stateHeartbeat: 30 * MINUTE,
  /** The "Test the connection" button reads the stations at most this often. */
  testCooldown: 10 * SECOND,
  /**
   * Commands (Gladys waits 5 s for the ack): the fresh read and the command
   * must leave by 3.5 s after the click, or the command is refused unsent;
   * the answer is awaited until 4.3 s, after which the command is "sent,
   * without confirmation".
   */
  commandSendBy: 3_500,
  commandAnswerBy: 4_300,
  /** The fresh read of a command: 1.5 s at most, and 0.3 s left to send after it. */
  commandReadMax: 1_500,
  commandMinRead: 300,
  commandMinSend: 300,
  /** Reads after a command, spaced: its effect, then a check. */
  followUps: [5 * SECOND, 20 * SECOND],
  /** A sent command keeps its guard until the state moves to what it asked, or 90 s. */
  guard: 90 * SECOND,
};
