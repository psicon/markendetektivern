// SubmissionHelp.jsx — Onboarding + help for Kassenbon + Produktbilder submissions
// Mirrors RewardsHelp architecture: portal-rendered overlays + dedicated help pages.

const SH_F = window.F;
const SH_C = window.COLORS;

function shPortal(children) {
  if (typeof document === 'undefined') return children;
  const host = document.getElementById('__sheet_host');
  if (!host || !window.ReactDOM || !window.ReactDOM.createPortal) return children;
  return window.ReactDOM.createPortal(children, host);
}

// ─────────────────────────────────────────────────────────────
// RECEIPT onboarding
// ─────────────────────────────────────────────────────────────
const SH_RECEIPT_KEY = 'md-receipt-onboard-seen';
const RECEIPT_STEPS = [
  {
    title: 'Kassenbons einreichen',
    body: 'Mit jedem Bon lernt MarkenDetektive, welche NoName-Produkte wo verkauft werden.\n\nDeine Einreichungen machen die Preis-Datenbank für alle genauer.',
    icon: '🧾',
    cta: 'Los geht\'s',
  },
  {
    title: 'Was wir brauchen',
    body: 'Fotografiere den kompletten Bon — Kopf bis Fuß.\n\nWichtig: Datum, Geschäft und die Gesamtsumme müssen lesbar sein. Einzelne Produkte müssen nicht alle scharf sein.',
    icon: '📸',
    color: '#2d7a6e',
    cta: 'Weiter',
  },
  {
    title: 'Tipps für gute Bons',
    body: 'Heller, glatter Untergrund. Kein Schatten, kein Finger im Bild.\n\nBei langen Bons: mach mehrere überlappende Fotos — wir setzen sie zusammen.',
    icon: '💡',
    color: '#2d7a6e',
    cta: 'Verstanden',
  },
  {
    title: 'Deine Belohnung',
    body: '0,08 € Cashback pro geprüftem Bon — meist innerhalb von 24h.\n\nMax. 5 Bons pro Woche. Taler ab 15 € auszahlbar.',
    icon: '💶',
    color: '#0d8575',
    cta: 'Alles klar',
  },
];

function shShouldShowReceipt() { try { return !localStorage.getItem(SH_RECEIPT_KEY); } catch { return false; } }
function shResetReceipt()      { try { localStorage.removeItem(SH_RECEIPT_KEY); } catch {} }

function ReceiptOnboarding({ onDone }) {
  return <OnboardShell steps={RECEIPT_STEPS} storageKey={SH_RECEIPT_KEY} onDone={onDone}/>;
}

// ─────────────────────────────────────────────────────────────
// PHOTO onboarding
// ─────────────────────────────────────────────────────────────
const SH_PHOTO_KEY = 'md-photo-onboard-seen';
const PHOTO_ONBOARD_STEPS = [
  {
    title: 'Produkte einreichen',
    body: 'Hilf uns, NoName-Produkte transparent zu machen. Mit 7 Fotos pro Produkt erfassen wir alle wichtigen Infos.\n\nAndere Detektive profitieren direkt von deinem Beitrag.',
    icon: '📷',
    cta: 'Los geht\'s',
  },
  {
    title: '7 Fotos pro Datensatz',
    body: 'Front · Rückseite · EAN-Barcode · Zutaten · Nährwerte · Hersteller · Preisschild.\n\nDu kannst auch in mehreren Sessions einreichen — alle Fotos landen in einem Datensatz.',
    icon: '🗂️',
    color: '#8b5cf6',
    cta: 'Weiter',
  },
  {
    title: 'Foto-Tipps',
    body: 'Gutes Licht, Produkt mittig, scharf gestellt.\n\nBei Text (Zutaten, Nährwerte): nah genug, dass man lesen kann. Beim Preisschild: Regal mit rein, nicht nur das Schild.',
    icon: '💡',
    color: '#8b5cf6',
    cta: 'Verstanden',
  },
  {
    title: 'Deine Belohnung',
    body: '0,10 € Cashback pro vollständigem Datensatz — nach manueller Prüfung (1-3 Tage).\n\nKeine Limits, Taler ab 15 € auszahlbar.',
    icon: '💶',
    color: '#0d8575',
    cta: 'Alles klar',
  },
];

