import React, { useState, useEffect, useRef } from 'react';
import { getSettings, saveSettings, DEFAULT_SETTINGS } from '../../lib/storage';
import { EngineRegistry, type BUILTIN_STOCKFISH } from '../../lib/engine-registry';
import { capsFor } from '../../lib/engine-capabilities';
import { REPERTOIRE_LIST } from '../../lib/opening-book';
import { OPENING_CATALOG } from '../../lib/openings/catalog';
import OpeningBrowser from './components/OpeningBrowser';
import { getEngineStrengthDescription, mapEloToPatriciaSkill, getPatriciaTuning, getStockfishTuning } from '../../lib/engine-tuning';
import type {
  EngineSettings,
  EngineEvaluation,
  EngineCapabilities,
  EngineTelemetry,
  CustomEngineMeta,
} from '../../lib/types';
import {
  Sliders,
  Eye,
  ExternalLink,
  RotateCcw,
  Sparkles,
  Activity,
  CheckCircle2,
  Cpu,
  BookOpen,
  Terminal,
  ShieldAlert,
  Server,
  UploadCloud,
  Lock,
  Flame,
} from 'lucide-react';
import './App.css';

type SettingsTab = 'engine' | 'board' | 'analysis' | 'strength' | 'resources' | 'opening' | 'advanced';

