/* pages-overview.jsx */
const BROWSER_LOGOS = {
  chrome: (
    <svg viewBox="0 0 48 48" width="28" height="28" aria-hidden="true">
      <defs>
        <linearGradient id="cr_r" x1="3" y1="15" x2="45" y2="15" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#d93025"/><stop offset="1" stopColor="#ea4335"/>
        </linearGradient>
        <linearGradient id="cr_y" x1="21" y1="48" x2="42" y2="12" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#fcc934"/><stop offset="1" stopColor="#fbbc04"/>
        </linearGradient>
        <linearGradient id="cr_g" x1="27" y1="47" x2="6" y2="11" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#1e8e3e"/><stop offset="1" stopColor="#34a853"/>
        </linearGradient>
      </defs>
      <circle cx="24" cy="24" r="12" fill="#fff"/>
      <path d="M24 12h20.78A24 24 0 002.63 12l10.4 18A12 12 0 0124 12z" fill="url(#cr_r)"/>
      <path d="M34.4 30l-10.4 18A24 24 0 0044.78 12H24a12 12 0 0110.4 18z" fill="url(#cr_y)"/>
      <path d="M13.6 30L3.2 12A24 24 0 0024 48l10.4-18a12 12 0 01-20.8 0z" fill="url(#cr_g)"/>
      <circle cx="24" cy="24" r="9.5" fill="#1a73e8"/>
    </svg>
  ),
  safari: (
    <svg viewBox="0 0 48 48" width="28" height="28" aria-hidden="true">
      <defs>
        <linearGradient id="sf_bg" x1="24" y1="0" x2="24" y2="48" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#19D3FF"/><stop offset="1" stopColor="#1B8BF2"/>
        </linearGradient>
      </defs>
      <circle cx="24" cy="24" r="23" fill="url(#sf_bg)"/>
      <circle cx="24" cy="24" r="20" fill="none" stroke="#fff" strokeWidth="1" opacity=".35"/>
      {/* Tick marks around the compass */}
      {[0,30,60,90,120,150,180,210,240,270,300,330].map(a =>
        <line key={a} x1="24" y1={a%90===0?2.5:4.5} x2="24" y2={a%90===0?7:6.5}
              stroke="#fff" strokeWidth={a%90===0?1.5:0.8} opacity={a%90===0?1:0.6}
              transform={`rotate(${a} 24 24)`}/>
      )}
      {/* Compass needle */}
      <polygon points="24,8 27.5,24 24,26" fill="#EA3323"/>
      <polygon points="24,40 20.5,24 24,22" fill="#fff" opacity=".9"/>
      <circle cx="24" cy="24" r="2.5" fill="#fff"/>
    </svg>
  ),
  firefox: (
    <svg viewBox="0 0 51500 51500" width="28" height="28" aria-hidden="true">
      <radialGradient id="ff_b" cx="87.4%" cy="-12.9%" r="128%" gradientTransform="matrix(.8 0 0 1 .18 .13)">
        <stop offset=".13" stopColor="#ffbd4f"/>
        <stop offset=".28" stopColor="#ff980e"/>
        <stop offset=".47" stopColor="#ff3750"/>
        <stop offset=".78" stopColor="#eb0878"/>
        <stop offset=".86" stopColor="#e50080"/>
      </radialGradient>
      <radialGradient id="ff_d" cx="49%" cy="40%" r="128%" gradientTransform="matrix(.82 0 0 1 .09 0)">
        <stop offset=".3" stopColor="#960e18"/>
        <stop offset=".35" stopColor="#b11927" stopOpacity=".74"/>
        <stop offset=".43" stopColor="#db293d" stopOpacity=".34"/>
        <stop offset=".5" stopColor="#f5334b" stopOpacity=".1"/>
        <stop offset=".53" stopColor="#ff3750" stopOpacity="0"/>
      </radialGradient>
      <radialGradient id="ff_e" cx="48%" cy="-12%" r="140%">
        <stop offset=".13" stopColor="#fff44f"/>
        <stop offset=".53" stopColor="#ff980e"/>
      </radialGradient>
      <radialGradient id="ff_f" cx="22.76%" cy="110.11%" r="100%">
        <stop offset=".35" stopColor="#3a8ee6"/>
        <stop offset=".67" stopColor="#9059ff"/>
        <stop offset="1" stopColor="#c139e6"/>
      </radialGradient>
      <radialGradient id="ff_h" cx="52%" cy="33%" r="59%" gradientTransform="scale(.9 1)">
        <stop offset=".21" stopColor="#9059ff" stopOpacity="0"/>
        <stop offset=".97" stopColor="#6e008b" stopOpacity=".6"/>
      </radialGradient>
      <radialGradient id="ff_i" cx="210%" cy="-100%" r="290%">
        <stop offset=".1" stopColor="#ffe226"/>
        <stop offset=".79" stopColor="#ff7139"/>
      </radialGradient>
      <radialGradient id="ff_j" cx="84%" cy="-41%" r="180%">
        <stop offset=".11" stopColor="#fff44f"/>
        <stop offset=".46" stopColor="#ff980e"/>
        <stop offset=".72" stopColor="#ff3647"/>
        <stop offset=".9" stopColor="#e31587"/>
      </radialGradient>
      <radialGradient id="ff_k" cx="16.1%" cy="-18.6%" r="348.8%" gradientTransform="matrix(.10453 .46743 -.99452 .04913 -.05 -.26)">
        <stop offset="0" stopColor="#fff44f"/>
        <stop offset=".3" stopColor="#ff980e"/>
        <stop offset=".57" stopColor="#ff3647"/>
        <stop offset=".74" stopColor="#e31587"/>
      </radialGradient>
      <radialGradient id="ff_l" cx="18.9%" cy="-42.5%" r="238.4%">
        <stop offset=".14" stopColor="#fff44f"/>
        <stop offset=".48" stopColor="#ff980e"/>
        <stop offset=".66" stopColor="#ff3647"/>
        <stop offset=".9" stopColor="#e31587"/>
      </radialGradient>
      <radialGradient id="ff_m" cx="159.3%" cy="-44.72%" r="313.1%">
        <stop offset=".09" stopColor="#fff44f"/>
        <stop offset=".63" stopColor="#ff980e"/>
      </radialGradient>
      <linearGradient id="ff_a" x1="87.25%" x2="9.4%" y1="15.5%" y2="93.1%">
        <stop offset=".05" stopColor="#fff44f"/>
        <stop offset=".37" stopColor="#ff980e"/>
        <stop offset=".53" stopColor="#ff3647"/>
        <stop offset=".7" stopColor="#e31587"/>
      </linearGradient>
      <linearGradient id="ff_n" x1="80%" x2="18%" y1="14%" y2="84%">
        <stop offset=".17" stopColor="#fff44f" stopOpacity=".8"/>
        <stop offset=".6" stopColor="#fff44f" stopOpacity="0"/>
      </linearGradient>
      <path id="ff_c" d="M47870 16735c-1044-2512-3160-5224-4820-6082 1352 2650 2134 5310 2433 7294 0-6 2 5 4 22l4 26c2268 6147 1032 12398-748 16218-2754 5910-9420 11967-19857 11670-11276-318-21210-8683-23064-19643-338-1728 0-2605 170-4008-207 1080-286 1394-390 3315l-2 123c0 13270 10760 24030 24032 24030 11887 0 21756-8630 23690-19963l110-927c477-4120-53-8453-1560-12075z"/>
      <path id="ff_g" d="M25677 21050c-40 598-2150 2660-2890 2660-6834 0-7943 4133-7943 4133 303 3480 2726 6348 5660 7865 134 70 270 130 405 193a13277 13277 0 00706 289 10674 10674 0 003127 603c11978 562 14300-14320 5655-18640 2213-385 4510 505 5794 1407-2100-3672-6025-6150-10530-6150-285 0-564 24-844 43a12025 12025 0 00-6614 2549c366 310 780 724 1650 1583 1630 1606 5813 3270 5822 3465z"/>
      <path fill="url(#ff_a)" d="M47870 16735c-1044-2512-3160-5224-4820-6082 1352 2650 2134 5310 2433 7294l5 40c-2718-6773-7325-9505-11088-15452l-566-920a7372 7372 0 01-265-497 4370 4370 0 01-359-950 63 63 0 00-55-65 82 82 0 00-45 0l-12 7-17 10 10-14c-6037 3536-8085 10076-8274 13350a12025 12025 0 00-6614 2548 7136 7136 0 00-622-470 11134 11134 0 01-68-5873c-2468 1124-4390 2900-5785 4470h-10c-953-1206-886-5187-832-6018-10-52-710 363-802 425a17507 17507 0 00-2349 2012 21048 21048 0 00-2244 2692l-1 3v-3a20284 20284 0 00-3225 7280l-32 160a39700 39700 0 00-237 1500l-5 52a22907 22907 0 00-390 3316l-1 120c0 13270 10760 24030 24032 24030 11887 0 21756-8630 23690-19963l110-927c477-4120-53-8453-1560-12075zM20170 35545c113 53 220 112 334 164l16 10a12620 12620 0 01-350-174zm5506-14493zm19813-3060l-3-23 4 26z"/>
      <use fill="url(#ff_b)" xlinkHref="#ff_c"/>
      <use fill="url(#ff_d)" xlinkHref="#ff_c"/>
      <path fill="url(#ff_e)" d="M36192 19560l150 110a13070 13070 0 00-2231-2911C26640 9290 32150 563 33080 120l10-13c-6037 3535-8085 10076-8273 13348 280-20 560-43 844-43 4505 0 8430 2477 10530 6150z"/>
      <use fill="url(#ff_f)" xlinkHref="#ff_g"/>
      <use fill="url(#ff_h)" xlinkHref="#ff_g"/>
      <path fill="url(#ff_i)" d="M17083 15204a24404 24404 0 01498 330 11134 11134 0 01-67-5874c-2470 1125-4390 2900-5785 4470 115-3 3600-66 5354 1074z"/>
      <path fill="url(#ff_j)" d="M1822 26240c1855 10960 11788 19325 23063 19644 10437 296 17104-5762 19858-11670 1780-3820 3016-10070 748-16218v-2l-4-24c-2-17-4-28-4-22l5 40c853 5566-1980 10958-6405 14604l-13 30c-8625 7023-16878 4237-18550 3097a14410 14410 0 01-350-174c-5028-2403-7105-6984-6660-10913-4245 0-5693-3580-5693-3580s3812-2718 8836-355c4653 2190 9023 355 9023 354-10-195-4192-1860-5822-3465-872-860-1285-1272-1652-1583a7136 7136 0 00-622-470 28293 28293 0 00-498-330c-1753-1140-5240-1076-5355-1073h-10c-953-1207-886-5188-832-6020-10-50-710 363-802 426a17507 17507 0 00-2349 2012 21048 21048 0 00-2244 2692l-1 3v-3a20284 20284 0 00-3225 7280c-10 52-865 3784-444 5720z"/>
      <path fill="url(#ff_k)" d="M34110 16760a13070 13070 0 012231 2910l360 296c5450 5020 2594 12120 2380 12626 4426-3646 7258-9038 6405-14604-2716-6774-7323-9506-11086-15453l-566-920a7372 7372 0 01-265-497 4370 4370 0 01-359-950 63 63 0 00-55-65 82 82 0 00-45 0l-12 7-17 10c-930 443-6440 9170 1030 16640z"/>
      <path fill="url(#ff_l)" d="M36702 19965a4743 4743 0 00-360-295l-150-110c-1283-900-3580-1792-5794-1407 8644 4322 6323 19203-5655 18640a10674 10674 0 01-3127-603 13451 13451 0 01-706-289 9064 9064 0 01-405-193l16 10c1670 1140 9924 3925 18550-3097l13-30c213-506 3068-7606-2380-12626z"/>
      <path fill="url(#ff_m)" d="M14844 27844s1110-4133 7943-4133c740 0 2850-2062 2890-2660s-4370 1836-9023-354c-5024-2363-8836 354-8836 354s1448 3580 5693 3580c-445 3930 1632 8510 6660 10913 113 53 218 112 334 164-2935-1517-5358-4384-5660-7865z"/>
      <path fill="url(#ff_n)" d="M47870 16735c-1044-2512-3160-5224-4820-6082 1352 2650 2134 5310 2433 7294l5 40c-2718-6773-7325-9505-11088-15452l-566-920a7372 7372 0 01-265-497 4370 4370 0 01-359-950 63 63 0 00-55-65 82 82 0 00-45 0l-12 7-17 10 10-14c-6037 3536-8085 10076-8274 13350 280-20 560-43 845-43 4505 0 8430 2477 10530 6148-1284-900-3580-1792-5795-1407 8644 4322 6323 19203-5655 18640a10674 10674 0 01-3127-603 13451 13451 0 01-706-289 9064 9064 0 01-405-193l17 10a14410 14410 0 01-350-174c112 53 218 112 333 164-2935-1517-5358-4384-5660-7865 0 0 1108-4133 7942-4133 740 0 2850-2062 2890-2660-10-195-4190-1860-5822-3465-870-860-1285-1272-1650-1583a7136 7136 0 00-623-470 11134 11134 0 01-67-5873c-2470 1124-4390 2900-5785 4470h-10c-953-1207-886-5187-832-6020-10-50-710 363-802 426a17507 17507 0 00-2349 2012 21048 21048 0 00-2243 2692l-1 3v-3a20284 20284 0 00-3225 7280l-32 160a39787 39787 0 00-277 1515c-2 18 2-17 0 0a27956 27956 0 00-355 3353l-3 122c0 13270 10760 24030 24032 24030 11887 0 21756-8630 23690-19963l110-927c477-4120-53-8453-1560-12075zm-2384 1234l4 26v-2l-4-24z"/>
    </svg>
  ),
  edge: (
    <svg viewBox="0 0 27600 27600" width="28" height="28" aria-hidden="true">
      <defs>
        <linearGradient id="ed_a" gradientUnits="userSpaceOnUse"/>
        <linearGradient id="ed_b" x1="6870" x2="24704" y1="18705" y2="18705" xlinkHref="#ed_a">
          <stop offset="0" stopColor="#0c59a4"/>
          <stop offset="1" stopColor="#114a8b"/>
        </linearGradient>
        <linearGradient id="ed_c" x1="16272" x2="5133" y1="10968" y2="23102" xlinkHref="#ed_a">
          <stop offset="0" stopColor="#1b9de2"/>
          <stop offset=".16" stopColor="#1595df"/>
          <stop offset=".67" stopColor="#0680d7"/>
          <stop offset="1" stopColor="#0078d4"/>
        </linearGradient>
        <radialGradient id="ed_d" cx="16720" cy="18747" r="9538" xlinkHref="#ed_a">
          <stop offset=".72" stopOpacity="0"/>
          <stop offset=".95" stopOpacity=".53"/>
          <stop offset="1"/>
        </radialGradient>
        <radialGradient id="ed_e" cx="7130" cy="19866" r="14324" gradientTransform="matrix(.14843 -.98892 .79688 .1196 -8759 25542)" xlinkHref="#ed_a">
          <stop offset=".76" stopOpacity="0"/>
          <stop offset=".95" stopOpacity=".5"/>
          <stop offset="1"/>
        </radialGradient>
        <radialGradient id="ed_f" cx="2523" cy="4680" r="20243" gradientTransform="matrix(-.03715 .99931 -2.12836 -.07913 13579 3530)" xlinkHref="#ed_a">
          <stop offset="0" stopColor="#35c1f1"/>
          <stop offset=".11" stopColor="#34c1ed"/>
          <stop offset=".23" stopColor="#2fc2df"/>
          <stop offset=".31" stopColor="#2bc3d2"/>
          <stop offset=".67" stopColor="#36c752"/>
        </radialGradient>
        <radialGradient id="ed_g" cx="24247" cy="7758" r="9734" gradientTransform="matrix(.28109 .95968 -.78353 .22949 24510 -16292)" xlinkHref="#ed_a">
          <stop offset="0" stopColor="#66eb6e"/>
          <stop offset="1" stopColor="#66eb6e" stopOpacity="0"/>
        </radialGradient>
      </defs>
      <path id="ed_h" d="M24105 20053a9345 9345 0 01-1053 472 10202 10202 0 01-3590 646c-4732 0-8855-3255-8855-7432 0-1175 680-2193 1643-2729-4280 180-5380 4640-5380 7253 0 7387 6810 8137 8276 8137 791 0 1984-230 2704-456l130-44a12834 12834 0 006660-5282c220-350-168-757-535-565z"/>
      <path id="ed_i" d="M11571 25141a7913 7913 0 01-2273-2137 8145 8145 0 01-1514-4740 8093 8093 0 013093-6395 8082 8082 0 011373-859c312-148 846-414 1554-404a3236 3236 0 012569 1297 3184 3184 0 01636 1866c0-21 2446-7960-8005-7960-4390 0-8004 4166-8004 7820 0 2319 538 4170 1212 5604a12833 12833 0 007684 6757 12795 12795 0 003908 610c1414 0 2774-233 4045-656a7575 7575 0 01-6278-803z"/>
      <path id="ed_j" d="M16231 15886c-80 105-330 250-330 566 0 260 170 512 472 723 1438 1003 4149 868 4156 868a5954 5954 0 003027-839 6147 6147 0 001133-850 6180 6180 0 001910-4437c26-2242-796-3732-1133-4392-2120-4141-6694-6525-11668-6525-7011 0-12703 5635-12798 12620 47-3654 3679-6605 7996-6605 350 0 2346 34 4200 1007 1634 858 2490 1894 3086 2921 618 1067 728 2415 728 2952s-271 1333-780 1990z"/>
      <use fill="url(#ed_b)" xlinkHref="#ed_h"/>
      <use fill="url(#ed_d)" opacity=".35" xlinkHref="#ed_h"/>
      <use fill="url(#ed_c)" xlinkHref="#ed_i"/>
      <use fill="url(#ed_e)" opacity=".4" xlinkHref="#ed_i"/>
      <use fill="url(#ed_f)" xlinkHref="#ed_j"/>
      <use fill="url(#ed_g)" opacity=".45" xlinkHref="#ed_j"/>
    </svg>
  ),
  brave: (
    <svg viewBox="0 0 48 48" width="28" height="28" aria-hidden="true">
      <path d="M24 3l13 4 2 4-2 22-13 12-13-12-2-22 2-4 13-4z" fill="#fb542b"/>
      <path d="M24 9l8 2.5 1 2.4-1.3 14L24 38l-7.7-10.1-1.3-14 1-2.4L24 9z" fill="#fff" opacity=".92"/>
      <path d="M24 14l4 1.2-.7 9.3L24 30l-3.3-5.5-.7-9.3L24 14z" fill="#fb542b"/>
    </svg>
  ),
  opera: (
    <svg viewBox="0 0 48 48" width="28" height="28" aria-hidden="true">
      <circle cx="24" cy="24" r="21" fill="#ff1b2d"/>
      <ellipse cx="24" cy="24" rx="9.5" ry="14" fill="#fff"/>
    </svg>
  ),
  vivaldi: (
    <svg viewBox="0 0 48 48" width="28" height="28" aria-hidden="true">
      <circle cx="24" cy="24" r="21" fill="#ef3939"/>
      <path d="M14 16h6l4 11 4-11h6l-7 18h-6l-7-18z" fill="#fff"/>
    </svg>
  ),
  chromium: (
    <svg viewBox="0 0 48 48" width="28" height="28" aria-hidden="true">
      <circle cx="24" cy="24" r="12" fill="#cfd8e3"/>
      <circle cx="24" cy="24" r="21" fill="none" stroke="#5b7a99" strokeWidth="3"/>
      <circle cx="24" cy="24" r="9.5" fill="#5b9bd5"/>
    </svg>
  ),
};

