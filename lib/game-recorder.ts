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
  private manualMode = false; // when true, only stop() saves (auto game-over still saves for safety)
  private playerColor: 'w' | 'b' = 'w';
  private url = '';
  private moves: string[] = [];
  private lastSeenFen = '';
  private pendingSave: Promise<void> | null = null;

  constructor() {
    this.url = typeof location !== 'undefined' ? location.href : '';
  }

  /** Start recording. If moves are already on the board (e.g. attaching mid-game),
   *  we snapshot the existing move list so we don't start from empty. */
  start(boardEl?: HTMLElement, initialMoves?: string[]) {
    this.initialFen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
    this.startedAt = Date.now();
    this.gameActive = true;
    this.manualMode = false;
    this.moves = Array.isArray(initialMoves) ? initialMoves.slice() : [];
    this.lastSeenFen = '';
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

  /** Explicit user-controlled start (Record button). */
  startManual(boardEl?: HTMLElement, initialMoves?: string[]) {
    this.start(boardEl, initialMoves);
    this.manualMode = true;
  }

  /** Explicit user-controlled stop — saves whatever we have right now. */
  async stop(boardEl?: HTMLElement | null, overrideMoves?: string[], overrideFen?: string) {
    if (!this.gameActive) return undefined;
    const moves = overrideMoves && overrideMoves.length >= 2 ? overrideMoves : this.moves;
    const fen = overrideFen || this.lastSeenFen;
    return this.onGameOver(boardEl || null, moves, fen);
  }

  /** Accept the canonical move list each tick so the recorder is in sync with
   *  what the overlay sees (same detection path as highlights). */
  observe(moveHistory: string[], fen: string) {
    if (!this.gameActive) return;
    if (!moveHistory) return;
    if (moveHistory.length >= this.moves.length) {
      this.moves = moveHistory.slice();
    }
    if (fen) this.lastSeenFen = fen;
  }

  isManual() { return this.manualMode; }

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
  async onGameOver(boardEl: HTMLElement | null, moveHistory?: string[] | null, fen?: string | null, forcedResult?: StoredGame['result']): Promise<StoredGame | undefined> {
    if (!this.gameActive) return;
    const moves = (moveHistory && moveHistory.length >= this.moves.length) ? moveHistory.slice() : this.moves.slice();
    if (!moves || moves.length < 2) {
      this.gameActive = false;
      return;
    }

    const id = gameId(this.initialFen, moves);
    if (id === this.lastSavedKey) return;
    this.lastSavedKey = id;
    this.gameActive = false;

    const chess = new Chess();
    let replayOk = true;
    for (const san of moves) {
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
      moves: moves.slice(),
      finalFen: replayOk ? chess.fen() : (fen || this.lastSeenFen),
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
   *  by a new game, to avoid losing the previous one). In manual mode we do
   *  NOT auto-save on board replacement — the user will hit Stop. */
  async flush(boardEl: HTMLElement | null, moveHistory?: string[], fen?: string) {
    if (this.manualMode) return;
    const moves = (moveHistory && moveHistory.length >= this.moves.length) ? moveHistory : this.moves;
    if (this.gameActive && moves && moves.length >= 2) {
      return this.onGameOver(boardEl, moves, fen);
    }
    this.gameActive = false;
  }

  isActive() { return this.gameActive; }
  getPlayerColor() { return this.playerColor; }
}
