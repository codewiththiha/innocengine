import React, { useMemo, useState } from 'react';
import type { OpeningDefinition, OpeningCategory } from '../../../lib/openings/types';
import { Search, Flame, Shield, Sparkles, Filter, X, Check, BookOpen, Swords, Zap } from 'lucide-react';

interface OpeningBrowserProps {
  openings: OpeningDefinition[];
  selectedIds: string[];
  whiteRepertoireId?: string;
  blackRepertoireId?: string;
  onChange: (ids: string[]) => void;
  onWhiteRepertoireChange?: (id: string) => void;
  onBlackRepertoireChange?: (id: string) => void;
}

const CATEGORY_LABELS: Record<string, string> = {
  aggressive: 'Aggressive',
  solid: 'Solid',
  positional: 'Positional',
  tactical: 'Tactical',
  sharp: 'Sharp',
  gambit: 'Gambit',
  trap: 'Trap',
  meme: 'Meme',
  weird: 'Weird',
  beginner: 'Beginner',
  classical: 'Classical',
  hypermodern: 'Hypermodern',
  sicilian: 'Sicilian',
  french: 'French',
  'caro-kann': 'Caro-Kann',
  'kings-pawn': "King's Pawn",
  'queens-pawn': "Queen's Pawn",
  indian: 'Indian',
  english: 'English',
  dutch: 'Dutch',
  system: 'System',
};

const PRESETS = [
  {
    name: '🏆 Grandmaster',
    desc: 'Classical & Tier-1',
    ids: ['italian', 'queens-gambit', 'sicilian-najdorf', 'kings-indian'],
  },
  {
    name: '🛡️ Solid Rock',
    desc: 'Fortress & Structure',
    ids: ['london', 'catalan', 'caro-classical', 'slav-black'],
  },
  {
    name: '⚔️ Sharp Attacks',
    desc: 'Tactics & Sacrifices',
    ids: ['kings-gambit-accepted', 'evans-gambit', 'sicilian-dragon', 'french-winawer'],
  },
  {
    name: '🎭 Gambits',
    desc: 'Traps & Wild lines',
    ids: ['fried-liver', 'danish-gambit', 'stafford-gambit', 'latvian-gambit'],
  },
];

