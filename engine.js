/* ============================================================
   MNHR-engine — engine.js v5
   Fix: import animation frame (1 frame mỗi lần, không race)
   ============================================================ */
window.MNHR = (function () {
'use strict';

/* ============================================================
   MINI RUNTIME — self-contained (embedded verbatim in export)
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
        enabled: false,
        title: 'MNHR Game',
        subtitle: 'Nhấn để chơi',
        bg: '#0e1116',
        titleColor: '#ffb86b',
        subColor: '#a8b6cc'
      }
    };
  }

  function getBounds(it) {
    if (it.kind === 'sprite') {
      return {
        x: it.x + it.hb.ox - it.hb.hw,
        y: it.y + it.hb.oy - it.hb.hh,
        w: it.hb.hw * 2, h: it.hb.hh * 2
      };
    }
    return { x: it.x - it.w / 2, y: it.y - it.h / 2, w: it.w, h: it.h };
  }
  function aabb(a, b) {
    return a.x < b.x + b.w && a.x + a.w > b.x &&
           a.y < b.y + b.h && a.y + a.h > b.y;
  }
  function damage(it, amount) {
    if (it._invuln > 0 || it._dead) return;
    it.hp = Math.max(0, it.hp - amount);
    it._invuln = it.iframe;
    if (it.hp <= 0) it._dead = true;
  }

  function resolveCollisions(state, it, axis) {
    for (let i = 0; i < state.items.length; i++) {
      const other = state.items[i];
      if (other === it || other.kind !== 'block') continue;
      const b = getBounds(it), ob = getBounds(other);
      if (!aabb(b, ob)) continue;
      if (other.hazard && it.hp > 0) damage(it, 10);
      if (!other.solid) continue;
      if (axis === 'x') {
        if (it._vx > 0) it.x -= (b.x + b.w) - ob.x;
        else if (it._vx < 0) it.x += (ob.x + ob.w) - b.x;
        it._vx = 0;
      } else {
        if (it._vy > 0) { it.y -= (b.y + b.h) - ob.y; it._vy = 0; it._onGround = true; }
        else if (it._vy < 0) { it.y += (ob.y + ob.h) - b.y; it._vy = 0; }
      }
    }
  }

  function spawnBullet(state, it, facing) {
    const s = it.shoot;
    if (!s || !s.enabled) return;
    state.projectiles.push({
      x: it.x + (s.offsetX || 0) * facing,
      y: it.y + (s.offsetY || 0),
      vx: facing * (s.speed || 8),
      vy: 0,
      w: s.bulletW || 14, h: s.bulletH || 14,
      damage: s.damage || 10,
      owner: it.id,
      img: s.img || null,
      life: 5, facing,
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
    if (it.animations && it.animations.shoot && it.animations.shoot.frames.length) {
      it._shootAnimTime = 0.3;
    }
  }
  function updatePendingShots(state, it, dt) {
    if (!it._pendingShots || !it._pendingShots.length) return;
    for (let i = it._pendingShots.length - 1; i >= 0; i--) {
      const p = it._pendingShots[i];
      p.t -= dt;
      if (p.t <= 0) { spawnBullet(state, it, p.facing); it._pendingShots.splice(i, 1); }
    }
  }

  function updateBotAI(state, it, dt) {
    if (it._patrolOrigin === undefined) { it._patrolOrigin = it.x; it._patrolDir = 1; }
    const range = it.botRange != null ? it.botRange : 150;
    const patrolRange = it.botPatrol != null ? it.botPatrol : 80;
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
      if (it.x > it._patrolOrigin + patrolRange) it._patrolDir = -1;
      if (it.x < it._patrolOrigin - patrolRange) it._patrolDir = 1;
      it._facing = it._patrolDir;
      it._vx = it._patrolDir * (BASE_SPEED * it.speed * 0.6);
    }
  }

  function stepAnimation(it, dt) {
    const anim = (it.animations && (it.animations[it._state] || it.animations.idle)) || null;
    if (!anim || !anim.frames || !anim.frames.length) { it._animFrame = 0; return; }
    const fps = anim.fps || 8;
    it._animTime = (it._animTime || 0) + dt;
    const frameDur = 1 / fps;
    while (it._animTime >= frameDur) {
      it._animTime -= frameDur;
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
    updatePendingShots(state, it, dt);
    if (it._dead) { it._vx = 0; it._vy = 0; stepAnimation(it, dt); return; }
    if (it._invuln > 0) { it._invuln -= dt; if (it._invuln < 0) it._invuln = 0; }

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
      if (jump && it._onGround) { it._vy = -BASE_JUMP * it.jumpPower; it._onGround = false; }
      if (moveX !== 0) it._facing = moveX > 0 ? 1 : -1;
      it._vx = moveX * BASE_SPEED * it.speed;
    } else if (it.control === 'bot') {
      updateBotAI(state, it, dt);
    } else { it._vx = 0; }

    if (it.gravity > 0) it._vy += BASE_GRAVITY * it.gravity * dt * 60;
    else { it._vy *= 0.85; if (Math.abs(it._vy) < 0.02) it._vy = 0; }
    it._vy = clamp(it._vy, -30, 25);
    it.x += it._vx * dt * 60;
    resolveCollisions(state, it, 'x');
    it._onGround = false;
    it.y += it._vy * dt * 60;
    resolveCollisions(state, it, 'y');
    it.x = clamp(it.x, -5000, 5000);
    if (it.y > VH + 500) { it.y = -60; it._vy = 0; }

    let st = 'idle';
    if (it.hp <= 0) st = 'die';
    else if (it._shootAnimTime > 0 && it.animations.shoot && it.animations.shoot.frames.length) st = 'shoot';
    else if (it._invuln > 0 && it.animations.hurt && it.animations.hurt.frames.length) st = 'hurt';
    else if (!it._onGround) st = 'jump';
    else if (Math.abs(it._vx) > 0.15) st = 'run';

    if (it._prevState !== st) { it._animFrame = 0; it._animTime = 0; it._prevState = st; }
    it._state = st;
    stepAnimation(it, dt);
  }

  function updateProjectiles(state, dt) {
    for (let i = state.projectiles.length - 1; i >= 0; i--) {
      const p = state.projectiles[i];
      if (p.useGravity) p.vy += BASE_GRAVITY * p.bulletGravity * dt * 60 * 0.5;
      p.x += p.vx * dt * 60;
      p.y += p.vy * dt * 60;
      p.life -= dt;
      if (p.life <= 0 || p.x < -600 || p.x > VW + 600 || p.y > VH + 600 || p.y < -800) {
        state.projectiles.splice(i, 1); continue;
      }
      const pb = { x: p.x - p.w/2, y: p.y - p.h/2, w: p.w, h: p.h };
      let hit = false;
      for (let j = 0; j < state.items.length; j++) {
        const other = state.items[j];
        if (other.kind === 'block') {
          if (aabb(pb, getBounds(other))) { hit = true; break; }
        } else if (other.kind === 'sprite' && other.id !== p.owner && !other._dead) {
          if (aabb(pb, getBounds(other))) { damage(other, p.damage); hit = true; break; }
        }
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

  function drawGrid(ctx, cx, cy) {
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,.045)';
    ctx.lineWidth = 1;
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
    if (img) {
      ctx.translate(it.x, it.y);
      ctx.scale(it._facing, 1);
      ctx.drawImage(img, -it.w / 2, -it.h / 2, it.w, it.h);
    } else {
      ctx.fillStyle = it._dead ? '#5c2130' : (it.control === 'bot' ? '#ff5a6e' : '#7c5cff');
      ctx.fillRect(it.x - it.w / 2, it.y - it.h / 2, it.w, it.h);
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 10px system-ui, sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText((it.name || '').slice(0, 9), it.x, it.y);
    }
    ctx.restore();
  }

  function drawHPBar(ctx, it) {
    const w = 52, h = 6;
    const x = it.x - w/2;
    const y = it.y - it.h/2 - 14;
    const pct = Math.max(0, Math.min(1, it.hp / it.maxHp));
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,.72)';
    ctx.fillRect(x - 2, y - 2, w + 4, h + 4);
    ctx.fillStyle = '#2a1420'; ctx.fillRect(x, y, w, h);
    ctx.fillStyle = pct > 0.5 ? '#3ddc84' : pct > 0.25 ? '#ffb86b' : '#ff5a6e';
    ctx.fillRect(x, y, w * pct, h);
    ctx.strokeStyle = 'rgba(255,255,255,.35)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    ctx.restore();
  }

  function drawBlock(ctx, it, editor) {
    const b = getBounds(it);
    const hasTex = it.tex && (it.tex.all || it.tex.top || it.tex.bottom || it.tex.left || it.tex.right);
    if (hasTex) {
      ctx.save();
      ctx.beginPath(); ctx.rect(b.x, b.y, b.w, b.h); ctx.clip();
      if (it.tex.all && it.tex.all.img) {
        ctx.drawImage(it.tex.all.img, b.x, b.y, b.w, b.h);
      } else {
        const parts = [
          ['top',    b.x,         b.y,         b.w,   b.h/2],
          ['bottom', b.x,         b.y + b.h/2, b.w,   b.h/2],
          ['left',   b.x,         b.y,         b.w/2, b.h],
          ['right',  b.x + b.w/2, b.y,         b.w/2, b.h]
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
      ctx.fillRect(b.x, b.y, b.w, b.h);
      ctx.strokeRect(b.x, b.y, b.w, b.h);
      ctx.restore();
    }
    if (editor) {
      ctx.save();
      ctx.strokeStyle = it.hazard ? 'rgba(255,90,110,.9)' : 'rgba(124,92,255,.75)';
      ctx.lineWidth = 1.5; ctx.setLineDash([]);
      ctx.strokeRect(b.x, b.y, b.w, b.h);
      ctx.restore();
    }
  }

  function drawProjectile(ctx, p) {
    ctx.save();
    if (p.img) {
      ctx.translate(p.x, p.y);
      if (p.facing < 0) ctx.scale(-1, 1);
      ctx.drawImage(p.img, -p.w/2, -p.h/2, p.w, p.h);
    } else {
      ctx.fillStyle = '#ffb86b';
      ctx.shadowColor = '#ffb86b'; ctx.shadowBlur = 8;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.w/2, 0, Math.PI*2); ctx.fill();
    }
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
      ctx.beginPath();
      ctx.arc(kx, ky, L.joyKnob.r, 0, Math.PI*2);
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
        if (p.x >= b.x - w/2 && p.x <= b.x + w/2 && p.y >= b.y - h/2 && p.y <= b.y + h/2) {
          return b.key;
        }
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

    if (editor && state.selectedId) {
      const sel = state.items.find(i => i.id === state.selectedId);
      if (sel) {
        const b = getBounds(sel);
        ctx.save();
        ctx.strokeStyle = '#7c5cff'; ctx.lineWidth = 1.5;
        ctx.setLineDash([5, 4]);
        ctx.strokeRect(b.x - 4, b.y - 4, b.w + 8, b.h + 8);
        if (sel.kind === 'sprite') {
          ctx.strokeStyle = 'rgba(61,220,132,.95)';
          ctx.setLineDash([]); ctx.lineWidth = 1.5;
          ctx.strokeRect(b.x, b.y, b.w, b.h);
          if (sel.camera) {
            ctx.fillStyle = 'rgba(255,200,80,.9)';
            ctx.font = 'bold 12px system-ui, sans-serif';
            ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.fillText('📷', sel.x, sel.y - sel.h/2 - 24);
          }
          if (sel.control === 'bot') {
            const r = sel.botRange != null ? sel.botRange : 150;
            ctx.strokeStyle = 'rgba(255,90,110,.4)';
            ctx.setLineDash([4, 6]);
            ctx.beginPath(); ctx.arc(sel.x, sel.y, r, 0, Math.PI*2); ctx.stroke();
          }
          if (sel.shoot && sel.shoot.enabled) {
            ctx.fillStyle = '#ffb86b';
            ctx.beginPath();
            ctx.arc(sel.x + (sel.shoot.offsetX||0), sel.y + (sel.shoot.offsetY||0), 4, 0, Math.PI*2);
            ctx.fill();
          }
        }
        ctx.restore();
      }
    }
    ctx.restore();

    if (!editor || opts.forceUIDraw) drawUI(ctx, state);
  }

  return {
    VW, VH,
    BASE_SPEED, BASE_JUMP, BASE_GRAVITY,
    defaultUI,
    getBounds, aabb, damage, resolveCollisions,
    updateItem, updateProjectiles, updateCamera,
    render, drawUI, hitUIButton, spawnBullet, tryShoot
  };
}

/* ============================================================
   PROJECTS
   ============================================================ */
const Projects = (function () {
  const KEY = 'mnhr_projects_v2';
  let cache = null;
  const load = () => {
    if (cache) return cache;
    try { cache = JSON.parse(localStorage.getItem(KEY) || ''); }
    catch (e) { cache = null; }
    if (!cache || !cache.projects) cache = { projects: [], currentId: null };
    return cache;
  };
  const persist = () => {
    try { localStorage.setItem(KEY, JSON.stringify(load())); }
    catch (e) { console.warn('save fail', e); }
  };
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
      if (!p) return;
      p.data = data;
      p.updatedAt = Date.now();
      persist();
    },
    remove: (id) => {
      const store = load();
      store.projects = store.projects.filter(p => p.id !== id);
      if (store.currentId === id) store.currentId = store.projects[0] ? store.projects[0].id : null;
      persist();
    }
  };
  function emptyScene() {
    const VW = 640, VH = 360;
    return {
      vw: VW, vh: VH,
      items: [{
        kind: 'block', id: 'ground', name: 'Mặt đất',
        x: VW/2, y: VH - 16, w: VW, h: 32,
        solid: true, hazard: false,
        tex: { all: null, top: null, bottom: null, left: null, right: null }
      }],
      ui: MiniRuntime().defaultUI()
    };
  }
})();

