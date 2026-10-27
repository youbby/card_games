import { type Card, fullDeck } from '../../core/cards';
import { evaluate, type HandValue } from '../../core/evaluator';
import { createRng, type Rng, shuffle } from '../../core/rng';
import { buildPots, splitPot } from './pots';
import type {
  Action,
  ActionKind,
  HandEvent,
  HandResult,
  HandState,
  LegalActions,
  PlayerState,
  SeatInput,
  Street,
} from './types';

export interface StartHandInput {
  variant?: 'holdem' | 'draw';
  /** Players dealt in, in seat order around the table. Every stack must be > 0. */
  players: SeatInput[];
  /** Index into `players` of the dealer button. */
  button: number;
  sb: number;
  bb: number;
  rng: Rng;
}

export interface Step {
  state: HandState;
  events: HandEvent[];
}

function clonePlayer(p: PlayerState): PlayerState {
  return { ...p, hole: [...p.hole] };
}

function cloneState(s: HandState): HandState {
  return {
    ...s,
    players: s.players.map(clonePlayer),
    deck: [...s.deck],
    board: [...s.board],
    actions: [...s.actions],
    discards: s.discards ? [...s.discards] : undefined,
    drawDone: s.drawDone ? [...s.drawDone] : undefined,
  };
}

const live = (p: PlayerState) => !p.folded;
const canAct = (p: PlayerState) => !p.folded && !p.allIn;

function othersCanAct(s: HandState, index: number): boolean {
  return s.players.some((q, i) => i !== index && canAct(q));
}

function needsToAct(s: HandState, index: number): boolean {
  const p = s.players[index];
  if (!canAct(p)) return false;
  if (p.bet < s.currentBet) return true;
  // Nobody left to bet against: no decision to make.
  if (!othersCanAct(s, index)) return false;
  return !p.hasActed;
}

function findNextToAct(s: HandState, from: number): number {
  const n = s.players.length;
  for (let k = 0; k < n; k++) {
    const i = (from + k) % n;
    if (needsToAct(s, i)) return i;
  }
  return -1;
}

/** Moves chips from a player's stack into the pot. */
function commit(p: PlayerState, amount: number): number {
  const paid = Math.min(amount, p.stack);
  p.stack -= paid;
  p.bet += paid;
  p.contributed += paid;
  if (p.stack === 0) p.allIn = true;
  return paid;
}

export function potTotal(s: HandState): number {
  return s.players.reduce((sum, p) => sum + p.contributed, 0);
}

export function startHand(input: StartHandInput): Step {
  const { players: seats, button, sb, bb, rng } = input;
  const n = seats.length;
  if (n < 2) throw new Error('Need at least 2 players');
  if (seats.some((p) => p.stack <= 0)) throw new Error('Every player needs chips');

  const headsUp = n === 2;
  const sbIndex = headsUp ? button : (button + 1) % n;
  const bbIndex = headsUp ? (button + 1) % n : (button + 2) % n;

  const deck = shuffle(fullDeck(), rng);
  const players: PlayerState[] = seats.map((p) => ({
    id: p.id,
    name: p.name,
    startStack: p.stack,
    stack: p.stack,
    hole: [],
    bet: 0,
    contributed: 0,
    folded: false,
    allIn: false,
    hasActed: false,
  }));
  for (let round = 0; round < (input.variant === 'draw' ? 5 : 2); round++) {
    for (let k = 0; k < n; k++) players[(sbIndex + k) % n].hole.push(deck.pop()!);
  }

  const state: HandState = {
    variant: input.variant ?? 'holdem',
    discards: [],
    drawSeed: rng.int(0x7fffffff),
    players,
    button,
    sbIndex,
    bbIndex,
    sb,
    bb,
    deck,
    board: [],
    street: 'PREFLOP',
    toAct: -1,
    currentBet: bb,
    minRaise: bb,
    lastAggressor: -1,
    preflopRaiser: -1,
    actions: [],
    result: null,
  };
  const events: HandEvent[] = [];

  const post = (index: number, amount: number, kind: ActionKind) => {
    const p = players[index];
    const paid = commit(p, amount);
    const record = { street: 'PREFLOP' as Street, player: index, kind, amount: paid, to: p.bet, allIn: p.allIn };
    state.actions.push(record);
    events.push({ type: 'action', record });
  };
  post(sbIndex, sb, 'sb');
  post(bbIndex, bb, 'bb');

  const first = headsUp ? sbIndex : (bbIndex + 1) % n;
  state.toAct = findNextToAct(state, first);
  if (state.toAct < 0) endRound(state, events);
  return { state, events };
}

