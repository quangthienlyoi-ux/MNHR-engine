/* ============================================================
   MNHR-engine — engine.js v7
   Bullet anim + Hitbox flip + Assets folder + Settings + FPS + BGM
   ============================================================ */
window.MNHR = (function () {
'use strict';

/* ============================================================
   MINI RUNTIME
   ============================================================ */
function MiniRuntime() {
  const VW = 640, VH = 360;
  const BASE_SPEED = 2.6, BASE_JUMP = 9.2, BASE_GRAVITY = 0.55;
  const clamp = (v, a, b) => v < a ? a : v > b ? b : v;

  function defaultUI() {
    return {
      mode: 'arrows',
      layout: {
        left:  { x: 42,        y: VH - 46, r: 26 },
        right: { x: 106,       y: VH - 46, r: 26 },
        fire:  { x: VW - 104,  y: VH - 46, r: 24 },
        jump:  { x: VW - 46,   y: VH - 46, r: 28 },
        joyBase: { x: 90, y: VH - 80, r: 56 },
        joyKnob: { x: 90, y: VH - 80, r: 24 }
      },
      buttons: [],
      mainMenu: {
        enabled: false, title: 'MNHR Game', subtitle: 'Nhấn để chơi',
        bg: '#0e1116', titleColor: '#ffb86b', subColor: '#a8b6cc'
      }
    };
  }

  /* ---------- HITBOXES (facing-aware) ---------- */
  function getHitboxes(it) {
    const facing = it._facing || 1;
    if (it.hitboxes && it.hitboxes.length) {
      const out = new Array(it.hitboxes.length);
      for (let i = 0; i < it.hitboxes.length; i++) {
        const h = it.hitboxes[i];
        const ox = facing === 1 ? h.ox : -h.ox;
        out[i] = { x: it.x + ox - h.w/2, y: it.y + h.oy - h.h/2, w: h.w, h: h.h };
      }
      return out;
    }
    // legacy single-hb
    if (it.kind === 'sprite' && it.hb) {
      const ox = facing === 1 ? it.hb.ox : -it.hb.ox;
      return [{
        x: it.x + ox - it.hb.hw,
        y: it.y + it.hb.oy - it.hb.hh,
        w: it.hb.hw * 2, h: it.hb.hh * 2
      }];
    }
    return [{ x: it.x - it.w/2, y: it.y - it.h/2, w: it.w, h: it.h }];
  }

  function getBounds(it) {
    const boxes = getHitboxes(it);
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const b of boxes) {
      if (b.x < minX) minX = b.x;
      if (b.y < minY) minY = b.y;
      if (b.x + b.w > maxX) maxX = b.x + b.w;
      if (b.y + b.h > maxY) maxY = b.y + b.h;
    }
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
  }

  function aabb(a, b) {
    return a.x < b.x + b.w && a.x + a.w > b.x &&
           a.y < b.y + b.h && a.y + a.h > b.y;
  }
  function anyHitboxOverlap(A, B) {
    for (let i = 0; i < A.length; i++) {
      const a = A[i];
      for (let j = 0; j < B.length; j++) if (aabb(a, B[j])) return { a, b: B[j] };
    }
    return null;
  }
  function deepestHitboxPair(A, B, axis, dirSign) {
    let best = null, bestDepth = 0;
    for (let i = 0; i < A.length; i++) {
      const a = A[i];
      for (let j = 0; j < B.length; j++) {
        const b = B[j];
        if (!aabb(a, b)) continue;
        let d;
        if (axis === 'x') d = dirSign > 0 ? (a.x + a.w) - b.x : (b.x + b.w) - a.x;
        else              d = dirSign > 0 ? (a.y + a.h) - b.y : (b.y + b.h) - a.y;
        if (d > bestDepth) { bestDepth = d; best = { a, b }; }
      }
    }
    return best ? { pair: best, depth: bestDepth } : null;
  }

  /* ---------- EVENTS ---------- */
  function ensureEventState(state, it) {
    if (!it._pendingActions) it._pendingActions = [];
    if (!it._everyTimers) it._everyTimers = {};
    if (!it._keyState) it._keyState = {};
    if (!it._idleFired) it._idleFired = {};
    if (!it._touchSet) it._touchSet = new Set();
  }
  function scheduleEventAction(it, ev) {
    if (!it._pendingActions) it._pendingActions = [];
    it._pendingActions.push({
      action: ev.action,
      actionParams: ev.actionParams || {},
      timeLeft: Math.max(0, ev.delay || 0)
    });
  }
  function fireEvent(state, it, triggerKey) {
    if (!it.events || !it.events.length) return;
    for (let i = 0; i < it.events.length; i++) {
      const ev = it.events[i];
      if (ev.trigger !== triggerKey) continue;
      const tp = ev.triggerParams || {};
      if (triggerKey === 'onNearPlayer') {
        const dist = tp.distance != null ? tp.distance : 100;
        let found = false;
        for (let j = 0; j < state.items.length; j++) {
          const o = state.items[j];
          if (o === it || o.kind !== 'sprite') continue;
          if (o.control !== 'player' || o._dead) continue;
          const dx = o.x - it.x, dy = o.y - it.y;
          if (Math.sqrt(dx*dx + dy*dy) <= dist) { found = true; break; }
        }
        if (!found) continue;
      }
      scheduleEventAction(it, ev);
    }
  }
  function updateTimedEvents(state, it, dt) {
    if (!it.events || !it.events.length) return;
    ensureEventState(state, it);
    for (let i = 0; i < it.events.length; i++) {
      const ev = it.events[i];
      const tp = ev.triggerParams || {};
      if (ev.trigger === 'onEvery') {
        const intv = Math.max(0.05, tp.interval != null ? tp.interval : 1);
        it._everyTimers[ev.id] = (it._everyTimers[ev.id] || 0) + dt;
        if (it._everyTimers[ev.id] >= intv) {
          it._everyTimers[ev.id] -= intv;
          scheduleEventAction(it, ev);
        }
      } else if (ev.trigger === 'onKeyPress') {
        const k = tp.key;
        const was = !!it._keyState[ev.id];
        const now = !!(k && state.keys[k]);
        if (now && !was) scheduleEventAction(it, ev);
        it._keyState[ev.id] = now;
      } else if (ev.trigger === 'onHpBelow') {
        const thr = (tp.percent != null ? tp.percent : 50) / 100 * it.maxHp;
        const prev = it._prevHp != null ? it._prevHp : it.hp;
        if (it.hp <= thr && prev > thr) scheduleEventAction(it, ev);
      } else if (ev.trigger === 'onIdle') {
        const secs = tp.seconds != null ? tp.seconds : 2;
        if (it._state === 'idle' && (it._idleTime || 0) >= secs) {
          if (!it._idleFired[ev.id]) { it._idleFired[ev.id] = true; scheduleEventAction(it, ev); }
        } else if (it._state !== 'idle') it._idleFired[ev.id] = false;
      }
    }
    it._prevHp = it.hp;
  }
  function updatePendingActions(state, it, dt) {
    if (!it._pendingActions || !it._pendingActions.length) return;
    for (let i = it._pendingActions.length - 1; i >= 0; i--) {
      const p = it._pendingActions[i];
      p.timeLeft -= dt;
      if (p.timeLeft <= 0) {
        executeAction(state, it, p.action, p.actionParams);
        it._pendingActions.splice(i, 1);
      }
    }
  }
  function executeAction(state, it, action, params) {
    params = params || {};
    switch (action) {
      case 'shakeScreen':
        state.shakeScreen = {
          intensity: Math.max(0, params.intensity != null ? params.intensity : 8),
          timeLeft: Math.max(0, params.duration != null ? params.duration : 0.5),
          duration: Math.max(0.001, params.duration != null ? params.duration : 0.5)
        };
        break;
      case 'changeHp': {
        const amt = params.amount != null ? params.amount : 0;
        if (amt < 0) damage(state, it, -amt);
        else it.hp = Math.min(it.maxHp, it.hp + amt);
        break;
      }
      case 'teleport': it.x += params.dx || 0; it.y += params.dy || 0; break;
      case 'setPos':
        if (params.x != null) it.x = params.x;
        if (params.y != null) it.y = params.y;
        break;
      case 'spawnBullet':
        if (it.shoot && it.shoot.enabled) spawnBullet(state, it, it._facing || 1);
        break;
      case 'setInvuln':
        it._invuln = Math.max(it._invuln || 0, params.seconds != null ? params.seconds : 1);
        break;
      case 'destroySelf': it._dead = true; break;
      case 'changeControl': it.control = params.mode || it.control; break;
      case 'showText':
        state.floatingTexts.push({
          x: it.x, y: it.y - it.h / 2,
          text: params.text != null ? String(params.text) : '!',
          color: params.color || '#ffd166',
          life: params.duration != null ? params.duration : 1.5,
          totalLife: params.duration != null ? params.duration : 1.5,
          vy: -40
        });
        break;
      case 'spawnParticles': {
        const cnt = Math.max(1, params.count != null ? params.count : 12);
        for (let i = 0; i < cnt; i++) {
          state.particles.push({
            x: it.x, y: it.y,
            vx: (Math.random() - 0.5) * 200,
            vy: (Math.random() - 0.5) * 200 - 40,
            life: params.life != null ? params.life : 0.8,
            totalLife: params.life != null ? params.life : 0.8,
            color: params.color || '#ffb86b',
            size: params.size != null ? params.size : 4
          });
        }
        break;
      }
      case 'flash':
        it._flash = {
          color: params.color || '#ffffff',
          timeLeft: params.duration != null ? params.duration : 0.3,
          duration: params.duration != null ? params.duration : 0.3
        };
        break;
      case 'playSound':
        try {
          const AC = window.AudioContext || window.webkitAudioContext;
          if (AC) {
            const audio = new AC();
            const osc = audio.createOscillator();
            const gain = audio.createGain();
            osc.type = params.wave || 'sine';
            osc.frequency.value = params.frequency != null ? params.frequency : 440;
            osc.connect(gain); gain.connect(audio.destination);
            const dur = params.duration != null ? params.duration : 0.2;
            gain.gain.setValueAtTime(0.12, audio.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + dur);
            osc.start();
            osc.stop(audio.currentTime + dur);
          }
        } catch (e) {}
        break;
      case 'setSpeed':
        it._speedBuff = { mult: params.multiplier != null ? params.multiplier : 2,
          timeLeft: params.duration != null ? params.duration : 3 };
        break;
      case 'setGravity':
        it._gravityBuff = { mult: params.multiplier != null ? params.multiplier : 0,
          timeLeft: params.duration != null ? params.duration : 3 };
        break;
      case 'setScale':
        it._scaleBuff = { mult: params.multiplier != null ? params.multiplier : 1.5,
          timeLeft: params.duration != null ? params.duration : 3 };
        break;
      case 'setCameraTarget':
        for (let i = 0; i < state.items.length; i++) {
          const o = state.items[i];
          if (o.kind === 'sprite') o.camera = (o === it);
        }
        break;
    }
  }
  function updateParticles(state, dt) {
    for (let i = state.particles.length - 1; i >= 0; i--) {
      const p = state.particles[i];
      p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 300 * dt;
      p.life -= dt;
      if (p.life <= 0) state.particles.splice(i, 1);
    }
  }
  function updateFloatingTexts(state, dt) {
    for (let i = state.floatingTexts.length - 1; i >= 0; i--) {
      const f = state.floatingTexts[i];
      f.y += f.vy * dt; f.life -= dt;
      if (f.life <= 0) state.floatingTexts.splice(i, 1);
    }
  }
  function updateShake(state, dt) {
    if (state.shakeScreen && state.shakeScreen.timeLeft > 0) {
      state.shakeScreen.timeLeft -= dt;
      if (state.shakeScreen.timeLeft < 0) state.shakeScreen.timeLeft = 0;
    }
  }
  function damage(state, it, amount) {
    if (it._invuln > 0 || it._dead) return;
    it.hp = Math.max(0, it.hp - amount);
    it._invuln = it.iframe;
    if (state) fireEvent(state, it, 'onHurt');
    if (it.hp <= 0) { it._dead = true; if (state) fireEvent(state, it, 'onDeath'); }
  }
  function resolveCollisions(state, it, axis) {
    const myBoxes = getHitboxes(it);
    for (let i = 0; i < state.items.length; i++) {
      const other = state.items[i];
      if (other === it || other.kind !== 'block') continue;
      const otherBoxes = getHitboxes(other);
      if (!anyHitboxOverlap(myBoxes, otherBoxes)) continue;
      if (other.hazard && it.hp > 0) damage(state, it, 10);
      if (!other.solid) continue;
      if (axis === 'x') {
        if (it._vx > 0) {
          const d = deepestHitboxPair(myBoxes, otherBoxes, 'x', 1);
          if (d) it.x -= d.depth;
          it._vx = 0;
        } else if (it._vx < 0) {
          const d = deepestHitboxPair(myBoxes, otherBoxes, 'x', -1);
          if (d) it.x += d.depth;
          it._vx = 0;
        }
      } else {
        if (it._vy > 0) {
          const d = deepestHitboxPair(myBoxes, otherBoxes, 'y', 1);
          if (d) it.y -= d.depth;
          it._vy = 0; it._onGround = true;
        } else if (it._vy < 0) {
          const d = deepestHitboxPair(myBoxes, otherBoxes, 'y', -1);
          if (d) it.y += d.depth;
          it._vy = 0;
        }
      }
    }
  }

  /* ---------- BULLETS ---------- */
  function spawnBullet(state, it, facing) {
    const s = it.shoot;
    if (!s || !s.enabled) return;
    const angle = (s.angle != null ? s.angle : 0) * Math.PI / 180;
    const speed = s.speed || 8;
    const vx = facing * Math.cos(angle) * speed;
    const vy = -Math.sin(angle) * speed;
    state.projectiles.push({
      x: it.x + (s.offsetX || 0) * facing,
      y: it.y + (s.offsetY || 0),
      vx, vy,
      w: s.bulletW || 14, h: s.bulletH || 14,
      damage: s.damage || 10,
      owner: it.id,
      img: s.img || null,
      animation: s.animation && s.animation.frames && s.animation.frames.length ? s.animation : null,
      _animFrame: 0, _animTime: 0,
      life: 5, facing, angle,
      useGravity: !!s.useGravity,
      bulletGravity: s.bulletGravity != null ? s.bulletGravity : 5
    });
  }
  function tryShoot(state, it) {
    if (!it.shoot || !it.shoot.enabled) return;
    if (it._shootCd > 0) return;
    it._shootCd = it.shoot.cooldown || 0.3;
    const delay = it.shoot.delay || 0;
    if (delay > 0) {
      if (!it._pendingShots) it._pendingShots = [];
      it._pendingShots.push({ t: delay, facing: it._facing });
    } else spawnBullet(state, it, it._facing);
    if (it.animations && it.animations.shoot && it.animations.shoot.frames.length)
      it._shootAnimTime = 0.3;
    fireEvent(state, it, 'onShoot');
  }
  function updatePendingShots(state, it, dt) {
    if (!it._pendingShots || !it._pendingShots.length) return;
    for (let i = it._pendingShots.length - 1; i >= 0; i--) {
      const p = it._pendingShots[i];
      p.t -= dt;
      if (p.t <= 0) { spawnBullet(state, it, p.facing); it._pendingShots.splice(i, 1); }
    }
  }
  function stepBulletAnim(p, dt) {
    if (!p.animation) return;
    const anim = p.animation;
    const fps = anim.fps || 8;
    p._animTime += dt;
    const fd = 1 / fps;
    while (p._animTime >= fd) {
      p._animTime -= fd;
      p._animFrame++;
      if (p._animFrame >= anim.frames.length) {
        if (anim.loop === false) { p._animFrame = anim.frames.length - 1; break; }
        p._animFrame = 0;
      }
    }
  }

  function updateBotAI(state, it, dt) {
    if (it._patrolOrigin === undefined) { it._patrolOrigin = it.x; it._patrolDir = 1; }
    const range = it.botRange != null ? it.botRange : 150;
    const pr = it.botPatrol != null ? it.botPatrol : 80;
    let target = null, minDist = Infinity;
    for (let i = 0; i < state.items.length; i++) {
      const o = state.items[i];
      if (o === it || o.kind !== 'sprite') continue;
      if (o.control !== 'player' || o._dead) continue;
      const dx = o.x - it.x, dy = o.y - it.y;
      const d = Math.sqrt(dx*dx + dy*dy);
      if (d < minDist) { minDist = d; target = o; }
    }
    if (target && minDist <= range) {
      it._facing = target.x > it.x ? 1 : -1;
      if (it.shoot && it.shoot.enabled) tryShoot(state, it);
      if (minDist > range * 0.65)      it._vx = it._facing * (BASE_SPEED * it.speed * 0.7);
      else if (minDist < 50)           it._vx = -it._facing * (BASE_SPEED * it.speed * 0.5);
      else                              it._vx = 0;
    } else {
      if (it.x > it._patrolOrigin + pr) it._patrolDir = -1;
      if (it.x < it._patrolOrigin - pr) it._patrolDir = 1;
      it._facing = it._patrolDir;
      it._vx = it._patrolDir * (BASE_SPEED * it.speed * 0.6);
    }
  }
  function stepAnimation(it, dt) {
    const anim = (it.animations && (it.animations[it._state] || it.animations.idle)) || null;
    if (!anim || !anim.frames || !anim.frames.length) { it._animFrame = 0; return; }
    const fps = anim.fps || 8;
    it._animTime = (it._animTime || 0) + dt;
    const fd = 1 / fps;
    while (it._animTime >= fd) {
      it._animTime -= fd;
      it._animFrame = (it._animFrame || 0) + 1;
      if (it._animFrame >= anim.frames.length) {
        if (anim.loop === false) { it._animFrame = anim.frames.length - 1; break; }
        it._animFrame = 0;
      }
    }
  }
  function currentFrameImage(it, stateKey) {
    if (!it.animations) return null;
    const anim = it.animations[stateKey || it._state] || it.animations.idle;
    if (!anim || !anim.frames || !anim.frames.length) return null;
    const idx = (it._animFrame || 0) % anim.frames.length;
    const f = anim.frames[idx];
    return f && f.img ? f.img : null;
  }

  function updateItem(state, it, dt, keys) {
    if (it._shootCd > 0) it._shootCd -= dt;
    if (it._shootAnimTime > 0) it._shootAnimTime -= dt;
    if (!it._startFired) { it._startFired = true; fireEvent(state, it, 'onStart'); }
    ensureEventState(state, it);
    updateTimedEvents(state, it, dt);
    updatePendingActions(state, it, dt);
    updatePendingShots(state, it, dt);

    if (it._flash) { it._flash.timeLeft -= dt; if (it._flash.timeLeft <= 0) it._flash = null; }
    if (it._speedBuff)   { it._speedBuff.timeLeft   -= dt; if (it._speedBuff.timeLeft   <= 0) it._speedBuff = null; }
    if (it._gravityBuff) { it._gravityBuff.timeLeft -= dt; if (it._gravityBuff.timeLeft <= 0) it._gravityBuff = null; }
    if (it._scaleBuff)   { it._scaleBuff.timeLeft   -= dt; if (it._scaleBuff.timeLeft   <= 0) it._scaleBuff = null; }

    if (it._dead) { it._vx = 0; it._vy = 0; stepAnimation(it, dt); return; }
    if (it._invuln > 0) { it._invuln -= dt; if (it._invuln < 0) it._invuln = 0; }

    const speedMult = it._speedBuff ? it._speedBuff.mult : 1;
    const gravMult = it._gravityBuff ? it._gravityBuff.mult : it.gravity;
    let moveX = 0, jump = false, fire = false;

    if (it.control === 'player') {
      if (keys['ArrowLeft']  || keys['a'] || keys['A']) moveX -= 1;
      if (keys['ArrowRight'] || keys['d'] || keys['D']) moveX += 1;
      if (keys['ArrowUp'] || keys['w'] || keys['W'] || keys[' ']) jump = true;
      if (keys['Fire'] || keys['x'] || keys['X'] || keys['f'] || keys['F']) fire = true;
      if (keys['_joy_active']) {
        const jx = keys['_joy_x'] || 0, jy = keys['_joy_y'] || 0;
        if (jx < -0.28) moveX = -1;
        else if (jx > 0.28) moveX = 1;
        else moveX = jx * 1.2;
        if (jy < -0.65 && it._onGround) jump = true;
      }
      if (fire) tryShoot(state, it);
      if (jump && it._onGround) { it._vy = -BASE_JUMP * it.jumpPower; it._onGround = false; fireEvent(state, it, 'onJump'); }
      if (moveX !== 0) it._facing = moveX > 0 ? 1 : -1;
      it._vx = moveX * BASE_SPEED * it.speed * speedMult;
    } else if (it.control === 'bot') {
      updateBotAI(state, it, dt);
    } else it._vx = 0;

    const wasOnGround = it._onGround;
    if (gravMult > 0) it._vy += BASE_GRAVITY * gravMult * dt * 60;
    else { it._vy *= 0.85; if (Math.abs(it._vy) < 0.02) it._vy = 0; }
    it._vy = clamp(it._vy, -30, 25);
    it.x += it._vx * dt * 60;
    resolveCollisions(state, it, 'x');
    it._onGround = false;
    it.y += it._vy * dt * 60;
    resolveCollisions(state, it, 'y');
    it.x = clamp(it.x, -5000, 5000);
    if (it.y > VH + 500) { it.y = -60; it._vy = 0; }
    if (!wasOnGround && it._onGround) fireEvent(state, it, 'onLand');

    let st = 'idle';
    if (it.hp <= 0) st = 'die';
    else if (it._shootAnimTime > 0 && it.animations.shoot && it.animations.shoot.frames.length) st = 'shoot';
    else if (it._invuln > 0 && it.animations.hurt && it.animations.hurt.frames.length) st = 'hurt';
    else if (!it._onGround) st = 'jump';
    else if (Math.abs(it._vx) > 0.15) st = 'run';

    if (it._prevState !== st) {
      it._animFrame = 0; it._animTime = 0;
      if (st === 'run' && it._prevState !== 'run') fireEvent(state, it, 'onRun');
      it._prevState = st;
    }
    it._state = st;
    if (st === 'idle') it._idleTime = (it._idleTime || 0) + dt;
    else it._idleTime = 0;

    if (it.events && it.events.length) {
      let near = false;
      for (let j = 0; j < state.items.length && !near; j++) {
        const o = state.items[j];
        if (o === it || o.kind !== 'sprite') continue;
        if (o.control !== 'player' || o._dead) continue;
        const dx = o.x - it.x, dy = o.y - it.y;
        if (Math.sqrt(dx*dx + dy*dy) <= 200) near = true;
      }
      if (near && !it._nearPlayer) fireEvent(state, it, 'onNearPlayer');
      it._nearPlayer = near;

      const curTouch = new Set();
      const myBoxes = getHitboxes(it);
      for (let j = 0; j < state.items.length; j++) {
        const o = state.items[j];
        if (o === it) continue;
        const oBoxes = getHitboxes(o);
        if (!anyHitboxOverlap(myBoxes, oBoxes)) continue;
        curTouch.add(o.id);
        if (!it._touchSet.has(o.id)) {
          fireEvent(state, it, o.kind === 'block' ? 'onHitBlock' : 'onHitSprite');
        }
      }
      it._touchSet = curTouch;
    }
    stepAnimation(it, dt);
  }

  function updateBlock(it, dt) {
    const anim = it.animations && it.animations.default;
    if (!anim || !anim.frames || !anim.frames.length) return;
    const fps = anim.fps || 8;
    it._animTime = (it._animTime || 0) + dt;
    const fd = 1 / fps;
    while (it._animTime >= fd) {
      it._animTime -= fd;
      it._animFrame = (it._animFrame || 0) + 1;
      if (it._animFrame >= anim.frames.length) {
        if (anim.loop === false) { it._animFrame = anim.frames.length - 1; break; }
        it._animFrame = 0;
      }
    }
  }

  function updateProjectiles(state, dt) {
    for (let i = state.projectiles.length - 1; i >= 0; i--) {
      const p = state.projectiles[i];
      if (p.useGravity) p.vy += BASE_GRAVITY * p.bulletGravity * dt * 60 * 0.5;
      p.x += p.vx * dt * 60;
      p.y += p.vy * dt * 60;
      p.life -= dt;
      stepBulletAnim(p, dt);
      if (p.life <= 0 || p.x < -600 || p.x > VW + 600 || p.y > VH + 600 || p.y < -800) {
        state.projectiles.splice(i, 1); continue;
      }
      const pb = { x: p.x - p.w/2, y: p.y - p.h/2, w: p.w, h: p.h };
      let hit = false;
      for (let j = 0; j < state.items.length; j++) {
        const other = state.items[j];
        if (other.kind === 'block') {
          const boxes = getHitboxes(other);
          for (let k = 0; k < boxes.length; k++) if (aabb(pb, boxes[k])) { hit = true; break; }
        } else if (other.kind === 'sprite' && other.id !== p.owner && !other._dead) {
          const boxes = getHitboxes(other);
          for (let k = 0; k < boxes.length; k++) {
            if (aabb(pb, boxes[k])) { damage(state, other, p.damage); hit = true; break; }
          }
        }
        if (hit) break;
      }
      if (hit) state.projectiles.splice(i, 1);
    }
  }
  function updateCamera(state, dt) {
    let target = null;
    for (let i = 0; i < state.items.length; i++) {
      const it = state.items[i];
      if (it.kind === 'sprite' && it.camera && !it._dead) { target = it; break; }
    }
    const tx = target ? target.x : VW / 2;
    const ty = target ? target.y : VH / 2;
    const k = 1 - Math.pow(0.001, dt);
    state.camera.x += (tx - state.camera.x) * Math.min(1, k * 1.6);
    state.camera.y += (ty - state.camera.y) * Math.min(1, k * 1.6);
  }

  /* ---------- DRAW ---------- */
  function drawGrid(ctx, cx, cy) {
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,.045)'; ctx.lineWidth = 1;
    const sX = Math.floor((cx - VW/2) / 40) * 40;
    const eX = Math.ceil((cx + VW/2) / 40) * 40;
    const sY = Math.floor((cy - VH/2) / 40) * 40;
    const eY = Math.ceil((cy + VH/2) / 40) * 40;
    for (let x = sX; x <= eX; x += 40) { ctx.beginPath(); ctx.moveTo(x, sY); ctx.lineTo(x, eY); ctx.stroke(); }
    for (let y = sY; y <= eY; y += 40) { ctx.beginPath(); ctx.moveTo(sX, y); ctx.lineTo(eX, y); ctx.stroke(); }
    ctx.restore();
  }
  function drawSprite(ctx, it) {
    const flicker = it._invuln > 0 && Math.floor(it._invuln * 14) % 2 === 0;
    ctx.save();
    if (flicker) ctx.globalAlpha = 0.35;
    const img = currentFrameImage(it);
    const sc = it._scaleBuff ? it._scaleBuff.mult : 1;
    const dw = it.w * sc, dh = it.h * sc;
    if (img) {
      ctx.translate(it.x, it.y);
      ctx.scale(it._facing, 1);
      ctx.drawImage(img, -dw / 2, -dh / 2, dw, dh);
    } else {
      ctx.fillStyle = it._dead ? '#5c2130' : (it.control === 'bot' ? '#ff5a6e' : '#7c5cff');
      ctx.fillRect(it.x - dw / 2, it.y - dh / 2, dw, dh);
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 10px system-ui, sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText((it.name || '').slice(0, 9), it.x, it.y);
    }
    if (it._flash) {
      const a = Math.min(1, it._flash.timeLeft / Math.max(0.001, it._flash.duration));
      ctx.globalAlpha = a;
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = it._flash.color;
      ctx.fillRect(it.x - dw / 2, it.y - dh / 2, dw, dh);
      ctx.globalCompositeOperation = 'source-over';
    }
    ctx.restore();
  }
  function drawHPBar(ctx, it) {
    const w = 52, h = 6;
    const x = it.x - w/2, y = it.y - it.h/2 - 14;
    const pct = Math.max(0, Math.min(1, it.hp / it.maxHp));
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,.72)'; ctx.fillRect(x - 2, y - 2, w + 4, h + 4);
    ctx.fillStyle = '#2a1420'; ctx.fillRect(x, y, w, h);
    ctx.fillStyle = pct > 0.5 ? '#3ddc84' : pct > 0.25 ? '#ffb86b' : '#ff5a6e';
    ctx.fillRect(x, y, w * pct, h);
    ctx.strokeStyle = 'rgba(255,255,255,.35)'; ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    ctx.restore();
  }
  function drawBlock(ctx, it, editor) {
    const anim = it.animations && it.animations.default;
    if (anim && anim.frames && anim.frames.length) {
      const idx = (it._animFrame || 0) % anim.frames.length;
      const f = anim.frames[idx];
      if (f && f.img) {
        ctx.drawImage(f.img, it.x - it.w/2, it.y - it.h/2, it.w, it.h);
        if (editor) drawBlockEditorOverlay(ctx, it);
        return;
      }
    }
    const hasTex = it.tex && (it.tex.all || it.tex.top || it.tex.bottom || it.tex.left || it.tex.right);
    if (hasTex) {
      ctx.save();
      ctx.beginPath(); ctx.rect(it.x - it.w/2, it.y - it.h/2, it.w, it.h); ctx.clip();
      if (it.tex.all && it.tex.all.img) {
        ctx.drawImage(it.tex.all.img, it.x - it.w/2, it.y - it.h/2, it.w, it.h);
      } else {
        const x0 = it.x - it.w/2, y0 = it.y - it.h/2;
        const parts = [
          ['top', x0, y0, it.w, it.h/2],
          ['bottom', x0, y0 + it.h/2, it.w, it.h/2],
          ['left', x0, y0, it.w/2, it.h],
          ['right', x0 + it.w/2, y0, it.w/2, it.h]
        ];
        for (const [k, x, y, w, h] of parts) {
          const t = it.tex[k];
          if (t && t.img) ctx.drawImage(t.img, x, y, w, h);
          else { ctx.fillStyle = 'rgba(40,46,60,.85)'; ctx.fillRect(x, y, w, h); }
        }
      }
      ctx.restore();
    } else if (editor) {
      ctx.save();
      ctx.setLineDash([6, 4]); ctx.lineWidth = 1.5;
      ctx.strokeStyle = it.hazard ? 'rgba(255,90,110,.75)' : 'rgba(124,92,255,.55)';
      ctx.fillStyle = it.hazard ? 'rgba(255,90,110,.06)' : 'rgba(124,92,255,.06)';
      ctx.fillRect(it.x - it.w/2, it.y - it.h/2, it.w, it.h);
      ctx.strokeRect(it.x - it.w/2, it.y - it.h/2, it.w, it.h);
      ctx.restore();
    }
    if (editor) drawBlockEditorOverlay(ctx, it);
  }
  function drawBlockEditorOverlay(ctx, it) {
    ctx.save();
    ctx.strokeStyle = it.hazard ? 'rgba(255,90,110,.9)' : 'rgba(124,92,255,.75)';
    ctx.lineWidth = 1.5; ctx.setLineDash([]);
    ctx.strokeRect(it.x - it.w/2, it.y - it.h/2, it.w, it.h);
    ctx.restore();
  }
  function drawProjectile(ctx, p) {
    ctx.save();
    let img = p.img;
    if (p.animation && p.animation.frames && p.animation.frames.length) {
      const idx = (p._animFrame || 0) % p.animation.frames.length;
      const f = p.animation.frames[idx];
      if (f && f.img) img = f.img;
    }
    if (img) {
      ctx.translate(p.x, p.y);
      // rotate bullet to match travel direction if it's a directional sprite
      if (p.angle && Math.abs(p.angle) > 0.1) {
        ctx.rotate(p.facing < 0 ? -p.angle : p.angle);
      }
      if (p.facing < 0) ctx.scale(-1, 1);
      ctx.drawImage(img, -p.w/2, -p.h/2, p.w, p.h);
    } else {
      ctx.fillStyle = '#ffb86b';
      ctx.shadowColor = '#ffb86b'; ctx.shadowBlur = 8;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.w/2, 0, Math.PI*2); ctx.fill();
    }
    ctx.restore();
  }
  function drawParticle(ctx, p) {
    const a = Math.max(0, p.life / Math.max(0.001, p.totalLife));
    ctx.save();
    ctx.globalAlpha = a;
    ctx.fillStyle = p.color;
    ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }
  function drawFloatingText(ctx, f) {
    const a = Math.max(0, f.life / Math.max(0.001, f.totalLife));
    ctx.save();
    ctx.globalAlpha = a;
    ctx.fillStyle = 'rgba(0,0,0,.6)';
    ctx.font = 'bold 16px system-ui, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(f.text, f.x + 1, f.y + 1);
    ctx.fillStyle = f.color;
    ctx.fillText(f.text, f.x, f.y);
    ctx.restore();
  }
  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
  function drawCircleBtn(ctx, b, label, active, color) {
    if (!b) return;
    ctx.save();
    ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, Math.PI*2);
    ctx.fillStyle = active ? color + 'cc' : 'rgba(255,255,255,.12)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,.28)'; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.fillStyle = '#e6e9ef';
    ctx.font = 'bold 18px system-ui, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(label, b.x, b.y + 1);
    ctx.restore();
  }
  function drawUI(ctx, state) {
    const ui = state.ui || defaultUI();
    if (ui.mainMenu && ui.mainMenu.enabled && state.showMenu) {
      ctx.save();
      ctx.fillStyle = ui.mainMenu.bg || '#0e1116';
      ctx.fillRect(0, 0, VW, VH);
      ctx.fillStyle = ui.mainMenu.titleColor || '#ffb86b';
      ctx.font = 'bold 44px system-ui, -apple-system, sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(ui.mainMenu.title || 'Game', VW/2, VH/2 - 24);
      ctx.fillStyle = ui.mainMenu.subColor || '#a8b6cc';
      ctx.font = '16px system-ui, sans-serif';
      ctx.fillText(ui.mainMenu.subtitle || 'Nhấn để bắt đầu', VW/2, VH/2 + 28);
      ctx.restore();
      return;
    }
    if (!state.playing) return;
    const L = ui.layout;
    if (ui.mode === 'joystick') {
      ctx.save();
      ctx.beginPath();
      ctx.arc(L.joyBase.x, L.joyBase.y, L.joyBase.r, 0, Math.PI*2);
      ctx.fillStyle = 'rgba(255,255,255,.08)'; ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,.28)'; ctx.lineWidth = 2; ctx.stroke();
      const jx = state.keys['_joy_x'] || 0, jy = state.keys['_joy_y'] || 0;
      const kx = L.joyBase.x + jx * (L.joyBase.r - L.joyKnob.r);
      const ky = L.joyBase.y + jy * (L.joyBase.r - L.joyKnob.r);
      ctx.beginPath(); ctx.arc(kx, ky, L.joyKnob.r, 0, Math.PI*2);
      ctx.fillStyle = state.keys['_joy_active'] ? 'rgba(124,92,255,.85)' : 'rgba(124,92,255,.55)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,.35)'; ctx.lineWidth = 1.5; ctx.stroke();
      ctx.restore();
      drawCircleBtn(ctx, L.jump, '▲', state.keys[' '], '#7c5cff');
      drawCircleBtn(ctx, L.fire, '🔥', state.keys['Fire'], '#ff7b5a');
    } else {
      drawCircleBtn(ctx, L.left,  '◀', state.keys['ArrowLeft'],  '#7c5cff');
      drawCircleBtn(ctx, L.right, '▶', state.keys['ArrowRight'], '#7c5cff');
      drawCircleBtn(ctx, L.fire,  '🔥', state.keys['Fire'],       '#ff7b5a');
      drawCircleBtn(ctx, L.jump,  '▲', state.keys[' '],           '#3ddc84');
    }
    if (ui.buttons && ui.buttons.length) {
      for (const b of ui.buttons) {
        const active = state.keys[b.key];
        ctx.save();
        const w = b.w || 70, h = b.h || 40;
        roundRect(ctx, b.x - w/2, b.y - h/2, w, h, 10);
        ctx.fillStyle = active ? 'rgba(124,92,255,.75)' : 'rgba(255,255,255,.14)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,.3)'; ctx.lineWidth = 1.5; ctx.stroke();
        ctx.fillStyle = '#e6e9ef';
        ctx.font = 'bold 13px system-ui, sans-serif';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(b.label || b.key, b.x, b.y + 1);
        ctx.restore();
      }
    }
  }
  function hitUIButton(p, ui) {
    ui = ui || defaultUI();
    if (ui.mainMenu && ui.mainMenu.enabled) return '__menu__';
    const L = ui.layout;
    const test = (b, key) => {
      if (!b) return null;
      const dx = p.x - b.x, dy = p.y - b.y;
      return (dx*dx + dy*dy <= b.r*b.r) ? key : null;
    };
    if (ui.mode === 'joystick') {
      let k;
      if ((k = test(L.jump, ' '))) return k;
      if ((k = test(L.fire, 'Fire'))) return k;
      const dx = p.x - L.joyBase.x, dy = p.y - L.joyBase.y;
      if (dx*dx + dy*dy <= L.joyBase.r * L.joyBase.r) return '__joy__';
    } else {
      let k;
      if ((k = test(L.left, 'ArrowLeft'))) return k;
      if ((k = test(L.right, 'ArrowRight'))) return k;
      if ((k = test(L.jump, ' '))) return k;
      if ((k = test(L.fire, 'Fire'))) return k;
    }
    if (ui.buttons) {
      for (const b of ui.buttons) {
        const w = b.w || 70, h = b.h || 40;
        if (p.x >= b.x - w/2 && p.x <= b.x + w/2 && p.y >= b.y - h/2 && p.y <= b.y + h/2) return b.key;
      }
    }
    return null;
  }

  function render(ctx, state, opts) {
    opts = opts || {};
    const editor = !!opts.editor;
    const cam = (editor && state.editCam) ? state.editCam : (state.camera || { x: VW/2, y: VH/2 });

    ctx.clearRect(0, 0, VW, VH);
    ctx.fillStyle = '#0e1116';
    ctx.fillRect(0, 0, VW, VH);

    ctx.save();
    const shake = state.shakeScreen;
    if (!editor && shake && shake.timeLeft > 0) {
      const k = shake.timeLeft / Math.max(0.001, shake.duration);
      ctx.translate((Math.random()-0.5)*2*shake.intensity*k, (Math.random()-0.5)*2*shake.intensity*k);
    }
    ctx.translate(VW/2 - cam.x, VH/2 - cam.y);
    if (editor) drawGrid(ctx, cam.x, cam.y);

    for (const it of state.items) if (it.kind === 'block') drawBlock(ctx, it, editor);
    for (const it of state.items) {
      if (it.kind === 'sprite') {
        drawSprite(ctx, it);
        if (it.hpMode === 'bar' && !it._dead) drawHPBar(ctx, it);
      }
    }
    for (const p of state.projectiles) drawProjectile(ctx, p);
    if (!editor && state.particles) for (const p of state.particles) drawParticle(ctx, p);
    if (!editor && state.floatingTexts) for (const f of state.floatingTexts) drawFloatingText(ctx, f);

    if (editor && state.selectedId) {
      const sel = state.items.find(i => i.id === state.selectedId);
      if (sel) {
        const b = getBounds(sel);
        ctx.save();
        ctx.strokeStyle = '#7c5cff'; ctx.lineWidth = 1.5;
        ctx.setLineDash([5, 4]);
        ctx.strokeRect(b.x - 4, b.y - 4, b.w + 8, b.h + 8);
        if (sel.hitboxes && sel.hitboxes.length) {
          const boxes = getHitboxes(sel);
          ctx.strokeStyle = 'rgba(61,220,132,.95)';
          ctx.fillStyle = 'rgba(61,220,132,.12)';
          ctx.setLineDash([]); ctx.lineWidth = 1.5;
          for (const hb of boxes) {
            ctx.fillRect(hb.x, hb.y, hb.w, hb.h);
            ctx.strokeRect(hb.x, hb.y, hb.w, hb.h);
          }
        } else if (sel.kind === 'sprite') {
          ctx.strokeStyle = 'rgba(61,220,132,.95)';
          ctx.setLineDash([]); ctx.lineWidth = 1.5;
          ctx.strokeRect(b.x, b.y, b.w, b.h);
        }
        if (sel.kind === 'sprite' && sel.camera) {
          ctx.fillStyle = 'rgba(255,200,80,.9)';
          ctx.font = 'bold 12px system-ui, sans-serif';
          ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          ctx.fillText('📷', sel.x, sel.y - sel.h/2 - 24);
        }
        if (sel.kind === 'sprite' && sel.control === 'bot') {
          const r = sel.botRange != null ? sel.botRange : 150;
          ctx.strokeStyle = 'rgba(255,90,110,.4)';
          ctx.setLineDash([4, 6]);
          ctx.beginPath(); ctx.arc(sel.x, sel.y, r, 0, Math.PI*2); ctx.stroke();
        }
        if (sel.kind === 'sprite' && sel.shoot && sel.shoot.enabled) {
          // draw bullet angle vector
          const ang = (sel.shoot.angle || 0) * Math.PI / 180;
          const f = sel._facing || 1;
          const bx = sel.x + (sel.shoot.offsetX || 0) * f;
          const by = sel.y + (sel.shoot.offsetY || 0);
          ctx.fillStyle = '#ffb86b';
          ctx.beginPath();
          ctx.arc(bx, by, 4, 0, Math.PI*2); ctx.fill();
          ctx.strokeStyle = 'rgba(255,184,107,.85)';
          ctx.setLineDash([3, 3]); ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(bx, by);
          ctx.lineTo(bx + Math.cos(ang) * 60 * f, by - Math.sin(ang) * 60);
          ctx.stroke();
        }
        if (sel.kind === 'sprite' && sel.events && sel.events.length) {
          ctx.fillStyle = 'rgba(255,184,107,.9)';
          ctx.font = 'bold 11px system-ui, sans-serif';
          ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          ctx.fillText('🧩' + sel.events.length, sel.x, sel.y - sel.h/2 - 40);
        }
        ctx.restore();
      }
    }
    ctx.restore();
    if (!editor || opts.forceUIDraw) drawUI(ctx, state);
  }

  return {
    VW, VH, BASE_SPEED, BASE_JUMP, BASE_GRAVITY, defaultUI,
    getBounds, getHitboxes, aabb, damage,
    resolveCollisions, updateItem, updateBlock,
    updateProjectiles, updateCamera,
    updateParticles, updateFloatingTexts, updateShake,
    render, drawUI, hitUIButton, spawnBullet, tryShoot,
    fireEvent, executeAction
  };
}

