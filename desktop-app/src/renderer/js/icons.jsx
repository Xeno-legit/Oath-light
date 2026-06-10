/* icons.jsx — minimal stroke icons. Shared via window. */
const Ico = ({ d, fill, size = 20, sw = 1.7, children, ...p }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="none"
       stroke="currentColor" strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" {...p}>
    {d ? <path d={d} /> : children}
  </svg>
);

const IconShield = (p) => <Ico {...p}><path d="M12 3l7 3v5c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6l7-3z" /><path d="M9 12l2 2 4-4" /></Ico>;
const IconGrid = (p) => <Ico {...p}><rect x="3.5" y="3.5" width="7" height="7" rx="2" /><rect x="13.5" y="3.5" width="7" height="7" rx="2" /><rect x="3.5" y="13.5" width="7" height="7" rx="2" /><rect x="13.5" y="13.5" width="7" height="7" rx="2" /></Ico>;
const IconList = (p) => <Ico {...p}><path d="M8 6h12M8 12h12M8 18h12" /><circle cx="4" cy="6" r="1.2" fill="currentColor" stroke="none" /><circle cx="4" cy="12" r="1.2" fill="currentColor" stroke="none" /><circle cx="4" cy="18" r="1.2" fill="currentColor" stroke="none" /></Ico>;
const IconPalette = (p) => <Ico {...p}><path d="M12 3a9 9 0 100 18c1.1 0 2-.9 2-2 0-.5-.2-1-.6-1.3-.3-.4-.5-.8-.5-1.2 0-.8.7-1.5 1.6-1.5H16a5 5 0 005-5c0-3.9-4-7-9-7z" /><circle cx="7.5" cy="11" r="1.1" fill="currentColor" stroke="none" /><circle cx="12" cy="7.5" r="1.1" fill="currentColor" stroke="none" /><circle cx="16.5" cy="11" r="1.1" fill="currentColor" stroke="none" /></Ico>;
const IconSliders = (p) => <Ico {...p}><path d="M5 21V14M5 10V3M12 21v-9M12 8V3M19 21v-5M19 12V3" /><circle cx="5" cy="12" r="2" /><circle cx="12" cy="10" r="2" /><circle cx="19" cy="14" r="2" /></Ico>;
const IconChat = (p) => <Ico {...p}><path d="M21 12a8 8 0 01-11.5 7.2L4 21l1.8-5.5A8 8 0 1121 12z" /></Ico>;
const IconSpark = (p) => <Ico {...p}><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3z" /><path d="M18.5 16.5l.7 2 .8-2 .8-.7-.8-.8M5 17l.5 1.5L7 19l-1.5.5L5 21" /></Ico>;
const IconGear = (p) => <Ico {...p}><circle cx="12" cy="12" r="3.2" /><path d="M19.4 13a7.8 7.8 0 000-2l2-1.5-2-3.4-2.3 1a8 8 0 00-1.7-1l-.4-2.6H9.9l-.4 2.6a8 8 0 00-1.7 1l-2.3-1-2 3.4L5.6 11a7.8 7.8 0 000 2l-2 1.5 2 3.4 2.3-1a8 8 0 001.7 1l.4 2.6h4.2l.4-2.6a8 8 0 001.7-1l2.3 1 2-3.4-2-1.5z" /></Ico>;
const IconUser = (p) => <Ico {...p}><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4 3.6-6.5 8-6.5s8 2.5 8 6.5" /></Ico>;
const IconPlus = (p) => <Ico {...p}><path d="M12 5v14M5 12h14" /></Ico>;
const IconSearch = (p) => <Ico {...p}><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></Ico>;
const IconSun = (p) => <Ico {...p}><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M2 12h2M20 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4" /></Ico>;
const IconMoon = (p) => <Ico {...p}><path d="M20 14.5A8 8 0 119.5 4a6.5 6.5 0 0010.5 10.5z" /></Ico>;
const IconLock = (p) => <Ico {...p}><rect x="4.5" y="10.5" width="15" height="10" rx="2.5" /><path d="M8 10.5V8a4 4 0 018 0v2.5" /><circle cx="12" cy="15.5" r="1.4" fill="currentColor" stroke="none" /></Ico>;
const IconClock = (p) => <Ico {...p}><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></Ico>;
const IconChevron = (p) => <Ico {...p}><path d="M9 6l6 6-6 6" /></Ico>;
const IconX = (p) => <Ico {...p}><path d="M6 6l12 12M18 6L6 18" /></Ico>;
const IconSend = (p) => <Ico {...p}><path d="M4 12l16-7-7 16-2.5-6.5L4 12z" /></Ico>;
const IconCheck = (p) => <Ico {...p}><path d="M5 12.5l4.5 4.5L19 6.5" /></Ico>;
const IconTrash = (p) => <Ico {...p}><path d="M4 7h16M9 7V5a1.5 1.5 0 011.5-1.5h3A1.5 1.5 0 0115 5v2M6 7l1 13a1.5 1.5 0 001.5 1.4h7A1.5 1.5 0 0017 20L18 7" /></Ico>;
const IconFlame = (p) => <Ico {...p}><path d="M12 3c1 3-1.5 4.5-1.5 7a1.5 1.5 0 003 0c0-.8-.3-1.4-.3-1.4 2 1.4 3.3 3.6 3.3 6.1a6.5 6.5 0 11-13 0C3.5 11 7 9 7.5 5.5 9.5 7 10 4.5 12 3z" /></Ico>;
const IconHeart = (p) => <Ico {...p}><path d="M12 20s-7-4.3-9.2-8.5C1.3 8.4 2.7 5 6 5c2 0 3.2 1.3 4 2.4C10.8 6.3 12 5 14 5c3.3 0 4.7 3.4 3.2 6.5C19 15.7 12 20 12 20z" /></Ico>;
const IconBell = (p) => <Ico {...p}><path d="M6 9a6 6 0 1112 0c0 5 2 6 2 6H4s2-1 2-6z" /><path d="M10 20a2 2 0 004 0" /></Ico>;
const IconShieldOff = (p) => <Ico {...p}><path d="M12 3l7 3v5c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6l7-3z" /><path d="M5 4l14 16" /></Ico>;
const IconCompass = (p) => <Ico {...p}><circle cx="12" cy="12" r="8.5" /><path d="M15.5 8.5l-1.8 5-3.2 2 1.8-5 3.2-2z" /></Ico>;
const IconBook = (p) => <Ico {...p}><path d="M5 4.5h9a3 3 0 013 3V20a2.5 2.5 0 00-2.5-2.5H5z" /><path d="M5 4.5v13" /></Ico>;
const IconArrowUp = (p) => <Ico {...p}><path d="M12 19V6M6 12l6-6 6 6" /></Ico>;
const IconWave = (p) => <Ico {...p}><path d="M3 12c2 0 2-2 4-2s2 2 4 2 2-2 4-2 2 2 4 2" /><path d="M3 17c2 0 2-2 4-2s2 2 4 2 2-2 4-2 2 2 4 2" /></Ico>;
const IconDroplet = (p) => <Ico {...p}><circle cx="12" cy="12" r="9" fill="currentColor" stroke="none" /></Ico>;

Object.assign(window, {
  IconShield, IconGrid, IconList, IconPalette, IconSliders, IconChat, IconSpark,
  IconGear, IconUser, IconPlus, IconSearch, IconSun, IconMoon, IconLock, IconClock,
  IconChevron, IconX, IconSend, IconCheck, IconTrash, IconFlame, IconHeart, IconBell,
  IconShieldOff, IconCompass, IconBook, IconArrowUp, IconWave, IconDroplet,
});
