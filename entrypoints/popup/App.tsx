import React, { useState, useEffect, useRef } from 'react';
import { getSettings, saveSettings, DEFAULT_SETTINGS } from '../../lib/storage';
import { capsFor } from '../../lib/engine-capabilities';
import { OPENING_CATALOG } from '../../lib/openings/catalog';
import OpeningBrowser from './components/OpeningBrowser';
import { getBallMaeGyiTuning, getStockfishTuning, mapEloToBallMaeGyiSkill } from '../../lib/engine-tuning';
import type { EngineSettings, EngineEvaluation, EngineCapabilities, OpeningMode } from '../../lib/types';
import {
  Activity, RotateCcw, ExternalLink, Eye, Sliders, ShieldAlert,
  Server, Terminal,
} from 'lucide-react';

type Tab = 'engine' | 'board' | 'analysis' | 'strength' | 'opening' | 'advanced';

const TAB_RESET_KEYS: Record<Tab, (keyof EngineSettings)[]> = {
  engine: ['activeEngineId'],
  board: ['showHighlights', 'highlightPlayerMoves', 'highlightOpponentMoves', 'showArrows',
    'showEvalBar', 'showHud', 'highlighterOpacity', 'showNumberCircles', 'highlightShape'],
  analysis: ['depth', 'multiPv', 'autoAnalyze'],
  strength: ['limitStrength', 'targetElo', 'ballmaegyiPersonality', 'ballmaegyiElo',
    'ballmaegyiPerformance', 'ballmaegyiManualDepth'],
  opening: ['opening'],
  advanced: ['hashMb', 'threads'],
};

const BUILTIN_ENGINES = [
  { id: 'stockfish', label: 'Stockfish 17' },
  { id: 'ballmaegyi', label: 'BallMaeGyi 5.1' },
  { id: 'maia3', label: 'Maia-3' },
  { id: 'maia2', label: 'Maia-2' },
];

