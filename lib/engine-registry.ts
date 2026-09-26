import type { CustomEngineMeta } from './types';

const DB_NAME = 'chess_ai_engines_db';
const STORE_NAME = 'engines';
const DB_VERSION = 1;

export const BUILTIN_STOCKFISH: CustomEngineMeta = {
  id: 'stockfish',
  name: 'Stockfish 17 (Built-in)',
  author: 'Stockfish Developers',
  sizeBytes: 1650000,
  dateAdded: 0,
  isBuiltIn: true,
};

export const BUILTIN_PATRICIA: CustomEngineMeta = {
  id: 'patricia',
  name: 'Patricia 5.1 (Aggressive & Human)',
  author: 'Adam Kulju',
  sizeBytes: 5029036,
  dateAdded: 0,
  isBuiltIn: true,
};

export const BUILTIN_MAIA3: CustomEngineMeta = {
  id: 'maia3',
  name: 'Maia-3 (Chessformer Human Policy)',
  author: 'CSSLab / University of Toronto',
  sizeBytes: 0,
  dateAdded: 0,
  isBuiltIn: true,
};

export const BUILTIN_MAIA2: CustomEngineMeta = {
  id: 'maia2',
  name: 'Maia-2 (Unified Human Model)',
  author: 'CSSLab / University of Toronto',
  sizeBytes: 0,
  dateAdded: 0,
  isBuiltIn: true,
};

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export class EngineRegistry {
  public static async getInstalledEngines(): Promise<CustomEngineMeta[]> {
    try {
      const db = await openDb();
      return new Promise((resolve) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const req = store.getAll();

        req.onsuccess = () => {
          const custom = (req.result || []).map((e: any) => ({
            id: e.id,
            name: e.name,
            author: e.author,
            sizeBytes: e.sizeBytes,
            dateAdded: e.dateAdded,
            isBuiltIn: false,
          }));
          resolve([BUILTIN_STOCKFISH, BUILTIN_PATRICIA, BUILTIN_MAIA3, BUILTIN_MAIA2, ...custom]);
        };

        req.onerror = () => resolve([BUILTIN_STOCKFISH, BUILTIN_PATRICIA, BUILTIN_MAIA3, BUILTIN_MAIA2]);
      });
    } catch (_) {
      return [BUILTIN_STOCKFISH, BUILTIN_PATRICIA, BUILTIN_MAIA3, BUILTIN_MAIA2];
    }
  }

  public static async saveCustomEngine(
    name: string,
    wasmBytes: ArrayBuffer,
    author: string = 'Custom Developer'
  ): Promise<CustomEngineMeta> {
    const db = await openDb();
    const id = `engine_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const meta: CustomEngineMeta = {
      id,
      name,
      author,
      sizeBytes: wasmBytes.byteLength,
      dateAdded: Date.now(),
      isBuiltIn: false,
    };

    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.put({
        ...meta,
        wasmBytes,
      });

      req.onsuccess = () => resolve(meta);
      req.onerror = () => reject(req.error);
    });
  }

  public static async getEngineWasmBytes(id: string): Promise<ArrayBuffer | null> {
    if (id === 'stockfish' || id === 'patricia' || id === 'maia3' || id === 'maia2') return null;

    try {
      const db = await openDb();
      return new Promise((resolve) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const req = store.get(id);

        req.onsuccess = () => {
          if (req.result && req.result.wasmBytes) {
            resolve(req.result.wasmBytes);
          } else {
            resolve(null);
          }
        };

        req.onerror = () => resolve(null);
      });
    } catch (_) {
      return null;
    }
  }

  public static async deleteCustomEngine(id: string): Promise<void> {
    if (id === 'stockfish' || id === 'patricia' || id === 'maia3' || id === 'maia2') return;

    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.delete(id);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }
}
