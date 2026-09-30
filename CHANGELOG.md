# Changelog

## 1.1.3 - 2026-09-30

### Added

- **Manual depth override for Patricia**: a new toggle unlocks the calculation-depth
  slider in Aggressive / Human-Like / Solid modes so you can force a custom ply count
  instead of the Elo-calibrated default. Turning the override off snaps depth back
  to the auto-calibrated value.
- **Performance / responsiveness profile** for Patricia (Instant / Balanced / Deep)
  that scales depth caps and move-time budgets. Instant mode is tuned for near-
  immediate highlight feedback.
- **22 new openings & gambits** in the catalog: Göring, Ponziani, Cochrane, Traxler,
  Max Lange, Marshall, Jaenisch, Icelandic, Frankenstein-Dracula, From's, Staunton,
  Belgrade, Blumenfeld, von Hennig-Schara, Scheveningen, Pelikan, Rossolimo, King's
  Indian Attack, Chigorin, Vienna Gambit, Rousseau, and Nakhchivan/Italian Gambit.

### Fixed

- **Patricia highlight lag at plies 12–14 in Aggressive/Human modes** is now
  effectively instant:
  - Progressive iterative-deepening info is streamed to the UI in handicapped
    modes (previously suppressed until `bestmove`, causing the visible delay).
  - A pre-warmed standby Patricia worker eliminates the WASM-reload gap on every
    new position — the busy worker is atomically swapped instead of being killed
    and reinitialized.
  - Stability window tightened from 180 ms to 60 ms (~3 animation frames).
  - Host-supplied `movetime` budgets are now honored by the Patricia worker.

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

- Keep Patricia's handicapped search lines internal until its selected move is final.
- Ignore stale shallow MultiPV lines, preserve mate scores, and prevent sampling an immediate forced loss.
- Restore the requested MultiPV setting in full-strength mode and keep five internal candidates only for handicapped searches.
- Report Patricia initialization failures instead of treating a failed or timed-out worker as ready.

### Release

- Align extension, package, and in-app versions at `1.0.1`.
- Add a tag-triggered GitHub release workflow for Chrome, Firefox, and XPI packages.