/* ============================================================
   EDITOR
   ============================================================ */
const RT = MiniRuntime();
const VW = RT.VW, VH = RT.VH;
const uid = () => 'x' + Math.random().toString(36).slice(2, 9);
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;

let canvas, ctx, imgCache;
let saveTimer = null;

const State = {
  items: [], selectedId: null, playing: false,
  keys: {}, time: 0,
  drag: null,
  panMode: false, panStart: null,
  pointerToBtn: new Map(),
  joystick: { active: false, pointerId: null },
  camera: { x: VW/2, y: VH/2 },
  editCam: { x: VW/2, y: VH/2 },
  projectiles: [],
  currentProjectId: null,
  tab: 'scene',
  ui: RT.defaultUI(),
  uiSelected: null,
  uiDrag: null,
  showMenu: false,
  fullscreen: false
};

function toast(msg, kind, ms) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'show ' + (kind || '');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { t.className = ''; }, ms || 2200);
}

/* ============================================================
   FILE PICKING — bulletproof single-file picking
   Uses 'change' event + 'cancel' event (modern browsers).
   Falls back to a long focus timeout for old browsers.
   ============================================================ */
function pickFile(opts) {
  opts = opts || {};
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = opts.accept || 'image/*';
    input.multiple = false;
    input.style.cssText = 'position:fixed;left:-10000px;top:-10000px;';

    let settled = false;
    let focusTimer = null;

    const cleanup = () => {
      if (focusTimer) { clearTimeout(focusTimer); focusTimer = null; }
      window.removeEventListener('focus', onFocus);
      setTimeout(() => {
        try { if (input.parentNode) document.body.removeChild(input); } catch (_) {}
      }, 100);
    };
    const finish = (file) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(file || null);
    };

    // Primary: change event — fires when user picks a file
    input.addEventListener('change', () => {
      const f = input.files && input.files[0];
      finish(f || null);
    });

    // Secondary: cancel event — modern browsers fire when user dismisses picker
    input.addEventListener('cancel', () => {
      finish(null);
    });

    // Fallback for old browsers: window regains focus after picker closes.
    // Give change event plenty of time (3s) to fire first.
    const onFocus = () => {
      if (focusTimer) return;
      focusTimer = setTimeout(() => { finish(null); }, 3000);
    };
    window.addEventListener('focus', onFocus);

    document.body.appendChild(input);
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