function shShouldShowPhoto() { try { return !localStorage.getItem(SH_PHOTO_KEY); } catch { return false; } }
function shResetPhoto()      { try { localStorage.removeItem(SH_PHOTO_KEY); } catch {} }

function PhotoOnboarding({ onDone }) {
  return <OnboardShell steps={PHOTO_ONBOARD_STEPS} storageKey={SH_PHOTO_KEY} onDone={onDone}/>;
}

// ─────────────────────────────────────────────────────────────
// Shared onboard shell — identical UX to RewardsOnboarding
// ─────────────────────────────────────────────────────────────
function OnboardShell({ steps, storageKey, onDone }) {
  const [step, setStep] = React.useState(0);
  const s = steps[step];
  const last = step === steps.length - 1;

  const commit = () => { try { localStorage.setItem(storageKey, '1'); } catch {} onDone(); };
  const next = () => last ? commit() : setStep(step + 1);

  return shPortal(
    <div style={{
      position: 'absolute', inset: 0, zIndex: 70,
      background: 'rgba(15,18,19,.72)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 20, pointerEvents: 'auto',
    }}>
      <div style={{
        width: '100%', background: 'var(--th-card)', borderRadius: 18,
        padding: '22px 20px 18px',
        boxShadow: '0 24px 60px rgba(0,0,0,.3)',
        animation: 'rh-pop .24s cubic-bezier(.2,.9,.2,1) both',
      }}>
        {/* progress dots */}
        <div style={{ display: 'flex', gap: 6, justifyContent: 'center', marginBottom: 16 }}>
          {steps.map((_, i) => (
            <div key={i} style={{
              width: i === step ? 20 : 6, height: 6, borderRadius: 3,
              background: i === step ? (s.color || SH_C.primary) : 'rgba(25,28,29,.15)',
              transition: 'all .25s',
            }}/>
          ))}
        </div>

        <div style={{
          fontSize: 52, textAlign: 'center', marginBottom: 12, lineHeight: 1,
        }}>{s.icon}</div>

        <h2 style={{
          margin: 0, font: `800 22px/1.2 ${SH_F}`, color: SH_C.text,
          textAlign: 'center', letterSpacing: '-.01em',
          height: 54,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>{s.title}</h2>

        <p style={{
          margin: '10px 0 20px', font: `500 14px/1.55 ${SH_F}`, color: SH_C.muted,
          textAlign: 'center', whiteSpace: 'pre-line',
          height: 150,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>{s.body}</p>

        <button onClick={next} style={{
          width: '100%', height: 48, borderRadius: 12, border: 0, cursor: 'pointer',
          background: s.color || SH_C.primary, color: '#fff',
          font: `800 14px ${SH_F}`, letterSpacing: '-.01em',
        }}>
          {s.cta}
        </button>

        <button
          onClick={last ? undefined : commit}
          disabled={last}
          style={{
            width: '100%', height: 36, marginTop: 6, border: 0, background: 'transparent',
            cursor: last ? 'default' : 'pointer',
            color: last ? 'transparent' : SH_C.muted,
            font: `600 12px ${SH_F}`,
          }}
        >
          Überspringen
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Help pages (dedicated, full-screen) for each flow
// ─────────────────────────────────────────────────────────────
const RECEIPT_HELP_SECTIONS = [
  {
    title: 'Warum Kassenbons?',
    icon: 'help-circle-outline',
    color: '#2d7a6e',
    body: ['Jeder Bon zeigt uns, welche NoName-Produkte wo verkauft werden und zu welchem Preis. Das macht unsere Datenbank genau und aktuell — gut für dich und alle anderen Detektive.'],
  },
  {
    title: 'Was muss auf dem Bon zu sehen sein?',
    icon: 'check-circle-outline',
    color: '#2d7a6e',
    body: [
      '✓ Name des Geschäfts (Kopf des Bons)',
      '✓ Datum des Einkaufs',
      '✓ Gesamtsumme (Fuß des Bons)',
      'Einzelne Produkt-Zeilen müssen nicht 100% scharf sein — wir erkennen das Wesentliche auch bei leichten Knicken.',
    ],
  },
  {
    title: 'Tipps für beste Ergebnisse',
    icon: 'lightbulb-on-outline',
    color: '#e0a800',
    body: [
      '· Bon glatt ziehen, heller Untergrund',
      '· Kein Schatten, kein Finger im Bild',
      '· Lange Bons: mehrere Fotos, 20% Überlappung',
      '· Ausdrucke und Thermobons beide OK',
    ],
  },
  {
    title: 'Belohnung & Limits',
    icon: 'cash',
    color: '#0d8575',
    body: [
      '0,08 € Cashback pro geprüftem Bon.',
      'Max. 5 Bons pro Kalenderwoche.',
      'Prüfung meist innerhalb von 24 Stunden.',
      'Taler ab 15 € auszahlbar (siehe Belohnungen).',
    ],
  },
  {
    title: 'Wann wird ein Bon abgelehnt?',
    icon: 'alert-circle-outline',
    color: '#dc2626',
    body: [
      '· Datum älter als 14 Tage',
      '· Unleserliche Gesamtsumme oder Geschäft',
      '· Bon wurde bereits eingereicht',
      'Bei Ablehnung siehst du den Grund in „Eingereichte Kassenbons".',
    ],
  },
];

const PHOTO_HELP_SECTIONS = [
  {
    title: 'Warum Produktbilder?',
    icon: 'help-circle-outline',
    color: '#8b5cf6',
    body: ['Gute Fotos helfen anderen Detektiven, Produkte auch ohne Regal zu finden und zu vergleichen. Zutaten, Nährwerte und Preise werden so für alle zugänglich.'],
  },
  {
    title: 'Die 7 Fotos',
    icon: 'camera-outline',
    color: '#8b5cf6',
    body: [
      '1. Produktfront — Vorderseite mit Markenname',
      '2. Rückseite — falls relevant (z.B. Beschreibung)',
      '3. EAN-Barcode — Strichcode scharf, vollständig im Bild',
      '4. Zutatenliste — lesbar, gerade fotografiert',
      '5. Nährwerttabelle — komplett mit Angaben',
      '6. Hersteller — Adresse/Kontakt meist hinten klein',
      '7. Preisschild — Regal mit Preis vor Ort',
    ],
  },
  {
    title: 'Foto-Tipps',
    icon: 'lightbulb-on-outline',
    color: '#e0a800',
    body: [
      '· Tageslicht oder helle Deckenlampe',
      '· Produkt füllt das Bild gut aus',
      '· Scharfstellen durch kurzes Tippen',
      '· Bei Text: nah genug, dass man es lesen kann',
      '· Preisschild: Regal mit fotografieren, damit der Kontext klar ist',
    ],
  },
  {
    title: 'Belohnung & Prüfung',
    icon: 'cash',
    color: '#0d8575',
    body: [
      '0,10 € Cashback pro vollständigem Datensatz.',
      'Manuelle Prüfung durch unser Team, meist 1-3 Tage.',
      'Keine Obergrenze — je mehr, desto mehr.',
      'Unvollständige Datensätze bleiben als Entwurf und können später ergänzt werden.',
    ],
  },
  {
    title: 'Was wird nicht akzeptiert?',
    icon: 'alert-circle-outline',
    color: '#dc2626',
    body: [
      '· Bilder aus dem Internet/Herstellerseite',
      '· Verschwommene oder zu dunkle Fotos',
      '· Produkte, die bereits eingereicht wurden',
      'Wir informieren dich bei Ablehnung direkt in der App.',
    ],
  },
];

function HelpPageShell({ title, sections, onBack, onReplayTour, replayLabel }) {
  return (
    <div style={{ fontFamily: SH_F, background: 'var(--th-bg)', minHeight: '100%', paddingBottom: 110 }}>
      {/* Standard PageHeader */}
      <div style={{
        position: 'sticky', top: 0, zIndex: 10, background: 'var(--th-bg)',
        padding: '18px 20px 10px', display: 'flex', alignItems: 'center', gap: 10,
      }}>
        <button onClick={onBack} style={{
          width: 40, height: 40, borderRadius: 20, cursor: 'pointer',
          background: 'transparent', border: 0, marginLeft: -8,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <window.MdI name="arrow-left" size={22} color={SH_C.primary}/>
        </button>
        <h1 style={{
          flex: 1, margin: 0, letterSpacing: '-.02em',
          font: `800 22px ${SH_F}`, color: SH_C.text,
        }}>{title}</h1>
      </div>

      {/* Sections */}
      <div style={{ padding: '10px 20px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        {sections.map((s, i) => (
          <div key={i} style={{
            background: 'var(--th-card)', borderRadius: 14, border: '1px solid var(--th-border)',
            padding: '14px 14px',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
              <div style={{
                width: 40, height: 40, borderRadius: 10, background: s.color + '1a',
                display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
              }}>
                <window.MdI name={s.icon} size={20} color={s.color}/>
              </div>
              <div style={{ font: `800 15px ${SH_F}`, color: SH_C.text, letterSpacing: '-.01em', flex: 1 }}>{s.title}</div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {s.body.map((p, k) => (
                <p key={k} style={{
                  margin: 0, font: `500 13px/1.5 ${SH_F}`, color: SH_C.text, whiteSpace: 'pre-line',
                }}>{p}</p>
              ))}
            </div>
          </div>
        ))}

        {/* Replay tour button */}
        {onReplayTour && (
          <button onClick={onReplayTour} style={{
            background: 'var(--th-card)', borderRadius: 14, padding: '14px',
            border: '1px solid var(--th-border)', cursor: 'pointer', textAlign: 'left',
            display: 'flex', alignItems: 'center', gap: 12,
          }}>
            <div style={{
              width: 36, height: 36, borderRadius: 10, background: 'var(--th-primary-tint-strong)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
            }}>
              <window.MdI name="play-circle-outline" size={20} color={SH_C.primary}/>
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ font: `800 14px ${SH_F}`, color: SH_C.text }}>{replayLabel}</div>
              <div style={{ font: `500 12px ${SH_F}`, color: SH_C.muted, marginTop: 2 }}>
                Die Einführungskarten erneut abspielen.
              </div>
            </div>
            <window.MdI name="chevron-right" size={20} color={SH_C.muted}/>
          </button>
        )}
      </div>
    </div>
  );
}

function ReceiptHelpPage({ onBack, onReplayTour }) {
  return <HelpPageShell
    title="So geht's: Kassenbons"
    sections={RECEIPT_HELP_SECTIONS}
    onBack={onBack}
    onReplayTour={onReplayTour}
    replayLabel="Kassenbon-Tour nochmal ansehen"
  />;
}

function PhotoHelpPage({ onBack, onReplayTour }) {
  return <HelpPageShell
    title="So geht's: Produktbilder"
    sections={PHOTO_HELP_SECTIONS}
    onBack={onBack}
    onReplayTour={onReplayTour}
    replayLabel="Produktbild-Tour nochmal ansehen"
  />;
}

// ─────────────────────────────────────────────────────────────
// HelpButton — little pill for screen headers to open help page
// ─────────────────────────────────────────────────────────────
function HelpButton({ onClick, color, label = "So geht's" }) {
  const c = color || SH_C.primary;
  return (
    <button onClick={onClick} aria-label={label} style={{
      height: 32, padding: '0 10px', borderRadius: 16,
      background: c + '1a', color: c, border: 0, cursor: 'pointer',
      font: `700 12px ${SH_F}`,
      display: 'inline-flex', alignItems: 'center', gap: 4, flexShrink: 0,
    }}>
      <window.MdI name="help-circle-outline" size={14} color={c}/>
      {label}
    </button>
  );
}

Object.assign(window, {
  ReceiptOnboarding, ReceiptHelpPage,
  PhotoOnboarding,   PhotoHelpPage,
  HelpButton,
  shShouldShowReceiptOnboarding: shShouldShowReceipt,
  shResetReceiptOnboarding: shResetReceipt,
  shShouldShowPhotoOnboarding: shShouldShowPhoto,
  shResetPhotoOnboarding: shResetPhoto,
});
