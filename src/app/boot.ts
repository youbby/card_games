import { getSettings, listPlayers } from '../services/characters';
import { initializeApp } from '../services/factoryReset';
import { recoverOpenSessions, sweepBankruptPlayers } from '../services/session';
import type { Screen } from './store';
import { useApp } from './store';
import { recoverHouseRooms } from '../services/house';

/** Where the app should start: create, all-bankrupt guide, or character select. */
export async function startScreen(): Promise<Screen> {
  const players = await listPlayers();
  if (players.length === 0) return { name: 'characterCreate', reason: 'first' };
  if (players.every((p) => p.status === 'BANKRUPT')) return { name: 'characterCreate', reason: 'allBankrupt' };
  return { name: 'characterSelect' };
}

let booting: Promise<void> | null = null;

/** Runs once per app launch (React StrictMode mounts effects twice in development). */
export function boot(): Promise<void> {
  booting ??= runBoot();
  return booting;
}

async function runBoot(): Promise<void> {
  const app = useApp.getState();
  await initializeApp();
  const recovered = await recoverOpenSessions();
  const recoveredRooms = await recoverHouseRooms();
  await sweepBankruptPlayers();
  app.setSettings(await getSettings());
  app.setPlayer(null);
  app.reset([await startScreen()]);
  if (recoveredRooms) app.showToast('중단된 방을 정산했습니다. 진행 중이던 베팅은 패배로 기록됩니다.');
  if (recovered) {
    app.showToast(
      recovered.abandonedLoss > 0
        ? `이전 게임이 중단되어 폴드 처리되었습니다 (−${recovered.abandonedLoss.toLocaleString()})`
        : '이전 게임이 정산되었습니다',
    );
  }
}
