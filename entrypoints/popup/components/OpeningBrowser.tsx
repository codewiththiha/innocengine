import React, { useMemo, useState } from 'react';
import type { OpeningCategory, OpeningDefinition } from '../../../lib/openings/types';

interface OpeningFilters {
  categories?: OpeningCategory[];
  includeMeme?: boolean;
  includeWeird?: boolean;
  maxRisk?: number;
}

interface OpeningBrowserProps {
  openings: OpeningDefinition[];
  selectedIds: string[];
  filters: OpeningFilters;
  disabled?: boolean;
  onChange: (ids: string[]) => void;
  onFiltersChange: (patch: Partial<OpeningFilters>) => void;
}

const CATEGORY_LABELS: Record<OpeningCategory, string> = {
  white: 'White',
  black: 'Black',
  universal: 'Universal',
  aggressive: 'Aggressive',
  solid: 'Solid',
  positional: 'Positional',
  tactical: 'Tactical',
  sharp: 'Sharp',
  risky: 'Risky',
  gambit: 'Gambit',
  trap: 'Trap',
  meme: 'Meme',
  weird: 'Weird',
  fun: 'Fun',
  chaos: 'Chaos',
  beginner: 'Beginner',
  classical: 'Classical',
  hypermodern: 'Hypermodern',
  flank: 'Flank',
  indian: 'Indian',
  sicilian: 'Sicilian',
  french: 'French',
  'caro-kann': 'Caro-Kann',
  'kings-pawn': "King's Pawn",
  'queens-pawn': "Queen's Pawn",
  english: 'English',
  dutch: 'Dutch',
  offbeat: 'Offbeat',
  romantic: 'Romantic',
  system: 'System',
  'ruy-lopez': 'Ruy Lopez',
  'queens-gambit': "Queen's Gambit",
  'kingside-attack': 'Kingside Attack',
};

const BROWSE_CATEGORIES: OpeningCategory[] = [
  'solid',
  'positional',
  'aggressive',
  'tactical',
  'gambit',
  'classical',
  'hypermodern',
  'system',
];

const PRESETS = [
  {
    name: 'Classical',
    description: 'A compact classical repertoire',
    ids: ['italian', 'queens-gambit', 'sicilian-najdorf', 'kings-indian'],
  },
  {
    name: 'Solid',
    description: 'Low-risk positional choices',
    ids: ['london', 'catalan', 'caro-classical', 'slav-black'],
  },
  {
    name: 'Sharp',
    description: 'Tactical opening choices',
    ids: ['kings-gambit-accepted', 'evans-gambit', 'sicilian-dragon', 'french-winawer'],
  },
  {
    name: 'Gambits',
    description: 'Sacrificial and trapping lines',
    ids: ['fried-liver', 'danish-gambit', 'stafford-gambit', 'latvian-gambit'],
  },
];

