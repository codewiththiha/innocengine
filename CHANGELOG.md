# Changelog

## 1.3.1 - 2026-09-30

### Popup polish

- Opening tab completely re-built with daisyUI components (preset buttons,
  tabbed side filter, bordered search input, checkbox-xs filters, range-xs
  risk slider, rounded-full category chips, a real scrollable opening list
  with hover states and selection highlights) replacing the unstyled custom
  classes that were rendering raw text.
- Disabled repertoire controls now visibly gray out (opacity 0.4 +
  pointer-events none); the disabled `range` slider for opening depth is no
  longer interactive or visually prominent when the repertoire is off.
- Tab bar now sits inside a `tabs-boxed` container with padding, rounded
  corners, active primary fill with shadow, and inactive tabs at reduced
  opacity so active tab is clearly visible.
- Header uses `navbar bg-base-200 border-b base-300`; popup body uses
  `bg-base-100 text-base-content`; footer sticks to bottom with a bg-base-200
  strip and a top border.
- Removed unused `Cpu` / `EngineTelemetry` imports and the leftover
  `popup/style.css` that was pulling old tokens but no longer imported.
- Added explicit disabled-state styling for ranges/selects/inputs so disabled
  controls look uniformly grayed instead of appearing "broken".

## 1.3.0 - 2026-09-30

### Rebrand & UI refresh

- Renamed **Patricia → BallMaeGyi** everywhere (engine IDs, filenames, worker glue,
  labels, manifest web-accessible resources). Existing engine settings are
  auto-migrated by the new engine id.
- Popup and review UI rebuilt on **Tailwind CSS + daisyUI 4** (dark theme):
  tabs, selects, sliders, toggles, progress bars, buttons and stats now use
  daisyUI components. Removed the "Ready / Thinking" status badge, the
  glassmorphism chrome, the verbose engine-blurb paragraphs and the
  "by Adam Kulju" / "romantic aggressive" expositions.
- Dropped the **custom WASM import** path; only the built-in engines are offered
  (Stockfish 17, BallMaeGyi 5.1, Maia-2, Maia-3). The IndexedDB engine store
  and file-input UI are removed.
- Manifest name updated to "Chess Engine Overlay by codewiththiha"; byline
  updated across popup header and review page footer.
- Review page: removed "human-first" / "about the feedback" / "engine is
  separate…" explainer blocks, "You stay in control" AI badge, and the
  "Engine results are suggestions, not truth" subtitle. Controls now use
  daisyUI stat cards, form-control labels, range sliders, checkboxes, and
  a native `<progress>` element for review progress.
- Game library items are compact daisyUI cards with per-game delete buttons.

## 1.2.1 - 2026-09-30

### Fixed

- **Game recorder reliability**: finished games now appear in the Review page.
  - Added a global game-over watcher (DOM body observer + 750 ms polling) so the
    Chess.com end-of-game modal triggers persistence even if the board element
    doesn't fire a clear "inactive" mutation.
  - When the board element is replaced (new game, navigation), the in-progress
    recorder is flushed so previous games aren't lost on transition.
  - Loading a URL that already shows a finished game immediately saves that
    game instead of waiting for another mutation.
  - Minimum-ply guard raised to 2 (so trivial single-move pages don't create
    ghost records), and an idempotent `lastSavedKey` prevents duplicate records
    of the same finished game.
  - Result detection reads Chess.com's game-over header (Won / Lost / Draw)
    instead of always recording "unknown".
  - After a successful save, the content script sends a `GAME_SAVED` message so
    the open Review tab refreshes automatically (plus a 2.5 s fallback poll).

## 1.2.0 - 2026-09-30

### Added

- **Post-game review page** (`chrome-extension://<id>/review.html`): a Chess.com-styled
  analysis companion that opens in a new tab.
  - List of all finished games auto-recorded from Chess.com (persisted to IndexedDB,
    never leaves the device).
  - Deep per-move engine analysis using a **separate review engine** (Stockfish 17 or
    BallMaeGyi 5.1, depth 12–24, 2–5 MultiPV lines) independent from your live
    highlight engine, so re-analysing a game never disrupts in-play hints.
  - Chess.com-style move classification with colored glyphs and plain-English
    explanations: Brilliant (!!), Great (!), Best (★), Book (B), Good (✓),
    Inaccuracy (?!), Mistake (?), Blunder (??).
  - Overall accuracy score per side (White/Black), summary chips, and a live
    evaluation bar.
  - Click any move in the move list to jump to it; arrow keys (←/→/Home/End/F)
    navigate; Space toggles the best-move arrow.
  - Better-move hint card with the engine's top reply and centipawn-loss figure.
  - **Training mode**: guess the best move from each position and get instant
    feedback — a spaced-repetition style way to drill lost positions.
