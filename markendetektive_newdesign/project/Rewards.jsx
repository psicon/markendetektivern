// Rewards.jsx — Einlösen (Cashback-Taler) + Bestenliste (Detektiv-Punkte)

// —— User state ——
const CASHBACK_EUR = 12.40;          // Cashback-Taler (einlösbar ab 15 €)
const PAYOUT_THRESHOLD = 15.00;
const DET_POINTS = 2340;             // Detektiv-Punkte (Gamification)
const DET_LEVEL = { n: 6, name: 'Clever-Shopper', pct: 85, toNext: 450 };
const STREAK = { days: 18, tier: 3, bonus: 3, freezes: 2 };
const USER_NICK = 'Hannah K.';

// —— Cashback catalogue (provider-agnostic, stands in for the partner list) ——
const CASHBACK_CATS = [
  { k: 'all',      l: 'Alle',       i: 'view-grid-outline' },
  { k: 'gift',     l: 'Gutscheine', i: 'ticket-percent' },
  { k: 'prepaid',  l: 'Prepaid',    i: 'credit-card-outline' },
  { k: 'money',    l: 'Auszahlung', i: 'cash-multiple' },
  { k: 'charity',  l: 'Spenden',    i: 'heart-outline' },
];

const CASHBACK_REWARDS = [
  // Gift cards
  { id: 'amazon-de', cat: 'gift', brand: 'Amazon.de',  value: '15 €', tint: '#ff9900', short: 'a', hot: true },
  { id: 'rewe',      cat: 'gift', brand: 'Rewe',        value: '15 €', tint: '#cc071e', short: 'R' },
  { id: 'kaufland',  cat: 'gift', brand: 'Kaufland',    value: '15 €', tint: '#e10915', short: 'K' },
  { id: 'penny',     cat: 'gift', brand: 'Penny',       value: '15 €', tint: '#d40f14', short: 'P' },
  { id: 'rossmann',  cat: 'gift', brand: 'Rossmann',    value: '15 €', tint: '#e3001a', short: 'R' },
  { id: 'lieferando',cat: 'gift', brand: 'Lieferando',  value: '15 €', tint: '#ff8000', short: 'L' },
  { id: 'amazon-com',cat: 'gift', brand: 'Amazon.com',  value: '25 €', tint: '#232f3e', short: 'a' },
  { id: 'apple',     cat: 'gift', brand: 'Apple',       value: '25 €', tint: '#000',    short: '' },
  { id: 'google',    cat: 'gift', brand: 'Google Play', value: '15 €', tint: '#4285f4', short: 'G' },
  // Prepaid
  { id: 'visa-v',    cat: 'prepaid', brand: 'Virtual Visa',  value: '25 €', tint: '#1a1f71', short: 'VISA' },
  { id: 'visa-p',    cat: 'prepaid', brand: 'Physical Visa', value: '50 €', tint: '#0e164d', short: 'VISA' },
  // Monetary
  { id: 'paypal',    cat: 'money',   brand: 'PayPal',        value: '15 €', tint: '#003087', short: 'P', hot: true },
  // Charity
  { id: 'msf',       cat: 'charity', brand: 'Ärzte ohne Grenzen', value: '15 € Spende', tint: '#c0392b', short: '✚' },
  { id: 'irc',       cat: 'charity', brand: 'Int. Rescue Committee', value: '15 € Spende', tint: '#d4231a', short: 'IRC' },
  { id: 'stc',       cat: 'charity', brand: 'Save the Children', value: '15 € Spende', tint: '#e8384f', short: 'S' },
];

// Limits & Quoten (Kostenkontrolle — backend-enforced)
const RECEIPT_LIMIT = { perWeek: 6,  eurEach: 0.08, usedThisWeek: 2 };
const PHOTO_LIMIT   = { perWeek: 20, eurEach: 0.10, usedThisWeek: 14 };
const SURVEY_AVAILABLE = false;

const PHOTO_WIZARD_STEPS = [
  { n: 1, l: 'Produktfront',    i: 'image-outline' },
  { n: 2, l: 'Produktrückseite',i: 'image-multiple-outline' },
  { n: 3, l: 'EAN-Barcode',     i: 'barcode-scan' },
  { n: 4, l: 'Zutaten',         i: 'format-list-bulleted' },
  { n: 5, l: 'Nährwerte',       i: 'nutrition' },
  { n: 6, l: 'Hersteller',      i: 'factory' },
  { n: 7, l: 'Preisschild',     i: 'tag-outline' },
];

const CASHBACK_EARN = [
  {
    k: 'survey',  i: 'poll',                l: 'Umfrage beantworten',
    sub: 'Nur wenn verfügbar · 2–5 Min',    reward: '0,20 – 2,00 €',
    available: SURVEY_AVAILABLE,
    limitLabel: SURVEY_AVAILABLE ? 'Verfügbar' : 'Aktuell keine Umfrage',
  },
  {
    k: 'receipt', i: 'receipt-text-outline', l: 'Kassenbon hochladen',
    sub: `${RECEIPT_LIMIT.eurEach.toFixed(2).replace('.', ',')} € pro Bon · max. ${RECEIPT_LIMIT.perWeek}/Woche`,
    reward: `${RECEIPT_LIMIT.eurEach.toFixed(2).replace('.', ',')} €`,
    available: RECEIPT_LIMIT.usedThisWeek < RECEIPT_LIMIT.perWeek,
    limitLabel: RECEIPT_LIMIT.usedThisWeek < RECEIPT_LIMIT.perWeek
      ? `Noch verfügbar · ${RECEIPT_LIMIT.usedThisWeek}/${RECEIPT_LIMIT.perWeek} diese Woche`
      : `Limit erreicht · ${RECEIPT_LIMIT.perWeek}/${RECEIPT_LIMIT.perWeek} diese Woche`,
    limitProgress: RECEIPT_LIMIT.usedThisWeek / RECEIPT_LIMIT.perWeek,
  },
  {
    k: 'photo',   i: 'camera-outline',      l: 'Produktbilder (voller Datensatz)',
    sub: `Wizard: ${PHOTO_WIZARD_STEPS.length} Fotos – Front, Rückseite, Barcode, Zutaten, Nährwerte, Hersteller, Preisschild`,
    reward: `${PHOTO_LIMIT.eurEach.toFixed(2).replace('.', ',')} €`,
    available: PHOTO_LIMIT.usedThisWeek < PHOTO_LIMIT.perWeek,
    limitLabel: PHOTO_LIMIT.usedThisWeek < PHOTO_LIMIT.perWeek
      ? `Noch verfügbar · ${PHOTO_LIMIT.usedThisWeek}/${PHOTO_LIMIT.perWeek} diese Woche`
      : `Limit erreicht · ${PHOTO_LIMIT.perWeek}/${PHOTO_LIMIT.perWeek} diese Woche`,
    limitProgress: PHOTO_LIMIT.usedThisWeek / PHOTO_LIMIT.perWeek,
  },
];

