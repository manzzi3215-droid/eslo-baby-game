/* =====================================================================
 * 이슬로 베이비 버블 클린 - script.js
 * Vanilla JavaScript (외부 프레임워크 미사용)
 *
 * 구조 요약
 *  1) CONFIG          : 게임 상수 (난이도/시간/개수 등) — 행사 운영 시 이 부분만 조정
 *  2) Utils           : 공용 유틸 함수
 *  3) AudioManager    : 사운드 재생 (현재는 파일 없이도 동작, 주석 가이드 포함)
 *  4) InputManager    : 포인터(마우스/터치/펜) 입력을 통합 → 추후 MediaPipe Hands 연동 지점
 *  5) ParticleSystem  : 캔버스 기반 거품/물방울/물줄기/반짝이 파티클
 *  6) Gyemyeon        : 계면이 캐릭터 클래스
 *  7) Game            : 상태/미션/루프 총괄
 *  8) bootstrap       : 초기화 및 버튼 바인딩
 *
 * 좌표계: 모든 게임 좌표는 "플레이필드(playfield) 픽셀" 기준입니다.
 *         포인터/캔버스/계면이 모두 같은 좌표계를 사용해 충돌을 계산합니다.
 * ===================================================================== */

(() => {
  "use strict";

  /* ===================================================================
   * 1) CONFIG : 게임 설정 상수
   *    - 행사 난이도/시간 조정은 이 객체만 수정하면 됩니다.
   * =================================================================== */
  const CONFIG = {
    GYEMYEON_COUNT: 7,          // 계면이 마리 수
    GAME_DURATION_SEC: 40,      // 제한 시간(초). 기획 기준 30초 → 토들러 배려로 40 기본값
    TIMER_HURRY_AT: 10,         // 남은 시간 이때부터 빨간 경고

    WASH_RATE: 160,             // 거품이 닿을 때 계면이 체력 감소 속도(per sec)
    GY_MAX_HEALTH: 100,         // 계면이 체력
    GY_CRY_AT: 40,              // 체력 이하일 때 울먹임 상태

    BUBBLE_MAX: 260,            // 동시에 존재 가능한 거품 최대 수(성능 보호)
    BUBBLE_TRAIL_PER_MOVE: 3,   // 드래그 1회 이동당 생성 거품 수
    BUBBLE_MIN_R: 9,
    BUBBLE_MAX_R: 20,

    M2_RINSE_RADIUS: 80,        // 샤워 물줄기가 거품을 씻어내는 반경
    M2_CLEAR_RATIO: 0.08,       // 거품이 이 비율 이하로 남으면 미션2 클리어
    M3_DRY_NEEDED: 100,         // 미션3 닦기 진행 총량
    M3_DRY_RATE: 70,            // 수건이 아기에 닿을 때 진행 속도(per sec)

    // 계면이 제거 시 랜덤 말풍선 문구
    SPEECHES: ["앗!", "으악~", "씻기 싫어~", "도망가!", "안돼~", "차가워!", "미끌미끌~", "뽁!"],
  };

  /* ===================================================================
   * 2) Utils : 공용 유틸 함수
   * =================================================================== */
  const rand = (min, max) => min + Math.random() * (max - min);          // 실수 난수
  const randInt = (min, max) => Math.floor(rand(min, max + 1));          // 정수 난수
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));            // 범위 제한
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];    // 배열 랜덤 선택
  const dist2 = (ax, ay, bx, by) => {                                    // 거리 제곱(루트 생략→성능)
    const dx = ax - bx, dy = ay - by;
    return dx * dx + dy * dy;
  };

  /* ===================================================================
   * 3) AudioManager : 사운드 매니저
   *    - sound 폴더에 mp3가 있으면 재생, 없으면 조용히 무시(행사장 안정성).
   *    - 모바일/태블릿은 첫 사용자 입력 후에만 오디오가 허용되므로
   *      START 버튼에서 unlock()을 호출합니다.
   * =================================================================== */
  const AudioManager = {
    enabled: true,
    sounds: {},

    // 사용할 사운드 목록 (sound/ 폴더에 동일 이름의 mp3를 넣으면 자동 재생)
    manifest: {
      bubble: "sound/bubble.mp3",   // 거품 생성
      pop: "sound/pop.mp3",         // 계면이 "뽁!" 사라짐
      water: "sound/water.mp3",     // 샤워 물줄기
      clear: "sound/clear.mp3",     // 미션 클리어
      success: "sound/success.mp3", // 최종 성공
    },

    /** 오디오 객체 미리 생성 (파일이 없어도 에러가 게임을 막지 않음) */
    init() {
      Object.entries(this.manifest).forEach(([key, src]) => {
        try {
          const a = new Audio(src);
          a.preload = "auto";
          this.sounds[key] = a;
        } catch (e) {
          /* 파일이 없으면 무시 */
        }
      });
    },

    /** 모바일 오디오 잠금 해제: 첫 터치/클릭 시 호출 */
    unlock() {
      Object.values(this.sounds).forEach((a) => {
        a.play().then(() => { a.pause(); a.currentTime = 0; }).catch(() => {});
      });
    },

    /** 사운드 재생 (없으면 무시). vol: 0~1 */
    play(key, vol = 1) {
      if (!this.enabled) return;
      const base = this.sounds[key];
      if (!base) return;
      try {
        // 동시 다발 재생을 위해 복제 후 재생
        const a = base.cloneNode();
        a.volume = vol;
        a.play().catch(() => {});
      } catch (e) {}
    },
  };

  /* ===================================================================
   * 4) InputManager : 입력 추상화 레이어
   *    - 마우스/터치/펜을 Pointer Events로 통합 처리.
   *    - 게임은 onDown/onMove/onUp 콜백만 사용하므로, 추후 MediaPipe Hands가
   *      손 좌표를 feedExternalPointer()로 흘려보내면 그대로 동작합니다.
   *
   *    [MediaPipe 연동 예시]
   *      hands.onResults((res) => {
   *        const tip = res.multiHandLandmarks?.[0]?.[8]; // 검지 끝
   *        if (tip) Input.feedExternalPointer(tip.x, tip.y, true, true); // (정규화 좌표)
   *        else Input.feedExternalPointer(0, 0, false, true);
   *      });
   * =================================================================== */
  const Input = {
    el: null,
    isDown: false,
    mode: "pointer",    // "pointer"(마우스/터치) | "cameraHand"(손 인식) — 현재 활성 입력 소스
    x: 0, y: 0,         // 현재 포인터(플레이필드 좌표)
    px: 0, py: 0,       // 직전 포인터
    callbacks: { down: null, move: null, up: null },

    /** 입력 대상 엘리먼트에 리스너 부착 */
    attach(el, callbacks) {
      this.el = el;
      this.callbacks = callbacks;

      // Pointer Events 하나로 마우스/터치/펜 통합
      el.addEventListener("pointerdown", this._onDown.bind(this));
      el.addEventListener("pointermove", this._onMove.bind(this));
      window.addEventListener("pointerup", this._onUp.bind(this));
      window.addEventListener("pointercancel", this._onUp.bind(this));

      // 터치 기본 동작(스크롤/줌) 방지
      el.addEventListener("touchstart", (e) => e.preventDefault(), { passive: false });
      el.addEventListener("touchmove", (e) => e.preventDefault(), { passive: false });
    },

    /** 화면(client) 좌표 → 플레이필드 좌표로 변환 */
    _toLocal(clientX, clientY) {
      const r = this.el.getBoundingClientRect();
      return { x: clientX - r.left, y: clientY - r.top };
    },

    _onDown(e) {
      this.mode = "pointer";   // 마우스/터치 입력이 들어오면 포인터 모드
      const p = this._toLocal(e.clientX, e.clientY);
      this.isDown = true;
      this.x = this.px = p.x;
      this.y = this.py = p.y;
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

    /**
     * 외부(예: MediaPipe Hands) 입력 주입용 훅.
     * @param {number} nx,ny  - 정규화 좌표(0~1)면 normalized=true
     * @param {boolean} active - 손이 펴져 있어 "드래그 중"인지
     * @param {boolean} normalized - nx,ny가 0~1 정규화 좌표인지
     */
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
   * 5) ParticleSystem : 캔버스 파티클(거품/물방울/물줄기/반짝이)
   *    - 종류(type)에 따라 그리기/물리를 다르게 처리.
   *    - 거품(bubble)은 충돌 대상이라 별도 배열에서도 참조됩니다.
   * =================================================================== */
  class ParticleSystem {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext("2d");
      this.bubbles = [];   // 충돌/헹굼 대상 거품
      this.fx = [];        // 그 외 이펙트(물방울/물줄기/반짝이/스플래시)
      this.dpr = 1;
    }

    /** 캔버스를 플레이필드 크기에 맞춰 리사이즈(고해상도 대응) */
    resize() {
      const r = this.canvas.getBoundingClientRect();
      this.dpr = Math.min(window.devicePixelRatio || 1, 2);
      this.canvas.width = r.width * this.dpr;
      this.canvas.height = r.height * this.dpr;
      this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      this.w = r.width;
      this.h = r.height;
    }

    clearAll() { this.bubbles.length = 0; this.fx.length = 0; }

    /** 거품 생성 (드래그 경로에 풍성하게) */
    spawnBubble(x, y) {
      if (this.bubbles.length >= CONFIG.BUBBLE_MAX) return;
      this.bubbles.push({
        x: x + rand(-14, 14),
        y: y + rand(-14, 14),
        r: rand(CONFIG.BUBBLE_MIN_R, CONFIG.BUBBLE_MAX_R),
        vx: rand(-8, 8),
        vy: rand(-22, -6),      // 살짝 떠오름(둥실)
        wob: rand(0, Math.PI * 2),
        life: rand(6, 12),      // 충분히 오래 남아 미션2 헹굼 대상이 됨
        popping: 0,
      });
    }

    /** 물방울 효과(계면이 제거 순간) */
    spawnDroplets(x, y, n = 8) {
      for (let i = 0; i < n; i++) {
        this.fx.push({
          type: "drop", x, y,
          vx: rand(-90, 90), vy: rand(-160, -40),
          r: rand(3, 7), life: rand(0.5, 0.9), age: 0, g: 520,
        });
      }
    }

    /** 샤워 물줄기(아래로 흐르는 물 입자) */
    spawnWaterStream(x, y) {
      for (let i = 0; i < 3; i++) {
        this.fx.push({
          type: "water", x: x + rand(-10, 10), y: y + rand(0, 10),
          vx: rand(-30, 30), vy: rand(180, 320),
          r: rand(2.5, 5), life: rand(0.4, 0.7), age: 0, g: 240,
        });
      }
    }

    /** 작은 스플래시(거품이 헹궈질 때) */
    spawnSplash(x, y) {
      for (let i = 0; i < 5; i++) {
        this.fx.push({
          type: "drop", x, y,
          vx: rand(-70, 70), vy: rand(-120, -20),
          r: rand(2, 5), life: rand(0.3, 0.6), age: 0, g: 480,
        });
      }
    }

    /** 반짝이(수건 닦기/성공 연출) */
    spawnSparkle(x, y, n = 2) {
      for (let i = 0; i < n; i++) {
        this.fx.push({
          type: "sparkle", x: x + rand(-30, 30), y: y + rand(-30, 30),
          r: rand(6, 14), life: rand(0.5, 1.0), age: 0,
          rot: rand(0, Math.PI), spin: rand(-4, 4),
        });
      }
    }

    /** 물리 업데이트 */
    update(dt) {
      // 거품
      for (let i = this.bubbles.length - 1; i >= 0; i--) {
        const b = this.bubbles[i];
        if (b.popping > 0) {
          b.popping -= dt;
          if (b.popping <= 0) { this.bubbles.splice(i, 1); continue; }
          continue;
        }
        b.wob += dt * 3;
        b.x += (b.vx + Math.sin(b.wob) * 12) * dt;
        b.y += b.vy * dt;
        b.vy += -4 * dt;                 // 천천히 더 떠오름
        b.life -= dt;
        if (b.y < -30 || b.life <= 0) this.bubbles.splice(i, 1);
      }
      // 그 외 이펙트
      for (let i = this.fx.length - 1; i >= 0; i--) {
        const p = this.fx[i];
        p.age += dt;
        if (p.age >= p.life) { this.fx.splice(i, 1); continue; }
        if (p.type === "sparkle") { p.rot += p.spin * dt; }
        else {
          p.vy += (p.g || 0) * dt;
          p.x += p.vx * dt;
          p.y += p.vy * dt;
        }
      }
    }

    /** 즉시 거품 일부를 헹굼(미션2): 지정 좌표 반경 내 거품을 펑 처리 */
    rinseAt(x, y, radius) {
      const r2 = radius * radius;
      let removed = 0;
      for (const b of this.bubbles) {
        if (b.popping > 0) continue;
        if (dist2(b.x, b.y, x, y) < r2) {
          b.popping = 0.18;
          this.spawnSplash(b.x, b.y);
          removed++;
        }
      }
      return removed;
    }

    /** 렌더링 */
    render() {
      const ctx = this.ctx;
      ctx.clearRect(0, 0, this.w, this.h);

      // 거품: 반투명 + 하이라이트
      for (const b of this.bubbles) {
        const a = b.popping > 0 ? clamp(b.popping / 0.18, 0, 1) * 0.9 : 0.85;
        ctx.beginPath();
        ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(220, 240, 255, ${a * 0.55})`;
        ctx.fill();
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = `rgba(255, 255, 255, ${a})`;
        ctx.stroke();
        // 하이라이트
        ctx.beginPath();
        ctx.arc(b.x - b.r * 0.3, b.y - b.r * 0.3, b.r * 0.28, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255, 255, 255, ${a})`;
        ctx.fill();
      }

      // 이펙트
      for (const p of this.fx) {
        const t = 1 - p.age / p.life;
        if (p.type === "water") {
          ctx.beginPath();
          ctx.ellipse(p.x, p.y, p.r * 0.6, p.r * 1.6, 0, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(150, 205, 255, ${0.7 * t})`;
          ctx.fill();
        } else if (p.type === "drop") {
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(140, 200, 255, ${0.85 * t})`;
          ctx.fill();
        } else if (p.type === "sparkle") {
          this._drawStar(ctx, p.x, p.y, p.r * t, p.rot, `rgba(255, 246, 200, ${t})`);
        }
      }
    }

    /** 4갈래 반짝이 별 그리기 */
    _drawStar(ctx, x, y, r, rot, color) {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(rot);
      ctx.fillStyle = color;
      ctx.beginPath();
      for (let i = 0; i < 4; i++) {
        ctx.rotate(Math.PI / 2);
        ctx.moveTo(0, 0);
        ctx.quadraticCurveTo(r * 0.25, r * 0.25, r, 0);
        ctx.quadraticCurveTo(r * 0.25, -r * 0.25, 0, 0);
      }
      ctx.fill();
      ctx.restore();
    }
  }

  /* ===================================================================
   * 6) Gyemyeon : 계면이 캐릭터
   *    - 앵커(붙은 위치) 기준으로 통통 튀고 좌우로 흔들리며,
   *      가끔 위치를 바꿔 "살아있는 장난꾸러기" 느낌을 줍니다.
   *    - 거품에 닿으면 체력이 줄고, 0이 되면 펑! 사라집니다.
   * =================================================================== */
  class Gyemyeon {
    /**
     * @param {object} layer  - DOM 레이어
     * @param {object} field  - {w,h} 플레이필드 크기 getter
     * @param {number} ax,ay  - 앵커 좌표(플레이필드 px)
     */
    constructor(layer, field, ax, ay) {
      this.field = field;
      this.ax = ax; this.ay = ay;       // 앵커(기준 위치)
      this.cx = ax; this.cy = ay;       // 현재 중심(충돌 계산용)
      this.health = CONFIG.GY_MAX_HEALTH;
      this.alive = true;
      this.dead = false;

      this.t = rand(0, Math.PI * 2);    // 위상(개체마다 다르게)
      this.hopSpeed = rand(2.4, 3.6);
      this.swaySpeed = rand(1.2, 2.0);
      this.hopAmp = rand(6, 12);
      this.swayAmp = rand(10, 22);
      this.repositionTimer = rand(2.5, 5); // 위치 바꾸기까지 시간

      // DOM 생성
      this.el = document.createElement("div");
      this.el.className = "gyemyeon is-idle";
      this.el.innerHTML = `<img class="gyemyeon__img" src="assets/gyemyeon.jpg" alt="계면이" draggable="false">`;
      layer.appendChild(this.el);

      this._surprisedT = 0;
    }

    /** 거품/도구가 닿았을 때 데미지 */
    hit(amount) {
      if (!this.alive) return;
      this.health -= amount;
      // 놀람 연출(짧게)
      if (this._surprisedT <= 0) {
        this.el.classList.add("is-surprised");
        this._surprisedT = 0.35;
      }
      // 울먹임 연출
      if (this.health <= CONFIG.GY_CRY_AT) {
        this.el.classList.remove("is-idle");
        this.el.classList.add("is-crying");
      }
      if (this.health <= 0) this._pop();
    }

    /** 펑! 제거 연출 → 말풍선/물방울/사운드 */
    _pop() {
      if (!this.alive) return;
      this.alive = false;
      this.el.classList.remove("is-idle", "is-crying", "is-surprised");
      this.el.classList.add("is-popping");

      // 말풍선
      const sp = document.createElement("div");
      sp.className = "speech";
      sp.textContent = pick(CONFIG.SPEECHES);
      sp.style.left = `${this.cx}px`;
      sp.style.top = `${this.cy}px`;
      this.el.parentElement.appendChild(sp);
      setTimeout(() => sp.remove(), 950);

      AudioManager.play("pop");

      // 콜백(게임에 알림): 물방울 효과 + 카운트 감소
      if (this.onPop) this.onPop(this.cx, this.cy);

      // DOM 제거
      setTimeout(() => { this.el.remove(); this.dead = true; }, 380);
    }

    /** 매 프레임 모션 업데이트 */
    update(dt) {
      if (!this.alive) return;
      this.t += dt;

      // 놀람 타이머
      if (this._surprisedT > 0) {
        this._surprisedT -= dt;
        if (this._surprisedT <= 0) this.el.classList.remove("is-surprised");
      }

      // 가끔 위치 변경(장난치며 도망다니는 느낌)
      this.repositionTimer -= dt;
      if (this.repositionTimer <= 0) {
        this.repositionTimer = rand(2.5, 5);
        const a = Game.randomAnchorNear(this.ax, this.ay);
        this.ax = a.x; this.ay = a.y;
      }

      // 통통(상하) + 좌우 흔들림
      const hop = Math.abs(Math.sin(this.t * this.hopSpeed)) * this.hopAmp;
      const sway = Math.sin(this.t * this.swaySpeed) * this.swayAmp;
      this.cx = this.ax + sway;
      this.cy = this.ay - hop;

      // 체력에 따른 크기/투명도 (점점 작아지고 투명해짐)
      const s = clamp(0.55 + (this.health / CONFIG.GY_MAX_HEALTH) * 0.45, 0.2, 1);
      const op = clamp(this.health / (CONFIG.GY_CRY_AT * 0.8), 0.25, 1);
      this.el.style.opacity = op;
      this.el.style.transform = `translate(${this.cx}px, ${this.cy}px) scale(${s})`;
    }
  }

  /* ===================================================================
   * 7) Game : 게임 총괄 (상태/미션/루프)
   *    상태: "start" → "playing"(mission 1~3) → "success" | "fail"
   * =================================================================== */
  const Game = {
    state: "start",
    mission: 1,
    fields: {},          // DOM 참조 모음
    field: { w: 0, h: 0 },
    particles: null,
    gyemyeons: [],
    remaining: 0,
    timeLeft: 0,
    paused: false,       // 미션 전환 연출 동안 타이머 정지
    dryProgress: 0,      // 미션3 진행도
    m2InitialBubbles: 0, // 미션2 시작 시 거품 수(진행률 계산 기준)
    lastTs: 0,
    running: false,

    /** 최초 1회 초기화 */
    init() {
      const $ = (id) => document.getElementById(id);
      this.fields = {
        playfield: $("playfield"),
        babyContainer: $("baby-container"),
        gyLayer: $("gyemyeon-layer"),
        canvas: $("fx-canvas"),
        toolCursor: $("tool-cursor"),
        missionToast: $("mission-toast"),
        hud: $("hud"),
        hudRemaining: $("hud-remaining"),
        hudTotal: $("hud-total"),
        hudTimer: $("hud-timer"),
        hudMission: $("hud-mission"),
        gaugeFill: $("gauge-fill"),
        productDock: $("product-dock"),
        dockHint: $("dock-hint"),
        screenStart: $("screen-start"),
        screenSuccess: $("screen-success"),
        screenFail: $("screen-fail"),
      };

      this.particles = new ParticleSystem(this.fields.canvas);

      AudioManager.init();

      // 입력 연결
      Input.attach(this.fields.playfield, {
        down: (x, y) => this.onDown(x, y),
        move: (x, y, px, py) => this.onMove(x, y, px, py),
        up: () => this.onUp(),
      });

      // 리사이즈 대응
      window.addEventListener("resize", () => this.resize());
      this.resize();

      // 버튼 바인딩
      $("btn-start").addEventListener("click", () => this.start());
      $("btn-restart-success").addEventListener("click", () => this.start());
      $("btn-restart-fail").addEventListener("click", () => this.start());

      // 렌더 루프 시작(상태와 무관하게 항상 도는 단일 루프)
      this.running = true;
      this.lastTs = performance.now();
      requestAnimationFrame((t) => this.loop(t));
    },

    /** 플레이필드 크기 갱신 */
    resize() {
      const r = this.fields.playfield.getBoundingClientRect();
      this.field.w = r.width;
      this.field.h = r.height;
      this.particles.resize();
    },

    /* ---------------- 게임 시작/리셋 ---------------- */
    start() {
      AudioManager.unlock(); // 모바일 오디오 잠금 해제

      // 화면 정리
      this.fields.screenStart.classList.remove("is-active");
      this.fields.screenSuccess.classList.remove("is-active");
      this.fields.screenFail.classList.remove("is-active");
      this.fields.babyContainer.classList.remove("is-shiny");

      // 상태 리셋
      this.state = "playing";
      this.mission = 1;
      this.timeLeft = CONFIG.GAME_DURATION_SEC;
      this.paused = false;
      this.dryProgress = 0;
      this.particles.clearAll();

      // 기존 계면이 제거
      this.gyemyeons.forEach((g) => g.el && g.el.remove());
      this.gyemyeons = [];

      this.resize();
      this.spawnGyemyeons();

      this.remaining = this.gyemyeons.length;
      this.fields.hudTotal.textContent = CONFIG.GYEMYEON_COUNT;

      // 미션1 진입
      this.enterMission(1);
      this.updateHud();
    },

    /* ---------------- 계면이 배치 ---------------- */

    /** 아기 몸 영역(플레이필드 좌표) 계산 */
    babyRect() {
      const br = this.fields.babyContainer.getBoundingClientRect();
      const pr = this.fields.playfield.getBoundingClientRect();
      return { x: br.left - pr.left, y: br.top - pr.top, w: br.width, h: br.height };
    },

    /** 아기 몸 위 앵커 후보(컨테이너 비율) — 머리/팔/배/다리 등 */
    anchorRatios: [
      { x: 0.50, y: 0.16 }, // 머리 위
      { x: 0.30, y: 0.30 }, // 왼볼/어깨
      { x: 0.70, y: 0.30 }, // 오른볼/어깨
      { x: 0.22, y: 0.62 }, // 왼팔
      { x: 0.78, y: 0.62 }, // 오른팔
      { x: 0.50, y: 0.64 }, // 배
      { x: 0.38, y: 0.86 }, // 왼다리
      { x: 0.62, y: 0.86 }, // 오른다리
      { x: 0.50, y: 0.42 }, // 가슴
    ],

    /** 계면이 7마리를 랜덤 앵커에 배치 */
    spawnGyemyeons() {
      const rect = this.babyRect();
      const ratios = [...this.anchorRatios].sort(() => Math.random() - 0.5).slice(0, CONFIG.GYEMYEON_COUNT);
      ratios.forEach((rt) => {
        const ax = rect.x + rect.w * rt.x + rand(-12, 12);
        const ay = rect.y + rect.h * rt.y + rand(-12, 12);
        const g = new Gyemyeon(this.fields.gyLayer, this.field, ax, ay);
        g.onPop = (x, y) => this.onGyemyeonPopped(x, y);
        this.gyemyeons.push(g);
      });
    },

    /** 현재 위치 근처의 새 앵커(아기 몸 범위 내) — 계면이가 위치 바꿀 때 사용 */
    randomAnchorNear(x, y) {
      const rect = this.babyRect();
      const nx = clamp(x + rand(-40, 40), rect.x + 20, rect.x + rect.w - 20);
      const ny = clamp(y + rand(-40, 40), rect.y + 20, rect.y + rect.h - 20);
      return { x: nx, y: ny };
    },

    /** 계면이 제거 콜백 */
    onGyemyeonPopped(x, y) {
      this.particles.spawnDroplets(x, y, 10);
      this.particles.spawnSparkle(x, y, 3);
      this.remaining = Math.max(0, this.remaining - 1);
      this.updateHud();
      if (this.remaining <= 0 && this.mission === 1) {
        this.completeMission(1);
      }
    },

    /* ---------------- 미션 진행 ---------------- */

    /** 미션 진입(도구/안내/독 상태 세팅) */
    enterMission(n) {
      this.mission = n;
      const toast = this.fields.missionToast;

      if (n === 1) {
        this.fields.hudMission.textContent = "MISSION 1";
        this.fields.dockHint.textContent = "제품을 드래그해 거품을 만들어요!";
        this.fields.productDock.classList.remove("is-hidden");
        this.setTool("bottle");
        this.showToast("MISSION 1", "계면이를 깨끗하게 씻겨요 🫧");
      } else if (n === 2) {
        this.fields.hudMission.textContent = "MISSION 2";
        this.fields.dockHint.textContent = "샤워기로 거품을 헹궈요!";
        this.fields.productDock.classList.add("is-hidden");
        this.setTool("shower");
        // 충분한 거품(폼) 보장: 아기 몸에 거품을 덮어줌
        this.fillFoamOverBaby();
        this.m2InitialBubbles = Math.max(1, this.particles.bubbles.length);
        this.showToast("MISSION 2", "샤워기로 거품을 헹궈주세요 🚿");
      } else if (n === 3) {
        this.fields.hudMission.textContent = "MISSION 3";
        this.fields.dockHint.textContent = "수건으로 톡톡 닦아요!";
        this.fields.productDock.classList.add("is-hidden");
        this.setTool("towel");
        this.particles.bubbles.length = 0; // 남은 거품 정리
        this.showToast("MISSION 3", "수건으로 톡톡 닦아주세요 🧺");
      }
      this.updateHud();
    },

    /** 미션 클리어 처리(연출 후 다음 미션 or 성공) */
    completeMission(n) {
      if (this.mission !== n) return;
      this.paused = true; // 연출 동안 타이머 정지

      if (n < 3) {
        AudioManager.play("clear");
        this.showToast("MISSION CLEAR!", n === 1 ? "이제 거품을 헹궈볼까요?" : "마지막! 뽀송하게 말려요");
        setTimeout(() => {
          this.paused = false;
          this.enterMission(n + 1);
        }, 1700);
      } else {
        // 미션3까지 완료 → 성공
        AudioManager.play("clear");
        this.showToast("MISSION COMPLETE!", "뽀송뽀송 완료 ✨");
        this.fields.babyContainer.classList.add("is-shiny");
        setTimeout(() => this.win(), 1500);
      }
    },

    /** 미션2용: 아기 몸 위에 거품 폼을 풍성하게 깔기 */
    fillFoamOverBaby() {
      const rect = this.babyRect();
      const target = 150; // 헹굴 거품 목표 수
      const need = Math.max(0, target - this.particles.bubbles.length);
      for (let i = 0; i < need; i++) {
        const x = rect.x + rand(0.12, 0.88) * rect.w;
        const y = rect.y + rand(0.12, 0.92) * rect.h;
        this.particles.bubbles.push({
          x, y, r: rand(CONFIG.BUBBLE_MIN_R, CONFIG.BUBBLE_MAX_R),
          vx: rand(-4, 4), vy: rand(-6, 2), wob: rand(0, 6.28),
          life: 999, popping: 0, // 헹굴 때까지 유지
        });
      }
    },

    /* ---------------- 도구(커서) ---------------- */
    setTool(name) {
      const el = this.fields.toolCursor;
      el.className = "tool-cursor tool-cursor--" + name;
      this.currentTool = name;
    },

    moveToolCursor(x, y, active) {
      const el = this.fields.toolCursor;
      el.classList.toggle("is-active", !!active);
      el.style.transform = `translate(${x}px, ${y}px)`;
    },

    /* ---------------- 입력 핸들러 ---------------- */
    onDown(x, y) {
      if (this.state !== "playing" || this.paused) return;
      this.moveToolCursor(x, y, true);
      this.applyToolAt(x, y, x, y);
    },

    onMove(x, y, px, py) {
      if (this.state !== "playing" || this.paused) return;
      this.moveToolCursor(x, y, true);
      this.applyToolAt(x, y, px, py);
    },

    onUp() {
      this.moveToolCursor(Input.x, Input.y, false);
    },

    /** 현재 도구를 좌표에 적용 (미션별 동작 분기) */
    applyToolAt(x, y, px, py) {
      if (this.mission === 1) {
        // 제품: 드래그 경로에 거품 생성
        for (let i = 0; i < CONFIG.BUBBLE_TRAIL_PER_MOVE; i++) {
          const t = i / CONFIG.BUBBLE_TRAIL_PER_MOVE;
          this.particles.spawnBubble(px + (x - px) * t, py + (y - py) * t);
        }
        if (Math.random() < 0.2) AudioManager.play("bubble", 0.5);
      } else if (this.mission === 2) {
        // 샤워기: 물줄기 + 주변 거품 헹굼
        this.particles.spawnWaterStream(x, y);
        const removed = this.particles.rinseAt(x, y, CONFIG.M2_RINSE_RADIUS);
        if (removed > 0 && Math.random() < 0.3) AudioManager.play("water", 0.5);
      } else if (this.mission === 3) {
        // 수건: 아기 몸 위를 닦으면 진행도 증가 + 반짝이
        const rect = this.babyRect();
        const inside = x > rect.x && x < rect.x + rect.w && y > rect.y && y < rect.y + rect.h;
        if (inside) {
          this.particles.spawnSparkle(x, y, 2);
          // 진행도는 update에서 dt 기반으로 누적(여기서는 플래그만)
          this._towelOnBaby = true;
        }
      }
    },

    /* ---------------- 메인 루프 ---------------- */
    loop(ts) {
      if (!this.running) return;
      let dt = (ts - this.lastTs) / 1000;
      this.lastTs = ts;
      dt = Math.min(dt, 0.05); // 프레임 튐 방지

      if (this.state === "playing") this.update(dt);
      this.particles.render();

      requestAnimationFrame((t) => this.loop(t));
    },

    /** 게임 로직 업데이트 */
    update(dt) {
      // 계면이 모션 + 충돌(미션1)
      for (const g of this.gyemyeons) {
        g.update(dt);
        if (this.mission === 1 && g.alive) {
          this.checkBubbleCollision(g, dt);
        }
      }

      this.particles.update(dt);

      // 미션2 진행도 체크
      if (this.mission === 2) {
        const ratio = this.particles.bubbles.length / this.m2InitialBubbles;
        if (ratio <= CONFIG.M2_CLEAR_RATIO) {
          this.particles.bubbles.length = 0;
          this.completeMission(2);
        }
      }

      // 미션3 진행도 누적
      if (this.mission === 3 && this._towelOnBaby) {
        this.dryProgress += CONFIG.M3_DRY_RATE * dt;
        // 진행에 따라 점점 빛나게
        const p = clamp(this.dryProgress / CONFIG.M3_DRY_NEEDED, 0, 1);
        if (p > 0.5) this.fields.babyContainer.classList.add("is-shiny");
        if (this.dryProgress >= CONFIG.M3_DRY_NEEDED) {
          this._towelOnBaby = false;
          this.completeMission(3);
        }
        this._towelOnBaby = false; // 매 프레임 리셋(드래그 중에만 true)
      }

      // 타이머
      if (!this.paused) {
        this.timeLeft -= dt;
        if (this.timeLeft <= 0) {
          this.timeLeft = 0;
          this.lose();
        }
      }

      this.updateHud();
    },

    /** 거품-계면이 충돌 검사 (미션1) */
    checkBubbleCollision(g, dt) {
      const bubbles = this.particles.bubbles;
      let touching = false;
      for (const b of bubbles) {
        if (b.popping > 0) continue;
        const rr = (b.r + 26); // 계면이 반경(약 26px) + 거품 반경
        if (dist2(b.x, b.y, g.cx, g.cy) < rr * rr) { touching = true; break; }
      }
      // 도구(제품)로 직접 문지르는 경우에도 닿은 것으로 간주(반응성↑)
      if (!touching && Input.isDown) {
        if (dist2(Input.x, Input.y, g.cx, g.cy) < 44 * 44) touching = true;
      }
      if (touching) g.hit(CONFIG.WASH_RATE * dt);
    },

    /* ---------------- HUD / 토스트 ---------------- */
    updateHud() {
      this.fields.hudRemaining.textContent = this.remaining;
      this.fields.hudTimer.textContent = Math.ceil(this.timeLeft);

      // 진행 게이지: 미션별 진행률
      let progress = 0;
      if (this.mission === 1) {
        progress = (CONFIG.GYEMYEON_COUNT - this.remaining) / CONFIG.GYEMYEON_COUNT;
      } else if (this.mission === 2) {
        const ratio = this.particles.bubbles.length / Math.max(1, this.m2InitialBubbles);
        progress = clamp(1 - ratio, 0, 1);
      } else if (this.mission === 3) {
        progress = clamp(this.dryProgress / CONFIG.M3_DRY_NEEDED, 0, 1);
      }
      this.fields.gaugeFill.style.width = (progress * 100).toFixed(1) + "%";

      // 시간 임박 경고
      this.fields.hud.classList.toggle("is-hurry", this.timeLeft <= CONFIG.TIMER_HURRY_AT);
    },

    showToast(big, sub) {
      const el = this.fields.missionToast;
      el.innerHTML = `<div class="mission-toast__big">${big}</div><div class="mission-toast__sub">${sub}</div>`;
      el.classList.remove("is-show");
      void el.offsetWidth; // 리플로우로 애니메이션 재시작
      el.classList.add("is-show");
    },

    /* ---------------- 종료 ---------------- */
    win() {
      this.state = "success";
      AudioManager.play("success");
      // === 확장 지점: 점수/최고기록 저장, QR 보상 발급 등 ===
      // 예) Storage.saveRecord({ clearedAt: Date.now(), timeLeft: this.timeLeft });
      this.fields.screenSuccess.classList.add("is-active");
    },

    lose() {
      if (this.state !== "playing") return;
      this.state = "fail";
      this.fields.screenFail.classList.add("is-active");
    },
  };

  // 전역 노출(디버깅/확장 및 MediaPipe 연동에서 Input 접근용)
  window.EsloGame = Game;
  window.EsloInput = Input;

  /* ===================================================================
   * 8) bootstrap : DOM 준비되면 초기화
   * =================================================================== */
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => Game.init());
  } else {
    Game.init();
  }
})();
