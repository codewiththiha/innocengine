import type { BoardState } from './types';

const PIECE_MAP: Record<string, string> = {
  wp: 'P',
  wn: 'N',
  wb: 'B',
  wr: 'R',
  wq: 'Q',
  wk: 'K',
  bp: 'p',
  bn: 'n',
  bb: 'b',
  br: 'r',
  bq: 'q',
  bk: 'k',
};

export class BoardParser {
  private static lastPlacement: string = '';
  private static lastTurn: 'w' | 'b' = 'w';

  public static findBoardElement(): HTMLElement | null {
    const selectors = [
      'wc-chess-board',
      'chess-board',
      '#board-single',
      '#board-layout-chessboard',
      '.board',
    ];

    for (const selector of selectors) {
      const el = document.querySelector<HTMLElement>(selector);
      if (el && (el.querySelector('.piece') || el.clientWidth > 100)) {
        return el;
      }
    }
    return null;
  }

  public static isBoardFlipped(board: HTMLElement): boolean {
    // 1. Direct class or attribute on board element
    if (
      board.classList.contains('flipped') ||
      board.hasAttribute('flipped') ||
      board.getAttribute('orientation') === 'black' ||
      board.getAttribute('data-orientation') === 'black'
    ) {
      return true;
    }

    // 2. Ancestor container classes and attributes
    const parent = board.closest(
      '.board-layout-main, .board-container, #board-layout-chessboard, .board-layout-chessboard'
    );
    if (
      parent &&
      (parent.classList.contains('flipped') ||
        parent.hasAttribute('flipped') ||
        parent.getAttribute('orientation') === 'black' ||
        parent.getAttribute('data-orientation') === 'black')
    ) {
      return true;
    }

    // 3. SVG Coordinates: Check vertical position of rank '1' vs '8'
    const coordTexts = board.querySelectorAll(
      'svg.coordinates text, text.coordinate-light, text.coordinate-dark, .coordinates text'
    );
    if (coordTexts.length > 0) {
      const boardRect = board.getBoundingClientRect();
      const midY = boardRect.top + boardRect.height / 2;
      for (const text of Array.from(coordTexts)) {
        const content = text.textContent?.trim();
        if (content === '1' || content === '8') {
          const rect = text.getBoundingClientRect();
          if (rect.height > 0) {
            // If coordinate '1' is in the top half, rank 1 is on top -> board is flipped
            if (content === '1') {
              return rect.top < midY;
            }
            // If coordinate '8' is in the bottom half, rank 8 is on bottom -> board is flipped
            if (content === '8') {
              return rect.top > midY;
            }
          }
        }
      }
    }

    // 4. Piece layout position check: where is square-51 (e1) or square-41 (d1)?
    const e1Piece = board.querySelector('.square-51, .square-41');
    if (e1Piece) {
      const boardRect = board.getBoundingClientRect();
      const rect = e1Piece.getBoundingClientRect();
      if (rect.height > 0 && boardRect.height > 0) {
        // If rank 1 is near top (< 30%), board is flipped!
        if (rect.top - boardRect.top < boardRect.height * 0.3) {
          return true;
        }
      }
    }

    return false;
  }

  public static detectPlayerColor(board: HTMLElement, isFlipped: boolean): 'w' | 'b' {
    // 1. Check bottom player container in Chess.com UI (User is always bottom player)
    const bottomPlayer = document.querySelector(
      '.board-layout-player.bottom, .player-component.bottom, [data-test-element="player-bottom"], .board-player-bottom'
    );
    if (bottomPlayer) {
      if (
        bottomPlayer.querySelector('.piece.wk, .piece-white, .user-tagline-white, .white-square') ||
        bottomPlayer.classList.contains('white') ||
        bottomPlayer.getAttribute('data-color') === 'w'
      ) {
        return 'w';
      }
      if (
        bottomPlayer.querySelector('.piece.bk, .piece-black, .user-tagline-black, .black-square') ||
        bottomPlayer.classList.contains('black') ||
        bottomPlayer.getAttribute('data-color') === 'b'
      ) {
        return 'b';
      }
    }

    // 2. Board orientation is primary indicator:
    // If board is flipped, Black is at the bottom -> player is 'b'
    // If not flipped, White is at the bottom -> player is 'w'
    return isFlipped ? 'b' : 'w';
  }