// Fallback badge for any browser without a dedicated logo above.
function browserLogo(key) {
  if (BROWSER_LOGOS[key]) return BROWSER_LOGOS[key];
  const letter = (key || '?').charAt(0).toUpperCase();
  return (
    <svg viewBox="0 0 48 48" width="28" height="28" aria-hidden="true">
      <circle cx="24" cy="24" r="21" fill="var(--accent)" opacity=".18" />
      <text x="24" y="31" textAnchor="middle" fontSize="22" fontWeight="800" fill="var(--accent)">{letter}</text>
    </svg>
  );
}

// Maps the backend's per-browser `state` to how the row reads. The words are
// catalog keys (status.*), resolved at render — this table is built once at
// load, so storing the resolved text would pin the row to whichever voice and
// language happened to be active then.
const BROWSER_STATE = {
  running_connected: { labelKey: 'status.browser_protected', color: 'var(--accent-2)', dot: 'var(--accent-2)', off: false },
  running_partial:   { labelKey: 'status.browser_partial', color: '#d9a441', dot: '#d9a441', off: false },
  running_unknown:   { labelKey: 'status.browser_running_unknown', color: '#d9a441', dot: '#d9a441', off: false },
  connecting:        { labelKey: 'status.connecting', color: '#d9a441', dot: '#d9a441', off: false },
  extension_missing: { labelKey: 'status.browser_ext_missing', color: '#e5544b', dot: '#e5544b', off: false },
  idle:              { labelKey: 'status.browser_idle', color: 'var(--muted)', dot: 'color-mix(in oklab, var(--muted) 70%, transparent)', off: true },
  not_installed:     { labelKey: 'status.not_installed', color: 'var(--muted)', dot: 'color-mix(in oklab, var(--muted) 70%, transparent)', off: true },
};

