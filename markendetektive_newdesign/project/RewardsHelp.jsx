// RewardsHelp.jsx — explains the Rewards system
// 3 surfaces:
//  1) InfoIcon — small (i) next to terms; opens a compact bottom sheet explaining one concept
//  2) RewardsHelpPage — dedicated full "So funktioniert's" page, opens from a toolbar button
//  3) RewardsOnboarding — one-time coachmark overlay on first Rewards visit

const RH_F = window.F;
const RH_C = window.COLORS;

// ─────────────────────────────────────────────────────────────
// Content — friendly, du-Ansprache, coachend
// ─────────────────────────────────────────────────────────────
const HELP = {
  taler: {
    title: 'Cashback-Taler',
    icon: 'cash',
    color: '#0d8575',
    summary: 'Echtes Geld zurück für deine Einkäufe.',
    body: [
      'Taler sind echtes Geld, das du dir auszahlen lassen kannst. Du sammelst sie, indem du aktiv hilfst, die NoName-Welt zu kartieren.',
      'Sobald du 15 € erreicht hast, kannst du sie dir auf dein Konto überweisen lassen.',
    ],
  },
  points: {
    title: 'Detektiv-Punkte',
    icon: 'star-four-points',
    color: '#e0a800',
    summary: 'Dein Spielstand — zeigt, wie aktiv du bist.',
    body: [
      'Detektiv-Punkte sind kein Geld, sondern dein Level-Fortschritt. Sie bestimmen deinen Rang und platzieren dich auf der Bestenliste.',
      'Jede Aktion in der App gibt Punkte — kleine Gewohnheiten wie Scannen oder Favoriten zählen auch.',
    ],
  },
  threshold: {
    title: 'Auszahlungsschwelle',
    icon: 'bank-transfer',
    color: '#0d8575',
    summary: 'Ab 15 € Taler auszahlbar.',
    body: [
      'Damit die Überweisung sich lohnt, kannst du erst ab 15 € Taler auszahlen. Darunter sammelst du weiter.',
      'Die Auszahlung dauert in der Regel 2-3 Werktage auf dein hinterlegtes Konto.',
    ],
  },
  earnTaler: {
    title: 'Taler verdienen',
    icon: 'hand-coin',
    color: '#0d8575',
    summary: 'Drei Aktionen geben Taler.',
    body: [
      '🧾 Kassenbon einreichen: 0,08 € pro gültigem Bon.',
      '📷 Produktbilder: 0,10 € je Foto-Set (6 Fotos).',
      '📊 Umfragen: wenn verfügbar, pro Umfrage bis zu 1,50 €.',
      'Nur diese drei Aktionen geben dir Taler — alles andere gibt Punkte.',
    ],
  },
  earnPoints: {
    title: 'Punkte verdienen',
    icon: 'trending-up',
    color: '#e0a800',
    summary: 'Viele kleine Aktionen geben Punkte.',
    body: [
      'Produkte scannen: +2 Pkt je Scan.',
      'Favoriten speichern: +1 Pkt pro Produkt.',
      'Streaks: Täglich die App öffnen gibt Bonus-Punkte — bleib dran!',
      'Je mehr du forschst, desto höher dein Level.',
    ],
  },
  leaderboard: {
    title: 'Level & Bestenliste',
    icon: 'trophy-outline',
    color: '#7c4dff',
    summary: 'Messen dich mit Freunden und deiner Region.',
    body: [
      'Jedes Level schaltet neue Fähigkeiten frei. Mit mehr Punkten steigst du auf.',
      'In der Bestenliste siehst du, wer in deinem Freundeskreis oder Bundesland am aktivsten ist.',
      'Kein Druck — wir zeigen dir nur, wo du stehst.',
    ],
  },
  achievements: {
    title: 'Abzeichen',
    icon: 'medal-outline',
    color: '#FF9500',
    summary: 'Extra-Punkte für besondere Meilensteine.',
    body: [
      'Abzeichen feiern deine Erfolge: Erster Scan, 100 € gespart, 30-Tage-Streak uvm.',
      'Jedes freigeschaltete Abzeichen gibt dir zusätzliche Detektiv-Punkte.',
    ],
  },
  season: {
    title: 'Saison-Reset',
    icon: 'calendar-refresh',
    color: '#2d1b60',
    summary: 'Jeden Monat starten die Ranglisten neu.',
    body: [
      'Am Monatsende werden die Monats-Ranglisten zurückgesetzt — jeder bekommt eine neue Chance.',
      'Top-3 jeder Saison bekommen einen Bonus von 10 € Taler.',
      'Deine All-Time-Punkte bleiben davon unberührt.',
    ],
  },
};

