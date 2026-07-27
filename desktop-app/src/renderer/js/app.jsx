/* app.jsx — Oath Light main app */
const { useState, useEffect } = React;

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "theme": "dark",
  "style": "noir",
  "bg": "both",
  "intensity": 7
}/*EDITMODE-END*/;

const PAGES = {
  home: HubMenu,
  overview: OverviewPage,
  monitor: MonitorPage,
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
    const display = { theme: t.theme, style: t.style, bg: t.bg, intensity: t.intensity };
    PP.set({ display });
    if (window.PPNative && PPNative.available) PPNative.setTheme(display);
  }, [t.theme, t.style, t.bg, t.intensity]);

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
    strictness: b.strictness || 'balanced',
    // Voice (UX Direction §2). The extension's pages and service worker speak
    // in the same register as the desktop app; `serious` is NOT sent from here
    // — the backend injects it into this same payload from its own persisted
    // settings (broadcast_blocking), because a renderer-supplied value must
    // never be able to claim Serious Mode is off.
    voice: s.voice || 'companion',
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

  // apply theme/style/intensity to the document
  useEffect(() => {
    const el = document.documentElement;
    el.setAttribute('data-theme', t.theme);
    el.setAttribute('data-style', t.style);
    el.style.setProperty('--intensity', String((t.intensity || 0) / 10));
  }, [t.theme, t.style, t.intensity]);

  // User-custom colors (UX Direction §7): apply the active theme side's
  // `--ol-*` overrides as inline custom properties on the root element, so
  // they win over tokens.css's defaults and cascade through styles.css's own
  // variables (which alias the --ol-* tokens under [data-style="noir"]).
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
        <AnimatedBG bg={t.bg} intensity={t.intensity} />
        {!isHome && !isPanic && !needsOnboarding && <Sidebar s={s} go={go} />}
        <main className="content scroll" key={needsOnboarding ? 'onboarding' : s.page}>
          {needsOnboarding ?
            <OnboardingFlow s={s} PP={PP} /> :
            <Page s={s} PP={PP} go={go} />}
        </main>
      </div>

      <TweaksPanel>
        <TweakSection label="Appearance" />
        <TweakRadio label="Theme" value={t.theme} options={['light', 'dark']}
                    onChange={(v) => setTweak('theme', v)} />
        {/* Palette picker removed (UX Direction §7): Noir is the only built-in
            theme. Custom colors live on the Themes page as token overrides. */}
        <TweakSection label="Atmosphere" />
        <TweakSelect label="Background" value={t.bg}
                     options={['both', 'orbs', 'waves', 'stars', 'ripple', 'smoke', 'off']}
                     onChange={(v) => setTweak('bg', v)} />
        <TweakSlider label="Motion" value={t.intensity} min={0} max={10}
                     onChange={(v) => setTweak('intensity', v)} />
      </TweaksPanel>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
