/* icons.jsx — polished stroke icons (Lucide-quality). Shared via window. */
const Ico = ({ d, fill, size = 20, sw = 1.8, children, ...p }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="none"
       stroke="currentColor" strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" {...p}>
    {d ? <path d={d} /> : children}
  </svg>
);

/* ── Navigation & Layout ── */
const IconGrid = (p) => <Ico {...p}><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></Ico>;
const IconList = (p) => <Ico {...p}><path d="M8 6h13M8 12h13M8 18h13" /><circle cx="3.5" cy="6" r="1" fill="currentColor" stroke="none" /><circle cx="3.5" cy="12" r="1" fill="currentColor" stroke="none" /><circle cx="3.5" cy="18" r="1" fill="currentColor" stroke="none" /></Ico>;
const IconChevron = (p) => <Ico {...p}><path d="M9 18l6-6-6-6" /></Ico>;
const IconArrowUp = (p) => <Ico {...p}><path d="M12 19V5M5 12l7-7 7 7" /></Ico>;

/* ── Shield & Security ── */
const IconShield = (p) => <Ico {...p}><path d="M12 2l8 3.5v5c0 5.25-3.38 8.25-8 10-4.62-1.75-8-4.75-8-10v-5L12 2z" /><path d="M9 12l2 2 4-4" /></Ico>;
const IconShieldOff = (p) => <Ico {...p}><path d="M12 2l8 3.5v5c0 5.25-3.38 8.25-8 10-4.62-1.75-8-4.75-8-10v-5L12 2z" /><path d="M4.5 4.5l15 15" /></Ico>;
const IconLock = (p) => <Ico {...p}><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0110 0v4" /><circle cx="12" cy="16" r="1.5" fill="currentColor" stroke="none" /></Ico>;

/* ── Actions ── */
const IconSearch = (p) => <Ico {...p}><circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" /></Ico>;
const IconPlus = (p) => <Ico {...p}><path d="M12 5v14M5 12h14" /></Ico>;
const IconX = (p) => <Ico {...p}><path d="M18 6L6 18M6 6l12 12" /></Ico>;
const IconCheck = (p) => <Ico {...p}><path d="M20 6L9 17l-5-5" /></Ico>;
const IconTrash = (p) => <Ico {...p}><path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2" /><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" /><path d="M10 11v6M14 11v6" /></Ico>;
const IconSend = (p) => <Ico {...p}><path d="M22 2L11 13" /><path d="M22 2l-7 20-4-9-9-4 20-7z" /></Ico>;

/* ── Settings & Controls ── */
const IconGear = (p) => <Ico {...p}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" /></Ico>;
const IconSliders = (p) => <Ico {...p}><path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3" /><circle cx="4" cy="12" r="2" /><circle cx="12" cy="10" r="2" /><circle cx="20" cy="14" r="2" /></Ico>;

/* ── Communication ── */
const IconChat = (p) => <Ico {...p}><path d="M21 11.5a8.38 8.38 0 01-.9 3.8 8.5 8.5 0 01-7.6 4.7 8.38 8.38 0 01-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 01-.9-3.8 8.5 8.5 0 014.7-7.6 8.38 8.38 0 013.8-.9h.5a8.48 8.48 0 018 8v.5z" /></Ico>;
const IconBell = (p) => <Ico {...p}><path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.73 21a2 2 0 01-3.46 0" /></Ico>;

/* ── Emotional / Wellness ── */
const IconHeart = (p) => <Ico {...p}><path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z" /></Ico>;
const IconFlame = (p) => <Ico {...p}><path d="M8.5 14.5A2.5 2.5 0 0011 12c0-1.38-.5-2-1-3-1.07-2.14 0-5.5 2-6.5 0 1.5.5 3 2 4.5C15.5 8.5 17 10 17 14a5 5 0 01-10 0" /></Ico>;
const IconSpark = (p) => <Ico {...p}><path d="M12 2l2.4 7.2L22 12l-7.6 2.8L12 22l-2.4-7.2L2 12l7.6-2.8L12 2z" /><path d="M20 5l.6 1.8L22.4 7.4 20.6 8 20 9.8 19.4 8l-1.8-.6L19.4 6.8z" /></Ico>;

