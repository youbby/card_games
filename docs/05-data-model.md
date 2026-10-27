# 05. 데이터 모델

모든 데이터는 기기 내 IndexedDB(Dexie)에 저장. 앱 삭제·앱 데이터 삭제 시 함께 삭제됨.

## 1. 테이블(스토어)

### characters — 플레이어 캐릭터와 CPU 공통
| 필드 | 타입 | 설명 |
|---|---|---|
| id | string (UUID) | PK |
| kind | `'PLAYER' \| 'CPU'` | index |
| cpuClass | `'LOW' \| 'HIGH'`? | CPU만, index |
| personality | `{ tightness, aggression, bluff }`? | CPU만 |
| name | string | 활성 캐릭터 전체(플레이어+CPU)에서 중복 불가 |
| avatar | string | 아바타 키 |
| balance | number | 지갑 잔액 (테이블 위 스택 제외) |
| status | `'ACTIVE' \| 'BANKRUPT'` | CPU는 파산 즉시 삭제되므로 사실상 ACTIVE만 |
| createdAt | number | epoch ms |
| bankruptAt | number? | 플레이어만 |
| lastPlayedAt | number | 캐릭터 선택 화면 정렬 |
| peakBalance | number | 총 자산 최고치 |

### tableSessions — 게임 시작 ~ 일어나기
| 필드 | 타입 | 설명 |
|---|---|---|
| id | string | PK |
| playerId | string | index |
| gameId | `'holdem'` | |
| cpuClass | `'LOW' \| 'HIGH'` | |
| seatCount | number | 선택한 인원 (2~6) |
| stakes | `{ sb, bb }` | |
| seats | `{ characterId, name, kind, buyInTotal, stack }[]` | 좌석별 현재 상태 (CPU 포함) |
| startedAt / endedAt | number | endedAt 없으면 진행 중 |
| handsPlayed | number | |
| inProgressHand | object? | 진행 중 핸드 스냅샷 (복구용) |

CPU의 바이인/스택도 세션에 기록 → 세션 종료(또는 복구) 시 CPU 지갑으로 정산.

### hands — 플레이어 핸드 히스토리 (캐릭터당 최근 500개 유지)
| 필드 | 타입 | 설명 |
|---|---|---|
| id | string | PK |
| playerId, sessionId | string | index |
| playedAt | number | |
| seed | number | RNG 시드 (리플레이용) |
| position | string | BTN / SB / BB / UTG … |
| holeCards | string[] | 예 `["As","Kd"]` |
| board | string[] | |
| opponents | `{ name, cpuClass }[]` | **이름 스냅샷** (CPU 삭제 후에도 표시) |
| actions | compact log | 스트리트별 액션 요약 |
| potTotal | number | |
| net | number | 이 핸드 손익 |
| wentToShowdown, won | boolean | |
| bestHandRank | number? | 쇼다운 시 내 족보 |
| vpip, pfr | boolean | 통계 계산용 |
| abandoned | boolean | 비정상 종료로 폴드 처리된 핸드 |

### stats — 캐릭터별 누적 통계 (핸드 저장 시 함께 갱신)
| 필드 | 설명 |
|---|---|
| characterId | PK (CPU 삭제 시 함께 삭제) |
| handsPlayed, handsWon | |
| netProfit | |
| biggestPotWon, biggestLoss | 플레이어만 |
| bestHand | `{ rank, cards, at }` 플레이어만 |
| showdowns, showdownsWon | |
| vpipCount, pfrCount | |
| byClass | `{ LOW: {hands, net}, HIGH: {hands, net} }` 플레이어만 |
| byStakes | `{ [bb]: {hands, net} }` 플레이어만 |
| bySeatCount | `{ [n]: {hands, net} }` 플레이어만 |
| sessions, playTimeMs | |

CPU 통계는 핸드 수·승리 수·손익·쇼다운 정도만 유지.

### settings — 기기 전역 (단일 레코드)
| 필드 | 기본값 |
|---|---|
| startingChips | 10,000 (플레이어 캐릭터 생성 시에만 읽음) |
| sound, haptics | true |
| animationSpeed | `'NORMAL'` |
| cpuThinkTime | `'NORMAL'` |
| lastCharacterId | — |
| schemaVersion | — |

## 2. 칩 흐름

```
지갑(balance) ──바이인──▶ 테이블 스택(session.seats[i].stack) ──캐시아웃──▶ 지갑
                              │
                         핸드 결과(±)
```
플레이어와 CPU 모두 같은 규칙.

