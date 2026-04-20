// Profile.jsx — user profile + settings + history sub-views
// Depends on globals: COLORS, F, MdI, DetectiveMark, PRODUCTS, MARKETS, useStateS, SH_SM

// ——— User profile data (mocked for Hannah K.) ———
const PROFILE = {
  name: 'Hannah K.',
  nickname: 'Hannah K.',
  avatarEmoji: '🦉',
  email: '9kss6sn8ff@privaterelay.appleid.com',
  memberSince: 'Mitglied seit Mai 2024',
  markets: ['lidl', 'aldi', 'rewe'],   // favorite markets (max 3)
  city: 'München',
  bundesland: 'Bayern',
  dob: '1992-07-14',
  gender: 'weiblich',
  totalSaved: 682.30,
  productsBought: 143,
  level: { n: 6, name: 'Clever-Shopper', pct: 85, toNext: 450 },
  points: 2340,
  streak: 18,
};

// Mock histories
const HIST_SEARCH = [
  { q: 'Milchreis',          when: 'Heute, 14:20',    hits: 4 },
  { q: 'Nutella',             when: 'Heute, 11:08',    hits: 3 },
  { q: 'Cola 1,5 L',          when: 'Gestern, 18:45',  hits: 4 },
  { q: 'Frischkäse',          when: 'Gestern, 09:12',  hits: 2 },
  { q: 'Haferdrink bio',      when: 'Mo, 16:30',       hits: 1 },
  { q: 'Caffè Crema',         when: 'Mo, 08:15',       hits: 2 },
  { q: 'Schokolade',          when: 'So, 19:44',       hits: 3 },
];
const HIST_SCAN = [
  { productId: 'milchreis',    when: 'Heute, 14:22',   result: 'Treffer' },
  { productId: 'nutella',      when: 'Gestern, 19:03', result: 'Treffer' },
  { productId: 'coca-cola',    when: 'Gestern, 18:48', result: 'Treffer' },
  { productId: 'philadelphia', when: 'Sa, 11:30',      result: 'Treffer' },
  { productId: 'lavazza',      when: 'Fr, 08:07',      result: 'Kein No-Name gefunden' },
];

const HIST_PURCHASE = [
  { id: 'milbona-mr', when: 'Heute',           market: 'lidl',     saved: 0.50 },
  { id: 'ja-cola',    when: 'Heute',           market: 'rewe',     saved: 0.94 },
  { id: 'fc-alpen',   when: 'Gestern',         market: 'lidl',     saved: 0.60 },
  { id: 'milbona-haf',when: 'Gestern',         market: 'lidl',     saved: 0.54 },
  { id: 'frischer-lidl', when: 'Sa',           market: 'lidl',     saved: 1.20 },
  { id: 'nk-lidl',    when: 'Fr',              market: 'lidl',     saved: 1.00 },
  { id: 'moreno-cc',  when: 'Do',              market: 'aldi',     saved: 4.00 },
];

const HIST_RATINGS = [
  { id: 'milbona-mr',  stars: 5, text: 'Schmeckt genau wie das Original – spare ich mir jetzt immer.' },
  { id: 'fc-alpen',    stars: 5, text: 'Krass gut für den Preis!' },
  { id: 'ja-cola',     stars: 4, text: 'Nicht ganz so süß, ansonsten top.' },
  { id: 'moreno-cc',   stars: 4, text: 'Solider Espresso für den Alltag.' },
  { id: 'frischer-lidl', stars: 3, text: 'Ok, etwas weniger cremig als das Markenprodukt.' },
];

const SHOP_LISTS = [
  { name: 'Wocheneinkauf',     count: 12, done:  8, updated: 'Heute' },
  { name: 'Drogerie',          count:  6, done:  2, updated: 'Gestern' },
  { name: 'Geburtstag Mama',   count:  4, done:  0, updated: 'Sa' },
];

const FAV_IDS = ['milbona-mr', 'fc-alpen', 'ja-cola', 'milbona-haf', 'frischer-lidl', 'moreno-cc'];

// Kassenbon-Einreichungen (vom User eingereicht)
const RECEIPT_LIMIT_WEEK = 6;
const RECEIPT_EUR_EACH   = 0.08;
const HIST_RECEIPTS = [
  { id: 'r-2847', when: 'Heute, 15:42',    dateSort: '2026-04-19', market: 'lidl',     total: 42.18, items: 11, status: 'approved', eur: 0.08 },
  { id: 'r-2846', when: 'Heute, 09:17',    dateSort: '2026-04-19', market: 'rewe',     total: 23.94, items: 7,  status: 'pending',  eur: 0.08 },
  { id: 'r-2841', when: 'Gestern, 18:32',  dateSort: '2026-04-18', market: 'aldi',     total: 38.72, items: 9,  status: 'approved', eur: 0.08 },
  { id: 'r-2835', when: 'Mo, 17:08',       dateSort: '2026-04-13', market: 'lidl',     total: 29.40, items: 6,  status: 'approved', eur: 0.08 },
  { id: 'r-2829', when: 'So, 11:22',       dateSort: '2026-04-12', market: 'rewe',     total: 51.08, items: 14, status: 'approved', eur: 0.08 },
  { id: 'r-2822', when: 'Fr, 19:55',       dateSort: '2026-04-10', market: 'kaufland', total: 67.32, items: 18, status: 'approved', eur: 0.08 },
  { id: 'r-2814', when: 'Di, 16:40',       dateSort: '2026-04-07', market: 'lidl',     total: 18.64, items: 4,  status: 'rejected', eur: 0.00, reason: 'Unleserlich' },
  { id: 'r-2808', when: 'Mo, 12:15',       dateSort: '2026-04-06', market: 'aldi',     total: 33.18, items: 8,  status: 'approved', eur: 0.08 },
];

const MARKET_LABELS = { lidl: 'Lidl', aldi: 'Aldi', rewe: 'Rewe', kaufland: 'Kaufland', penny: 'Penny', edeka: 'Edeka' };
const MARKET_TINTS  = { lidl: '#0050aa', aldi: '#00549f', rewe: '#cc071e', kaufland: '#e10915', penny: '#d40f14', edeka: '#005ca9' };

// Produktbild-Einreichungen (voller Datensatz: 7 Fotos)
const PHOTO_LIMIT_WEEK = 20;
const PHOTO_EUR_EACH   = 0.10;
const PHOTO_STEPS = [
  { n: 1, l: 'Produktfront',     i: 'image-outline',           hint: 'Gesamtes Produkt, lesbarer Markenname' },
  { n: 2, l: 'Produktrückseite', i: 'image-multiple-outline',  hint: 'Rückseite — Beschreibung & Herkunft' },
  { n: 3, l: 'EAN-Barcode',      i: 'barcode-scan',            hint: 'Strichcode scharf und vollständig im Bild' },
  { n: 4, l: 'Zutaten',          i: 'format-list-bulleted',    hint: 'Komplette Zutatenliste, scharf' },
  { n: 5, l: 'Nährwerte',        i: 'nutrition',               hint: 'Nährwerttabelle komplett sichtbar' },
  { n: 6, l: 'Hersteller',       i: 'factory',                 hint: 'Hersteller-/Importeur-Angabe' },
  { n: 7, l: 'Preisschild',      i: 'tag-outline',             hint: 'Regalpreis + Markt eindeutig erkennbar' },
];

const HIST_PHOTOSETS = [
  { id: 'ps-418', when: 'Heute, 16:05',   dateSort: '2026-04-19', product: 'Alpro Haferdrink 1 L',  market: 'rewe',     status: 'approved', eur: 0.10, done: 6 },
  { id: 'ps-417', when: 'Heute, 12:48',   dateSort: '2026-04-19', product: 'Milbona Milchreis',     market: 'lidl',     status: 'pending',  eur: 0.10, done: 6 },
  { id: 'ps-416', when: 'Heute, 09:22',   dateSort: '2026-04-19', product: 'Ja! Kakao Schoko',      market: 'rewe',     status: 'approved', eur: 0.10, done: 6 },
  { id: 'ps-412', when: 'Gestern, 18:14', dateSort: '2026-04-18', product: 'Fairtrade Cola 1,5 L',  market: 'aldi',     status: 'approved', eur: 0.10, done: 6 },
  { id: 'ps-411', when: 'Gestern, 17:58', dateSort: '2026-04-18', product: 'Chocolat des Alpes',    market: 'lidl',     status: 'approved', eur: 0.10, done: 6 },
  { id: 'ps-409', when: 'Gestern, 11:30', dateSort: '2026-04-18', product: 'K-Classic Frischkäse',  market: 'kaufland', status: 'approved', eur: 0.10, done: 6 },
  { id: 'ps-405', when: 'Mo, 16:40',      dateSort: '2026-04-13', product: 'Gut&Günstig Nusscreme', market: 'edeka',    status: 'approved', eur: 0.10, done: 6 },
  { id: 'ps-402', when: 'Mo, 14:12',      dateSort: '2026-04-13', product: 'Moreno Caffè Crema',    market: 'aldi',     status: 'rejected', eur: 0.00, done: 7, reason: 'Zutaten unscharf' },
  { id: 'ps-399', when: 'So, 10:05',      dateSort: '2026-04-12', product: 'Philadelphia Natur',    market: 'rewe',     status: 'approved', eur: 0.10, done: 6 },
  { id: 'ps-398', when: 'So, 09:48',      dateSort: '2026-04-12', product: 'Naturgut Bio-Joghurt',  market: 'penny',    status: 'approved', eur: 0.10, done: 6 },
  { id: 'ps-390', when: 'Sa, 15:30',      dateSort: '2026-04-11', product: 'Milram Butter',         market: 'rewe',     status: 'approved', eur: 0.10, done: 6 },
  { id: 'ps-385', when: 'Fr, 18:22',      dateSort: '2026-04-10', product: 'Hofer Pesto Basilikum', market: 'aldi',     status: 'approved', eur: 0.10, done: 6 },
  { id: 'ps-381', when: 'Do, 12:40',      dateSort: '2026-04-09', product: 'Edeka Bio Vollkornbrot',market: 'edeka',    status: 'approved', eur: 0.10, done: 6 },
  { id: 'ps-378', when: 'Di, 17:15',      dateSort: '2026-04-07', product: 'Penny Käse gerieben',   market: 'penny',    status: 'approved', eur: 0.10, done: 6 },
];