/* ============================================================
   IMPORT HANDLERS
   ============================================================ */
async function importBlockTexture(item, key) {
  const file = await pickFile({ accept: 'image/*' });
  if (!file) return;
  const url = await readAsDataURL(file);
  if (!url) { toast('Không đọc được file', 'err'); return; }
  const img = await loadImage(url);
  if (!img) { toast('Không tải được ảnh', 'err'); return; }
  item.tex[key] = { url, img };
  renderInspector();
  renderLayers();
  scheduleSave();
  toast('✅ Đã import texture', 'ok');
}

async function importShootImage(item) {
  const file = await pickFile({ accept: 'image/*' });
  if (!file) return;
  const url = await readAsDataURL(file);
  if (!url) { toast('Không đọc được file', 'err'); return; }
  const img = await loadImage(url);
  if (!img) { toast('Không tải được ảnh', 'err'); return; }
  item.shoot.url = url;
  item.shoot.img = img;
  renderInspector();
  scheduleSave();
  toast('✅ Đã import ảnh đạn', 'ok');
}

/* -------- SINGLE FRAME IMPORT — 1 frame per click -------- */
async function importAnimFrame() {
  if (!animCtx) return;
  const item = State.items.find(i => i.id === animCtx.itemId);
  if (!item) { toast('Không tìm thấy nhân vật', 'err'); return; }
  const anim = item.animations[animCtx.key];
  if (!anim) { toast('Animation không tồn tại', 'err'); return; }

  const file = await pickFile({ accept: 'image/*' });
  if (!file) return; // user cancelled
  const url = await readAsDataURL(file);
  if (!url) { toast('Không đọc được file', 'err'); return; }
  const img = await loadImage(url);
  if (!img) { toast('Không tải được ảnh', 'err'); return; }

  anim.frames.push({ url, img });
  renderAnimFrames();
  renderInspector();
  renderLayers();
  scheduleSave();
  toast('✅ Đã thêm frame #' + anim.frames.length, 'ok');
}

/* -------- SPRITESHEET -------- */
let sheetCtx = { file: null, url: null, img: null };

async function importSpritesheetFile() {
  const file = await pickFile({ accept: 'image/*' });
  if (!file) return;
  const url = await readAsDataURL(file);
  if (!url) { toast('Không đọc được file', 'err'); return; }
  const img = await loadImage(url);
  if (!img) { toast('Không tải được ảnh', 'err'); return; }

  sheetCtx.file = file;
  sheetCtx.url = url;
  sheetCtx.img = img;

  const panel = document.getElementById('sheetPanel');
  panel.style.display = 'block';
  const preview = document.getElementById('sheetPreview');
  preview.innerHTML = '';
  const pi = document.createElement('img');
  pi.src = url;
  preview.appendChild(pi);

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

  const item = State.items.find(i => i.id === animCtx.itemId);
  if (!item) { toast('Không tìm thấy nhân vật', 'err'); return; }
  const anim = item.animations[animCtx.key];
  if (!anim) { toast('Animation không tồn tại', 'err'); return; }

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
  renderAnimFrames();
  renderInspector();
  renderLayers();
  scheduleSave();
  toast('✅ Đã cắt ' + made + ' frames', 'ok');
  document.getElementById('sheetPanel').style.display = 'none';
  sheetCtx = { file: null, url: null, img: null };
}

