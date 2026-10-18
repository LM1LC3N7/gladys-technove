// -----------------------------------------------------------------------------
// The integration: the stations typed in the configuration (IP addresses),
// one read of each every poll interval, the Gladys devices and their states,
// the transport badge, the "Test the connection" button, and the three
// commands (start, stop, maximum current), refused unless the configuration
// allows them. index.js only wires the SDK handlers to it.
//
// Commands follow the rules learnt on the previous modules:
//   - decided on a fresh read of the station only, never on the state kept in
//     memory, and refused when a value they need is missing;
//   - the "Allow the commands" option is checked on arrival and again right
//     before sending;
//   - sent within 3.5 s of the click or refused unsent; answered by 4.3 s;
//   - a command that may have reached the station (silence, a 5xx) is never
//     answered "not sent": "sent, without confirmation", then spaced reads;
//   - the ack never waits for a publication to Gladys;
//   - one command at a time per station; never retried.
// -----------------------------------------------------------------------------

import { DEVICE_TRANSPORTS, createLogger } from '@gladysassistant/integration-sdk';
import { addressKey, normalizeConfig } from './config.js';
import { CURRENT, FAULTS, FEATURES, PRESSED, SECOND, STATUS, TIMINGS } from './constants.js';
import {
  COMMAND_ROLES,
  buildDevice,
  deviceStates,
  parseFeatureId,
  powerOf,
  stationIds,
} from './devices.js';
import { ERRORS, STATUS_NAMES, T, age, summaryOf, word } from './i18n.js';
import { StatePublisher } from './publisher.js';
import { fileStore, normalizeMemory } from './store.js';
import { COMMANDS, TechnoveClient, errorReason } from './technove/client.js';
import { ERROR_KINDS } from './technove/http.js';

/** Command errors after which the request may have reached the station. */
const MAYBE_SENT = new Set([ERROR_KINDS.TIMEOUT, ERROR_KINDS.PROTOCOL]);

const both = (en, fr) => ({ en, fr });
const join = (a, b) => both(`${a.en} ${b.en}`, `${a.fr} ${b.fr}`);

export class TechnoveApp {
  constructor({
    gladys,
    logger = createLogger({ name: 'technove' }),
    transport,
    now = Date.now,
    timers = globalThis,
    store = fileStore(),
  }) {
    this.gladys = gladys;
    this.logger = logger;
    this.now = now;
    this.timers = timers;
    this.store = store;
    this.client = new TechnoveClient({ transport, now });
    this.publisher = new StatePublisher({ gladys, logger, now, timers });
    this.config = normalizeConfig();
    this.memory = normalizeMemory(null, now());
    /** addressKey -> station: { key, address, snapshot, online, failures, wait, timer, running, followUps }. */
    this.stations = new Map();
    this.generation = 0;
    this.started = false;
    this.pausedUntil = 0;
    this.lastStatus = undefined;
    this.published = undefined;
    this.badge = undefined;
    this.lastTestAt = -Infinity;
    /** mac -> the tail of its command chain (one command at a time per station). */
    this.chains = new Map();
    /** `${mac}:${kind}` -> { from, expected, moved, until }: a command sent, not seen yet. */
    this.guards = new Map();
  }

  // --- Lifecycle -------------------------------------------------------------

  async start(raw = {}) {
    this.stop();
    await Promise.all([...this.stations.values()].map((s) => s.running));
    this.config = normalizeConfig(raw);
    this.memory = normalizeMemory(await this.store.load().catch(() => null), this.now());
    // A 429 pause survives a restart and a new configuration.
    if (this.memory.pause) {
      this.pausedUntil = Math.max(this.pausedUntil, this.memory.pause.until);
    }
    this.stations = new Map(
      this.config.addresses.map((address) => [
        addressKey(address),
        {
          key: addressKey(address),
          address,
          snapshot: undefined,
          online: undefined,
          failures: 0,
          wait: undefined,
          timer: undefined,
          running: undefined,
          followUps: new Set(),
        },
      ]),
    );
    this.published = undefined;
    this.badge = undefined;
    this.publisher.start();
    if (this.stations.size === 0) {
      await this.updateStatus();
      return;
    }
    await this.setStatus(false, this.withInvalid(this.pauseMessage() ?? T.connecting));
    await Promise.all([...this.stations.values()].map((station) => this.tick(station)));
  }

