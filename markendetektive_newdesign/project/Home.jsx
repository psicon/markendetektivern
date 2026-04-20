// Home.jsx — MarkenDetektive home (rewritten to match screenshots)
function Home({ onOpenProduct, onOpenSearch, onOpenScanner, onOpenProfile, onOpenReceipt, onOpenPhotos, onOpenFavorites, onOpenSurveys, onOpenLists, variant = 'a', userName = 'Hannah' }) {
  const totalSavings = 47.80;
  const thisMonth = 12.45;

  const featured = PRODUCTS.slice(0, 4).map(p => {
    const best = bestNoName(p);
    return { product: p, best, saved: savings(p, best), pct: savingsPct(p, best) };
  });

  if (variant === 'b') return <HomeB {...{ onOpenProduct, onOpenSearch, onOpenScanner, onOpenLists, userName, featured }}/>;

  // Scroll-driven header morph: [logo + title] -> [search bar]
  const rootRef = useRefS(null);
  const [scrollY, setScrollY] = useStateS(0);
  useEffectS(() => {
    const scroller = rootRef.current?.parentElement;
    if (!scroller) return;
    const onScroll = () => setScrollY(scroller.scrollTop);
    scroller.addEventListener('scroll', onScroll, { passive: true });
    return () => scroller.removeEventListener('scroll', onScroll);
  }, []);
  // Start morph after ~30px, complete by ~85px
  const t = Math.max(0, Math.min(1, (scrollY - 30) / 55));

  return (
    <div ref={rootRef} style={{ fontFamily: F, background: 'var(--th-bg)', minHeight: '100%', paddingBottom: 110 }}>
      {/* Sticky morphing header */}
      <div style={{
        position: 'sticky', top: 0, zIndex: 20,
        background: 'var(--th-bg)',
        padding: '10px 20px 8px',
        boxShadow: t > 0.5 ? '0 2px 8px rgba(0,0,0,.04)' : 'none',
        transition: 'box-shadow .2s ease',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, height: 48 }}>
          {/* Morphing slot: logo+title OR search bar */}
          <div style={{ flex: 1, position: 'relative', height: 48 }}>
            {/* Logo + Title layer */}
            <div style={{
              position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', gap: 10,
              opacity: 1 - t,
              transform: `translateY(${t * -6}px) scale(${1 - t * 0.08})`,
              transformOrigin: 'left center',
              pointerEvents: t > 0.5 ? 'none' : 'auto',
              transition: 'opacity .12s ease-out',
            }}>
              <DetectiveMark size={28} color={COLORS.primary}/>
              <h1 style={{
                font: `800 20px ${F}`, color: COLORS.primary, margin: 0,
                letterSpacing: '-.01em', whiteSpace: 'nowrap',
              }}>MarkenDetektive</h1>
            </div>
            {/* Search bar layer */}
            <button onClick={onOpenSearch} style={{
              position: 'absolute', inset: 0,
              height: 40, margin: 'auto 0', top: 4, bottom: 4,
              borderRadius: 20, background: COLORS.low, border: 0,
              display: 'flex', alignItems: 'center', gap: 10, padding: '0 14px',
              cursor: 'pointer',
              opacity: t,
              transform: `translateY(${(1 - t) * 8}px)`,
              pointerEvents: t < 0.5 ? 'none' : 'auto',
              transition: 'opacity .12s ease-out',
            }}>
              <MdI name="magnify" size={18} color={COLORS.muted}/>
              <span style={{
                flex: 1, font: `500 14px ${F}`, color: COLORS.muted, textAlign: 'left',
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
              }}>Marken oder Produkte suchen…</span>
            </button>
          </div>
          <button onClick={onOpenScanner} style={{
            width: 36, height: 36, borderRadius: 18, background: COLORS.low, border: 0, cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
          }}>
            <MdI name="barcode-scan" size={18} color={COLORS.muted}/>
          </button>
          <button onClick={onOpenProfile} style={{
            width: 36, height: 36, borderRadius: 18, background: COLORS.low, border: 0, cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
          }}>
            <MdI name="account-outline" size={20} color={COLORS.muted}/>
          </button>
        </div>
      </div>

      {/* Full-width search bar below header (fades out as header search takes over) */}
      <div style={{
        padding: '6px 20px 0',
        opacity: 1 - t,
        transform: `translateY(${t * -12}px)`,
        pointerEvents: t > 0.5 ? 'none' : 'auto',
        transition: 'opacity .12s ease-out',
      }}>
        <button onClick={onOpenSearch} style={{
          width: '100%', height: 48, borderRadius: 24, background: COLORS.low, border: 0,
          display: 'flex', alignItems: 'center', gap: 10, padding: '0 18px',
          cursor: 'pointer',
        }}>
          <MdI name="magnify" size={18} color={COLORS.muted}/>
          <span style={{ flex: 1, font: `500 14px ${F}`, color: COLORS.muted, textAlign: 'left' }}>Marken oder Produkte suchen…</span>
          <MdI name="magnify" size={16} color={COLORS.muted}/>
        </button>
      </div>

      {/* First-run welcome card (explanation moved here from onboarding) */}
      <HomeWelcome onOpenScanner={onOpenScanner}/>

      {/* Schnellzugriff */}
      <div style={{ padding: '20px 20px 0' }}>
        <h2 style={{ font: `700 17px ${F}`, color: COLORS.text, margin: '0 0 12px', letterSpacing: '-.01em' }}>Schnellzugriff</h2>
        <div style={{ display: 'flex', gap: 10, overflowX: 'auto', scrollbarWidth: 'none' }}>
          {[
            { i: 'receipt-text-outline',  l: 'Kassenbon\nscannen',      bg: '#95cfc4', dark: true, onClick: onOpenReceipt   || onOpenScanner },
            { i: 'camera-plus-outline',   l: 'Produkte\neinreichen',    bg: '#a89cdf', dark: true, onClick: onOpenPhotos    || onOpenScanner },
            { i: 'heart-outline',         l: 'Deine\nFavoriten',        bg: '#dde2e4',             onClick: onOpenFavorites || onOpenProfile },
            { i: 'poll',                  l: 'Umfragen',                bg: '#dde2e4',             onClick: onOpenSurveys   || onOpenScanner },
            { i: 'format-list-checks',    l: 'Einkaufs-\nliste',        bg: '#dde2e4',             onClick: onOpenLists     || onOpenProfile },
          ].map((q, i) => (
            <button key={i} onClick={q.onClick} style={{
              width: 112, height: 90, flexShrink: 0, borderRadius: 14, background: q.bg, border: 0,
              cursor: 'pointer', padding: 12, display: 'flex', flexDirection: 'column',
              alignItems: 'flex-start', justifyContent: 'space-between',
            }}>
              <MdI name={q.i} size={22} color={q.dark ? '#fff' : COLORS.text}/>
              <span style={{ font: `600 12px/1.2 ${F}`, color: q.dark ? '#fff' : COLORS.text, textAlign: 'left', whiteSpace: 'pre-line' }}>{q.l}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Level progress card */}
      <div style={{ padding: '18px 20px 0' }}>
        <div style={{
          borderRadius: 14, padding: '14px 16px',
          background: 'linear-gradient(90deg,#4a90c2,#4a73a8 50%,#3a5a8a 100%)',
          color: '#fff', display: 'flex', alignItems: 'center', gap: 12,
        }}>
          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 8 }}>
              <span style={{ font: `700 13px ${F}` }}>Level 6: Clever-Shopper</span>
            </div>
            <div style={{ height: 8, background: 'rgba(255,255,255,.25)', borderRadius: 4, overflow: 'hidden' }}>
              <div style={{ width: '85%', height: '100%', background: '#fff', borderRadius: 4 }}/>
            </div>
            <div style={{ font: `500 11px ${F}`, opacity: .9, marginTop: 6 }}>Noch 450 Punkte bis zum nächsten Rang</div>
          </div>
          <div style={{
            width: 40, height: 40, borderRadius: 20, background: 'rgba(255,255,255,.2)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
          }}>
            <MdI name="trophy-outline" size={22} color="#fff"/>
          </div>
        </div>
      </div>

      {/* INVESTIGATION UPDATE — Neu für dich enttarnt */}
      <div style={{ padding: '26px 20px 0' }}>
        <div style={{ font: `700 11px ${F}`, color: COLORS.primary, letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 4 }}>
          Investigation Update
        </div>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
          <h2 style={{ font: `800 22px ${F}`, color: COLORS.text, margin: 0, letterSpacing: '-.01em' }}>Neu für dich enttarnt</h2>
          <button onClick={onOpenSearch} style={{ background: 'transparent', border: 0, color: COLORS.primary, font: `700 13px ${F}`, cursor: 'pointer' }}>
            Alle anzeigen
          </button>
        </div>
      </div>

      {/* Product cards carousel — uses new ProductCard */}
      <div style={{ padding: '14px 20px 0', display: 'flex', gap: 14, overflowX: 'auto', scrollbarWidth: 'none' }}>
        {featured.map(({ product }) => (
          <div key={product.id} style={{ flexShrink: 0, width: 170 }}>
            <ProductCard product={product} variant="h" onClick={()=>onOpenProduct(product)}/>
          </div>
        ))}
      </div>

      {/* Neuigkeiten */}
      <div style={{ padding: '26px 20px 0' }}>
        <h2 style={{ font: `800 20px ${F}`, color: COLORS.text, margin: '0 0 14px', letterSpacing: '-.01em' }}>Neuigkeiten</h2>
        <div style={{ display: 'flex', gap: 14, overflowX: 'auto', scrollbarWidth: 'none', paddingBottom: 4 }}>
          {[
            { tag: 'INSIDER WISSEN', title: 'Hersteller-Codes auf Verpackungen richtig lesen', sub: 'Lerne die geheime Sprache der Lebensmittelindustrie.', tint: ['#8ac47e','#c28a4e'], emoji: '🥦' },
            { tag: 'VERBRAUCHERSCHUTZ', title: 'Preiserhöhungen: Marken jetzt', sub: 'Shrinkflation erkennen und sparen.', tint: ['#c9a77a','#9a8261'], emoji: '📦' },
            { tag: 'TIPP', title: 'Die 5 besten Eigenmarken im Test', sub: 'Lidl, Aldi & co. im Vergleich.', tint: ['#a9c8e6','#6a8fb0'], emoji: '🏆' },
          ].map((n, i) => (
            <div key={i} style={{
              width: 270, flexShrink: 0, background: 'var(--th-card)', borderRadius: 16, overflow: 'hidden', cursor: 'pointer',
            }}>
              <div style={{ position: 'relative', height: 130, background: `linear-gradient(135deg,${n.tint[0]},${n.tint[1]})`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <span style={{ fontSize: 50 }}>{n.emoji}</span>
                <span style={{
                  position: 'absolute', top: 10, left: 10, background: '#e89042', color: '#fff',
                  padding: '4px 10px', borderRadius: 8, font: `800 10px ${F}`, letterSpacing: 0.8,
                }}>{n.tag}</span>
              </div>
              <div style={{ padding: '12px 14px 14px' }}>
                <div style={{ font: `700 14px/1.3 ${F}`, color: COLORS.text }}>{n.title}</div>
                <div style={{ font: `400 12px/1.4 ${F}`, color: COLORS.muted, marginTop: 6 }}>{n.sub}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Cashback CTA */}
      <div style={{ padding: '26px 20px 0' }}>
        <div style={{
          position: 'relative', overflow: 'hidden',
          borderRadius: 18, padding: '22px 24px',
          background: 'linear-gradient(135deg,#0a6f62,#0d8575)',
          color: '#fff', boxShadow: '0 6px 14px rgba(13,133,117,.25)',
        }}>
          <div style={{
            position: 'absolute', right: -30, bottom: -20, opacity: 0.18,
          }}>
            <DetectiveMark size={140} color="#fff"/>
          </div>
          <div style={{ position: 'relative' }}>
            <h3 style={{ font: `800 22px/1.2 ${F}`, margin: 0, letterSpacing: '-.01em' }}>
              Sichere dir Cashback &<br/>Rewards!
            </h3>
            <p style={{ font: `400 13px/1.5 ${F}`, margin: '10px 0 16px', opacity: .92, maxWidth: 260 }}>
              Scanne deinen Kassenbeleg oder nimm an Umfragen teil, um dir Gutscheine oder Cashback zu sichern.
            </p>
            <button onClick={onOpenScanner} style={{
              background: 'var(--th-card)', color: COLORS.primary, border: 0, cursor: 'pointer',
              height: 44, padding: '0 18px', borderRadius: 22,
              font: `700 13px ${F}`,
              display: 'inline-flex', alignItems: 'center', gap: 8,
            }}>
              <MdI name="barcode-scan" size={16} color={COLORS.primary}/>
              Beleg scannen
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Variant B: "Ticker" — compact home with list-style deals ──
function HomeB({ onOpenProduct, onOpenSearch, onOpenScanner, onOpenLists, userName, featured }) {
  const totalSavings = 47.80;
  return (
    <div style={{ fontFamily: F, background: 'var(--th-bg)', minHeight: '100%', paddingBottom: 110 }}>
      <div style={{
        background: COLORS.gradient, color: '#fff', padding: '16px 18px 22px',
        borderRadius: '0 0 24px 24px',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <DetectiveMark size={28} color="#fff"/>
          <div style={{ flex: 1 }}>
            <div style={{ font: `500 12px ${F}`, opacity: .85 }}>Servus {userName} 👋</div>
            <div style={{ font: `800 18px ${F}`, marginTop: 2, letterSpacing: '-.01em' }}>MarkenDetektive</div>
          </div>
        </div>
        <div style={{ marginTop: 18 }}>
          <div style={{ font: `500 11px ${F}`, opacity: .85, textTransform: 'uppercase', letterSpacing: 1 }}>Bisher gespart</div>
          <div style={{ font: `800 42px/1 ${F}`, letterSpacing: '-.02em', marginTop: 4 }}>
            {totalSavings.toFixed(2).replace('.', ',')} €
          </div>
        </div>
      </div>
      <div style={{ padding: '22px 20px 0' }}>
        <h2 style={{ font: `800 20px ${F}`, color: COLORS.text, margin: 0 }}>Frisch enttarnt</h2>
        <div style={{ marginTop: 14, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          {featured.map(({ product }) => (
            <ProductCard key={product.id} product={product} variant="grid" onClick={()=>onOpenProduct(product)}/>
          ))}
        </div>
      </div>
    </div>
  );
}

window.Home = Home;

// ─────────────────────────────────────────────────────────
// HomeWelcome — first-run click-through tutorial overlay on Home
// Same pattern as Rewards/Scanner onboarding: portal + dot-progress.
// ─────────────────────────────────────────────────────────
function HomeWelcome({ onOpenScanner }) {
  const KEY = 'md-home-welcome-dismissed';
  const [dismissed, setDismissed] = useStateS(() => {
    try { return !!localStorage.getItem(KEY); } catch { return false; }
  });
  const [step, setStep] = React.useState(0);

  // Only show when app onboarding is done AND welcome not yet dismissed
  const obDone = useStateS(() => {
    try { return !!localStorage.getItem('md-app-onboard-seen'); } catch { return false; }
  })[0];

  if (dismissed) return null;
  if (!obDone) return null;

  const commit = () => {
    try { localStorage.setItem(KEY, '1'); } catch {}
    setDismissed(true);
  };

  const STEPS = [
    {
      icon: '🕵️',
      title: 'Willkommen, Detektiv!',
      body: 'Discounter führen oft günstigere Eigenmarken — manchmal sogar vom selben Hersteller.\n\nWir helfen dir, sie zu finden.',
      cta: 'Los geht\'s',
    },
    {
      icon: '🔎',
      title: 'Nicht jedes Produkt hat einen Treffer',
      body: 'Ehrlich gesagt: zu manchen Marken gibt es keine günstigere Eigenmarke. Dann sagen wir dir das auch.\n\nUnsere Datenbank wächst mit jedem Scan und jedem Bon.',
      color: '#b88400',
      cta: 'Verstanden',
    },
    {
      icon: '📷',
      title: 'Scannen oder suchen',
      body: 'Barcode scannen, Foto vom Produkt machen oder Marke suchen.\n\nGibt\'s eine passende Eigenmarke, zeigen wir sie dir mit Preisvergleich.',
      color: '#8b5cf6',
      cta: 'Weiter',
    },
    {
      icon: '🧾',
      title: 'Bons einreichen, Cashback bekommen',
      body: 'Jeder Kassenbon macht die Datenbank besser — und gibt dir Taler.\n\nAb 15 € zahlen wir aus.',
      color: '#0d8575',
      cta: 'Loslegen',
    },
  ];

  const s = STEPS[step];
  const last = step === STEPS.length - 1;
  const next = () => last ? commit() : setStep(step + 1);

  // Portal into phone's sheet host
  const overlay = (
    <div style={{
      position: 'absolute', inset: 0, zIndex: 70,
      background: 'rgba(15,18,19,.72)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 20, pointerEvents: 'auto',
    }}>
      <div style={{
        width: '100%', background: 'var(--th-card)', borderRadius: 18,
        padding: '22px 20px 18px',
        boxShadow: '0 24px 60px rgba(0,0,0,.3)',
        animation: 'rh-pop .24s cubic-bezier(.2,.9,.2,1) both',
      }}>
        {/* progress dots */}
        <div style={{ display: 'flex', gap: 6, justifyContent: 'center', marginBottom: 16 }}>
          {STEPS.map((_, i) => (
            <div key={i} style={{
              width: i === step ? 20 : 6, height: 6, borderRadius: 3,
              background: i === step ? (s.color || COLORS.primary) : 'rgba(25,28,29,.15)',
              transition: 'all .25s',
            }}/>
          ))}
        </div>

        <div style={{
          fontSize: 52, textAlign: 'center', marginBottom: 12, lineHeight: 1,
        }}>{s.icon}</div>

        <h2 style={{
          margin: 0, font: `800 22px/1.2 ${F}`, color: COLORS.text,
          textAlign: 'center', letterSpacing: '-.01em',
          minHeight: 54,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>{s.title}</h2>

        <p style={{
          margin: '10px 0 20px', font: `500 14px/1.55 ${F}`, color: COLORS.muted,
          textAlign: 'center', whiteSpace: 'pre-line',
          minHeight: 130,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>{s.body}</p>

        <button onClick={next} style={{
          width: '100%', height: 48, borderRadius: 12, border: 0, cursor: 'pointer',
          background: s.color || COLORS.primary, color: '#fff',
          font: `800 14px ${F}`, letterSpacing: '-.01em',
        }}>
          {s.cta}
        </button>

        <button
          onClick={last ? undefined : commit}
          disabled={last}
          style={{
            width: '100%', height: 36, marginTop: 6, border: 0, background: 'transparent',
            cursor: last ? 'default' : 'pointer',
            color: last ? 'transparent' : COLORS.muted,
            font: `600 12px ${F}`,
          }}
        >
          Überspringen
        </button>
      </div>
    </div>
  );

  // Portal into phone's sheet host (so it lives above content, like other tutorials)
  if (typeof document !== 'undefined' && window.ReactDOM && window.ReactDOM.createPortal) {
    const host = document.getElementById('__sheet_host');
    if (host) return window.ReactDOM.createPortal(overlay, host);
  }
  return overlay;
}

window.HomeWelcome = HomeWelcome;
