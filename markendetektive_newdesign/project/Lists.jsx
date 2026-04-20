// Lists.jsx — Einkaufszettel (shopping list) + Einkaufshistorie.
// Depends on globals: MdI, COLORS, F, PRODUCTS, MARKETS, PROFILE
//
// Features:
//  1. Tabs Marken / NoNames with live counts + savings banner
//  2. Default NoName-alt = user's favorite market (PROFILE.markets[0]…) else first
//  3. Swipe right  → als gekauft (moves to history, list item fades + strikethrough)
//     Swipe left   → löschen (list item shrinks out)
//  4. CTA "Alle als gekauft markieren" animates each row staggered, moves all to history
//  5. Einkaufshistorie: persisted in localStorage md-shopping-history
//  6. Manual add via + button (freetext + icon picker)
//  7. Filter FAB (Stufe, Markt, nur offen, nur mit Ersparnis)

const LIST_F = 'Nunito, -apple-system, sans-serif';
const LIST_C = {
  text: '#191c1d',
  muted: '#6b7175',
  primary: '#0d8575',
  primaryDark: '#0a6f62',
  danger: '#ef4444',
};

const LIST_HIST_KEY = 'md-shopping-history';
const LIST_STATE_KEY = 'md-shopping-list-state-v2';

// ——— History helpers ———
function loadHistory() {
  try {
    const raw = localStorage.getItem(LIST_HIST_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  // seed
  const seed = [
    { id: 'h1', ts: Date.now() - 1*3600e3, name: 'Milbona Milchreis Klassik', brand: 'Milbona', market: 'lidl', qty: 2, price: 0.49, savedEach: 0.75, kind: 'noname', noNameId: 'milbona-mr' },
    { id: 'h2', ts: Date.now() - 1*3600e3, name: 'Fin Carré Alpenvoll',        brand: 'Fin Carré', market: 'lidl', qty: 1, price: 0.89, savedEach: 0.60, kind: 'noname', noNameId: 'fc-alpen' },
    { id: 'h3', ts: Date.now() - 1*3600e3, name: 'Brötchen',                   brand: null,       market: null,   qty: 4, price: 0,    savedEach: 0,    kind: 'manual', icon: 'baguette' },
    { id: 'h4', ts: Date.now() - 26*3600e3, name: 'FreeWay Cola 1,5 L',        brand: 'FreeWay',   market: 'lidl', qty: 6, price: 0.49, savedEach: 0.94, kind: 'noname', noNameId: 'fw-15' },
    { id: 'h5', ts: Date.now() - 26*3600e3, name: 'Moreno Caffè Crema',        brand: 'Moreno',    market: 'aldi', qty: 1, price: 3.99, savedEach: 4.00, kind: 'noname', noNameId: 'moreno-cc' },
    { id: 'h6', ts: Date.now() - 50*3600e3, name: 'Milbona Haferdrink',        brand: 'Milbona',   market: 'lidl', qty: 1, price: 1.15, savedEach: 0.54, kind: 'noname', noNameId: 'milbona-haf' },
  ];
  try { localStorage.setItem(LIST_HIST_KEY, JSON.stringify(seed)); } catch {}
  return seed;
}
function appendHistory(entries) {
  const h = loadHistory();
  const next = [...entries, ...h];
  try { localStorage.setItem(LIST_HIST_KEY, JSON.stringify(next)); } catch {}
  return next;
}

// ——— Data lookup ———
const findProduct = (id) => window.PRODUCTS?.find(p => p.id === id);
const findNoNameAny = (id) => {
  for (const p of window.PRODUCTS || []) {
    const nn = p.noNames.find(n => n.id === id);
    if (nn) return { product: p, noName: nn };
  }
  return null;
};

// Pick default alt for a brand item based on user favorite markets
function pickDefaultAlt(product) {
  if (!product?.noNames?.length) return null;
  const favs = window.PROFILE?.markets || [];
  for (const fav of favs) {
    const hit = product.noNames.find(nn => nn.market === fav);
    if (hit) return hit.id;
  }
  return product.noNames[0].id;
}

// Seed items
const LIST_SEED = {
  brands: [
    { id: 'b1', productId: 'mueller-milchreis', qty: 1 },
    { id: 'b2', productId: 'milka-alpenmilch',  qty: 2 },
    { id: 'b3', productId: 'frischkaese',       qty: 1 },
    { id: 'b4', productId: 'nutella-400',       qty: 1 },
  ],
  noNames: [
    { id: 'n1', noNameId: 'milbona-mr', qty: 1 },
    { id: 'n2', noNameId: 'fc-alpen',   qty: 2 },
    { id: 'n3', noNameId: 'nk-400',     qty: 1 },
    { id: 'n4', noNameId: 'fw-15',      qty: 6 },
    { id: 'n5', noNameId: 'frischer-lidl', qty: 1 },
    { id: 'n6', noNameId: 'milbona-haf', qty: 1 },
    { id: 'n7', manual: true, name: 'Brötchen', icon: 'baguette', qty: 4 },
  ],
};
function loadListState() {
  try {
    const raw = localStorage.getItem(LIST_STATE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return LIST_SEED;
}
function saveListState(state) {
  try { localStorage.setItem(LIST_STATE_KEY, JSON.stringify(state)); } catch {}
}

const MANUAL_ICONS = [
  'baguette','food-apple-outline','fruit-grapes-outline','bottle-soda-outline',
  'cheese','egg-outline','food-steak','fish','rice','pasta',
  'carrot','bread-slice-outline','coffee-outline','tea-outline',
  'cupcake','ice-cream','candy-outline','cookie-outline',
  'spray-bottle','lotion-outline','toilet','toothbrush-paste',
  'dog-side','cat','flower-outline','pill','bandage',
];

// ================================================================
// ShoppingList — main screen
// ================================================================
function ShoppingList({ onBack, onOpenHistory }) {
  const [tab, setTab] = React.useState('brands');
  const initial = loadListState();
  const [brands, setBrands] = React.useState(initial.brands || []);
  const [noNames, setNoNames] = React.useState(initial.noNames || []);
  const [expanded, setExpanded] = React.useState({});
  const [selectedAlt, setSelectedAlt] = React.useState({}); // brandId→noNameId
  const [leaving, setLeaving] = React.useState({});         // itemId→'bought'|'deleted'
  const [filterOpen, setFilterOpen] = React.useState(false);
  const [addOpen, setAddOpen] = React.useState(false);

  const [bFilter, setBFilter] = React.useState({ onlyUnchecked: false, onlyWithSavings: false });
  const [nFilter, setNFilter] = React.useState({ stufe: 'any', market: 'any' });

  // Persist on every change
  React.useEffect(() => { saveListState({ brands, noNames }); }, [brands, noNames]);

  // Pre-fill default alt selection when brands list changes (respecting Lieblingsmarkt)
  React.useEffect(() => {
    setSelectedAlt(prev => {
      const next = { ...prev };
      brands.forEach(b => {
        if (next[b.id] === undefined) {
          const p = findProduct(b.productId);
          next[b.id] = pickDefaultAlt(p);
        }
      });
      return next;
    });
  }, [brands]);

  // Filtered lists
  const filteredBrands = brands.filter(it => {
    const p = findProduct(it.productId);
    if (!p) return false;
    if (bFilter.onlyWithSavings && !p.noNames?.length) return false;
    return true;
  });
  const filteredNoNames = noNames.filter(it => {
    if (it.manual) return nFilter.stufe === 'any' && nFilter.market === 'any';
    const hit = findNoNameAny(it.noNameId);
    if (!hit) return false;
    if (nFilter.stufe !== 'any' && hit.noName.stufe !== Number(nFilter.stufe)) return false;
    if (nFilter.market !== 'any' && hit.noName.market !== nFilter.market) return false;
    return true;
  });

  // Savings
  const savingsPotential = brands.reduce((s, it) => {
    const p = findProduct(it.productId);
    if (!p || !p.noNames?.length) return s;
    const altId = selectedAlt[it.id];
    const alt = p.noNames.find(n => n.id === altId) || p.noNames[0];
    return s + (p.brandPrice - alt.price) * it.qty;
  }, 0);
  const savingsEarned = noNames.reduce((s, it) => {
    if (it.manual) return s;
    const hit = findNoNameAny(it.noNameId);
    if (!hit) return s;
    return s + (hit.product.brandPrice - hit.noName.price) * it.qty;
  }, 0);

  const pendingConvert = Object.keys(selectedAlt).filter(k => selectedAlt[k] && brands.some(b => b.id === k));

  // Actions
  const setQty = (arr, setArr, id, dq) =>
    setArr(arr.map(it => it.id === id ? { ...it, qty: Math.max(1, it.qty + dq) } : it));

  const markBought = (kind, id) => {
    // Find the item and record to history
    const arr = kind === 'brand' ? brands : noNames;
    const it = arr.find(x => x.id === id);
    if (!it) return;
    let entry = null;
    if (kind === 'brand') {
      const p = findProduct(it.productId);
      const altId = selectedAlt[id];
      const alt = p?.noNames?.find(n => n.id === altId) || p?.noNames?.[0];
      if (alt) {
        entry = {
          id: 'h' + Date.now() + id, ts: Date.now(),
          name: `${alt.brand} ${alt.name}`, brand: alt.brand,
          market: alt.market, qty: it.qty, price: alt.price,
          savedEach: p.brandPrice - alt.price,
          kind: 'noname', noNameId: alt.id,
        };
      } else if (p) {
        entry = {
          id: 'h' + Date.now() + id, ts: Date.now(),
          name: `${p.brand} ${p.name}`, brand: p.brand,
          market: null, qty: it.qty, price: p.brandPrice, savedEach: 0,
          kind: 'brand', productId: p.id,
        };
      }
    } else if (it.manual) {
      entry = { id: 'h' + Date.now() + id, ts: Date.now(), name: it.name, brand: null, market: null, qty: it.qty, price: 0, savedEach: 0, kind: 'manual', icon: it.icon };
    } else {
      const hit = findNoNameAny(it.noNameId);
      if (hit) entry = {
        id: 'h' + Date.now() + id, ts: Date.now(),
        name: `${hit.noName.brand} ${hit.noName.name}`, brand: hit.noName.brand,
        market: hit.noName.market, qty: it.qty, price: hit.noName.price,
        savedEach: hit.product.brandPrice - hit.noName.price,
        kind: 'noname', noNameId: hit.noName.id,
      };
    }
    if (entry) appendHistory([entry]);

    // Start animation
    setLeaving(prev => ({ ...prev, [id]: 'bought' }));
    setTimeout(() => {
      if (kind === 'brand') setBrands(prev => prev.filter(x => x.id !== id));
      else                  setNoNames(prev => prev.filter(x => x.id !== id));
      setLeaving(prev => { const n = { ...prev }; delete n[id]; return n; });
    }, 700);
  };

  const deleteItem = (kind, id) => {
    setLeaving(prev => ({ ...prev, [id]: 'deleted' }));
    setTimeout(() => {
      if (kind === 'brand') setBrands(prev => prev.filter(x => x.id !== id));
      else                  setNoNames(prev => prev.filter(x => x.id !== id));
      setLeaving(prev => { const n = { ...prev }; delete n[id]; return n; });
    }, 350);
  };

  const markAllBought = () => {
    const ids = noNames.map(n => n.id);
    ids.forEach((id, i) => {
      setTimeout(() => markBought('noname', id), i * 120);
    });
  };

  const convertBulk = () => {
    const ids = pendingConvert;
    if (!ids.length) return;
    const newItems = [];
    ids.forEach(brandId => {
      const b = brands.find(x => x.id === brandId);
      const altId = selectedAlt[brandId];
      if (!b || !altId) return;
      newItems.push({ id: 'n' + Date.now() + brandId, noNameId: altId, qty: b.qty });
    });
    setNoNames(prev => [...prev, ...newItems]);
    setBrands(prev => prev.filter(x => !ids.includes(x.id)));
    setSelectedAlt({});
    setTab('nonames');
  };

  return (
    <div style={{
      position: 'absolute', inset: 0, background: '#F4F5F7',
      display: 'flex', flexDirection: 'column', overflow: 'hidden',
      fontFamily: LIST_F,
    }}>
      {/* Header — App-Standard */}
      <div style={{
        position: 'sticky', top: 0, zIndex: 10, background: '#F9FAFB',
        padding: '18px 20px 10px', display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0,
      }}>
        <button onClick={onBack} style={{
          width: 40, height: 40, borderRadius: 20, cursor: 'pointer',
          background: 'transparent', border: 0, marginLeft: -8,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <MdI name="arrow-left" size={22} color={LIST_C.primary}/>
        </button>
        <h1 style={{
          flex: 1, margin: 0, letterSpacing: '-.02em',
          font: `800 22px ${LIST_F}`, color: LIST_C.text,
          minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>Einkaufszettel</h1>
        <button onClick={onOpenHistory} title="Historie" style={{
          width: 40, height: 40, borderRadius: 20, cursor: 'pointer',
          background: 'transparent', border: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <MdI name="history" size={22} color={LIST_C.muted}/>
        </button>
        <button onClick={() => setAddOpen(true)} title="Hinzufügen" style={{
          width: 40, height: 40, borderRadius: 20, cursor: 'pointer',
          background: 'transparent', border: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <MdI name="plus" size={24} color={LIST_C.primary}/>
        </button>
      </div>

      {/* Tabs */}
      <div style={{ background: '#fff', display: 'flex', flexShrink: 0, boxShadow: '0 1px 0 rgba(25,28,29,.06)' }}>
        {[
          { k: 'brands',  l: 'Marken',  n: brands.length },
          { k: 'nonames', l: 'NoNames', n: noNames.length },
        ].map(t => {
          const on = tab === t.k;
          return (
            <button key={t.k} onClick={() => setTab(t.k)} style={{
              flex: 1, background: 'transparent', border: 0, cursor: 'pointer',
              padding: '14px 0 10px', position: 'relative',
              font: `700 15px ${LIST_F}`, color: on ? LIST_C.primary : LIST_C.muted,
            }}>
              {t.l} ({t.n})
              <div style={{
                position: 'absolute', left: '25%', right: '25%', bottom: 0,
                height: 3, background: on ? LIST_C.primary : 'transparent', borderRadius: 2,
              }}/>
            </button>
          );
        })}
      </div>

      {/* Banner */}
      <div style={{
        background: tab === 'brands'
          ? 'linear-gradient(90deg,#f59332,#f57a23)'
          : 'linear-gradient(90deg,#0d8575,#10a18a)',
        color: '#fff', padding: '12px 16px',
        display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0,
      }}>
        <div style={{ flex: 1 }}>
          <div style={{ font: `800 15px ${LIST_F}`, display: 'flex', alignItems: 'center', gap: 6 }}>
            {tab === 'brands' ? 'Dein Sparpotenzial' : 'Einkaufszettel Ersparnis'}
            <MdI name="information-outline" size={14} color="rgba(255,255,255,.85)"/>
          </div>
          <div style={{ font: `500 11px ${LIST_F}`, opacity: .92, marginTop: 2 }}>
            {tab === 'brands' ? 'Mit aktuell gewählten NoName-Alternativen' : 'Durch gewählte NoName-Produkte'}
          </div>
        </div>
        <div style={{
          background: 'rgba(255,255,255,.18)', borderRadius: 20,
          padding: '6px 12px', display: 'flex', alignItems: 'center', gap: 6,
          font: `800 16px ${LIST_F}`,
        }}>
          <MdI name="tag-outline" size={16} color="#fff"/>
          −{(tab === 'brands' ? savingsPotential : savingsEarned).toFixed(2).replace('.', ',')} €
        </div>
      </div>

      {/* Scrollable body */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '10px 12px 140px', position: 'relative' }}>
        {tab === 'brands' ? (
          filteredBrands.length === 0 ? <EmptyState kind="brands"/> :
          filteredBrands.map(it => (
            <SwipeRow
              key={it.id}
              leaving={leaving[it.id]}
              onSwipeBought={() => markBought('brand', it.id)}
              onSwipeDelete={() => deleteItem('brand', it.id)}
            >
              <BrandRow
                item={it}
                expanded={!!expanded[it.id]}
                onToggleExpand={() => setExpanded(e => ({ ...e, [it.id]: !e[it.id] }))}
                onMarkBought={() => markBought('brand', it.id)}
                onDelete={() => deleteItem('brand', it.id)}
                onQty={(d) => setQty(brands, setBrands, it.id, d)}
                selectedAlt={selectedAlt[it.id]}
                setSelectedAlt={(id) => setSelectedAlt(prev => ({ ...prev, [it.id]: id }))}
                leaving={leaving[it.id]}
              />
            </SwipeRow>
          ))
        ) : (
          filteredNoNames.length === 0 ? <EmptyState kind="nonames"/> :
          filteredNoNames.map(it => (
            <SwipeRow
              key={it.id}
              leaving={leaving[it.id]}
              onSwipeBought={() => markBought('noname', it.id)}
              onSwipeDelete={() => deleteItem('noname', it.id)}
            >
              <NoNameRow
                item={it}
                onMarkBought={() => markBought('noname', it.id)}
                onDelete={() => deleteItem('noname', it.id)}
                onQty={(d) => setQty(noNames, setNoNames, it.id, d)}
                leaving={leaving[it.id]}
              />
            </SwipeRow>
          ))
        )}

        <div style={{
          font: `500 11px ${LIST_F}`, color: LIST_C.muted, textAlign: 'center', padding: '8px 6px',
        }}>
          Tipp: Nach rechts wischen = gekauft · Nach links wischen = löschen
        </div>
      </div>

      {/* Filter FAB */}
      <button onClick={() => setFilterOpen(true)} style={{
        position: 'absolute', right: 18, bottom: 96, zIndex: 5,
        width: 48, height: 48, borderRadius: 24, border: 0, cursor: 'pointer',
        background: LIST_C.primary, color: '#fff',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        boxShadow: '0 6px 16px rgba(13,133,117,.35)',
      }}>
        <MdI name="filter-variant" size={22} color="#fff"/>
      </button>

      {/* Bottom action */}
      <div style={{
        position: 'absolute', bottom: 0, left: 0, right: 0, zIndex: 6,
        padding: '12px 16px 18px',
        background: 'linear-gradient(to top, #F4F5F7 75%, rgba(244,245,247,0))',
      }}>
        {tab === 'brands' ? (
          <button
            disabled={pendingConvert.length === 0}
            onClick={convertBulk}
            style={{
              width: '100%', height: 48, borderRadius: 12, border: 0,
              cursor: pendingConvert.length ? 'pointer' : 'not-allowed',
              background: pendingConvert.length ? LIST_C.primary : '#cfd3d6', color: '#fff',
              font: `800 15px ${LIST_F}`,
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            }}>
            <MdI name="swap-horizontal" size={18} color="#fff"/>
            {pendingConvert.length === 0
              ? 'Alternative wählen zum Umwandeln'
              : `${pendingConvert.length} Produkt${pendingConvert.length > 1 ? 'e' : ''} umwandeln`}
          </button>
        ) : (
          <button
            disabled={noNames.length === 0}
            onClick={markAllBought}
            style={{
              width: '100%', height: 48, borderRadius: 12, border: 0,
              cursor: noNames.length ? 'pointer' : 'not-allowed',
              background: noNames.length ? LIST_C.primary : '#cfd3d6', color: '#fff',
              font: `800 15px ${LIST_F}`,
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            }}>
            <MdI name="check-circle" size={18} color="#fff"/>
            Alle als gekauft markieren
          </button>
        )}
      </div>

      {filterOpen && (
        <ListsFilterSheet
          tab={tab}
          bFilter={bFilter} setBFilter={setBFilter}
          nFilter={nFilter} setNFilter={setNFilter}
          onClose={() => setFilterOpen(false)}
        />
      )}
      {addOpen && (
        <AddItemSheet
          onClose={() => setAddOpen(false)}
          onAddManual={(name, icon) => {
            setNoNames(prev => [{ id: 'n' + Date.now(), manual: true, name, icon, qty: 1 }, ...prev]);
            setTab('nonames');
            setAddOpen(false);
          }}
        />
      )}
    </div>
  );
}

// ================================================================
// SwipeRow — wraps a row with swipe gestures
// ================================================================
function SwipeRow({ children, onSwipeBought, onSwipeDelete, leaving }) {
  const [dx, setDx] = React.useState(0);
  const [anim, setAnim] = React.useState(false);
  const startX = React.useRef(0);
  const active = React.useRef(false);

  const THRESH = 90;

  const onDown = (e) => {
    if (leaving) return;
    active.current = true;
    startX.current = (e.touches?.[0]?.clientX ?? e.clientX);
    setAnim(false);
  };
  const onMove = (e) => {
    if (!active.current) return;
    const x = (e.touches?.[0]?.clientX ?? e.clientX);
    setDx(x - startX.current);
  };
  const onUp = () => {
    if (!active.current) return;
    active.current = false;
    const d = dx;
    setAnim(true);
    if (d >= THRESH) {
      // bought — fling right
      setDx(500);
      setTimeout(() => { onSwipeBought?.(); setDx(0); setAnim(false); }, 220);
    } else if (d <= -THRESH) {
      setDx(-500);
      setTimeout(() => { onSwipeDelete?.(); setDx(0); setAnim(false); }, 220);
    } else {
      setDx(0);
      setTimeout(() => setAnim(false), 220);
    }
  };

  // Backgrounds revealed behind the row
  const showBought = dx > 8;
  const showDelete = dx < -8;

  // Leaving animation
  const leavingStyle = leaving ? {
    maxHeight: 0, marginTop: 0, marginBottom: 0, paddingTop: 0, paddingBottom: 0,
    opacity: 0, transform: 'scale(.96)',
    transition: 'max-height .45s ease, margin .45s ease, opacity .45s ease, transform .45s ease',
    overflow: 'hidden',
  } : {};

  return (
    <div style={{
      position: 'relative', marginBottom: 10,
      maxHeight: 600, transition: anim ? 'transform .22s ease' : 'none',
      ...leavingStyle,
    }}>
      {/* Action backgrounds */}
      <div style={{
        position: 'absolute', inset: 0, borderRadius: 14, overflow: 'hidden',
        display: 'flex', alignItems: 'stretch', pointerEvents: 'none',
      }}>
        <div style={{
          flex: 1, background: LIST_C.primary,
          opacity: showBought ? 1 : 0,
          display: 'flex', alignItems: 'center', paddingLeft: 18, gap: 10,
          transition: 'opacity .15s',
        }}>
          <MdI name="check-circle" size={26} color="#fff"/>
          <span style={{ font: `800 14px ${LIST_F}`, color: '#fff' }}>Als gekauft markieren</span>
        </div>
        <div style={{
          flex: 1, background: LIST_C.danger,
          opacity: showDelete ? 1 : 0,
          display: 'flex', alignItems: 'center', justifyContent: 'flex-end', paddingRight: 18, gap: 10,
          transition: 'opacity .15s',
        }}>
          <span style={{ font: `800 14px ${LIST_F}`, color: '#fff' }}>Löschen</span>
          <MdI name="delete-outline" size={26} color="#fff"/>
        </div>
      </div>

      {/* Foreground row (draggable) */}
      <div
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        style={{
          transform: `translateX(${dx}px)`,
          transition: anim ? 'transform .22s ease' : 'none',
          touchAction: 'pan-y',
          cursor: 'grab',
        }}>
        {children}
      </div>
    </div>
  );
}

// ================================================================
// BrandRow
// ================================================================
function BrandRow({ item, expanded, onToggleExpand, onMarkBought, onDelete, onQty, selectedAlt, setSelectedAlt, leaving }) {
  const p = findProduct(item.productId);
  if (!p) return null;
  const selectedNN = p.noNames?.find(n => n.id === selectedAlt);
  const best = p.noNames?.[0];
  const altForSavings = selectedNN || best;
  const potential = altForSavings ? (p.brandPrice - altForSavings.price) * item.qty : 0;
  const market = selectedNN && window.MARKETS?.[selectedNN.market];
  const strike = leaving === 'bought';

  return (
    <div style={{
      background: '#fff', borderRadius: 14, overflow: 'hidden',
      border: '1px solid rgba(25,28,29,.06)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 10, position: 'relative' }}>
        <div style={{
          width: 62, height: 62, borderRadius: 10, flexShrink: 0,
          background: `linear-gradient(135deg,${p.tint[0]},${p.tint[1]})`,
          display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 30,
        }}>{p.emoji}</div>
        <div style={{ flex: 1, minWidth: 0, textDecoration: strike ? 'line-through' : 'none', opacity: strike ? .55 : 1, transition: 'opacity .3s, text-decoration .3s' }}>
          <div style={{ font: `700 11px ${LIST_F}`, color: LIST_C.primary, marginBottom: 1 }}>
            {p.brand}
          </div>
          <div style={{ font: `800 14px ${LIST_F}`, color: LIST_C.text, lineHeight: 1.2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {p.name}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
            <span style={{ font: `800 13px ${LIST_F}`, color: LIST_C.text }}>
              €{p.brandPrice.toFixed(2).replace('.', ',')}
            </span>
            {selectedNN && (
              <span style={{ font: `700 11px ${LIST_F}`, color: LIST_C.primary }}>
                → €{selectedNN.price.toFixed(2).replace('.', ',')}
              </span>
            )}
          </div>
          {altForSavings && (
            <div style={{ font: `600 10px ${LIST_F}`, color: LIST_C.primary, marginTop: 2, display: 'flex', alignItems: 'center', gap: 4 }}>
              <MdI name="tag-outline" size={11} color={LIST_C.primary}/>
              Ersparnis: €{potential.toFixed(2).replace('.', ',')}
              {market && (
                <span style={{
                  font: `800 8px ${LIST_F}`, color: '#fff', background: market.tint,
                  padding: '1px 4px', borderRadius: 3, marginLeft: 4,
                }}>{market.name.toUpperCase()}</span>
              )}
              {window.PROFILE?.markets?.includes(selectedNN?.market) && (
                <MdI name="heart" size={10} color="#ef4444"/>
              )}
            </div>
          )}
        </div>
        {p.noNames?.length > 0 && (
          <button onClick={onToggleExpand} style={{
            width: 28, height: 28, borderRadius: 14, border: 0, background: 'transparent', cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <MdI name={expanded ? 'chevron-up' : 'chevron-down'} size={20} color={LIST_C.muted}/>
          </button>
        )}
        <button onClick={onMarkBought} style={{
          width: 34, height: 34, borderRadius: 17, border: 0, cursor: 'pointer',
          background: LIST_C.primary, color: '#fff',
          display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
        }}>
          <MdI name="check" size={18} color="#fff"/>
        </button>
        <button onClick={onDelete} style={{
          width: 34, height: 34, borderRadius: 17, border: 0, cursor: 'pointer',
          background: LIST_C.danger, color: '#fff',
          display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
        }}>
          <MdI name="delete-outline" size={18} color="#fff"/>
        </button>
      </div>

      <div style={{ padding: '0 12px 10px', display: 'flex', alignItems: 'center', gap: 8 }}>
        <QtyStepper qty={item.qty} onDec={() => onQty(-1)} onInc={() => onQty(1)}/>
      </div>

      {expanded && p.noNames?.length > 0 && (
        <div style={{ background: '#fafafa', padding: '4px 10px 12px', borderTop: '1px solid rgba(25,28,29,.06)' }}>
          <div style={{ font: `700 12px ${LIST_F}`, color: LIST_C.text, padding: '10px 2px 6px', display: 'flex', alignItems: 'center', gap: 6 }}>
            NoName-Alternative wählen:
            <span style={{ font: `500 10px ${LIST_F}`, color: LIST_C.muted }}>
              Lieblingsmarkt wird bevorzugt
            </span>
          </div>
          {p.noNames.map(nn => {
            const isSel = selectedAlt === nn.id;
            const isFav = window.PROFILE?.markets?.includes(nn.market);
            const s = (p.brandPrice - nn.price) * item.qty;
            const pct = Math.round(((p.brandPrice - nn.price) / p.brandPrice) * 100);
            const m = window.MARKETS?.[nn.market];
            return (
              <div key={nn.id} onClick={() => setSelectedAlt(nn.id)} style={{
                background: '#fff', borderRadius: 10, padding: 8, marginBottom: 6,
                border: `2px solid ${isSel ? LIST_C.primary : 'transparent'}`,
                display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', position: 'relative',
              }}>
                {isFav && (
                  <div style={{
                    position: 'absolute', top: -6, right: 8, background: '#ef4444',
                    font: `800 8px ${LIST_F}`, color: '#fff', padding: '2px 6px',
                    borderRadius: 4, display: 'flex', alignItems: 'center', gap: 2,
                  }}>
                    <MdI name="heart" size={8} color="#fff"/>
                    LIEBLING
                  </div>
                )}
                <div style={{
                  width: 44, height: 44, borderRadius: 8, flexShrink: 0,
                  background: `linear-gradient(135deg,${p.tint[0]},${p.tint[1]})`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22,
                }}>{p.emoji}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ font: `700 12px ${LIST_F}`, color: LIST_C.text, lineHeight: 1.2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {nn.brand} – {nn.name}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 2 }}>
                    {m && (
                      <span style={{
                        font: `800 8px ${LIST_F}`, color: '#fff', background: m.tint,
                        padding: '1px 4px', borderRadius: 3,
                      }}>{m.name.toUpperCase()}</span>
                    )}
                    <span style={{ font: `500 10px ${LIST_F}`, color: LIST_C.muted }}>(DE)</span>
                    <span style={{ font: `700 10px ${LIST_F}`, color: LIST_C.primary, marginLeft: 4 }}>
                      ★ Stufe {nn.stufe}
                    </span>
                  </div>
                </div>
                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                  <div style={{ font: `800 11px ${LIST_F}`, color: LIST_C.primary }}>
                    −€{s.toFixed(2).replace('.', ',')}
                  </div>
                  <div style={{ font: `800 12px ${LIST_F}`, color: LIST_C.text }}>
                    €{nn.price.toFixed(2).replace('.', ',')}
                  </div>
                  <div style={{ font: `600 10px ${LIST_F}`, color: LIST_C.muted }}>−{pct}%</div>
                </div>
                <div style={{
                  width: 28, height: 28, borderRadius: 14, flexShrink: 0,
                  background: isSel ? LIST_C.primary : 'transparent',
                  border: isSel ? 'none' : `2px solid ${LIST_C.muted}`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  {isSel && <MdI name="check" size={16} color="#fff"/>}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ================================================================
// NoNameRow (+ manual)
// ================================================================
function NoNameRow({ item, onMarkBought, onDelete, onQty, leaving }) {
  const strike = leaving === 'bought';

  if (item.manual) {
    return (
      <div style={{
        background: '#fff', borderRadius: 14, padding: 10,
        border: '1px solid rgba(25,28,29,.06)', display: 'flex', alignItems: 'center', gap: 10,
      }}>
        <div style={{
          width: 62, height: 62, borderRadius: 10, flexShrink: 0,
          background: 'rgba(13,133,117,.1)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <MdI name={item.icon || 'shopping-outline'} size={28} color={LIST_C.primary}/>
        </div>
        <div style={{ flex: 1, minWidth: 0, textDecoration: strike ? 'line-through' : 'none', opacity: strike ? .55 : 1, transition: 'opacity .3s, text-decoration .3s' }}>
          <div style={{ font: `700 11px ${LIST_F}`, color: LIST_C.muted, marginBottom: 1 }}>
            Manuell hinzugefügt
          </div>
          <div style={{ font: `800 14px ${LIST_F}`, color: LIST_C.text, lineHeight: 1.2 }}>
            {item.name}
          </div>
          <div style={{ marginTop: 6 }}>
            <QtyStepper qty={item.qty} onDec={() => onQty(-1)} onInc={() => onQty(1)}/>
          </div>
        </div>
        <RowActions onMarkBought={onMarkBought} onDelete={onDelete}/>
      </div>
    );
  }

  const hit = findNoNameAny(item.noNameId);
  if (!hit) return null;
  const { product: p, noName: nn } = hit;
  const m = window.MARKETS?.[nn.market];
  const s = (p.brandPrice - nn.price) * item.qty;
  const isFav = window.PROFILE?.markets?.includes(nn.market);

  return (
    <div style={{
      background: '#fff', borderRadius: 14, padding: 10,
      border: '1px solid rgba(25,28,29,.06)', display: 'flex', alignItems: 'center', gap: 10,
    }}>
      <div style={{
        width: 62, height: 62, borderRadius: 10, flexShrink: 0,
        background: `linear-gradient(135deg,${p.tint[0]},${p.tint[1]})`,
        display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 30,
      }}>{p.emoji}</div>
      <div style={{ flex: 1, minWidth: 0, textDecoration: strike ? 'line-through' : 'none', opacity: strike ? .55 : 1, transition: 'opacity .3s, text-decoration .3s' }}>
        <div style={{ font: `700 11px ${LIST_F}`, color: LIST_C.primary, marginBottom: 1, display: 'flex', alignItems: 'center', gap: 4 }}>
          {nn.brand}
          {isFav && <MdI name="heart" size={10} color="#ef4444"/>}
        </div>
        <div style={{ font: `800 14px ${LIST_F}`, color: LIST_C.text, lineHeight: 1.2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {nn.name}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 2 }}>
          {m && (
            <span style={{
              font: `800 8px ${LIST_F}`, color: '#fff', background: m.tint,
              padding: '1px 4px', borderRadius: 3,
            }}>{m.name.toUpperCase()}</span>
          )}
          <span style={{ font: `500 10px ${LIST_F}`, color: LIST_C.muted }}>(DE) · Stufe {nn.stufe}</span>
        </div>
        <div style={{ font: `800 13px ${LIST_F}`, color: LIST_C.text, marginTop: 2 }}>
          €{nn.price.toFixed(2).replace('.', ',')}
          <span style={{ font: `600 11px ${LIST_F}`, color: LIST_C.primary, marginLeft: 6 }}>
            (−€{s.toFixed(2).replace('.', ',')})
          </span>
        </div>
        <div style={{ marginTop: 6 }}>
          <QtyStepper qty={item.qty} onDec={() => onQty(-1)} onInc={() => onQty(1)}/>
        </div>
      </div>
      <RowActions onMarkBought={onMarkBought} onDelete={onDelete}/>
    </div>
  );
}

function RowActions({ onMarkBought, onDelete }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flexShrink: 0 }}>
      <button onClick={onMarkBought} style={{
        width: 34, height: 34, borderRadius: 17, border: 0, cursor: 'pointer',
        background: LIST_C.primary, color: '#fff',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <MdI name="check" size={18} color="#fff"/>
      </button>
      <button onClick={onDelete} style={{
        width: 34, height: 34, borderRadius: 17, border: 0, cursor: 'pointer',
        background: LIST_C.danger, color: '#fff',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <MdI name="delete-outline" size={18} color="#fff"/>
      </button>
    </div>
  );
}

function QtyStepper({ qty, onDec, onInc }) {
  return (
    <div
      onPointerDown={e => e.stopPropagation()}
      style={{
      display: 'inline-flex', alignItems: 'center',
      background: '#f0f2f3', borderRadius: 18, padding: 2, gap: 2,
    }}>
      <button onClick={onDec} style={{
        width: 28, height: 28, borderRadius: 14, border: 0, background: '#fff', cursor: 'pointer',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <MdI name="minus" size={16} color={LIST_C.text}/>
      </button>
      <span style={{ minWidth: 26, textAlign: 'center', font: `800 13px ${LIST_F}`, color: LIST_C.text }}>
        {qty}
      </span>
      <button onClick={onInc} style={{
        width: 28, height: 28, borderRadius: 14, border: 0, background: '#fff', cursor: 'pointer',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <MdI name="plus" size={16} color={LIST_C.text}/>
      </button>
    </div>
  );
}

function EmptyState({ kind }) {
  return (
    <div style={{ padding: '40px 20px', textAlign: 'center', color: LIST_C.muted }}>
      <MdI name={kind === 'brands' ? 'tag-multiple-outline' : 'cart-outline'} size={42} color={LIST_C.muted}/>
      <div style={{ font: `800 14px ${LIST_F}`, color: LIST_C.text, marginTop: 8 }}>
        Nichts zu sehen
      </div>
      <div style={{ font: `500 12px ${LIST_F}`, marginTop: 4 }}>
        Keine Einträge – tippe + oben, um etwas hinzuzufügen.
      </div>
    </div>
  );
}

// ================================================================
// Filter sheet
// ================================================================
function ListsFilterSheet({ tab, bFilter, setBFilter, nFilter, setNFilter, onClose }) {
  return (
    <div onClick={onClose} style={{
      position: 'absolute', inset: 0, zIndex: 20,
      background: 'rgba(0,0,0,.45)', display: 'flex', alignItems: 'flex-end',
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        background: '#fff', width: '100%', borderTopLeftRadius: 18, borderTopRightRadius: 18,
        padding: '8px 0 100px', maxHeight: '85%', overflowY: 'auto',
      }}>
        <div style={{ width: 40, height: 4, background: '#dcdfe2', borderRadius: 2, margin: '8px auto 10px' }}/>
        <div style={{ padding: '0 18px 8px', display: 'flex', alignItems: 'center' }}>
          <h3 style={{ margin: 0, font: `800 17px ${LIST_F}`, color: LIST_C.text }}>
            Filter · {tab === 'brands' ? 'Marken' : 'NoNames'}
          </h3>
          <button onClick={onClose} style={{
            marginLeft: 'auto', background: 'transparent', border: 0, cursor: 'pointer', padding: 6,
          }}>
            <MdI name="close" size={22} color={LIST_C.muted}/>
          </button>
        </div>

        {tab === 'brands' ? (
          <div style={{ padding: '4px 18px' }}>
            <ToggleRow label="Nur mit NoName-Alternative" on={bFilter.onlyWithSavings}
              onChange={(v) => setBFilter(f => ({ ...f, onlyWithSavings: v }))}/>
            <button onClick={() => setBFilter({ onlyUnchecked: false, onlyWithSavings: false })}
              style={{
                marginTop: 10, background: 'transparent', color: LIST_C.primary,
                border: `1px solid ${LIST_C.primary}`, borderRadius: 10,
                padding: '10px 14px', font: `700 13px ${LIST_F}`, cursor: 'pointer', width: '100%',
              }}>Filter zurücksetzen</button>
          </div>
        ) : (
          <div style={{ padding: '4px 18px' }}>
            <div style={{ font: `700 12px ${LIST_F}`, color: LIST_C.muted, textTransform: 'uppercase', letterSpacing: 1, margin: '8px 0 6px' }}>
              Markenqualität-Stufe
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {[{v:'any',l:'Alle'},{v:'5',l:'★ 5'},{v:'4',l:'★ 4'},{v:'3',l:'★ 3'},{v:'2',l:'★ 2'},{v:'1',l:'★ 1'}].map(o => {
                const on = String(nFilter.stufe) === o.v;
                return (
                  <button key={o.v} onClick={() => setNFilter(f => ({ ...f, stufe: o.v }))}
                    style={{
                      padding: '8px 12px', borderRadius: 18,
                      background: on ? LIST_C.primary : '#f0f2f3',
                      color: on ? '#fff' : LIST_C.text,
                      border: 0, cursor: 'pointer', font: `700 12px ${LIST_F}`,
                    }}>{o.l}</button>
                );
              })}
            </div>

            <div style={{ font: `700 12px ${LIST_F}`, color: LIST_C.muted, textTransform: 'uppercase', letterSpacing: 1, margin: '16px 0 6px' }}>
              Markt
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {[{ v: 'any', name: 'Alle' }, ...Object.entries(window.MARKETS || {}).map(([k, v]) => ({ v: k, name: v.name, tint: v.tint }))].map(o => {
                const on = nFilter.market === o.v;
                const isFav = window.PROFILE?.markets?.includes(o.v);
                return (
                  <button key={o.v} onClick={() => setNFilter(f => ({ ...f, market: o.v }))}
                    style={{
                      padding: '8px 12px', borderRadius: 18,
                      background: on ? (o.tint || LIST_C.primary) : '#f0f2f3',
                      color: on ? '#fff' : LIST_C.text,
                      border: 0, cursor: 'pointer', font: `700 12px ${LIST_F}`,
                      display: 'inline-flex', alignItems: 'center', gap: 4,
                    }}>
                    {o.name}
                    {isFav && <MdI name="heart" size={10} color={on ? '#fff' : '#ef4444'}/>}
                  </button>
                );
              })}
            </div>

            <button onClick={() => setNFilter({ stufe: 'any', market: 'any' })}
              style={{
                marginTop: 14, background: 'transparent', color: LIST_C.primary,
                border: `1px solid ${LIST_C.primary}`, borderRadius: 10,
                padding: '10px 14px', font: `700 13px ${LIST_F}`, cursor: 'pointer', width: '100%',
              }}>Filter zurücksetzen</button>
          </div>
        )}
      </div>
    </div>
  );
}

function ToggleRow({ label, on, onChange }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', padding: '10px 0', borderBottom: '1px solid rgba(25,28,29,.06)' }}>
      <span style={{ flex: 1, font: `600 14px ${LIST_F}`, color: LIST_C.text }}>{label}</span>
      <button onClick={() => onChange(!on)} style={{
        width: 42, height: 24, borderRadius: 12, border: 0, cursor: 'pointer',
        background: on ? LIST_C.primary : '#d0d4d7', position: 'relative',
        transition: 'background .15s',
      }}>
        <div style={{
          position: 'absolute', top: 2, left: on ? 20 : 2,
          width: 20, height: 20, borderRadius: 10, background: '#fff',
          transition: 'left .15s',
        }}/>
      </button>
    </div>
  );
}

// ================================================================
// Add item sheet
// ================================================================
function AddItemSheet({ onClose, onAddManual }) {
  const [name, setName] = React.useState('');
  const [icon, setIcon] = React.useState(MANUAL_ICONS[0]);
  return (
    <div onClick={onClose} style={{
      position: 'absolute', inset: 0, zIndex: 25,
      background: 'rgba(0,0,0,.45)', display: 'flex', alignItems: 'flex-end',
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        background: '#fff', width: '100%', borderTopLeftRadius: 18, borderTopRightRadius: 18,
        padding: '8px 0 18px', maxHeight: '90%', overflowY: 'auto',
      }}>
        <div style={{ width: 40, height: 4, background: '#dcdfe2', borderRadius: 2, margin: '8px auto 12px' }}/>
        <div style={{ padding: '0 18px 10px', display: 'flex', alignItems: 'center' }}>
          <h3 style={{ margin: 0, font: `800 17px ${LIST_F}`, color: LIST_C.text }}>
            Eintrag hinzufügen
          </h3>
          <button onClick={onClose} style={{
            marginLeft: 'auto', background: 'transparent', border: 0, cursor: 'pointer', padding: 6,
          }}>
            <MdI name="close" size={22} color={LIST_C.muted}/>
          </button>
        </div>
        <div style={{ padding: '4px 18px 0' }}>
          <div style={{ font: `700 12px ${LIST_F}`, color: LIST_C.muted, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>
            Bezeichnung
          </div>
          <input
            autoFocus value={name} onChange={e => setName(e.target.value)}
            placeholder="z. B. Brötchen, Milch, Kaugummi…"
            style={{
              width: '100%', border: '1px solid rgba(25,28,29,.12)', borderRadius: 10,
              padding: '12px 12px', font: `600 14px ${LIST_F}`, color: LIST_C.text,
              outline: 'none', background: '#fafafa',
            }}/>
          <div style={{ font: `700 12px ${LIST_F}`, color: LIST_C.muted, textTransform: 'uppercase', letterSpacing: 1, margin: '16px 0 6px' }}>
            Icon wählen
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 6 }}>
            {MANUAL_ICONS.map(i => {
              const on = icon === i;
              return (
                <button key={i} onClick={() => setIcon(i)} style={{
                  aspectRatio: '1 / 1', borderRadius: 10, cursor: 'pointer',
                  background: on ? LIST_C.primary : '#f0f2f3',
                  border: on ? 'none' : '1px solid rgba(25,28,29,.06)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <MdI name={i} size={22} color={on ? '#fff' : LIST_C.text}/>
                </button>
              );
            })}
          </div>
        </div>
        <div style={{ padding: '18px 18px 0', display: 'flex', gap: 8 }}>
          <button onClick={onClose} style={{
            flex: 1, height: 44, borderRadius: 10, cursor: 'pointer',
            background: 'transparent', color: LIST_C.text,
            border: '1px solid rgba(25,28,29,.12)', font: `700 13px ${LIST_F}`,
          }}>Abbrechen</button>
          <button disabled={!name.trim()} onClick={() => onAddManual(name.trim(), icon)}
            style={{
              flex: 2, height: 44, borderRadius: 10, border: 0,
              cursor: name.trim() ? 'pointer' : 'not-allowed',
              background: name.trim() ? LIST_C.primary : '#cfd3d6', color: '#fff',
              font: `800 13px ${LIST_F}`,
            }}>Hinzufügen</button>
        </div>
      </div>
    </div>
  );
}

// ================================================================
// ShoppingHistory — Einkaufshistorie (page accessed from Profile)
// ================================================================
function ShoppingHistory({ onBack }) {
  const [history, setHistory] = React.useState(() => loadHistory());

  // Group by day label
  const groups = React.useMemo(() => {
    const now = new Date();
    const map = new Map();
    history.forEach(h => {
      const d = new Date(h.ts);
      const sameDay = d.toDateString() === now.toDateString();
      const y = new Date(now); y.setDate(now.getDate() - 1);
      const sameYest = d.toDateString() === y.toDateString();
      let label;
      if (sameDay) label = 'Heute';
      else if (sameYest) label = 'Gestern';
      else label = d.toLocaleDateString('de-DE', { weekday: 'long', day: '2-digit', month: '2-digit' });
      if (!map.has(label)) map.set(label, []);
      map.get(label).push(h);
    });
    return [...map.entries()];
  }, [history]);

  const totalSaved = history.reduce((s, h) => s + h.savedEach * h.qty, 0);
  const totalItems = history.reduce((s, h) => s + h.qty, 0);

  const clear = () => {
    if (!confirm('Einkaufshistorie komplett löschen?')) return;
    try { localStorage.removeItem(LIST_HIST_KEY); } catch {}
    setHistory([]);
  };

  return (
    <div style={{
      position: 'absolute', inset: 0, background: '#F4F5F7',
      display: 'flex', flexDirection: 'column', overflow: 'hidden',
      fontFamily: LIST_F,
    }}>
      <div style={{
        position: 'sticky', top: 0, zIndex: 10, background: '#F9FAFB',
        padding: '18px 20px 10px', display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0,
      }}>
        <button onClick={onBack} style={{
          width: 40, height: 40, borderRadius: 20, cursor: 'pointer',
          background: 'transparent', border: 0, marginLeft: -8,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <MdI name="arrow-left" size={22} color={LIST_C.primary}/>
        </button>
        <h1 style={{
          flex: 1, margin: 0, letterSpacing: '-.02em',
          font: `800 22px ${LIST_F}`, color: LIST_C.text,
          minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>Einkaufshistorie</h1>
        <button onClick={clear} disabled={history.length === 0} title="Alle löschen" style={{
          width: 40, height: 40, borderRadius: 20, cursor: history.length ? 'pointer' : 'default',
          background: 'transparent', border: 0, opacity: history.length ? 1 : .3,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <MdI name="delete-sweep-outline" size={22} color={LIST_C.muted}/>
        </button>
      </div>

      {/* Stats banner */}
      <div style={{
        background: 'linear-gradient(90deg,#0d8575,#10a18a)',
        color: '#fff', padding: '14px 16px', display: 'flex', gap: 10, flexShrink: 0,
      }}>
        <div style={{ flex: 1 }}>
          <div style={{ font: `800 15px ${LIST_F}` }}>Gesamt gespart</div>
          <div style={{ font: `500 11px ${LIST_F}`, opacity: .92, marginTop: 2 }}>
            {totalItems} Produkte · {history.length} Einträge
          </div>
        </div>
        <div style={{
          background: 'rgba(255,255,255,.2)', borderRadius: 20,
          padding: '6px 12px', font: `800 16px ${LIST_F}`,
          display: 'flex', alignItems: 'center', gap: 6,
        }}>
          <MdI name="piggy-bank-outline" size={16} color="#fff"/>
          −{totalSaved.toFixed(2).replace('.', ',')} €
        </div>
      </div>

      {/* List */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '10px 12px 20px' }}>
        {history.length === 0 ? (
          <div style={{ padding: '40px 20px', textAlign: 'center', color: LIST_C.muted }}>
            <MdI name="history" size={42} color={LIST_C.muted}/>
            <div style={{ font: `800 14px ${LIST_F}`, color: LIST_C.text, marginTop: 8 }}>
              Noch keine gekauften Einträge
            </div>
            <div style={{ font: `500 12px ${LIST_F}`, marginTop: 4 }}>
              Sobald du etwas aus deinem Einkaufszettel als gekauft markierst, taucht es hier auf.
            </div>
          </div>
        ) : groups.map(([label, items]) => {
          const daySaved = items.reduce((s, h) => s + h.savedEach * h.qty, 0);
          return (
            <div key={label} style={{ marginBottom: 14 }}>
              <div style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '6px 4px 8px',
              }}>
                <div style={{ font: `800 12px ${LIST_F}`, color: LIST_C.text, textTransform: 'uppercase', letterSpacing: 1 }}>
                  {label}
                </div>
                <div style={{ flex: 1, height: 1, background: 'rgba(25,28,29,.1)' }}/>
                <div style={{ font: `700 12px ${LIST_F}`, color: LIST_C.primary }}>
                  −{daySaved.toFixed(2).replace('.', ',')} €
                </div>
              </div>
              {items.map(h => <HistoryRow key={h.id} h={h}/>)}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function HistoryRow({ h }) {
  const hit = h.kind === 'noname' && h.noNameId ? findNoNameAny(h.noNameId) : null;
  const p = hit?.product || (h.kind === 'brand' && h.productId ? findProduct(h.productId) : null);
  const m = h.market && window.MARKETS?.[h.market];
  const time = new Date(h.ts).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });

  const visual = h.kind === 'manual' ? (
    <div style={{
      width: 52, height: 52, borderRadius: 10, flexShrink: 0,
      background: 'rgba(13,133,117,.1)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <MdI name={h.icon || 'shopping-outline'} size={24} color={LIST_C.primary}/>
    </div>
  ) : p ? (
    <div style={{
      width: 52, height: 52, borderRadius: 10, flexShrink: 0,
      background: `linear-gradient(135deg,${p.tint[0]},${p.tint[1]})`,
      display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 26,
    }}>{p.emoji}</div>
  ) : (
    <div style={{
      width: 52, height: 52, borderRadius: 10, flexShrink: 0, background: '#e6e8ea',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <MdI name="cart-outline" size={22} color={LIST_C.muted}/>
    </div>
  );

  return (
    <div style={{
      background: '#fff', borderRadius: 12, padding: 10, marginBottom: 8,
      border: '1px solid rgba(25,28,29,.06)', display: 'flex', alignItems: 'center', gap: 10,
    }}>
      {visual}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ font: `800 13px ${LIST_F}`, color: LIST_C.text, lineHeight: 1.2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {h.name}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 3 }}>
          {m && (
            <span style={{
              font: `800 8px ${LIST_F}`, color: '#fff', background: m.tint,
              padding: '1px 4px', borderRadius: 3,
            }}>{m.name.toUpperCase()}</span>
          )}
          <span style={{ font: `500 11px ${LIST_F}`, color: LIST_C.muted }}>
            {time} · {h.qty}×
          </span>
        </div>
      </div>
      <div style={{ textAlign: 'right' }}>
        {h.price > 0 && (
          <div style={{ font: `800 13px ${LIST_F}`, color: LIST_C.text }}>
            €{(h.price * h.qty).toFixed(2).replace('.', ',')}
          </div>
        )}
        {h.savedEach > 0 && (
          <div style={{ font: `700 11px ${LIST_F}`, color: LIST_C.primary }}>
            −€{(h.savedEach * h.qty).toFixed(2).replace('.', ',')}
          </div>
        )}
        {h.kind === 'manual' && (
          <div style={{ font: `500 10px ${LIST_F}`, color: LIST_C.muted }}>manuell</div>
        )}
      </div>
    </div>
  );
}

// ================================================================
// CartFab — floating button to open shopping list
// ================================================================
function CartFab({ onClick, bottom = 94, right = 16 }) {
  // Count live list items for badge
  const [count, setCount] = React.useState(() => {
    try {
      const raw = localStorage.getItem(LIST_STATE_KEY);
      if (raw) {
        const s = JSON.parse(raw);
        return (s.brands?.length || 0) + (s.noNames?.length || 0);
      }
    } catch {}
    return (LIST_SEED.brands.length + LIST_SEED.noNames.length);
  });
  React.useEffect(() => {
    const tick = () => {
      try {
        const raw = localStorage.getItem(LIST_STATE_KEY);
        if (raw) {
          const s = JSON.parse(raw);
          setCount((s.brands?.length || 0) + (s.noNames?.length || 0));
        }
      } catch {}
    };
    const id = setInterval(tick, 800);
    return () => clearInterval(id);
  }, []);
  return (
    <button onClick={onClick} aria-label="Einkaufszettel" style={{
      width: 56, height: 56, borderRadius: 28, border: 0, cursor: 'pointer', position: 'relative',
      background: LIST_C.primary, color: '#fff',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      boxShadow: '0 10px 24px rgba(13,133,117,.4), 0 2px 4px rgba(0,0,0,.1)',
    }}>
      <MdI name="cart-outline" size={26} color="#fff"/>
      {count > 0 && (
        <span style={{
          position: 'absolute', top: -4, right: -4, minWidth: 22, height: 22,
          borderRadius: 11, background: '#ef4444', color: '#fff',
          font: `800 11px ${LIST_F}`, padding: '0 6px',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          border: '2px solid #F9FAFB',
        }}>{count}</span>
      )}
    </button>
  );
}

Object.assign(window, { ShoppingList, ShoppingHistory, CartFab });