/* ── Time & Navigation ── */
const IconClock = (p) => <Ico {...p}><circle cx="12" cy="12" r="10" /><path d="M12 6v6l4 2" /></Ico>;
const IconCompass = (p) => <Ico {...p}><circle cx="12" cy="12" r="10" /><polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76" /></Ico>;
const IconGlobe = (p) => <Ico {...p}><circle cx="12" cy="12" r="10" /><path d="M2 12h20" /><path d="M12 2a15.3 15.3 0 010 20 15.3 15.3 0 010-20z" /></Ico>;

/* ── User & Profile ── */
const IconUser = (p) => <Ico {...p}><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" /><circle cx="12" cy="7" r="4" /></Ico>;

/* ── Theme ── */
const IconSun = (p) => <Ico {...p}><circle cx="12" cy="12" r="5" /><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" /></Ico>;
const IconMoon = (p) => <Ico {...p}><path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" /></Ico>;
const IconPalette = (p) => <Ico {...p}><circle cx="13.5" cy="6.5" r="1.5" fill="currentColor" stroke="none" /><circle cx="17.5" cy="10.5" r="1.5" fill="currentColor" stroke="none" /><circle cx="8.5" cy="7.5" r="1.5" fill="currentColor" stroke="none" /><circle cx="6.5" cy="12" r="1.5" fill="currentColor" stroke="none" /><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.93 0 1.5-.67 1.5-1.5 0-.39-.15-.74-.39-1.04-.23-.29-.38-.63-.38-1.01 0-.83.67-1.5 1.5-1.5H16c3.31 0 6-2.69 6-6 0-5.52-4.48-9.95-10-9.95z" /></Ico>;

/* ── Misc ── */
const IconBook = (p) => <Ico {...p}><path d="M4 19.5A2.5 2.5 0 016.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z" /></Ico>;
const IconWave = (p) => <Ico {...p}><path d="M2 12c2-2 4-2 6 0s4 2 6 0 4-2 6 0" /><path d="M2 17c2-2 4-2 6 0s4 2 6 0 4-2 6 0" /></Ico>;
/* Two rising plumes. The mentor page's "Understand the habit" exercise leans on
   one image — "the behavior is the smoke; the fire is what's really burning
   underneath" — so this draws smoke, not a generic cloud. */
const IconSmoke = (p) => <Ico {...p}><path d="M9 21c0-2 2-2.6 2-4.5S9 14.4 9 12.5 11 9.9 11 8" /><path d="M15.4 21c0-1.7 1.6-2.2 1.6-3.8s-1.6-2.1-1.6-3.7 1.6-2.2 1.6-3.8" opacity=".55" /></Ico>;
const IconDroplet = (p) => <Ico {...p}><circle cx="12" cy="12" r="9" fill="currentColor" stroke="none" /></Ico>;

/* ── Look icons ──
 * These replaced the atmosphere set (IconOrbs / IconStars / IconRipple /
 * IconMinimal / IconAtmosphere), which drew the six animated backgrounds
 * that no longer exist. IconWave and IconSmoke survived the cull because
 * the mentor, tips, blocklist and overview pages use them for their own
 * unrelated reasons.
 *
 * Each one draws the thing its look actually paints, at 24×24 — a picture
 * of the ground, not a generic sparkle. */