/* ============================================================
   PROJECTS (localStorage + settings persist)
   ============================================================ */
const Projects = (function () {
  const KEY = 'mnhr_projects_v2';
  const SKEY = 'mnhr_settings_v1';
  let cache = null, settingsCache = null;
  const load = () => {
    if (cache) return cache;
    try { cache = JSON.parse(localStorage.getItem(KEY) || ''); } catch (e) { cache = null; }
    if (!cache || !cache.projects) cache = { projects: [], currentId: null };
    return cache;
  };
  const persist = () => {
    try { localStorage.setItem(KEY, JSON.stringify(load())); return true; }
    catch (e) { console.warn('save fail', e); return false; }
  };
  const loadSettings = () => {
    if (settingsCache) return settingsCache;
    try { settingsCache = JSON.parse(localStorage.getItem(SKEY) || ''); } catch (e) { settingsCache = null; }
    if (!settingsCache) settingsCache = { theme: 'dark', showFps: true, maxFps: 60, autoSave: true };
    return settingsCache;
  };
  const persistSettings = () => {
    try { localStorage.setItem(SKEY, JSON.stringify(loadSettings())); return true; }
    catch (e) { return false; }
  };
  function emptyScene() {
    const VW = 640, VH = 360;
    return {
      vw: VW, vh: VH,
      ui: MiniRuntime().defaultUI(),
      bgMusic: { url: null, volume: 0.6, loop: true },
      items: [{
        kind: 'block', id: 'ground', name: 'Mặt đất',
        x: VW/2, y: VH - 16, w: VW, h: 32,
        solid: true, hazard: false,
        tex: { all: null, top: null, bottom: null, left: null, right: null },
        hitboxes: [],
        animations: { default: { frames: [], fps: 8, loop: true } }
      }]
    };
  }
  return {
    list: () => load().projects,
    get: (id) => load().projects.find(p => p.id === id),
    currentId: () => load().currentId,
    setCurrent: (id) => { load().currentId = id; persist(); },
    create: (name) => {
      const id = 'p' + Date.now() + Math.random().toString(36).slice(2, 6);
      const proj = { id, name: name || 'Dự án mới', updatedAt: Date.now(), data: emptyScene() };
      load().projects.unshift(proj);
      load().currentId = id;
      persist();
      return proj;
    },
    save: (id, data) => {
      const p = load().projects.find(x => x.id === id);
      if (!p) return false;
      p.data = data;
      p.updatedAt = Date.now();
      return persist();
    },
    remove: (id) => {
      const store = load();
      store.projects = store.projects.filter(p => p.id !== id);
      if (store.currentId === id) store.currentId = store.projects[0] ? store.projects[0].id : null;
      persist();
    },
    getSettings: loadSettings,
    saveSettings: () => persistSettings(),
    emptyScene
  };
})();

