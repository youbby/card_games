/** Tiny synthesized sound effects (no audio files, works offline). */
let ctx: AudioContext | null = null;

function audio(): AudioContext | null {
  if (typeof window === 'undefined' || !('AudioContext' in window)) return null;
  ctx ??= new AudioContext();
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

function tone(freq: number, duration: number, type: OscillatorType = 'sine', gain = 0.06, delay = 0) {
  const a = audio();
  if (!a) return;
  const t = a.currentTime + delay;
  const osc = a.createOscillator();
  const g = a.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + duration);
  osc.connect(g).connect(a.destination);
  osc.start(t);
  osc.stop(t + duration);
}

export type SoundName = 'card' | 'chip' | 'check' | 'fold' | 'turn' | 'win' | 'lose';

export function playSound(name: SoundName, enabled: boolean): void {
  if (!enabled) return;
  switch (name) {
    case 'card':
      tone(900, 0.05, 'triangle', 0.04);
      break;
    case 'chip':
      tone(1500, 0.04, 'square', 0.025);
      tone(1900, 0.05, 'square', 0.02, 0.04);
      break;
    case 'check':
      tone(300, 0.06, 'sine', 0.06);
      break;
    case 'fold':
      tone(220, 0.12, 'sine', 0.04);
      break;
    case 'turn':
      tone(660, 0.08, 'sine', 0.05);
      tone(880, 0.1, 'sine', 0.05, 0.08);
      break;
    case 'win':
      [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.18, 'triangle', 0.06, i * 0.09));
      break;
    case 'lose':
      tone(330, 0.2, 'sine', 0.05);
      tone(262, 0.3, 'sine', 0.05, 0.15);
      break;
  }
}
