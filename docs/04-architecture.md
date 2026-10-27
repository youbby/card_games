# 04. 아키텍처

## 1. 기술 스택과 장단점

| 영역 | 선택 | 역할 |
|---|---|---|
| 앱 패키징 | **Capacitor** | 웹 앱을 안드로이드 APK로 감싸고 네이티브 기능(뒤로가기, 진동 등) 연결 |
| 빌드 | **Vite** | 개발 서버 + 정적 번들 (오프라인 동작) |
| 언어 | **TypeScript** | 엔진 상태/액션 타입 안정성 |
| UI | **React** + **Tailwind CSS** | 화면 구성, 스타일 |
| 상태 관리 | **Zustand** | 엔진 이벤트 구독, 화면 간 상태 공유 |
| 저장소 | **IndexedDB (Dexie)** | 캐릭터·전적 저장. Repository 인터페이스 뒤에 숨겨 교체 가능 |
| 테스트 | **Vitest** | 엔진/족보/사이드팟/AI 단위 테스트 |

### 장점
- **개발 속도**: PC 브라우저에서 바로 실행·디버깅 (핫 리로드). 기기 빌드는 확인할 때만
- **엔진 테스트가 쉬움**: 게임 로직이 순수 TS라 Node에서 수만 핸드 시뮬레이션 가능
- **한 언어로 전부**: UI, 엔진, AI, 저장, 빌드 스크립트 모두 TypeScript
- **확장성**: 같은 코드로 iOS·웹 버전도 가능 (지금은 안드로이드만)
- **카드 게임에 충분한 성능**: 화면 요소가 적고 3D가 없어서 WebView로 충분. 무거운 AI 계산은 Web Worker로 분리
- **자료와 라이브러리가 많음**: React/Tailwind는 예제와 문제 해결 자료가 풍부
- **APK가 작음**: 대략 5~10MB

### 단점
- **네이티브보다 덜 매끄러움**: 저사양 기기에서 많은 애니메이션이 동시에 돌면 끊길 수 있음 → CSS transform 위주의 애니메이션으로 대응
- **기기마다 WebView 버전이 다름**: 오래된 기기에서 최신 CSS/JS가 안 될 수 있음 → 빌드 타깃을 보수적으로 잡고 최소 안드로이드 버전 명시
- **네이티브 느낌이 약함**: 스크롤, 터치 반응이 순수 안드로이드 앱과 미묘하게 다름
- **두 세계를 다 알아야 할 때가 있음**: 서명·권한·빌드 오류는 Android Studio/Gradle 쪽 지식 필요
- **React 런타임 오버헤드**: 순수 JS보다 번들이 조금 크고, 매 프레임 렌더링이 필요한 연출에는 부적합 (카드 게임은 해당 없음)
- **IndexedDB 주의점**: 앱 삭제나 "앱 데이터 삭제" 시 기록이 모두 사라짐. 저장소를 PC에서 직접 들여다보기가 SQLite보다 불편

### 다른 선택지와 비교

| 선택지 | 장점 | 단점 |
|---|---|---|
| **Capacitor + React (선택)** | 빠른 개발, 브라우저 디버깅, TS 하나로 통일 | WebView 성능 한계, 네이티브 느낌 약함 |
| Flutter | 매끄러운 애니메이션, 기기 간 화면 일관성 | Dart 새로 배워야 함, 엔진 시뮬레이션 도구 따로 구성 |
| Kotlin + Jetpack Compose | 최고의 네이티브 성능·느낌 | 안드로이드 전용, 수정할 때마다 빌드가 느림 |
| Unity | 화려한 연출, 파티클 | 카드 게임엔 과함, APK 50MB+, 메뉴/통계 UI 만들기 번거로움 |
| Godot | 가벼운 게임 엔진 | 목록·통계 같은 앱형 UI가 불편, 생태계 작음 |

**결론**: 이 게임은 화려한 연출보다 **정확한 규칙, AI, 데이터(칩·전적)** 가 핵심이라 개발·테스트 속도가 빠른 Capacitor + React + TS가 가장 유리하다.

### 네이티브 플러그인
@capacitor/app (뒤로가기·생명주기), @capacitor/haptics, @capacitor/screen-orientation, @capacitor/status-bar, @capacitor/splash-screen

아이콘·폰트·CSS는 모두 **번들에 포함** (CDN 사용 안 함 → 오프라인 동작, 버전 고정).

## 2. 레이어 구조

```
┌─────────────────────────────────────────────┐
│ UI (React screens/components)               │  화면, 애니메이션, 입력
├─────────────────────────────────────────────┤
│ App services                                │  게임 세션 컨트롤러, CPU 풀 관리,
│                                             │  파산 판정, 엔진 ↔ UI ↔ 저장소 연결
├──────────────────────┬──────────────────────┤
│ Game engine (순수 TS) │ Data (repositories)  │
│  - core: card, deck, │  - characters (플레이│
│    rng, evaluator    │    어 + CPU)         │
│  - holdem: rules,    │  - sessions, hands   │
│    state machine     │  - stats, settings   │
│  - ai: bots          │                      │
└──────────────────────┴──────────────────────┘
```