/* ============================================================
   EDITOR
   ============================================================ */
const RT = MiniRuntime();
const VW = RT.VW, VH = RT.VH;
const uid = () => 'x' + Math.random().toString(36).slice(2, 9);
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;

let canvas, ctx, imgCache, audioCache;
let saveTimer = null;
let bgAudioEl = null;

const State = {
  items: [], selectedId: null, playing: false,
  keys: {}, time: 0,
  drag: null, panMode: false, panStart: null,
  pointerToBtn: new Map(),
  joystick: { active: false, pointerId: null },
  camera: { x: VW/2, y: VH/2 },
  editCam: { x: VW/2, y: VH/2 },
  projectiles: [], particles: [], floatingTexts: [],
  shakeScreen: { intensity: 0, timeLeft: 0, duration: 0.001 },
  currentProjectId: null,
  tab: 'scene',
  ui: RT.defaultUI(),
  uiSelected: null, uiDrag: null,
  showMenu: false, fullscreen: false,
  bgMusic: { url: null, volume: 0.6, loop: true },
  settings: { theme: 'dark', showFps: true, maxFps: 60, autoSave: true },
  fps: 0, _fpsAcc: 0, _fpsFrames: 0
};

function toast(msg, kind, ms) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'show ' + (kind || '');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { t.className = ''; }, ms || 2200);
}

function applyTheme() {
  document.body.classList.toggle('light', State.settings.theme === 'light');
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', State.settings.theme === 'light' ? '#eef1f6' : '#0b0d12');
}

