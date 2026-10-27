/** Position label for `index` in a hand of `n` players with the button at `button`. */
export function positionName(n: number, index: number, button: number): string {
  const offset = (index - button + n) % n;
  if (n === 2) return offset === 0 ? 'BTN' : 'BB';
  if (offset === 0) return 'BTN';
  if (offset === 1) return 'SB';
  if (offset === 2) return 'BB';
  const fromBtn = n - offset; // 1 = cutoff
  if (fromBtn === 1) return 'CO';
  if (offset === 3) return 'UTG';
  return 'MP';
}