// Secondary note describing the force-install lock and — critically — its
// scope. A user-scope (HKCU) lock is real but the user can delete it, so we say
// "user-level" rather than implying it's un-removable. Machine-scope (HKLM,
// elevated) is the hard lock. Shown on healthy rows too, so the tamper-lock's
// presence and strength are always visible, not only when the extension is gone.
//
// Deliberately NOT in strings.js, unlike every other string on this page:
// these lines say where the lock is weak and what it would take to defeat it,
// which is the one thing the shared catalog refuses to carry (VOICE.md,
// "status yes, map no" — this function is named there as the example). Cutting
// them down to a flat status is a copy decision for the owner, not something
// to launder into the design system by moving it.
function enforcementNote(b) {
  const missing = b.state === 'extension_missing' || b.state === 'running_partial';
  switch (b.enforcement) {
    case 'enforced':      return missing ? 'restoring on restart' : 'locked';
    case 'enforced_user': return missing ? 'restoring on restart (user-level)' : 'locked (user-level)';
    // Policy is written but the extension isn't actually installed yet. Never
    // claim "locked" here — that conflation is the bug we fixed.
    case 'pending':       return 'policy set — waiting for the browser to install it';
    case 'pending_user':  return 'policy set (user-level) — waiting for the browser to install it';
    // Writing the policy needs admin on most machines (the Software\Policies key
    // is usually admin-only in both hives), so say so plainly.
    case 'failed':        return 'needs admin to lock';
    // Auto-installed rather than force-installed (the Edge path). The browser
    // fetched it on its own and is holding it switched off until the user
    // approves it once — that prompt is a browser security control, so the note
    // asks for the click instead of implying we can skip it.
    case 'needs_approval': return 'downloaded — turn it on in your browser';
    // Approved and running. Real protection, but nothing pins it here, so this
    // must never borrow the word "locked".
    case 'auto_installed': return 'installed — not locked (removable)';
    // Edge, on a PC that isn't domain/Entra-joined, force-installs ONLY from the
    // Microsoft Edge Add-ons store — a Chrome Web Store entry is accepted as
    // policy and then silently ignored. Admin does not change that, so the note
    // must not imply it might.
    case 'store_unavailable': return 'won’t auto-install here — add it yourself';
    case 'dormant':       return 'auto-restore on hold'; // engine not configured (defensive)
    default:              return null; // 'off' or not present
  }
}