/* ---------- FILE PICKING ---------- */
function pickFiles(opts) {
  opts = opts || {};
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = opts.accept || 'image/*';
    input.multiple = !!opts.multiple;
    input.style.cssText = 'position:fixed;left:-10000px;top:0;';
    document.body.appendChild(input);
    let settled = false;
    const finish = (files) => {
      if (settled) return;
      settled = true;
      try { document.body.removeChild(input); } catch (_) {}
      resolve(files || []);
    };
    input.addEventListener('change', () => finish(Array.from(input.files || [])));
    const onFocus = () => setTimeout(() => {
      window.removeEventListener('focus', onFocus);
      if (!settled) finish([]);
    }, 400);
    window.addEventListener('focus', onFocus);
    input.click();
  });
}
function readAsDataURL(file) {
  return new Promise((resolve) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => resolve(null);
    r.readAsDataURL(file);
  });
}
function readAsText(file) {
  return new Promise((resolve) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => resolve(null);
    r.readAsText(file);
  });
}
function loadImage(url) {
  return new Promise((resolve) => {
    if (!url) return resolve(null);
    const img = document.createElement('img');
    img.style.cssText = 'position:absolute;width:1px;height:1px;';
    imgCache.appendChild(img);
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

/* ---------- IMPORT HELPERS ---------- */
async function importBlockTexture(item, key) {
  const files = await pickFiles({ accept: 'image/*' });
  if (!files.length) return;
  const url = await readAsDataURL(files[0]);
  const img = await loadImage(url);
  if (!img) { toast('Không tải được ảnh', 'err'); return; }
  item.tex[key] = { url, img };
  renderInspector(); renderLayers(); scheduleSave();
  toast('Đã import texture', 'ok');
}
async function importShootImage(item) {
  const files = await pickFiles({ accept: 'image/*' });
  if (!files.length) return;
  const url = await readAsDataURL(files[0]);
  const img = await loadImage(url);
  if (!img) { toast('Không tải được ảnh', 'err'); return; }
  item.shoot.url = url; item.shoot.img = img;
  renderInspector(); scheduleSave();
  toast('Đã import ảnh đạn', 'ok');
}
async function importAnimFrames(ctx2) {
  const files = await pickFiles({ accept: 'image/*' });
  if (!files.length) return;
  const anim = resolveAnimRef(ctx2);
  if (!anim) { toast('Animation không tồn tại', 'err'); return; }
  const url = await readAsDataURL(files[0]);
  if (!url) { toast('Không đọc được file', 'err'); return; }
  const img = await loadImage(url);
  if (!img) { toast('Không tải được ảnh', 'err'); return; }
  anim.frames.push({ url, img });
  renderAnimFrames(); renderInspector(); renderLayers(); scheduleSave();
  toast('Đã thêm 1 frame', 'ok');
}
let sheetCtx = { file: null, url: null, img: null };
async function importSpritesheetFile() {
  const files = await pickFiles({ accept: 'image/*' });
  if (!files.length) return;
  const url = await readAsDataURL(files[0]);
  const img = await loadImage(url);
  if (!img) { toast('Không tải được ảnh', 'err'); return; }
  sheetCtx = { file: files[0], url, img };
  document.getElementById('sheetPanel').style.display = 'block';
  const preview = document.getElementById('sheetPreview');
  preview.innerHTML = '';
  const pi = document.createElement('img');
  pi.src = url; preview.appendChild(pi);
  document.getElementById('sheetW').value = img.naturalWidth;
  document.getElementById('sheetH').value = img.naturalHeight;
  document.getElementById('sheetX').value = 0;
  document.getElementById('sheetY').value = 0;
  document.getElementById('sheetPad').value = 0;
  document.getElementById('sheetMax').value = 0;
}
async function doSliceSheet() {
  if (!sheetCtx.img || !animCtx) { toast('Chưa chọn ảnh', 'err'); return; }
  const fw = Math.max(1, parseInt(document.getElementById('sheetW').value, 10) || 64);
  const fh = Math.max(1, parseInt(document.getElementById('sheetH').value, 10) || 64);
  const ox = parseInt(document.getElementById('sheetX').value, 10) || 0;
  const oy = parseInt(document.getElementById('sheetY').value, 10) || 0;
  const pad = parseInt(document.getElementById('sheetPad').value, 10) || 0;
  const maxFrames = parseInt(document.getElementById('sheetMax').value, 10) || 0;
  const anim = resolveAnimRef(animCtx);
  if (!anim) return;
  const img = sheetCtx.img;
  const cols = Math.floor((img.naturalWidth  - ox + pad) / (fw + pad));
  const rows = Math.floor((img.naturalHeight - oy + pad) / (fh + pad));
  let made = 0;
  outer:
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      if (maxFrames > 0 && made >= maxFrames) break outer;
      const sx = ox + x * (fw + pad);
      const sy = oy + y * (fh + pad);
      const c = document.createElement('canvas');
      c.width = fw; c.height = fh;
      c.getContext('2d').drawImage(img, sx, sy, fw, fh, 0, 0, fw, fh);
      const furl = c.toDataURL('image/png');
      const fimg = await loadImage(furl);
      if (fimg) { anim.frames.push({ url: furl, img: fimg }); made++; }
    }
  }
  renderAnimFrames(); renderInspector(); renderLayers(); scheduleSave();
  toast('Đã cắt ' + made + ' frames', 'ok');
  document.getElementById('sheetPanel').style.display = 'none';
  sheetCtx = { file: null, url: null, img: null };
}

/* ---------- HITBOX EDITOR ---------- */
const hitboxState = {
  itemId: null, W: 0, H: 0, img: null,
  boxes: [], scale: 1,
  drawing: false, drawStart: null, drawPreview: null
};
let hitboxCanvas, hitboxCtx2;

function collectAllFrames(item) {
  const imgs = [];
  if (item.kind === 'sprite') {
    for (const k in item.animations) {
      const a = item.animations[k];
      if (!a || !a.frames) continue;
      for (const f of a.frames) if (f.img) imgs.push(f.img);
    }
    if (item.shoot && item.shoot.animation && item.shoot.animation.frames) {
      for (const f of item.shoot.animation.frames) if (f.img) imgs.push(f.img);
    }
  } else if (item.kind === 'block') {
    const a = item.animations && item.animations.default;
    if (a && a.frames) for (const f of a.frames) if (f.img) imgs.push(f.img);
    if (item.tex) for (const k in item.tex) if (item.tex[k] && item.tex[k].img) imgs.push(item.tex[k].img);
  }
  return imgs;
}
function openHitboxModal(item) {
  hitboxState.itemId = item.id;
  hitboxState.W = item.w;
  hitboxState.H = item.h;
  hitboxState.img = pickPreviewImage(item);
  hitboxState.drawing = false;
  hitboxState.drawStart = null;
  hitboxState.drawPreview = null;
  if (item.hitboxes && item.hitboxes.length) {
    hitboxState.boxes = item.hitboxes.map(h => ({
      x: h.ox + item.w/2 - h.w/2,
      y: h.oy + item.h/2 - h.h/2,
      w: h.w, h: h.h
    }));
  } else if (item.kind === 'sprite' && item.hb) {
    hitboxState.boxes = [{
      x: item.w/2 + item.hb.ox - item.hb.hw,
      y: item.h/2 + item.hb.oy - item.hb.hh,
      w: item.hb.hw * 2, h: item.hb.hh * 2
    }];
  } else {
    hitboxState.boxes = [{ x: 0, y: 0, w: item.w, h: item.h }];
  }
  document.getElementById('hitboxTitle').textContent = '🎯 Hitbox: ' + (item.name || '');
  document.getElementById('hitboxModal').classList.add('show');
  document.getElementById('hitboxAllFrames').checked = true;
  hitboxCanvas = document.getElementById('hitboxCanvas');
  hitboxCtx2 = hitboxCanvas.getContext('2d');
  const maxW = Math.min(640, window.innerWidth - 100);
  const maxH = Math.min(340, window.innerHeight - 340);
  const s = Math.max(1, Math.min(maxW / item.w, maxH / item.h, 12));
  hitboxState.scale = s;
  hitboxCanvas.width = item.w;
  hitboxCanvas.height = item.h;
  hitboxCanvas.style.width  = Math.round(item.w * s) + 'px';
  hitboxCanvas.style.height = Math.round(item.h * s) + 'px';
  hitboxCanvas.style.imageRendering = s >= 4 ? 'pixelated' : 'auto';
  redrawHitboxCanvas();
  renderHitboxList();
  updateHitboxInfo();
}
function pickPreviewImage(item) {
  if (item.kind === 'sprite') {
    const anim = item.animations.idle;
    if (anim && anim.frames.length && anim.frames[0].img) return anim.frames[0].img;
    for (const k in item.animations) {
      const a = item.animations[k];
      if (a && a.frames.length && a.frames[0].img) return a.frames[0].img;
    }
  } else if (item.kind === 'block') {
    const anim = item.animations && item.animations.default;
    if (anim && anim.frames.length && anim.frames[0].img) return anim.frames[0].img;
    if (item.tex.all && item.tex.all.img) return item.tex.all.img;
    if (item.tex.top && item.tex.top.img) return item.tex.top.img;
  }
  return null;
}
function redrawHitboxCanvas() {
  if (!hitboxCtx2) return;
  const W = hitboxState.W, H = hitboxState.H;
  const c = hitboxCtx2;
  c.clearRect(0, 0, W, H);
  if (hitboxState.img) c.drawImage(hitboxState.img, 0, 0, W, H);
  else {
    c.fillStyle = '#262d3f'; c.fillRect(0, 0, W, H);
    c.fillStyle = '#6d7f99';
    c.font = 'bold 12px system-ui, sans-serif';
    c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText('(không có ảnh)', W/2, H/2);
  }
  c.save();
  c.strokeStyle = 'rgba(255,255,255,.06)'; c.lineWidth = 1;
  for (let x = 0; x <= W; x += 8) { c.beginPath(); c.moveTo(x, 0); c.lineTo(x, H); c.stroke(); }
  for (let y = 0; y <= H; y += 8) { c.beginPath(); c.moveTo(0, y); c.lineTo(W, y); c.stroke(); }
  c.restore();
  c.save();
  for (const b of hitboxState.boxes) {
    c.fillStyle = 'rgba(61,220,132,.22)';
    c.fillRect(b.x, b.y, b.w, b.h);
    c.strokeStyle = '#3ddc84';
    c.lineWidth = 1.5;
    c.strokeRect(b.x + 0.5, b.y + 0.5, b.w - 1, b.h - 1);
  }
  if (hitboxState.drawing && hitboxState.drawPreview) {
    const p = hitboxState.drawPreview;
    c.fillStyle = 'rgba(255,184,107,.25)';
    c.fillRect(p.x, p.y, p.w, p.h);
    c.strokeStyle = '#ffb86b';
    c.lineWidth = 1.5; c.setLineDash([4, 3]);
    c.strokeRect(p.x + 0.5, p.y + 0.5, p.w - 1, p.h - 1);
    c.setLineDash([]);
  }
  c.restore();
}
function renderHitboxList() {
  const el2 = document.getElementById('hitboxList');
  el2.innerHTML = '';
  if (!hitboxState.boxes.length) {
    el2.innerHTML = '<div style="padding:6px;color:#4f5f78;">Chưa có hitbox. Vẽ bằng cách kéo trên ảnh.</div>';
    return;
  }
  hitboxState.boxes.forEach((b, i) => {
    const r = document.createElement('div');
    r.className = 'hb-row';
    r.innerHTML = '<span>#' + (i+1) + '  (x:' + Math.round(b.x) + ', y:' + Math.round(b.y) +
                  ', w:' + Math.round(b.w) + ', h:' + Math.round(b.h) + ')</span>';
    const del = document.createElement('span');
    del.className = 'hb-del'; del.textContent = '✕';
    del.onclick = () => {
      hitboxState.boxes.splice(i, 1);
      redrawHitboxCanvas(); renderHitboxList(); updateHitboxInfo();
    };
    r.appendChild(del);
    el2.appendChild(r);
  });
}
function updateHitboxInfo() {
  document.getElementById('hitboxInfo').textContent = 'Tổng ' + hitboxState.boxes.length + ' vùng hitbox';
}
function hbPointerPos(e) {
  const r = hitboxCanvas.getBoundingClientRect();
  return { x: (e.clientX - r.left) * (hitboxCanvas.width / r.width),
           y: (e.clientY - r.top) * (hitboxCanvas.height / r.height) };
}
function hbClamp(p) { return { x: clamp(p.x, 0, hitboxState.W), y: clamp(p.y, 0, hitboxState.H) }; }
function hbPointerDown(e) {
  e.preventDefault();
  const p = hbClamp(hbPointerPos(e));
  hitboxState.drawing = true;
  hitboxState.drawStart = p;
  hitboxState.drawPreview = { x: p.x, y: p.y, w: 0, h: 0 };
  try { hitboxCanvas.setPointerCapture(e.pointerId); } catch (_) {}
}
function hbPointerMove(e) {
  if (!hitboxState.drawing) return;
  const p = hbClamp(hbPointerPos(e));
  const s = hitboxState.drawStart;
  const x = Math.min(s.x, p.x), y = Math.min(s.y, p.y);
  const w = Math.abs(p.x - s.x), h = Math.abs(p.y - s.y);
  hitboxState.drawPreview = { x, y, w, h };
  redrawHitboxCanvas();
}
function hbPointerUp(e) {
  if (!hitboxState.drawing) return;
  hitboxState.drawing = false;
  const p = hitboxState.drawPreview;
  hitboxState.drawPreview = null;
  if (p && p.w >= 2 && p.h >= 2) {
    hitboxState.boxes.push({ x: p.x, y: p.y, w: p.w, h: p.h });
    renderHitboxList(); updateHitboxInfo();
  }
  redrawHitboxCanvas();
}
function buildGridFromAlpha(alpha, W, H, cellSize, alphaThreshold) {
  const cols = Math.ceil(W / cellSize);
  const rows = Math.ceil(H / cellSize);
  const grid = [];
  for (let y = 0; y < rows; y++) {
    grid[y] = [];
    for (let x = 0; x < cols; x++) {
      let solid = false;
      const x0 = x * cellSize, y0 = y * cellSize;
      const x1 = Math.min(W, x0 + cellSize), y1 = Math.min(H, y0 + cellSize);
      for (let py = y0; py < y1 && !solid; py++) {
        for (let px = x0; px < x1; px++) {
          if (alpha[py * W + px] > alphaThreshold) { solid = true; break; }
        }
      }
      grid[y][x] = solid;
    }
  }
  return { grid, cols, rows };
}
function mergeGridToRects(grid, cols, rows, cellSize, W, H) {
  const used = Array.from({ length: rows }, () => new Array(cols).fill(false));
  const rects = [];
  for (let y = 0; y < rows; y++) {
    let x = 0;
    while (x < cols) {
      if (grid[y][x] && !used[y][x]) {
        let x2 = x;
        while (x2 + 1 < cols && grid[y][x2+1] && !used[y][x2+1]) x2++;
        let y2 = y;
        outer:
        while (y2 + 1 < rows) {
          for (let xx = x; xx <= x2; xx++) if (!grid[y2+1][xx] || used[y2+1][xx]) break outer;
          y2++;
        }
        for (let yy = y; yy <= y2; yy++) for (let xx = x; xx <= x2; xx++) used[yy][xx] = true;
        rects.push({
          x: x * cellSize, y: y * cellSize,
          w: Math.min((x2 - x + 1) * cellSize, W - x * cellSize),
          h: Math.min((y2 - y + 1) * cellSize, H - y * cellSize)
        });
        x = x2 + 1;
      } else x++;
    }
  }
  return rects;
}
function autoDetectAllFrames(item, W, H, cellSize, alphaThreshold) {
  const allFrames = collectAllFrames(item);
  if (!allFrames.length) return null;
  const cnv = document.createElement('canvas');
  cnv.width = W; cnv.height = H;
  const c2 = cnv.getContext('2d');
  const alpha = new Uint8ClampedArray(W * H);
  for (const img of allFrames) {
    c2.clearRect(0, 0, W, H);
    c2.drawImage(img, 0, 0, W, H);
    let data;
    try { data = c2.getImageData(0, 0, W, H).data; } catch (e) { return null; }
    for (let i = 0; i < W * H; i++) {
      const a = data[i * 4 + 3];
      if (a > alpha[i]) alpha[i] = a;
    }
  }
  const { grid, cols, rows } = buildGridFromAlpha(alpha, W, H, cellSize, alphaThreshold);
  return mergeGridToRects(grid, cols, rows, cellSize, W, H);
}
function autoDetectSingle(img, W, H, cellSize, alphaThreshold) {
  const cnv = document.createElement('canvas');
  cnv.width = W; cnv.height = H;
  const c2 = cnv.getContext('2d');
  c2.drawImage(img, 0, 0, W, H);
  let data;
  try { data = c2.getImageData(0, 0, W, H).data; } catch (e) { return null; }
  const alpha = new Uint8ClampedArray(W * H);
  for (let i = 0; i < W * H; i++) alpha[i] = data[i * 4 + 3];
  const { grid, cols, rows } = buildGridFromAlpha(alpha, W, H, cellSize, alphaThreshold);
  return mergeGridToRects(grid, cols, rows, cellSize, W, H);
}
function hbAutoDetect() {
  if (!hitboxState.itemId) { toast('Không có item', 'err'); return; }
  const item = State.items.find(i => i.id === hitboxState.itemId);
  if (!item) { toast('Không tìm thấy item', 'err'); return; }
  const cellSize = clamp(parseInt(document.getElementById('hitboxCell').value, 10) || 16, 2, 128);
  const alphaThr = clamp(parseInt(document.getElementById('hitboxAlpha').value, 10) || 10, 0, 255);
  const allFrames = document.getElementById('hitboxAllFrames').checked;
  let rects;
  if (allFrames) {
    rects = autoDetectAllFrames(item, hitboxState.W, hitboxState.H, cellSize, alphaThr);
    if (rects === null) { toast('Không có frame nào', 'err'); return; }
    if (!rects.length) { toast('Không tìm thấy vùng đặc', 'err'); return; }
    toast('Auto-detect (tất cả frames): ' + rects.length + ' vùng', 'ok', 3000);
  } else {
    if (!hitboxState.img) { toast('Không có ảnh', 'err'); return; }
    rects = autoDetectSingle(hitboxState.img, hitboxState.W, hitboxState.H, cellSize, alphaThr);
    if (rects === null) { toast('Không đọc được pixel', 'err'); return; }
    if (!rects.length) { toast('Không tìm thấy vùng đặc', 'err'); return; }
    toast('Auto-detect (frame đầu): ' + rects.length + ' vùng', 'ok');
  }
  hitboxState.boxes = rects;
  redrawHitboxCanvas(); renderHitboxList(); updateHitboxInfo();
}
function saveHitbox() {
  const item = State.items.find(i => i.id === hitboxState.itemId);
  if (!item) { closeHitboxModal(); return; }
  const W = hitboxState.W, H = hitboxState.H;
  item.hitboxes = hitboxState.boxes.map(b => ({
    ox: b.x + b.w/2 - W/2,
    oy: b.y + b.h/2 - H/2,
    w: b.w, h: b.h
  }));
  renderInspector(); renderLayers(); scheduleSave();
  toast('Đã lưu ' + item.hitboxes.length + ' hitbox', 'ok');
  closeHitboxModal();
}
function closeHitboxModal() {
  document.getElementById('hitboxModal').classList.remove('show');
  hitboxState.itemId = null;
  hitboxState.img = null;
  hitboxState.boxes = [];
  hitboxState.drawing = false;
  hitboxState.drawPreview = null;
}

/* ---------- FACTORIES ---------- */
function countPrefix(items, kind, prefix) {
  let max = 0;
  for (const it of items) {
    if (it.kind !== kind) continue;
    const m = new RegExp(prefix + '\\s+(\\d+)\\s*$').exec(it.name || '');
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return max;
}
const emptyAnim = () => ({ frames: [], fps: 8, loop: true });

function makeSprite(o) {
  const w = 64, h = 64;
  const name = 'Nhân vật ' + (countPrefix(State.items, 'sprite', 'Nhân vật') + 1);
  return Object.assign({
    id: uid(), kind: 'sprite', name,
    x: VW/2, y: VH/2 - 40, w, h,
    hb: { ox: 0, oy: 0, hw: w/2, hh: h/2 },
    hitboxes: [], events: [],
    control: 'player', camera: false, hpMode: 'default',
    animations: {
      idle: emptyAnim(), run: emptyAnim(), jump: emptyAnim(),
      hurt: emptyAnim(), die: emptyAnim(), shoot: emptyAnim()
    },
    shoot: {
      enabled: false, url: null, img: null,
      offsetX: 0, offsetY: 0, delay: 0, cooldown: 0.3, damage: 10,
      speed: 8, bulletW: 14, bulletH: 14,
      angle: 0,
      useGravity: false, bulletGravity: 5,
      animation: emptyAnim()
    },
    botRange: 150, botPatrol: 80,
    speed: 1, jumpPower: 1, gravity: 1,
    hp: 92, maxHp: 92, iframe: 1,
    _vx: 0, _vy: 0, _onGround: false, _facing: 1,
    _state: 'idle', _invuln: 0, _dead: false, _shootCd: 0, _shootAnimTime: 0,
    _pendingShots: [], _animFrame: 0, _animTime: 0, _prevState: 'idle',
    _pendingActions: [], _everyTimers: {}, _keyState: {},
    _idleFired: {}, _touchSet: new Set(),
    _flash: null, _speedBuff: null, _gravityBuff: null, _scaleBuff: null,
    _startFired: false, _prevHp: null, _idleTime: 0, _nearPlayer: false
  }, o || {});
}
function makeBot(o) {
  const base = makeSprite(o || {});
  base.name = 'Bot ' + (countPrefix(State.items, 'sprite', 'Bot') + 1);
  base.control = 'bot';
  base.shoot.enabled = true;
  base.shoot.cooldown = 0.8;
  base.shoot.speed = 6;
  return base;
}
function makeBlock(o) {
  const name = 'Khối ' + (countPrefix(State.items, 'block', 'Khối') + 1);
  return Object.assign({
    id: uid(), kind: 'block', name,
    x: VW/2, y: VH - 30, w: 96, h: 32,
    solid: true, hazard: false,
    tex: { all: null, top: null, bottom: null, left: null, right: null },
    hitboxes: [],
    animations: { default: emptyAnim() },
    _animFrame: 0, _animTime: 0
  }, o || {});
}

/* ---------- CANVAS ---------- */
function resizeCanvas() {
  const wrap = document.getElementById('stageWrap');
  const aw = Math.max(120, wrap.clientWidth - 24);
  const ah = Math.max(120, wrap.clientHeight - 24);
  const s = Math.min(aw / VW, ah / VH);
  canvas.width = VW; canvas.height = VH;
  canvas.style.width  = Math.floor(VW * s) + 'px';
  canvas.style.height = Math.floor(VH * s) + 'px';
}
function toStage(cx, cy) {
  const r = canvas.getBoundingClientRect();
  return { x: (cx - r.left) * (VW / r.width), y: (cy - r.top) * (VH / r.height) };
}
function toWorld(sx, sy) {
  const cam = State.playing ? State.camera : State.editCam;
  return { x: sx - VW/2 + cam.x, y: sy - VH/2 + cam.y };
}

/* ---------- ANIM MODAL (supports sprite/block/bullet) ---------- */
let animCtx = null;  // { itemId, path, label }
function resolveAnimRef(ctx2) {
  if (!ctx2) return null;
  const item = State.items.find(i => i.id === ctx2.itemId);
  if (!item) return null;
  const parts = ctx2.path.split('.');
  let obj = item;
  for (let i = 0; i < parts.length - 1; i++) obj = obj[parts[i]];
  if (!obj) return null;
  const last = parts[parts.length - 1];
  if (!obj[last]) obj[last] = emptyAnim();
  return obj[last];
}
function openAnimModal(item, path, label) {
  animCtx = { itemId: item.id, path, label };
  const anim = resolveAnimRef(animCtx);
  if (!anim) return;
  document.getElementById('animTitle').textContent = '🎞️ Animation: ' + label;
  document.getElementById('animFps').value = anim.fps || 8;
  document.getElementById('animLoop').checked = anim.loop !== false;
  renderAnimFrames();
  document.getElementById('sheetPanel').style.display = 'none';
  sheetCtx = { file: null, url: null, img: null };
  document.getElementById('animModal').classList.add('show');
}
function renderAnimFrames() {
  if (!animCtx) return;
  const anim = resolveAnimRef(animCtx);
  if (!anim) return;
  const wrap = document.getElementById('animFrames');
  wrap.innerHTML = '';
  if (!anim.frames.length) {
    const e = document.createElement('div');
    e.className = 'empty-frame';
    e.textContent = 'Chưa có frame. Nhấn "Thêm frame" hoặc "Spritesheet".';
    wrap.appendChild(e);
    return;
  }
  anim.frames.forEach((f, i) => {
    const el = document.createElement('div');
    el.className = 'frame';
    const img = document.createElement('img');
    img.src = f.url;
    el.appendChild(img);
    const num = document.createElement('div');
    num.className = 'fnum'; num.textContent = i + 1;
    el.appendChild(num);
    const del = document.createElement('div');
    del.className = 'fdel'; del.textContent = '×';
    del.onclick = () => {
      anim.frames.splice(i, 1);
      renderAnimFrames(); renderInspector(); renderLayers(); scheduleSave();
    };
    el.appendChild(del);
    wrap.appendChild(el);
  });
}

/* ---------- LAYERS ---------- */
function renderLayers() {
  const el = document.getElementById('layers');
  el.innerHTML = '';
  for (let i = State.items.length - 1; i >= 0; i--) {
    const item = State.items[i];
    const card = document.createElement('div');
    card.className = 'layer-card' + (item.id === State.selectedId ? ' sel' : '');
    card.onclick = () => { State.tab = 'scene'; selectItem(item.id); };
    const thumb = document.createElement('div');
    thumb.className = 'thumb';
    let thumbUrl = null;
    if (item.kind === 'sprite') {
      const idle = item.animations.idle;
      if (idle && idle.frames.length) thumbUrl = idle.frames[0].url;
    } else {
      const anim = item.animations && item.animations.default;
      if (anim && anim.frames.length) thumbUrl = anim.frames[0].url;
      else if (item.tex && item.tex.all) thumbUrl = item.tex.all.url;
    }
    if (thumbUrl) {
      const img = document.createElement('img');
      img.src = thumbUrl; thumb.appendChild(img);
    } else {
      thumb.textContent = item.kind === 'sprite'
        ? (item.control === 'bot' ? '🤖' : '🧍')
        : (item.hazard ? '⚠️' : '⬛');
    }
    card.appendChild(thumb);
    const nm = document.createElement('div');
    nm.className = 'nm'; nm.textContent = item.name;
    card.appendChild(nm);
    if (item.kind === 'sprite' && item.camera) {
      const cam = document.createElement('div'); cam.className = 'cam'; cam.textContent = '📷';
      card.appendChild(cam);
    }
    if (item.kind === 'sprite' && item.control === 'bot') {
      const b = document.createElement('div'); b.className = 'bot'; b.textContent = '🤖';
      card.appendChild(b);
    }
    if (item.kind === 'sprite' && item.events && item.events.length) {
      const ev = document.createElement('div'); ev.className = 'ev'; ev.textContent = '🧩';
      card.appendChild(ev);
    }
    const del = document.createElement('div');
    del.className = 'del'; del.textContent = '×';
    del.onclick = ev => { ev.stopPropagation(); deleteItem(item.id); };
    card.appendChild(del);
    el.appendChild(card);
  }
  const add = document.createElement('div');
  add.className = 'layer-add'; add.textContent = '＋';
  add.onclick = () => addSprite();
  el.appendChild(add);
}

/* ---------- DOM HELPERS ---------- */
function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}
function row(label, input) {
  const r = el('div', 'row');
  r.appendChild(el('span', null, label));
  r.appendChild(input);
  return r;
}
function numInput(val, cb, step, min, max) {
  const i = el('input', 'inp');
  i.type = 'number'; i.value = val;
  i.step = step != null ? step : 1;
  if (min != null) i.min = min;
  if (max != null) i.max = max;
  i.oninput = () => { let v = parseFloat(i.value); if (isNaN(v)) v = 0; cb(v); scheduleSave(); };
  return i;
}
function textInput(val, cb) {
  const i = el('input', 'inp'); i.type = 'text'; i.value = val || '';
  i.oninput = () => { cb(i.value); scheduleSave(); };
  return i;
}
function colorInput(val, cb) {
  const i = el('input', 'inp'); i.type = 'color'; i.value = val || '#ffffff';
  i.style.padding = '2px'; i.style.height = '28px';
  i.oninput = () => { cb(i.value); scheduleSave(); };
  return i;
}
function selectInput(val, options, cb) {
  const s = el('select', 'inp');
  for (const [v, t] of options) {
    const o = document.createElement('option');
    o.value = v; o.textContent = t;
    if (v === val) o.selected = true;
    s.appendChild(o);
  }
  s.onchange = () => { cb(s.value); scheduleSave(); };
  return s;
}
function checkbox(val, cb) {
  const wrap = el('div');
  const i = el('input'); i.type = 'checkbox'; i.checked = !!val;
  i.style.accentColor = 'var(--accent)'; i.style.width = '18px'; i.style.height = '18px';
  i.onchange = () => { cb(i.checked); scheduleSave(); };
  wrap.appendChild(i);
  return wrap;
}
function sectionHeader(txt) { return el('div', 'ins-sub', txt); }

function animSlot(item, path, label) {
  // path like 'animations.idle'
  const parts = path.split('.');
  let obj = item;
  for (let i = 0; i < parts.length - 1; i++) obj = obj[parts[i]];
  const key = parts[parts.length - 1];
  const anim = obj[key];
  const has = anim && anim.frames.length;
  const wrap = el('div', 'anim-slot' + (has ? ' on' : ''));
  wrap.onclick = () => openAnimModal(item, path, label);
  const prev = el('div', 'anim-prev');
  if (has && anim.frames[0].img) {
    const img = document.createElement('img');
    img.src = anim.frames[0].url;
    prev.appendChild(img);
  } else {
    prev.textContent = '—'; prev.style.color = '#3f4a5e'; prev.style.fontSize = '16px';
  }
  wrap.appendChild(prev);
  wrap.appendChild(el('div', 'anim-name', label));
  wrap.appendChild(el('div', 'anim-meta', has ? (anim.frames.length + ' f • ' + anim.fps + ' fps') : 'trống'));
  return wrap;
}
function texSlot(item, key) {
  const labels = { all: 'Toàn bộ', top: 'Trên', bottom: 'Dưới', left: 'Trái', right: 'Phải' };
  const wrap = el('div', 'anim-slot' + (item.tex[key] ? ' on' : ''));
  const prev = el('div', 'anim-prev');
  const a = item.tex[key];
  if (a && a.img) {
    const img = document.createElement('img'); img.src = a.url; prev.appendChild(img);
  } else {
    prev.textContent = labels[key];
    prev.style.color = '#3f4a5e'; prev.style.fontSize = '10px'; prev.style.fontWeight = '700';
  }
  wrap.appendChild(prev);
  wrap.appendChild(el('div', 'anim-name', labels[key]));
  const btns = el('div', 'anim-btns');
  const setB = el('button', 'btn-mini', 'Ảnh');
  setB.onclick = (e) => { e.stopPropagation(); importBlockTexture(item, key); };
  btns.appendChild(setB);
  if (a) {
    const clr = el('button', 'btn-mini danger', '✕');
    clr.onclick = (e) => { e.stopPropagation(); item.tex[key] = null; renderInspector(); scheduleSave(); };
    btns.appendChild(clr);
  }
  wrap.appendChild(btns);
  return wrap;
}
function hitboxButton(item) {
  const wrap = el('div');
  wrap.style.cssText = 'background:var(--card);border:1px solid var(--border2);border-radius:9px;padding:8px;margin-top:4px;';
  const info = el('div');
  const n = (item.hitboxes && item.hitboxes.length) || 0;
  info.style.cssText = 'font-size:11px;color:var(--text2);margin-bottom:6px;';
  info.textContent = n ? (n + ' vùng hitbox (lật theo hướng)') : 'Mặc định (toàn bộ item)';
  wrap.appendChild(info);
  const btn = el('button', 'btn accent', '🎯 Mở trình chỉnh Hitbox');
  btn.style.width = '100%';
  btn.onclick = () => openHitboxModal(item);
  wrap.appendChild(btn);
  if (n) {
    const rst = el('button', 'btn-mini danger', '↺ Về mặc định');
    rst.style.cssText = 'width:100%;padding:5px;margin-top:5px;font-size:10px;';
    rst.onclick = () => {
      item.hitboxes = [];
      renderInspector(); renderLayers(); scheduleSave();
      toast('Đã reset hitbox', 'ok');
    };
    wrap.appendChild(rst);
  }
  return wrap;
}

/* ---------- EVENTS UI ---------- */
const TRIGGERS = [
  ['onStart', '🚀 Bắt đầu game'], ['onShoot', '💥 Bắn đạn'],
  ['onJump', '⬆️ Nhảy'], ['onLand', '⬇️ Chạm đất'],
  ['onRun', '🏃 Bắt đầu chạy'], ['onHurt', '💔 Mất máu'],
  ['onDeath', '☠️ Chết'], ['onHpBelow', '❤️ Máu dưới X%'],
  ['onKeyPress', '⌨️ Bấm phím'], ['onNearPlayer', '👁 Player lại gần'],
  ['onEvery', '⏱ Định kỳ mỗi N giây'], ['onIdle', '😴 Đứng yên N giây'],
  ['onHitBlock', '🧱 Chạm khối'], ['onHitSprite', '👥 Chạm nhân vật khác']
];
const ACTIONS = [
  ['shakeScreen', '📳 Rung màn hình'], ['changeHp', '❤️ Đổi máu'],
  ['spawnBullet', '💥 Bắn đạn'], ['teleport', '➡️ Dịch chuyển (dx, dy)'],
  ['setPos', '📍 Đặt vị trí (x, y)'], ['setInvuln', '🛡 Bất tử N giây'],
  ['destroySelf', '☠️ Tự huỷ'], ['changeControl', '🎮 Đổi kiểu điều khiển'],
  ['showText', '💬 Hiện text bay'], ['spawnParticles', '✨ Tạo hạt'],
  ['flash', '⚡ Nhấp nháy màu'], ['playSound', '🔊 Phát âm thanh'],
  ['setSpeed', '⚡ Buff tốc độ'], ['setGravity', '🌌 Buff trọng lực'],
  ['setScale', '📏 Buff kích thước'], ['setCameraTarget', '📷 Đổi mục tiêu camera']
];
const TRIGGER_PARAM_DEF = {
  onHpBelow: { percent: 50 }, onKeyPress: { key: 'Fire' },
  onNearPlayer: { distance: 100 }, onEvery: { interval: 2 }, onIdle: { seconds: 2 }
};
const ACTION_PARAM_DEF = {
  shakeScreen: { intensity: 10, duration: 0.5 }, changeHp: { amount: -10 },
  teleport: { dx: 0, dy: -40 }, setPos: { x: 320, y: 100 }, setInvuln: { seconds: 2 },
  changeControl: { mode: 'player' },
  showText: { text: '!', color: '#ffd166', duration: 1.5 },
  spawnParticles: { count: 12, color: '#ffb86b', size: 4, life: 0.8 },
  flash: { color: '#ffffff', duration: 0.3 },
  playSound: { frequency: 440, duration: 0.2, wave: 'sine' },
  setSpeed: { multiplier: 2, duration: 3 },
  setGravity: { multiplier: 0, duration: 3 },
  setScale: { multiplier: 1.5, duration: 3 }
};

function renderEventCard(item, ev, idx) {
  const card = el('div', 'event-card');
  const head = el('div', 'ev-head');
  head.appendChild(el('div', 'ev-num', '#' + (idx + 1)));
  const trigSel = selectInput(ev.trigger, TRIGGERS, v => {
    ev.trigger = v;
    const def = TRIGGER_PARAM_DEF[v];
    ev.triggerParams = def ? Object.assign({}, def) : {};
    renderInspector(); scheduleSave();
  });
  head.appendChild(trigSel);
  const del = el('button', 'ev-del', '🗑');
  del.onclick = () => { item.events.splice(idx, 1); renderInspector(); renderLayers(); scheduleSave(); };
  head.appendChild(del);
  card.appendChild(head);

  const tp = ev.triggerParams || (ev.triggerParams = {});
  if (ev.trigger === 'onHpBelow')
    card.appendChild(row('Dưới (%)', numInput(tp.percent != null ? tp.percent : 50, v => tp.percent = clamp(v, 0, 100), 1, 0, 100)));
  else if (ev.trigger === 'onKeyPress') {
    card.appendChild(row('Phím', textInput(tp.key || 'Fire', v => tp.key = v)));
    card.appendChild(el('div', 'ev-hint', 'Dùng tên phím: Fire, ArrowLeft, ArrowRight, ArrowUp, a, b, ...'));
  } else if (ev.trigger === 'onNearPlayer')
    card.appendChild(row('Khoảng cách', numInput(tp.distance != null ? tp.distance : 100, v => tp.distance = Math.max(10, v), 10, 10)));
  else if (ev.trigger === 'onEvery')
    card.appendChild(row('Mỗi (giây)', numInput(tp.interval != null ? tp.interval : 2, v => tp.interval = Math.max(0.1, v), 0.1, 0.1)));
  else if (ev.trigger === 'onIdle')
    card.appendChild(row('Sau (giây)', numInput(tp.seconds != null ? tp.seconds : 2, v => tp.seconds = Math.max(0.1, v), 0.1, 0.1)));

  card.appendChild(el('div', 'ev-sub', '⏳ Trễ'));
  card.appendChild(row('Sau (giây)', numInput(ev.delay != null ? ev.delay : 0, v => ev.delay = Math.max(0, v), 0.1, 0)));

  card.appendChild(el('div', 'ev-sub', '🎬 Hành động'));
  const actSel = selectInput(ev.action, ACTIONS, v => {
    ev.action = v;
    const def = ACTION_PARAM_DEF[v];
    ev.actionParams = def ? Object.assign({}, def) : {};
    renderInspector(); scheduleSave();
  });
  card.appendChild(row('Làm', actSel));
  const ap = ev.actionParams || (ev.actionParams = {});
  const r = (label, input) => card.appendChild(row(label, input));
  switch (ev.action) {
    case 'shakeScreen':
      r('Cường độ', numInput(ap.intensity != null ? ap.intensity : 10, v => ap.intensity = Math.max(0, v), 1, 0));
      r('Thời gian (s)', numInput(ap.duration != null ? ap.duration : 0.5, v => ap.duration = Math.max(0.05, v), 0.05, 0.05));
      break;
    case 'changeHp':
      r('Số lượng', numInput(ap.amount != null ? ap.amount : -10, v => ap.amount = v, 1));
      card.appendChild(el('div', 'ev-hint', 'Số âm = mất máu, số dương = hồi máu.'));
      break;
    case 'teleport':
      r('ΔX', numInput(ap.dx != null ? ap.dx : 0, v => ap.dx = v, 5));
      r('ΔY', numInput(ap.dy != null ? ap.dy : -40, v => ap.dy = v, 5));
      break;
    case 'setPos':
      r('X', numInput(ap.x != null ? ap.x : 320, v => ap.x = v, 10));
      r('Y', numInput(ap.y != null ? ap.y : 100, v => ap.y = v, 10));
      break;
    case 'setInvuln':
      r('Thời gian (s)', numInput(ap.seconds != null ? ap.seconds : 2, v => ap.seconds = Math.max(0, v), 0.5, 0));
      break;
    case 'changeControl':
      r('Kiểu', selectInput(ap.mode || 'player', [
        ['player','Người chơi'], ['bot','Bot / NPC'], ['none','Đứng yên']
      ], v => ap.mode = v));
      break;
    case 'showText':
      r('Text', textInput(ap.text != null ? ap.text : '!', v => ap.text = v));
      r('Màu', colorInput(ap.color || '#ffd166', v => ap.color = v));
      r('Thời gian (s)', numInput(ap.duration != null ? ap.duration : 1.5, v => ap.duration = Math.max(0.1, v), 0.1, 0.1));
      break;
    case 'spawnParticles':
      r('Số hạt', numInput(ap.count != null ? ap.count : 12, v => ap.count = clamp(v, 1, 200), 1, 1, 200));
      r('Màu', colorInput(ap.color || '#ffb86b', v => ap.color = v));
      r('Kích cỡ', numInput(ap.size != null ? ap.size : 4, v => ap.size = Math.max(1, v), 1, 1));
      r('Đời sống (s)', numInput(ap.life != null ? ap.life : 0.8, v => ap.life = Math.max(0.1, v), 0.1, 0.1));
      break;
    case 'flash':
      r('Màu', colorInput(ap.color || '#ffffff', v => ap.color = v));
      r('Thời gian (s)', numInput(ap.duration != null ? ap.duration : 0.3, v => ap.duration = Math.max(0.05, v), 0.05, 0.05));
      break;
    case 'playSound':
      r('Tần số (Hz)', numInput(ap.frequency != null ? ap.frequency : 440, v => ap.frequency = Math.max(20, v), 20, 20));
      r('Thời gian (s)', numInput(ap.duration != null ? ap.duration : 0.2, v => ap.duration = Math.max(0.05, v), 0.05, 0.05));
      r('Dạng sóng', selectInput(ap.wave || 'sine', [
        ['sine','Sine'], ['square','Square'], ['sawtooth','Saw'], ['triangle','Triangle']
      ], v => ap.wave = v));
      break;
    case 'setSpeed':
      r('Hệ số', numInput(ap.multiplier != null ? ap.multiplier : 2, v => ap.multiplier = Math.max(0, v), 0.1, 0));
      r('Thời gian (s)', numInput(ap.duration != null ? ap.duration : 3, v => ap.duration = Math.max(0.1, v), 0.1, 0.1));
      break;
    case 'setGravity':
      r('Hệ số', numInput(ap.multiplier != null ? ap.multiplier : 0, v => ap.multiplier = Math.max(0, v), 0.1, 0));
      r('Thời gian (s)', numInput(ap.duration != null ? ap.duration : 3, v => ap.duration = Math.max(0.1, v), 0.1, 0.1));
      card.appendChild(el('div', 'ev-hint', '0 = bay lơ lửng.'));
      break;
    case 'setScale':
      r('Hệ số', numInput(ap.multiplier != null ? ap.multiplier : 1.5, v => ap.multiplier = Math.max(0.1, v), 0.1, 0.1));
      r('Thời gian (s)', numInput(ap.duration != null ? ap.duration : 3, v => ap.duration = Math.max(0.1, v), 0.1, 0.1));
      break;
    case 'setCameraTarget':
      card.appendChild(el('div', 'ev-hint', 'Đặt nhân vật này làm mục tiêu camera.'));
      break;
    case 'spawnBullet':
    case 'destroySelf':
      card.appendChild(el('div', 'ev-hint', 'Không có tham số.'));
      break;
  }
  return card;
}

/* ---------- INSPECTOR ---------- */
function renderInspector() {
  const root = document.getElementById('inspector');
  root.innerHTML = '';
  const tabs = el('div', 'tabs');
  const tScene = el('div', 'tab' + (State.tab === 'scene' ? ' on' : ''), '🎬 Scene');
  const tUI    = el('div', 'tab' + (State.tab === 'ui'    ? ' on' : ''), '🎨 UI');
  tScene.onclick = () => { State.tab = 'scene'; State.uiSelected = null;
    document.getElementById('btnUI').classList.remove('on'); renderInspector(); };
  tUI.onclick    = () => { State.tab = 'ui';    State.selectedId = null;
    document.getElementById('btnUI').classList.add('on');    renderInspector(); };
  tabs.appendChild(tScene); tabs.appendChild(tUI);
  root.appendChild(tabs);
  if (State.tab === 'ui') { renderUIInspector(root); return; }
  const item = State.items.find(i => i.id === State.selectedId);
  if (!item) {
    root.appendChild(el('div', 'empty',
      'Chọn một layer để chỉnh sửa<br>hoặc bấm ＋ để thêm nhân vật / khối<br><br>Bấm tab 🎨 UI để chỉnh giao diện.'));
    return;
  }
  if (item.kind === 'sprite') renderSpriteInspector(root, item);
  else renderBlockInspector(root, item);
}

function renderSpriteInspector(root, item) {
  const isBot = item.control === 'bot';
  root.appendChild(el('div', 'ins-head', isBot ? '🤖 Bot / NPC' : '🧍 Nhân vật'));
  root.appendChild(row('Tên', textInput(item.name, v => { item.name = v; renderLayers(); })));
  root.appendChild(row('X', numInput(Math.round(item.x), v => item.x = v, 1)));
  root.appendChild(row('Y', numInput(Math.round(item.y), v => item.y = v, 1)));
  root.appendChild(sectionHeader('Kích thước'));
  const sg = el('div', 'grid4');
  sg.appendChild(row('W', numInput(item.w, v => { item.w = Math.max(4,v); if (!item.hitboxes || !item.hitboxes.length) item.hb.hw = item.w/2; }, 1, 4)));
  sg.appendChild(row('H', numInput(item.h, v => { item.h = Math.max(4,v); if (!item.hitboxes || !item.hitboxes.length) item.hb.hh = item.h/2; }, 1, 4)));
  root.appendChild(sg);
  root.appendChild(sectionHeader('Hitbox'));
  root.appendChild(hitboxButton(item));
  root.appendChild(sectionHeader('Chuyển động & Camera'));
  root.appendChild(row('Kiểu', selectInput(item.control, [
    ['player', 'Người chơi'], ['bot', 'Bot / NPC'], ['none', 'Đứng yên']
  ], v => {
    item.control = v;
    if (v === 'bot' && item.shoot && !item.shoot.enabled) item.shoot.enabled = true;
    renderInspector(); renderLayers();
  })));
  root.appendChild(row('📷 Camera theo', checkbox(item.camera, v => {
    item.camera = v;
    if (v) for (const o of State.items) if (o !== item && o.kind === 'sprite') o.camera = false;
    renderLayers();
  })));
  if (isBot) {
    root.appendChild(sectionHeader('🤖 Bot AI'));
    root.appendChild(row('Tầm phát hiện', numInput(item.botRange, v => item.botRange = Math.max(20, v), 10, 20)));
    root.appendChild(row('Phạm vi tuần',  numInput(item.botPatrol, v => item.botPatrol = Math.max(10, v), 10, 10)));
  }
  root.appendChild(sectionHeader('Animation (frames)'));
  const ag = el('div', 'anim-grid');
  ag.appendChild(animSlot(item, 'animations.idle',  'Đứng yên'));
  ag.appendChild(animSlot(item, 'animations.run',   'Chạy'));
  ag.appendChild(animSlot(item, 'animations.jump',  'Nhảy'));
  ag.appendChild(animSlot(item, 'animations.hurt',  'Mất máu'));
  ag.appendChild(animSlot(item, 'animations.die',   'Chết'));
  ag.appendChild(animSlot(item, 'animations.shoot', 'Bắn đạn'));
  root.appendChild(ag);

  root.appendChild(sectionHeader('💥 Bắn đạn'));
  root.appendChild(row('Bật bắn đạn', checkbox(item.shoot.enabled, v => {
    item.shoot.enabled = v; renderInspector();
  })));
  if (item.shoot.enabled) {
    const sw = el('div', 'anim-slot' + (item.shoot.img ? ' on' : ''));
    sw.style.marginBottom = '6px';
    const sp = el('div', 'anim-prev');
    if (item.shoot.img) {
      const img = document.createElement('img'); img.src = item.shoot.url; sp.appendChild(img);
    } else { sp.textContent = '●'; sp.style.color = '#ffb86b'; sp.style.fontSize = '20px'; }
    sw.appendChild(sp);
    sw.appendChild(el('div', 'anim-name', 'Ảnh đạn tĩnh'));
    const sb = el('div', 'anim-btns');
    const setB = el('button', 'btn-mini', 'Ảnh đạn');
    setB.onclick = () => importShootImage(item);
    sb.appendChild(setB);
    if (item.shoot.img) {
      const clr = el('button', 'btn-mini danger', '✕');
      clr.onclick = () => { item.shoot.url = null; item.shoot.img = null; renderInspector(); scheduleSave(); };
      sb.appendChild(clr);
    }
    sw.appendChild(sb);
    root.appendChild(sw);

    // Bullet animation
    root.appendChild(sectionHeader('🎞️ Animation viên đạn'));
    if (!item.shoot.animation) item.shoot.animation = emptyAnim();
    const bag = el('div', 'anim-grid');
    bag.appendChild(animSlot(item, 'shoot.animation', 'Bullet'));
    root.appendChild(bag);
    if (item.shoot.animation.frames.length) {
      root.appendChild(el('div', 'anim-meta',
        'Khi có animation, viên đạn dùng animation thay vì ảnh tĩnh.'));
    }

    const og = el('div', 'grid4');
    og.appendChild(row('X', numInput(item.shoot.offsetX, v => item.shoot.offsetX = v, 1)));
    og.appendChild(row('Y', numInput(item.shoot.offsetY, v => item.shoot.offsetY = v, 1)));
    root.appendChild(og);
    root.appendChild(row('Góc bắn (°)', numInput(item.shoot.angle || 0,
      v => item.shoot.angle = clamp(v, -180, 180), 5, -180, 180)));
    root.appendChild(el('div', 'ev-hint',
      '0° = ngang, 90° = lên thẳng, -90° = xuống thẳng. Góc âm để bắn xuống dưới.'));
    root.appendChild(row('Độ trễ (s)', numInput(item.shoot.delay, v => item.shoot.delay = Math.max(0, v), 0.05, 0)));
    root.appendChild(row('Hồi chiêu (s)', numInput(item.shoot.cooldown, v => item.shoot.cooldown = Math.max(0.02, v), 0.05, 0.02)));
    root.appendChild(row('Tốc độ đạn',   numInput(item.shoot.speed, v => item.shoot.speed = Math.max(0.5, v), 0.5, 0.5)));
    root.appendChild(row('Sát thương',   numInput(item.shoot.damage, v => item.shoot.damage = Math.max(0, v), 1, 0)));
    const bg = el('div', 'grid4');
    bg.appendChild(row('W', numInput(item.shoot.bulletW, v => item.shoot.bulletW = Math.max(2, v), 1, 2)));
    bg.appendChild(row('H', numInput(item.shoot.bulletH, v => item.shoot.bulletH = Math.max(2, v), 1, 2)));
    root.appendChild(bg);
    root.appendChild(row('Trọng lực đạn', checkbox(item.shoot.useGravity, v => {
      item.shoot.useGravity = v; renderInspector();
    })));
    if (item.shoot.useGravity) {
      root.appendChild(row('Hệ số (mặc định 5)', numInput(item.shoot.bulletGravity, v => item.shoot.bulletGravity = Math.max(0, v), 0.5, 0)));
    }
  }

  root.appendChild(sectionHeader('Vật lý'));
  root.appendChild(row('Tốc độ',      numInput(item.speed,     v => item.speed     = Math.max(0, v), 0.1, 0)));
  root.appendChild(row('Độ cao nhảy', numInput(item.jumpPower, v => item.jumpPower = Math.max(0, v), 0.1, 0)));
  root.appendChild(row('Trọng lực',   numInput(item.gravity,   v => item.gravity   = Math.max(0, v), 0.1, 0)));
  root.appendChild(sectionHeader('Máu & Hiển thị'));
  root.appendChild(row('HP tối đa', numInput(item.maxHp, v => {
    item.maxHp = Math.max(1, v);
    item.hp = Math.min(item.hp, item.maxHp);
  }, 1, 1)));
  root.appendChild(row('Kiểu HP', selectInput(item.hpMode, [
    ['default', 'Mặc định'], ['bar', 'Thanh HP trên đầu']
  ], v => item.hpMode = v)));
  root.appendChild(row('Bất tử (s)', numInput(item.iframe, v => item.iframe = Math.max(0, v), 0.1, 0)));

  /* BIẾN */
  root.appendChild(sectionHeader('🧩 Biến (Sự kiện → Hành động)'));
  if (!item.events) item.events = [];
  const evList = el('div');
  item.events.forEach((ev, i) => evList.appendChild(renderEventCard(item, ev, i)));
  root.appendChild(evList);
  const addEv = el('button', 'btn accent', '＋ Thêm biến');
  addEv.style.width = '100%'; addEv.style.marginTop = '4px';
  addEv.onclick = () => {
    item.events.push({
      id: uid(), trigger: 'onShoot', triggerParams: {}, delay: 0,
      action: 'shakeScreen', actionParams: { intensity: 10, duration: 0.5 }
    });
    renderInspector(); renderLayers(); scheduleSave();
  };
  root.appendChild(addEv);
  if (item.events.length) {
    const hint = el('div', 'ev-hint');
    hint.style.marginTop = '8px';
    hint.innerHTML = 'Ví dụ: <b>Bắn đạn</b> → <b>sau 3s</b> → <b>rung màn hình</b>.';
    root.appendChild(hint);
  }
  const del = el('button', 'btn danger full', '🗑 Xoá ' + (isBot ? 'bot' : 'nhân vật'));
  del.onclick = () => deleteItem(item.id);
  root.appendChild(del);
}

function renderBlockInspector(root, item) {
  root.appendChild(el('div', 'ins-head', '⬛ Khối'));
  root.appendChild(row('Tên', textInput(item.name, v => { item.name = v; renderLayers(); })));
  root.appendChild(row('X', numInput(Math.round(item.x), v => item.x = v, 1)));
  root.appendChild(row('Y', numInput(Math.round(item.y), v => item.y = v, 1)));
  root.appendChild(sectionHeader('Kích thước'));
  const sg = el('div', 'grid4');
  sg.appendChild(row('W', numInput(item.w, v => item.w = Math.max(4, v), 1, 4)));
  sg.appendChild(row('H', numInput(item.h, v => item.h = Math.max(4, v), 1, 4)));
  root.appendChild(sg);
  root.appendChild(sectionHeader('Hitbox'));
  root.appendChild(hitboxButton(item));
  root.appendChild(sectionHeader('Thuộc tính'));
  root.appendChild(row('Rắn (đất/tường)', checkbox(item.solid,  v => item.solid  = v)));
  root.appendChild(row('Gây sát thương',  checkbox(item.hazard, v => item.hazard = v)));
  root.appendChild(sectionHeader('🎞️ Animation (bầu trời, mây…)'));
  if (!item.animations) item.animations = { default: emptyAnim() };
  if (!item.animations.default) item.animations.default = emptyAnim();
  const ag = el('div', 'anim-grid');
  ag.appendChild(animSlot(item, 'animations.default', 'Animation khối'));
  root.appendChild(ag);
  root.appendChild(sectionHeader('Texture tĩnh'));
  const grid = el('div', 'anim-grid');
  ['all', 'top', 'bottom', 'left', 'right'].forEach(k => grid.appendChild(texSlot(item, k)));
  root.appendChild(grid);
  const del = el('button', 'btn danger full', '🗑 Xoá khối');
  del.onclick = () => deleteItem(item.id);
  root.appendChild(del);
}

function renderUIInspector(root) {
  const ui = State.ui;
  root.appendChild(el('div', 'ins-head', '🎨 Giao diện'));
  root.appendChild(sectionHeader('Điều khiển'));
  root.appendChild(row('Kiểu', selectInput(ui.mode, [
    ['arrows', 'Nút mũi tên'], ['joystick', 'Joystick']
  ], v => { ui.mode = v; renderInspector(); })));
  if (ui.mode === 'arrows') {
    for (const [key, label] of [['left','Nút ◀'],['right','Nút ▶'],['jump','Nút ▲'],['fire','Nút 🔥']]) {
      root.appendChild(sectionHeader(label));
      const g = el('div', 'grid4');
      g.appendChild(row('X', numInput(ui.layout[key].x, v => ui.layout[key].x = v, 2)));
      g.appendChild(row('Y', numInput(ui.layout[key].y, v => ui.layout[key].y = v, 2)));
      g.appendChild(row('R', numInput(ui.layout[key].r, v => ui.layout[key].r = Math.max(10, v), 1, 10)));
      root.appendChild(g);
    }
  } else {
    root.appendChild(sectionHeader('Joystick base'));
    const g1 = el('div', 'grid4');
    g1.appendChild(row('X', numInput(ui.layout.joyBase.x, v => ui.layout.joyBase.x = v, 2)));
    g1.appendChild(row('Y', numInput(ui.layout.joyBase.y, v => ui.layout.joyBase.y = v, 2)));
    g1.appendChild(row('R', numInput(ui.layout.joyBase.r, v => ui.layout.joyBase.r = Math.max(20, v), 2, 20)));
    root.appendChild(g1);
    root.appendChild(sectionHeader('Joystick knob'));
    const g2 = el('div', 'grid4');
    g2.appendChild(row('R', numInput(ui.layout.joyKnob.r, v => ui.layout.joyKnob.r = Math.max(8, v), 1, 8)));
    root.appendChild(g2);
    root.appendChild(sectionHeader('Nút nhảy'));
    const g3 = el('div', 'grid4');
    g3.appendChild(row('X', numInput(ui.layout.jump.x, v => ui.layout.jump.x = v, 2)));
    g3.appendChild(row('Y', numInput(ui.layout.jump.y, v => ui.layout.jump.y = v, 2)));
    g3.appendChild(row('R', numInput(ui.layout.jump.r, v => ui.layout.jump.r = Math.max(10, v), 1, 10)));
    root.appendChild(g3);
    root.appendChild(sectionHeader('Nút bắn'));
    const g4 = el('div', 'grid4');
    g4.appendChild(row('X', numInput(ui.layout.fire.x, v => ui.layout.fire.x = v, 2)));
    g4.appendChild(row('Y', numInput(ui.layout.fire.y, v => ui.layout.fire.y = v, 2)));
    g4.appendChild(row('R', numInput(ui.layout.fire.r, v => ui.layout.fire.r = Math.max(10, v), 1, 10)));
    root.appendChild(g4);
  }
  root.appendChild(sectionHeader('Nút tùy chỉnh'));
  (ui.buttons || []).forEach((b, i) => {
    const item = el('div');
    item.style.cssText = 'background:var(--card);border:1px solid var(--border2);border-radius:8px;padding:6px;margin-bottom:6px;';
    item.appendChild(row('Nhãn', textInput(b.label, v => b.label = v)));
    item.appendChild(row('Phím', textInput(b.key, v => b.key = v)));
    const g = el('div', 'grid4');
    g.appendChild(row('X', numInput(b.x, v => b.x = v, 2)));
    g.appendChild(row('Y', numInput(b.y, v => b.y = v, 2)));
    g.appendChild(row('W', numInput(b.w, v => b.w = Math.max(20, v), 2, 20)));
    g.appendChild(row('H', numInput(b.h, v => b.h = Math.max(16, v), 2, 16)));
    item.appendChild(g);
    const del = el('button', 'btn-mini danger', '🗑 Xoá');
    del.style.width = '100%'; del.style.padding = '6px';
    del.onclick = () => { ui.buttons.splice(i, 1); renderInspector(); scheduleSave(); };
    item.appendChild(del);
    root.appendChild(item);
  });
  const addB = el('button', 'btn accent full', '＋ Thêm nút tùy chỉnh');
  addB.style.marginTop = '6px';
  addB.onclick = () => {
    ui.buttons.push({ id: uid(), label: 'Nút', key: 'Fire', x: VW/2, y: 60, w: 80, h: 40 });
    renderInspector(); scheduleSave();
  };
  root.appendChild(addB);
  root.appendChild(sectionHeader('Main Menu'));
  root.appendChild(row('Bật main menu', checkbox(ui.mainMenu.enabled, v => {
    ui.mainMenu.enabled = v; renderInspector();
  })));
  if (ui.mainMenu.enabled) {
    root.appendChild(row('Tiêu đề', textInput(ui.mainMenu.title, v => ui.mainMenu.title = v)));
    root.appendChild(row('Phụ đề',  textInput(ui.mainMenu.subtitle, v => ui.mainMenu.subtitle = v)));
    root.appendChild(row('Màu nền',  colorInput(ui.mainMenu.bg, v => ui.mainMenu.bg = v)));
    root.appendChild(row('Màu tiêu đề', colorInput(ui.mainMenu.titleColor, v => ui.mainMenu.titleColor = v)));
    root.appendChild(row('Màu phụ đề', colorInput(ui.mainMenu.subColor, v => ui.mainMenu.subColor = v)));
  }
  const reset = el('button', 'btn danger full', '↺ Reset UI về mặc định');
  reset.onclick = () => { State.ui = RT.defaultUI(); renderInspector(); scheduleSave(); };
  root.appendChild(reset);
}

/* ---------- CRUD ---------- */
function addSprite() {
  const s = makeSprite({});
  State.items.push(s); State.selectedId = s.id; State.tab = 'scene';
  document.getElementById('btnUI').classList.remove('on');
  refreshAll(); scheduleSave(); toast('Đã thêm nhân vật', 'ok');
}
function addBot() {
  const b = makeBot({});
  State.items.push(b); State.selectedId = b.id; State.tab = 'scene';
  document.getElementById('btnUI').classList.remove('on');
  refreshAll(); scheduleSave(); toast('Đã thêm bot', 'ok');
}
function addBlock() {
  const b = makeBlock({});
  State.items.push(b); State.selectedId = b.id; State.tab = 'scene';
  document.getElementById('btnUI').classList.remove('on');
  refreshAll(); scheduleSave(); toast('Đã thêm khối', 'ok');
}
function deleteItem(id) {
  const idx = State.items.findIndex(i => i.id === id);
  if (idx < 0) return;
  State.items.splice(idx, 1);
  if (State.selectedId === id) State.selectedId = null;
  refreshAll(); scheduleSave();
}
function selectItem(id) {
  State.selectedId = id; State.uiSelected = null;
  State.tab = 'scene';
  document.getElementById('btnUI').classList.remove('on');
  refreshAll();
}
function refreshAll() { renderLayers(); renderInspector(); }

/* ---------- PLAY/STOP ---------- */
function play() {
  for (const it of State.items) {
    if (it.kind === 'sprite') {
      it.hp = it.maxHp;
      it._vx = 0; it._vy = 0; it._onGround = false;
      it._invuln = 0; it._dead = false; it._shootCd = 0; it._shootAnimTime = 0;
      it._state = 'idle'; it._prevState = 'idle';
      it._animFrame = 0; it._animTime = 0;
      it._facing = 1;
      it._patrolOrigin = undefined; it._patrolDir = 1;
      it._pendingShots = [];
      it._pendingActions = [];
      it._everyTimers = {}; it._keyState = {};
      it._idleFired = {}; it._touchSet = new Set();
      it._flash = null; it._speedBuff = null; it._gravityBuff = null; it._scaleBuff = null;
      it._startFired = false; it._prevHp = null;
      it._idleTime = 0; it._nearPlayer = false;
    } else if (it.kind === 'block') {
      it._animFrame = 0; it._animTime = 0;
    }
  }
  State.keys = {};
  State.pointerToBtn.clear();
  State.joystick.active = false; State.joystick.pointerId = null;
  State.projectiles = []; State.particles = []; State.floatingTexts = [];
  State.shakeScreen = { intensity: 0, timeLeft: 0, duration: 0.001 };
  State.camera = { x: VW/2, y: VH/2 };
  State.showMenu = !!(State.ui.mainMenu && State.ui.mainMenu.enabled);
  State.playing = true;
  document.getElementById('btnPlay').disabled = true;
  document.getElementById('btnStop').disabled = false;
  document.getElementById('inspector').classList.add('hidden');
  document.getElementById('btnPan').classList.remove('on');
  State.panMode = false;
  document.getElementById('stageWrap').classList.remove('panmode');
  startBgMusic();
}
function stop() {
  State.playing = false;
  State.showMenu = false;
  State.keys = {};
  State.pointerToBtn.clear();
  State.joystick.active = false;
  State.projectiles = []; State.particles = []; State.floatingTexts = [];
  State.shakeScreen = { intensity: 0, timeLeft: 0, duration: 0.001 };
  document.getElementById('btnPlay').disabled = false;
  document.getElementById('btnStop').disabled = true;
  document.getElementById('inspector').classList.remove('hidden');
  stopBgMusic();
}

/* ---------- BG MUSIC ---------- */
function startBgMusic() {
  stopBgMusic();
  if (!State.bgMusic || !State.bgMusic.url) return;
  try {
    bgAudioEl = new Audio(State.bgMusic.url);
    bgAudioEl.loop = State.bgMusic.loop !== false;
    bgAudioEl.volume = State.bgMusic.volume != null ? State.bgMusic.volume : 0.6;
    const p = bgAudioEl.play();
    if (p && p.catch) p.catch(() => {});
  } catch (e) { console.warn('bgMusic', e); }
}
function stopBgMusic() {
  if (bgAudioEl) {
    try { bgAudioEl.pause(); bgAudioEl.currentTime = 0; } catch (e) {}
    bgAudioEl = null;
  }
}

/* ---------- POINTER ---------- */
function onPointerDown(e) {
  e.preventDefault();
  if (State.playing && State.showMenu) { State.showMenu = false; return; }
  if (State.playing) {
    const p = toStage(e.clientX, e.clientY);
    const key = RT.hitUIButton(p, State.ui);
    if (key === '__joy__') {
      State.joystick.active = true; State.joystick.pointerId = e.pointerId;
      State.keys['_joy_active'] = true;
      State.keys['_joy_x'] = 0; State.keys['_joy_y'] = 0;
      try { canvas.setPointerCapture(e.pointerId); } catch(_){}
      return;
    }
    if (key) {
      State.pointerToBtn.set(e.pointerId, key);
      State.keys[key] = true;
      try { canvas.setPointerCapture(e.pointerId); } catch(_){}
    }
    return;
  }
  if (State.tab === 'ui') {
    const p = toStage(e.clientX, e.clientY);
    const hit = hitUIAt(p);
    if (hit) {
      State.uiSelected = hit;
      State.uiDrag = { kind: hit.kind, key: hit.key, dx: p.x - hit.x, dy: p.y - hit.y };
      try { canvas.setPointerCapture(e.pointerId); } catch(_){}
      renderInspector();
      return;
    }
    State.uiSelected = null; renderInspector();
    return;
  }
  if (State.panMode) {
    State.panStart = { sx: e.clientX, sy: e.clientY, cx: State.editCam.x, cy: State.editCam.y };
    try { canvas.setPointerCapture(e.pointerId); } catch(_){}
    return;
  }
  const p = toStage(e.clientX, e.clientY);
  const w = toWorld(p.x, p.y);
  for (let i = State.items.length - 1; i >= 0; i--) {
    const item = State.items[i];
    const b = RT.getBounds(item);
    if (w.x >= b.x && w.x <= b.x + b.w && w.y >= b.y && w.y <= b.y + b.h) {
      selectItem(item.id);
      State.drag = { id: item.id, dx: w.x - item.x, dy: w.y - item.y };
      try { canvas.setPointerCapture(e.pointerId); } catch(_){}
      return;
    }
  }
  selectItem(null);
}
function hitUIAt(p) {
  const ui = State.ui, L = ui.layout;
  const tryBtn = (key, b) => {
    if (!b) return null;
    const dx = p.x - b.x, dy = p.y - b.y;
    if (dx*dx + dy*dy <= (b.r + 6)*(b.r + 6)) return { kind: 'layout', key, x: b.x, y: b.y };
    return null;
  };
  if (ui.mode === 'joystick') {
    let h;
    if ((h = tryBtn('jump', L.jump))) return h;
    if ((h = tryBtn('fire', L.fire))) return h;
    if ((h = tryBtn('joyBase', L.joyBase))) return h;
  } else {
    let h;
    if ((h = tryBtn('left',  L.left)))  return h;
    if ((h = tryBtn('right', L.right))) return h;
    if ((h = tryBtn('jump',  L.jump)))  return h;
    if ((h = tryBtn('fire',  L.fire)))  return h;
  }
  if (ui.buttons) {
    for (const b of ui.buttons) {
      const w = b.w || 70, h = b.h || 40;
      if (p.x >= b.x - w/2 && p.x <= b.x + w/2 && p.y >= b.y - h/2 && p.y <= b.y + h/2)
        return { kind: 'custom', key: b.id, x: b.x, y: b.y };
    }
  }
  return null;
}
function onPointerMove(e) {
  if (State.playing && State.showMenu) return;
  if (State.playing) {
    const p = toStage(e.clientX, e.clientY);
    if (State.joystick.active && e.pointerId === State.joystick.pointerId) {
      const L = State.ui.layout.joyBase;
      let dx = p.x - L.x, dy = p.y - L.y;
      const dist = Math.sqrt(dx*dx + dy*dy);
      if (dist > L.r) { dx = dx / dist * L.r; dy = dy / dist * L.r; }
      State.keys['_joy_x'] = dx / L.r;
      State.keys['_joy_y'] = dy / L.r;
      return;
    }
    if (!State.pointerToBtn.has(e.pointerId)) return;
    const key = State.pointerToBtn.get(e.pointerId);
    State.keys[key] = RT.hitUIButton(p, State.ui) === key;
    return;
  }
  if (State.tab === 'ui' && State.uiDrag) {
    const p = toStage(e.clientX, e.clientY);
    const d = State.uiDrag;
    if (d.kind === 'layout') {
      State.ui.layout[d.key].x = p.x - d.dx;
      State.ui.layout[d.key].y = p.y - d.dy;
    } else if (d.kind === 'custom') {
      const b = State.ui.buttons.find(x => x.id === d.key);
      if (b) { b.x = p.x - d.dx; b.y = p.y - d.dy; }
    }
    return;
  }
  if (State.panMode && State.panStart) {
    const scale = VW / canvas.getBoundingClientRect().width;
    const dx = (e.clientX - State.panStart.sx) * scale;
    const dy = (e.clientY - State.panStart.sy) * scale;
    State.editCam.x = State.panStart.cx - dx;
    State.editCam.y = State.panStart.cy - dy;
    updateCamInfo();
    return;
  }
  if (!State.drag) return;
  const p = toStage(e.clientX, e.clientY);
  const w = toWorld(p.x, p.y);
  const item = State.items.find(i => i.id === State.drag.id);
  if (!item) return;
  item.x = w.x - State.drag.dx;
  item.y = w.y - State.drag.dy;
}
function onPointerUp(e) {
  if (State.playing) {
    if (State.joystick.active && e.pointerId === State.joystick.pointerId) {
      State.joystick.active = false; State.joystick.pointerId = null;
      State.keys['_joy_active'] = false;
      State.keys['_joy_x'] = 0; State.keys['_joy_y'] = 0;
      return;
    }
    const key = State.pointerToBtn.get(e.pointerId);
    if (key) { State.keys[key] = false; State.pointerToBtn.delete(e.pointerId); }
    return;
  }
  if (State.uiDrag) { State.uiDrag = null; scheduleSave(); return; }
  if (State.panStart) { State.panStart = null; return; }
  if (State.drag) { State.drag = null; renderInspector(); scheduleSave(); }
}
function onKeyDown(e) {
  State.keys[e.key] = true;
  if (State.playing && [' ','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].indexOf(e.key) >= 0) e.preventDefault();
}
function onKeyUp(e) { State.keys[e.key] = false; }
function updateCamInfo() {
  document.getElementById('camInfo').textContent =
    'Camera: ' + Math.round(State.editCam.x) + ', ' + Math.round(State.editCam.y);
}

/* ---------- MAIN LOOP ---------- */
let lastT = 0;
function loop(t) {
  if (!lastT) lastT = t;
  let dt = (t - lastT) / 1000;
  lastT = t;
  if (dt > 0.05) dt = 0.05;
  if (dt < 0) dt = 0;

  // FPS counter
  State._fpsAcc += dt;
  State._fpsFrames++;
  if (State._fpsAcc >= 0.5) {
    State.fps = Math.round(State._fpsFrames / State._fpsAcc);
    State._fpsAcc = 0;
    State._fpsFrames = 0;
  }

  if (State.playing && !State.showMenu) {
    State.time += dt;
    for (const it of State.items) {
      if (it.kind === 'sprite') RT.updateItem(State, it, dt, State.keys);
      else if (it.kind === 'block') RT.updateBlock(it, dt);
    }
    RT.updateProjectiles(State, dt);
    RT.updateParticles(State, dt);
    RT.updateFloatingTexts(State, dt);
    RT.updateShake(State, dt);
    RT.updateCamera(State, dt);
  } else if (State.playing && State.showMenu) {
    for (const it of State.items) {
      if (it.kind === 'sprite') RT.updateItem(State, it, dt, {});
      else if (it.kind === 'block') RT.updateBlock(it, dt);
    }
    RT.updateParticles(State, dt);
    RT.updateFloatingTexts(State, dt);
    RT.updateShake(State, dt);
  } else {
    for (const it of State.items) {
      if (it.kind === 'block' && it.animations && it.animations.default &&
          it.animations.default.frames.length > 1) RT.updateBlock(it, dt);
    }
  }

  RT.render(ctx, State, { editor: !State.playing });
  if (!State.playing && State.tab === 'ui') drawUIEditorOverlay();

  // FPS overlay
  if (State.settings.showFps && State.playing) drawFpsOverlay();

  requestAnimationFrame(loop);
}
function drawFpsOverlay() {
  ctx.save();
  const text = State.fps + ' FPS';
  ctx.font = 'bold 11px ui-monospace, monospace';
  const w = ctx.measureText(text).width + 14;
  ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--fps-bg').trim() || 'rgba(0,0,0,.55)';
  ctx.fillRect(6, 6, w, 20);
  ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--fps-fg').trim() || '#7cffb0';
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  ctx.fillText(text, 13, 17);
  ctx.restore();
}
function drawUIEditorOverlay() {
  const ui = State.ui, L = ui.layout;
  ctx.save();
  if (ui.mainMenu.enabled) {
    ctx.fillStyle = ui.mainMenu.bg || '#0e1116';
    ctx.fillRect(0, 0, VW, VH);
    ctx.fillStyle = ui.mainMenu.titleColor || '#ffb86b';
    ctx.font = 'bold 44px system-ui, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(ui.mainMenu.title || 'Game', VW/2, VH/2 - 24);
    ctx.fillStyle = ui.mainMenu.subColor || '#a8b6cc';
    ctx.font = '16px system-ui, sans-serif';
    ctx.fillText(ui.mainMenu.subtitle || 'Nhấn để bắt đầu', VW/2, VH/2 + 28);
  }
  const ghost = (b, key, label) => {
    if (!b) return;
    const sel = State.uiSelected && State.uiSelected.kind === 'layout' && State.uiSelected.key === key;
    ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, Math.PI*2);
    ctx.fillStyle = 'rgba(124,92,255,.2)'; ctx.fill();
    ctx.strokeStyle = sel ? '#ffb86b' : 'rgba(124,92,255,.7)';
    ctx.lineWidth = sel ? 2.5 : 1.5; ctx.stroke();
    ctx.fillStyle = '#e6e9ef';
    ctx.font = 'bold 12px system-ui, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(label, b.x, b.y);
  };
  if (ui.mode === 'joystick') {
    ghost(L.joyBase, 'joyBase', 'JOY');
    ghost(L.jump, 'jump', '▲');
    ghost(L.fire, 'fire', '🔥');
  } else {
    ghost(L.left, 'left', '◀');
    ghost(L.right, 'right', '▶');
    ghost(L.jump, 'jump', '▲');
    ghost(L.fire, 'fire', '🔥');
  }
  if (ui.buttons) {
    for (const b of ui.buttons) {
      const sel = State.uiSelected && State.uiSelected.kind === 'custom' && State.uiSelected.key === b.id;
      const w = b.w || 70, h = b.h || 40;
      const x = b.x - w/2, y = b.y - h/2;
      ctx.save();
      ctx.beginPath();
      const r = 10;
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + w, y, x + w, y + h, r);
      ctx.arcTo(x + w, y + h, x, y + h, r);
      ctx.arcTo(x, y + h, x, y, r);
      ctx.arcTo(x, y, x + w, y, r);
      ctx.closePath();
      ctx.fillStyle = 'rgba(124,92,255,.2)'; ctx.fill();
      ctx.strokeStyle = sel ? '#ffb86b' : 'rgba(124,92,255,.7)';
      ctx.lineWidth = sel ? 2.5 : 1.5; ctx.stroke();
      ctx.fillStyle = '#e6e9ef';
      ctx.font = 'bold 12px system-ui, sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(b.label || b.key, b.x, b.y);
      ctx.restore();
    }
  }
  ctx.restore();
}

/* ---------- SERIALIZE ---------- */
function serializeAnim(anim) {
  if (!anim) return null;
  return {
    frames: anim.frames.map(f => ({ url: f.url })),
    fps: anim.fps || 8,
    loop: anim.loop !== false
  };
}
function serializeEvents(events) {
  if (!events || !events.length) return [];
  return events.map(ev => ({
    id: ev.id, trigger: ev.trigger,
    triggerParams: JSON.parse(JSON.stringify(ev.triggerParams || {})),
    delay: ev.delay != null ? ev.delay : 0,
    action: ev.action,
    actionParams: JSON.parse(JSON.stringify(ev.actionParams || {}))
  }));
}
function serialize() {
  return {
    vw: VW, vh: VH,
    ui: JSON.parse(JSON.stringify(State.ui)),
    bgMusic: {
      url: State.bgMusic.url || null,
      volume: State.bgMusic.volume != null ? State.bgMusic.volume : 0.6,
      loop: State.bgMusic.loop !== false
    },
    items: State.items.map(it => {
      if (it.kind === 'sprite') {
        const animations = {};
        for (const k in it.animations) animations[k] = serializeAnim(it.animations[k]);
        return {
          kind: 'sprite', id: it.id, name: it.name,
          x: it.x, y: it.y, w: it.w, h: it.h,
          hb: { ox: it.hb.ox, oy: it.hb.oy, hw: it.hb.hw, hh: it.hb.hh },
          hitboxes: (it.hitboxes || []).map(h => ({ ox: h.ox, oy: h.oy, w: h.w, h: h.h })),
          events: serializeEvents(it.events),
          control: it.control, camera: !!it.camera, hpMode: it.hpMode || 'default',
          animations,
          shoot: {
            enabled: !!it.shoot.enabled, url: it.shoot.url || null,
            offsetX: it.shoot.offsetX || 0, offsetY: it.shoot.offsetY || 0,
            angle: it.shoot.angle || 0,
            delay: it.shoot.delay || 0,
            cooldown: it.shoot.cooldown != null ? it.shoot.cooldown : 0.3,
            damage: it.shoot.damage != null ? it.shoot.damage : 10,
            speed: it.shoot.speed != null ? it.shoot.speed : 8,
            bulletW: it.shoot.bulletW != null ? it.shoot.bulletW : 14,
            bulletH: it.shoot.bulletH != null ? it.shoot.bulletH : 14,
            useGravity: !!it.shoot.useGravity,
            bulletGravity: it.shoot.bulletGravity != null ? it.shoot.bulletGravity : 5,
            animation: serializeAnim(it.shoot.animation || emptyAnim())
          },
          botRange: it.botRange != null ? it.botRange : 150,
          botPatrol: it.botPatrol != null ? it.botPatrol : 80,
          speed: it.speed, jumpPower: it.jumpPower, gravity: it.gravity,
          hp: it.hp, maxHp: it.maxHp, iframe: it.iframe
        };
      }
      const tex = {};
      for (const k in it.tex) {
        const a = it.tex[k];
        tex[k] = a ? { url: a.url } : null;
      }
      return {
        kind: 'block', id: it.id, name: it.name,
        x: it.x, y: it.y, w: it.w, h: it.h,
        solid: it.solid, hazard: it.hazard, tex,
        hitboxes: (it.hitboxes || []).map(h => ({ ox: h.ox, oy: h.oy, w: h.w, h: h.h })),
        animations: { default: serializeAnim(it.animations && it.animations.default) }
      };
    })
  };
}
function deserialize(data) {
  State.items = [];
  State.selectedId = null;
  State.ui = (data && data.ui) ? JSON.parse(JSON.stringify(data.ui)) : RT.defaultUI();
  State.bgMusic = (data && data.bgMusic) ? {
    url: data.bgMusic.url || null,
    volume: data.bgMusic.volume != null ? data.bgMusic.volume : 0.6,
    loop: data.bgMusic.loop !== false
  } : { url: null, volume: 0.6, loop: true };
  const items = (data && data.items) || [];
  let pending = 0;
  const doneOne = () => { pending--; if (pending === 0) refreshAll(); };
  const track = (p) => { pending++; Promise.resolve(p).then(doneOne); };
  for (const d of items) {
    if (d.kind === 'sprite') {
      const animations = {};
      const srcAnims = d.animations || {};
      for (const k in srcAnims) {
        const a = srcAnims[k];
        if (!a) { animations[k] = emptyAnim(); continue; }
        animations[k] = {
          frames: (a.frames || []).map(f => ({ url: f.url, img: null })),
          fps: a.fps || 8, loop: a.loop !== false
        };
      }
      ['idle','run','jump','hurt','die','shoot'].forEach(k => {
        if (!animations[k]) animations[k] = emptyAnim();
      });
      const sh = d.shoot || {};
      const shoot = {
        enabled: !!sh.enabled, url: sh.url || null, img: null,
        offsetX: sh.offsetX || 0, offsetY: sh.offsetY || 0,
        angle: sh.angle || 0,
        delay: sh.delay || 0,
        cooldown: sh.cooldown != null ? sh.cooldown : 0.3,
        damage: sh.damage != null ? sh.damage : 10,
        speed: sh.speed != null ? sh.speed : 8,
        bulletW: sh.bulletW != null ? sh.bulletW : 14,
        bulletH: sh.bulletH != null ? sh.bulletH : 14,
        useGravity: !!sh.useGravity,
        bulletGravity: sh.bulletGravity != null ? sh.bulletGravity : 5,
        animation: sh.animation ? {
          frames: (sh.animation.frames || []).map(f => ({ url: f.url, img: null })),
          fps: sh.animation.fps || 8,
          loop: sh.animation.loop !== false
        } : emptyAnim()
      };
      const hitboxes = (d.hitboxes || []).map(h => ({
        ox: h.ox || 0, oy: h.oy || 0,
        w: Math.max(1, h.w || 1), h: Math.max(1, h.h || 1)
      }));
      const events = (d.events || []).map(e => ({
        id: e.id || uid(),
        trigger: e.trigger || 'onStart',
        triggerParams: Object.assign({}, e.triggerParams || {}),
        delay: e.delay != null ? e.delay : 0,
        action: e.action || 'shakeScreen',
        actionParams: Object.assign({}, e.actionParams || {})
      }));
      const sp = makeSprite({
        id: d.id || uid(), name: d.name,
        x: d.x, y: d.y, w: d.w, h: d.h,
        hb: d.hb, hitboxes, events,
        control: d.control,
        camera: !!d.camera, hpMode: d.hpMode || 'default',
        animations, shoot,
        botRange: d.botRange != null ? d.botRange : 150,
        botPatrol: d.botPatrol != null ? d.botPatrol : 80,
        speed: d.speed, jumpPower: d.jumpPower, gravity: d.gravity,
        hp: d.hp, maxHp: d.maxHp || d.hp, iframe: d.iframe
      });
      State.items.push(sp);
      for (const k in animations) {
        const anim = animations[k];
        for (const f of anim.frames) track(loadImage(f.url).then(img => { f.img = img; }));
      }
      if (shoot.url) track(loadImage(shoot.url).then(img => { shoot.img = img; }));
      for (const f of shoot.animation.frames) track(loadImage(f.url).then(img => { f.img = img; }));
    } else {
      const tex = {};
      for (const k in d.tex) tex[k] = d.tex[k] ? { url: d.tex[k].url, img: null } : null;
      const hitboxes = (d.hitboxes || []).map(h => ({
        ox: h.ox || 0, oy: h.oy || 0,
        w: Math.max(1, h.w || 1), h: Math.max(1, h.h || 1)
      }));
      const srcAnim = (d.animations && d.animations.default) || null;
      const blockAnim = srcAnim ? {
        frames: (srcAnim.frames || []).map(f => ({ url: f.url, img: null })),
        fps: srcAnim.fps || 8,
        loop: srcAnim.loop !== false
      } : emptyAnim();
      const bl = makeBlock({
        id: d.id || uid(), name: d.name,
        x: d.x, y: d.y, w: d.w, h: d.h,
        solid: d.solid, hazard: d.hazard, tex, hitboxes,
        animations: { default: blockAnim }
      });
      State.items.push(bl);
      for (const k in bl.tex) {
        const a = bl.tex[k];
        if (!a) continue;
        track(loadImage(a.url).then(img => { a.img = img; }));
      }
      for (const f of blockAnim.frames) track(loadImage(f.url).then(img => { f.img = img; }));
    }
  }
  refreshAll();
}

/* ---------- AUTO-SAVE + MANUAL SAVE ---------- */
function scheduleSave() {
  if (!State.currentProjectId) return;
  if (!State.settings.autoSave) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { manualSave(true); }, 900);
}
function manualSave(silent) {
  if (!State.currentProjectId) {
    if (!silent) toast('Chưa có dự án', 'err');
    return false;
  }
  try {
    const data = serialize();
    const ok = Projects.save(State.currentProjectId, data);
    if (ok) {
      if (!silent) toast('💾 Đã lưu dự án', 'ok');
      return true;
    } else {
      if (!silent) toast('⚠️ Không thể lưu (bộ nhớ đầy?) — dùng Xuất .mnhr', 'err', 4000);
      return false;
    }
  } catch (e) {
    console.error(e);
    if (!silent) toast('❌ Lỗi lưu: ' + e.message, 'err', 4000);
    return false;
  }
}
function loadProject(proj) {
  if (!proj) return;
  State.currentProjectId = proj.id;
  Projects.setCurrent(proj.id);
  deserialize(proj.data);
  State.editCam = { x: VW/2, y: VH/2 };
  updateCamInfo();
}

