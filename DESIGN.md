# Popup design system

The extension popup is a compact chess annotation tool, not a marketing page or a dashboard.

## Direction

**Chess annotation desk.** The interface should feel like a precise working surface: warm paper neutrals, dark ink typography, a restrained oxblood action color, and compact data-oriented controls. The board overlay retains semantic chess colors: amber and blue for engine variations, emerald for repertoire theory.

## Tokens

- Canvas: `#f3f0e9`; surface: `#fffdf8`; muted surface: `#ece8df`
- Ink: `#20252d`; muted text: `#59616d`; lines: `#d7d1c6`
- One action accent: `#963d30`; success is reserved for ready state
- Radius: 6–10px; spacing scale: 4, 8, 12, 16, 24px
- Typography: a single native sans stack; tabular monospace only for moves, depths, and numeric readings

## Interaction rules

- Settings are grouped by purpose and separated with lines, not a field of nested cards.
- Controls have visible `:focus-visible` treatment and direct labels.
- Transitions affect color and background only, stay below 200ms, and honor reduced motion.
- Book theory and engine analysis are distinguished by source and color, never hidden behind decorative copy.

## Exclusions

No glass panels, decorative gradients, default purple/cyan palettes, oversized rounded pills, fake metrics, hero sections, or animation used to create visual drama.
