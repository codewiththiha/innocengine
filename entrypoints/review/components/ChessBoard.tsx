import React, { useMemo, useRef, useState, useCallback, useEffect } from 'react';
import type { Square, Piece } from 'chess.js';

/**
 * ChessBoard
 *
 * Chess.com-styled 8x8 board:
 *   - Green/brown square palette matching Chess.com
 *   - Piece rendering via built-in merida-style Unicode glyphs (scaled, text-shadow)
 *   - Last-move highlight in Chess.com's soft yellow
 *   - Selected square in blue
 *   - Click and drag-to-move support
 *   - Move arrows rendered as SVG overlays with markers
 *   - Right/bottom coordinate labels
 */

export interface Arrow {
  from: Square;
  to: Square;
  color: string;
  opacity?: number;
  label?: string;
}

export interface SquareAnnotation {
  square: Square;
  kind: 'last-move-from' | 'last-move-to' | 'selected' | 'best' | 'blunder' | 'check' | 'highlight';
  color?: string;
}

interface ChessBoardProps {
  fen: string;
  flipped?: boolean;
  lastMove?: { from: Square; to: Square } | null;
  bestMove?: { from: Square; to: Square } | null;
  arrows?: Arrow[];
  annotations?: SquareAnnotation[];
  onMove?: (from: Square, to: Square, promotion?: string) => void;
  onSquareClick?: (sq: Square) => void;
  highlightedSquares?: Map<Square, string>; // bg color per square
  orientation?: 'w' | 'b';
  disabled?: boolean;
}

// Chess.com-ish palette
const LIGHT_SQ = '#eeeed2';
const DARK_SQ = '#769656';
const LAST_MOVE_FROM = 'rgba(246, 246, 105, 0.45)';
const LAST_MOVE_TO = 'rgba(246, 246, 105, 0.55)';
const SELECTED_SQ = 'rgba(106, 159, 181, 0.65)';
const BEST_MOVE_SQ = 'rgba(129, 182, 76, 0.45)';
const BLUNDER_SQ = 'rgba(250, 65, 45, 0.5)';

const UNICODE: Record<string, string> = {
  p: '♟', n: '♞', b: '♝', r: '♜', q: '♛', k: '♚',
  P: '♙', N: '♘', B: '♗', R: '♖', Q: '♕', K: '♔',
};

function pieceOnSquare(fen: string, sq: Square): string | null {
  const placement = fen.split(' ')[0] || '';
  const ranks = placement.split('/');
  const file = sq.charCodeAt(0) - 97;     // 0-7 (a-h)
  const rank = parseInt(sq[1]!, 10);       // 1-8
  const rankIdx = 8 - rank;                // 0-7 top->bottom
  const row = ranks[rankIdx];
  if (!row) return null;
  let f = 0;
  for (const ch of row) {
    if (/\d/.test(ch)) { f += Number(ch); continue; }
    if (f === file) return ch;
    f++;
  }
  return null;
}

function fileRankFromIdx(idx: number, flipped: boolean): { file: number; rank: number; sq: Square } {
  const col = idx % 8;
  const row = Math.floor(idx / 8);
  const file = flipped ? 7 - col : col;
  const rank = flipped ? row + 1 : 8 - row;
  const sq = `${String.fromCharCode(97 + file)}${rank}` as Square;
  return { file, rank, sq };
}