// Where a user is sent to install the extension by hand, when no policy can put
// it there for them. Edge accepts Chrome Web Store extensions on a manual
// install (it prompts to allow other stores); it just will not *force*-install
// them — which is exactly the case this covers.
const MANUAL_INSTALL_URL = {
  gecko: 'https://addons.mozilla.org/firefox/addon/oath-light-content-filter/',
  chromium: 'https://chromewebstore.google.com/detail/oigdpcdgmldgjalfnlgekcbkmniplnad',
};

// The one action worth offering for this row, or null when there is nothing
// honest to offer.
//
// Every branch here has to actually change something. The button this replaced
// re-applied a policy that the backend then declined to rewrite, so it was a
// no-op in every state it could appear in — a button that visibly does nothing
// is worse than no button, because it teaches the user the lock is broken.
function extensionAction(b) {
  if (!PPNative.available) return null;
  const missing = b.state === 'extension_missing' || b.state === 'running_partial'
    || b.state === 'not_installed' || b.state === 'running_unknown';
  switch (b.enforcement) {
    // The browser downloaded it for us and is waiting on the user's approval.
    // One click, in the browser — so send them straight to the toggle rather
    // than leaving them to find a page they've probably never opened.
    case 'needs_approval':
      return { labelKey: 'status.action_turn_on', ghost: false, run: () => PPNative.openExtensionsPage(b.key) };
    // Auto-installed and approved. Nothing to offer.
    case 'auto_installed':
      return null;
    // No store will serve a forced install here, and auto-install didn't take
    // either. Elevation is irrelevant; the only thing left is installing by hand.
    case 'store_unavailable':
      return {
        labelKey: 'status.action_install_manually',
        ghost: false,
        run: () => PPNative.openExternal(MANUAL_INSTALL_URL[b.engine] || MANUAL_INSTALL_URL.chromium),
      };
    // Not locked, or locked only in the user's own hive where the user can
    // delete it. One UAC prompt turns either into the machine-wide lock, so
    // offer that — this is the button that used to exist and worked.
    case 'failed':
    case 'enforced_user':
    case 'pending_user':
      return { labelKey: 'status.action_grant_admin', ghost: false, run: () => PPNative.requestElevatedSetup() };
    // Already the strong machine-wide lock. Nothing to upgrade — but if the
    // extension still isn't there, re-asserting the policy makes the browser
    // reload it and reinstall without waiting for a restart.
    case 'enforced':
    case 'pending':
      return missing ? { labelKey: 'status.action_restore', ghost: true, run: () => PPNative.enforce(b.key) } : null;
    default:
      return null; // 'off', 'dormant', 'unsupported'
  }
}

// True when every profile we can see is carrying the extension. The browser
// lock's bar, and deliberately stricter than `b.installed` (which is "at least
// one profile"): a second profile without the extension is a fully usable
// unprotected browser, which is the whole thing the lock exists to stop.
function fullyProtected(b) {
  const profiles = b.profiles || [];
  return profiles.length > 0 && profiles.every((p) => p.connected);
}

// Locked-out browsers are the one case where the row's action isn't about the
// force-install policy at all — there is no policy to grant, upgrade or restore,
// because this browser is here precisely because no policy works on it. The
// only move is opening a restore window. Kept separate from `extensionAction`
// rather than folded in as another case, because it outranks every branch there.
function BrowserLockRow({ b }) {
  const [left, setLeft] = React.useState(b.lock_grace_secs || 0);

  // The backend re-states the remaining seconds every 3s monitor tick, which is
  // too coarse to watch a 20-second window drain. Tick locally between updates
  // and re-sync whenever a fresh status arrives.
  React.useEffect(() => { setLeft(b.lock_grace_secs || 0); }, [b.lock_grace_secs]);
  React.useEffect(() => {
    if (left <= 0) return undefined;
    const t = setInterval(() => setLeft((n) => (n > 0 ? n - 1 : 0)), 1000);
    return () => clearInterval(t);
  }, [left > 0]);

  const open = left > 0;
  return (
    <div className="ext-lock">
      <div className="ext-lock-note">
        {open
          // The countdown is the whole message: it does not extend for any
          // reason, so the number on screen is the real remaining time and not
          // an estimate the backend might quietly revise.
          ? `${left}s — switch the extension on in ${b.name} now.`
          : b.pending_approval
            ? `${b.name} stays closed until the extension is switched on. It's downloaded already — one click.`
            : `${b.name} stays closed until it's running the extension.`}
      </div>
      {!open &&
        <button className="btn btn-sm" onClick={() => PPNative.requestBrowserRestore(b.key)}>
          {PP.t('status.action_unlock', { browser: b.name })}
        </button>
      }
    </div>
  );
}

function ExtensionRow({ b }) {
  const st = BROWSER_STATE[b.state] || BROWSER_STATE.not_installed;
  const note = enforcementNote(b);
  // While a browser is locked out and not yet covered, the restore window is the
  // only thing worth offering — suppress the policy action so the row never
  // shows two competing buttons.
  const locked = b.locked_out && !fullyProtected(b);
  const action = locked ? null : extensionAction(b);
  const profiles = b.profiles || [];
  const connProfiles = profiles.filter((p) => p.connected).length;
  const multi = profiles.length > 1;

  return (
    <div className={'ext-row' + (st.off ? ' is-off' : '')}>
      <div className="ext-logo">{browserLogo(b.key)}</div>
      <div className="ext-info">
        <div className="ext-name">
          {b.name}
          {b.extension_version && <span className="ext-ver">v{b.extension_version}</span>}
        </div>
        <div className="ext-status" style={{ color: st.color }}>
          <span className="ext-dot" style={{ background: st.dot }} />
          {PP.t(st.labelKey)}
          {multi && <span className="ext-sync">· {PP.t('status.profiles_connected', { connected: connProfiles, total: profiles.length })}</span>}
          {note && <span className="ext-sync">· {note}</span>}
        </div>

        {/* Per-profile breakdown — names every profile and flags any that are
            missing the extension so an uncovered profile can't hide. */}
        {multi &&
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 14px', marginTop: 6 }}>
            {profiles.map((p) => (
              <span key={p.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: p.connected ? 'var(--muted)' : '#d9a441' }}>
                <span className="ext-dot" style={{ background: p.connected ? 'var(--accent-2)' : '#d9a441' }} />
                {p.label}{p.connected ? (p.version ? ` · v${p.version}` : '') : ` · ${PP.t('status.profile_not_installed')}`}
              </span>
            ))}
          </div>
        }

        {locked && <BrowserLockRow b={b} />}
      </div>
      {action &&
        <button className={'btn btn-sm' + (action.ghost ? ' btn-ghost' : '')} onClick={action.run}>
          {PP.t(action.labelKey)}
        </button>
      }
    </div>
  );
}
// Attributed quotations, so they stay here rather than in strings.js: a quote
// rewritten into a second voice is no longer that person's sentence, and the
// catalog's contract is that every key has BOTH voices. The card's own label
// ("Today's quote") is a catalog string — see overview.quote_eyebrow.
const DAILY_MESSAGES = [
{ q: "The urge is a wave. You don't have to fight it — just let it rise, crest, and pass. You always outlast it.", by: "Naval Ravikant" },
{ q: "You are not starting over. You are starting from experience, with everything the last days taught you.", by: "James Clear" },
{ q: "Discipline is choosing what you want most over what you want now. You've chosen well today.", by: "Abraham Lincoln" },
{ q: "Every clear minute rewires you a little. Quietly, you are becoming someone new.", by: "Marcus Aurelius" }];


function StatTile({ icon: I, label, value, sub }) {
  return (
    <div className="card" style={{ padding: 18 }}>
      <div className="row" style={{ gap: 10, color: 'var(--accent)' }}>
        <I size={18} /><span style={{ fontSize: 13, fontWeight: 700, color: 'var(--muted)' }}>{label}</span>
      </div>
      <div style={{ fontSize: 30, fontWeight: 800, letterSpacing: '-.03em', marginTop: 10 }}>{value}</div>
      {sub && <div style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: 2 }}>{sub}</div>}
    </div>);

}

// Streak milestones (5.5) and the one-tap trigger vocabulary (5.4) both live
// canonically on the store (store.js defines and exposes them) — read, never
// redeclared, so the celebration/backfill logic and the panic flow's tags
// can't drift out of lockstep with this page.
const MILESTONES = PP.MILESTONES;
const TRIGGER_TAGS = PP.TRIGGERS;

