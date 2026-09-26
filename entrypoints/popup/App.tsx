import React, { useState, useEffect } from 'react';
import { getSettings, saveSettings, DEFAULT_SETTINGS } from '../../lib/storage';
import type { EngineSettings, EngineEvaluation } from '../../lib/types';
import {
  Sliders,
  Eye,
  Cpu,
  Layers,
  Palette,
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
    // Load initial settings
    getSettings().then((s) => setSettings(s));

    // Request active evaluation from background
    chrome.runtime.sendMessage({ target: 'popup', type: 'GET_CURRENT_EVAL' }, (res: any) => {
      if (res && res.evaluation) {
        setCurrentEval(res.evaluation);
        if (res.evaluation.isCalculating) setEngineStatus('analyzing');
      }
    });

    // Listen for live updates while popup is open
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

  const colorPresets = [
    { label: 'Emerald', value: '#10b981' },
    { label: 'Cyan', value: '#06b6d4' },
    { label: 'Amber', value: '#f59e0b' },
    { label: 'Purple', value: '#a855f7' },
    { label: 'Rose', value: '#f43f5e' },
  ];

  return (
    <div className="popup-container">
      {/* Header */}
      <header className="popup-header">
        <div className="popup-title-group">
          <div className="logo-icon">
            <Sparkles size={18} color="#38bdf8" />
          </div>
          <div>
            <h1 className="popup-title">Chess AI Overlay</h1>
            <p className="popup-subtitle">WASM Stockfish & SVG HUD</p>
          </div>
        </div>
        <div className={`status-badge status-${engineStatus}`}>
          <span className="status-dot"></span>
          <span className="status-text">
            {engineStatus === 'analyzing' ? 'Calculating' : 'Engine Ready'}
          </span>
        </div>
      </header>

      {/* Live Eval Preview Card */}
      {currentEval && (
        <div className="eval-card">
          <div className="eval-header">
            <span className="eval-tag">
              <Activity size={12} style={{ marginRight: 4 }} /> Live Game
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

      {/* Settings List */}
      <div className="settings-section">
        <div className="section-title">
          <Sliders size={14} /> Engine Parameters
        </div>

        {/* Depth Slider */}
        <div className="setting-item">
          <div className="setting-label-row">
            <span className="setting-label">Calculation Depth</span>
            <span className="setting-value">{settings.depth} ply</span>
          </div>
          <input
            type="range"
            min="8"
            max="25"
            step="1"
            value={settings.depth}
            onChange={(e) => updateSetting('depth', parseInt(e.target.value, 10))}
            className="slider"
          />
          <div className="slider-hints">
            <span>Fast (8)</span>
            <span>Balanced (16)</span>
            <span>Deep (25)</span>
          </div>
        </div>

        {/* MultiPV Slider */}
        <div className="setting-item">
          <div className="setting-label-row">
            <span className="setting-label">MultiPV (Alternative Lines)</span>
            <span className="setting-value">{settings.multiPv} lines</span>
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
        </div>
      </div>

      {/* Visual Options */}
      <div className="settings-section">
        <div className="section-title">
          <Eye size={14} /> Visual Overlay
        </div>

        {/* Arrow Color Picker */}
        <div className="color-picker-row">
          <span className="setting-label">Primary Arrow Color</span>
          <div className="color-swatches">
            {colorPresets.map((c) => (
              <button
                key={c.value}
                type="button"
                className={`color-swatch ${settings.arrowColor === c.value ? 'selected' : ''}`}
                style={{ backgroundColor: c.value }}
                title={c.label}
                onClick={() => updateSetting('arrowColor', c.value)}
              />
            ))}
          </div>
        </div>

        {/* Toggle Grid */}
        <div className="toggle-list">
          <label className="toggle-row">
            <span className="toggle-label">Best Move Arrow</span>
            <input
              type="checkbox"
              checked={settings.showArrows}
              onChange={(e) => updateSetting('showArrows', e.target.checked)}
              className="toggle-switch"
            />
          </label>

          <label className="toggle-row">
            <span className="toggle-label">MultiPV Alternative Arrows</span>
            <input
              type="checkbox"
              checked={settings.showMultiPv}
              onChange={(e) => updateSetting('showMultiPv', e.target.checked)}
              className="toggle-switch"
            />
          </label>

          <label className="toggle-row">
            <span className="toggle-label">Square Highlights</span>
            <input
              type="checkbox"
              checked={settings.showHighlights}
              onChange={(e) => updateSetting('showHighlights', e.target.checked)}
              className="toggle-switch"
            />
          </label>

          <label className="toggle-row">
            <span className="toggle-label">Live Evaluation Bar</span>
            <input
              type="checkbox"
              checked={settings.showEvalBar}
              onChange={(e) => updateSetting('showEvalBar', e.target.checked)}
              className="toggle-switch"
            />
          </label>

          <label className="toggle-row">
            <span className="toggle-label">On-Board Analysis HUD</span>
            <input
              type="checkbox"
              checked={settings.showHud}
              onChange={(e) => updateSetting('showHud', e.target.checked)}
              className="toggle-switch"
            />
          </label>

          <label className="toggle-row">
            <span className="toggle-label">Auto-Analyze Every Move</span>
            <input
              type="checkbox"
              checked={settings.autoAnalyze}
              onChange={(e) => updateSetting('autoAnalyze', e.target.checked)}
              className="toggle-switch"
            />
          </label>
        </div>
      </div>

      {/* Footer Actions */}
      <footer className="popup-footer">
        <button type="button" className="action-button primary-btn" onClick={openPlayground}>
          <ExternalLink size={14} style={{ marginRight: 6 }} /> Open Test Playground
        </button>
        <button type="button" className="action-button secondary-btn" onClick={handleResetDefaults} title="Reset to Defaults">
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
