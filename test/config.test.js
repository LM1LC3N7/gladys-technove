import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeConfig, parseAddress } from '../src/config.js';
import { POLL_INTERVAL } from '../src/constants.js';

test('addresses: IPv4 or host names, a pasted URL reduced, four at most', () => {
  assert.deepEqual(parseAddress(' 192.168.1.50 '), { host: '192.168.1.50', port: 80 });
  assert.deepEqual(parseAddress('http://192.168.1.50:8080/station'), {
    host: '192.168.1.50',
    port: 8080,
  });
  assert.deepEqual(parseAddress('Borne.local'), { host: 'borne.local', port: 80 });
  for (const bad of ['', '300.1.1.1', '1.2.3', 'a b', 'x:0', 'x:70000', '-x', 'a_b']) {
    assert.equal(parseAddress(bad), undefined, bad);
  }
  const config = normalizeConfig({
    addresses: '10.0.0.1,10.0.0.1;10.0.0.2 10.0.0.3 10.0.0.4 10.0.0.5 a_b',
  });
  assert.deepEqual(
    config.addresses.map((a) => a.host),
    ['10.0.0.1', '10.0.0.2', '10.0.0.3', '10.0.0.4'],
  );
  assert.deepEqual(config.invalid, ['a_b']);
});

test('the commands are allowed by true only', () => {
  assert.equal(normalizeConfig({}).allowCommands, false);
  assert.equal(normalizeConfig({ allow_commands: true }).allowCommands, true);
  assert.equal(normalizeConfig({ allow_commands: 'true' }).allowCommands, true);
  for (const value of [1, '1', 'yes', 'TRUE', {}, [], null, undefined, false, 'false']) {
    assert.equal(normalizeConfig({ allow_commands: value }).allowCommands, false, String(value));
  }
});

test('interval bounded, language fr or en, unknown keys ignored', () => {
  assert.equal(normalizeConfig({ poll_interval: 1 }).pollInterval, POLL_INTERVAL.min);
  assert.equal(normalizeConfig({ poll_interval: 99999 }).pollInterval, POLL_INTERVAL.max);
  assert.equal(normalizeConfig({ poll_interval: '' }).pollInterval, POLL_INTERVAL.default);
  assert.equal(normalizeConfig({ poll_interval: 'x' }).pollInterval, POLL_INTERVAL.default);
  assert.equal(normalizeConfig({ language: 'de' }).language, 'fr');
  assert.equal(normalizeConfig({ language: 'en' }).language, 'en');
  const polluted = normalizeConfig(JSON.parse('{"__proto__":{"allow_commands":true}}'));
  assert.equal(polluted.allowCommands, false);
  assert.equal({}.allow_commands, undefined);
});
