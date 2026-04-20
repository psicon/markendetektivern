// components.jsx — MarkenDetektive shared UI primitives
const { useState } = React;

const COLORS = {
  primary: 'var(--th-primary)', primaryHover: 'var(--th-primary-hover)', secondary: '#42a968',
  surface: 'var(--th-surface)', low: 'var(--th-low)', high: 'var(--th-high)', card: 'var(--th-card)',
  text: 'var(--th-text)', textVar: 'var(--th-text-var)', muted: 'var(--th-muted)', faint: 'var(--th-faint)',
  stufe: { 1:'#ef2d1a', 2:'#f5720e', 3:'#fbc801', 4:'#73c928', 5:'#0d8575' },
  warn: '#ff9500', err: '#ff3b30',
  gradient: 'var(--th-gradient)',
};
const F = "'Nunito',-apple-system,BlinkMacSystemFont,system-ui,sans-serif";
const SH_SM = 'var(--th-shadow-sm)';
const SH_MD = 'var(--th-shadow-md)';
const SH_LG = 'var(--th-shadow-lg)';

// MDI icon via CDN webfont
function MdI({ name, size = 20, color = 'currentColor', style = {} }) {
  return <i className={`mdi mdi-${name}`} style={{ fontFamily: '"Material Design Icons"', fontSize: size, color, lineHeight: 1, ...style }} />;
}

// Material Symbols (matches original design system)
function Icon({ name, size = 24, color = 'currentColor', fill = 0, weight = 400, style = {} }) {
  return <span className="material-symbols-outlined" style={{
    fontSize: size, color, lineHeight: 1,
    fontVariationSettings: `'FILL' ${fill}, 'wght' ${weight}, 'GRAD' 0, 'opsz' 24`,
    ...style,
  }}>{name}</span>;
}

// Brand detective glyph — hat + goggles inline SVG (matches uploaded logo)
function DetectiveMark({ size = 32, color = COLORS.primary }) {
  return (
    <svg width={size} height={size} viewBox="0 0 717.2 744.45" fill={color} xmlns="http://www.w3.org/2000/svg">
      <path d="M162.1,248.04h533.5c9.43,0,19.56,15.8,20.51,24.49,8.65,79.58-34.53,157.33-118.46,166.55l-480.03-.06C34.78,428.21-7.5,351.59,1.1,272.53c1.25-11.48,10.12-22.2,21.59-24.41l85.31-.19,40.83-166.67C172.68,9.58,254.11-24.43,318.83,19.8c15.49,10.59,26.4,25.34,39.77,38.21,20.28-21.58,37.92-42.17,66.99-52,73.68-24.91,140.92,31.08,150.26,103.77,2.26,17.58-6.93,34.84-26.27,34.3-25.4-.71-24.24-28.49-30.43-45.59-15.36-42.43-65.06-56.52-99.56-26.49-15.21,13.24-30.46,36.62-45.98,48.02-9.3,6.84-20.7,6.84-30,0-15.59-11.46-30.65-34.81-45.98-48.02-34.54-29.77-82.5-16.34-99.01,25.04l-36.51,150.99h0ZM54.72,303.11c-2.21.63-1.73,4.52-1.62,6.4,2.13,36.38,33.38,71.36,70.45,73.57l472.92-.18c38.59-4.75,67.86-40.6,67.17-78.92l-608.92-.88h0Z"/>
      <path d="M327.23,585.91h62.73c6.92-32.45,25.78-61.54,52.82-80.68,78.42-55.52,188.41-12.82,207.36,80.77,16.88,1.99,45.81-5.26,58.99,7.51,15.88,15.39,6.09,42.72-15.5,44.57-6.59.57-40.07-1.22-42.57.43-10.48,44.43-40.71,81.16-83.7,97.3-63.31,23.78-136.8-4.32-166.43-65.1-5.03-10.32-7.91-21.45-11.82-32.18l-58.57-.54c-1.61-.07-2.44.31-3.37,1.63-1.45,2.07-3.63,13.1-5.06,16.94-25.99,69.77-102.49,105.85-173,78.97-42.61-16.25-72.56-52.88-82.98-97.02-2.59-1.71-36.68.22-43.52-.48-14.74-1.5-25.35-17.29-21.83-31.8,6.95-28.66,45.04-18.27,66.27-20.23,8.26-44.86,42.65-83.13,85.53-97.97,76.37-26.45,157.89,19.37,174.65,97.89h0ZM195.92,532.27c-60.78.82-100.15,66.37-69.34,119.79,33.97,58.89,123.48,51.42,146.53-12.5,19.12-53.02-21.38-108.04-77.19-107.28h0ZM518.92,532.3c-74.42,1.21-108.16,93.78-50.29,141.71,37.77,31.28,96.17,21.32,121.27-20.67,32.56-54.45-8.45-122.06-70.99-121.04h0Z"/>
    </svg>
  );
}