// Home-style quick actions — shown on both tabs so the user can always act
const QUICK_ACTIONS = [
  { k: 'receipt', i: 'receipt-text-outline', l: 'Kassenbon\nscannen',    bg: '#95cfc4', dark: true, kind: 'taler', reward: '0,08 €' },
  { k: 'photo',   i: 'camera-plus-outline',  l: 'Produkte\neinreichen',  bg: '#a89cdf', dark: true, kind: 'taler', reward: '0,10 €' },
  { k: 'survey',  i: 'poll',                 l: 'Umfragen',              bg: '#dde2e4',             kind: 'taler', reward: 'wenn verfügb.' },
];

// —— Leaderboard data ——
const SCOPES = [
  { k: 'friends', l: 'Freunde' },
  { k: 'state',   l: 'Bayern' },   // user's Bundesland
];
const PERIODS = [
  { k: 'month', l: 'Diesen Monat' },
  { k: 'all',   l: 'All-Time' },
];

// Combined rows: {n, pts, eur, a, city, me?, rank?}
const LB = {
  friends: {
    month: [
      { n: 'PreisjägerT',      pts: 3210, eur: 128.40, a: '🦊', city: 'München' },
      { n: 'AldiAgent23',      pts: 2980, eur: 112.90, a: '🐻', city: 'Nürnberg' },
      { n: 'SparfuchsMila',    pts: 2760, eur: 98.20,  a: '🦊', city: 'Augsburg' },
      { n: 'Detektiv Dave',    pts: 2510, eur: 68.10,  a: '🕵️', city: 'Regensburg' },
      { n: 'Hannah K.',        pts: 2340, eur: 76.30,  a: '🦉', city: 'München', me: true },
      { n: 'Billig-Betty',     pts: 2120, eur: 54.40,  a: '🐨', city: 'Würzburg' },
      { n: 'KeinMarkusKeiner', pts: 1980, eur: 84.50,  a: '🦝', city: 'Ingolstadt' },
      { n: 'NoNameNina',       pts: 1740, eur: 42.80,  a: '🐸', city: 'Erlangen' },
      { n: 'Herr Sparschwein', pts: 1520, eur: 31.50,  a: '🐷', city: 'Bamberg' },
    ],
    all: [
      { n: 'PreisjägerT',      pts: 41820, eur: 1284.40, a: '🦊', city: 'München' },
      { n: 'AldiAgent23',      pts: 38420, eur: 1108.90, a: '🐻', city: 'Nürnberg' },
      { n: 'Detektiv Dave',    pts: 34100, eur: 624.10,  a: '🕵️', city: 'Regensburg' },
      { n: 'SparfuchsMila',    pts: 29760, eur: 892.20,  a: '🦊', city: 'Augsburg' },
      { n: 'Hannah K.',        pts: 24340, eur: 682.30,  a: '🦉', city: 'München', me: true },
      { n: 'Billig-Betty',     pts: 22120, eur: 498.40,  a: '🐨', city: 'Würzburg' },
      { n: 'KeinMarkusKeiner', pts: 19810, eur: 760.50,  a: '🦝', city: 'Ingolstadt' },
      { n: 'NoNameNina',       pts: 17410, eur: 412.80,  a: '🐸', city: 'Erlangen' },
      { n: 'Herr Sparschwein', pts: 15200, eur: 301.50,  a: '🐷', city: 'Bamberg' },
    ],
  },
  state: {
    month: [
      { n: 'BayernBlitz',   pts: 8420, eur: 342.20, a: '🦁', city: 'München' },
      { n: 'LidlLena',      pts: 7210, eur: 298.40, a: '🌸', city: 'Augsburg' },
      { n: 'OktoberOtto',   pts: 6640, eur: 254.10, a: '🥨', city: 'München' },
      { n: 'FrankenFuchs',  pts: 5980, eur: 221.60, a: '🦊', city: 'Nürnberg' },
      { n: 'Hannah K.',     pts: 2340, eur: 76.30,  a: '🦉', city: 'München', me: true, rank: 7 },
    ],
    all: [
      { n: 'BayernBlitz',   pts: 118420, eur: 3842.20, a: '🦁', city: 'München' },
      { n: 'LidlLena',      pts: 94210,  eur: 2984.40, a: '🌸', city: 'Augsburg' },
      { n: 'OktoberOtto',   pts: 82640,  eur: 2541.10, a: '🥨', city: 'München' },
      { n: 'FrankenFuchs',  pts: 75980,  eur: 2216.60, a: '🦊', city: 'Nürnberg' },
      { n: 'Hannah K.',     pts: 24340,  eur: 682.30,  a: '🦉', city: 'München', me: true, rank: 6 },
    ],
  },
};

const CITY_BATTLE = [
  { city: 'München',    score: 842000, delta: '+4.2%' },
  { city: 'Nürnberg',   score: 612000, delta: '+2.1%' },
  { city: 'Augsburg',   score: 498000, delta: '+6.8%' },
  { city: 'Regensburg', score: 312000, delta: '+1.4%' },
  { city: 'Würzburg',   score: 248000, delta: '-0.8%' },
];

