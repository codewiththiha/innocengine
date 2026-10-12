# Changelog

## 1.5.2 - 2026-10-12

### GwayMaeGyi: calm, accurate highlight updates

- Fixed the flickering "arrows keep appearing" behavior: during a long final
  iteration the worker reposted an *identical* report every ~50 ms, so the
  overlay repainted the same candidate arrows dozens of times per search.
  The worker (upstream [8cba6a1](https://github.com/codewiththiha/gwaymaegyi/commit/8cba6a181265e08bdfab23284fddf36d346c8197)) now publishes only finished
  searches, new iterations, and real decision changes (new best move, mate
  flag, or a >=10 cp swing), with a slow ~400 ms liveness heartbeat in between.
- The runner additionally drops same-decision echo reports even from older
  workers, and the final result always lands immediately.
- Popup now explains the Instant/Balanced/Deep effort budgets (~0.1-0.5 s /
  ~0.3-1 s / ~0.4-2 s, scaled by nominal Elo) and that arrows refine as the
  search deepens.
- Engine wasm binaries are unchanged from 1.5.1 (search behavior identical);
  only the worker runtime JS was re-vendored.

## 1.5.1 - 2026-10-12

### GwayMaeGyi: stronger presets actually play stronger

- Fixed a real strength inversion in the Elo slider: above the 2200 default,
  higher presets visibly played *weaker* than 2200. Two compounding causes:
  the extension gave every preset the same flat ~220 ms move budget, which
  truncated deep high-Elo searches mid-iteration; and upstream style windows
  (opening diversity and sacrifice tolerances) were constant regardless of
  nominal Elo, while a forced five-line search reordered the top line even
  when no style choice remained. See upstream commit
  `377b4e1` (style windows and the principal-variation floor now decay with
  the nominal Elo target, closing at 3000).
- Move budgets now scale with the nominal Elo per performance profile
  (responsive ~140-480 ms, balanced ~260-980 ms, deep ~380-2000 ms), so every
  slider position completes the search it actually needs.
- Vendored upstream WASM rebuilt from gwaymaegyi `377b4e1` for both backends
  (`SOURCE.md` pin updated); upstream test suites, wasm lanes, and the
  deterministic fixture snapshot all pass unchanged.

## 1.5.0 - 2026-10-11

### Engine replacement: BallMaeGyi (Patricia) → GwayMaeGyi (Rust NNUE)

- The built-in house engine is now **GwayMaeGyi**, the safe Rust chess engine
  from <https://github.com/codewiththiha/gwaymaegyi> (NNUE evaluation with
  three embedded models, iterative PVS search, Chess960 support). It replaces
  the retired BallMaeGyi 5.1 (Patricia) Emscripten build as a strictly better,
  actively developed successor.
- Verbatim upstream WASM packages ship for both backends — `simd128` (feature
  detected at runtime) and `portable` fallback — under
  `public/engine/gwaymaegyi/`, with MIT/engine and NNUE weight licenses plus a
  `SOURCE.md` provenance record. The old `public/engine/ballmaegyi/` assets
  (~10 MB) are deleted.
- The engine runner now speaks the engine's strongly typed JSON worker
  protocol instead of UCI text lines. Searches run as cooperative bounded
  slices in a single worker, so move interrupts, retuning and stops land
  between slices instantly — the old warm-standby dual-worker and
  terminate/respawn machinery is deleted.
- Search starts only after the worker atomically validates and acks the FEN,
  so a rejected position can never analyze the wrong board. Style-picked
  human/aggressive best moves remain authoritative for on-board highlights,
  mirroring UCI `bestmove` semantics.
- Personalities map onto engine modes (Aggressive/Human-Like/Solid→balanced
  modes, Full Strength → skill 21) with the same nominal 500–3000 skill table
  upstream ships. UI now marks Elo sliders as nominal, uncalibrated presets
  per upstream guidance.
- Legacy settings auto-migrate: `patricia`/`ballmaegyi` engine ids and the
  `ballmaegyi*` tuning keys (including opening engine policy) become their
  `gwaymaegyi` equivalents without data loss.
- Stockfish, Maia-2/Maia-3 and custom WASM engines are unchanged.

## 1.4.0 - 2026-09-30

### Removed

- Post-game review feature removed entirely: `entrypoints/review/` page,
  `lib/game-recorder.ts`, `lib/game-store.ts`, `lib/review-classifier.ts`,
  and `lib/dual-engine-host.ts` deleted.
- Manual Record / Stop button and the popup's Review/Play split removed
  from the footer (only Playground + Reset remain).
- Auto-record, manual-recording and auto-review settings stripped; legacy
  saved keys are scrubbed by `normalizeSettings()`.
- Manifest `description` updated to no longer mention post-game review.

### Chess.com-only activation

- Content script `matches` remains `*://*.chess.com/*`. An additional runtime
  host check (`isChessDomain()`) bails out of `init()`, the board scanner,
  MutationObserver callbacks and any async continuations if the hostname
  is not `chess.com`, `www.chess.com`, or a subdomain thereof (belt-and-
  suspenders in case of script mis-injection, dev reloads, or testers that
  load content scripts on other origins).
- Header subtitle now reads "by codewiththiha · chess.com only"; Engine tab
  shows a one-line notice that the overlay is idle on non-chess.com sites.
- Footer simplified to Playground + Reset tab.

## 1.3.2 - 2026-09-30

### Recording

- Added a manual **Record / Stop** button in the popup footer. It messages the
  active tab to start/stop recording; Stop flushes the currently-captured
  move list to IndexedDB and notifies the Review page. Manual recordings are
  not auto-saved on board replacement (only on explicit Stop or game-over).
- Recorder is now always warmed up when a board attaches (snapshots existing
  moves on attach and is fed the same canonical SAN list the highlight
  controller reads every frame), so it never starts from an empty slate
  mid-game. `manualRecording` flag is tracked per-session.
- `autoRecordGames` toggle added to the Board tab so auto-save can be turned
  off and only the manual Record button is used.

### Defaults

- Default engine: **BallMaeGyi 5.1** (was Stockfish).
- Default personality: **human-like**.
- Default BallMaeGyi / target Elo: **2200**.
- Default MultiPV (variation count): **1** (was 2).
- Default HUD: **off** (was on).
- Default highlight shape: **square** (no rounded corners).
- Default highlight opacity: **0.28** (quieter palette, less flash).
- Default number badges on destination squares: **off**.

### Highlighter polish

- Replaced the neon palette (amber/blue/violet/rose/cyan) with muted warm
  earth-tones that sit quietly on the Chess.com board (ochre, slate,
  mauve-gray, muted brick, teal-gray; book green is now a soft moss).
- Square highlights default to `rx=0` (hard corners) per setting
  `highlightShape: 'square'`; a "Rounded" option is offered in the Board
  tab.
- Number circle badges (① ② etc.) hidden by default (`showNumberCircles:
  false`) with a toggle in the Board tab.
- Stroke opacity dialed down; fills capped to 0.65 max instead of 0.85.

### Popup UX

- **Tab persistence**: the last open tab is saved in `lastPopupTab` and
  restored on next open.
- **Reset button is scoped to the current tab**: clicking the rotate icon
  only resets settings that belong to the tab you're on (Engine, Board,
  Analysis, Strength, Opening, Advanced) instead of nuking everything.
- Record/Stop button, Review, Play (Test Bench) and Reset split the footer
  evenly.
- Board tab now also contains an Auto-record toggle, "Move number badges"
  toggle, and "Square corners" select.

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