function PrimaryButton({ children, onClick, icon, full, size = 'md', style = {} }) {
  const h = size === 'sm' ? 34 : 44;
  return (
    <button onClick={onClick} style={{
      height: h, padding: size === 'sm' ? '0 14px' : '0 22px',
      background: COLORS.gradient, color: '#fff', border: 0,
      borderRadius: size === 'sm' ? 10 : 12,
      font: `700 ${size === 'sm' ? 12 : 14}px ${F}`,
      display: 'inline-flex', alignItems: 'center', gap: 8,
      cursor: 'pointer', width: full ? '100%' : undefined, justifyContent: 'center',
      boxShadow: 'inset 0 1px 0 rgba(255,255,255,.2), 0 2px 6px rgba(13,133,117,.25)',
      ...style,
    }}>{icon && <MdI name={icon} size={size === 'sm' ? 14 : 16} />}{children}</button>
  );
}

function SecondaryButton({ children, onClick, icon, full, style = {} }) {
  return (
    <button onClick={onClick} style={{
      height: 44, padding: '0 20px',
      background: COLORS.card, color: COLORS.primary, border: 0, borderRadius: 12,
      font: `700 14px ${F}`, display: 'inline-flex', alignItems: 'center', gap: 8,
      cursor: 'pointer', width: full ? '100%' : undefined, justifyContent: 'center',
      boxShadow: SH_SM, ...style,
    }}>{icon && <MdI name={icon} size={16} />}{children}</button>
  );
}

function Chip({ active, children, onClick, icon }) {
  return (
    <button onClick={onClick} style={{
      height: 32, padding: '0 12px', borderRadius: 8, border: 0,
      background: active ? COLORS.primary : COLORS.card,
      color: active ? '#fff' : COLORS.text,
      boxShadow: SH_SM, font: `500 13px ${F}`,
      display: 'inline-flex', alignItems: 'center', gap: 6,
      whiteSpace: 'nowrap', cursor: 'pointer',
    }}>{icon && <MdI name={icon} size={14} />}{children}</button>
  );
}

function StufeBadge({ stufe }) {
  const bg = COLORS.stufe[stufe];
  const textColor = stufe === 3 ? COLORS.text : '#fff';
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      background: bg, color: textColor, padding: '3px 7px', borderRadius: 10,
      font: `700 10px ${F}`,
    }}>
      <MdI name="chart-bar" size={10} color={textColor}/> Stufe {stufe}
    </span>
  );
}

// Horizontal 5-segment chips — like the ref (5 filled rectangles)
function StufenChips({ stufe, size = 'md' }) {
  const h = size === 'sm' ? 10 : size === 'lg' ? 18 : 14;
  const w = size === 'sm' ? 5 : size === 'lg' ? 8 : 6;
  const color = COLORS.stufe[stufe];
  return (
    <div style={{ display: 'inline-flex', gap: 2, alignItems: 'center' }}>
      {[1,2,3,4,5].map(n => (
        <span key={n} style={{
          width: w, height: h, borderRadius: 2,
          background: n <= stufe ? color : 'var(--th-border-strong)',
        }}/>
      ))}
    </div>
  );
}

function StufenBar({ stufe, style = {} }) {
  return (
    <div style={{ display: 'flex', height: 6, borderRadius: 999, overflow: 'hidden', gap: 2, ...style }}>
      {[1,2,3,4,5].map(n => (
        <div key={n} style={{ flex: 1, background: n <= stufe ? COLORS.stufe[stufe] : 'var(--th-border-md)', borderRadius: 999 }}/>
      ))}
    </div>
  );
}

// Market square badge on product image — matches ref (rounded rect with letter)
function MarketBadge({ market, style = {} }) {
  const m = MARKETS[market];
  if (!m) return null;
  return (
    <div style={{
      width: 30, height: 30, borderRadius: 8, background: m.tint,
      color: '#fff', font: `800 13px ${F}`, letterSpacing: -0.5,
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      boxShadow: '0 1px 3px rgba(0,0,0,.15)', ...style,
    }}>{m.short}</div>
  );
}

