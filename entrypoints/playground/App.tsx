import React, { useState, useEffect, useRef } from 'react';
import { Chess, type Square } from 'chess.js';
import { RotateCw, Play, RotateCcw, Award, ChevronRight, Zap } from 'lucide-react';
import type { EngineEvaluation, MoveLine } from '../../lib/types';
import './App.css';

// Unicode chess piece glyphs
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
  { name: "Scholar's Mate", fen: 'r1bqkb1r/pppp1ppp/2n5/4p3/2B1n3/5Q2/PPPP1PPP/RNB1K1NR w KQkq - 0 5' },
  { name: 'Opera Game (Morphy)', fen: '4kb1r/p2rqppp/5n2/1B2p1B1/4P3/1Q6/PPP2PPP/2KR4 w k - 0 15' },
  { name: 'Kasparov Immortal', fen: 'b2r3r/4k3/p1q1pp2/8/2P1N3/1P1p1PP1/P5K1/1R1Q3R b - - 0 28' },
  { name: 'Endgame: Rook Mate', fen: '8/8/8/4k3/8/8/3R4/4K3 w - - 0 1' },
];

export default function App() {
  const [chess, setChess] = useState<Chess>(new Chess());
  const [fen, setFen] = useState<string>(chess.fen());
  const [selectedSquare, setSelectedSquare] = useState<Square | null>(null);
  const [isFlipped, setIsFlipped] = useState<boolean>(false);
  const [customFenInput, setCustomFenInput] = useState<string>('');
  const [lastMove, setLastMove] = useState<{ from: string; to: string } | null>(null);

  // Engine state
  const [evalData, setEvalData] = useState<EngineEvaluation>({
    fen: chess.fen(),
    depth: 0,
    scoreCp: 25,
    scoreMate: null,
    bestMove: null,
    multiPvLines: [],
    isCalculating: false,
    timestamp: Date.now(),
  });

  const workerRef = useRef<Worker | null>(null);

  // Initialize Stockfish worker
  useEffect(() => {
    try {
      const workerUrl = chrome?.runtime?.getURL
        ? chrome.runtime.getURL('engine/stockfish.wasm.js')
        : '/engine/stockfish.wasm.js';

      const worker = new Worker(workerUrl);
      workerRef.current = worker;

      worker.onmessage = (e) => {
        const line = typeof e.data === 'string' ? e.data : '';
        handleEngineOutput(line);
      };

      worker.postMessage('uci');
      worker.postMessage('isready');
      worker.postMessage('setoption name MultiPV value 3');

      // Trigger initial analysis
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
    w.postMessage('setoption name MultiPV value 3');
    w.postMessage(`position fen ${fenStr}`);
    w.postMessage('go depth 16');

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

  // Coordinate helper for SVG overlay
  const squareToCoords = (sq: string) => {
    if (sq.length < 2 || !sq[1]) return null;
    const file = sq.charCodeAt(0) - 97;
    const rank = parseInt(sq[1], 10) - 1;
    if (file < 0 || file > 7 || rank < 0 || rank > 7) return null;
    return isFlipped
      ? { x: (7 - file) * 100 + 50, y: rank * 100 + 50 }
      : { x: file * 100 + 50, y: (7 - rank) * 100 + 50 };
  };

  return (
    <div className="playground-root">
      {/* Navigation */}
      <nav className="playground-nav">
        <div className="brand-section">
          <div className="brand-logo">♔</div>
          <div>
            <h1 className="brand-title">Chess AI Overlay Test Playground</h1>
            <p className="brand-subtitle">
              Verify WebAssembly Stockfish, SVG coordinate trigonometry, and MultiPV overlay
            </p>
          </div>
        </div>
        <div className="btn-group">
          <button type="button" className="btn" onClick={() => setIsFlipped(!isFlipped)}>
            <RotateCw size={14} /> Flip Perspective ({isFlipped ? 'Black' : 'White'})
          </button>
          <button type="button" className="btn" onClick={undoMove}>
            <RotateCcw size={14} /> Undo Move
          </button>
          <button type="button" className="btn btn-primary" onClick={resetGame}>
            <Play size={14} /> Reset Board
          </button>
        </div>
      </nav>

      {/* Main Workspace */}
      <div className="playground-layout">
        {/* Board & Overlay */}
        <div className="board-column">
          <div className="board-wrapper">
            {/* Live Evaluation Bar */}
            <div className="eval-bar-wrapper">
              <div
                className="eval-bar-fill"
                style={{
                  height: `${isFlipped ? 100 - whiteWinPercent : whiteWinPercent}%`,
                }}
              />
              <span className="eval-bar-text">{evalScoreString}</span>
            </div>

            {/* 8x8 Chessboard */}
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

                return (
                  <div
                    key={sq}
                    className={`board-square ${isLight ? 'square-light' : 'square-dark'} ${
                      isSelected ? 'square-selected' : ''
                    } ${isLastMoveSq ? 'square-last-move' : ''}`}
                    onClick={() => handleSquareClick(sq)}
                  >
                    {piece && (
                      <span
                        className="piece-symbol"
                        style={{ color: piece.color === 'w' ? '#ffffff' : '#000000' }}
                      >
                        {UNICODE_PIECES[piece.color === 'w' ? piece.type.toUpperCase() : piece.type]}
                      </span>
                    )}
                  </div>
                );
              })}

              {/* Dynamic SVG Arrows Overlay */}
              <svg
                className="svg-overlay-layer"
                viewBox="0 0 800 800"
                style={{ pointerEvents: 'none' }}
              >
                <defs>
                  <filter id="svg-glow" x="-20%" y="-20%" width="140%" height="140%">
                    <feDropShadow dx="0" dy="2" stdDeviation="4" flood-color="#000" flood-opacity="0.6" />
                  </filter>
                  <marker
                    id="pg-best"
                    viewBox="0 0 10 10"
                    refX="6"
                    refY="5"
                    markerWidth="6.5"
                    markerHeight="6.5"
                    orient="auto-start-reverse"
                  >
                    <path d="M 0 1.5 L 9 5 L 0 8.5 z" fill="#10b981" />
                  </marker>
                  <marker
                    id="pg-pv2"
                    viewBox="0 0 10 10"
                    refX="6"
                    refY="5"
                    markerWidth="5.5"
                    markerHeight="5.5"
                    orient="auto-start-reverse"
                  >
                    <path d="M 0 1.5 L 9 5 L 0 8.5 z" fill="#f59e0b" />
                  </marker>
                  <marker
                    id="pg-pv3"
                    viewBox="0 0 10 10"
                    refX="6"
                    refY="5"
                    markerWidth="5"
                    markerHeight="5"
                    orient="auto-start-reverse"
                  >
                    <path d="M 0 1.5 L 9 5 L 0 8.5 z" fill="#06b6d4" />
                  </marker>
                </defs>

                {/* Render MultiPV Arrows */}
                {evalData.multiPvLines.map((line, idx) => {
                  if (!line.bestMove || line.bestMove.length < 4) return null;
                  const fromSq = line.bestMove.substring(0, 2);
                  const toSq = line.bestMove.substring(2, 4);
                  const c1 = squareToCoords(fromSq);
                  const c2 = squareToCoords(toSq);
                  if (!c1 || !c2) return null;

                  const dx = c2.x - c1.x;
                  const dy = c2.y - c1.y;
                  const len = Math.sqrt(dx * dx + dy * dy);
                  if (len === 0) return null;
                  const ux = dx / len;
                  const uy = dy / len;

                  const sx = c1.x + ux * 10;
                  const sy = c1.y + uy * 10;
                  const tx = c2.x - ux * 26;
                  const ty = c2.y - uy * 26;

                  const colors = ['#10b981', '#f59e0b', '#06b6d4'];
                  const markers = ['url(#pg-best)', 'url(#pg-pv2)', 'url(#pg-pv3)'];
                  const widths = [22, 16, 12];
                  const opacities = [0.88, 0.72, 0.55];

                  // Knight check
                  const fromFile = fromSq.charCodeAt(0) - 97;
                  const fromRank = fromSq[1] ? parseInt(fromSq[1], 10) - 1 : 0;
                  const toFile = toSq.charCodeAt(0) - 97;
                  const toRank = toSq[1] ? parseInt(toSq[1], 10) - 1 : 0;
                  const isKnight =
                    (Math.abs(toFile - fromFile) === 1 && Math.abs(toRank - fromRank) === 2) ||
                    (Math.abs(toFile - fromFile) === 2 && Math.abs(toRank - fromRank) === 1);

                  let dPath = `M ${sx} ${sy} L ${tx} ${ty}`;
                  if (isKnight) {
                    const midX = (c1.x + c2.x) / 2;
                    const midY = (c1.y + c2.y) / 2;
                    dPath = `M ${sx} ${sy} Q ${midX - uy * 45} ${midY + ux * 45} ${tx} ${ty}`;
                  }

                  return (
                    <path
                      key={line.id}
                      d={dPath}
                      stroke={colors[idx] || '#a855f7'}
                      strokeWidth={widths[idx] || 10}
                      strokeOpacity={opacities[idx] || 0.5}
                      strokeLinecap="round"
                      fill="none"
                      markerEnd={markers[idx] || 'url(#pg-best)'}
                      filter="url(#svg-glow)"
                    />
                  );
                })}
              </svg>
            </div>
          </div>
        </div>

        {/* Side Panel */}
        <div className="controls-column">
          {/* Active Engine Card */}
          <div className="panel-card">
            <h2 className="panel-title">
              <Zap size={16} /> Engine Analysis
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

            {/* MultiPV Lines */}
            <div style={{ fontSize: 12, fontWeight: 700, color: '#cbd5e1', marginBottom: 6 }}>
              Top Recommended Lines (MultiPV):
            </div>
            <div className="multipv-list">
              {evalData.multiPvLines.length > 0 ? (
                evalData.multiPvLines.map((line) => (
                  <div key={line.id} className="multipv-item">
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span className={`line-badge line-${line.id}`}>#{line.id}</span>
                      <span className="move-algebraic">{line.bestMove}</span>
                      <span style={{ color: line.scoreCp && line.scoreCp >= 0 ? '#38bdf8' : '#f87171', fontWeight: 600 }}>
                        {line.scoreMate !== null
                          ? `M${line.scoreMate}`
                          : line.scoreCp !== null
                          ? `${(line.scoreCp / 100).toFixed(2)}`
                          : ''}
                      </span>
                    </div>
                    <div className="pv-preview">{line.pv.slice(0, 6).join(' ')}</div>
                  </div>
                ))
              ) : (
                <div style={{ fontSize: 12, color: '#64748b', fontStyle: 'italic', padding: 8 }}>
                  Calculating best lines...
                </div>
              )}
            </div>
          </div>

          {/* Famous Position Presets */}
          <div className="panel-card">
            <h2 className="panel-title">
              <Award size={16} /> Famous Tactical Presets
            </h2>
            <div className="btn-group">
              {PRESETS.map((p) => (
                <button key={p.name} type="button" className="btn" onClick={() => loadPreset(p.fen)}>
                  <ChevronRight size={12} /> {p.name}
                </button>
              ))}
            </div>
          </div>

          {/* FEN Management */}
          <div className="panel-card">
            <h2 className="panel-title">Position FEN</h2>
            <div style={{ fontSize: 11, color: '#94a3b8', wordBreak: 'break-all', fontFamily: 'monospace' }}>
              {fen}
            </div>
            <form onSubmit={handleCustomFenSubmit} className="fen-input-row">
              <input
                type="text"
                placeholder="Paste custom FEN string..."
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
