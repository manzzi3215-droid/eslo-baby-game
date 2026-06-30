# 🫧 계면이 퇴치 미션 (Eslo Baby — Gyemyeoni Mission)

> 베이비페어 행사장용 **브랜드 체험 웹게임**
> 아기 피부에 달라붙은 장난꾸러기 악당 **계면이**를 *이슬로 베이비* 제품으로 모두 씻어내는 콘텐츠입니다.
> 플레이만으로 **"피부에 남은 나쁜 계면이(계면활성제)를 깨끗하게 씻어낸다"** 는 브랜드 컨셉을 자연스럽게 전달합니다.
> *※ 의학적·기능성 효능을 주장하지 않는 컨셉 표현용 게임입니다.*

- **개발 스택**: HTML + CSS + Vanilla JavaScript (외부 프레임워크 없음)
- **플레이 시간**: 약 30~60초 (3단계 미션)
- **대상**: 3~7세 아이 + 동반 부모 (직원 설명 없이 직관적으로 플레이)
- **권장 환경**: 태블릿 **가로 모드** / 마우스·터치·드래그 + **웹캠 손 인식(선택)**

---

## 1. 프로젝트 구조

```
eslo-baby-game/
├── index.html        # 화면 구조(시작/게임/성공/실패) + 아기 SVG + HUD + 보호막 + 엔딩 캔버스
├── style.css         # 파스텔 톤 테마, 계면이/거품/보호막/엔딩 애니메이션, 손인식 UI
├── script.js         # 게임 로직 (입력/미션/Object Pool 파티클/계면이 AI/사운드)
├── hand-tracking.js  # 손 인식 모듈 (MediaPipe → Input.feedExternalPointer 연결)
├── README.md         # 이 문서
├── assets/
│   ├── enemy/                        # 계면이 스프라이트(상태별)
│   │   ├── enemy-gyemyeon-idle.png   # 기본
│   │   ├── enemy-gyemyeon-cling.png  # 기어다님
│   │   ├── enemy-gyemyeon-run.png    # 도망
│   │   ├── enemy-gyemyeon-boss.png   # 보스(끝까지 버팀)
│   │   ├── sad-gyemyeon-idle.png     # 씻겨 내려갈 때
│   │   └── best-gyemyeon-idle.png    # 보호막에 튕겨난 뒤(행복)
│   └── products/                     # 제품 이미지
│       ├── eslo-baby-bath-shampoo.png   # MISSION 1 (+ MISSION 3 로션 임시)
│       └── eslo-baby-hip-cleanser.png   # MISSION 2
└── sound/            # 효과음 (선택) — 파일이 없어도 게임은 동작
    ├── bubble.mp3 / pop.mp3 / water.mp3 / clear.mp3 / success.mp3
```

### 게임 흐름 (스토리형 3미션)

| 단계 | 제품 | 스토리 | 플레이 | 클리어 |
|------|------|--------|--------|--------|
| **MISSION 1** | 바스앤샴푸 | "계면이들이 잔뜩 달라붙었어요!" | 제품 드래그 → 거품으로 씻기 | 계면이 0마리 |
| **MISSION 2** | 엉덩이 클렌저 | "헤헤… 우린 엉덩이에 숨어있지!" | 엉덩이 구역 계면이 씻기(보스 등장) | 계면이 0마리 |
| **MISSION 3** | 로션 | "촉촉한 보호막을 만들어주세요!" | 문질러 보호막 생성 → 계면이 튕겨남 | 보호막 100% |

- **계면이 행동**: 피부 위를 천천히 **기어다니고**, 거품/제품이 가까워지면 **도망**갑니다. 거품에 닿으면 슬픈 표정(`sad`)으로 **물과 함께 아래로 씻겨 내려가고**, 로션 보호막이 완성되면 행복한 표정(`best`)으로 **바깥으로 튕겨납니다**.
- **엔딩**: *GOOD JOB!* 화면 + **컨페티·폭죽·별·반짝이** 연출 → 직원에게 보여주기 → **다시하기**.
- 제한 시간(기본 60초, 미션 전환 중 정지) 초과 시 **실패 → 다시 도전** 화면.

> ⚙️ **성능**: 거품·물방울·반짝이·컨페티 등 모든 파티클과 계면이 DOM은 **Object Pool로 재사용**합니다. 게임 루프 중 객체를 새로 생성하지 않아 **iPad Safari 장시간 운영에도 메모리 누수/프레임 드랍이 없도록** 설계했습니다.

