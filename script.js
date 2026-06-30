/* =====================================================================
 * 계면이 퇴치 미션 - script.js
 * 이슬로 베이비 브랜드 체험 게임 (Vanilla JS, 프레임워크 없음)
 *
 * 모듈 구성
 *  1) CONFIG          : 게임 상수/미션/에셋 경로 (운영 시 이 부분만 조정)
 *  2) Utils           : 공용 유틸 함수
 *  3) AudioManager    : 사운드(파일 없어도 동작)
 *  4) Input           : 마우스/터치 통합 + 손 인식 입력 훅(feedExternalPointer)
 *  5) AssetLoader     : 스프라이트 사전 로드(런타임 끊김 방지)
 *  6) ParticlePool    : 거품/물방울/반짝이/컨페티/폭죽/별 — Object Pool(메모리 누수 방지)
 *  7) Enemy / EnemyPool : 계면이(기어다님·도망·씻김·튕겨남) + DOM 재사용 풀
 *  8) Game            : 상태/미션/루프 총괄
 *  9) bootstrap       : 초기화
 *
 * 성능 메모: 파티클과 계면이 DOM은 모두 풀로 재사용합니다.
 *           게임 루프 중에는 객체를 새로 생성하지 않아 GC 부담이 거의 없습니다.
 *           (iPad Safari 장시간 운영 대응)
 * ===================================================================== */