export function legalActions(s: HandState): LegalActions {
  const none: LegalActions = {
    canFold: false,
    canCheck: false,
    canCall: false,
    callAmount: 0,
    canRaise: false,
    minRaiseTo: 0,
    maxRaiseTo: 0,
  };
  if (s.toAct < 0 || s.result || s.street === 'DRAW') return none;
  const p = s.players[s.toAct];
  const owed = Math.max(0, s.currentBet - p.bet);
  const maxRaiseTo = p.bet + p.stack;
  let minRaiseTo = s.currentBet === 0 ? s.bb : s.currentBet + s.minRaise;
  const canRaise = !p.hasActed && maxRaiseTo > s.currentBet && othersCanAct(s, s.toAct);
  if (minRaiseTo > maxRaiseTo) minRaiseTo = maxRaiseTo; // only an all-in is possible
  return {
    canFold: owed > 0,
    canCheck: owed === 0,
    canCall: owed > 0,
    callAmount: Math.min(owed, p.stack),
    canRaise,
    minRaiseTo: canRaise ? minRaiseTo : 0,
    maxRaiseTo: canRaise ? maxRaiseTo : 0,
  };
}

/**
 * Applies the acting player's action. Illegal actions are coerced to the
 * closest legal one (e.g. an undersized raise becomes a min-raise, a check
 * facing a bet becomes a fold).
 */
export function applyAction(prev: HandState, action: Action): Step {
  if (prev.toAct < 0 || prev.result) throw new Error('No player to act');
  if (prev.street === 'DRAW') return applyDraw(prev, action);
  if (action.type === 'draw') throw new Error('지금은 카드를 교환할 수 없습니다.');
  const s = cloneState(prev);
  const events: HandEvent[] = [];
  const index = s.toAct;
  const p = s.players[index];
  const legal = legalActions(s);

  let act = action;
  if (act.type === 'raise' && !legal.canRaise) act = legal.canCall ? { type: 'call' } : { type: 'check' };
  if (act.type === 'check' && !legal.canCheck) act = { type: 'fold' };
  if (act.type === 'call' && !legal.canCall) act = { type: 'check' };
  if (act.type === 'fold' && !legal.canFold) act = { type: 'check' };

  let kind: ActionKind;
  let amount = 0;
  switch (act.type) {
    case 'fold':
      p.folded = true;
      kind = 'fold';
      break;
    case 'check':
      kind = 'check';
      break;
    case 'call':
      amount = commit(p, legal.callAmount);
      kind = 'call';
      break;
    case 'raise': {
      const to = Math.min(Math.max(act.to, legal.minRaiseTo), legal.maxRaiseTo);
      kind = s.currentBet === 0 ? 'bet' : 'raise';
      amount = commit(p, to - p.bet);
      const increment = p.bet - s.currentBet;
      if (increment >= s.minRaise) {
        // Full raise: reopens the action for everyone else.
        s.minRaise = increment;
        s.players.forEach((q, i) => {
          if (i !== index) q.hasActed = false;
        });
      }
      s.currentBet = p.bet;
      s.lastAggressor = index;
      if (s.street === 'PREFLOP') s.preflopRaiser = index;
      break;
    }
  }
  p.hasActed = true;

  const record = { street: s.street, player: index, kind, amount, to: p.bet, allIn: p.allIn };
  s.actions.push(record);
  events.push({ type: 'action', record });

  if (s.players.filter(live).length === 1) {
    finishWithoutShowdown(s, events);
    return { state: s, events };
  }

  s.toAct = findNextToAct(s, index + 1);
  if (s.toAct < 0) endRound(s, events);
  return { state: s, events };
}

const NEXT_STREET: Partial<Record<Street, Street>> = { PREFLOP: 'FLOP', FLOP: 'TURN', TURN: 'RIVER' };

function dealStreet(s: HandState, street: Street, events: HandEvent[]) {
  const count = street === 'FLOP' ? 3 : 1;
  s.deck.pop(); // burn
  const cards: Card[] = [];
  for (let i = 0; i < count; i++) cards.push(s.deck.pop()!);
  s.board.push(...cards);
  s.street = street;
  events.push({ type: 'street', street, cards });
}

function endRound(s: HandState, events: HandEvent[]) {
  if (s.variant === 'draw') {
    if (s.street !== 'PREFLOP') { showdown(s, events); return; }
    s.street = 'DRAW';
    s.drawDone = s.players.map((player) => player.folded);
    s.toAct = nextDrawer(s, s.button + 1);
    events.push({ type: 'street', street: 'DRAW', cards: [] });
    return;
  }
  for (;;) {
    const next = NEXT_STREET[s.street];
    if (!next) {
      showdown(s, events);
      return;
    }
    s.players.forEach((p) => {
      p.bet = 0;
      p.hasActed = false;
    });
    s.currentBet = 0;
    s.minRaise = s.bb;
    s.lastAggressor = -1;
    dealStreet(s, next, events);

    // With fewer than two players able to bet, the board just runs out.
    if (s.players.filter(canAct).length < 2) continue;
    s.toAct = findNextToAct(s, s.button + 1);
    if (s.toAct >= 0) return;
  }
}