// ProductCard — the "Stöbern" style card: image + market badge + stufe chips + name + price + unit
function ProductCard({ product, noName, variant = 'grid', onClick }) {
  // variant 'grid' = full-width grid cell; 'h' = horizontal scroller card (narrower)
  const nn = noName || bestNoName(product);
  const width = variant === 'h' ? 168 : '100%';
  const imgH = variant === 'h' ? 150 : 180;
  return (
    <button onClick={onClick} style={{
      width, background: 'var(--th-card)', borderRadius: 16, padding: 0, overflow: 'hidden',
      border: 0, textAlign: 'left', cursor: 'pointer',
      fontFamily: F, flexShrink: 0, display: 'block',
    }}>
      <div style={{ position: 'relative' }}>
        <ProductImg product={product} size={imgH} rounded={0}/>
        <div style={{ position: 'absolute', top: 10, left: 10 }}>
          <MarketBadge market={nn.market}/>
        </div>
        <div style={{ position: 'absolute', bottom: 10, right: 10 }}>
          <StufenChips stufe={nn.stufe} size={variant === 'h' ? 'sm' : 'md'}/>
        </div>
      </div>
      <div style={{ padding: '12px 12px 14px' }}>
        <div style={{ font: `700 10px ${F}`, color: COLORS.primary, letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 4 }}>
          {nn.brand.toUpperCase()}
        </div>
        <div style={{ font: `600 15px/1.25 ${F}`, color: COLORS.text, minHeight: 36 }}>
          {nn.name}
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginTop: 6, gap: 8 }}>
          <span style={{ font: `700 16px ${F}`, color: COLORS.text }}>{nn.price.toFixed(2).replace('.',',')}€</span>
          {variant === 'grid' && <span style={{ font: `400 11px ${F}`, color: COLORS.muted }}>{nn.unit}</span>}
        </div>
      </div>
    </button>
  );
}

function TabBar({ active = 'home', onNav }) {
  const tab = (id, icon, label) => {
    const on = active === id;
    return (
      <button onClick={() => onNav && onNav(id)} style={{
        flex: 1, background: 'transparent', border: 0, cursor: 'pointer',
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3,
        color: on ? COLORS.primary : COLORS.faint, font: `700 10.5px ${F}`,
        letterSpacing: 0.6, padding: '6px 0', textTransform: 'uppercase',
      }}>
        <Icon name={icon} size={22} fill={on ? 1 : 0}/>
        <span>{label}</span>
      </button>
    );
  };
  return (
    <div style={{
      position: 'absolute', bottom: 0, left: 0, right: 0, zIndex: 30,
      background: 'var(--th-card)', borderTop: '1px solid var(--th-border)', height: 82,
      display: 'flex', alignItems: 'flex-start', padding: '10px 6px 26px', gap: 2,
    }}>
      {tab('home', 'home', 'Home')}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', position: 'relative' }}>
        <button onClick={() => onNav && onNav('explore')} style={{
          width: 58, height: 58, borderRadius: 29, background: COLORS.primary,
          border: 0, color: '#fff', cursor: 'pointer',
          boxShadow: '0 6px 14px rgba(13,133,117,.35)', marginTop: -18,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <DetectiveMark size={32} color="#fff"/>
        </button>
        <span style={{
          font: `700 10.5px ${F}`, color: active === 'explore' ? COLORS.primary : COLORS.faint,
          letterSpacing: 0.6, textTransform: 'uppercase', marginTop: 4,
        }}>Stöbern</span>
      </div>
      {tab('rewards', 'emoji_events', 'Rewards')}
    </div>
  );
}

// BrandLogo — stylized wordmark badge for branded products.
// Renders the brand name on a colored capsule (placeholder for real logo asset).
// `kind`: 'badge' (rounded rect) | 'pill' (capsule) | 'circle' (initials only)
// `size`: 'sm' | 'md' | 'lg'
function BrandLogo({ product, kind = 'pill', size = 'md', style = {} }) {
  if (!product?.markeColor) return null;
  const bg = product.markeColor;
  // Choose contrast color
  const fg = '#fff';
  const sizes = {
    sm: { fs: 11, py: 4,  px: 9,  r: 6,  circle: 28 },
    md: { fs: 13, py: 6,  px: 12, r: 8,  circle: 36 },
    lg: { fs: 17, py: 9,  px: 16, r: 10, circle: 52 },
  }[size] || {};

  if (kind === 'circle') {
    const initials = product.brand.split(/[\s-]/).map(w => w[0]).join('').slice(0,2).toUpperCase();
    return (
      <div style={{
        width: sizes.circle, height: sizes.circle, borderRadius: sizes.circle/2,
        background: bg, color: fg,
        font: `800 ${sizes.fs}px ${F}`, letterSpacing: '-.02em',
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        boxShadow: '0 2px 6px rgba(0,0,0,.15)',
        flexShrink: 0,
        ...style,
      }}>{initials}</div>
    );
  }
  return (
    <div style={{
      display: 'inline-flex', alignItems: 'center', gap: 0,
      background: bg, color: fg,
      padding: `${sizes.py}px ${sizes.px}px`,
      borderRadius: kind === 'pill' ? 99 : sizes.r,
      font: `800 ${sizes.fs}px ${F}`, letterSpacing: '-.01em',
      boxShadow: '0 2px 6px rgba(0,0,0,.15)',
      whiteSpace: 'nowrap',
      ...style,
    }}>{product.brand}</div>
  );
}

Object.assign(window, {
  COLORS, F, SH_SM, SH_MD, SH_LG, MdI, DetectiveMark,
  PrimaryButton, SecondaryButton, Chip, StufeBadge, StufenBar, StufenChips, MarketBadge, ProductCard, TabBar, Icon,
  BrandLogo,
});
