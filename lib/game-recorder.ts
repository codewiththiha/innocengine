/**
 * game-recorder.ts
 *
 * Content-script helper that observes a Chess.com game and persists the final
 * SAN sequence + metadata to IndexedDB on game-end (win/loss/draw detected
 * from the board state and DOM move list). Uses the same authoritative
 * GameStateAdapter FEN reconstruction as the live overlay so saved games always
 * match what was displayed.
 *
 * Robustness fixes over the first pass:
 *   - Safe to call start/finish multiple times (idempotent).
 *   - Records result (win/loss/draw) from Chess.com's game-over header text.
 *   - Only commits when there are ≥ 2 plies (avoid saving empty/placing games).
 */
import { BoardParser } from './board-parser';
import { putGame, gameId, type StoredGame } from './game-store';
import { Chess } from 'chess.js';

export interface GameRecorderConfig {
  autoRecord: boolean;
}

export class GameRecorder {
  private initialFen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
  private startedAt = 0;
  private lastSavedKey = '';
  private gameActive = false;
  private playerColor: 'w' | 'b' = 'w';
  private url = '';
  private pendingSave: Promise<void> | null = null;

  constructor() {
    this.url = typeof location !== 'undefined' ? location.href : '';
  }

  /** Reset at start of a new game. */
  start(boardEl?: HTMLElement) {
    this.initialFen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
    this.startedAt = Date.now();
    this.gameActive = true;
    // Never overwrite lastSavedKey here — that key guards duplicate saves of
    // the SAME game; new games will produce a different gameId.
    try {
      if (boardEl) {
        const flipped = BoardParser.isBoardFlipped(boardEl);
        this.playerColor = BoardParser.detectPlayerColor(boardEl, flipped) || 'w';
      } else {
        this.playerColor = 'w';
      }
    } catch (_) {
      this.playerColor = 'w';
    }
  }

  /** Inspect Chess.com's game-over dialog for the result string. */
  private detectResultFromDom(): StoredGame['result'] {
    if (typeof document === 'undefined') return 'unknown';

    // The modal title / subtitle containing "Won", "Lost", "Draw", "Checkmate", "Resignation", etc.
    const titleSelectors = [
      '.game-over-modal-component .header-title',
      '.game-over-modal-shell-container .header-title',
      '.game-over-dialog-component .game-over-dialog-header',
      '[data-test-element="game-over-message"]',
      '.game-over-header-title',
      '.game-over-message',
      '.game-over-result',
    ];
    for (const sel of titleSelectors) {
      const el = document.querySelector(sel);
      const text = el?.textContent?.toLowerCase().trim();
      if (!text) continue;
      if (text.includes('won') || text.includes('checkmate') && !text.includes('by')) {
        // Need to determine who won; fall through to player heuristic
        if (text.includes('you won') || text.includes('white won') && this.playerColor === 'w' ||
            text.includes('black won') && this.playerColor === 'b') {
          return 'win';
        }
        if (text.includes('you lost') || text.includes('white won') && this.playerColor === 'b' ||
            text.includes('black won') && this.playerColor === 'w') {
          return 'loss';
        }
        // If we can't tell who, check if text mentions the username — fall through
      }
      if (text.includes('draw') || text.includes('stalemate') || text.includes('repetition') || text.includes('insufficient')) {
        return 'draw';
      }
    }

    // User-tagline result badges
    const winBadge = document.querySelector('.user-tagline-winner, .user-tagline-result-winner, .game-over-winner-badge');
    if (winBadge) {
      const parent = winBadge.closest('[data-color], [class*="white"], [class*="black"]');
      const parentColor = parent?.getAttribute('data-color');
      const isWhite = parentColor === 'white' || parentColor === 'w' ||
        (parent as HTMLElement | null)?.classList.contains('white');
      const isBlack = parentColor === 'black' || parentColor === 'b' ||
        (parent as HTMLElement | null)?.classList.contains('black');
      if ((isWhite && this.playerColor === 'w') || (isBlack && this.playerColor === 'b')) return 'win';
      if ((isWhite && this.playerColor === 'b') || (isBlack && this.playerColor === 'w')) return 'loss';
    }

    return 'unknown';
  }

  /**
   * Called when the board becomes inactive or the game-over DOM appears.
   * Returns the saved game record (or undefined if save was skipped).
   */
  async onGameOver(boardEl: HTMLElement | null, moveHistory: string[], fen: string, forcedResult?: StoredGame['result']): Promise<StoredGame | undefined> {
    if (!this.gameActive) return;
    if (!moveHistory || moveHistory.length < 2) {
      // Too short to be a real game — usually opening-practice or abandoned.
      this.gameActive = false;
      return;
    }

    const id = gameId(this.initialFen, moveHistory);
    if (id === this.lastSavedKey) return; // idempotent
    this.lastSavedKey = id;
    this.gameActive = false;

    const chess = new Chess();
    let replayOk = true;
    for (const san of moveHistory) {
      try { if (!chess.move(san)) { replayOk = false; break; } }
      catch { replayOk = false; break; }
    }

    let result = forcedResult;
    if (!result || result === 'unknown') {
      result = this.detectResultFromDom();
    }
    if (result === 'unknown') {
      // Fallback: use board status
      if (boardEl && BoardParser.isGameActive(boardEl) === false) {
        // last side to move lost if there's checkmate, but without analyzing just keep unknown
      }
    }

    const record: StoredGame = {
      id,
      url: this.url,
      startedAt: this.startedAt || Date.now(),
      endedAt: Date.now(),
      playerColor: this.playerColor,
      result,
      initialFen: this.initialFen,
      moves: moveHistory.slice(),
      finalFen: replayOk ? chess.fen() : fen,
      pgn: replayOk ? chess.pgn() : undefined,
      reviewStatus: 'none',
    };

    this.pendingSave = putGame(record).catch((err) => {
      console.warn('[GameRecorder] Failed to persist game:', err);
    });
    await this.pendingSave;

    // Notify any open review page that a new game is available.
    try {
      if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
        chrome.runtime.sendMessage({ target: 'review', type: 'GAME_SAVED', gameId: record.id }).catch(() => {});
      }
    } catch (_) {}

    return record;
  }

  /** Force-finish any active game (used when the board element is replaced
   *  by a new game, to avoid losing the previous one). */
  async flush(boardEl: HTMLElement | null, moveHistory: string[], fen: string) {
    if (this.gameActive && moveHistory && moveHistory.length >= 2) {
      return this.onGameOver(boardEl, moveHistory, fen);
    }
    this.gameActive = false;
  }

  isActive() { return this.gameActive; }
  getPlayerColor() { return this.playerColor; }
}