(() => {
  "use strict";

  /* ===================================================================
   * 1) CONFIG
   * =================================================================== */
  const CONFIG = {
    GAME_DURATION_SEC: 60,     // 전체 제한 시간(초). 미션 전환 연출 동안은 정지.
    TIMER_HURRY_AT: 12,        // 남은 시간 경고 시점

    ENEMY_HEALTH: 70,          // 일반 계면이 체력
    BOSS_HEALTH: 170,          // 보스 계면이 체력(끝까지 버팀)
    WASH_RATE: 190,            // 거품/제품이 닿을 때 체력 감소 속도(per sec)

    FLEE_RADIUS: 96,           // 이 거리 안에 커서가 오면 도망
    CRAWL_SPEED: 36,           // 평소 기어다니는 속도(px/s)
    FLEE_SPEED: 150,           // 도망칠 때 속도(px/s)

    BUBBLE_TRAIL_PER_MOVE: 3,  // 드래그 1회 이동당 거품 수
    BUBBLE_MIN_R: 9,
    BUBBLE_MAX_R: 20,
    POOL_CAP: 360,             // 게임 파티클 풀 용량
    ENDING_CAP: 460,           // 엔딩 파티클 풀 용량
    ENEMY_POOL_MAX: 8,         // 계면이 DOM 풀 크기(미션 최대 마리수 이상)

    SHIELD_RATE: 0.5,          // 로션 보호막 차오르는 속도(per sec, 0~1)

    // ---- 제품 이미지 (한 곳에서 관리: 추후 로션 이미지 추가 시 lotion만 교체) ----
    PRODUCTS: {
      bathShampoo: "assets/products/eslo-baby-bath-shampoo.png",
      hipCleanser: "assets/products/eslo-baby-hip-cleanser.png",
      // TODO: 로션 이미지 준비되면 아래 경로만 교체하면 됩니다.
      lotion: "assets/products/eslo-baby-bath-shampoo.png",
    },

    // ---- 계면이 스프라이트 ----
    SPRITES: {
      idle: "assets/enemy/enemy-gyemyeon-idle.png",   // 기본
      cling: "assets/enemy/enemy-gyemyeon-cling.png", // 기어다님
      run: "assets/enemy/enemy-gyemyeon-run.png",     // 도망
      boss: "assets/enemy/enemy-gyemyeon-boss.png",   // 보스
      sad: "assets/enemy/sad-gyemyeon-idle.png",      // 씻겨 내려감
      best: "assets/enemy/best-gyemyeon-idle.png",    // 보호막에 튕겨남(행복)
    },

    // ---- 미션 정의 (데이터 주도 설계) ----
    MISSIONS: [
      {
        n: 1, label: "MISSION 1", product: "bathShampoo",
        type: "wash", count: 6, boss: false,
        zones: ["face", "arm", "belly", "leg", "hip"],
        story: "계면이들이 아기 피부에 잔뜩 달라붙었어요!",
        dockHint: "바스앤샴푸를 드래그해 거품을 만들어요!",
      },
      {
        n: 2, label: "MISSION 2", product: "hipCleanser",
        type: "wash", count: 4, boss: true,
        zones: ["hip"],
        story: "헤헤… 우린 아직 엉덩이에 숨어있지!",
        dockHint: "엉덩이 클렌저로 구석구석 씻어요!",
      },
      {
        n: 3, label: "MISSION 3", product: "lotion",
        type: "lotion", count: 5, boss: false,
        zones: ["face", "arm", "belly", "leg"],
        story: "깨끗하게 씻었어요! 이제 촉촉한 보호막을 만들어주세요.",
        dockHint: "로션을 문질러 반짝이는 보호막을 만들어요!",
      },
    ],

    // ---- 계면이가 붙는 신체 구역(아기 컨테이너 비율 좌표) ----
    ZONES: {
      face:  { x0: 0.30, y0: 0.07, x1: 0.70, y1: 0.30 },
      arm:   { x0: 0.10, y0: 0.40, x1: 0.90, y1: 0.62 },
      belly: { x0: 0.34, y0: 0.44, x1: 0.66, y1: 0.66 },
      leg:   { x0: 0.30, y0: 0.74, x1: 0.70, y1: 0.93 },
      hip:   { x0: 0.30, y0: 0.63, x1: 0.70, y1: 0.82 },
      all:   { x0: 0.12, y0: 0.08, x1: 0.88, y1: 0.92 },
    },
    BODY_BOUNDS: { x0: 0.04, y0: 0.03, x1: 0.96, y1: 0.97 }, // 도망 시 이탈 방지 경계

    SPEECHES: ["앗!", "으악~", "씻기 싫어~", "도망가!", "안돼~", "차가워!", "미끌미끌~", "뽁!"],
    REPEL_SPEECH: "앗… 이제 못 들어가!",
    // 엔딩 컨페티/폭죽 색상 (파스텔 + 브랜드)
    PARTY_COLORS: ["#ffd1e3", "#bfe3ff", "#c9f3e6", "#fff3b0", "#caa9ff", "#9fe6d2", "#ffb3c6"],
  };

  /* ===================================================================
   * 2) Utils
   * =================================================================== */
  const rand = (min, max) => min + Math.random() * (max - min);
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const pick = (arr) => arr[(Math.random() * arr.length) | 0];
  const dist2 = (ax, ay, bx, by) => { const dx = ax - bx, dy = ay - by; return dx * dx + dy * dy; };

  /* ===================================================================
   * 3) AudioManager (파일 없으면 조용히 무시)
   * =================================================================== */
  const AudioManager = {
    enabled: true,
    sounds: {},
    manifest: {
      bubble: "sound/bubble.mp3",
      pop: "sound/pop.mp3",
      water: "sound/water.mp3",
      clear: "sound/clear.mp3",
      success: "sound/success.mp3",
    },
    init() {
      Object.entries(this.manifest).forEach(([k, src]) => {
        try { const a = new Audio(src); a.preload = "auto"; this.sounds[k] = a; } catch (e) {}
      });
    },
    unlock() {
      Object.values(this.sounds).forEach((a) => {
        a.play().then(() => { a.pause(); a.currentTime = 0; }).catch(() => {});
      });
    },
    play(key, vol = 1) {
      if (!this.enabled) return;
      const base = this.sounds[key];
      if (!base) return;
      try { const a = base.cloneNode(); a.volume = vol; a.play().catch(() => {}); } catch (e) {}
    },
  };

  /* ===================================================================
   * 4) Input : 마우스/터치 통합 + 손 인식 입력 훅
   *    (손 인식 모듈 hand-tracking.js가 feedExternalPointer로 좌표를 흘려보냄)
   * =================================================================== */
  const Input = {
    el: null,
    isDown: false,
    mode: "pointer",     // "pointer" | "cameraHand"
    x: 0, y: 0,
    px: 0, py: 0,
    callbacks: { down: null, move: null, up: null },

    attach(el, callbacks) {
      this.el = el;
      this.callbacks = callbacks;
      el.addEventListener("pointerdown", this._onDown.bind(this));
      el.addEventListener("pointermove", this._onMove.bind(this));
      window.addEventListener("pointerup", this._onUp.bind(this));
      window.addEventListener("pointercancel", this._onUp.bind(this));
      el.addEventListener("touchstart", (e) => e.preventDefault(), { passive: false });
      el.addEventListener("touchmove", (e) => e.preventDefault(), { passive: false });
    },
    _toLocal(clientX, clientY) {
      const r = this.el.getBoundingClientRect();
      return { x: clientX - r.left, y: clientY - r.top };
    },
    _onDown(e) {
      this.mode = "pointer";
      const p = this._toLocal(e.clientX, e.clientY);
      this.isDown = true;
      this.x = this.px = p.x; this.y = this.py = p.y;
      this.callbacks.down && this.callbacks.down(p.x, p.y);
    },
    _onMove(e) {
      const p = this._toLocal(e.clientX, e.clientY);
      this.px = this.x; this.py = this.y;
      this.x = p.x; this.y = p.y;
      if (this.isDown) this.callbacks.move && this.callbacks.move(p.x, p.y, this.px, this.py);
    },
    _onUp() {
      if (!this.isDown) return;
      this.isDown = false;
      this.callbacks.up && this.callbacks.up();
    },
    /** 외부(손 인식 등) 입력 주입 — 마우스/터치와 동일 경로로 흐름 */
    feedExternalPointer(nx, ny, active, normalized = true) {
      this.mode = "cameraHand";
      const r = this.el.getBoundingClientRect();
      const x = normalized ? nx * r.width : nx;
      const y = normalized ? ny * r.height : ny;
      if (active && !this.isDown) { this.isDown = true; this.x = this.px = x; this.y = this.py = y; this.callbacks.down && this.callbacks.down(x, y); }
      else if (active && this.isDown) { this.px = this.x; this.py = this.y; this.x = x; this.y = y; this.callbacks.move && this.callbacks.move(x, y, this.px, this.py); }
      else if (!active && this.isDown) { this.isDown = false; this.callbacks.up && this.callbacks.up(); }
    },
  };

  /* ===================================================================
   * 5) AssetLoader : 스프라이트 사전 로드(첫 표시 끊김/깜빡임 방지)
   * =================================================================== */
  const AssetLoader = {
    cache: [],
    preload() {
      const list = [...Object.values(CONFIG.SPRITES), ...Object.values(CONFIG.PRODUCTS)];
      list.forEach((src) => { const img = new Image(); img.src = src; this.cache.push(img); });
    },
  };

  /* ===================================================================
   * 6) ParticlePool : 모든 파티클을 재사용(Object Pool)
   *    종류(kind): bubble / drop / water / sparkle / shield /
   *                confetti / fw(폭죽) / star
   * =================================================================== */
  class ParticlePool {
    constructor(canvas, cap) {
      this.canvas = canvas;
      this.ctx = canvas.getContext("2d");
      this.cap = cap;
      this.free = [];
      this.active = [];
      this.w = 0; this.h = 0; this.dpr = 1;
      for (let i = 0; i < cap; i++) this.free.push(this._blank());
    }
    _blank() {
      return { kind: "", x: 0, y: 0, vx: 0, vy: 0, r: 0, life: 1, age: 0, g: 0, rot: 0, spin: 0, color: "#fff", alpha: 1, wob: 0, sw: 0 };
    }
    resize() {
      const r = this.canvas.getBoundingClientRect();
      this.dpr = Math.min(window.devicePixelRatio || 1, 2);
      this.canvas.width = Math.max(1, r.width * this.dpr);
      this.canvas.height = Math.max(1, r.height * this.dpr);
      this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      this.w = r.width; this.h = r.height;
    }
    /** 풀에서 입자 하나 꺼내기(없으면 null → 스폰 생략으로 성능 보호) */
    obtain() {
      const p = this.free.pop();
      if (!p) return null;
      p.age = 0; p.alpha = 1;
      this.active.push(p);
      return p;
    }
    clear() {
      while (this.active.length) this.free.push(this.active.pop());
    }

    /* ---- 종류별 스폰 ---- */
    bubble(x, y) {
      const p = this.obtain(); if (!p) return;
      p.kind = "bubble";
      p.x = x + rand(-14, 14); p.y = y + rand(-14, 14);
      p.r = rand(CONFIG.BUBBLE_MIN_R, CONFIG.BUBBLE_MAX_R);
      p.vx = rand(-8, 8); p.vy = rand(-22, -6);
      p.wob = rand(0, 6.28); p.life = rand(1.6, 3.2);
    }
    drop(x, y) {
      const p = this.obtain(); if (!p) return;
      p.kind = "drop";
      p.x = x; p.y = y;
      p.vx = rand(-80, 80); p.vy = rand(-40, 60);
      p.r = rand(3, 7); p.g = 520; p.life = rand(0.5, 0.9);
    }
    water(x, y) {
      const p = this.obtain(); if (!p) return;
      p.kind = "water";
      p.x = x + rand(-8, 8); p.y = y;
      p.vx = rand(-20, 20); p.vy = rand(140, 260);
      p.r = rand(2.5, 5); p.g = 240; p.life = rand(0.5, 0.9);
    }
    sparkle(x, y) {
      const p = this.obtain(); if (!p) return;
      p.kind = "sparkle";
      p.x = x + rand(-26, 26); p.y = y + rand(-26, 26);
      p.r = rand(6, 14); p.rot = rand(0, 3.14); p.spin = rand(-4, 4);
      p.life = rand(0.5, 1.0); p.color = "#fff6c8";
    }
    shield(x, y) {
      const p = this.obtain(); if (!p) return;
      p.kind = "shield";
      p.x = x + rand(-22, 22); p.y = y + rand(-22, 22);
      p.r = rand(7, 16); p.rot = rand(0, 3.14); p.spin = rand(-3, 3);
      p.vy = rand(-26, -8); p.life = rand(0.6, 1.1); p.color = "#bfe3ff";
    }
    confetti() {
      const p = this.obtain(); if (!p) return;
      p.kind = "confetti";
      p.x = rand(0, this.w); p.y = rand(-40, -10);
      p.vx = rand(-30, 30); p.vy = rand(80, 170);
      p.r = rand(6, 11); p.sw = rand(0.6, 1.2);
      p.rot = rand(0, 6.28); p.spin = rand(-6, 6);
      p.wob = rand(0, 6.28); p.life = rand(3.5, 5.5);
      p.color = pick(CONFIG.PARTY_COLORS);
    }
    firework(cx, cy) {
      const n = 26, hue = pick(CONFIG.PARTY_COLORS);
      for (let i = 0; i < n; i++) {
        const p = this.obtain(); if (!p) return;
        p.kind = "fw";
        const a = (i / n) * 6.283, sp = rand(120, 260);
        p.x = cx; p.y = cy;
        p.vx = Math.cos(a) * sp; p.vy = Math.sin(a) * sp;
        p.r = rand(2.5, 4.5); p.g = 90; p.life = rand(0.9, 1.4); p.color = hue;
      }
    }
    star(x, y) {
      const p = this.obtain(); if (!p) return;
      p.kind = "star";
      p.x = x; p.y = y;
      p.r = rand(8, 18); p.rot = rand(0, 3.14); p.spin = rand(-2, 2);
      p.vy = rand(-30, -8); p.life = rand(0.8, 1.4); p.color = "#fff3b0";
    }

    /* ---- 물리 업데이트 (swap-remove로 비활성 입자 즉시 회수) ---- */
    update(dt) {
      const act = this.active;
      for (let i = act.length - 1; i >= 0; i--) {
        const p = act[i];
        p.age += dt;
        let dead = p.age >= p.life;
        switch (p.kind) {
          case "bubble":
            p.wob += dt * 3;
            p.x += (p.vx + Math.sin(p.wob) * 12) * dt;
            p.y += p.vy * dt; p.vy += -4 * dt;
            if (p.y < -30) dead = true;
            break;
          case "drop":
          case "water":
          case "fw":
            p.vy += p.g * dt; p.x += p.vx * dt; p.y += p.vy * dt;
            break;
          case "sparkle":
            p.rot += p.spin * dt;
            break;
          case "shield":
            p.rot += p.spin * dt; p.y += p.vy * dt;
            break;
          case "star":
            p.rot += p.spin * dt; p.y += p.vy * dt;
            break;
          case "confetti":
            p.wob += dt * 4;
            p.x += (p.vx + Math.sin(p.wob) * 30) * dt;
            p.y += p.vy * dt; p.rot += p.spin * dt;
            if (p.y > this.h + 40) dead = true;
            break;
        }
        if (dead) {
          act[i] = act[act.length - 1]; act.pop();
          this.free.push(p);
        }
      }
    }

    /* ---- 렌더링 ---- */
    render() {
      const ctx = this.ctx;
      ctx.clearRect(0, 0, this.w, this.h);
      const act = this.active;
      for (let i = 0; i < act.length; i++) {
        const p = act[i];
        const t = 1 - p.age / p.life; // 1→0 (페이드)
        switch (p.kind) {
          case "bubble": {
            const a = 0.85 * clamp(t * 1.4, 0, 1);
            ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 6.283);
            ctx.fillStyle = `rgba(220,240,255,${a * 0.55})`; ctx.fill();
            ctx.lineWidth = 1.5; ctx.strokeStyle = `rgba(255,255,255,${a})`; ctx.stroke();
            ctx.beginPath(); ctx.arc(p.x - p.r * 0.3, p.y - p.r * 0.3, p.r * 0.28, 0, 6.283);
            ctx.fillStyle = `rgba(255,255,255,${a})`; ctx.fill();
            break;
          }
          case "drop":
            ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 6.283);
            ctx.fillStyle = `rgba(140,200,255,${0.85 * t})`; ctx.fill();
            break;
          case "water":
            ctx.beginPath(); ctx.ellipse(p.x, p.y, p.r * 0.6, p.r * 1.7, 0, 0, 6.283);
            ctx.fillStyle = `rgba(150,205,255,${0.7 * t})`; ctx.fill();
            break;
          case "sparkle":
          case "shield":
            this._star4(ctx, p.x, p.y, p.r * t, p.rot, this._rgba(p.color, t));
            break;
          case "star":
            this._star5(ctx, p.x, p.y, p.r * (0.6 + 0.4 * Math.sin(p.age * 12)), p.rot, this._rgba(p.color, t));
            break;
          case "fw":
            ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 6.283);
            ctx.fillStyle = this._rgba(p.color, t); ctx.fill();
            break;
          case "confetti":
            ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot);
            ctx.globalAlpha = clamp(t * 1.5, 0, 1); ctx.fillStyle = p.color;
            ctx.fillRect(-p.r * 0.5, -p.r * 0.5 * p.sw, p.r, p.r * p.sw);
            ctx.restore(); ctx.globalAlpha = 1;
            break;
        }
      }
    }
    _rgba(hex, a) {
      const n = parseInt(hex.slice(1), 16);
      return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
    }
    _star4(ctx, x, y, r, rot, color) {
      ctx.save(); ctx.translate(x, y); ctx.rotate(rot); ctx.fillStyle = color; ctx.beginPath();
      for (let i = 0; i < 4; i++) { ctx.rotate(1.5708); ctx.moveTo(0, 0); ctx.quadraticCurveTo(r * 0.25, r * 0.25, r, 0); ctx.quadraticCurveTo(r * 0.25, -r * 0.25, 0, 0); }
      ctx.fill(); ctx.restore();
    }
    _star5(ctx, x, y, r, rot, color) {
      ctx.save(); ctx.translate(x, y); ctx.rotate(rot); ctx.fillStyle = color; ctx.beginPath();
      for (let i = 0; i < 10; i++) { const rad = i % 2 ? r * 0.45 : r; const a = (i / 10) * 6.283; ctx[i ? "lineTo" : "moveTo"](Math.cos(a) * rad, Math.sin(a) * rad); }
      ctx.closePath(); ctx.fill(); ctx.restore();
    }
  }

  /* ===================================================================
   * 7) Enemy : 계면이 (기어다님 → 도망 → 씻김/튕겨남)
   *    DOM 구조: .enemy(위치) > .enemy__inner(좌우반전·크기) > img(상태 애니)
   * =================================================================== */
  class Enemy {
    constructor(el) {
      this.el = el;
      this.inner = el.querySelector(".enemy__inner");
      this.img = el.querySelector(".enemy__img");
      this.inUse = false;
      this._sprite = "";
    }
    /** 풀에서 꺼내 새 미션용으로 초기화 */
    spawn(opts) {
      this.zone = opts.zone;
      this.bounds = opts.bounds;          // 활동 구역(px) — 스폰/리사이즈 때만 계산
      this.isBoss = opts.isBoss;
      this.maxHealth = opts.isBoss ? CONFIG.BOSS_HEALTH : CONFIG.ENEMY_HEALTH;
      this.health = this.maxHealth;
      this.state = "crawl";               // crawl | flee | washing | repelled
      this.cleared = false;
      this.onCleared = opts.onCleared;
      this.face = 1; this._bob = rand(0, 6.28);
      this._hurtT = 0; this._idleT = 0; this._endTimer = 0;
      this.x = rand(this.bounds.x0, this.bounds.x1);
      this.y = rand(this.bounds.y0, this.bounds.y1);
      this._newTarget();
      this.inUse = true;

      this.el.className = "enemy" + (this.isBoss ? " enemy--boss" : "");
      this.img.className = "enemy__img is-crawl";
      this.img.style.transform = "";
      this.el.style.display = "block";
      this._setSprite(this.isBoss ? "boss" : "cling");
      this._applyTransform();
    }
    _setSprite(name) {
      if (this._sprite === name) return;
      this._sprite = name;
      this.img.src = CONFIG.SPRITES[name];
    }
    _newTarget() {
      this.tx = rand(this.bounds.x0, this.bounds.x1);
      this.ty = rand(this.bounds.y0, this.bounds.y1);
      this._retargetT = rand(1.4, 3.4);
    }
    /** 구역 px 갱신(리사이즈 대응) */
    setBounds(b) { this.bounds = b; }

    hit(amount) {
      if (this.state === "washing" || this.state === "repelled") return;
      this.health -= amount;
      if (this._hurtT <= 0) { this.img.classList.add("is-hurt"); this._hurtT = 0.25; }
      if (this.health <= 0) this._wash();
    }
    /** 거품에 씻겨 내려감 */
    _wash() {
      this.state = "washing";
      this.img.className = "enemy__img is-washing";
      this.img.style.transform = "";
      this._setSprite("sad");
      Game.spawnWashSplash(this.x, this.y);
      Game.speech(this.x, this.y, pick(CONFIG.SPEECHES));
      AudioManager.play("pop");
      this._endTimer = 0.75;
    }
    /** 로션 보호막에 튕겨남 */
    repel() {
      if (this.state === "washing" || this.state === "repelled") return;
      this.state = "repelled";
      const dir = this.x < Game.field.w / 2 ? -1 : 1;
      this.el.style.setProperty("--fly-x", dir * rand(200, 360) + "px");
      this.el.style.setProperty("--fly-r", dir * rand(220, 560) + "deg");
      this.img.className = "enemy__img is-repelled";
      this.img.style.transform = "";
      this._setSprite("best");
      Game.speech(this.x, this.y, CONFIG.REPEL_SPEECH);
      Game.spawnSparkleBurst(this.x, this.y);
      AudioManager.play("pop");
      this._endTimer = 0.8;
    }

    update(dt, cursor) {
      if (!this.inUse) return;

      // 씻김/튕겨남: CSS 애니메이션이 처리, 타이머 끝나면 회수
      if (this.state === "washing" || this.state === "repelled") {
        this._endTimer -= dt;
        if (this._endTimer <= 0) this._finish();
        return;
      }
      if (this._hurtT > 0) { this._hurtT -= dt; if (this._hurtT <= 0) this.img.classList.remove("is-hurt"); }

      // 도망 판단
      let fleeing = false;
      if (cursor.active) {
        if (dist2(cursor.x, cursor.y, this.x, this.y) < CONFIG.FLEE_RADIUS * CONFIG.FLEE_RADIUS) fleeing = true;
      }

      if (fleeing) {
        this.state = "flee";
        if (!this.isBoss) this._setSprite("run");
        this.img.classList.remove("is-crawl");
        let dx = this.x - cursor.x, dy = this.y - cursor.y;
        const len = Math.hypot(dx, dy) || 1;
        const sp = CONFIG.FLEE_SPEED * (this.isBoss ? 0.72 : 1);
        this.x += (dx / len) * sp * dt;
        this.y += (dy / len) * sp * dt;
        this.face = dx >= 0 ? 1 : -1;
      } else {
        this.state = "crawl";
        this.img.classList.add("is-crawl");
        this._retargetT -= dt;
        if (this._retargetT <= 0) this._newTarget();
        let dx = this.tx - this.x, dy = this.ty - this.y;
        const len = Math.hypot(dx, dy);
        if (len < 6) {
          if (!this.isBoss) this._setSprite("idle");
          this._idleT -= dt; if (this._idleT <= 0) this._newTarget();
        } else {
          if (!this.isBoss) this._setSprite("cling");
          this._idleT = rand(0.4, 1.1);
          const sp = CONFIG.CRAWL_SPEED * (this.isBoss ? 0.8 : 1);
          this.x += (dx / len) * sp * dt;
          this.y += (dy / len) * sp * dt;
          this.face = dx >= 0 ? 1 : -1;
        }
      }

      // 아기 몸 밖으로 못 나가게 클램프
      const bb = Game.bodyBoundsPx;
      this.x = clamp(this.x, bb.x0, bb.x1);
      this.y = clamp(this.y, bb.y0, bb.y1);
      this._bob += dt * 6;
      this._applyTransform();
    }

    _applyTransform() {
      const bob = this.state === "crawl" ? Math.sin(this._bob) * 3 : 0;
      this.el.style.transform = `translate(${this.x}px, ${this.y + bob}px)`;
      const hp = clamp(0.6 + 0.4 * (this.health / this.maxHealth), 0.4, 1);
      this.inner.style.transform = `scaleX(${this.face}) scale(${hp})`;
    }
    _finish() {
      this.inUse = false;
      this.el.style.display = "none";
      this.el.className = "enemy";
      this.img.style.transform = "";
      if (this.onCleared && !this.cleared) { this.cleared = true; this.onCleared(this); }
    }
  }

  /* --- 계면이 DOM 풀: 요소를 재생성하지 않고 재사용 --- */
  const EnemyPool = {
    pool: [],
    init(layer, max) {
      for (let i = 0; i < max; i++) {
        const el = document.createElement("div");
        el.className = "enemy";
        el.style.display = "none";
        el.innerHTML = '<div class="enemy__inner"><img class="enemy__img" alt="계면이" draggable="false"></div>';
        layer.appendChild(el);
        this.pool.push(new Enemy(el));
      }
    },
    obtain() {
      for (const e of this.pool) if (!e.inUse) return e;
      return null;
    },
    resetAll() {
      for (const e of this.pool) { e.inUse = false; e.el.style.display = "none"; e.el.className = "enemy"; e.img.style.transform = ""; }
    },
    get activeList() { return this.pool.filter((e) => e.inUse); },
  };

  /* ===================================================================
   * 8) Game : 상태/미션/루프
   * =================================================================== */
  const Game = {
    state: "start",            // start | playing | success | fail
    missionIndex: 0,
    fields: {},
    field: { w: 0, h: 0 },
    particles: null,           // 게임용 파티클 풀
    ending: null,              // 엔딩용 파티클 풀
    cursor: { active: false, x: 0, y: 0 },
    timeLeft: 0,
    paused: false,
    lastTs: 0,
    running: false,

    // 미션 상태
    mission: null,
    remaining: 0,
    cleared: 0,
    shield: 0,                 // 로션 보호막 진행도 0~1
    repelledCount: 0,
    bodyBoundsPx: { x0: 0, y0: 0, x1: 0, y1: 0 },
    _endingT: 0,

    init() {
      const $ = (id) => document.getElementById(id);
      this.fields = {
        playfield: $("playfield"),
        babyContainer: $("baby-container"),
        enemyLayer: $("gyemyeon-layer"),
        shieldEl: $("skin-shield"),
        canvas: $("fx-canvas"),
        endingCanvas: $("ending-canvas"),
        toolCursor: $("tool-cursor"),
        missionToast: $("mission-toast"),
        hud: $("hud"),
        hudRemaining: $("hud-remaining"),
        hudTotal: $("hud-total"),
        hudTimer: $("hud-timer"),
        hudMission: $("hud-mission"),
        gaugeFill: $("gauge-fill"),
        productDock: $("product-dock"),
        productImg: $("product-img"),
        dockHint: $("dock-hint"),
        screenStart: $("screen-start"),
        screenSuccess: $("screen-success"),
        screenFail: $("screen-fail"),
      };

      this.particles = new ParticlePool(this.fields.canvas, CONFIG.POOL_CAP);
      this.ending = new ParticlePool(this.fields.endingCanvas, CONFIG.ENDING_CAP);

      AudioManager.init();
      AssetLoader.preload();
      EnemyPool.init(this.fields.enemyLayer, CONFIG.ENEMY_POOL_MAX);

      Input.attach(this.fields.playfield, {
        down: (x, y) => this.onDown(x, y),
        move: (x, y, px, py) => this.onMove(x, y, px, py),
        up: () => this.onUp(),
      });

      window.addEventListener("resize", () => this.resize());
      this.resize();

      $("btn-start").addEventListener("click", () => this.start());
      $("btn-restart-success").addEventListener("click", () => this.start());
      $("btn-restart-fail").addEventListener("click", () => this.start());

      this.running = true;
      this.lastTs = performance.now();
      requestAnimationFrame((t) => this.loop(t));
    },

    resize() {
      const r = this.fields.playfield.getBoundingClientRect();
      this.field.w = r.width; this.field.h = r.height;
      this.particles.resize();
      this.ending.resize();
      this._recalcBounds();
    },

    /** 신체 구역/경계 px 재계산(리사이즈 대응) — 활성 계면이 구역도 갱신 */
    _recalcBounds() {
      const rect = this.babyRect();
      this.bodyBoundsPx = this.zonePx(CONFIG.BODY_BOUNDS, rect);
      for (const e of EnemyPool.activeList) {
        e.setBounds(this.zonePx(CONFIG.ZONES[e.zone] || CONFIG.ZONES.all, rect));
      }
    },

    babyRect() {
      const br = this.fields.babyContainer.getBoundingClientRect();
      const pr = this.fields.playfield.getBoundingClientRect();
      return { x: br.left - pr.left, y: br.top - pr.top, w: br.width, h: br.height };
    },
    /** 비율 구역 → 플레이필드 px 구역 */
    zonePx(b, rect) {
      rect = rect || this.babyRect();
      return {
        x0: rect.x + b.x0 * rect.w, y0: rect.y + b.y0 * rect.h,
        x1: rect.x + b.x1 * rect.w, y1: rect.y + b.y1 * rect.h,
      };
    },

    /* ---------------- 시작/리셋 ---------------- */
    start() {
      AudioManager.unlock();
      this.fields.screenStart.classList.remove("is-active");
      this.fields.screenSuccess.classList.remove("is-active");
      this.fields.screenFail.classList.remove("is-active");
      this.fields.babyContainer.classList.remove("is-shiny");
      this.fields.shieldEl.style.opacity = 0;
      this.fields.shieldEl.classList.remove("is-on");

      this.state = "playing";
      this.missionIndex = 0;
      this.timeLeft = CONFIG.GAME_DURATION_SEC;
      this.paused = false;
      this.particles.clear();
      this.ending.clear();
      EnemyPool.resetAll();
      this.resize();

      this.enterMission(0);
    },

    /* ---------------- 미션 ---------------- */
    enterMission(index) {
      this.missionIndex = index;
      const m = CONFIG.MISSIONS[index];
      this.mission = m;
      this.cleared = 0;
      this.shield = 0;
      this.repelledCount = 0;
      this.fields.shieldEl.style.opacity = 0;
      this.fields.shieldEl.classList.remove("is-on");

      // 도구/제품 이미지 세팅 (제품 경로는 CONFIG.PRODUCTS 한 곳에서)
      const productSrc = CONFIG.PRODUCTS[m.product];
      this.fields.productImg.src = productSrc;
      this.fields.toolCursor.style.backgroundImage = `url("${productSrc}")`;
      this.fields.dockHint.textContent = m.dockHint;
      this.fields.hudMission.textContent = m.label;

      // 계면이 스폰
      this._spawnEnemies(m);
      this.remaining = m.count;
      this.fields.hudTotal.textContent = m.count;

      // 스토리 안내
      this.showToast(m.label, m.story);
      this.updateHud();
    },

    _spawnEnemies(m) {
      EnemyPool.resetAll();   // 이전 미션 잔여 계면이 정리(방어적)
      const rect = this.babyRect();
      const zones = m.zones.slice();
      for (let i = 0; i < m.count; i++) {
        const e = EnemyPool.obtain();
        if (!e) break;
        const zone = zones[i % zones.length];
        const isBoss = m.boss && i === 0;   // 미션당 보스 1마리
        e.spawn({
          zone,
          bounds: this.zonePx(CONFIG.ZONES[zone], rect),
          isBoss,
          onCleared: (en) => this.onEnemyCleared(en),
        });
      }
    },

    onEnemyCleared(enemy) {
      // 로션 미션에서는 보호막 진행이 클리어 기준이므로 카운트만 갱신
      if (this.mission.type === "wash") {
        this.cleared++;
        this.remaining = Math.max(0, this.mission.count - this.cleared);
        this.updateHud();
        if (this.cleared >= this.mission.count) this.completeMission();
      } else {
        this.remaining = Math.max(0, this.mission.count - this.repelledCount);
        this.updateHud();
      }
    },

    completeMission() {
      if (this.paused) return;
      this.paused = true;
      const isLast = this.missionIndex >= CONFIG.MISSIONS.length - 1;
      AudioManager.play("clear");

      if (!isLast) {
        this.showToast("MISSION CLEAR!", this.missionIndex === 0 ? "다음 계면이를 찾아라!" : "거의 다 왔어요!");
        setTimeout(() => { this.paused = false; this.enterMission(this.missionIndex + 1); }, 1700);
      } else {
        this.showToast("MISSION COMPLETE!", "보호막 완성! ✨");
        this.fields.babyContainer.classList.add("is-shiny");
        setTimeout(() => this.win(), 1500);
      }
    },

    /* ---------------- 입력 ---------------- */
    onDown(x, y) { if (this.state !== "playing" || this.paused) return; this.cursor.active = true; this.cursor.x = x; this.cursor.y = y; this._moveTool(x, y, true); this.applyTool(x, y, x, y); },
    onMove(x, y, px, py) { if (this.state !== "playing" || this.paused) return; this.cursor.active = true; this.cursor.x = x; this.cursor.y = y; this._moveTool(x, y, true); this.applyTool(x, y, px, py); },
    onUp() { this.cursor.active = false; this._moveTool(Input.x, Input.y, false); },

    _moveTool(x, y, active) {
      const el = this.fields.toolCursor;
      el.classList.toggle("is-active", !!active);
      el.style.transform = `translate(${x}px, ${y}px)`;
    },

    /** 현재 미션 도구 효과 적용 */
    applyTool(x, y, px, py) {
      if (this.mission.type === "wash") {
        // 제품 드래그 경로에 거품 생성
        for (let i = 0; i < CONFIG.BUBBLE_TRAIL_PER_MOVE; i++) {
          const t = i / CONFIG.BUBBLE_TRAIL_PER_MOVE;
          this.particles.bubble(px + (x - px) * t, py + (y - py) * t);
        }
        if (Math.random() < 0.18) AudioManager.play("bubble", 0.5);
      } else {
        // 로션: 아기 몸 위를 문지르면 보호막 진행 + 반짝이
        const r = this.babyRect();
        const inside = x > r.x && x < r.x + r.w && y > r.y && y < r.y + r.h;
        if (inside) {
          this.particles.shield(x, y);
          this.particles.sparkle(x, y);
        }
      }
    },

    /* ---------------- 연출 헬퍼 ---------------- */
    spawnWashSplash(x, y) {
      for (let i = 0; i < 8; i++) this.particles.drop(x, y);
      for (let i = 0; i < 6; i++) this.particles.water(x, y);
    },
    spawnSparkleBurst(x, y) {
      for (let i = 0; i < 6; i++) this.particles.sparkle(x, y);
    },
    speech(x, y, text) {
      const sp = document.createElement("div");
      sp.className = "speech";
      sp.textContent = text;
      sp.style.left = `${x}px`;
      sp.style.top = `${y}px`;
      this.fields.enemyLayer.appendChild(sp);
      setTimeout(() => sp.remove(), 950);
    },

    /* ---------------- 루프 ---------------- */
    loop(ts) {
      if (!this.running) return;
      let dt = (ts - this.lastTs) / 1000;
      this.lastTs = ts;
      dt = Math.min(dt, 0.05);

      if (this.state === "playing") {
        this.update(dt);
        this.particles.update(dt);
        this.particles.render();
      } else if (this.state === "success") {
        this._endingTick(dt);
        this.ending.update(dt);
        this.ending.render();
      } else {
        this.particles.render(); // start/fail: 캔버스 비우기
      }

      requestAnimationFrame((t) => this.loop(t));
    },

    update(dt) {
      const enemies = EnemyPool.activeList;

      // 계면이 AI
      for (const e of enemies) e.update(dt, this.cursor);

      // 미션별 메커니즘
      if (this.mission.type === "wash") {
        this._updateWash(dt, enemies);
      } else {
        this._updateLotion(dt, enemies);
      }

      // 타이머
      if (!this.paused) {
        this.timeLeft -= dt;
        if (this.timeLeft <= 0) { this.timeLeft = 0; this.lose(); }
      }
      this.updateHud();
    },

    /** 씻기 미션: 거품/커서와 충돌하면 체력 감소 */
    _updateWash(dt, enemies) {
      const bubbles = this.particles.active;
      const dmg = CONFIG.WASH_RATE * dt;
      const cursorActive = this.cursor.active;
      for (const e of enemies) {
        if (e.state === "washing" || e.state === "repelled") continue;
        let touch = false;
        // 커서(제품)로 직접 문지르면 즉시 반응
        if (cursorActive && dist2(this.cursor.x, this.cursor.y, e.x, e.y) < 46 * 46) touch = true;
        // 거품 충돌
        if (!touch) {
          for (let i = 0; i < bubbles.length; i++) {
            const b = bubbles[i];
            if (b.kind !== "bubble") continue;
            const rr = b.r + 26;
            if (dist2(b.x, b.y, e.x, e.y) < rr * rr) { touch = true; break; }
          }
        }
        if (touch) e.hit(dmg);
      }
    },

    /** 로션 미션: 보호막 차오름 → 단계별로 계면이 튕겨냄 */
    _updateLotion(dt, enemies) {
      // 커서가 아기 몸 위에서 드래그 중이면 보호막이 차오름(이벤트 타이밍에 의존하지 않음)
      const r = this.babyRect();
      const rubbing = this.cursor.active &&
        this.cursor.x > r.x && this.cursor.x < r.x + r.w &&
        this.cursor.y > r.y && this.cursor.y < r.y + r.h;
      if (rubbing) {
        this.shield = clamp(this.shield + CONFIG.SHIELD_RATE * dt, 0, 1);
        const el = this.fields.shieldEl;
        el.classList.add("is-on");
        el.style.opacity = (0.15 + this.shield * 0.85).toFixed(3);
        if (this.shield > 0.45) this.fields.babyContainer.classList.add("is-shiny");
      }
      // 보호막 진행도에 따라 계면이를 순차적으로 튕겨냄
      const total = this.mission.count;
      const repelThreshold = (this.repelledCount + 1) / total * 0.92;
      if (this.shield >= repelThreshold && this.repelledCount < total) {
        const target = enemies.find((e) => e.state !== "repelled" && e.state !== "washing");
        if (target) { target.repel(); this.repelledCount++; this.remaining = Math.max(0, total - this.repelledCount); }
      }
      // 보호막 완성 + 모두 튕겨냄 → 미션 완료
      if (this.shield >= 1 && this.repelledCount >= total && !this.paused) {
        this.completeMission();
      }
    },

    /* ---------------- HUD / 토스트 ---------------- */
    updateHud() {
      this.fields.hudRemaining.textContent = this.remaining;
      this.fields.hudTimer.textContent = Math.ceil(this.timeLeft);
      let progress = 0;
      if (this.mission.type === "wash") progress = this.cleared / this.mission.count;
      else progress = this.shield;
      this.fields.gaugeFill.style.width = (clamp(progress, 0, 1) * 100).toFixed(1) + "%";
      this.fields.hud.classList.toggle("is-hurry", this.timeLeft <= CONFIG.TIMER_HURRY_AT);
    },
    showToast(big, sub) {
      const el = this.fields.missionToast;
      el.innerHTML = `<div class="mission-toast__big">${big}</div><div class="mission-toast__sub">${sub}</div>`;
      el.classList.remove("is-show");
      void el.offsetWidth;
      el.classList.add("is-show");
    },

    /* ---------------- 엔딩 연출 (컨페티/폭죽/별) ---------------- */
    _endingTick(dt) {
      this._endingT += dt;
      // 컨페티 지속 낙하
      if (Math.random() < dt * 60) for (let i = 0; i < 3; i++) this.ending.confetti();
      // 폭죽 주기적 발사
      if (this._endingT > 0.6) {
        this._endingT = 0;
        this.ending.firework(rand(this.ending.w * 0.2, this.ending.w * 0.8), rand(this.ending.h * 0.18, this.ending.h * 0.5));
        for (let i = 0; i < 3; i++) this.ending.star(rand(0, this.ending.w), rand(0, this.ending.h * 0.6));
      }
    },

    /* ---------------- 종료 ---------------- */
    win() {
      this.state = "success";
      this.paused = false;
      this._endingT = 0;
      this.particles.clear();
      this.ending.clear();
      this.ending.resize();
      AudioManager.play("success");
      // === 확장 지점: 점수/최고기록 저장, QR 보상 발급 등 ===
      this.fields.screenSuccess.classList.add("is-active");
    },
    lose() {
      if (this.state !== "playing") return;
      this.state = "fail";
      this.fields.screenFail.classList.add("is-active");
    },
  };

  // 전역 노출 (손 인식 모듈/디버깅/확장)
  window.EsloGame = Game;
  window.EsloInput = Input;

  /* ===================================================================
   * 9) bootstrap
   * =================================================================== */
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => Game.init());
  } else {
    Game.init();
  }
})();
