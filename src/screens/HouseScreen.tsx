import { useEffect, useRef, useState } from 'react';
import { startScreen } from '../app/boot';
import { vibrate } from '../app/native';
import { playSound } from '../app/sound';
import { useApp } from '../app/store';
import { errorMessage } from '../core/errors';
import { db } from '../data/db';
import { gameName, profitTarget } from '../games/catalog';
import { stakeById } from '../games/holdem/stakes';
import { baccaratValue, blackjackActions, blackjackValue, insuranceCost } from '../games/house/engine';
import {
  isRoundOpen,
  type BaccaratBet,
  type BaccaratRound,
  type BlackjackAction,
  type BlackjackHand,
  type BlackjackRound,
  type HouseRoom,
} from '../games/house/types';
import { actHouse, betHouse, closeHouseRoom, houseBetLimits, houseLimitReached } from '../services/house';
import { Avatar, Button, Chips, ClassBadge, cx, fmt, PlayingCard } from '../ui/components';
import { FloatingNet, GameHeader, LeaveConfirm, SessionEndModal, useLeave, type SessionSummary } from '../ui/game';
import { HelpModal, TutorialModal, useTutorial } from '../ui/help';
import { useStagedReveal } from '../ui/motion';
import { RoundResult } from '../ui/RoundResult';
import { houseResult } from '../ui/results';

const BACCARAT_CHOICES: { value: BaccaratBet; label: string; odds: string }[] = [
  { value: 'player', label: '플레이어', odds: '1:1' },
  { value: 'banker', label: '뱅커', odds: '0.95:1' },
  { value: 'tie', label: '무승부', odds: '8:1' },
];

const ACTION_LABELS: Record<BlackjackAction, string> = {
  hit: '히트',
  stand: '스탠드',
  double: '더블다운',
  split: '스플릿',
  surrender: '서렌더',
  insurance: '보험',
  noInsurance: '보험 없이',
};

/** Milliseconds between baccarat cards and between the dealer's blackjack cards. */
const BACCARAT_STEP_MS = 600;
const DEALER_STEP_MS = 650;

/** Loads the room, then hands it to the table once it is known to be open. */
export function HouseScreen({ roomId }: { roomId: string }) {
  const { reset, showToast } = useApp();
  const [loaded, setLoaded] = useState<{ room: HouseRoom; playerName: string } | null>(null);

  useEffect(() => {
    let live = true;
    (async () => {
      const room = await db.rooms.get(roomId);
      if (!live) return;
      if (!room?.active) {
        reset([{ name: 'characterSelect' }, { name: 'lobby' }]);
        return;
      }
      const player = await db.characters.get(room.playerId);
      if (live) setLoaded({ room, playerName: player?.name ?? '' });
    })().catch((error: unknown) => showToast(errorMessage(error)));
    return () => {
      live = false;
    };
  }, [roomId, reset, showToast]);

  if (!loaded) {
    return <div className="flex h-full items-center justify-center text-sm text-gray-500">방 준비 중…</div>;
  }
  return <HouseTable initialRoom={loaded.room} playerName={loaded.playerName} />;
}

