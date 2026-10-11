import type { EngineCandidate, EngineEvaluation, EngineSettings, BoardState } from './types';
import { OpeningBook } from './opening-book';
import { validateBookMoveCached } from './opening-safety';
import { OPENING_CATALOG } from './openings/catalog';
import { OpeningIndex } from './openings/index';
import { resolveSafeOpeningEntry } from './openings/resolver';
import { AdaptiveOpeningSelector } from './openings/adaptive-selector';

export const globalOpeningIndex = new OpeningIndex(OPENING_CATALOG);

export interface RenderSnapshot {
  candidates: EngineCandidate[];
  isCommitted: boolean;
  depth: number;
}

export type HighlightRenderCallback = (snapshot: RenderSnapshot) => void;

export class HighlightController {
  private currentBoardState: BoardState | null = null;
  private settings: EngineSettings;
  private latestEngineSnapshot: EngineEvaluation | null = null;
  private committedCandidates: EngineCandidate[] = [];
  private pendingCandidates: EngineCandidate[] = [];
  private pendingDepth: number = 0;
  private candidatePendingSince: number = 0;
  private pendingCandidateKey: string = '';
  private stabilityTimer: ReturnType<typeof setTimeout> | null = null;
  private renderCallback: HighlightRenderCallback;
  private activePositionKey: string = '';
  private readonly openingSelector = new AdaptiveOpeningSelector();

  // Tighter stability window because modern engines stream progressive
  // iterative-deepening info. 60ms is ~3 animation frames — enough to absorb
  // PV flips at depth 1-2, short enough that highlights feel instant.
  private readonly STABILITY_WINDOW_MS = 60;

  constructor(settings: EngineSettings, renderCallback: HighlightRenderCallback) {
    this.settings = settings;
    this.renderCallback = renderCallback;
  }

  public updateSettings(settings: EngineSettings) {
    this.settings = settings;
    if (this.currentBoardState && this.settings.opening.enabled && this.isWithinBookDepth(this.currentBoardState.fen)) {
      const bookCandidate = this.getValidatedBookCandidate();
      if (bookCandidate && !this.latestEngineSnapshot) {
        this.committedCandidates = this.shouldShowForTurn() ? [bookCandidate] : [];
        this.broadcastCurrentState();
        return;
      }
    }

    if (this.latestEngineSnapshot) {
      this.handleEvaluation(this.latestEngineSnapshot);
    } else {
      this.broadcastCurrentState();
    }
  }

  public setBoardState(boardState: BoardState | null) {
    if (!boardState || boardState.isGameActive === false) {
      this.currentBoardState = boardState;
      this.clear();
      return;
    }

    const positionChanged = this.activePositionKey !== boardState.positionKey;
    this.currentBoardState = boardState;

    if (positionChanged) {
      this.activePositionKey = boardState.positionKey;
      this.clearPendingTimer();
      this.latestEngineSnapshot = null;
      this.pendingCandidateKey = '';
      this.pendingCandidates = [];
      this.pendingDepth = 0;

      // Immediately display opening repertoire move if available and validated safe
      if (this.settings.opening.enabled && this.isWithinBookDepth(boardState.fen)) {
        const bookCandidate = this.getValidatedBookCandidate();
        if (bookCandidate) {
          this.committedCandidates = this.shouldShowForTurn() ? [bookCandidate] : [];
          this.broadcastCurrentState();
          return;
        }
      }

      this.committedCandidates = [];
      this.broadcastCurrentState();
    }
  }

