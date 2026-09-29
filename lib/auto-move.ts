import type { AutoMoveMode, AutoMoveSettings, BoardState, EngineCandidate } from './types';
import { HumanMovePlanner } from './maia-policy';

export interface AutoMoveStatus {
  enabled: boolean;
  mode: AutoMoveMode;
  playedMoves: number;
  maxMoves: number;
  /** Milliseconds this position was given, and what decided it. */
  thinkMs: number;
  reason: string;
  lastSan: string | null;
  /** Set when auto-move stopped itself and needs a reset. */
  halted: string | null;
}

export interface AutoMoveHandlers {
  playMove(candidate: EngineCandidate, state: BoardState): boolean;
  onStatus(status: AutoMoveStatus): void;
}

/** A rejected move is retried once, then auto-move gives up on that position. */
const MAX_ATTEMPTS = 2;
/** Ignore candidates this long after a move, while the board catches up. */
const LOCKOUT_MS = 1200;
/** How long the board gets to register a played move before we give up. */
const VERIFY_MS = 2500;

/**
 * Plays committed engine candidates on the live board.
 *
 * One move per board position: the plan is created when the position first
 * appears, the move fires once its think time has passed *and* the engine has
 * committed a candidate, and a short lockout after playing stops the controller
 * from reacting to its own move before the board has repainted. Nothing here
 * tries to look automated or undetectable; it performs the same input a person
 * would and stops itself when the board refuses a move.
 */
export class AutoMoveController {
  private settings: AutoMoveSettings;
  private readonly handlers: AutoMoveHandlers;
  private readonly planner = new HumanMovePlanner();
  private state: BoardState | null = null;
  private planKey = '';
  private timer: ReturnType<typeof setTimeout> | null = null;
  private verifyTimer: ReturnType<typeof setTimeout> | null = null;
  private playedKey = '';
  private pendingCandidate: EngineCandidate | null = null;
  private attempts = 0;
  private playedMoves = 0;
  private lastSan: string | null = null;
  private halted: string | null = null;
  private lockUntil = 0;

  constructor(settings: AutoMoveSettings, handlers: AutoMoveHandlers) {
    this.settings = settings;
    this.handlers = handlers;
  }

  public updateSettings(settings: AutoMoveSettings): void {
    const timingChanged =
      settings.mode !== this.settings.mode ||
      settings.minThinkMs !== this.settings.minThinkMs ||
      settings.maxThinkMs !== this.settings.maxThinkMs ||
      settings.delayMs !== this.settings.delayMs;
    this.settings = settings;

    if (!settings.enabled) {
      this.clearTimer();
      this.clearVerifyTimer();
      this.planner.clear();
      this.planKey = '';
      this.halted = null;
      this.emit();
      return;
    }
    // Any halt other than the move limit clears when auto-move is re-enabled.
    if (this.halted !== null && this.halted !== 'Move limit reached') {
      this.halted = null;
    }
    if (this.halted === 'Move limit reached' && (settings.maxMoves === 0 || this.playedMoves < settings.maxMoves)) {
      this.halted = null;
    }
    // The pending plan was built from the old numbers, so it is rebuilt.
    if (timingChanged) this.planKey = '';
    this.schedule();
    this.emit();
  }

  /** Call on every board change, before candidates are considered. */
  public onPosition(state: BoardState, now: number): void {
    const previousKey = this.state?.positionKey ?? '';
    this.state = state;
    if (state.positionKey === previousKey) return;

    this.attempts = 0;
    this.pendingCandidate = null;
    this.clearTimer();
    if (this.planKey !== state.positionKey) this.planKey = '';

    if (!this.settings.enabled || this.halted !== null) {
      this.emit();
      return;
    }
    if (this.settings.maxMoves > 0 && this.playedMoves >= this.settings.maxMoves) {
      this.halted = 'Move limit reached';
      this.emit();
      return;
    }
    if (!this.isOurTurn(state) || (this.settings.pauseWhenHidden && document.hidden)) {
      this.emit();
      return;
    }

    this.planFor(state, now);
    this.emit();
  }

  /** Call whenever a committed candidate set arrives for the current position. */
  public onCandidates(state: BoardState, candidates: EngineCandidate[], now: number): void {
    this.state = state;
    if (!this.settings.enabled || this.halted !== null) return;
    if (this.planKey !== state.positionKey) {
      this.planFor(state, now);
    }
    if (this.pendingCandidate !== null) return;
    if (!this.isOurTurn(state)) return;

    const candidate = this.pickCandidate(candidates, state);
    if (!candidate) return;
    this.pendingCandidate = candidate;
    this.schedule();
  }