// Helper: find a product by no-name id (searches nested noNames)
function findByNoName(id) {
  for (const p of PRODUCTS) {
    const nn = p.noNames.find(n => n.id === id);
    if (nn) return { product: p, noName: nn };
  }
  return null;
}

// ——— Root component ———
function Profile({ onBack, onOpenProduct, onOpenRewards, onOpenReceiptScan, initialView = 'main' }) {
  const [view, setView] = useStateS(initialView);
  const go = (v) => {
    if (v === 'level') { onOpenRewards && onOpenRewards(); return; }
    setView(v);
  };

  // If Profile was entered directly into a sub-view (e.g. via Einstellungen tab),
  // the sub-view back button should exit the screen, not fall back to profile-main.
  const settingsBack = initialView === 'settings' ? onBack : () => setView('main');
  const receiptsBack = initialView === 'receipts' ? onBack : () => setView('main');
  const photosBack   = initialView === 'photos'   ? onBack : () => setView('main');
  const favoritesBack = initialView === 'favorites' ? onBack : () => setView('main');
  const listsBack    = initialView === 'lists'    ? onBack : () => setView('main');

  return (
    <div style={{ background: '#F9FAFB', minHeight: '100%', paddingBottom: 110, fontFamily: F }}>
      {view === 'main'       && <ProfileMain onBack={onBack} go={go}/>}
      {view === 'settings'   && <ProfileSettings onBack={settingsBack}/>}
      {view === 'lists'      && <ShoppingList onBack={listsBack} onOpenHistory={() => setView('list-history')}/>}
      {view === 'list-history' && <ShoppingHistory onBack={() => setView('main')}/>}
      {view === 'favorites'  && <ProfileFavorites onBack={favoritesBack} onOpenProduct={onOpenProduct}/>}
      {view === 'history'    && <ProfileHistory onBack={() => setView('main')} onOpenProduct={onOpenProduct}/>}
      {view === 'log'        && <ProfileLog onBack={() => setView('main')}/>}
      {view === 'ratings'    && <ProfileRatings onBack={() => setView('main')} onOpenProduct={onOpenProduct}/>}
      {view === 'receipts'   && <ProfileReceipts onBack={receiptsBack} onOpenScan={onOpenReceiptScan}/>}
      {view === 'photos'     && <ProfilePhotos onBack={photosBack}/>}
    </div>
  );
}

// ——— Sub-page header (green strip, back arrow, title) ———
function PageHeader({ onBack, title, right }) {
  return (
    <div style={{
      position: 'sticky', top: 0, zIndex: 10,
      background: '#F9FAFB',
      padding: '18px 20px 10px',
      display: 'flex', alignItems: 'center', gap: 10,
    }}>
      {onBack && (
        <button onClick={onBack} style={{
          width: 40, height: 40, borderRadius: 20, cursor: 'pointer',
          background: 'transparent', border: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          marginLeft: -8,
        }}>
          <MdI name="arrow-left" size={22} color={COLORS.primary}/>
        </button>
      )}
      <h1 style={{
        flex: 1, margin: 0, letterSpacing: '-.02em',
        font: `800 ${onBack ? 22 : 26}px ${F}`, color: COLORS.text,
        minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>
        {title}
      </h1>
      {right}
    </div>
  );
}

// ——————————————————————————————————————————————————
// MAIN PROFILE
// ——————————————————————————————————————————————————
function ProfileMain({ onBack, go }) {
  return (
    <>
      <PageHeader title="Profil"
        right={
          <button onClick={() => go('settings')} style={{
            width: 40, height: 40, borderRadius: 20, cursor: 'pointer',
            background: 'transparent', border: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            marginRight: -8,
          }}>
            <MdI name="pencil-outline" size={20} color={COLORS.primary}/>
          </button>
        }/>

      {/* Identity block */}
      <div style={{ padding: '16px 20px 0', display: 'flex', gap: 14, alignItems: 'center' }}>
        <div style={{
          width: 72, height: 72, borderRadius: '50%',
          background: COLORS.gradient,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 38, boxShadow: '0 4px 10px rgba(13,133,117,.25)',
          flexShrink: 0, border: '3px solid #fff',
        }}>{PROFILE.avatarEmoji}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ font: `800 22px ${F}`, color: COLORS.text, letterSpacing: '-.01em' }}>{PROFILE.name}</div>
          <div style={{
            font: `500 11px ${F}`, color: COLORS.muted, marginTop: 2,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>{PROFILE.email}</div>
          <div style={{ display: 'flex', gap: 6, marginTop: 7, flexWrap: 'wrap', alignItems: 'center' }}>
            <LocBadge icon="store-outline" label={PROFILE.markets.map(m => MARKETS[m].name).join(' · ')}/>
            <LocBadge icon="map-marker-outline" label={`${PROFILE.city}, ${PROFILE.bundesland}`}/>
          </div>
        </div>
      </div>

      {/* Level card — compact version of rewards hero */}
      <div style={{ padding: '18px 20px 0' }}>
        <button onClick={() => go('level')} style={{
          width: '100%', textAlign: 'left', border: 0, cursor: 'pointer', padding: 0,
          background: 'transparent',
        }}>
          <div style={{
            background: 'linear-gradient(135deg,#0a6f62 0%,#0d8575 55%,#10a18a 100%)',
            borderRadius: 16, padding: '14px 16px', color: '#fff',
            position: 'relative', overflow: 'hidden',
          }}>
            <div style={{ position: 'absolute', right: -16, bottom: -20, opacity: .15 }}>
              <DetectiveMark size={110} color="#fff"/>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, position: 'relative' }}>
              <div style={{
                width: 40, height: 40, borderRadius: 10, background: 'rgba(255,255,255,.2)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <MdI name="shield-star" size={22} color="#ffd44b"/>
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ font: `600 10px ${F}`, opacity: .85, letterSpacing: '.06em', textTransform: 'uppercase' }}>
                  Level {PROFILE.level.n}
                </div>
                <div style={{ font: `800 16px ${F}`, marginTop: 1, letterSpacing: '-.01em' }}>{PROFILE.level.name}</div>
              </div>
              <MdI name="chevron-right" size={20} color="#fff"/>
            </div>
            <div style={{ marginTop: 12, position: 'relative' }}>
              <div style={{
                display: 'flex', justifyContent: 'space-between',
                font: `600 10px ${F}`, opacity: .9, marginBottom: 5,
              }}>
                <span>{PROFILE.points.toLocaleString('de-DE')} Detektiv-Punkte</span>
                <span>{PROFILE.level.toNext} bis Lv {PROFILE.level.n + 1}</span>
              </div>
              <div style={{ height: 5, background: 'rgba(255,255,255,.22)', borderRadius: 3, overflow: 'hidden' }}>
                <div style={{ width: `${PROFILE.level.pct}%`, height: '100%', background: '#fff', borderRadius: 3 }}/>
              </div>
            </div>
          </div>
        </button>
      </div>

      {/* Savings + bought products */}
      <div style={{ padding: '12px 20px 0' }}>
        <div style={{
          background: 'linear-gradient(90deg,#f97316,#ea580c)',
          borderRadius: 14, padding: '12px 14px', color: '#fff',
          display: 'flex', alignItems: 'center', gap: 12,
        }}>
          <div style={{ flex: 1 }}>
            <div style={{ font: `500 10px ${F}`, opacity: .9, letterSpacing: '.06em', textTransform: 'uppercase' }}>
              Deine Gesamtersparnis
            </div>
            <div style={{ font: `800 22px/1.1 ${F}`, marginTop: 3, letterSpacing: '-.02em' }}>
              {PROFILE.totalSaved.toFixed(2).replace('.', ',')} €
            </div>
          </div>
          <div style={{
            background: 'rgba(255,255,255,.18)', borderRadius: 10, padding: '7px 10px',
            display: 'flex', flexDirection: 'column', alignItems: 'center',
          }}>
            <span style={{ font: `800 16px ${F}` }}>{PROFILE.productsBought}</span>
            <span style={{ font: `600 9px ${F}`, opacity: .9, whiteSpace: 'nowrap' }}>gekauft</span>
          </div>
        </div>
      </div>

      {/* Menu list */}
      <div style={{ padding: '18px 20px 0' }}>
        <div style={{ background: '#fff', borderRadius: 14, border: '1px solid rgba(25,28,29,.06)', overflow: 'hidden' }}>
          <MenuRow icon="trophy-outline"      color="#e0a800"       label="Belohnungen & Level"           sub={`Level ${PROFILE.level.n} · ${PROFILE.points.toLocaleString('de-DE')} Pkt`} onClick={() => go('level')} first/>
          <MenuRow icon="format-list-checks"  color={COLORS.primary} label="Einkaufszettel"              sub={`${SHOP_LISTS.length} Listen`}        onClick={() => go('lists')}/>
          <MenuRow icon="basket-check-outline" color="#0d8575"        label="Einkaufshistorie"            sub="Gekaufte Produkte aus dem Zettel" onClick={() => go('list-history')}/>
          <MenuRow icon="heart-outline"       color="#ef4444"       label="Deine Lieblingsprodukte"     sub={`${FAV_IDS.length} Produkte`}         onClick={() => go('favorites')}/>
          <MenuRow icon="history"             color="#8b5cf6"       label="Kaufhistorie"                sub={`${HIST_PURCHASE.length} Einträge`}    onClick={() => go('history')}/>
          <MenuRow icon="magnify"             color="#0ea5e9"       label="Such- & Scanverlauf"         sub={`${HIST_SEARCH.length + HIST_SCAN.length} Einträge`} onClick={() => go('log')}/>
          <MenuRow icon="receipt-text-outline" color="#0d8575"      label="Eingereichte Kassenbons"     sub={`${HIST_RECEIPTS.length} Bons · ${HIST_RECEIPTS.filter(r => r.status === 'approved').reduce((s,r) => s + r.eur, 0).toFixed(2).replace('.', ',')} € verdient`} onClick={() => go('receipts')}/>
          <MenuRow icon="camera-outline"      color="#8b5cf6"       label="Produktbilder eingereicht"  sub={`${HIST_PHOTOSETS.length} Datensätze · ${HIST_PHOTOSETS.filter(p => p.status === 'approved').reduce((s,p) => s + p.eur, 0).toFixed(2).replace('.', ',')} € verdient`} onClick={() => go('photos')}/>
          <MenuRow icon="star-outline"        color="#f59e0b"       label="Eigene Bewertungen"          sub={`${HIST_RATINGS.length} Bewertungen`} onClick={() => go('ratings')}/>
          <MenuRow icon="cog-outline"         color={COLORS.muted}  label="Profil bearbeiten"           onClick={() => go('settings')}          last/>
        </div>
      </div>

      {/* ——— Mehr ——— */}
      <SectionLabel>Mehr</SectionLabel>
      <div style={{ padding: '0 20px' }}>
        <div style={{ background: '#fff', borderRadius: 14, border: '1px solid rgba(25,28,29,.06)', overflow: 'hidden' }}>
          <MenuRow icon="account-plus-outline" color={COLORS.primary} label="Onboarding abschließen"     first/>
          <MenuRow icon="account-circle-outline" color={COLORS.primary} label="Mein Profil"/>
          <MenuRow icon="account-group-outline" color={COLORS.primary} label="Find us on social media"/>
          <MenuRow icon="star-outline"        color={COLORS.primary} label="App bewerten"/>
          <MenuRow icon="share-variant-outline" color={COLORS.primary} label="App teilen"                last/>
        </div>
      </div>

      {/* ——— Kontakt & Rechtliches ——— */}
      <SectionLabel>Kontakt &amp; Rechtliches</SectionLabel>
      <div style={{ padding: '0 20px' }}>
        <div style={{ background: '#fff', borderRadius: 14, border: '1px solid rgba(25,28,29,.06)', overflow: 'hidden' }}>
          <MenuRow icon="shield-outline"      color={COLORS.primary} label="Datenschutz & Haftungsausschluss" first/>
          <MenuRow icon="file-document-outline" color={COLORS.primary} label="AGB"/>
          <MenuRow icon="email-outline"       color={COLORS.primary} label="Kontakt"                    last/>
        </div>
      </div>

      {/* ——— Einstellungen / Toggles ——— */}
      <div style={{ padding: '14px 20px 0' }}>
        <div style={{ background: '#fff', borderRadius: 14, border: '1px solid rgba(25,28,29,.06)', overflow: 'hidden' }}>
          <ToggleRow icon="white-balance-sunny" label="Dunkler Modus" first/>
          <ToggleRow icon="bell-off-outline"    label="Gamification Benachrichtigungen deaktivieren" defaultOn last/>
        </div>
      </div>

      {/* Version */}
      <div style={{ padding: '18px 20px 0', textAlign: 'center' }}>
        <span style={{ font: `500 11px ${F}`, color: COLORS.muted }}>Version 1.0.24</span>
      </div>

      {/* Logout + delete */}
      <div style={{ padding: '18px 20px 0' }}>
        <button style={{
          width: '100%', height: 48, borderRadius: 12, border: 0,
          background: '#fff', color: '#dc2626',
          font: `700 14px ${F}`, cursor: 'pointer',
          boxShadow: '0 1px 2px rgba(0,0,0,.04)',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
          border: '1px solid rgba(220,38,38,.15)',
        }}>
          <MdI name="logout" size={17} color="#dc2626"/>
          Abmelden
        </button>
        <button style={{
          width: '100%', marginTop: 10, background: 'transparent', border: 0,
          color: COLORS.muted, font: `500 12px ${F}`, cursor: 'pointer',
          textDecoration: 'underline', textUnderlineOffset: 3,
        }}>
          Account löschen
        </button>
      </div>
    </>
  );
}