const IconMatte = (p) => <Ico {...p}><rect x="3" y="4" width="18" height="16" rx="3" /><path d="M3 8h18" opacity=".55" /></Ico>;
const IconHalo = (p) => <Ico {...p}><path d="M4 14a8 8 0 0116 0" /><path d="M7 18a5 5 0 0110 0" opacity=".45" /><path d="M12 3v2" /></Ico>;
const IconFieldBg = (p) => <Ico {...p}><rect x="3" y="4" width="18" height="16" rx="3" /><path d="M4 16L16 5" opacity=".6" /><path d="M9 19l10-9" opacity=".35" /></Ico>;
const IconTheatre = (p) => <Ico {...p}><rect x="3" y="4" width="18" height="16" rx="3" /><circle cx="12" cy="12" r="4.5" opacity=".55" /></Ico>;
const IconSlate = (p) => <Ico {...p}><rect x="3" y="4" width="18" height="16" rx="3" /><path d="M9 4v16" /></Ico>;
const IconStudio = (p) => <Ico {...p}><rect x="3" y="4" width="18" height="16" rx="3" /><path d="M9 4v16M9 9h12" opacity=".7" /></Ico>;
const IconPaperBg = (p) => <Ico {...p}><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M7 9h10M7 13h10M7 17h6" opacity=".5" /></Ico>;
const IconDrafting = (p) => <Ico {...p}><circle cx="6" cy="7" r="1" fill="currentColor" stroke="none" /><circle cx="12" cy="7" r="1" fill="currentColor" stroke="none" /><circle cx="18" cy="7" r="1" fill="currentColor" stroke="none" /><circle cx="6" cy="12" r="1" fill="currentColor" stroke="none" /><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" /><circle cx="18" cy="12" r="1" fill="currentColor" stroke="none" /><circle cx="6" cy="17" r="1" fill="currentColor" stroke="none" /><circle cx="12" cy="17" r="1" fill="currentColor" stroke="none" /><circle cx="18" cy="17" r="1" fill="currentColor" stroke="none" /></Ico>;
const IconCloth = (p) => <Ico {...p}><path d="M4 9l5-5M4 15l11-11M9 20l11-11M15 20l5-5" /></Ico>;
const IconContour = (p) => <Ico {...p}><path d="M2 16c4-4 7-1 10-5s7-2 10-5" /><path d="M2 20c4-4 7-1 10-5s7-2 10-5" opacity=".55" /><path d="M2 12c4-4 7-1 10-5s7-2 10-5" opacity=".55" /></Ico>;
const IconEngrave = (p) => <Ico {...p}><circle cx="12" cy="12" r="2" /><circle cx="12" cy="12" r="5.5" opacity=".65" /><circle cx="12" cy="12" r="9" opacity=".4" /></Ico>;
const IconHalftone = (p) => <Ico {...p}><circle cx="6" cy="7" r=".8" fill="currentColor" stroke="none" /><circle cx="12" cy="7" r=".8" fill="currentColor" stroke="none" /><circle cx="18" cy="7" r=".8" fill="currentColor" stroke="none" /><circle cx="6" cy="12.5" r="1.5" fill="currentColor" stroke="none" /><circle cx="12" cy="12.5" r="1.5" fill="currentColor" stroke="none" /><circle cx="18" cy="12.5" r="1.5" fill="currentColor" stroke="none" /><circle cx="6" cy="18" r="2.2" fill="currentColor" stroke="none" /><circle cx="12" cy="18" r="2.2" fill="currentColor" stroke="none" /><circle cx="18" cy="18" r="2.2" fill="currentColor" stroke="none" /></Ico>;

/* ── Wallpaper / interface ── */
const IconImage = (p) => <Ico {...p}><rect x="3" y="4" width="18" height="16" rx="3" /><circle cx="8.5" cy="9.5" r="1.8" /><path d="M3 17l5-4.5 4 3.5 3-2.5 6 5" /></Ico>;
const IconDensity = (p) => <Ico {...p}><path d="M4 5h16M4 12h16M4 19h16" /><path d="M4 8.5h16M4 15.5h16" opacity=".4" /></Ico>;
const IconMotionOff = (p) => <Ico {...p}><circle cx="12" cy="12" r="9" /><path d="M4.5 4.5l15 15" /></Ico>;

Object.assign(window, {
  IconShield, IconGrid, IconList, IconPalette, IconSliders, IconChat, IconSpark,
  IconGear, IconUser, IconPlus, IconSearch, IconSun, IconMoon, IconLock, IconClock,
  IconChevron, IconX, IconSend, IconCheck, IconTrash, IconFlame, IconHeart, IconBell,
  IconShieldOff, IconCompass, IconGlobe, IconBook, IconArrowUp, IconWave, IconDroplet,
  IconSmoke,
  IconMatte, IconHalo, IconFieldBg, IconTheatre, IconSlate, IconStudio,
  IconPaperBg, IconDrafting, IconCloth, IconContour, IconEngrave, IconHalftone,
  IconImage, IconDensity, IconMotionOff,
});