**핵심 원칙: 엔진은 DOM·React·저장소를 전혀 모른다.**
- 엔진 = `(state, action) → (newState, events[])` 순수 함수
- 시드 RNG 주입 → 같은 시드면 같은 결과 → 테스트·버그 재현·핸드 리플레이 가능
- UI는 `events`(DealHole, PostBlind, PlayerAction, DealBoard, Showdown, PotAwarded…)를 받아 애니메이션과 로그를 그림
- 같은 엔진을 헤드리스 시뮬레이터(AI 검증)에서도 사용

## 3. 폴더 구조

```
card_games/
├─ docs/
├─ texas_hold_em_poker.html     # 기존 프로토타입 (참고용, 빌드에 포함 안 함)
├─ src/
│   ├─ main.tsx
│   ├─ app/
│   │   ├─ router.tsx           # 화면 전환
│   │   ├─ screens/             # Launch, CharacterSelect, CharacterCreate, AllBankrupt,
│   │   │                       # Lobby, GameSetup, Table, Stats, CpuList, Settings
│   │   └─ store/               # zustand 스토어
│   ├─ services/
│   │   ├─ sessionController.ts # 바이인 → 핸드 진행 → 기록 → 캐시아웃
│   │   ├─ cpuPool.ts           # CPU 생성·선발·파산 삭제·보충 (클래스별 10명 유지)
│   │   ├─ bankruptcy.ts        # 파산 판정
│   │   └─ factoryReset.ts      # 전체 초기화
│   ├─ core/                    # 게임 공통
│   │   ├─ cards.ts             # Card, Suit, Rank, 문자열 변환 ("As", "Td")
│   │   ├─ deck.ts
│   │   ├─ rng.ts               # 시드 RNG
│   │   └─ evaluator.ts         # 7장 족보 평가
│   ├─ games/
│   │   ├─ registry.ts          # 게임 목록 (홀덤, 이후 추가)
│   │   └─ holdem/
│   │       ├─ types.ts         # HoldemState, Action, Event
│   │       ├─ engine.ts        # 상태 머신
│   │       ├─ pots.ts          # 사이드팟
│   │       ├─ stakes.ts        # 블라인드 단계 + 클래스별 허용 범위
│   │       ├─ ai/              # lowBot, highBot, equity.worker, preflopRanges
│   │       └─ ui/              # Table, Seat, CardView, ActionBar, PotView, HandLog
│   ├─ data/
│   │   ├─ db.ts                # Dexie 스키마 & 마이그레이션
│   │   ├─ names.ts             # CPU 이름 목록
│   │   └─ repositories/        # CharacterRepo, SessionRepo, HandRepo, StatsRepo, SettingsRepo
│   └─ ui/                      # 공통 컴포넌트 (Button, Modal, Toast…)
├─ tools/
│   └─ simulate.ts              # 헤드리스 봇 대전 시뮬레이터
├─ android/                     # Capacitor가 생성
├─ capacitor.config.ts
├─ vite.config.ts
└─ package.json
```

## 4. 확장: 다른 카드 게임 추가

```ts
interface GameModule {
  id: 'holdem' | string;
  name: string;
  minPlayers: number; maxPlayers: number;
  stakes: StakeLevel[];
  createTable(config: TableConfig, rng: Rng): TableController;
  createBot(cls: 'LOW' | 'HIGH', personality: Personality): Bot;
  TableScreen: React.FC<TableProps>;
  statsSchema: StatDefinition[];   // 게임별 통계 항목
}
```

`core/`(카드·덱·RNG·족보), `services/`(CPU 풀·파산·세션), `data/`(캐릭터·전적)는 공유하고, 게임별로 `games/<id>/`만 추가. 칩과 CPU 풀은 게임 간 공통.

## 5. 배포: GitHub Releases APK

| 단계 | 내용 |
|---|---|
| 개발 시작부터 | **로컬 git**으로 버전 관리 (원격 저장소 없음) |
| 개발 중 | 디버그 APK를 기기에 직접 설치 (USB 또는 파일 전송) |
| GitHub 연동 (어느 정도 완성 후) | 저장소 생성, 소스 푸시 |
| 릴리스 | 서명된 릴리스 APK를 GitHub Releases에 업로드 → 기기에서 내려받아 설치 |
| 이후 자동화 (선택) | 태그 푸시 시 GitHub Actions가 APK 빌드·서명·릴리스 업로드 |

주의할 점:
- **릴리스 서명 키(keystore)는 한 번 만들어 계속 사용**. 키가 바뀌면 기존 앱 위에 업데이트 설치가 안 되고, 삭제 후 재설치하면 **기기의 캐릭터·전적이 모두 사라짐**
- keystore와 비밀번호는 저장소에 올리지 않음 (Actions 사용 시 GitHub Secrets)
- applicationId(예: `com.<이름>.cardgames`)는 처음 정한 뒤 바꾸지 않음
- 매 릴리스마다 `versionCode` 증가
- 설치하는 기기에서 "출처를 알 수 없는 앱 설치" 허용 필요

## 6. 안드로이드 고려사항
- 세로 고정, 노치/제스처바 safe-area 대응
- `App.addListener('backButton')`로 화면별 뒤로가기 처리
- `pause` 이벤트 시 즉시 저장 (진행 중 핸드 상태 포함)
- 빌드 환경: Android Studio + JDK 21, `npx cap sync android`
