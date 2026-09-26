import { Chess } from 'chess.js';

export interface OpeningSafetySettings {
  maxLossCp?: number;
  forbidQueenHang?: boolean;
  minEngineDepth?: number;
  maxEngineDisagreementCp?: number;
  allowRiskyOpenings?: boolean;
  allowMemeOpenings?: boolean;
}

const PIECE_VALUES: Record<string, number> = {
  p: 100,
  n: 320,
  b: 330,
  r: 500,
  q: 900,
  k: 0,
};

export function parseUci(uci: string): { from: string; to: string; promotion?: string } {
  return {
    from: uci.slice(0, 2),
    to: uci.slice(2, 4),
    promotion: uci.length > 4 ? uci[4] : undefined,
  };
}

export function isLegalUci(fen: string, uci: string): boolean {
  if (!uci || uci.length < 4) return false;
  try {
    const chess = new Chess(fen);
    const { from, to, promotion } = parseUci(uci);
    const move = chess.move({
      from,
      to,
      promotion,
    } as any);
    return Boolean(move);
  } catch {
    return false;
  }
}

/**
 * Lightweight tactical safety check.
 * Evaluates whether playing `uci` allows the opponent to immediately win material (e.g. queen hang).
 */
export function immediateLossAfterMove(fen: string, uci: string): number {
  try {
    const chess = new Chess(fen);
    const { from, to, promotion } = parseUci(uci);

    const made = chess.move({
      from,
      to,
      promotion,
    } as any);

    if (!made) return Infinity;

    let worstLoss = 0;
    const opponentCaptures = chess
      .moves({ verbose: true })
      .filter((m) => m.captured);

    for (const cap of opponentCaptures) {
      const victimValue = PIECE_VALUES[cap.captured ?? 'p'] ?? 0;
      if (victimValue <= worstLoss) continue;

      chess.move(cap);
      const canRecapture = chess
        .moves({ verbose: true })
        .some((m) => m.to === cap.to && Boolean(m.captured));
      chess.undo();

      const attackerValue = PIECE_VALUES[cap.piece] ?? 0;
      const loss = canRecapture
        ? Math.max(0, victimValue - attackerValue)
        : victimValue;

      if (loss > worstLoss) {
        worstLoss = loss;
      }
    }

    chess.undo();
    return worstLoss;
  } catch {
    return Infinity;
  }
}

export interface BookMoveValidation {
  legal: boolean;
  safe: boolean;
  reason: string;
  loss: number;
}

export function validateBookMove(
  fen: string,
  uci: string,
  safety: OpeningSafetySettings = {}
): BookMoveValidation {
  if (!uci || uci.length < 4) {
    return {
      legal: false,
      safe: false,
      reason: 'bad-uci',
      loss: Infinity,
    };
  }

  if (!isLegalUci(fen, uci)) {
    return {
      legal: false,
      safe: false,
      reason: 'illegal-move',
      loss: Infinity,
    };
  }

  const loss = immediateLossAfterMove(fen, uci);
  const maxLossCp = safety.maxLossCp ?? 250;
  const forbidQueenHang = safety.forbidQueenHang ?? true;

  if (!Number.isFinite(loss)) {
    return {
      legal: true,
      safe: false,
      reason: 'tactical-unknown',
      loss: Infinity,
    };
  }

  if (forbidQueenHang && loss >= 800) {
    return {
      legal: true,
      safe: false,
      reason: 'queen-hang',
      loss,
    };
  }

  if (loss > maxLossCp) {
    return {
      legal: true,
      safe: false,
      reason: 'material-loss',
      loss,
    };
  }

  return {
    legal: true,
    safe: true,
    reason: 'ok',
    loss,
  };
}

const safetyCache = new Map<string, BookMoveValidation>();
const MAX_CACHE_SIZE = 500;

export function validateBookMoveCached(
  fen: string,
  uci: string,
  safety: OpeningSafetySettings = {}
): BookMoveValidation {
  const key = `${fen}|${uci}|${safety.maxLossCp ?? 250}|${safety.forbidQueenHang ?? true}`;
  const cached = safetyCache.get(key);
  if (cached) return cached;

  const result = validateBookMove(fen, uci, safety);
  if (safetyCache.size >= MAX_CACHE_SIZE) {
    const firstKey = safetyCache.keys().next().value;
    if (firstKey) safetyCache.delete(firstKey);
  }
  safetyCache.set(key, result);
  return result;
}

export function clearSafetyCache() {
  safetyCache.clear();
}
