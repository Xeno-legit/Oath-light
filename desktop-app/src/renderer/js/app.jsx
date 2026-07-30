/* app.jsx — Oath Light main app */
const { useState, useEffect } = React;

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "theme": "dark",
  "look": "matte",
  "neutral": "pure",
  "density": "comfortable",
  "motion": "on"
}/*EDITMODE-END*/;

// `monitor` is not routed any more — the AI screen monitor is a section
// inside Blocking Settings (see MonitorSection in pages-blocking.jsx), not a
// destination of its own.
const PAGES = {
  home: HubMenu,
  overview: OverviewPage,
  blocklist: BlocklistPage,
  blocking: BlockingPage,
  mentor: MentorPage,
  tips: TipsPage,
  themes: ThemesPage,
  settings: SettingsPage,
  panic: PanicPage,
};

function App() {
  const [s, PP] = usePP();
  const [t, setTweak] = useTweaks(TWEAK_DEFAULTS);

  // Serious Mode (UX Direction §1) — mirror the backend's flag into the store,
  // once, here at the root. Everything else in the app reads `s.serious`; the
  // store's own `syncVoice` turns that into the active voice plus the
  // `[data-serious]` attribute tokens.css hangs its visual overrides off, so
  // copy and chrome flip together on the same render.
  useSeriousMode();

  // expose a single setter so the Themes page can write display tweaks too
  useEffect(() => {
    window.__setDisplayTweak = (patch) => {
      Object.entries(patch).forEach(([k, v]) => setTweak(k, v));
    };
  }, [setTweak]);

  // keep store.display mirrored from tweaks (for components that read s.display)
  // and push it to the browser extensions so their pages match the app theme.
  useEffect(() => {
    const display = {
      theme: t.theme, look: t.look, neutral: t.neutral,
      density: t.density, motion: t.motion,
    };
    PP.set({ display });
    if (window.PPNative && PPNative.available) PPNative.setTheme(display);
  }, [t.theme, t.look, t.neutral, t.density, t.motion]);

  // mirror the app's day streak down to the browser extensions
  useEffect(() => {
    if (window.PPNative && PPNative.available) PPNative.setStreak(s.streak || 0);
  }, [s.streak]);

  // push blocking settings (the "Redirect link" target + the focus-schedule
  // reminders) down to the extensions so they actually take effect in-browser.
  const b = s.blocking || {};
  const blockingPayload = {
    redirectLinkOn: !!b.redirectLinkOn,
    redirectUrl: b.redirectUrl || '',
    vulnerable: b.vulnerable || { on: false },
    alerts: b.alerts || [],
    youtubeRestrict: !!b.youtubeRestrict,
    // Strictness preset (6.4) — the extension reads this to decide whether the
    // higher-false-positive layers (3.7's path/query keywords) are armed.
    strictness: b.strictness || 'strict',
    // Voice (UX Direction §2). The extension's pages and service worker speak
    // in the same register as the desktop app; `serious` is NOT sent from here
    // — the backend injects it into this same payload from its own persisted
    // settings (broadcast_blocking), because a renderer-supplied value must
    // never be able to claim Serious Mode is off.
    //
    // Which is why this is now a constant. Serious Mode is the only thing that
    // changes the tone, the extension already forces the hard voice from the
    // backend's `serious` flag (voice-sync.js), and a stale 'serious' left in
    // a saved profile by the removed voice picker must not outlive it.
    voice: 'companion',
    // UI language, same channel and same reasoning as `voice`: the block
    // screen and the popup should not be in a different language from the
    // app that configured them. voice-sync.js reads it and also derives the
    // page's text direction from it, so `dir` is never sent separately.
    locale: s.locale || 'en',
    // Habit replacement (5.6) — the user's own alternatives, rendered on the
    // extension's block screen. Sent as data, so the block page needs no
    // knowledge of what any individual entry means.
    alternatives: (b.alternatives || []).slice(0, 6),
  };
  useEffect(() => {
    if (window.PPNative && PPNative.available) PPNative.setBlocking(blockingPayload);
  }, [JSON.stringify(blockingPayload)]);

  // push the user's "my blocklist" custom sites down to the extensions — this
  // is the only thing that makes a site added in the UI actually get blocked;
  // the renderer's localStorage list stays the source of truth.
  const customSiteUrls = (s.blocklist.customSites || []).map((x) => x.url);
  useEffect(() => {
    if (window.PPNative && PPNative.available) PPNative.setCustomDomains(customSiteUrls);
  }, [JSON.stringify(customSiteUrls)]);

  // push the uninstall-guard toggle down to the backend so it actually (dis)arms
  // the reinstall-enforcement monitor, not just the UI switch. This is pure
  // reconciliation (mirroring the store's current value down to the backend,
  // not a user-initiated toggle), so it deliberately passes no master-
  // password token (4.2) — a rejected weakening here is the CORRECT outcome
  // when a password is set: it means the actual toggle-off click already
  // went through the gated path in pages-blocking.jsx, and if that path
  // itself was cancelled, the store's own value never changed, so this
  // effect wouldn't even fire. The catch just keeps a rejected weakening
  // from surfacing as an unhandled promise rejection.
  useEffect(() => {
    if (window.PPNative && PPNative.available) {
      PPNative.setGuard(!!s.blocking.uninstallGuard).catch(() => {});
    }
  }, [s.blocking.uninstallGuard]);

  // Panic / SOS entry (5.1): the tray "I need help now" item, the global
  // Ctrl+Shift+Space hotkey and the extension blocked page's deep-link all
  // funnel into the backend's `open-panic` event; a request that fired before
  // this listener existed (cold start) is caught by the pending flag, which
  // take_panic_pending consumes at most once.
  useEffect(() => {
    if (!(window.PPNative && PPNative.available)) return;
    let unlisten = null, cancelled = false;
    PPNative.onOpenPanic(() => PP.set({ page: 'panic' }))
      .then((fn) => { if (cancelled) fn(); else unlisten = fn; });
    PPNative.takePanicPending().then((pending) => {
      if (pending && !cancelled) PP.set({ page: 'panic' });
    });
    return () => { cancelled = true; if (unlisten) unlisten(); };
  }, []);

  // Apply theme + motion intensity to the document.
  //
  // `data-style` is deliberately NOT set any more. It used to carry a palette
  // name that every stylesheet keyed its colours off, and six of the seven
  // possible values have been gone since Noir became the only built-in theme.
  // What was left was an attribute nothing read — while three surfaces still
  // wrote it and one HTML file still shipped a stale `aurora` in it.
  // Apply the display axes to the document.
  //
  // All five are plain attributes on <html>, because that is the cheapest
  // possible switch: CSS keys every look, temper and density off them with
  // no JS in the paint path and no inline styles to keep in sync. This
  // replaced `--intensity`, a numeric custom property that existed only to
  // scale animations that no longer exist.
  //
  // `pure`, `comfortable` and `on` are the defaults and are written as an
  // ABSENT attribute rather than an explicit value, so the CSS default in
  // :root is the thing that applies and there is exactly one source for it.
  //
  // `data-style` is still deliberately not set: it carried a palette name
  // that nothing has read since Noir became the only built-in theme.
  useEffect(() => {
    const el = document.documentElement;
    el.setAttribute('data-theme', t.theme);
    el.setAttribute('data-look', t.look || 'matte');
    const flag = (attr, value, dflt) => {
      if (!value || value === dflt) el.removeAttribute(attr);
      else el.setAttribute(attr, value);
    };
    flag('data-neutral', t.neutral, 'pure');
    flag('data-density', t.density, 'comfortable');
    flag('data-motion', t.motion === 'off' ? 'off' : null, null);
  }, [t.theme, t.look, t.neutral, t.density, t.motion]);

  // Wallpaper (UX Direction §7). The image is read from its own localStorage
  // key rather than the store — see PP.wallpaper — and applied as a `url()`
  // custom property that the .bg-wall layer consumes.
  //
  // The dim floor is enforced HERE as well as in the Themes page slider,
  // because this is the value that actually reaches the screen: a profile
  // hand-edited to `dim: 0` would otherwise render an interface with white
  // text on someone's holiday photo. Legibility is not a preference.
  const wall = s.wallpaper || {};
  useEffect(() => {
    const el = document.documentElement;
    const src = wall.on ? PP.wallpaper.read() : null;
    if (src) {
      el.style.setProperty('--wallpaper', `url("${src}")`);
      el.style.setProperty('--wallpaper-dim', String(Math.min(90, Math.max(25, +wall.dim || 55)) / 100));
      el.style.setProperty('--wallpaper-blur', `${Math.min(24, Math.max(0, +wall.blur || 0))}px`);
    } else {
      el.style.removeProperty('--wallpaper');
      el.style.removeProperty('--wallpaper-dim');
      el.style.removeProperty('--wallpaper-blur');
    }
  }, [wall.on, wall.dim, wall.blur, wall.name]);

  // User-custom colors (UX Direction §7): apply the active theme side's
  // `--ol-*` overrides as inline custom properties on the root element, so
  // they win over tokens.css's defaults and cascade through styles.css's own
  // variables, which alias the --ol-* tokens).
  //
  // Every managed token is written on each pass — cleared ones are explicitly
  // REMOVED rather than left behind, otherwise resetting a color in the
  // Themes page would appear to do nothing until a reload.
  const customTokens = s.customTokens || {};
  const activeSide = t.theme === 'light' ? 'light' : 'dark';
  const sideOverrides = customTokens[activeSide] || {};
  useEffect(() => {
    const el = document.documentElement;
    const managed = ((window.OL_TOKENS || []).filter((tok) => tok.group === 'color'));
    managed.forEach((tok) => {
      const v = sideOverrides[tok.name];
      if (v) el.style.setProperty(tok.name, v);
      else el.style.removeProperty(tok.name);
    });
  }, [activeSide, JSON.stringify(sideOverrides)]);

  const go = (page) => PP.set({ page });
  const Page = PAGES[s.page] || HubMenu;
  const isHome = s.page === 'home';
  // The panic flow is full-screen: no sidebar, nothing competing for focus.
  const isPanic = s.page === 'panic';
  // First run (6.4): the wizard replaces the whole app surface until it's
  // completed OR skipped — either outcome sets `onboarded`, so it appears
  // exactly once and can never trap someone who wants past it.
  const needsOnboarding = !s.onboarded;

  return (
    <div className="window">
      <PasswordGate />
      <TitleBar s={s} />
      <div className="body">
        <AnimatedBG />
        {!isHome && !isPanic && !needsOnboarding && <Sidebar s={s} go={go} />}
        {/* One boundary per page. `<main>` is already keyed on the page id, so
            the boundary remounts (and the error clears) the moment the user
            navigates away — a broken page costs them that page, not the app.
            See ErrorBoundary in ui.jsx for why this exists at all. */}
        <main className="content scroll" key={needsOnboarding ? 'onboarding' : s.page}>
          <ErrorBoundary onHome={() => go('home')}>
            {needsOnboarding ?
              <OnboardingFlow s={s} PP={PP} /> :
              <Page s={s} PP={PP} go={go} />}
          </ErrorBoundary>
        </main>
      </div>

      <TweaksPanel>
        <TweakSection label="Appearance" />
        <TweakRadio label="Theme" value={t.theme} options={['light', 'dark']}
                    onChange={(v) => setTweak('theme', v)} />
        {/* Palette picker removed (UX Direction §7): Noir is the only built-in
            theme. Custom colors live on the Themes page as token overrides. */}
        {/* The atmosphere pair (a seven-option background picker and a 0–10
            motion slider) is gone with the animated background itself. What
            replaced it is the same set of axes the Themes page exposes, so
            the two stay in lockstep — which was the original reason these
            controls were mirrored here at all. */}
        <TweakSelect label="Look" value={t.look}
                     options={['matte', 'halo', 'field', 'theatre', 'slate', 'studio',
                               'paper', 'drafting', 'cloth', 'contour', 'engrave', 'halftone']}
                     onChange={(v) => setTweak('look', v)} />
        <TweakRadio label="Neutral" value={t.neutral} options={['pure', 'cool', 'warm']}
                    onChange={(v) => setTweak('neutral', v)} />
        <TweakSection label="Interface" />
        <TweakRadio label="Density" value={t.density} options={['comfortable', 'compact']}
                    onChange={(v) => setTweak('density', v)} />
        <TweakRadio label="Motion" value={t.motion} options={['on', 'off']}
                    onChange={(v) => setTweak('motion', v)} />
      </TweaksPanel>
    </div>
  );
}

// Last resort: catches anything thrown outside the routed page — the title
// bar, the sidebar, the tweaks panel, or App's own body. A root-level throw
// still costs the whole window, but it costs it as a message with a reload
// button rather than as a black rectangle.
ReactDOM.createRoot(document.getElementById('root')).render(
  <ErrorBoundary scope="app"><App /></ErrorBoundary>
);
