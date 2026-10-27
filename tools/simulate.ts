/**
 * Headless bot-vs-bot simulator.
 *   npm run simulate -- [hands]
 * Plays HIGH vs LOW heads-up and 6-max with fresh 100bb stacks every hand,
 * checks chip conservation, and reports results in bb/100 hands.
 */
import { createRng, type Rng } from '../src/core/rng';
import { botDecide, randomPersonality, type CpuClass } from '../src/games/holdem/ai';
import { applyAction, legalActions, startHand } from '../src/games/holdem/engine';
import type { Action } from '../src/games/holdem/types';

type Kind = CpuClass | 'RANDOM';

function randomAction(rng: Rng, legal: ReturnType<typeof legalActions>): Action {
  const r = rng.next();
  if (legal.canRaise && r < 0.2) return { type: 'raise', to: legal.minRaiseTo + rng.int(legal.maxRaiseTo - legal.minRaiseTo + 1) };
  if (legal.canFold && r < 0.45) return { type: 'fold' };
  return legal.canCall ? { type: 'call' } : { type: 'check' };
}

function run(kinds: Kind[], hands: number, seed: number) {
  const rng = createRng(seed);
  const bb = 20;
  const personalities = kinds.map((k) => randomPersonality(k === 'RANDOM' ? 'LOW' : k, rng));
  const net = kinds.map(() => 0);
  let illegal = 0;

  for (let h = 0; h < hands; h++) {
    const players = kinds.map((_, i) => ({ id: `${i}`, name: `${i}`, stack: bb * 100 }));
    let step = startHand({ players, button: h % kinds.length, sb: bb / 2, bb, rng });
    let guard = 0;
    while (!step.state.result) {
      const seat = step.state.toAct;
      const kind = kinds[seat];
      const legal = legalActions(step.state);
      const action =
        kind === 'RANDOM' ? randomAction(rng, legal) : botDecide(kind, step.state, { personality: personalities[seat], rng });
      if (action.type === 'raise' && (!legal.canRaise || action.to < legal.minRaiseTo || action.to > legal.maxRaiseTo)) illegal++;
      step = applyAction(step.state, action);
      if (++guard > 500) throw new Error('Hand did not finish');
    }
    const total = step.state.players.reduce((s, p) => s + p.stack, 0);
    if (total !== bb * 100 * kinds.length) throw new Error(`Chips not conserved in hand ${h}`);
    step.state.result.net.forEach((n, i) => (net[i] += n));
  }

  const byKind = new Map<Kind, { seats: number; net: number }>();
  kinds.forEach((k, i) => {
    const e = byKind.get(k) ?? { seats: 0, net: 0 };
    e.seats++;
    e.net += net[i];
    byKind.set(k, e);
  });
  const label = kinds.join(' vs ');
  console.log(`\n${label}  (${hands} hands, illegal raises: ${illegal})`);
  for (const [k, e] of byKind) {
    const bbPer100 = (e.net / e.seats / bb / hands) * 100;
    console.log(`  ${k.padEnd(6)} ${bbPer100 >= 0 ? '+' : ''}${bbPer100.toFixed(1)} bb/100 per seat`);
  }
}

const hands = Number(process.argv[2] ?? 20000);
const started = Date.now();
run(['HIGH', 'LOW'], hands, 1);
run(['HIGH', 'RANDOM'], hands, 2);
run(['LOW', 'RANDOM'], hands, 3);
run(['HIGH', 'LOW', 'LOW', 'HIGH', 'LOW', 'HIGH'], Math.floor(hands / 2), 4);
console.log(`\nDone in ${((Date.now() - started) / 1000).toFixed(1)}s`);
