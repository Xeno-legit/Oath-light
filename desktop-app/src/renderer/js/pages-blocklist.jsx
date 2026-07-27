/* pages-blocklist.jsx */
const BLACKLIST_KNOWN = ['pornhub.com', 'xvideos.com', 'xnxx.com', 'onlyfans.com', 'redtube.com', 'chaturbate.com', 'stripchat.com', 'adultfriendfinder.com', 'youporn.com', 'brazzers.com', 'spankbang.com', 'xhamster.com'];
const BLACKLIST_KEYWORDS = ['porn', 'xxx', 'xvideos', 'adult', 'nsfw', 'sex', 'nude', 'cam', 'escort', 'hookup', 'onlyfans', 'fetish', 'erotic'];

function cleanDomain(q) {
  return q.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '');
}
// Fallback heuristic used only when the native bridge isn't available (e.g.
// running outside Tauri) — the old 12-domain + keyword guess, kept exactly
// as it was so the app still shows *something* in a browser preview.
function checkBlacklistLocal(q) {
  const d = cleanDomain(q);
  if (!d) return null;
  const blocked = BLACKLIST_KNOWN.some((x) => d === x || d.includes(x) || x.includes(d)) ||
  BLACKLIST_KEYWORDS.some((k) => d.includes(k));
  return { domain: d, blocked };
}
function checkGraylist(q, graylist) {
  const d = cleanDomain(q);
  if (!d) return null;
  const hit = graylist.find((g) => d === g.url || d.includes(g.url) || g.url.includes(d));
  return { domain: d, hit };
}

