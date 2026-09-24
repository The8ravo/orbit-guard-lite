(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const KEY = 'orbit-guard-save-v1';
  const MAX_COINS = 999999999999;
  let storageWarning = false;
  function readSave() {
    const candidates = [];
    function read(load) {
      try {
        const raw = load();
        const data = raw ? JSON.parse(raw) : undefined;
        if (data && typeof data === 'object' && !Array.isArray(data)) candidates.push(data);
      } catch (_) {}
    }
    read(() => window.AndroidStore && window.AndroidStore.load());
    read(() => localStorage.getItem(KEY));
    return candidates.reduce((latest, data) => {
      const time = Number.isFinite(data.savedAt) ? data.savedAt : 0;
      const previous = latest && Number.isFinite(latest.savedAt) ? latest.savedAt : 0;
      return !latest || time > previous ? data : latest;
    }, undefined);
  }
  const game = new TowerEngine.Game(readSave());
  const canvas = $('battlefield');
  const ctx = canvas.getContext('2d', { alpha: false });
  let width = 0, height = 0, scale = 1, background = document.hidden;
  let lastTime = 0, lastHud = 0, lastSave = 0, visualTime = 0;
  let toastTimer, messageTimer, towerAngle = -Math.PI / 2;
  let message = '自动开火，点击下方升级';
  const currencyModal = $('currency-modal');
  const resultModal = $('result-modal');
  const upgradeButtons = Array.from(document.querySelectorAll('[data-upgrade]'));
  const compact = (n) => TowerEngine.formatNumber(Math.max(0, Number(n) || 0));
  const number = (n) => Math.round(Math.max(0, Number(n) || 0)).toLocaleString('zh-CN');

  function save() {
    const json = JSON.stringify(game.exportSave());
    let success = false;
    try { if (window.AndroidStore) { window.AndroidStore.save(json); success = true; } } catch (_) {}
    try { localStorage.setItem(KEY, json); success = true; } catch (_) {}
    if (!success && !storageWarning) { storageWarning = true; $('save-hint').textContent = '存档失败，请保持游戏开启'; }
  }
  function toast(text) {
    clearTimeout(toastTimer);
    $('toast').textContent = text; $('toast').hidden = false;
    toastTimer = setTimeout(() => { $('toast').hidden = true; }, 1900);
  }
  function announce(text, boss) {
    clearTimeout(messageTimer); message = text;
    $('arena-message').textContent = text;
    $('arena-message').classList.toggle('boss', !!boss);
    $('arena-message').style.opacity = '1';
    messageTimer = setTimeout(() => { $('arena-message').style.opacity = '0'; }, boss ? 3500 : 2600);
  }
  function showResult() {
    const run = game.state.run;
    $('result-wave').textContent = run.wave;
    $('result-coins').textContent = compact(run.earned);
    $('result-kills').textContent = number(run.kills);
    resultModal.hidden = false;
  }
  function refreshHud() {
    const state = game.state, run = state.run, stats = game.getStats();
    $('coin-count').textContent = compact(state.coins);
    $('currency-open').title = number(state.coins) + ' 金币 · 点击修改';
    $('wave-number').textContent = String(run.wave).padStart(2, '0');
    $('wave-label').textContent = run.wave % 10 === 0 ? '首领波次' : '下一首领 · ' + (Math.floor(run.wave / 10) * 10 + 10);
    $('best-wave').textContent = Math.max(state.bestWave || 0, run.wave || 0);
    $('kill-count').textContent = '击破 ' + number(run.kills);
    $('health-value').textContent = compact(Math.ceil(run.hp)) + ' / ' + compact(stats.maxHp);
    const health = Math.max(0, Math.min(1, run.hp / stats.maxHp));
    $('health-fill').style.width = health * 100 + '%';
    $('health-fill').style.background = health < .25 ? '#eb946e' : '#95f3bf';
    $('wave-progress').style.width = Math.min(100, (game.getWaveProgress ? game.getWaveProgress() : run.waveTime / 12) * 100) + '%';
    $('paused-badge').hidden = !run.paused || run.over;
    $('pause-label').textContent = run.paused ? '继续' : '暂停';
    $('pause-icon').innerHTML = run.paused ? '<path d="m6 3 10 7-10 7Z"/>' : '<path d="M7 4v12M13 4v12"/>';
    $('pause-button').disabled = run.over;
    $('combat-status').textContent = run.over ? '防御结束' : run.paused ? '防御已暂停' : '自动防御中';
    $('speed-label').textContent = (state.settings.speed || 1) + '×';
    for (const button of upgradeButtons) {
      const id = button.dataset.upgrade, level = state.meta[id] || 0;
      const def = TowerEngine.UPGRADES.find((u) => u.id === id);
      const maxed = level >= def.maxLevel, cost = game.getCost(id);
      $('level-' + id).textContent = 'Lv.' + level;
      $('stat-' + id).textContent = id === 'attackSpeed' ? stats[id].toFixed(1) : compact(stats[id]);
      $('cost-' + id).textContent = maxed ? '已满级' : '◇ ' + compact(cost);
      button.disabled = maxed || state.coins < cost;
      button.classList.toggle('affordable', !button.disabled);
      button.setAttribute('aria-label', def.name + '，等级 ' + level + (maxed ? '，已满级' : '，升级花费 ' + number(cost) + ' 金币'));
    }
  }
  function resize() {
    const rect = canvas.getBoundingClientRect();
    width = rect.width; height = rect.height;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    scale = Math.min(width / 510, (height - 20) / 480);
  }
  function polygon(x, y, radius, sides, rotation) {
    ctx.beginPath();
    for (let i = 0; i < sides; i++) {
      const a = rotation + i * Math.PI * 2 / sides;
      const px = x + Math.cos(a) * radius, py = y + Math.sin(a) * radius;
      if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py);
    }
    ctx.closePath();
  }
  function circle(x, y, r) { ctx.beginPath(); ctx.arc(x, y, Math.max(0, r), 0, Math.PI * 2); }
  function draw() {
    const run = game.state.run, stats = game.getStats();
    ctx.fillStyle = '#091414'; ctx.fillRect(0, 0, width, height);
    ctx.save(); ctx.translate(width / 2, height / 2 - 7); ctx.scale(scale, scale);
    // Sparse radar marks keep the battlefield legible at small screen sizes.
    ctx.fillStyle = '#1c342b';
    for (let x = -250; x <= 250; x += 26) for (let y = -234; y <= 234; y += 26) {
      if (x * x + y * y < 255 * 255) { circle(x, y, .65); ctx.fill(); }
    }
    const glow = ctx.createRadialGradient(0, 0, 7, 0, 0, stats.range + 40);
    glow.addColorStop(0, 'rgba(25,55,43,.53)'); glow.addColorStop(.7, 'rgba(17,42,32,.12)'); glow.addColorStop(1, 'rgba(9,20,20,0)');
    ctx.fillStyle = glow; circle(0, 0, stats.range + 40); ctx.fill();
    ctx.strokeStyle = '#1b392d'; ctx.lineWidth = 1;
    circle(0, 0, 205); ctx.stroke();
    ctx.strokeStyle = '#2a5140'; ctx.setLineDash([3, 7]); circle(0, 0, stats.range); ctx.stroke(); ctx.setLineDash([]);
    ctx.strokeStyle = '#16372b'; circle(0, 0, 68); ctx.stroke();
    for (let i = 0; i < 4; i++) {
      const a = i * Math.PI / 2;
      ctx.strokeStyle = '#42634c'; ctx.beginPath(); ctx.moveTo(Math.cos(a) * 198, Math.sin(a) * 198); ctx.lineTo(Math.cos(a) * 212, Math.sin(a) * 212); ctx.stroke();
    }
    ctx.save(); ctx.rotate(visualTime * .1); ctx.strokeStyle = '#385a43'; ctx.lineWidth = 1.5;
    for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.arc(0, 0, 45, i * Math.PI * 2 / 3, i * Math.PI * 2 / 3 + .35); ctx.stroke(); }
    ctx.restore();

    for (const e of run.enemies || []) {
      if (e.hp <= 0) continue;
      const boss = e.type === 'boss', size = e.size || (boss ? 19 : 7);
      const color = boss ? '#f0ae76' : '#d7b493';
      ctx.save(); ctx.translate(e.x, e.y);
      if (boss) {
        ctx.strokeStyle = 'rgba(211,136,83,.27)'; ctx.lineWidth = 1;
        polygon(0, 0, size + 8, 6, -visualTime * .18); ctx.stroke();
      }
      ctx.fillStyle = boss ? '#442b22' : '#30281f'; ctx.strokeStyle = color; ctx.lineWidth = boss ? 2 : 1.3;
      polygon(0, 0, size, boss ? 6 : 4, boss ? visualTime * .12 : Math.PI / 4); ctx.fill(); ctx.stroke();
      if (boss) { ctx.fillStyle = '#ffc393'; polygon(0, 0, 5, 6, visualTime * .12); ctx.fill(); }
      if (e.hp < e.maxHp) {
        ctx.fillStyle = '#40362b'; ctx.fillRect(-size, -size - 8, size * 2, 2);
        ctx.fillStyle = color; ctx.fillRect(-size, -size - 8, size * 2 * Math.max(0, e.hp / e.maxHp), 2);
      }
      ctx.restore();
    }
    for (const p of run.projectiles || []) {
      ctx.strokeStyle = 'rgba(167,255,210,.51)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(Number.isFinite(p.px) ? p.px : p.x * .94, Number.isFinite(p.py) ? p.py : p.y * .94); ctx.lineTo(p.x, p.y); ctx.stroke();
      ctx.fillStyle = '#c6ffdf'; circle(p.x, p.y, 2.4); ctx.fill();
    }
    for (const e of run.effects || []) {
      const progress = Math.max(0, Math.min(1, (e.age || 0) / (e.life || .4)));
      ctx.globalAlpha = 1 - progress; ctx.strokeStyle = e.color || '#bef4bf'; ctx.lineWidth = 1;
      circle(e.x || 0, e.y || 0, 3 + progress * (e.type === 'death' ? 20 : 11)); ctx.stroke();
      ctx.globalAlpha = 1;
    }
    let nearest = null, distance = stats.range;
    for (const e of run.enemies || []) {
      const d = Math.hypot(e.x, e.y);
      if (d < distance) { distance = d; nearest = e; }
    }
    if (nearest && !run.paused && !background && currencyModal.hidden && resultModal.hidden) towerAngle = Math.atan2(nearest.y, nearest.x);
    ctx.strokeStyle = 'rgba(149,243,191,.2)'; ctx.lineWidth = 1; circle(0, 0, 30 + Math.sin(visualTime * 2) * 1.5); ctx.stroke();
    ctx.fillStyle = '#193b2d'; ctx.strokeStyle = '#9df4be'; ctx.lineWidth = 2;
    polygon(0, 0, 21, 6, Math.PI / 6); ctx.fill(); ctx.stroke();
    ctx.save(); ctx.rotate(towerAngle);
    ctx.fillStyle = '#112b22'; ctx.strokeStyle = '#bcffd2'; ctx.lineWidth = 1.4;
    ctx.fillRect(5, -4, 22, 8); ctx.strokeRect(5, -4, 22, 8); ctx.restore();
    ctx.fillStyle = '#baffd6'; polygon(0, 0, 7, 6, Math.PI / 6); ctx.fill();
    ctx.restore();
  }
  function frame(now) {
    const dt = lastTime ? Math.min(.08, (now - lastTime) / 1000) : 0;
    lastTime = now;
    if (!background && currencyModal.hidden && resultModal.hidden) {
      game.tick(dt);
      if (!game.state.run.paused && !game.state.run.over) visualTime += dt * (game.state.settings.speed || 1);
    }
    const events = game.events ? game.events.splice(0) : [];
    for (const e of events) {
      if (e.type === 'boss') announce('第 ' + game.state.run.wave + ' 波 · 首领接近', true);
      if (e.type === 'death') { showResult(); save(); }
    }
    if (game.state.run.over && resultModal.hidden) showResult();
    if (now - lastHud > 100) { refreshHud(); lastHud = now; }
    if (now - lastSave > 5000 && !background) { save(); lastSave = now; }
    draw(); requestAnimationFrame(frame);
  }
  for (const button of upgradeButtons) button.addEventListener('click', () => {
    if (game.purchase(button.dataset.upgrade)) { refreshHud(); save(); }
  });
  $('pause-button').addEventListener('click', () => { game.togglePause(); refreshHud(); save(); });
  $('speed-button').addEventListener('click', () => {
    const speeds = [1, 2, 4]; game.setSpeed(speeds[(speeds.indexOf(game.state.settings.speed) + 1) % speeds.length]); refreshHud(); save();
  });
  function openCurrency() {
    $('currency-input').value = String(Math.floor(game.state.coins)); $('currency-error').textContent = '';
    currencyModal.hidden = false;
  }
  function closeCurrency() { currencyModal.hidden = true; $('currency-input').blur(); lastTime = 0; }
  $('currency-open').addEventListener('click', openCurrency);
  $('currency-close').addEventListener('click', closeCurrency);
  currencyModal.addEventListener('click', (e) => { if (e.target === currencyModal) closeCurrency(); });
  for (const button of document.querySelectorAll('[data-add]')) button.addEventListener('click', () => {
    const val = Number($('currency-input').value);
    $('currency-input').value = String(Math.min(MAX_COINS, Math.max(0, Number.isFinite(val) ? Math.floor(val) : 0) + Number(button.dataset.add)));
    $('currency-error').textContent = '';
  });
  $('currency-apply').addEventListener('click', () => {
    const raw = $('currency-input').value.trim(); const val = Number(raw);
    if (!/^\d{1,12}$/.test(raw) || !Number.isSafeInteger(val) || val < 0 || val > MAX_COINS) {
      $('currency-error').textContent = '请输入 0 至 999,999,999,999 之间的整数'; return;
    }
    game.modifyCurrency({ coins: val }); save(); refreshHud(); closeCurrency(); toast('金币已保存');
  });
  $('currency-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('currency-apply').click(); });
  $('restart-button').addEventListener('click', () => {
    game.startRun(); resultModal.hidden = true; lastTime = 0; refreshHud(); save(); announce('防线重启 · 升级已保留');
  });
  window.gameApp = {
    onBackground() { background = true; save(); },
    onForeground() { background = false; lastTime = 0; },
    onBack() { if (!currencyModal.hidden) closeCurrency(); else if (!game.state.run.over) { if (!game.state.run.paused) game.togglePause(); refreshHud(); save(); } },
  };
  document.addEventListener('visibilitychange', () => { if (document.hidden) window.gameApp.onBackground(); else window.gameApp.onForeground(); });
  window.addEventListener('pagehide', save);
  window.addEventListener('resize', resize);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') window.gameApp.onBack(); });
  if (!game.state.run.active && !game.state.run.over) game.startRun();
  if (game.state.run.over) showResult();
  resize(); refreshHud(); announce(message); requestAnimationFrame(frame);
})();
