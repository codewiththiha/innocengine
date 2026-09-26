import React, { useState, useEffect, useRef } from 'react';
import { Chess, type Square } from 'chess.js';
import { RotateCw, Play, RotateCcw, Award, ChevronRight, Zap } from 'lucide-react';
import type { EngineEvaluation, MoveLine } from '../../lib/types';
import './App.css';

const UNICODE_PIECES: Record<string, string> = {
  p: '♟',
  n: '♞',
  b: '♝',
  r: '♜',
  q: '♛',
  k: '♚',
  P: '♙',
  N: '♘',
  B: '♗',
  R: '♖',
  Q: '♕',
  K: '♔',
};

const PRESETS = [
  { name: 'Standard Start', fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1' },
  { name: '1. f4 Nf6 (From Screenshot)', fen: 'rnbqkb1r/pppppppp/5n2/8/5P2/8/PPPPP1PP/RNBQKBNR w KQkq - 1 2' },
  { name: "Scholar's Mate", fen: 'r1bqkb1r/pppp1ppp/2n5/4p3/2B1n3/5Q2/PPPP1PPP/RNB1K1NR w KQkq - 0 5' },
  { name: 'Opera Game (Morphy)', fen: '4kb1r/p2rqppp/5n2/1B2p1B1/4P3/1Q6/PPP2PPP/2KR4 w k - 0 15' },
  { name: 'Kasparov vs Topalov', fen: 'b2r3r/4k3/p1q1pp2/8/2P1N3/1P1p1PP1/P5K1/1R1Q3R b - - 0 28' },
  { name: 'Endgame: Rook Mate', fen: '8/8/8/4k3/8/8/3R4/4K3 w - - 0 1' },
];

export default function App() {
  const [chess, setChess] = useState<Chess>(new Chess());
  const [fen, setFen] = useState<string>(chess.fen());
  const [selectedSquare, setSelectedSquare] = useState<Square | null>(null);
  const [isFlipped, setIsFlipped] = useState<boolean>(false);
  const [customFenInput, setCustomFenInput] = useState<string>('');
  const [lastMove, setLastMove] = useState<{ from: string; to: string } | null>(null);

  const [evalData, setEvalData] = useState<EngineEvaluation>({
    fen: chess.fen(),
    depth: 0,
    scoreCp: 0,
    scoreMate: null,
    bestMove: null,
    multiPvLines: [],
    isCalculating: false,
    timestamp: Date.now(),
  });

  const workerRef = useRef<Worker | null>(null);

  // Initialize self-contained Stockfish JS worker
  useEffect(() => {
    try {
      const workerUrl = chrome?.runtime?.getURL
        ? chrome.runtime.getURL('engine/stockfish.js')
        : '/engine/stockfish.js';

      const worker = new Worker(workerUrl);
      workerRef.current = worker;

      worker.onmessage = (e) => {
        const line = typeof e.data === 'string' ? e.data : '';
        handleEngineOutput(line);
      };

      worker.postMessage('uci');
      worker.postMessage('isready');

      analyzePosition(chess.fen(), worker);
    } catch (err) {
      console.warn('[Playground] Worker init error:', err);
    }

    return () => {
      if (workerRef.current) {
        workerRef.current.terminate();
      }
    };
  }, []);

  const handleEngineOutput = (line: string) => {
    if (!line.startsWith('info') || !line.includes(' score ')) return;

    const depthMatch = line.match(/\bdepth\s+(\d+)/);
    const depth = depthMatch && depthMatch[1] ? parseInt(depthMatch[1], 10) : 0;

    const multiPvMatch = line.match(/\bmultipv\s+(\d+)/);
    const pvId = multiPvMatch && multiPvMatch[1] ? parseInt(multiPvMatch[1], 10) : 1;

    let scoreCp: number | null = null;
    let scoreMate: number | null = null;

    const cpMatch = line.match(/\bscore\s+cp\s+(-?\d+)/);
    if (cpMatch && cpMatch[1]) scoreCp = parseInt(cpMatch[1], 10);

    const mateMatch = line.match(/\bscore\s+mate\s+(-?\d+)/);
    if (mateMatch && mateMatch[1]) scoreMate = parseInt(mateMatch[1], 10);

    const pvIndex = line.indexOf(' pv ');
    let pvMoves: string[] = [];
    let bestMove = '';
    if (pvIndex !== -1) {
      pvMoves = line.substring(pvIndex + 4).trim().split(/\s+/);
      if (pvMoves.length > 0 && pvMoves[0]) bestMove = pvMoves[0];
    }

    if (bestMove) {
      setEvalData((prev) => {
        const existingLines = [...prev.multiPvLines];
        const lineIdx = existingLines.findIndex((l) => l.id === pvId);
        const newLine: MoveLine = {
          id: pvId,
          depth,
          scoreCp,
          scoreMate,
          bestMove,
          pv: pvMoves,
        };

        if (lineIdx !== -1) {
          existingLines[lineIdx] = newLine;
        } else {
          existingLines.push(newLine);
        }
        existingLines.sort((a, b) => a.id - b.id);

        const primary = existingLines[0] || newLine;

        return {
          ...prev,
          depth: Math.max(prev.depth, depth),
          scoreCp: primary.scoreCp,
          scoreMate: primary.scoreMate,
          bestMove: primary.bestMove,
          multiPvLines: existingLines,
          isCalculating: true,
        };
      });
    }
  };

  const analyzePosition = (fenStr: string, workerInstance?: Worker) => {
    const w = workerInstance || workerRef.current;
    if (!w) return;

    w.postMessage('stop');
    w.postMessage(`position fen ${fenStr}`);
    w.postMessage('go depth 14');

    setEvalData((prev) => ({
      ...prev,
      fen: fenStr,
      depth: 0,
      bestMove: null,
      multiPvLines: [],
      isCalculating: true,
    }));
  };

  const handleSquareClick = (square: Square) => {
    if (!selectedSquare) {
      const piece = chess.get(square);
      if (piece && piece.color === chess.turn()) {
        setSelectedSquare(square);
      }
    } else {
      if (selectedSquare === square) {
        setSelectedSquare(null);
        return;
      }

      try {
        const move = chess.move({
          from: selectedSquare,
          to: square,
          promotion: 'q',
        });

        if (move) {
          const newFen = chess.fen();
          setFen(newFen);
          setLastMove({ from: move.from, to: move.to });
          setSelectedSquare(null);
          analyzePosition(newFen);
        } else {
          const piece = chess.get(square);
          if (piece && piece.color === chess.turn()) {
            setSelectedSquare(square);
          } else {
            setSelectedSquare(null);
          }
        }
      } catch (_) {
        const piece = chess.get(square);
        if (piece && piece.color === chess.turn()) {
          setSelectedSquare(square);
        } else {
          setSelectedSquare(null);
        }
      }
    }
  };

  const loadPreset = (presetFen: string) => {
    try {
      const newChess = new Chess(presetFen);
      setChess(newChess);
      setFen(presetFen);
      setSelectedSquare(null);
      setLastMove(null);
      analyzePosition(presetFen);
    } catch (err) {
      console.error('Invalid FEN:', err);
    }
  };

  const handleCustomFenSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (customFenInput) {
      loadPreset(customFenInput);
      setCustomFenInput('');
    }
  };

  const resetGame = () => {
    loadPreset('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
  };

  const undoMove = () => {
    chess.undo();
    const newFen = chess.fen();
    setFen(newFen);
    setSelectedSquare(null);
    setLastMove(null);
    analyzePosition(newFen);
  };

  // Evaluation bar computation
  let evalScoreString = '0.0';
  let whiteWinPercent = 50;
  if (evalData.scoreMate !== null) {
    evalScoreString = `M${evalData.scoreMate > 0 ? '+' : ''}${evalData.scoreMate}`;
    whiteWinPercent = evalData.scoreMate > 0 ? 100 : 0;
  } else if (evalData.scoreCp !== null) {
    const p = (evalData.scoreCp / 100).toFixed(1);
    evalScoreString = `${evalData.scoreCp > 0 ? '+' : ''}${p}`;
    const winP = 1 / (1 + Math.exp(-0.00368208 * evalData.scoreCp));
    whiteWinPercent = Math.max(5, Math.min(95, Math.round(winP * 100)));
  }

  // Recommended move squares from Stockfish
  const recommendedFrom = evalData.bestMove ? evalData.bestMove.substring(0, 2) : null;
  const recommendedTo = evalData.bestMove ? evalData.bestMove.substring(2, 4) : null;

  return (
    <div className="playground-root">
      <nav className="playground-nav">
        <div className="brand-section">
          <div className="brand-logo">♔</div>
          <div>
            <h1 className="brand-title">Chess AI Move Square Highlighter</h1>
            <p className="brand-subtitle">
              Live Stockfish Engine: Highlights Piece in Charge (Azure) & Move Target (Emerald)
            </p>
          </div>
        </div>
        <div className="btn-group">
          <button type="button" className="btn" onClick={() => setIsFlipped(!isFlipped)}>
            <RotateCw size={14} /> Flip Board ({isFlipped ? 'Black' : 'White'})
          </button>
          <button type="button" className="btn" onClick={undoMove}>
            <RotateCcw size={14} /> Undo Move
          </button>
          <button type="button" className="btn btn-primary" onClick={resetGame}>
            <Play size={14} /> Reset Board
          </button>
        </div>
      </nav>

      <div className="playground-layout">
        <div className="board-column">
          <div className="board-wrapper">
            <div className="eval-bar-wrapper">
              <div
                className="eval-bar-fill"
                style={{
                  height: `${isFlipped ? 100 - whiteWinPercent : whiteWinPercent}%`,
                }}
              />
              <span className="eval-bar-text">{evalScoreString}</span>
            </div>

            <div className="board-container">
              {Array.from({ length: 64 }).map((_, idx) => {
                const row = Math.floor(idx / 8);
                const col = idx % 8;
                const fileIdx = isFlipped ? 7 - col : col;
                const rankIdx = isFlipped ? row : 7 - row;
                const fileChar = String.fromCharCode(97 + fileIdx);
                const rankChar = (rankIdx + 1).toString();
                const sq = `${fileChar}${rankChar}` as Square;
                const piece = chess.get(sq);

                const isLight = (fileIdx + rankIdx) % 2 !== 0;
                const isSelected = selectedSquare === sq;
                const isLastMoveSq = lastMove?.from === sq || lastMove?.to === sq;

                // Square highlights for best move
                const isPieceInCharge = recommendedFrom === sq;
                const isTargetSquare = recommendedTo === sq;

                return (
                  <div
                    key={sq}
                    className={`board-square ${isLight ? 'square-light' : 'square-dark'} ${
                      isSelected ? 'square-selected' : ''
                    } ${isLastMoveSq ? 'square-last-move' : ''}`}
                    onClick={() => handleSquareClick(sq)}
                  >
                    {/* Piece in Charge highlight (Azure Blue) */}
                    {isPieceInCharge && (
                      <div
                        style={{
                          position: 'absolute',
                          inset: 0,
                          backgroundColor: 'rgba(56, 189, 248, 0.55)',
                          boxShadow: 'inset 0 0 0 3px #0284c7',
                          borderRadius: 4,
                          pointerEvents: 'none',
                          zIndex: 2,
                        }}
                      />
                    )}

                    {/* Move Destination highlight (Emerald Green) */}
                    {isTargetSquare && (
                      <div
                        style={{
                          position: 'absolute',
                          inset: 0,
                          backgroundColor: 'rgba(16, 185, 129, 0.55)',
                          boxShadow: 'inset 0 0 0 3px #059669',
                          borderRadius: 4,
                          pointerEvents: 'none',
                          zIndex: 2,
                        }}
                      />
                    )}

                    {piece && (
                      <span
                        className="piece-symbol"
                        style={{
                          color: piece.color === 'w' ? '#ffffff' : '#000000',
                          zIndex: 3,
                        }}
                      >
                        {UNICODE_PIECES[piece.color === 'w' ? piece.type.toUpperCase() : piece.type]}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Color Legend */}
          <div style={{ display: 'flex', gap: 20, fontSize: 12, marginTop: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span
                style={{
                  width: 14,
                  height: 14,
                  borderRadius: 3,
                  backgroundColor: 'rgba(56, 189, 248, 0.7)',
                  border: '1px solid #0284c7',
                }}
              />
              <span>Piece in Charge (Move From)</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span
                style={{
                  width: 14,
                  height: 14,
                  borderRadius: 3,
                  backgroundColor: 'rgba(16, 185, 129, 0.7)',
                  border: '1px solid #059669',
                }}
              />
              <span>Target Move Square (Move To)</span>
            </div>
          </div>
        </div>

        <div className="controls-column">
          <div className="panel-card">
            <h2 className="panel-title">
              <Zap size={16} /> Stockfish Engine Analysis
            </h2>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
              <div>
                <div style={{ fontSize: 11, color: '#94a3b8' }}>Evaluation</div>
                <div style={{ fontSize: 24, fontWeight: 800, color: '#38bdf8' }}>{evalScoreString}</div>
              </div>
              <div>
                <div style={{ fontSize: 11, color: '#94a3b8' }}>Search Depth</div>
                <div style={{ fontSize: 24, fontWeight: 800, color: '#f8fafc' }}>
                  {evalData.depth} <span style={{ fontSize: 12, color: '#94a3b8' }}>ply</span>
                </div>
              </div>
              <div>
                <div style={{ fontSize: 11, color: '#94a3b8' }}>Turn to Move</div>
                <div style={{ fontSize: 24, fontWeight: 800, color: chess.turn() === 'w' ? '#ffffff' : '#fbbf24' }}>
                  {chess.turn() === 'w' ? 'White' : 'Black'}
                </div>
              </div>
            </div>

            <div style={{ marginTop: 10, padding: 10, background: '#0f172a', borderRadius: 8 }}>
              <div style={{ fontSize: 12, color: '#94a3b8' }}>Recommended Move:</div>
              <div style={{ fontSize: 20, fontWeight: 800, color: '#34d399', fontFamily: 'monospace' }}>
                {evalData.bestMove
                  ? `${evalData.bestMove.substring(0, 2)} → ${evalData.bestMove.substring(2, 4)}`
                  : 'Calculating...'}
              </div>
            </div>
          </div>

          <div className="panel-card">
            <h2 className="panel-title">
              <Award size={16} /> Famous Position Presets
            </h2>
            <div className="btn-group">
              {PRESETS.map((p) => (
                <button key={p.name} type="button" className="btn" onClick={() => loadPreset(p.fen)}>
                  <ChevronRight size={12} /> {p.name}
                </button>
              ))}
            </div>
          </div>

          <div className="panel-card">
            <h2 className="panel-title">Position FEN</h2>
            <div style={{ fontSize: 11, color: '#94a3b8', wordBreak: 'break-all', fontFamily: 'monospace' }}>
              {fen}
            </div>
            <form onSubmit={handleCustomFenSubmit} className="fen-input-row">
              <input
                type="text"
                placeholder="Paste custom FEN..."
                value={customFenInput}
                onChange={(e) => setCustomFenInput(e.target.value)}
                className="fen-input"
              />
              <button type="submit" className="btn btn-primary">
                Load
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