---

## 2. 실행 방법

### 가장 간단한 방법
`index.html` 을 더블클릭해 브라우저로 엽니다. (별도 빌드/설치 불필요)

> ⚠️ 일부 브라우저는 보안 정책상 `file://` 로 열면 이미지/사운드 로딩이 제한될 수 있습니다.
> 아래처럼 **로컬 서버**로 여는 것을 권장합니다.

### 로컬 서버로 실행 (권장)

**Python (설치돼 있다면)**
```bash
cd eslo-baby-game
python -m http.server 5500
# 브라우저에서 http://localhost:5500 접속
```

**Node.js**
```bash
cd eslo-baby-game
npx serve .
# 또는: npx http-server -p 5500
```

**VS Code**
- `Live Server` 확장 설치 → `index.html` 우클릭 → **Open with Live Server**

---

## 3. 이미지 교체 방법

이미지는 `assets/enemy/`(계면이)와 `assets/products/`(제품)에 있습니다. **같은 파일명으로 덮어쓰면** 코드 수정 없이 교체됩니다.

| 교체 대상 | 파일 | 권장 사양 |
|-----------|------|-----------|
| 계면이(기본/기어다님/도망/보스/슬픔/행복) | `assets/enemy/*.png` | **배경 투명 PNG**, 정면 캐릭터 |
| 바스앤샴푸 (MISSION 1) | `assets/products/eslo-baby-bath-shampoo.png` | 세로형, **배경 투명 PNG** 권장 |
| 엉덩이 클렌저 (MISSION 2) | `assets/products/eslo-baby-hip-cleanser.png` | 세로형, **배경 투명 PNG** 권장 |

### ⭐ 로션 이미지 추가 (MISSION 3)
현재 로션 이미지가 없어 **MISSION 3은 바스앤샴푸 이미지를 임시로 사용**합니다.
로션 이미지가 준비되면 `assets/products/` 에 넣고, `script.js` 상단의 **한 줄만** 바꾸면 끝입니다.
```js
// script.js → CONFIG.PRODUCTS
PRODUCTS: {
  bathShampoo: "assets/products/eslo-baby-bath-shampoo.png",
  hipCleanser: "assets/products/eslo-baby-hip-cleanser.png",
  lotion:      "assets/products/eslo-baby-bath-shampoo.png", // ← 여기를 로션 경로로 교체
},
```

- 모든 제품/스프라이트 경로는 `script.js`의 `CONFIG.PRODUCTS` / `CONFIG.SPRITES` **한 곳에서** 관리됩니다(파일명을 바꿔도 여기만 수정).
- **아기 캐릭터**는 이미지가 아니라 `index.html` 안의 **인라인 SVG**입니다. 색/표정은 SVG의 `fill` 값을 수정하면 됩니다.

---

## 4. 향후 기능 추가 방법

코드는 확장을 전제로 설계돼 있습니다. 주요 진입점은 다음과 같습니다.

### 난이도 / 시간 / 미션 조정 (가장 자주 쓰는 부분)
`script.js` 상단 **`CONFIG`** 객체만 수정하면 됩니다.
```js
const CONFIG = {
  GAME_DURATION_SEC: 60,   // 제한 시간(초), 미션 전환 중에는 정지
  ENEMY_HEALTH: 70,        // 계면이 체력 (작을수록 쉬움)
  BOSS_HEALTH: 170,        // 보스 체력
  WASH_RATE: 190,          // 씻기는 속도 (클수록 쉬움)
  FLEE_RADIUS: 96,         // 도망 시작 거리 (작을수록 쉬움)
  SHIELD_RATE: 0.5,        // 로션 보호막 차오르는 속도
  MISSIONS: [ /* 미션별 제품·계면이 수·구역·스토리 (데이터 주도) */ ],
  ...
};
```
- 미션을 추가/변경하려면 `CONFIG.MISSIONS` 배열에 항목을 넣으면 됩니다(코드 수정 없이 미션 확장 가능).

### 점수 / 최고기록 저장
`Game.win()` 안의 주석 표시 지점에 `localStorage` 저장 로직을 추가하면 됩니다.
```js
win() {
  // === 확장 지점 ===
  const best = Number(localStorage.getItem("eslo_best_time") || 0);
  if (this.timeLeft > best) localStorage.setItem("eslo_best_time", this.timeLeft);
}
```