const MIN_EVENTS_FOR_PATTERNS = 5;
const DOW_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function fmtHour(h) {
  const hh = ((h % 24) + 24) % 24;
  const period = hh < 12 ? 'am' : 'pm';
  let h12 = hh % 12; if (h12 === 0) h12 = 12;
  return `${h12}${period}`;
}

// Local trigger analytics (5.4) — buckets every logged urge/slip (they share
// one log; a slip mirrors into `urges` with source:'slip', see store.js) by
// hour-of-day and day-of-week, then finds the tightest recurring 2-hour risk
// band. Pure function of the log itself — never invents data, so a thin log
// naturally yields an "insufficient data" read rather than a fake pattern.
function computeUrgeAnalytics(urges) {
  const hourCounts = new Array(24).fill(0);
  const dayTotals = new Array(7).fill(0);
  const events = [];
  (urges || []).forEach((u) => {
    const d = new Date(u && u.ts);
    if (!isFinite(d.getTime())) return;
    const hour = d.getHours(), dow = d.getDay();
    hourCounts[hour]++;
    dayTotals[dow]++;
    events.push({ hour, dow });
  });
  const total = events.length;

  // Slide a 2-hour window around the 24h circle; the highest-count band is
  // the "risk window" (ties keep the earliest start).
  const WIN = 2;
  let bestStart = 0, bestSum = -1;
  for (let h = 0; h < 24; h++) {
    let sum = 0;
    for (let k = 0; k < WIN; k++) sum += hourCounts[(h + k) % 24];
    if (sum > bestSum) { bestSum = sum; bestStart = h; }
  }
  const bandHours = new Set();
  for (let k = 0; k < WIN; k++) bandHours.add((bestStart + k) % 24);

  // Which day(s) actually drive that band, so the summary can name specific
  // days ("Tue/Fri") instead of a vague "most days" whenever the data
  // genuinely supports it.
  const bandDayCounts = new Array(7).fill(0);
  let bandTotal = 0;
  events.forEach(({ hour, dow }) => {
    if (bandHours.has(hour)) { bandDayCounts[dow]++; bandTotal++; }
  });
  const rankedDays = DOW_LABELS
    .map((label, i) => ({ label, count: bandDayCounts[i] }))
    .filter((d) => d.count > 0)
    .sort((a, b) => b.count - a.count);
  const topDays = [];
  for (const d of rankedDays) {
    if (topDays.length >= 2) break;
    if (topDays.length > 0 && d.count / bandTotal < 0.25) break;
    topDays.push(d.label);
  }

  // Honesty gate: a window only counts as "meaningful" when it holds a real
  // concentration of events — not just whichever 2h slice edges out an
  // otherwise near-uniform spread by a single tally.
  const meaningful = total >= MIN_EVENTS_FOR_PATTERNS && bandTotal >= 3 && (bandTotal / total) >= 0.3;

  return {
    total,
    hourCounts,
    dayCounts: DOW_LABELS.map((label, i) => ({ label, count: dayTotals[i] })),
    band: { startHour: bestStart, endHour: (bestStart + WIN) % 24, bandTotal, topDays, meaningful },
  };
}

function riskWindowSummary(band) {
  const range = `${fmtHour(band.startHour)}–${fmtHour(band.endHour)}`;
  const days = band.topDays.length ? band.topDays.join('/') + ' ' : '';
  return PP.t('overview.risk_window_summary', { when: `${days}${range}` });
}

// --- vulnerable-hours merge (5.4's "cover this window" one-click) ----------
//
// `blocking.vulnerable` (see store.js / pages-blocking.jsx) has no backend
// friction gate of its own the way the DNS filter, uninstall guard, or app
// blocking do (see tauri-bridge.jsx) — the Blocking page writes it straight
// through `PP.set({ blocking: { vulnerable: {...} } })`, instant either
// direction. So THIS is the one place that must self-police the "strengthen
// instantly, never silently weaken" asymmetry the rest of the app enforces
// server-side: turning the window on from off is a pure strengthening
// (nothing existing to shrink); when a window is already on, the suggested
// band is MERGED into it rather than replacing it, via the smallest single
// arc that contains both — a strict superset of the existing window, so
// applying this can only ever grow coverage, never narrow it.
function timeToMinutes(hhmm) {
  const m = /^(\d{1,2}):(\d{2})$/.exec((hhmm || '').trim());
  if (!m) return null;
  return Math.min(23, +m[1]) * 60 + Math.min(59, +m[2]);
}
function minutesToTime(mins) {
  const wrapped = ((mins % 1440) + 1440) % 1440;
  const h = Math.floor(wrapped / 60), mm = wrapped % 60;
  return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}
// Minute-set [0,1440) covered by a (possibly overnight) window. Mirrors the
// extension's own `isWithinWindow` semantics (extension/bg/reminders.js):
// start === end means "covers the full day".
function coveredMinutes(startStr, endStr) {
  const covered = new Array(1440).fill(false);
  const a = timeToMinutes(startStr), z = timeToMinutes(endStr);
  if (a == null || z == null) return covered;
  if (a === z) { covered.fill(true); return covered; }
  if (a < z) { for (let m = a; m < z; m++) covered[m] = true; }
  else { for (let m = a; m < 1440; m++) covered[m] = true; for (let m = 0; m < z; m++) covered[m] = true; }
  return covered;
}
function mergeWindowsExpandOnly(startA, endA, startB, endB) {
  const covered = coveredMinutes(startA, endA);
  const b = coveredMinutes(startB, endB);
  for (let m = 0; m < 1440; m++) if (b[m]) covered[m] = true;
  if (covered.every(Boolean)) return { start: '00:00', end: '00:00' }; // full-day, by the app's own convention

  // Rotate to a clean "gap start" boundary (an uncovered minute whose
  // predecessor is covered) so every gap reads as a simple non-wrapping run.
  let u0 = covered.findIndex((v, i) => !v && covered[(i - 1 + 1440) % 1440]);
  if (u0 === -1) u0 = covered.indexOf(false);

  let bestLen = -1, bestGapStart = u0, bestGapEnd = u0;
  let i = 0;
  while (i < 1440) {
    const m = (u0 + i) % 1440;
    if (!covered[m]) {
      let j = i;
      while (j < 1440 && !covered[(u0 + j) % 1440]) j++;
      if (j - i > bestLen) { bestLen = j - i; bestGapStart = (u0 + i) % 1440; bestGapEnd = (u0 + j) % 1440; }
      i = j;
    } else {
      i++;
    }
  }
  // The merged window is the circle minus its single largest gap.
  return { start: minutesToTime(bestGapEnd), end: minutesToTime(bestGapStart) };
}

// Applies a suggested risk window through the exact same store pathway the
// Blocking page's own `setVuln` uses (`PP.set({ blocking: { vulnerable:
// {...} } })` — see pages-blocking.jsx), so app.jsx's existing sync effect
// pushes it to the extensions precisely the way any other vulnerable-hours
// edit would. No PPNative call needed here for the same reason the Blocking
// page doesn't make one for this field.
function applyRiskWindow(PP, blocking, band) {
  const v = (blocking && blocking.vulnerable) || {};
  const pad = (n) => String(n).padStart(2, '0');
  const newStart = `${pad(band.startHour)}:00`;
  const newEnd = `${pad(band.endHour)}:00`;
  if (!v.on) {
    PP.set({ blocking: { vulnerable: { on: true, start: newStart, end: newEnd } } });
    return;
  }
  const merged = mergeWindowsExpandOnly(v.start, v.end, newStart, newEnd);
  PP.set({ blocking: { vulnerable: { on: true, start: merged.start, end: merged.end } } });
}

