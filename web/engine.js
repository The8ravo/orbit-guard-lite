/* 星环守卫 — local, dependency-free game simulation. World coordinates: 500 × 500, centered at (0, 0). */
(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.TowerEngine = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var LIMIT = 999999999999;
  var WAVE_SECONDS = 12;
  var UPGRADES = [
    { id: 'damage', name: '火力', description: '提高每发子弹的伤害', maxLevel: 100, baseCost: 12, category: 'attack' },
    { id: 'attackSpeed', name: '射速', description: '提高每秒发射次数', maxLevel: 50, baseCost: 16, category: 'attack' },
    { id: 'maxHp', name: '护盾', description: '提高生命上限，并立即补充增量', maxLevel: 100, baseCost: 10, category: 'defense' }
  ];
  // Boss health/speed ratios follow the community wiki; all progression and pacing are our own.
  var ENEMY_TYPES = {
    basic: { name: '普通', color: '#ff6c88', size: 8, hpMultiplier: 1, speedMultiplier: 1, coinValue: 2 },
    boss: { name: '首领', color: '#ff684c', size: 23, hpMultiplier: 20, speedMultiplier: 0.3, coinValue: 5 }
  };
  function number(value, fallback, min, max) {
    return typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
  }
  function integer(value, fallback, min, max) { return Math.floor(number(value, fallback, min, max)); }
  function currency(value) { return integer(value, 0, 0, LIMIT); }
  function levels(source) {
    var result = {};
    UPGRADES.forEach(function (u) { result[u.id] = integer(source && source[u.id], 0, 0, u.maxLevel); });
    return result;
  }
  function emptyRun() {
    return { active: false, over: false, paused: false, wave: 0, waveTime: 0, hp: 120,
      kills: 0, earned: 0, enemies: [], projectiles: [], effects: [], spawned: 0, shotClock: 0, elapsed: 0 };
  }
  function formatNumber(value) {
    var n = number(value, 0, 0, Number.MAX_VALUE);
    if (n < 1000) return String(Math.floor(n));
    var suffix = n >= 1e12 ? ['T', 1e12] : n >= 1e9 ? ['B', 1e9] : n >= 1e6 ? ['M', 1e6] : ['K', 1000];
    return (n / suffix[1]).toFixed(n / suffix[1] >= 100 ? 0 : 1).replace(/\.0$/, '') + suffix[0];
  }

  function Game(saved) {
    saved = saved && typeof saved === 'object' ? saved : {};
    this.events = [];
    this.state = {
      version: 1, coins: currency(saved.coins), bestWave: integer(saved.bestWave, 0, 0, 10000),
      totalKills: integer(saved.totalKills, 0, 0, LIMIT), meta: levels(saved.meta), run: emptyRun(),
      settings: { speed: saved.settings && [1, 2, 4].indexOf(saved.settings.speed) >= 0 ? saved.settings.speed : 1 },
      savedAt: number(saved.savedAt, Date.now(), 0, Number.MAX_SAFE_INTEGER)
    };
    this._rng = integer(saved.rng, Math.floor(Math.random() * 2147483646) + 1, 1, 2147483646);
    this._nextId = 1;
    this.state.run.hp = this.getStats().maxHp;
    this._restoreRun(saved.run);
  }
  Game.prototype._random = function () {
    this._rng = this._rng * 16807 % 2147483647;
    return (this._rng - 1) / 2147483646;
  };
  Game.prototype._event = function (type, text, extra) {
    this.events.push(Object.assign({ type: type, text: text }, extra || {}));
    if (this.events.length > 30) this.events.shift();
  };
  Game.prototype.getStats = function () {
    var l = this.state.meta;
    return {
      damage: 12 * (1 + 0.22 * l.damage) * Math.pow(1.075, l.damage),
      attackSpeed: Math.min(12, 1.8 + l.attackSpeed * 0.204),
      maxHp: Math.round(120 * (1 + 0.25 * l.maxHp) * Math.pow(1.08, l.maxHp)),
      range: 140, regen: 0
    };
  };
  Game.prototype.getCost = function (id) {
    var u = UPGRADES.find(function (item) { return item.id === id; });
    if (!u || this.state.meta[id] >= u.maxLevel) return Infinity;
    return Math.min(LIMIT, Math.ceil(u.baseCost * Math.pow(1.3, this.state.meta[id])));
  };
  Game.prototype.purchase = function (id) {
    var cost = this.getCost(id);
    if (!Number.isFinite(cost) || this.state.coins < cost) return false;
    var previousHp = this.getStats().maxHp;
    this.state.coins -= cost;
    this.state.meta[id] += 1;
    if (id === 'maxHp' && !this.state.run.over) this.state.run.hp += this.getStats().maxHp - previousHp;
    this._event('upgrade', '升级已保存', { id: id, level: this.state.meta[id] });
    return true;
  };
  Game.prototype.modifyCurrency = function (values) {
    if (!values || typeof values.coins !== 'number' || !Number.isFinite(values.coins) || values.coins < 0 || values.coins > LIMIT) return false;
    this.state.coins = Math.floor(values.coins);
    this._event('currency', '金币已修改');
    return true;
  };
  Game.prototype.setSpeed = function (speed) {
    if ([1, 2, 4].indexOf(speed) < 0) return false;
    this.state.settings.speed = speed;
    return true;
  };
  Game.prototype.togglePause = function () {
    if (!this.state.run.active) return false;
    this.state.run.paused = !this.state.run.paused;
    return this.state.run.paused;
  };
  Game.prototype.startRun = function () {
    this.state.run = emptyRun();
    this.state.run.active = true;
    this.state.run.hp = this.getStats().maxHp;
    this._beginWave();
    return true;
  };
  Game.prototype.getWaveProgress = function () { return Math.min(1, this.state.run.waveTime / WAVE_SECONDS); };
  Game.prototype._beginWave = function () {
    var run = this.state.run;
    run.wave = Math.min(10000, run.wave + 1);
    run.waveTime = 0;
    run.spawned = 0;
    this.state.bestWave = Math.max(this.state.bestWave, run.wave);
    if (run.wave > 1) {
      var reward = 5 + Math.floor(run.wave / 2);
      this._reward(reward);
      run.hp = Math.min(this.getStats().maxHp, run.hp + this.getStats().maxHp * 0.06);
      this._effect(0, 0, 'heal', '#78efc4', 0.7);
    }
    if (run.wave % 10 === 0) {
      this._spawn('boss');
      this._event('boss', '首领来袭', { wave: run.wave });
    } else this._event('wave', '第 ' + run.wave + ' 波', { wave: run.wave });
    this._spawnNext();
  };
  Game.prototype._reward = function (amount) {
    this.state.coins = Math.min(LIMIT, this.state.coins + amount);
    this.state.run.earned = Math.min(LIMIT, this.state.run.earned + amount);
  };
  Game.prototype._waveCount = function () { return Math.min(26, 5 + Math.floor(this.state.run.wave / 3)); };
  Game.prototype._spawnNext = function () {
    var run = this.state.run;
    this._spawn('basic');
    run.spawned += 1;
  };
  Game.prototype._spawn = function (type) {
    var run = this.state.run;
    if (run.enemies.length >= 180) return;
    var t = ENEMY_TYPES[type];
    var wave = run.wave - 1;
    var angle = this._random() * Math.PI * 2;
    var hp = Math.min(1e15, 12 * Math.pow(1.125, Math.min(wave, 300)) * (1 + wave * 0.02) * t.hpMultiplier);
    run.enemies.push({
      id: this._nextId++, type: type, x: Math.cos(angle) * 230, y: Math.sin(angle) * 230,
      hp: hp, maxHp: hp, size: t.size, color: t.color, angle: angle,
      speed: (28 + Math.min(20, wave * 0.16)) * t.speedMultiplier,
      damage: Math.min(1e15, 5 * Math.pow(1.115, Math.min(wave, 300))),
      reward: t.coinValue + Math.floor(wave / 15), hitClock: 0.4
    });
  };
  Game.prototype._effect = function (x, y, type, color, life) {
    var effects = this.state.run.effects;
    if (effects.length >= 90) effects.shift();
    effects.push({ x: x, y: y, type: type, color: color, age: 0, life: life });
  };
  Game.prototype._kill = function (enemy) {
    if (enemy.dead) return;
    enemy.dead = true;
    this.state.run.kills = Math.min(LIMIT, this.state.run.kills + 1);
    this.state.totalKills = Math.min(LIMIT, this.state.totalKills + 1);
    this._reward(enemy.reward);
    this._effect(enemy.x, enemy.y, 'burst', enemy.color, enemy.type === 'boss' ? 1 : 0.45);
    if (enemy.type === 'boss') {
      this._reward(20 + this.state.run.wave);
      var maxHp = this.getStats().maxHp;
      this.state.run.hp = Math.min(maxHp, this.state.run.hp + maxHp * 0.15);
      this._event('bossKilled', '首领已击破', { wave: this.state.run.wave });
    }
  };
  Game.prototype.tick = function (seconds) {
    if (!Number.isFinite(seconds) || seconds <= 0 || !this.state.run.active || this.state.run.paused) return;
    // Limit a single foreground frame; background time is deliberately not simulated.
    var remaining = Math.min(seconds, 0.5) * this.state.settings.speed;
    while (remaining > 0.000001 && this.state.run.active) {
      var dt = Math.min(1 / 30, remaining);
      this._step(dt);
      remaining -= dt;
    }
  };
  Game.prototype._step = function (dt) {
    var run = this.state.run;
    var stats = this.getStats();
    run.elapsed += dt;
    run.waveTime += dt;
    if (run.waveTime + 1e-9 >= WAVE_SECONDS) {
      var carry = Math.max(0, run.waveTime - WAVE_SECONDS);
      this._beginWave();
      run.waveTime = carry;
    }
    var interval = 8.5 / this._waveCount();
    if (run.spawned < this._waveCount() && run.waveTime >= run.spawned * interval) this._spawnNext();
    for (var i = 0; i < run.enemies.length; i++) {
      var e = run.enemies[i];
      if (e.hp <= 0) { this._kill(e); continue; }
      var distance = Math.hypot(e.x, e.y);
      var stopAt = 20 + e.size * 0.5;
      if (distance > stopAt) {
        var move = Math.min(distance - stopAt, e.speed * dt);
        e.x -= e.x / distance * move;
        e.y -= e.y / distance * move;
      } else {
        e.hitClock -= dt;
        if (e.hitClock <= 0) {
          run.hp = Math.max(0, run.hp - e.damage);
          e.hitClock += 1;
          this._effect(0, 0, 'hit', '#ff6c88', 0.2);
          if (run.hp <= 0) { this._die(); return; }
        }
      }
    }
    run.shotClock = Math.max(0, run.shotClock - dt);
    if (run.shotClock <= 0) {
      var target = null;
      var nearest = stats.range + 1;
      run.enemies.forEach(function (e) {
        var d = Math.hypot(e.x, e.y);
        if (!e.dead && e.hp > 0 && d <= stats.range && d < nearest) { target = e; nearest = d; }
      });
      if (target) {
        run.projectiles.push({ x: 0, y: 0, px: 0, py: 0, target: target.id, damage: stats.damage, life: 1.5 });
        run.shotClock = 1 / stats.attackSpeed;
        run.towerAngle = Math.atan2(target.y, target.x);
        this._effect(0, 0, 'muzzle', '#a6fbec', 0.12);
      }
    }
    for (var p = run.projectiles.length - 1; p >= 0; p--) {
      var bullet = run.projectiles[p];
      var victim = run.enemies.find(function (e) { return e.id === bullet.target && !e.dead; });
      bullet.life -= dt;
      if (!victim || bullet.life <= 0) { run.projectiles.splice(p, 1); continue; }
      var dx = victim.x - bullet.x, dy = victim.y - bullet.y;
      var d = Math.hypot(dx, dy), travel = 460 * dt;
      bullet.px = bullet.x; bullet.py = bullet.y;
      if (d <= travel + victim.size) {
        victim.hp = Math.max(0, victim.hp - bullet.damage);
        this._effect(victim.x, victim.y, 'spark', victim.color, 0.17);
        if (victim.hp <= 0) this._kill(victim);
        run.projectiles.splice(p, 1);
      } else { bullet.x += dx / d * travel; bullet.y += dy / d * travel; }
    }
    run.enemies = run.enemies.filter(function (e) { return !e.dead; });
    run.effects.forEach(function (effect) { effect.age += dt; });
    run.effects = run.effects.filter(function (effect) { return effect.age < effect.life; });
  };
  Game.prototype._die = function () {
    var run = this.state.run;
    run.active = false; run.over = true; run.paused = false; run.hp = 0;
    run.projectiles = [];
    this._effect(0, 0, 'burst', '#ff6c88', 1.2);
    this._event('death', '本轮结束', { wave: run.wave, kills: run.kills, earned: run.earned });
  };
  Game.prototype.exportSave = function () {
    this.state.savedAt = Date.now();
    var result = JSON.parse(JSON.stringify(this.state));
    result.rng = this._rng;
    result.run.effects = [];
    return result;
  };
  Game.prototype._restoreRun = function (source) {
    if (!source || typeof source !== 'object' || (!source.active && !source.over)) return;
    var run = this.state.run;
    run.active = source.active === true && source.over !== true;
    run.over = source.over === true;
    run.paused = source.paused === true && run.active;
    run.wave = integer(source.wave, 1, 1, 10000);
    run.waveTime = number(source.waveTime, 0, 0, WAVE_SECONDS);
    run.hp = number(source.hp, this.getStats().maxHp, 0, this.getStats().maxHp);
    run.kills = integer(source.kills, 0, 0, LIMIT);
    run.earned = currency(source.earned);
    run.spawned = integer(source.spawned, this._waveCount(), 0, this._waveCount());
    run.shotClock = number(source.shotClock, 0, 0, 1);
    run.elapsed = number(source.elapsed, 0, 0, 1e9);
    run.towerAngle = number(source.towerAngle, -Math.PI / 2, -Math.PI * 2, Math.PI * 2);
    if (Array.isArray(source.enemies)) {
      var used = new Set();
      var self = this;
      source.enemies.slice(0, 180).forEach(function (e) {
        if (!e || !Object.prototype.hasOwnProperty.call(ENEMY_TYPES, e.type)) return;
        var t = ENEMY_TYPES[e.type];
        var id = integer(e.id, self._nextId, 1, 1e9);
        if (used.has(id)) return;
        used.add(id);
        self._nextId = Math.max(self._nextId, id + 1);
        var hp = number(e.maxHp, 12, 1, 1e15);
        run.enemies.push({ id: id, type: e.type, x: number(e.x, 230, -250, 250), y: number(e.y, 0, -250, 250),
          maxHp: hp, hp: number(e.hp, hp, 0.001, hp), size: t.size, color: t.color,
          angle: number(e.angle, 0, 0, Math.PI * 2), speed: number(e.speed, 28 * t.speedMultiplier, 1, 100),
          damage: number(e.damage, 5, 0.1, 1e15), reward: integer(e.reward, t.coinValue, 1, 1000),
          hitClock: number(e.hitClock, 0.4, 0, 1) });
      });
    }
    if (Array.isArray(source.projectiles) && run.active && run.hp > 0) {
      var maxDamage = this.getStats().damage;
      source.projectiles.slice(0, 64).forEach(function (p) {
        if (!p || !run.enemies.some(function (e) { return e.id === p.target; })) return;
        run.projectiles.push({
          x: number(p.x, 0, -250, 250), y: number(p.y, 0, -250, 250),
          px: number(p.px, 0, -250, 250), py: number(p.py, 0, -250, 250), target: p.target,
          damage: number(p.damage, maxDamage, 0, maxDamage), life: number(p.life, 1.5, 0, 1.5)
        });
      });
    }
    if (run.hp <= 0 || run.over) { run.hp = 0; run.active = false; run.over = true; run.paused = false; }
    this.state.bestWave = Math.max(this.state.bestWave, run.wave);
  };

  return { Game: Game, UPGRADES: UPGRADES, ENEMY_TYPES: ENEMY_TYPES, formatNumber: formatNumber };
});