- **Draggable pieces and Chess.com-styled board** in the review page:
  - #eeeed2/#769656 Chess.com green/brown square palette with embedded coordinates,
    Unicode merida-style pieces with drop-shadows, drag-and-drop move input,
    last-move yellow highlight, blue selected square, legal-move dots,
    best-move green arrows, and blunder red highlights.
  - Resize-aware (CSS `aspect-ratio`) and works down to mobile widths.
- **Auto-record finished games** toggle (on by default). Every Chess.com game that
  ends naturally is saved with URL, player color, SAN move list, final FEN, PGN,
  timestamp, and result. All data is local to IndexedDB.
- **Dual-engine architecture** — the new `dual-engine-host.ts` runs full-strength
  deep reviews with longer movetime budgets and multipv without fighting with
  the responsive highlight runner. A cancel button stops long reviews instantly.
- New settings for review engine, depth, multi-PV, and auto-review.
- A new **Review** button in the popup footer alongside Test Bench.

### Design (anti-AI UX)

- Human-first review layout: accuracy + result first, detail progressively
  disclosed; explanations next to every classification chip.
- Explicit AI state ("Analyzing move X/Y • depth N" + cancellable progress bar);
  no silent spinners.
- Plain-English copy, control boundaries visible (player chooses engine, depth,
  when to start/cancel/review).
- Capped accent colors — red/amber/green/teal only carry meaning (classification),
  chrome stays neutral.
- Escape hatch: every analysis can be cancelled, games can be deleted, and all
  processing runs on device.

## 1.1.3 - 2026-09-30

### Added

- **Manual depth override for BallMaeGyi**: a new toggle unlocks the calculation-depth
  slider in Aggressive / Human-Like / Solid modes so you can force a custom ply count
  instead of the Elo-calibrated default. Turning the override off snaps depth back
  to the auto-calibrated value.
- **Performance / responsiveness profile** for BallMaeGyi (Instant / Balanced / Deep)
  that scales depth caps and move-time budgets. Instant mode is tuned for near-
  immediate highlight feedback.
- **22 new openings & gambits** in the catalog: Göring, Ponziani, Cochrane, Traxler,
  Max Lange, Marshall, Jaenisch, Icelandic, Frankenstein-Dracula, From's, Staunton,
  Belgrade, Blumenfeld, von Hennig-Schara, Scheveningen, Pelikan, Rossolimo, King's
  Indian Attack, Chigorin, Vienna Gambit, Rousseau, and Nakhchivan/Italian Gambit.

### Fixed

- **BallMaeGyi highlight lag at plies 12–14 in Aggressive/Human modes** is now
  effectively instant:
  - Progressive iterative-deepening info is streamed to the UI in handicapped
    modes (previously suppressed until `bestmove`, causing the visible delay).
  - A pre-warmed standby BallMaeGyi worker eliminates the WASM-reload gap on every
    new position — the busy worker is atomically swapped instead of being killed
    and reinitialized.
  - Stability window tightened from 180 ms to 60 ms (~3 animation frames).
  - Host-supplied `movetime` budgets are now honored by the BallMaeGyi worker.

## 1.1.2 - 2026-09-28

### Added

- Add system-adaptive light and dark themes across the popup and playground.
- Add IndexedDB-backed adaptive repertoire matching that follows actual moves
  and falls back across selected opening lines.

### Fixed

- Release content-script observers, timers, subscriptions, and engine listeners
  when a Chess.com page is replaced.

## 1.1.0 - 2026-09-28

### Added

- Add a Theory + engine opening mode that keeps every configured engine variation
  visible alongside a legal, locally safe repertoire step through the configured
  opening depth.

### Changed

- Rebuild the extension popup around a compact, keyboard-visible chess annotation
  interface and persist opening-catalog filters with the repertoire.

## 1.0.1 - 2026-09-27

### Fixed

- Keep BallMaeGyi's handicapped search lines internal until its selected move is final.
- Ignore stale shallow MultiPV lines, preserve mate scores, and prevent sampling an immediate forced loss.
- Restore the requested MultiPV setting in full-strength mode and keep five internal candidates only for handicapped searches.
- Report BallMaeGyi initialization failures instead of treating a failed or timed-out worker as ready.

### Release

- Align extension, package, and in-app versions at `1.0.1`.
- Add a tag-triggered GitHub release workflow for Chrome, Firefox, and XPI packages.
