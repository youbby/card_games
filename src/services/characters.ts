import { db, newId } from '../data/db';
import { AVATARS } from '../data/names';
import { type Character, DEFAULT_SETTINGS, type Settings, type Stats } from '../data/types';
import type { GameId } from '../games/catalog';

export function emptyStats(characterId: string): Stats {
  return {
    characterId,
    handsPlayed: 0,
    handsWon: 0,
    netProfit: 0,
    biggestPotWon: 0,
    biggestLoss: 0,
    showdowns: 0,
    showdownsWon: 0,
    vpipCount: 0,
    pfrCount: 0,
    byClass: {},
    byStake: {},
    bySeatCount: {},
    byGame: {},
    sessions: 0,
    playTimeMs: 0,
  };
}

export async function getSettings(): Promise<Settings> {
  const saved = await db.settings.get('app');
  return { ...DEFAULT_SETTINGS, ...saved, profitLimits: { ...DEFAULT_SETTINGS.profitLimits, ...saved?.profitLimits } };
}

export async function updateSettings(patch: Partial<Omit<Settings, 'id'>>): Promise<Settings> {
  const next = { ...(await getSettings()), ...patch, id: 'app' as const };
  if (Object.values(next.profitLimits).some((value) => value !== null && (!Number.isInteger(value) || value < 1 || value > 100))) {
    throw new Error('수익 한도는 1~100배 또는 제한 없음으로 설정하세요.');
  }
  await db.settings.put(next);
  return next;
}

export async function updateProfitLimit(gameId: GameId, multiplier: number | null): Promise<Settings> {
  return db.transaction('rw', db.settings, async () => {
    const settings = await getSettings();
    return updateSettings({ profitLimits: { ...settings.profitLimits, [gameId]: multiplier } });
  });
}

export async function listPlayers(): Promise<Character[]> {
  const players = await db.characters.where('kind').equals('PLAYER').toArray();
  return players.sort((a, b) => b.lastPlayedAt - a.lastPlayedAt);
}

/** Names must be unique among active characters (players and CPUs). */
export async function isNameTaken(name: string): Promise<boolean> {
  const same = await db.characters.where('name').equals(name.trim()).toArray();
  return same.some((c) => c.status === 'ACTIVE');
}

export const NAME_MAX_LENGTH = 12;

export async function createPlayer(name: string, avatar: string = AVATARS[0]): Promise<Character> {
  const trimmed = name.trim();
  if (!trimmed) throw new Error('이름을 입력하세요.');
  if (trimmed.length > NAME_MAX_LENGTH) throw new Error(`이름은 ${NAME_MAX_LENGTH}자 이하로 입력하세요.`);
  if (await isNameTaken(trimmed)) throw new Error('이미 사용 중인 이름입니다.');

  const { startingChips } = await getSettings();
  const now = Date.now();
  const character: Character = {
    id: newId(),
    kind: 'PLAYER',
    name: trimmed,
    avatar,
    balance: startingChips,
    status: 'ACTIVE',
    createdAt: now,
    lastPlayedAt: now,
    peakBalance: startingChips,
  };
  await db.transaction('rw', db.characters, db.stats, async () => {
    await db.characters.add(character);
    await db.stats.add(emptyStats(character.id));
  });
  return character;
}

export async function deletePlayer(id: string): Promise<void> {
  await db.transaction('rw', [db.characters, db.stats, db.hands, db.sessions], async () => {
    await db.characters.delete(id);
    await db.stats.delete(id);
    await db.hands.where('playerId').equals(id).delete();
    await db.sessions.where('playerId').equals(id).delete();
  });
}

export async function getCharacter(id: string): Promise<Character | undefined> {
  return db.characters.get(id);
}

export async function getStats(id: string): Promise<Stats> {
  return (await db.stats.get(id)) ?? emptyStats(id);
}