export default function App() {
  const [activeTab, setActiveTab] = useState<SettingsTab>('engine');
  const [settings, setSettings] = useState<EngineSettings>(DEFAULT_SETTINGS);
  const [currentEval, setCurrentEval] = useState<EngineEvaluation | null>(null);
  const [capabilities, setCapabilities] = useState<EngineCapabilities | null>(null);
  const [telemetry, setTelemetry] = useState<EngineTelemetry | null>(null);
  const [installedEngines, setInstalledEngines] = useState<CustomEngineMeta[]>([]);
  const [engineStatus, setEngineStatus] = useState<'ready' | 'loading' | 'analyzing'>('ready');
  const [savedBadge, setSavedBadge] = useState<boolean>(false);
  const [optionSearch, setOptionSearch] = useState<string>('');
  const [importStatus, setImportStatus] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const activeCaps = capsFor(settings.activeEngineId, capabilities);

  useEffect(() => {
    getSettings().then((s) => setSettings(s));
    refreshEnginesList();

    chrome.runtime.sendMessage({ target: 'popup', type: 'GET_CURRENT_EVAL' }, (res: any) => {
      if (res) {
        if (res.evaluation) {
          setCurrentEval(res.evaluation);
          if (res.evaluation.isCalculating) setEngineStatus('analyzing');
        }
        if (res.capabilities) setCapabilities(res.capabilities);
        if (res.telemetry) setTelemetry(res.telemetry);
      }
    });

    const listener = (msg: any) => {
      if (msg.target === 'content' && msg.type === 'EVAL_UPDATE') {
        setCurrentEval(msg.evaluation);
        setEngineStatus(msg.evaluation.isCalculating ? 'analyzing' : 'ready');
      } else if (msg.target === 'popup') {
        if (msg.type === 'ENGINE_CAPABILITIES') setCapabilities(msg.capabilities);
        if (msg.type === 'TELEMETRY_UPDATE') setTelemetry(msg.telemetry);
      }
    };

    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, []);

  const refreshEnginesList = async () => {
    const list = await EngineRegistry.getInstalledEngines();
    setInstalledEngines(list);
  };

  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const resolveSynchronizedDepth = (current: EngineSettings): number => {
    if (current.activeEngineId === 'patricia' && current.patriciaPersonality !== 'full_strength') {
      return getPatriciaTuning(current).recommendedDepth;
    }
    if (current.activeEngineId === 'stockfish' && current.limitStrength) {
      return getStockfishTuning(current).maxDepth;
    }
    if (current.activeEngineId === 'maia2' || current.activeEngineId === 'maia3') {
      return 1;
    }
    return current.depth || 16;
  };

  const updateSettingsBatch = async (patch: Partial<EngineSettings>) => {
    const updated = { ...settings, ...patch };
    const autoDepth = resolveSynchronizedDepth(updated);
    const isAuto =
      (updated.activeEngineId === 'patricia' && updated.patriciaPersonality !== 'full_strength') ||
      (updated.activeEngineId === 'stockfish' && updated.limitStrength) ||
      updated.activeEngineId === 'maia2' ||
      updated.activeEngineId === 'maia3';

    if (isAuto && updated.depth !== autoDepth) {
      updated.depth = autoDepth;
      patch.depth = autoDepth;
    }
    setSettings(updated);

    if (patch.activeEngineId) {
      chrome.runtime.sendMessage({ target: 'engine', type: 'SWITCH_ENGINE', engineId: String(patch.activeEngineId) });
    }

    await saveSettings({ ...patch, ...(isAuto ? { depth: autoDepth } : {}) });
    showSavedNotification();
  };

  const updateSetting = <K extends keyof EngineSettings>(key: K, value: EngineSettings[K]) => {
    const updated = { ...settings, [key]: value };
    const autoDepth = resolveSynchronizedDepth(updated);
    const isAuto =
      (updated.activeEngineId === 'patricia' && updated.patriciaPersonality !== 'full_strength') ||
      (updated.activeEngineId === 'stockfish' && updated.limitStrength) ||
      updated.activeEngineId === 'maia2' ||
      updated.activeEngineId === 'maia3';

    if (isAuto && updated.depth !== autoDepth) {
      updated.depth = autoDepth;
    }
    setSettings(updated);

    if (key === 'activeEngineId') {
      chrome.runtime.sendMessage({ target: 'engine', type: 'SWITCH_ENGINE', engineId: String(value) });
    }

    // Debounce storage persist to avoid flooding engine worker during slider dragging
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }
    saveTimeoutRef.current = setTimeout(async () => {
      await saveSettings(updated);
      showSavedNotification();
    }, 100);
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.name.endsWith('.wasm')) {
      setImportStatus('Error: Please select a valid .wasm binary');
      return;
    }

    try {
      setImportStatus('Importing engine binary...');
      const buffer = await file.arrayBuffer();
      const meta = await EngineRegistry.saveCustomEngine(file.name.replace('.wasm', ''), buffer);
      await refreshEnginesList();
      await updateSetting('activeEngineId', meta.id);
      setImportStatus(`Success: ${meta.name} imported!`);
      setTimeout(() => setImportStatus(null), 3000);
    } catch (err: any) {
      setImportStatus(`Import failed: ${err?.message || 'Invalid binary'}`);
    }
  };

  const showSavedNotification = () => {
    setSavedBadge(true);
    setTimeout(() => setSavedBadge(false), 1200);
  };

  const handleResetDefaults = async () => {
    setSettings(DEFAULT_SETTINGS);
    await saveSettings(DEFAULT_SETTINGS);
    showSavedNotification();
  };

  const openPlayground = () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('playground.html') });
  };

  const maxHardwareThreads = typeof navigator !== 'undefined' && navigator.hardwareConcurrency ? navigator.hardwareConcurrency : 8;

  return (
    <div className="popup-container">
      <header className="popup-header">
        <div className="popup-title-group">
          <div className="logo-icon">
            <Sparkles size={18} color="#f59e0b" />
          </div>
          <div>
            <h1 className="popup-title">Chess AI Overlay</h1>
            <p className="popup-subtitle">{capabilities?.name || 'Stockfish 17'} • MV3</p>
          </div>
        </div>
        <div className={`status-badge status-${engineStatus}`}>
          <span className="status-dot"></span>
          <span className="status-text">{engineStatus === 'analyzing' ? 'Thinking' : 'Ready'}</span>
        </div>
      </header>

      {currentEval && (
        <div className="eval-card">
          <div className="eval-header">
            <span className="eval-tag">
              <Activity size={12} style={{ marginRight: 4 }} /> Live Position
            </span>
            <span className="eval-depth">Depth {currentEval.depth}</span>
          </div>
          <div className="eval-body">
            <div className="eval-score">
              {(() => {
                const isBlack = currentEval.fen?.split(' ')[1] === 'b';
                const whiteCp = currentEval.whiteScoreCp ?? (currentEval.scoreCp !== null ? (isBlack ? -currentEval.scoreCp : currentEval.scoreCp) : null);
                const whiteMate = currentEval.whiteScoreMate ?? (currentEval.scoreMate !== null ? (isBlack ? -currentEval.scoreMate : currentEval.scoreMate) : null);
                if (whiteMate !== null) {
                  return `M${whiteMate > 0 ? '+' : ''}${whiteMate}`;
                }
                if (whiteCp !== null) {
                  return `${whiteCp > 0 ? '+' : ''}${(whiteCp / 100).toFixed(2)}`;
                }
                return '0.00';
              })()}
            </div>
            <div className="eval-best-move">
              <span className="best-move-label">Best Move:</span>
              <span className="best-move-algebraic">{currentEval.bestMove || 'Calculating...'}</span>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 10, fontSize: 10, color: '#94a3b8', marginTop: 6, borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: 4 }}>
            <span>Raw PV: {currentEval.multiPvLines?.length || 0}</span>
            <span>Player: {settings.highlightPlayerMoves ? 'ON' : 'OFF'}</span>
            <span>Opponent: {settings.highlightOpponentMoves ? 'ON' : 'OFF'}</span>
            <span>Arrows: {settings.showArrows ? 'ON' : 'OFF'}</span>
          </div>
        </div>
      )}

      {/* Navigation Tabs */}
      <nav className="tab-bar">
        <button
          type="button"
          className={`tab-btn ${activeTab === 'engine' ? 'active' : ''}`}
          onClick={() => setActiveTab('engine')}
        >
          <Server size={12} /> Engine
        </button>
        <button
          type="button"
          className={`tab-btn ${activeTab === 'board' ? 'active' : ''}`}
          onClick={() => setActiveTab('board')}
        >
          <Eye size={12} /> Board
        </button>
        <button
          type="button"
          className={`tab-btn ${activeTab === 'analysis' ? 'active' : ''}`}
          onClick={() => setActiveTab('analysis')}
        >
          <Sliders size={12} /> Analysis
        </button>
        <button
          type="button"
          className={`tab-btn ${activeTab === 'strength' ? 'active' : ''}`}
          onClick={() => setActiveTab('strength')}
        >
          <ShieldAlert size={12} /> Strength
        </button>
        <button
          type="button"
          className={`tab-btn ${activeTab === 'resources' ? 'active' : ''}`}
          onClick={() => setActiveTab('resources')}
        >
          <Cpu size={12} /> Resources
        </button>
        <button
          type="button"
          className={`tab-btn ${activeTab === 'opening' ? 'active' : ''}`}
          onClick={() => setActiveTab('opening')}
        >
          <BookOpen size={12} /> Opening
        </button>
        <button
          type="button"
          className={`tab-btn ${activeTab === 'advanced' ? 'active' : ''}`}
          onClick={() => setActiveTab('advanced')}
        >
          <Terminal size={12} /> UCI
        </button>
      </nav>

      {/* Tab: Engine Switcher & Custom WASM */}
      {activeTab === 'engine' && (
        <div className="settings-section">
          <div className="section-title">
            <Server size={14} /> Active Engine & Registry
          </div>

          <div className="setting-item">
            <div className="setting-label-row">
              <span className="setting-label">Selected Engine</span>
            </div>
            <select
              className="select-dropdown"
              value={settings.activeEngineId}
              onChange={(e) => updateSetting('activeEngineId', e.target.value)}
            >
              {installedEngines.map((eng) => (
                <option key={eng.id} value={eng.id}>
                  {eng.name} {eng.isBuiltIn ? '(Built-in)' : '(Custom WASM)'}
                </option>
              ))}
            </select>
          </div>

          <div style={{ marginTop: 12 }}>
            <input
              type="file"
              ref={fileInputRef}
              accept=".wasm"
              style={{ display: 'none' }}
              onChange={handleFileUpload}
            />
            <button
              type="button"
              className="btn"
              style={{ width: '100%', justifyContent: 'center' }}
              onClick={() => fileInputRef.current?.click()}
            >
              <UploadCloud size={14} /> Import Custom WASM Engine (.wasm)
            </button>
            {importStatus && (
              <div style={{ fontSize: 11, color: '#38bdf8', marginTop: 6, textAlign: 'center' }}>
                {importStatus}
              </div>
            )}
          </div>
          <div style={{ fontSize: 11, color: '#64748b', marginTop: 10 }}>
            Supports any UCI-compliant WebAssembly chess binary with standard protocol handshake.
          </div>

          {settings.activeEngineId === 'maia3' && (
            <div style={{ marginTop: 10, padding: 8, background: 'rgba(56, 189, 248, 0.08)', borderRadius: 6, border: '1px solid rgba(56, 189, 248, 0.2)', fontSize: 11, color: '#94a3b8', lineHeight: 1.4 }}>
              <span style={{ color: '#38bdf8', fontWeight: 600 }}>Maia-3 Human Engine Active:</span> Predicts moves human players make at target Elo rating rather than ruthless engine tactics.
            </div>
          )}

          {settings.activeEngineId === 'maia2' && (
            <div style={{ marginTop: 10, padding: 8, background: 'rgba(56, 189, 248, 0.08)', borderRadius: 6, border: '1px solid rgba(56, 189, 248, 0.2)', fontSize: 11, color: '#94a3b8', lineHeight: 1.4 }}>
              <span style={{ color: '#38bdf8', fontWeight: 600 }}>Maia-2 Unified Model Active:</span> NeurIPS 2024 unified human-AI chess policy modeling natural human play from 1100 to 1900 Elo.
            </div>
          )}

          {settings.activeEngineId === 'patricia' && (
            <div style={{ marginTop: 10, padding: 8, background: 'rgba(244, 63, 94, 0.08)', borderRadius: 6, border: '1px solid rgba(244, 63, 94, 0.25)', fontSize: 11, color: '#94a3b8', lineHeight: 1.4 }}>
              <span style={{ color: '#f43f5e', fontWeight: 600 }}>Patricia 5.1 Active:</span> Adam Kulju’s romantic aggressive engine (EAS 430,000) with calibrated human blunder simulation and tactical piece sacrifices.
            </div>
          )}
        </div>
      )}

      {/* Tab: Board */}
      {activeTab === 'board' && (
        <div className="settings-section">
          <div className="section-title">
            <Eye size={14} /> Board Presentation
          </div>
          <div className="toggle-list">
            <label className="toggle-row">
              <span className="toggle-label">Highlight Player's Moves</span>
              <input
                type="checkbox"
                checked={settings.highlightPlayerMoves}
                onChange={(e) => {
                  updateSettingsBatch({
                    highlightPlayerMoves: e.target.checked,
                    showHighlights: e.target.checked || settings.highlightOpponentMoves,
                  });
                }}
                className="toggle-switch"
              />
            </label>

            <label className="toggle-row">
              <span className="toggle-label">Highlight Opponent's Moves</span>
              <input
                type="checkbox"
                checked={settings.highlightOpponentMoves}
                onChange={(e) => {
                  updateSettingsBatch({
                    highlightOpponentMoves: e.target.checked,
                    showOpponentMoves: e.target.checked,
                    showHighlights: e.target.checked || settings.highlightPlayerMoves,
                  });
                }}
                className="toggle-switch"
              />
            </label>

            <label className="toggle-row">
              <span className="toggle-label">Show Move Arrows</span>
              <input
                type="checkbox"
                checked={settings.showArrows}
                onChange={(e) => {
                  updateSettingsBatch({
                    showArrows: e.target.checked,
                    showConnectors: e.target.checked,
                  });
                }}
                className="toggle-switch"
              />
            </label>

            <div className="setting-item" style={{ marginTop: 12 }}>
              <div className="setting-label-row">
                <span className="setting-label">Highlighter Strength / Opacity</span>
                <span className="setting-value">{Math.round((settings.highlighterOpacity ?? 0.35) * 100)}%</span>
              </div>
              <input
                type="range"
                min="0.15"
                max="0.80"
                step="0.05"
                value={settings.highlighterOpacity ?? 0.35}
                onChange={(e) => updateSetting('highlighterOpacity', parseFloat(e.target.value))}
                className="slider"
              />
              <div className="slider-hints">
                <span>Soft (20%)</span>
                <span>Balanced (35%)</span>
                <span>Vivid (65%+)</span>
              </div>
            </div>

            <label className="toggle-row">
              <span className="toggle-label">Evaluation Bar</span>
              <input
                type="checkbox"
                checked={settings.showEvalBar}
                onChange={(e) => updateSetting('showEvalBar', e.target.checked)}
                className="toggle-switch"
              />
            </label>

            <label className="toggle-row">
              <span className="toggle-label">Compact Board HUD</span>
              <input
                type="checkbox"
                checked={settings.showHud}
                onChange={(e) => updateSetting('showHud', e.target.checked)}
                className="toggle-switch"
              />
            </label>
          </div>

          <div className="setting-item" style={{ marginTop: 12 }}>
            <div className="section-title" style={{ marginTop: 6 }}>
              <Lock size={13} /> Capture Privacy (Resistance)
            </div>
            <div style={{ fontSize: 11, color: '#94a3b8', lineHeight: 1.4 }}>
              Press <b>Alt + H</b> anytime on Chess.com to immediately toggle the overlay visibility.
            </div>
          </div>
        </div>
      )}

      {/* Tab: Analysis */}
      {activeTab === 'analysis' && (
        <div className="settings-section">
          <div className="section-title">
            <Sliders size={14} /> Search Budget & Variations
          </div>

          {/* Calculation Depth: Active & unlocked for manual tuning, or locked with auto-calibrated depth */}
          {(() => {
            const isPatriciaAuto = settings.activeEngineId === 'patricia' && settings.patriciaPersonality !== 'full_strength';
            const isStockfishAuto = settings.activeEngineId === 'stockfish' && settings.limitStrength;
            const isMaiaAuto = settings.activeEngineId === 'maia2' || settings.activeEngineId === 'maia3';
            const isDepthAuto = isPatriciaAuto || isStockfishAuto || isMaiaAuto;

            let effectiveDepth = settings.depth;
            let autoReason = '';

            if (isPatriciaAuto) {
              const tuning = getPatriciaTuning({ ...settings, patriciaElo: settings.patriciaElo ?? 2500 });
              effectiveDepth = tuning.recommendedDepth;
              autoReason = `Auto-calibrated to ${effectiveDepth} ply for ${settings.patriciaElo ?? 2500} Elo handicap.`;
            } else if (isStockfishAuto) {
              const sfTuning = getStockfishTuning(settings);
              effectiveDepth = sfTuning.maxDepth;
              autoReason = `Auto-calibrated to ${effectiveDepth} ply for ${settings.targetElo ?? 2000} Elo strength limiter.`;
            } else if (isMaiaAuto) {
              effectiveDepth = 1;
              autoReason = `Auto-calibrated to 1 ply (zero-search policy) for Maia neural model.`;
            }

            return (
              <div className="setting-item">
                <div className="setting-label-row">
                  <span className="setting-label">Calculation Depth</span>
                  <span
                    className="setting-value"
                    style={{
                      color: isDepthAuto ? '#38bdf8' : '#e2e8f0',
                      fontWeight: isDepthAuto ? 600 : 500,
                    }}
                  >
                    {isDepthAuto ? `Auto: ${effectiveDepth} ply` : `${settings.depth} ply`}
                  </span>
                </div>
                <input
                  type="range"
                  min="1"
                  max="24"
                  step="1"
                  value={effectiveDepth}
                  disabled={isDepthAuto}
                  onChange={(e) => {
                    if (!isDepthAuto) {
                      updateSetting('depth', parseInt(e.target.value, 10));
                    }
                  }}
                  className="slider"
                  style={isDepthAuto ? { opacity: 0.6, cursor: 'not-allowed' } : {}}
                />
                <div className="slider-hints">
                  <span>Novice (2)</span>
                  <span>Balanced (16)</span>
                  <span>Deep (24)</span>
                </div>
                {isDepthAuto && (
                  <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 6, lineHeight: 1.4 }}>
                    {autoReason} Manual depth override is disabled to prevent engine overpower conflicts.
                  </div>
                )}
              </div>
            );
          })()}

          <div className="setting-item">
            <div className="setting-label-row">
              <span className="setting-label">MultiPV Variations</span>
              <span className="setting-value">{settings.multiPv}</span>
            </div>
            <input
              type="range"
              min="1"
              max="4"
              step="1"
              value={settings.multiPv}
              onChange={(e) => updateSetting('multiPv', parseInt(e.target.value, 10))}
              className="slider"
            />
            <div className="slider-hints">
              <span>1 (Amber)</span>
              <span>2 (+Blue)</span>
              <span>3 (+Violet)</span>
              <span>4 (+Slate)</span>
            </div>
          </div>

          <label className="toggle-row" style={{ marginTop: 12 }}>
            <span className="toggle-label">Auto-Analyze Moves</span>
            <input
              type="checkbox"
              checked={settings.autoAnalyze}
              onChange={(e) => updateSetting('autoAnalyze', e.target.checked)}
              className="toggle-switch"
            />
          </label>
        </div>
      )}

      {/* Tab: Strength */}
      {activeTab === 'strength' && (
        <div className="settings-section">
          {settings.activeEngineId === 'patricia' ? (
            <>
              <div className="section-title">
                <Flame size={14} color="#f43f5e" /> Patricia 5.1 Style & Strength Settings
              </div>

              {/* Personality / Playstyle Mode */}
              <div className="setting-item" style={{ marginTop: 8 }}>
                <div className="setting-label-row">
                  <span className="setting-label">Personality / Playstyle</span>
                  <span className="setting-value" style={{ textTransform: 'capitalize' }}>
                    {settings.patriciaPersonality === 'human'
                      ? 'Human-Like'
                      : settings.patriciaPersonality === 'full_strength'
                      ? 'Full Strength (3500+)'
                      : settings.patriciaPersonality === 'solid'
                      ? 'Solid Positional'
                      : 'Aggressive (EAS 430k)'}
                  </span>
                </div>
                <select
                  className="select-dropdown"
                  value={settings.patriciaPersonality || 'aggressive'}
                  onChange={(e) => updateSetting('patriciaPersonality', e.target.value as any)}
                >
                  <option value="aggressive">Aggressive (EAS 430,000 Sacrificial)</option>
                  <option value="human">Human-Like (Calibrated Elo Model)</option>
                  <option value="full_strength">Full Strength (CCRL 3500+ Grandmaster)</option>
                  <option value="solid">Solid / Classical (Controlled Aggression)</option>
                </select>
                <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 4, lineHeight: 1.4 }}>
                  {settings.patriciaPersonality === 'aggressive' && 'Patricia’s signature romantic play: searches for tactical piece sacrifices, avoids draws with high contempt, and hunts the king.'}
                  {settings.patriciaPersonality === 'human' && 'Weakens search using MultiPV 5 error distribution and human blunder probabilities calibrated across rating bands.'}
                  {settings.patriciaPersonality === 'full_strength' && 'Maximum tactical computation (3500+ Elo CCRL Blitz rating) without blunder handicapping.'}
                  {settings.patriciaPersonality === 'solid' && 'Balanced attacking style with lower blunder variance and sound opening structures.'}
                </div>
              </div>

              {/* Target Elo Rating Slider for Aggressive, Human-Like, and Solid modes */}
              {settings.patriciaPersonality !== 'full_strength' && (
                <div className="setting-item" style={{ marginTop: 12 }}>
                  <div className="setting-label-row">
                    <span className="setting-label">Target Elo Rating (UCI_Elo)</span>
                    <span className="setting-value">
                      {mapEloToPatriciaSkill(settings.patriciaElo ?? 2500).clampedElo} Elo (Skill {mapEloToPatriciaSkill(settings.patriciaElo ?? 2500).skillLevel}/20 • Depth {getPatriciaTuning({ ...settings, patriciaElo: settings.patriciaElo ?? 2500 }).recommendedDepth} ply)
                    </span>
                  </div>
                  <input
                    type="range"
                    min="500"
                    max="3000"
                    step="100"
                    value={settings.patriciaElo ?? 2500}
                    onChange={(e) => updateSetting('patriciaElo', parseInt(e.target.value, 10))}
                    className="slider"
                  />
                  <div className="slider-hints">
                    <span>500 (Novice)</span>
                    <span>1000 (Club)</span>
                    <span>1500 (Intermediate)</span>
                    <span>2000 (Expert)</span>
                    <span>2500 (Master)</span>
                    <span>3000 (Super-GM)</span>
                  </div>
                  <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 6, lineHeight: 1.4 }}>
                    {settings.patriciaPersonality === 'aggressive'
                      ? 'Aggressive Mode: Prioritizes tactical sacrifices, checks, and king attacks while constrained to authentic rating blunder probabilities and depth limits.'
                      : settings.patriciaPersonality === 'solid'
                      ? 'Solid Positional Mode: Prioritizes king safety, central pawn stability, and penalizes unsound speculative sacrifices.'
                      : 'Human Mode: Authentic rating-calibrated blunder and mistake distribution modeled from human game statistics.'}
                  </div>
                </div>
              )}

              {/* Dynamic Calibration Guide */}
              <div
                style={{
                  marginTop: 12,
                  padding: '10px 12px',
                  borderRadius: 6,
                  background: 'rgba(30, 41, 59, 0.5)',
                  border: '1px solid rgba(244, 63, 94, 0.25)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 600, color: '#f43f5e', marginBottom: 4 }}>
                  <Sparkles size={12} /> Dynamic Rating & Personality Calibration
                </div>
                <div style={{ fontSize: 11, color: '#94a3b8', lineHeight: 1.4 }}>
                  Patricia dynamically throttles search depth ({getPatriciaTuning({ ...settings, patriciaElo: settings.patriciaElo ?? 2500 }).recommendedDepth} ply) and move time to match the selected rating. At low Elo (500–1000), search is restricted to authentic beginner tactical horizon instead of machine-like 20+ ply perfection.
                </div>
              </div>

              <div
                style={{
                  marginTop: 10,
                  padding: '10px 12px',
                  borderRadius: 6,
                  background: 'rgba(30, 41, 59, 0.5)',
                  border: '1px solid rgba(255, 255, 255, 0.08)',
                }}
              >
                <div style={{ fontSize: 11, fontWeight: 600, color: '#38bdf8', marginBottom: 4 }}>
                  {getEngineStrengthDescription(settings).detail}
                </div>
                <div style={{ fontSize: 11, color: '#94a3b8', lineHeight: 1.4 }}>
                  {getEngineStrengthDescription(settings).subtext}
                </div>
              </div>
            </>
          ) : settings.activeEngineId === 'maia2' ? (
            <>
              <div className="section-title">
                <ShieldAlert size={14} /> Maia-2 Human Policy Rating Checkpoint
              </div>

              <div className="setting-item" style={{ marginTop: 8 }}>
                <div className="setting-label-row">
                  <span className="setting-label">Target Human Elo Rating</span>
                  <span className="setting-value">{Math.max(1100, Math.min(1900, Math.round((settings.targetElo || 1500) / 100) * 100))} Elo</span>
                </div>

                <div className="elo-pills">
                  {[1100, 1300, 1500, 1700, 1900].map((elo) => (
                    <button
                      key={elo}
                      type="button"
                      className={`elo-pill ${Math.round((settings.targetElo || 1500) / 100) * 100 === elo ? 'active' : ''}`}
                      onClick={() => updateSetting('targetElo', elo)}
                    >
                      {elo}
                    </button>
                  ))}
                </div>

                <input
                  type="range"
                  min="1100"
                  max="1900"
                  step="100"
                  value={Math.max(1100, Math.min(1900, Math.round((settings.targetElo || 1500) / 100) * 100))}
                  onChange={(e) => updateSetting('targetElo', parseInt(e.target.value, 10))}
                  className="slider"
                />
                <div className="slider-hints">
                  <span>1100 (Casual)</span>
                  <span>1300</span>
                  <span>1500 (Club)</span>
                  <span>1700</span>
                  <span>1900 (Expert)</span>
                </div>
              </div>

              <div
                style={{
                  marginTop: 12,
                  padding: '10px 12px',
                  borderRadius: 6,
                  background: 'rgba(30, 41, 59, 0.5)',
                  border: '1px solid rgba(56, 189, 248, 0.25)',
                }}
              >
                <div style={{ fontSize: 11, fontWeight: 600, color: '#38bdf8', marginBottom: 4 }}>
                  {getEngineStrengthDescription(settings).detail}
                </div>
                <div style={{ fontSize: 11, color: '#94a3b8', lineHeight: 1.4 }}>
                  {getEngineStrengthDescription(settings).subtext}
                </div>
              </div>
            </>
          ) : settings.activeEngineId === 'maia3' ? (
            <>
              <div className="section-title">
                <ShieldAlert size={14} /> Maia-3 Human Policy Rating Checkpoint
              </div>

              <div className="setting-item" style={{ marginTop: 8 }}>
                <div className="setting-label-row">
                  <span className="setting-label">Target Human Elo Rating</span>
                  <span className="setting-value">{Math.round((settings.targetElo || 1500) / 100) * 100} Elo</span>
                </div>

                <div className="elo-pills">
                  {[600, 1100, 1300, 1500, 1700, 1900, 2200, 2600].map((elo) => (
                    <button
                      key={elo}
                      type="button"
                      className={`elo-pill ${Math.round((settings.targetElo || 1500) / 100) * 100 === elo ? 'active' : ''}`}
                      onClick={() => updateSetting('targetElo', elo)}
                    >
                      {elo}
                    </button>
                  ))}
                </div>

                <input
                  type="range"
                  min="600"
                  max="2600"
                  step="100"
                  value={Math.round((settings.targetElo || 1500) / 100) * 100}
                  onChange={(e) => updateSetting('targetElo', parseInt(e.target.value, 10))}
                  className="slider"
                />
                <div className="slider-hints">
                  <span>600 (Novice)</span>
                  <span>1100 (Casual)</span>
                  <span>1500 (Club)</span>
                  <span>1900 (Expert)</span>
                  <span>2600 (Master)</span>
                </div>
              </div>

              <div
                style={{
                  marginTop: 12,
                  padding: '10px 12px',
                  borderRadius: 6,
                  background: 'rgba(30, 41, 59, 0.5)',
                  border: '1px solid rgba(56, 189, 248, 0.25)',
                }}
              >
                <div style={{ fontSize: 11, fontWeight: 600, color: '#38bdf8', marginBottom: 4 }}>
                  {getEngineStrengthDescription(settings).detail}
                </div>
                <div style={{ fontSize: 11, color: '#94a3b8', lineHeight: 1.4 }}>
                  {getEngineStrengthDescription(settings).subtext}
                </div>
              </div>
            </>
          ) : (
            <>
              <div className="section-title">
                <ShieldAlert size={14} /> Stockfish WASM Strength Limiter
              </div>

              <label className="toggle-row">
                <span className="toggle-label">Limit Engine Strength</span>
                <input
                  type="checkbox"
                  checked={settings.limitStrength}
                  onChange={(e) => updateSetting('limitStrength', e.target.checked)}
                  className="toggle-switch"
                />
              </label>

              <div className="setting-item" style={{ marginTop: 10, opacity: settings.limitStrength ? 1 : 0.45 }}>
                <div className="setting-label-row">
                  <span className="setting-label">Target Elo Rating</span>
                  <span className="setting-value">{settings.targetElo} Elo</span>
                </div>
                <input
                  type="range"
                  min="800"
                  max="3000"
                  step="25"
                  disabled={!settings.limitStrength}
                  value={settings.targetElo}
                  onChange={(e) => updateSetting('targetElo', parseInt(e.target.value, 10))}
                  className="slider"
                />
                <div className="slider-hints">
                  <span>Novice (1000)</span>
                  <span>Club (1500)</span>
                  <span>Master (2200)</span>
                  <span>GM (2800+)</span>
                </div>
              </div>

              <div
                style={{
                  marginTop: 12,
                  padding: '10px 12px',
                  borderRadius: 6,
                  background: 'rgba(30, 41, 59, 0.5)',
                  border: `1px solid ${settings.limitStrength ? 'rgba(245, 158, 11, 0.3)' : 'rgba(16, 185, 129, 0.3)'}`,
                }}
              >
                <div
                  style={{
                    fontSize: 11,
                    fontWeight: 600,
                    color: settings.limitStrength ? '#f59e0b' : '#10b981',
                    marginBottom: 4,
                  }}
                >
                  {getEngineStrengthDescription(settings).detail}
                </div>
                <div style={{ fontSize: 11, color: '#94a3b8', lineHeight: 1.4 }}>
                  {getEngineStrengthDescription(settings).subtext}
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* Tab: Resources */}
      {activeTab === 'resources' && (
        <div className="settings-section">
          <div className="section-title">
            <Cpu size={14} /> Compute & Memory Resources
          </div>

          <div className="resource-strip">
            <div className="res-card">
              <span className="res-label">Estimated Memory</span>
              <span className="res-val">
                {settings.activeEngineId === 'patricia'
                  ? '~64 MB'
                  : (settings.activeEngineId === 'maia3' || settings.activeEngineId === 'maia2')
                  ? '~12 MB'
                  : `~${settings.hashMb + 48} MB`}
              </span>
              <span className="res-sub">
                {settings.activeEngineId === 'patricia'
                  ? 'Dual NNUE + Hash'
                  : (settings.activeEngineId === 'maia3' || settings.activeEngineId === 'maia2')
                  ? 'Model Weights'
                  : `Hash: ${settings.hashMb} MB`}
              </span>
            </div>
            <div className="res-card">
              <span className="res-label">Engine Activity</span>
              <div className="activity-sparkline">
                {(telemetry?.history || [4, 6, 8, 12, 10, 15, 14, 18, 16, 20]).map((h, i) => (
                  <span key={i} className="spark-bar" style={{ height: `${Math.min(100, h * 4)}%` }} />
                ))}
              </div>
              <span className="res-sub">Active Worker</span>
            </div>
          </div>

          {activeCaps.hasHash && (
            <div className="setting-item" style={{ marginTop: 12 }}>
              <div className="setting-label-row">
                <span className="setting-label">Hash Table Size (RAM)</span>
                <span className="setting-value">{settings.hashMb} MB</span>
              </div>
              <input
                type="range"
                min="16"
                max="256"
                step="16"
                value={settings.hashMb}
                onChange={(e) => updateSetting('hashMb', parseInt(e.target.value, 10))}
                className="slider"
              />
            </div>
          )}

          {activeCaps.hasThreads && (
            <div className="setting-item">
              <div className="setting-label-row">
                <span className="setting-label">Search Threads</span>
                <span className="setting-value">{settings.threads} / {maxHardwareThreads}</span>
              </div>
              <input
                type="range"
                min="1"
                max={maxHardwareThreads}
                step="1"
                value={settings.threads}
                onChange={(e) => updateSetting('threads', parseInt(e.target.value, 10))}
                className="slider"
              />
            </div>
          )}

          {settings.activeEngineId === 'patricia' ? (
            <div
              style={{
                marginTop: 12,
                padding: '10px 12px',
                borderRadius: 6,
                background: 'rgba(30, 41, 59, 0.5)',
                border: '1px solid rgba(244, 63, 94, 0.25)',
              }}
            >
              <div style={{ fontSize: 11, fontWeight: 600, color: '#f43f5e', marginBottom: 4 }}>
                Patricia 5.1 WASM Execution Profile
              </div>
              <div style={{ fontSize: 11, color: '#94a3b8', lineHeight: 1.4 }}>
                Dual NNUE perspective networks (768x2-&gt;768-&gt;1) trained on aggressive filtered positions. Features asymmetric sacrifice evaluation, 30cp draw contempt, and MultiPV 5 human simulation.
              </div>
            </div>
          ) : settings.activeEngineId === 'stockfish' ? (
            <div
              style={{
                marginTop: 12,
                padding: '10px 12px',
                borderRadius: 6,
                background: 'rgba(30, 41, 59, 0.5)',
                border: '1px solid rgba(255,255,255,0.08)',
              }}
            >
              <div style={{ fontSize: 11, fontWeight: 600, color: '#f8fafc', marginBottom: 4 }}>
                Stockfish WASM Execution Profile
              </div>
              <div style={{ fontSize: 11, color: '#94a3b8', lineHeight: 1.4 }}>
                Runs safely in a dedicated Web Worker (1 thread, 16 MB Hash). Worker thread allocation and hash size are managed without sending unsupported UCI commands that stall the engine.
              </div>
            </div>
          ) : (
            <div
              style={{
                marginTop: 12,
                padding: '10px 12px',
                borderRadius: 6,
                background: 'rgba(30, 41, 59, 0.5)',
                border: '1px solid rgba(255,255,255,0.08)',
              }}
            >
              <div style={{ fontSize: 11, fontWeight: 600, color: '#f8fafc', marginBottom: 4 }}>
                {activeCaps.name} Execution Profile
              </div>
              <div style={{ fontSize: 11, color: '#94a3b8', lineHeight: 1.4 }}>
                Direct neural policy execution in memory. Instantaneous 1-node inference without tree search threads or transposition tables.
              </div>
            </div>
          )}
        </div>
      )}

      {/* Tab: Opening */}
      {activeTab === 'opening' && (
        <div className="settings-section">
          <div className="section-title">
            <BookOpen size={14} /> Opening Book & Repertoire Engine
          </div>

          <label className="toggle-row">
            <span className="toggle-label">Enable Opening Repertoire</span>
            <input
              type="checkbox"
              checked={settings.opening.enabled}
              onChange={(e) =>
                updateSetting('opening', { ...settings.opening, enabled: e.target.checked })
              }
              className="toggle-switch"
            />
          </label>

          <div className="setting-item" style={{ marginTop: 10, opacity: settings.opening.enabled ? 1 : 0.45 }}>
            <div className="setting-label-row">
              <span className="setting-label">Display & Tactical Integration Mode</span>
            </div>
            <select
              className="select-dropdown"
              disabled={!settings.opening.enabled}
              value={settings.opening.mode}
              onChange={(e) =>
                updateSetting('opening', { ...settings.opening, mode: e.target.value as any })
              }
            >
              <option value="adaptive">Adaptive (Tactical Veto: suppresses book if queen hangs or engine refutes)</option>
              <option value="coexist">Coexist (Overlay both engine variations & repertoire)</option>
              <option value="prefer">Prefer Book (Promote safe repertoire move to #1)</option>
              <option value="hint">Hint Only (Non-intrusive hint; never displaces engine lines)</option>
              <option value="book-only">Book Only (Repertoire moves only with tactical safety fallback)</option>
              <option value="off">Off (Disable opening recommendations)</option>
            </select>
            <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 5, lineHeight: 1.3 }}>
              {settings.opening.mode === 'adaptive' && 'Smartest mode: guides opening theory but instantly suppresses book moves if an enemy piece attacks your queen or wins material.'}
              {settings.opening.mode === 'coexist' && 'Renders emerald green book highlight alongside amber/blue engine variations.'}
              {settings.opening.mode === 'prefer' && 'Promotes the safe repertoire move to primary variation (#1) during the opening phase.'}
              {settings.opening.mode === 'hint' && 'Subtle hint mode recommended for human policy engines like Maia.'}
              {settings.opening.mode === 'book-only' && 'Only suggests book moves; safely falls back to engine if line deviates or hangs material.'}
              {settings.opening.mode === 'off' && 'Opening book recommendations disabled.'}
            </div>
          </div>

          <div className="setting-item" style={{ marginTop: 10, opacity: settings.opening.enabled ? 1 : 0.45 }}>
            <div className="setting-label-row">
              <span className="setting-label">Repertoire Depth Limit</span>
              <span className="setting-value">{settings.opening.maxPlies} plies ({settings.opening.maxPlies / 2} moves)</span>
            </div>
            <input
              type="range"
              min="4"
              max="24"
              step="2"
              disabled={!settings.opening.enabled}
              value={settings.opening.maxPlies}
              onChange={(e) =>
                updateSetting('opening', { ...settings.opening, maxPlies: parseInt(e.target.value, 10) })
              }
              className="slider"
            />
            <div className="slider-hints">
              <span>Short (6 plies)</span>
              <span>Standard (14 plies)</span>
              <span>Deep (24 plies)</span>
            </div>
          </div>

          {/* Searchable Categorized Opening Catalog */}
          <div style={{ marginTop: 12, opacity: settings.opening.enabled ? 1 : 0.45 }}>
            <div className="section-title" style={{ fontSize: 12, marginBottom: 4 }}>
              <Sparkles size={13} /> Opening Catalog & Repertoire Builder
            </div>
            <OpeningBrowser
              openings={OPENING_CATALOG}
              selectedIds={settings.opening.selectedOpeningIds || []}
              whiteRepertoireId={settings.opening.whiteRepertoireId || 'auto'}
              blackRepertoireId={settings.opening.blackRepertoireId || 'auto'}
              onChange={(ids) => {
                updateSetting('opening', {
                  ...settings.opening,
                  selectedOpeningIds: ids,
                  repertoireId: ids.length === 1 ? ids[0]! : 'auto',
                });
              }}
              onWhiteRepertoireChange={(id) => {
                updateSetting('opening', {
                  ...settings.opening,
                  whiteRepertoireId: id,
                });
              }}
              onBlackRepertoireChange={(id) => {
                updateSetting('opening', {
                  ...settings.opening,
                  blackRepertoireId: id,
                });
              }}
            />
          </div>
        </div>
      )}

      {/* Tab: Advanced UCI */}
      {activeTab === 'advanced' && (
        <div className="settings-section">
          <div className="section-title">
            <Terminal size={14} /> UCI Options & Inspector
          </div>

          <input
            type="text"
            placeholder="Search engine options..."
            value={optionSearch}
            onChange={(e) => setOptionSearch(e.target.value)}
            className="uci-search-input"
          />

          <div className="uci-options-list">
            {capabilities?.options ? (
              Object.values(capabilities.options)
                .filter((opt) => opt.name.toLowerCase().includes(optionSearch.toLowerCase()))
                .map((opt) => (
                  <div key={opt.name} className="uci-opt-row">
                    <div>
                      <span className="uci-opt-name">{opt.name}</span>
                      <span className="uci-opt-type">{opt.type}</span>
                    </div>
                    <span className="uci-opt-def">{opt.default !== undefined ? String(opt.default) : '-'}</span>
                  </div>
                ))
            ) : (
              <div style={{ fontSize: 12, color: '#64748b' }}>UCI options discovered dynamically upon engine initialization.</div>
            )}
          </div>
        </div>
      )}

      <footer className="popup-footer">
        <button type="button" className="action-button primary-btn" onClick={openPlayground}>
          <ExternalLink size={14} style={{ marginRight: 6 }} /> Open Test Bench
        </button>
        <button
          type="button"
          className="action-button secondary-btn"
          onClick={handleResetDefaults}
          title="Reset to Defaults"
        >
          <RotateCcw size={14} />
        </button>
      </footer>

      {savedBadge && (
        <div className="saved-toast">
          <CheckCircle2 size={12} style={{ marginRight: 4 }} /> Saved
        </div>
      )}
    </div>
  );
}