- 게임 시작: 플레이어와 선발된 CPU 전원의 `balance -= 바이인`, 세션 생성 — **한 트랜잭션**
- 핸드 종료: 좌석별 `stack` 갱신 + `hands` 추가 + `stats` 갱신 — **한 트랜잭션**
- CPU 리바이/퇴장/교체: 해당 CPU 지갑과 세션 좌석 갱신 — **한 트랜잭션**
- 일어나기: 전원 `balance += stack`, `endedAt` — **한 트랜잭션** → 파산 판정 → CPU 풀 보충
- 총 자산 = `balance + (진행 중 세션 stack)`
- **불변식**: 세션 동안 (참가자 지갑 + 스택) 합계는 일정 → 개발 빌드에서 검사

## 3. 비정상 종료 처리 (치트 방지 겸)

앱을 강제 종료해서 지는 핸드를 무르는 것을 막는다.

1. 핸드 시작 시 `inProgressHand = { 좌석별 시작 스택, 시드 }` 저장
2. 플레이어가 칩을 낼 때마다(블라인드·콜·베팅) `inProgressHand.committed` 갱신
3. 핸드 정상 종료 → `inProgressHand` 삭제
4. 앱 재시작 시 `inProgressHand` 존재 →
   - 플레이어: **폴드로 간주**, `stack = 시작 스택 - committed`, 핸드 기록 `abandoned = true`
   - CPU: 그 핸드를 무효로 보고 시작 스택으로 되돌린 뒤, 플레이어가 잃은 `committed`는 그 핸드에 칩을 넣은 CPU들에게 기여 비율대로 분배 (칩 총량 보존)
5. 세션 자동 종료(전원 캐시아웃) → 파산 판정 → CPU 풀 보충 → 캐릭터 선택 화면으로

## 4. 파산 판정

```ts
// 플레이어: 전체 단계 중 최저 / CPU: 자기 클래스 허용 단계 중 최저
function bankruptThreshold(c: Character) {
  const levels = c.kind === 'CPU' ? stakesFor(c.cpuClass) : allStakes;
  return Math.min(...levels.map(s => s.minBuyIn));   // 플레이어·Low 400, High 2,000
}

function isBankrupt(c: Character, inSession: boolean) {
  if (inSession) return false;     // 앉아 있으면 판정 보류
  return c.balance < bankruptThreshold(c);
}
```

| 대상 | 파산 시 처리 |
|---|---|
| 플레이어 | `status = 'BANKRUPT'`, `bankruptAt` 기록. 이후 게임 시작 API 전부 거부. 되돌릴 수 없음 |
| CPU (게임 중) | 스택 0 && 지갑 0 → 즉시 **삭제** → 같은 클래스에 새 CPU 생성, 빈자리 보충 |
| CPU (게임 종료 후) | 정산 후 `balance < bankruptThreshold` → **삭제** → 같은 클래스에 새 CPU 생성 |

## 5. CPU 풀 유지

```ts
const POOL_SIZE = 10;
const CPU_STARTING_CHIPS = { LOW: 10_000, HIGH: 50_000 };   // settings.startingChips와 무관

async function ensurePool() {
  for (const cls of ['LOW', 'HIGH']) {
    const active = await repo.countActiveCpu(cls);
    for (let i = active; i < POOL_SIZE; i++) {
      await repo.createCpu({
        cpuClass: cls,
        name: pickUniqueName(),
        personality: randomPersonality(cls),
        balance: CPU_STARTING_CHIPS[cls],
      });
    }
  }
}
```

호출 시점: 최초 실행, 앱 시작(무결성 검사), CPU 파산 처리 직후, 세션 종료, 전체 초기화.

## 6. 전체 초기화

앱을 설치 직후 상태로 되돌린다.

```
1. 진행 중 세션이 있으면 정산 없이 폐기
2. 모든 스토어 비우기 (characters, tableSessions, hands, stats, settings)
3. settings 기본값 생성
4. ensurePool()  → Low 10 / High 10
5. 첫 실행 상태 → 캐릭터 생성 화면
```
DB 전체를 삭제하고 새로 여는 방식(`db.delete()` → `db.open()`)이 가장 확실하다.

## 7. 저장 포맷과 버전
- 카드는 짧은 문자열(`"As"`, `"Td"`)로 저장
- Dexie `version(n).upgrade()`로 마이그레이션 (앱 업데이트 시 기존 기록 보존)