export default function ChessBoard({
  fen,
  flipped,
  lastMove,
  bestMove,
  arrows = [],
  annotations = [],
  onMove,
  onSquareClick,
  highlightedSquares,
  disabled,
}: ChessBoardProps) {
  const [selectedSquare, setSelectedSquare] = useState<Square | null>(null);
  const [legalTargets, setLegalTargets] = useState<Set<Square>>(new Set());
  const [dragging, setDragging] = useState<{ from: Square; piece: string; x: number; y: number } | null>(null);
  const boardRef = useRef<HTMLDivElement>(null);
  const [boardSize, setBoardSize] = useState(0);

  useEffect(() => {
    setSelectedSquare(null);
    setLegalTargets(new Set());
  }, [fen]);

  useEffect(() => {
    const el = boardRef.current;
    if (!el) return;
    const measure = () => setBoardSize(el.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const annotBySquare = useMemo(() => {
    const m = new Map<Square, SquareAnnotation>();
    for (const a of annotations) m.set(a.square, a);
    if (lastMove) {
      m.set(lastMove.from, { square: lastMove.from, kind: 'last-move-from' });
      m.set(lastMove.to, { square: lastMove.to, kind: 'last-move-to' });
    }
    if (bestMove) {
      if (!m.has(bestMove.from)) m.set(bestMove.from, { square: bestMove.from, kind: 'best' });
      if (!m.has(bestMove.to)) m.set(bestMove.to, { square: bestMove.to, kind: 'best' });
    }
    return m;
  }, [annotations, lastMove, bestMove]);

  const squareColor = (file: number, rank: number) =>
    ((file + rank) % 2 === 0) ? DARK_SQ : LIGHT_SQ;

  const handleSquareClick = useCallback((sq: Square) => {
    onSquareClick?.(sq);
    if (disabled) return;
    const piece = pieceOnSquare(fen, sq);
    if (selectedSquare && selectedSquare !== sq) {
      if (legalTargets.has(sq)) {
        // determine promotion (auto-queen except when pawn reaches 8th/1st)
        const mover = pieceOnSquare(fen, selectedSquare);
        const isPromotion = mover && mover.toLowerCase() === 'p' && (sq[1] === '8' || sq[1] === '1');
        onMove?.(selectedSquare, sq, isPromotion ? 'q' : undefined);
        setSelectedSquare(null);
        setLegalTargets(new Set());
        return;
      }
      if (piece) {
        setSelectedSquare(sq);
        return;
      }
      setSelectedSquare(null);
      setLegalTargets(new Set());
      return;
    }
    if (piece) {
      setSelectedSquare(sq);
      // Compute legal targets — we defer to onMove validation but show simple empty/opponent hints.
      // For a richer hint we could import chess.js here; keep the base hint light.
      setLegalTargets(new Set());
    } else {
      setSelectedSquare(null);
    }
  }, [fen, selectedSquare, legalTargets, disabled, onMove, onSquareClick]);

  const onPointerDown = (e: React.PointerEvent, sq: Square) => {
    if (disabled) return;
    const piece = pieceOnSquare(fen, sq);
    if (!piece) return;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setDragging({
      from: sq,
      piece,
      x: e.clientX - rect.left - rect.width / 2,
      y: e.clientY - rect.top - rect.height / 2,
    });
    setSelectedSquare(sq);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragging || !boardRef.current) return;
    const rect = boardRef.current.getBoundingClientRect();
    setDragging({
      ...dragging,
      x: e.clientX - rect.left - rect.width / 8 / 2,
      y: e.clientY - rect.top - rect.width / 8 / 2,
    });
  };

  const onPointerUp = (e: React.PointerEvent) => {
    if (!dragging || !boardRef.current) { setDragging(null); return; }
    const rect = boardRef.current.getBoundingClientRect();
    const relX = e.clientX - rect.left;
    const relY = e.clientY - rect.top;
    const cell = rect.width / 8;
    const col = Math.max(0, Math.min(7, Math.floor(relX / cell)));
    const row = Math.max(0, Math.min(7, Math.floor(relY / cell)));
    const file = flipped ? 7 - col : col;
    const rank = flipped ? row + 1 : 8 - row;
    const toSq = `${String.fromCharCode(97 + file)}${rank}` as Square;
    if (toSq !== dragging.from) {
      const mover = dragging.piece;
      const isPromotion = mover && mover.toLowerCase() === 'p' && (toSq[1] === '8' || toSq[1] === '1');
      onMove?.(dragging.from, toSq, isPromotion ? 'q' : undefined);
    }
    setDragging(null);
    setSelectedSquare(null);
  };

  const cellPct = 12.5;

  return (
    <div
      ref={boardRef}
      className="cc-board"
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      style={{ position: 'relative', width: '100%', aspectRatio: '1 / 1', userSelect: 'none' }}
    >
      {Array.from({ length: 64 }).map((_, idx) => {
        const { file, rank, sq } = fileRankFromIdx(idx, !!flipped);
        const piece = pieceOnSquare(fen, sq);
        const isLight = (file + rank) % 2 !== 0;
        const bg = isLight ? LIGHT_SQ : DARK_SQ;
        const ann = annotBySquare.get(sq);
        let overlay = '';
        if (ann?.kind === 'last-move-from') overlay = LAST_MOVE_FROM;
        if (ann?.kind === 'last-move-to') overlay = LAST_MOVE_TO;
        if (ann?.kind === 'selected' || selectedSquare === sq) overlay = SELECTED_SQ;
        if (ann?.kind === 'best') overlay = BEST_MOVE_SQ;
        if (ann?.kind === 'blunder') overlay = BLUNDER_SQ;
        const customBg = highlightedSquares?.get(sq);
        if (customBg) overlay = customBg;
        const isLegalTarget = legalTargets.has(sq);

        return (
          <div
            key={sq}
            className="cc-square"
            style={{
              position: 'absolute',
              left: `${file * cellPct}%`,
              top: `${(flipped ? rank - 1 : 8 - rank) * cellPct}%`,
              width: `${cellPct}%`,
              height: `${cellPct}%`,
              background: bg,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: piece ? 'grab' : 'default',
            }}
            onClick={() => handleSquareClick(sq)}
            onPointerDown={(e) => onPointerDown(e, sq)}
          >
            {overlay && (
              <div style={{
                position: 'absolute', inset: 0, background: overlay, pointerEvents: 'none',
              }} />
            )}
            {isLegalTarget && !piece && (
              <div style={{
                position: 'absolute', width: '24%', height: '24%', borderRadius: '50%',
                background: 'rgba(0,0,0,0.22)', pointerEvents: 'none',
              }} />
            )}
            {isLegalTarget && piece && (
              <div style={{
                position: 'absolute', inset: '4%', borderRadius: '50%',
                boxShadow: 'inset 0 0 0 4px rgba(0,0,0,0.3)', pointerEvents: 'none',
              }} />
            )}
            {/* File/rank labels */}
            {((flipped ? file === 7 : file === 0)) && (
              <span className="cc-coord cc-coord-rank" style={{
                position: 'absolute', left: 3, top: 1, fontSize: 10, fontWeight: 600,
                color: isLight ? DARK_SQ : LIGHT_SQ, pointerEvents: 'none',
              }}>{rank}</span>
            )}
            {((flipped ? rank === 8 : rank === 1)) && (
              <span className="cc-coord cc-coord-file" style={{
                position: 'absolute', right: 3, bottom: 1, fontSize: 10, fontWeight: 600,
                color: isLight ? DARK_SQ : LIGHT_SQ, pointerEvents: 'none',
              }}>{String.fromCharCode(97 + file)}</span>
            )}
            {piece && !(dragging && dragging.from === sq) && (
              <span
                className="cc-piece"
                style={{
                  fontSize: 'clamp(24px, 7.5vw, 58px)',
                  lineHeight: 1,
                  color: piece === piece.toUpperCase() ? '#ffffff' : '#1a1a1a',
                  textShadow: piece === piece.toUpperCase()
                    ? '0 1px 0 #000, 0 0 2px rgba(0,0,0,0.6)'
                    : '0 1px 0 #fff, 0 0 2px rgba(0,0,0,0.4)',
                  position: 'relative',
                  zIndex: 2,
                  pointerEvents: 'none',
                  fontFamily: 'Segoe UI Symbol, Arial Unicode MS, sans-serif',
                }}
              >
                {UNICODE[piece]}
              </span>
            )}
          </div>
        );
      })}

      {/* Arrow layer */}
      <svg
        viewBox="0 0 8 8"
        preserveAspectRatio="none"
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 3 }}
      >
        <defs>
          {arrows.map((a, i) => (
            <marker key={i} id={`arrhd-${i}`} viewBox="0 0 6 6" refX="5" refY="3" markerWidth="0.5" markerHeight="0.5" orient="auto-start-reverse">
              <path d="M0 0.5 L5.5 3 L0 5.5 z" fill={a.color} />
            </marker>
          ))}
        </defs>
        {arrows.map((a, i) => {
          const fx = a.from.charCodeAt(0) - 97;
          const fr = parseInt(a.from[1]!, 10);
          const tx = a.to.charCodeAt(0) - 97;
          const tr = parseInt(a.to[1]!, 10);
          const sx = (flipped ? 7 - fx : fx) + 0.5;
          const sy = (flipped ? fr - 1 : 8 - fr) + 0.5;
          const ex = (flipped ? 7 - tx : tx) + 0.5;
          const ey = (flipped ? tr - 1 : 8 - tr) + 0.5;
          const dx = ex - sx, dy = ey - sy;
          const d = Math.hypot(dx, dy);
          if (d < 0.2) return null;
          const tail = 0.25, head = 0.4;
          return (
            <line
              key={i}
              x1={sx + (dx / d) * tail} y1={sy + (dy / d) * tail}
              x2={ex - (dx / d) * head} y2={ey - (dy / d) * head}
              stroke={a.color} strokeWidth={0.24} strokeLinecap="round"
              opacity={a.opacity ?? 0.72}
              markerEnd={`url(#arrhd-${i})`}
            />
          );
        })}
      </svg>

      {/* Dragging piece */}
      {dragging && boardSize > 0 && (
        <div style={{
          position: 'absolute',
          left: `calc(${(flipped ? 7 - (dragging.from.charCodeAt(0) - 97) : (dragging.from.charCodeAt(0) - 97)) * cellPct}% + ${dragging.x}px)`,
          top: `calc(${(flipped ? parseInt(dragging.from[1]!, 10) - 1 : 8 - parseInt(dragging.from[1]!, 10)) * cellPct}% + ${dragging.y}px)`,
          width: `${cellPct}%`, height: `${cellPct}%`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          pointerEvents: 'none', zIndex: 20,
          transform: 'translate(0,0)',
        }}>
          <span style={{
            fontSize: 'clamp(24px, 7.5vw, 58px)',
            color: dragging.piece === dragging.piece.toUpperCase() ? '#fff' : '#1a1a1a',
            textShadow: dragging.piece === dragging.piece.toUpperCase()
              ? '0 2px 4px rgba(0,0,0,0.5)'
              : '0 2px 4px rgba(0,0,0,0.4)',
          }}>
            {UNICODE[dragging.piece]}
          </span>
        </div>
      )}
    </div>
  );
}
