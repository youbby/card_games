import Dexie, { type EntityTable } from 'dexie';
import type { Character, HandRecord, Settings, Stats, TableSession } from './types';

export class CardGamesDb extends Dexie {
  characters!: EntityTable<Character, 'id'>;
  sessions!: EntityTable<TableSession, 'id'>;
  hands!: EntityTable<HandRecord, 'id'>;
  stats!: EntityTable<Stats, 'characterId'>;
  settings!: EntityTable<Settings, 'id'>;

  constructor(name = 'card-games') {
    super(name);
    this.version(1).stores({
      characters: 'id, kind, cpuClass, status, name',
      sessions: 'id, playerId, active',
      hands: 'id, playerId, sessionId, [playerId+playedAt]',
      stats: 'characterId',
      settings: 'id',
    });
  }
}

export const db = new CardGamesDb();

export function newId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