  public static extractBoardState(board: HTMLElement): BoardState | null {
    const isFlipped = this.isBoardFlipped(board);
    const playerColor = this.detectPlayerColor(board, isFlipped);
    const pieces = board.querySelectorAll<HTMLElement>('.piece:not([class*="ai-"])');
    if (!pieces || pieces.length === 0) {
      return null;
    }

    const grid: string[][] = Array(8)
      .fill(null)
      .map(() => Array(8).fill(''));

    const pieceMap = new Map<string, string>();
    const boardRect = board.getBoundingClientRect();
    const squareWidth = boardRect.width / 8;
    const squareHeight = boardRect.height / 8;

    pieces.forEach((pieceEl) => {
      if (pieceEl.closest('#chess-ai-svg-overlay')) return;

      let pieceType: string | null = null;
      let file: number | null = null;
      let rank: number | null = null;

      for (const cls of Array.from(pieceEl.classList)) {
        if (PIECE_MAP[cls]) {
          pieceType = PIECE_MAP[cls];
          break;
        }
      }

      if (!pieceType) {
        const pieceData = pieceEl.dataset.piece;
        if (pieceData && PIECE_MAP[pieceData]) {
          pieceType = PIECE_MAP[pieceData];
        }
      }

      if (!pieceType) return;

      for (const cls of Array.from(pieceEl.classList)) {
        const match = cls.match(/^square-(\d)(\d)$/);
        if (match && match[1] && match[2]) {
          file = parseInt(match[1], 10) - 1;
          rank = parseInt(match[2], 10) - 1;
          break;
        }
      }

      if ((file === null || rank === null) && pieceEl.style.transform && squareWidth > 0) {
        const transform = pieceEl.style.transform;
        const matchPx = transform.match(/translate\(\s*(-?\d+(?:\.\d+)?)px,\s*(-?\d+(?:\.\d+)?)px\)/);
        const matchPercent = transform.match(/translate\(\s*(-?\d+(?:\.\d+)?)%,\s*(-?\d+(?:\.\d+)?)%\)/);

        if (matchPx && matchPx[1] && matchPx[2]) {
          const col = Math.round(parseFloat(matchPx[1]) / squareWidth);
          const row = Math.round(parseFloat(matchPx[2]) / squareHeight);
          file = isFlipped ? 7 - col : col;
          rank = isFlipped ? row : 7 - row;
        } else if (matchPercent && matchPercent[1] && matchPercent[2]) {
          const col = Math.round(parseFloat(matchPercent[1]) / 100);
          const row = Math.round(parseFloat(matchPercent[2]) / 100);
          file = isFlipped ? 7 - col : col;
          rank = isFlipped ? row : 7 - row;
        }
      }

      if (file !== null && rank !== null && file >= 0 && file < 8 && rank >= 0 && rank < 8) {
        const rowArr = grid[rank];
        if (rowArr) {
          rowArr[file] = pieceType;
        }
        const sqName = `${String.fromCharCode(97 + file)}${rank + 1}`;
        pieceMap.set(sqName, pieceType);
      }
    });

    const placement = this.gridToPlacement(grid);
    const isInitialPosition = this.checkInitialPosition(grid);

    let turn: 'w' | 'b';
    if (isInitialPosition) {
      turn = 'w';
      this.lastTurn = 'w';
      this.lastPlacement = placement;
    } else if (placement === this.lastPlacement && this.lastTurn) {
      // Piece selection or click without movement: retain existing turn!
      // This prevents the opponent move shift bug when focusing a piece.
      turn = this.lastTurn;
    } else {
      // Pieces actually moved to new squares: detect whose turn it is now
      turn = this.detectSideToMove(board, grid);
      this.lastTurn = turn;
      this.lastPlacement = placement;
    }

    const castling = this.computeCastlingRights(grid);
    const positionKey = `${placement} ${turn} ${castling} -`;
    const fen = `${positionKey} 0 1`;

    return {
      fen,
      positionKey,
      placement,
      isFlipped,
      turn,
      playerColor,
      controlledColor: 'auto',
      pieceMap,
      boardElement: board,
    };
  }

