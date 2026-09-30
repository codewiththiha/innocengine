import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Chess, type Square } from 'chess.js';
import {
  Play, Pause, SkipBack, SkipForward, ChevronsLeft, ChevronsRight,
  RotateCcw, Trash2, Star, Download, BookOpen, Target, Sparkles,
  ChevronRight, RefreshCw, Eye, EyeOff,
} from 'lucide-react';
import ChessBoard from './components/ChessBoard';
import { CLASS_META, annotateGame, type MoveClass, type MoveAnnotation, type ReviewResult } from '../../lib/review-classifier';
import { listGames, getGame, putGame, deleteGame, type StoredGame } from '../../lib/game-store';
import { getSettings, saveSettings, DEFAULT_SETTINGS } from '../../lib/storage';
import { runDeepReview, type ProgressCallback } from '../../lib/dual-engine-host';
import type { EngineSettings } from '../../lib/types';

const MOVE_CLASS_ORDER: MoveClass[] = ['brilliant','great','best','book','good','inaccuracy','mistake','blunder'];

function cpToWhitePct(cp: number | null, mate: number | null): number {
  if (mate !== null) return mate > 0 ? 100 : 0;
  if (cp === null) return 50;
  const win = 1 / (1 + Math.exp(-0.00368208 * cp));
  return Math.max(3, Math.min(97, Math.round(win * 100)));
}

function formatEval(cp: number | null, mate: number | null, flipped: boolean): string {
  if (mate !== null) return `M${mate > 0 ? '+' : ''}${mate}`;
  if (cp === null) return '0.0';
  const v = flipped ? -cp : cp;
  return `${v > 0 ? '+' : ''}${(v / 100).toFixed(2)}`;
}

function toMoverCp(cp: number | null, mate: number | null, isWhite: boolean) {
  if (cp === null) return { cp: null, mate };
  return { cp: isWhite ? cp : -cp, mate: mate === null ? null : (isWhite ? mate : -mate) };
}