export default function App() {
  const [tab, setTab] = useState<Tab>('engine');
  const [settings, setSettings] = useState<EngineSettings>(DEFAULT_SETTINGS);
  const [currentEval, setCurrentEval] = useState<EngineEvaluation | null>(null);
  const [capabilities, setCapabilities] = useState<EngineCapabilities | null>(null);
  const [savedBadge, setSavedBadge] = useState(false);
  const [optionSearch, setOptionSearch] = useState('');
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tabRef = useRef<Tab>('engine');

  useEffect(() => {
    getSettings().then((s) => {
      setSettings(s);
      const initialTab = ((s.lastPopupTab as Tab) || 'engine');
      setTab(initialTab);
      tabRef.current = initialTab;
    });
    chrome.runtime.sendMessage({ target: 'popup', type: 'GET_CURRENT_EVAL' }, (res: any) => {
      if (res) {
        if (res.evaluation) setCurrentEval(res.evaluation);
        if (res.capabilities) setCapabilities(res.capabilities);
      }
    });
    const onMsg = (msg: any) => {
      if (msg.target === 'content' && msg.type === 'EVAL_UPDATE') setCurrentEval(msg.evaluation);
      else if (msg.target === 'popup' && msg.type === 'ENGINE_CAPABILITIES') setCapabilities(msg.capabilities);
    };
    chrome.runtime.onMessage.addListener(onMsg);
    return () => chrome.runtime.onMessage.removeListener(onMsg);
  }, []);

  const setActiveTab = (t: Tab) => {
    setTab(t);
    tabRef.current = t;
    saveSettings({ lastPopupTab: t });
  };

  const activeCaps = capsFor(settings.activeEngineId, capabilities);
  const maxThreads = navigator.hardwareConcurrency || 8;

  const resolveDepth = (s: EngineSettings): number => {
    if (s.activeEngineId === 'ballmaegyi' && !s.ballmaegyiManualDepth && s.ballmaegyiPersonality !== 'full_strength')
      return getBallMaeGyiTuning(s).recommendedDepth;
    if (s.activeEngineId === 'stockfish' && s.limitStrength) return getStockfishTuning(s).maxDepth;
    if (s.activeEngineId === 'maia2' || s.activeEngineId === 'maia3') return 1;
    return s.depth || 16;
  };

  const apply = async (patch: Partial<EngineSettings>) => {
    const next = { ...settings, ...patch };
    const autoDepth = resolveDepth(next);
    const isAuto =
      (next.activeEngineId === 'ballmaegyi' && !next.ballmaegyiManualDepth && next.ballmaegyiPersonality !== 'full_strength') ||
      (next.activeEngineId === 'stockfish' && next.limitStrength) ||
      next.activeEngineId === 'maia2' || next.activeEngineId === 'maia3';
    if (isAuto) next.depth = autoDepth;
    setSettings(next);
    if (patch.activeEngineId) {
      chrome.runtime.sendMessage({ target: 'engine', type: 'SWITCH_ENGINE', engineId: String(patch.activeEngineId) });
    }
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      await saveSettings(next);
      setSavedBadge(true);
      setTimeout(() => setSavedBadge(false), 1000);
    }, 100);
  };

  const resetTab = async () => {
    const keys = TAB_RESET_KEYS[tabRef.current] || [];
    const patch: Partial<EngineSettings> = {};
    for (const k of keys) (patch as any)[k] = (DEFAULT_SETTINGS as any)[k];
    const next = { ...settings, ...patch };
    setSettings(next);
    await saveSettings(next);
    setSavedBadge(true);
    setTimeout(() => setSavedBadge(false), 1000);
  };

  const openPlayground = () => chrome.tabs.create({ url: chrome.runtime.getURL('playground.html') });

  const isBallMaeGyi = settings.activeEngineId === 'ballmaegyi';
  const isStockfish = settings.activeEngineId === 'stockfish';
  const isMaia2 = settings.activeEngineId === 'maia2';
  const isMaia3 = settings.activeEngineId === 'maia3';
  const effectiveDepth = resolveDepth(settings);
  const isDepthAuto = (isBallMaeGyi && !settings.ballmaegyiManualDepth && settings.ballmaegyiPersonality !== 'full_strength') || (isStockfish && settings.limitStrength) || isMaia2 || isMaia3;

  return (
    <div className="popup-shell flex flex-col bg-base-100 text-base-content" data-theme="dark">
      <div className="navbar bg-base-200 px-3 py-2 min-h-0 border-b border-base-300">
        <div className="flex-1 flex items-center gap-2">
          <span className="text-2xl leading-none">♞</span>
          <div className="leading-tight">
            <div className="text-sm font-bold">Chess Engine</div>
            <div className="text-[11px] opacity-60">by codewiththiha · chess.com only</div>
          </div>
        </div>
      </div>

      {currentEval && (
        <div className="mx-3 mt-2 p-3 rounded-lg bg-base-200/70 border border-base-300">
          <div className="flex items-center justify-between text-xs mb-1">
            <span className="flex items-center gap-1 opacity-80"><Activity size={12}/> Live position</span>
            <span className="badge badge-sm badge-ghost">depth {currentEval.depth}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xl font-bold font-mono">
              {(() => {
                const isBlack = currentEval.fen?.split(' ')[1] === 'b';
                const wcp = currentEval.whiteScoreCp ?? (currentEval.scoreCp != null ? (isBlack ? -currentEval.scoreCp : currentEval.scoreCp) : null);
                const wm = currentEval.whiteScoreMate ?? (currentEval.scoreMate != null ? (isBlack ? -currentEval.scoreMate : currentEval.scoreMate) : null);
                if (wm != null) return `M${wm > 0 ? '+' : ''}${wm}`;
                if (wcp != null) return `${wcp > 0 ? '+' : ''}${(wcp/100).toFixed(2)}`;
                return '0.00';
              })()}
            </span>
            <div className="text-right">
              <div className="text-[10px] opacity-60 uppercase tracking-wide">Best move</div>
              <div className="font-mono text-sm font-semibold text-success">{currentEval.bestMove || '…'}</div>
            </div>
          </div>
        </div>
      )}

      <div role="tablist" className="tabs tabs-boxed tabs-sm m-2 mb-1 bg-base-200 p-1 rounded-lg">
        {([
          ['engine', <Server size={12}/>, 'Engine'],
          ['board', <Eye size={12}/>, 'Board'],
          ['analysis', <Sliders size={12}/>, 'Analysis'],
          ['strength', <ShieldAlert size={12}/>, 'Strength'],
          ['opening', <span style={{fontSize:12}}>♞</span>, 'Opening'],
          ['advanced', <Terminal size={12}/>, 'UCI'],
        ] as const).map(([id, icon, label]) => (
          <button key={id} role="tab"
            className={`tab flex-1 gap-1 h-8 text-xs rounded-md ${tab === id ? 'tab-active bg-primary text-primary-content shadow-sm' : 'opacity-70 hover:opacity-100'}`}
            onClick={() => setActiveTab(id as Tab)}>
            {icon}<span>{label}</span>
          </button>
        ))}
      </div>

      <div className="flex-1 scroll-y px-3 pb-3">
        {tab === 'engine' && (
          <div className="flex flex-col gap-3">
            <label className="form-control w-full">
              <div className="label py-1"><span className="label-text">Engine</span></div>
              <select className="select select-bordered select-sm w-full" value={settings.activeEngineId} onChange={(e) => apply({ activeEngineId: e.target.value })}>
                {BUILTIN_ENGINES.map(e => <option key={e.id} value={e.id}>{e.label}</option>)}
              </select>
            </label>
            <div className="text-xs opacity-60">The overlay runs only on chess.com. On any other site the extension stays idle.</div>
          </div>
        )}

        {tab === 'board' && (
          <div className="flex flex-col gap-2">
            <label className="flex items-center justify-between cursor-pointer">
              <span className="text-sm">Highlight my moves</span>
              <input type="checkbox" className="toggle toggle-primary toggle-sm" checked={settings.highlightPlayerMoves}
                onChange={(e) => apply({ highlightPlayerMoves: e.target.checked, showHighlights: e.target.checked || settings.highlightOpponentMoves })}/>
            </label>
            <label className="flex items-center justify-between cursor-pointer">
              <span className="text-sm">Highlight opponent moves</span>
              <input type="checkbox" className="toggle toggle-primary toggle-sm" checked={settings.highlightOpponentMoves}
                onChange={(e) => apply({ highlightOpponentMoves: e.target.checked, showOpponentMoves: e.target.checked, showHighlights: e.target.checked || settings.highlightPlayerMoves })}/>
            </label>
            <label className="flex items-center justify-between cursor-pointer">
              <span className="text-sm">Show arrows</span>
              <input type="checkbox" className="toggle toggle-primary toggle-sm" checked={settings.showArrows}
                onChange={(e) => apply({ showArrows: e.target.checked, showConnectors: e.target.checked })}/>
            </label>
            <label className="flex items-center justify-between cursor-pointer">
              <span className="text-sm">Evaluation bar</span>
              <input type="checkbox" className="toggle toggle-primary toggle-sm" checked={settings.showEvalBar}
                onChange={(e) => apply({ showEvalBar: e.target.checked })}/>
            </label>
            <label className="flex items-center justify-between cursor-pointer">
              <span className="text-sm">HUD</span>
              <input type="checkbox" className="toggle toggle-primary toggle-sm" checked={!!settings.showHud}
                onChange={(e) => apply({ showHud: e.target.checked })}/>
            </label>
            <label className="flex items-center justify-between cursor-pointer">
              <span className="text-sm">Move number badges</span>
              <input type="checkbox" className="toggle toggle-primary toggle-sm" checked={!!settings.showNumberCircles}
                onChange={(e) => apply({ showNumberCircles: e.target.checked })}/>
            </label>
            <label className="form-control w-full">
              <div className="label py-1"><span className="label-text">Square corners</span></div>
              <select className="select select-bordered select-sm w-full" value={settings.highlightShape || 'square'}
                onChange={(e) => apply({ highlightShape: e.target.value as 'square' | 'rounded' })}>
                <option value="square">Square</option>
                <option value="rounded">Rounded</option>
              </select>
            </label>
            <label className="form-control w-full">
              <div className="label py-1"><span className="label-text">Opacity · {Math.round((settings.highlighterOpacity ?? 0.28)*100)}%</span></div>
              <input type="range" className="range range-primary range-xs" min="0.10" max="0.60" step="0.05" value={settings.highlighterOpacity ?? 0.28}
                onChange={(e) => apply({ highlighterOpacity: parseFloat(e.target.value) })}/>
            </label>
            <div className="divider my-1"></div>
            <div className="text-xs opacity-70">Press <kbd className="kbd kbd-xs">Alt</kbd>+<kbd className="kbd kbd-xs">H</kbd> to hide the overlay.</div>
          </div>
        )}

        {tab === 'analysis' && (
          <div className="flex flex-col gap-3">
            <label className="form-control w-full">
              <div className="label py-1">
                <span className="label-text">Depth</span>
                <span className={`label-text-alt ${isDepthAuto ? 'text-info' : ''}`}>{isDepthAuto ? `Auto · ${effectiveDepth}` : `${settings.depth} ply`}</span>
              </div>
              <input type="range" className="range range-primary range-xs" min="1" max="24" step="1" value={effectiveDepth} disabled={isDepthAuto}
                onChange={(e) => !isDepthAuto && apply({ depth: parseInt(e.target.value,10) })}/>
            </label>
            {isBallMaeGyi && settings.ballmaegyiPersonality !== 'full_strength' && (
              <label className="flex items-center justify-between cursor-pointer">
                <span className="text-sm">Manual depth</span>
                <input type="checkbox" className="toggle toggle-primary toggle-sm" checked={!!settings.ballmaegyiManualDepth}
                  onChange={(e) => apply({ ballmaegyiManualDepth: e.target.checked })}/>
              </label>
            )}
            <label className="form-control w-full">
              <div className="label py-1"><span className="label-text">Lines</span><span className="label-text-alt">{settings.multiPv}</span></div>
              <input type="range" className="range range-primary range-xs" min="1" max="4" step="1" value={settings.multiPv}
                onChange={(e) => apply({ multiPv: parseInt(e.target.value,10) })}/>
            </label>
            <label className="flex items-center justify-between cursor-pointer">
              <span className="text-sm">Auto-analyze</span>
              <input type="checkbox" className="toggle toggle-primary toggle-sm" checked={settings.autoAnalyze}
                onChange={(e) => apply({ autoAnalyze: e.target.checked })}/>
            </label>
          </div>
        )}

        {tab === 'strength' && isBallMaeGyi && (
          <div className="flex flex-col gap-3">
            <label className="form-control w-full">
              <div className="label py-1"><span className="label-text">Playstyle</span></div>
              <select className="select select-bordered select-sm w-full" value={settings.ballmaegyiPersonality || 'human'}
                onChange={(e) => apply({ ballmaegyiPersonality: e.target.value as any })}>
                <option value="aggressive">Aggressive</option>
                <option value="human">Human-like</option>
                <option value="full_strength">Full strength</option>
                <option value="solid">Solid</option>
              </select>
            </label>
            {settings.ballmaegyiPersonality !== 'full_strength' && (
              <label className="form-control w-full">
                <div className="label py-1"><span className="label-text">Target Elo</span><span className="label-text-alt">{mapEloToBallMaeGyiSkill(settings.ballmaegyiElo ?? 2200).clampedElo}</span></div>
                <input type="range" className="range range-primary range-xs" min="500" max="3000" step="100" value={settings.ballmaegyiElo ?? 2200}
                  onChange={(e) => apply({ ballmaegyiElo: parseInt(e.target.value,10) })}/>
              </label>
            )}
            <label className="form-control w-full">
              <div className="label py-1"><span className="label-text">Responsiveness</span></div>
              <select className="select select-bordered select-sm w-full" value={settings.ballmaegyiPerformance || 'responsive'}
                onChange={(e) => apply({ ballmaegyiPerformance: e.target.value as any })}>
                <option value="responsive">Instant</option>
                <option value="balanced">Balanced</option>
                <option value="deep">Deep</option>
              </select>
            </label>
          </div>
        )}

        {tab === 'strength' && (isMaia2 || isMaia3) && (
          <div className="flex flex-col gap-3">
            <label className="form-control w-full">
              <div className="label py-1"><span className="label-text">Target Elo</span><span className="label-text-alt">{settings.targetElo}</span></div>
              <input type="range" className="range range-primary range-xs" min={isMaia2 ? 1100 : 600} max={isMaia2 ? 1900 : 2600} step="100" value={settings.targetElo}
                onChange={(e) => apply({ targetElo: parseInt(e.target.value,10) })}/>
              <div className="flex gap-1 mt-2 flex-wrap">
                {(isMaia3 ? [600,1100,1500,1900,2200,2600] : [1100,1300,1500,1700,1900]).map(e => (
                  <button key={e} className={`btn btn-xs ${Math.round(settings.targetElo/100)*100 === e ? 'btn-primary' : 'btn-ghost'}`} onClick={() => apply({ targetElo: e })}>{e}</button>
                ))}
              </div>
            </label>
          </div>
        )}

        {tab === 'strength' && isStockfish && (
          <div className="flex flex-col gap-3">
            <label className="flex items-center justify-between cursor-pointer">
              <span className="text-sm">Limit strength</span>
              <input type="checkbox" className="toggle toggle-primary toggle-sm" checked={settings.limitStrength}
                onChange={(e) => apply({ limitStrength: e.target.checked })}/>
            </label>
            <label className="form-control w-full">
              <div className="label py-1"><span className="label-text">Target Elo</span><span className="label-text-alt">{settings.targetElo}</span></div>
              <input type="range" className="range range-primary range-xs" min="800" max="3000" step="25" value={settings.targetElo} disabled={!settings.limitStrength}
                onChange={(e) => apply({ targetElo: parseInt(e.target.value,10) })}/>
            </label>
          </div>
        )}

        {tab === 'opening' && (
          <div className="flex flex-col gap-2">
            <label className="flex items-center justify-between cursor-pointer">
              <span className="text-sm">Enable repertoire</span>
              <input type="checkbox" className="toggle toggle-primary toggle-sm" checked={settings.opening.enabled}
                onChange={(e) => apply({ opening: { ...settings.opening, enabled: e.target.checked } })}/>
            </label>
            <label className="flex items-center justify-between cursor-pointer" style={{ opacity: settings.opening.enabled ? 1 : 0.4 }}>
              <span className="text-sm">Adaptive matching</span>
              <input type="checkbox" className="toggle toggle-primary toggle-sm" disabled={!settings.opening.enabled}
                checked={settings.opening.adaptiveSelection ?? true}
                onChange={(e) => apply({ opening: { ...settings.opening, adaptiveSelection: e.target.checked } })}/>
            </label>
            <label className="form-control w-full" style={{ opacity: settings.opening.enabled ? 1 : 0.4 }}>
              <div className="label py-1"><span className="label-text">Mode</span></div>
              <select className="select select-bordered select-sm w-full" disabled={!settings.opening.enabled} value={settings.opening.mode}
                onChange={(e) => apply({ opening: { ...settings.opening, mode: e.target.value as OpeningMode } })}>
                <option value="adaptive">Adaptive safety</option>
                <option value="parallel">Theory + engine</option>
                <option value="coexist">Share slots</option>
                <option value="prefer">Prefer theory</option>
                <option value="hint">Theory hint</option>
                <option value="book-only">Book only</option>
                <option value="off">Off</option>
              </select>
            </label>
            <label className="form-control w-full" style={{ opacity: settings.opening.enabled ? 1 : 0.4 }}>
              <div className="label py-1"><span className="label-text">Depth</span><span className="label-text-alt">{settings.opening.maxPlies} plies</span></div>
              <input type="range" className="range range-primary range-xs" min="4" max="24" step="2" disabled={!settings.opening.enabled} value={settings.opening.maxPlies}
                onChange={(e) => apply({ opening: { ...settings.opening, maxPlies: parseInt(e.target.value,10) } })}/>
            </label>
            <div style={{ opacity: settings.opening.enabled ? 1 : 0.4 }}>
              <OpeningBrowser
                openings={OPENING_CATALOG}
                selectedIds={settings.opening.selectedOpeningIds || []}
                filters={{ categories: settings.opening.categories, includeMeme: settings.opening.includeMeme, includeWeird: settings.opening.includeWeird, maxRisk: settings.opening.maxRisk }}
                disabled={!settings.opening.enabled}
                onChange={(ids) => apply({ opening: { ...settings.opening, selectedOpeningIds: ids, repertoireId: ids.length === 1 ? ids[0]! : 'auto' } })}
                onFiltersChange={(patch) => apply({ opening: { ...settings.opening, ...patch } })}
              />
            </div>
          </div>
        )}

        {tab === 'advanced' && (
          <div className="flex flex-col gap-2">
            {activeCaps.hasHash && (
              <label className="form-control w-full">
                <div className="label py-1"><span className="label-text">Hash (MB)</span><span className="label-text-alt">{settings.hashMb}</span></div>
                <input type="range" className="range range-primary range-xs" min="16" max="256" step="16" value={settings.hashMb}
                  onChange={(e) => apply({ hashMb: parseInt(e.target.value,10) })}/>
              </label>
            )}
            {activeCaps.hasThreads && (
              <label className="form-control w-full">
                <div className="label py-1"><span className="label-text">Threads</span><span className="label-text-alt">{settings.threads}/{maxThreads}</span></div>
                <input type="range" className="range range-primary range-xs" min="1" max={maxThreads} step="1" value={settings.threads}
                  onChange={(e) => apply({ threads: parseInt(e.target.value,10) })}/>
              </label>
            )}
            <div className="divider my-1">UCI options</div>
            <input type="text" placeholder="Search…" value={optionSearch} onChange={(e) => setOptionSearch(e.target.value)} className="input input-bordered input-sm w-full"/>
            <div className="max-h-52 overflow-y-auto">
              <table className="table table-xs">
                <thead><tr><th>Option</th><th>Type</th><th>Default</th></tr></thead>
                <tbody>
                  {capabilities?.options ? Object.values(capabilities.options)
                    .filter(o => o.name.toLowerCase().includes(optionSearch.toLowerCase()))
                    .map(o => (
                      <tr key={o.name}><td className="font-mono text-[11px]">{o.name}</td><td>{o.type}</td><td className="opacity-70">{o.default !== undefined ? String(o.default) : '—'}</td></tr>
                    )) : <tr><td colSpan={3} className="text-xs opacity-60">Engine not initialized.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      <div className="flex gap-2 p-2 border-t border-base-300 bg-base-200 mt-auto">
        <button className="btn btn-primary btn-sm flex-1 gap-1" onClick={openPlayground}><ExternalLink size={14}/>Playground</button>
        <button className="btn btn-sm btn-ghost px-3" onClick={resetTab} title={`Reset ${tab} tab`}><RotateCcw size={14}/> Reset</button>
      </div>

      {savedBadge && (
        <div className="toast toast-end toast-bottom"><div className="alert alert-success alert-sm text-xs py-1 px-2">Saved</div></div>
      )}
    </div>
  );
}