/* ---------- .mnhr EXPORT/IMPORT ---------- */
function exportMnhr() {
  try {
    const data = serialize();
    const payload = {
      format: 'mnhr',
      version: 1,
      name: (Projects.get(State.currentProjectId) || {}).name || 'project',
      savedAt: Date.now(),
      data
    };
    const text = JSON.stringify(payload, null, 2);
    const blob = new Blob([text], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const nameSafe = (payload.name || 'project').replace(/[^a-zA-Z0-9_\-]/g, '_').slice(0, 40);
    a.download = nameSafe + '.mnhr';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 2000);
    toast('💾 Đã xuất file .mnhr', 'ok', 3000);
  } catch (e) {
    console.error(e);
    toast('Lỗi xuất .mnhr: ' + e.message, 'err');
  }
}
async function importMnhr() {
  const files = await pickFiles({ accept: '.mnhr,.json,application/json' });
  if (!files.length) return;
  const text = await readAsText(files[0]);
  if (!text) { toast('Không đọc được file', 'err'); return; }
  let payload;
  try { payload = JSON.parse(text); }
  catch (e) { toast('File JSON không hợp lệ', 'err'); return; }
  const data = payload.data || payload;
  if (!data || !data.items) { toast('File .mnhr không hợp lệ', 'err'); return; }
  const name = payload.name || (files[0].name || 'Dự án nhập').replace(/\.[^.]+$/, '');
  const proj = Projects.create(name);
  Projects.save(proj.id, data);
  loadProject(proj);
  toast('📂 Đã nhập dự án: ' + name, 'ok', 3000);
}

