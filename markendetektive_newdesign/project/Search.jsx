// Search.jsx — Stöbern mit Eigenmarken/Marken Tabs + Filter-Rail

const INGREDIENTS = [
  'Bio',
  'Vegan',
  'Vegetarisch',
  'Laktosefrei',
  'Glutenfrei',
  'Ohne Palmöl',
  'Ohne Zuckerzusatz',
  'Fairtrade',
];

function Search({ onOpenProduct, onBack, variant = 'a' }) {
  const [tab, setTab]           = useStateS('eigen'); // 'eigen' | 'marken'
  const [query, setQuery]       = useStateS('');
  const [market, setMarket]     = useStateS('all');
  const [handels, setHandels]   = useStateS('all'); // Handelsmarke (nn.brand)
  const [cat, setCat]           = useStateS('all');
  const [minStufe, setMinStufe] = useStateS(0);
  const [brand, setBrand]       = useStateS('all'); // Originalmarke (marken tab)
  const [ingredients, setIngredients] = useStateS([]); // multi-select
  const [sort, setSort]         = useStateS('name'); // 'name' | 'preis' | 'ersparnis'
  const [sheet, setSheet]       = useStateS(null); // null | 'markt' | 'handels' | 'kategorie' | 'stufe' | 'marke' | 'inhalt' | 'sort'

  // Derived option sets
  const categories    = useMemoS(() => [...new Set(PRODUCTS.map(p => p.category))], []);
  const handelsmarken = useMemoS(() => [...new Set(PRODUCTS.flatMap(p => p.noNames.map(n => n.brand)))].sort(), []);
  const brands        = useMemoS(() => [...new Set(PRODUCTS.map(p => p.brand))].sort(), []);

  const results = useMemoS(() => {
    const q = query.toLowerCase().trim();
    let items;
    if (tab === 'eigen') {
      items = [];
      PRODUCTS.forEach(p => {
        if (p.orphan) {
          // Orphan NoName: show as standalone item (no linked brand product)
          const nn = asOwnNN(p);
          if (market  !== 'all' && nn.market !== market) return;
          if (handels !== 'all' && nn.brand  !== handels) return;
          if (cat     !== 'all' && p.category !== cat) return;
          if (minStufe && nn.stufe < minStufe) return;
          if (q && !(p.brand.toLowerCase().includes(q) || p.name.toLowerCase().includes(q))) return;
          items.push({ product: p, nn });
          return;
        }
        p.noNames.forEach(nn => {
          if (market  !== 'all' && nn.market !== market) return;
          if (handels !== 'all' && nn.brand  !== handels) return;
          if (cat     !== 'all' && p.category !== cat) return;
          if (minStufe && nn.stufe < minStufe) return;
          if (q && !(p.brand.toLowerCase().includes(q) || p.name.toLowerCase().includes(q) || nn.brand.toLowerCase().includes(q))) return;
          items.push({ product: p, nn });
        });
      });
      if (sort === 'preis') items.sort((a,b) => a.nn.price - b.nn.price);
      else                  items.sort((a,b) => a.nn.brand.localeCompare(b.nn.brand));
    } else {
      items = PRODUCTS
        .filter(p => !p.orphan)
        .filter(p => cat   === 'all' || p.category === cat)
        .filter(p => brand === 'all' || p.brand    === brand)
        .filter(p => !q || p.brand.toLowerCase().includes(q) || p.name.toLowerCase().includes(q));
      if (sort === 'preis')  items = [...items].sort((a,b) => a.brandPrice - b.brandPrice);
      else                   items = [...items].sort((a,b) => a.brand.localeCompare(b.brand));
    }
    return items;
  }, [tab, query, market, handels, cat, minStufe, brand, ingredients, sort]);

  // Reset filters when switching tabs (tab-specific filters shouldn't bleed)
  const switchTab = (k) => {
    setTab(k);
    setMarket('all'); setHandels('all'); setMinStufe(0); setBrand('all');
  };

  const resetAll = () => {
    setMarket('all'); setHandels('all'); setCat('all'); setMinStufe(0);
    setBrand('all'); setIngredients([]);
  };

  const toggleIngredient = (x) =>
    setIngredients(ingredients.includes(x) ? ingredients.filter(i => i !== x) : [...ingredients, x]);

  const anyFilter =
    (tab === 'eigen' && (market !== 'all' || handels !== 'all' || minStufe > 0)) ||
    (tab === 'marken' && brand !== 'all') ||
    cat !== 'all' || ingredients.length > 0;

  return (
    <div style={{ fontFamily: F, background: '#F9FAFB', minHeight: '100%', paddingBottom: 110, position: 'relative' }}>
      {/* Eigenmarken / Marken pill toggle */}
      <div style={{
        margin: '12px 20px 0', height: 40, borderRadius: 20, background: '#e9ebec',
        padding: 3, display: 'flex', gap: 3, position: 'relative',
      }}>
        {[['eigen','Eigenmarken'],['marken','Marken']].map(([k,l]) => {
          const on = tab === k;
          return (
            <button key={k} onClick={() => switchTab(k)} style={{
              flex: 1, height: 34, borderRadius: 17, border: 0,
              background: on ? '#fff' : 'transparent',
              color: on ? COLORS.primary : COLORS.muted,
              font: `700 13px ${F}`, cursor: 'pointer',
              boxShadow: on ? '0 2px 6px rgba(25,28,29,.08)' : 'none',
              transition: 'all .2s',
            }}>{l}</button>
          );
        })}
      </div>

      {/* Sticky search + filter rail — glassy backdrop (iOS best practice) */}
      <div style={{
        position: 'sticky', top: 0, zIndex: 10,
        background: 'rgba(249,250,251,.78)',
        WebkitBackdropFilter: 'blur(18px) saturate(180%)',
        backdropFilter: 'blur(18px) saturate(180%)',
        paddingTop: 10,
      }}>
        {/* Search */}
        <div style={{ padding: '0 20px' }}>
          <div style={{
            height: 38, background: 'rgba(255,255,255,.92)', borderRadius: 11,
            display: 'flex', alignItems: 'center', gap: 8, padding: '0 12px',
            border: '1px solid rgba(25,28,29,.06)',
          }}>
            <MdI name="magnify" size={16} color={COLORS.muted}/>
            <input
              placeholder={tab === 'eigen' ? 'Eigenmarken durchsuchen …' : 'Marken oder Hersteller …'}
              value={query}
              onChange={(e)=>setQuery(e.target.value)}
              style={{ flex: 1, border: 0, outline: 0, background: 'transparent', font: `500 14px ${F}`, color: COLORS.text }}/>
            {query && (
              <button onClick={()=>setQuery('')} style={{ background: 'transparent', border: 0, cursor: 'pointer', padding: 0, display:'flex' }}>
                <MdI name="close-circle" size={16} color={COLORS.muted}/>
              </button>
            )}
          </div>
        </div>

        {/* Filter rail — horizontal scrollable chips */}
        <div style={{
          padding: '10px 20px 10px',
          display: 'flex', gap: 6, overflowX: 'auto',
          scrollbarWidth: 'none', msOverflowStyle: 'none',
        }}>
          <style>{`.fr::-webkit-scrollbar{display:none}`}</style>

          {/* Sort — dedicated button, always leftmost */}
          <FilterChip
            icon="swap-vertical"
            label={sort === 'preis' ? 'Preis' : 'A–Z'}
            value={null}
            onClick={() => setSheet('sort')}
            strong={sort !== 'name'}
          />

          {/* Divider */}
          <div style={{ flexShrink: 0, width: 1, background: 'rgba(25,28,29,.1)', margin: '4px 4px' }}/>
          {anyFilter && (
            <FilterChip
              icon="filter-remove-outline"
              label="Zurücksetzen"
              muted
              onClick={resetAll}
            />
          )}

          {tab === 'eigen' ? (
            <>
              <FilterChip
                icon="storefront-outline"
                label="Markt"
                value={market !== 'all' ? MARKETS[market]?.name : null}
                onClick={() => setSheet('markt')}
                onClear={market !== 'all' ? () => setMarket('all') : null}
              />
              <FilterChip
                icon="shape-outline"
                label="Kategorie"
                value={cat !== 'all' ? cat : null}
                onClick={() => setSheet('kategorie')}
                onClear={cat !== 'all' ? () => setCat('all') : null}
              />
              <FilterChip
                icon="star-four-points-outline"
                label="Stufe"
                value={minStufe ? `${minStufe}+` : null}
                onClick={() => setSheet('stufe')}
                onClear={minStufe ? () => setMinStufe(0) : null}
              />
              <FilterChip
                icon="leaf"
                label="Inhaltsstoffe"
                value={ingredients.length ? `${ingredients.length}` : null}
                onClick={() => setSheet('inhalt')}
                onClear={ingredients.length ? () => setIngredients([]) : null}
              />
              <FilterChip
                icon="tag-outline"
                label="Handelsmarke"
                value={handels !== 'all' ? handels : null}
                onClick={() => setSheet('handels')}
                onClear={handels !== 'all' ? () => setHandels('all') : null}
              />
            </>
          ) : (
            <>
              <FilterChip
                icon="bookmark-outline"
                label="Marke"
                value={brand !== 'all' ? brand : null}
                onClick={() => setSheet('marke')}
                onClear={brand !== 'all' ? () => setBrand('all') : null}
              />
              <FilterChip
                icon="shape-outline"
                label="Kategorie"
                value={cat !== 'all' ? cat : null}
                onClick={() => setSheet('kategorie')}
                onClear={cat !== 'all' ? () => setCat('all') : null}
              />
              <FilterChip
                icon="leaf"
                label="Inhaltsstoffe"
                value={ingredients.length ? `${ingredients.length}` : null}
                onClick={() => setSheet('inhalt')}
                onClear={ingredients.length ? () => setIngredients([]) : null}
              />
            </>
          )}
        </div>
      </div>

      {/* Results grid */}
      {results.length === 0 ? (
        <div style={{ padding: '60px 32px', textAlign: 'center' }}>
          <div style={{ fontSize: 54, marginBottom: 12 }}>🔍</div>
          <div style={{ font: `700 16px ${F}`, color: COLORS.text }}>Keine Treffer</div>
          <div style={{ font: `500 13px ${F}`, color: COLORS.muted, marginTop: 6 }}>
            Probier weniger Filter oder einen anderen Tab.
          </div>
        </div>
      ) : tab === 'eigen' ? (
        <div style={{ padding: '0 20px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          {results.map(({ product, nn }) => (
            <ProductCard key={nn.id} product={product} noName={nn} variant="grid" onClick={() => onOpenProduct(product)}/>
          ))}
        </div>
      ) : (
        <div style={{ padding: '0 20px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          {results.map(p => <BrandCard key={p.id} product={p} onClick={() => onOpenProduct(p)}/>)}
        </div>
      )}

      {/* Filter sheet — one per chip */}
      {sheet && (
        <FilterSheet title={sheetTitle(sheet)} onClose={() => setSheet(null)}>
          {sheet === 'sort' && (
            <OptionList
              value={sort}
              onChange={(v) => { setSort(v); setSheet(null); }}
              options={[
                ['name',  'Name (A–Z)'],
                ['preis', 'Preis (aufsteigend)'],
              ]}
            />
          )}
          {sheet === 'markt' && (
            <OptionList
              value={market}
              onChange={(v) => { setMarket(v); setSheet(null); }}
              options={[['all','Alle Märkte'], ...Object.entries(MARKETS).map(([k,v]) => [k, v.name])]}
              renderLeading={(k) => k === 'all'
                ? <div style={{ width: 28, height: 28, borderRadius: 8, background: COLORS.low, display:'flex', alignItems:'center', justifyContent:'center' }}>
                    <MdI name="storefront-outline" size={16} color={COLORS.muted}/>
                  </div>
                : <div style={{
                    width: 28, height: 28, borderRadius: 8, background: MARKETS[k].tint,
                    display:'flex', alignItems:'center', justifyContent:'center',
                    color: '#fff', font: `800 12px ${F}`,
                  }}>{MARKETS[k].short}</div>
              }
            />
          )}
          {sheet === 'handels' && (
            <OptionList
              value={handels}
              onChange={(v) => { setHandels(v); setSheet(null); }}
              options={[['all','Alle Handelsmarken'], ...handelsmarken.map(n => [n, n])]}
            />
          )}
          {sheet === 'kategorie' && (
            <OptionList
              value={cat}
              onChange={(v) => { setCat(v); setSheet(null); }}
              options={[['all','Alle Kategorien'], ...categories.map(c => [c, c])]}
            />
          )}
          {sheet === 'marke' && (
            <OptionList
              value={brand}
              onChange={(v) => { setBrand(v); setSheet(null); }}
              options={[['all','Alle Marken'], ...brands.map(b => [b, b])]}
            />
          )}
          {sheet === 'stufe' && (
            <StufeOptions value={minStufe} onChange={(v) => setMinStufe(v)} onApply={() => setSheet(null)}/>
          )}
          {sheet === 'inhalt' && (
            <IngredientOptions
              selected={ingredients}
              onToggle={toggleIngredient}
              onApply={() => setSheet(null)}
              onReset={() => setIngredients([])}
            />
          )}
        </FilterSheet>
      )}
    </div>
  );
}

// ---- Filter UI primitives ----

function FilterChip({ label, value, onClick, onClear, muted, icon, strong }) {
  const active = !!value || strong;
  const bg =
    muted  ? 'rgba(25,28,29,.06)' :
    active ? COLORS.primary :
             '#fff';
  const fg =
    muted  ? COLORS.muted :
    active ? '#fff' :
             COLORS.text;
  const iconColor =
    muted  ? COLORS.muted :
    active ? '#fff' :
             COLORS.primary;

  return (
    <div style={{
      flexShrink: 0, display: 'inline-flex', alignItems: 'stretch',
      height: 30, borderRadius: 15,
      background: bg,
      border: active || muted ? '1px solid transparent' : '1px solid rgba(25,28,29,.09)',
      color: fg,
      font: `600 12px ${F}`,
      boxShadow: active ? '0 2px 8px rgba(13,133,117,.22)' : '0 1px 2px rgba(25,28,29,.03)',
      overflow: 'hidden',
      transition: 'background .15s ease, box-shadow .15s ease',
    }}>
      <button onClick={onClick} style={{
        padding: onClear ? '0 6px 0 10px' : '0 11px 0 10px',
        display: 'flex', alignItems: 'center', gap: 5,
        background: 'transparent', border: 0, cursor: 'pointer',
        color: 'inherit', font: 'inherit',
      }}>
        {icon && <MdI name={icon} size={14} color={iconColor}/>}
        <span style={{ whiteSpace: 'nowrap' }}>
          {label}
          {value && <span style={{ opacity: .7 }}>: </span>}
          {value && <span style={{ fontWeight: 800 }}>{value}</span>}
        </span>
        {!onClear && !muted && <MdI name="chevron-down" size={12} color={iconColor} style={{ marginLeft: 1 }}/>}
      </button>
      {onClear && (
        <button onClick={(e)=>{ e.stopPropagation(); onClear(); }} style={{
          padding: '0 8px 0 2px',
          background: 'transparent', border: 0, cursor: 'pointer',
          display: 'flex', alignItems: 'center',
          borderLeft: '1px solid rgba(255,255,255,.25)',
          marginLeft: 2,
        }}>
          <MdI name="close" size={12} color="#fff"/>
        </button>
      )}
    </div>
  );
}

function sheetTitle(k) {
  return {
    markt:     'Markt',
    handels:   'Handelsmarke',
    kategorie: 'Kategorie',
    stufe:     'Stufe — mindestens',
    marke:     'Marke',
    inhalt:    'Inhaltsstoffe',
    sort:      'Sortieren',
  }[k] || '';
}

function FilterSheet({ title, onClose, children }) {
  const host = document.getElementById('__sheet_host');
  const node = (
    <div onClick={onClose} style={{
      position: 'absolute', inset: 0,
      background: 'rgba(25,28,29,.35)', display: 'flex', alignItems: 'flex-end',
      pointerEvents: 'auto',
      animation: 'md-fade .2s ease',
    }}>
      <style>{`@keyframes md-fade{from{opacity:0}to{opacity:1}}@keyframes md-slideup{from{transform:translateY(100%)}to{transform:translateY(0)}}`}</style>
      <div onClick={(e)=>e.stopPropagation()} style={{
        width: '100%', background: COLORS.surface, borderRadius: '22px 22px 0 0',
        padding: '10px 20px 28px', maxHeight: '78%', overflowY: 'auto',
        animation: 'md-slideup .26s cubic-bezier(.2,.9,.2,1)',
        boxShadow: '0 -12px 40px rgba(0,0,0,.18)',
      }}>
        <div style={{ width: 36, height: 4, borderRadius: 2, background: '#d6d8da', margin: '4px auto 14px' }}/>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <div style={{ font: `800 18px ${F}`, color: COLORS.text }}>{title}</div>
          <button onClick={onClose} style={{ background: 'transparent', border: 0, cursor: 'pointer', padding: 4, display: 'flex' }}>
            <MdI name="close" size={20} color={COLORS.muted}/>
          </button>
        </div>
        {children}
      </div>
    </div>
  );
  return host ? ReactDOM.createPortal(node, host) : node;
}

function OptionList({ value, onChange, options, renderLeading }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {options.map(([k, l], i) => {
        const on = value === k;
        const last = i === options.length - 1;
        return (
          <button key={k} onClick={() => onChange(k)} style={{
            height: 54, background: 'transparent', border: 0, cursor: 'pointer',
            display: 'flex', alignItems: 'center', gap: 12,
            padding: '0 4px', textAlign: 'left',
            borderBottom: last ? 'none' : '1px solid rgba(25,28,29,.06)',
          }}>
            {renderLeading ? renderLeading(k) : null}
            <span style={{ flex: 1, font: `${on ? 700 : 500} 15px ${F}`, color: on ? COLORS.primary : COLORS.text }}>{l}</span>
            {on
              ? <MdI name="check-circle" size={22} color={COLORS.primary}/>
              : <div style={{ width: 22, height: 22, borderRadius: 11, border: '1.5px solid rgba(25,28,29,.18)' }}/>
            }
          </button>
        );
      })}
    </div>
  );
}

