// Receipt.jsx — Kassenbon-Scanner: camera view for receipt submission.
// Color system: light green (#95cfc4) as primary, matches Home quick-access tile.

const RECEIPT_GREEN       = '#2d7a6e';   // deeper green for CTA
const RECEIPT_GREEN_LIGHT = '#95cfc4';   // light green (matches Home tile)
const RECEIPT_GREEN_TINT  = 'rgba(149,207,196,0.18)';

const RECEIPT_EUR_EACH = 0.08;

function ReceiptScanner({ onBack }) {
  const [step, setStep] = React.useState('capture'); // 'capture' | 'review' | 'done'
  const [captured, setCaptured] = React.useState(false);
  const [flash, setFlash] = React.useState(false);
  const [market, setMarket] = React.useState('Rewe');
  const [date, setDate]     = React.useState('Heute, 16:05');
  const [total, setTotal]   = React.useState('23,47 €');
  const [showHelp, setShowHelp] = React.useState(false);
  const [showOnboard, setShowOnboard] = React.useState(() =>
    window.shShouldShowReceiptOnboarding && window.shShouldShowReceiptOnboarding());

  // Tell the app shell to go fullscreen (hide tab bar, dark status bar)
  React.useEffect(() => {
    window.dispatchEvent(new Event('md-wizard-enter'));
    return () => window.dispatchEvent(new Event('md-wizard-exit'));
  }, []);

  // Help page inside scanner (sits above scanner, below onboarding)
  if (showHelp) {
    return <window.ReceiptHelpPage
      onBack={() => setShowHelp(false)}
      onReplayTour={() => {
        window.shResetReceiptOnboarding && window.shResetReceiptOnboarding();
        setShowHelp(false);
        setShowOnboard(true);
      }}
    />;
  }

  const onOpenHelp = () => setShowHelp(true);

  if (step === 'done') {
    return (<>
      <ReceiptSubmitted onClose={onBack} market={market} total={total}/>
      {showOnboard && <window.ReceiptOnboarding onDone={() => setShowOnboard(false)}/>}
    </>);
  }
  if (step === 'review') {
    return (<>
      <ReceiptReview
        market={market} setMarket={setMarket}
        date={date} setDate={setDate}
        total={total} setTotal={setTotal}
        onRetake={() => { setStep('capture'); setCaptured(false); }}
        onSubmit={() => setStep('done')}
        onClose={onBack}
        onOpenHelp={onOpenHelp}
      />
      {showOnboard && <window.ReceiptOnboarding onDone={() => setShowOnboard(false)}/>}
    </>);
  }
  return (<>
    <ReceiptCapture
      flash={flash} setFlash={setFlash}
      captured={captured} setCaptured={setCaptured}
      onCaptured={() => setStep('review')}
      onClose={onBack}
      onOpenHelp={onOpenHelp}
    />
    {showOnboard && <window.ReceiptOnboarding onDone={() => setShowOnboard(false)}/>}
  </>);
}

