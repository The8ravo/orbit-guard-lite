'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const engine = require('../web/engine.js');
const app = fs.readFileSync(require.resolve('../web/app.js'), 'utf8');

function boot(nativeLoad, localLoad) {
  let game;
  const nodes = new Map();
  const node = id => {
    if (!nodes.has(id)) nodes.set(id, {
      hidden: true, style: {}, dataset: {}, textContent: '', value: '',
      classList: { toggle() {} }, addEventListener() {}, setAttribute() {},
      getContext() { return { setTransform() {} }; },
      getBoundingClientRect() { return { width: 390, height: 390 }; }
    });
    return nodes.get(id);
  };
  const context = {
    TowerEngine: { ...engine, Game: function (saved) { game = new engine.Game(saved); return game; } },
    document: { hidden: false, getElementById: node, querySelectorAll: () => [], addEventListener() {} },
    window: { AndroidStore: nativeLoad ? { load: nativeLoad, save() {} } : undefined, addEventListener() {}, devicePixelRatio: 1 },
    localStorage: { getItem: localLoad, setItem() {} },
    requestAnimationFrame() {}, setTimeout() {}, clearTimeout() {}
  };
  vm.runInNewContext(app, context, { filename: 'web/app.js' });
  return game;
}
function save(coins, savedAt) { return JSON.stringify({ version: 1, coins, savedAt }); }

test('a failed native load still restores valid browser storage', () => {
  const game = boot(() => { throw new Error('unavailable'); }, () => save(4321, 20));
  assert.equal(game.state.coins, 4321);
});
test('a damaged native JSON save still restores valid browser storage', () => {
  const game = boot(() => '{partial', () => save(7654, 20));
  assert.equal(game.state.coins, 7654);
});
test('newer local save wins, while native wins ties', () => {
  assert.equal(boot(() => save(20, 10), () => save(30, 20)).state.coins, 30);
  assert.equal(boot(() => save(20, 30), () => save(30, 20)).state.coins, 20);
  assert.equal(boot(() => save(20, 30), () => save(30, 30)).state.coins, 20);
});
test('null or array saves are skipped and a failed browser store preserves native save', () => {
  assert.equal(boot(() => 'null', () => save(80, 20)).state.coins, 80);
  assert.equal(boot(() => '[]', () => save(80, 20)).state.coins, 80);
  assert.equal(boot(() => save(99, 20), () => { throw new Error('blocked'); }).state.coins, 99);
});