// Sequential single-hue magnitude bars (thin, rounded tops, baseline-
// anchored) with the detected risk band picked out in the app's existing
// "good/highlighted" accent — no new palette, just the two hues this app
// already uses for status everywhere else (BrowserProtectionCard, the streak
// hero). A native `title` gives an honest exact count on hover.
function MiniBars({ data, highlightSet }) {
  const max = Math.max(1, ...data.map((d) => d.count));
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 56 }}>
      {data.map((d, i) => {
        const h = d.count > 0 ? Math.max(3, Math.round((d.count / max) * 52)) : 2;
        const on = highlightSet && highlightSet.has(i);
        return (
          <div key={i} title={`${d.label}: ${d.count}`}
            style={{
              flex: 1, height: h, borderRadius: '3px 3px 0 0',
              background: on
                ? 'var(--accent-2)'
                : `color-mix(in oklab, var(--accent) ${20 + Math.round((d.count / max) * 60)}%, transparent)`,
            }} />
        );
      })}
    </div>
  );
}

// One-tap manual urge log (5.4) — lives right on this analytics card so
// logging and seeing the resulting pattern are in the same place. Tapping a
// trigger (or Skip) logs immediately; there's no separate confirm step, same
// "one tap" contract as the panic flow's exit-stage tagging.
function UrgeQuickLog({ PP }) {
  const [open, setOpen] = React.useState(false);
  const [justLogged, setJustLogged] = React.useState(false);

  React.useEffect(() => {
    if (!justLogged) return;
    const id = setTimeout(() => setJustLogged(false), 2400);
    return () => clearTimeout(id);
  }, [justLogged]);

  const log = (trigger) => {
    PP.logUrge(trigger, 'manual');
    setOpen(false);
    setJustLogged(true);
  };

  if (justLogged) {
    return (
      <span style={{ fontSize: 12.5, color: 'var(--accent-2)', fontWeight: 700 }}>
        <IconCheck size={13} /> {PP.t('overview.urge_logged')}
      </span>
    );
  }
  if (!open) {
    return (
      <button className="btn btn-ghost btn-sm" onClick={() => setOpen(true)}>
        <IconSpark size={15} /> {PP.t('overview.urge_log_cta')}
      </button>
    );
  }
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
      {TRIGGER_TAGS.map((tag) => (
        <button key={tag.id} className="chip" onClick={() => log(tag.id)}>{PP.t(tag.labelKey)}</button>
      ))}
      <button className="chip" style={{ color: 'var(--muted)' }} onClick={() => log(null)}>
        {PP.t('app.action_skip')}
      </button>
    </div>
  );
}

// Local-only trigger analytics card (5.4). Every number comes straight from
// `s.urges` — there's no sample/demo data path, so a thin log honestly says
// so instead of drawing fake bars (see MIN_EVENTS_FOR_PATTERNS above).
function RiskAnalyticsCard({ s, PP }) {
  const analytics = React.useMemo(() => computeUrgeAnalytics(s.urges), [s.urges]);
  const { total, hourCounts, dayCounts, band } = analytics;
  const hasEnough = total >= MIN_EVENTS_FOR_PATTERNS;

  const hourData = hourCounts.map((count, h) => ({ label: fmtHour(h), count }));
  const highlightHours = new Set();
  if (hasEnough) for (let k = 0; k < 2; k++) highlightHours.add((band.startHour + k) % 24);
  const highlightDays = new Set();
  if (hasEnough && band.topDays.length) {
    dayCounts.forEach((d, i) => { if (band.topDays.indexOf(d.label) !== -1) highlightDays.add(i); });
  }

  return (
    <div className="card fade-up" style={{ marginTop: 18 }}>
      <div className="spread" style={{ marginBottom: 4, alignItems: 'flex-start' }}>
        <div>
          <div style={{ fontWeight: 800, fontSize: 16, letterSpacing: '-.02em' }}>{PP.t('overview.patterns_title')}</div>
          <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 3, maxWidth: '48ch' }}>
            {PP.t('overview.patterns_sub')}
          </div>
        </div>
        <UrgeQuickLog PP={PP} />
      </div>

      {!hasEnough ? (
        <div style={{ fontSize: 13.5, color: 'var(--muted)', padding: '18px 2px 4px', lineHeight: 1.6 }}>
          {total === 0
            ? PP.t('overview.patterns_empty')
            : PP.t('overview.patterns_thin', { count: total })}
        </div>
      ) : (
        <div style={{ marginTop: 14 }}>
          <div style={{ fontSize: 13.5, lineHeight: 1.6, marginBottom: 18 }}>
            {riskWindowSummary(band)}{' '}
            <span style={{ color: 'var(--muted)' }}>
              {PP.t('overview.risk_window_events', { band: band.bandTotal, total })}
            </span>
          </div>

          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-2)', marginBottom: 6 }}>{PP.t('overview.by_hour')}</div>
          <MiniBars data={hourData} highlightSet={highlightHours} />
          <div className="spread" style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>
            <span>12am</span><span>12pm</span><span>11pm</span>
          </div>

          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-2)', margin: '22px 0 6px' }}>{PP.t('overview.by_day')}</div>
          <MiniBars data={dayCounts} highlightSet={highlightDays} />
          <div style={{ display: 'flex', gap: 3, marginTop: 4 }}>
            {dayCounts.map((d, i) => (
              <div key={i} style={{ flex: 1, textAlign: 'center', fontSize: 11, color: 'var(--muted)' }}>{d.label}</div>
            ))}
          </div>

          <div style={{ marginTop: 20 }}>
            <button className="btn btn-primary btn-sm" disabled={!band.meaningful}
              onClick={() => applyRiskWindow(PP, s.blocking, band)}>
              <IconClock size={15} /> {PP.t('overview.cover_window_cta')}
            </button>
            {!band.meaningful && (
              <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 8 }}>
                {PP.t('overview.cover_window_locked')}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// Compassionate slip flow (5.5) — a real two-step confirm: the "I had a
// slip" button only opens this sheet; nothing is recorded until the user
// explicitly confirms inside it. Copy matches MENTOR_REPLIES.slip in
// pages-mentor.jsx ("a slip is not a collapse — it's a single moment, not
// your identity") verbatim in spirit, so this doesn't invent a second voice
// for the same moment.
function SlipDialog({ PP, go, onClose }) {
  const [stage, setStage] = React.useState('confirm'); // confirm -> done
  const [trigger, setTrigger] = React.useState(null);

  const confirmSlip = () => {
    PP.relapse(trigger);
    setStage('done');
  };

  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,.45)' }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="card" style={{ width: 420, maxWidth: '90vw', padding: 26 }}>
        {stage === 'confirm' ? (
          <React.Fragment>
            <div className="row" style={{ gap: 10, color: 'var(--accent-2)' }}>
              <IconHeart size={18} />
              <span style={{ fontWeight: 800, fontSize: 15.5 }}>{PP.t('streak.slip_confirm_title')}</span>
            </div>
            <p style={{ fontSize: 13.5, color: 'var(--text-2)', lineHeight: 1.6, margin: '12px 0 18px' }}>
              {PP.t('streak.slip_confirm_body')}
            </p>
            <div style={{ fontSize: 12.5, color: 'var(--muted)', marginBottom: 8 }}>{PP.t('overview.slip_trigger_prompt')}</div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 22 }}>
              {TRIGGER_TAGS.map((tag) => (
                <button key={tag.id} className="chip" onClick={() => setTrigger(tag.id)}
                  style={trigger === tag.id ? { color: 'var(--accent)', borderColor: 'var(--accent)' } : undefined}>
                  {PP.t(tag.labelKey)}
                </button>
              ))}
            </div>
            <div className="row" style={{ gap: 10, justifyContent: 'flex-end' }}>
              <button className="btn btn-ghost btn-sm" onClick={onClose}>{PP.t('overview.slip_never_mind')}</button>
              <button className="btn btn-primary btn-sm" onClick={confirmSlip}>{PP.t('overview.slip_confirm_cta')}</button>
            </div>
          </React.Fragment>
        ) : (
          <React.Fragment>
            <div className="row" style={{ gap: 10, color: 'var(--accent-2)' }}>
              <IconHeart size={18} />
              <span style={{ fontWeight: 800, fontSize: 15.5 }}>{PP.t('streak.slip_logged_title')}</span>
            </div>
            <p style={{ fontSize: 13.5, color: 'var(--text-2)', lineHeight: 1.6, margin: '12px 0 20px' }}>
              {PP.t('streak.slip_logged_body')}
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <button className="btn btn-primary btn-sm" onClick={() => { onClose(); go('mentor'); }}>
                <IconChat size={15} /> {PP.t('overview.slip_talk_mentor')}
              </button>
              <button className="btn btn-ghost btn-sm" onClick={() => { onClose(); go('panic'); }}>
                <IconWave size={15} /> {PP.t('overview.slip_ride_urge')}
              </button>
              <button className="btn btn-ghost btn-sm" onClick={onClose}>{PP.t('app.action_close')}</button>
            </div>
          </React.Fragment>
        )}
      </div>
    </div>
  );
}