  public handleEvaluation(evaluation: EngineEvaluation) {
    if (!this.shouldShowForTurn()) {
      this.clearPendingTimer();
      this.committedCandidates = [];
      this.broadcastCurrentState();
      return;
    }

    if (evaluation.positionKey !== this.activePositionKey) return;

    this.latestEngineSnapshot = evaluation;

    const validCandidates = this.validateCandidates(evaluation.candidates);
    if (validCandidates.length === 0) return;

    const displayCandidates = this.applyOpeningBook(validCandidates);
    if (displayCandidates.length === 0) return;

    // If calculation completed (bestmove arrived or maia evaluated), commit atomically
    if (!evaluation.isCalculating) {
      this.clearPendingTimer();
      this.committedCandidates = displayCandidates;
      this.pendingCandidates = displayCandidates;
      this.pendingDepth = evaluation.depth;
      this.renderCallback({
        candidates: displayCandidates,
        isCommitted: true,
        depth: evaluation.depth,
      });
      return;
    }

    // Filter out premature 1-ply blunders (depth < 4) during initial alpha-beta expansion.
    // Note: Maia models operate via 1-node policy without alpha-beta search.
    // Low-Elo GwayMaeGyi operates at intentional novice depths (depth 3 for 500-700 Elo) and is also exempt.
    const primaryCandidate = displayCandidates[0];
    const isLowDepthEngine =
      evaluation.engineInstanceId?.startsWith('maia') ||
      evaluation.engineInstanceId === 'gwaymaegyi';
    if (evaluation.depth < 4 && !primaryCandidate?.isBookMove && !isLowDepthEngine) {
      return;
    }

    if (!primaryCandidate) return;

    const primaryMoveKey = `${primaryCandidate.from}-${primaryCandidate.to}`;
    const now = Date.now();

    // If no candidates are rendered yet (e.g. freshly opened position), render immediately
    // so the user does not experience an artificial 180ms delay
    if (this.committedCandidates.length === 0) {
      this.pendingCandidateKey = primaryMoveKey;
      this.candidatePendingSince = now;
      this.pendingCandidates = displayCandidates;
      this.pendingDepth = evaluation.depth;
      this.committedCandidates = displayCandidates;
      this.renderCallback({
        candidates: displayCandidates,
        isCommitted: false,
        depth: evaluation.depth,
      });
      return;
    }

    if (primaryMoveKey !== this.pendingCandidateKey) {
      // Top move has changed: start the stability window to prevent jitter
      this.pendingCandidateKey = primaryMoveKey;
      this.candidatePendingSince = now;
      this.pendingCandidates = displayCandidates;
      this.pendingDepth = evaluation.depth;

      this.clearPendingTimer();
      this.stabilityTimer = setTimeout(() => {
        if (this.pendingCandidateKey === primaryMoveKey && this.pendingCandidates.length > 0) {
          this.committedCandidates = this.pendingCandidates;
          this.renderCallback({
            candidates: this.pendingCandidates,
            isCommitted: false,
            depth: this.pendingDepth,
          });
        }
      }, this.STABILITY_WINDOW_MS);
    } else {
      // Primary move is stable: keep pending batch updated with incoming multipv lines
      this.pendingCandidates = displayCandidates;
      this.pendingDepth = evaluation.depth;

      const windowElapsed = now - this.candidatePendingSince >= this.STABILITY_WINDOW_MS;
      const newLinesAvailable = displayCandidates.length > this.committedCandidates.length;

      // Commit immediately if stability window elapsed or additional MultiPV lines arrived
      if (windowElapsed || newLinesAvailable) {
        this.committedCandidates = displayCandidates;
        this.renderCallback({
          candidates: displayCandidates,
          isCommitted: false,
          depth: evaluation.depth,
        });
      }
    }
  }

  private shouldShowForTurn(): boolean {
    if (!this.currentBoardState) return true;
    if (this.currentBoardState.isGameActive === false) return false;

    const turn = this.currentBoardState.turn;
    const playerColor = this.settings.controlledColor === 'auto'
      ? (this.currentBoardState.playerColor || (this.currentBoardState.isFlipped ? 'b' : 'w'))
      : this.settings.controlledColor;
    const isPlayerTurn = turn === playerColor;

    if (isPlayerTurn) {
      return this.settings.highlightPlayerMoves ?? this.settings.showHighlights ?? true;
    } else {
      return this.settings.highlightOpponentMoves ?? false;
    }
  }

  private isWithinBookDepth(fen: string): boolean {
    try {
      const tokens = fen.trim().split(/\s+/);
      const fullmove = parseInt(tokens[5] || '1', 10);
      const isBlack = tokens[1] === 'b';
      const plies = (fullmove - 1) * 2 + (isBlack ? 1 : 0);
      const maxPlies = this.settings.opening.maxPlies ?? 12;
      return plies <= maxPlies;
    } catch (_) {
      return true;
    }
  }

  private validateCandidates(candidates: EngineCandidate[]): EngineCandidate[] {
    const currentBoard = this.currentBoardState;
    const pieceMap = currentBoard?.pieceMap;
    const turn = currentBoard?.turn;

    return candidates
      .filter((cand) => {
        if (!cand || !cand.from || cand.from.length !== 2) return false;

        // Authoritative Board Defense:
        // Ensure the candidate piece's source square actually exists on the board
        // and matches the current player's color. This permanently prevents delayed or
        // out-of-sync engine evaluations from highlighting pieces that have already moved.
        if (pieceMap && pieceMap.size > 0 && turn) {
          const piece = pieceMap.get(cand.from);
          if (!piece) {
            // Source square is vacant; the piece has already moved!
            return false;
          }
          const isWhitePiece = piece === piece.toUpperCase();
          const isExpectedWhite = turn === 'w';
          if (isWhitePiece !== isExpectedWhite) {
            // Square holds an opponent piece; invalid move for current turn!
            return false;
          }
        }

        return true;
      })
      .map((cand) => ({
        ...cand,
        continuation: this.settings.showOpponentMoves ? cand.continuation : undefined,
      }));
  }

