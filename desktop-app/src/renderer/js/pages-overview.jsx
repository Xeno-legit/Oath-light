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

// Maps the backend's per-browser `state` to how the row reads.
const BROWSER_STATE = {
  running_connected: { label: 'Protected', color: 'var(--accent-2)', dot: 'var(--accent-2)', off: false },
  running_partial:   { label: 'Partially protected', color: '#d9a441', dot: '#d9a441', off: false },
  running_unknown:   { label: 'Running · extension not detected', color: '#d9a441', dot: '#d9a441', off: false },
  connecting:        { label: 'Connecting…', color: '#d9a441', dot: '#d9a441', off: false },
  extension_missing: { label: 'Extension missing', color: '#e5544b', dot: '#e5544b', off: false },
  idle:              { label: 'Installed · not running', color: 'var(--muted)', dot: 'color-mix(in oklab, var(--muted) 70%, transparent)', off: true },
  not_installed:     { label: 'Not installed', color: 'var(--muted)', dot: 'color-mix(in oklab, var(--muted) 70%, transparent)', off: true },
};

// Secondary note describing the force-install lock and — critically — its
// scope. A user-scope (HKCU) lock is real but the user can delete it, so we say
// "user-level" rather than implying it's un-removable. Machine-scope (HKLM,
// elevated) is the hard lock. Shown on healthy rows too, so the tamper-lock's
// presence and strength are always visible, not only when the extension is gone.
function enforcementNote(b) {
  const missing = b.state === 'extension_missing' || b.state === 'running_partial';
  switch (b.enforcement) {
    case 'enforced':      return missing ? 'restoring on restart' : 'locked';
    case 'enforced_user': return missing ? 'restoring on restart (user-level)' : 'locked (user-level)';
    // Policy is written but the extension isn't actually installed yet. Never
    // claim "locked" here — that conflation is the bug we fixed.
    case 'pending':       return 'policy set — waiting for the browser to install it';
    // Chrome/Edge only honor a self-hosted force-install on an enterprise-managed
    // device (AD/Entra-joined or cloud-enrolled). On a normal PC the policy is
    // silently ignored, so admin can't help — say so instead of faking a lock.
    case 'unsupported_device': return 'can’t lock — needs the Web Store or a managed device';
    // Writing the policy needs admin (the Software\Policies key is admin-only in
    // both hives), so an unelevated app can't apply it — say so plainly.
    case 'failed':        return 'needs admin to lock';
    case 'dormant':       return 'auto-restore on hold'; // Firefox, on hold
    default:              return null; // 'off' or not present
  }
}

function ExtensionRow({ b }) {
  const st = BROWSER_STATE[b.state] || BROWSER_STATE.not_installed;
  const note = enforcementNote(b);
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
          {st.label}
          {multi && <span className="ext-sync">· {connProfiles}/{profiles.length} profiles</span>}
          {note && <span className="ext-sync">· {note}</span>}
        </div>

        {/* Per-profile breakdown — names every profile and flags any that are
            missing the extension so an uncovered profile can't hide. */}
        {multi &&
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 14px', marginTop: 6 }}>
            {profiles.map((p) => (
              <span key={p.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: p.connected ? 'var(--muted)' : '#d9a441' }}>
                <span className="ext-dot" style={{ background: p.connected ? 'var(--accent-2)' : '#d9a441' }} />
                {p.label}{p.connected ? (p.version ? ` · v${p.version}` : '') : ' · not installed'}
              </span>
            ))}
          </div>
        }
      </div>
      {b.enforcement === 'failed' && PPNative.available &&
        <button className="btn btn-sm" onClick={() => PPNative.requestElevatedSetup()}>Grant admin &amp; lock</button>
      }
      {b.enforcement !== 'failed' && b.enforcement !== 'unsupported_device' && b.state === 'extension_missing' && PPNative.available &&
        <button className="btn btn-ghost btn-sm" onClick={() => PPNative.enforce(b.key)}>Restore</button>
      }
    </div>
  );
}
const DAILY_MESSAGES = [
{ q: "The urge is a wave. You don't have to fight it — just let it rise, crest, and pass. You always outlast it.", a: "Today's quote", by: "Naval Ravikant" },
{ q: "You are not starting over. You are starting from experience, with everything the last days taught you.", a: "Today's quote", by: "James Clear" },
{ q: "Discipline is choosing what you want most over what you want now. You've chosen well today.", a: "Today's quote", by: "Abraham Lincoln" },
{ q: "Every clear minute rewires you a little. Quietly, you are becoming someone new.", a: "Today's quote", by: "Marcus Aurelius" }];


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

