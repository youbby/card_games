import Dexie, { type EntityTable } from 'dexie';
import type { Character, HandRecord, Settings, Stats, TableSession } from './types';
import type { HouseRoom } from '../games/house/types';

export class CardGamesDb extends Dexie {
  characters!: EntityTable<Character, 'id'>;
  sessions!: EntityTable<TableSession, 'id'>;
  hands!: EntityTable<HandRecord, 'id'>;
  stats!: EntityTable<Stats, 'characterId'>;
  settings!: EntityTable<Settings, 'id'>;
  rooms!: EntityTable<HouseRoom, 'id'>;

  constructor(name = 'card-games') {
    super(name);
    this.version(1).stores({
      characters: 'id, kind, cpuClass, status, name',
      sessions: 'id, playerId, active',
      hands: 'id, playerId, sessionId, [playerId+playedAt]',
      stats: 'characterId',
      settings: 'id',
    });
    this.version(2).stores({ rooms: 'id, playerId, active, gameId' }).upgrade(async (tx) => {
      await tx.table('stats').toCollection().modify((stats: Stats) => {
        stats.byGame ??= { holdem: { hands: stats.handsPlayed, net: stats.netProfit } };
      });
    });
  }
}

export const db = new CardGamesDb();

export function newId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
