/* bg.jsx — the static ground behind the app.
 *
 * This file used to build the atmosphere: three drifting orbs, three
 * translating wave paths, sixteen rising particles, eighty twinkling stars,
 * four expanding ripple rings and six smoke clouds, each with its own
 * randomised duration and delay, rebuilt in JS on every mount. Roughly a
 * hundred always-running animations, none of them carrying information.
 *
 * It is now seven empty elements.
 *
 * Everything visible is decided in CSS by `[data-look]` on <html>, which sets
 * the `--ground-*` custom properties these layers read (see the GROUND
 * section of styles.css). A layer whose token is unset resolves to `none` and
 * paints nothing, so the same markup serves every look and no look needs a
 * branch here. Adding a look is a CSS change alone — this component does not
 * know what looks exist, and that is the point.
 *
 * Nothing here takes props any more. Motion is gone, so `intensity` had
 * nothing to scale; the look is an attribute on the document, so `bg` had
 * nothing to switch on. React.memo with no props means it renders exactly
 * once for the lifetime of the window.
 */
const AnimatedBG = React.memo(function Ground() {
  return (
    <div className="bg" aria-hidden="true">
      {/* Back to front. The wallpaper and its scrim are first so every
          texture below sits ON the user's image rather than under it —
          otherwise a grain layer would be invisible the moment someone
          set a photograph. */}
      <i className="bg-wall" />
      <i className="bg-wall-scrim" />
      <i className="bg-pattern" />
      <i className="bg-field" />
      <i className="bg-glow" />
      <i className="bg-grain" />
      <i className="bg-vignette" />
    </div>
  );
});
window.AnimatedBG = AnimatedBG;