function HouseTable({ initialRoom, playerName }: { initialRoom: HouseRoom; playerName: string }) {
  const { reset, showToast, settings } = useApp();
  const [room, setRoom] = useState(initialRoom);
  const [bet, setBet] = useState(() => houseBetLimits(initialRoom).min);
  const [choice, setChoice] = useState<BaccaratBet>('player');
  const [busy, setBusy] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [ended, setEnded] = useState<SessionSummary | null>(null);
  const tutorial = useTutorial(room.gameId);
  const working = useRef(false);

  const round = room.round;
  const reveal = useRoundReveal(room);
  const settledRound = round && !reveal.pending ? round : null;
  const summary = houseResult(settledRound, room.dealer.name);
  useRoundFeedback(settledRound ? room.roundsPlayed : null, summary?.net ?? 0, settings);

  const perform = async (job: () => Promise<HouseRoom>) => {
    if (working.current) return;
    working.current = true;
    setBusy(true);
    try {
      const next = await job();
      setRoom(next);
      const limits = houseBetLimits(next);
      setBet((current) => Math.max(limits.min, Math.min(limits.max, current)));
    } catch (error) {
      showToast(errorMessage(error));
    } finally {
      working.current = false;
      setBusy(false);
    }
  };

  const leave = useLeave(
    () => closeHouseRoom(room.id),
    (result) =>
      setEnded({
        name: playerName,
        bankrupt: result.bankrupt,
        roundLabel: '판',
        rounds: room.roundsPlayed,
        buyIn: room.initialBuyIn,
        cashOut: result.cashOut,
        abandonedLoss: result.abandonedLoss,
      }),
  );

  const openRound = isRoundOpen(round) ? round : null;
  const playing = !!openRound;
  const stake = stakeById(room.stakeId);
  const target = profitTarget(room.initialBuyIn, room.initialBuyIn, room.profitMultiplier);
  const shownBalance = room.balance - reveal.hiddenPayout;
  const locked = busy || leave.leaving || reveal.pending;

  return (
    <div className="mx-auto flex h-full min-h-0 max-w-lg flex-col overflow-hidden">
      <GameHeader
        onLeave={leave.ask}
        leaveDisabled={leave.leaving}
        onHelp={() => setShowHelp(true)}
        right={<Chips amount={shownBalance} className="text-sm" />}
      >
        <ClassBadge cls={room.cpuClass} />
        <span className="truncate font-bold">{gameName(room.gameId)}</span>
        <span className="text-gray-400">{stake.name}</span>
      </GameHeader>
      <div className="flex shrink-0 items-center justify-between gap-2 px-3 pb-2 text-[10px] text-gray-500">
        <span>
          입장금 {fmt(room.initialBuyIn)} · {room.roundsPlayed}판
        </span>
        <span>
          {target == null ? '수익 한도 없음' : `순이익 ${room.profitMultiplier}배 · 목표 잔액 ${fmt(target)}`}
        </span>
      </div>

      <main className="min-h-0 flex-1 overflow-y-auto px-3">
        <div className="rounded-[28px] border border-emerald-900/70 bg-gradient-to-b from-emerald-950/60 to-gray-950 p-3">
          <div className="mb-3 flex items-center justify-center gap-2">
            <Avatar emoji={room.dealer.avatar} size="sm" />
            <div className="text-sm font-bold">
              {room.dealer.name} <span className="text-[10px] text-gray-500">상대 딜러</span>
            </div>
          </div>
          {room.gameId === 'baccarat' ? (
            <BaccaratTable round={round?.kind === 'baccarat' ? round : null} shown={reveal.shown} />
          ) : (
            <BlackjackTable
              round={round?.kind === 'blackjack' ? round : null}
              dealerShown={reveal.shown}
              settled={!!settledRound}
            />
          )}
          <div data-testid="house-result-slot" className="relative mt-3 h-[84px] shrink-0">
            {summary ? (
              <div key={room.roundsPlayed} className="result-in h-full">
                <RoundResult summary={summary} compact />
                <FloatingNet net={summary.net} className="-top-2" />
              </div>
            ) : (
              <div className="flex h-full items-center justify-center text-center text-sm text-gray-500">
                {reveal.pending
                  ? '카드를 공개하는 중…'
                  : round?.phase === 'insurance'
                    ? '딜러가 A를 보이고 있어요'
                    : playing
                      ? '내 차례 · 21을 넘지 않게 선택하세요'
                      : '베팅 후 카드를 받으세요'}
              </div>
            )}
          </div>
          <p className="mt-3 text-center text-[10px] text-gray-600">
            6덱 슈 · 남은 카드 {(round?.deck ?? room.deck).length}장
          </p>
        </div>
      </main>

      <footer className="safe-bottom shrink-0 border-t border-white/5 bg-ink px-4 pt-3">
        <div className="flex h-[200px] flex-col justify-end gap-2">
          {openRound ? (
            <BlackjackControls
              round={openRound}
              disabled={locked}
              onAct={(action) => void perform(() => actHouse(room.id, action))}
            />
          ) : (houseLimitReached(room) || room.balance === 0) && !reveal.pending ? (
            <RoomFinished limit={houseLimitReached(room)} disabled={leave.leaving} onLeave={leave.leave} />
          ) : (
            <BetControls
              room={room}
              bet={bet}
              choice={choice}
              disabled={locked}
              onBet={setBet}
              onChoose={setChoice}
              onPlace={() => void perform(() => betHouse(room.id, bet, choice))}
              busy={busy}
            />
          )}
        </div>
      </footer>

      {leave.confirming && (
        <LeaveConfirm
          stake={{
            inProgress: playing,
            wagered: openRound?.totalBet ?? 0,
            remaining: room.balance,
            settledAs: '패배',
          }}
          onConfirm={leave.leave}
          onCancel={leave.cancel}
        />
      )}
      {showHelp && <HelpModal gameId={room.gameId} onClose={() => setShowHelp(false)} />}
      {tutorial.open && <TutorialModal gameId={room.gameId} onDone={tutorial.finish} />}
      {ended && (
        <SessionEndModal
          summary={ended}
          onDone={async () =>
            reset(ended.bankrupt ? [await startScreen()] : [{ name: 'characterSelect' }, { name: 'lobby' }])
          }
        />
      )}
    </div>
  );
}

