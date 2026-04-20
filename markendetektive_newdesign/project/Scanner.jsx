/* Scanner — camera view with scan-area cutout + recent scans row */

function Scanner({ onBack, onOpenProduct }) {
  const [flash, setFlash] = useStateS(false);
  const [focused, setFocused] = useStateS(false);

  // Simulate a lock-on after ~1.6s (visual feedback only)
  useEffectS(() => {
    const t = setTimeout(() => setFocused(true), 1600);
    const t2 = setTimeout(() => setFocused(false), 3200);
    const t3 = setTimeout(() => setFocused(true), 4800);
    return () => { clearTimeout(t); clearTimeout(t2); clearTimeout(t3); };
  }, []);

  // Recent scans — use first 10 products
  const recent = PRODUCTS.slice(0, 10);

  // Scan window dimensions (centered)
  const W = 402; // phone content width
  const SCAN_W = 286;
  const SCAN_H = 170;
  const SCAN_TOP = 170;
  const SCAN_LEFT = (W - SCAN_W) / 2;

  return (
    <div style={{
      fontFamily: F,
      position: 'absolute', inset: 0,
      background: '#000', overflow: 'hidden',
    }}>
      {/* Fake camera feed — dim shelf-like gradient with noise */}
      <CameraFeed flash={flash}/>

      {/* Dark overlay everywhere, with a cutout for the scan window.
          Using 4 rectangles around the window for a clean hard edge. */}
      <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
        {/* top */}
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: SCAN_TOP, background: 'rgba(0,0,0,0.55)' }}/>
        {/* bottom */}
        <div style={{ position: 'absolute', top: SCAN_TOP + SCAN_H, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.55)' }}/>
        {/* left */}
        <div style={{ position: 'absolute', top: SCAN_TOP, left: 0, width: SCAN_LEFT, height: SCAN_H, background: 'rgba(0,0,0,0.55)' }}/>
        {/* right */}
        <div style={{ position: 'absolute', top: SCAN_TOP, right: 0, width: SCAN_LEFT, height: SCAN_H, background: 'rgba(0,0,0,0.55)' }}/>
      </div>

      {/* Scan window frame */}
      <ScanWindow top={SCAN_TOP} left={SCAN_LEFT} width={SCAN_W} height={SCAN_H} focused={focused}/>

      {/* Top bar — close, title, flash */}
      <div style={{
        position: 'absolute', top: 10, left: 0, right: 0, height: 56,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0 16px', zIndex: 10,
      }}>
        <button onClick={onBack} style={{
          width: 40, height: 40, borderRadius: 20, border: 0, cursor: 'pointer',
          background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(8px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <MdI name="close" size={22} color="#fff"/>
        </button>
        <div style={{
          font: `700 15px ${F}`, color: '#fff', letterSpacing: '-.01em',
          textShadow: '0 1px 2px rgba(0,0,0,.4)',
        }}>
          Barcode scannen
        </div>
        <button onClick={() => setFlash(!flash)} style={{
          width: 40, height: 40, borderRadius: 20, border: 0, cursor: 'pointer',
          background: flash ? '#FFD84D' : 'rgba(0,0,0,0.45)',
          backdropFilter: 'blur(8px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <MdI name={flash ? 'flashlight' : 'flashlight-off'} size={20} color={flash ? '#1a1a1a' : '#fff'}/>
        </button>
      </div>

      {/* Hint under scan window */}
      <div style={{
        position: 'absolute', top: SCAN_TOP + SCAN_H + 18, left: 0, right: 0,
        textAlign: 'center', zIndex: 10, padding: '0 40px',
      }}>
        <div style={{ font: `700 15px ${F}`, color: '#fff', marginBottom: 4, textShadow: '0 1px 3px rgba(0,0,0,.5)' }}>
          {focused ? 'Barcode erkannt …' : 'Barcode im Rahmen positionieren'}
        </div>
        <div style={{ font: `500 12px ${F}`, color: 'rgba(255,255,255,.7)' }}>
          Die App erkennt EAN, QR & Hersteller-Codes
        </div>
      </div>

      {/* Manual entry pill */}
      <button style={{
        position: 'absolute', top: SCAN_TOP + SCAN_H + 72, left: '50%', transform: 'translateX(-50%)',
        padding: '10px 16px', borderRadius: 100, border: '1px solid rgba(255,255,255,.25)',
        background: 'rgba(0,0,0,.45)', backdropFilter: 'blur(8px)',
        color: '#fff', font: `700 13px ${F}`, cursor: 'pointer', zIndex: 10,
        display: 'flex', alignItems: 'center', gap: 8,
      }}>
        <MdI name="keyboard-outline" size={16}/>
        Code manuell eingeben
      </button>

      {/* Bottom — recent scans */}
      <div style={{
        position: 'absolute', bottom: 56, left: 0, right: 0, zIndex: 10,
      }}>
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '0 20px 8px',
        }}>
          <div style={{ font: `800 13px ${F}`, color: '#fff', letterSpacing: '-.01em' }}>
            Letzte Scans
          </div>
          <button style={{
            background: 'transparent', border: 0, color: 'rgba(255,255,255,.75)',
            font: `700 11px ${F}`, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 2,
          }}>
            Alle <MdI name="chevron-right" size={12}/>
          </button>
        </div>
        <div style={{
          display: 'flex', gap: 8, overflowX: 'auto', scrollSnapType: 'x mandatory',
          padding: '0 20px 6px', WebkitOverflowScrolling: 'touch',
        }}>
          {recent.map((p, i) => (
            <RecentCard key={p.id} product={p} ago={['Gerade eben', 'vor 2 Std.', 'Gestern', 'Gestern', 'vor 2 Tagen', 'vor 3 Tagen', 'letzte Woche', 'letzte Woche', 'vor 2 Wochen', 'vor 3 Wochen'][i]} onClick={() => onOpenProduct(p)}/>
          ))}
        </div>
      </div>

      <style>{`
        @keyframes scannerLaser {
          0%   { transform: translateY(0);       opacity: 0; }
          10%  { opacity: 1; }
          90%  { opacity: 1; }
          100% { transform: translateY(${SCAN_H - 3}px); opacity: 0; }
        }
        @keyframes scannerPulse {
          0%, 100% { transform: scale(1); opacity: .9; }
          50%      { transform: scale(1.02); opacity: 1; }
        }
        @keyframes scannerNoise {
          0%   { background-position: 0 0; }
          100% { background-position: 100px 100px; }
        }
      `}</style>
    </div>
  );
}

/* Scan window with corner brackets + laser line */
function ScanWindow({ top, left, width, height, focused }) {
  const brackets = focused ? COLORS.primary : '#fff';
  const BW = 3;  // bracket stroke width
  const BL = 24; // bracket length

  const corner = (pos) => {
    const s = { position: 'absolute', width: BL, height: BL };
    if (pos === 'tl') return { ...s, top: -BW, left: -BW, borderTop: `${BW}px solid ${brackets}`, borderLeft: `${BW}px solid ${brackets}`, borderTopLeftRadius: 10 };
    if (pos === 'tr') return { ...s, top: -BW, right: -BW, borderTop: `${BW}px solid ${brackets}`, borderRight: `${BW}px solid ${brackets}`, borderTopRightRadius: 10 };
    if (pos === 'bl') return { ...s, bottom: -BW, left: -BW, borderBottom: `${BW}px solid ${brackets}`, borderLeft: `${BW}px solid ${brackets}`, borderBottomLeftRadius: 10 };
    if (pos === 'br') return { ...s, bottom: -BW, right: -BW, borderBottom: `${BW}px solid ${brackets}`, borderRight: `${BW}px solid ${brackets}`, borderBottomRightRadius: 10 };
  };

  return (
    <div style={{
      position: 'absolute', top, left, width, height,
      pointerEvents: 'none',
      animation: focused ? 'scannerPulse 0.6s ease-out' : 'none',
    }}>
      {/* subtle inner glow when focused */}
      <div style={{
        position: 'absolute', inset: 0, borderRadius: 8,
        boxShadow: focused
          ? `0 0 0 2px ${COLORS.primary}, 0 0 40px rgba(44,81,191,0.5)`
          : '0 0 0 1px rgba(255,255,255,0.15)',
        transition: 'box-shadow .3s',
      }}/>
      {/* corner brackets */}
      <div style={corner('tl')}/>
      <div style={corner('tr')}/>
      <div style={corner('bl')}/>
      <div style={corner('br')}/>
      {/* laser line */}
      <div style={{
        position: 'absolute', left: 10, right: 10, top: 0, height: 2,
        background: `linear-gradient(90deg, transparent, ${COLORS.primary}, transparent)`,
        boxShadow: `0 0 12px ${COLORS.primary}, 0 0 24px ${COLORS.primary}`,
        animation: 'scannerLaser 2.2s ease-in-out infinite',
        borderRadius: 2,
      }}/>
      {/* Center EAN barcode illustration — very faint (so it looks like a product is being aimed at) */}
      {!focused && (
        <div style={{
          position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%, -50%)',
          opacity: 0.35, display: 'flex', alignItems: 'flex-end', gap: 1.5, height: 50,
        }}>
          {[3,1,1,2,1,3,1,2,3,1,2,1,1,3,2,1,1,2,1,3,2,1,3,1,1,2,1,1,3,1,2,1,3,1,1,2].map((w, i) => (
            <div key={i} style={{ width: w, height: i === 8 || i === 27 ? 55 : 50, background: '#fff' }}/>
          ))}
        </div>
      )}
      {/* Lock-on badge */}
      {focused && (
        <div style={{
          position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
          background: COLORS.primary, color: '#fff', borderRadius: 100,
          padding: '8px 14px', font: `700 13px ${F}`,
          display: 'flex', alignItems: 'center', gap: 6,
          boxShadow: '0 4px 16px rgba(0,0,0,.3)',
        }}>
          <MdI name="check-circle" size={16} color="#fff"/>
          Erkannt
        </div>
      )}
    </div>
  );
}

/* Fake camera feed — hints at a supermarket shelf */
function CameraFeed({ flash }) {
  return (
    <div style={{
      position: 'absolute', inset: 0, overflow: 'hidden',
      background: 'radial-gradient(ellipse at 50% 45%, #4a4038 0%, #2a2520 50%, #14110f 100%)',
    }}>
      {/* Blurred shelf silhouettes — horizontal strips */}
      <div style={{
        position: 'absolute', left: '-10%', right: '-10%', top: '35%', height: 110,
        background: 'linear-gradient(180deg, rgba(255,220,160,.08), rgba(180,140,80,.18))',
        filter: 'blur(12px)',
      }}/>
      <div style={{
        position: 'absolute', left: '-10%', right: '-10%', top: '60%', height: 90,
        background: 'linear-gradient(180deg, rgba(200,160,110,.18), rgba(80,55,35,.1))',
        filter: 'blur(14px)',
      }}/>
      {/* Fake product shapes behind scan window */}
      <div style={{
        position: 'absolute', left: '8%', top: '32%', width: 60, height: 140,
        borderRadius: 6, background: 'linear-gradient(180deg, #c4a06a, #6b4f2f)',
        filter: 'blur(6px)', opacity: 0.7,
      }}/>
      <div style={{
        position: 'absolute', right: '10%', top: '28%', width: 70, height: 150,
        borderRadius: 6, background: 'linear-gradient(180deg, #9b6b4a, #4a2f20)',
        filter: 'blur(7px)', opacity: 0.65,
      }}/>
      <div style={{
        position: 'absolute', left: '38%', top: '38%', width: 80, height: 130,
        borderRadius: 4, background: 'linear-gradient(180deg, #d9c089, #8a6a3b)',
        filter: 'blur(5px)', opacity: 0.55,
      }}/>
      {/* Chromatic vignette */}
      <div style={{
        position: 'absolute', inset: 0,
        background: 'radial-gradient(ellipse at center, transparent 40%, rgba(0,0,0,.6) 100%)',
      }}/>
      {/* Grain */}
      <div style={{
        position: 'absolute', inset: 0, opacity: 0.15, mixBlendMode: 'overlay',
        backgroundImage: `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='120' height='120'><filter id='n'><feTurbulence baseFrequency='0.9' numOctaves='2'/></filter><rect width='100%' height='100%' filter='url(%23n)' opacity='0.8'/></svg>")`,
        animation: 'scannerNoise 0.3s steps(4) infinite',
      }}/>
      {/* Flash */}
      {flash && (
        <div style={{
          position: 'absolute', inset: 0,
          background: 'radial-gradient(ellipse at center, rgba(255,248,220,0.35) 0%, transparent 60%)',
          pointerEvents: 'none',
        }}/>
      )}
    </div>
  );
}

/* Recent scan product card — horizontal scroll */
function RecentCard({ product, ago, onClick }) {
  return (
    <button onClick={onClick} style={{
      flex: '0 0 auto', width: 168, padding: 6, borderRadius: 12,
      background: 'rgba(255,255,255,0.96)', border: 0, cursor: 'pointer',
      boxShadow: '0 4px 14px rgba(0,0,0,.25)',
      scrollSnapAlign: 'start', textAlign: 'left',
      display: 'flex', alignItems: 'center', gap: 8,
    }}>
      <div style={{
        width: 46, height: 46, borderRadius: 8,
        background: product.tint || '#f0e7d8',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 22, flexShrink: 0,
      }}>
        {product.emoji}
      </div>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{
          font: `800 12px ${F}`, color: COLORS.text, letterSpacing: '-.01em',
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>
          {product.brand}
        </div>
        <div style={{
          font: `500 10px ${F}`, color: COLORS.muted,
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', marginTop: 1,
        }}>
          {product.name}
        </div>
        <div style={{
          font: `600 9px ${F}`, color: COLORS.primary, marginTop: 2,
          display: 'flex', alignItems: 'center', gap: 2,
        }}>
          <MdI name="clock-outline" size={9}/>
          {ago}
        </div>
      </div>
    </button>
  );
}

const useStateS = React.useState;
const useEffectS = React.useEffect;