  private getValidatedBookCandidate(
    engineCandidates: EngineCandidate[] = [],
    allowEngineDisagreement: boolean = false
  ): EngineCandidate | null {
    if (!this.currentBoardState || this.currentBoardState.isGameActive === false) return null;
    const openingSettings = this.settings.opening;
    if (!openingSettings?.enabled) return null;
    if (!this.isWithinBookDepth(this.currentBoardState.fen)) return null;

    // Strict Player-Turn Gating: Book recommendations are exclusively for the active player's turn!
    // Never highlight book moves when it is the opponent's turn to move.
    const turn = this.currentBoardState.turn;
    const playerColor = this.settings.controlledColor === 'auto'
      ? (this.currentBoardState.playerColor || (this.currentBoardState.isFlipped ? 'b' : 'w'))
      : this.settings.controlledColor;

    if (turn !== playerColor) {
      return null;
    }

    // Repertoire check: If specific repertoire is configured, its side must match playerColor
    if (openingSettings.repertoireId && openingSettings.repertoireId !== 'auto') {
      const meta = OpeningBook.getMeta(openingSettings.repertoireId);
      if (meta && meta.side !== playerColor) {
        return null;
      }
    }

    // 1. Try PGN-indexed catalog resolver first with player color awareness
    const resolved = resolveSafeOpeningEntry(
      globalOpeningIndex,
      this.currentBoardState.fen,
      this.settings,
      engineCandidates,
      this.currentBoardState.playerColor,
      { allowEngineDisagreement, selector: this.openingSelector }
    );

    if (resolved) {
      return {
        pvId: 0,
        from: resolved.uci.substring(0, 2),
        to: resolved.uci.substring(2, 4),
        promotion: resolved.uci.length > 4 ? resolved.uci.substring(4, 5) : undefined,
        depth: 0,
        scoreCp: null,
        scoreMate: null,
        pv: [resolved.uci],
        isBookMove: true,
        bookName: resolved.openingName,
      };
    }

    // Exact catalog matching is the default adaptive behavior. Keep the legacy
    // system repertoire only for users who explicitly turn adaptive matching off.
    if (openingSettings.adaptiveSelection !== false) return null;

    // Legacy fallback to OpeningBook.lookupMove with tactical safety validation.
    const bookEntry = OpeningBook.lookupMove(
      this.currentBoardState.positionKey,
      openingSettings.repertoireId,
      this.currentBoardState.fen
    );

    if (!bookEntry?.move || bookEntry.move.length < 4) return null;

    const validation = validateBookMoveCached(
      this.currentBoardState.fen,
      bookEntry.move,
      openingSettings.safety
    );

    if (!validation.legal || !validation.safe) return null;

    return {
      pvId: 0,
      from: bookEntry.move.substring(0, 2),
      to: bookEntry.move.substring(2, 4),
      promotion: bookEntry.move.length > 4 ? bookEntry.move.substring(4, 5) : undefined,
      depth: 0,
      scoreCp: null,
      scoreMate: null,
      pv: [bookEntry.move],
      isBookMove: true,
      bookName: bookEntry.name,
    };
  }

  private allowBookMoveAgainstEngine(
    bookCandidate: EngineCandidate,
    engineCandidates: EngineCandidate[]
  ): boolean {
    if (!engineCandidates.length) return true;

    const opening = this.settings.opening;
    const enginePolicy = opening?.enginePolicy?.[this.settings.activeEngineId] ?? {};
    const minEngineDepth = enginePolicy.minEngineDepth ?? (this.settings.activeEngineId === 'gwaymaegyi' ? 2 : opening?.safety?.minEngineDepth ?? 8);
    const topEngineCandidate = engineCandidates[0];
    if (!topEngineCandidate) return true;

    const engineDepth = topEngineCandidate.depth ?? 0;
    if (engineDepth < minEngineDepth) {
      return true;
    }

    const engineAlreadyIncludesBookMove = engineCandidates.some(
      (c) =>
        c.from === bookCandidate.from &&
        c.to === bookCandidate.to &&
        (c.promotion ?? '') === (bookCandidate.promotion ?? '')
    );

    if (engineAlreadyIncludesBookMove) {
      return true;
    }

    if (topEngineCandidate.scoreMate != null) {
      return false;
    }

    const bookName = bookCandidate.bookName?.toLowerCase() ?? '';
    const isRiskyBook =
      bookName.includes('gambit') ||
      bookName.includes('trap') ||
      bookName.includes('meme') ||
      bookName.includes('weird') ||
      bookName.includes('chaos');

    if (isRiskyBook && !opening?.safety?.allowRiskyOpenings && !enginePolicy.allowRisky) {
      return false;
    }

    return true;
  }