/* ============================================================
   FACTORIES
   ============================================================ */
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
    control: 'player', camera: false, hpMode: 'default',
    animations: {
      idle: emptyAnim(), run: emptyAnim(), jump: emptyAnim(),
      hurt: emptyAnim(), die: emptyAnim(), shoot: emptyAnim()
    },
    shoot: {
      enabled: false, url: null, img: null,
      offsetX: 0, offsetY: 0, delay: 0, cooldown: 0.3, damage: 10,
      speed: 8, bulletW: 14, bulletH: 14,
      useGravity: false, bulletGravity: 5
    },
    botRange: 150, botPatrol: 80,
    speed: 1, jumpPower: 1, gravity: 1,
    hp: 92, maxHp: 92, iframe: 1,
    _vx: 0, _vy: 0, _onGround: false, _facing: 1,
    _state: 'idle', _invuln: 0, _dead: false, _shootCd: 0, _shootAnimTime: 0,
    _pendingShots: [], _animFrame: 0, _animTime: 0, _prevState: 'idle'
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
    tex: { all: null, top: null, bottom: null, left: null, right: null }
  }, o || {});
}

/* ============================================================
   CANVAS SIZING
   ============================================================ */
function resizeCanvas() {
  const wrap = document.getElementById('stageWrap');
  const aw = Math.max(120, wrap.clientWidth - 24);
  const ah = Math.max(120, wrap.clientHeight - 24);
  const s = Math.min(aw / VW, ah / VH);
  canvas.width = VW;
  canvas.height = VH;
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

/* ============================================================
   ANIMATION MODAL
   ============================================================ */
let animCtx = null;

function openAnimModal(item, key, label) {
  animCtx = { itemId: item.id, key };
  const anim = item.animations[key];
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
  const item = State.items.find(i => i.id === animCtx.itemId);
  if (!item) return;
  const anim = item.animations[animCtx.key];
  const wrap = document.getElementById('animFrames');
  wrap.innerHTML = '';
  if (!anim.frames.length) {
    const e = document.createElement('div');
    e.className = 'empty-frame';
    e.textContent = 'Chưa có frame. Bấm "＋ Thêm 1 frame" hoặc "📄 Spritesheet".';
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
    num.className = 'fnum';
    num.textContent = i + 1;
    el.appendChild(num);
    const del = document.createElement('div');
    del.className = 'fdel';
    del.textContent = '×';
    del.onclick = () => {
      anim.frames.splice(i, 1);
      renderAnimFrames();
      renderInspector();
      renderLayers();
      scheduleSave();
    };
    el.appendChild(del);
    wrap.appendChild(el);
  });
}

/* ============================================================
   LAYERS
   ============================================================ */
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
    const idle = item.kind === 'sprite' ? item.animations.idle : null;
    if (idle && idle.frames.length && idle.frames[0].img) {
      const img = document.createElement('img');
      img.src = idle.frames[0].url;
      thumb.appendChild(img);
    } else {
      thumb.textContent = item.kind === 'sprite'
        ? (item.control === 'bot' ? '🤖' : '🧍')
        : (item.hazard ? '⚠️' : '⬛');
    }
    card.appendChild(thumb);
    const nm = document.createElement('div');
    nm.className = 'nm';
    nm.textContent = item.name;
    card.appendChild(nm);
    if (item.kind === 'sprite' && item.camera) {
      const cam = document.createElement('div'); cam.className = 'cam'; cam.textContent = '📷';
      card.appendChild(cam);
    }
    if (item.kind === 'sprite' && item.control === 'bot') {
      const b = document.createElement('div'); b.className = 'bot'; b.textContent = '🤖';
      card.appendChild(b);
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

/* ============================================================
   DOM HELPERS
   ============================================================ */
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
  i.style.accentColor = '#7c5cff'; i.style.width = '18px'; i.style.height = '18px';
  i.onchange = () => { cb(i.checked); scheduleSave(); };
  wrap.appendChild(i);
  return wrap;
}
function sectionHeader(txt) { return el('div', 'ins-sub', txt); }