function LocBadge({ icon, label }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      padding: '3px 8px', borderRadius: 6,
      background: 'rgba(13,133,117,.08)', color: COLORS.primary,
      font: `700 10px ${F}`,
    }}>
      <MdI name={icon} size={12} color={COLORS.primary}/>
      {label}
    </span>
  );
}

function SectionLabel({ children }) {
  return (
    <div style={{
      padding: '18px 20px 8px',
      font: `600 12px ${F}`, color: COLORS.muted,
      letterSpacing: '.02em',
    }}>
      {children}
    </div>
  );
}

function ToggleRow({ icon, label, defaultOn, first, last }) {
  const [on, setOn] = React.useState(!!defaultOn);
  return (
    <button onClick={() => setOn(v => !v)} style={{
      width: '100%', background: '#fff', border: 0, cursor: 'pointer',
      padding: '14px 14px', display: 'flex', alignItems: 'center', gap: 12,
      borderTop: first ? 'none' : '1px solid rgba(25,28,29,.05)',
      textAlign: 'left',
    }}>
      <div style={{
        width: 34, height: 34, borderRadius: 9,
        background: `${COLORS.primary}18`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        flexShrink: 0,
      }}>
        <MdI name={icon} size={18} color={COLORS.primary}/>
      </div>
      <div style={{ flex: 1, minWidth: 0, font: `600 14px ${F}`, color: COLORS.text, paddingRight: 8 }}>
        {label}
      </div>
      <div style={{
        width: 38, height: 22, borderRadius: 22,
        background: on ? COLORS.primary : '#d1d5db',
        position: 'relative', transition: 'background .15s',
        flexShrink: 0,
      }}>
        <div style={{
          position: 'absolute', top: 2, left: on ? 18 : 2,
          width: 18, height: 18, borderRadius: '50%',
          background: '#fff', boxShadow: '0 1px 2px rgba(0,0,0,.2)',
          transition: 'left .15s',
        }}/>
      </div>
    </button>
  );
}

function MenuRow({ icon, color, label, sub, onClick, first, last }) {
  return (
    <button onClick={onClick} style={{
      width: '100%', background: '#fff', border: 0, cursor: 'pointer',
      padding: '14px 14px', display: 'flex', alignItems: 'center', gap: 12,
      borderTop: first ? 'none' : '1px solid rgba(25,28,29,.05)',
      textAlign: 'left',
    }}>
      <div style={{
        width: 34, height: 34, borderRadius: 9,
        background: `${color}18`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        flexShrink: 0,
      }}>
        <MdI name={icon} size={18} color={color}/>
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ font: `700 14px ${F}`, color: COLORS.text }}>{label}</div>
        {sub && <div style={{ font: `500 11px ${F}`, color: COLORS.muted, marginTop: 1 }}>{sub}</div>}
      </div>
      <MdI name="chevron-right" size={18} color={COLORS.muted}/>
    </button>
  );
}

// ——————————————————————————————————————————————————
// SETTINGS
// ——————————————————————————————————————————————————
function ProfileSettings({ onBack }) {
  const [name,        setName]        = useStateS(PROFILE.name);
  const [markets,     setMarkets]     = useStateS(PROFILE.markets);
  const [city,        setCity]        = useStateS(PROFILE.city);
  const [dob,         setDob]         = useStateS(PROFILE.dob);
  const [gender,      setGender]      = useStateS(PROFILE.gender);
  const [avatarEmoji, setAvatarEmoji] = useStateS(PROFILE.avatarEmoji);

  const toggleMarket = (id) => {
    if (markets.includes(id)) setMarkets(markets.filter(m => m !== id));
    else if (markets.length < 3) setMarkets([...markets, id]);
  };

  return (
    <>
      <PageHeader onBack={onBack} title="Einstellungen"
        right={
          <button style={{
            height: 36, padding: '0 14px', borderRadius: 18, border: 0,
            background: COLORS.primary, color: '#fff', cursor: 'pointer',
            font: `700 13px ${F}`,
          }}>Speichern</button>
        }/>

      {/* Avatar picker */}
      <div style={{ padding: '20px 20px 0' }}>
        <SettingsLabel>Profilbild</SettingsLabel>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 14, background: '#fff',
          borderRadius: 14, padding: '14px', border: '1px solid rgba(25,28,29,.06)',
        }}>
          <div style={{
            width: 64, height: 64, borderRadius: '50%',
            background: COLORS.gradient,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 34, border: '3px solid #fff',
            boxShadow: '0 2px 6px rgba(0,0,0,.08)',
          }}>{avatarEmoji}</div>
          <div style={{ flex: 1 }}>
            <button style={{
              height: 36, padding: '0 14px', borderRadius: 10, border: 0,
              background: COLORS.primary, color: '#fff', cursor: 'pointer',
              font: `700 12px ${F}`,
              display: 'inline-flex', alignItems: 'center', gap: 6,
            }}>
              <MdI name="camera-outline" size={14} color="#fff"/>
              Bild ändern
            </button>
            <div style={{ font: `500 10px ${F}`, color: COLORS.muted, marginTop: 6 }}>
              oder Emoji wählen
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
          {['🦉','🦊','🐻','🐨','🦝','🐸','🐷','🦁','🐰','🦄'].map(e => (
            <button key={e} onClick={() => setAvatarEmoji(e)} style={{
              width: 36, height: 36, borderRadius: 10, border: 0, cursor: 'pointer',
              background: avatarEmoji === e ? COLORS.primary : '#fff',
              fontSize: 18, boxShadow: '0 1px 2px rgba(0,0,0,.04)',
            }}>{e}</button>
          ))}
        </div>
      </div>

      {/* Name */}
      <div style={{ padding: '18px 20px 0' }}>
        <SettingsLabel>Name</SettingsLabel>
        <Field value={name} onChange={setName} icon="account-outline" placeholder="Vor- & Nachname"/>
      </div>

      {/* Favorite markets */}
      <div style={{ padding: '18px 20px 0' }}>
        <SettingsLabel hint={`${markets.length}/3 ausgewählt`}>Lieblingsmärkte</SettingsLabel>
        <div style={{
          background: '#fff', borderRadius: 14, padding: 10,
          border: '1px solid rgba(25,28,29,.06)',
          display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8,
        }}>
          {Object.entries(MARKETS).map(([k, m]) => {
            const on = markets.includes(k);
            const disabled = !on && markets.length >= 3;
            return (
              <button key={k} onClick={() => toggleMarket(k)} disabled={disabled} style={{
                height: 42, borderRadius: 10, cursor: disabled ? 'not-allowed' : 'pointer',
                background: on ? m.tint : '#f3f4f5',
                color: on ? '#fff' : (disabled ? COLORS.muted : COLORS.text),
                border: on ? 'none' : '1px solid rgba(25,28,29,.08)',
                font: `700 13px ${F}`,
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                opacity: disabled ? .45 : 1,
              }}>
                {on && <MdI name="check" size={14} color="#fff"/>}
                {m.name}
              </button>
            );
          })}
        </div>
      </div>

      {/* City */}
      <div style={{ padding: '18px 20px 0' }}>
        <SettingsLabel>Einkaufsort</SettingsLabel>
        <Field value={city} onChange={setCity} icon="map-marker-outline" placeholder="Stadt"/>
      </div>

      {/* DOB */}
      <div style={{ padding: '18px 20px 0' }}>
        <SettingsLabel>Geburtsdatum</SettingsLabel>
        <Field value={dob} onChange={setDob} icon="cake-variant-outline" placeholder="TT.MM.JJJJ" type="date"/>
      </div>

      {/* Gender */}
      <div style={{ padding: '18px 20px 0' }}>
        <SettingsLabel>Geschlecht</SettingsLabel>
        <div style={{ display: 'flex', gap: 6, background: '#ECEEF0', padding: 3, borderRadius: 11 }}>
          {[
            { k: 'weiblich', l: 'Weiblich' },
            { k: 'männlich', l: 'Männlich' },
            { k: 'divers',   l: 'Divers' },
            { k: '',         l: 'Keine Angabe' },
          ].map(o => {
            const on = gender === o.k;
            return (
              <button key={o.k || 'none'} onClick={() => setGender(o.k)} style={{
                flex: 1, height: 36, borderRadius: 8, border: 0,
                background: on ? '#fff' : 'transparent',
                color: on ? COLORS.text : COLORS.muted,
                font: `700 11px ${F}`, cursor: 'pointer',
                boxShadow: on ? '0 1px 3px rgba(0,0,0,.08)' : 'none',
              }}>{o.l}</button>
            );
          })}
        </div>
      </div>

      {/* Email (read-only) */}
      <div style={{ padding: '18px 20px 0' }}>
        <SettingsLabel>E-Mail-Adresse</SettingsLabel>
        <div style={{
          background: '#f3f4f5', borderRadius: 11, padding: '12px 14px',
          display: 'flex', alignItems: 'center', gap: 10,
          border: '1px solid rgba(25,28,29,.06)',
        }}>
          <MdI name="email-outline" size={16} color={COLORS.muted}/>
          <div style={{
            flex: 1, font: `500 12px ${F}`, color: COLORS.muted,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>{PROFILE.email}</div>
          <MdI name="lock-outline" size={14} color={COLORS.muted}/>
        </div>
      </div>

      <div style={{ height: 32 }}/>
    </>
  );
}

