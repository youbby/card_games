import { cardToString, rankLabel, rankOf, SUIT_SYMBOLS, suitOf, type Card } from '../core/cards';
import { createRng, randomSeed, type Rng } from '../core/rng';
import { db } from '../data/db';
import type { Character, InProgressHand, TableSession } from '../data/types';
import { botDecide } from '../games/holdem/ai';
import { applyAction, startHand } from '../games/holdem/engine';
import type { Action, ActionRecord, HandEvent, HandState } from '../games/holdem/types';
import {
  endSession,
  type EndSessionResult,
  maintainCpuSeats,
  nextButton,
  rebuyPlayer,
  recordHand,
  saveInProgress,
  seatsInPlay,
  type TableNotice,
} from './session';

export type TablePhase = 'starting' | 'playing' | 'handOver' | 'needRebuy' | 'noOpponents' | 'ended';

export interface LogEntry {
  id: number;
  text: string;
  tone: 'system' | 'action' | 'street' | 'win' | 'mine';
}

export interface TableView {
  session: TableSession;
  hand: HandState | null;
  /** session seat index for each player index of `hand`. */
  seatOfPlayer: number[];
  phase: TablePhase;
  log: LogEntry[];
  /** Last action label per session seat. */
  seatLabels: Record<number, string>;
  thinkingSeat: number | null;
  humanTurn: boolean;
  endResult?: EndSessionResult;
}

export interface RunnerOptions {
  /** CPU "thinking" delay in ms. */
  thinkMs: () => number;
  onChange: (view: TableView) => void;
  rng?: Rng;
}

export function formatCard(c: Card): string {
  return `${rankLabel(rankOf(c))}${SUIT_SYMBOLS[suitOf(c)]}`;
}

export function actionLabel(r: ActionRecord): string {
  const n = r.to.toLocaleString();
  switch (r.kind) {
    case 'sb':
      return `SB ${n}`;
    case 'bb':
      return `BB ${n}`;
    case 'fold':
      return '폴드';
    case 'check':
      return '체크';
    case 'call':
      return r.allIn ? `올인 ${n}` : `콜 ${n}`;
    case 'bet':
      return r.allIn ? `올인 ${n}` : `벳 ${n}`;
    case 'raise':
      return r.allIn ? `올인 ${n}` : `레이즈 ${n}`;
  }
}

const STREET_KO = { PREFLOP: '프리플랍', FLOP: '플랍', TURN: '턴', RIVER: '리버', SHOWDOWN: '쇼다운' } as const;

export class TableRunner {
  private session: TableSession;
  private hand: HandState | null = null;
  private seatOfPlayer: number[] = [];
  private phase: TablePhase = 'starting';
  private log: LogEntry[] = [];
  private logId = 0;
  private seatLabels: Record<number, string> = {};
  private thinkingSeat: number | null = null;
  private inProgress: InProgressHand | undefined;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private persist: Promise<unknown> = Promise.resolve();
  /** Hand setup or recording in flight; leave() waits for it. */
  private work: Promise<unknown> = Promise.resolve();
  private personalities = new Map<string, Character>();
  private rng: Rng;
  private disposed = false;
  private endResult?: EndSessionResult;

  constructor(
    session: TableSession,
    private readonly opts: RunnerOptions,
  ) {
    this.session = session;
    this.rng = opts.rng ?? createRng(randomSeed());
  }

  view(): TableView {
    const human = this.seatOfPlayer.indexOf(0);
    return {
      session: this.session,
      hand: this.hand,
      seatOfPlayer: this.seatOfPlayer,
      phase: this.phase,
      log: this.log,
      seatLabels: this.seatLabels,
      thinkingSeat: this.thinkingSeat,
      humanTurn: this.phase === 'playing' && !!this.hand && !this.hand.result && this.hand.toAct === human && human >= 0,
      endResult: this.endResult,
    };
  }

  private emit() {
    if (!this.disposed) this.opts.onChange(this.view());
  }

  private addLog(text: string, tone: LogEntry['tone'] = 'action') {
    this.log = [...this.log.slice(-80), { id: ++this.logId, text, tone }];
  }

  private logNotices(notices: TableNotice[]) {
    for (const n of notices) {
      if (n.type === 'rebuy') this.addLog(`${n.name} 리바이 ${n.amount.toLocaleString()}`, 'system');
      if (n.type === 'bankrupt') this.addLog(`💀 ${n.name} 파산으로 퇴장`, 'system');
      if (n.type === 'join') this.addLog(`${n.name} 입장`, 'system');
      if (n.type === 'leave') this.addLog(`${n.name} 퇴장`, 'system');
    }
  }

  startNextHand(): Promise<void> {
    const job = this.work.then(() => this.setUpHand());
    this.work = job.catch((e: unknown) => this.reportError(e));
    return job;
  }

  private reportError(e: unknown) {
    this.addLog(`오류: ${e instanceof Error ? e.message : String(e)}`, 'system');
    this.emit();
  }

