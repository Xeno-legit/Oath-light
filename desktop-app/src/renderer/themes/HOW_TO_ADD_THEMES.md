# How to Add New Themes

Adding new themes to Pure Path is simple and doesn't require modifying the core source code heavily. We use a declarative JSON-based approach.

## 1. Create a Theme JSON File
Create a new file in this directory (`src/renderer/themes/`) with the `.json` extension (e.g., `synthwave.json`).

## 2. Define Theme Properties
The JSON file should define the CSS variables that apply to the HTML `:root` to change UI colors, as well as the WebGL variables utilized by the animated fluid background.

### Example configuration:

```json
{
  "id": "my-custom-theme",
  "name": "My Custom Theme",
  "description": "A description of the theme.",
  "type": "dark",
  "css": {
    "--bg-deep": "#080b12",
    "--bg-surface": "#0d111d",
    "--bg-elevated": "#121827",
    "--violet": "#a855f7",
    "--violet-light": "#d8b4fe",
    "--violet-dark": "#9333ea",
    "--blue": "#0ea5e9",
    "--frost": "#f8fafc",
    "--frost-muted": "#94a3b8",
    "--frost-dim": "#64748b",
    "--glass-bg": "rgba(13, 17, 29, 0.55)",
    "--glass-bg-solid": "rgba(13, 17, 29, 0.85)",
    "--glass-border": "rgba(168, 85, 247, 0.12)",
    "--glass-border-hover": "rgba(168, 85, 247, 0.28)"
  },
  "webgl": {
    "deepBg": [0.031, 0.043, 0.070],
    "violet": [0.658, 0.333, 0.968],
    "blue": [0.054, 0.647, 0.913],
    "darkViolet": [0.35, 0.10, 0.60],
    "frostHint": [0.70, 0.75, 0.85]
  }
}
```

> **Note on WebGL Colors:**
> The `webgl` colors use normalized RGB space, meaning values range from `0.0` to `1.0` instead of `0` to `255`. E.g., rgb(128, 0, 255) becomes `[0.5, 0.0, 1.0]`.

## 3. Register the Theme
Add the theme's basic metadata to the `themesList` array in `src/renderer/js/pages/themes.js` so it visually appears in the Settings UI. 

```javascript
{
  id: 'my-custom-theme',
  name: 'My Custom Theme',
  description: 'Your short description here.',
  colors: ['#080b12', '#a855f7'] // Hex values for the gradient preview card
}
```

That's it! The Theme Manager will parse your file locally when activated and push your CSS and WebGL properties live instantly.
