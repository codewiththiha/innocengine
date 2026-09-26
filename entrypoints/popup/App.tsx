import React, { useState, useEffect } from 'react';
import { getSettings, saveSettings, DEFAULT_SETTINGS } from '../../lib/storage';
import type { EngineSettings, EngineEvaluation } from '../../lib/types';
import {
  Sliders,
  Eye,
  ExternalLink,
  RotateCcw,
  Sparkles,
  Activity,
  CheckCircle2,
} from 'lucide-react';
import './App.css';

export default function App() {
  const [settings, setSettings] = useState<EngineSettings>(DEFAULT_SETTINGS);
  const [currentEval, setCurrentEval] = useState<EngineEvaluation | null>(null);
  const [engineStatus, setEngineStatus] = useState<'ready' | 'loading' | 'analyzing'>('ready');
  const [savedBadge, setSavedBadge] = useState<boolean>(false);

  useEffect(() => {
    getSettings().then((s) => setSettings(s));

    chrome.runtime.sendMessage({ target: 'popup', type: 'GET_CURRENT_EVAL' }, (res: any) => {
      if (res && res.evaluation) {
        setCurrentEval(res.evaluation);
        if (res.evaluation.isCalculating) setEngineStatus('analyzing');
      }
    });

    const listener = (msg: any) => {
      if (msg.target === 'content' && msg.type === 'EVAL_UPDATE') {
        setCurrentEval(msg.evaluation);
        setEngineStatus(msg.evaluation.isCalculating ? 'analyzing' : 'ready');
      }
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, []);

  const updateSetting = async <K extends keyof EngineSettings>(key: K, value: EngineSettings[K]) => {
    const updated = { ...settings, [key]: value };
    setSettings(updated);
    await saveSettings({ [key]: value });
    showSavedNotification();
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

  return (
    <div className="popup-container">
      <header className="popup-header">
        <div className="popup-title-group">
          <div className="logo-icon">
            <Sparkles size={18} color="#38bdf8" />
          </div>
          <div>
            <h1 className="popup-title">Chess AI Overlay</h1>
            <p className="popup-subtitle">Square Highlighter & Stockfish</p>
          </div>
        </div>
        <div className={`status-badge status-${engineStatus}`}>
          <span className="status-dot"></span>
          <span className="status-text">
            {engineStatus === 'analyzing' ? 'Calculating' : 'Engine Ready'}
          </span>
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
              {currentEval.scoreMate !== null
                ? `M${currentEval.scoreMate > 0 ? '+' : ''}${currentEval.scoreMate}`
                : currentEval.scoreCp !== null
                ? `${currentEval.scoreCp > 0 ? '+' : ''}${(currentEval.scoreCp / 100).toFixed(2)}`
                : '0.00'}
            </div>
            <div className="eval-best-move">
              <span className="best-move-label">Best Move:</span>
              <span className="best-move-algebraic">{currentEval.bestMove || 'Calculating...'}</span>
            </div>
          </div>
        </div>
      )}

      <div className="settings-section">
        <div className="section-title">
          <Sliders size={14} /> Engine Parameters
        </div>

        <div className="setting-item">
          <div className="setting-label-row">
            <span className="setting-label">Calculation Depth</span>
            <span className="setting-value">{settings.depth} ply</span>
          </div>
          <input
            type="range"
            min="8"
            max="22"
            step="1"
            value={settings.depth}
            onChange={(e) => updateSetting('depth', parseInt(e.target.value, 10))}
            className="slider"
          />
          <div className="slider-hints">
            <span>Fast (8)</span>
            <span>Balanced (16)</span>
            <span>Deep (22)</span>
          </div>
        </div>
      </div>

      <div className="settings-section">
        <div className="section-title">
          <Eye size={14} /> Square Highlights & Visuals
        </div>

        <div className="toggle-list">
          <label className="toggle-row">
            <span className="toggle-label">Piece Move Square Highlights</span>
            <input
              type="checkbox"
              checked={settings.showHighlights}
              onChange={(e) => updateSetting('showHighlights', e.target.checked)}
              className="toggle-switch"
            />
          </label>

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
            <span className="toggle-label">Top Analysis HUD</span>
            <input
              type="checkbox"
              checked={settings.showHud}
              onChange={(e) => updateSetting('showHud', e.target.checked)}
              className="toggle-switch"
            />
          </label>

          <label className="toggle-row">
            <span className="toggle-label">Auto-Analyze Moves</span>
            <input
              type="checkbox"
              checked={settings.autoAnalyze}
              onChange={(e) => updateSetting('autoAnalyze', e.target.checked)}
              className="toggle-switch"
            />
          </label>
        </div>
      </div>

      <footer className="popup-footer">
        <button type="button" className="action-button primary-btn" onClick={openPlayground}>
          <ExternalLink size={14} style={{ marginRight: 6 }} /> Open Test Playground
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