export default function OpeningBrowser({
  openings,
  selectedIds,
  filters,
  disabled = false,
  onChange,
  onFiltersChange,
}: OpeningBrowserProps) {
  const [query, setQuery] = useState('');
  const [sideFilter, setSideFilter] = useState<'all' | 'w' | 'b'>('all');
  const activeCategories = useMemo(
    () => new Set(filters.categories ?? []),
    [filters.categories],
  );
  const maxRisk = filters.maxRisk ?? 5;
  const includeMeme = filters.includeMeme ?? false;
  const includeWeird = filters.includeWeird ?? false;

  const whiteOpenings = useMemo(
    () => openings.filter((opening) => opening.side === 'w' || opening.side === 'any'),
    [openings],
  );
  const blackOpenings = useMemo(
    () => openings.filter((opening) => opening.side === 'b' || opening.side === 'any'),
    [openings],
  );

  const filtered = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    return openings.filter((opening) => {
      if (opening.enabled === false) return false;
      if (sideFilter !== 'all' && opening.side !== 'any' && opening.side !== sideFilter) return false;
      if (!includeMeme && opening.meme) return false;
      if (!includeWeird && opening.categories.includes('weird')) return false;
      if (opening.risk > maxRisk) return false;
      if (activeCategories.size > 0 && !opening.categories.some((category) => activeCategories.has(category))) {
        return false;
      }
      if (!normalizedQuery) return true;

      return [
        opening.id,
        opening.name,
        opening.eco ?? '',
        opening.description ?? '',
        ...(opening.tags ?? []),
        ...opening.categories,
      ]
        .join(' ')
        .toLowerCase()
        .includes(normalizedQuery);
    });
  }, [activeCategories, includeMeme, includeWeird, maxRisk, openings, query, sideFilter]);

  const updateSelection = (id: string) => {
    if (disabled) return;
    onChange(selectedIds.includes(id) ? selectedIds.filter((selected) => selected !== id) : [...selectedIds, id]);
  };

  const toggleCategory = (category: OpeningCategory) => {
    if (disabled) return;
    const next = new Set(activeCategories);
    if (next.has(category)) {
      next.delete(category);
    } else {
      next.add(category);
    }
    onFiltersChange({ categories: Array.from(next) });
  };

  const applyPreset = (ids: string[]) => {
    if (disabled) return;
    onChange(ids.filter((id) => openings.some((opening) => opening.id === id)));
  };

  const selectShown = () => {
    if (disabled) return;
    onChange(Array.from(new Set([...selectedIds, ...filtered.map((opening) => opening.id)])));
  };

  const usesCatalogDefault = selectedIds.length === 0;
  const selectedWhiteCount = useMemo(
    () => usesCatalogDefault
      ? whiteOpenings.length
      : selectedIds.filter((id) => openings.some((opening) => opening.id === id && (opening.side === 'w' || opening.side === 'any'))).length,
    [openings, selectedIds, usesCatalogDefault, whiteOpenings.length],
  );
  const selectedBlackCount = useMemo(
    () => usesCatalogDefault
      ? blackOpenings.length
      : selectedIds.filter((id) => openings.some((opening) => opening.id === id && (opening.side === 'b' || opening.side === 'any'))).length,
    [blackOpenings.length, openings, selectedIds, usesCatalogDefault],
  );

  return (
    <section className={`opening-browser ${disabled ? 'is-disabled' : ''}`} aria-label="Opening repertoire builder">
      <div className="repertoire-presets" aria-label="Repertoire presets">
        <span className="field-label">Start with</span>
        <div className="preset-list">
          {PRESETS.map((preset) => (
            <button
              key={preset.name}
              type="button"
              className="preset-button"
              disabled={disabled}
              onClick={() => applyPreset(preset.ids)}
              title={preset.description}
            >
              {preset.name}
            </button>
          ))}
        </div>
      </div>

      <div className="opening-side-tabs" role="group" aria-label="Opening side">
        <button
          type="button"
          className={`side-tab ${sideFilter === 'all' ? 'active' : ''}`}
          aria-pressed={sideFilter === 'all'}
          disabled={disabled}
          onClick={() => setSideFilter('all')}
        >
          All <span>{openings.length}</span>
        </button>
        <button
          type="button"
          className={`side-tab ${sideFilter === 'w' ? 'active' : ''}`}
          aria-pressed={sideFilter === 'w'}
          disabled={disabled}
          onClick={() => setSideFilter('w')}
        >
          White <span>{selectedWhiteCount}/{whiteOpenings.length}</span>
        </button>
        <button
          type="button"
          className={`side-tab ${sideFilter === 'b' ? 'active' : ''}`}
          aria-pressed={sideFilter === 'b'}
          disabled={disabled}
          onClick={() => setSideFilter('b')}
        >
          Black <span>{selectedBlackCount}/{blackOpenings.length}</span>
        </button>
      </div>

      <div className="opening-search-wrap">
        <label className="sr-only" htmlFor="opening-search">Search openings</label>
        <input
          id="opening-search"
          type="search"
          placeholder="Search name, ECO, or style"
          value={query}
          disabled={disabled}
          onChange={(event) => setQuery(event.target.value)}
          className="opening-search-input"
        />
        {query && (
          <button
            type="button"
            className="clear-search"
            aria-label="Clear opening search"
            disabled={disabled}
            onClick={() => setQuery('')}
          >
            ×
          </button>
        )}
      </div>

      <div className="opening-filter-row">
        <label className="check-label">
          <input
            type="checkbox"
            checked={includeMeme}
            disabled={disabled}
            onChange={(event) => onFiltersChange({ includeMeme: event.target.checked })}
          />
          Include meme lines
        </label>
        <label className="check-label">
          <input
            type="checkbox"
            checked={includeWeird}
            disabled={disabled}
            onChange={(event) => onFiltersChange({ includeWeird: event.target.checked })}
          />
          Include offbeat lines
        </label>
        <label className="risk-control">
          <span>Risk ≤ {maxRisk}</span>
          <input
            type="range"
            min="1"
            max="5"
            value={maxRisk}
            disabled={disabled}
            onChange={(event) => onFiltersChange({ maxRisk: Number(event.target.value) })}
          />
        </label>
      </div>

      <div className="opening-category-row" aria-label="Opening style filters">
        {BROWSE_CATEGORIES.map((category) => (
          <button
            key={category}
            type="button"
            className={`opening-chip ${activeCategories.has(category) ? 'active' : ''}`}
            aria-pressed={activeCategories.has(category)}
            disabled={disabled}
            onClick={() => toggleCategory(category)}
          >
            {CATEGORY_LABELS[category]}
          </button>
        ))}
      </div>

      <div className="opening-list-header">
        <span>{filtered.length} shown · {usesCatalogDefault ? `all ${openings.length} catalog openings active` : `${selectedIds.length} selected`}</span>
        <div>
          <button type="button" className="text-button" disabled={disabled || filtered.length === 0} onClick={selectShown}>
            Select shown
          </button>
          <button type="button" className="text-button" disabled={disabled || usesCatalogDefault} onClick={() => onChange([])}>
            Use all
          </button>
        </div>
      </div>
      {usesCatalogDefault && (
        <p className="opening-selection-note">Choose individual openings or a preset to create a narrower repertoire.</p>
      )}

      <div className="opening-list" aria-live="polite">
        {filtered.map((opening) => {
          const selected = selectedIds.includes(opening.id);
          return (
            <label key={opening.id} className={`opening-row ${selected ? 'selected' : ''}`}>
              <input
                type="checkbox"
                checked={selected}
                disabled={disabled}
                onChange={() => updateSelection(opening.id)}
              />
              <span className="opening-row-main">
                <span className="opening-row-title">{opening.name}</span>
                <span className="opening-row-line">{opening.pgn}</span>
              </span>
              <span className="opening-row-meta">
                {opening.eco && <span>{opening.eco}</span>}
                <span>R{opening.risk}</span>
              </span>
            </label>
          );
        })}
        {filtered.length === 0 && (
          <p className="opening-empty">No openings match these filters.</p>
        )}
      </div>
    </section>
  );
}