/**
 * Settled rounds are revealed card by card: baccarat deals all its cards one
 * at a time, blackjack turns the dealer's hole card and then draws. Payouts
 * stay hidden until the last card is shown.
 */
function useRoundReveal(room: HouseRoom) {
  const round = room.round;
  const done = round?.phase === 'done';
  let total = 0;
  let from = 0;
  let stepMs = BACCARAT_STEP_MS;
  if (round?.kind === 'baccarat') {
    total = round.player.length + round.dealer.length;
  } else if (round?.kind === 'blackjack') {
    // Only the face-up card is known until the round is over.
    total = done ? round.dealer.length : 1;
    from = 1;
    stepMs = DEALER_STEP_MS;
  }
  const key = round ? `${room.roundsPlayed}:${done ? 'done' : 'open'}` : null;
  const shown = useStagedReveal(key, total, stepMs, from);
  const pending = done && shown < total;

  let hiddenPayout = 0;
  if (pending && round?.kind === 'baccarat') hiddenPayout = round.payout;
  if (pending && round?.kind === 'blackjack') {
    hiddenPayout = round.hands.reduce((sum, hand) => sum + (hand.payout ?? 0), round.insurancePayout ?? 0);
  }
  return { shown, pending, hiddenPayout };
}

function useRoundFeedback(settledKey: number | null, net: number, settings: { sound: boolean; haptics: boolean }) {
  const last = useRef(settledKey);
  useEffect(() => {
    if (settledKey === null || settledKey === last.current) return;
    last.current = settledKey;
    playSound(net > 0 ? 'win' : net < 0 ? 'lose' : 'check', settings.sound);
    if (net > 0) vibrate(settings.haptics, true);
  }, [settledKey, net, settings.sound, settings.haptics]);
}

// ── Baccarat ─────────────────────────────────────────────────────────────

/** The order cards come out of the shoe: player, banker, player, banker, then third cards. */
function baccaratOrder(round: BaccaratRound): ['player' | 'dealer', number][] {
  const order: ['player' | 'dealer', number][] = [
    ['player', 0],
    ['dealer', 0],
    ['player', 1],
    ['dealer', 1],
  ];
  if (round.player.length > 2) order.push(['player', 2]);
  if (round.dealer.length > 2) order.push(['dealer', 2]);
  return order;
}