/* ---------- SETTINGS MODAL ---------- */
function renderSettings() {
  const body = document.getElementById('settingsBody');
  body.innerHTML = '';
  const s = State.settings;

  body.appendChild(sectionHeader('Giao diện'));
  body.appendChild(row('Theme', selectInput(s.theme, [
    ['dark', '🌙 Dark (mặc định)'], ['light', '☀️ Light']
  ], v => { s.theme = v; applyTheme(); Projects.saveSettings(); })));

  body.appendChild(row('Hiện FPS', checkbox(s.showFps, v => {
    s.showFps = v; Projects.saveSettings();
  })));

  body.appendChild(row('Max FPS', selectInput(String(s.maxFps), [
    ['30', '30 FPS'], ['60', '60 FPS'], ['120', '120 FPS (VSync)']
  ], v => { s.maxFps = parseInt(v, 10); Projects.saveSettings(); })));

  body.appendChild(sectionHeader('Lưu trữ'));
  body.appendChild(row('Tự động lưu', checkbox(s.autoSave, v => {
    s.autoSave = v;
    Projects.saveSettings();
    toast(v ? 'Auto-save: BẬT' : 'Auto-save: TẮT', 'ok', 1500);
  })));
  body.appendChild(el('div', 'ev-hint',
    'Auto-save lưu vào localStorage. Với ảnh lớn có thể bị đầy (5-10MB). Dùng <b>💾 Xuất .mnhr</b> để backup chắc chắn.'));

  body.appendChild(sectionHeader('🎵 Nhạc nền'));
  const bgWrap = el('div');
  bgWrap.style.cssText = 'background:var(--card);border:1px solid var(--border2);border-radius:9px;padding:10px;';
  const bgInfo = el('div');
  bgInfo.style.cssText = 'font-size:11px;color:var(--text2);margin-bottom:6px;';
  bgInfo.textContent = State.bgMusic.url ? '✓ Đã có nhạc nền' : 'Chưa có nhạc nền';
  bgWrap.appendChild(bgInfo);
  const bgBtns = el('div');
  bgBtns.style.cssText = 'display:flex;gap:6px;';
  const importB = el('button', 'btn accent', '📁 Chọn nhạc');
  importB.onclick = async () => {
    const files = await pickFiles({ accept: 'audio/*' });
    if (!files.length) return;
    const url = await readAsDataURL(files[0]);
    if (!url) { toast('Không đọc được file', 'err'); return; }
    State.bgMusic.url = url;
    renderSettings(); scheduleSave();
    toast('Đã import nhạc nền', 'ok');
  };
  bgBtns.appendChild(importB);
  if (State.bgMusic.url) {
    const clearB = el('button', 'btn-mini danger', '🗑 Xoá');
    clearB.style.cssText = 'flex:0 0 auto;padding:6px 12px;font-size:11px;';
    clearB.onclick = () => {
      State.bgMusic.url = null;
      renderSettings(); scheduleSave();
    };
    bgBtns.appendChild(clearB);
  }
  bgWrap.appendChild(bgBtns);
  body.appendChild(bgWrap);

  body.appendChild(row('Âm lượng', numInput(
    Math.round((State.bgMusic.volume != null ? State.bgMusic.volume : 0.6) * 100),
    v => { State.bgMusic.volume = clamp(v, 0, 100) / 100; scheduleSave(); },
    5, 0, 100)));

  body.appendChild(row('Lặp lại', checkbox(State.bgMusic.loop !== false, v => {
    State.bgMusic.loop = v; scheduleSave();
  })));

  body.appendChild(sectionHeader('Dự án'));
  body.appendChild(el('div', 'ev-hint',
    'Xuất .mnhr để backup toàn bộ dự án (bao gồm ảnh/âm thanh) thành 1 file JSON. Nhập lại để khôi phục.'));

  const mnhrBtns = el('div');
  mnhrBtns.style.cssText = 'display:flex;gap:6px;margin-top:6px;';
  const expB = el('button', 'btn accent', '💾 Xuất .mnhr');
  expB.style.flex = '1';
  expB.onclick = exportMnhr;
  const impB = el('button', 'btn accent', '📂 Nhập .mnhr');
  impB.style.flex = '1';
  impB.onclick = importMnhr;
  mnhrBtns.appendChild(expB); mnhrBtns.appendChild(impB);
  body.appendChild(mnhrBtns);

  const saveB = el('button', 'btn primary full', '💾 Lưu vào trình duyệt ngay');
  saveB.onclick = () => manualSave(false);
  body.appendChild(saveB);
}

