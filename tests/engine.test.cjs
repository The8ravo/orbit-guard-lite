'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Game, UPGRADES, ENEMY_TYPES } = require('../web/engine.js');
function advance(game, seconds) {
  for (let i = 0; i < Math.ceil(seconds * 30); i++) game.tick(1 / 30);
}

test('exactly three permanent upgrades and two enemy types', () => {
  assert.deepEqual(UPGRADES.map(u => u.id), ['damage', 'attackSpeed', 'maxHp']);
  assert.deepEqual(Object.keys(ENEMY_TYPES), ['basic', 'boss']);
  assert.equal(ENEMY_TYPES.boss.hpMultiplier, 20);
  assert.equal(ENEMY_TYPES.boss.speedMultiplier, 0.3);
});

test('purchases are atomic, consume coins, raise stats, and survive a new run', () => {
  const g = new Game();
  g.startRun();
  assert.equal(g.purchase('damage'), false);
  assert.equal(g.purchase('constructor'), false);
  assert.equal(g.state.coins, 0);
  const damage = g.getStats().damage;
  const price = g.getCost('damage');
  g.modifyCurrency({ coins: price });
  assert.equal(g.purchase('damage'), true);
  assert.equal(g.state.coins, 0);
  assert.equal(g.state.meta.damage, 1);
  assert.ok(g.getStats().damage > damage);
  g.startRun();
  assert.equal(g.state.meta.damage, 1);
  assert.equal(g.state.run.wave, 1);
});

test('health purchase grants only the added maximum, preserving damage taken', () => {
  const g = new Game();
  g.startRun();
  g.state.run.hp -= 35;
  g.modifyCurrency({ coins: 100 });
  assert.equal(g.purchase('maxHp'), true);
  assert.equal(g.getStats().maxHp - g.state.run.hp, 35);
});

test('modifier rejects nonfinite and out-of-range input without changing coins', () => {
  const g = new Game();
  assert.equal(g.modifyCurrency({ coins: 123.9 }), true);
  assert.equal(g.state.coins, 123);
  for (const value of [-1, Infinity, NaN, '20', 1000000000000]) {
    assert.equal(g.modifyCurrency({ coins: value }), false);
    assert.equal(g.state.coins, 123);
  }
  assert.equal(g.modifyCurrency({ coins: 999999999999 }), true);
  assert.equal(g.modifyCurrency({ coins: 0 }), true);
});

test('real combat moves, shoots, kills and rewards exactly once per enemy', () => {
  const g = new Game({ rng: 43 });
  g.startRun();
  const enemy = g.state.run.enemies[0];
  const radius = Math.hypot(enemy.x, enemy.y);
  advance(g, 1);
  assert.ok(Math.hypot(enemy.x, enemy.y) < radius);
  advance(g, 9);
  assert.ok(g.state.run.kills >= 4);
  assert.equal(g.state.totalKills, g.state.run.kills);
  assert.equal(g.state.coins, g.state.run.kills * 2);
  assert.equal(g.state.run.earned, g.state.coins);
});

test('pause freezes the whole simulation and speed is applied exactly once', () => {
  const g = new Game();
  g.startRun();
  advance(g, 1);
  g.togglePause();
  const snapshot = JSON.stringify(g.state.run);
  advance(g, 4);
  assert.equal(JSON.stringify(g.state.run), snapshot);
  g.togglePause();
  g.setSpeed(4);
  assert.equal(g.setSpeed(3), false);
  const before = g.state.run.elapsed;
  advance(g, 1);
  assert.ok(Math.abs(g.state.run.elapsed - before - 4) < 0.00001);
});

test('wave 10 spawns one boss with 20× HP / 0.3× speed and wave healing is bounded', () => {
  const g = new Game({ rng: 61 });
  g.startRun();
  g.state.meta.damage = 60;
  g.state.meta.maxHp = 80;
  g.state.run.hp = g.getStats().maxHp;
  advance(g, 108.1);
  assert.equal(g.state.run.wave, 10);
  const boss = g.state.run.enemies.find(e => e.type === 'boss');
  const basic = g.state.run.enemies.find(e => e.type === 'basic');
  assert.ok(boss);
  assert.ok(basic);
  assert.ok(Math.abs(boss.maxHp / basic.maxHp - 20) < 0.00001);
  assert.ok(Math.abs(boss.speed / basic.speed - 0.3) < 0.00001);
  assert.equal(g.state.run.enemies.filter(e => e.type === 'boss').length, 1);
  assert.ok(g.state.run.hp <= g.getStats().maxHp);
  assert.ok(g.events.some(e => e.type === 'boss'));
});