function BlocklistPage({ s, PP }) {
  const [tab, setTab] = React.useState('blocked');
  const [blackQuery, setBlackQuery] = React.useState('');
  const [blackResult, setBlackResult] = React.useState(null);
  const [grayQuery, setGrayQuery] = React.useState('');
  const [grayOpen, setGrayOpen] = React.useState(false);
  const [newSite, setNewSite] = React.useState('');
  const bl = s.blocklist;
  // Live, real domain/keyword counts from the actual blocklist (~385k
  // domains) — null until loaded or outside Tauri. Guarded this way (rather
  // than calling window.useBlocklistCounts() directly) so this page doesn't
  // crash if the hook isn't wired up yet; it's still called unconditionally
  // every render, so it stays hook-rule safe.
  const counts = (window.useBlocklistCounts || (() => null))();
  const domainCountText = counts ? counts.domain_count.toLocaleString() : '—';

  // Blacklist search: the keyword heuristic is instant and local (it mirrors
  // what the extension actually blocks on the fly), but the domain verdict
  // now comes from the real backend list instead of a 12-site guess. Debounced
  // and guarded against stale/out-of-order responses.
  const blackSeq = React.useRef(0);
  React.useEffect(() => {
    const d = cleanDomain(blackQuery);
    if (!d) { setBlackResult(null); return; }
    const seq = ++blackSeq.current;
    const keywordHit = BLACKLIST_KEYWORDS.some((k) => d.includes(k));
    const nativeAvailable = !!(window.PPNative && window.PPNative.available &&
      typeof window.PPNative.checkDomainBlocked === 'function');

    if (!nativeAvailable) {
      setBlackResult(checkBlacklistLocal(blackQuery));
      return;
    }

    // Clear the previous verdict while the new check is in flight — showing
    // a stale result for a *different* domain, even briefly, is a small lie.
    setBlackResult(null);
    const t = setTimeout(() => {
      window.PPNative.checkDomainBlocked(d)
        .then((res) => {
          if (seq !== blackSeq.current) return; // a newer query has since started
          setBlackResult({ domain: d, blocked: !!(res && res.blocked) || keywordHit });
        })
        .catch(() => {
          if (seq !== blackSeq.current) return;
          setBlackResult(checkBlacklistLocal(blackQuery));
        });
    }, 250);
    return () => clearTimeout(t);
  }, [blackQuery]);

  function addSite() {
    // Same normalization the backend and extension apply, so the list shows
    // exactly the domain that will be blocked.
    const url = cleanDomain(newSite);
    if (!url) return;
    if (bl.customSites.some((x) => x.url === url)) { setNewSite(''); return; }
    const list = [...bl.customSites, { id: Date.now(), url, added: 'just now' }];
    PP.set({ blocklist: { customSites: list } });
    setNewSite('');
  }
  function removeSite(site) {
    if (!(window.PPNative && window.PPNative.available)) {
      // No native bridge (standalone preview) — nothing to gate, just update
      // the local cosmetic copy.
      PP.put('blocklist', { ...bl, customSites: bl.customSites.filter((x) => x.id !== site.id) });
      return;
    }
    // Master-password gated (4.2) when one is set. Acquire BEFORE touching
    // the local store: if the user cancels the prompt, the site must stay
    // exactly where it was in the list, not disappear and then silently
    // reappear on the next backend poll.
    (window.PPAuth ? PPAuth.acquire() : Promise.resolve(null))
      .then((auth) => {
        // Fire the removal request — the backend keeps actually enforcing the
        // block until the friction delay elapses (4.1). This only registers
        // the request; it does not wait for it.
        window.PPNative.removeCustomDomain(site.url, auth).catch(() => {});
        // Local list update happens once acquisition succeeded — same as
        // before removeCustomDomain existed, this is the renderer's own
        // cosmetic copy, not the enforcement.
        PP.put('blocklist', { ...bl, customSites: bl.customSites.filter((x) => x.id !== site.id) });
      })
      .catch((e) => {
        // Cancelled prompt: leave the list untouched, silently abort.
        if (!e || e.message !== 'cancelled') console.warn('[OathLight] removeSite failed:', e);
      });
  }
  function removeAllow(id) {
    PP.put('blocklist', { ...bl, allow: bl.allow.filter((x) => x.id !== id) });
  }
  // Pending custom-block removals (4.1) — sites that still show removed from
  // the list above but the backend is still blocking until the delay elapses.
  const pendingRemovals = (window.usePendingWeakenings || (() => []))()
    .filter((p) => p.action_id.indexOf('custom_block.remove:') === 0);
  function keepBlocking(p) {
    const domain = p.action_id.slice('custom_block.remove:'.length);
    window.PPNative.cancelWeakening(p.action_id).then(() => {
      if (!bl.customSites.some((x) => x.url === domain)) {
        PP.put('blocklist', { ...bl, customSites: [...bl.customSites, { id: Date.now(), url: domain, added: 'restored' }] });
      }
    });
  }

  const grayResult = checkGraylist(grayQuery, bl.graylist);

  return (
    <div className="page">
      <div className="page-head fade-up">
        <div className="eyebrow">Blocklist</div>
        <h1 className="page-title">What gets <em style={{ fontFamily: "Manrope" }}>blocked</em></h1>
        <p className="page-sub">Search any site to see if it's blocked outright or filtered for explicit content. Changes apply instantly across every browser and app.</p>
      </div>

      <div className="spread fade-up" style={{ marginBottom: 18 }}>
        <Segmented value={tab} onChange={setTab} options={[
        { value: 'blocked', label: 'Blocked' },
        { value: 'custom', label: 'Custom sites' },
        { value: 'allow', label: 'Always allowed' }]
        } />
      </div>

      {tab === 'blocked' &&
      <div className="grid fade-up" style={{ gridTemplateColumns: '1fr 1fr', gap: 16, alignItems: 'stretch' }}>

          {/* BLACKLIST */}
          <div className="card panel-card" style={{ padding: 0, overflow: 'hidden' }}>
            <div className="panel-head">
              <div className="ico" style={{ background: 'color-mix(in oklab, #d9534f 16%, transparent)', color: '#d9534f' }}><IconShieldOff size={20} /></div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="panel-title">Blacklist <span className="chip" style={{ marginInlineStart: 6, color: '#d9534f' }}>{domainCountText} domains</span></div>
                <div className="panel-sub">Sites that are <b>explicit by nature</b> — pornography and adult media. Blocked entirely, the instant they're detected.</div>
              </div>
            </div>
            <div className="panel-body">
              <div className="panel-search">
                <IconSearch size={16} />
                <input placeholder="Check if a site is blocked…" value={blackQuery}
              onChange={(e) => setBlackQuery(e.target.value)} />
              </div>
              {!blackResult ?
            <div className="search-hint">Type any website to check it against {domainCountText} explicit domains.</div> :

            <div className={'search-result ' + (blackResult.blocked ? 'is-blocked' : 'is-clear')}>
                  <div className="ico">{blackResult.blocked ? <IconShieldOff size={20} /> : <IconCheck size={20} />}</div>
                  <div className="txt">
                    <b>{blackResult.domain}</b>
                    <span>{blackResult.blocked ? 'On the blacklist — fully blocked' : 'Not on the blacklist'}</span>
                  </div>
                  <span className="chip">{blackResult.blocked ? 'Blocked' : 'Not blocked'}</span>
                </div>
            }
            </div>
          </div>

          {/* GRAYLIST */}
          <div className="card panel-card" style={{ padding: 0, overflow: 'hidden' }}>
            <div className="panel-head">
              <div className="ico" style={{ background: 'color-mix(in oklab, #d9a441 18%, transparent)', color: '#c9962f' }}><IconList size={20} /></div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="panel-title">Graylist <span className="chip" style={{ marginInlineStart: 6, color: '#c9962f' }}>{bl.graylist.length} sites</span></div>
                <div className="panel-sub">Mainstream sites that <b>aren't explicit themselves</b> but can host explicit content. We filter the risky parts instead of blocking the whole site.</div>
              </div>
            </div>
            <div className="panel-body">
              <div className="panel-search">
                <IconSearch size={16} />
                <input placeholder="Check a site for filtered content…" value={grayQuery}
              onChange={(e) => setGrayQuery(e.target.value)} />
              </div>
              {!grayResult ?
            <div className="search-hint">Type any website to see if its explicit content is filtered. To block a site entirely, add it under <b>Custom sites</b>.</div> :
            grayResult.hit ?
            <div className="search-result is-gray">
                  <div className="ico"><IconWave size={20} /></div>
                  <div className="txt">
                    <b>{grayResult.hit.url}</b>
                    <span>{grayResult.hit.desc}</span>
                  </div>
                  <span className="chip">Filtered</span>
                </div> :

            <div className="search-result is-clear">
                  <div className="ico"><IconCheck size={20} /></div>
                  <div className="txt">
                    <b>{grayResult.domain}</b>
                    <span>Not on the graylist — block it under Custom sites if needed</span>
                  </div>
                  <span className="chip">Not filtered</span>
                </div>
            }

              {/* Collapsible catalog of every filtered site */}
              <button
              className="gray-catalog-toggle"
              onClick={() => setGrayOpen((v) => !v)}
              style={{ marginTop: 14, width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '11px 13px', background: 'color-mix(in oklab, var(--muted) 7%, transparent)', border: '1px solid color-mix(in oklab, var(--muted) 16%, transparent)', borderRadius: 10, cursor: 'pointer', font: 'inherit', color: 'var(--text)' }}>
                <IconList size={16} style={{ color: 'var(--accent-2)', flex: '0 0 auto' }} />
                <span style={{ flex: 1, textAlign: 'start', fontWeight: 700, fontSize: 13 }}>All {bl.graylist.length} filtered sites</span>
                <IconChevron size={16} style={{ flex: '0 0 auto', color: 'var(--muted)', transform: grayOpen ? 'rotate(90deg)' : 'none', transition: 'transform .2s ease' }} />
              </button>
              {grayOpen &&
              <div style={{ display: 'flex', flexDirection: 'column', gap: 7, maxHeight: 320, overflowY: 'auto', marginTop: 8 }}>
                {bl.graylist.map((g) =>
              <div key={g.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', background: 'color-mix(in oklab, var(--muted) 7%, transparent)', border: '1px solid color-mix(in oklab, var(--muted) 14%, transparent)', borderRadius: 10 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <b style={{ fontSize: 13 }}>{g.url}</b>
                      <span style={{ display: 'block', fontSize: 11.5, color: 'var(--muted)', marginTop: 1, lineHeight: 1.4 }}>{g.desc}</span>
                    </div>
                    <span className="chip" style={{ flex: '0 0 auto', color: g.kind === 'discord' ? '#7c84f6' : g.kind === 'dom' ? '#c9962f' : g.kind === 'enforce' ? '#4fb286' : 'var(--accent-2)' }}>{g.kind === 'discord' ? 'Channel block' : g.kind === 'dom' ? 'Page filter' : g.kind === 'enforce' ? 'Safe mode' : 'Feed filter'}</span>
                  </div>
              )}
              </div>
            }
            </div>
          </div>
        </div>
      }

      {tab === 'custom' &&
      <div className="grid fade-up" style={{ gap: 16 }}>
          <div className="card">
            <div style={{ fontWeight: 800, fontSize: 15, marginBottom: 12 }}>Block a specific site</div>
            <div className="row" style={{ gap: 10 }}>
              <input className="input" placeholder="e.g. example.com" value={newSite}
            onChange={(e) => setNewSite(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addSite()} />
              <button className="btn btn-primary" onClick={addSite}><IconPlus size={17} /> Block</button>
            </div>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 10 }}>
              Changes apply across every connected browser within moments.
            </div>
          </div>
          <div className="card" style={{ padding: 8 }}>
            {bl.customSites.map((site) =>
          <div className="setting" key={site.id} style={{ padding: '13px 14px' }}>
                <div className="ico" style={{ background: 'color-mix(in oklab, var(--accent-2) 14%, transparent)', color: 'var(--accent-2)' }}><IconShield size={18} /></div>
                <div className="txt"><b>{site.url}</b><span>Added {site.added}</span></div>
                <button className="btn btn-ghost btn-sm" onClick={() => removeSite(site)}><IconTrash size={15} /></button>
              </div>
          )}
            {!bl.customSites.length && <div style={{ padding: 24, textAlign: 'center', color: 'var(--muted)' }}>No custom sites yet.</div>}
          </div>

          {/* pending removals (4.1) — still blocked until the delay elapses */}
          {pendingRemovals.length > 0 &&
            <div className="card" style={{ padding: 8 }}>
              <div style={{ fontWeight: 800, fontSize: 13, padding: '10px 14px 2px' }}>Pending removals</div>
              <div style={{ fontSize: 12, color: 'var(--muted)', padding: '0 14px 10px' }}>
                Still blocked until the delay below elapses — click "Keep blocking" to cancel the removal.
              </div>
              {pendingRemovals.map((p) => {
                const domain = p.action_id.slice('custom_block.remove:'.length);
                return (
                  <div className="setting" key={p.action_id} style={{ padding: '13px 14px' }}>
                    <div className="ico" style={{ background: 'color-mix(in oklab, #d9a441 18%, transparent)', color: '#c9962f' }}><IconShield size={18} /></div>
                    {/* fmtDur is a plain top-level function in pages-settings.jsx; see the
                        note in pages-blocking.jsx for why cross-file load order is safe here. */}
                    <div className="txt"><b>{domain}</b><span>Unblocks in {fmtDur(p.remaining_secs)}</span></div>
                    <button className="btn btn-ghost btn-sm" onClick={() => keepBlocking(p)}>Keep blocking</button>
                  </div>
                );
              })}
            </div>
          }
        </div>
      }

      {tab === 'allow' &&
      <div className="grid fade-up" style={{ gap: 16 }}>
          <div className="card" style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
            <div className="ico" style={{ width: 40, height: 40, flex: '0 0 40px', borderRadius: 12, display: 'grid', placeItems: 'center', background: 'color-mix(in oklab, var(--accent) 14%, transparent)', color: 'var(--accent)' }}><IconHeart size={20} /></div>
            <div>
              <div style={{ fontWeight: 800, fontSize: 15 }}>Trusted exceptions</div>
              <p style={{ fontSize: 13.5, color: 'var(--muted)', lineHeight: 1.5, marginTop: 4 }}>Health and education resources that won't be blocked, even when they touch on sensitive topics.
Such as Wikipedia, Certain AI providers and etc.
</p>
            </div>
          </div>
        </div>
      }
    </div>);

}
window.BlocklistPage = BlocklistPage;