  stop() {
    this.generation += 1;
    for (const station of this.stations.values()) {
      this.clearTimer(station);
      for (const handle of station.followUps) {
        this.timers.clearTimeout(handle);
      }
      station.followUps.clear();
    }
    this.publisher.stop();
  }

  clearTimer(station) {
    if (station.timer) {
      this.timers.clearTimeout(station.timer);
      station.timer = undefined;
    }
  }

  /**
   * Connected to Gladys. The first time, start; after a reconnection (Gladys
   * restarted), resend what Gladys keeps in memory only (status, Discovery
   * list, badge) and the last states. The 429 pause stays.
   */
  async connected(raw = {}) {
    if (!this.started) {
      this.started = true;
      await this.start(raw);
      return;
    }
    if (this.needsRestart(raw)) {
      await this.start(raw);
      return;
    }
    this.config = normalizeConfig(raw);
    this.published = undefined;
    this.badge = undefined;
    this.lastStatus = undefined;
    await this.publishAll();
  }

  needsRestart(raw) {
    const next = normalizeConfig(raw);
    return (
      next.pollInterval !== this.config.pollInterval ||
      JSON.stringify(next.addresses) !== JSON.stringify(this.config.addresses) ||
      JSON.stringify(next.invalid) !== JSON.stringify(this.config.invalid)
    );
  }

  /** New addresses or interval restart; the option and the language apply at once. */
  async configUpdated(raw = {}) {
    if (this.needsRestart(raw)) {
      await this.start(raw);
      return;
    }
    const previous = this.config;
    this.config = normalizeConfig(raw);
    if (this.config.allowCommands !== previous.allowCommands) {
      this.logger.info(`TechnoVE commands ${this.config.allowCommands ? 'allowed' : 'disabled'}`);
    }
    if (this.config.language !== previous.language) {
      await this.publishAll();
    }
  }

  async setStatus(connected, message) {
    const key = JSON.stringify([connected, message ?? null]);
    if (key === this.lastStatus) {
      return;
    }
    this.lastStatus = key;
    await this.gladys
      .setConnectionStatus(connected, message)
      .catch((err) => this.logger.warn(`setConnectionStatus failed: ${err.message}`));
  }

  async saveMemory() {
    await this.store
      .save(this.memory)
      .catch((err) => this.logger.warn(`Saving the state to /data failed: ${err.message}`));
  }

  // --- Polling ---------------------------------------------------------------

  get interval() {
    return this.config.pollInterval * SECOND;
  }

  get paused() {
    return this.now() < this.pausedUntil;
  }

  /** The next read of a station: after the pause, after its backoff, else the interval. */
  schedule(station, delay) {
    this.clearTimer(station);
    const wait = this.paused
      ? this.pausedUntil - this.now()
      : (delay ?? (station.online === false ? station.wait : this.interval));
    const generation = this.generation;
    station.timer = this.timers.setTimeout(
      () => {
        station.timer = undefined;
        if (generation === this.generation) {
          this.tick(station).catch(() => this.logger.error('TechnoVE refresh failed'));
        }
      },
      Math.max(0, wait ?? this.interval),
    );
  }

  /** One read at a time per station: a tick during a read joins it. */
  tick(station) {
    if (!station.running) {
      station.running = this.run(station).finally(() => {
        station.running = undefined;
      });
    }
    return station.running;
  }

  async run(station) {
    const generation = this.generation;
    if (this.paused) {
      this.schedule(station);
      return;
    }
    try {
      const snapshot = await this.client.read(station.address, {
        timeoutMs: TIMINGS.readTimeout,
      });
      if (generation !== this.generation) {
        return;
      }
      this.applyRead(station, snapshot);
    } catch (err) {
      if (generation !== this.generation) {
        return;
      }
      await this.failed(station, err);
    }
    await this.publishAll();
    if (generation === this.generation) {
      this.schedule(station);
    }
  }

  /** A read answered: the station as read, and the guards it may lift. */
  applyRead(station, snapshot) {
    station.snapshot = snapshot;
    station.online = true;
    station.failures = 0;
    station.wait = undefined;
    station.error = snapshot.mac ? undefined : 'no_id';
    if (snapshot.mac) {
      this.observe(snapshot);
    }
  }