function animSlot(item, key, label) {
  const anim = item.animations[key];
  const has = anim && anim.frames.length;
  const wrap = el('div', 'anim-slot' + (has ? ' on' : ''));
  wrap.onclick = () => openAnimModal(item, key, label);
  const prev = el('div', 'anim-prev');
  if (has && anim.frames[0].img) {
    const img = document.createElement('img');
    img.src = anim.frames[0].url;
    prev.appendChild(img);
  } else {
    prev.textContent = '—';
    prev.style.color = '#3f4a5e';
    prev.style.fontSize = '16px';
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

/* ============================================================
   INSPECTOR
   ============================================================ */
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
  sg.appendChild(row('W', numInput(item.w, v => { item.w = Math.max(4,v); item.hb.hw = item.w/2; }, 1, 4)));
  sg.appendChild(row('H', numInput(item.h, v => { item.h = Math.max(4,v); item.hb.hh = item.h/2; }, 1, 4)));
  root.appendChild(sg);

  root.appendChild(sectionHeader('Hitbox'));
  const hg = el('div', 'grid4');
  hg.appendChild(row('X', numInput(item.hb.ox, v => item.hb.ox = v, 1)));
  hg.appendChild(row('Y', numInput(item.hb.oy, v => item.hb.oy = v, 1)));
  hg.appendChild(row('W', numInput(item.hb.hw*2, v => item.hb.hw = Math.max(1,v)/2, 1, 2)));
  hg.appendChild(row('H', numInput(item.hb.hh*2, v => item.hb.hh = Math.max(1,v)/2, 1, 2)));
  root.appendChild(hg);

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
  ag.appendChild(animSlot(item, 'idle',  'Đứng yên'));
  ag.appendChild(animSlot(item, 'run',   'Chạy'));
  ag.appendChild(animSlot(item, 'jump',  'Nhảy'));
  ag.appendChild(animSlot(item, 'hurt',  'Mất máu'));
  ag.appendChild(animSlot(item, 'die',   'Chết'));
  ag.appendChild(animSlot(item, 'shoot', 'Bắn đạn'));
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
    sw.appendChild(el('div', 'anim-name', 'Ảnh đạn'));
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

    const og = el('div', 'grid4');
    og.appendChild(row('X', numInput(item.shoot.offsetX, v => item.shoot.offsetX = v, 1)));
    og.appendChild(row('Y', numInput(item.shoot.offsetY, v => item.shoot.offsetY = v, 1)));
    root.appendChild(og);
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
  root.appendChild(sectionHeader('Thuộc tính'));
  root.appendChild(row('Rắn (đất/tường)', checkbox(item.solid,  v => item.solid  = v)));
  root.appendChild(row('Gây sát thương',  checkbox(item.hazard, v => item.hazard = v)));
  root.appendChild(sectionHeader('Texture'));
  const grid = el('div', 'anim-grid');
  ['all', 'top', 'bottom', 'left', 'right'].forEach(k => grid.appendChild(texSlot(item, k)));
  root.appendChild(grid);
  const del = el('button', 'btn danger full', '🗑 Xoá khối');
  del.onclick = () => deleteItem(item.id);
  root.appendChild(del);
}

/* ============================================================
   UI INSPECTOR
   ============================================================ */
function renderUIInspector(root) {
  const ui = State.ui;
  root.appendChild(el('div', 'ins-head', '🎨 Giao diện'));

  root.appendChild(sectionHeader('Điều khiển'));
  root.appendChild(row('Kiểu', selectInput(ui.mode, [
    ['arrows', 'Nút mũi tên'],
    ['joystick', 'Joystick']
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
    item.style.cssText = 'background:#0d1017;border:1px solid #262d3f;border-radius:8px;padding:6px;margin-bottom:6px;';
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

/* ============================================================
   CRUD
   ============================================================ */
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

/* ============================================================
   PLAY / STOP
   ============================================================ */
function play() {
  for (const it of State.items) {
    if (it.kind !== 'sprite') continue;
    it.hp = it.maxHp;
    it._vx = 0; it._vy = 0; it._onGround = false;
    it._invuln = 0; it._dead = false; it._shootCd = 0; it._shootAnimTime = 0;
    it._state = 'idle'; it._prevState = 'idle';
    it._animFrame = 0; it._animTime = 0;
    it._facing = 1;
    it._patrolOrigin = undefined; it._patrolDir = 1;
    it._pendingShots = [];
  }
  State.keys = {};
  State.pointerToBtn.clear();
  State.joystick.active = false; State.joystick.pointerId = null;
  State.projectiles = [];
  State.camera = { x: VW/2, y: VH/2 };
  State.showMenu = !!(State.ui.mainMenu && State.ui.mainMenu.enabled);
  State.playing = true;
  document.getElementById('btnPlay').disabled = true;
  document.getElementById('btnStop').disabled = false;
  document.getElementById('inspector').classList.add('hidden');
  document.getElementById('btnPan').classList.remove('on');
  State.panMode = false;
  document.getElementById('stageWrap').classList.remove('panmode');
}
function stop() {
  State.playing = false;
  State.showMenu = false;
  State.keys = {};
  State.pointerToBtn.clear();
  State.joystick.active = false;
  State.projectiles = [];
  document.getElementById('btnPlay').disabled = false;
  document.getElementById('btnStop').disabled = true;
  document.getElementById('inspector').classList.remove('hidden');
}

/* ============================================================
   POINTER
   ============================================================ */
function onPointerDown(e) {
  e.preventDefault();

  if (State.playing && State.showMenu) {
    State.showMenu = false;
    return;
  }

  if (State.playing) {
    const p = toStage(e.clientX, e.clientY);
    const key = RT.hitUIButton(p, State.ui);
    if (key === '__joy__') {
      State.joystick.active = true;
      State.joystick.pointerId = e.pointerId;
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
    State.uiSelected = null;
    renderInspector();
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
    if (dx*dx + dy*dy <= (b.r + 6)*(b.r + 6)) {
      return { kind: 'layout', key, x: b.x, y: b.y };
    }
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
      if (p.x >= b.x - w/2 && p.x <= b.x + w/2 && p.y >= b.y - h/2 && p.y <= b.y + h/2) {
        return { kind: 'custom', key: b.id, x: b.x, y: b.y };
      }
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
      const max = L.r;
      if (dist > max) { dx = dx / dist * max; dy = dy / dist * max; }
      State.keys['_joy_x'] = dx / max;
      State.keys['_joy_y'] = dy / max;
      return;
    }
    if (!State.pointerToBtn.has(e.pointerId)) return;
    const key = State.pointerToBtn.get(e.pointerId);
    const ok = RT.hitUIButton(p, State.ui) === key;
    State.keys[key] = ok;
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

/* ============================================================
   MAIN LOOP
   ============================================================ */
let lastT = 0;
function loop(t) {
  if (!lastT) lastT = t;
  let dt = (t - lastT) / 1000;
  lastT = t;
  if (dt > 0.05) dt = 0.05;
  if (dt < 0) dt = 0;

  if (State.playing && !State.showMenu) {
    State.time += dt;
    for (const it of State.items) {
      if (it.kind === 'sprite') RT.updateItem(State, it, dt, State.keys);
    }
    RT.updateProjectiles(State, dt);
    RT.updateCamera(State, dt);
  } else if (State.playing && State.showMenu) {
    for (const it of State.items) {
      if (it.kind === 'sprite') RT.updateItem(State, it, dt, {});
    }
  }

  RT.render(ctx, State, { editor: !State.playing });

  if (!State.playing && State.tab === 'ui') drawUIEditorOverlay();

  requestAnimationFrame(loop);
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

/* ============================================================
   SERIALIZE / DESERIALIZE
   ============================================================ */
function serializeAnim(anim) {
  if (!anim) return null;
  return {
    frames: anim.frames.map(f => ({ url: f.url })),
    fps: anim.fps || 8,
    loop: anim.loop !== false
  };
}

function serialize() {
  return {
    vw: VW, vh: VH,
    ui: JSON.parse(JSON.stringify(State.ui)),
    items: State.items.map(it => {
      if (it.kind === 'sprite') {
        const animations = {};
        for (const k in it.animations) animations[k] = serializeAnim(it.animations[k]);
        return {
          kind: 'sprite', id: it.id, name: it.name,
          x: it.x, y: it.y, w: it.w, h: it.h,
          hb: { ox: it.hb.ox, oy: it.hb.oy, hw: it.hb.hw, hh: it.hb.hh },
          control: it.control, camera: !!it.camera, hpMode: it.hpMode || 'default',
          animations,
          shoot: {
            enabled: !!it.shoot.enabled, url: it.shoot.url || null,
            offsetX: it.shoot.offsetX || 0, offsetY: it.shoot.offsetY || 0,
            delay: it.shoot.delay || 0,
            cooldown: it.shoot.cooldown != null ? it.shoot.cooldown : 0.3,
            damage: it.shoot.damage != null ? it.shoot.damage : 10,
            speed: it.shoot.speed != null ? it.shoot.speed : 8,
            bulletW: it.shoot.bulletW != null ? it.shoot.bulletW : 14,
            bulletH: it.shoot.bulletH != null ? it.shoot.bulletH : 14,
            useGravity: !!it.shoot.useGravity,
            bulletGravity: it.shoot.bulletGravity != null ? it.shoot.bulletGravity : 5
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
        solid: it.solid, hazard: it.hazard, tex
      };
    })
  };
}

function deserialize(data) {
  State.items = [];
  State.selectedId = null;
  State.ui = (data && data.ui) ? JSON.parse(JSON.stringify(data.ui)) : RT.defaultUI();
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
          fps: a.fps || 8,
          loop: a.loop !== false
        };
      }
      ['idle','run','jump','hurt','die','shoot'].forEach(k => {
        if (!animations[k]) animations[k] = emptyAnim();
      });

      const sh = d.shoot || {};
      const shoot = {
        enabled: !!sh.enabled, url: sh.url || null, img: null,
        offsetX: sh.offsetX || 0, offsetY: sh.offsetY || 0,
        delay: sh.delay || 0,
        cooldown: sh.cooldown != null ? sh.cooldown : 0.3,
        damage: sh.damage != null ? sh.damage : 10,
        speed: sh.speed != null ? sh.speed : 8,
        bulletW: sh.bulletW != null ? sh.bulletW : 14,
        bulletH: sh.bulletH != null ? sh.bulletH : 14,
        useGravity: !!sh.useGravity,
        bulletGravity: sh.bulletGravity != null ? sh.bulletGravity : 5
      };

      const sp = makeSprite({
        id: d.id || uid(), name: d.name,
        x: d.x, y: d.y, w: d.w, h: d.h,
        hb: d.hb, control: d.control,
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
        for (const f of anim.frames) {
          track(loadImage(f.url).then(img => { f.img = img; }));
        }
      }
      if (shoot.url) track(loadImage(shoot.url).then(img => { shoot.img = img; }));
    } else {
      const tex = {};
      for (const k in d.tex) tex[k] = d.tex[k] ? { url: d.tex[k].url, img: null } : null;
      const bl = makeBlock({
        id: d.id || uid(), name: d.name,
        x: d.x, y: d.y, w: d.w, h: d.h,
        solid: d.solid, hazard: d.hazard, tex
      });
      State.items.push(bl);
      for (const k in bl.tex) {
        const a = bl.tex[k];
        if (!a) continue;
        track(loadImage(a.url).then(img => { a.img = img; }));
      }
    }
  }
  refreshAll();
}

/* ============================================================
   AUTO-SAVE
   ============================================================ */
function scheduleSave() {
  if (!State.currentProjectId) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    Projects.save(State.currentProjectId, serialize());
  }, 600);
}

function loadProject(proj) {
  if (!proj) return;
  State.currentProjectId = proj.id;
  Projects.setCurrent(proj.id);
  deserialize(proj.data);
  State.editCam = { x: VW/2, y: VH/2 };
  updateCamInfo();
}

/* ============================================================
   PROJECTS UI
   ============================================================ */
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

/* ============================================================
   EXPORTER
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
      const dataBytes = typeof files[name] === 'string' ? enc.encode(files[name]) : files[name];
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

  function buildHTML(data, customControlCode) {
    const runtimeSrc = MiniRuntime.toString();
    const safeJson = JSON.stringify(data)
      .replace(/<\/script/gi, '<\\/script')
      .replace(/<!--/g, '<\\!--');
    const customSrc = (customControlCode && customControlCode.trim())
      ? JSON.stringify(customControlCode) : '""';

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
    L.push('box-shadow:0 0 0 1px #262d3f,0 10px 40px rgba(0,0,0,.6);}');
    L.push('#imgCache{position:fixed;bottom:0;left:0;width:1px;height:1px;overflow:hidden;opacity:0;pointer-events:none;z-index:-1;}');
    L.push('</style></head><body>');
    L.push('<div id="wrap"><canvas id="c"></canvas></div>');
    L.push('<div id="imgCache"></div>');
    L.push('<script>');
    L.push(runtimeSrc);
    L.push('<\/script>');
    L.push('<script>');
    L.push('(function(){');
    L.push('var data = ' + safeJson + ';');
    L.push('var CUSTOM_SRC = ' + customSrc + ';');
    L.push('var RT = MiniRuntime();');
    L.push('var VW = RT.VW, VH = RT.VH;');
    L.push('var canvas = document.getElementById("c");');
    L.push('var ctx = canvas.getContext("2d");');
    L.push('canvas.width = VW; canvas.height = VH;');
    L.push('var imgCache = document.getElementById("imgCache");');
    L.push('function fit(){var s=Math.min(window.innerWidth/VW,window.innerHeight/VH);');
    L.push('canvas.style.width=Math.floor(VW*s)+"px";canvas.style.height=Math.floor(VH*s)+"px";}');
    L.push('window.addEventListener("resize",fit);');
    L.push('window.addEventListener("orientationchange",function(){setTimeout(fit,250);});');
    L.push('fit();');
    L.push('var state = { items: [], playing: true, keys: {}, time: 0,');
    L.push('camera: {x:VW/2,y:VH/2}, projectiles: [],');
    L.push('ui: data.ui || RT.defaultUI(), showMenu: !!(data.ui && data.ui.mainMenu && data.ui.mainMenu.enabled) };');
    L.push('function loadImg(url, cb){if(!url) return cb(null);');
    L.push('var img = document.createElement("img");');
    L.push('img.style.cssText="position:absolute;width:1px;height:1px;";');
    L.push('imgCache.appendChild(img);');
    L.push('img.onload=function(){cb(img);};img.onerror=function(){cb(null);};img.src=url;}');
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
    L.push('    state.items.push({');
    L.push('      kind:"sprite", id:d.id, name:d.name,');
    L.push('      x:d.x, y:d.y, w:d.w, h:d.h,');
    L.push('      hb:{ox:d.hb.ox,oy:d.hb.oy,hw:d.hb.hw,hh:d.hb.hh},');
    L.push('      control:d.control, camera:!!d.camera, hpMode:d.hpMode||"default",');
    L.push('      animations: animations,');
    L.push('      shoot: { enabled:!!sh.enabled, url:sh.url||null, img:null,');
    L.push('        offsetX:sh.offsetX||0, offsetY:sh.offsetY||0, delay:sh.delay||0,');
    L.push('        cooldown:sh.cooldown!=null?sh.cooldown:0.3, damage:sh.damage!=null?sh.damage:10,');
    L.push('        speed:sh.speed!=null?sh.speed:8,');
    L.push('        bulletW:sh.bulletW!=null?sh.bulletW:14, bulletH:sh.bulletH!=null?sh.bulletH:14,');
    L.push('        useGravity:!!sh.useGravity,');
    L.push('        bulletGravity:sh.bulletGravity!=null?sh.bulletGravity:5 },');
    L.push('      botRange:d.botRange!=null?d.botRange:150,');
    L.push('      botPatrol:d.botPatrol!=null?d.botPatrol:80,');
    L.push('      speed:d.speed, jumpPower:d.jumpPower, gravity:d.gravity,');
    L.push('      hp:d.hp, maxHp:d.maxHp||d.hp, iframe:d.iframe,');
    L.push('      _vx:0,_vy:0,_onGround:false,_facing:1,_state:"idle",_invuln:0,_dead:false,');
    L.push('      _shootCd:0,_shootAnimTime:0,_pendingShots:[],_animFrame:0,_animTime:0,_prevState:"idle",');
    L.push('      _patrolOrigin:undefined,_patrolDir:1');
    L.push('    });');
    L.push('  } else {');
    L.push('    var tex = {};');
    L.push('    for (var k2 in d.tex) tex[k2] = d.tex[k2] ? {url:d.tex[k2].url, img:null} : null;');
    L.push('    state.items.push({kind:"block", id:d.id, name:d.name,');
    L.push('      x:d.x, y:d.y, w:d.w, h:d.h, solid:d.solid, hazard:d.hazard, tex:tex});');
    L.push('  }');
    L.push('});');
    L.push('function loadAll(cb){');
    L.push('  var total=0, done=0;');
    L.push('  function tick(){done++;if(done>=total) cb();}');
    L.push('  state.items.forEach(function(it){');
    L.push('    if (it.kind==="sprite") {');
    L.push('      for (var k in it.animations) {');
    L.push('        (function(anim){ anim.frames.forEach(function(f){ total++; loadImg(f.url,function(img){ f.img=img; tick(); }); }); })(it.animations[k]);');
    L.push('      }');
    L.push('      if (it.shoot && it.shoot.url) { total++; loadImg(it.shoot.url,function(img){ it.shoot.img=img; tick(); }); }');
    L.push('    } else {');
    L.push('      for (var k2 in it.tex) { if(!it.tex[k2]) continue; total++;');
    L.push('        (function(a){ loadImg(a.url,function(img){ a.img=img; tick(); }); })(it.tex[k2]); }');
    L.push('    }');
    L.push('  });');
    L.push('  if (total===0) cb();');
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
    L.push('  if (state.showMenu) { state.showMenu = false; return; }');
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
    L.push('var lastT = 0;');
    L.push('function loop(t){');
    L.push('  if (!lastT) lastT = t;');
    L.push('  var dt = (t-lastT)/1000; lastT = t;');
    L.push('  if (dt > 0.05) dt = 0.05; if (dt < 0) dt = 0;');
    L.push('  if (!state.showMenu) {');
    L.push('    state.time += dt;');
    L.push('    if (customControl) { try { customControl(state, state.keys, dt, RT, VW, VH); } catch(e){} }');
    L.push('    for (var i=0;i<state.items.length;i++){');
    L.push('      var it = state.items[i];');
    L.push('      if (it.kind === "sprite") RT.updateItem(state, it, dt, state.keys);');
    L.push('    }');
    L.push('    RT.updateProjectiles(state, dt);');
    L.push('    RT.updateCamera(state, dt);');
    L.push('  } else {');
    L.push('    for (var i2=0;i2<state.items.length;i2++){');
    L.push('      var it2 = state.items[i2];');
    L.push('      if (it2.kind === "sprite") RT.updateItem(state, it2, dt, {});');
    L.push('    }');
    L.push('  }');
    L.push('  RT.render(ctx, state, { editor: false });');
    L.push('  requestAnimationFrame(loop);');
    L.push('}');
    L.push('loadAll(function(){ requestAnimationFrame(loop); });');
    L.push('})();');
    L.push('<\/script>');
    L.push('</body></html>');
    return L.join('\n');
  }

  function buildPackage(data, customCode) {
    const html = buildHTML(data, customCode);
    const zipBytes = makeZip({
      'index.html': html,
      'README.txt':
        'MNHR-engine game\r\n' +
        '================\r\n' +
        'Mở index.html bằng trình duyệt để chơi game.\r\n' +
        'Toàn bộ ảnh/animation đã được nhúng dưới dạng data URL.\r\n'
    });
    return { html, zipBytes };
  }

  function downloadBlob(bytes, filename) {
    try {
      const blob = new Blob([bytes], { type: 'application/zip' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.rel = 'noopener';
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 2000);
      return true;
    } catch (e) {
      console.error('download fail', e);
      return false;
    }
  }

  function openInNewTab(html) {
    try {
      const blob = new Blob([html], { type: 'text/html' });
      const url = URL.createObjectURL(blob);
      const w = window.open(url, '_blank');
      if (!w) throw new Error('Popup blocked');
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      return true;
    } catch (e) {
      console.error('open fail', e);
      return false;
    }
  }

  let _lastExport = null;
  function showResult(result, filename, dlOk) {
    _lastExport = result;
    const modal = document.getElementById('exportResultModal');
    const title = document.getElementById('exportResTitle');
    const info = document.getElementById('exportResInfo');
    const wrap = document.getElementById('resCodeWrap');
    const ta = document.getElementById('resCode');

    if (dlOk) {
      title.textContent = '✅ Xuất thành công';
      title.style.color = '#7cffb0';
    } else {
      title.textContent = '⚠️ Không thể tải ZIP — dùng HTML thủ công';
      title.style.color = '#ff8fa3';
    }

    const sizeKB = (result.zipBytes.length / 1024).toFixed(1);
    info.innerHTML =
      '<div><b>Tên file:</b> ' + filename + '</div>' +
      '<div><b>Kích thước ZIP:</b> ' + sizeKB + ' KB</div>' +
      '<div><b>Kích thước HTML:</b> ' + (result.html.length / 1024).toFixed(1) + ' KB</div>' +
      '<div><b>Trạng thái:</b> ' + (dlOk ? '✅ Đã gửi lệnh tải' : '❌ Thất bại') + '</div>' +
      (dlOk ? '' : '<div style="margin-top:8px;color:#ff8fa3;">Dùng <b>Copy HTML</b> bên dưới để tạo file thủ công.</div>');

    ta.value = result.html;
    if (!dlOk) wrap.classList.add('show');
    else wrap.classList.remove('show');
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
      const result = buildPackage(data, customCode);
      const stamp = new Date().toISOString().slice(0,19).replace(/[:T]/g,'-');
      const filename = 'mnhr-game-' + stamp + '.zip';
      const ok = downloadBlob(result.zipBytes, filename);
      showResult(result, filename, ok);
      if (ok) toast('✅ Đã xuất: ' + filename, 'ok', 3000);
    } catch (e) {
      console.error('Export error', e);
      alert('Lỗi xuất game: ' + e.message);
    }
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
      const file = await pickFile({ accept: '.js,.txt,text/javascript' });
      if (!file) return;
      const text = await file.text();
      document.getElementById('customCode').value = text;
    };

    document.getElementById('btnResClose').onclick = () => {
      document.getElementById('exportResultModal').classList.remove('show');
    };
    document.getElementById('btnResDownload').onclick = () => {
      if (!_lastExport) return;
      const stamp = new Date().toISOString().slice(0,19).replace(/[:T]/g,'-');
      const fn = 'mnhr-game-' + stamp + '.zip';
      const ok = downloadBlob(_lastExport.zipBytes, fn);
      if (ok) toast('Đã gửi lệnh tải lại', 'ok');
      else toast('Tải lại thất bại — dùng Copy HTML', 'err');
    };
    document.getElementById('btnResPreview').onclick = () => {
      if (!_lastExport) return;
      const ok = openInNewTab(_lastExport.html);
      if (!ok) toast('Popup bị chặn — dùng Copy HTML', 'err');
      else toast('Đã mở tab preview', 'ok');
    };
    document.getElementById('btnResShowHtml').onclick = () => {
      document.getElementById('resCodeWrap').classList.toggle('show');
    };
    document.getElementById('btnResCopy').onclick = async () => {
      try {
        await navigator.clipboard.writeText(_lastExport.html);
        toast('📋 Đã copy HTML', 'ok');
      } catch (e) {
        const ta = document.getElementById('resCode');
        ta.select(); document.execCommand('copy');
        toast('📋 Đã copy HTML', 'ok');
      }
      document.getElementById('resCodeWrap').classList.add('show');
    };
    document.getElementById('btnResSelectAll').onclick = () => {
      const ta = document.getElementById('resCode');
      ta.focus(); ta.select();
    };

    document.querySelectorAll('.modal').forEach(m => {
      m.addEventListener('click', (e) => {
        if (e.target === m) m.classList.remove('show');
      });
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

  resizeCanvas();
  window.addEventListener('resize', resizeCanvas);
  window.addEventListener('orientationchange', () => setTimeout(resizeCanvas, 250));

  document.getElementById('btnAddSprite').onclick  = addSprite;
  document.getElementById('btnAddBot').onclick     = addBot;
  document.getElementById('btnAddBlock').onclick   = addBlock;
  document.getElementById('btnQuickBlock').onclick = addBlock;
  document.getElementById('btnPlay').onclick       = play;
  document.getElementById('btnStop').onclick       = stop;

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
    State.editCam = { x: VW/2, y: VH/2 };
    updateCamInfo();
    toast('Đã reset camera', 'ok');
  };

  const wrap = document.getElementById('stageWrap');
  document.getElementById('btnFullscreen').onclick = async () => {
    try {
      if (!document.fullscreenElement) {
        if (wrap.requestFullscreen) await wrap.requestFullscreen();
        else if (wrap.webkitRequestFullscreen) wrap.webkitRequestFullscreen();
      } else {
        if (document.exitFullscreen) await document.exitFullscreen();
      }
    } catch (e) {
      toast('Thiết bị không hỗ trợ fullscreen', 'err');
    }
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

  document.getElementById('btnExport').onclick = () => {
    Exporter.showExportDialog(serialize());
  };
  Exporter.bind();

  document.getElementById('btnInspector').onclick = () => {
    document.getElementById('inspector').classList.toggle('hidden');
    setTimeout(resizeCanvas, 220);
  };

  document.getElementById('btnProjects').onclick = openProjectsModal;
  document.getElementById('btnCloseProjects').onclick = () =>
    document.getElementById('projectModal').classList.remove('show');
  document.getElementById('btnNewProject').onclick = () => {
    const name = prompt('Tên dự án:', 'Dự án ' + (Projects.list().length + 1));
    if (name == null) return;
    const p = Projects.create((name || '').trim() || 'Dự án mới');
    loadProject(p);
    openProjectsModal();
    toast('Đã tạo dự án mới', 'ok');
  };

  /* -------- ANIM MODAL -------- */
  document.getElementById('btnAddFrame').onclick = () => {
    if (!animCtx) return;
    importAnimFrame();
  };
  document.getElementById('btnImportSheet').onclick = () => {
    if (!animCtx) return;
    importSpritesheetFile();
  };
  document.getElementById('btnCancelSheet').onclick = () => {
    document.getElementById('sheetPanel').style.display = 'none';
    sheetCtx = { file: null, url: null, img: null };
  };
  document.getElementById('btnDoSlice').onclick = doSliceSheet;
  document.getElementById('btnClearFrames').onclick = () => {
    if (!animCtx) return;
    const item = State.items.find(i => i.id === animCtx.itemId);
    if (!item) return;
    item.animations[animCtx.key].frames = [];
    renderAnimFrames(); renderInspector(); renderLayers(); scheduleSave();
  };
  document.getElementById('btnReverseFrames').onclick = () => {
    if (!animCtx) return;
    const item = State.items.find(i => i.id === animCtx.itemId);
    if (!item) return;
    item.animations[animCtx.key].frames.reverse();
    renderAnimFrames(); renderInspector(); renderLayers(); scheduleSave();
  };
  document.getElementById('btnAnimDone').onclick = () => {
    document.getElementById('animModal').classList.remove('show');
    animCtx = null;
    sheetCtx = { file: null, url: null, img: null };
    renderInspector();
  };
  document.getElementById('animFps').oninput = (e) => {
    if (!animCtx) return;
    const item = State.items.find(i => i.id === animCtx.itemId);
    if (!item) return;
    item.animations[animCtx.key].fps = Math.max(1, Math.min(60, parseInt(e.target.value, 10) || 8));
    renderInspector(); scheduleSave();
  };
  document.getElementById('animLoop').onchange = (e) => {
    if (!animCtx) return;
    const item = State.items.find(i => i.id === animCtx.itemId);
    if (!item) return;
    item.animations[animCtx.key].loop = e.target.checked;
    scheduleSave();
  };

  canvas.addEventListener('pointerdown',   onPointerDown);
  canvas.addEventListener('pointermove',   onPointerMove);
  canvas.addEventListener('pointerup',     onPointerUp);
  canvas.addEventListener('pointercancel', onPointerUp);
  canvas.addEventListener('contextmenu',   e => e.preventDefault());

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup',   onKeyUp);

  let proj = Projects.get(Projects.currentId());
  if (!proj) {
    const items = Projects.list();
    proj = items.length ? items[0] : Projects.create('Dự án đầu tiên');
  }
  loadProject(proj);
  updateCamInfo();
  requestAnimationFrame(loop);
  toast('MNHR-engine v5 sẵn sàng 🎮', 'ok', 2800);
}

return {
  Editor: { init },
  Runtime: RT,
  State,
  Projects,
  Exporter,
  serialize,
  deserialize,
  MiniRuntime,
  toast
};
})();