  /**
   * Prefers the engine's own top move. A candidate with no depth and no book
   * provenance is a search that has not reported anything yet, so it is left
   * for the next evaluation rather than played on a guess.
   */
  private pickCandidate(candidates: EngineCandidate[], state: BoardState): EngineCandidate | null {
    for (const candidate of candidates) {
      if (!candidate.from || !candidate.to) continue;
      const piece = state.pieceMap?.get(candidate.from);
      if (!piece) continue;
      const isWhitePiece = piece === piece.toUpperCase();
      if (isWhitePiece !== (state.turn === 'w')) continue;
      if (!candidate.isBookMove && candidate.depth <= 0) continue;
      return candidate;
    }
    return null;
  }

  public isOurTurn(state: BoardState): boolean {
    const target =
      this.settings.playFor === 'auto'
        ? state.controlledColor === 'auto'
          ? state.playerColor
          : state.controlledColor
        : this.settings.playFor;
    return state.turn === target;
  }

  private planFor(state: BoardState, now: number): void {
    this.planner.planFor(state.positionKey, state.fen, this.settings, now, null);
    this.planKey = state.positionKey;
  }

  private schedule(): void {
    this.clearTimer();
    const state = this.state;
    if (!this.settings.enabled || this.halted !== null || !state) return;
    if (!this.pendingCandidate || this.planKey !== state.positionKey) return;

    const remaining = Math.max(0, this.planner.readyAtMs - Date.now());
    if (remaining > 0) {
      this.timer = setTimeout(() => {
        this.timer = null;
        this.attempt();
      }, remaining);
      this.emit();
      return;
    }
    this.attempt();
  }

  private attempt(): void {
    const state = this.state;
    const candidate = this.pendingCandidate;
    if (!state || !candidate) return;
    if (!this.settings.enabled || this.halted !== null) return;
    if (this.planKey !== state.positionKey) return;
    if (Date.now() < this.lockUntil) {
      this.schedule();
      return;
    }
    if (this.settings.maxMoves > 0 && this.playedMoves >= this.settings.maxMoves) {
      this.halted = 'Move limit reached';
      this.emit();
      return;
    }
    if (this.settings.pauseWhenHidden && document.hidden) {
      document.addEventListener('visibilitychange', this.onVisibility, { once: true });
      return;
    }

    this.attempts += 1;
    const accepted = this.handlers.playMove(candidate, state);
    if (accepted) {
      this.playedMoves += 1;
      this.lastSan = candidate.pv[0] ?? `${candidate.from}${candidate.to}`;
      this.pendingCandidate = null;
      this.lockUntil = Date.now() + LOCKOUT_MS;
      this.playedKey = state.positionKey;
      this.scheduleVerification();
    } else if (this.attempts >= MAX_ATTEMPTS) {
      this.halted = 'Board refused the move';
      this.pendingCandidate = null;
    }
    this.emit();
  }

  /**
   * A synthetic move that the board ignores leaves no trace, so the position
   * key is the only evidence that it landed. Silence means stop rather than
   * silently pretending to play.
   */
  private scheduleVerification(): void {
    if (this.verifyTimer) clearTimeout(this.verifyTimer);
    this.verifyTimer = setTimeout(() => {
      this.verifyTimer = null;
      if (this.halted !== null || !this.settings.enabled) return;
      if (document.hidden) return;
      if (this.state && this.state.positionKey === this.playedKey) {
        this.halted = 'The board did not register the move';
        this.emit();
      }
    }, VERIFY_MS);
  }

  private onVisibility = (): void => {
    if (!document.hidden) this.schedule();
  };

  public resetPlayedCount(): void {
    this.playedMoves = 0;
    if (this.halted === 'Move limit reached') this.halted = null;
    this.emit();
  }

  public get status(): AutoMoveStatus {
    return {
      enabled: this.settings.enabled,
      mode: this.settings.mode,
      playedMoves: this.playedMoves,
      maxMoves: this.settings.maxMoves,
      thinkMs: this.planner.thinkMs,
      reason: this.planner.lastReason ?? 'idle',
      lastSan: this.lastSan,
      halted: this.halted,
    };
  }

  private emit(): void {
    this.handlers.onStatus(this.status);
  }

  private clearTimer(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private clearVerifyTimer(): void {
    if (this.verifyTimer) {
      clearTimeout(this.verifyTimer);
      this.verifyTimer = null;
    }
  }

  public destroy(): void {
    this.clearTimer();
    this.clearVerifyTimer();
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.planner.clear();
    this.pendingCandidate = null;
    this.state = null;
  }
}