// —— Root ——
function Rewards({ onBack, onOpenScanner, onOpenProfile, onOpenReceipts, onOpenPhotos, onOpenReceiptScan, onOpenFavorites }) {
  const [tab, setTab] = useStateS('redeem');
  const [helpOpen, setHelpOpen] = React.useState(false);
  const [infoConcept, setInfoConcept] = React.useState(null);
  const [showOnboard, setShowOnboard] = React.useState(() => window.shouldShowRewardsOnboarding && window.shouldShowRewardsOnboarding());
  const openInfo = (k) => setInfoConcept(k);

  const onAction = (k) => {
    if (k === 'receipt') onOpenReceiptScan && onOpenReceiptScan();
    else if (k === 'scan') onOpenScanner && onOpenScanner();
    else if (k === 'photo') onOpenPhotos && onOpenPhotos();
    else if (k === 'fav')  onOpenFavorites && onOpenFavorites();
  };

  if (helpOpen) {
    return <window.RewardsHelpPage
      onBack={() => setHelpOpen(false)}
      onResetOnboarding={() => {
        window.resetRewardsOnboarding && window.resetRewardsOnboarding();
        setHelpOpen(false);
        setShowOnboard(true);
      }}
    />;
  }

  return (
    <div style={{ fontFamily: F, background: '#F9FAFB', minHeight: '100%', paddingBottom: 110 }}>
      {/* Header with title + tab switcher */}
      <div style={{
        position: 'sticky', top: 0, zIndex: 10,
        background: '#F9FAFB',
        padding: '18px 20px 10px',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
          <h1 style={{ font: `800 26px ${F}`, color: COLORS.text, margin: 0, letterSpacing: '-.02em', flex: 1 }}>
            Belohnungen
          </h1>
          <button onClick={() => setHelpOpen(true)} aria-label="So funktioniert's" style={{
            height: 34, padding: '0 12px', borderRadius: 17,
            background: 'rgba(13,133,117,.1)', color: COLORS.primary, border: 0, cursor: 'pointer',
            font: `700 12px ${F}`,
            display: 'inline-flex', alignItems: 'center', gap: 5, flexShrink: 0,
          }}>
            <MdI name="help-circle-outline" size={15} color={COLORS.primary}/>
            So geht's
          </button>
          <button onClick={onOpenProfile} style={{
            width: 34, height: 34, borderRadius: 17, background: COLORS.low, border: 0, cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
          }}>
            <MdI name="account-outline" size={20} color={COLORS.muted}/>
          </button>
        </div>
        <div style={{
          display: 'flex', gap: 4, background: '#ECEEF0', padding: 3, borderRadius: 12,
        }}>
          <TabBtn active={tab === 'redeem'}  onClick={() => setTab('redeem')}  label="Einlösen" icon="wallet-outline"/>
          <TabBtn active={tab === 'ranks'}   onClick={() => setTab('ranks')}   label="Bestenliste" icon="trophy-outline"/>
        </div>
      </div>

      {tab === 'redeem' ? <RedeemTab onOpenReceipts={onOpenReceipts} onOpenPhotos={onOpenPhotos} onAction={onAction} openInfo={openInfo}/> : <RanksTab onAction={onAction} openInfo={openInfo}/>}

      {infoConcept && <window.InfoSheet concept={infoConcept} onClose={() => setInfoConcept(null)} onOpenHelp={() => setHelpOpen(true)}/>}
      {showOnboard && <window.RewardsOnboarding onDone={() => setShowOnboard(false)}/>}
    </div>
  );
}

function TabBtn({ active, onClick, label, icon }) {
  return (
    <button onClick={onClick} style={{
      flex: 1, height: 36, borderRadius: 9, border: 0,
      background: active ? '#fff' : 'transparent',
      color: active ? COLORS.text : COLORS.muted,
      font: `700 13px ${F}`, cursor: 'pointer',
      boxShadow: active ? '0 1px 3px rgba(0,0,0,.08)' : 'none',
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
    }}>
      <MdI name={icon} size={15} color={active ? COLORS.primary : COLORS.muted}/>
      {label}
    </button>
  );
}

// ————————————————————————————————————————
// REDEEM TAB
// ————————————————————————————————————————
function RedeemTab({ onOpenReceipts, onOpenPhotos, onAction, openInfo }) {
  const [filter, setFilter] = useStateS('all');
  const items = filter === 'all' ? CASHBACK_REWARDS : CASHBACK_REWARDS.filter(r => r.cat === filter);
  const pct = Math.min(100, Math.round((CASHBACK_EUR / PAYOUT_THRESHOLD) * 100));
  const canRedeem = CASHBACK_EUR >= PAYOUT_THRESHOLD;
  const gapEur = (PAYOUT_THRESHOLD - CASHBACK_EUR).toFixed(2).replace('.', ',');

  return (
    <>
      {/* Hero — Cashback-Taler */}
      <div style={{ padding: '4px 20px 0' }}>
        <div style={{
          background: 'linear-gradient(135deg,#0a6f62 0%,#0d8575 55%,#10a18a 100%)',
          borderRadius: 20, padding: '18px 18px 20px', color: '#fff',
          position: 'relative', overflow: 'hidden',
        }}>
          <div style={{ position: 'absolute', right: -30, bottom: -30, opacity: .12 }}>
            <DetectiveMark size={160} color="#fff"/>
          </div>
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            background: 'rgba(255,255,255,.18)', padding: '4px 4px 4px 10px', borderRadius: 20,
            font: `700 10px ${F}`, letterSpacing: 1, textTransform: 'uppercase',
          }}>
            <MdI name="treasure-chest" size={12} color="#ffd44b"/>
            Cashback-Taler
            <button onClick={(e)=>{e.stopPropagation();openInfo&&openInfo('taler');}} aria-label="Was sind Taler?" style={{
              width: 18, height: 18, borderRadius: '50%', border: 0, marginLeft: 2,
              background: 'rgba(255,255,255,.25)', cursor: 'pointer',
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <MdI name="information-outline" size={11} color="#fff"/>
            </button>
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 4, marginTop: 10 }}>
            <span style={{ font: `800 48px/1 ${F}`, letterSpacing: '-.02em' }}>
              {CASHBACK_EUR.toFixed(2).replace('.', ',')}
            </span>
            <span style={{ font: `800 22px ${F}`, opacity: .95 }}>€</span>
          </div>
          <div style={{ font: `500 12px ${F}`, opacity: .92, marginTop: 8 }}>
            {canRedeem
              ? 'Bereit zur Auszahlung'
              : <>Noch <b>{gapEur} €</b> bis zur nächsten Auszahlung</>}
          </div>
          <div style={{ height: 8, background: 'rgba(255,255,255,.22)', borderRadius: 4, overflow: 'hidden', marginTop: 10 }}>
            <div style={{ width: `${pct}%`, height: '100%', background: '#fff', borderRadius: 4, transition: 'width .3s' }}/>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6, font: `600 10px ${F}`, opacity: .85 }}>
            <span>0 €</span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              Schwelle 15 €
              <button onClick={()=>openInfo&&openInfo('threshold')} aria-label="Warum 15 €?" style={{
                width: 16, height: 16, padding: 0, border: 0, background: 'transparent', cursor: 'pointer',
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <MdI name="information-outline" size={11} color="rgba(255,255,255,.85)"/>
              </button>
            </span>
          </div>
        </div>
      </div>

      {/* Quick actions — earn more points & taler */}
      <div style={{ padding: '22px 20px 0' }}>
        <QuickActions intro="Mehr Taler & Punkte sammeln" onAction={onAction}/>
      </div>

      {/* Earn Cashback */}
      <div style={{ padding: '22px 20px 0' }}>
        <SecHeader title="Taler verdienen" sub="Nur diese Aktionen geben Cashback" onInfo={()=>openInfo&&openInfo('earnTaler')}/>
        <div style={{ background: '#fff', borderRadius: 14, border: '1px solid rgba(25,28,29,.06)', overflow: 'hidden', marginTop: 10 }}>
          {CASHBACK_EARN.map((e, i) => (
            <div key={e.k} onClick={e.k === 'receipt' ? onOpenReceipts : e.k === 'photo' ? onOpenPhotos : undefined} style={{
              display: 'flex', alignItems: 'flex-start', gap: 12, padding: '12px 14px',
              borderTop: i === 0 ? 'none' : '1px solid rgba(25,28,29,.06)',
              cursor: (e.k === 'receipt' || e.k === 'photo') ? 'pointer' : 'default',
            }}>
              <div style={{
                width: 40, height: 40, borderRadius: 10, background: 'rgba(13,133,117,.1)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                flexShrink: 0, marginTop: 2,
              }}>
                <MdI name={e.i} size={20} color={COLORS.primary}/>
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                  <div style={{ font: `700 14px ${F}`, color: COLORS.text, flex: 1 }}>
                    {e.l}
                    {(e.k === 'receipt' || e.k === 'photo') && <MdI name="chevron-right" size={16} color={COLORS.muted} style={{ verticalAlign: 'middle', marginLeft: 2 }}/>}
                  </div>
                  <div style={{ font: `800 12px ${F}`, color: COLORS.primary, whiteSpace: 'nowrap' }}>{e.reward}</div>
                </div>
                <div style={{ font: `500 11px/1.35 ${F}`, color: COLORS.muted, marginTop: 2 }}>{e.sub}</div>
                {e.limitLabel && (
                  <div style={{
                    marginTop: 7, display: 'flex', alignItems: 'center', gap: 6,
                  }}>
                    <span style={{
                      display: 'inline-flex', alignItems: 'center', gap: 4,
                      font: `700 10px ${F}`,
                      color: e.available ? COLORS.primary : '#dc2626',
                      background: e.available ? 'rgba(13,133,117,.1)' : 'rgba(220,38,38,.1)',
                      padding: '2px 7px', borderRadius: 4, letterSpacing: .3,
                    }}>
                      <span style={{
                        width: 6, height: 6, borderRadius: '50%',
                        background: e.available ? '#16a34a' : '#dc2626',
                      }}/>
                      {e.limitLabel}
                    </span>
                    {typeof e.limitProgress === 'number' && (
                      <div style={{ flex: 1, height: 4, background: 'rgba(25,28,29,.06)', borderRadius: 2, overflow: 'hidden' }}>
                        <div style={{
                          width: `${Math.min(100, Math.round(e.limitProgress * 100))}%`,
                          height: '100%',
                          background: e.available ? COLORS.primary : '#dc2626',
                        }}/>
                      </div>
                    )}
                  </div>
                )}
                {e.k === 'photo' && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 8 }}>
                    {PHOTO_WIZARD_STEPS.map(s => (
                      <span key={s.n} style={{
                        display: 'inline-flex', alignItems: 'center', gap: 4,
                        font: `600 10px ${F}`, color: COLORS.text,
                        background: 'rgba(25,28,29,.05)', padding: '3px 7px', borderRadius: 4,
                      }}>
                        <span style={{ color: COLORS.primary, fontWeight: 800 }}>{s.n}</span>
                        {s.l}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Rewards grid */}
      <div style={{ padding: '22px 20px 0' }}>
        <SecHeader title="Einlösen" sub={`${CASHBACK_REWARDS.length} Belohnungen`}/>
        <div style={{ display: 'flex', gap: 6, overflowX: 'auto', scrollbarWidth: 'none', margin: '8px -20px 10px', padding: '0 20px 2px' }}>
          {CASHBACK_CATS.map(c => (
            <CatChip key={c.k} active={filter === c.k} onClick={() => setFilter(c.k)} icon={c.i} label={c.l}/>
          ))}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          {items.map(r => <RewardCard key={r.id} r={r} canRedeem={canRedeem}/>)}
        </div>
      </div>
    </>
  );
}

function SecHeader({ title, sub, onInfo }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
      <h2 style={{ font: `800 20px ${F}`, color: COLORS.text, margin: 0, letterSpacing: '-.01em', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
        {title}
        {onInfo && (
          <button onClick={onInfo} aria-label="Mehr Info" style={{
            width: 22, height: 22, padding: 0, border: 0, background: 'transparent', cursor: 'pointer',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <MdI name="information-outline" size={15} color={COLORS.muted}/>
          </button>
        )}
      </h2>
      {sub && <span style={{ font: `500 12px ${F}`, color: COLORS.muted }}>{sub}</span>}
    </div>
  );
}

function QuickActions({ intro = 'Noch mehr Punkte & Taler sammeln', onAction }) {
  return (
    <div>
      <div style={{
        font: `700 10px ${F}`, color: COLORS.muted,
        textTransform: 'uppercase', letterSpacing: '.08em',
        marginBottom: 8, paddingLeft: 2,
      }}>Schnellzugriff · {intro}</div>
      <div style={{
        display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8,
      }}>
        {QUICK_ACTIONS.map(a => (
          <button key={a.k} onClick={() => onAction && onAction(a.k)} style={{
            minHeight: 112,
            background: a.bg, color: a.dark ? '#fff' : COLORS.text,
            border: 0, borderRadius: 14, padding: '12px 10px',
            display: 'flex', flexDirection: 'column', alignItems: 'flex-start',
            justifyContent: 'space-between', cursor: 'pointer',
            textAlign: 'left',
          }}>
            <div style={{
              width: 30, height: 30, borderRadius: 8,
              background: a.dark ? 'rgba(255,255,255,.22)' : '#fff',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <MdI name={a.i} size={17} color={a.dark ? '#fff' : COLORS.primary}/>
            </div>
            <div style={{ width: '100%' }}>
              <div style={{ font: `700 12px/1.2 ${F}`, whiteSpace: 'pre-line' }}>{a.l}</div>
              <div style={{
                font: `800 9px ${F}`, marginTop: 6, letterSpacing: .4,
                display: 'inline-block',
                padding: '2px 6px', borderRadius: 4,
                background: a.dark ? 'rgba(255,255,255,.2)'
                                   : (a.kind === 'taler' ? 'rgba(13,133,117,.14)' : 'rgba(224,168,0,.2)'),
                color: a.dark ? '#fff'
                              : (a.kind === 'taler' ? COLORS.primary : '#8a6800'),
              }}>
                {a.reward}
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

function CatChip({ active, onClick, icon, label }) {
  return (
    <button onClick={onClick} style={{
      flexShrink: 0, height: 34, padding: '0 12px', borderRadius: 17,
      background: active ? COLORS.primary : '#fff',
      color: active ? '#fff' : COLORS.text,
      border: active ? '1px solid transparent' : '1px solid rgba(25,28,29,.09)',
      font: `600 12px ${F}`, cursor: 'pointer',
      display: 'inline-flex', alignItems: 'center', gap: 6,
    }}>
      <MdI name={icon} size={14} color={active ? '#fff' : COLORS.primary}/>
      {label}
    </button>
  );
}

function RewardCard({ r, canRedeem }) {
  return (
    <div style={{
      background: '#fff', borderRadius: 14, overflow: 'hidden',
      border: '1px solid rgba(25,28,29,.06)',
      opacity: canRedeem ? 1 : 0.88,
      position: 'relative',
    }}>
      {r.hot && (
        <div style={{
          position: 'absolute', top: 8, right: 8, zIndex: 2,
          background: '#ff3b30', color: '#fff',
          font: `800 9px ${F}`, letterSpacing: '.08em',
          padding: '3px 7px', borderRadius: 6, textTransform: 'uppercase',
        }}>BELIEBT</div>
      )}
      <div style={{
        height: 82, background: `linear-gradient(135deg,${r.tint},${adjust(r.tint, -24)})`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <div style={{
          minWidth: 56, height: 44, borderRadius: 8, background: '#fff',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: r.tint, font: `800 14px ${F}`, padding: '0 10px',
          boxShadow: '0 2px 6px rgba(0,0,0,.12)',
          letterSpacing: r.short.length > 2 ? '.02em' : 0,
        }}>{r.short || '●'}</div>
      </div>
      <div style={{ padding: '10px 12px 12px' }}>
        <div style={{ font: `700 10px ${F}`, color: COLORS.muted, letterSpacing: 0.7, textTransform: 'uppercase' }}>{r.brand}</div>
        <div style={{ font: `800 16px ${F}`, color: COLORS.text, marginTop: 2 }}>{r.value}</div>
      </div>
    </div>
  );
}

// ————————————————————————————————————————
// RANKS TAB (Bestenliste)
// ————————————————————————————————————————
function RanksTab({ onAction, openInfo }) {
  const [scope,  setScope]  = useStateS('friends');
  const [period, setPeriod] = useStateS('month');

  const rows = LB[scope][period];
  const topThree = rows.slice(0, 3);
  const rest = rows.slice(3);

  const meRow = rows.find(r => r.me);
  const meIdx = rows.findIndex(r => r.me);
  const userRank = meRow?.rank || (meIdx >= 0 ? meIdx + 1 : null);
  const totalInList = scope === 'friends' ? rows.length : null;
  const nextRival = meIdx > 0 ? rows[meIdx - 1] : null;
  const gapToRival = nextRival ? (nextRival.pts - meRow.pts) : 0;

  return (
    <>
      {/* Personal status hero */}
      <div style={{ padding: '4px 20px 0' }}>
        <StatusHero
          userRank={userRank}
          totalInList={totalInList}
          scopeLabel={scope === 'friends' ? 'von Freunden' : 'in Bayern'}
          openInfo={openInfo}
        />
      </div>

      {/* Quick actions — earn more points */}
      <div style={{ padding: '18px 20px 0' }}>
        <QuickActions intro="Mehr Detektiv-Punkte sammeln" onAction={onAction}/>
      </div>

      {/* Next rival nudge */}
      {nextRival && (
        <div style={{ padding: '10px 20px 0' }}>
          <div style={{
            background: '#fff', borderRadius: 14, border: '1px solid rgba(25,28,29,.06)',
            padding: '10px 12px', display: 'flex', alignItems: 'center', gap: 10,
          }}>
            <div style={{
              width: 34, height: 34, borderRadius: '50%', background: '#fff7e0',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              border: '1.5px solid #ffd44b', fontSize: 16, flexShrink: 0,
            }}>{nextRival.a}</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ font: `700 12px ${F}`, color: COLORS.text }}>
                Nächste Zielperson: <span style={{ color: COLORS.primary }}>{nextRival.n}</span>
              </div>
              <div style={{ font: `500 11px ${F}`, color: COLORS.muted, marginTop: 1 }}>
                Nur noch <b>{gapToRival.toLocaleString('de-DE')} Pkt</b> bis Platz {Math.max(1, (userRank || 2) - 1)}
              </div>
            </div>
            <MdI name="trending-up" size={20} color={COLORS.primary}/>
          </div>
        </div>
      )}

      {/* Season countdown */}
      {period === 'month' && (
        <div style={{ padding: '10px 20px 0' }}>
          <div style={{
            background: 'linear-gradient(135deg,#2d1b60 0%,#6b2fa3 100%)',
            borderRadius: 12, padding: '10px 12px', color: '#fff',
            display: 'flex', alignItems: 'center', gap: 10,
          }}>
            <MdI name="clock-outline" size={18} color="#ffd44b"/>
            <div style={{ flex: 1, font: `700 12px ${F}` }}>
              Saison „November" endet in <b>12 Tagen</b>
            </div>
            <div style={{
              font: `800 10px ${F}`, letterSpacing: .5,
              background: 'rgba(255,255,255,.16)', padding: '3px 7px', borderRadius: 6,
            }}>10 € TALER</div>
          </div>
        </div>
      )}

      {/* —— Simple filter: ONE big scope toggle + compact period chips —— */}
      <div style={{ padding: '22px 20px 0' }}>
        <SegCtrl
          options={[
            { k: 'friends', l: 'Freunde', i: 'account-group' },
            { k: 'state',   l: 'Bayern',  i: 'map-marker' },
          ]}
          value={scope} onChange={setScope} size="lg"/>
        <div style={{ display: 'flex', gap: 6, justifyContent: 'center', marginTop: 12 }}>
          {PERIODS.map(p => {
            const on = period === p.k;
            return (
              <button key={p.k} onClick={() => setPeriod(p.k)} style={{
                height: 30, padding: '0 14px', borderRadius: 15,
                background: on ? COLORS.text : 'transparent',
                color: on ? '#fff' : COLORS.muted,
                border: on ? 'none' : '1px solid rgba(25,28,29,.1)',
                font: `700 12px ${F}`, cursor: 'pointer',
              }}>{p.l}</button>
            );
          })}
        </div>
      </div>

      {/* —— Podium —— */}
      <div style={{ padding: '24px 20px 0' }}>
        <div style={{ marginTop: 2 }}>
          <Podium rows={topThree}/>
        </div>
      </div>

      {/* —— List rows 4+ —— */}
      <div style={{ padding: '18px 20px 0' }}>
        <div style={{ background: '#fff', borderRadius: 14, border: '1px solid rgba(25,28,29,.06)', overflow: 'hidden' }}>
          {rest.map((r, i) => {
            const rowRank = r.rank || i + 4;
            const prevRank = i === 0 ? 3 : (rest[i - 1].rank || i + 3);
            const gap = rowRank - prevRank > 1;
            return (
              <React.Fragment key={i}>
                {gap && (
                  <div style={{
                    padding: '6px 12px', background: 'rgba(25,28,29,.02)',
                    font: `600 10px ${F}`, color: COLORS.muted,
                    textAlign: 'center', letterSpacing: .6,
                    borderTop: '1px solid rgba(25,28,29,.05)',
                    borderBottom: '1px solid rgba(25,28,29,.05)',
                  }}>··· {rowRank - prevRank - 1} weitere ···</div>
                )}
                <LbRow rank={rowRank} row={r}
                  first={i === 0 && !gap} last={i === rest.length - 1}/>
              </React.Fragment>
            );
          })}
        </div>
        {scope === 'friends' && (
          <button style={{
            width: '100%', marginTop: 10, height: 42, borderRadius: 11,
            background: '#fff', color: COLORS.primary,
            border: `1px dashed ${COLORS.primary}`,
            font: `700 13px ${F}`, cursor: 'pointer',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
          }}>
            <MdI name="account-plus-outline" size={17} color={COLORS.primary}/>
            Freunde einladen
          </button>
        )}
        <div style={{
          marginTop: 10, display: 'flex', alignItems: 'center', gap: 6,
          font: `500 10px ${F}`, color: COLORS.muted,
          justifyContent: 'center',
        }}>
          <MdI name="information-outline" size={12} color={COLORS.muted}/>
          Sortiert nach Detektiv-Punkten · Ersparnis als Zusatzinfo
        </div>
      </div>

      {/* —— Achievements —— */}
      <div style={{ padding: '28px 20px 0' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 10 }}>
          <h2 style={{ font: `800 20px ${F}`, color: COLORS.text, margin: 0, letterSpacing: '-.01em', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            Errungenschaften
            <button onClick={()=>openInfo&&openInfo('achievements')} aria-label="Was sind Abzeichen?" style={{
              width: 22, height: 22, padding: 0, border: 0, background: 'transparent', cursor: 'pointer',
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <MdI name="information-outline" size={15} color={COLORS.muted}/>
            </button>
          </h2>
          <button style={{ background: 'transparent', border: 0, color: COLORS.primary, font: `700 13px ${F}`, cursor: 'pointer' }}>
            Alle ({ACHIEVEMENTS.length})
          </button>
        </div>
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <SummaryPill
            icon="trophy" color="#e0a800" bg="#fff7e0"
            n={ACHIEVEMENTS.filter(a => a.progress >= a.target).length}
            total={ACHIEVEMENTS.length} label="freigeschaltet"/>
          <SummaryPill
            icon="star-four-points" color={COLORS.primary} bg="rgba(13,133,117,.1)"
            n={ACHIEVEMENTS.filter(a => a.progress >= a.target).reduce((s,a)=>s+a.points,0)}
            label="Bonus-Pkt"/>
        </div>
        <div style={{ display: 'flex', gap: 10, overflowX: 'auto', scrollbarWidth: 'none', margin: '0 -20px', padding: '0 20px 2px' }}>
          {ACHIEVEMENTS.map((a, i) => <AchievementCard key={i} a={a}/>)}
        </div>
      </div>

      {/* —— City battle —— */}
      <div style={{ padding: '28px 20px 0' }}>
        <SecHeader title="Städte-Duell" sub={period === 'month' ? 'Diesen Monat' : 'Gesamt'} onInfo={()=>openInfo&&openInfo('season')}/>
        <div style={{
          background: '#fff', borderRadius: 14, border: '1px solid rgba(25,28,29,.06)',
          padding: '14px 14px 12px', marginTop: 10,
        }}>
          {CITY_BATTLE.map((c, i) => {
            const max = CITY_BATTLE[0].score;
            const pct = Math.round((c.score / max) * 100);
            const mine = c.city === 'München';
            const up = c.delta.startsWith('+');
            return (
              <div key={c.city} style={{ marginBottom: i === CITY_BATTLE.length - 1 ? 0 : 10 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 4 }}>
                  <span style={{
                    font: `700 13px ${F}`, color: mine ? COLORS.primary : COLORS.text,
                    display: 'inline-flex', alignItems: 'center', gap: 6,
                  }}>
                    {c.city}
                    {mine && <span style={{
                      font: `700 9px ${F}`, background: COLORS.primary, color: '#fff',
                      padding: '2px 6px', borderRadius: 4, letterSpacing: .4,
                    }}>DU</span>}
                  </span>
                  <span style={{ font: `500 11px ${F}`, color: up ? '#16a34a' : '#dc2626' }}>{c.delta}</span>
                </div>
                <div style={{ height: 6, background: 'rgba(25,28,29,.06)', borderRadius: 3, overflow: 'hidden' }}>
                  <div style={{
                    width: `${pct}%`, height: '100%',
                    background: mine ? COLORS.gradient : '#c3cacc',
                    borderRadius: 3,
                  }}/>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}

// —— Status Hero (green gradient, MD logo, rank + level + progress) ——
function StatusHero({ userRank, totalInList, scopeLabel, openInfo }) {
  return (
    <div style={{
      background: 'linear-gradient(135deg,#0a6f62 0%,#0d8575 55%,#10a18a 100%)',
      borderRadius: 20, padding: '18px 18px 18px', color: '#fff',
      position: 'relative', overflow: 'hidden',
    }}>
      {/* MD watermark */}
      <div style={{ position: 'absolute', right: -24, bottom: -28, opacity: .14 }}>
        <DetectiveMark size={170} color="#fff"/>
      </div>

      {/* Top row: avatar + name + rank badge */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, position: 'relative' }}>
        <div style={{
          width: 54, height: 54, borderRadius: '50%', background: '#fff',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 28, boxShadow: '0 4px 10px rgba(0,0,0,.18)',
          flexShrink: 0,
        }}>🦉</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ font: `800 17px ${F}`, letterSpacing: '-.01em' }}>{USER_NICK}</div>
          <div style={{ font: `600 11px ${F}`, opacity: .88, marginTop: 2, display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            <MdI name="shield-star-outline" size={12} color="#ffd44b"/>
            Level {DET_LEVEL.n} · {DET_LEVEL.name}
          </div>
        </div>
        <div style={{
          textAlign: 'right',
        }}>
          <div style={{
            font: `800 28px/1 ${F}`, letterSpacing: '-.03em',
            display: 'inline-flex', alignItems: 'baseline', gap: 2,
          }}>
            <span style={{ font: `700 14px ${F}`, opacity: .9 }}>#</span>{userRank || '–'}
          </div>
          <div style={{ font: `600 10px ${F}`, opacity: .85, marginTop: 2 }}>
            {totalInList ? `von ${totalInList}` : scopeLabel}
          </div>
        </div>
      </div>

      {/* Points + progress */}
      <div style={{ marginTop: 14, position: 'relative' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <div style={{ display: 'inline-flex', alignItems: 'baseline', gap: 4 }}>
            <span style={{ font: `800 26px/1 ${F}`, letterSpacing: '-.02em' }}>
              {DET_POINTS.toLocaleString('de-DE')}
            </span>
            <span style={{ font: `700 11px ${F}`, opacity: .9, display: 'inline-flex', alignItems: 'center', gap: 3 }}>
              Detektiv-Pkt
              <button onClick={()=>openInfo&&openInfo('points')} aria-label="Was sind Detektiv-Punkte?" style={{
                width: 18, height: 18, padding: 0, borderRadius: '50%',
                background: 'rgba(255,255,255,.2)', border: 0, cursor: 'pointer',
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <MdI name="information-outline" size={11} color="#fff"/>
              </button>
            </span>
          </div>
          <div style={{ font: `600 11px ${F}`, opacity: .85 }}>
            {DET_LEVEL.toNext} bis Lv {DET_LEVEL.n + 1}
          </div>
        </div>
        <div style={{ height: 7, background: 'rgba(255,255,255,.22)', borderRadius: 4, overflow: 'hidden', marginTop: 8 }}>
          <div style={{ width: `${DET_LEVEL.pct}%`, height: '100%', background: '#fff', borderRadius: 4 }}/>
        </div>
      </div>

      {/* Streak + freeze chips */}
      <div style={{ display: 'flex', gap: 8, marginTop: 12, position: 'relative' }}>
        <Chip3 icon="🔥" label={`${STREAK.days} Tage Streak`} sub={`+${STREAK.bonus} Pkt/Tag`}/>
        <Chip3 icon="❄️" label={`${STREAK.freezes}/2 Freezes`}/>
      </div>
    </div>
  );
}

function Chip3({ icon, label, sub }) {
  return (
    <div style={{
      background: 'rgba(255,255,255,.15)', borderRadius: 10, padding: '6px 10px',
      display: 'inline-flex', alignItems: 'center', gap: 6,
      backdropFilter: 'blur(4px)',
    }}>
      <span style={{ fontSize: 14 }}>{icon}</span>
      <div>
        <div style={{ font: `800 11px ${F}`, color: '#fff' }}>{label}</div>
        {sub && <div style={{ font: `600 9px ${F}`, color: '#fff', opacity: .8, marginTop: 1 }}>{sub}</div>}
      </div>
    </div>
  );
}

function FilterGroup({ label, children }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{
        font: `700 10px ${F}`, color: COLORS.muted,
        textTransform: 'uppercase', letterSpacing: '.08em',
        marginBottom: 6, paddingLeft: 2,
      }}>{label}</div>
      {children}
    </div>
  );
}

function SegCtrl({ options, value, onChange, size = 'md' }) {
  const H = size === 'lg' ? 42 : 34;
  return (
    <div style={{ display: 'flex', background: '#ECEEF0', padding: 3, borderRadius: 12, gap: 3 }}>
      {options.map(o => {
        const on = value === o.k;
        return (
          <button key={o.k} onClick={() => onChange(o.k)} style={{
            flex: 1, height: H, borderRadius: 9, border: 0,
            background: on ? '#fff' : 'transparent',
            color: on ? COLORS.text : COLORS.muted,
            font: `700 13px ${F}`, cursor: 'pointer',
            boxShadow: on ? '0 1px 3px rgba(0,0,0,.08)' : 'none',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
          }}>
            {o.i && <MdI name={o.i} size={15} color={on ? COLORS.primary : COLORS.muted}/>}
            {o.l}
          </button>
        );
      })}
    </div>
  );
}

function SummaryPill({ icon, color, bg, n, total, label }) {
  return (
    <div style={{
      flex: 1, background: bg, borderRadius: 12, padding: '10px 12px',
      display: 'flex', alignItems: 'center', gap: 8,
    }}>
      <MdI name={icon} size={18} color={color}/>
      <div>
        <div style={{ font: `800 14px ${F}`, color: COLORS.text }}>
          {typeof n === 'number' ? n.toLocaleString('de-DE') : n}{total ? `/${total}` : ''}
        </div>
        <div style={{ font: `600 10px ${F}`, color: COLORS.muted, marginTop: 1 }}>{label}</div>
      </div>
    </div>
  );
}

function AchievementCard({ a }) {
  const pct = Math.min(100, Math.round((a.progress / a.target) * 100));
  const done = pct >= 100;
  return (
    <div style={{
      flexShrink: 0, width: 150, background: '#fff', borderRadius: 14,
      border: `1px solid ${done ? a.color + '44' : 'rgba(25,28,29,.06)'}`,
      padding: '12px 12px 10px',
      position: 'relative',
    }}>
      {done && (
        <div style={{
          position: 'absolute', top: 8, right: 8,
          width: 16, height: 16, borderRadius: '50%',
          background: a.color, display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <MdI name="check" size={11} color="#fff"/>
        </div>
      )}
      <div style={{
        width: 38, height: 38, borderRadius: 10,
        background: done ? a.color : `${a.color}22`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        marginBottom: 8,
      }}>
        <MdI name={a.icon} size={20} color={done ? '#fff' : a.color}/>
      </div>
      <div style={{ font: `700 13px ${F}`, color: COLORS.text, lineHeight: 1.2 }}>{a.name}</div>
      <div style={{ font: `500 11px/1.3 ${F}`, color: COLORS.muted, marginTop: 4, minHeight: 28 }}>
        {a.desc}
      </div>
      <div style={{ marginTop: 8 }}>
        <div style={{ height: 4, background: 'rgba(25,28,29,.06)', borderRadius: 2, overflow: 'hidden' }}>
          <div style={{ width: `${pct}%`, height: '100%', background: done ? a.color : COLORS.primary }}/>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6 }}>
          <span style={{ font: `600 10px ${F}`, color: COLORS.muted }}>
            {done ? 'Freigeschaltet' : `${a.progress}/${a.target}`}
          </span>
          <span style={{ font: `800 10px ${F}`, color: COLORS.primary }}>+{a.points}</span>
        </div>
      </div>
    </div>
  );
}

const ACHIEVEMENTS = [
  { name: 'Es geht los!',           desc: 'Deine erste Aktion',            icon: 'thumb-up-outline',  color: '#8E8E93', points: 5,   progress: 1, target: 1 },
  { name: 'Erste Umwandlung',       desc: 'Wandle 1 Marke zu No-Name um',  icon: 'auto-fix',          color: '#007AFF', points: 5,   progress: 1, target: 1 },
  { name: 'Scanner-Profi',          desc: '50 Produkte scannen',           icon: 'barcode-scan',      color: '#5AC8FA', points: 10,  progress: 32, target: 50 },
  { name: 'Vergleichsexperte',      desc: '10 Produktvergleiche',          icon: 'scale-balance',     color: '#FF9500', points: 10,  progress: 7,  target: 10 },
  { name: 'Sammler',                desc: '25 Lieblingsprodukte',          icon: 'heart',             color: '#FF3B30', points: 15,  progress: 18, target: 25 },
  { name: '100 € gespart',          desc: 'Erreiche 100 € Ersparnis',      icon: 'currency-eur',      color: '#34C759', points: 20,  progress: 48, target: 100 },
  { name: 'Einkaufszettelmaster',   desc: '5 No-Name Zettel leer',         icon: 'format-list-checks',color: '#007AFF', points: 20,  progress: 2,  target: 5 },
  { name: 'Suchmeister',            desc: '100 Produkte suchen',           icon: 'magnify',           color: '#4CD964', points: 25,  progress: 62, target: 100 },
  { name: 'Feedbackgeber',          desc: '20 Bewertungen abgeben',        icon: 'comment-outline',   color: '#FF9500', points: 75,  progress: 4,  target: 20 },
  { name: 'Treu bleiben',           desc: '30 Tage in Folge öffnen',       icon: 'heart-pulse',       color: '#FF2D55', points: 150, progress: 18, target: 30 },
];

function Podium({ rows }) {
  if (rows.length < 3) {
    return (
      <div style={{ background: '#fff', borderRadius: 14, padding: 6, border: '1px solid rgba(25,28,29,.06)' }}>
        {rows.map((r, i) => <LbRow key={i} rank={i + 1} row={r} first={i === 0} last={i === rows.length - 1}/>)}
      </div>
    );
  }
  const [first, second, third] = rows;
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.2fr 1fr', gap: 8, alignItems: 'end' }}>
      <PodiumCol row={second} rank={2} h={92}  medal="🥈" tint="#c0c8cc"/>
      <PodiumCol row={first}  rank={1} h={118} medal="🥇" tint="#ffd44b" champion/>
      <PodiumCol row={third}  rank={3} h={76}  medal="🥉" tint="#d89966"/>
    </div>
  );
}

function PodiumCol({ row, rank, h, medal, tint, champion }) {
  const isMe = row.me;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <div style={{ position: 'relative', marginBottom: 6 }}>
        <div style={{
          width: champion ? 62 : 52, height: champion ? 62 : 52, borderRadius: '50%',
          background: '#fff',
          border: `3px solid ${tint}`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: champion ? 28 : 24,
          boxShadow: champion ? '0 4px 14px rgba(255,212,75,.45)' : '0 2px 6px rgba(0,0,0,.08)',
        }}>{row.a}</div>
        <div style={{
          position: 'absolute', bottom: -4, right: -4, width: 22, height: 22, borderRadius: '50%',
          background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 13, boxShadow: '0 2px 4px rgba(0,0,0,.15)',
        }}>{medal}</div>
      </div>
      <div style={{
        font: `700 12px ${F}`, color: isMe ? COLORS.primary : COLORS.text,
        maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        marginBottom: 2,
      }}>{row.n}</div>
      <div style={{
        width: '100%', height: h, marginTop: 4,
        background: champion ? `linear-gradient(180deg,${tint}33,${tint}66)` : `${tint}33`,
        border: `1px solid ${tint}99`,
        borderTopWidth: 2,
        borderRadius: '10px 10px 0 0',
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        padding: 6, gap: 2,
      }}>
        <div style={{ font: `800 24px/1 ${F}`, color: COLORS.text, letterSpacing: '-.02em' }}>{rank}</div>
        <div style={{ font: `800 11px ${F}`, color: COLORS.text, textAlign: 'center', lineHeight: 1.15 }}>
          {row.pts.toLocaleString('de-DE')} Pkt
        </div>
        <div style={{ font: `600 9px ${F}`, color: COLORS.muted, textAlign: 'center' }}>
          {row.eur.toFixed(2).replace('.', ',')} € gespart
        </div>
      </div>
    </div>
  );
}

function LbRow({ rank, row, first, last }) {
  const isMe = row.me;
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px',
      borderTop: first ? 'none' : '1px solid rgba(25,28,29,.05)',
      background: isMe ? 'rgba(13,133,117,.07)' : 'transparent',
    }}>
      <div style={{
        width: 24, font: `800 14px ${F}`, color: isMe ? COLORS.primary : COLORS.muted,
        textAlign: 'center',
      }}>{rank}</div>
      <div style={{
        width: 36, height: 36, borderRadius: '50%', background: '#fff',
        border: `1.5px solid ${isMe ? COLORS.primary : 'rgba(25,28,29,.1)'}`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 18, flexShrink: 0,
      }}>{row.a}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          font: `700 13px ${F}`, color: isMe ? COLORS.primary : COLORS.text,
          display: 'flex', alignItems: 'center', gap: 6,
        }}>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.n}</span>
          {isMe && <span style={{
            font: `700 9px ${F}`, background: COLORS.primary, color: '#fff',
            padding: '2px 6px', borderRadius: 4, letterSpacing: .4,
          }}>DU</span>}
        </div>
        <div style={{ font: `500 10px ${F}`, color: COLORS.muted, marginTop: 1 }}>
          {row.city} · {row.eur.toFixed(2).replace('.', ',')} € gespart
        </div>
      </div>
      <div style={{ textAlign: 'right', flexShrink: 0 }}>
        <div style={{ font: `800 14px ${F}`, color: isMe ? COLORS.primary : COLORS.text, whiteSpace: 'nowrap' }}>
          {row.pts.toLocaleString('de-DE')}
        </div>
        <div style={{ font: `600 9px ${F}`, color: COLORS.muted, marginTop: 1 }}>Pkt</div>
      </div>
    </div>
  );
}

// Util: darken a hex color
function adjust(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.max(0, Math.min(255, (n >> 16) + amt));
  const g = Math.max(0, Math.min(255, ((n >> 8) & 0xff) + amt));
  const b = Math.max(0, Math.min(255, (n & 0xff) + amt));
  return '#' + ((r << 16) | (g << 8) | b).toString(16).padStart(6, '0');
}

window.Rewards = Rewards;