function SettingsLabel({ children, hint }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 7, paddingLeft: 2 }}>
      <div style={{
        font: `700 10px ${F}`, color: COLORS.muted,
        textTransform: 'uppercase', letterSpacing: '.08em',
      }}>{children}</div>
      {hint && <div style={{ font: `600 10px ${F}`, color: COLORS.primary }}>{hint}</div>}
    </div>
  );
}

function Field({ value, onChange, icon, placeholder, type = 'text' }) {
  return (
    <div style={{
      background: '#fff', borderRadius: 11, padding: '0 14px',
      display: 'flex', alignItems: 'center', gap: 10, height: 46,
      border: '1px solid rgba(25,28,29,.06)',
    }}>
      {icon && <MdI name={icon} size={16} color={COLORS.muted}/>}
      <input
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        style={{
          flex: 1, border: 0, outline: 0, background: 'transparent',
          font: `600 13px ${F}`, color: COLORS.text, minWidth: 0,
        }}
      />
    </div>
  );
}

// ——————————————————————————————————————————————————
// SHOPPING LISTS
// ——————————————————————————————————————————————————
function ProfileLists({ onBack }) {
  return (
    <>
      <PageHeader onBack={onBack} title="Einkaufszettel"
        right={
          <button style={{
            width: 40, height: 40, borderRadius: 20, cursor: 'pointer',
            background: 'transparent', border: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            marginRight: -8,
          }}>
            <MdI name="plus" size={22} color={COLORS.primary}/>
          </button>
        }/>
      <div style={{ padding: '20px 20px 0' }}>
        {SHOP_LISTS.map((l, i) => {
          const pct = Math.round((l.done / l.count) * 100);
          return (
            <div key={i} style={{
              background: '#fff', borderRadius: 14, padding: '14px 14px',
              border: '1px solid rgba(25,28,29,.06)', marginBottom: 10,
              display: 'flex', alignItems: 'center', gap: 12,
            }}>
              <div style={{
                width: 44, height: 44, borderRadius: 12,
                background: 'rgba(13,133,117,.1)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                flexShrink: 0,
              }}>
                <MdI name="format-list-checks" size={22} color={COLORS.primary}/>
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ font: `800 14px ${F}`, color: COLORS.text }}>{l.name}</div>
                <div style={{ font: `500 11px ${F}`, color: COLORS.muted, marginTop: 2 }}>
                  {l.done}/{l.count} erledigt · {l.updated}
                </div>
                <div style={{ height: 4, background: 'rgba(25,28,29,.06)', borderRadius: 2, overflow: 'hidden', marginTop: 6 }}>
                  <div style={{ width: `${pct}%`, height: '100%', background: COLORS.primary }}/>
                </div>
              </div>
              <MdI name="chevron-right" size={18} color={COLORS.muted}/>
            </div>
          );
        })}
      </div>
    </>
  );
}

