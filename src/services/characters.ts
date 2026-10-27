import { db, newId } from '../data/db';
import { AVATARS } from '../data/names';
import { type Character, DEFAULT_SETTINGS, type Settings, type Stats } from '../data/types';

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
    sessions: 0,
    playTimeMs: 0,
  };
}

export async function getSettings(): Promise<Settings> {
  return (await db.settings.get('app')) ?? { ...DEFAULT_SETTINGS };
}

export async function updateSettings(patch: Partial<Omit<Settings, 'id'>>): Promise<Settings> {
  const next = { ...(await getSettings()), ...patch, id: 'app' as const };
  await db.settings.put(next);
  return next;
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