export default function OpeningBrowser({
  openings,
  selectedIds,
  whiteRepertoireId,
  blackRepertoireId,
  onChange,
  onWhiteRepertoireChange,
  onBlackRepertoireChange,
}: OpeningBrowserProps) {
  const [query, setQuery] = useState('');
  const [sideFilter, setSideFilter] = useState<'all' | 'w' | 'b'>('all');
  const [activeCategories, setActiveCategories] = useState<Set<OpeningCategory>>(new Set());
  const [maxRisk, setMaxRisk] = useState<number>(5);
  const [includeMeme, setIncludeMeme] = useState(false);
  const [includeWeird, setIncludeWeird] = useState(false);

  const whiteOpenings = useMemo(() => openings.filter((o) => o.side === 'w' || o.side === 'any'), [openings]);
  const blackOpenings = useMemo(() => openings.filter((o) => o.side === 'b' || o.side === 'any'), [openings]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();

    return openings.filter((opening) => {
      if (opening.enabled === false) return false;

      // Side filter
      if (sideFilter !== 'all' && opening.side !== 'any' && opening.side !== sideFilter) {
        return false;
      }

      // Meme / Weird filter
      if (!includeMeme && opening.meme) return false;
      if (!includeWeird && opening.categories.includes('weird')) return false;

      // Risk threshold
      if (opening.risk > maxRisk) return false;

      // Category chip filter
      if (activeCategories.size > 0) {
        const matchesCat = opening.categories.some((cat) => activeCategories.has(cat));
        if (!matchesCat) return false;
      }

      // Search query filter
      if (!q) return true;

      const haystack = [
        opening.id,
        opening.name,
        opening.eco ?? '',
        opening.description ?? '',
        ...(opening.tags ?? []),
        ...opening.categories,
      ]
        .join(' ')
        .toLowerCase();

      return haystack.includes(q);
    });
  }, [openings, query, sideFilter, activeCategories, maxRisk, includeMeme, includeWeird]);

  const toggleOpening = (id: string) => {
    if (selectedIds.includes(id)) {
      onChange(selectedIds.filter((x) => x !== id));
    } else {
      onChange([...selectedIds, id]);
    }
  };

  const toggleCategory = (cat: OpeningCategory) => {
    const next = new Set(activeCategories);
    if (next.has(cat)) {
      next.delete(cat);
    } else {
      next.add(cat);
    }
    setActiveCategories(next);
  };

  const handleApplyPreset = (presetIds: string[]) => {
    // Only keep IDs that exist in the catalog
    const valid = presetIds.filter((id) => openings.some((o) => o.id === id));
    onChange(valid);
  };

  const handleSelectAllFiltered = () => {
    const combined = Array.from(new Set([...selectedIds, ...filtered.map((o) => o.id)]));
    onChange(combined);
  };

  const handleClearSelection = () => {
    onChange([]);
  };

  // Selected counts by side
  const selectedWhiteCount = useMemo(
    () => selectedIds.filter((id) => openings.some((o) => o.id === id && (o.side === 'w' || o.side === 'any'))).length,
    [selectedIds, openings]
  );
  const selectedBlackCount = useMemo(
    () => selectedIds.filter((id) => openings.some((o) => o.id === id && (o.side === 'b' || o.side === 'any'))).length,
    [selectedIds, openings]
  );

  return (
    <div className="opening-browser">
      {/* Quick Repertoire Presets */}
      <div className="opening-presets-bar">
        <span className="presets-title">Quick Presets:</span>
        <div className="presets-scroll">
          {PRESETS.map((preset) => (
            <button
              key={preset.name}
              type="button"
              className="preset-btn"
              onClick={() => handleApplyPreset(preset.ids)}
              title={preset.desc}
            >
              {preset.name}
            </button>
          ))}
          {selectedIds.length > 0 && (
            <button
              type="button"
              className="preset-btn clear"
              onClick={handleClearSelection}
            >
              Clear All ({selectedIds.length})
            </button>
          )}
        </div>
      </div>

      {/* Side Tabs & Active Repertoire Counts */}
      <div className="opening-side-tabs">
        <button
          type="button"
          className={`side-tab ${sideFilter === 'all' ? 'active' : ''}`}
          onClick={() => setSideFilter('all')}
        >
          All Openings ({openings.length})
        </button>
        <button
          type="button"
          className={`side-tab ${sideFilter === 'w' ? 'active' : ''}`}
          onClick={() => setSideFilter('w')}
        >
          ⚪ White Repertoire ({whiteOpenings.length})
          {selectedWhiteCount > 0 && <span className="tab-pill">{selectedWhiteCount}</span>}
        </button>
        <button
          type="button"
          className={`side-tab ${sideFilter === 'b' ? 'active' : ''}`}
          onClick={() => setSideFilter('b')}
        >
          ⚫ Black Repertoire ({blackOpenings.length})
          {selectedBlackCount > 0 && <span className="tab-pill">{selectedBlackCount}</span>}
        </button>
      </div>

      {/* Search Input */}
      <div style={{ position: 'relative' }}>
        <input
          type="text"
          placeholder={
            sideFilter === 'w'
              ? 'Search White openings (e.g. Italian, London, Queen’s Gambit)...'
              : sideFilter === 'b'
              ? 'Search Black defenses (e.g. Sicilian, Caro-Kann, King’s Indian)...'
              : 'Search 99+ openings by name, ECO (e.g. C50), or theme...'
          }
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="opening-search-input"
        />
        {query && (
          <button
            type="button"
            onClick={() => setQuery('')}
            style={{
              position: 'absolute',
              right: 8,
              top: '50%',
              transform: 'translateY(-50%)',
              background: 'none',
              border: 'none',
              color: '#64748b',
              cursor: 'pointer',
            }}
          >
            <X size={12} />
          </button>
        )}
      </div>

      {/* Control Strip: Meme, Weird & Risk */}
      <div className="opening-controls-bar">
        <label className="opening-toggle-label">
          <input
            type="checkbox"
            checked={includeMeme}
            onChange={(e) => setIncludeMeme(e.target.checked)}
          />
          🎭 Memes (Bongcloud, Borg)
        </label>

        <label className="opening-toggle-label">
          <input
            type="checkbox"
            checked={includeWeird}
            onChange={(e) => setIncludeWeird(e.target.checked)}
          />
          🌀 Weird / Offbeat
        </label>

        {/* Risk Limit */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10, color: '#94a3b8' }}>
          <span>Max Risk: <b>{maxRisk}/5</b></span>
          <input
            type="range"
            min="1"
            max="5"
            value={maxRisk}
            onChange={(e) => setMaxRisk(Number(e.target.value))}
            style={{ width: 50, height: 3, accentColor: '#38bdf8' }}
          />
        </div>
      </div>

      {/* Category Filter Chips */}
      <div className="opening-categories-wrap">
        {Object.entries(CATEGORY_LABELS).map(([key, label]) => {
          const active = activeCategories.has(key as OpeningCategory);
          return (
            <button
              key={key}
              type="button"
              className={`opening-chip ${active ? 'active' : ''}`}
              onClick={() => toggleCategory(key as OpeningCategory)}
            >
              {label}
            </button>
          );
        })}
      </div>

      {/* Action Strip: Count & Quick Select */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 11, color: '#64748b' }}>
        <span>
          Showing <b>{filtered.length}</b> openings ({selectedIds.length} active in repertoire)
        </span>
        <div style={{ display: 'flex', gap: 6 }}>
          <button
            type="button"
            className="opening-chip"
            style={{ fontSize: 9, padding: '1px 6px' }}
            onClick={handleSelectAllFiltered}
          >
            Select Shown ({filtered.length})
          </button>
          {selectedIds.length > 0 && (
            <button
              type="button"
              className="opening-chip"
              style={{ fontSize: 9, padding: '1px 6px', color: '#f43f5e' }}
              onClick={handleClearSelection}
            >
              Clear
            </button>
          )}
        </div>
      </div>

      {/* Cards List */}
      <div className="opening-cards-list">
        {filtered.map((opening) => {
          const isSelected = selectedIds.includes(opening.id);
          return (
            <div
              key={opening.id}
              className={`opening-card ${isSelected ? 'selected' : ''}`}
              onClick={() => toggleOpening(opening.id)}
            >
              <div className="opening-card-header">
                <div className="opening-card-title">
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => {}}
                    onClick={(e) => e.stopPropagation()}
                    style={{ accentColor: '#38bdf8', cursor: 'pointer' }}
                  />
                  <span>{opening.name}</span>
                </div>
                <div className="opening-badges-row">
                  {opening.eco && <span className="opening-badge badge-eco">{opening.eco}</span>}
                  <span className={`opening-badge badge-side-${opening.side}`}>
                    {opening.side === 'w' ? '⚪ White' : opening.side === 'b' ? '⚫ Black' : 'Universal'}
                  </span>
                  <span className={`opening-badge badge-risk risk-${opening.risk}`}>
                    Risk {opening.risk}/5
                  </span>
                </div>
              </div>

              {opening.description && (
                <div className="opening-card-desc">{opening.description}</div>
              )}

              <div className="opening-card-tags">
                <span className="opening-tag pgn-tag">{opening.pgn}</span>
                {opening.categories.slice(0, 3).map((cat) => (
                  <span key={cat} className="opening-tag">
                    {cat}
                  </span>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
