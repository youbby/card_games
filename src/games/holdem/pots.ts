export interface Pot {
  amount: number;
  eligible: number[];
}

/**
 * Splits the chips into a main pot and side pots.
 * Each slice between two contribution levels is contested only by the
 * non-folded players who put in at least that level.
 */
export function buildPots(contributed: number[], folded: boolean[]): Pot[] {
  const levels = [...new Set(contributed.filter((c, i) => !folded[i] && c > 0))].sort((a, b) => a - b);
  const maxContribution = Math.max(0, ...contributed);
  if (levels.length === 0 || levels[levels.length - 1] < maxContribution) levels.push(maxContribution);

  const pots: Pot[] = [];
  let prev = 0;
  for (const level of levels) {
    let amount = 0;
    for (const c of contributed) amount += Math.min(c, level) - Math.min(c, prev);
    const eligible = contributed.flatMap((c, i) => (!folded[i] && c >= level ? [i] : []));
    prev = level;
    if (amount === 0) continue;

    const last = pots[pots.length - 1];
    if (eligible.length === 0 && last) {
      // Chips above every live player's contribution (only possible from folded players).
      last.amount += amount;
    } else if (last && sameMembers(last.eligible, eligible)) {
      last.amount += amount;
    } else {
      pots.push({ amount, eligible });
    }
  }
  return pots;
}

function sameMembers(a: number[], b: number[]): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

/**
 * Splits `amount` between winners. Odd chips go one at a time to the winners
 * closest to the left of the button.
 */
export function splitPot(amount: number, winners: number[], button: number, seatCount: number): number[] {
  const base = Math.floor(amount / winners.length);
  let remainder = amount - base * winners.length;
  const order = [...winners].sort(
    (a, b) => ((a - button - 1 + seatCount) % seatCount) - ((b - button - 1 + seatCount) % seatCount),
  );
  const shares = new Map(winners.map((w) => [w, base]));
  for (const w of order) {
    if (remainder === 0) break;
    shares.set(w, shares.get(w)! + 1);
    remainder--;
  }
  return winners.map((w) => shares.get(w)!);
}
