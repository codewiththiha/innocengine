import React, { useState, useEffect, useRef } from 'react';
import { Chess, type Square } from 'chess.js';
import { RotateCw, Play, RotateCcw, Award, ChevronRight, Zap } from 'lucide-react';
import type { EngineEvaluation, MoveLine, EngineCandidate } from '../../lib/types';
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

const VARIATION_COLORS: Record<number, { fill: string; stroke: string; line: string; label: string }> = {
  1: { fill: 'rgba(245, 158, 11, 0.20)', stroke: 'rgba(245, 158, 11, 0.85)', line: '#f59e0b', label: 'Primary (Amber)' },
  2: { fill: 'rgba(59, 130, 246, 0.16)', stroke: 'rgba(59, 130, 246, 0.75)', line: '#3b82f6', label: 'Alternative 2 (Blue)' },
  3: { fill: 'rgba(168, 85, 247, 0.14)', stroke: 'rgba(168, 85, 247, 0.65)', line: '#a855f7', label: 'Alternative 3 (Violet)' },
};

export default function App() {
  const [chess, setChess] = useState<Chess>(new Chess());
  const [fen, setFen] = useState<string>(chess.fen());
  const [selectedSquare, setSelectedSquare] = useState<Square | null>(null);
  const [isFlipped, setIsFlipped] = useState<boolean>(false);
  const [customFenInput, setCustomFenInput] = useState<string>('');
  const [lastMove, setLastMove] = useState<{ from: string; to: string } | null>(null);
  const [multiPvCount, setMultiPvCount] = useState<number>(2);

  const [committedCandidates, setCommittedCandidates] = useState<EngineCandidate[]>([]);
  const [evalData, setEvalData] = useState<EngineEvaluation>({
    engineInstanceId: 'stockfish',
    analysisId: 1,
    positionKey: '',
    fen: chess.fen(),
    depth: 0,
    scoreCp: 0,
    scoreMate: null,
    bestMove: null,
    multiPvLines: [],
    candidates: [],
    isCalculating: false,
    timestamp: Date.now(),
  });

  const workerRef = useRef<Worker | null>(null);
  const currentAnalysisIdRef = useRef<number>(1);
  const stabilityTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

      analyzePosition(chess.fen(), multiPvCount, worker);
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
    if (line.startsWith('bestmove')) {
      // Atomic commit of final search decision
      const parts = line.split(/\s+/);
      const finalMove = parts[1];
      if (finalMove && finalMove !== '(none)') {
        setEvalData((prev) => {
          const finalCandidate: EngineCandidate = {
            pvId: 1,
            from: finalMove.substring(0, 2),
            to: finalMove.substring(2, 4),
            depth: prev.depth,
            scoreCp: prev.scoreCp,
            scoreMate: prev.scoreMate,
            pv: [finalMove],
          };
          const updatedCandidates = [finalCandidate, ...prev.candidates.filter((c) => c.pvId > 1)];
          setCommittedCandidates(updatedCandidates);
          return {
            ...prev,
            bestMove: finalMove,
            isCalculating: false,
            candidates: updatedCandidates,
          };
        });
      }
      return;
    }

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

    if (bestMove && bestMove.length >= 4) {
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

        const candidateList: EngineCandidate[] = existingLines.map((l) => ({
          pvId: l.id,
          from: l.bestMove.substring(0, 2),
          to: l.bestMove.substring(2, 4),
          depth: l.depth,
          scoreCp: l.scoreCp,
          scoreMate: l.scoreMate,
          pv: l.pv,
        }));

        // Apply stability filter before updating board highlights
        if (depth >= 4 && candidateList.length > 0) {
          if (!stabilityTimerRef.current) {
            stabilityTimerRef.current = setTimeout(() => {
              stabilityTimerRef.current = null;
              setCommittedCandidates(candidateList);
            }, 180);
          }
        }

        return {
          ...prev,
          depth: Math.max(prev.depth, depth),
          scoreCp: primary.scoreCp,
          scoreMate: primary.scoreMate,
          bestMove: primary.bestMove,
          multiPvLines: existingLines,
          candidates: candidateList,
          isCalculating: true,
        };
      });
    }
  };

  const analyzePosition = (fenStr: string, pvCount: number, workerInstance?: Worker) => {
    const w = workerInstance || workerRef.current;
    if (!w) return;

    if (stabilityTimerRef.current) {
      clearTimeout(stabilityTimerRef.current);
      stabilityTimerRef.current = null;
    }

    currentAnalysisIdRef.current++;
    const posKey = fenStr.split(' ').slice(0, 4).join(' ');

    w.postMessage('stop');
    w.postMessage(`setoption name MultiPV value ${pvCount}`);
    w.postMessage(`position fen ${fenStr}`);
    w.postMessage('go depth 16');

    setCommittedCandidates([]);
    setEvalData((prev) => ({
      ...prev,
      analysisId: currentAnalysisIdRef.current,
      positionKey: posKey,
      fen: fenStr,
      depth: 0,
      bestMove: null,
      multiPvLines: [],
      candidates: [],
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
          analyzePosition(newFen, multiPvCount);
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
      analyzePosition(presetFen, multiPvCount);
    } catch (err) {
      console.error('Invalid FEN:', err);
    }
  };

  const handleMultiPvChange = (newCount: number) => {
    setMultiPvCount(newCount);
    analyzePosition(chess.fen(), newCount);
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
    analyzePosition(newFen, multiPvCount);
  };

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

  // Pre-calculate square candidate highlight styles
  const squareHighlightStyles = new Map<string, { fill: string; stroke: string }>();
  committedCandidates.forEach((candidate) => {
    const pal = VARIATION_COLORS[candidate.pvId] || VARIATION_COLORS[1] || {
      fill: 'rgba(245, 158, 11, 0.20)',
      stroke: 'rgba(245, 158, 11, 0.85)',
      line: '#f59e0b',
      label: 'Primary',
    };
    squareHighlightStyles.set(candidate.from, { fill: pal.fill, stroke: pal.stroke });
    squareHighlightStyles.set(candidate.to, { fill: pal.fill, stroke: pal.stroke });
  });

  return (
    <div className="playground-root">
      <nav className="playground-nav">
        <div className="brand-section">
          <div className="brand-logo" style={{ color: '#f59e0b' }}>♔</div>
          <div>
            <h1 className="brand-title">Chess AI Move Overlay</h1>
            <p className="brand-subtitle">
              Board-First Architecture: 1 Color per Candidate Move Pair • Zero Flicker
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

            <div className="board-container" style={{ position: 'relative' }}>
              {/* Board 8x8 squares */}
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
                const hlStyle = squareHighlightStyles.get(sq);

                return (
                  <div
                    key={sq}
                    className={`board-square ${isLight ? 'square-light' : 'square-dark'} ${
                      isSelected ? 'square-selected' : ''
                    } ${isLastMoveSq ? 'square-last-move' : ''}`}
                    onClick={() => handleSquareClick(sq)}
                  >
                    {hlStyle && (
                      <div
                        style={{
                          position: 'absolute',
                          inset: 0,
                          backgroundColor: hlStyle.fill,
                          boxShadow: `inset 0 0 0 2px ${hlStyle.stroke}`,
                          borderRadius: 3,
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

              {/* Restrained SVG Connector Layer */}
              <svg
                viewBox="0 0 8 8"
                style={{
                  position: 'absolute',
                  inset: 0,
                  width: '100%',
                  height: '100%',
                  pointerEvents: 'none',
                  zIndex: 4,
                }}
              >
                <defs>
                  <marker id="pg-arrow-1" viewBox="0 0 6 6" refX="4.5" refY="3" markerWidth="0.32" markerHeight="0.32" orient="auto-start-reverse">
                    <path d="M 0 0.5 L 5 3 L 0 5.5 z" fill="#f59e0b" />
                  </marker>
                  <marker id="pg-arrow-2" viewBox="0 0 6 6" refX="4.5" refY="3" markerWidth="0.32" markerHeight="0.32" orient="auto-start-reverse">
                    <path d="M 0 0.5 L 5 3 L 0 5.5 z" fill="#3b82f6" />
                  </marker>
                  <marker id="pg-arrow-3" viewBox="0 0 6 6" refX="4.5" refY="3" markerWidth="0.32" markerHeight="0.32" orient="auto-start-reverse">
                    <path d="M 0 0.5 L 5 3 L 0 5.5 z" fill="#a855f7" />
                  </marker>
                </defs>
                {committedCandidates.map((candidate) => {
                  const pal = VARIATION_COLORS[candidate.pvId] || VARIATION_COLORS[1] || {
                    fill: 'rgba(245, 158, 11, 0.20)',
                    stroke: 'rgba(245, 158, 11, 0.85)',
                    line: '#f59e0b',
                    label: 'Primary',
                  };
                  if (!candidate.from[1] || !candidate.to[1]) return null;
                  const fromFile = candidate.from.charCodeAt(0) - 97;
                  const fromRank = parseInt(candidate.from[1], 10) - 1;
                  const toFile = candidate.to.charCodeAt(0) - 97;
                  const toRank = parseInt(candidate.to[1], 10) - 1;

                  const sx = isFlipped ? 7 - fromFile + 0.5 : fromFile + 0.5;
                  const sy = isFlipped ? fromRank + 0.5 : 7 - fromRank + 0.5;
                  const ex = isFlipped ? 7 - toFile + 0.5 : toFile + 0.5;
                  const ey = isFlipped ? toRank + 0.5 : 7 - toRank + 0.5;

                  const dx = ex - sx;
                  const dy = ey - sy;
                  const dist = Math.sqrt(dx * dx + dy * dy);
                  if (dist < 0.4) return null;

                  const offS = 0.22;
                  const offE = 0.28;
                  const lx1 = sx + (dx / dist) * offS;
                  const ly1 = sy + (dy / dist) * offS;
                  const lx2 = ex - (dx / dist) * offE;
                  const ly2 = ey - (dy / dist) * offE;

                  return (
                    <line
                      key={`${candidate.pvId}-${candidate.from}-${candidate.to}`}
                      x1={lx1}
                      y1={ly1}
                      x2={lx2}
                      y2={ly2}
                      stroke={pal.line}
                      strokeWidth="0.026"
                      strokeLinecap="round"
                      markerEnd={`url(#pg-arrow-${Math.min(3, candidate.pvId)})`}
                    />
                  );
                })}
              </svg>
            </div>
          </div>

          {/* Palette Legend */}
          <div style={{ display: 'flex', gap: 20, fontSize: 12, marginTop: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span
                style={{
                  width: 14,
                  height: 14,
                  borderRadius: 3,
                  backgroundColor: 'rgba(245, 158, 11, 0.25)',
                  border: '1px solid #f59e0b',
                }}
              />
              <span>PV 1: Warm Amber (Primary Move)</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span
                style={{
                  width: 14,
                  height: 14,
                  borderRadius: 3,
                  backgroundColor: 'rgba(59, 130, 246, 0.25)',
                  border: '1px solid #3b82f6',
                }}
              />
              <span>PV 2: Cool Steel Blue</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span
                style={{
                  width: 14,
                  height: 14,
                  borderRadius: 3,
                  backgroundColor: 'rgba(168, 85, 247, 0.25)',
                  border: '1px solid #a855f7',
                }}
              />
              <span>PV 3: Muted Violet</span>
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
                <div style={{ fontSize: 24, fontWeight: 800, color: '#f59e0b' }}>{evalScoreString}</div>
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
              <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 4 }}>Committed Candidates:</div>
              {committedCandidates.length === 0 ? (
                <div style={{ color: '#64748b', fontSize: 13 }}>Analyzing position...</div>
              ) : (
                committedCandidates.map((c) => {
                  const pal = VARIATION_COLORS[c.pvId] || VARIATION_COLORS[1] || {
                    fill: 'rgba(245, 158, 11, 0.20)',
                    stroke: 'rgba(245, 158, 11, 0.85)',
                    line: '#f59e0b',
                    label: 'Primary',
                  };
                  return (
                    <div
                      key={`${c.pvId}-${c.from}${c.to}`}
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        fontSize: 14,
                        fontFamily: 'monospace',
                        color: pal.line,
                        marginTop: 2,
                      }}
                    >
                      <span>Line {c.pvId}: {c.from} → {c.to}</span>
                      <span style={{ color: '#94a3b8', fontSize: 12 }}>
                        {c.scoreMate !== null ? `M${c.scoreMate}` : `${((c.scoreCp || 0) / 100).toFixed(2)}`}
                      </span>
                    </div>
                  );
                })
              )}
            </div>

            <div style={{ marginTop: 14 }}>
              <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 6 }}>
                MultiPV Variations: {multiPvCount}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                {[1, 2, 3].map((cnt) => (
                  <button
                    key={cnt}
                    type="button"
                    className={`btn ${multiPvCount === cnt ? 'btn-primary' : ''}`}
                    onClick={() => handleMultiPvChange(cnt)}
                  >
                    {cnt} {cnt === 1 ? 'Line' : 'Lines'}
                  </button>
                ))}
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