function StufeOptions({ value, onChange, onApply }) {
  return (
    <>
      <div style={{ font: `500 13px ${F}`, color: COLORS.muted, marginBottom: 14 }}>
        Zeige nur Eigenmarken ab dieser Ähnlichkeitsstufe.
      </div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 22 }}>
        {[0,1,2,3,4,5].map(n => {
          const on = value === n;
          return (
            <button key={n} onClick={() => onChange(n)} style={{
              flex: 1, height: 52, borderRadius: 12, border: 0, cursor: 'pointer',
              background: on
                ? (n === 0 ? COLORS.text : COLORS.stufe[n])
                : COLORS.card,
              color: on
                ? (n === 3 ? COLORS.text : '#fff')
                : COLORS.text,
              font: `800 16px ${F}`, boxShadow: SH_SM,
            }}>{n === 0 ? '—' : n}</button>
          );
        })}
      </div>
      <PrimaryButton full onClick={onApply}>Anwenden</PrimaryButton>
    </>
  );
}

function IngredientOptions({ selected, onToggle, onApply, onReset }) {
  return (
    <>
      <div style={{ font: `500 13px ${F}`, color: COLORS.muted, marginBottom: 14 }}>
        Mehrfachauswahl möglich.
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 20 }}>
        {INGREDIENTS.map(x => {
          const on = selected.includes(x);
          return (
            <button key={x} onClick={() => onToggle(x)} style={{
              height: 38, padding: '0 14px', borderRadius: 19,
              background: on ? COLORS.primary : '#fff',
              color:      on ? '#fff' : COLORS.text,
              border: on ? '1px solid transparent' : '1px solid rgba(25,28,29,.12)',
              font: `600 13px ${F}`, cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: 6,
            }}>
              {on && <MdI name="check" size={14} color="#fff"/>}
              {x}
            </button>
          );
        })}
      </div>
      <div style={{ display: 'flex', gap: 10 }}>
        <button onClick={onReset} style={{
          flex: 1, height: 48, borderRadius: 12, border: 0, background: COLORS.card,
          font: `700 14px ${F}`, color: COLORS.text, cursor: 'pointer', boxShadow: SH_SM,
        }}>Zurücksetzen</button>
        <PrimaryButton full onClick={onApply}>Anwenden</PrimaryButton>
      </div>
    </>
  );
}