### 스테이지 / 난이도 단계
`CONFIG` 를 배열(예: `LEVELS`)로 분리하고 `Game.start(levelIndex)` 형태로 받도록 확장하세요. 미션 구조(`enterMission`)는 그대로 재사용됩니다.

### QR 보상 시스템
성공 화면(`#screen-success`)에 `<canvas>` 를 추가하고 QR 라이브러리로 쿠폰 코드를 그리면 됩니다. 발급 시점은 `Game.win()`.

### 행사 관리자 모드
키 입력(예: `Shift+A` 5회)으로 숨김 패널을 띄워 `CONFIG` 값을 실시간 변경하거나 플레이 횟수를 표시하도록 추가할 수 있습니다. `window.EsloGame` 으로 게임 객체에 접근 가능합니다.

---

## 5. 손 인식(카메라) 사용법 — ✅ 기본 탑재됨

**MediaPipe Hand Landmarker(Tasks Vision)** 기반 손 인식이 게임에 내장되어 있습니다.
웹캠으로 **검지 끝**을 인식해 게임 커서(제품/거품)를 움직이며, 기존 마우스/터치 드래그 로직과 **완전히 동일하게** 거품 생성·계면이 제거가 동작합니다.

관련 파일: **`hand-tracking.js`** (손 인식 전용 모듈). 게임 본체 `script.js` 는 건드리지 않고, `Input.feedExternalPointer()` 로 좌표만 흘려보내는 구조입니다.

### 플레이 방법
1. 시작 화면에서 **「✋ 손으로 플레이하기」** 버튼 터치
2. 브라우저가 **카메라 권한**을 물어보면 **허용**
3. 우측 하단에 작은 **웹캠 미리보기**가 뜨고, 손을 움직이면 커서가 따라옵니다
4. 손이 안 잡히면 화면에 **「손을 카메라 앞에 보여주세요 ✋」** 안내가 표시됩니다
5. 카메라가 안 되면(권한 거부/장치 없음/네트워크) **안내 문구가 뜨고**, 그대로 **「👆 터치로 플레이하기」** 로 진행하면 됩니다 — 행사 중 오류가 나도 멈추지 않습니다

### ⚠️ 동작 조건 (중요)
- **카메라는 `https` 또는 `localhost` 환경에서만 동작합니다.**
  `file://` 로 직접 열면 브라우저 보안 정책상 웹캠을 사용할 수 없습니다.
  → 로컬에서는 `http://localhost:포트` (아래 2번 항목의 로컬 서버), 외부 배포는 **Netlify(https)** 를 사용하세요.
- **인터넷 연결**이 필요합니다. MediaPipe 모델/런타임을 CDN에서 불러오기 때문입니다.
  (오프라인 행사라면 `hand-tracking.js` 상단의 `VISION_URL / WASM_URL / MODEL_URL` 을 내부 서버 경로로 바꿔 호스팅하세요.)

### 테스트 방법 (노트북/태블릿 웹캠)
```bash
cd eslo-baby-game
python -m http.server 5500     # 또는: npx http-server -p 5500
# 브라우저에서 http://localhost:5500 접속 → "손으로 플레이하기"
```
- 노트북 내장 웹캠, USB 웹캠, 태블릿 전면 카메라 모두 사용 가능합니다.
- 화면은 **거울 모드**로 보여주므로(셀카처럼) 손을 오른쪽으로 움직이면 커서도 오른쪽으로 갑니다.

### 미세 조정 (`hand-tracking.js` 상단 설정값)
| 상수 | 의미 | 기본값 |
|------|------|--------|
| `SMOOTHING` | 커서 떨림 보정(클수록 부드럽지만 지연) | `0.5` |
| `GAIN` | 손 이동 범위 확대(화면 끝까지 닿기 쉽게) | `1.3` |
| `LOST_GRACE_MS` | 손이 잠깐 사라져도 드래그 유지하는 시간(ms) | `350` |
| `FINGERTIP_INDEX` | 추적 랜드마크(8=검지 끝) | `8` |