  private static gridToPlacement(grid: string[][]): string {
    const rows: string[] = [];
    for (let r = 7; r >= 0; r--) {
      let empty = 0;
      let rowStr = '';
      const rowArr = grid[r];
      for (let f = 0; f < 8; f++) {
        const piece = rowArr ? rowArr[f] : '';
        if (piece) {
          if (empty > 0) {
            rowStr += empty;
            empty = 0;
          }
          rowStr += piece;
        } else {
          empty++;
        }
      }
      if (empty > 0) {
        rowStr += empty;
      }
      rows.push(rowStr);
    }
    return rows.join('/');
  }

  private static checkInitialPosition(grid: string[][]): boolean {
    const startBackWhite = ['R', 'N', 'B', 'Q', 'K', 'B', 'N', 'R'];
    const startBackBlack = ['r', 'n', 'b', 'q', 'k', 'b', 'n', 'r'];

    const row0 = grid[0];
    const row1 = grid[1];
    const row6 = grid[6];
    const row7 = grid[7];
    if (!row0 || !row1 || !row6 || !row7) return false;

    for (let f = 0; f < 8; f++) {
      if (row0[f] !== startBackWhite[f] || row1[f] !== 'P') return false;
      if (row7[f] !== startBackBlack[f] || row6[f] !== 'p') return false;
    }
    for (let r = 2; r <= 5; r++) {
      const row = grid[r];
      if (!row) return false;
      for (let f = 0; f < 8; f++) {
        if (row[f] !== '') return false;
      }
    }
    return true;
  }

  private static computeCastlingRights(grid: string[][]): string {
    let rights = '';
    const row0 = grid[0];
    const row7 = grid[7];

    if (row0 && row0[4] === 'K') {
      if (row0[7] === 'R') rights += 'K';
      if (row0[0] === 'R') rights += 'Q';
    }
    if (row7 && row7[4] === 'k') {
      if (row7[7] === 'r') rights += 'k';
      if (row7[0] === 'r') rights += 'q';
    }
    return rights.length > 0 ? rights : '-';
  }

  public static extractMoveHistoryFromDom(): string[] {
    const nodes = document.querySelectorAll<HTMLElement>(
      '.move-list-row .node, vertical-move-list .node, .game-history .node, wc-move-list .node, .move-node'
    );
    if (!nodes || nodes.length === 0) return [];

    const moves: string[] = [];
    nodes.forEach((node) => {
      const text = node.innerText.trim();
      // Skip turn numbers like "1.", "2."
      if (/^\d+\.?$/.test(text)) return;
      const match = text.match(/^[KQRBN]?[a-h]?[1-8]?x?[a-h][1-8](?:=[QRBN])?[\+#]?|^O-O(?:-O)?[\+#]?/);
      if (match && match[0]) {
        moves.push(match[0]);
      }
    });

    return moves;
  }

  private static detectSideToMove(board: HTMLElement, grid: string[][]): 'w' | 'b' {
    // 1. Authoritative move count from move history
    const moveHistory = this.extractMoveHistoryFromDom();
    if (moveHistory.length > 0) {
      return moveHistory.length % 2 === 0 ? 'w' : 'b';
    }

    // 2. Check running clock
    const whiteClock = document.querySelector(
      '.player-component.white .clock-player-turn, .clock-white.running, [data-cy="white-clock"].running'
    );
    const blackClock = document.querySelector(
      '.player-component.black .clock-player-turn, .clock-black.running, [data-cy="black-clock"].running'
    );
    if (whiteClock && !blackClock) return 'w';
    if (blackClock && !whiteClock) return 'b';

    // 3. Check native Chess.com move highlights (strictly excluding any AI overlay elements)
    // Only examine when there are exactly 2 native highlights (1 origin + 1 destination)
    const nativeHighlights = board.querySelectorAll(
      '.highlight:not([class*="ai-"]):not([id*="ai-"])'
    );
    if (nativeHighlights.length === 2) {
      let destPiece: string | null = null;
      let emptyCount = 0;
      for (const hl of Array.from(nativeHighlights)) {
        for (const cls of Array.from(hl.classList)) {
          const match = cls.match(/^square-(\d)(\d)$/);
          if (match && match[1] && match[2]) {
            const file = parseInt(match[1], 10) - 1;
            const rank = parseInt(match[2], 10) - 1;
            const piece = grid[rank]?.[file];
            if (piece) {
              destPiece = piece;
            } else {
              emptyCount++;
            }
          }
        }
      }
      if (destPiece && emptyCount === 1) {
        return destPiece === destPiece.toUpperCase() ? 'b' : 'w';
      }
    }

    return this.lastTurn || 'w';
  }
}