// ——————————————————————————————————————————————————
// FAVORITES
// ——————————————————————————————————————————————————
function ProfileFavorites({ onBack, onOpenProduct }) {
  return (
    <>
      <PageHeader onBack={onBack} title="Lieblingsprodukte"/>
      <div style={{ padding: '18px 20px 0', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        {FAV_IDS.map(id => {
          const hit = findByNoName(id);
          if (!hit) return null;
          const { product, noName } = hit;
          return (
            <button key={id} onClick={() => onOpenProduct && onOpenProduct(product)} style={{
              background: '#fff', borderRadius: 14, border: '1px solid rgba(25,28,29,.06)',
              padding: 0, cursor: 'pointer', overflow: 'hidden', textAlign: 'left',
            }}>
              <div style={{
                height: 90, background: `linear-gradient(135deg,${product.tint[0]},${product.tint[1]})`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 44, position: 'relative',
              }}>
                {product.emoji}
                <div style={{
                  position: 'absolute', top: 6, right: 6,
                  width: 22, height: 22, borderRadius: '50%',
                  background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  boxShadow: '0 1px 2px rgba(0,0,0,.1)',
                }}>
                  <MdI name="heart" size={12} color="#ef4444"/>
                </div>
              </div>
              <div style={{ padding: '10px 10px 12px' }}>
                <div style={{
                  font: `700 12px ${F}`, color: COLORS.text, lineHeight: 1.2,
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>{noName.brand}</div>
                <div style={{
                  font: `500 10px ${F}`, color: COLORS.muted, marginTop: 2,
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>{noName.name}</div>
                <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ font: `800 12px ${F}`, color: COLORS.primary }}>
                    {noName.price.toFixed(2).replace('.', ',')} €
                  </span>
                  {MARKETS[noName.market] && (
                    <span style={{
                      font: `700 8px ${F}`, background: MARKETS[noName.market].tint,
                      color: '#fff', padding: '2px 5px', borderRadius: 4,
                    }}>{MARKETS[noName.market].name}</span>
                  )}
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </>
  );
}

// ——————————————————————————————————————————————————
// PURCHASE HISTORY
// ——————————————————————————————————————————————————
function ProfileHistory({ onBack, onOpenProduct }) {
  const totalSaved = HIST_PURCHASE.reduce((s, h) => s + h.saved, 0);
  return (
    <>
      <PageHeader onBack={onBack} title="Kaufhistorie"/>
      <div style={{ padding: '16px 20px 0' }}>
        <div style={{
          background: 'rgba(13,133,117,.08)', borderRadius: 12, padding: '10px 14px',
          display: 'flex', alignItems: 'center', gap: 10,
        }}>
          <MdI name="piggy-bank-outline" size={20} color={COLORS.primary}/>
          <div style={{ flex: 1, font: `500 12px ${F}`, color: COLORS.text }}>
            In diesen {HIST_PURCHASE.length} Käufen gespart:
          </div>
          <div style={{ font: `800 16px ${F}`, color: COLORS.primary }}>
            {totalSaved.toFixed(2).replace('.', ',')} €
          </div>
        </div>
      </div>
      <div style={{ padding: '14px 20px 0' }}>
        <div style={{ background: '#fff', borderRadius: 14, border: '1px solid rgba(25,28,29,.06)', overflow: 'hidden' }}>
          {HIST_PURCHASE.map((h, i) => {
            const hit = findByNoName(h.id);
            if (!hit) return null;
            const { product, noName } = hit;
            return (
              <button key={i} onClick={() => onOpenProduct && onOpenProduct(product)} style={{
                width: '100%', background: '#fff', border: 0, cursor: 'pointer',
                padding: '10px 12px', display: 'flex', alignItems: 'center', gap: 10,
                borderTop: i === 0 ? 'none' : '1px solid rgba(25,28,29,.05)',
                textAlign: 'left',
              }}>
                <div style={{
                  width: 40, height: 40, borderRadius: 10,
                  background: `linear-gradient(135deg,${product.tint[0]},${product.tint[1]})`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 22, flexShrink: 0,
                }}>{product.emoji}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ font: `700 13px ${F}`, color: COLORS.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {noName.brand} {noName.name}
                  </div>
                  <div style={{
                    font: `500 11px ${F}`, color: COLORS.muted, marginTop: 1,
                    display: 'inline-flex', alignItems: 'center', gap: 6,
                  }}>
                    {h.when}
                    <span>·</span>
                    {MARKETS[h.market] && (
                      <span style={{
                        font: `700 9px ${F}`, background: MARKETS[h.market].tint,
                        color: '#fff', padding: '1px 5px', borderRadius: 3,
                      }}>{MARKETS[h.market].name}</span>
                    )}
                  </div>
                </div>
                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                  <div style={{ font: `800 13px ${F}`, color: COLORS.primary }}>
                    −{h.saved.toFixed(2).replace('.', ',')} €
                  </div>
                  <div style={{ font: `500 9px ${F}`, color: COLORS.muted }}>gespart</div>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </>
  );
}

// ——————————————————————————————————————————————————
// SEARCH + SCAN LOG (combined tabs)
// ——————————————————————————————————————————————————
function ProfileLog({ onBack }) {
  const [tab, setTab] = useStateS('search');
  return (
    <>
      <PageHeader onBack={onBack} title="Such- & Scanverlauf"/>
      <div style={{ padding: '16px 20px 0' }}>
        <div style={{ display: 'flex', background: '#ECEEF0', padding: 3, borderRadius: 11, gap: 3 }}>
          {[['search','Suchen',HIST_SEARCH.length],['scan','Scans',HIST_SCAN.length]].map(([k,l,n]) => {
            const on = tab === k;
            return (
              <button key={k} onClick={() => setTab(k)} style={{
                flex: 1, height: 36, borderRadius: 8, border: 0,
                background: on ? '#fff' : 'transparent',
                color: on ? COLORS.text : COLORS.muted,
                font: `700 12px ${F}`, cursor: 'pointer',
                boxShadow: on ? '0 1px 3px rgba(0,0,0,.08)' : 'none',
              }}>{l} ({n})</button>
            );
          })}
        </div>
      </div>

      <div style={{ padding: '14px 20px 0' }}>
        <div style={{ background: '#fff', borderRadius: 14, border: '1px solid rgba(25,28,29,.06)', overflow: 'hidden' }}>
          {tab === 'search' && HIST_SEARCH.map((h, i) => (
            <div key={i} style={{
              padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 12,
              borderTop: i === 0 ? 'none' : '1px solid rgba(25,28,29,.05)',
            }}>
              <div style={{
                width: 34, height: 34, borderRadius: 9,
                background: 'rgba(14,165,233,.12)', flexShrink: 0,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <MdI name="magnify" size={17} color="#0ea5e9"/>
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ font: `700 13px ${F}`, color: COLORS.text }}>{h.q}</div>
                <div style={{ font: `500 11px ${F}`, color: COLORS.muted, marginTop: 1 }}>
                  {h.when} · {h.hits} Treffer
                </div>
              </div>
              <MdI name="chevron-right" size={18} color={COLORS.muted}/>
            </div>
          ))}
          {tab === 'scan' && HIST_SCAN.map((h, i) => {
            const p = PRODUCTS.find(p => p.id === h.productId) || {};
            return (
              <div key={i} style={{
                padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 12,
                borderTop: i === 0 ? 'none' : '1px solid rgba(25,28,29,.05)',
              }}>
                <div style={{
                  width: 34, height: 34, borderRadius: 9,
                  background: p.tint ? `linear-gradient(135deg,${p.tint[0]},${p.tint[1]})` : '#f3f4f5',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 18, flexShrink: 0,
                }}>{p.emoji || '📦'}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ font: `700 13px ${F}`, color: COLORS.text }}>{p.brand || 'Unbekannt'} {p.productName || ''}</div>
                  <div style={{
                    font: `500 11px ${F}`,
                    color: h.result === 'Treffer' ? COLORS.primary : COLORS.muted,
                    marginTop: 1,
                  }}>
                    {h.when} · {h.result}
                  </div>
                </div>
                <MdI name="chevron-right" size={18} color={COLORS.muted}/>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}

// ——————————————————————————————————————————————————
// OWN RATINGS
// ——————————————————————————————————————————————————
function ProfileRatings({ onBack, onOpenProduct }) {
  return (
    <>
      <PageHeader onBack={onBack} title="Deine Bewertungen"/>
      <div style={{ padding: '18px 20px 0' }}>
        {HIST_RATINGS.map((r, i) => {
          const hit = findByNoName(r.id);
          if (!hit) return null;
          const { product, noName } = hit;
          return (
            <button key={i} onClick={() => onOpenProduct && onOpenProduct(product)} style={{
              width: '100%', background: '#fff', border: '1px solid rgba(25,28,29,.06)',
              borderRadius: 14, padding: '12px 14px', marginBottom: 10, cursor: 'pointer',
              textAlign: 'left', display: 'flex', gap: 12, alignItems: 'flex-start',
            }}>
              <div style={{
                width: 46, height: 46, borderRadius: 11,
                background: `linear-gradient(135deg,${product.tint[0]},${product.tint[1]})`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 24, flexShrink: 0,
              }}>{product.emoji}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ font: `700 13px ${F}`, color: COLORS.text }}>
                  {noName.brand} {noName.name}
                </div>
                <div style={{ display: 'flex', gap: 2, marginTop: 4 }}>
                  {[1,2,3,4,5].map(n => (
                    <MdI key={n} name={n <= r.stars ? 'star' : 'star-outline'} size={13}
                      color={n <= r.stars ? '#f59e0b' : COLORS.muted}/>
                  ))}
                </div>
                <div style={{ font: `500 12px/1.4 ${F}`, color: COLORS.text, marginTop: 6, opacity: .85 }}>
                  „{r.text}"
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </>
  );
}

window.Profile = Profile;
window.ProfileReceipts = ProfileReceipts;
window.ProfilePhotos = ProfilePhotos;

// ——————————————————————————————————————————————————
// SUBMITTED PRODUCT PHOTO SETS + 6-STEP WIZARD
// ——————————————————————————————————————————————————
function ProfilePhotos({ onBack }) {
  const [wizard, setWizard] = useStateS(null);   // null | 'intro' | number (step index 0..5) | 'review'
  const [captured, setCaptured] = useStateS([false, false, false, false, false, false, false]);
  const [productName, setProductName] = useStateS('');

  const approved = HIST_PHOTOSETS.filter(p => p.status === 'approved');
  const pending  = HIST_PHOTOSETS.filter(p => p.status === 'pending');
  const rejected = HIST_PHOTOSETS.filter(p => p.status === 'rejected');
  const earned   = approved.reduce((s, p) => s + p.eur, 0);
  const thisWeek = HIST_PHOTOSETS.filter(p => ['2026-04-19','2026-04-18','2026-04-17','2026-04-16','2026-04-15','2026-04-14','2026-04-13'].includes(p.dateSort)).length;
  const remaining = Math.max(0, PHOTO_LIMIT_WEEK - thisWeek);
  const limitReached = remaining === 0;

  if (wizard !== null) {
    return (
      <PhotoWizard
        step={wizard}
        captured={captured}
        productName={productName}
        setProductName={setProductName}
        setCaptured={setCaptured}
        setStep={setWizard}
        onClose={() => { setWizard(null); setCaptured([false,false,false,false,false,false,false]); setProductName(''); }}
      />
    );
  }

  return <ProfilePhotosList
    onBack={onBack}
    earned={earned} approved={approved} pending={pending} rejected={rejected}
    thisWeek={thisWeek} remaining={remaining} limitReached={limitReached}
    onStartWizard={() => setWizard('intro')}
  />;
}

function ProfilePhotosList({ onBack, earned, approved, pending, rejected, thisWeek, remaining, limitReached, onStartWizard }) {
  const [filter, setFilter] = useStateS('all');
  const items = filter === 'all' ? HIST_PHOTOSETS
    : filter === 'approved' ? approved
    : filter === 'pending'  ? pending
    : rejected;

  const tabs = [
    { k: 'all',      l: 'Alle',       n: HIST_PHOTOSETS.length },
    { k: 'approved', l: 'Bestätigt',  n: approved.length },
    { k: 'pending',  l: 'In Prüfung', n: pending.length },
    { k: 'rejected', l: 'Abgelehnt',  n: rejected.length },
  ];

  return (
    <>
      <PageHeader onBack={onBack} title="Eingereichte Produktbilder"/>

      {/* Summary card */}
      <div style={{ padding: '4px 20px 0' }}>
        <div style={{
          background: 'linear-gradient(135deg,#5b21b6 0%,#7c3aed 55%,#a855f7 100%)',
          borderRadius: 18, padding: '16px 16px', color: '#fff',
          position: 'relative', overflow: 'hidden',
        }}>
          <div style={{ font: `700 10px ${F}`, letterSpacing: 1, opacity: .9, textTransform: 'uppercase' }}>
            Bisher verdient
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 4, marginTop: 4 }}>
            <span style={{ font: `800 32px/1 ${F}`, letterSpacing: '-.02em' }}>
              {earned.toFixed(2).replace('.', ',')}
            </span>
            <span style={{ font: `800 16px ${F}`, opacity: .95 }}>€</span>
            <span style={{ marginLeft: 8, font: `500 11px ${F}`, opacity: .88 }}>
              · {approved.length} Datensätze bestätigt
            </span>
          </div>
          <div style={{ marginTop: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', font: `600 11px ${F}`, opacity: .92, marginBottom: 5 }}>
              <span>Diese Woche: {thisWeek}/{PHOTO_LIMIT_WEEK}</span>
              <span>Noch {remaining} möglich</span>
            </div>
            <div style={{ height: 6, background: 'rgba(255,255,255,.22)', borderRadius: 3, overflow: 'hidden' }}>
              <div style={{
                width: `${Math.min(100, (thisWeek / PHOTO_LIMIT_WEEK) * 100)}%`,
                height: '100%', background: '#fff', borderRadius: 3,
              }}/>
            </div>
          </div>
        </div>
      </div>

      {/* Upload CTA */}
      <div style={{ padding: '12px 20px 0' }}>
        <button onClick={limitReached ? undefined : onStartWizard} disabled={limitReached} style={{
          width: '100%', height: 46, borderRadius: 12,
          background: limitReached ? '#ECEEF0' : '#7c3aed',
          color: limitReached ? COLORS.muted : '#fff',
          border: 0, font: `700 14px ${F}`, cursor: limitReached ? 'not-allowed' : 'pointer',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
        }}>
          <MdI name="camera-outline" size={18} color={limitReached ? COLORS.muted : '#fff'}/>
          {limitReached ? 'Wochenlimit erreicht' : `Neuen Datensatz einreichen (+${PHOTO_EUR_EACH.toFixed(2).replace('.', ',')} €)`}
        </button>
      </div>

      {/* Filter tabs */}
      <div style={{ padding: '18px 20px 0' }}>
        <div style={{ display: 'flex', gap: 6, overflowX: 'auto', scrollbarWidth: 'none', margin: '0 -20px', padding: '0 20px 2px' }}>
          {tabs.map(t => {
            const on = filter === t.k;
            return (
              <button key={t.k} onClick={() => setFilter(t.k)} style={{
                flexShrink: 0, height: 32, padding: '0 12px', borderRadius: 16,
                background: on ? '#7c3aed' : '#fff',
                color: on ? '#fff' : COLORS.text,
                border: on ? 'none' : '1px solid rgba(25,28,29,.09)',
                font: `700 12px ${F}`, cursor: 'pointer',
              }}>
                {t.l} <span style={{ opacity: .7, marginLeft: 4 }}>{t.n}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* List */}
      <div style={{ padding: '12px 20px 0' }}>
        <div style={{ background: '#fff', borderRadius: 14, border: '1px solid rgba(25,28,29,.06)', overflow: 'hidden' }}>
          {items.length === 0 && (
            <div style={{ padding: '30px 14px', textAlign: 'center', font: `500 13px ${F}`, color: COLORS.muted }}>
              Keine Einträge
            </div>
          )}
          {items.map((r, i) => {
            const tint = MARKET_TINTS[r.market] || '#6b7280';
            const label = MARKET_LABELS[r.market] || r.market;
            const badge = r.status === 'approved'
              ? { bg: 'rgba(124,58,237,.1)',  color: '#7c3aed',      icon: 'check-circle', text: 'Bestätigt' }
              : r.status === 'pending'
              ? { bg: 'rgba(245,158,11,.1)',  color: '#d97706',      icon: 'clock-outline',text: 'In Prüfung' }
              : { bg: 'rgba(220,38,38,.1)',   color: '#dc2626',      icon: 'close-circle', text: 'Abgelehnt' };
            return (
              <div key={r.id} style={{
                padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 12,
                borderTop: i === 0 ? 'none' : '1px solid rgba(25,28,29,.05)',
              }}>
                <div style={{
                  width: 46, height: 46, borderRadius: 10,
                  background: `linear-gradient(135deg,${tint}20,${tint}10)`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                  border: `1px solid ${tint}30`,
                }}>
                  <MdI name="camera-outline" size={22} color={tint}/>
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    font: `700 13px ${F}`, color: COLORS.text,
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>{r.product}</div>
                  <div style={{ font: `500 11px ${F}`, color: COLORS.muted, marginTop: 2 }}>
                    {r.when} · {label} · {r.done}/7 Fotos
                  </div>
                  <div style={{ marginTop: 5, display: 'inline-flex', alignItems: 'center', gap: 4,
                    font: `700 10px ${F}`, color: badge.color, background: badge.bg,
                    padding: '2px 7px', borderRadius: 4, letterSpacing: .3,
                  }}>
                    <MdI name={badge.icon} size={11} color={badge.color}/>
                    {badge.text}{r.reason ? ` · ${r.reason}` : ''}
                  </div>
                </div>
                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                  <div style={{
                    font: `800 13px ${F}`,
                    color: r.eur > 0 ? '#7c3aed' : COLORS.muted,
                    whiteSpace: 'nowrap',
                  }}>
                    {r.eur > 0 ? '+' : ''}{r.eur.toFixed(2).replace('.', ',')} €
                  </div>
                  <div style={{ font: `600 9px ${F}`, color: COLORS.muted, marginTop: 1 }}>Cashback</div>
                </div>
              </div>
            );
          })}
        </div>

        <div style={{
          marginTop: 12, padding: '10px 12px', background: 'rgba(25,28,29,.03)',
          borderRadius: 10, display: 'flex', alignItems: 'flex-start', gap: 8,
        }}>
          <MdI name="information-outline" size={14} color={COLORS.muted}/>
          <div style={{ font: `500 11px/1.4 ${F}`, color: COLORS.muted }}>
            Pro vollständigem Datensatz (7 Fotos) gibt es <b>{PHOTO_EUR_EACH.toFixed(2).replace('.', ',')} €</b> Cashback,
            max. <b>{PHOTO_LIMIT_WEEK} Datensätze pro Woche</b>. Nur komplett eingereichte Sets werden vergütet.
          </div>
        </div>
      </div>
    </>
  );
}

// ——— 7-step wizard ———
function PhotoWizard({ step, captured, setCaptured, productName, setProductName, setStep, onClose }) {
  // Notify App to hide tab bar + make chrome dark during camera capture steps.
  // Intro and review keep the regular app chrome.
  const fullscreen = step !== 'intro' && step !== 'review';
  React.useEffect(() => {
    if (fullscreen) {
      window.dispatchEvent(new Event('md-wizard-enter'));
      return () => window.dispatchEvent(new Event('md-wizard-exit'));
    }
  }, [fullscreen]);

  const [showHelp, setShowHelp] = React.useState(false);
  const [showOnboard, setShowOnboard] = React.useState(() =>
    window.shShouldShowPhotoOnboarding && window.shShouldShowPhotoOnboarding());

  if (showHelp) {
    return <window.PhotoHelpPage
      onBack={() => setShowHelp(false)}
      onReplayTour={() => {
        window.shResetPhotoOnboarding && window.shResetPhotoOnboarding();
        setShowHelp(false);
        setShowOnboard(true);
      }}
    />;
  }
  const onOpenHelp = () => setShowHelp(true);

  let content;
  if (step === 'intro') {
    content = <PhotoWizardIntro productName={productName} setProductName={setProductName} onStart={() => setStep(0)} onClose={onClose} onOpenHelp={onOpenHelp}/>;
  } else if (step === 'review') {
    content = <PhotoWizardReview captured={captured} productName={productName} onEdit={(i) => setStep(i)} onSubmit={onClose} onClose={onClose}/>;
  } else {
    content = (
      <PhotoWizardStep
        stepIdx={step}
        productName={productName}
        captured={captured}
        onCapture={() => {
          const next = [...captured]; next[step] = true; setCaptured(next);
          if (step < 6) setStep(step + 1);
          else setStep('review');
        }}
        onSkip={() => { step < 6 ? setStep(step + 1) : setStep('review'); }}
        onBack={() => { step === 0 ? setStep('intro') : setStep(step - 1); }}
        onClose={onClose}
        onGoto={(i) => setStep(i)}
      />
    );
  }

  return (<>
    {content}
    {showOnboard && <window.PhotoOnboarding onDone={() => setShowOnboard(false)}/>}
  </>);
}

function PhotoWizardIntro({ productName, setProductName, onStart, onClose, onOpenHelp }) {
  const nameOk = productName.trim().length >= 3;
  return (
    <>
      <PageHeader onBack={onClose} title="Neuer Datensatz" right={onOpenHelp && <window.HelpButton color="#7c3aed" onClick={onOpenHelp}/>}/>
      <div style={{ padding: '4px 20px 0' }}>
        <div style={{
          background: 'linear-gradient(135deg,#5b21b6,#7c3aed)', color: '#fff',
          borderRadius: 16, padding: '16px 16px',
        }}>
          <div style={{ font: `700 10px ${F}`, letterSpacing: 1, opacity: .9, textTransform: 'uppercase' }}>Voller Datensatz</div>
          <div style={{ font: `800 20px/1.2 ${F}`, marginTop: 6, letterSpacing: '-.01em' }}>
            7 Fotos = {PHOTO_EUR_EACH.toFixed(2).replace('.', ',')} € Cashback
          </div>
          <div style={{ font: `500 12px/1.45 ${F}`, opacity: .92, marginTop: 8 }}>
            Nur komplette Datensätze werden vergütet. Qualität ist wichtig — unscharfe Fotos werden abgelehnt.
          </div>
        </div>
      </div>

      <div style={{ padding: '18px 20px 0' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 6 }}>
          <div style={{ font: `700 11px ${F}`, color: COLORS.muted, letterSpacing: .5, textTransform: 'uppercase' }}>
            Produkt
          </div>
          <div style={{ font: `600 10px ${F}`, color: nameOk ? '#16a34a' : COLORS.muted, letterSpacing: .3 }}>
            {nameOk ? '✓ OK' : `${productName.trim().length}/3 Zeichen`}
          </div>
        </div>
        <input
          value={productName}
          onChange={(e) => setProductName(e.target.value)}
          placeholder="z. B. Alpro Haferdrink 1 L"
          style={{
            width: '100%', height: 46, borderRadius: 11, padding: '0 14px',
            background: '#fff',
            border: `1px solid ${nameOk ? 'rgba(22,163,74,.45)' : 'rgba(25,28,29,.1)'}`,
            font: `500 14px ${F}`, color: COLORS.text, outline: 'none', boxSizing: 'border-box',
          }}/>
        <div style={{ font: `500 11px/1.4 ${F}`, color: COLORS.muted, marginTop: 6 }}>
          Mindestens 3 Zeichen — Marke + Produktname (z. B. „Alpro Haferdrink 1 L").
        </div>
      </div>

      {/* Start button — placed right after the name field so it's immediately visible */}
      <div style={{ padding: '18px 20px 0' }}>
        <button
          onClick={nameOk ? onStart : undefined}
          disabled={!nameOk}
          style={{
            width: '100%', height: 52, borderRadius: 13,
            background: nameOk ? '#7c3aed' : '#ECEEF0',
            color: nameOk ? '#fff' : COLORS.muted,
            border: 0, font: `800 15px ${F}`, cursor: nameOk ? 'pointer' : 'not-allowed',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            boxShadow: nameOk ? '0 6px 18px rgba(124,58,237,.3)' : 'none',
            transition: 'all .15s',
          }}>
          <MdI name="camera-outline" size={18} color={nameOk ? '#fff' : COLORS.muted}/>
          Wizard starten
        </button>
        {!nameOk && (
          <div style={{ font: `500 11px ${F}`, color: COLORS.muted, marginTop: 8, textAlign: 'center' }}>
            Bitte gib zuerst einen Produktnamen ein (mind. 3 Zeichen).
          </div>
        )}
      </div>

      <div style={{ padding: '22px 20px 0' }}>
        <div style={{ font: `700 11px ${F}`, color: COLORS.muted, letterSpacing: .5, textTransform: 'uppercase', marginBottom: 10 }}>
          Ablauf · 6 Schritte
        </div>
        <div style={{ background: '#fff', borderRadius: 14, border: '1px solid rgba(25,28,29,.06)', overflow: 'hidden' }}>
          {PHOTO_STEPS.map((s, i) => (
            <div key={s.n} style={{
              display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px',
              borderTop: i === 0 ? 'none' : '1px solid rgba(25,28,29,.05)',
            }}>
              <div style={{
                width: 32, height: 32, borderRadius: 16, background: 'rgba(124,58,237,.1)',
                color: '#7c3aed', font: `800 13px ${F}`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>{s.n}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ font: `700 13px ${F}`, color: COLORS.text }}>{s.l}</div>
                <div style={{ font: `500 11px ${F}`, color: COLORS.muted, marginTop: 1 }}>{s.hint}</div>
              </div>
              <MdI name={s.i} size={20} color="#7c3aed"/>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

function PhotoWizardStep({ stepIdx, productName, captured, onCapture, onSkip, onBack, onClose, onGoto }) {
  const s = PHOTO_STEPS[stepIdx];
  const total = PHOTO_STEPS.length;
  const pct = ((stepIdx + 1) / total) * 100;
  return (
    <div style={{ position: 'absolute', inset: 0, background: '#0f0f0f', color: '#fff', display: 'flex', flexDirection: 'column', zIndex: 30 }}>
      {/* Top bar */}
      <div style={{
        position: 'sticky', top: 0, zIndex: 10, padding: '14px 16px 10px',
        background: 'linear-gradient(180deg, rgba(0,0,0,.7), rgba(0,0,0,0))',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button onClick={onBack} style={{
            width: 36, height: 36, borderRadius: 18, background: 'rgba(255,255,255,.14)', border: 0, cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <MdI name="arrow-left" size={20} color="#fff"/>
          </button>
          <div style={{ flex: 1 }}>
            <div style={{ font: `700 11px ${F}`, opacity: .7, letterSpacing: .4, textTransform: 'uppercase' }}>
              Schritt {stepIdx + 1} von {total}
            </div>
            <div style={{ font: `800 16px ${F}`, marginTop: 1 }}>{s.l}</div>
          </div>
          <button onClick={onClose} style={{
            width: 36, height: 36, borderRadius: 18, background: 'rgba(255,255,255,.14)', border: 0, cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <MdI name="close" size={20} color="#fff"/>
          </button>
        </div>
        {/* Progress */}
        <div style={{ marginTop: 10, height: 4, background: 'rgba(255,255,255,.14)', borderRadius: 2, overflow: 'hidden' }}>
          <div style={{ width: `${pct}%`, height: '100%', background: '#a855f7', borderRadius: 2, transition: 'width .25s' }}/>
        </div>
        {/* Step chips */}
        <div style={{ display: 'flex', gap: 4, marginTop: 10 }}>
          {PHOTO_STEPS.map((p, i) => {
            const done = captured[i];
            const active = i === stepIdx;
            return (
              <button key={p.n} onClick={() => onGoto(i)} style={{
                flex: 1, height: 26, borderRadius: 6,
                background: active ? '#a855f7' : done ? 'rgba(168,85,247,.35)' : 'rgba(255,255,255,.1)',
                border: 0, font: `700 10px ${F}`, color: '#fff', cursor: 'pointer',
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 3,
              }}>
                {done && <MdI name="check" size={11} color="#fff"/>}
                {p.n}
              </button>
            );
          })}
        </div>
      </div>

      {/* Viewfinder */}
      <div style={{ flex: 1, padding: '0 16px', display: 'flex', flexDirection: 'column' }}>
        <div style={{ font: `500 12px ${F}`, opacity: .8, marginTop: 6 }}>
          {productName || 'Dein Produkt'}
        </div>
        <div style={{
          flex: 1, marginTop: 10, borderRadius: 16,
          background: 'radial-gradient(circle at 50% 45%, #2a2a2a 0%, #111 70%)',
          border: '1px dashed rgba(255,255,255,.2)',
          position: 'relative', overflow: 'hidden',
          minHeight: 340,
        }}>
          {/* Corner crop markers */}
          {[[10,10,'tl'],[null,10,'tr'],[10,null,'bl'],[null,null,'br']].map((pos, i) => (
            <div key={i} style={{
              position: 'absolute',
              top: pos[1] !== null ? pos[1] : undefined, bottom: pos[1] === null ? 10 : undefined,
              left: pos[0] !== null ? pos[0] : undefined, right: pos[0] === null ? 10 : undefined,
              width: 26, height: 26,
              borderTop: pos[3] === 'tl' || pos[3] === 'tr' || i < 2 ? '3px solid rgba(168,85,247,.8)' : 'none',
              borderBottom: i >= 2 ? '3px solid rgba(168,85,247,.8)' : 'none',
              borderLeft: i === 0 || i === 2 ? '3px solid rgba(168,85,247,.8)' : 'none',
              borderRight: i === 1 || i === 3 ? '3px solid rgba(168,85,247,.8)' : 'none',
              borderRadius: 4,
            }}/>
          ))}

          {/* Ghost illustration */}
          <div style={{
            position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center', gap: 14, padding: 24,
            textAlign: 'center',
          }}>
            <div style={{
              width: 72, height: 72, borderRadius: 18,
              background: 'rgba(168,85,247,.18)',
              border: '1px solid rgba(168,85,247,.4)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <MdI name={s.i} size={36} color="#c084fc"/>
            </div>
            <div>
              <div style={{ font: `800 18px ${F}`, letterSpacing: '-.01em' }}>{s.l}</div>
              <div style={{ font: `500 12px/1.45 ${F}`, opacity: .7, marginTop: 4, maxWidth: 260 }}>
                {s.hint}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Bottom shutter */}
      <div style={{ padding: '16px 16px 24px', display: 'flex', alignItems: 'center', gap: 12, justifyContent: 'space-between' }}>
        <button onClick={onCapture} aria-label="Aus Galerie wählen" style={{
          width: 58, height: 58, borderRadius: 14, background: 'rgba(255,255,255,.12)',
          border: '1px solid rgba(255,255,255,.18)', cursor: 'pointer', padding: 0,
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2,
        }}>
          <MdI name="image-multiple-outline" size={22} color="#fff"/>
          <span style={{ font: `600 9px ${F}`, color: 'rgba(255,255,255,.85)' }}>Galerie</span>
        </button>
        <button onClick={onCapture} aria-label="Aufnahme" style={{
          width: 74, height: 74, borderRadius: 37, background: '#fff',
          border: '5px solid rgba(255,255,255,.3)', cursor: 'pointer', padding: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: '0 4px 20px rgba(168,85,247,.45)',
        }}>
          <div style={{ width: 56, height: 56, borderRadius: 28, background: '#a855f7' }}/>
        </button>
        <button onClick={onSkip} aria-label="Überspringen" style={{
          width: 58, height: 58, borderRadius: 14, background: 'rgba(255,255,255,.12)',
          border: '1px solid rgba(255,255,255,.18)', cursor: 'pointer', padding: 0,
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2,
        }}>
          <MdI name="skip-next-outline" size={22} color="#fff"/>
          <span style={{ font: `600 9px ${F}`, color: 'rgba(255,255,255,.85)' }}>Skip</span>
        </button>
      </div>
      <div style={{ padding: '0 16px 10px', font: `500 11px ${F}`, textAlign: 'center', color: 'rgba(255,255,255,.55)' }}>
        Kamera · Galerie-Import möglich — bereits geschossene Fotos können direkt verwendet werden.
      </div>
    </div>
  );
}

function PhotoWizardReview({ captured, productName, onEdit, onSubmit, onClose }) {
  const doneCount = captured.filter(Boolean).length;
  const complete = doneCount === 6;
  return (
    <>
      <PageHeader onBack={onClose} title="Datensatz prüfen"/>

      <div style={{ padding: '4px 20px 0' }}>
        <div style={{
          background: complete ? 'linear-gradient(135deg,#0a6f62,#0d8575)' : 'linear-gradient(135deg,#b45309,#f59e0b)',
          borderRadius: 16, padding: '14px 16px', color: '#fff',
          display: 'flex', alignItems: 'center', gap: 12,
        }}>
          <MdI name={complete ? 'check-circle' : 'alert-circle-outline'} size={28} color="#fff"/>
          <div style={{ flex: 1 }}>
            <div style={{ font: `800 15px ${F}` }}>
              {complete ? 'Alles komplett!' : `Noch ${7 - doneCount} Foto${7 - doneCount === 1 ? '' : 's'} fehlen`}
            </div>
            <div style={{ font: `500 11px ${F}`, opacity: .9, marginTop: 2 }}>
              {complete
                ? `Datensatz einreichen für +${PHOTO_EUR_EACH.toFixed(2).replace('.', ',')} € Cashback`
                : 'Nur vollständige Datensätze werden vergütet'}
            </div>
          </div>
        </div>
      </div>

      <div style={{ padding: '18px 20px 0' }}>
        <div style={{ font: `700 11px ${F}`, color: COLORS.muted, letterSpacing: .5, textTransform: 'uppercase', marginBottom: 8 }}>
          Produkt
        </div>
        <div style={{
          background: '#fff', borderRadius: 12, padding: '12px 14px',
          border: '1px solid rgba(25,28,29,.06)',
          font: `600 14px ${F}`, color: COLORS.text,
        }}>
          {productName || '—'}
        </div>
      </div>

      <div style={{ padding: '18px 20px 0' }}>
        <div style={{ font: `700 11px ${F}`, color: COLORS.muted, letterSpacing: .5, textTransform: 'uppercase', marginBottom: 10 }}>
          Deine Fotos
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          {PHOTO_STEPS.map((s, i) => {
            const done = captured[i];
            return (
              <button key={s.n} onClick={() => onEdit(i)} style={{
                position: 'relative', aspectRatio: '1/1', borderRadius: 12, overflow: 'hidden',
                background: done ? 'linear-gradient(135deg,#7c3aed22,#5b21b611)' : '#ECEEF0',
                border: `1px solid ${done ? 'rgba(124,58,237,.3)' : 'rgba(25,28,29,.08)'}`,
                cursor: 'pointer', padding: 10, textAlign: 'left',
                display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{
                    width: 22, height: 22, borderRadius: 11,
                    background: done ? '#7c3aed' : '#fff',
                    color: done ? '#fff' : COLORS.muted,
                    border: done ? 'none' : '1px solid rgba(25,28,29,.12)',
                    font: `800 11px ${F}`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>{s.n}</div>
                  {done
                    ? <MdI name="check-circle" size={18} color="#7c3aed"/>
                    : <MdI name="plus-circle-outline" size={18} color={COLORS.muted}/>}
                </div>
                <div>
                  <div style={{
                    width: 32, height: 32, borderRadius: 8,
                    background: done ? '#fff' : 'rgba(25,28,29,.06)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    marginBottom: 6,
                  }}>
                    <MdI name={s.i} size={18} color={done ? '#7c3aed' : COLORS.muted}/>
                  </div>
                  <div style={{ font: `700 12px ${F}`, color: COLORS.text }}>{s.l}</div>
                  <div style={{ font: `600 10px ${F}`, color: done ? '#7c3aed' : COLORS.muted, marginTop: 2 }}>
                    {done ? 'Aufgenommen' : 'Noch offen'}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      <div style={{ padding: '22px 20px 0' }}>
        <button
          onClick={complete ? onSubmit : undefined}
          disabled={!complete}
          style={{
            width: '100%', height: 50, borderRadius: 13,
            background: complete ? '#7c3aed' : '#ECEEF0',
            color: complete ? '#fff' : COLORS.muted,
            border: 0, font: `800 15px ${F}`, cursor: complete ? 'pointer' : 'not-allowed',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
          }}>
          <MdI name="cloud-upload-outline" size={18} color={complete ? '#fff' : COLORS.muted}/>
          {complete ? `Einreichen · +${PHOTO_EUR_EACH.toFixed(2).replace('.', ',')} €` : `Noch ${7 - doneCount} offen`}
        </button>
        <button onClick={onClose} style={{
          width: '100%', marginTop: 10, background: 'transparent', border: 0,
          color: COLORS.muted, font: `500 12px ${F}`, cursor: 'pointer',
          textDecoration: 'underline', textUnderlineOffset: 3,
        }}>
          Abbrechen & verwerfen
        </button>
      </div>
    </>
  );
}

// ——————————————————————————————————————————————————
// SUBMITTED RECEIPTS
// ——————————————————————————————————————————————————
function ProfileReceipts({ onBack, onOpenScan }) {
  const [filter, setFilter] = useStateS('all');
  const approved = HIST_RECEIPTS.filter(r => r.status === 'approved');
  const pending  = HIST_RECEIPTS.filter(r => r.status === 'pending');
  const rejected = HIST_RECEIPTS.filter(r => r.status === 'rejected');
  const earned   = approved.reduce((s, r) => s + r.eur, 0);
  const thisWeek = HIST_RECEIPTS.filter(r => ['2026-04-19','2026-04-18','2026-04-17','2026-04-16','2026-04-15','2026-04-14','2026-04-13'].includes(r.dateSort)).length;
  const remaining = Math.max(0, RECEIPT_LIMIT_WEEK - thisWeek);

  const items = filter === 'all' ? HIST_RECEIPTS
    : filter === 'approved' ? approved
    : filter === 'pending'  ? pending
    : rejected;

  const tabs = [
    { k: 'all',      l: 'Alle',       n: HIST_RECEIPTS.length },
    { k: 'approved', l: 'Bestätigt',  n: approved.length },
    { k: 'pending',  l: 'In Prüfung', n: pending.length },
    { k: 'rejected', l: 'Abgelehnt',  n: rejected.length },
  ];

  return (
    <>
      <PageHeader onBack={onBack} title="Eingereichte Kassenbons"/>

      {/* Summary card */}
      <div style={{ padding: '4px 20px 0' }}>
        <div style={{
          background: 'linear-gradient(135deg,#0a6f62 0%,#0d8575 55%,#10a18a 100%)',
          borderRadius: 18, padding: '16px 16px', color: '#fff',
          position: 'relative', overflow: 'hidden',
        }}>
          <div style={{ font: `700 10px ${F}`, letterSpacing: 1, opacity: .9, textTransform: 'uppercase' }}>
            Bisher verdient
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 4, marginTop: 4 }}>
            <span style={{ font: `800 32px/1 ${F}`, letterSpacing: '-.02em' }}>
              {earned.toFixed(2).replace('.', ',')}
            </span>
            <span style={{ font: `800 16px ${F}`, opacity: .95 }}>€</span>
            <span style={{ marginLeft: 8, font: `500 11px ${F}`, opacity: .88 }}>
              · {approved.length} bestätigte Bons
            </span>
          </div>

          {/* Week progress */}
          <div style={{ marginTop: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', font: `600 11px ${F}`, opacity: .92, marginBottom: 5 }}>
              <span>Diese Woche: {thisWeek}/{RECEIPT_LIMIT_WEEK}</span>
              <span>Noch {remaining} möglich</span>
            </div>
            <div style={{ height: 6, background: 'rgba(255,255,255,.22)', borderRadius: 3, overflow: 'hidden' }}>
              <div style={{
                width: `${Math.min(100, (thisWeek / RECEIPT_LIMIT_WEEK) * 100)}%`,
                height: '100%', background: '#fff', borderRadius: 3,
              }}/>
            </div>
          </div>
        </div>
      </div>

      {/* Upload CTA */}
      <div style={{ padding: '12px 20px 0' }}>
        <button disabled={remaining === 0} onClick={remaining === 0 ? undefined : onOpenScan} style={{
          width: '100%', height: 46, borderRadius: 12,
          background: remaining === 0 ? '#ECEEF0' : COLORS.primary,
          color: remaining === 0 ? COLORS.muted : '#fff',
          border: 0, font: `700 14px ${F}`, cursor: remaining === 0 ? 'not-allowed' : 'pointer',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
        }}>
          <MdI name="receipt-text-outline" size={18} color={remaining === 0 ? COLORS.muted : '#fff'}/>
          {remaining === 0 ? 'Wochenlimit erreicht' : `Neuen Kassenbon einreichen (+${RECEIPT_EUR_EACH.toFixed(2).replace('.', ',')} €)`}
        </button>
      </div>

      {/* Filter tabs */}
      <div style={{ padding: '18px 20px 0' }}>
        <div style={{ display: 'flex', gap: 6, overflowX: 'auto', scrollbarWidth: 'none', margin: '0 -20px', padding: '0 20px 2px' }}>
          {tabs.map(t => {
            const on = filter === t.k;
            return (
              <button key={t.k} onClick={() => setFilter(t.k)} style={{
                flexShrink: 0, height: 32, padding: '0 12px', borderRadius: 16,
                background: on ? COLORS.primary : '#fff',
                color: on ? '#fff' : COLORS.text,
                border: on ? 'none' : '1px solid rgba(25,28,29,.09)',
                font: `700 12px ${F}`, cursor: 'pointer',
              }}>
                {t.l} <span style={{ opacity: .7, marginLeft: 4 }}>{t.n}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Receipt list */}
      <div style={{ padding: '12px 20px 0' }}>
        <div style={{ background: '#fff', borderRadius: 14, border: '1px solid rgba(25,28,29,.06)', overflow: 'hidden' }}>
          {items.length === 0 && (
            <div style={{ padding: '30px 14px', textAlign: 'center', font: `500 13px ${F}`, color: COLORS.muted }}>
              Keine Einträge
            </div>
          )}
          {items.map((r, i) => {
            const tint = MARKET_TINTS[r.market] || '#6b7280';
            const label = MARKET_LABELS[r.market] || r.market;
            const badge = r.status === 'approved'
              ? { bg: 'rgba(13,133,117,.1)',  color: COLORS.primary, icon: 'check-circle', text: 'Bestätigt' }
              : r.status === 'pending'
              ? { bg: 'rgba(245,158,11,.1)',  color: '#d97706',      icon: 'clock-outline',text: 'In Prüfung' }
              : { bg: 'rgba(220,38,38,.1)',   color: '#dc2626',      icon: 'close-circle', text: 'Abgelehnt' };
            return (
              <div key={r.id} style={{
                padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 12,
                borderTop: i === 0 ? 'none' : '1px solid rgba(25,28,29,.05)',
              }}>
                <div style={{
                  width: 42, height: 42, borderRadius: 10, background: `${tint}15`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                  border: `1px solid ${tint}30`,
                }}>
                  <MdI name="receipt-text-outline" size={20} color={tint}/>
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                    <div style={{ font: `700 13px ${F}`, color: COLORS.text }}>{label}</div>
                    <div style={{ font: `600 11px ${F}`, color: COLORS.muted }}>· {r.items} Artikel</div>
                  </div>
                  <div style={{ font: `500 11px ${F}`, color: COLORS.muted, marginTop: 2 }}>
                    {r.when} · {r.total.toFixed(2).replace('.', ',')} €
                  </div>
                  <div style={{ marginTop: 5, display: 'inline-flex', alignItems: 'center', gap: 4,
                    font: `700 10px ${F}`, color: badge.color, background: badge.bg,
                    padding: '2px 7px', borderRadius: 4, letterSpacing: .3,
                  }}>
                    <MdI name={badge.icon} size={11} color={badge.color}/>
                    {badge.text}{r.reason ? ` · ${r.reason}` : ''}
                  </div>
                </div>
                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                  <div style={{
                    font: `800 13px ${F}`,
                    color: r.eur > 0 ? COLORS.primary : COLORS.muted,
                    whiteSpace: 'nowrap',
                  }}>
                    {r.eur > 0 ? '+' : ''}{r.eur.toFixed(2).replace('.', ',')} €
                  </div>
                  <div style={{ font: `600 9px ${F}`, color: COLORS.muted, marginTop: 1 }}>Cashback</div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Info footer */}
        <div style={{
          marginTop: 12, padding: '10px 12px', background: 'rgba(25,28,29,.03)',
          borderRadius: 10, display: 'flex', alignItems: 'flex-start', gap: 8,
        }}>
          <MdI name="information-outline" size={14} color={COLORS.muted}/>
          <div style={{ font: `500 11px/1.4 ${F}`, color: COLORS.muted }}>
            Pro Bon gibt es <b>{RECEIPT_EUR_EACH.toFixed(2).replace('.', ',')} €</b> Cashback,
            max. <b>{RECEIPT_LIMIT_WEEK} Bons pro Woche</b>. Die Prüfung dauert i. d. R. 24–48 Stunden.
          </div>
        </div>
      </div>
    </>
  );
}