### 동작 원리 (요약)
```
웹캠 → MediaPipe HandLandmarker → 검지 끝(normalized x,y)
     → 거울 보정(1 - x) + 스무딩 + 게인
     → EsloInput.feedExternalPointer(x, y, active, true)
     → (기존) Game.onDown / onMove / onUp  ← 마우스·터치와 동일 경로
```
- `active` 는 **손이 인식되는 동안 `true`** 로, 마우스를 누르고 드래그하는 것과 동일하게 취급됩니다.
- 마우스/터치와 손 인식은 같은 입력 통로를 쓰므로 **둘을 동시에 켜둬도** 충돌하지 않습니다(자동 fallback).
- 관리자/디버깅용으로 콘솔에서 `EsloHandTracking.disable()` 을 호출하면 카메라를 끄고 터치 모드로 되돌릴 수 있습니다.

> 💡 **주먹/펴짐 제스처로 "거품 ON/OFF"** 를 구현하려면, `_handle()` 에서 손가락 펴짐 여부를 계산해 `feedExternalPointer(..., active)` 의 `active` 값으로 넘기면 됩니다.

---

## 6. 행사장에서 태블릿으로 사용하는 방법

1. **가로 모드 고정**
   - 태블릿 설정에서 **화면 회전 잠금(가로)** 을 켭니다.
   - 세로로 들면 "가로로 돌려주세요" 안내가 자동 노출됩니다.
2. **전체 화면(키오스크) 실행**
   - 크롬: 주소창에서 페이지를 열고 메뉴 → **홈 화면에 추가** 또는 **전체화면**.
   - iPad Safari: 공유 → **홈 화면에 추가** 하면 주소창 없는 풀스크린 앱처럼 실행됩니다.
   - 안드로이드: 크롬 **전체화면** + "화면 켜짐 유지" 설정 권장.
3. **오작동 방지**
   - 화면 스크롤/확대는 코드에서 이미 차단돼 있습니다.
   - 게임은 **새로고침만 하면 처음 상태**로 돌아갑니다. 종료 후 화면에서 **다시하기** 버튼으로 바로 재시작됩니다.
4. **사운드**
   - 첫 **START** 터치 시 오디오가 활성화됩니다(모바일 정책). 행사장이 시끄럽다면 사운드 파일을 빼고 운영해도 됩니다.
5. **운영 팁**
   - 화면 밝기 최대, 절전/화면꺼짐 시간 길게 설정.
   - 거치대로 각도를 세워 아이 손이 닿기 쉽게 배치.
   - 한 회차가 끝나면 **다시하기** 한 번으로 다음 손님 플레이 가능.

---

## 7. Netlify 배포 방법

이 프로젝트는 빌드가 필요 없는 **정적 사이트**라 배포가 매우 간단합니다.

### 방법 A — 드래그 앤 드롭 (가장 쉬움)
1. [https://app.netlify.com/drop](https://app.netlify.com/drop) 접속
2. `eslo-baby-game` **폴더 전체**를 브라우저 창에 끌어다 놓기
3. 잠시 후 `https://랜덤이름.netlify.app` 주소가 발급됨 → 태블릿에서 바로 접속

### 방법 B — Git 연동 (지속 운영/수정 반영)
1. 깃 저장소 생성 후 푸시
   ```bash
   git init
   git add .
   git commit -m "Eslo Baby Bubble Clean"
   git branch -M main
   git remote add origin <당신의 저장소 URL>
   git push -u origin main
   ```
2. Netlify → **Add new site → Import an existing project** → 저장소 선택
3. 빌드 설정
   - **Build command**: 비워둠
   - **Publish directory**: `.` (저장소 루트)
4. **Deploy** → 발급된 주소로 접속

### 방법 C — Netlify CLI
```bash
npm install -g netlify-cli
netlify deploy --prod --dir .
```

> 배포 후 **HTTPS** 가 적용되므로(카메라/오디오 권한에 유리) 추후 MediaPipe 손 인식 확장에도 그대로 사용할 수 있습니다.

---

## 브랜드 메시지

> 게임을 끝낸 부모가 자연스럽게 떠올리도록 설계했습니다.
> **"아~ 피부에 남은 계면활성제(계면이)를 물로 깨끗하게 씻어내는 컨셉이구나."**
>
> *이슬로 베이비와 함께, 순하게 클린.* 🫧

*※ 본 콘텐츠는 체험용이며 의학적·기능성 효능을 주장하지 않습니다. "깨끗하게 씻어요", "순하게 클린" 등 일반적 표현만 사용합니다.*
