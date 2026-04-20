// AppOnboarding.jsx — First-launch experience
// Flow: welcome → 5 questions → loading → savings reveal → done
// Explanation content moved to Home first-run welcome card.

const AO_F = window.F;
const AO_C = window.COLORS;

const AO_KEY   = 'md-app-onboard-seen';
const AO_ANSWERS_KEY = 'md-app-onboard-answers';

// ─── Public API ───────────────────────────────────────────
function aoShouldShow()  { try { return !localStorage.getItem(AO_KEY); } catch { return false; } }
function aoReset()       { try {
  localStorage.removeItem(AO_KEY);
  localStorage.removeItem(AO_ANSWERS_KEY);
  localStorage.removeItem('md-home-welcome-dismissed');
} catch {} }
function aoLoadAnswers() { try { return JSON.parse(localStorage.getItem(AO_ANSWERS_KEY) || '{}'); } catch { return {}; } }
function aoSaveAnswers(a){ try { localStorage.setItem(AO_ANSWERS_KEY, JSON.stringify(a)); } catch {} }

// ─── Data ─────────────────────────────────────────────────
const COUNTRIES = [
  { k: 'de', n: 'Deutschland', flag: '🇩🇪' },
  { k: 'ch', n: 'Schweiz',     flag: '🇨🇭' },
  { k: 'at', n: 'Österreich',  flag: '🇦🇹' },
];

// Supermarket "logos": little branded tiles (text + real brand color).
// Using text-based logos avoids trademark issues while keeping recognition.
const OB_MARKETS = [
  { k: 'aldi_nord', n: 'Aldi Nord', bg: '#00549f', fg: '#fff', label: 'ALDI\nNORD', accent: '#ff6600' },
  { k: 'penny',     n: 'Penny',     bg: '#c8102e', fg: '#fff', label: 'PENNY', accent: '#ffd100' },
  { k: 'aldi_sued', n: 'Aldi Süd',  bg: '#004b93', fg: '#fff', label: 'ALDI\nSÜD',  accent: '#ff9500' },
  { k: 'dm',        n: 'dm',        bg: '#fff', fg: '#004b93', label: 'dm', accent: '#ffd100' },
  { k: 'edeka',     n: 'EDEKA',     bg: '#ffd500', fg: '#004b93', label: 'EDEKA', accent: '#e10915' },
  { k: 'globus',    n: 'GLOBUS',    bg: '#fff', fg: '#ff8200', label: 'GLOBUS', accent: '#009845' },
  { k: 'kaufland',  n: 'Kaufland',  bg: '#e10915', fg: '#fff', label: 'Kaufland', accent: '#fff' },
  { k: 'lidl',      n: 'Lidl',      bg: '#0050aa', fg: '#ffd500', label: 'Lidl', accent: '#e10915' },
  { k: 'mueller',   n: 'Müller',    bg: '#fff', fg: '#e10915', label: 'Müller', accent: '#000' },
  { k: 'netto',     n: 'Netto',     bg: '#ffd500', fg: '#e10915', label: 'Netto', accent: '#000' },
  { k: 'rewe',      n: 'Rewe',      bg: '#cc071e', fg: '#fff', label: 'REWE', accent: '#ffd500' },
  { k: 'rossmann',  n: 'Rossmann',  bg: '#fff', fg: '#c8102e', label: 'Rossmann', accent: '#000' },
];

const SOURCES = [
  { k: 'instagram', n: 'Instagram', emoji: '📸' },
  { k: 'tiktok',    n: 'TikTok',    emoji: '🎵' },
  { k: 'youtube',   n: 'YouTube',   emoji: '📺' },
  { k: 'facebook',  n: 'Facebook',  emoji: '👥' },
  { k: 'friends',   n: 'Freunde/Familie', emoji: '👨‍👩‍👧' },
  { k: 'google',    n: 'Google',    emoji: '🔍' },
  { k: 'appstore',  n: 'App Store', emoji: '📱' },
  { k: 'other',     n: 'Sonstiges', emoji: '💭' },
];

const PRIORITIES = [
  { k: 'preis',     n: 'Preis',         emoji: '💰' },
  { k: 'inhalt',    n: 'Inhaltsstoffe', emoji: '🧪' },
  { k: 'qualitaet', n: 'Qualität',      emoji: '⭐' },
  { k: 'marke',     n: 'Marke',         emoji: '🏷️' },
  { k: 'marktnaehe',n: 'Marktnähe',     emoji: '📍' },
  { k: 'anderes',   n: 'Anderes',       emoji: '💭' },
];