function OverviewPage({ s, PP }) {
  const extStats = useExtensionStats();
  // Total blocked = the sum reported across every connected extension/profile;
  // fall back to the local weekly count when the desktop bridge isn't live.
  const totalBlocked = extStats && typeof extStats.total_blocks === 'number'
    ? extStats.total_blocks
    : (s.blockedThisWeek || 0);
  const msg = DAILY_MESSAGES[new Date().getDate() % DAILY_MESSAGES.length];
  const nextMilestone = [7, 14, 30, 60, 90, 180, 365].find((m) => m > s.streak) || s.streak + 30;
  const ringVal = Math.min(100, Math.round(s.streak / nextMilestone * 100));

  return (
    <div className="page">
      <div className="page-head fade-up">
        <div className="eyebrow">Overview</div>
        <h1 className="page-title">Your <em style={{ fontFamily: "Manrope" }}>progress</em></h1>
        <p className="page-sub">A calm look at how far you've come. Small, steady steps — that's the whole game.</p>
      </div>

      <div className="grid stagger" style={{ gridTemplateColumns: '1.3fr 1fr', alignItems: 'stretch' }}>
        {/* streak hero */}
        <div className="card" style={{ display: 'flex', alignItems: 'center', gap: 26 }}>
          <Ring value={ringVal} size={170}>
            <div>
              <div style={{ fontSize: 46, fontWeight: 800, lineHeight: 1, letterSpacing: '-.04em' }}>{s.streak}</div>
              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--muted)', marginTop: 4 }}>days clean</div>
            </div>
          </Ring>
          <div style={{ flex: 1 }}>
            <div className="row" style={{ gap: 8, color: 'var(--accent-2)' }}>
              <IconFlame size={19} /><span style={{ fontWeight: 800, fontSize: 15 }}>On a roll</span>
            </div>
            <p style={{ fontSize: 14, color: 'var(--text-2)', lineHeight: 1.55, margin: '10px 0 16px' }}>
              You're <b style={{ color: 'var(--text)' }}>{nextMilestone - s.streak} days</b> from your next milestone of {nextMilestone} days. Keep the rhythm.
            </p>
            <button className="btn btn-ghost btn-sm" onClick={() => PP.relapse()}>
              <IconFlame size={16} /> Relapsed?
            </button>
          </div>
        </div>

        {/* stat tiles */}
        <div className="grid" style={{ gridTemplateRows: '1fr 1fr', gap: 16 }}>
          <StatTile icon={IconArrowUp} label="Best streak" value={`${s.bestStreak} days`} sub="Your personal record" />
          <StatTile icon={IconShield} label="Sites blocked" value={totalBlocked.toLocaleString()} sub="Across all your browsers" />
        </div>
      </div>

      {/* daily message */}
      <div className="card fade-up" style={{ marginTop: 18, padding: '28px 30px', position: 'relative', overflow: 'hidden' }}>
        <div className="eyebrow" style={{ color: 'var(--muted)' }}>{msg.a}</div>
        <blockquote style={{ fontSize: 27, lineHeight: 1.35, letterSpacing: '.005em', marginTop: 8, maxWidth: '46ch', fontFamily: "Manrope" }}>
          “{msg.q}”
        </blockquote>
        {msg.by && (
          <div style={{ marginTop: 14, fontSize: 13.5, fontWeight: 600, color: 'var(--muted)' }}>
            — <em>{msg.by}</em>
          </div>
        )}
      </div>

      {/* extension connection status */}
      <BrowserProtectionCard />
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
          <div style={{ fontWeight: 800, fontSize: 16, letterSpacing: '-.02em' }}>Browser protection</div>
          <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 3 }}>
            Pure Path watches every running browser and keeps its extension in place
          </div>
        </div>
        {runningBrowsers.length > 0 &&
          <span className="chip" style={{ color: allGood ? 'var(--accent-2)' : (missing ? '#e5544b' : 'var(--warn, #d9a441)') }}>
            <IconShield size={14} /> {protectedRunning}/{runningBrowsers.length} protected
          </span>
        }
      </div>

      {!PPNative.available ? (
        <div style={{ fontSize: 13.5, color: 'var(--muted)', padding: '14px 2px' }}>
          Browser monitoring runs in the desktop app.
        </div>
      ) : shown.length === 0 ? (
        <div style={{ fontSize: 13.5, color: 'var(--muted)', padding: '14px 2px' }}>
          No browser is running right now. Open one and Pure Path will protect it automatically.
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