// Tasteful once-per-milestone celebration (5.5) — `s.lastMilestone` (store.js)
// is the persisted "already celebrated" marker, so this only ever fires once
// per milestone, survives restarts, and doesn't re-fire for progress a user
// already had before this feature shipped (see store.js's backfill). No
// desktop notification: Settings' "Milestone celebrations" row is an honest
// disabled "Coming soon" stub (pages-settings.jsx's COMING_NOTIFS) with no
// backend command behind it at all, and this task is renderer-only — wiring
// one would mean inventing new backend surface, which is explicitly out of
// scope here. This in-app banner is the whole celebration for now.
function MilestoneBanner({ milestone, onClose }) {
  return (
    <div className="card fade-up" style={{
      marginBottom: 18, padding: '20px 24px', display: 'flex', alignItems: 'center', gap: 16,
      border: '1px solid color-mix(in oklab, var(--accent-2) 40%, transparent)',
      background: 'color-mix(in oklab, var(--accent-2) 8%, var(--bg-1))',
    }}>
      <div style={{ color: 'var(--accent-2)' }}><IconFlame size={26} /></div>
      <div style={{ flex: 1 }}>
        <div style={{ fontWeight: 800, fontSize: 15.5 }}>{PP.t('streak.milestone_banner', { days: milestone })}</div>
        <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 2 }}>{PP.t('streak.milestone_sub')}</div>
      </div>
      <button className="btn btn-ghost btn-sm" onClick={onClose}><IconX size={14} /></button>
    </div>
  );
}

// --- Weekly recap ------------------------------------------------------------

// Settings used to list "Weekly progress recap" as a Coming-soon stub. Audited
// against the code, the other two stubs beside it were already built (the daily
// message and the milestone celebration are both on this page) — this one
// genuinely wasn't, so here it is, in the same in-app channel as its two
// siblings rather than as an OS notification the app has no plugin for.
//
// Rolling seven days, not "every Sunday": a recap that only exists one day a
// week is a recap you mostly can't read. It reports only what the app actually
// knows — logged urges and logged slips — and never infers anything from their
// absence beyond "nothing was logged", because a day with no entry is a day the
// user didn't tell us about, which is not the same as a day we watched.
const RECAP_DAYS = 7;

function computeWeeklyRecap(s) {
  const now = Date.now();
  const cutoff = now - RECAP_DAYS * 86400000;
  const prevCutoff = now - 2 * RECAP_DAYS * 86400000;
  const at = (x) => new Date(typeof x === 'string' ? x : (x && x.ts)).getTime();
  const inRange = (t, from, to) => isFinite(t) && t >= from && t < to;

  const urges = s.urges || [];
  const slips = s.slips || [];

  // A slip is mirrored into `urges` with source:'slip', so counting every urge
  // would double-count it. "Rode out" is the honest name for the rest.
  const rodeOut = urges.filter((u) => u && u.source !== 'slip' && inRange(at(u), cutoff, now)).length;
  const prevRodeOut = urges.filter((u) => u && u.source !== 'slip' && inRange(at(u), prevCutoff, cutoff)).length;
  const slipDays = new Set(
    slips.filter((x) => inRange(at(x), cutoff, now)).map((x) => new Date(at(x)).toDateString())
  );

  return {
    cleanDays: Math.max(0, RECAP_DAYS - slipDays.size),
    slips: slipDays.size,
    rodeOut,
    // null when there's nothing to compare against yet, so the card can stay
    // silent instead of announcing a meaningless "+0".
    trend: (rodeOut === 0 && prevRodeOut === 0) ? null : rodeOut - prevRodeOut,
  };
}

function WeeklyRecapCard({ s }) {
  const r = computeWeeklyRecap(s);
  // English pluralises by suffixing an s; most languages don't, so the count
  // picks between two whole keys rather than having the code splice a letter
  // onto a translated noun.
  const plural = (n, key) => PP.t(`overview.${key}_${n === 1 ? 'one' : 'other'}`, { count: n });

  // One plain sentence, chosen by what the week actually was — not a template
  // with numbers dropped into it.
  let line;
  if (r.slips === 0 && r.rodeOut === 0) {
    line = PP.t('overview.recap_quiet');
  } else if (r.slips === 0) {
    line = PP.t(`overview.recap_held_${r.rodeOut === 1 ? 'one' : 'other'}`, { count: r.rodeOut });
  } else if (r.rodeOut > r.slips) {
    line = PP.t('overview.recap_mostly_held', {
      urges: plural(r.rodeOut, 'recap_urge'),
      slips: plural(r.slips, 'recap_slip'),
    });
  } else {
    line = PP.t('overview.recap_hard');
  }

  return (
    <div className="card fade-up" style={{ marginTop: 18 }}>
      <div className="spread" style={{ marginBottom: 4 }}>
        <div>
          <div style={{ fontWeight: 800, fontSize: 16, letterSpacing: '-.02em' }}>{PP.t('overview.recap_title')}</div>
          <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 3 }}>{line}</div>
        </div>
        {r.trend != null && r.trend !== 0 &&
          <span className="chip" style={{ color: r.trend < 0 ? 'var(--accent-2)' : 'var(--muted)' }}>
            {r.trend < 0 ? '↓' : '↑'} {PP.t('overview.recap_trend', { delta: Math.abs(r.trend) })}
          </span>}
      </div>
      <div className="grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginTop: 14 }}>
        <RecapStat label={PP.t('overview.recap_clean_days')} value={`${r.cleanDays}/${RECAP_DAYS}`} />
        <RecapStat label={PP.t('overview.recap_ridden_out')} value={r.rodeOut} />
        <RecapStat label={PP.t('overview.recap_slips')} value={r.slips} />
      </div>
    </div>
  );
}

function RecapStat({ label, value }) {
  return (
    <div style={{
      padding: '12px 14px', borderRadius: 12,
      background: 'var(--glass-2)', border: '1px solid var(--glass-brd)',
    }}>
      <div style={{ fontSize: 24, fontWeight: 800, letterSpacing: '-.03em', fontVariantNumeric: 'tabular-nums' }}>{value}</div>
      <div style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: 2 }}>{label}</div>
    </div>
  );
}

