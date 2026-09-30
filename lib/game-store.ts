/**
 * game-store.ts
 *
 * IndexedDB persistence for finished Chess.com games, deep engine reviews,
 * and training bookmarks. Follows AGENTS.md storage conventions: small, typed,
 * versioned, and never blocking the main thread on open.
 */
import type { ReviewResult } from './review-classifier';

export interface StoredGame {
  id: string;                   // content hash of initial FEN + move list
  url?: string;
  startedAt: number;
  endedAt: number;
  playerColor: 'w' | 'b';
  opponentName?: string;
  timeControl?: string;
  result?: 'win' | 'loss' | 'draw' | 'unknown';
  initialFen: string;
  moves: string[];              // SAN sequence
  finalFen: string;
  pgn?: string;
  reviewStatus: 'none' | 'queued' | 'reviewing' | 'reviewed' | 'error';
  review?: ReviewResult;
  reviewEngineId?: string;      // engine used for review (separate from highlight engine)
  reviewDepth?: number;
  trainingNotes?: string;
  starred?: boolean;
  tags?: string[];
}

const DB_NAME = 'chess_overlay_games';
const DB_VERSION = 2;
const GAMES_STORE = 'games';

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB unavailable'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(GAMES_STORE)) {
        const store = db.createObjectStore(GAMES_STORE, { keyPath: 'id' });
        store.createIndex('endedAt', 'endedAt');
        store.createIndex('playerColor', 'playerColor');
        store.createIndex('reviewStatus', 'reviewStatus');
        store.createIndex('starred', 'starred');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T> | Promise<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const transaction = db.transaction(GAMES_STORE, mode);
        const store = transaction.objectStore(GAMES_STORE);
        const result = fn(store) as IDBRequest<T>;
        if (result && 'onsuccess' in result) {
          result.onsuccess = () => resolve(result.result);
          result.onerror = () => reject(result.error);
        } else {
          Promise.resolve(result).then(resolve, reject);
        }
        transaction.onerror = () => reject(transaction.error);
      })
  );
}

export async function putGame(game: StoredGame): Promise<void> {
  await tx('readwrite', (store) => store.put(game));
}

export async function getGame(id: string): Promise<StoredGame | undefined> {
  return tx('readonly', (store) => store.get(id) as IDBRequest<StoredGame | undefined>);
}

export async function deleteGame(id: string): Promise<void> {
  await tx('readwrite', (store) => store.delete(id));
}

export interface GameQuery {
  limit?: number;
  offset?: number;
  playerColor?: 'w' | 'b';
  reviewStatus?: StoredGame['reviewStatus'];
  starredOnly?: boolean;
}

export async function listGames(query: GameQuery = {}): Promise<StoredGame[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(GAMES_STORE, 'readonly');
    const store = transaction.objectStore(GAMES_STORE);
    const index = store.index('endedAt');
    const results: StoredGame[] = [];
    const req = index.openCursor(null, 'prev');
    req.onsuccess = () => {
      const cursor = req.result;
      if (!cursor) {
        resolve(results.slice(query.offset || 0, (query.offset || 0) + (query.limit || 100)));
        return;
      }
      const game = cursor.value as StoredGame;
      if (query.playerColor && game.playerColor !== query.playerColor) {
        cursor.continue();
        return;
      }
      if (query.reviewStatus && game.reviewStatus !== query.reviewStatus) {
        cursor.continue();
        return;
      }
      if (query.starredOnly && !game.starred) {
        cursor.continue();
        return;
      }
      results.push(game);
      cursor.continue();
    };
    req.onerror = () => reject(req.error);
  });
}

export async function countGames(): Promise<number> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(GAMES_STORE, 'readonly');
    const req = tx.objectStore(GAMES_STORE).count();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** Stable content-addressed id so the same finished game isn't stored twice. */
export function gameId(initialFen: string, moves: string[]): string {
  const key = `${initialFen}|${moves.join(' ')}`;
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return 'g_' + (h >>> 0).toString(16);
}
