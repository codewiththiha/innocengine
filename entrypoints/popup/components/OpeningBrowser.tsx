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
  white: 'White', black: 'Black', universal: 'Universal',
  aggressive: 'Aggressive', solid: 'Solid', positional: 'Positional',
  tactical: 'Tactical', sharp: 'Sharp', risky: 'Risky',
  gambit: 'Gambit', trap: 'Trap', meme: 'Meme', weird: 'Weird',
  fun: 'Fun', chaos: 'Chaos', beginner: 'Beginner', classical: 'Classical',
  hypermodern: 'Hypermodern', flank: 'Flank', indian: 'Indian',
  sicilian: 'Sicilian', french: 'French', 'caro-kann': 'Caro-Kann',
  'kings-pawn': "King's Pawn", 'queens-pawn': "Queen's Pawn",
  english: 'English', dutch: 'Dutch', offbeat: 'Offbeat', romantic: 'Romantic',
  system: 'System', 'ruy-lopez': 'Ruy Lopez', 'queens-gambit': "Queen's Gambit",
  'kingside-attack': 'Kingside Attack',
};

const BROWSE_CATEGORIES: OpeningCategory[] = [
  'solid', 'positional', 'aggressive', 'tactical', 'gambit',
  'classical', 'hypermodern', 'system',
];

const PRESETS = [
  { name: 'Classical', ids: ['italian', 'queens-gambit', 'sicilian-najdorf', 'kings-indian'] },
  { name: 'Solid', ids: ['london', 'catalan', 'caro-classical', 'slav-black'] },
  { name: 'Sharp', ids: ['kings-gambit-accepted', 'evans-gambit', 'sicilian-dragon', 'french-winawer'] },
  { name: 'Gambits', ids: ['fried-liver', 'danish-gambit', 'stafford-gambit', 'latvian-gambit'] },
];

