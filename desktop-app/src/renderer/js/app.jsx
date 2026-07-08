/* app.jsx — Pure Path main app */
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
  // the reinstall-enforcement monitor, not just the UI switch.
  useEffect(() => {
    if (window.PPNative && PPNative.available) PPNative.setGuard(!!s.blocking.uninstallGuard);
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

  const go = (page) => PP.set({ page });
  const Page = PAGES[s.page] || HubMenu;
  const isHome = s.page === 'home';
  // The panic flow is full-screen: no sidebar, nothing competing for focus.
  const isPanic = s.page === 'panic';

  return (
    <div className="window">
      <TitleBar s={s} />
      <div className="body">
        <AnimatedBG bg={t.bg} intensity={t.intensity} />
        {!isHome && !isPanic && <Sidebar s={s} go={go} />}
        <main className="content scroll" key={s.page}>
          <Page s={s} PP={PP} go={go} />
        </main>
      </div>

      <TweaksPanel>
        <TweakSection label="Appearance" />
        <TweakRadio label="Theme" value={t.theme} options={['light', 'dark']}
                    onChange={(v) => setTweak('theme', v)} />
        <TweakSelect label="Palette" value={t.style}
                     options={['aurora', 'lagoon', 'dawn', 'midnight', 'forest', 'ember', 'noir']}
                     onChange={(v) => setTweak('style', v)} />
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