function BaccaratTable({ round, shown }: { round: BaccaratRound | null; shown: number }) {
  const order = round ? baccaratOrder(round) : [];
  const visible = (side: 'player' | 'dealer', index: number) =>
    order.findIndex(([s, i]) => s === side && i === index) < shown;
  const settled = !!round && shown >= order.length;

  const side = (key: 'player' | 'dealer', label: string) => {
    const cards = round?.[key] ?? [];
    const open = cards.filter((_, i) => visible(key, i));
    const won = settled && round.winner === (key === 'dealer' ? 'banker' : 'player');
    const mine = round?.choice === (key === 'dealer' ? 'banker' : 'player');
    return (
      <div
        className={cx('rounded-2xl border p-2 transition', won ? 'glow-win border-emerald-400/40' : 'border-white/5')}
      >
        <p className="mb-2 text-center text-xs text-emerald-100/80">
          {label} <b className="tabular-nums">{open.length ? baccaratValue(open) : '-'}</b>
          {mine && <b className="ml-2 text-yellow-200">내 베팅</b>}
        </p>
        <div className="flex min-h-14 justify-center gap-1">
          {round ? (
            cards.map((card, i) =>
              visible(key, i) ? (
                <PlayingCard key={`${i}-${card}`} card={card} size="board" flip={i < 2} />
              ) : i < 2 ? (
                <PlayingCard key={`${i}-back`} faceDown size="board" />
              ) : null,
            )
          ) : (
            <>
              <PlayingCard faceDown size="board" />
              <PlayingCard faceDown size="board" />
            </>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="grid grid-cols-2 gap-2">
      {side('player', '플레이어')}
      {side('dealer', '뱅커')}
    </div>
  );
}

// ── Blackjack ────────────────────────────────────────────────────────────

/** Delay (ms) for each of the four opening cards: player, dealer, player, dealer. */
const OPENING_DELAYS = { player: [0, 300], dealer: [150, 450] };

function BlackjackTable({
  round,
  dealerShown,
  settled,
}: {
  round: BlackjackRound | null;
  dealerShown: number;
  settled: boolean;
}) {
  const done = round?.phase === 'done';
  const dealerCards = round?.dealer ?? [];
  const openDealer = done ? dealerCards.slice(0, dealerShown) : dealerCards.slice(0, 1);
  const opening = !!round && round.hands.length === 1 && round.hands[0].cards.length === 2 && !done;

  return (
    <>
      <p className="mb-2 text-center text-xs text-emerald-100/80">
        딜러 <b className="tabular-nums">{round ? blackjackValue(openDealer).total : '-'}</b>
        {round && !settled && <span className="ml-1 text-gray-500">{done ? '' : '+ ?'}</span>}
      </p>
      <div data-testid="house-dealer-cards" className="flex min-h-14 flex-wrap justify-center gap-1">
        {round ? (
          dealerCards.map((card, i) => {
            if (i === 0) return <PlayingCard key={`0-${card}`} card={card} size="board" delay={opening ? 150 : 0} />;
            if (i === 1) {
              const open = done && dealerShown > 1;
              return open ? (
                <PlayingCard key={`1-${card}`} card={card} size="board" flip />
              ) : (
                <PlayingCard key="1-back" faceDown size="board" delay={opening ? 450 : 0} />
              );
            }
            return i < dealerShown ? <PlayingCard key={`${i}-${card}`} card={card} size="board" /> : null;
          })
        ) : (
          <>
            <PlayingCard faceDown size="board" />
            <PlayingCard faceDown size="board" />
          </>
        )}
      </div>

      <div className={cx('mt-4 grid gap-3', round && round.hands.length > 1 && 'grid-cols-2')}>
        {round ? (
          round.hands.map((hand, i) => (
            <BlackjackHandView
              key={i}
              hand={hand}
              index={i}
              active={round.phase === 'player' && round.activeHand === i}
              small={round.hands.length > 1}
              settled={settled}
              opening={opening}
            />
          ))
        ) : (
          <div className="flex justify-center gap-1">
            <PlayingCard faceDown size="board" />
            <PlayingCard faceDown size="board" />
          </div>
        )}
      </div>
      {round && (round.insurance ?? 0) > 0 && (
        <p className="mt-2 text-center text-[11px] text-sky-200">
          보험 {fmt(round.insurance!)}칩
          {settled && (round.insurancePayout ? ` · 적중 +${fmt(round.insurancePayout)}` : ' · 미적중')}
        </p>
      )}
    </>
  );
}

function BlackjackHandView({
  hand,
  index,
  active,
  small,
  settled,
  opening,
}: {
  hand: BlackjackHand;
  index: number;
  active: boolean;
  small: boolean;
  settled: boolean;
  opening: boolean;
}) {
  const value = blackjackValue(hand.cards);
  const result = settled ? hand.result : undefined;
  const tone =
    (hand.payout ?? 0) > hand.bet
      ? 'text-yellow-200'
      : (hand.payout ?? 0) < hand.bet
        ? 'text-rose-200'
        : 'text-slate-200';
  const resultText =
    result === '블랙잭'
      ? '블랙잭 승리'
      : result === '버스트'
        ? '패배 (버스트)'
        : result === '서렌더'
          ? '서렌더 (절반 반환)'
          : result;
  return (
    <div
      data-testid="blackjack-hand"
      className={cx(
        'rounded-xl border p-2 transition',
        active ? 'border-yellow-500/50 bg-yellow-400/5' : 'border-white/5',
        settled && (hand.payout ?? 0) > hand.bet && 'glow-win',
      )}
    >
      <p className="mb-1 text-center text-xs text-gray-300">
        내 {index + 1}번 핸드 · <b className="tabular-nums">{value.total}</b>
        {value.soft && value.total < 21 ? ' (소프트)' : ''}
      </p>
      <p className={cx('mb-2 h-4 text-center text-xs font-extrabold', tone)}>{result ? `내 ${resultText}` : ' '}</p>
      <div className="flex flex-wrap justify-center gap-1">
        {hand.cards.map((card, k) => (
          <PlayingCard
            key={`${k}-${card}`}
            card={card}
            size={small ? 'sm' : 'board'}
            delay={opening && k < 2 ? OPENING_DELAYS.player[k] : 0}
            dim={hand.surrendered}
          />
        ))}
      </div>
      <p className="mt-1 text-center text-[10px] text-gray-500">내 베팅 {fmt(hand.bet)}</p>
    </div>
  );
}

function BlackjackControls({
  round,
  disabled,
  onAct,
}: {
  round: BlackjackRound;
  disabled: boolean;
  onAct: (action: BlackjackAction) => void;
}) {
  const legal = blackjackActions(round);

  if (round.phase === 'insurance') {
    const cost = insuranceCost(round);
    const hasBlackjack = blackjackValue(round.hands[0].cards).total === 21;
    return (
      <>
        <p className="text-center text-xs leading-relaxed text-gray-300">
          {hasBlackjack ? (
            <>
              블랙잭이에요! <b>이븐 머니</b>를 받으면 딜러 결과와 상관없이 {fmt(round.hands[0].bet)}칩 이익이 확정돼요.
            </>
          ) : (
            <>
              보험 비용 <b className="text-yellow-300">{fmt(cost)}</b>칩 · 딜러가 블랙잭이면 2:1로 돌려받아요.
            </>
          )}
        </p>
        <div className="grid grid-cols-2 gap-2">
          <button className="poker-action poker-action-call" disabled={disabled} onClick={() => onAct('noInsurance')}>
            {hasBlackjack ? '그대로 진행' : '보험 없이'}
          </button>
          <button
            className="poker-action poker-action-raise"
            disabled={disabled || !legal.includes('insurance')}
            onClick={() => onAct('insurance')}
          >
            {hasBlackjack ? '이븐 머니' : '보험 걸기'}
            <span className="poker-action-amount">{fmt(cost)}</span>
          </button>
        </div>
      </>
    );
  }

  const button = (action: BlackjackAction, style: string) => (
    <button
      key={action}
      className={cx('poker-action', style)}
      disabled={disabled || !legal.includes(action)}
      onClick={() => onAct(action)}
    >
      {ACTION_LABELS[action]}
    </button>
  );
  return (
    <>
      <p className="text-center text-xs text-gray-400">
        내 {round.activeHand + 1}번 핸드 차례 · 추가 베팅 가능 칩 {fmt(round.balance)}
      </p>
      <div className="grid grid-cols-3 gap-2">
        {button('double', 'poker-action-raise')}
        {button('split', 'poker-action-raise')}
        {button('surrender', 'poker-action-fold')}
      </div>
      <div className="grid grid-cols-2 gap-2">
        {button('stand', 'poker-action-call')}
        {button('hit', 'poker-action-call')}
      </div>
    </>
  );
}

// ── Betting ──────────────────────────────────────────────────────────────

function BetControls({
  room,
  bet,
  choice,
  disabled,
  busy,
  onBet,
  onChoose,
  onPlace,
}: {
  room: HouseRoom;
  bet: number;
  choice: BaccaratBet;
  disabled: boolean;
  busy: boolean;
  onBet: (bet: number) => void;
  onChoose: (choice: BaccaratBet) => void;
  onPlace: () => void;
}) {
  const limits = houseBetLimits(room);
  const unit = 20;
  const allIn = limits.max === room.balance ? room.balance : Math.floor(limits.max / unit) * unit;
  const presets: [string, number][] = [
    ['최소', limits.min],
    ['중간', Math.max(limits.min, Math.floor(limits.max / (unit * 2)) * unit)],
    ['최대', allIn],
  ];
  return (
    <>
      {room.gameId === 'baccarat' && (
        <div className="grid grid-cols-3 gap-2">
          {BACCARAT_CHOICES.map((item) => (
            <button
              key={item.value}
              disabled={disabled}
              onClick={() => onChoose(item.value)}
              className={cx(
                'rounded-xl border px-2 py-2 text-xs',
                choice === item.value
                  ? 'border-yellow-500/60 bg-yellow-400/10 text-yellow-200'
                  : 'border-gray-700 bg-gray-900 text-gray-400',
              )}
            >
              {item.label}
              <span className="ml-1 text-[10px] opacity-60">{item.odds}</span>
            </button>
          ))}
        </div>
      )}
      <div className="flex items-center justify-between text-xs text-gray-400">
        <span>
          베팅 {fmt(limits.min)}~{fmt(limits.max)}
        </span>
        <Chips amount={bet} />
      </div>
      <input
        aria-label="베팅 금액"
        disabled={disabled}
        type="range"
        min={0}
        max={Math.floor(limits.max / unit)}
        value={Math.floor(bet / unit)}
        step={1}
        onChange={(event) => onBet(Math.max(limits.min, Number(event.target.value) * unit))}
      />
      <div className="grid grid-cols-3 gap-2">
        {presets.map(([label, value]) => (
          <Button key={label} className="py-2" disabled={disabled} onClick={() => onBet(value)}>
            {label}
          </Button>
        ))}
      </div>
      <button className="poker-action poker-action-raise" disabled={disabled || bet <= 0} onClick={onPlace}>
        {busy ? '정산 중…' : `${room.roundsPlayed ? '다음 판' : '시작'} · ${fmt(bet)}칩 베팅`}
      </button>
    </>
  );
}

function RoomFinished({ limit, disabled, onLeave }: { limit: boolean; disabled: boolean; onLeave: () => void }) {
  return (
    <>
      <p className="text-center font-bold text-yellow-300">
        {limit ? '이번 방의 수익 목표를 달성했습니다!' : '이번 방의 칩을 모두 사용했습니다.'}
      </p>
      <p className="text-center text-xs text-gray-400">
        {limit
          ? '마지막 판의 당첨금까지 전부 지급했습니다. 정산 후 다시 입장해 주세요.'
          : '남은 지갑 잔액으로 다시 입장할 수 있습니다.'}
      </p>
      <Button className="w-full" variant="primary" disabled={disabled} onClick={onLeave}>
        정산하고 나가기
      </Button>
    </>
  );
}