  private applyOpeningBook(engineCandidates: EngineCandidate[]): EngineCandidate[] {
    const multiPv = Math.max(1, this.settings.multiPv || 1);
    const baseCandidates = engineCandidates.slice(0, multiPv);
    const opening = this.settings.opening;

    if (!opening?.enabled || !this.currentBoardState || !this.isWithinBookDepth(this.currentBoardState.fen)) {
      return baseCandidates;
    }

    const mode = opening.mode || 'adaptive';
    const bookCandidate = this.getValidatedBookCandidate(baseCandidates, mode === 'parallel');
    if (!bookCandidate) {
      return baseCandidates;
    }

    if (mode === 'off') {
      return baseCandidates;
    }

    if (mode === 'book-only') {
      return [bookCandidate];
    }

    const matchIdx = baseCandidates.findIndex(
      (c) =>
        c.from === bookCandidate.from &&
        c.to === bookCandidate.to &&
        (c.promotion ?? '') === (bookCandidate.promotion ?? '')
    );

    if (mode === 'parallel') {
      if (matchIdx !== -1) {
        return baseCandidates.map((candidate, index) =>
          index === matchIdx
            ? { ...candidate, isBookMove: true, bookName: bookCandidate.bookName }
            : candidate
        );
      }

      // Theory + engine is an explicit comparison mode: retain every requested
      // engine variation and append the independently safe repertoire move.
      return [...baseCandidates, bookCandidate];
    }

    if (matchIdx !== -1) {
      const updated = [...baseCandidates];
      updated[matchIdx] = {
        ...updated[matchIdx]!,
        isBookMove: true,
        bookName: bookCandidate.bookName,
      };

      if (mode === 'prefer' && matchIdx > 0) {
        const [matched] = updated.splice(matchIdx, 1);
        if (matched) updated.unshift(matched);
      }

      return updated;
    }

    const reserveBookSlot = opening.reserveSlot ?? true;

    if (mode === 'prefer') {
      return [bookCandidate, ...baseCandidates].slice(0, multiPv);
    }

    if (mode === 'coexist') {
      if (baseCandidates.length < multiPv) {
        return [...baseCandidates, bookCandidate];
      }
      if (reserveBookSlot) {
        return [...baseCandidates.slice(0, Math.max(0, multiPv - 1)), bookCandidate];
      }
      return baseCandidates;
    }

    if (mode === 'hint') {
      if (baseCandidates.length < multiPv) {
        return [...baseCandidates, bookCandidate];
      }
      return baseCandidates;
    }

    if (mode === 'adaptive') {
      const allowUnsafeLookingBookMove = this.allowBookMoveAgainstEngine(
        bookCandidate,
        baseCandidates
      );

      if (!allowUnsafeLookingBookMove) {
        return baseCandidates;
      }

      if (baseCandidates.length < multiPv) {
        return [...baseCandidates, bookCandidate];
      }

      if (reserveBookSlot) {
        return [...baseCandidates.slice(0, Math.max(0, multiPv - 1)), bookCandidate];
      }
      return baseCandidates;
    }

    return baseCandidates;
  }

  private clearPendingTimer() {
    if (this.stabilityTimer) {
      clearTimeout(this.stabilityTimer);
      this.stabilityTimer = null;
    }
  }

  public destroy() {
    this.clearPendingTimer();
    this.currentBoardState = null;
    this.latestEngineSnapshot = null;
    this.committedCandidates = [];
    this.pendingCandidates = [];
    this.pendingCandidateKey = '';
    this.pendingDepth = 0;
  }

  public clear() {
    this.clearPendingTimer();
    this.latestEngineSnapshot = null;
    this.committedCandidates = [];
    this.pendingCandidateKey = '';
    this.pendingCandidates = [];
    this.pendingDepth = 0;
    this.broadcastCurrentState();
  }

  private broadcastCurrentState() {
    this.renderCallback({
      candidates: this.committedCandidates,
      isCommitted: true,
      depth: 0,
    });
  }

  public getCommittedCandidates(): EngineCandidate[] {
    return this.committedCandidates;
  }
}
