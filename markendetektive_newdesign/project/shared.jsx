// shared.jsx — shared primitives specific to this prototype (extends components.jsx)
const { useState: useStateS, useEffect: useEffectS, useRef: useRefS, useMemo: useMemoS } = React;

// Market pill — used wherever a market is shown
function MarketPill({ marketId, size = 'md' }) {
  const m = MARKETS[marketId];
  if (!m) return null;
  const h = size === 'sm' ? 18 : size === 'lg' ? 26 : 22;
  const fs = size === 'sm' ? 10 : size === 'lg' ? 13 : 11;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5,
      height: h, padding: '0 8px', borderRadius: h / 2,
      background: m.tint, color: '#fff',
      font: `700 ${fs}px ${F}`, letterSpacing: '.01em',
      boxShadow: '0 1px 2px rgba(0,0,0,.1)',
    }}>
      {m.name}
    </span>
  );
}

// Stufe dot — a single filled dot, size-adjustable
function StufeDot({ stufe, size = 10 }) {
  return (
    <span style={{
      width: size, height: size, borderRadius: size / 2,
      background: COLORS.stufe[stufe], display: 'inline-block',
      boxShadow: `0 0 0 2px ${COLORS.stufe[stufe]}22`,
    }}/>
  );
}

// Stufe mini-ring — 5 segments, show how many light up
function StufeRing({ stufe, size = 38 }) {
  const r = size / 2 - 3;
  const c = 2 * Math.PI * r;
  const frac = stufe / 5;
  const color = COLORS.stufe[stufe];
  return (
    <div style={{ position: 'relative', width: size, height: size }}>
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={size/2} cy={size/2} r={r} stroke="rgba(25,28,29,.08)" strokeWidth="3" fill="none"/>
        <circle cx={size/2} cy={size/2} r={r} stroke={color} strokeWidth="3" fill="none"
          strokeLinecap="round"
          strokeDasharray={`${c*frac} ${c}`}/>
      </svg>
      <div style={{
        position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
        font: `800 ${size*0.35}px ${F}`, color: color, letterSpacing: '-.02em',
      }}>{stufe}</div>
    </div>
  );
}

// Euro pill — hero number with subtle pct
function EuroPill({ amount, pct, tone = 'solid', size = 'md' }) {
  const big = size === 'lg' ? 28 : size === 'md' ? 18 : 14;
  const bg = tone === 'solid' ? COLORS.gradient
           : tone === 'soft' ? '#eaf5f2'
           : 'transparent';
  const fg = tone === 'solid' ? '#fff' : COLORS.primary;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'baseline', gap: 6,
      padding: tone === 'ghost' ? 0 : size === 'lg' ? '6px 12px' : '3px 10px',
      borderRadius: 999, background: bg, color: fg,
      font: `800 ${big}px ${F}`, letterSpacing: '-.02em',
    }}>
      −{amount.toFixed(2).replace('.', ',')} €
      {pct != null && <span style={{ font: `700 ${big*0.55}px ${F}`, opacity: .85 }}>{pct}%</span>}
    </span>
  );
}

// Product-tile emoji artwork — consistent across screens
function PackTile({ product, size = 110, stufe, chip }) {
  const [c1, c2] = product.tint || ['#eaf5f2', '#d7efec'];
  return (
    <div style={{
      height: size, background: `linear-gradient(135deg,${c1},${c2})`,
      position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: size * 0.52, overflow: 'hidden',
    }}>
      {/* soft radial highlight */}
      <div style={{
        position: 'absolute', inset: 0,
        background: 'radial-gradient(circle at 30% 25%, rgba(255,255,255,.5), transparent 55%)',
      }}/>
      <span style={{ position: 'relative', lineHeight: 1 }}>{product.emoji}</span>
      {stufe != null && (
        <div style={{ position: 'absolute', top: 8, right: 8 }}>
          <StufeBadge stufe={stufe}/>
        </div>
      )}
      {chip && (
        <div style={{ position: 'absolute', bottom: 8, left: 8 }}>{chip}</div>
      )}
    </div>
  );
}

// Soft card surface
function Card({ children, style = {}, onClick, pad = 14, elev = 'sm' }) {
  const sh = elev === 'lg' ? SH_LG : elev === 'md' ? SH_MD : SH_SM;
  return (
    <div onClick={onClick} style={{
      background: COLORS.card, borderRadius: 16, padding: pad,
      boxShadow: sh, cursor: onClick ? 'pointer' : 'default', ...style,
    }}>{children}</div>
  );
}

// Section header
function SectionHead({ title, action, onAction, style = {} }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
      padding: '0 18px 10px', ...style,
    }}>
      <span style={{ font: `700 17px ${F}`, color: COLORS.text, letterSpacing: '-.01em' }}>{title}</span>
      {action && <button onClick={onAction} style={{
        background: 'transparent', border: 0, color: COLORS.primary,
        font: `600 13px ${F}`, cursor: 'pointer', padding: 0,
      }}>{action}</button>}
    </div>
  );
}

Object.assign(window, {
  MarketPill, StufeDot, StufeRing, EuroPill, PackTile, Card, SectionHead,
});
