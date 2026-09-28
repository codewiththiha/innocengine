# Changelog

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