function OverviewPage({ s, PP, go }) {
  const extStats = useExtensionStats();
  // Total blocked = the sum reported across every connected extension/profile;
  // fall back to the local weekly count when the desktop bridge isn't live.
  const totalBlocked = extStats && typeof extStats.total_blocks === 'number'
    ? extStats.total_blocks
    : (s.blockedThisWeek || 0);
  const msg = DAILY_MESSAGES[new Date().getDate() % DAILY_MESSAGES.length];
  const nextMilestone = MILESTONES.find((m) => m > s.streak) || s.streak + 30;
  const ringVal = Math.min(100, Math.round(s.streak / nextMilestone * 100));
  // Only actually changes when a slip is logged (or the month rolls over) —
  // memoized on s.slips so it doesn't rescan the slip log on the app-wide
  // re-render every store write causes.
  const cleanDaysThisMonth = React.useMemo(() => PP.cleanDaysThisMonth(), [s.slips]);

  // Compassionate streak design (5.5): while a slip's 24h gentle-mode window
  // is active, tone the hero down instead of showing a bare "Day 0" — the
  // window and the zero-day period line up almost exactly (both anchored to
  // the same slip timestamp), so this naturally covers the whole "just
  // slipped" stretch without extra bookkeeping.
  const gentle = PP.isGentle();
  // isGentle() reads the clock, not state, so nothing re-renders on its own
  // when the 24h window lapses — schedule one re-render for that moment so
  // the hero can't keep showing gentle copy past its own expiry.
  const [, gentleTick] = React.useReducer((x) => x + 1, 0);
  React.useEffect(() => {
    if (!gentle) return;
    const slips = s.slips || [];
    const last = slips.length ? new Date(slips[slips.length - 1]).getTime() : NaN;
    if (!isFinite(last)) return;
    const remain = last + PP.GENTLE_MS - Date.now();
    if (remain <= 0) return;
    const id = setTimeout(gentleTick, remain + 1000);
    return () => clearTimeout(id);
  }, [gentle, s.slips]);

  const [slipOpen, setSlipOpen] = React.useState(false);

  // Milestone celebration (5.5) — fires at most once per milestone per
  // streak; `s.lastMilestone` is the persisted guard (see store.js). The
  // effect only depends on `s.streak` so writing `lastMilestone` back into
  // the store here doesn't re-trigger itself.
  const [celebrating, setCelebrating] = React.useState(null);
  React.useEffect(() => {
    const crossed = MILESTONES.filter((m) => s.streak >= m).pop();
    if (crossed && crossed > (s.lastMilestone || 0)) {
      // Goes through PP.markMilestone (not a raw PP.set) so the guard is
      // written to the BACKEND too (5.5) — otherwise clearing localStorage
      // would re-celebrate every milestone the user already passed.
      PP.markMilestone(crossed);
      setCelebrating(crossed);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.streak]);
  React.useEffect(() => {
    if (!celebrating) return;
    const id = setTimeout(() => setCelebrating(null), 12000);
    return () => clearTimeout(id);
  }, [celebrating]);

  return (
    <div className="page">
      <div className="page-head fade-up">
        <div className="eyebrow">{PP.t('overview.eyebrow')}</div>
        <h1 className="page-title">{tRich('overview.title')}</h1>
        <p className="page-sub">{PP.t('overview.sub')}</p>
      </div>

      {celebrating && <MilestoneBanner milestone={celebrating} onClose={() => setCelebrating(null)} />}

      <div className="grid stagger" style={{ gridTemplateColumns: '1.3fr 1fr', alignItems: 'stretch' }}>
        {/* streak hero */}
        <div className="card" style={{ display: 'flex', alignItems: 'center', gap: 26 }}>
          <Ring value={ringVal} size={170}>
            <div>
              {gentle ? (
                <React.Fragment>
                  <div style={{ fontSize: 26, fontWeight: 800, lineHeight: 1.2, letterSpacing: '-.02em' }}>
                    {PP.t('streak.gentle_title')}
                  </div>
                  <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--muted)', marginTop: 4 }}>
                    {PP.t('streak.gentle_sub')}
                  </div>
                </React.Fragment>
              ) : (
                <React.Fragment>
                  <div style={{ fontSize: 46, fontWeight: 800, lineHeight: 1, letterSpacing: '-.04em' }}>{s.streak}</div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--muted)', marginTop: 4 }}>
                    {PP.t('overview.days_clean_label')}
                  </div>
                </React.Fragment>
              )}
            </div>
          </Ring>
          <div style={{ flex: 1 }}>
            <div className="row" style={{ gap: 8, color: gentle ? 'var(--muted)' : 'var(--accent-2)' }}>
              {gentle ? <IconHeart size={19} /> : <IconFlame size={19} />}
              <span style={{ fontWeight: 800, fontSize: 15 }}>
                {PP.t(gentle ? 'overview.hero_gentle_label' : 'overview.hero_on_a_roll')}
              </span>
            </div>
            <p style={{ fontSize: 14, color: 'var(--text-2)', lineHeight: 1.55, margin: '10px 0 14px' }}>
              {gentle
                ? PP.t('overview.hero_gentle_body')
                : tRich('overview.hero_next_milestone', { days: nextMilestone - s.streak, target: nextMilestone })}
            </p>
            <div className="chip" style={{ width: 'fit-content', marginBottom: 14 }}>
              {PP.t(`overview.clean_days_month_${cleanDaysThisMonth === 1 ? 'one' : 'other'}`, { count: cleanDaysThisMonth })}
            </div>
            <div>
              <button className="btn btn-ghost btn-sm" onClick={() => setSlipOpen(true)}>
                <IconHeart size={16} /> {PP.t('streak.slip_button')}
              </button>
            </div>
          </div>
        </div>

        {/* stat tiles */}
        <div className="grid" style={{ gridTemplateRows: '1fr 1fr', gap: 16 }}>
          <StatTile icon={IconArrowUp} label={PP.t('streak.best_streak_label')}
                    value={PP.t('overview.stat_best_streak_value', { days: s.bestStreak })}
                    sub={PP.t('overview.stat_best_streak_sub')} />
          <StatTile icon={IconShield} label={PP.t('overview.stat_blocked_label')}
                    value={totalBlocked.toLocaleString()} sub={PP.t('overview.stat_blocked_sub')} />
        </div>
      </div>

      {/* daily message */}
      <div className="card fade-up" style={{ marginTop: 18, padding: '28px 30px', position: 'relative', overflow: 'hidden' }}>
        <div className="eyebrow" style={{ color: 'var(--muted)' }}>{PP.t('overview.quote_eyebrow')}</div>
        <blockquote style={{ fontSize: 27, lineHeight: 1.35, letterSpacing: '.005em', marginTop: 8, maxWidth: '46ch' }}>
          “{msg.q}”
        </blockquote>
        {msg.by && (
          <div style={{ marginTop: 14, fontSize: 13.5, fontWeight: 600, color: 'var(--muted)' }}>
            — <em>{msg.by}</em>
          </div>
        )}
      </div>

      {/* weekly recap — the third of Settings' three in-app "notifications" */}
      <WeeklyRecapCard s={s} />

      {/* urge log & trigger analytics (5.4) */}
      <RiskAnalyticsCard s={s} PP={PP} />

      {/* extension connection status */}
      <BrowserProtectionCard />

      {slipOpen && <SlipDialog PP={PP} go={go} onClose={() => setSlipOpen(false)} />}
    </div>);

}

// Live browser-protection panel. Shows the desktop app monitoring each running
// browser's extension; falls back to a calm empty state when nothing is up yet.
function BrowserProtectionCard() {
  const browsers = useBrowsers();

  // Show what's running plus any browser that has the extension installed
  // (even if currently closed); ignore the rest of the large table.
  const shown = browsers.filter((b) => b.running || b.installed);
  const runningBrowsers = browsers.filter((b) => b.running);
  const protectedRunning = runningBrowsers.filter((b) => b.state === 'running_connected').length;
  const missing = runningBrowsers.some((b) => b.state === 'extension_missing');
  const allGood = runningBrowsers.length > 0 && protectedRunning === runningBrowsers.length;

  return (
    <div className="card fade-up" style={{ marginTop: 18 }}>
      <div className="spread" style={{ marginBottom: 4 }}>
        <div>
          <div style={{ fontWeight: 800, fontSize: 16, letterSpacing: '-.02em' }}>
            {PP.t('status.browser_protection_title')}
          </div>
          <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 3 }}>
            {PP.t('overview.browser_sub')}
          </div>
        </div>
        {runningBrowsers.length > 0 &&
          <span className="chip" style={{ color: allGood ? 'var(--accent-2)' : (missing ? '#e5544b' : 'var(--warn, #d9a441)') }}>
            <IconShield size={14} />{' '}
            {PP.t('status.browsers_protected_count', { protected: protectedRunning, total: runningBrowsers.length })}
          </span>
        }
      </div>

      {!PPNative.available ? (
        <div style={{ fontSize: 13.5, color: 'var(--muted)', padding: '14px 2px' }}>
          {PP.t('overview.browser_needs_desktop')}
        </div>
      ) : shown.length === 0 ? (
        <div style={{ fontSize: 13.5, color: 'var(--muted)', padding: '14px 2px' }}>
          {PP.t('overview.browser_none_running')}
        </div>
      ) : (
        <div className="ext-grid">
          {shown.map((b) => <ExtensionRow key={b.key} b={b} />)}
        </div>
      )}
    </div>
  );
}
window.OverviewPage = OverviewPage;