  async failed(station, err) {
    const reason = errorReason(err);
    if (err.kind === ERROR_KINDS.RATE_LIMITED) {
      await this.pause(err);
      this.logger.warn(`TechnoVE ${station.key}: ${reason}, pause`);
      return;
    }
    // Never read again sooner than the interval.
    const wait = Math.max(
      this.interval,
      TIMINGS.backoff[Math.min(station.failures, TIMINGS.backoff.length - 1)],
    );
    station.failures += 1;
    station.online = false;
    station.wait = wait;
    station.error = reason;
    this.logger.warn(
      `TechnoVE ${station.key}: ${reason}; next try in ${Math.round(wait / 1000)} s`,
    );
  }

  /** A 429: every path waits (polling, button, commands), kept in /data. */
  async pause(err) {
    const wait = Math.min(
      TIMINGS.rateLimitMax,
      Math.max(TIMINGS.rateLimitMin, err.retryAfter ?? TIMINGS.rateLimitDefault),
    );
    this.pausedUntil = Math.max(this.pausedUntil, this.now() + wait);
    this.memory.pause = { until: this.pausedUntil };
    await this.saveMemory();
  }

  pauseMessage() {
    return this.paused ? T.rateLimited(age(this.pausedUntil - this.now())) : undefined;
  }

  withInvalid(message) {
    return this.config.invalid.length > 0 ? join(message, T.invalid(this.config.invalid)) : message;
  }

  summary(station) {
    const s = station.snapshot;
    return summaryOf({
      name: s.name ?? `TechnoVE ${s.mac?.slice(-4) ?? station.key}`,
      status: s.status,
      power: powerOf(s),
      maxCurrent: s.maxCurrent,
    });
  }

  /** The connection status of the configuration screen, from every station. */
  async updateStatus() {
    const stations = [...this.stations.values()];
    if (stations.length === 0) {
      await this.setStatus(
        false,
        this.config.invalid.length > 0
          ? join(T.noAddress, T.invalid(this.config.invalid))
          : T.noAddress,
      );
      return;
    }
    const pause = this.pauseMessage();
    const readOnce = stations.some((s) => s.snapshot);
    if (pause) {
      await this.setStatus(readOnce, this.withInvalid(pause));
      return;
    }
    const down = stations.filter((s) => s.online === false);
    if (down.length > 0) {
      const wait = Math.min(...down.map((s) => s.wait ?? this.interval));
      await this.setStatus(
        false,
        this.withInvalid(T.unreachable(down.map((s) => s.key).join(', '), age(wait))),
      );
      return;
    }
    if (stations.some((s) => s.online === undefined)) {
      await this.setStatus(false, this.withInvalid(T.connecting));
      return;
    }
    if (stations.some((s) => s.error === 'no_id')) {
      await this.setStatus(false, this.withInvalid(T.noId));
      return;
    }
    const summaries = stations.map((s) => this.summary(s));
    const summary = both(
      summaries.map((m) => m.en).join(' '),
      summaries.map((m) => m.fr).join(' '),
    );
    await this.setStatus(true, this.withInvalid(T.connected(summary)));
  }

  // --- Gladys ----------------------------------------------------------------

  /** The stations read with a valid MAC, one per MAC (the first address wins). */
  known() {
    const byMac = new Map();
    for (const station of this.stations.values()) {
      const mac = station.snapshot?.mac;
      if (mac && !byMac.has(mac)) {
        byMac.set(mac, station);
      }
    }
    return byMac;
  }

  stationOf(mac) {
    return this.known().get(mac);
  }

  async publishAll() {
    await this.publishDevices();
    this.queueStates();
    await this.flush();
    await this.publishBadge();
    await this.updateStatus();
  }

  async flush() {
    await this.publisher
      .flush()
      .catch((err) => this.logger.warn(`Sending to Gladys failed: ${err.message}`));
  }

