import { normalizeFenForBook } from './index';
import type { BookPositionEntry, OpeningConfig } from './types';

interface PersistedOpeningDecision {
  key: string;
  selectionKey: string;
  positionKey: string;
  openingId: string;
  updatedAt: number;
}

const DB_NAME = 'chess_ai_repertoire_db';
const DB_VERSION = 1;
const STORE_NAME = 'adaptive-opening-decisions';
const MAX_DECISIONS_PER_SELECTION = 48;

let databasePromise: Promise<IDBDatabase | null> | null = null;

function openDatabase(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  if (databasePromise) return databasePromise;

  databasePromise = new Promise((resolve) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const store = request.result.objectStoreNames.contains(STORE_NAME)
        ? request.transaction!.objectStore(STORE_NAME)
        : request.result.createObjectStore(STORE_NAME, { keyPath: 'key' });

      if (!store.indexNames.contains('selectionKey')) {
        store.createIndex('selectionKey', 'selectionKey', { unique: false });
      }
      if (!store.indexNames.contains('updatedAt')) {
        store.createIndex('updatedAt', 'updatedAt', { unique: false });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });

  return databasePromise;
}

function sortEntries(entries: BookPositionEntry[]): BookPositionEntry[] {
  return entries.slice().sort((a, b) => {
    if (a.priority !== b.priority) return b.priority - a.priority;
    if (a.risk !== b.risk) return a.risk - b.risk;
    if (a.ply !== b.ply) return a.ply - b.ply;
    return a.openingId.localeCompare(b.openingId);
  });
}

function preferenceKey(config: OpeningConfig, playerColor: 'w' | 'b'): string {
  const selectedIds = [...new Set(config.selectedOpeningIds ?? [])].sort().join(',') || '*';
  const categories = [...new Set(config.categories ?? [])].sort().join(',') || '*';
  return [
    playerColor,
    selectedIds,
    config.repertoireId ?? 'auto',
    config.whiteRepertoireId ?? 'auto',
    config.blackRepertoireId ?? 'auto',
    categories,
    config.includeMeme ? 'meme' : 'no-meme',
    config.includeWeird ? 'weird' : 'no-weird',
    config.maxRisk ?? 5,
  ].join('|');
}

export class AdaptiveOpeningSelector {
  private activeOpeningId: string | null = null;
  private activeSelectionKey = '';
  private decisions = new Map<string, PersistedOpeningDecision>();

  public rank(
    entries: BookPositionEntry[],
    config: OpeningConfig,
    playerColor: 'w' | 'b'
  ): BookPositionEntry[] {
    const sorted = sortEntries(entries);
    if (config.adaptiveSelection === false) return sorted;

    const selectionKey = preferenceKey(config, playerColor);
    this.ensureSelection(selectionKey);

    const positionKey = sorted[0] ? normalizeFenForBook(sorted[0].fen) : '';
    const cachedOpeningId = positionKey
      ? this.decisions.get(this.decisionKey(selectionKey, positionKey))?.openingId
      : undefined;
    const preferredOpeningId = sorted.some((entry) => entry.openingId === this.activeOpeningId)
      ? this.activeOpeningId
      : cachedOpeningId;

    if (!preferredOpeningId) return sorted;

    return sorted.sort((a, b) => {
      const aPreferred = a.openingId === preferredOpeningId;
      const bPreferred = b.openingId === preferredOpeningId;
      if (aPreferred !== bPreferred) return aPreferred ? -1 : 1;
      return 0;
    });
  }

  public remember(
    entry: BookPositionEntry,
    config: OpeningConfig,
    playerColor: 'w' | 'b'
  ) {
    if (config.adaptiveSelection === false) return;

    const selectionKey = preferenceKey(config, playerColor);
    this.ensureSelection(selectionKey);
    this.activeOpeningId = entry.openingId;

    const positionKey = normalizeFenForBook(entry.fen);
    const key = this.decisionKey(selectionKey, positionKey);
    const current = this.decisions.get(key);
    if (current?.openingId === entry.openingId) return;

    const decision: PersistedOpeningDecision = {
      key,
      selectionKey,
      positionKey,
      openingId: entry.openingId,
      updatedAt: Date.now(),
    };
    this.decisions.set(key, decision);
    void this.persist(decision);
  }

  private ensureSelection(selectionKey: string) {
    if (selectionKey === this.activeSelectionKey) return;
    this.activeSelectionKey = selectionKey;
    this.activeOpeningId = null;
    this.decisions.clear();
    void this.hydrate(selectionKey);
  }

  private async hydrate(selectionKey: string) {
    const database = await openDatabase();
    if (!database) return;

    try {
      await new Promise<void>((resolve) => {
        const transaction = database.transaction(STORE_NAME, 'readonly');
        const index = transaction.objectStore(STORE_NAME).index('selectionKey');
        const request = index.getAll(IDBKeyRange.only(selectionKey));

        request.onsuccess = () => {
          if (selectionKey === this.activeSelectionKey) {
            const decisions = (request.result as PersistedOpeningDecision[])
              .sort((a, b) => b.updatedAt - a.updatedAt)
              .slice(0, MAX_DECISIONS_PER_SELECTION);
            for (const decision of decisions) {
              this.decisions.set(decision.key, decision);
            }
          }
          resolve();
        };
        request.onerror = () => resolve();
      });
    } catch {
      // IndexedDB is an opportunistic cache and must never delay board analysis.
    }
  }

  private async persist(decision: PersistedOpeningDecision) {
    const database = await openDatabase();
    if (!database) return;

    try {
      await new Promise<void>((resolve) => {
        const transaction = database.transaction(STORE_NAME, 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        store.put(decision);
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => resolve();
        transaction.onabort = () => resolve();
      });
    } catch {
      return;
    }

    void this.prune(decision.selectionKey, database);
  }

  private async prune(selectionKey: string, database: IDBDatabase) {
    try {
      await new Promise<void>((resolve) => {
        const transaction = database.transaction(STORE_NAME, 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        const index = store.index('selectionKey');
        const request = index.getAll(IDBKeyRange.only(selectionKey));

        request.onsuccess = () => {
          const stale = (request.result as PersistedOpeningDecision[])
            .sort((a, b) => b.updatedAt - a.updatedAt)
            .slice(MAX_DECISIONS_PER_SELECTION);
          for (const decision of stale) {
            store.delete(decision.key);
          }
        };
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => resolve();
        transaction.onabort = () => resolve();
      });
    } catch {
      // Cache pruning is best effort.
    }
  }

  private decisionKey(selectionKey: string, positionKey: string): string {
    return `${selectionKey}::${positionKey}`;
  }
}