export default function App() {
  const [settings, setSettings] = useState<EngineSettings>(DEFAULT_SETTINGS);
  const [games, setGames] = useState<StoredGame[]>([]);
  const [activeGame, setActiveGame] = useState<StoredGame | null>(null);
  const [chess, setChess] = useState<Chess>(new Chess());
  const [ply, setPly] = useState(0);         // how many moves have been played on review board (0..moves.length)
  const [trainingMode, setTrainingMode] = useState(false);
  const [trainingGuess, setTrainingGuess] = useState<{ from: Square; to: Square } | null>(null);
  const [reviewProgress, setReviewProgress] = useState<{ ply: number; total: number; depth: number } | null>(null);
  const [reviewCanceller, setReviewCanceller] = useState<{ cancelled: boolean } | null>(null);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [boardFlipped, setBoardFlipped] = useState(false);
  const [showBestMove, setShowBestMove] = useState(false);

  // Navigation history for the current game (SAN + UCI + FEN at each ply)
  const nav = useMemo(() => {
    if (!activeGame) return { fens: [] as string[], ucis: [] as string[], sans: [] as string[], moveNumbering: [] as number[] };
    const c = new Chess(activeGame.initialFen);
    const fens = [c.fen()];
    const ucis: string[] = [];
    const sans: string[] = [];
    for (const san of activeGame.moves) {
      try {
        const mv = c.move(san);
        if (!mv) break;
        ucis.push(mv.from + mv.to + (mv.promotion || ''));
        sans.push(mv.san);
        fens.push(c.fen());
      } catch (_) { break; }
    }
    return { fens, ucis, sans };
  }, [activeGame]);

  const review = activeGame?.review;
  const currentAnnot: MoveAnnotation | null = review?.annotations?.[ply - 1] ?? null;

  const currentFen = nav.fens[ply] || chess.fen();
  const isWhiteToMove = currentFen.split(' ')[1] === 'w';

  // Current best move arrow (if any)
  const bestMoveArrow = useMemo(() => {
    if (!showBestMove || !currentAnnot) return null;
    const from = currentAnnot.bestMove.substring(0, 2) as Square;
    const to = currentAnnot.bestMove.substring(2, 4) as Square;
    if (!from || !to || from.length !== 2 || to.length !== 2) return null;
    return { from, to, color: '#81b64c' };
  }, [showBestMove, currentAnnot]);

  // Played move arrow (from→to of the actual move at this ply, after navigating to ply-1)
  const playedArrow = useMemo(() => {
    if (!activeGame || ply === 0 || !nav.ucis[ply - 1]) return null;
    const uci = nav.ucis[ply - 1]!;
    const color = currentAnnot
      ? CLASS_META[currentAnnot.classification].color
      : '#f59e0b';
    return {
      from: uci.substring(0, 2) as Square,
      to: uci.substring(2, 4) as Square,
      color,
      opacity: 0.85,
    };
  }, [activeGame, ply, nav, currentAnnot]);

  const lastMove = useMemo(() => {
    if (ply === 0) return null;
    const uci = nav.ucis[ply - 1];
    if (!uci) return null;
    return { from: uci.substring(0, 2) as Square, to: uci.substring(2, 4) as Square };
  }, [ply, nav]);

  // Settings & game loading
  useEffect(() => {
    getSettings().then(setSettings);
    refreshGames();

    // Auto-refresh when new games are saved (content script posts GAME_SAVED).
    const onMsg = (msg: any) => {
      if (msg?.target === 'review' && msg?.type === 'GAME_SAVED') {
        refreshGames();
      }
    };
    try {
      chrome?.runtime?.onMessage?.addListener?.(onMsg);
    } catch (_) {}
    const interval = setInterval(refreshGames, 2500);
    return () => {
      try { chrome?.runtime?.onMessage?.removeListener?.(onMsg); } catch (_) {}
      clearInterval(interval);
    };
  }, []);

  const refreshGames = useCallback(async () => {
    const list = await listGames({ limit: 50 });
    setGames(list);
  }, []);

  const selectGame = useCallback(async (id: string) => {
    const g = await getGame(id);
    if (g) {
      setActiveGame(g);
      setPly(g.moves.length);  // start at end of game
      setReviewError(null);
      setShowBestMove(false);
      setTrainingMode(false);
      setBoardFlipped(g.playerColor === 'b');
    }
  }, []);

  // --- Review engine ---
  const startReview = useCallback(async () => {
    if (!activeGame) return;
    const engine = settings.reviewEngineId || 'stockfish';
    const depth = settings.reviewDepth || 18;
    const multiPv = settings.reviewMultiPv || 3;

    const canceller = { cancelled: false };
    setReviewCanceller(canceller);
    setReviewError(null);

    // Mark as reviewing
    const updating = { ...activeGame, reviewStatus: 'reviewing' as const };
    await putGame(updating);
    setActiveGame(updating);
    setReviewProgress({ ply: 0, total: activeGame.moves.length, depth: 0 });

    try {
      // Build (san, uci) pairs via replay.
      const replay = new Chess(activeGame.initialFen);
      const movePairs: { san: string; uci: string }[] = [];
      for (const san of activeGame.moves) {
        try {
          const mv = replay.move(san);
          if (!mv) break;
          movePairs.push({ san: mv.san, uci: mv.from + mv.to + (mv.promotion || '') });
        } catch (_) { break; }
      }

      const onProgress: ProgressCallback = (p) => {
        setReviewProgress({ ply: p.ply, total: p.totalPlies, depth: p.depth });
      };

      const results = await runDeepReview({
        gameId: activeGame.id,
        initialFen: activeGame.initialFen,
        moves: movePairs,
        engineId: engine,
        depth,
        multiPv,
        onProgress,
        signal: canceller,
      });

      if (canceller.cancelled) return;

      // Build annotations from our per-position analyses.
      // runDeepReview returns PositionAnalysisResult[] with lines from the MOVER's perspective.
      const analyses = results.map((r) => ({
        depth: r.depth,
        lines: r.lines.map((c) => {
          const isCapture = false;
          const capturedPiece: string | null = null;
          return {
            uci: c.from + c.to + (c.promotion || ''),
            cp: c.scoreCp,
            mate: c.scoreMate,
            pv: c.pv || [c.from + c.to],
            isCapture,
            capturedPiece,
          };
        }),
      }));

      const isBookFor = () => false; // opening book lookup can be plugged in later
      const annotated = annotateGame(
        movePairs.map((m, i) => ({ san: m.san, uci: m.uci, isBook: isBookFor() && i < 14 })),
        analyses
      );

      const reviewResult: ReviewResult = {
        engineId: engine,
        depth,
        multiPv,
        reviewedAt: Date.now(),
        annotations: annotated.annotations,
        accuracy: annotated.accuracy,
        summary: annotated.summary,
      };

      const updated: StoredGame = {
        ...updating,
        reviewStatus: 'reviewed',
        review: reviewResult,
        reviewEngineId: engine,
        reviewDepth: depth,
      };
      await putGame(updated);
      setActiveGame(updated);
      setReviewProgress(null);
      refreshGames();
    } catch (e: any) {
      setReviewError(e?.message || 'Review failed');
      const errored = { ...updating, reviewStatus: 'error' as const };
      await putGame(errored);
      setActiveGame(errored);
      setReviewProgress(null);
    }
  }, [activeGame, settings, refreshGames]);

  const cancelReview = useCallback(() => {
    if (reviewCanceller) reviewCanceller.cancelled = true;
    setReviewCanceller(null);
    setReviewProgress(null);
  }, [reviewCanceller]);

  const deleteGameEntry = useCallback(async (id: string) => {
    await deleteGame(id);
    if (activeGame?.id === id) setActiveGame(null);
    refreshGames();
  }, [activeGame, refreshGames]);

  // Keyboard navigation
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT' || (e.target as HTMLElement)?.tagName === 'TEXTAREA') return;
      if (!activeGame) return;
      if (e.key === 'ArrowRight') setPly((p) => Math.min(nav.fens.length - 1, p + 1));
      else if (e.key === 'ArrowLeft') setPly((p) => Math.max(0, p - 1));
      else if (e.key === 'Home') setPly(0);
      else if (e.key === 'End') setPly(nav.fens.length - 1);
      else if (e.key === 'f' || e.key === 'F') setBoardFlipped((v) => !v);
      else if (e.key === ' ') { e.preventDefault(); setShowBestMove((v) => !v); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [activeGame, nav]);

  // Sync chess instance to current ply
  useEffect(() => {
    if (!activeGame) { setChess(new Chess()); return; }
    const c = new Chess(activeGame.initialFen);
    for (let i = 0; i < ply; i++) {
      try { c.move(activeGame.moves[i]!); } catch { break; }
    }
    setChess(c);
  }, [ply, activeGame]);

  // --- Training mode: user makes a move on the board and we compare it with the best move ---
  const handleBoardMove = useCallback((from: Square, to: Square, promotion?: string) => {
    if (!activeGame) return;
    if (!trainingMode || !currentAnnot) {
      // In casual review, don't allow making new moves; only navigate moves.
      return;
    }
    setTrainingGuess({ from, to });
  }, [activeGame, trainingMode, currentAnnot]);

  const trainingFeedback = useMemo(() => {
    if (!trainingMode || !currentAnnot || !trainingGuess) return null;
    const guessed = trainingGuess.from + trainingGuess.to;
    const best = currentAnnot.bestMove.substring(0, 4);
    const played = nav.ucis[ply - 1]?.substring(0, 4) || '';
    const isBest = guessed === best;
    const isPlayed = guessed === played;
    return { isBest, isPlayed, best };
  }, [trainingMode, currentAnnot, trainingGuess, nav, ply]);

  // Change settings
  const updateSetting = async (patch: Partial<EngineSettings>) => {
    const next = { ...settings, ...patch };
    setSettings(next);
    await saveSettings(patch);
  };

  // --- Render helpers ---
  const accuracy = review?.accuracy;
  const whiteWinPct = cpToWhitePct(
    currentAnnot?.evalBefore ?? (ply === nav.fens.length - 1 ? (currentAnnot?.evalAfter ?? null) : null),
    null
  );

  return (
    <div className="review-shell">
      {/* LEFT: Game library */}
      <aside className="col-left">
        <div className="card bg-base-200 shadow-sm">
          <h1 className="text-lg font-bold flex items-center gap-2 mb-2"><BookOpen size={18} /> Game Review</h1>
          <div className="flex gap-2 mb-3">
            <button className="btn btn-sm btn-ghost gap-1" onClick={refreshGames}><RefreshCw size={14} /> Refresh</button>
          </div>
          <div className="text-xs uppercase tracking-wide opacity-60 mb-2">Recorded games</div>
          {games.length === 0 ? (
            <div className="text-sm opacity-70 py-6 text-center">No saved games yet.</div>
          ) : (
            <div className="flex flex-col gap-1 max-h-[60vh] overflow-y-auto">
              {games.map((g) => (
                <div
                  key={g.id}
                  className={`card card-compact cursor-pointer border transition-colors ${activeGame?.id === g.id ? 'bg-primary/15 border-primary' : 'bg-base-100 border-base-300 hover:bg-base-200'}`}
                  onClick={() => selectGame(g.id)}
                >
                  <div className="card-body p-2">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-semibold">
                        {g.result === 'win' ? '🏆 Win' : g.result === 'loss' ? '✗ Loss' : g.result === 'draw' ? '½ Draw' : '•'}
                      </span>
                      <span className="opacity-60">{g.moves.length} moves</span>
                    </div>
                    <div className="text-[11px] opacity-60">
                      {g.playerColor === 'w' ? 'White' : 'Black'} · {new Date(g.endedAt || g.startedAt).toLocaleString()}
                    </div>
                    {g.reviewStatus === 'reviewed' && g.review && (
                      <div className="text-[11px]">W {g.review.accuracy.white} / B {g.review.accuracy.black}</div>
                    )}
                  </div>
                  <button
                    className="btn btn-ghost btn-xs absolute top-1 right-1 text-error"
                    onClick={(e) => { e.stopPropagation(); deleteGameEntry(g.id); }}
                    title="Delete"
                  ><Trash2 size={12}/></button>
                </div>
              ))}
            </div>
          )}
        </div>
      </aside>

      {/* CENTER: Board + moves */}
      <main className="col-center">
        {!activeGame ? (
          <div className="card bg-base-200 shadow-sm">
            <div className="card-body items-center text-center py-16">
              <Sparkles size={28} className="text-primary mb-2"/>
              <h2 className="card-title">Pick a game to review</h2>
              <p className="text-sm opacity-70 max-w-xs">Select a game from the left, or finish a game on Chess.com.</p>
            </div>
          </div>
        ) : (
          <>
            <div className="card" style={{ marginBottom: 12 }}>
              <div className="toolbar">
                <button className="btn ghost" onClick={() => setPly(0)} title="First"><ChevronsLeft size={14} /></button>
                <button className="btn ghost" onClick={() => setPly((p) => Math.max(0, p - 1))}><SkipBack size={14} /></button>
                <button className="btn ghost" onClick={() => setPly((p) => Math.min(nav.fens.length - 1, p + 1))}><SkipForward size={14} /></button>
                <button className="btn ghost" onClick={() => setPly(nav.fens.length - 1)} title="Last"><ChevronsRight size={14} /></button>
                <span className="sep" />
                <button className="btn" onClick={() => setBoardFlipped((v) => !v)}><RotateCcw size={14} /> Flip</button>
                <button className={`btn ${showBestMove ? 'primary' : ''}`} onClick={() => setShowBestMove((v) => !v)}>
                  {showBestMove ? <Eye size={14} /> : <EyeOff size={14} />} {showBestMove ? 'Hide' : 'Show'} best
                </button>
                <span className="sep" />
                <label className="training-toggle">
                  <input
                    type="checkbox"
                    checked={trainingMode}
                    onChange={(e) => { setTrainingMode(e.target.checked); setTrainingGuess(null); }}
                  />
                  <Target size={14} /> Training mode
                </label>
                <span style={{ flex: 1 }} />
                <button className="btn danger ghost" onClick={() => deleteGameEntry(activeGame.id)} title="Delete game">
                  <Trash2 size={14} />
                </button>
              </div>

              <div className="eval-bar-h" aria-label="Evaluation bar">
                <div className="fill" style={{
                  width: `${isWhiteToMove ? whiteWinPct : 100 - whiteWinPct}%`,
                  background: isWhiteToMove ? '#f3f3f3' : '#111',
                }} />
                <div className="label" style={{ color: isWhiteToMove ? '#111' : '#f3f3f3', mixBlendMode: 'normal' }}>
                  {formatEval(
                    currentAnnot?.evalBefore ?? (ply > 0 ? currentAnnot?.evalAfter ?? null : null),
                    null,
                    boardFlipped
                  )}
                </div>
              </div>

              <div className="board-section">
                <div className="board-wrap">
                  <ChessBoard
                    fen={chess.fen()}
                    flipped={boardFlipped}
                    lastMove={lastMove}
                    bestMove={bestMoveArrow ? { from: bestMoveArrow.from, to: bestMoveArrow.to } : null}
                    arrows={[bestMoveArrow, playedArrow].filter(Boolean) as any}
                    onMove={handleBoardMove}
                    onSquareClick={(sq) => { if (trainingMode) setTrainingGuess(null); }}
                    disabled={!trainingMode}
                  />
                </div>

                <div className="move-list-wrap">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                    <div className="section-title" style={{ margin: 0 }}>Moves</div>
                    {review?.summary && (
                      <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>
                        {MOVE_CLASS_ORDER.map((c) => {
                          const n = review.summary[c];
                          if (!n) return null;
                          return (
                            <span key={c} title={CLASS_META[c].label} style={{ marginRight: 8 }}>
                              <span className="chip" style={{
                                background: CLASS_META[c].bg,
                                color: CLASS_META[c].color,
                                borderColor: CLASS_META[c].border,
                                display: 'inline-flex', width: 20, height: 20,
                              }}>{CLASS_META[c].symbol}</span>{' '}
                              <span style={{ color: 'var(--text)' }}>{n}</span>
                            </span>
                          );
                        })}
                      </div>
                    )}
                  </div>
                  <div className="move-list-scroll">
                    {Array.from({ length: Math.ceil(nav.sans.length / 2) }).map((_, rowIdx) => {
                      const iw = rowIdx * 2;
                      const ib = iw + 1;
                      const w = nav.sans[iw];
                      const b = nav.sans[ib];
                      const wAnn = review?.annotations?.[iw];
                      const bAnn = review?.annotations?.[ib];
                      return (
                        <div key={rowIdx} className="move-row">
                          <span className="move-num">{rowIdx + 1}.</span>
                          <span
                            className={`move-cell ${ply === iw + 1 ? 'active' : ''}`}
                            onClick={() => setPly(iw + 1)}
                          >
                            {wAnn && <ClassChip cls={wAnn.classification} />}
                            <span>{w}</span>
                          </span>
                          {b && (
                            <span
                              className={`move-cell ${ply === ib + 1 ? 'active' : ''}`}
                              onClick={() => setPly(ib + 1)}
                            >
                              {bAnn && <ClassChip cls={bAnn.classification} />}
                              <span>{b}</span>
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {currentAnnot && (
                    <div className="comment-card" style={{ borderLeftColor: CLASS_META[currentAnnot.classification].color }}>
                      <div className="title" style={{ color: CLASS_META[currentAnnot.classification].color }}>
                        <span className="chip" style={{
                          background: CLASS_META[currentAnnot.classification].bg,
                          color: CLASS_META[currentAnnot.classification].color,
                          borderColor: CLASS_META[currentAnnot.classification].border,
                        }}>{CLASS_META[currentAnnot.classification].symbol}</span>
                        {CLASS_META[currentAnnot.classification].label}
                        {' · '}
                        <span style={{ fontWeight: 400, color: 'var(--text-dim)' }}>
                          {currentAnnot.cpLoss} cp lost
                        </span>
                      </div>
                      <div>{CLASS_META[currentAnnot.classification].description}</div>
                      {currentAnnot.bestMove && currentAnnot.bestMoveSan && (
                        <div className="bestmove-hint">
                          Better: <strong style={{ color: 'var(--accent)', marginLeft: 4 }}>
                            {currentAnnot.bestMoveSan}
                          </strong>
                        </div>
                      )}
                      {trainingMode && trainingFeedback && (
                        <div style={{ marginTop: 8, fontSize: 12 }}>
                          {trainingFeedback.isBest
                            ? '🎯 Perfect! That was the engine\'s top choice.'
                            : trainingFeedback.isPlayed
                            ? '✓ You found the move actually played.'
                            : `Not quite. The best move was ${trainingFeedback.best}. Try again or press → to continue.`}
                        </div>
                      )}
                    </div>
                  )}

                  <div className="hint-row">
                    <span><span className="kbd">←</span><span className="kbd">→</span> navigate moves</span>
                    <span><span className="kbd">Space</span> toggle best-move arrow</span>
                    <span><span className="kbd">F</span> flip board</span>
                  </div>
                </div>
              </div>
            </div>
          </>
        )}
      </main>

      {/* RIGHT: Engine, review controls, accuracy */}
      <aside className="col-right flex flex-col gap-3">
        <div className="card bg-base-200 shadow-sm">
          <div className="card-body p-3 gap-3">
            <h2 className="card-title text-sm"><Sparkles size={14}/> Analysis</h2>

            {activeGame ? (
              <>
                <label className="form-control w-full">
                  <div className="label py-0.5"><span className="label-text text-xs">Engine</span></div>
                  <select className="select select-sm select-bordered w-full" value={settings.reviewEngineId}
                    onChange={(e) => updateSetting({ reviewEngineId: e.target.value as any })}>
                    <option value="stockfish">Stockfish 17</option>
                    <option value="ballmaegyi">BallMaeGyi 5.1</option>
                  </select>
                </label>
                <label className="form-control w-full">
                  <div className="label py-0.5"><span className="label-text text-xs">Depth</span><span className="label-text-alt">{settings.reviewDepth} ply</span></div>
                  <input type="range" className="range range-primary range-xs" min={12} max={24} step={1} value={settings.reviewDepth}
                    onChange={(e) => updateSetting({ reviewDepth: parseInt(e.target.value,10) })}/>
                </label>
                <label className="form-control w-full">
                  <div className="label py-0.5"><span className="label-text text-xs">Lines</span><span className="label-text-alt">{settings.reviewMultiPv}</span></div>
                  <input type="range" className="range range-primary range-xs" min={2} max={5} step={1} value={settings.reviewMultiPv}
                    onChange={(e) => updateSetting({ reviewMultiPv: parseInt(e.target.value,10) })}/>
                </label>

                {reviewProgress ? (
                  <>
                    <button className="btn btn-sm btn-error" onClick={cancelReview}><Pause size={14} /> Cancel</button>
                    <progress className="progress progress-primary w-full" value={reviewProgress.ply} max={Math.max(1, reviewProgress.total)}></progress>
                    <div className="text-xs opacity-60">Move {reviewProgress.ply + 1} / {reviewProgress.total} · depth {reviewProgress.depth}</div>
                  </>
                ) : (
                  <button className="btn btn-sm btn-primary" onClick={startReview}
                    disabled={reviewCanceller !== null || activeGame.reviewStatus === 'reviewing'}>
                    <Sparkles size={14}/>
                    {activeGame.reviewStatus === 'reviewed' ? 'Re-analyze' : 'Analyze game'}
                  </button>
                )}
                {reviewError && <div className="text-xs text-error">{reviewError}</div>}
              </>
            ) : (
              <div className="text-xs opacity-60 py-2">Select a game first.</div>
            )}
          </div>
        </div>

        {activeGame?.review && accuracy && (
          <div className="card bg-base-200 shadow-sm">
            <div className="card-body p-3">
              <h2 className="card-title text-sm mb-1">Accuracy</h2>
              <div className="flex items-center gap-3 mb-2">
                <div className="stat bg-base-100 rounded-lg p-2 flex-1 text-center">
                  <div className="stat-value text-xl">{accuracy.white}</div>
                  <div className="stat-desc">White</div>
                </div>
                <div className="stat bg-base-100 rounded-lg p-2 flex-1 text-center">
                  <div className="stat-value text-xl">{accuracy.black}</div>
                  <div className="stat-desc">Black</div>
                </div>
              </div>
              <div className="flex flex-col gap-1">
                {MOVE_CLASS_ORDER.map((c) => (
                  <div key={c} className="flex items-center gap-2 text-xs">
                    <span className="w-6 h-6 flex items-center justify-center text-[10px] rounded" style={{
                      background: CLASS_META[c].bg, color: CLASS_META[c].color, border: '1px solid ' + CLASS_META[c].border
                    }}>{CLASS_META[c].symbol}</span>
                    <span className="flex-1">{CLASS_META[c].label}</span>
                    <span className="opacity-60">{activeGame.review!.summary[c] || 0}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        <div className="card bg-base-200 shadow-sm">
          <div className="card-body p-3 gap-2">
            <h2 className="card-title text-sm">Auto-save</h2>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" className="checkbox checkbox-sm checkbox-primary" checked={!!settings.autoRecordGames}
                onChange={(e) => updateSetting({ autoRecordGames: e.target.checked })}/>
              <span className="text-xs">Record finished games</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" className="checkbox checkbox-sm checkbox-primary" checked={!!settings.autoReview}
                onChange={(e) => updateSetting({ autoReview: e.target.checked })}/>
              <span className="text-xs">Auto-analyze after each game</span>
            </label>
            <div className="text-[11px] opacity-60">Games stay in your browser; analysis runs locally.</div>
          </div>
        </div>

        <div className="text-center text-[10px] opacity-40 pb-2">by codewiththiha</div>
      </aside>
    </div>
  );
}

function ClassChip({ cls }: { cls: MoveClass }) {
  return (
    <span
      className="chip"
      title={CLASS_META[cls].label}
      style={{
        background: CLASS_META[cls].bg,
        color: CLASS_META[cls].color,
        borderColor: CLASS_META[cls].border,
        fontSize: 10,
        width: 20, height: 20,
        marginRight: 4,
      }}
    >
      {CLASS_META[cls].symbol}
    </span>
  );
}