  async publishDevices() {
    const devices = [...this.known().values()].map((s) =>
      buildDevice(this.gladys, s.snapshot, this.config.language),
    );
    if (devices.length === 0) {
      return;
    }
    const json = JSON.stringify(devices);
    if (json === this.published) {
      return;
    }
    try {
      await this.gladys.publishDiscoveredDevices(devices);
      this.published = json;
    } catch (err) {
      this.logger.warn(`Publishing the discovered devices failed: ${err.message}`);
    }
  }

  createdFeatures() {
    return new Set(
      (this.gladys.devices ?? []).flatMap((d) => (d.features ?? []).map((f) => f.external_id)),
    );
  }

  queueStates(created = this.createdFeatures()) {
    for (const [mac, station] of this.known()) {
      const states = deviceStates(stationIds(this.gladys, mac), station.snapshot, {
        online: station.online !== false,
        language: this.config.language,
      });
      for (const { device_feature_external_id: id, ...value } of states) {
        if (created.has(id)) {
          this.publisher.push(id, value);
        }
      }
    }
  }

  async publishBadge() {
    const created = new Set((this.gladys.devices ?? []).map((d) => d.external_id));
    const entries = [];
    for (const [mac, station] of this.known()) {
      const externalId = stationIds(this.gladys, mac).device;
      if (created.has(externalId)) {
        entries.push({
          external_id: externalId,
          transport:
            station.online === false ? DEVICE_TRANSPORTS.UNREACHABLE : DEVICE_TRANSPORTS.LOCAL,
        });
      }
    }
    const json = JSON.stringify(entries);
    if (entries.length === 0 || json === this.badge) {
      return;
    }
    try {
      await this.gladys.publishTransports(entries);
      this.badge = json;
    } catch (err) {
      this.logger.warn(`Transport badge failed: ${err.message}`);
    }
  }

  /** A device was created (or updated): send its last values at once. */
  async deviceCreated(device) {
    this.badge = undefined;
    const created = this.createdFeatures();
    for (const f of device?.features ?? []) {
      created.add(f.external_id);
    }
    this.queueStates(created);
    await this.flush();
    await this.publishBadge();
  }

  async deviceDeleted(device) {
    this.badge = undefined;
    if (typeof device?.external_id === 'string') {
      this.publisher.forget(device.external_id);
    }
  }

  /** The Discovery tab asks for a scan: the devices of the last reads, sent again. */
  async scan() {
    this.published = undefined;
    await this.publishDevices();
  }

  // --- Configuration button ------------------------------------------------------

  async testConnection() {
    if (this.stations.size === 0) {
      return this.config.invalid.length > 0
        ? join(T.noAddress, T.invalid(this.config.invalid))
        : T.noAddress;
    }
    const paused = this.pauseMessage();
    if (paused) {
      return paused;
    }
    if (this.now() - this.lastTestAt < TIMINGS.testCooldown) {
      const last = JSON.parse(this.lastStatus ?? '[false,null]')[1];
      return last ? join(T.test.cooldown, last) : T.test.cooldown;
    }
    this.lastTestAt = this.now();
    // A read now of every station (a read in progress is joined).
    await Promise.all([...this.stations.values()].map((station) => this.tick(station)));
    return JSON.parse(this.lastStatus ?? '[false,null]')[1] ?? T.connecting;
  }

  // --- Commands --------------------------------------------------------------------

  refusal(text) {
    return new Error(word(text, this.config.language));
  }

  /**
   * The value of a command, strictly: null, '', ' ', true or 1.5 are never
   * read as a number. Throws a refusal when it is not valid.
   */
  commandValue(role, value) {
    if (role === FEATURES.START || role === FEATURES.STOP) {
      if (value === PRESSED || value === String(PRESSED)) {
        return PRESSED;
      }
      throw this.refusal(ERRORS.badButton);
    }
    const amps =
      typeof value === 'number'
        ? value
        : typeof value === 'string' && /^\s*\d{1,3}\s*$/.test(value)
          ? Number(value.trim())
          : NaN;
    if (!Number.isInteger(amps)) {
      throw this.refusal(ERRORS.badCurrent);
    }
    if (amps < CURRENT.min || amps > CURRENT.ratingMax) {
      throw this.refusal(ERRORS.outOfBounds(CURRENT.min, CURRENT.ratingMax));
    }
    return amps;
  }