// ─────────────────────────────────────────────────────────────
// InfoIcon — small (i) bubble next to a term
// ─────────────────────────────────────────────────────────────
function InfoIcon({ concept, size = 16, color, onOpen }) {
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onOpen(concept); }}
      aria-label="Erklärung anzeigen"
      style={{
        width: size + 6, height: size + 6, padding: 0, flexShrink: 0,
        borderRadius: '50%', border: 0, background: 'transparent',
        cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        verticalAlign: 'middle',
      }}
    >
      <window.MdI name="information-outline" size={size} color={color || RH_C.muted}/>
    </button>
  );
}

// ─────────────────────────────────────────────────────────────
// Portal helper — attaches overlay to phone frame's sheet host
// ─────────────────────────────────────────────────────────────
function portalToSheetHost(children) {
  if (typeof document === 'undefined') return children;
  const host = document.getElementById('__sheet_host');
  if (!host || !window.ReactDOM || !window.ReactDOM.createPortal) return children;
  return window.ReactDOM.createPortal(children, host);
}

// ─────────────────────────────────────────────────────────────
// InfoSheet — compact bottom sheet for one concept
// ─────────────────────────────────────────────────────────────
function InfoSheet({ concept, onClose, onOpenHelp }) {
  if (!concept) return null;
  const c = HELP[concept];
  if (!c) return null;

  return portalToSheetHost(
    <div onClick={onClose} style={{
      position: 'absolute', inset: 0, zIndex: 60,
      background: 'rgba(25,28,29,.45)', display: 'flex', alignItems: 'flex-end',
      pointerEvents: 'auto',
      animation: 'rh-fadein .2s ease-out both',
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        width: '100%', background: '#F9FAFB',
        borderRadius: '22px 22px 0 0',
        padding: '10px 0 20px',
        animation: 'rh-slideup .26s cubic-bezier(.2,.9,.2,1) both',
        boxShadow: '0 -12px 40px rgba(0,0,0,.18)',
        maxHeight: '85%', display: 'flex', flexDirection: 'column',
      }}>
        {/* handle */}
        <div style={{ width: 36, height: 4, borderRadius: 2, background: '#d6d8da', margin: '4px auto 14px', flexShrink: 0 }}/>

        {/* header */}
        <div style={{ padding: '0 20px 14px', display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{
            width: 44, height: 44, borderRadius: 12,
            background: c.color + '1a',
            display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
          }}>
            <window.MdI name={c.icon} size={22} color={c.color}/>
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h3 style={{ margin: 0, font: `800 18px ${RH_F}`, color: RH_C.text, letterSpacing: '-.01em' }}>
              {c.title}
            </h3>
            <div style={{ font: `500 13px ${RH_F}`, color: RH_C.muted, marginTop: 2 }}>{c.summary}</div>
          </div>
          <button onClick={onClose} style={{
            width: 32, height: 32, borderRadius: 16, border: 0, background: 'rgba(25,28,29,.06)',
            cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
          }}>
            <window.MdI name="close" size={16} color={RH_C.text}/>
          </button>
        </div>

        {/* body */}
        <div style={{ padding: '0 20px', overflowY: 'auto' }}>
          {c.body.map((p, i) => (
            <p key={i} style={{
              margin: i === 0 ? '0 0 10px' : '0 0 10px',
              font: `500 14px/1.55 ${RH_F}`, color: RH_C.text,
            }}>{p}</p>
          ))}
        </div>

        {/* footer link */}
        {onOpenHelp && (
          <div style={{ padding: '6px 20px 0' }}>
            <button onClick={() => { onClose(); onOpenHelp(); }} style={{
              width: '100%', height: 44, borderRadius: 12, border: 0, cursor: 'pointer',
              background: 'rgba(13,133,117,.08)', color: RH_C.primary,
              font: `700 13px ${RH_F}`,
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            }}>
              Alle Belohnungen-Regeln ansehen
              <window.MdI name="arrow-right" size={16} color={RH_C.primary}/>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// RewardsHelpPage — full "So funktioniert's" page
// ─────────────────────────────────────────────────────────────
function RewardsHelpPage({ onBack, onResetOnboarding }) {
  const sections = [
    { k: 'taler' }, { k: 'points' }, { k: 'earnTaler' }, { k: 'threshold' },
    { k: 'earnPoints' }, { k: 'leaderboard' }, { k: 'achievements' }, { k: 'season' },
  ];
  return (
    <div style={{ fontFamily: RH_F, background: '#F9FAFB', minHeight: '100%', paddingBottom: 110 }}>
      {/* header — matches app PageHeader */}
      <div style={{
        position: 'sticky', top: 0, zIndex: 10, background: '#F9FAFB',
        padding: '18px 20px 10px', display: 'flex', alignItems: 'center', gap: 10,
      }}>
        <button onClick={onBack} style={{
          width: 40, height: 40, borderRadius: 20, cursor: 'pointer',
          background: 'transparent', border: 0, marginLeft: -8,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <window.MdI name="arrow-left" size={22} color={RH_C.primary}/>
        </button>
        <h1 style={{
          flex: 1, margin: 0, letterSpacing: '-.02em',
          font: `800 22px ${RH_F}`, color: RH_C.text,
        }}>So funktioniert's</h1>
      </div>

      {/* intro card */}
      <div style={{ padding: '18px 20px 0' }}>
        <div style={{
          background: 'linear-gradient(135deg,#0d8575,#16a085)',
          borderRadius: 16, padding: '18px 18px 16px', color: '#fff',
        }}>
          <div style={{ font: `800 10px ${RH_F}`, letterSpacing: 1.4, opacity: .85, textTransform: 'uppercase' }}>
            Deine Belohnungen
          </div>
          <h2 style={{ margin: '6px 0 8px', font: `800 22px/1.15 ${RH_F}`, letterSpacing: '-.01em' }}>
            Zwei Währungen, ein Ziel
          </h2>
          <div style={{ font: `500 13px/1.5 ${RH_F}`, opacity: .95 }}>
            Du sammelst <b>Cashback-Taler</b> (echtes Geld) und <b>Detektiv-Punkte</b> (Spielstand). Wir erklären dir jedes Detail — in deinem Tempo.
          </div>
        </div>
      </div>

      {/* sections */}
      <div style={{ padding: '18px 20px 20px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        {sections.map(({ k }) => {
          const c = HELP[k];
          return (
            <div key={k} style={{
              background: '#fff', borderRadius: 14, border: '1px solid rgba(25,28,29,.06)',
              padding: '14px 14px 14px',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
                <div style={{
                  width: 40, height: 40, borderRadius: 10, background: c.color + '1a',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                }}>
                  <window.MdI name={c.icon} size={20} color={c.color}/>
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ font: `800 15px ${RH_F}`, color: RH_C.text, letterSpacing: '-.01em' }}>{c.title}</div>
                  <div style={{ font: `500 12px ${RH_F}`, color: RH_C.muted, marginTop: 1 }}>{c.summary}</div>
                </div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {c.body.map((p, i) => (
                  <p key={i} style={{
                    margin: 0, font: `500 13px/1.5 ${RH_F}`, color: RH_C.text,
                  }}>{p}</p>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {/* closing nudge */}
      <div style={{ padding: '0 20px' }}>
        <button onClick={() => { onResetOnboarding && onResetOnboarding(); }} style={{
          width: '100%', background: '#fff', borderRadius: 14, padding: '14px 14px',
          border: '1px solid rgba(25,28,29,.06)', cursor: 'pointer', textAlign: 'left',
          display: 'flex', alignItems: 'center', gap: 12,
        }}>
          <div style={{
            width: 36, height: 36, borderRadius: 10, background: 'rgba(13,133,117,.1)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
          }}>
            <window.MdI name="play-circle-outline" size={20} color={RH_C.primary}/>
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ font: `800 14px ${RH_F}`, color: RH_C.text }}>Willkommens-Tour nochmal ansehen</div>
            <div style={{ font: `500 12px ${RH_F}`, color: RH_C.muted, marginTop: 2 }}>
              Die 4 Einführungskarten erneut abspielen.
            </div>
          </div>
          <window.MdI name="chevron-right" size={20} color={RH_C.muted}/>
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// RewardsOnboarding — one-time coachmark overlay
// ─────────────────────────────────────────────────────────────
const RH_ONBOARD_KEY = 'md-rewards-onboard-seen';

const ONBOARD_STEPS = [
  {
    title: 'Willkommen im Belohnungen-Center',
    body: 'Hier sammelst du Geld zurück und siehst deinen Fortschritt als Produkt-Detektiv.\n\nIn 4 kurzen Karten erklären wir dir, wie es funktioniert.',
    icon: '🕵️',
    cta: 'Los geht\'s',
  },
  {
    title: 'Cashback-Taler',
    body: 'Taler sind echtes Geld — ab 15 € zahlen wir sie aufs Konto aus.\n\nDu verdienst sie mit Kassenbons (0,08 €), Produktbildern (0,10 €) und Umfragen (bis 1,50 €).',
    icon: '💶',
    color: '#0d8575',
    cta: 'Weiter',
  },
  {
    title: 'Detektiv-Punkte',
    body: 'Punkte sind dein Spielstand — sie bestimmen dein Level und deinen Rang.\n\nScans (+2), Favoriten (+1) und tägliche Streaks geben Punkte. Jede kleine Aktion zählt.',
    icon: '⭐',
    color: '#e0a800',
    cta: 'Weiter',
  },
  {
    title: 'Bestenliste',
    body: 'Miss dich mit Freunden oder deinem Bundesland — ganz ohne Druck.\n\nMonatlich werden die Ranglisten zurückgesetzt. Top-3 gewinnen 10 € Bonus-Taler.',
    icon: '🏆',
    color: '#7c4dff',
    cta: 'Alles klar',
  },
];

function RewardsOnboarding({ onDone }) {
  const [step, setStep] = React.useState(0);
  const s = ONBOARD_STEPS[step];
  const last = step === ONBOARD_STEPS.length - 1;

  const next = () => {
    if (last) {
      try { localStorage.setItem(RH_ONBOARD_KEY, '1'); } catch {}
      onDone();
    } else {
      setStep(step + 1);
    }
  };

  const skip = () => {
    try { localStorage.setItem(RH_ONBOARD_KEY, '1'); } catch {}
    onDone();
  };

  return portalToSheetHost(
    <div style={{
      position: 'absolute', inset: 0, zIndex: 70,
      background: 'rgba(15,18,19,.72)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 20, pointerEvents: 'auto',
    }}>
      <div style={{
        width: '100%', background: '#fff', borderRadius: 18,
        padding: '22px 20px 18px',
        boxShadow: '0 24px 60px rgba(0,0,0,.3)',
        animation: 'rh-pop .24s cubic-bezier(.2,.9,.2,1) both',
      }}>
        {/* progress dots */}
        <div style={{ display: 'flex', gap: 6, justifyContent: 'center', marginBottom: 16 }}>
          {ONBOARD_STEPS.map((_, i) => (
            <div key={i} style={{
              width: i === step ? 20 : 6, height: 6, borderRadius: 3,
              background: i === step ? (s.color || RH_C.primary) : 'rgba(25,28,29,.15)',
              transition: 'all .25s',
            }}/>
          ))}
        </div>

        <div style={{
          fontSize: 52, textAlign: 'center', marginBottom: 12, lineHeight: 1,
        }}>{s.icon}</div>

        <h2 style={{
          margin: 0, font: `800 22px/1.2 ${RH_F}`, color: RH_C.text,
          textAlign: 'center', letterSpacing: '-.01em',
          height: 54,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>{s.title}</h2>

        <p style={{
          margin: '10px 0 20px', font: `500 14px/1.55 ${RH_F}`, color: RH_C.muted,
          textAlign: 'center', whiteSpace: 'pre-line',
          height: 150,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>{s.body}</p>

        <button onClick={next} style={{
          width: '100%', height: 48, borderRadius: 12, border: 0, cursor: 'pointer',
          background: s.color || RH_C.primary, color: '#fff',
          font: `800 14px ${RH_F}`, letterSpacing: '-.01em',
        }}>
          {s.cta}
        </button>

        <button
          onClick={last ? undefined : skip}
          disabled={last}
          style={{
            width: '100%', height: 36, marginTop: 6, border: 0, background: 'transparent',
            cursor: last ? 'default' : 'pointer',
            color: last ? 'transparent' : RH_C.muted,
            font: `600 12px ${RH_F}`, visibility: 'visible',
          }}
        >
          Überspringen
        </button>
      </div>
    </div>
  );
}

function shouldShowOnboarding() {
  try { return !localStorage.getItem(RH_ONBOARD_KEY); } catch { return false; }
}
function resetOnboarding() {
  try { localStorage.removeItem(RH_ONBOARD_KEY); } catch {}
}

// Inject keyframes once
if (typeof document !== 'undefined' && !document.getElementById('rh-keyframes')) {
  const st = document.createElement('style');
  st.id = 'rh-keyframes';
  st.textContent = `
    @keyframes rh-fadein{from{opacity:0}to{opacity:1}}
    @keyframes rh-slideup{from{transform:translateY(100%)}to{transform:translateY(0)}}
    @keyframes rh-pop{from{transform:scale(.94);opacity:.2}to{transform:scale(1);opacity:1}}
  `;
  document.head.appendChild(st);
}

Object.assign(window, {
  InfoIcon, InfoSheet, RewardsHelpPage, RewardsOnboarding,
  shouldShowRewardsOnboarding: shouldShowOnboarding,
  resetRewardsOnboarding: resetOnboarding,
});
