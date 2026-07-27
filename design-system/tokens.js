/* ============================================================
   OATH LIGHT — DESIGN TOKEN MANIFEST
   Metadata only, NO values — values live in tokens.css and are read
   live via getComputedStyle() by preview.html. This file just tells
   the editor which --ol-* custom properties exist, how to group
   them, and what kind of control to build for each.

   Keep this in sync with tokens.css by hand: every custom property
   declared in tokens.css's :root block (i.e. every editable token)
   must have exactly one entry here, in the same order they appear
   in tokens.css, grouped the same way. Tokens introduced only inside
   [data-serious] are NOT listed separately — they reuse names already
   covered by the :root entries below (serious mode overrides existing
   tokens, it doesn't add new ones).

   type meanings (used by preview.html to pick a control):
     'color'  -> <input type=color>, falls back to a text input if the
                 current computed value isn't a plain hex/rgb color
                 (e.g. rgba() with alpha, which <input type=color>
                 cannot represent)
     'length' -> numeric value with a CSS unit (px, ms, %) — rendered
                 as a paired range + number input, unit preserved
     'number' -> plain unitless numeric value (font-weight, line-height)
     'text'   -> anything else (font stacks, shadows, cubic-bezier
                 easings) — free-text input
   ============================================================ */

globalThis.OL_TOKENS = [
  /* ---------------- color ---------------- */
  { name: '--ol-bg-0',           group: 'color', type: 'color', label: 'Background 0 (deepest)' },
  { name: '--ol-bg-1',           group: 'color', type: 'color', label: 'Background 1' },
  { name: '--ol-bg-2',           group: 'color', type: 'color', label: 'Background 2 (raised)' },
  { name: '--ol-bg-3',           group: 'color', type: 'color', label: 'Background 3 (most raised)' },
  { name: '--ol-text-1',         group: 'color', type: 'color', label: 'Text — primary' },
  { name: '--ol-text-2',         group: 'color', type: 'color', label: 'Text — secondary' },
  { name: '--ol-text-3',         group: 'color', type: 'color', label: 'Text — muted' },
  { name: '--ol-accent',         group: 'color', type: 'color', label: 'Accent' },
  { name: '--ol-accent-2',       group: 'color', type: 'color', label: 'Accent 2' },
  { name: '--ol-accent-3',       group: 'color', type: 'color', label: 'Accent 3' },
  { name: '--ol-accent-ink',     group: 'color', type: 'color', label: 'Ink on accent' },
  { name: '--ol-ok',             group: 'color', type: 'color', label: 'Status — OK' },
  { name: '--ol-warn',           group: 'color', type: 'color', label: 'Status — warning' },
  { name: '--ol-danger',         group: 'color', type: 'color', label: 'Status — danger' },
  { name: '--ol-border',         group: 'color', type: 'color', label: 'Border' },
  { name: '--ol-border-strong',  group: 'color', type: 'color', label: 'Border — strong' },
  { name: '--ol-focus-ring',     group: 'color', type: 'color', label: 'Focus ring' },

  /* ---------------- typography ---------------- */
  { name: '--ol-font-ui',        group: 'type',  type: 'text',   label: 'Font — UI stack' },
  { name: '--ol-font-display',   group: 'type',  type: 'text',   label: 'Font — display stack' },
  { name: '--ol-size-xs',        group: 'type',  type: 'length', label: 'Size — XS' },
  { name: '--ol-size-sm',        group: 'type',  type: 'length', label: 'Size — SM' },
  { name: '--ol-size-base',      group: 'type',  type: 'length', label: 'Size — Base' },
  { name: '--ol-size-md',        group: 'type',  type: 'length', label: 'Size — MD' },
  { name: '--ol-size-lg',        group: 'type',  type: 'length', label: 'Size — LG' },
  { name: '--ol-size-xl',        group: 'type',  type: 'length', label: 'Size — XL' },
  { name: '--ol-size-2xl',       group: 'type',  type: 'length', label: 'Size — 2XL' },
  { name: '--ol-size-3xl',       group: 'type',  type: 'length', label: 'Size — 3XL' },
  { name: '--ol-size-4xl',       group: 'type',  type: 'length', label: 'Size — 4XL' },
  { name: '--ol-weight-regular', group: 'type',  type: 'number', label: 'Weight — regular' },
  { name: '--ol-weight-medium',  group: 'type',  type: 'number', label: 'Weight — medium' },
  { name: '--ol-weight-semibold',group: 'type',  type: 'number', label: 'Weight — semibold' },
  { name: '--ol-weight-bold',    group: 'type',  type: 'number', label: 'Weight — bold' },
  { name: '--ol-weight-black',   group: 'type',  type: 'number', label: 'Weight — black' },
  { name: '--ol-leading-tight',    group: 'type', type: 'number', label: 'Line-height — tight' },
  { name: '--ol-leading-snug',     group: 'type', type: 'number', label: 'Line-height — snug' },
  { name: '--ol-leading-normal',   group: 'type', type: 'number', label: 'Line-height — normal' },
  { name: '--ol-leading-relaxed',  group: 'type', type: 'number', label: 'Line-height — relaxed' },

  /* ---------------- spacing ---------------- */
  { name: '--ol-space-1', group: 'space', type: 'length', label: 'Space 1' },
  { name: '--ol-space-2', group: 'space', type: 'length', label: 'Space 2' },
  { name: '--ol-space-3', group: 'space', type: 'length', label: 'Space 3' },
  { name: '--ol-space-4', group: 'space', type: 'length', label: 'Space 4' },
  { name: '--ol-space-5', group: 'space', type: 'length', label: 'Space 5' },
  { name: '--ol-space-6', group: 'space', type: 'length', label: 'Space 6' },
  { name: '--ol-space-7', group: 'space', type: 'length', label: 'Space 7' },
  { name: '--ol-space-8', group: 'space', type: 'length', label: 'Space 8' },

  /* ---------------- radii ---------------- */
  { name: '--ol-radius-sm',   group: 'radius', type: 'length', label: 'Radius — SM' },
  { name: '--ol-radius-md',   group: 'radius', type: 'length', label: 'Radius — MD' },
  { name: '--ol-radius-lg',   group: 'radius', type: 'length', label: 'Radius — LG' },
  { name: '--ol-radius-xl',   group: 'radius', type: 'length', label: 'Radius — XL' },
  { name: '--ol-radius-pill', group: 'radius', type: 'length', label: 'Radius — pill' },

  /* ---------------- shadow / elevation ---------------- */
  { name: '--ol-shadow-sm',    group: 'shadow', type: 'text',   label: 'Shadow — small' },
  { name: '--ol-shadow-md',    group: 'shadow', type: 'text',   label: 'Shadow — medium' },
  { name: '--ol-blur-panel',   group: 'shadow', type: 'length', label: 'Panel blur' },

  /* ---------------- motion ---------------- */
  { name: '--ol-duration-fast',   group: 'motion', type: 'length', label: 'Duration — fast' },
  { name: '--ol-duration-base',   group: 'motion', type: 'length', label: 'Duration — base' },
  { name: '--ol-duration-slow',   group: 'motion', type: 'length', label: 'Duration — slow' },
  { name: '--ol-ease-standard',   group: 'motion', type: 'text',   label: 'Ease — standard' },
  { name: '--ol-ease-spring',     group: 'motion', type: 'text',   label: 'Ease — spring' },
];