/* ============================================================
   EXPORTER (assets folder + options)
   ============================================================ */
const Exporter = (function () {
  const CRC_TABLE = (function () {
    const t = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[i] = c >>> 0;
    }
    return t;
  })();
  function crc32(bytes) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }
  function makeZip(files) {
    const enc = new TextEncoder();
    const entries = [], parts = [];
    let offset = 0;
    for (const name in files) {
      const nameBytes = enc.encode(name);
      const raw = files[name];
      const dataBytes = typeof raw === 'string' ? enc.encode(raw) : raw;
      const crc = crc32(dataBytes);
      const size = dataBytes.length;
      const lfh = new Uint8Array(30 + nameBytes.length);
      const dv = new DataView(lfh.buffer);
      dv.setUint32(0, 0x04034b50, true); dv.setUint16(4, 20, true);
      dv.setUint16(6, 0, true); dv.setUint16(8, 0, true);
      dv.setUint16(10, 0, true); dv.setUint16(12, 0, true);
      dv.setUint32(14, crc, true); dv.setUint32(18, size, true); dv.setUint32(22, size, true);
      dv.setUint16(26, nameBytes.length, true); dv.setUint16(28, 0, true);
      lfh.set(nameBytes, 30);
      entries.push({ nameBytes, crc, size, offset });
      parts.push(lfh, dataBytes);
      offset += lfh.length + dataBytes.length;
    }
    const cdStart = offset, cdParts = [];
    for (const e of entries) {
      const cdh = new Uint8Array(46 + e.nameBytes.length);
      const dv = new DataView(cdh.buffer);
      dv.setUint32(0, 0x02014b50, true); dv.setUint16(4, 20, true); dv.setUint16(6, 20, true);
      dv.setUint16(8, 0, true); dv.setUint16(10, 0, true); dv.setUint16(12, 0, true);
      dv.setUint16(14, 0, true); dv.setUint32(16, e.crc, true);
      dv.setUint32(20, e.size, true); dv.setUint32(24, e.size, true);
      dv.setUint16(28, e.nameBytes.length, true); dv.setUint16(30, 0, true);
      dv.setUint16(32, 0, true); dv.setUint16(34, 0, true);
      dv.setUint16(36, 0, true); dv.setUint32(38, 0, true); dv.setUint32(42, e.offset, true);
      cdh.set(e.nameBytes, 46);
      cdParts.push(cdh);
      offset += cdh.length;
    }
    const eocd = new Uint8Array(22);
    const dv = new DataView(eocd.buffer);
    dv.setUint32(0, 0x06054b50, true); dv.setUint16(4, 0, true); dv.setUint16(6, 0, true);
    dv.setUint16(8, entries.length, true); dv.setUint16(10, entries.length, true);
    dv.setUint32(12, offset - cdStart, true); dv.setUint32(16, cdStart, true);
    dv.setUint16(20, 0, true);
    const total = offset + eocd.length;
    const out = new Uint8Array(total);
    let p = 0;
    for (const part of parts)   { out.set(part, p); p += part.length; }
    for (const part of cdParts) { out.set(part, p); p += part.length; }
    out.set(eocd, p);
    return out;
  }

  function dataUrlExt(url) {
    const m = /^data:([^;]+);/.exec(url);
    const mime = m ? m[1] : 'image/png';
    if (mime.includes('jpeg') || mime.includes('jpg')) return 'jpg';
    if (mime.includes('gif')) return 'gif';
    if (mime.includes('webp')) return 'webp';
    if (mime.includes('svg')) return 'svg';
    if (mime.includes('png')) return 'png';
    if (mime.includes('mpeg') || mime.includes('mp3')) return 'mp3';
    if (mime.includes('ogg')) return 'ogg';
    if (mime.includes('wav')) return 'wav';
    if (mime.includes('m4a') || mime.includes('mp4')) return 'm4a';
    if (mime.includes('webm')) return 'webm';
    return 'bin';
  }
  function dataUrlToBytes(dataUrl) {
    const idx = dataUrl.indexOf(',');
    const b64 = dataUrl.slice(idx + 1);
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  }

  function buildPackage(data, customCode, opts) {
    opts = opts || {};
    const separateAssets = opts.separateAssets !== false;
    const renderScale = opts.renderScale || 1;
    const maxFps = opts.maxFps || 60;

    const assetsMap = {};
    let assetIdx = 0;
    function registerAsset(url) {
      if (!url || !url.startsWith('data:')) return url;
      if (assetsMap[url]) return assetsMap[url];
      const ext = dataUrlExt(url);
      const path = 'assets/asset_' + (assetIdx++) + '.' + ext;
      assetsMap[url] = path;
      return path;
    }

    const dataForExport = JSON.parse(JSON.stringify(data));
    if (dataForExport.bgMusic && dataForExport.bgMusic.url) {
      if (separateAssets) dataForExport.bgMusic.url = registerAsset(dataForExport.bgMusic.url);
    }
    for (const it of dataForExport.items) {
      if (it.kind === 'sprite') {
        for (const k in it.animations) {
          const anim = it.animations[k];
          if (!anim || !anim.frames) continue;
          for (const f of anim.frames) {
            if (separateAssets) f.url = registerAsset(f.url);
          }
        }
        if (it.shoot) {
          if (it.shoot.url && separateAssets) it.shoot.url = registerAsset(it.shoot.url);
          if (it.shoot.animation && it.shoot.animation.frames) {
            for (const f of it.shoot.animation.frames) {
              if (separateAssets) f.url = registerAsset(f.url);
            }
          }
        }
      } else if (it.kind === 'block') {
        for (const k in it.tex) {
          if (it.tex[k] && separateAssets) it.tex[k].url = registerAsset(it.tex[k].url);
        }
        if (it.animations && it.animations.default) {
          for (const f of it.animations.default.frames) {
            if (separateAssets) f.url = registerAsset(f.url);
          }
        }
      }
    }

    const html = buildHTML(dataForExport, customCode, { renderScale, maxFps });
    const files = { 'index.html': html };
    if (separateAssets) {
      for (const url in assetsMap) files[assetsMap[url]] = dataUrlToBytes(url);
    }
    files['README.txt'] =
      'MNHR-engine Export\r\n==================\r\n' +
      (separateAssets
        ? 'Thư mục assets/ chứa toàn bộ ảnh & âm thanh.\r\n'
        : 'Toàn bộ assets được nhúng base64 trong index.html.\r\n') +
      'Mở index.html bằng trình duyệt để chơi game.\r\n' +
      'Độ phân giải: ' + Math.round(640 * renderScale) + '×' + Math.round(360 * renderScale) + '\r\n' +
      'Max FPS: ' + maxFps + '\r\n';

    return {
      html,
      zipBytes: makeZip(files),
      assetCount: Object.keys(assetsMap).length,
      useAssets: separateAssets
    };
  }

  function buildHTML(data, customCode, opts) {
    opts = opts || {};
    const renderScale = opts.renderScale || 1;
    const maxFps = opts.maxFps || 60;
    const runtimeSrc = MiniRuntime.toString();
    const safeJson = JSON.stringify(data)
      .replace(/<\/script/gi, '<\\/script')
      .replace(/<!--/g, '<\\!--');
    const customSrc = (customCode && customCode.trim()) ? JSON.stringify(customCode) : '""';

    const L = [];
    L.push('<!DOCTYPE html>');
    L.push('<html lang="vi"><head>');
    L.push('<meta charset="utf-8">');
    L.push('<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no,viewport-fit=cover">');
    L.push('<meta name="theme-color" content="#0b0d12">');
    L.push('<title>MNHR Game</title>');
    L.push('<style>');
    L.push('*{box-sizing:border-box;margin:0;padding:0;-webkit-tap-highlight-color:transparent;}');
    L.push('html,body{height:100%;overflow:hidden;background:#000;font-family:system-ui,sans-serif;}');
    L.push('#wrap{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;');
    L.push('background:radial-gradient(circle at 50% 40%,#131824 0%,#0b0d12 70%);}');
    L.push('canvas{display:block;background:#0e1116;touch-action:none;border-radius:8px;');
    L.push('box-shadow:0 0 0 1px #262d3f,0 10px 40px rgba(0,0,0,.6);image-rendering:' + (renderScale > 1 ? 'auto' : 'pixelated') + ';}');
    L.push('#imgCache{position:fixed;bottom:0;left:0;width:1px;height:1px;overflow:hidden;opacity:0;pointer-events:none;z-index:-1;}');
    L.push('#fps{position:fixed;top:8px;left:8px;color:#7cffb0;font:bold 11px ui-monospace,monospace;');
    L.push('background:rgba(0,0,0,.55);padding:4px 8px;border-radius:6px;z-index:99;pointer-events:none;}');
    L.push('</style></head><body>');
    L.push('<div id="wrap"><canvas id="c"></canvas></div>');
    L.push('<div id="imgCache"></div>');
    L.push('<div id="fps" style="display:none;"></div>');
    L.push('<script>');
    L.push(runtimeSrc);
    L.push('<\/script>');
    L.push('<script>');
    L.push('(function(){');
    L.push('var data = ' + safeJson + ';');
    L.push('var CUSTOM_SRC = ' + customSrc + ';');
    L.push('var RENDER_SCALE = ' + renderScale + ';');
    L.push('var MAX_FPS = ' + maxFps + ';');
    L.push('var SHOW_FPS = ' + (window.MNHR && window.MNHR.State && window.MNHR.State.settings ? window.MNHR.State.settings.showFps : true) + ';');
    L.push('var RT = MiniRuntime();');
    L.push('var VW = RT.VW, VH = RT.VH;');
    L.push('var canvas = document.getElementById("c");');
    L.push('var ctx = canvas.getContext("2d");');
    L.push('canvas.width = VW * RENDER_SCALE;');
    L.push('canvas.height = VH * RENDER_SCALE;');
    L.push('ctx.scale(RENDER_SCALE, RENDER_SCALE);');
    L.push('var imgCache = document.getElementById("imgCache");');
    L.push('function fit(){var s=Math.min(window.innerWidth/VW,window.innerHeight/VH);');
    L.push('canvas.style.width=Math.floor(VW*s)+"px";canvas.style.height=Math.floor(VH*s)+"px";}');
    L.push('window.addEventListener("resize",fit);');
    L.push('window.addEventListener("orientationchange",function(){setTimeout(fit,250);});');
    L.push('fit();');

    L.push('var state = { items: [], playing: true, keys: {}, time: 0,');
    L.push('camera: {x:VW/2,y:VH/2}, projectiles: [],');
    L.push('particles: [], floatingTexts: [],');
    L.push('shakeScreen: {intensity:0, timeLeft:0, duration:0.001},');
    L.push('ui: data.ui || RT.defaultUI(), showMenu: !!(data.ui && data.ui.mainMenu && data.ui.mainMenu.enabled) };');

    L.push('function loadImg(url, cb){if(!url) return cb(null);');
    L.push('var img = document.createElement("img");');
    L.push('img.style.cssText="position:absolute;width:1px;height:1px;";');
    L.push('imgCache.appendChild(img);');
    L.push('img.onload=function(){cb(img);};img.onerror=function(){cb(null);};img.src=url;}');
    L.push('function loadAudio(url){if(!url) return null;var a=document.createElement("audio");a.src=url;a.loop=' + (data.bgMusic && data.bgMusic.loop !== false) + ';a.volume=' + (data.bgMusic && data.bgMusic.volume != null ? data.bgMusic.volume : 0.6) + ';return a;}');

    L.push('data.items.forEach(function(d){');
    L.push('  if (d.kind === "sprite") {');
    L.push('    var animations = {};');
    L.push('    for (var k in d.animations) {');
    L.push('      var src = d.animations[k];');
    L.push('      animations[k] = src ? { fps: src.fps||8, loop: src.loop!==false,');
    L.push('        frames: (src.frames||[]).map(function(f){return {url:f.url, img:null};}) }');
    L.push('        : { frames: [], fps: 8, loop: true };');
    L.push('    }');
    L.push('    ["idle","run","jump","hurt","die","shoot"].forEach(function(k){');
    L.push('      if(!animations[k]) animations[k]={frames:[],fps:8,loop:true};});');
    L.push('    var sh = d.shoot||{};');
    L.push('    var shAnim = sh.animation ? { fps: sh.animation.fps||8, loop: sh.animation.loop!==false,');
    L.push('      frames: (sh.animation.frames||[]).map(function(f){return {url:f.url, img:null};}) }');
    L.push('      : { frames: [], fps: 8, loop: true };');
    L.push('    var hitboxes = (d.hitboxes||[]).map(function(h){return {ox:h.ox,oy:h.oy,w:h.w,h:h.h};});');
    L.push('    var events = (d.events||[]).map(function(e){return {');
    L.push('      id:e.id, trigger:e.trigger, triggerParams:e.triggerParams||{},');
    L.push('      delay:e.delay||0, action:e.action, actionParams:e.actionParams||{}');
    L.push('    };});');
    L.push('    state.items.push({');
    L.push('      kind:"sprite", id:d.id, name:d.name,');
    L.push('      x:d.x, y:d.y, w:d.w, h:d.h,');
    L.push('      hb:d.hb, hitboxes:hitboxes, events:events,');
    L.push('      control:d.control, camera:!!d.camera, hpMode:d.hpMode||"default",');
    L.push('      animations: animations,');
    L.push('      shoot: { enabled:!!sh.enabled, url:sh.url||null, img:null,');
    L.push('        offsetX:sh.offsetX||0, offsetY:sh.offsetY||0, angle:sh.angle||0,');
    L.push('        delay:sh.delay||0,');
    L.push('        cooldown:sh.cooldown!=null?sh.cooldown:0.3, damage:sh.damage!=null?sh.damage:10,');
    L.push('        speed:sh.speed!=null?sh.speed:8,');
    L.push('        bulletW:sh.bulletW!=null?sh.bulletW:14, bulletH:sh.bulletH!=null?sh.bulletH:14,');
    L.push('        useGravity:!!sh.useGravity,');
    L.push('        bulletGravity:sh.bulletGravity!=null?sh.bulletGravity:5,');
    L.push('        animation: shAnim },');
    L.push('      botRange:d.botRange!=null?d.botRange:150,');
    L.push('      botPatrol:d.botPatrol!=null?d.botPatrol:80,');
    L.push('      speed:d.speed, jumpPower:d.jumpPower, gravity:d.gravity,');
    L.push('      hp:d.hp, maxHp:d.maxHp||d.hp, iframe:d.iframe,');
    L.push('      _vx:0,_vy:0,_onGround:false,_facing:1,_state:"idle",_invuln:0,_dead:false,');
    L.push('      _shootCd:0,_shootAnimTime:0,_pendingShots:[],_animFrame:0,_animTime:0,_prevState:"idle",');
    L.push('      _pendingActions:[],_everyTimers:{},_keyState:{},_idleFired:{},_touchSet:new Set(),');
    L.push('      _flash:null,_speedBuff:null,_gravityBuff:null,_scaleBuff:null,');
    L.push('      _startFired:false,_prevHp:null,_idleTime:0,_nearPlayer:false,');
    L.push('      _patrolOrigin:undefined,_patrolDir:1');
    L.push('    });');
    L.push('  } else {');
    L.push('    var tex = {};');
    L.push('    for (var k2 in d.tex) tex[k2] = d.tex[k2] ? {url:d.tex[k2].url, img:null} : null;');
    L.push('    var blAnimSrc = (d.animations && d.animations.default) || null;');
    L.push('    var blAnim = blAnimSrc ? { fps: blAnimSrc.fps||8, loop: blAnimSrc.loop!==false,');
    L.push('      frames: (blAnimSrc.frames||[]).map(function(f){return {url:f.url, img:null};}) }');
    L.push('      : { frames: [], fps: 8, loop: true };');
    L.push('    var blHitboxes = (d.hitboxes||[]).map(function(h){return {ox:h.ox,oy:h.oy,w:h.w,h:h.h};});');
    L.push('    state.items.push({kind:"block", id:d.id, name:d.name,');
    L.push('      x:d.x, y:d.y, w:d.w, h:d.h, solid:d.solid, hazard:d.hazard, tex:tex,');
    L.push('      hitboxes: blHitboxes,');
    L.push('      animations: { default: blAnim },');
    L.push('      _animFrame:0, _animTime:0});');
    L.push('  }');
    L.push('});');

    L.push('function loadAll(cb){');
    L.push('  var total=0, done=0;');
    L.push('  function tick(){done++;if(done>=total) cb();}');
    L.push('  state.items.forEach(function(it){');
    L.push('    if (it.kind==="sprite") {');
    L.push('      for (var k in it.animations) {');
    L.push('        var anim=it.animations[k];');
    L.push('        (function(anim2){ anim2.frames.forEach(function(f){ total++; loadImg(f.url,function(img){ f.img=img; tick(); }); }); })(anim);');
    L.push('      }');
    L.push('      if (it.shoot && it.shoot.url) { total++; loadImg(it.shoot.url,function(img){ it.shoot.img=img; tick(); }); }');
    L.push('      if (it.shoot && it.shoot.animation) {');
    L.push('        it.shoot.animation.frames.forEach(function(f){ total++; loadImg(f.url,function(img){ f.img=img; tick(); }); });');
    L.push('      }');
    L.push('    } else {');
    L.push('      for (var k2 in it.tex) { if(!it.tex[k2]) continue; total++;');
    L.push('        (function(a){ loadImg(a.url,function(img){ a.img=img; tick(); }); })(it.tex[k2]); }');
    L.push('      var ba = it.animations && it.animations.default;');
    L.push('      if (ba) ba.frames.forEach(function(f){ total++; loadImg(f.url,function(img){ f.img=img; tick(); }); });');
    L.push('    }');
    L.push('  });');
    L.push('  if (total===0) cb();');
    L.push('}');

    L.push('var bgAudio = null;');
    L.push('if (data.bgMusic && data.bgMusic.url) {');
    L.push('  bgAudio = loadAudio(data.bgMusic.url);');
    L.push('}');

    L.push('var customControl = null;');
    L.push('if (CUSTOM_SRC && CUSTOM_SRC.length) {');
    L.push('  try { customControl = new Function("state","keys","dt","RT","VW","VH", CUSTOM_SRC); }');
    L.push('  catch(e){ console.error("Custom control error:", e); }');
    L.push('}');

    L.push('var pointerToBtn = new Map();');
    L.push('var joystick = { active:false, pointerId:null };');
    L.push('function getP(e){var r=canvas.getBoundingClientRect();');
    L.push('  return {x:(e.clientX-r.left)*(VW/r.width), y:(e.clientY-r.top)*(VH/r.height)};}');

    L.push('canvas.addEventListener("pointerdown", function(e){');
    L.push('  e.preventDefault();');
    L.push('  if (state.showMenu) {');
    L.push('    state.showMenu = false;');
    L.push('    if (bgAudio) try { bgAudio.play(); } catch(_){}');
    L.push('    return;');
    L.push('  }');
    L.push('  var p = getP(e);');
    L.push('  var key = RT.hitUIButton(p, state.ui);');
    L.push('  if (key === "__joy__") {');
    L.push('    joystick.active = true; joystick.pointerId = e.pointerId;');
    L.push('    state.keys["_joy_active"]=true; state.keys["_joy_x"]=0; state.keys["_joy_y"]=0;');
    L.push('    try { canvas.setPointerCapture(e.pointerId); } catch(_){}');
    L.push('    return;');
    L.push('  }');
    L.push('  if (key) { pointerToBtn.set(e.pointerId, key); state.keys[key]=true;');
    L.push('    try { canvas.setPointerCapture(e.pointerId); } catch(_){} }');
    L.push('});');

    L.push('canvas.addEventListener("pointermove", function(e){');
    L.push('  if (state.showMenu) return;');
    L.push('  var p = getP(e);');
    L.push('  if (joystick.active && e.pointerId === joystick.pointerId) {');
    L.push('    var L = state.ui.layout.joyBase;');
    L.push('    var dx = p.x-L.x, dy = p.y-L.y;');
    L.push('    var dist = Math.sqrt(dx*dx+dy*dy);');
    L.push('    if (dist > L.r) { dx = dx/dist*L.r; dy = dy/dist*L.r; }');
    L.push('    state.keys["_joy_x"] = dx/L.r; state.keys["_joy_y"] = dy/L.r;');
    L.push('    return;');
    L.push('  }');
    L.push('  if (!pointerToBtn.has(e.pointerId)) return;');
    L.push('  var key = pointerToBtn.get(e.pointerId);');
    L.push('  var ok = RT.hitUIButton(p, state.ui) === key;');
    L.push('  state.keys[key] = ok;');
    L.push('});');

    L.push('function up(e){');
    L.push('  if (joystick.active && e.pointerId === joystick.pointerId) {');
    L.push('    joystick.active = false; joystick.pointerId = null;');
    L.push('    state.keys["_joy_active"]=false; state.keys["_joy_x"]=0; state.keys["_joy_y"]=0;');
    L.push('    return;');
    L.push('  }');
    L.push('  var key = pointerToBtn.get(e.pointerId);');
    L.push('  if (key) { state.keys[key]=false; pointerToBtn.delete(e.pointerId); }');
    L.push('}');
    L.push('canvas.addEventListener("pointerup", up);');
    L.push('canvas.addEventListener("pointercancel", up);');
    L.push('canvas.addEventListener("contextmenu", function(e){e.preventDefault();});');

    L.push('window.addEventListener("keydown", function(e){');
    L.push('  state.keys[e.key]=true;');
    L.push('  if ([" ","ArrowUp","ArrowDown","ArrowLeft","ArrowRight"].indexOf(e.key)>=0) e.preventDefault();');
    L.push('});');
    L.push('window.addEventListener("keyup", function(e){ state.keys[e.key]=false; });');

    L.push('var lastT = 0, fpsAcc = 0, fpsCount = 0, fpsDisp = 0;');
    L.push('var fpsEl = document.getElementById("fps");');
    L.push('if (SHOW_FPS) fpsEl.style.display = "block";');
    L.push('var minFrameMs = 1000 / MAX_FPS - 0.5;');
    L.push('var lastFrameTime = 0;');
    L.push('function loop(t){');
    L.push('  requestAnimationFrame(loop);');
    L.push('  if (t - lastFrameTime < minFrameMs) return;');
    L.push('  lastFrameTime = t;');
    L.push('  if (!lastT) lastT = t;');
    L.push('  var dt = (t-lastT)/1000; lastT = t;');
    L.push('  if (dt > 0.05) dt = 0.05; if (dt < 0) dt = 0;');
    L.push('  fpsAcc += dt; fpsCount++;');
    L.push('  if (fpsAcc >= 0.5) { fpsDisp = Math.round(fpsCount/fpsAcc); fpsAcc = 0; fpsCount = 0;');
    L.push('    if (SHOW_FPS) fpsEl.textContent = fpsDisp + " FPS"; }');
    L.push('  if (!state.showMenu) {');
    L.push('    state.time += dt;');
    L.push('    if (customControl) { try { customControl(state, state.keys, dt, RT, VW, VH); } catch(e){} }');
    L.push('    for (var i=0;i<state.items.length;i++){');
    L.push('      var it = state.items[i];');
    L.push('      if (it.kind === "sprite") RT.updateItem(state, it, dt, state.keys);');
    L.push('      else if (it.kind === "block") RT.updateBlock(it, dt);');
    L.push('    }');
    L.push('    RT.updateProjectiles(state, dt);');
    L.push('    RT.updateParticles(state, dt);');
    L.push('    RT.updateFloatingTexts(state, dt);');
    L.push('    RT.updateShake(state, dt);');
    L.push('    RT.updateCamera(state, dt);');
    L.push('  } else {');
    L.push('    for (var i2=0;i2<state.items.length;i2++){');
    L.push('      var it2 = state.items[i2];');
    L.push('      if (it2.kind === "sprite") RT.updateItem(state, it2, dt, {});');
    L.push('      else if (it2.kind === "block") RT.updateBlock(it2, dt);');
    L.push('    }');
    L.push('    RT.updateParticles(state, dt);');
    L.push('    RT.updateFloatingTexts(state, dt);');
    L.push('    RT.updateShake(state, dt);');
    L.push('  }');
    L.push('  RT.render(ctx, state, { editor: false });');
    L.push('}');

    L.push('loadAll(function(){ requestAnimationFrame(loop); });');
    L.push('})();');
    L.push('<\/script>');
    L.push('</body></html>');
    return L.join('\n');
  }

  function downloadBlob(bytes, filename) {
    try {
      const blob = new Blob([bytes], { type: 'application/zip' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = filename; a.rel = 'noopener';
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 2000);
      return true;
    } catch (e) { console.error(e); return false; }
  }
  function openInNewTab(html) {
    try {
      const blob = new Blob([html], { type: 'text/html' });
      const url = URL.createObjectURL(blob);
      const w = window.open(url, '_blank');
      if (!w) throw new Error('Popup blocked');
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      return true;
    } catch (e) { console.error(e); return false; }
  }

  let _lastExport = null;
  function showResult(result, filename, dlOk) {
    _lastExport = result;
    const modal = document.getElementById('exportResultModal');
    const title = document.getElementById('exportResTitle');
    const info = document.getElementById('exportResInfo');
    if (dlOk) { title.textContent = '✅ Xuất thành công'; title.style.color = '#7cffb0'; }
    else { title.textContent = '⚠️ Không thể tải ZIP'; title.style.color = '#ff8fa3'; }
    const sizeKB = (result.zipBytes.length / 1024).toFixed(1);
    info.innerHTML =
      '<div><b>Tên file:</b> ' + filename + '</div>' +
      '<div><b>Kích thước ZIP:</b> ' + sizeKB + ' KB</div>' +
      '<div><b>Assets:</b> ' + result.assetCount + ' file' +
      (result.useAssets ? ' (thư mục <code>assets/</code>)' : ' (nhúng base64)') + '</div>' +
      '<div><b>Trạng thái:</b> ' + (dlOk ? '✅ Đã gửi lệnh tải' : '❌ Thất bại') + '</div>';
    modal.classList.add('show');
  }

  let _pendingData = null;
  function showExportDialog(data) {
    _pendingData = data;
    document.getElementById('customPanel').classList.remove('show');
    document.getElementById('customCode').value = '';
    document.getElementById('exportModal').classList.add('show');
  }
  function doExport(data, customCode) {
    try {
      const resSel = document.getElementById('expRes');
      const fpsSel = document.getElementById('expFps');
      const sepChk = document.getElementById('expSeparateAssets');
      const opts = {
        renderScale: parseFloat(resSel.value) || 1,
        maxFps: parseInt(fpsSel.value, 10) || 60,
        separateAssets: sepChk.checked
      };
      const result = buildPackage(data, customCode, opts);
      const stamp = new Date().toISOString().slice(0,19).replace(/[:T]/g,'-');
      const filename = 'mnhr-game-' + stamp + '.zip';
      const ok = downloadBlob(result.zipBytes, filename);
      showResult(result, filename, ok);
      if (ok) toast('✅ Đã xuất: ' + filename, 'ok', 3000);
    } catch (e) { console.error(e); alert('Lỗi: ' + e.message); }
  }
  function bind() {
    document.getElementById('btnNoCustom').onclick = () => {
      document.getElementById('exportModal').classList.remove('show');
      doExport(_pendingData, '');
    };
    document.getElementById('btnYesCustom').onclick = () => {
      document.getElementById('customPanel').classList.add('show');
      setTimeout(() => document.getElementById('customCode').focus(), 50);
    };
    document.getElementById('btnCancelExport').onclick = () => {
      document.getElementById('exportModal').classList.remove('show');
    };
    document.getElementById('btnDoExport').onclick = () => {
      document.getElementById('exportModal').classList.remove('show');
      doExport(_pendingData, document.getElementById('customCode').value || '');
    };
    document.getElementById('btnImportJs').onclick = async () => {
      const files = await pickFiles({ accept: '.js,.txt,text/javascript' });
      if (!files.length) return;
      document.getElementById('customCode').value = await readAsText(files[0]);
    };
    document.getElementById('btnResClose').onclick = () => document.getElementById('exportResultModal').classList.remove('show');
    document.getElementById('btnResDownload').onclick = () => {
      if (!_lastExport) return;
      const stamp = new Date().toISOString().slice(0,19).replace(/[:T]/g,'-');
      const fn = 'mnhr-game-' + stamp + '.zip';
      const ok = downloadBlob(_lastExport.zipBytes, fn);
      if (ok) toast('Đã gửi lệnh tải lại', 'ok');
      else toast('Tải lại thất bại', 'err');
    };
    document.getElementById('btnResPreview').onclick = () => {
      if (!_lastExport) return;
      const ok = openInNewTab(_lastExport.html);
      if (!ok) toast('Popup bị chặn', 'err');
      else toast('Đã mở tab preview', 'ok');
    };
    document.querySelectorAll('.modal').forEach(m => {
      m.addEventListener('click', (e) => { if (e.target === m) m.classList.remove('show'); });
    });
  }
  return { showExportDialog, buildHTML, buildPackage, makeZip, crc32, bind };
})();