function nextDrawer(s: HandState, from: number): number {
  for (let offset = 0; offset < s.players.length; offset++) {
    const index = (from + offset) % s.players.length;
    if (!s.drawDone![index]) return index;
  }
  return -1;
}
function applyDraw(prev: HandState, action: Action): Step {
  if (action.type !== 'draw') throw new Error('교환할 카드를 선택하세요.');
  const indices = [...new Set(action.indices)];
  if (indices.length !== action.indices.length || indices.some((i) => !Number.isInteger(i) || i < 0 || i > 4)) throw new Error('교환할 카드가 올바르지 않습니다.');
  const s = cloneState(prev), events: HandEvent[] = [];
  const index = s.toAct, player = s.players[index];
  const discarded = indices.map((i) => player.hole[i]);
  for (const i of indices) {
    if (!s.deck.length) {
      s.deck = shuffle(s.discards!, createRng(s.drawSeed!));
      s.drawSeed = (s.drawSeed! + 1) >>> 0; s.discards = [];
    }
    const card = s.deck.pop();
    if (card === undefined) throw new Error('카드가 부족합니다.');
    player.hole[i] = card;
  }
  s.discards!.push(...discarded);
  s.drawDone![index] = true;
  s.actions.push({ street: 'DRAW', player: index, kind: 'draw', amount: 0, to: indices.length, allIn: player.allIn });
  events.push({ type: 'draw', player: index, count: indices.length });
  s.toAct = nextDrawer(s, index + 1);
  if (s.toAct < 0) {
    s.street = 'RIVER'; s.currentBet = 0; s.minRaise = s.bb; s.lastAggressor = -1;
    s.players.forEach((p) => { p.bet = 0; p.hasActed = false; });
    events.push({ type: 'street', street: 'RIVER', cards: [] });
    s.toAct = findNextToAct(s, s.button + 1);
    if (s.toAct < 0) showdown(s, events);
  }
  return { state: s, events };
}

function finishWithoutShowdown(s: HandState, events: HandEvent[]) {
  const winner = s.players.findIndex(live);
  const amount = potTotal(s);
  const payouts = s.players.map((_, i) => (i === winner ? amount : 0));
  settle(s, events, {
    showdown: false,
    pots: [{ amount, eligible: [winner], winners: [winner], shares: [amount] }],
    hands: s.players.map(() => null),
    payouts,
  });
}

function showdown(s: HandState, events: HandEvent[]) {
  s.street = 'SHOWDOWN';
  const hands: (HandValue | null)[] = s.players.map((p) => (p.folded ? null : evaluate([...p.hole, ...s.board])));
  const pots = buildPots(
    s.players.map((p) => p.contributed),
    s.players.map((p) => p.folded),
  );
  const payouts = s.players.map(() => 0);
  const potResults = pots.map((pot) => {
    const best = Math.max(...pot.eligible.map((i) => hands[i]!.score));
    const winners = pot.eligible.filter((i) => hands[i]!.score === best);
    const shares = splitPot(pot.amount, winners, s.button, s.players.length);
    winners.forEach((w, k) => (payouts[w] += shares[k]));
    return { ...pot, winners, shares };
  });
  settle(s, events, { showdown: true, pots: potResults, hands, payouts });
}

function settle(s: HandState, events: HandEvent[], r: Omit<HandResult, 'net'>) {
  s.players.forEach((p, i) => {
    p.stack += r.payouts[i];
    p.bet = 0;
  });
  const result: HandResult = { ...r, net: s.players.map((p) => p.stack - p.startStack) };
  s.result = result;
  s.toAct = -1;
  events.push({ type: 'end', result });
}

/** Whether the player at `index` voluntarily put chips in preflop (VPIP). */
export function didVpip(s: HandState, index: number): boolean {
  return s.actions.some(
    (a) => a.player === index && a.street === 'PREFLOP' && (a.kind === 'call' || a.kind === 'raise' || a.kind === 'bet'),
  );
}

export function didPfr(s: HandState, index: number): boolean {
  return s.actions.some((a) => a.player === index && a.street === 'PREFLOP' && (a.kind === 'raise' || a.kind === 'bet'));
}
