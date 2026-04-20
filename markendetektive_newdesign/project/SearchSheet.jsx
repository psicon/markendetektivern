// SearchSheet.jsx — bottom search modal triggered from Home
// Shows: search input, recent queries as dismissable pills, Top NoName grid.

const SS_F = window.F;
const SS_C = window.COLORS;

const SS_RECENTS_KEY = 'md-recent-searches';
const SS_DEFAULT_RECENTS = ['Mini biscuits', 'Badeherz', 'Joghurt', 'Schokolade', 'Haferdrink'];

function loadRecents() {
  try {
    const s = localStorage.getItem(SS_RECENTS_KEY);
    if (s) return JSON.parse(s);
  } catch {}
  return SS_DEFAULT_RECENTS.slice(0, 4);
}
function saveRecents(arr) {
  try { localStorage.setItem(SS_RECENTS_KEY, JSON.stringify(arr.slice(0, 8))); } catch {}
}

// Top NoName picks — curated picks from product data, synthesized into "NoName cards"
function getTopNoNames() {
  const out = [];
  (window.PRODUCTS || []).forEach(p => {
    if (p.orphan) {
      out.push({
        id: p.id, product: p, brand: p.brand, name: p.name,
        category: p.category, rating: 5.0, reviewCount: 4 + Math.floor(Math.random() * 8),
      });
    } else {
      (p.noNames || []).filter(nn => nn.stufe === 5).slice(0, 1).forEach(nn => {
        out.push({
          id: nn.id, product: p, noName: nn, brand: nn.brand, name: nn.name,
          category: p.category, rating: 5.0, reviewCount: 3 + Math.floor(Math.random() * 10),
        });
      });
    }
  });
  return out.slice(0, 6);
}

// Inject keyframes to document head once
if (typeof document !== 'undefined' && !document.getElementById('ss-keyframes')) {
  const st = document.createElement('style');
  st.id = 'ss-keyframes';
  st.textContent = `
    @keyframes ss-fade{from{opacity:0}to{opacity:1}}
    @keyframes ss-slideup{from{transform:translateY(100%)}to{transform:translateY(0)}}
  `;
  document.head.appendChild(st);
}

