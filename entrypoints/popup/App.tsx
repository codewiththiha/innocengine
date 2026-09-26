import React, { useState, useEffect, useRef } from 'react';
import { getSettings, saveSettings, DEFAULT_SETTINGS } from '../../lib/storage';
import { EngineRegistry, type BUILTIN_STOCKFISH } from '../../lib/engine-registry';
import { REPERTOIRE_LIST } from '../../lib/opening-book';
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

  const updateSettingsBatch = async (patch: Partial<EngineSettings>) => {
    setSettings((prev) => {
      const updated = { ...prev, ...patch };
      saveSettings(patch);
      return updated;
    });

    if (patch.activeEngineId) {
      chrome.runtime.sendMessage({ target: 'engine', type: 'SWITCH_ENGINE', engineId: String(patch.activeEngineId) });
    }
    if (patch.hashMb !== undefined) {
      chrome.runtime.sendMessage({ target: 'engine', type: 'SET_OPTION', name: 'Hash', value: Number(patch.hashMb) });
    }
    if (patch.threads !== undefined) {
      chrome.runtime.sendMessage({ target: 'engine', type: 'SET_OPTION', name: 'Threads', value: Number(patch.threads) });
    }
    if (patch.limitStrength !== undefined) {
      chrome.runtime.sendMessage({ target: 'engine', type: 'SET_OPTION', name: 'UCI_LimitStrength', value: Boolean(patch.limitStrength) });
    }
    if (patch.targetElo !== undefined) {
      chrome.runtime.sendMessage({ target: 'engine', type: 'SET_OPTION', name: 'UCI_Elo', value: Number(patch.targetElo) });
    }

    showSavedNotification();
  };

  const updateSetting = async <K extends keyof EngineSettings>(key: K, value: EngineSettings[K]) => {
    await updateSettingsBatch({ [key]: value });
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
            <Sliders size={14} /> Search Budget
          </div>

          <div className="setting-item">
            <div className="setting-label-row">
              <span className="setting-label">Calculation Depth</span>
              <span className="setting-value">{settings.depth} ply</span>
            </div>
            <input
              type="range"
              min="8"
              max="24"
              step="1"
              value={settings.depth}
              onChange={(e) => updateSetting('depth', parseInt(e.target.value, 10))}
              className="slider"
            />
            <div className="slider-hints">
              <span>Fast (8)</span>
              <span>Balanced (16)</span>
              <span>Deep (24)</span>
            </div>
          </div>

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
          <div className="section-title">
            <ShieldAlert size={14} /> Engine Strength & Elo Limiter
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
              min="1100"
              max="3190"
              step="25"
              disabled={!settings.limitStrength}
              value={settings.targetElo}
              onChange={(e) => updateSetting('targetElo', parseInt(e.target.value, 10))}
              className="slider"
            />
            <div className="slider-hints">
              <span>Novice (1200)</span>
              <span>Club (1600)</span>
              <span>Master (2200)</span>
              <span>GM (2800+)</span>
            </div>
            <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 8, lineHeight: 1.4 }}>
              {settings.activeEngineId === 'maia3'
                ? 'Calibrates Maia-3 neural move predictor to human games played at this Elo rating.'
                : 'Configures UCI_Elo, UCI_LimitStrength, and Skill Level in Stockfish WASM to throttle engine strength.'}
            </div>
          </div>
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
              <span className="res-val">~{settings.hashMb + 48} MB</span>
              <span className="res-sub">Hash: {settings.hashMb} MB</span>
            </div>
            <div className="res-card">
              <span className="res-label">Engine Activity</span>
              <div className="activity-sparkline">
                {(telemetry?.history || [4, 6, 8, 12, 10, 15, 14, 18, 16, 20]).map((h, i) => (
                  <span key={i} className="spark-bar" style={{ height: `${Math.min(100, h * 4)}%` }} />
                ))}
              </div>
              <span className="res-sub">Search active</span>
            </div>
          </div>

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
        </div>
      )}

      {/* Tab: Opening */}
      {activeTab === 'opening' && (
        <div className="settings-section">
          <div className="section-title">
            <BookOpen size={14} /> Soft Repertoire Layer
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
              <span className="setting-label">Active Repertoire</span>
            </div>
            <select
              className="select-dropdown"
              disabled={!settings.opening.enabled}
              value={settings.opening.repertoireId}
              onChange={(e) =>
                updateSetting('opening', { ...settings.opening, repertoireId: e.target.value })
              }
            >
              <optgroup label="⚪ White Openings">
                {REPERTOIRE_LIST.filter((r) => r.side === 'w').map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name} ({r.category})
                  </option>
                ))}
              </optgroup>
              <optgroup label="⚫ Black Defenses">
                {REPERTOIRE_LIST.filter((r) => r.side === 'b').map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name} ({r.category})
                  </option>
                ))}
              </optgroup>
            </select>
            <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 6, lineHeight: 1.3 }}>
              Repertoires automatically recommend the proper move when it is your side's turn.
            </div>
          </div>

          <div className="setting-item" style={{ marginTop: 10, opacity: settings.opening.enabled ? 1 : 0.45 }}>
            <div className="setting-label-row">
              <span className="setting-label">Display Mode</span>
            </div>
            <div className="pill-group">
              {([
                { id: 'coexist', label: 'Overlay Both' },
                { id: 'prefer', label: 'Engine Guided' },
                { id: 'book-only', label: 'Book Only' },
              ] as const).map(({ id, label }) => (
                <button
                  key={id}
                  type="button"
                  disabled={!settings.opening.enabled}
                  className={`pill-btn ${settings.opening.mode === id ? 'active' : ''}`}
                  onClick={() => updateSetting('opening', { ...settings.opening, mode: id })}
                >
                  {label}
                </button>
              ))}
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
              <span>Standard (12 plies)</span>
              <span>Deep (20 plies)</span>
            </div>
          </div>

          <div style={{ fontSize: 11, color: '#64748b', marginTop: 8 }}>
            {settings.opening.mode === 'coexist' && 'Shows distinct Emerald Green highlight for Opening Book alongside Engine variations.'}
            {settings.opening.mode === 'prefer' && 'Promotes the repertoire move to the primary variation (#1), followed by engine alternatives.'}
            {settings.opening.mode === 'book-only' && 'Only displays the opening repertoire move during the opening phase.'}
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
