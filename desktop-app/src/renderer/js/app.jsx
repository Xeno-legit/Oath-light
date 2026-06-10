/* app.jsx — Pure Path main app */
const { useState, useEffect } = React;

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "theme": "dark",
  "style": "aurora",
  "bg": "both",
  "intensity": 7
}/*EDITMODE-END*/;

const PAGES = {
  home: HubMenu,
  overview: OverviewPage,
  blocklist: BlocklistPage,
  blocking: BlockingPage,
  mentor: MentorPage,
  tips: TipsPage,
  themes: ThemesPage,
  settings: SettingsPage,
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
  useEffect(() => {
    PP.set({ display: { theme: t.theme, style: t.style, bg: t.bg, intensity: t.intensity } });
  }, [t.theme, t.style, t.bg, t.intensity]);

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

  return (
    <div className="window">
      <TitleBar s={s} />
      <div className="body">
        <AnimatedBG bg={t.bg} intensity={t.intensity} />
        {!isHome && <Sidebar s={s} go={go} />}
        <main className="content scroll" key={s.page}>
          <Page s={s} PP={PP} go={go} />
        </main>
      </div>

      <TweaksPanel>
        <TweakSection label="Appearance" />
        <TweakRadio label="Theme" value={t.theme} options={['light', 'dark']}
                    onChange={(v) => setTweak('theme', v)} />
        <TweakSelect label="Palette" value={t.style}
                     options={['aurora', 'lagoon', 'dawn', 'midnight', 'forest', 'ember']}
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