// ——————————————————————————————————————————————————
// CAPTURE — camera viewfinder with receipt crop frame
// ——————————————————————————————————————————————————
function ReceiptCapture({ flash, setFlash, captured, setCaptured, onCaptured, onClose, onOpenHelp }) {
  const [detected, setDetected] = React.useState(false);
  React.useEffect(() => {
    const t = setTimeout(() => setDetected(true), 1400);
    return () => clearTimeout(t);
  }, []);

  const handleShutter = () => {
    setCaptured(true);
    setTimeout(onCaptured, 350);
  };

  return (
    <div style={{
      position: 'absolute', inset: 0, background: '#0a0a0a', color: '#fff',
      display: 'flex', flexDirection: 'column', zIndex: 30, fontFamily: F,
      overflow: 'hidden',
    }}>
      {/* Fake camera feed */}
      <ReceiptCameraFeed flash={flash}/>

      {/* Top chrome */}
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10,
        padding: '14px 16px 12px',
        background: 'linear-gradient(180deg, rgba(0,0,0,.65), rgba(0,0,0,0))',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button onClick={onClose} aria-label="Schließen" style={{
            width: 36, height: 36, borderRadius: 18,
            background: 'rgba(255,255,255,.14)', border: 0, cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <MdI name="close" size={20} color="#fff"/>
          </button>
          <div style={{ flex: 1 }}>
            <div style={{ font: `700 11px ${F}`, opacity: .75, letterSpacing: .4, textTransform: 'uppercase' }}>
              Kassenbon · {RECEIPT_EUR_EACH.toFixed(2).replace('.', ',')} € Cashback
            </div>
            <div style={{ font: `800 16px ${F}`, marginTop: 1, letterSpacing: '-.01em' }}>
              Beleg abfotografieren
            </div>
          </div>
          <button onClick={() => setFlash(!flash)} aria-label="Blitz" style={{
            width: 36, height: 36, borderRadius: 18,
            background: flash ? '#FFD84D' : 'rgba(255,255,255,.14)',
            border: 0, cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <MdI name={flash ? 'flashlight' : 'flashlight-off'} size={18} color={flash ? '#1a1a1a' : '#fff'}/>
          </button>
          {onOpenHelp && (
            <button onClick={onOpenHelp} aria-label="So geht's" style={{
              width: 36, height: 36, borderRadius: 18,
              background: 'rgba(255,255,255,.14)', border: 0, cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <MdI name="help-circle-outline" size={18} color="#fff"/>
            </button>
          )}
        </div>
      </div>

      {/* Receipt crop frame — tall narrow portrait rectangle */}
      <ReceiptCropFrame detected={detected && !captured} captured={captured}/>

      {/* Hint */}
      <div style={{
        position: 'absolute', left: 0, right: 0, bottom: 180, zIndex: 10,
        textAlign: 'center', padding: '0 30px', pointerEvents: 'none',
      }}>
        <div style={{
          font: `700 14px ${F}`, color: '#fff',
          textShadow: '0 1px 3px rgba(0,0,0,.5)', marginBottom: 4,
        }}>
          {captured ? 'Foto aufgenommen …'
            : detected ? 'Beleg erkannt — jetzt auslösen'
            : 'Kompletten Beleg im Rahmen positionieren'}
        </div>
        <div style={{
          font: `500 12px ${F}`, color: 'rgba(255,255,255,.75)',
        }}>
          Markt, Datum & Summe müssen lesbar sein
        </div>
      </div>

      {/* Bottom controls */}
      <div style={{
        position: 'absolute', left: 0, right: 0, bottom: 0, zIndex: 10,
        padding: '16px 16px 28px',
        background: 'linear-gradient(180deg, rgba(0,0,0,0), rgba(0,0,0,.55))',
      }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 12, justifyContent: 'space-between',
        }}>
          {/* Gallery */}
          <button onClick={handleShutter} aria-label="Aus Galerie wählen" style={{
            width: 58, height: 58, borderRadius: 14,
            background: 'rgba(255,255,255,.12)', border: '1px solid rgba(255,255,255,.18)',
            cursor: 'pointer', padding: 0,
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2,
          }}>
            <MdI name="image-multiple-outline" size={22} color="#fff"/>
            <span style={{ font: `600 9px ${F}`, color: 'rgba(255,255,255,.85)' }}>Galerie</span>
          </button>

          {/* Shutter */}
          <button onClick={handleShutter} aria-label="Auslöser" style={{
            width: 74, height: 74, borderRadius: 37, background: '#fff',
            border: '5px solid rgba(255,255,255,.3)', cursor: 'pointer', padding: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: `0 4px 20px ${RECEIPT_GREEN_LIGHT}80`,
            transform: captured ? 'scale(.92)' : 'scale(1)',
            transition: 'transform .15s',
          }}>
            <div style={{ width: 56, height: 56, borderRadius: 28, background: RECEIPT_GREEN_LIGHT }}/>
          </button>

          {/* Manual */}
          <button onClick={() => onCaptured()} aria-label="Manuell eingeben" style={{
            width: 58, height: 58, borderRadius: 14,
            background: 'rgba(255,255,255,.12)', border: '1px solid rgba(255,255,255,.18)',
            cursor: 'pointer', padding: 0,
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2,
          }}>
            <MdI name="keyboard-outline" size={20} color="#fff"/>
            <span style={{ font: `600 9px ${F}`, color: 'rgba(255,255,255,.85)' }}>Manuell</span>
          </button>
        </div>
        <div style={{
          padding: '12px 8px 0', font: `500 11px ${F}`, textAlign: 'center',
          color: 'rgba(255,255,255,.55)',
        }}>
          Kamera · Galerie-Import möglich — bereits abfotografierte Belege können direkt verwendet werden.
        </div>
      </div>
    </div>
  );
}

// Receipt-shaped crop overlay: tall narrow portrait rectangle with ragged top
function ReceiptCropFrame({ detected, captured }) {
  const brand = captured ? '#fff' : detected ? RECEIPT_GREEN_LIGHT : 'rgba(255,255,255,.75)';
  return (
    <div style={{
      position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
      pointerEvents: 'none',
    }}>
      <div style={{
        position: 'relative', width: 230, height: 420,
        display: 'flex', flexDirection: 'column',
      }}>
        {/* Ragged-edge receipt top */}
        <div style={{
          height: 8, width: '100%',
          background: `repeating-linear-gradient(90deg, transparent 0 6px, ${brand} 6px 8px)`,
          opacity: .85,
        }}/>

        {/* Frame body */}
        <div style={{
          flex: 1, borderRadius: 6,
          border: `2px solid ${brand}`,
          boxShadow: detected
            ? `0 0 0 4px ${RECEIPT_GREEN_TINT}, 0 0 40px rgba(149,207,196,0.45)`
            : '0 0 0 1px rgba(255,255,255,0.08)',
          transition: 'box-shadow .25s, border-color .25s',
          position: 'relative',
          background: 'rgba(255,255,255,.02)',
        }}>
          {/* Corner ticks */}
          {['tl','tr','bl','br'].map(p => (
            <span key={p} style={{
              position: 'absolute',
              [p.includes('t') ? 'top' : 'bottom']: -2,
              [p.includes('l') ? 'left' : 'right']: -2,
              width: 22, height: 22,
              [`border${p.includes('t') ? 'Top' : 'Bottom'}`]: `3px solid ${brand}`,
              [`border${p.includes('l') ? 'Left' : 'Right'}`]: `3px solid ${brand}`,
              borderRadius: p === 'tl' ? '6px 0 0 0'
                          : p === 'tr' ? '0 6px 0 0'
                          : p === 'bl' ? '0 0 0 6px'
                                       : '0 0 6px 0',
            }}/>
          ))}

          {/* Scan-line animation */}
          {detected && !captured && (
            <div style={{
              position: 'absolute', left: 6, right: 6, top: 0, height: 2,
              background: `linear-gradient(90deg, transparent, ${RECEIPT_GREEN_LIGHT}, transparent)`,
              boxShadow: `0 0 10px ${RECEIPT_GREEN_LIGHT}`,
              animation: 'rScanLine 2.4s ease-in-out infinite',
            }}/>
          )}

          {/* Ghost receipt contents */}
          {!captured && (
            <div style={{
              position: 'absolute', inset: 18, opacity: detected ? .38 : .22,
              display: 'flex', flexDirection: 'column', gap: 6,
            }}>
              <div style={{ height: 8, background: '#fff', width: '55%', margin: '0 auto', borderRadius: 1 }}/>
              <div style={{ height: 5, background: '#fff', width: '70%', margin: '2px auto 10px', borderRadius: 1, opacity: .7 }}/>
              {Array.from({ length: 11 }).map((_, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: 6 }}>
                  <div style={{ height: 4, width: `${30 + (i*7)%40}%`, background: '#fff', borderRadius: 1 }}/>
                  <div style={{ height: 4, width: '18%', background: '#fff', borderRadius: 1 }}/>
                </div>
              ))}
              <div style={{
                marginTop: 8, height: 6, width: '100%',
                background: `repeating-linear-gradient(90deg, #fff 0 3px, transparent 3px 6px)`,
                opacity: .5,
              }}/>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
                <div style={{ height: 6, width: '22%', background: '#fff', borderRadius: 1 }}/>
                <div style={{ height: 6, width: '30%', background: '#fff', borderRadius: 1 }}/>
              </div>
            </div>
          )}

          {/* Lock-on pill */}
          {detected && !captured && (
            <div style={{
              position: 'absolute', top: 14, left: '50%', transform: 'translateX(-50%)',
              background: RECEIPT_GREEN_LIGHT, color: '#0a3c35',
              padding: '4px 10px', borderRadius: 100,
              font: `800 10px ${F}`, letterSpacing: .3,
              display: 'inline-flex', alignItems: 'center', gap: 4,
              boxShadow: '0 2px 10px rgba(0,0,0,.25)',
            }}>
              <MdI name="check-circle" size={11} color="#0a3c35"/>
              Erkannt
            </div>
          )}
        </div>
      </div>

      <style>{`
        @keyframes rScanLine {
          0%   { transform: translateY(8px);   opacity: 0; }
          12%  { opacity: 1; }
          88%  { opacity: 1; }
          100% { transform: translateY(390px); opacity: 0; }
        }
        @keyframes rNoise {
          0%   { background-position: 0 0; }
          100% { background-position: 120px 120px; }
        }
      `}</style>
    </div>
  );
}

function ReceiptCameraFeed({ flash }) {
  return (
    <div style={{
      position: 'absolute', inset: 0, overflow: 'hidden',
      background: 'radial-gradient(ellipse at 50% 50%, #3a3530 0%, #1c1915 60%, #0a0806 100%)',
    }}>
      {/* Fake desk/table surface blur */}
      <div style={{
        position: 'absolute', left: '-10%', right: '-10%', top: '30%', bottom: 0,
        background: 'radial-gradient(ellipse at 50% 30%, rgba(180,160,130,.18), transparent 70%)',
        filter: 'blur(18px)',
      }}/>
      {/* Receipt silhouette under frame */}
      <div style={{
        position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%,-50%)',
        width: 215, height: 400, borderRadius: 4,
        background: 'linear-gradient(180deg, #d8d3c8 0%, #e6e1d6 50%, #c8c1b2 100%)',
        filter: 'blur(2px)', opacity: 0.55,
      }}/>
      {/* Vignette */}
      <div style={{
        position: 'absolute', inset: 0,
        background: 'radial-gradient(ellipse at center, transparent 35%, rgba(0,0,0,.65) 100%)',
      }}/>
      {/* Grain */}
      <div style={{
        position: 'absolute', inset: 0, opacity: 0.12, mixBlendMode: 'overlay',
        backgroundImage: `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='120' height='120'><filter id='n'><feTurbulence baseFrequency='0.9' numOctaves='2'/></filter><rect width='100%' height='100%' filter='url(%23n)' opacity='0.8'/></svg>")`,
        animation: 'rNoise 0.3s steps(4) infinite',
      }}/>
      {flash && (
        <div style={{
          position: 'absolute', inset: 0,
          background: 'radial-gradient(ellipse at center, rgba(255,248,220,.35) 0%, transparent 60%)',
        }}/>
      )}
    </div>
  );
}

// ——————————————————————————————————————————————————
// REVIEW — OCR-prefilled form confirming Markt/Datum/Summe
// ——————————————————————————————————————————————————
function ReceiptReview({ market, setMarket, date, setDate, total, setTotal, onRetake, onSubmit, onClose }) {
  return (
    <div style={{
      position: 'absolute', inset: 0, background: '#F7F8F6', color: COLORS.text,
      display: 'flex', flexDirection: 'column', zIndex: 30, fontFamily: F, overflow: 'auto',
    }}>
      {/* Header */}
      <div style={{
        position: 'sticky', top: 0, zIndex: 10,
        background: `linear-gradient(135deg, ${RECEIPT_GREEN_LIGHT}, #7bc0b3)`,
        color: '#0a3c35', padding: '14px 16px 16px',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button onClick={onRetake} aria-label="Neu aufnehmen" style={{
            width: 36, height: 36, borderRadius: 18,
            background: 'rgba(255,255,255,.5)', border: 0, cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <MdI name="arrow-left" size={20} color="#0a3c35"/>
          </button>
          <div style={{ flex: 1 }}>
            <div style={{ font: `700 11px ${F}`, opacity: .75, letterSpacing: .4, textTransform: 'uppercase' }}>
              Schritt 2 von 2
            </div>
            <div style={{ font: `800 17px ${F}`, marginTop: 1, letterSpacing: '-.01em' }}>
              Beleg prüfen
            </div>
          </div>
          <button onClick={onClose} aria-label="Abbrechen" style={{
            width: 36, height: 36, borderRadius: 18,
            background: 'rgba(255,255,255,.5)', border: 0, cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <MdI name="close" size={20} color="#0a3c35"/>
          </button>
        </div>
      </div>

      {/* Thumbnail preview */}
      <div style={{ padding: '16px 20px 0', display: 'flex', gap: 14 }}>
        <div style={{
          width: 76, height: 110, borderRadius: 8, flexShrink: 0,
          background: 'linear-gradient(180deg, #e6e1d6, #c8c1b2)',
          boxShadow: '0 4px 14px rgba(0,0,0,.12)',
          position: 'relative', overflow: 'hidden',
        }}>
          <div style={{
            position: 'absolute', top: 0, left: 0, right: 0, height: 4,
            background: `repeating-linear-gradient(90deg, transparent 0 4px, #b8b1a2 4px 6px)`,
          }}/>
          <div style={{ padding: 8, display: 'flex', flexDirection: 'column', gap: 3, marginTop: 4 }}>
            {Array.from({ length: 9 }).map((_, i) => (
              <div key={i} style={{ height: 2.5, background: 'rgba(50,45,40,.55)', width: `${50 + (i*13)%42}%`, borderRadius: 1 }}/>
            ))}
          </div>
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 5,
            background: RECEIPT_GREEN_TINT, color: RECEIPT_GREEN,
            padding: '3px 9px', borderRadius: 100,
            font: `700 10px ${F}`, letterSpacing: .3, textTransform: 'uppercase',
          }}>
            <MdI name="check-circle" size={11} color={RECEIPT_GREEN}/>
            OCR erfolgreich
          </div>
          <div style={{ font: `800 16px ${F}`, marginTop: 8, letterSpacing: '-.01em' }}>
            Bitte Angaben prüfen
          </div>
          <div style={{ font: `500 12px/1.45 ${F}`, color: COLORS.muted, marginTop: 4 }}>
            Wir haben die wichtigsten Felder automatisch erkannt. Korrigiere sie bei Bedarf.
          </div>
        </div>
      </div>

      {/* Form */}
      <div style={{ padding: '20px 20px 0' }}>
        <ReceiptField label="Markt"  icon="storefront-outline" value={market} onChange={setMarket}/>
        <div style={{ height: 12 }}/>
        <ReceiptField label="Datum"  icon="calendar-outline"   value={date}   onChange={setDate}/>
        <div style={{ height: 12 }}/>
        <ReceiptField label="Summe"  icon="cash-multiple"      value={total}  onChange={setTotal}/>
      </div>

      {/* Cashback card */}
      <div style={{ padding: '22px 20px 0' }}>
        <div style={{
          background: `linear-gradient(135deg, ${RECEIPT_GREEN}, #1c5c54)`,
          borderRadius: 14, padding: '14px 16px', color: '#fff',
          display: 'flex', alignItems: 'center', gap: 12,
        }}>
          <div style={{
            width: 44, height: 44, borderRadius: 22,
            background: 'rgba(255,255,255,.18)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <MdI name="cash-plus" size={24} color="#fff"/>
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ font: `800 16px ${F}` }}>+{RECEIPT_EUR_EACH.toFixed(2).replace('.', ',')} € Cashback</div>
            <div style={{ font: `500 11px ${F}`, opacity: .9, marginTop: 2 }}>
              Wird nach Freigabe deinem Guthaben gutgeschrieben (1–2 Tage).
            </div>
          </div>
        </div>
      </div>

      {/* Submit */}
      <div style={{ padding: '22px 20px 14px' }}>
        <button onClick={onSubmit} style={{
          width: '100%', height: 52, borderRadius: 13,
          background: RECEIPT_GREEN, color: '#fff', border: 0,
          font: `800 15px ${F}`, cursor: 'pointer',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
          boxShadow: `0 6px 18px ${RECEIPT_GREEN_LIGHT}80`,
        }}>
          <MdI name="upload" size={18} color="#fff"/>
          Beleg einreichen
        </button>
        <button onClick={onRetake} style={{
          width: '100%', marginTop: 10, background: 'transparent', border: 0,
          color: COLORS.muted, font: `700 13px ${F}`, cursor: 'pointer', padding: '10px 0',
        }}>
          Foto neu aufnehmen
        </button>
      </div>
    </div>
  );
}

function ReceiptField({ label, icon, value, onChange }) {
  return (
    <div>
      <div style={{
        font: `700 11px ${F}`, color: COLORS.muted,
        letterSpacing: .5, textTransform: 'uppercase', marginBottom: 6,
      }}>
        {label}
      </div>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10,
        background: '#fff', borderRadius: 11, padding: '0 14px',
        border: `1px solid ${RECEIPT_GREEN_TINT}`,
        height: 48,
      }}>
        <MdI name={icon} size={18} color={RECEIPT_GREEN}/>
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          style={{
            flex: 1, height: '100%', border: 0, outline: 'none', background: 'transparent',
            font: `600 14px ${F}`, color: COLORS.text,
          }}/>
      </div>
    </div>
  );
}

// ——————————————————————————————————————————————————
// DONE — success confirmation
// ——————————————————————————————————————————————————
function ReceiptSubmitted({ onClose, market, total }) {
  return (
    <div style={{
      position: 'absolute', inset: 0, background: '#F7F8F6', color: COLORS.text,
      display: 'flex', flexDirection: 'column', zIndex: 30, fontFamily: F,
    }}>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '0 32px', textAlign: 'center' }}>
        <div style={{
          width: 84, height: 84, borderRadius: 42,
          background: `linear-gradient(135deg, ${RECEIPT_GREEN_LIGHT}, ${RECEIPT_GREEN})`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: `0 10px 30px ${RECEIPT_GREEN_LIGHT}66`,
        }}>
          <MdI name="check" size={48} color="#fff"/>
        </div>
        <div style={{ font: `800 22px ${F}`, marginTop: 22, letterSpacing: '-.01em' }}>
          Beleg eingereicht!
        </div>
        <div style={{ font: `500 14px/1.5 ${F}`, color: COLORS.muted, marginTop: 8, maxWidth: 280 }}>
          Wir prüfen deinen Kassenbon von <b style={{ color: COLORS.text }}>{market}</b> über <b style={{ color: COLORS.text }}>{total}</b>. Die Freigabe dauert in der Regel 1–2 Tage.
        </div>

        <div style={{
          marginTop: 24, padding: '12px 18px',
          background: RECEIPT_GREEN_TINT, color: RECEIPT_GREEN,
          borderRadius: 100, font: `800 13px ${F}`,
          display: 'inline-flex', alignItems: 'center', gap: 6,
        }}>
          <MdI name="cash-plus" size={16} color={RECEIPT_GREEN}/>
          +{RECEIPT_EUR_EACH.toFixed(2).replace('.', ',')} € Cashback in Prüfung
        </div>
      </div>

      <div style={{ padding: '0 20px 28px' }}>
        <button onClick={onClose} style={{
          width: '100%', height: 52, borderRadius: 13,
          background: RECEIPT_GREEN, color: '#fff', border: 0,
          font: `800 15px ${F}`, cursor: 'pointer',
        }}>
          Fertig
        </button>
      </div>
    </div>
  );
}

Object.assign(window, { ReceiptScanner });