const LOADING_MESSAGES = [
  { i: '🔍', t: 'Deine Lieblings­produkte werden analysiert…' },
  { i: '🏷️', t: 'Eigenmarken werden verknüpft…' },
  { i: '💰', t: 'Sparpotenzial wird berechnet…' },
  { i: '🕵️', t: 'Detektiv-Profil wird erstellt…' },
];

const STEPS = [
  'welcome', 'country', 'account', 'markets', 'source', 'spend', 'priorities', 'loading', 'reveal',
];

// ─── Portal ───────────────────────────────────────────────
function aoPortal(children) {
  if (typeof document === 'undefined') return children;
  if (!window.ReactDOM || !window.ReactDOM.createPortal) return children;
  const host = document.getElementById('__sheet_host');
  if (!host) return children;
  return window.ReactDOM.createPortal(children, host);
}

// ─── Root ─────────────────────────────────────────────────
function AppOnboarding({ onDone }) {
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => { setMounted(true); }, []);

  const [idx, setIdx] = React.useState(0);
  const [answers, setAnswers] = React.useState(() => ({
    country: '',
    accountChoice: '',   // 'guest' | 'register'
    markets: [],
    source: '',
    spendWeek: 80,
    priorities: [],
    ...aoLoadAnswers(),
  }));

  const update = (patch) => setAnswers((a) => {
    const next = { ...a, ...patch };
    aoSaveAnswers(next);
    return next;
  });

  const step = STEPS[idx];
  const stepNum = idx;           // 0..8
  const totalSurvey = 8;         // steps 1..8 show "X von 8"
  const isFirst = idx === 0;
  const isLast  = idx === STEPS.length - 1;

  const commit = () => {
    try { localStorage.setItem(AO_KEY, '1'); } catch {}
    onDone && onDone(answers);
  };
  const next = () => isLast ? commit() : setIdx(idx + 1);
  const back = () => { if (!isFirst) setIdx(idx - 1); };
  const skipAll = () => commit();

  // Auto-advance for loading step
  React.useEffect(() => {
    if (step !== 'loading') return;
    const t = setTimeout(() => setIdx((i) => i + 1), 3200);
    return () => clearTimeout(t);
  }, [step]);

  if (!mounted) return null;

  // Special-case welcome: full-bleed hero, own CTAs, no progress bar
  if (step === 'welcome') {
    return aoPortal(<StepWelcome onNext={next} onSkip={skipAll}/>);
  }

  // Special-case loading & reveal: no top chrome needed differently
  const showTopChrome = !(step === 'loading');
  const showBottomCTA = !(step === 'loading');

  // Validation: disable CTA when required fields empty
  const canAdvance = (() => {
    if (step === 'country')    return !!answers.country;
    if (step === 'account')    return !!answers.accountChoice;
    if (step === 'markets')    return answers.markets.length > 0;
    if (step === 'source')     return !!answers.source;
    if (step === 'priorities') return answers.priorities.length > 0;
    return true;
  })();

  return aoPortal(
    <div style={{
      position: 'absolute', inset: 0, zIndex: 80,
      background: 'var(--th-bg)',
      display: 'flex', flexDirection: 'column',
      fontFamily: AO_F,
      pointerEvents: 'auto',
    }}>
      {/* Top chrome: progress + skip */}
      {showTopChrome && (
        <div style={{ padding: '56px 20px 6px', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button onClick={back} disabled={isFirst} style={{
              width: 36, height: 36, borderRadius: 18, border: 0,
              cursor: isFirst ? 'default' : 'pointer',
              background: 'transparent', marginLeft: -8,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              opacity: isFirst ? 0 : 1,
            }}>
              <window.MdI name="arrow-left" size={20} color={AO_C.text}/>
            </button>
            <div style={{
              flex: 1, height: 6, background: 'var(--th-border-md)', borderRadius: 3, overflow: 'hidden',
            }}>
              <div style={{
                width: `${(stepNum / totalSurvey) * 100}%`, height: '100%',
                background: AO_C.primary, borderRadius: 3,
                transition: 'width .45s cubic-bezier(.2,.9,.2,1)',
              }}/>
            </div>
            <button onClick={skipAll} style={{
              height: 32, padding: '0 12px', borderRadius: 16, border: 0, cursor: 'pointer',
              background: 'transparent', color: AO_C.muted, font: `700 12px ${AO_F}`,
            }}>Überspringen</button>
          </div>
          <div style={{
            textAlign: 'center', font: `600 11px ${AO_F}`, color: AO_C.muted, marginTop: 6,
          }}>
            {stepNum} von {totalSurvey}
          </div>
        </div>
      )}

      {/* Content */}
      <div key={step} style={{ flex: 1, overflow: 'auto', animation: 'ao-fadein .3s ease-out' }}>
        {step === 'country'    && <StepCountry
                                     country={answers.country} setCountry={(v) => update({ country: v })}/>}
        {step === 'account'    && <StepAccount
                                     accountChoice={answers.accountChoice} setAccountChoice={(v) => update({ accountChoice: v })}/>}
        {step === 'markets'    && <StepMarkets value={answers.markets} setValue={(v) => update({ markets: v })}/>}
        {step === 'source'     && <StepSource  value={answers.source}  setValue={(v) => update({ source: v })}/>}
        {step === 'spend'      && <StepSpend   value={answers.spendWeek} setValue={(v) => update({ spendWeek: v })}/>}
        {step === 'priorities' && <StepPriorities value={answers.priorities} setValue={(v) => update({ priorities: v })}/>}
        {step === 'loading'    && <StepLoading/>}
        {step === 'reveal'     && <StepReveal answers={answers}/>}
      </div>

      {/* Bottom CTA */}
      {showBottomCTA && (
        <div style={{ padding: '14px 20px 28px', background: 'var(--th-bg)', flexShrink: 0 }}>
          <button onClick={next} disabled={!canAdvance} style={{
            width: '100%', height: 54, borderRadius: 14, border: 0,
            cursor: canAdvance ? 'pointer' : 'default',
            background: canAdvance ? AO_C.primary : '#a0c9c2',
            color: '#fff',
            font: `800 15px ${AO_F}`, letterSpacing: '-.01em',
            boxShadow: canAdvance ? '0 8px 18px rgba(13,133,117,.3)' : 'none',
            transition: 'all .2s',
          }}>
            {step === 'reveal' ? 'Fantastisch! Weiter' : 'Weiter'}
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Step: Welcome (full-bleed hero) ──────────────────────
function StepWelcome({ onNext, onSkip }) {
  return (
    <div style={{
      position: 'absolute', inset: 0, zIndex: 80,
      background: '#4a5256',
      fontFamily: AO_F,
      overflow: 'hidden',
      display: 'flex', flexDirection: 'column',
      pointerEvents: 'auto',
    }}>
      {/* Hero background — photo of groceries */}
      <div style={{
        position: 'absolute', inset: 0,
        backgroundImage: `linear-gradient(180deg, rgba(74,82,86,.3) 0%, rgba(74,82,86,.15) 30%, rgba(25,28,29,.5) 75%, rgba(25,28,29,.85) 100%), url('https://images.unsplash.com/photo-1542838132-92c53300491e?w=900&q=85')`,
        backgroundSize: 'cover',
        backgroundPosition: 'center bottom',
      }}/>

      {/* Fallback SVG pattern if image fails — paper texture */}
      <div style={{
        position: 'absolute', inset: 0,
        background: `repeating-radial-gradient(circle at 30% 20%, rgba(255,255,255,.02) 0, rgba(255,255,255,.02) 2px, transparent 2px, transparent 6px)`,
        mixBlendMode: 'overlay',
      }}/>

      {/* Content */}
      <div style={{ position: 'relative', flex: 1, display: 'flex', flexDirection: 'column', padding: '60px 28px 28px' }}>
        {/* Top: Logo + brand */}
        <div style={{ textAlign: 'center', marginTop: 20 }}>
          <div style={{
            display: 'inline-flex', width: 86, height: 86, borderRadius: 22,
            background: 'rgba(255,255,255,.08)',
            backdropFilter: 'blur(12px)',
            border: '1.5px solid rgba(255,255,255,.2)',
            alignItems: 'center', justifyContent: 'center',
            marginBottom: 18,
            boxShadow: '0 10px 30px rgba(0,0,0,.3)',
          }}>
            <window.DetectiveMark size={48} color="#fff"/>
          </div>
          <div style={{
            font: `900 22px ${AO_F}`, color: '#fff', letterSpacing: '-.02em',
            textShadow: '0 2px 8px rgba(0,0,0,.3)',
          }}>
            Marken<span style={{ fontWeight: 400 }}>Detektive</span>
          </div>
          <div style={{
            font: `500 14px ${AO_F}`, color: 'color-mix(in srgb, var(--th-card) 85%, transparent)',
            marginTop: 8, textShadow: '0 1px 6px rgba(0,0,0,.4)',
          }}>
            NoNames enttarnen, clever sparen!
          </div>
        </div>

        <div style={{ flex: 1 }}/>

        {/* Bottom: CTAs */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <button onClick={onNext} style={{
            width: '100%', height: 54, borderRadius: 14, border: 0, cursor: 'pointer',
            background: AO_C.primary, color: '#fff',
            font: `800 15px ${AO_F}`, letterSpacing: '-.01em',
            boxShadow: '0 10px 24px rgba(13,133,117,.4)',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
          }}>
            Los geht's! 🚀
          </button>
          <button onClick={onSkip} style={{
            width: '100%', height: 50, borderRadius: 14,
            background: 'rgba(255,255,255,.08)',
            backdropFilter: 'blur(10px)',
            border: '1.5px solid rgba(255,255,255,.3)',
            color: '#fff', cursor: 'pointer',
            font: `700 14px ${AO_F}`,
          }}>
            Später
          </button>
          <div style={{
            textAlign: 'center', font: `500 11px ${AO_F}`,
            color: 'rgba(255,255,255,.75)', marginTop: 6,
            textShadow: '0 1px 4px rgba(0,0,0,.4)',
          }}>
            Wir zeigen dir, wer dahinter steckt!
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Step: Country ────────────────────────────────────────
function StepCountry({ country, setCountry }) {
  return (
    <div style={{ padding: '10px 24px 24px' }}>
      <StepHeader title="Wähle dein Land" sub="In welchem Land kaufst du ein?"/>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 22 }}>
        {COUNTRIES.map((c) => {
          const on = country === c.k;
          return (
            <button key={c.k} onClick={() => setCountry(c.k)} style={{
              width: '100%', height: 76,
              borderRadius: 16, padding: '0 22px',
              background: on ? '#e8f5f2' : 'var(--th-card)',
              border: `2px solid ${on ? AO_C.primary : 'var(--th-border-md)'}`,
              cursor: 'pointer', position: 'relative',
              display: 'flex', flexDirection: 'row',
              alignItems: 'center', justifyContent: 'flex-start', gap: 16,
              transition: 'all .2s',
            }}>
              <span style={{ fontSize: 36 }}>{c.flag}</span>
              <span style={{
                font: `800 17px ${AO_F}`,
                color: on ? AO_C.primary : AO_C.text, letterSpacing: '-.01em',
              }}>{c.n}</span>
              {on && (
                <div style={{
                  position: 'absolute', top: '50%', right: 16, transform: 'translateY(-50%)',
                  width: 28, height: 28, borderRadius: 14, background: AO_C.primary,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <window.MdI name="check" size={18} color="#fff"/>
                </div>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─── Step: Account ────────────────────────────────────────
function StepAccount({ accountChoice, setAccountChoice }) {
  return (
    <div style={{ padding: '10px 24px 24px' }}>
      <StepHeader
        title="Wie möchtest du fortfahren?"
        sub="Erstelle ein Konto für das beste App-Erlebnis — oder starte direkt ohne Registrierung."
      />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 22 }}>
        {/* Recommended: Register */}
        <button onClick={() => setAccountChoice('register')} style={{
          width: '100%', borderRadius: 16, padding: '18px 18px',
          background: accountChoice === 'register' ? '#e8f5f2' : '#fff',
          border: `2px solid ${accountChoice === 'register' ? AO_C.primary : 'var(--th-border-md)'}`,
          cursor: 'pointer', position: 'relative',
          display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-start',
          textAlign: 'left',
          transition: 'all .2s',
        }}>
          <div style={{
            position: 'absolute', top: -10, right: 14,
            background: AO_C.primary, color: '#fff',
            font: `800 9px ${AO_F}`, letterSpacing: '.06em',
            padding: '4px 10px', borderRadius: 10,
          }}>EMPFOHLEN</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%' }}>
            <div style={{
              width: 36, height: 36, borderRadius: 10, background: AO_C.primary,
              display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
            }}>
              <window.MdI name="account-circle" size={22} color="#fff"/>
            </div>
            <div style={{ font: `900 16px ${AO_F}`, color: AO_C.text, letterSpacing: '-.01em' }}>
              Registrieren / Login
            </div>
            {accountChoice === 'register' && (
              <div style={{
                marginLeft: 'auto',
                width: 26, height: 26, borderRadius: 13, background: AO_C.primary,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <window.MdI name="check" size={16} color="#fff"/>
              </div>
            )}
          </div>
          <div style={{ font: `500 12px/1.4 ${AO_F}`, color: AO_C.muted, paddingLeft: 46 }}>
            Belege synchron, Rewards sammeln, Daten sicher übertragen.
          </div>
        </button>

        {/* Alternative: Guest */}
        <button onClick={() => setAccountChoice('guest')} style={{
          width: '100%', borderRadius: 16, padding: '16px 18px',
          background: accountChoice === 'guest' ? '#e8f5f2' : '#fff',
          border: `2px solid ${accountChoice === 'guest' ? AO_C.primary : 'var(--th-border-md)'}`,
          cursor: 'pointer', position: 'relative',
          display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-start',
          textAlign: 'left',
          transition: 'all .2s',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%' }}>
            <div style={{
              width: 36, height: 36, borderRadius: 10, background: 'var(--th-border)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
            }}>
              <window.MdI name="incognito" size={20} color={AO_C.text}/>
            </div>
            <div style={{ font: `900 16px ${AO_F}`, color: AO_C.text, letterSpacing: '-.01em' }}>
              Ohne Account fortfahren
            </div>
            {accountChoice === 'guest' && (
              <div style={{
                marginLeft: 'auto',
                width: 26, height: 26, borderRadius: 13, background: AO_C.primary,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <window.MdI name="check" size={16} color="#fff"/>
              </div>
            )}
          </div>
          <div style={{ font: `500 12px/1.4 ${AO_F}`, color: AO_C.muted, paddingLeft: 46 }}>
            Schnellstart ohne E-Mail. Du kannst dich später jederzeit registrieren.
          </div>
        </button>
      </div>
    </div>
  );
}

// ─── Step: Markets ────────────────────────────────────────
function StepMarkets({ value, setValue }) {
  const toggle = (k) => {
    if (value.includes(k)) setValue(value.filter((x) => x !== k));
    else if (value.length < 3) setValue([...value, k]);
  };
  return (
    <div style={{ padding: '10px 24px 24px' }}>
      <StepHeader
        title="Wo kaufst du am liebsten ein?"
        sub={`${value.length}/3 ausgewählt`}
        subColor={AO_C.primary}
      />
      <div style={{
        display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10,
        marginTop: 18,
      }}>
        {OB_MARKETS.map((m) => {
          const on = value.includes(m.k);
          return (
            <button key={m.k} onClick={() => toggle(m.k)} style={{
              background: 'var(--th-card)', borderRadius: 14, padding: 0,
              border: `2px solid ${on ? AO_C.primary : 'var(--th-border)'}`,
              cursor: 'pointer', position: 'relative',
              boxShadow: '0 1px 3px rgba(25,28,29,.04)',
              overflow: 'hidden',
              transition: 'all .15s',
            }}>
              {/* Logo chip */}
              <div style={{
                height: 66, display: 'flex', alignItems: 'center', justifyContent: 'center',
                padding: '10px 8px',
              }}>
                <MarketLogo m={m}/>
              </div>
              {/* Name */}
              <div style={{
                padding: '8px 8px 12px', font: `700 13px ${AO_F}`,
                color: AO_C.text, letterSpacing: '-.01em',
                borderTop: '1px solid rgba(25,28,29,.04)',
              }}>{m.n}</div>
              {on && (
                <div style={{
                  position: 'absolute', top: 8, right: 8,
                  width: 24, height: 24, borderRadius: 12, background: AO_C.primary,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  boxShadow: '0 2px 6px rgba(13,133,117,.4)',
                }}>
                  <window.MdI name="check" size={14} color="#fff"/>
                </div>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function MarketLogo({ m }) {
  // Mini faux-logo tile that hints at each brand
  return (
    <div style={{
      width: 82, height: 46, borderRadius: 6, background: m.bg,
      border: m.bg === '#fff' ? '1px solid rgba(0,0,0,.1)' : 'none',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      font: `900 13px/1 ${AO_F}`, color: m.fg,
      letterSpacing: '-.02em', textAlign: 'center', whiteSpace: 'pre-line',
      position: 'relative',
    }}>
      {m.label}
    </div>
  );
}

// ─── Step: Source ─────────────────────────────────────────
function StepSource({ value, setValue }) {
  return (
    <div style={{ padding: '10px 24px 24px' }}>
      <StepHeader title="Wie hast du von uns gehört?"/>
      <div style={{
        display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10,
        marginTop: 18,
      }}>
        {SOURCES.map((s) => {
          const on = value === s.k;
          return (
            <button key={s.k} onClick={() => setValue(s.k)} style={{
              background: on ? '#e8f5f2' : 'var(--th-card)',
              borderRadius: 14, height: 94,
              border: `2px solid ${on ? AO_C.primary : 'var(--th-border)'}`,
              cursor: 'pointer', position: 'relative',
              display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'center', gap: 6,
              boxShadow: '0 1px 3px rgba(25,28,29,.04)',
              transition: 'all .15s',
            }}>
              <span style={{ fontSize: 28, lineHeight: 1 }}>{s.emoji}</span>
              <span style={{ font: `700 13px ${AO_F}`, color: on ? AO_C.primary : AO_C.text }}>{s.n}</span>
              {on && (
                <div style={{
                  position: 'absolute', top: 8, right: 8,
                  width: 22, height: 22, borderRadius: 11, background: AO_C.primary,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <window.MdI name="check" size={13} color="#fff"/>
                </div>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─── Step: Spend (weekly grocery budget) ──────────────────
function StepSpend({ value, setValue }) {
  const MIN = 20, MAX = 300, STEP_SIZE = 5;
  const v = Math.max(MIN, Math.min(MAX, value || MIN));
  const pct = ((v - MIN) / (MAX - MIN)) * 100;
  const presets = [40, 60, 80, 120, 180];
  return (
    <div style={{ padding: '10px 24px 24px' }}>
      <StepHeader
        title="Was gibst du pro Woche für Lebens­mittel aus?"
        sub="Damit berechnen wir, wie viel du mit MarkenDetektive sparen kannst."
      />
      <div style={{
        background: 'var(--th-card)', borderRadius: 20, padding: '24px 20px',
        border: '1px solid var(--th-border)', marginTop: 18,
      }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{
            font: `900 56px/1 ${AO_F}`, color: AO_C.primary, letterSpacing: '-.03em',
          }}>
            {v}<span style={{ fontSize: 28 }}>€</span>
          </div>
          <div style={{ font: `600 12px ${AO_F}`, color: AO_C.muted, marginTop: 4 }}>pro Woche</div>
        </div>

        {/* Slider */}
        <div style={{ position: 'relative', height: 36, marginTop: 22 }}>
          <div style={{ position: 'absolute', left: 0, right: 0, top: 16, height: 6,
            borderRadius: 3, background: 'var(--th-border-md)', pointerEvents: 'none' }}/>
          <div style={{ position: 'absolute', left: 0, top: 16, height: 6, width: `${pct}%`,
            borderRadius: 3, background: AO_C.primary, pointerEvents: 'none' }}/>
          <input
            type="range" min={MIN} max={MAX} step={STEP_SIZE} value={v}
            onChange={(e) => setValue(Number(e.target.value))}
            onInput={(e) => setValue(Number(e.target.value))}
            className="ao-range"
            style={{
              position: 'absolute', inset: 0, width: '100%', height: '100%',
              appearance: 'none', WebkitAppearance: 'none',
              background: 'transparent', border: 0, margin: 0, padding: 0,
              cursor: 'pointer',
            }}/>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', font: `600 11px ${AO_F}`, color: AO_C.muted, marginTop: 4 }}>
          <span>{MIN} €</span><span>{MAX} €+</span>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
        {presets.map((p) => {
          const on = v === p;
          return (
            <button key={p} onClick={() => setValue(p)} style={{
              flex: '1 1 auto', minWidth: 58, height: 40, borderRadius: 10,
              background: on ? AO_C.primary : 'var(--th-card)',
              color: on ? 'var(--th-card)' : AO_C.text,
              border: `1px solid ${on ? AO_C.primary : 'var(--th-border-md)'}`,
              cursor: 'pointer', font: `700 13px ${AO_F}`,
            }}>{p} €</button>
          );
        })}
      </div>
    </div>
  );
}

// ─── Step: Priorities ─────────────────────────────────────
function StepPriorities({ value, setValue }) {
  const toggle = (k) => {
    if (value.includes(k)) setValue(value.filter((x) => x !== k));
    else if (value.length < 3) setValue([...value, k]);
  };
  return (
    <div style={{ padding: '10px 24px 24px' }}>
      <StepHeader
        title="Was ist dir beim Einkauf wichtig?"
        sub={`Wähle bis zu 3 Aspekte · ${value.length}/3 ausgewählt`}
        subColor={value.length > 0 ? AO_C.primary : AO_C.muted}
      />
      <div style={{
        display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10,
        marginTop: 18,
      }}>
        {PRIORITIES.map((p) => {
          const on = value.includes(p.k);
          return (
            <button key={p.k} onClick={() => toggle(p.k)} style={{
              background: on ? '#e8f5f2' : 'var(--th-card)',
              borderRadius: 14, height: 104,
              border: `2px solid ${on ? AO_C.primary : 'var(--th-border)'}`,
              cursor: 'pointer', position: 'relative',
              display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'center', gap: 8,
              boxShadow: '0 1px 3px rgba(25,28,29,.04)',
              transition: 'all .15s',
            }}>
              <span style={{ fontSize: 32, lineHeight: 1 }}>{p.emoji}</span>
              <span style={{ font: `700 14px ${AO_F}`, color: on ? AO_C.primary : AO_C.text }}>{p.n}</span>
              {on && (
                <div style={{
                  position: 'absolute', top: 8, right: 8,
                  width: 22, height: 22, borderRadius: 11, background: AO_C.primary,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <window.MdI name="check" size={13} color="#fff"/>
                </div>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─── Step: Loading (auto-advance) ─────────────────────────
function StepLoading() {
  const [msgIdx, setMsgIdx] = React.useState(0);
  const [pct, setPct] = React.useState(0);
  React.useEffect(() => {
    const start = performance.now();
    let raf;
    const tick = (now) => {
      const t = Math.min(1, (now - start) / 3000);
      setPct(t * 100);
      setMsgIdx(Math.min(LOADING_MESSAGES.length - 1, Math.floor(t * LOADING_MESSAGES.length)));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
  const m = LOADING_MESSAGES[Math.max(0, Math.min(LOADING_MESSAGES.length - 1, msgIdx))] || LOADING_MESSAGES[0];

  return (
    <div style={{
      minHeight: '100%', display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center', padding: '40px 24px',
    }}>
      <div style={{ fontSize: 56, marginBottom: 24, animation: 'ao-hourglass 1.4s ease-in-out infinite' }}>⏳</div>
      <div style={{
        font: `900 22px ${AO_F}`, color: AO_C.text, letterSpacing: '-.02em', textAlign: 'center',
      }}>
        MarkenDetektive am Werk
      </div>
      <div style={{
        font: `500 14px ${AO_F}`, color: AO_C.muted, marginTop: 8, textAlign: 'center',
      }}>
        Wir optimieren dein App-Erlebnis
      </div>

      <div key={msgIdx} style={{
        marginTop: 36, font: `500 14px ${AO_F}`, color: AO_C.text,
        animation: 'ao-slidein .4s ease-out',
      }}>
        <span style={{ marginRight: 6 }}>{m.i}</span>
        {m.t}
      </div>

      <div style={{
        width: '70%', maxWidth: 260, height: 6, borderRadius: 3,
        background: 'var(--th-border-md)', marginTop: 20, overflow: 'hidden',
      }}>
        <div style={{
          width: `${pct}%`, height: '100%', background: AO_C.primary,
          borderRadius: 3, transition: 'width .1s linear',
        }}/>
      </div>
    </div>
  );
}

// ─── Step: Reveal (confetti + savings) ────────────────────
function StepReveal({ answers }) {
  const spendWeek = answers.spendWeek || 80;
  const [shown, setShown] = React.useState(0);
  const perYear  = spendWeek * 52;
  const saving   = Math.round(perYear * 0.35);
  const perMonth = Math.round(saving / 12);
  const perWeek  = Math.round(saving / 52);

  React.useEffect(() => {
    const start = performance.now();
    const dur = 1500;
    let raf;
    const tick = (now) => {
      const t = Math.min(1, (now - start) / dur);
      const eased = 1 - Math.pow(1 - t, 3);
      setShown(Math.round(saving * eased));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [saving]);

  return (
    <div style={{ position: 'relative', padding: '10px 24px 24px' }}>
      {/* Confetti overlay */}
      <Confetti/>

      <div style={{ position: 'relative', textAlign: 'center', marginTop: 8 }}>
        <div style={{ fontSize: 48, lineHeight: 1, marginBottom: 10 }}>💰</div>
        <h1 style={{
          font: `900 28px ${AO_F}`, color: AO_C.text, margin: 0, letterSpacing: '-.02em',
        }}>Dein Sparpotenzial!</h1>
        <p style={{
          font: `500 13px ${AO_F}`, color: AO_C.muted, margin: '8px 0 0',
        }}>Basierend auf deinem Wocheneinkauf von {spendWeek} €</p>
      </div>

      {/* Big savings card */}
      <div style={{
        background: 'var(--th-card)', borderRadius: 20, padding: '24px 20px', marginTop: 24,
        border: '1px solid var(--th-border)', textAlign: 'center',
        boxShadow: '0 8px 24px rgba(25,28,29,.06)',
      }}>
        <div style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          font: `800 12px ${AO_F}`, color: AO_C.primary, letterSpacing: .5,
        }}>
          🏆 Deine Jahresersparnis
        </div>
        <div style={{
          font: `900 56px/1 ${AO_F}`, color: AO_C.primary, letterSpacing: '-.03em', marginTop: 10,
        }}>
          {shown.toLocaleString('de-DE')}<span style={{ fontSize: 32 }}>€</span>
        </div>
        <div style={{ font: `600 13px ${AO_F}`, color: AO_C.text, marginTop: 8 }}>
          Das sind <b>{perMonth} €</b> jeden Monat!
        </div>
      </div>

      {/* Month/Week breakdown */}
      <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
        <div style={{
          flex: 1, background: 'var(--th-card)', borderRadius: 16, padding: '18px 14px',
          border: '1px solid var(--th-border)', textAlign: 'center',
        }}>
          <div style={{ font: `900 28px ${AO_F}`, color: AO_C.primary, letterSpacing: '-.02em' }}>
            {perMonth}€
          </div>
          <div style={{ font: `600 12px ${AO_F}`, color: AO_C.muted, marginTop: 2 }}>pro Monat</div>
        </div>
        <div style={{
          flex: 1, background: 'var(--th-card)', borderRadius: 16, padding: '18px 14px',
          border: '1px solid var(--th-border)', textAlign: 'center',
        }}>
          <div style={{ font: `900 28px ${AO_F}`, color: AO_C.primary, letterSpacing: '-.02em' }}>
            {perWeek}€
          </div>
          <div style={{ font: `600 12px ${AO_F}`, color: AO_C.muted, marginTop: 2 }}>pro Woche</div>
        </div>
      </div>
    </div>
  );
}

function Confetti() {
  // Simple confetti — 40 colored squares raining
  const pieces = React.useMemo(() => {
    const colors = ['#0d8575', '#ffd500', '#e10915', '#8b5cf6', '#f7a600', '#48bb78'];
    return Array.from({ length: 50 }, (_, i) => ({
      id: i,
      x: Math.random() * 100,
      delay: Math.random() * 1.5,
      dur: 2.4 + Math.random() * 1.8,
      color: colors[i % colors.length],
      size: 6 + Math.random() * 8,
      rot: Math.random() * 360,
    }));
  }, []);
  return (
    <div style={{
      position: 'absolute', top: -20, left: 0, right: 0, height: 220,
      pointerEvents: 'none', overflow: 'hidden',
    }}>
      {pieces.map((p) => (
        <div key={p.id} style={{
          position: 'absolute', top: -20, left: `${p.x}%`,
          width: p.size, height: p.size * 0.6, background: p.color,
          borderRadius: 2,
          transform: `rotate(${p.rot}deg)`,
          animation: `ao-fall ${p.dur}s ${p.delay}s ease-in infinite`,
        }}/>
      ))}
    </div>
  );
}

// ─── Shared bits ──────────────────────────────────────────
function StepHeader({ title, sub, subColor }) {
  return (
    <div>
      <h1 style={{
        font: `900 22px/1.25 ${AO_F}`, color: AO_C.text, margin: 0, letterSpacing: '-.02em',
      }}>{title}</h1>
      {sub && (
        <p style={{
          font: `500 13px/1.45 ${AO_F}`, color: subColor || AO_C.muted,
          margin: '8px 0 0',
        }}>{sub}</p>
      )}
    </div>
  );
}

// ─── Styles ───────────────────────────────────────────────
(function injectAOStyles() {
  if (typeof document === 'undefined' || document.getElementById('ao-styles')) return;
  const st = document.createElement('style');
  st.id = 'ao-styles';
  st.textContent = `
    @keyframes ao-fadein{from{opacity:0}to{opacity:1}}
    @keyframes ao-slidein{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}
    @keyframes ao-hourglass{0%{transform:rotate(0)}50%{transform:rotate(180deg)}100%{transform:rotate(360deg)}}
    @keyframes ao-fall{
      0%{transform:translateY(-30px) rotate(0deg);opacity:0}
      10%{opacity:1}
      100%{transform:translateY(240px) rotate(540deg);opacity:.9}
    }
    .ao-range{ -webkit-appearance:none; appearance:none; }
    .ao-range::-webkit-slider-runnable-track{ background:transparent; height:100%; }
    .ao-range::-moz-range-track{ background:transparent; height:100%; }
    .ao-range::-webkit-slider-thumb{
      -webkit-appearance:none; appearance:none;
      width:28px; height:28px; border-radius:14px;
      background:#fff; border:3px solid #0D8575;
      box-shadow:0 3px 8px rgba(13,133,117,.25);
      cursor:pointer; margin-top:0;
    }
    .ao-range::-moz-range-thumb{
      width:28px; height:28px; border-radius:14px;
      background:#fff; border:3px solid #0D8575;
      box-shadow:0 3px 8px rgba(13,133,117,.25);
      cursor:pointer;
    }
    .ao-range:focus{ outline:none; }
  `;
  document.head.appendChild(st);
})();

Object.assign(window, {
  AppOnboarding,
  aoShouldShowAppOnboarding: aoShouldShow,
  aoResetAppOnboarding: aoReset,
  aoLoadAnswers,
});
