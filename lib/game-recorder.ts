/**
 * game-recorder.ts
 *
 * Content-script helper that observes a Chess.com game and persists the final
 * SAN sequence + metadata to IndexedDB on game-end (win/loss/draw detected
 * from the board state and DOM move list). Uses the same authoritative
 * GameStateAdapter FEN reconstruction as the live overlay so saved games always
 * match what was displayed.
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
    this.lastSavedKey = '';
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

  /** Called when the board becomes inactive or a game-over state is detected. */
  async onGameOver(boardEl: HTMLElement, moveHistory: string[], fen: string, result?: StoredGame['result']) {
    if (!this.gameActive) return;
    this.gameActive = false;
    if (!moveHistory || moveHistory.length === 0) return;

    const id = gameId(this.initialFen, moveHistory);
    if (id === this.lastSavedKey) return; // dedupe
    this.lastSavedKey = id;

    const chess = new Chess();
    let replayOk = true;
    for (const san of moveHistory) {
      try { if (!chess.move(san)) { replayOk = false; break; } }
      catch { replayOk = false; break; }
    }

    const record: StoredGame = {
      id,
      url: this.url,
      startedAt: this.startedAt || Date.now(),
      endedAt: Date.now(),
      playerColor: this.playerColor,
      result: result || 'unknown',
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
    return record;
  }

  isActive() { return this.gameActive; }
  getPlayerColor() { return this.playerColor; }
}