test('boss death produces permanent reward and death transitions occur once', () => {
  const g = new Game();
  g.startRun();
  g._spawn('boss');
  const boss = g.state.run.enemies.find(e => e.type === 'boss');
  boss.hp = 0;
  g.tick(1 / 30);
  assert.equal(g.state.run.kills, 1);
  assert.equal(g.state.coins, 26);
  assert.ok(g.events.some(e => e.type === 'bossKilled'));
  const basic = g.state.run.enemies[0];
  basic.x = 0; basic.y = 0; basic.damage = 1000; basic.hitClock = 0;
  g.tick(1 / 30);
  assert.equal(g.state.run.active, false);
  assert.equal(g.state.run.over, true);
  assert.equal(g.state.run.hp, 0);
  advance(g, 5);
  assert.equal(g.events.filter(e => e.type === 'death').length, 1);
  g.startRun();
  assert.equal(g.state.run.over, false);
  assert.equal(g.state.coins, 26);
  assert.equal(g.state.run.kills, 0);
});

test('save restores active enemies, upgrades and pause without exposing state references', () => {
  const g = new Game({ rng: 82 });
  g.startRun();
  g.modifyCurrency({ coins: 100 });
  g.purchase('maxHp');
  advance(g, 2);
  g.togglePause();
  const saved = g.exportSave();
  const restored = new Game(JSON.parse(JSON.stringify(saved)));
  assert.equal(restored.state.coins, g.state.coins);
  assert.equal(restored.state.meta.maxHp, 1);
  assert.equal(restored.state.run.paused, true);
  assert.equal(restored.state.run.enemies.length, g.state.run.enemies.length);
  assert.equal(restored.state.run.enemies[0].x, g.state.run.enemies[0].x);
  assert.equal(restored.state.run.waveTime, g.state.run.waveTime);
  saved.meta.maxHp = 50;
  assert.equal(g.state.meta.maxHp, 1);
  restored.togglePause();
  advance(restored, 5);
  assert.ok(restored.state.run.kills > 0);
});

test('save with an active projectile resumes identical damage, rewards and enemy positions', () => {
  const original = new Game({ rng: 17 });
  original.startRun();
  for (let i = 0; i < 200 && !original.state.run.projectiles.length; i++) original.tick(1 / 30);
  assert.ok(original.state.run.projectiles.length > 0);
  const restored = new Game(original.exportSave());
  assert.deepEqual(restored.state.run.projectiles, original.state.run.projectiles);
  advance(original, 15);
  advance(restored, 15);
  assert.equal(restored.state.coins, original.state.coins);
  assert.equal(restored.state.run.hp, original.state.run.hp);
  assert.equal(restored.state.run.kills, original.state.run.kills);
  assert.deepEqual(restored.state.run.enemies, original.state.run.enemies);
  assert.deepEqual(restored.state.run.projectiles, original.state.run.projectiles);
});

test('malformed saves are finite and bounded; max levels cannot spend more coins', () => {
  const g = new Game({ coins: NaN, bestWave: Infinity, meta: { damage: 1000, attackSpeed: -9, maxHp: 'bad' },
    settings: { speed: 999 }, run: { active: true, wave: Infinity, waveTime: NaN, hp: NaN,
      enemies: [{ type: '__proto__' }, { id: 1, type: 'boss', hp: NaN, maxHp: Infinity, x: NaN }] } });
  assert.equal(g.state.coins, 0);
  assert.equal(g.state.meta.damage, 100);
  assert.equal(g.state.meta.attackSpeed, 0);
  assert.equal(g.state.settings.speed, 1);
  assert.equal(g.state.run.enemies.length, 1);
  g.modifyCurrency({ coins: 999999999999 });
  assert.equal(g.purchase('damage'), false);
  assert.equal(g.state.coins, 999999999999);
  advance(g, 1);
  assert.ok(Number.isFinite(g.state.run.hp));
  assert.ok(Number.isFinite(g.state.run.enemies[0].x));
  assert.equal(JSON.stringify(g.exportSave()).includes('null'), false);
});

test('a fresh run can defeat its first boss using only earned coins and balanced upgrades', () => {
  const g = new Game({ rng: 31 });
  g.startRun();
  let bossKills = 0;
  for (let frame = 0; frame < 30 * 300 && g.state.run.active; frame++) {
    g.tick(1 / 30);
    if (frame % 30 === 0) {
      const next = UPGRADES.map(u => u.id).sort((a, b) => g.getCost(a) - g.getCost(b))[0];
      g.purchase(next);
    }
    bossKills += g.events.splice(0).filter(e => e.type === 'bossKilled').length;
    assert.ok(g.state.coins >= 0);
  }
  assert.ok(bossKills >= 1);
  assert.ok(g.state.run.wave >= 15);
  assert.ok(g.state.run.elapsed <= 300);
});