  async setValue(_device, feature, value) {
    // The deadlines count from the arrival of the command, before any wait.
    const received = this.now();
    const target = parseFeatureId(feature?.external_id);
    if (!target || !COMMAND_ROLES.includes(target.role)) {
      throw this.refusal(ERRORS.readOnly);
    }
    const wanted = this.commandValue(target.role, value);
    if (!this.config.allowCommands) {
      throw this.refusal(ERRORS.disabled);
    }
    return this.serialized(target.mac, () => this.command(target, wanted, received));
  }

  /** Runs `task` after the previous command of the same station. */
  serialized(mac, task) {
    const previous = this.chains.get(mac) ?? Promise.resolve();
    const run = previous.catch(() => {}).then(task);
    const tail = run.catch(() => {});
    this.chains.set(mac, tail);
    tail.then(() => {
      if (this.chains.get(mac) === tail) {
        this.chains.delete(mac);
      }
    });
    return run;
  }

  /** What to send, from the station just read; undefined when it is already so. */
  plan(role, wanted, s, mac) {
    if (role === FEATURES.START || role === FEATURES.STOP) {
      if (s.autoCharge === undefined || s.sessionActive === undefined) {
        throw this.refusal(ERRORS.missing);
      }
      if (s.autoCharge) {
        throw this.refusal(ERRORS.autoCharge);
      }
      const pending = this.guardActive(mac, 'session');
      if (role === FEATURES.START) {
        if (FAULTS.has(s.status)) {
          throw this.refusal(ERRORS.fault(STATUS_NAMES[s.status]));
        }
        if (s.status === STATUS.UNKNOWN) {
          throw this.refusal(ERRORS.unknownStatus);
        }
        if (s.sessionActive && !pending) {
          return undefined;
        }
        return { command: COMMANDS.START, kind: 'session', from: s.sessionActive, expected: true };
      }
      const charging =
        s.status === STATUS.PLUGGED_CHARGING || s.status === STATUS.VENTILATION_REQUIRED;
      if (!s.sessionActive && !charging && !pending) {
        return undefined;
      }
      return { command: COMMANDS.STOP, kind: 'session', from: s.sessionActive, expected: false };
    }
    if (s.inSharingMode === undefined) {
      throw this.refusal(ERRORS.missing);
    }
    if (s.inSharingMode) {
      throw this.refusal(ERRORS.sharingMode);
    }
    if (s.maxStationCurrent === undefined) {
      throw this.refusal(ERRORS.unknownBounds);
    }
    if (wanted < CURRENT.min || wanted > s.maxStationCurrent) {
      throw this.refusal(ERRORS.outOfBounds(CURRENT.min, s.maxStationCurrent));
    }
    if (s.maxCurrent === wanted && !this.guardActive(mac, 'current')) {
      return undefined;
    }
    return {
      command: COMMANDS.MAX_CURRENT,
      current: wanted,
      kind: 'current',
      from: s.maxCurrent,
      expected: wanted,
    };
  }

  /** The checks before sending, on the latest configuration. */
  checkBeforeSend(generation, mac) {
    if (!this.config.allowCommands) {
      throw this.refusal(ERRORS.disabled);
    }
    if (generation !== this.generation || !this.stationOf(mac)) {
      throw this.refusal(ERRORS.unknownStation);
    }
    const paused = this.pauseMessage();
    if (paused) {
      throw this.refusal(ERRORS.paused(age(this.pausedUntil - this.now())));
    }
  }

