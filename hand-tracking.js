/* =====================================================================
 * 이슬로 베이비 버블 클린 - hand-tracking.js
 * MediaPipe Hand Landmarker(Tasks Vision) 기반 손 인식 입력 모듈
 *
 * 설계 원칙
 *  - 게임 로직(script.js)은 손상시키지 않는다. 이 파일은 "입력 소스"만 추가한다.
 *  - 손 검지 끝 좌표를 정규화(0~1)해서 window.EsloInput.feedExternalPointer()로 전달한다.
 *    → 마우스/터치와 완전히 동일한 경로(onDown/onMove/onUp)로 흘러간다.
 *  - 카메라가 안 되면 게임은 그대로 "터치로 플레이하기"로 동작한다(완전한 fallback).
 *
 * 의존성
 *  - @mediapipe/tasks-vision (CDN ESM 동적 import) — 인터넷 연결 필요
 *  - getUserMedia (웹캠) — https 또는 localhost 환경에서만 동작
 * ===================================================================== */

(() => {
  "use strict";

  const HandTracking = {
    /* ----------------------- 설정 (필요시 이 부분만 수정) ----------------------- */
    // MediaPipe Tasks Vision 모듈/런타임/모델 경로 (버전 교체 시 여기만 변경)
    VISION_URL: "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.20/vision_bundle.mjs",
    WASM_URL:   "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.20/wasm",
    MODEL_URL:  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",

    SMOOTHING: 0.5,       // 0~1, 클수록 부드럽지만 반응 지연(0.5 권장)
    GAIN: 1.3,            // 손 이동 범위 확대(중앙 기준). 화면 끝까지 닿기 쉽게.
    LOST_GRACE_MS: 350,  // 손이 잠깐 사라져도 이 시간 동안은 드래그 유지(깜빡임 방지)
    FINGERTIP_INDEX: 8,  // 검지 끝 랜드마크 인덱스

    /* ----------------------- 내부 상태 ----------------------- */
    landmarker: null,
    stream: null,
    running: false,
    rafId: null,
    active: false,        // 현재 손이 인식되어 "드래그 중"인지
    sx: 0.5, sy: 0.5,     // 스무딩된 정규화 좌표(거울 보정 후)
    lastSeen: 0,
    _lastTs: 0,
    _lastVideoTime: -1,
    els: {},

    /* ===================================================================
     * 초기화 & 버튼 바인딩
     * =================================================================== */
    init() {
      const $ = (id) => document.getElementById(id);
      this.els = {
        video: $("cam-video"),
        preview: $("cam-preview"),
        dot: $("cam-dot"),
        hint: $("hand-hint"),
        notice: $("cam-notice"),
        btnHand: $("btn-start-hand"),
        btnTouch: $("btn-start"),
      };

      // "손으로 플레이하기" → 카메라/모델 준비 후 게임 시작
      if (this.els.btnHand) {
        this.els.btnHand.addEventListener("click", () => this.enable());
      }
      // "터치로 플레이하기"는 script.js가 이미 Game.start()에 바인딩되어 있음(그대로 fallback)
    },

    /* ===================================================================
     * enable : 손 인식 모드 켜기 (버튼에서 호출)
     *  1) 보안 컨텍스트 확인 → 2) 웹캠 → 3) 모델 → 4) 루프 시작 → 5) 게임 시작
     *  어느 단계든 실패하면 안내 문구를 띄우고 터치 버튼으로 진행 가능.
     * =================================================================== */
    async enable() {
      // https/localhost가 아니면 카메라 자체가 불가능
      if (!window.isSecureContext) {
        this._notice("카메라는 https 또는 localhost 에서만 동작해요. 아래 ‘터치로 플레이하기’로 진행해 주세요.");
        return;
      }
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        this._notice("이 브라우저는 카메라를 지원하지 않아요. ‘터치로 플레이하기’로 진행해 주세요.");
        return;
      }

      this._lockButtons(true);
      this._notice("카메라를 준비하고 있어요... ✋", true);

      try {
        await this._initCamera();   // 웹캠 권한 + 스트림
        this._notice("손 인식을 불러오는 중이에요... ⏳", true);
        await this._initModel();    // MediaPipe 모델 로드
      } catch (err) {
        console.error("[HandTracking] 초기화 실패:", err);
        this._notice(this._friendlyError(err));
        this._stopStream();
        this._lockButtons(false);
        return;
      }

      // === 성공: 손 인식 모드 가동 ===
      window.EsloInput.mode = "cameraHand";
      this.els.preview.classList.add("is-on");
      this.els.preview.setAttribute("aria-hidden", "false");
      this.running = true;
      this.active = false;
      this.lastSeen = 0;
      this._lastVideoTime = -1;
      this._notice("");
      this._lockButtons(false);

      this._loop();                 // 인식 루프 시작
      window.EsloGame.start();      // 게임 시작(시작 화면 닫힘)
    },

    /* ----------------------- 웹캠 준비 ----------------------- */
    async _initCamera() {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } },
        audio: false,
      });
      const v = this.els.video;
      v.srcObject = this.stream;
      v.muted = true;
      v.playsInline = true;
      await v.play().catch(() => {});
      // 비디오 메타데이터(해상도) 준비 대기 (최대 3초)
      if (v.readyState < 2) {
        await new Promise((res) => {
          const done = () => res();
          v.addEventListener("loadeddata", done, { once: true });
          setTimeout(done, 3000);
        });
      }
    },

    /* ----------------------- MediaPipe 모델 준비 ----------------------- */
    async _initModel() {
      // ESM 동적 import (일반 스크립트에서도 동작)
      const vision = await import(this.VISION_URL);
      const fileset = await vision.FilesetResolver.forVisionTasks(this.WASM_URL);

      const create = (delegate) =>
        vision.HandLandmarker.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: this.MODEL_URL, delegate },
          runningMode: "VIDEO",
          numHands: 1,
          minHandDetectionConfidence: 0.5,
          minHandPresenceConfidence: 0.5,
          minTrackingConfidence: 0.5,
        });

      // GPU 우선, 실패하면 CPU로 폴백
      try {
        this.landmarker = await create("GPU");
      } catch (e) {
        console.warn("[HandTracking] GPU 델리게이트 실패 → CPU 폴백", e);
        this.landmarker = await create("CPU");
      }
    },

    /* ===================================================================
     * 인식 루프 : 매 프레임 손을 감지해 입력으로 전달
     * =================================================================== */
    _loop() {
      if (!this.running) return;
      const v = this.els.video;

      // detectForVideo는 단조 증가 타임스탬프를 요구 → 보정
      const now = Math.max(performance.now(), this._lastTs + 1);
      this._lastTs = now;

      // 새 프레임일 때만 추론(중복 프레임 처리 방지)
      if (v.readyState >= 2 && v.currentTime !== this._lastVideoTime) {
        this._lastVideoTime = v.currentTime;
        let res = null;
        try {
          res = this.landmarker.detectForVideo(v, now);
        } catch (e) {
          /* 일시적 추론 오류는 무시하고 다음 프레임 진행 */
        }
        this._handle(res, now);
      }

      this.rafId = requestAnimationFrame(() => this._loop());
    },

    /** 감지 결과 처리 → 좌표 변환 → 게임 입력 전달 */
    _handle(res, now) {
      const has = res && res.landmarks && res.landmarks.length > 0;

      if (has) {
        const tip = res.landmarks[0][this.FINGERTIP_INDEX];
        const nx = 1 - tip.x; // 화면을 거울로 보여주므로 x 반전
        const ny = tip.y;

        // 새로 잡힌 순간엔 점프 방지를 위해 현재 위치로 초기화
        if (!this.active) { this.sx = nx; this.sy = ny; }
        // 지수 스무딩(떨림 완화)
        this.sx += (nx - this.sx) * (1 - this.SMOOTHING);
        this.sy += (ny - this.sy) * (1 - this.SMOOTHING);

        // 중앙 기준 게인 + 0~1 클램프 (화면 가장자리까지 도달 쉽게)
        const gx = clamp(0.5 + (this.sx - 0.5) * this.GAIN, 0, 1);
        const gy = clamp(0.5 + (this.sy - 0.5) * this.GAIN, 0, 1);

        // 기존 입력 파이프라인으로 전달(마우스/터치와 동일 경로)
        window.EsloInput.feedExternalPointer(gx, gy, true, true);

        this.active = true;
        this.lastSeen = now;
        this._moveDot(this.sx, this.sy);   // 미리보기 점은 화면(거울) 좌표 기준
        this._showHint(false);
      } else {
        // 손이 사라짐 — 잠깐의 끊김은 유예(드래그 유지)
        if (this.active && now - this.lastSeen > this.LOST_GRACE_MS) {
          window.EsloInput.feedExternalPointer(0, 0, false, true); // 드래그 종료(onUp)
          this.active = false;
          this._showHint(true);
        } else if (!this.active) {
          this._showHint(true);
        }
      }
    },

    /* ----------------------- 미리보기/안내 UI ----------------------- */

    /** 미리보기 안의 손끝 표시 점 이동 */
    _moveDot(nx, ny) {
      const d = this.els.dot;
      if (!d) return;
      d.style.left = (nx * 100).toFixed(1) + "%";
      d.style.top = (ny * 100).toFixed(1) + "%";
      this.els.preview.classList.add("is-tracking");
    },

    /** "손을 보여주세요" 배너 표시/숨김 (게임 플레이 중일 때만 노출) */
    _showHint(show) {
      const playing = window.EsloGame && window.EsloGame.state === "playing";
      const on = show && this.running && playing;
      this.els.hint.classList.toggle("is-show", on);
      if (show) this.els.preview.classList.remove("is-tracking");
    },

    /** 시작 화면 안내 문구 (info=true면 파란색 정보, 아니면 빨간 경고) */
    _notice(text, info = false) {
      const n = this.els.notice;
      if (!n) return;
      n.textContent = text;
      n.classList.toggle("is-info", !!info);
    },

    _lockButtons(lock) {
      if (this.els.btnHand) this.els.btnHand.disabled = lock;
      if (this.els.btnTouch) this.els.btnTouch.disabled = lock;
      if (this.els.btnHand) this.els.btnHand.textContent = lock ? "준비 중... ✋" : "✋ 손으로 플레이하기";
    },

    /** 오류 객체 → 사용자 친화 한국어 메시지 */
    _friendlyError(err) {
      const name = (err && err.name) || "";
      if (name === "NotAllowedError" || name === "SecurityError") {
        return "카메라 권한이 거부됐어요. ‘터치로 플레이하기’로 진행해 주세요.";
      }
      if (name === "NotFoundError" || name === "OverconstrainedError" || name === "NotReadableError") {
        return "카메라를 찾을 수 없거나 사용 중이에요. ‘터치로 플레이하기’로 진행해 주세요.";
      }
      // 모델/네트워크 로드 실패 등
      return "손 인식을 불러오지 못했어요(인터넷 확인). ‘터치로 플레이하기’로 진행해 주세요.";
    },

    /* ===================================================================
     * disable : 손 인식 종료 (행사 관리자/디버깅용)
     * =================================================================== */
    disable() {
      this.running = false;
      if (this.rafId) cancelAnimationFrame(this.rafId);
      this._stopStream();
      this.els.preview.classList.remove("is-on", "is-tracking");
      this._showHint(false);
      window.EsloInput.mode = "pointer";
    },

    _stopStream() {
      if (this.stream) {
        this.stream.getTracks().forEach((t) => t.stop());
        this.stream = null;
      }
      if (this.els.video) this.els.video.srcObject = null;
    },
  };

  // 공용 유틸(작은 것만 자체 정의 — script.js의 IIFE 내부 함수는 접근 불가)
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  // 전역 노출(디버깅/관리자 모드에서 EsloHandTracking.disable() 등 사용)
  window.EsloHandTracking = HandTracking;

  // DOM 준비되면 버튼 바인딩
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => HandTracking.init());
  } else {
    HandTracking.init();
  }
})();