export default function OpeningBrowser({
  openings, selectedIds, filters, disabled = false, onChange, onFiltersChange,
}: OpeningBrowserProps) {
  const [query, setQuery] = useState('');
  const [sideFilter, setSideFilter] = useState<'all' | 'w' | 'b'>('all');
  const activeCategories = useMemo(() => new Set(filters.categories ?? []), [filters.categories]);
  const maxRisk = filters.maxRisk ?? 5;
  const includeMeme = filters.includeMeme ?? false;
  const includeWeird = filters.includeWeird ?? false;

  const whiteOpenings = useMemo(() => openings.filter(o => o.side === 'w' || o.side === 'any'), [openings]);
  const blackOpenings = useMemo(() => openings.filter(o => o.side === 'b' || o.side === 'any'), [openings]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return openings.filter(o => {
      if (o.enabled === false) return false;
      if (sideFilter !== 'all' && o.side !== 'any' && o.side !== sideFilter) return false;
      if (!includeMeme && o.meme) return false;
      if (!includeWeird && o.categories.includes('weird')) return false;
      if (o.risk > maxRisk) return false;
      if (activeCategories.size > 0 && !o.categories.some(c => activeCategories.has(c))) return false;
      if (!q) return true;
      return [o.id, o.name, o.eco ?? '', o.description ?? '', ...(o.tags ?? []), ...o.categories]
        .join(' ').toLowerCase().includes(q);
    });
  }, [activeCategories, includeMeme, includeWeird, maxRisk, openings, query, sideFilter]);

  const toggle = (id: string) => {
    if (disabled) return;
    onChange(selectedIds.includes(id) ? selectedIds.filter(x => x !== id) : [...selectedIds, id]);
  };
  const toggleCategory = (c: OpeningCategory) => {
    if (disabled) return;
    const next = new Set(activeCategories);
    next.has(c) ? next.delete(c) : next.add(c);
    onFiltersChange({ categories: Array.from(next) });
  };
  const usesCatalogDefault = selectedIds.length === 0;
  const selW = usesCatalogDefault ? whiteOpenings.length : selectedIds.filter(id => openings.some(o => o.id === id && (o.side === 'w' || o.side === 'any'))).length;
  const selB = usesCatalogDefault ? blackOpenings.length : selectedIds.filter(id => openings.some(o => o.id === id && (o.side === 'b' || o.side === 'any'))).length;

  return (
    <div className={`flex flex-col gap-2 ${disabled ? 'opacity-50 pointer-events-none' : ''}`}>
      {/* Presets */}
      <div>
        <div className="text-[11px] uppercase tracking-wide opacity-60 mb-1">Presets</div>
        <div className="flex flex-wrap gap-1">
          {PRESETS.map(p => (
            <button key={p.name} type="button" className="btn btn-xs btn-ghost border border-base-300"
              disabled={disabled} onClick={() => onChange(p.ids.filter(id => openings.some(o => o.id === id)))}>
              {p.name}
            </button>
          ))}
        </div>
      </div>

      {/* Side filter */}
      <div role="tablist" className="tabs tabs-boxed tabs-xs">
        <button role="tab" className={`tab flex-1 ${sideFilter === 'all' ? 'tab-active' : ''}`} disabled={disabled} onClick={() => setSideFilter('all')}>All {openings.length}</button>
        <button role="tab" className={`tab flex-1 ${sideFilter === 'w' ? 'tab-active' : ''}`} disabled={disabled} onClick={() => setSideFilter('w')}>White {selW}/{whiteOpenings.length}</button>
        <button role="tab" className={`tab flex-1 ${sideFilter === 'b' ? 'tab-active' : ''}`} disabled={disabled} onClick={() => setSideFilter('b')}>Black {selB}/{blackOpenings.length}</button>
      </div>

      {/* Search */}
      <label className="input input-xs input-bordered flex items-center gap-2">
        <input type="search" className="grow" placeholder="Search name, ECO, or style"
          value={query} disabled={disabled} onChange={e => setQuery(e.target.value)}/>
        {query && <button type="button" className="opacity-60 hover:opacity-100" disabled={disabled} onClick={() => setQuery('')}>×</button>}
      </label>

      {/* Checkboxes + risk */}
      <div className="flex flex-col gap-1">
        <label className="flex items-center gap-2 cursor-pointer text-xs">
          <input type="checkbox" className="checkbox checkbox-xs" checked={includeMeme} disabled={disabled}
            onChange={e => onFiltersChange({ includeMeme: e.target.checked })}/>
          Include meme lines
        </label>
        <label className="flex items-center gap-2 cursor-pointer text-xs">
          <input type="checkbox" className="checkbox checkbox-xs" checked={includeWeird} disabled={disabled}
            onChange={e => onFiltersChange({ includeWeird: e.target.checked })}/>
          Include offbeat lines
        </label>
        <label className="form-control w-full">
          <div className="flex items-center justify-between py-0.5">
            <span className="text-[11px] opacity-70">Max risk</span>
            <span className="text-[11px] font-semibold">{maxRisk}/5</span>
          </div>
          <input type="range" className="range range-xs range-primary" min="1" max="5" step="1"
            value={maxRisk} disabled={disabled} onChange={e => onFiltersChange({ maxRisk: Number(e.target.value) })}/>
        </label>
      </div>

      {/* Category chips */}
      <div className="flex flex-wrap gap-1">
        {BROWSE_CATEGORIES.map(c => (
          <button key={c} type="button"
            className={`btn btn-xs rounded-full ${activeCategories.has(c) ? 'btn-primary' : 'btn-ghost border border-base-300'}`}
            aria-pressed={activeCategories.has(c)} disabled={disabled} onClick={() => toggleCategory(c)}>
            {CATEGORY_LABELS[c]}
          </button>
        ))}
      </div>

      {/* List header */}
      <div className="flex items-center justify-between text-[11px] pt-1">
        <span className="opacity-70">
          {filtered.length} shown · {usesCatalogDefault ? `all ${openings.length} active` : `${selectedIds.length} selected`}
        </span>
        <div className="flex gap-1">
          <button type="button" className="btn btn-xs btn-ghost" disabled={disabled || filtered.length === 0}
            onClick={() => onChange(Array.from(new Set([...selectedIds, ...filtered.map(o => o.id)])))}>Select shown</button>
          <button type="button" className="btn btn-xs btn-ghost" disabled={disabled || usesCatalogDefault}
            onClick={() => onChange([])}>Clear</button>
        </div>
      </div>

      {/* Opening list */}
      <div className="max-h-56 overflow-y-auto border border-base-300 rounded-lg bg-base-100">
        {filtered.length === 0 ? (
          <div className="text-center text-xs opacity-60 py-6">No openings match these filters.</div>
        ) : filtered.map(o => {
          const selected = selectedIds.includes(o.id);
          return (
            <label key={o.id} className={`flex items-start gap-2 p-2 border-b border-base-200 last:border-b-0 cursor-pointer hover:bg-base-200/50 ${selected ? 'bg-primary/10' : ''}`}>
              <input type="checkbox" className="checkbox checkbox-xs mt-0.5" checked={selected} disabled={disabled} onChange={() => toggle(o.id)}/>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold truncate">{o.name}</span>
                  <span className="flex items-center gap-1 text-[10px] opacity-60 shrink-0">
                    {o.eco && <span className="badge badge-xs badge-ghost">{o.eco}</span>}
                    <span>R{o.risk}</span>
                  </span>
                </div>
                <div className="text-[10px] opacity-60 font-mono truncate">{o.pgn}</div>
              </div>
            </label>
          );
        })}
      </div>
    </div>
  );
}
