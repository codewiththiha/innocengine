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
    if (board.classList.contains('flipped') || board.hasAttribute('flipped')) {
      return true;
    }
    const parent = board.closest('.board-layout-main, .board-container');
    if (parent && (parent.classList.contains('flipped') || parent.hasAttribute('flipped'))) {
      return true;
    }
    return false;
  }

  public static extractBoardState(board: HTMLElement): BoardState | null {
    const isFlipped = this.isBoardFlipped(board);
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

    const isInitialPosition = this.checkInitialPosition(grid);
    const turn: 'w' | 'b' = isInitialPosition ? 'w' : this.detectSideToMove(board, grid);
    const controlledColor: 'w' | 'b' = isFlipped ? 'b' : 'w';
    const castling = this.computeCastlingRights(grid);
    const placement = this.gridToPlacement(grid);
    const positionKey = `${placement} ${turn} ${castling} -`;
    const fen = `${positionKey} 0 1`;

    return {
      fen,
      positionKey,
      isFlipped,
      turn,
      controlledColor,
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

  private static detectSideToMove(board: HTMLElement, grid: string[][]): 'w' | 'b' {
    // 1. Authoritative active clock turn
    const whiteClock = document.querySelector(
      '.player-component.white .clock-player-turn, .clock-white.running, [data-cy="white-clock"].running'
    );
    const blackClock = document.querySelector(
      '.player-component.black .clock-player-turn, .clock-black.running, [data-cy="black-clock"].running'
    );
    if (whiteClock && !blackClock) return 'w';
    if (blackClock && !whiteClock) return 'b';

    // 2. Authoritative move list history in sidebar
    const moveNodes = document.querySelectorAll(
      '.move-list-row .node, vertical-move-list .node, .game-history .node'
    );
    if (moveNodes.length > 0) {
      const lastNode = moveNodes[moveNodes.length - 1];
      if (lastNode) {
        const isWhite = lastNode.classList.contains('white-node') ||
          lastNode.getAttribute('data-player') === 'white' ||
          !lastNode.previousElementSibling;
        return isWhite ? 'b' : 'w';
      }
    }

    // 3. Fallback: piece count parities
    let whitePieces = 0;
    let blackPieces = 0;
    for (let r = 0; r < 8; r++) {
      for (let f = 0; f < 8; f++) {
        const p = grid[r]?.[f];
        if (p) {
          if (p === p.toUpperCase()) whitePieces++;
          else blackPieces++;
        }
      }
    }
    if (whitePieces < blackPieces) return 'w';
    if (blackPieces < whitePieces) return 'b';

    return 'w';
  }
}