  private async setUpHand(): Promise<void> {
    if (this.disposed || this.phase === 'ended') return;
    this.phase = 'starting';
    this.seatLabels = {};
    this.hand = null;
    this.seatOfPlayer = [];

    const player = this.session.seats[0]!;
    if (player.stack <= 0) {
      this.phase = 'needRebuy';
      this.emit();
      return;
    }

    const { session, notices } = await maintainCpuSeats(this.session, this.rng);
    this.session = session;
    this.logNotices(notices);

    const inPlay = seatsInPlay(this.session);
    if (inPlay.length < 2) {
      this.phase = 'noOpponents';
      this.addLog('함께 플레이할 상대가 없습니다.', 'system');
      this.emit();
      return;
    }
    for (const { record } of inPlay) {
      if (record.kind === 'CPU' && !this.personalities.has(record.characterId)) {
        const c = await db.characters.get(record.characterId);
        if (c) this.personalities.set(c.id, c);
      }
    }

    const buttonSeat = nextButton(this.session);
    const seed = randomSeed();
    const step = startHand({
      players: inPlay.map(({ record }) => ({ id: record.characterId, name: record.name, stack: record.stack })),
      button: inPlay.findIndex((s) => s.seat === buttonSeat),
      sb: this.session.sb,
      bb: this.session.bb,
      rng: createRng(seed),
    });
    this.seatOfPlayer = inPlay.map((s) => s.seat);
    this.hand = step.state;
    this.phase = 'playing';
    this.inProgress = {
      seed,
      startStacks: Object.fromEntries(step.state.players.map((p) => [p.id, p.startStack])),
      committed: {},
    };
    this.addLog(`── 핸드 #${this.session.handsPlayed + 1} ──`, 'system');
    this.handleEvents(step.events);
    this.queuePersist();
    this.continue();
  }

  private handleEvents(events: HandEvent[]) {
    const hand = this.hand!;
    for (const e of events) {
      if (e.type === 'action') {
        const seat = this.seatOfPlayer[e.record.player];
        const label = actionLabel(e.record);
        this.seatLabels = { ...this.seatLabels, [seat]: label };
        this.addLog(`${hand.players[e.record.player].name}: ${label}`, seat === 0 ? 'mine' : 'action');
      } else if (e.type === 'street') {
        this.seatLabels = Object.fromEntries(
          Object.entries(this.seatLabels).filter(([, l]) => l === '폴드' || l.startsWith('올인')),
        );
        this.addLog(`${STREET_KO[e.street]}: ${e.cards.map(formatCard).join(' ')}`, 'street');
      } else if (e.type === 'end') {
        const r = e.result;
        if (r.showdown) {
          hand.players.forEach((p, i) => {
            const v = r.hands[i];
            if (v) this.addLog(`${p.name}: ${p.hole.map(formatCard).join(' ')} → ${v.name}`, 'action');
          });
        }
        r.pots.forEach((pot, k) => {
          const label = r.pots.length > 1 ? (k === 0 ? '메인팟' : `사이드팟 ${k}`) : '팟';
          const who = pot.winners
            .map((w, j) => `${hand.players[w].name} +${pot.shares[j].toLocaleString()}`)
            .join(', ');
          const how = r.showdown ? ` (${r.hands[pot.winners[0]]!.name})` : '';
          this.addLog(`🏆 ${label}: ${who}${how}`, 'win');
        });
      }
    }
    if (this.inProgress) {
      this.inProgress = {
        ...this.inProgress,
        committed: Object.fromEntries(hand.players.map((p) => [p.id, p.contributed])),
      };
    }
  }

  private queuePersist() {
    const snapshot = this.inProgress;
    const id = this.session.id;
    this.persist = this.persist.then(() => saveInProgress(id, snapshot));
  }

  private continue() {
    const hand = this.hand;
    if (!hand || this.disposed) return;
    if (hand.result) {
      this.work = this.finishHand().catch((e: unknown) => this.reportError(e));
      return;
    }
    const seat = this.seatOfPlayer[hand.toAct];
    if (seat === 0) {
      this.thinkingSeat = null;
      this.emit();
      return;
    }
    this.thinkingSeat = seat;
    this.emit();
    this.timer = setTimeout(() => {
      this.timer = null;
      if (this.disposed || this.hand !== hand) return;
      const id = hand.players[hand.toAct].id;
      const cpu = this.personalities.get(id);
      const human = this.seatOfPlayer.indexOf(0);
      const action = botDecide(cpu?.cpuClass ?? this.session.cpuClass, hand, {
        personality: cpu?.personality ?? { tightness: 0.5, aggression: 0.5, bluff: 0.2 },
        rng: this.rng,
        human: human >= 0 ? { index: human, model: this.session.opponentModel } : undefined,
      });
      this.apply(action);
    }, this.opts.thinkMs());
  }

  private apply(action: Action) {
    const step = applyAction(this.hand!, action);
    this.hand = step.state;
    this.handleEvents(step.events);
    if (!step.state.result) this.queuePersist();
    this.thinkingSeat = null;
    this.continue();
  }

  humanAct(action: Action) {
    const v = this.view();
    if (!v.humanTurn) return;
    this.apply(action);
  }

  private async finishHand() {
    const hand = this.hand!;
    this.thinkingSeat = null;
    await this.persist;
    if (this.disposed) return;
    this.session = await recordHand({
      session: this.session,
      hand,
      seatOfPlayer: this.seatOfPlayer,
      seed: this.inProgress?.seed ?? 0,
    });
    this.inProgress = undefined;
    this.phase = 'handOver';
    this.emit();
  }

  async rebuy(amount: number) {
    this.session = await rebuyPlayer(this.session, amount);
    this.addLog(`리바이 ${amount.toLocaleString()}`, 'mine');
    await this.startNextHand();
  }

  /** Stand up. An unfinished hand counts as a fold. */
  async leave(): Promise<EndSessionResult> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    await this.work;
    await this.persist;
    if (this.phase === 'ended') return this.endResult!;
    const unfinished = this.hand && !this.hand.result ? this.inProgress : undefined;
    this.hand = null;
    this.endResult = await endSession(this.session.id, unfinished);
    this.phase = 'ended';
    this.emit();
    return this.endResult;
  }

  dispose() {
    this.disposed = true;
    if (this.timer) clearTimeout(this.timer);
  }

  /** Hole cards as strings, for debugging and tests. */
  holeCards(): string[][] {
    return this.hand?.players.map((p) => p.hole.map(cardToString)) ?? [];
  }
}