function SearchSheet({ open, onClose, onOpenProduct, onSubmitSearch }) {
  const [query, setQuery] = React.useState('');
  const [recents, setRecents] = React.useState(loadRecents);
  const inputRef = React.useRef(null);

  React.useEffect(() => {
    if (open) {
      setQuery('');
      setRecents(loadRecents());
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [open]);

  const topNN = React.useMemo(() => getTopNoNames(), []);

  if (!open) return null;
  const host = document.getElementById('__sheet_host');

  const submit = (q) => {
    const v = (q ?? query).trim();
    if (!v) return;
    const next = [v, ...recents.filter(r => r.toLowerCase() !== v.toLowerCase())].slice(0, 8);
    setRecents(next);
    saveRecents(next);
    if (onSubmitSearch) onSubmitSearch(v);
    else onClose();
  };

  const removeRecent = (v) => {
    const next = recents.filter(r => r !== v);
    setRecents(next);
    saveRecents(next);
  };

  const clearRecents = () => {
    setRecents([]);
    saveRecents([]);
  };

  const node = (
    <div onClick={onClose} style={{
      position: 'absolute', inset: 0, zIndex: 30,
      background: 'rgba(25,28,29,.35)', display: 'flex', alignItems: 'flex-end',
      pointerEvents: 'auto',
    }}>
      <div onClick={(e)=>e.stopPropagation()} style={{
        width: '100%', background: '#F9FAFB',
        /* Height chosen so the sheet's search row lines up exactly with Home's search bar */
        height: 'calc(100% - 98px)',
        borderRadius: '22px 22px 0 0',
        display: 'flex', flexDirection: 'column',
        animation: 'ss-slideup .26s cubic-bezier(.2,.9,.2,1) both',
        boxShadow: '0 -12px 40px rgba(0,0,0,.18)',
      }}>
        {/* Drag handle */}
        <div style={{ width: 36, height: 4, borderRadius: 2, background: '#d6d8da', margin: '4px auto 12px', flexShrink: 0 }}/>

        {/* Search row — aligned with Home's search bar position */}
        <div style={{ padding: '4px 20px 14px', display: 'flex', gap: 10, alignItems: 'center', flexShrink: 0 }}>
          <div style={{
            flex: 1, display: 'flex', alignItems: 'center', gap: 10,
            background: '#fff', borderRadius: 24, border: `1px solid rgba(25,28,29,.1)`,
            padding: '0 14px', height: 48,
          }}>
            <window.MdI name="magnify" size={18} color={SS_C.muted}/>
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e)=>setQuery(e.target.value)}
              onKeyDown={(e)=>{ if (e.key === 'Enter') submit(); }}
              placeholder="Produkte suchen …"
              style={{
                flex: 1, border: 0, outline: 0, background: 'transparent',
                font: `500 15px ${SS_F}`, color: SS_C.text,
                minWidth: 0,
              }}
            />
            {query && (
              <button onClick={()=>setQuery('')} style={{
                background: 'transparent', border: 0, cursor: 'pointer', padding: 4, display: 'flex',
              }}>
                <window.MdI name="close-circle" size={18} color={SS_C.muted}/>
              </button>
            )}
          </div>
          <button onClick={()=>submit()} style={{
            width: 48, height: 48, borderRadius: 24, border: 0, cursor: 'pointer',
            background: query.trim() ? SS_C.primary : 'rgba(13,133,117,.12)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            transition: 'background .15s',
          }}>
            <window.MdI name="magnify" size={22} color={query.trim() ? '#fff' : SS_C.primary}/>
          </button>
        </div>

        {/* Body scroll */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '0 20px 100px' }}>
          {/* Recents */}
          {recents.length > 0 && (
            <div style={{ marginBottom: 18 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                <h3 style={{ margin: 0, font: `800 16px ${SS_F}`, color: SS_C.text, letterSpacing: '-.01em' }}>
                  Zuletzt gesucht
                </h3>
                <button onClick={clearRecents} style={{
                  background: 'transparent', border: 0, cursor: 'pointer',
                  color: SS_C.primary, font: `700 13px ${SS_F}`,
                }}>Löschen</button>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {recents.map(r => (
                  <div key={r} style={{
                    display: 'inline-flex', alignItems: 'center', gap: 6,
                    background: '#fff', borderRadius: 20,
                    border: `1px solid rgba(25,28,29,.1)`,
                    padding: '6px 4px 6px 12px',
                    font: `500 13px ${SS_F}`, color: SS_C.text,
                  }}>
                    <window.MdI name="history" size={14} color={SS_C.muted}/>
                    <button onClick={()=>submit(r)} style={{
                      background: 'transparent', border: 0, cursor: 'pointer',
                      padding: 0, font: 'inherit', color: 'inherit',
                    }}>{r}</button>
                    <button onClick={()=>removeRecent(r)} style={{
                      background: 'transparent', border: 0, cursor: 'pointer',
                      padding: 2, display: 'flex',
                    }}>
                      <window.MdI name="close-circle" size={16} color={SS_C.muted}/>
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Top NoName-Produkte */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
              <h3 style={{ margin: 0, font: `800 16px ${SS_F}`, color: SS_C.text, letterSpacing: '-.01em' }}>
                Top NoName-Produkte
              </h3>
              <div style={{
                display: 'inline-flex', alignItems: 'center', gap: 4,
                background: '#fef4cc', borderRadius: 12,
                padding: '4px 10px', font: `800 11px ${SS_F}`, color: '#7a5a00',
              }}>
                <window.MdI name="star" size={12} color="#f5b301"/>
                Top Rated
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              {topNN.map(it => (
                <button key={it.id} onClick={()=>{ onOpenProduct(it.product); onClose(); }} style={{
                  background: '#fff', borderRadius: 14, padding: 10,
                  border: `1px solid rgba(25,28,29,.06)`,
                  cursor: 'pointer', textAlign: 'left',
                  display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0,
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                    <div style={{ width: 44, height: 44, borderRadius: 10, overflow: 'hidden', flexShrink: 0 }}>
                      <window.ProductImg product={it.product} size={44} rounded={0}/>
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{
                        font: `700 13px/1.2 ${SS_F}`, color: SS_C.text,
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      }}>{it.brand}</div>
                      <div style={{
                        font: `500 11px ${SS_F}`, color: SS_C.muted, marginTop: 2,
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      }}>{it.name}</div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <window.MdI name="star" size={12} color="#f5b301"/>
                    <span style={{ font: `800 12px/1 ${SS_F}`, color: SS_C.text }}>{it.rating.toFixed(1)}</span>
                    <span style={{ font: `500 11px ${SS_F}`, color: SS_C.muted }}>({it.reviewCount})</span>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  return host ? ReactDOM.createPortal(node, host) : node;
}

window.SearchSheet = SearchSheet;