// Brand card — variant for Marken tab
function BrandCard({ product, onClick }) {
  const nnCount = product.noNames.length;
  const best = bestNoName(product);
  const saved = savings(product, best);
  return (
    <button onClick={onClick} style={{
      width: '100%', background: '#fff', borderRadius: 16, overflow: 'hidden',
      border: 0, padding: 0,
      textAlign: 'left', cursor: 'pointer', fontFamily: F, display: 'block',
    }}>
      <div style={{ position: 'relative' }}>
        <ProductImg product={product} size={180} rounded={0}/>
        {nnCount > 0 && (
          <div style={{
            position: 'absolute', top: 10, right: 10, background: COLORS.primary,
            color: '#fff', padding: '4px 9px', borderRadius: 9,
            font: `800 10px ${F}`, letterSpacing: '.06em', textTransform: 'uppercase',
          }}>
            {nnCount} Alt.
          </div>
        )}
      </div>
      <div style={{ padding: '12px 12px 14px' }}>
        <div style={{ font: `700 10px ${F}`, color: COLORS.muted, letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 4 }}>
          {product.brand.toUpperCase()}
        </div>
        <div style={{ font: `600 15px/1.25 ${F}`, color: COLORS.text, minHeight: 36 }}>
          {product.name}
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginTop: 6, gap: 8 }}>
          <span style={{ font: `700 16px ${F}`, color: COLORS.text }}>
            {product.brandPrice.toFixed(2).replace('.',',')}€
          </span>
          <span style={{ font: `700 12px ${F}`, color: COLORS.primary }}>
            −{saved.toFixed(2).replace('.', ',')}€
          </span>
        </div>
      </div>
    </button>
  );
}
window.Search = Search;
