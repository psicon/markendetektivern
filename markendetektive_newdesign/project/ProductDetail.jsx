// ProductDetail.jsx — WahrheitsCheck, eng an Screenshot angelehnt
function ProductDetail({ product, onBack, onOpenProduct, onOpenLists, variant = 'a' }) {
  const p = product || PRODUCTS[0];
  if (p.orphan) return <ProductDetailOrphan product={p} onBack={onBack} onOpenProduct={onOpenProduct} onOpenLists={onOpenLists}/>;
  const sorted = useMemoS(() => [...p.noNames].sort((a,b) => b.stufe - a.stufe || a.price - b.price), [p]);
  const [idx, setIdx] = useStateS(0);
  const picked = sorted[idx];
  const [tab, setTab] = useStateS('ingredients');
  const [favMap, setFavMap] = useStateS({});
  const [listMap, setListMap] = useStateS({});
  const [ratings, setRatings] = useStateS(null); // { key, label, showSimilarity } or null
  const RatingsSheet = window.RatingsSheet;
  const fav = !!favMap[picked.id];
  const onList = !!listMap[picked.id];
  const setFav = (fn) => setFavMap(m => ({ ...m, [picked.id]: typeof fn === 'function' ? fn(!!m[picked.id]) : fn }));
  const setOnList = (fn) => setListMap(m => ({ ...m, [picked.id]: typeof fn === 'function' ? fn(!!m[picked.id]) : fn }));

  // Swipe
  const trackRef = useRefS(null);
  useEffectS(() => { setIdx(0); }, [p.id]);
  const onScroll = (e) => {
    const el = e.currentTarget;
    const step = 280 + 12; // card width + gap
    const i = Math.round(el.scrollLeft / step);
    if (i !== idx && i >= 0 && i < sorted.length) setIdx(i);
  };

  // Good alternatives = other products (simple pool)
  const alternatives = PRODUCTS.filter(x => x.id !== p.id).slice(0, 4);

  // Derived per picked NoName
  const pickedRating = (3.3 + picked.stufe * 0.35).toFixed(1);  // 3.7..4.7
  const pickedReviews = 120 + picked.stufe * 48 + (idx * 17);

  // Compute unit price string for brand (e.g. '200g (8,90€/kg)')
  const brandUnit = (() => {
    const m = p.size.match(/^([\d.,]+)\s*(g|kg|ml|l)$/i);
    if (!m) return p.size;
    const num = parseFloat(m[1].replace(',', '.'));
    const u = m[2].toLowerCase();
    if (u === 'g') return `(${(p.brandPrice / num * 1000).toFixed(2).replace('.', ',')}€/kg)`;
    if (u === 'kg') return `(${(p.brandPrice / num).toFixed(2).replace('.', ',')}€/kg)`;
    if (u === 'ml') return `(${(p.brandPrice / num * 1000).toFixed(2).replace('.', ',')}€/L)`;
    if (u === 'l') return `(${(p.brandPrice / num).toFixed(2).replace('.', ',')}€/L)`;
    return '';
  })();
  // Stufe affects ingredient match + nutrition closeness
  const stufeToMatchBoost = { 5: 0, 4: -5, 3: -15, 2: -25, 1: -40 }[picked.stufe] || 0;
  const stufeTexts = {
    5: { label: 'Identisch', line: 'Wird am selben Band mit identischer Rezeptur produziert.' },
    4: { label: 'Nahezu identisch', line: 'Gleicher Hersteller, minimal abweichende Rezeptur.' },
    3: { label: 'Ähnlich', line: 'Gleicher Hersteller, angepasste Rezeptur — sehr ähnlich im Geschmack.' },
    2: { label: 'Verwandt', line: 'Anderer Hersteller, aber vergleichbare Qualität & Zutaten.' },
    1: { label: 'Alternative', line: 'Günstige Alternative mit abweichender Rezeptur.' },
  }[picked.stufe] || { label: 'Alternative', line: '—' };

  return (
    <div style={{ fontFamily: F, background: 'var(--th-bg)', minHeight: '100%', paddingBottom: 110 }}>
      {/* Header */}
      <div style={{
        padding: '12px 16px 4px', display: 'flex', alignItems: 'center', gap: 10,
        background: 'var(--th-bg)', zIndex: 5, position: 'sticky', top: 0,
      }}>
        <button onClick={onBack} style={{ width: 40, height: 40, borderRadius: 20, background: 'transparent', border: 0, cursor: 'pointer' }}>
          <MdI name="arrow-left" size={22} color={COLORS.text}/>
        </button>
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 8 }}>
          <h1 style={{ font: `800 20px ${F}`, color: COLORS.text, letterSpacing: '-.01em', margin: 0 }}>Produktdetails</h1>
        </div>
        <button style={{ width: 40, height: 40, borderRadius: 20, background: 'transparent', border: 0, cursor: 'pointer' }}>
          <MdI name="magnify" size={22} color={COLORS.muted}/>
        </button>
        <button style={{ width: 40, height: 40, borderRadius: 20, background: 'transparent', border: 0, cursor: 'pointer' }}>
          <MdI name="bell-outline" size={22} color={COLORS.muted}/>
        </button>
      </div>

      {/* DAS ORIGINAL + Title */}
      <div style={{ padding: '10px 20px 10px' }}>
        <div style={{ font: `600 11px ${F}`, color: COLORS.muted, letterSpacing: 1.2, textTransform: 'uppercase' }}>
          Das Original
        </div>
        <h1 style={{ font: `800 26px/1.1 ${F}`, color: COLORS.text, margin: '2px 0 0', letterSpacing: '-.02em' }}>
          {p.name}
        </h1>
      </div>

      {/* Hero image with Brand+Hersteller chip top-left + actions bottom-right */}
      <div style={{ padding: '0 20px' }}>
        <div style={{ position: 'relative', borderRadius: 20, overflow: 'hidden' }}>
          <ProductImg product={p} size={240} rounded={0}/>
          {/* Brand + Hersteller — single colored pill, top-left */}
          {p.markeColor && (
            <div style={{
              position: 'absolute', left: 12, top: 12,
              background: p.markeColor, color: '#fff',
              padding: '6px 12px', borderRadius: 99,
              display: 'inline-flex', alignItems: 'center', gap: 10,
              maxWidth: 'calc(100% - 24px)',
              boxShadow: '0 2px 8px rgba(0,0,0,.18)',
            }}>
              <span style={{ font: `800 13px ${F}`, letterSpacing: '-.01em' }}>{p.brand}</span>
              <span style={{ width: 1, alignSelf: 'stretch', background: 'rgba(255,255,255,.4)' }}/>
              <span style={{
                font: `600 11px ${F}`, opacity: .95,
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>{p.maker || picked.maker}</span>
            </div>
          )}
          {/* Hersteller-Match badge — top-right, only if NoName has same maker */}
          {picked.maker === p.maker && (
            <div style={{
              position: 'absolute', right: 12, top: 12, background: COLORS.primary,
              color: '#fff', padding: '6px 10px', borderRadius: 18,
              display: 'inline-flex', alignItems: 'center', gap: 6,
              font: `700 11px ${F}`, boxShadow: '0 4px 10px rgba(13,133,117,.3)',
            }}>
              <MdI name="check-decagram" size={13} color="#fff"/>
              Selber Hersteller
            </div>
          )}

          {/* Price + size — bottom-left */}
          <div style={{
            position: 'absolute', left: 12, bottom: 12,
            background: 'rgba(255,255,255,.95)', backdropFilter: 'blur(8px)',
            padding: '8px 12px', borderRadius: 14,
            boxShadow: '0 2px 8px rgba(0,0,0,.12)',
          }}>
            <div style={{ font: `500 11px ${F}`, color: COLORS.muted }}>
              {p.size} · {brandUnit.replace(/^\(/, '').replace(/\)$/, '')}
            </div>
            <div style={{ font: `800 22px/1 ${F}`, color: COLORS.text, letterSpacing: '-.02em', marginTop: 4 }}>
              {p.brandPrice.toFixed(2).replace('.', ',')}€
            </div>
          </div>

          {/* Icon action cluster — bottom-right, matches NoName card */}
          <div style={{
            position: 'absolute', bottom: 12, right: 12,
            display: 'flex', gap: 8,
          }}>
            <button onClick={()=>setFav(v=>!v)} style={{
              width: 48, height: 48, borderRadius: 14, border: `1px solid rgba(25,28,29,.1)`,
              background: 'var(--th-card)', cursor: 'pointer',
              boxShadow: '0 2px 6px rgba(0,0,0,.08)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <MdI name={fav ? 'heart' : 'heart-outline'} size={22} color={fav ? '#e53935' : COLORS.text}/>
            </button>
            <button onClick={()=>setOnList(v=>!v)} style={{
              width: 48, height: 48, borderRadius: 14,
              border: onList ? 0 : `1px solid rgba(25,28,29,.1)`, cursor: 'pointer',
              background: onList ? COLORS.primary : 'var(--th-card)',
              boxShadow: '0 2px 6px rgba(0,0,0,.08)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <MdI name={onList ? 'cart-check' : 'cart-plus'} size={22} color={onList ? '#fff' : COLORS.text}/>
            </button>
            <button onClick={() => setRatings({ key: p.id, label: `${p.brand} ${p.name}`, showSimilarity: false })} style={{
              width: 48, height: 48, borderRadius: 14, border: `1px solid rgba(25,28,29,.1)`,
              background: 'var(--th-card)', cursor: 'pointer',
              boxShadow: '0 2px 6px rgba(0,0,0,.08)',
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
              gap: 0, padding: 0,
            }}>
              <MdI name="star" size={14} color="#f5b301"/>
              <div style={{ font: `800 12px/1 ${F}`, color: COLORS.text, marginTop: 2 }}>4.7</div>
            </button>
          </div>
        </div>
      </div>

      {/* "Alternativen vom gleichen Hersteller" */}
      <div style={{ padding: '18px 20px 0' }}>
        <h2 style={{ font: `800 20px/1.2 ${F}`, color: COLORS.text, margin: 0, letterSpacing: '-.01em' }}>
          Alternativen vom gleichen Hersteller
        </h2>
      </div>

      {/* Horizontal swipe carousel of NoNames — with right fade + chevron */}
      <div style={{ position: 'relative', marginTop: 10 }}>
        <div
          ref={trackRef}
          onScroll={onScroll}
          style={{
            padding: '0 20px 4px',
            scrollPaddingLeft: 20, scrollPaddingRight: 20,
            display: 'flex', gap: 12, overflowX: sorted.length > 1 ? 'auto' : 'hidden',
            scrollSnapType: 'x mandatory',
            WebkitOverflowScrolling: 'touch', scrollbarWidth: 'none',
          }}
        >
        {sorted.map((nn, i) => {
          const s = savings(p, nn);
          const pct = savingsPct(p, nn);
          const m = MARKETS[nn.market];
          const active = i === idx;
          const stufeLabel = { 5: 'Identisch', 4: 'Nahezu identisch', 3: 'Ähnlich', 2: 'Verwandt', 1: 'Alternative' }[nn.stufe] || 'Alternative';
          const stufeColor = COLORS.stufe[nn.stufe] || COLORS.primary;
          return (
            <div key={nn.id} onClick={() => setIdx(i)} style={{
              flexShrink: 0, width: sorted.length === 1 ? 'calc(100vw - 40px)' : 280,
              maxWidth: sorted.length === 1 ? 'calc(100% - 0px)' : 280,
              scrollSnapAlign: 'start',
              background: 'var(--th-card)', borderRadius: 18, boxShadow: SH_MD, overflow: 'hidden',
              border: active ? `2px solid ${COLORS.primary}` : '2px solid transparent',
              transition: 'border .2s',
              cursor: 'pointer',
              position: 'relative',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', padding: 12, gap: 12 }}>
                {/* Thumb */}
                <div style={{ width: 60, height: 60, flexShrink: 0, position: 'relative' }}>
                  <ProductImg product={p} size={60} rounded={10}/>
                </div>
                {/* Info */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 4 }}>
                    <MdI name={nn.stufe === 5 ? 'check-decagram' : nn.stufe === 4 ? 'check-circle' : 'circle-slice-5'} size={12} color={stufeColor}/>
                    <span style={{ font: `700 10px ${F}`, color: stufeColor, letterSpacing: 0.6, textTransform: 'uppercase' }}>
                      {stufeLabel}
                    </span>
                  </div>
                  <div style={{ font: `700 15px/1.2 ${F}`, color: COLORS.text, marginBottom: 4 }}>
                    {nn.brand} {nn.name}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                    <div style={{
                      width: 16, height: 16, borderRadius: 4, background: m.tint,
                      color: '#fff', font: `800 9px ${F}`,
                      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    }}>{m.short}</div>
                    <span style={{ font: `500 11px ${F}`, color: COLORS.muted }}>{m.name} Eigenmarke</span>
                  </div>
                </div>
                {/* % badge — flag corner top-right */}
                <div style={{
                  position: 'absolute', top: -2, right: -2,
                  background: '#e53935', color: '#fff',
                  padding: '7px 12px',
                  borderTopRightRadius: 16,
                  borderBottomLeftRadius: 14,
                  font: `800 13px/1 ${F}`, letterSpacing: '-.01em',
                  boxShadow: '0 4px 10px rgba(229,57,53,.35)',
                  pointerEvents: 'none',
                }}>−{pct}%</div>
              </div>
              {/* Divider */}
              <div style={{ height: 1, background: 'var(--th-border-md)', margin: '0 14px' }}/>
              {/* Price + actions row */}
              <div style={{ padding: '12px 14px 14px', display: 'flex', alignItems: 'flex-end', gap: 10 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ font: `500 10.5px ${F}`, color: COLORS.muted, whiteSpace: 'nowrap' }}>
                    {nn.size.replace(/\s+/g, '')} · {nn.unit.replace(/^[^(]+\(/, '').replace(/\)$/, '')}
                  </div>
                  <div style={{ font: `800 22px/1 ${F}`, color: COLORS.primary, letterSpacing: '-.02em', marginTop: 4 }}>
                    {nn.price.toFixed(2).replace('.', ',')}€
                  </div>
                </div>
                {/* Action cluster — 3 equal icon-only buttons, 48×48, 8px gap */}
                <div style={{ display: 'flex', gap: 8 }}>
                  <button onClick={(e) => { e.stopPropagation(); setFavMap(m => ({ ...m, [nn.id]: !m[nn.id] })); }} style={{
                    width: 48, height: 48, borderRadius: 14, border: `1px solid rgba(25,28,29,.1)`,
                    background: 'var(--th-card)', cursor: 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    <MdI name={favMap[nn.id] ? 'heart' : 'heart-outline'} size={22} color={favMap[nn.id] ? '#e53935' : COLORS.text}/>
                  </button>
                  <button onClick={(e) => { e.stopPropagation(); setListMap(m => ({ ...m, [nn.id]: !m[nn.id] })); }} style={{
                    width: 48, height: 48, borderRadius: 14,
                    border: listMap[nn.id] ? 0 : `1px solid rgba(25,28,29,.1)`,
                    background: listMap[nn.id] ? COLORS.primary : '#fff',
                    cursor: 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    <MdI name={listMap[nn.id] ? 'cart-check' : 'cart-plus'} size={22} color={listMap[nn.id] ? '#fff' : COLORS.text}/>
                  </button>
                  <button onClick={(e) => { e.stopPropagation(); setRatings({ key: nn.id, label: `${nn.brand} ${nn.name}`, showSimilarity: true }); }} style={{
                    width: 48, height: 48, borderRadius: 14, background: 'var(--th-card)',
                    border: `1px solid rgba(25,28,29,.1)`, cursor: 'pointer',
                    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                    gap: 0, padding: 0,
                  }}>
                    <MdI name="star" size={14} color="#f5b301"/>
                    <div style={{ font: `800 12px/1 ${F}`, color: COLORS.text, marginTop: 2 }}>{(3.3 + nn.stufe * 0.35).toFixed(1)}</div>
                  </button>
                </div>
              </div>
            </div>
          );
        })}
        </div>

        {/* Right-edge fade — hides when last card is visible */}
        {idx < sorted.length - 1 && (
          <div style={{
            position: 'absolute', top: 0, right: 0, bottom: 4, width: 48,
            background: 'linear-gradient(to left, rgba(249,250,251,1), rgba(249,250,251,0))',
            pointerEvents: 'none',
          }}/>
        )}

        {/* Chevron button — scrolls to next card */}
        {idx < sorted.length - 1 && (
          <button
            onClick={() => {
              const el = trackRef.current;
              if (!el) return;
              el.scrollTo({ left: (idx + 1) * (280 + 12), behavior: 'smooth' });
            }}
            style={{
              position: 'absolute', top: '50%', right: 8, transform: 'translateY(-50%)',
              width: 36, height: 36, borderRadius: 18, border: 0, cursor: 'pointer',
              background: 'var(--th-card)', boxShadow: '0 4px 12px rgba(0,0,0,.15)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            <MdI name="chevron-right" size={22} color={COLORS.text}/>
          </button>
        )}
      </div>

      {/* Dot indicator — only if >1 card */}
      {sorted.length > 1 && (
        <div style={{
          display: 'flex', justifyContent: 'center', gap: 6, marginTop: 10,
        }}>
          {sorted.map((_, i) => (
            <div key={i} style={{
              width: i === idx ? 18 : 6, height: 6, borderRadius: 3,
              background: i === idx ? COLORS.primary : 'rgba(25,28,29,.18)',
              transition: 'all .25s',
            }}/>
          ))}
        </div>
      )}

      {/* Tabs: Inhaltsstoffe / Nährwerte */}
      <div style={{
        margin: '24px 20px 0', padding: 4, borderRadius: 999, background: COLORS.low,
        display: 'flex', gap: 4,
      }}>
        {[['ingredients','Inhaltsstoffe'],['nutrition','Nährwerte']].map(([k,l]) => {
          const on = tab === k;
          return (
            <button key={k} onClick={()=>setTab(k)} style={{
              flex: 1, height: 40, borderRadius: 999, border: 0,
              background: on ? 'var(--th-card)' : 'transparent',
              color: on ? COLORS.text : COLORS.muted,
              font: `700 13px ${F}`, cursor: 'pointer',
              boxShadow: on ? '0 2px 6px rgba(25,28,29,.08)' : 'none',
            }}>{l}</button>
          );
        })}
      </div>

      {/* Match table */}
      <div style={{ margin: '18px 20px 0' }}>
        {tab === 'ingredients' ? (
          <>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
              <span style={{ font: `600 11px ${F}`, color: COLORS.muted, letterSpacing: 1, textTransform: 'uppercase' }}>Bestandteil</span>
              <span style={{ font: `600 11px ${F}`, color: COLORS.muted, letterSpacing: 1, textTransform: 'uppercase' }}>Match-Rate</span>
            </div>
            {getIngredients(p).map(([name, matchPct], i) => {
              const adj = Math.max(0, Math.min(100, matchPct + stufeToMatchBoost));
              return (
              <div key={i} style={{
                display: 'grid', gridTemplateColumns: '1fr auto 1fr',
                alignItems: 'center', gap: 14, padding: '10px 0',
                borderBottom: i < 2 ? '1px solid var(--th-divider)' : 'none',
              }}>
                <span style={{ font: `500 14px ${F}`, color: COLORS.text }}>{name}</span>
                <MdI name={adj >= 80 ? 'check-circle' : adj >= 40 ? 'circle-slice-5' : 'circle-outline'} size={18} color={adj >= 80 ? COLORS.primary : adj >= 40 ? '#f5b301' : COLORS.muted}/>
                <div style={{ display: 'flex', gap: 3, justifyContent: 'flex-end' }}>
                  {[1,2,3,4,5].map(n => (
                    <span key={n} style={{
                      width: 8, height: 16, borderRadius: 2,
                      background: n <= Math.round(adj / 20) ? COLORS.primary : 'var(--th-border-md)',
                    }}/>
                  ))}
                </div>
              </div>
            );})}
          </>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr auto auto', gap: '12px 14px', alignItems: 'center' }}>
            <span style={{ font: `600 11px ${F}`, color: COLORS.muted, textTransform: 'uppercase', letterSpacing: 1 }}>pro 100g</span>
            <span style={{ font: `700 11px ${F}`, color: COLORS.text, textAlign: 'right' }}>{p.brand}</span>
            <span style={{ font: `700 11px ${F}`, color: COLORS.primary, textAlign: 'right' }}>{picked.brand}</span>
            {[['Energie', '410 kcal', `${410 + (5-picked.stufe)*8} kcal`],['Fett', '8,5 g', `${(8.5 - (5-picked.stufe)*0.2).toFixed(1).replace('.',',')} g`],['Zucker', '13 g', `${13 + (5-picked.stufe)} g`],['Eiweiß', '3,2 g', '3,2 g']].map(([n,a,b]) => (
              <React.Fragment key={n}>
                <span style={{ font: `500 13px ${F}`, color: COLORS.text }}>{n}</span>
                <span style={{ font: `700 13px ${F}`, color: COLORS.text, textAlign: 'right' }}>{a}</span>
                <span style={{ font: `700 13px ${F}`, color: COLORS.primary, textAlign: 'right' }}>{b}</span>
              </React.Fragment>
            ))}
          </div>
        )}
      </div>

      {/* Detektiv-Check bestätigt info row — reflects picked stufe */}
      <div style={{ margin: '20px 20px 0', padding: '14px 16px', borderRadius: 14, background: COLORS.low, display: 'flex', alignItems: 'flex-start', gap: 12 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginTop: 1, alignItems: 'center' }}>
          <div style={{ font: `800 18px/1 ${F}`, color: COLORS.stufe[picked.stufe] || COLORS.primary }}>S{picked.stufe}</div>
          <div style={{ display: 'flex', gap: 2 }}>
            {[1,2,3,4,5].map(n => (
              <span key={n} style={{
                width: 5, height: 5, borderRadius: 3,
                background: n <= picked.stufe ? (COLORS.stufe[picked.stufe] || COLORS.primary) : 'rgba(25,28,29,.15)',
              }}/>
            ))}
          </div>
        </div>
        <span style={{ font: `500 12px/1.5 ${F}`, color: COLORS.textVar, flex: 1 }}>
          <b style={{ color: COLORS.text }}>Stufe {picked.stufe} — {stufeTexts.label}:</b> {stufeTexts.line} Hersteller: <b style={{ color: COLORS.text }}>{picked.maker}</b>.
        </span>
      </div>

      {/* Gute Alternativen */}
      <div style={{ padding: '28px 20px 0' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 14 }}>
          <h3 style={{ font: `800 20px ${F}`, color: COLORS.text, margin: 0, letterSpacing: '-.01em' }}>Gute Alternativen</h3>
          <button style={{ background: 'transparent', border: 0, color: COLORS.primary, font: `700 13px ${F}`, cursor: 'pointer' }}>
            Alle ansehen
          </button>
        </div>
        <div style={{ display: 'flex', gap: 14, overflowX: 'auto', scrollbarWidth: 'none', paddingBottom: 4 }}>
          {alternatives.map(ap => {
            const best = bestNoName(ap);
            return (
              <button key={ap.id} onClick={() => onOpenProduct && onOpenProduct(ap)} style={{
                width: 140, flexShrink: 0, background: 'var(--th-card)', borderRadius: 14, padding: 0, overflow: 'hidden',
                border: 0, cursor: 'pointer', textAlign: 'left',
              }}>
                <ProductImg product={ap} size={110} rounded={0}/>
                <div style={{ padding: '10px 10px 12px' }}>
                  <div style={{ font: `600 13px/1.2 ${F}`, color: COLORS.text, minHeight: 32 }}>
                    {ap.brand} {ap.name.split(' ').slice(0,2).join(' ')}
                  </div>
                  <div style={{ font: `700 13px ${F}`, color: COLORS.text, marginTop: 4 }}>
                    {best.price.toFixed(2).replace('.', ',')}€
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Ratings sheet */}
      {RatingsSheet && (
        <RatingsSheet
          open={!!ratings}
          onClose={() => setRatings(null)}
          contextLabel={ratings?.label || ''}
          ratingsKey={ratings?.key}
          showSimilarity={!!ratings?.showSimilarity}
        />
      )}
    </div>
  );
}

// Mock ingredient data per product
function getIngredients(p) {
  const base = {
    'mueller-milchreis':  [['Vollmilch (70%)', 100], ['Rundkornreis', 100], ['Zucker', 100]],
    'milka-alpenmilch':   [['Kakaomasse (30%)', 100], ['Vollmilchpulver', 100], ['Sojalecithin', 80]],
    'nutella-400':        [['Zucker', 100], ['Haselnüsse (13%)', 100], ['Magermilchpulver', 80]],
    'cocacola-15':        [['Wasser', 100], ['Zucker', 100], ['Koffein', 100]],
    'coffee-lav':         [['Arabica (80%)', 100], ['Robusta (20%)', 60]],
    'frischkase':         [['Frischkäse', 100], ['Sahne', 100], ['Salz', 100]],
    'hafer-drink':        [['Wasser', 100], ['Hafer (10%)', 100], ['Sonnenblumenöl', 80]],
  };
  return base[p.id] || [['Hauptbestandteil', 100], ['Zweiter Bestandteil', 100], ['Dritter Bestandteil', 80]];
}

// ─────────────────────────────────────────────────────────────
// ProductDetailOrphan — variant for Stufe 1 & 2 NoName products
// that have NO linked brand product (no comparison, no pick).
// ─────────────────────────────────────────────────────────────
function ProductDetailOrphan({ product, onBack, onOpenProduct, onOpenLists }) {
  const p = product;
  const m = MARKETS[p.market] || { name: p.market, tint: COLORS.primary, short: '?' };
  const [tab, setTab] = useStateS('ingredients');
  const [fav, setFav] = useStateS(false);
  const [onList, setOnList] = useStateS(false);
  const [ratings, setRatings] = useStateS(null);
  const RatingsSheet = window.RatingsSheet;
  const stufeColor = COLORS.stufe[p.stufe] || COLORS.primary;
  const stufeTexts = {
    2: { label: 'Günstige Eigenmarke', line: 'Solides Preis-Leistungs-Verhältnis, vergleichbar mit Standardware.' },
    1: { label: 'Einfache Eigenmarke', line: 'Budget-Option mit Basis-Qualität — ideal für den kleinen Geldbeutel.' },
  }[p.stufe] || { label: 'Eigenmarke', line: '—' };
  const unitShort = (p.unit || '').replace(/^[^(]+\(/, '').replace(/\)$/, '');
  const rating = (3.1 + p.stufe * 0.25).toFixed(1);

  // Alternatives: other products not this one
  const alternatives = PRODUCTS.filter(x => x.id !== p.id).slice(0, 4);

  return (
    <div style={{ fontFamily: F, background: 'var(--th-bg)', minHeight: '100%', paddingBottom: 110 }}>
      {/* Header */}
      <div style={{
        padding: '12px 16px 4px', display: 'flex', alignItems: 'center', gap: 10,
        background: 'var(--th-bg)', zIndex: 5, position: 'sticky', top: 0,
      }}>
        <button onClick={onBack} style={{ width: 40, height: 40, borderRadius: 20, background: 'transparent', border: 0, cursor: 'pointer' }}>
          <MdI name="arrow-left" size={22} color={COLORS.text}/>
        </button>
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 8 }}>
          <h1 style={{ font: `800 20px ${F}`, color: COLORS.text, letterSpacing: '-.01em', margin: 0 }}>Produktdetails</h1>
        </div>
        <button style={{ width: 40, height: 40, borderRadius: 20, background: 'transparent', border: 0, cursor: 'pointer' }}>
          <MdI name="magnify" size={22} color={COLORS.muted}/>
        </button>
        <button style={{ width: 40, height: 40, borderRadius: 20, background: 'transparent', border: 0, cursor: 'pointer' }}>
          <MdI name="bell-outline" size={22} color={COLORS.muted}/>
        </button>
      </div>

      {/* Eyebrow + Title */}
      <div style={{ padding: '10px 20px 10px' }}>
        <div style={{ font: `600 11px ${F}`, color: COLORS.muted, letterSpacing: 1.2, textTransform: 'uppercase' }}>
          Eigenmarke · {m.name}
        </div>
        <h1 style={{ font: `800 26px/1.1 ${F}`, color: COLORS.text, margin: '2px 0 0', letterSpacing: '-.02em' }}>
          {p.brand} {p.name}
        </h1>
      </div>

      {/* Hero image with Markt chip + icon actions */}
      <div style={{ padding: '0 20px' }}>
        <div style={{ position: 'relative', borderRadius: 20, overflow: 'hidden' }}>
          <ProductImg product={p} size={240} rounded={0}/>

          {/* Markt chip — top-left */}
          <div style={{
            position: 'absolute', left: 12, top: 12, background: m.tint,
            color: '#fff', padding: '8px 14px', borderRadius: 22,
            display: 'inline-flex', alignItems: 'center', gap: 8,
            font: `700 13px ${F}`, boxShadow: '0 4px 10px rgba(0,0,0,.18)',
          }}>
            <div style={{
              width: 18, height: 18, borderRadius: 5, background: 'rgba(255,255,255,.25)',
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              font: `800 10px ${F}`,
            }}>{m.short}</div>
            Exklusiv bei {m.name}
          </div>

          {/* Price + size — bottom-left */}
          <div style={{
            position: 'absolute', left: 12, bottom: 12,
            background: 'rgba(255,255,255,.95)', backdropFilter: 'blur(8px)',
            padding: '8px 12px', borderRadius: 14,
            boxShadow: '0 2px 8px rgba(0,0,0,.12)',
          }}>
            <div style={{ font: `500 11px ${F}`, color: COLORS.muted }}>
              {p.size}{unitShort ? ` · ${unitShort}` : ''}
            </div>
            <div style={{ font: `800 22px/1 ${F}`, color: COLORS.text, letterSpacing: '-.02em', marginTop: 4 }}>
              {p.brandPrice.toFixed(2).replace('.', ',')}€
            </div>
          </div>

          {/* Icon action cluster — bottom-right */}
          <div style={{
            position: 'absolute', bottom: 12, right: 12,
            display: 'flex', gap: 8,
          }}>
            <button onClick={()=>setFav(v=>!v)} style={{
              width: 48, height: 48, borderRadius: 14, border: `1px solid rgba(25,28,29,.1)`,
              background: 'var(--th-card)', cursor: 'pointer',
              boxShadow: '0 2px 6px rgba(0,0,0,.08)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <MdI name={fav ? 'heart' : 'heart-outline'} size={22} color={fav ? '#e53935' : COLORS.text}/>
            </button>
            <button onClick={()=>setOnList(v=>!v)} style={{
              width: 48, height: 48, borderRadius: 14,
              border: onList ? 0 : `1px solid rgba(25,28,29,.1)`, cursor: 'pointer',
              background: onList ? COLORS.primary : 'var(--th-card)',
              boxShadow: '0 2px 6px rgba(0,0,0,.08)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <MdI name={onList ? 'cart-check' : 'cart-plus'} size={22} color={onList ? '#fff' : COLORS.text}/>
            </button>
            <button onClick={() => setRatings({ key: p.id, label: `${p.brand} ${p.name}`, showSimilarity: false })} style={{
              width: 48, height: 48, borderRadius: 14, border: `1px solid rgba(25,28,29,.1)`,
              background: 'var(--th-card)', cursor: 'pointer',
              boxShadow: '0 2px 6px rgba(0,0,0,.08)',
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
              gap: 0, padding: 0,
            }}>
              <MdI name="star" size={14} color="#f5b301"/>
              <div style={{ font: `800 12px/1 ${F}`, color: COLORS.text, marginTop: 2 }}>{rating}</div>
            </button>
          </div>
        </div>
      </div>

      {/* Info card: Hersteller + Einordnung */}
      <div style={{ margin: '24px 20px 0', background: 'var(--th-card)', borderRadius: 16, padding: 16, boxShadow: SH_SM }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingBottom: 12, borderBottom: '1px solid var(--th-border)' }}>
          <span style={{ font: `500 13px ${F}`, color: COLORS.muted }}>Hersteller</span>
          <span style={{ font: `700 13px ${F}`, color: COLORS.text }}>{p.maker}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 0 0' }}>
          <span style={{ font: `500 13px ${F}`, color: COLORS.muted }}>Kategorie</span>
          <span style={{ font: `700 13px ${F}`, color: COLORS.text }}>{p.category || '—'}</span>
        </div>
      </div>

      {/* Tabs: Inhaltsstoffe / Nährwerte */}
      <div style={{
        margin: '20px 20px 0', padding: 4, borderRadius: 999, background: COLORS.low,
        display: 'flex', gap: 4,
      }}>
        {[['ingredients','Inhaltsstoffe'],['nutrition','Nährwerte']].map(([k,l]) => {
          const on = tab === k;
          return (
            <button key={k} onClick={()=>setTab(k)} style={{
              flex: 1, height: 40, borderRadius: 999, border: 0,
              background: on ? 'var(--th-card)' : 'transparent',
              color: on ? COLORS.text : COLORS.muted,
              font: `700 13px ${F}`, cursor: 'pointer',
              boxShadow: on ? '0 2px 6px rgba(25,28,29,.08)' : 'none',
            }}>{l}</button>
          );
        })}
      </div>

      {/* Single-column info (no comparison) */}
      <div style={{ margin: '18px 20px 0' }}>
        {tab === 'ingredients' ? (
          <div style={{ background: 'var(--th-card)', borderRadius: 14, padding: '6px 16px', boxShadow: SH_SM }}>
            {getOrphanIngredients(p).map(([name, note], i, arr) => (
              <div key={i} style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '12px 0',
                borderBottom: i < arr.length - 1 ? '1px solid var(--th-border)' : 'none',
              }}>
                <span style={{ font: `500 14px ${F}`, color: COLORS.text }}>{name}</span>
                <span style={{ font: `500 12px ${F}`, color: COLORS.muted }}>{note}</span>
              </div>
            ))}
          </div>
        ) : (
          <div style={{ background: 'var(--th-card)', borderRadius: 14, padding: '6px 16px', boxShadow: SH_SM }}>
            {getOrphanNutrition(p).map(([n, v], i, arr) => (
              <div key={n} style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '12px 0',
                borderBottom: i < arr.length - 1 ? '1px solid var(--th-border)' : 'none',
              }}>
                <span style={{ font: `500 13px ${F}`, color: COLORS.text }}>{n}</span>
                <span style={{ font: `700 13px ${F}`, color: COLORS.text }}>{v}</span>
              </div>
            ))}
            <div style={{ font: `500 11px ${F}`, color: COLORS.muted, padding: '8px 0 10px' }}>
              Angaben pro 100 g
            </div>
          </div>
        )}
      </div>

      {/* Detektiv-Einordnung */}
      <div style={{ margin: '20px 20px 0', padding: '14px 16px', borderRadius: 14, background: COLORS.low, display: 'flex', alignItems: 'flex-start', gap: 12 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginTop: 1, alignItems: 'center' }}>
          <div style={{ font: `800 18px/1 ${F}`, color: stufeColor }}>S{p.stufe}</div>
          <div style={{ display: 'flex', gap: 2 }}>
            {[1,2,3,4,5].map(n => (
              <span key={n} style={{
                width: 5, height: 5, borderRadius: 3,
                background: n <= p.stufe ? stufeColor : 'rgba(25,28,29,.15)',
              }}/>
            ))}
          </div>
        </div>
        <span style={{ font: `500 12px/1.5 ${F}`, color: COLORS.textVar, flex: 1 }}>
          <b style={{ color: COLORS.text }}>Stufe {p.stufe} — {stufeTexts.label}:</b> {stufeTexts.line} Kein direktes Markenprodukt zum Vergleich hinterlegt.
        </span>
      </div>

      {/* Gute Alternativen */}
      <div style={{ padding: '28px 20px 0' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 14 }}>
          <h3 style={{ font: `800 20px ${F}`, color: COLORS.text, margin: 0, letterSpacing: '-.01em' }}>Passende Alternativen</h3>
          <button style={{ background: 'transparent', border: 0, color: COLORS.primary, font: `700 13px ${F}`, cursor: 'pointer' }}>
            Alle ansehen
          </button>
        </div>
        <div style={{ display: 'flex', gap: 14, overflowX: 'auto', scrollbarWidth: 'none', paddingBottom: 4 }}>
          {alternatives.map(ap => {
            const best = bestNoName(ap);
            const displayPrice = best ? best.price : ap.brandPrice;
            return (
              <button key={ap.id} onClick={() => onOpenProduct && onOpenProduct(ap)} style={{
                width: 140, flexShrink: 0, background: 'var(--th-card)', borderRadius: 14, padding: 0, overflow: 'hidden',
                border: 0, cursor: 'pointer', textAlign: 'left',
              }}>
                <ProductImg product={ap} size={110} rounded={0}/>
                <div style={{ padding: '10px 10px 12px' }}>
                  <div style={{ font: `600 13px/1.2 ${F}`, color: COLORS.text, minHeight: 32 }}>
                    {ap.brand} {ap.name.split(' ').slice(0,2).join(' ')}
                  </div>
                  <div style={{ font: `700 13px ${F}`, color: COLORS.text, marginTop: 4 }}>
                    {displayPrice.toFixed(2).replace('.', ',')}€
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Ratings sheet */}
      {RatingsSheet && (
        <RatingsSheet
          open={!!ratings}
          onClose={() => setRatings(null)}
          contextLabel={ratings?.label || ''}
          ratingsKey={ratings?.key}
          showSimilarity={!!ratings?.showSimilarity}
        />
      )}
    </div>
  );
}

// Mock ingredient list for orphan products
function getOrphanIngredients(p) {
  const base = {
    'gutbio-apfelmus':       [['Äpfel (99%)', 'aus bio. Anbau'], ['Ascorbinsäure', 'Antioxidans'], ['Vitamin C', 'zugesetzt']],
    'mibell-butterkeks':     [['Weizenmehl', '58%'], ['Zucker', '21%'], ['Butter', '12%'], ['Milchzucker', ''], ['Salz', '']],
    'ja-sonnenblumenol':     [['Sonnenblumenöl', '100%'], ['raffiniert', '']],
  };
  return base[p.id] || [['Hauptbestandteil', ''], ['Zweiter Bestandteil', '']];
}

function getOrphanNutrition(p) {
  const table = {
    'gutbio-apfelmus':       [['Energie','52 kcal'],['Fett','0,2 g'],['Zucker','11 g'],['Ballaststoffe','1,8 g'],['Eiweiß','0,3 g']],
    'mibell-butterkeks':     [['Energie','467 kcal'],['Fett','15 g'],['Zucker','24 g'],['Kohlenhydrate','73 g'],['Eiweiß','7,1 g']],
    'ja-sonnenblumenol':     [['Energie','828 kcal'],['Fett','92 g'],['davon gesättigt','11 g'],['Vitamin E','47 mg']],
  };
  return table[p.id] || [['Energie','—'],['Fett','—'],['Zucker','—'],['Eiweiß','—']];
}

window.ProductDetail = ProductDetail;