/* ============================================================
   INIT
   ============================================================ */
function init() {
  canvas = document.getElementById('stage');
  ctx = canvas.getContext('2d');
  imgCache = document.getElementById('imgCache');
  audioCache = document.getElementById('audioCache');

  // Load settings first
  const s = Projects.getSettings();
  State.settings = Object.assign(State.settings, s);
  applyTheme();

  resizeCanvas();
  window.addEventListener('resize', resizeCanvas);
  window.addEventListener('orientationchange', () => setTimeout(resizeCanvas, 250));

  document.getElementById('btnAddSprite').onclick  = addSprite;
  document.getElementById('btnAddBot').onclick     = addBot;
  document.getElementById('btnAddBlock').onclick   = addBlock;
  document.getElementById('btnQuickBlock').onclick = addBlock;
  document.getElementById('btnPlay').onclick       = play;
  document.getElementById('btnStop').onclick       = stop;
  document.getElementById('btnSave').onclick = () => manualSave(false);

  document.getElementById('btnUI').onclick = () => {
    State.tab = State.tab === 'ui' ? 'scene' : 'ui';
    State.uiSelected = null;
    document.getElementById('btnUI').classList.toggle('on', State.tab === 'ui');
    if (State.tab === 'ui') { State.selectedId = null; document.getElementById('inspector').classList.remove('hidden'); }
    renderInspector();
  };
  document.getElementById('btnPan').onclick = () => {
    State.panMode = !State.panMode;
    document.getElementById('btnPan').classList.toggle('on', State.panMode);
    document.getElementById('stageWrap').classList.toggle('panmode', State.panMode);
    document.getElementById('camInfo').style.display = State.panMode ? 'block' : 'none';
  };
  document.getElementById('btnResetCam').onclick = () => {
    State.editCam = { x: VW/2, y: VH/2 }; updateCamInfo();
    toast('Đã reset camera', 'ok');
  };

  const wrap = document.getElementById('stageWrap');
  document.getElementById('btnFullscreen').onclick = async () => {
    try {
      if (!document.fullscreenElement) {
        if (wrap.requestFullscreen) await wrap.requestFullscreen();
        else if (wrap.webkitRequestFullscreen) wrap.webkitRequestFullscreen();
      } else if (document.exitFullscreen) await document.exitFullscreen();
    } catch (e) { toast('Không hỗ trợ fullscreen', 'err'); }
  };
  document.getElementById('fsExit').onclick = async () => {
    try { if (document.exitFullscreen) await document.exitFullscreen(); } catch (e) {}
  };
  const onFSChange = () => {
    State.fullscreen = !!document.fullscreenElement;
    setTimeout(resizeCanvas, 150);
  };
  document.addEventListener('fullscreenchange', onFSChange);
  document.addEventListener('webkitfullscreenchange', onFSChange);

  document.getElementById('btnExport').onclick = () => Exporter.showExportDialog(serialize());
  Exporter.bind();
  document.getElementById('btnInspector').onclick = () => {
    document.getElementById('inspector').classList.toggle('hidden');
    setTimeout(resizeCanvas, 220);
  };

  /* SETTINGS */
  document.getElementById('btnSettings').onclick = () => {
    renderSettings();
    document.getElementById('settingsModal').classList.add('show');
  };
  document.getElementById('btnSettingsClose').onclick = () => {
    document.getElementById('settingsModal').classList.remove('show');
  };

  /* PROJECTS */
  document.getElementById('btnProjects').onclick = openProjectsModal;
  document.getElementById('btnCloseProjects').onclick = () => document.getElementById('projectModal').classList.remove('show');
  document.getElementById('btnNewProject').onclick = () => {
    const name = prompt('Tên dự án:', 'Dự án ' + (Projects.list().length + 1));
    if (name == null) return;
    const p = Projects.create((name || '').trim() || 'Dự án mới');
    loadProject(p); openProjectsModal(); toast('Đã tạo dự án mới', 'ok');
  };
  document.getElementById('btnExportMnhr').onclick = exportMnhr;
  document.getElementById('btnImportMnhr').onclick = importMnhr;

  /* HITBOX */
  document.getElementById('btnHitboxAuto').onclick = hbAutoDetect;
  document.getElementById('btnHitboxFull').onclick = () => {
    hitboxState.boxes = [{ x: 0, y: 0, w: hitboxState.W, h: hitboxState.H }];
    redrawHitboxCanvas(); renderHitboxList(); updateHitboxInfo();
  };
  document.getElementById('btnHitboxClear').onclick = () => {
    hitboxState.boxes = [];
    redrawHitboxCanvas(); renderHitboxList(); updateHitboxInfo();
  };
  document.getElementById('btnHitboxCancel').onclick = closeHitboxModal;
  document.getElementById('btnHitboxDone').onclick = saveHitbox;
  const hc = document.getElementById('hitboxCanvas');
  hc.addEventListener('pointerdown', hbPointerDown);
  hc.addEventListener('pointermove', hbPointerMove);
  hc.addEventListener('pointerup', hbPointerUp);
  hc.addEventListener('pointercancel', hbPointerUp);
  hc.addEventListener('contextmenu', e => e.preventDefault());

  /* ANIM */
  document.getElementById('btnAddFrames').onclick = () => { if (animCtx) importAnimFrames(animCtx); };
  document.getElementById('btnImportSheet').onclick = () => { if (animCtx) importSpritesheetFile(); };
  document.getElementById('btnCancelSheet').onclick = () => {
    document.getElementById('sheetPanel').style.display = 'none';
    sheetCtx = { file: null, url: null, img: null };
  };
  document.getElementById('btnDoSlice').onclick = doSliceSheet;
  document.getElementById('btnClearFrames').onclick = () => {
    if (!animCtx) return;
    const anim = resolveAnimRef(animCtx);
    if (!anim) return;
    anim.frames = [];
    renderAnimFrames(); renderInspector(); renderLayers(); scheduleSave();
  };
  document.getElementById('btnReverseFrames').onclick = () => {
    if (!animCtx) return;
    const anim = resolveAnimRef(animCtx);
    if (!anim) return;
    anim.frames.reverse();
    renderAnimFrames(); renderInspector(); renderLayers(); scheduleSave();
  };
  document.getElementById('btnAnimDone').onclick = () => {
    document.getElementById('animModal').classList.remove('show');
    animCtx = null; sheetCtx = { file: null, url: null, img: null };
    renderInspector();
  };
  document.getElementById('animFps').oninput = (e) => {
    if (!animCtx) return;
    const anim = resolveAnimRef(animCtx);
    if (!anim) return;
    anim.fps = Math.max(1, Math.min(60, parseInt(e.target.value, 10) || 8));
    renderInspector(); scheduleSave();
  };
  document.getElementById('animLoop').onchange = (e) => {
    if (!animCtx) return;
    const anim = resolveAnimRef(animCtx);
    if (!anim) return;
    anim.loop = e.target.checked;
    scheduleSave();
  };

  canvas.addEventListener('pointerdown',   onPointerDown);
  canvas.addEventListener('pointermove',   onPointerMove);
  canvas.addEventListener('pointerup',     onPointerUp);
  canvas.addEventListener('pointercancel', onPointerUp);
  canvas.addEventListener('contextmenu',   e => e.preventDefault());

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup',   onKeyUp);

  // Ctrl/Cmd+S = save
  window.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault();
      manualSave(false);
    }
  });

  let proj = Projects.get(Projects.currentId());
  if (!proj) {
    const items = Projects.list();
    proj = items.length ? items[0] : Projects.create('Dự án đầu tiên');
  }
  loadProject(proj);
  updateCamInfo();
  requestAnimationFrame(loop);
  toast('MNHR-engine v7 sẵn sàng 🎮', 'ok', 2800);
}

function openProjectsModal() {
  const modal = document.getElementById('projectModal');
  const listEl = document.getElementById('projectList');
  listEl.innerHTML = '';
  const items = Projects.list();
  if (!items.length) listEl.appendChild(el('div', 'empty', 'Chưa có dự án nào.'));
  else for (const p of items) {
    const r = document.createElement('div');
    r.className = 'proj-item' + (p.id === State.currentProjectId ? ' active' : '');
    r.appendChild(el('div', 'pi-name', p.name));
    r.appendChild(el('div', 'pi-meta', new Date(p.updatedAt).toLocaleString('vi-VN')));
    const del = el('button', 'pi-del', '✕');
    del.onclick = (ev) => {
      ev.stopPropagation();
      if (!confirm('Xoá dự án "' + p.name + '"?')) return;
      Projects.remove(p.id);
      if (p.id === State.currentProjectId) {
        const first = Projects.list()[0];
        loadProject(first || Projects.create('Dự án mới'));
      }
      openProjectsModal();
      toast('Đã xoá dự án', 'ok');
    };
    r.appendChild(del);
    r.onclick = () => {
      loadProject(p);
      modal.classList.remove('show');
      toast('Đã mở: ' + p.name, 'ok');
    };
    listEl.appendChild(r);
  }
  modal.classList.add('show');
}

return {
  Editor: { init },
  Runtime: RT,
  State, Projects, Exporter,
  serialize, deserialize, MiniRuntime, toast
};
})();