import { Chess } from 'chess.js';
import { BoardParser } from './board-parser';
import type { BoardState } from './types';

export interface GameState {
  fen: string;
  positionKey: string;
  boardFingerprint: string;
  turn: 'w' | 'b';
  playerColor: 'w' | 'b';
  isFlipped: boolean;
  pieceMap: Map<string, string>;
  moveHistory: string[];
  boardElement: HTMLElement;
  isGameActive: boolean;
}

export class GameStateAdapter {
  public static extractGameState(
    board: HTMLElement,
    previousTurn: 'w' | 'b' = 'w',
    existingGridState?: BoardState | null
  ): GameState | null {
    const isFlipped = existingGridState?.isFlipped ?? BoardParser.isBoardFlipped(board);
    const gridState = existingGridState || BoardParser.extractBoardState(board);
    if (!gridState) return null;

    const boardFingerprint = this.computeBoardFingerprint(gridState.pieceMap);
    const moveHistory = gridState.moveHistory || this.extractMoveHistoryFromDom();
    const isGameActive = gridState.isGameActive ?? BoardParser.isGameActive(board);
    const playerColor = gridState.playerColor;

    // Attempt authoritative FEN reconstruction via Chess.com DOM move-list replay
    if (moveHistory.length > 0) {
      try {
        const chess = new Chess();
        let replaySuccess = true;

        for (const san of moveHistory) {
          try {
            const move = chess.move(san);
            if (!move) {
              replaySuccess = false;
              break;
            }
          } catch (_) {
            replaySuccess = false;
            break;
          }
        }

        if (replaySuccess) {
          const replayedFen = chess.fen();
          const tokens = replayedFen.split(' ');
          const positionKey = tokens.slice(0, 4).join(' ');

          if (this.verifyPieceMatch(chess, gridState.pieceMap)) {
            return {
              fen: replayedFen,
              positionKey,
              boardFingerprint,
              turn: chess.turn() as 'w' | 'b',
              playerColor,
              isFlipped,
              pieceMap: gridState.pieceMap,
              moveHistory,
              boardElement: board,
              isGameActive,
            };
          }
        }
      } catch (_) {}
    }

    // Determine turn reliably using single source of truth
    const detectedTurn = gridState.turn || BoardParser.detectTurn(board, previousTurn);

    // Fallback: visual board snapshot
    const tokens = gridState.fen.split(' ');
    tokens[1] = detectedTurn;
    const positionKey = tokens.slice(0, 4).join(' ');
    const fen = `${positionKey} 0 1`;

    return {
      fen,
      positionKey,
      boardFingerprint,
      turn: detectedTurn,
      playerColor,
      isFlipped,
      pieceMap: gridState.pieceMap,
      moveHistory,
      boardElement: board,
      isGameActive,
    };
  }

  public static computeBoardFingerprint(pieceMap: Map<string, string>): string {
    return Array.from(pieceMap.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([sq, p]) => `${sq}:${p}`)
      .join(';');
  }

  private static detectTurnFromClocksAndHistory(moveHistory: string[], fallbackTurn: 'w' | 'b'): 'w' | 'b' {
    return BoardParser.detectTurn(null, fallbackTurn);
  }

  public static extractMoveHistoryFromDom(): string[] {
    return BoardParser.extractMoveHistoryFromDom();
  }

  private static verifyPieceMatch(chess: Chess, pieceMap: Map<string, string>): boolean {
    const board = chess.board();
    let matches = 0;
    let totalPieces = 0;

    for (let r = 0; r < 8; r++) {
      for (let f = 0; f < 8; f++) {
        const sq = `${String.fromCharCode(97 + f)}${8 - r}`;
        const piece = board[r]?.[f];
        const domPiece = pieceMap.get(sq);

        if (piece) {
          totalPieces++;
          const expectedChar = piece.color === 'w' ? piece.type.toUpperCase() : piece.type;
          if (domPiece === expectedChar) {
            matches++;
          }
        } else if (domPiece) {
          return false;
        }
      }
    }

    return totalPieces > 0 && matches === totalPieces;
  }
}
