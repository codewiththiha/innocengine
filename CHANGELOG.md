# Changelog

## 1.2.1 - 2026-09-30

### Fixed

- Hide the opening bubble with the privacy hotkey (Alt+H), which already blanks
  the highlights, evaluation bar and HUD.
- Gather the Chrome, Firefox and AMO sources zips next to the XPI before the CI
  artifact is uploaded: `.output` is a dot-directory and upload-artifact skips
  hidden files, so the artifact shipped with the XPIs only. Both workflows now
  verify that every artefact kind exists and is non-empty before publishing.

## 1.2.0 - 2026-09-30

### Added

- Add a draggable live opening bubble that names the catalogue line the position
  belongs to, tracks both sides move by move, and shows the engine, depth, hash,
  thread count and response time. It collapses to a handle and remembers where it
  was dragged to.
- Add paced auto-move: instant, fixed-delay or human-like timing, with a
  deterministic think-time model (same position, same time), selectable minimum
  and maximum think time, a maximum auto-move count, side selection, and pause
  when the tab is hidden. The bubble carries a Play/Stop toggle for it.
- Add a Patricia processing-power slider beside the Hash control that scales
  search threads and think time together, plus a switch for the pthread build.
- Add a Patricia aggressiveness control with five presets (Solid, Balanced,
  Aggressive, Bullet, Chaos), backed by a real engine option.
- Add a think-time budget and a highlight settle-time control to the Analysis tab.
- Add 47 researched openings and gambits, bringing the catalogue to 146 lines:
  the King's Gambit family, Traxler, Ulvestad, Marshall, Jaenisch, the sharpened
  Sicilian and Indian systems, and the more combative black defences.

### Changed

- Keep the Patricia engine warm across moves instead of rebuilding the worker per
  position, which was the main cause of the ply 12-14 highlight lag.
- Derive the highlight settle window from settings, so it can be reduced to zero
  and commit every search improvement the moment it arrives.
- Build the Firefox MV2, MV3, AMO sources and XPI artefacts on every push, so the
  release path is exercised by CI rather than by the release itself.
- Declare cross-origin isolation in the Chromium manifest, which is what allows
  the pthread Patricia build to use more than one core.

### Fixed

- Forward the parallel-threads preference to the engine host; the message carried
  a run-option name that does not exist on settings, so the flag was dropped.
- Keep the bubble's own DOM out of the board observer's mutation handling and out
  of the synthetic input target, so dragging or updating it cannot disturb the
  board.

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