  async command({ mac, role }, wanted, received) {
    const generation = this.generation;
    const sendBy = received + TIMINGS.commandSendBy;
    this.checkBeforeSend(generation, mac);
    const station = this.stationOf(mac);
    const readBudget = Math.min(
      TIMINGS.commandReadMax,
      sendBy - TIMINGS.commandMinSend - this.now(),
    );
    if (readBudget < TIMINGS.commandMinRead) {
      throw this.refusal(ERRORS.tooSlow);
    }

    // The state just before acting, never the one in memory.
    let fresh;
    try {
      fresh = await this.client.read(station.address, { timeoutMs: readBudget });
    } catch (err) {
      if (err.kind === ERROR_KINDS.RATE_LIMITED) {
        await this.pause(err);
        this.updateStatus().catch(() => {});
      }
      throw this.refusal(ERRORS.unknownState(errorReason(err)));
    }
    if (generation !== this.generation) {
      throw this.refusal(ERRORS.unknownStation);
    }
    if (fresh.mac !== mac) {
      throw this.refusal(ERRORS.otherStation);
    }
    this.applyRead(station, fresh);
    // Shown in the background: the ack never waits for Gladys.
    this.publishAll().catch((err) => this.logger.warn(`Publishing failed: ${err.message}`));

    const plan = this.plan(role, wanted, fresh, mac);
    if (!plan) {
      return;
    }
    // The option may have been turned off during the read: checked again.
    this.checkBeforeSend(generation, mac);
    if (this.now() > sendBy) {
      throw this.refusal(ERRORS.tooSlow);
    }
    const timeoutMs = Math.max(200, received + TIMINGS.commandAnswerBy - this.now());
    this.logger.info(
      `TechnoVE ${station.key}: ${plan.command}${plan.current ? ` ${plan.current} A` : ''}`,
    );
    try {
      await this.client.command(station.address, plan.command, {
        current: plan.current,
        startBy: sendBy,
        timeoutMs,
      });
    } catch (err) {
      const reason = errorReason(err);
      this.logger.warn(`TechnoVE ${station.key}: ${plan.command} failed (${reason})`);
      if (err.kind === ERROR_KINDS.LATE) {
        throw this.refusal(ERRORS.tooSlow);
      }
      if (err.kind === ERROR_KINDS.UNREACHABLE) {
        throw this.refusal(ERRORS.notSent(reason));
      }
      if (err.kind === ERROR_KINDS.RATE_LIMITED) {
        await this.pause(err);
        this.updateStatus().catch(() => {});
        throw this.refusal(ERRORS.refused(reason));
      }
      if (err.kind === ERROR_KINDS.HTTP && err.status < 500) {
        this.followUp(station);
        throw this.refusal(ERRORS.refused(reason));
      }
      if (err.kind === ERROR_KINDS.HTTP || MAYBE_SENT.has(err.kind)) {
        // It may have reached the station: the state may change anyway.
        this.guard(mac, plan);
        this.followUp(station);
        throw this.refusal(ERRORS.sentUnconfirmed(reason));
      }
      throw this.refusal(ERRORS.sentUnconfirmed(reason));
    }
    this.guard(mac, plan);
    this.followUp(station);
  }

  /** Spaced reads after a command: its effect, then a check. */
  followUp(station) {
    const generation = this.generation;
    for (const delay of TIMINGS.followUps) {
      const handle = this.timers.setTimeout(() => {
        station.followUps.delete(handle);
        if (generation === this.generation) {
          this.tick(station).catch(() => this.logger.error('TechnoVE refresh failed'));
        }
      }, delay);
      station.followUps.add(handle);
    }
  }

  // --- Guards ----------------------------------------------------------------------

  /**
   * After a command, until the station shows it: a new command of the same
   * kind is always sent, never answered "already so" on a state that may not
   * show the previous one yet. The start state is kept: a read equal to it
   * lifts nothing until a move was seen.
   */
  guard(mac, plan) {
    this.guards.set(`${mac}:${plan.kind}`, {
      from: plan.from,
      expected: plan.expected,
      moved: false,
      until: this.now() + TIMINGS.guard,
    });
  }

  guardActive(mac, kind) {
    const key = `${mac}:${kind}`;
    const guard = this.guards.get(key);
    if (guard && this.now() >= guard.until) {
      this.guards.delete(key);
      return false;
    }
    return Boolean(guard);
  }

  /** A read of a station, through its guards: never lifted on an unknown value. */
  observe(snapshot) {
    for (const [kind, value] of [
      ['session', snapshot.sessionActive],
      ['current', snapshot.maxCurrent],
    ]) {
      if (!this.guardActive(snapshot.mac, kind) || value === undefined) {
        continue;
      }
      const guard = this.guards.get(`${snapshot.mac}:${kind}`);
      if (value !== guard.from) {
        guard.moved = true;
      }
      if (guard.moved && value === guard.expected) {
        this.guards.delete(`${snapshot.mac}:${kind}`);
      }
    }
  }
}
