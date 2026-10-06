'use strict';

/**
 * review-console — Admin-Callables für die Review-Konsole (Web-Back-Office,
 * Hosting-Site md-receipt-admin). Produkt-Einreichungen (`crowd_uploads`)
 * sichten, filtern, suchen und entscheiden — einzeln und im Batch.
 *
 * Grundsätze (docs/REVIEW_CONSOLE_DESIGN.md):
 *  - Admin-only (Custom-Claim `admin:true`), Admin-SDK → keine Rules-Lockerung.
 *  - Das Tool setzt NUR den Status. Geld bucht ausschließlich der Trigger
 *    crowd-upload-reward auf der Flanke pending→approved (Idempotenz dort).
 *  - Die Doppel-Regel (Wochen-Sperre gegen sich selbst, Entscheidung Patrick
 *    02.10.2026) wird bei JEDER Freigabe frisch aus den Tatsachen berechnet —
 *    nicht aus einem Cache. `force:true` + Notiz übersteuert bewusst und wird
 *    am Doc vermerkt.
 *  - Gesperrte Konten (`cashback_sperren/{uid}`, Entscheidung Patrick
 *    02.10.2026) gibt die Konsole NIE frei, auch nicht mit force. Die Sperre
 *    wird in der Freigabe-Transaktion gelesen; scheitert das Lesen, wird nicht
 *    freigegeben. Die Morgenrunde lässt diese Fälle stumm liegen; in der
 *    Warteschlange stehen sie am Ende.
 *  - Was die Morgenrunde bei einem offenen Fall gefunden hat und die Konsole
 *    selbst nicht prüfen kann (gleiches Foto bei einem anderen Konto oder in
 *    einer älteren Einreichung, abweichende/unsichere Barcode-Nummer), steht
 *    in `review.rundeOffen` (Prüfrunde 2, 02.10.2026). precheckOf macht daraus
 *    `hold` — Freigabe nur mit force + Notiz. Jede Entscheidung hier ersetzt
 *    `review` und nimmt den Eintrag mit; sonst aktualisiert ihn der nächste Lauf.
 *  - Batch = pro ID eigene Transaktion + Ergebnis pro ID. Kein „alles oder nichts".
 *  - reviewNote immer positiv formuliert (Copy-Ton-Regel, CLAUDE.md).
 *
 * Ausroll-Reihenfolge seit 26.09.2026 (effektive Werte aus src/werte.js),
 * ergänzt 02.10.2026 (Wochen-Sperre, Barcode-Foto, Kontosperre):
 *  1. firestore.rules — sperrt die Namer-/Nachlese-Felder und `eanFotoOcr`
 *     beim Anlegen. Vorher vertraute die Konsole fälschbaren Werten; ginge
 *     diese Codebase zuerst live, könnte ein Client `eanFotoOcr` mit der
 *     gespeicherten Nummer vorbelegen.
 *  2. diese Codebase SOLO (Multi-Codebase-Deploys flaken, CLAUDE.md).
 *  3. hosting:md-receipt-admin — pruefen.html fällt zwar auf die Rohfelder
 *     zurück, zeigt nachgelesene Werte aber erst mit dieser Codebase.
 *  4. Gutschrift-Seite der Kontosperre (cashback-pipeline, crowd-upload-reward,
 *     survey-reward; Zweig claude/reward-sperre).
 *  5. ERST DANN `cashback_sperren/{uid}` anlegen.
 */

const admin = require('firebase-admin');
const { FieldValue } = require('firebase-admin/firestore');
const { onCall, onRequest, HttpsError } = require('firebase-functions/v2/https');
const logger = require('firebase-functions/logger');
const { REASON, dupZumSpeichern, ms, appGrund } = require('./src/duplicatePolicy');
const { SPERREN, ladeSperren, kontoSperreVon, sperreAusDaten } = require('./src/kontoSperre');
const {
  INDEX_FELDER, safeStatus, rowOf, stripPolicy, precheckOf, precheckFuerFall,
  nachbarnAus, nachbarnVon, gruppiereNachEan, eanIndex, baueFotoListe,
} = require('./src/einreichung');
const { eanVarianten } = require('./src/werte');
const { ortVonEinreichung, ortVonBon, ortsverzeichnisAusBons } = require('./src/ort');
const { pruefeOrtsanforderung } = require('./src/locationGate');
const { kachelUrl, pruefeKachelAnfrage, MIN_SCHLUESSEL } = require('./src/kachel');

admin.initializeApp();
const db = admin.firestore();

const REGION = 'europe-west1';
const COL = 'crowd_uploads';
const MAX_BATCH = 100;
const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 500;

function assertAdmin(req) {
  if (!req.auth || !req.auth.token || req.auth.token.admin !== true) {
    throw new HttpsError('permission-denied', 'Admin-Recht erforderlich.');
  }
  return req.auth.uid;
}

const fmtDate = (msValue) => (msValue ? new Date(msValue).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' }) : null);

/** Nutzer-Hinweise je Grund — positiv, vorwärts gewandt (nie „keine Vergütung"). */
function noteFor(reason, ctx = {}) {
  const until = fmtDate(ctx.lockUntil);
  switch (reason) {
    // Wochen-Sperre (Entscheidung Patrick 02.10.2026); der Altcode aus einer
    // noch nicht neu ausgerollten Konsole bekommt denselben Text.
    case REASON.SAME_USER_WEEK:
    case REASON.SAME_USER:
      return `Dieses Produkt hast du diese Woche schon erfasst — danke! Derselbe Artikel zählt wieder ab ${until || 'nächster Woche'}.`;
    case REASON.OTHER_USER:
      return `Dieses Produkt ist bei uns schon frisch erfasst — danke fürs Mitmachen! Ab ${until || 'in 30 Tagen'} zählt es wieder, oder sofort mit neuem Preis oder anderem Hersteller.`;
    case REASON.PENDING_OLDER:
      return 'Doppelt eingereicht — die frühere Einreichung zählt.';
    case 'unvollstaendig':
      return `Es fehlen Fotos (${(ctx.missing || []).join(', ') || 'siehe Liste'}). Mit allen sieben Ansichten klappt es beim nächsten Mal.`;
    case 'ean_fehlt':
      return 'Der Barcode (EAN, 8–14 Ziffern) ordnet das Produkt eindeutig zu — beim nächsten Mal bitte scannen oder eintippen.';
    case 'kein_produktname':
      return 'Der Produktname war nicht erkennbar — Vorderseite gut ausgeleuchtet und ohne Spiegelung, dann passt es.';
    case 'bilder_wiederverwendet':
      return 'Dieselben Fotos wurden schon für eine andere Einreichung verwendet — jedes Produkt braucht eigene Aufnahmen.';
    case 'fotos_unpassend':
      return 'Die Fotos zeigen nicht das erwartete Produkt — bitte alle Ansichten vom selben Artikel.';
    case 'preis_fehlt':
      return 'Auf dem Preisfoto war kein Preis zu sehen — beim nächsten Mal Preisschild oder Kassenbon fotografieren.';
    case 'produkt_bereits_verguetet':
      return 'Dieses Produkt hast du schon eingereicht und es wurde bereits vergütet — danke!';
    default:
      return ctx.note || 'Danke fürs Einreichen — beim nächsten Datensatz geht es weiter.';
  }
}

/**
 * Alle Einreichungen zu einer EAN-Menge (Chunks à 30 für `in`-Queries), über
 * BEIDE EAN-Felder: eine nur nachgelesene EAN (`eanRescueOcr`) ist genauso
 * Nachbar wie eine gescannte — die Runde gruppiert über eanOf. Abgefragt wird
 * jede Schreibweise derselben GTIN (werte.eanVarianten: „0" + EAN-13 ist
 * derselbe Artikel, Prüfrunde 02.10.2026). Ergebnis je GTIN — nachschlagen
 * mit nachbarnVon(byEan, ean).
 */
async function loadByEans(eans) {
  const list = [...new Set(eans.filter(Boolean).flatMap(eanVarianten))];
  const docs = [];
  for (let i = 0; i < list.length; i += 30) {
    const chunk = list.slice(i, i + 30);
    const [gescannt, nachgelesen] = await Promise.all([
      db.collection(COL).where('ean', 'in', chunk).get(),
      db.collection(COL).where('eanRescueOcr', 'in', chunk).get(),
    ]);
    docs.push(...gescannt.docs, ...nachgelesen.docs);
  }
  return gruppiereNachEan(docs);
}

/**
 * Nachbarn derselben effektiven EAN IN der Transaktion — beide Abfragen, sonst
 * sieht die Doppel-Regel eine parallele Freigabe über das andere Feld nicht.
 * Nacheinander gelesen: alle Reads stehen vor dem ersten Write, parallele
 * Transaktions-Reads bringen bei zwei Abfragen nichts.
 */
async function nachbarnInTx(tx, ean, ohneId) {
  const varianten = eanVarianten(ean); // höchstens 8 — `in` erlaubt 30
  const gescannt = await tx.get(db.collection(COL).where('ean', 'in', varianten));
  const nachgelesen = await tx.get(db.collection(COL).where('eanRescueOcr', 'in', varianten));
  return nachbarnAus([...gescannt.docs, ...nachgelesen.docs], ean, ohneId);
}

/**
 * Zusatz-Eingaben der Vorprüfung für EINEN Fall außerhalb einer Transaktion:
 * Kontosperre (Lesefehler → 'unbekannt') und die Einreichungen unter der
 * Nummer vom Barcode-Foto, wenn sie von der gespeicherten abweicht.
 */
async function fallOptionen(row) {
  const fotoEan = row.eanFoto && row.eanFoto.art === 'abweichend' ? row.eanFoto.gelesen : null;
  const [sperre, fotoEanRows] = await Promise.all([
    row.userId
      ? db.collection(SPERREN).doc(row.userId).get().then((d) => sperreAusDaten(d.data())).catch(() => 'unbekannt')
      : null,
    fotoEan ? loadByEans([fotoEan]).then((m) => nachbarnVon(m, fotoEan)) : null,
  ]);
  return { kontoSperre: sperre, fotoEanRows };
}

/**
 * Urteil eines Bons — EINE Stelle, damit Warteschlange und Fallkarte dasselbe
 * sagen. Vorher berechnete die Liste hier und die Karte im Browser noch einmal
 * selbst; derselbe Bon stand links grün und rechts gelb.
 *
 * Die Zuordnung folgt dem RISIKO, nicht der Texterkennung: `ocr_confidence_low`
 * trägt fast jeder Bon in der Prüfung — färbte man den, wäre alles gelb und die
 * Farbe sagte nichts mehr.
 */
const BON_URTEIL = {
  forensics_software: 'locked',
  duplicate_content_self: 'locked',
  duplicate_content_cross_user: 'locked',
  bon_date_future: 'hold',
  ocr_unavailable: 'hold',
  // Konfiguration nicht lesbar (dritte Prüfrunde 06.10.2026, cashback-pipeline
  // verarbeiteCashback) — technischer Ausfall, keine Aussage über den Bon.
  config_unavailable: 'hold',
  // Lauf zu langsam (03.10.2026, cashback-pipeline laufzeitPruefen) —
  // technischer Ausfall wie ocr_unavailable, keine Aussage über den Bon.
  lauf_zeitgrenze: 'hold',
  ocr_zeitbudget: 'hold',
  ocr_confidence_none: 'hold',
  mensch_hat_entschieden: 'hold',
  // Nachprüfung 05.10.2026 (cashback-pipeline Regel bild): Bild ähnelt einem
  // bezahlten Bon derselben Person — ein Mensch vergleicht die beiden.
  bild_aehnlich_bezahlt: 'hold',
  // … gegen einen Bon, der noch nicht entschieden war (Nachprüfung 06.10.2026,
  // zweite Runde; die Pipeline wartet vorher bis zu vier Läufe darauf).
  bild_aehnlich_offen: 'hold',
  // Nachprüfung 06.10.2026 (cashback-pipeline Regel seiteAbweichend, nur mit
  // doppelSeiteAbweichend: true): sieht aus wie ein weiterer Abschnitt bzw.
  // eine weitere Seite eines bezahlten Belegs, nur Uhrzeit, Bestellnummer
  // oder (App) der Tag weichen ab — ein Mensch vergleicht die beiden.
  seite_abweichend: 'hold',
  // Abschlussprüfung 06.10.2026 (cashback-pipeline `capture.bildNichtLesbar`):
  // die Datei ist kein Bild, das die Bildprüfung lesen kann (PDF, HEIC,
  // abgeschnitten) — der Abgleich mit früheren Bons fehlt, ein Mensch sieht hin.
  bild_nicht_pruefbar: 'hold',
};
const bonUrteil = (row) => BON_URTEIL[row.reviewReason] || (row.reconOk === false ? 'hold' : 'ok');

// ─── Listen + Statistik ─────────────────────────────────────────────

exports.reviewListUploads = onCall({ region: REGION, memory: '512MiB', timeoutSeconds: 60 }, async (req) => {
  assertAdmin(req);
  const p = req.data || {};
  const status = p.status && p.status !== 'all' ? String(p.status) : null;
  const limit = Math.min(MAX_LIMIT, Math.max(1, Number(p.limit) || DEFAULT_LIMIT));
  const offset = Math.max(0, Number(p.offset) || 0);
  const q = String(p.q || '').trim().toLowerCase();
  const from = Number(p.from) || null;
  const to = Number(p.to) || null;

  // Eine Gleichheits-Bedingung serverseitig (Single-Field-Index), Rest im
  // Speicher — 1,6 k Docs, kein Composite-Index nötig (Index-Lehre in CLAUDE.md).
  let query = db.collection(COL);
  if (status) query = query.where('status', '==', status);
  else if (p.userId) query = query.where('userId', '==', String(p.userId));
  const snap = await query.get();
  let rows = snap.docs.map(rowOf);

  if (p.userId) rows = rows.filter((r) => r.userId === String(p.userId));
  if (p.campaignId) rows = rows.filter((r) => (p.campaignId === 'none' ? !r.campaignId : r.campaignId === String(p.campaignId)));
  if (p.marketId) rows = rows.filter((r) => r.marketId === String(p.marketId));
  if (p.ean) rows = rows.filter((r) => String(r.anzeigeEan || '').includes(String(p.ean).replace(/\D/g, '')));
  if (from) rows = rows.filter((r) => (r.createdAt ?? 0) >= from);
  if (to) rows = rows.filter((r) => (r.createdAt ?? 0) <= to);
  if (p.holdReason) rows = rows.filter((r) => r.holdReasons.some((h) => String(h).startsWith(String(p.holdReason))) || r.rejectReason === p.holdReason);
  if (q) {
    rows = rows.filter((r) =>
      [r.anzeigeName, r.productName, r.productNameOcr, r.productNameRescueOcr, r.anzeigeEan, r.ean, r.userId, r.marketName, r.marketId, r.manufacturer, r.id]
        .some((v) => v && String(v).toLowerCase().includes(q)),
    );
  }

  // Vorprüfung für offene Einreichungen — frisch gegen ALLE Einreichungen
  // derselben EAN. Bewusst über ALLE offenen, nicht nur die gefilterte Seite:
  // sonst zeigte der Kopfzeilen-Zähler „davon Sperre" den Ausschnitt neben
  // globalen Werten.
  const allPending = status === 'pending' && !p.userId
    ? rows.filter((r) => r.status === 'pending')
    : (await db.collection(COL).where('status', '==', 'pending').get()).docs.map(rowOf);
  // Effektive EAN (auch nur nachgelesen) — wie reviewCases und die Runde.
  // Auch die Nummern vom Barcode-Foto, wo sie abweichen (Doppel-Regel dort, 02.10.2026).
  const fotoEan = (r) => (r.eanFoto && r.eanFoto.art === 'abweichend' ? r.eanFoto.gelesen : null);
  const [byEan, sperren] = await Promise.all([
    allPending.length ? loadByEans([...allPending.map((r) => r.anzeigeEan), ...allPending.map(fotoEan)]) : new Map(),
    ladeSperren(db),
  ]);
  const opts = (r) => ({ kontoSperre: kontoSperreVon(sperren, r.userId), fotoEanRows: fotoEan(r) ? nachbarnVon(byEan, fotoEan(r)) : null });
  const preById = new Map(allPending.map((r) => [r.id, precheckOf(r, nachbarnVon(byEan, r.anzeigeEan), opts(r))]));
  let lockedPendingCount = 0;
  for (const pre of preById.values()) if (pre.verdict === 'locked') lockedPendingCount++;
  for (const r of rows) {
    r.precheck = r.status === 'pending' ? preById.get(r.id) ?? precheckOf(r, nachbarnVon(byEan, r.anzeigeEan), opts(r)) : r.review?.precheck ?? null;
  }
  if (p.precheck && p.precheck !== 'all') rows = rows.filter((r) => r.precheck && r.precheck.verdict === p.precheck);

  rows.sort((a, b) => (p.sort === 'createdAt_asc' ? (a.createdAt ?? 0) - (b.createdAt ?? 0) : (b.createdAt ?? 0) - (a.createdAt ?? 0)));
  const total = rows.length;
  const page = rows.slice(offset, offset + limit).map(stripPolicy);

  // Zähler (Aggregations-Queries, je 1 Read) + Aktionen fürs Filter-Menü.
  const [cPending, cApproved, cRejected, campaignsSnap] = await Promise.all([
    db.collection(COL).where('status', '==', 'pending').count().get(),
    db.collection(COL).where('status', '==', 'approved').count().get(),
    db.collection(COL).where('status', '==', 'rejected').count().get(),
    db.collection('cashback_campaigns').get(),
  ]);
  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
  const cToday = await db.collection(COL).where('reviewedAt', '>=', todayStart).count().get().catch(() => null);
  const campaigns = campaignsSnap.docs.map((d) => ({ id: d.id, title: d.data().title || d.id, kind: d.data().kind || 'receipt', active: !!d.data().active, endAt: ms(d.data().endAt) }))
    .filter((c) => c.kind === 'product_photos').sort((a, b) => (b.endAt || 0) - (a.endAt || 0));
  return {
    rows: page, total, offset, limit,
    stats: { pending: cPending.data().count, approved: cApproved.data().count, rejected: cRejected.data().count, reviewedToday: cToday ? cToday.data().count : null, lockedPending: lockedPendingCount },
    campaigns,
  };
});

exports.reviewGetUpload = onCall({ region: REGION }, async (req) => {
  assertAdmin(req);
  const id = String((req.data && req.data.id) || '');
  if (!id) throw new HttpsError('invalid-argument', 'id fehlt.');
  const d = await db.collection(COL).doc(id).get();
  if (!d.exists) throw new HttpsError('not-found', 'Einreichung nicht gefunden.');
  const row = rowOf(d);
  // Nachbarn über BEIDE EAN-Felder und jede Schreibweise, gezählt nach
  // effektiver EAN — dasselbe Urteil wie reviewCases und die Runde.
  const varianten = eanVarianten(row.anzeigeEan);
  const [gescannt, nachgelesen, sameUserSnap] = await Promise.all([
    row.anzeigeEan ? db.collection(COL).where('ean', 'in', varianten).get() : null,
    row.anzeigeEan ? db.collection(COL).where('eanRescueOcr', 'in', varianten).get() : null,
    row.userId ? db.collection(COL).where('userId', '==', row.userId).get() : null,
  ]);
  const sameEan = row.anzeigeEan ? nachbarnAus([...gescannt.docs, ...nachgelesen.docs], row.anzeigeEan, id) : [];
  const sameUser = sameUserSnap ? sameUserSnap.docs.map(rowOf).filter((r) => r.id !== id).sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0)).slice(0, 30) : [];
  const precheck = precheckFuerFall(row, sameEan, await fallOptionen(row));
  const prior = precheck.dup && precheck.dup.priorId ? sameEan.find((r) => r.id === precheck.dup.priorId) : null;
  return { row: stripPolicy(row), precheck, prior: prior ? stripPolicy(prior) : null, sameEan: sameEan.map(stripPolicy), sameUser: sameUser.map(stripPolicy) };
});

// ─── Entscheidungen (einzeln + Batch) ───────────────────────────────

// 'reopen' holt eine ABGELEHNTE Einreichung zurück in die Warteschlange —
// die Rücknahme im Prüf-Werkzeug. Bewusst nur aus 'rejected': eine Freigabe
// hat bereits gebucht, die nimmt man nicht per Klick zurück. Der bisherige
// Grund bleibt in `review.wiedereroeffnet` (Doppel-Gründe → `hold`, precheckOf).
const DECISIONS = new Set(['approve', 'reject', 'hold', 'unhold', 'reopen']);

exports.reviewDecideUploads = onCall({ region: REGION, timeoutSeconds: 120 }, async (req) => {
  const adminUid = assertAdmin(req);
  const p = req.data || {};
  const ids = Array.isArray(p.ids) ? [...new Set(p.ids.map(String))] : [];
  const decision = String(p.decision || '');
  const reason = p.reason ? String(p.reason) : null;
  const note = p.note ? String(p.note).slice(0, 500) : null;
  const force = p.force === true;
  if (!ids.length) throw new HttpsError('invalid-argument', 'ids fehlt.');
  if (ids.length > MAX_BATCH) throw new HttpsError('invalid-argument', `Maximal ${MAX_BATCH} IDs pro Aufruf.`);
  if (!DECISIONS.has(decision)) throw new HttpsError('invalid-argument', 'decision muss approve|reject|hold|unhold sein.');
  if ((decision === 'reject' || decision === 'hold') && !reason) throw new HttpsError('invalid-argument', 'reason fehlt.');
  if (decision === 'reopen' && ids.length > 20) throw new HttpsError('invalid-argument', 'Rücknahme nur für einzelne Einreichungen.');
  if (decision === 'approve' && force && !note) throw new HttpsError('invalid-argument', 'force braucht eine Notiz.');

  // Chronologisch verarbeiten (älteste zuerst): sonst sieht bei zwei offenen
  // Einreichungen derselben EAN die NEUERE die ältere noch als `pending` und
  // wird als „doppelt_eingereicht" blockiert, obwohl sie nach Freigabe der
  // älteren regulär entschieden würde. Die Liste im Client ist createdAt DESC.
  let ordered = ids;
  try {
    const snaps = await db.getAll(...ids.map((id) => db.collection(COL).doc(id)), { fieldMask: ['createdAt'] });
    const at = new Map(snaps.map((sn) => [sn.id, ms(sn.data() && sn.data().createdAt) ?? 0]));
    ordered = [...ids].sort((a, b) => (at.get(a) ?? 0) - (at.get(b) ?? 0));
  } catch (e) {
    logger.warn('[review-console] Sortierung fehlgeschlagen, Eingabereihenfolge', { err: e.message });
  }

  const results = [];
  for (const id of ordered) {
    const ref = db.collection(COL).doc(id);
    try {
      const res = await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists) return { id, outcome: 'error', reason: 'not_found' };
        const row = rowOf(snap);
        const ts = FieldValue.serverTimestamp();

        if (decision === 'approve') {
          if (row.status !== 'pending') return { id, outcome: 'skipped', reason: `status_${row.status}` };
          // Gesperrtes Konto (Entscheidung Patrick 02.10.2026): nie freigeben,
          // auch nicht mit force. In der Transaktion gelesen; ein Lesefehler
          // bricht die Transaktion ab → 'error', also ebenfalls keine Freigabe.
          // Eigener Ausgang 'refused' (nicht 'blocked'): die Oberfläche bietet
          // bei 'blocked' „Trotzdem freigeben" an, das hier nichts nützt.
          const sperre = row.userId ? sperreAusDaten((await tx.get(db.collection(SPERREN).doc(row.userId))).data()) : null;
          if (sperre) {
            return { id, outcome: 'refused', reason: sperre === 'gesperrt' ? 'konto_gesperrt' : 'kontosperre_unbekannt' };
          }
          // Tatsachen JETZT: alle Einreichungen derselben effektiven EAN (Reads
          // in der Transaktion, damit ein paralleler Approve derselben EAN kollidiert)
          // — und unter der Nummer vom Barcode-Foto, wenn sie abweicht.
          const others = row.anzeigeEan ? await nachbarnInTx(tx, row.anzeigeEan, id) : [];
          const fotoEan = row.eanFoto && row.eanFoto.art === 'abweichend' ? row.eanFoto.gelesen : null;
          const fotoEanRows = fotoEan ? await nachbarnInTx(tx, fotoEan, id) : null;
          // `row` aus der Transaktion trägt `rundeOffen` (Befunde der Morgenrunde) — precheckOf hält damit an.
          const precheck = precheckOf(row, others, { fotoEanRows });
          if (precheck.verdict !== 'ok' && !force) {
            return { id, outcome: 'blocked', reason: precheck.reasons[0] || precheck.verdict, precheck };
          }
          const review = { precheck: { verdict: precheck.verdict, reasons: precheck.reasons, dup: dupZumSpeichern(precheck.dup) }, decidedBy: adminUid, forced: force, ...(force ? { forcedNote: note } : {}) };
          tx.update(ref, { status: 'approved', reviewedAt: ts, reviewedBy: adminUid, updatedAt: ts, review, holdReasons: FieldValue.delete(), rejectReason: FieldValue.delete(), ...(note && !force ? { reviewNote: note } : {}) });
          return { id, outcome: 'approved', precheck: review.precheck };
        }

        if (decision === 'reject') {
          if (row.status !== 'pending') return { id, outcome: 'skipped', reason: `status_${row.status}` };
          // Für Sperr-Gründe die Frist aus den Tatsachen holen (Notiz nennt das Datum).
          let ctx = { note };
          if (reason === REASON.SAME_USER_WEEK || reason === REASON.SAME_USER || reason === REASON.OTHER_USER) {
            const pre = precheckOf(row, row.anzeigeEan ? await nachbarnInTx(tx, row.anzeigeEan, id) : []);
            ctx = { note, lockUntil: pre.dup && pre.dup.lockUntil };
          }
          // Am Dokument der Code, nach dem die App ihren Text wählt (appGrund:
          // die Wochen-Sperre — auch aus einer noch alten Oberfläche mit dem
          // 30-Tage-Code — erscheint als `doppelt_eingereicht`, Entscheidung
          // Patrick 02.10.2026). Der gewählte Grund bleibt in review.reason.
          const code = appGrund(reason);
          tx.update(ref, {
            status: 'rejected', rejectReason: code, holdReasons: [...new Set([...(row.holdReasons || []), code])],
            reviewNote: note || noteFor(reason, ctx), reviewedAt: ts, reviewedBy: adminUid, updatedAt: ts,
            review: { decidedBy: adminUid, reason, lockUntil: ctx.lockUntil || null },
          });
          return { id, outcome: 'rejected', reason };
        }

        if (decision === 'hold') {
          if (row.status !== 'pending') return { id, outcome: 'skipped', reason: `status_${row.status}` };
          tx.update(ref, { holdReasons: [...new Set([...(row.holdReasons || []), reason])], reviewNote: note || noteFor(reason, { note }), reviewedAt: ts, reviewedBy: adminUid, updatedAt: ts });
          return { id, outcome: 'held', reason };
        }

        if (decision === 'reopen') {
          if (row.status !== 'rejected') return { id, outcome: 'skipped', reason: `status_${row.status}` };
          // Den bisherigen Grund behalten (Schlussprüfung 03.10.2026): sonst
          // stand eine Runden-Ablehnung wegen wiederverwendeter Fotos nach dem
          // Zurückholen als „ok" da — den md5-Abgleich kann die Konsole nicht
          // selbst — und F gab ohne Notiz frei. precheckOf hält damit an.
          const alt = snap.data() || {};
          const altReview = alt.review && typeof alt.review === 'object' ? alt.review : {};
          const kurz = (v) => (typeof v === 'string' && v ? v.slice(0, 60) : null);
          tx.update(ref, {
            status: 'pending',
            rejectReason: FieldValue.delete(),
            holdReasons: FieldValue.delete(),
            reviewNote: FieldValue.delete(),
            reviewedAt: FieldValue.delete(),
            updatedAt: ts,
            reviewedBy: adminUid,
            review: {
              reopenedBy: adminUid, at: ts,
              wiedereroeffnet: { vorherGrund: kurz(alt.rejectReason), vorherIntern: kurz(altReview.reason), vorherVon: kurz(altReview.decidedBy) || kurz(alt.reviewedBy) },
            },
          });
          return { id, outcome: 'reopened' };
        }

        // unhold
        if (row.status !== 'pending') return { id, outcome: 'skipped', reason: `status_${row.status}` };
        tx.update(ref, { holdReasons: FieldValue.delete(), reviewNote: FieldValue.delete(), updatedAt: ts, reviewedBy: adminUid });
        return { id, outcome: 'unheld' };
      });
      results.push(res);
    } catch (e) {
      logger.error('[review-console] decide failed', { id, decision, err: e.message });
      results.push({ id, outcome: 'error', reason: e.message });
    }
  }
  const tally = results.reduce((acc, r) => ((acc[r.outcome] = (acc[r.outcome] || 0) + 1), acc), {});
  logger.info('[review-console] decide', { adminUid, decision, reason, force, n: ids.length, tally });
  return { results, tally };
});

// ═══════════════════════════════════════════════════════════════════
// Bons (receipts) — sichten + Review auflösen über resolveCashbackReview
// ═══════════════════════════════════════════════════════════════════
//
// Geld-Entscheidungen bleiben in der cashback-pipeline (Caps, Ledger-Reverse,
// purchased_products, Push). Die Konsole ruft den bestehenden HTTPS-Resolver
// server-seitig mit dem Admin-Key aus Secret Manager auf — der Key verlässt
// nie den Browser. Nur Bons im Status `review` sind entscheidbar.

const { defineSecret } = require('firebase-functions/params');
const CASHBACK_ADMIN_KEY = defineSecret('NUTRITION_SCRAPER_TRIGGER_KEY');
const { resolverAufruf, gueltig: resolverEntscheidungGueltig } = require('./src/resolverAufruf');
const RECEIPT_STATUSES = new Set(['ocr_pending', 'review', 'approved', 'no_reward', 'rejected', 'paid', 'matched', 'upload_failed', 'uploading']);
const safeReceiptStatus = (v) => (RECEIPT_STATUSES.has(v) ? v : 'unknown');
const RECEIPT_LIST_FIELDS = [
  'status', 'userId', 'campaignId', 'merchant', 'store', 'bonDate', 'bonTime', 'bonTotalCents', 'eligibleItemCount', 'cashbackCents',
  'rejectReason', 'rejectDetail', 'reviewReason', 'reviewDecision', 'reviewResolvedAt', 'duplicateOf', 'createdAt', 'updatedAt',
  'storage.path', 'ocr.robust.confidence', 'ocr.robust.method', 'ocr.reconciliation.ok', 'ocr.reconciliation.signedDeltaCents',
  'ocr.parsed.merchant', 'bonDateCorrection', 'attempts', 'lastError', 'alreadyCredited',
  // Ergebnis der feldweisen Prüfung — ohne das ist der Beobachtungs-Modus
  // blind: er schriebe ein Feld, das niemand liest.
  'ocrFieldAgreement',
  // Doppel-Schutz in der Buchung und Belegart (04.10.2026) — aus demselben
  // Grund: der Beobachtungs-Modus der Doppel-Regeln braucht einen Leser.
  'doppelPruefung', 'belegart',
];

function receiptRowOf(d) {
  const x = d.data() || {};
  return {
    id: d.id,
    // Ergebnis der feldweisen Prüfung (86cbet2w1). Im Beobachtungs-Modus steht
    // hier, was das Gate im Dauer-Modus entschieden hätte.
    ocrFieldAgreement: x.ocrFieldAgreement ?? null,
    // Doppel-Prüfung der Buchung: Schalterstand und Treffer (Regel, Modus,
    // Gegen-Bon, Anteil gleicher Artikel). Nur für Admins sichtbar.
    doppelPruefung: x.doppelPruefung
      ? {
          modi: x.doppelPruefung.modi ?? null,
          treffer: Array.isArray(x.doppelPruefung.treffer) ? x.doppelPruefung.treffer : [],
          at: ms(x.doppelPruefung.at),
        }
      : null,
    // Prompt v1.5: kassenbon | app_kassenbon | online_bestellung | sonstiges.
    belegart: x.belegart ?? null,
    status: safeReceiptStatus(x.status),
    userId: x.userId ?? null,
    campaignId: x.campaignId ?? null,
    merchantId: x.merchant?.id ?? null,
    merchantName: x.merchant?.name ?? x.ocr?.parsed?.merchant ?? null,
    merchantLand: x.merchant?.land ?? null,
    store: x.store ? { street: x.store.street ?? null, zip: x.store.zip ?? null, city: x.store.city ?? null } : null,
    bonDate: x.bonDate ?? null,
    bonTime: x.bonTime ?? null,
    bonTotalCents: x.bonTotalCents ?? null,
    eligibleItemCount: x.eligibleItemCount ?? null,
    itemCount: Array.isArray(x.items) ? x.items.length : null,
    cashbackCents: x.cashbackCents ?? null,
    rejectReason: x.rejectReason ?? null,
    rejectDetail: x.rejectDetail ?? null,
    reviewReason: x.reviewReason ?? null,
    reviewDecision: x.reviewDecision ?? null,
    reviewResolvedAt: ms(x.reviewResolvedAt),
    duplicateOf: x.duplicateOf ? { receiptId: x.duplicateOf.receiptId ?? null, sameUser: x.duplicateOf.sameUser ?? null, kind: x.duplicateOf.kind ?? null } : null,
    createdAt: ms(x.createdAt),
    updatedAt: ms(x.updatedAt),
    storagePath: x.storage?.path ?? null,
    ocrConfidence: x.ocr?.robust?.confidence ?? null,
    ocrMethod: x.ocr?.robust?.method ?? null,
    reconOk: x.ocr?.reconciliation?.ok ?? null,
    reconDeltaCents: x.ocr?.reconciliation?.signedDeltaCents ?? null,
    bonDateCorrection: x.bonDateCorrection ?? null,
    attempts: x.attempts ?? null,
    lastError: x.lastError ?? null,
    alreadyCredited: x.alreadyCredited ?? null,
    items: Array.isArray(x.items) ? x.items : undefined,
  };
}

exports.reviewListReceipts = onCall({ region: REGION, memory: '512MiB', timeoutSeconds: 60 }, async (req) => {
  assertAdmin(req);
  const p = req.data || {};
  const status = p.status && p.status !== 'all' ? String(p.status) : null;
  const limit = Math.min(MAX_LIMIT, Math.max(1, Number(p.limit) || DEFAULT_LIMIT));
  const offset = Math.max(0, Number(p.offset) || 0);
  const q = String(p.q || '').trim().toLowerCase();
  const from = Number(p.from) || null;
  const to = Number(p.to) || null;

  // Eine Bedingung serverseitig: Status ODER Nutzer ODER (bei „alle") ein
  // Zeitfenster über createdAt (Default 30 Tage) — kein Composite-Index nötig.
  let query = db.collection('receipts');
  if (status) query = query.where('status', '==', status);
  else if (p.userId) query = query.where('userId', '==', String(p.userId));
  else query = query.where('createdAt', '>=', new Date(from || Date.now() - 30 * 86400000));
  const snap = await query.select(...RECEIPT_LIST_FIELDS).get();
  let rows = snap.docs.map(receiptRowOf).map(({ items, ...r }) => r);

  if (p.userId) rows = rows.filter((r) => r.userId === String(p.userId));
  if (p.merchantId) rows = rows.filter((r) => r.merchantId === String(p.merchantId));
  if (p.campaignId) rows = rows.filter((r) => (p.campaignId === 'none' ? !r.campaignId : r.campaignId === String(p.campaignId)));
  if (p.reason) rows = rows.filter((r) => r.rejectReason === p.reason || r.reviewReason === p.reason);
  if (from) rows = rows.filter((r) => (r.createdAt ?? 0) >= from);
  if (to) rows = rows.filter((r) => (r.createdAt ?? 0) <= to);
  if (q) {
    rows = rows.filter((r) =>
      [r.id, r.userId, r.merchantName, r.merchantId, r.store?.city, r.store?.zip, r.bonDate, r.rejectReason, r.reviewReason]
        .some((v) => v && String(v).toLowerCase().includes(q)),
    );
  }
  rows.sort((a, b) => (p.sort === 'createdAt_asc' ? (a.createdAt ?? 0) - (b.createdAt ?? 0) : (b.createdAt ?? 0) - (a.createdAt ?? 0)));
  const total = rows.length;
  const page = rows.slice(offset, offset + limit);

  const counts = {};
  await Promise.all(['review', 'ocr_pending', 'approved', 'no_reward', 'rejected'].map(async (st) => {
    const c = await db.collection('receipts').where('status', '==', st).count().get().catch(() => null);
    counts[st] = c ? c.data().count : null;
  }));
  return { rows: page, total, offset, limit, stats: counts };
});

exports.reviewGetReceipt = onCall({ region: REGION }, async (req) => {
  assertAdmin(req);
  const id = String((req.data && req.data.id) || '');
  if (!id) throw new HttpsError('invalid-argument', 'id fehlt.');
  const d = await db.collection('receipts').doc(id).get();
  if (!d.exists) throw new HttpsError('not-found', 'Bon nicht gefunden.');
  const row = receiptRowOf(d);
  const x = d.data();
  const dup = row.duplicateOf && row.duplicateOf.receiptId ? await db.collection('receipts').doc(row.duplicateOf.receiptId).select(...RECEIPT_LIST_FIELDS).get() : null;
  const ledger = row.userId
    ? await db.collection(`users/${row.userId}/cashback_ledger`).where('receiptId', '==', id).get().then((s) => s.docs.map((l) => ({ id: l.id, ...l.data(), createdAt: ms(l.data().createdAt) })))
    : [];
  const sameUser = row.userId
    ? await db.collection('receipts').where('userId', '==', row.userId).select(...RECEIPT_LIST_FIELDS).get().then((s) => s.docs.map(receiptRowOf).map(({ items, ...r }) => r).filter((r) => r.id !== id).sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0)).slice(0, 30))
    : [];
  return {
    row,
    ocr: { parsed: x.ocr?.parsed ?? null, robust: x.ocr?.robust ?? null, reconciliation: x.ocr?.reconciliation ?? null, promptVersion: x.ocr?.promptVersion ?? null },
    capture: x.capture ?? null,
    journeyLocation: x.journey?.location ?? null,
    duplicate: dup && dup.exists ? receiptRowOf(dup) : null,
    ledger,
    sameUser,
  };
});

exports.reviewDecideReceipt = onCall({ region: REGION, timeoutSeconds: 90, secrets: [CASHBACK_ADMIN_KEY] }, async (req) => {
  const adminUid = assertAdmin(req);
  const p = req.data || {};
  const receiptId = String(p.receiptId || '');
  const decision = String(p.decision || '');
  const reason = p.reason ? String(p.reason) : '';
  if (!receiptId) throw new HttpsError('invalid-argument', 'receiptId fehlt.');
  if (!resolverEntscheidungGueltig(decision, reason)) throw new HttpsError('invalid-argument', 'decision=approve|reject[&reason]|no_reward&reason=daily_cap_reached|weekly_cap_reached|per_user_cap_reached');
  // doppelStand: Stand der Zeile „Doppel-Prüfung", den der Prüfer sah (vierte
  // Prüfrunde 06.10.2026) — nur damit quittiert die Freigabe deren Treffer.
  const doppelStand = p.doppelStand == null || p.doppelStand === '' || !Number.isFinite(Number(p.doppelStand)) ? null : Number(p.doppelStand);
  const r = await resolverAufruf({ receiptId, decision, reason, duplicateOf: p.duplicateOf || null, priorStatus: p.priorStatus || null, doppelStand, schluessel: CASHBACK_ADMIN_KEY.value() });
  logger.info('[review-console] receipt decision', { adminUid, receiptId, decision, reason, http: r.http, code: r.code });
  // 409 = fachlich (nicht in review / campaign_missing / no_cashback_computed) — als Ergebnis zurückgeben, kein Exception-Rauschen.
  if (!r.ok) return r;
  await db.collection('receipts').doc(receiptId).set({ reviewConsole: { decidedBy: adminUid, decision, reason: reason || null, at: FieldValue.serverTimestamp() } }, { merge: true }).catch(() => {});
  return r;
});

// ═══════════════════════════════════════════════════════════════════
// Prüf-Werkzeug (Fokus-Modus) — ein Fall groß, Bilder sofort sichtbar
// ═══════════════════════════════════════════════════════════════════
//
// Warum eigene Callables statt der Listen oben: Prüfen heißt Bilder ansehen,
// nicht Tabellen lesen. Der Prüfer braucht EINEN Fall vollständig und den
// nächsten schon geladen — nicht 200 Zeilen mit Platzhaltern.
//
// Bild-URLs entstehen HIER, nicht im Browser. Firebase-Storage-Objekte tragen
// in ihren Metadaten ein Download-Token; daraus lässt sich die öffentliche
// URL direkt bauen. Das spart pro Bild einen SDK-Aufruf mit Rules-Prüfung im
// Client — bei sieben Fotos je Fall war genau das der Grund, warum die alte
// Ansicht langsam war und Bilder oft gar nicht erschienen.

const REQUIRED_STEPS_ORDER = ['front', 'rueckseite', 'hersteller', 'ean', 'naehrwerte', 'zutaten', 'preis'];
const STEP_LABEL_DE = {
  front: 'Vorderseite', rueckseite: 'Rückseite', hersteller: 'Hersteller',
  ean: 'Barcode', naehrwerte: 'Nährwerte', zutaten: 'Zutaten', preis: 'Preis',
};
let _bucket = null;
function storageBucket() {
  if (!_bucket) _bucket = admin.storage().bucket('markendetektive-895f7.appspot.com');
  return _bucket;
}

/** Storage-Pfad → direkt ladbare URL (Download-Token aus den Metadaten). */
async function imageUrl(path) {
  if (!path) return null;
  try {
    const file = storageBucket().file(path);
    const [md] = await file.getMetadata();
    const token = md.metadata && md.metadata.firebaseStorageDownloadTokens;
    if (!token) return null;
    const t = String(token).split(',')[0];
    return `https://firebasestorage.googleapis.com/v0/b/${storageBucket().name}/o/${encodeURIComponent(path)}?alt=media&token=${t}`;
  } catch (e) {
    return null;
  }
}

/**
 * Verkleinerte Ansicht über den eigenen Endpunkt `reviewKachel` (unten).
 * Die Originale sind ~5 MB — sieben davon je Fall wären 34 MB und genau der
 * Grund, warum die alte Konsole unbenutzbar war. Eine Kachel hat ~50–90 KB
 * und ein Jahr Cache-Control. Das Original bleibt für die Lupe (`imageUrl`).
 *
 * Bis 01.10.2026 lief das über die Extension image-processing-api (Node 14,
 * abgekündigt), die jeden Bucket-Pfad ohne Anmeldung auslieferte. Jetzt
 * stellt NUR diese Funktion — nach der Admin-Prüfung in reviewCases — eine
 * signierte, ablaufende URL aus; der Endpunkt lehnt alles andere mit 403 ab.
 */
const KACHEL_SCHLUESSEL = defineSecret('REVIEW_KACHEL_SIGNING_KEY');
const KACHEL_BASIS = 'https://europe-west1-markendetektive-895f7.cloudfunctions.net/reviewKachel';
/**
 * `private` statt `public` wie bei der Extension: gleiche Wirkung im Browser,
 * aber kein geteilter Cache (Proxy) darf Bons und Produktfotos ablegen.
 */
const KACHEL_CACHE = 'private, max-age=31536000, immutable';

let kachelSchluesselGemeldet = false;
function kachelSchluessel() {
  let wert = null;
  try { wert = KACHEL_SCHLUESSEL.value(); } catch (e) { wert = null; }
  if ((!wert || wert.length < MIN_SCHLUESSEL) && !kachelSchluesselGemeldet) {
    kachelSchluesselGemeldet = true;
    logger.error('Kachel-Schlüssel fehlt oder ist zu kurz — Kacheln fallen auf die Originale zurück', { secret: 'REVIEW_KACHEL_SIGNING_KEY' });
  }
  return wert;
}

/**
 * Signierte Kachel-URL, oder null (Pfad außerhalb der erlaubten Bereiche,
 * Schlüssel fehlt). Aufrufer fallen dann auf das Original zurück: lieber
 * langsam als ein Fall ohne Bild, über den jemand entscheiden soll.
 */
function thumbUrl(path, width) {
  if (!path) return null;
  const url = kachelUrl(KACHEL_BASIS, path, width, kachelSchluessel());
  if (!url) logger.warn('Keine Kachel-URL ausgestellt', { praefix: String(path).split('/')[0], width });
  return url;
}

/** Warteschlange: alles, was zu entscheiden ist — schlank, für die Seitenleiste. */
exports.reviewQueue = onCall({ region: REGION, memory: '512MiB', timeoutSeconds: 60 }, async (req) => {
  assertAdmin(req);
  const p = req.data || {};
  const type = p.type === 'receipts' ? 'receipts' : 'photos';
  const q = String(p.q || '').trim().toLowerCase();

  if (type === 'receipts') {
    const snap = await db.collection('receipts').where('status', '==', 'review').select(...RECEIPT_LIST_FIELDS).get();
    let rows = snap.docs.map(receiptRowOf).map(({ items, ...r }) => ({
      id: r.id, userId: r.userId, merchantName: r.merchantName, store: r.store, bonDate: r.bonDate,
      bonTotalCents: r.bonTotalCents, eligibleItemCount: r.eligibleItemCount, reviewReason: r.reviewReason,
      ocrConfidence: r.ocrConfidence, reconOk: r.reconOk, createdAt: r.createdAt,
      verdict: bonUrteil(r),
    }));
    if (q) rows = rows.filter((r) => [r.id, r.userId, r.merchantName, r.store && r.store.city, r.bonDate].some((v) => v && String(v).toLowerCase().includes(q)));
    if (p.verdict && p.verdict !== 'all') rows = rows.filter((r) => r.verdict === p.verdict);
    rows.sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0)); // ältester zuerst — er wartet am längsten
    const counts = rows.reduce((acc, r) => ((acc[r.verdict] = (acc[r.verdict] || 0) + 1), acc), {});
    return { type, rows, total: rows.length, counts };
  }

  // Produktfotos: die Vorprüfung braucht alle Einreichungen derselben EAN.
  // EIN Bestands-Query mit wenigen Feldern ist schneller als viele `in`-Chunks —
  // aber es sind über 1.600 Dokumente, um eine Schlange von einem Dutzend zu
  // bauen, und die Funktion läuft bei jeder Anmeldung, jedem Reiterwechsel,
  // jeder Suche und jeder Filteränderung. Firestore-Reads sind der größte
  // eigene Serverposten des Projekts; der Bestand ändert sich zwischen zwei
  // Klicks so gut wie nie. Zwei Minuten Aufbewahrung fangen die Wiederholungen
  // ab, ohne dass jemand mit veralteten Nachbarn arbeitet.
  const [openSnap, sperren] = await Promise.all([db.collection(COL).where('status', '==', 'pending').get(), ladeSperren(db)]);
  // Sperren NICHT aus dem Zwischenspeicher: eine frisch gesetzte Sperre soll sofort sichtbar sein.
  const sperreVon = (uid) => kontoSperreVon(sperren, uid);
  const byEan = eanIndexAusCache();
  if (byEan) return baueFotoListe(openSnap.docs, byEan, p, q, sperreVon);

  // Beide EAN-Felder und beide Preis-Felder: Gruppe und Doppel-Regel wie in
  // der Runde (src/werte.js policyOf). Form wie `rowOf`, siehe eanIndex.
  const allSnap = await db.collection(COL).select(...INDEX_FELDER).get();
  const frisch = eanIndex(allSnap.docs);
  eanCache = { index: frisch, stand: Date.now() };
  return baueFotoListe(openSnap.docs, frisch, p, q, sperreVon);
});

/** Zwischenspeicher des EAN-Nachbarschafts-Index (siehe reviewQueue). */
let eanCache = null;
const EAN_TTL_MS = 2 * 60 * 1000;
function eanIndexAusCache() {
  return eanCache && Date.now() - eanCache.stand < EAN_TTL_MS ? eanCache.index : null;
}

/** Bis 6 Fälle vollständig — mit fertigen Bild-URLs, für Anzeige + Vorladen. */
exports.reviewCases = onCall({ region: REGION, memory: '512MiB', timeoutSeconds: 60, secrets: [KACHEL_SCHLUESSEL] }, async (req) => {
  assertAdmin(req);
  const p = req.data || {};
  const type = p.type === 'receipts' ? 'receipts' : 'photos';
  const ids = (Array.isArray(p.ids) ? p.ids : []).slice(0, 6).map(String);
  if (!ids.length) return { cases: [] };

  if (type === 'receipts') {
    const snaps = await db.getAll(...ids.map((id) => db.collection('receipts').doc(id)));
    const vorhanden = snaps.filter((s) => s.exists);

    // Dieselben zwei Angaben, die der Foto-Bildschirm hat und die beim Bon
    // bisher fehlten: wer reicht ein, und was löst die Freigabe aus. Ohne sie
    // drückt man bei einem Bon F, ohne zu wissen, ob acht Cent fließen und ob
    // der Mensch dahinter zum dritten Mal auffällt.
    const bonNutzer = new Map();
    await Promise.all([...new Set(vorhanden.map((s) => s.data().userId).filter(Boolean))].map(async (uid) => {
      const [eigene, user] = await Promise.all([
        db.collection('receipts').where('userId', '==', uid).select('status', 'createdAt').get(),
        db.doc(`users/${uid}`).get(),
      ]);
      let angenommen = 0; let abgelehnt = 0; let erste = null;
      eigene.docs.forEach((d) => {
        const st = String(d.data().status || '');
        if (st === 'approved') angenommen++;
        else if (st === 'rejected') abgelehnt++;
        const t = ms(d.data().createdAt);
        if (t && (erste == null || t < erste)) erste = t;
      });
      const u = user.exists ? user.data() : {};
      bonNutzer.set(uid, {
        einreichungen: eigene.size, angenommen, abgelehnt, seit: erste,
        guthabenCent: u.cashback_balance_cents ?? 0, proAktion: u.cashback_campaign_totals ?? {},
      });
    }));

    const cases = await Promise.all(vorhanden.map(async (s) => {
      const row = receiptRowOf(s);
      const x = s.data();
      const [full, ledger] = await Promise.all([
        imageUrl(row.storagePath),
        row.userId
          ? db.collection(`users/${row.userId}/cashback_ledger`).where('receiptId', '==', s.id).get().then((l) => l.docs.map((d) => ({ type: d.data().type, cents: d.data().cents })))
          : [],
      ]);
      return {
        id: s.id, kind: 'receipt', row: { ...row, items: undefined, verdict: bonUrteil(row) },
        ort: ortVonBon(x),
        nutzer: bonNutzer.get(row.userId) || null,
        // Der Betrag steht bereits am Bon — die Pipeline hat ihn mit allen
        // Deckeln gerechnet. Ihn hier ein zweites Mal herzuleiten wäre eine
        // Nachbildung, die auseinanderläuft.
        folge: {
          buchtCent: Number(x.cashbackCents) || 0,
          grund: (Number(x.cashbackCents) || 0) > 0 ? null : (x.zeroReason || x.rejectReason || 'kein_betrag'),
        },
        imageUrl: thumbUrl(row.storagePath, 1100) || full, fullUrl: full,
        items: Array.isArray(x.items) ? x.items : [],
        ocr: { parsed: x.ocr?.parsed ?? null, robust: x.ocr?.robust ?? null, reconciliation: x.ocr?.reconciliation ?? null },
        duplicateOf: row.duplicateOf, ledger,
      };
    }));
    return { cases };
  }

  const snaps = await db.getAll(...ids.map((id) => db.collection(COL).doc(id)));
  const present = snaps.filter((s) => s.exists);

  // Was beim Prüfen wirklich zählt und bisher fehlte: Wer reicht da ein, und
  // was löst eine Freigabe aus? Ohne das steht der Prüfer vor einer Feldliste
  // und muss raten, ob der Fall harmlos ist und ob Geld fließt.
  const nutzerInfo = new Map();
  const aktionInfo = new Map();
  await Promise.all([...new Set(present.map((s) => s.data().userId).filter(Boolean))].map(async (uid) => {
    const [eigene, user] = await Promise.all([
      db.collection(COL).where('userId', '==', uid).select('status', 'createdAt').get(),
      db.doc(`users/${uid}`).get(),
    ]);
    let angenommen = 0; let abgelehnt = 0; let erste = null;
    eigene.docs.forEach((d) => {
      const st = safeStatus(d.data().status);
      if (st === 'approved') angenommen++;
      else if (st === 'rejected') abgelehnt++;
      const t = ms(d.data().createdAt);
      if (t && (erste == null || t < erste)) erste = t;
    });
    const u = user.exists ? user.data() : {};
    nutzerInfo.set(uid, {
      einreichungen: eigene.size, angenommen, abgelehnt, seit: erste,
      guthabenCent: u.cashback_balance_cents ?? 0,
      proAktion: u.cashback_campaign_totals ?? {},
    });
  }));
  await Promise.all([...new Set(present.map((s) => s.data().campaignId).filter(Boolean))].map(async (cid) => {
    const c = await db.collection('cashback_campaigns').doc(cid).get();
    if (c.exists) {
      const x = c.data();
      aktionInfo.set(cid, {
        titel: x.title || cid,
        proEinreichungCent: Number(x.cashbackPerBonCents) || 0,
        maxProNutzerCent: Number(x.maxPerUserCents) || 0,
        restbudgetCent: Number(x.budgetRemainingCents) || 0,
      });
    }
  }));
  // EAN-Nachbarn für die Doppel-Regel: nur die betroffenen (effektiven) EANs.
  const rows = present.map(rowOf);
  // Auch unter der Nummer vom Barcode-Foto, wo sie abweicht (02.10.2026).
  const fotoEan = (r) => (r.eanFoto && r.eanFoto.art === 'abweichend' ? r.eanFoto.gelesen : null);
  const eans = [...new Set([...rows.map((r) => r.anzeigeEan), ...rows.map(fotoEan)].filter(Boolean))];
  const [byEan, sperren] = await Promise.all([eans.length ? loadByEans(eans) : new Map(), ladeSperren(db)]);
  const cases = await Promise.all(present.map(async (s, i) => {
    const row = rows[i];
    const nachbarn = nachbarnVon(byEan, row.anzeigeEan);
    const pre = precheckFuerFall(row, nachbarn, { kontoSperre: kontoSperreVon(sperren, row.userId), fotoEanRows: fotoEan(row) ? nachbarnVon(byEan, fotoEan(row)) : null });
    const defekt = new Set(row.bildDefekt.map((b) => b.slot));
    const bilder = await Promise.all(REQUIRED_STEPS_ORDER.map(async (step) => {
      const path = row.images && row.images[step];
      const full = await imageUrl(path); // Lupe
      return {
        step, label: STEP_LABEL_DE[step] || step,
        url: thumbUrl(path, 520) || full,  // Kachel
        full,
        fehlt: !path,
        // Vom Namer als abgeschnitten erkannt (unser Upload-Fehler, nicht der des Nutzers).
        defekt: defekt.has(step),
      };
    }));
    const prior = pre.dup && pre.dup.priorId ? nachbarn.find((r) => r.id === pre.dup.priorId) : null;
    const eigene = nachbarn.filter((r) => r.id !== row.id).length;
    const nutzer = nutzerInfo.get(row.userId) || null;
    const aktion = row.campaignId ? aktionInfo.get(row.campaignId) || null : null;
    // Was eine Freigabe auslöst — in Cent, mit Grund, wenn es nichts wird.
    let folge = { buchtCent: 0, grund: 'keine_aktion' };
    // Dieselbe Funktion, die der Trigger vor der Buchung anwendet — als Kopie
    // in src/locationGate.js, nicht nacherzählt. Eine zweite, halbe Fassung
    // dieser Regel sagte bei einer von elf Einreichungen das Falsche.
    const ort = pruefeOrtsanforderung(s.data());
    // Gesperrtes Konto (02.10.2026): eine Freigabe ist gar nicht möglich, und
    // gebucht würde ohnehin nichts.
    if (pre.kontoSperre === 'gesperrt') {
      folge = { buchtCent: 0, grund: 'konto_gesperrt' };
    } else if (!ort.ok) {
      folge = { buchtCent: 0, grund: ort.grund || 'ort_fehlt' };
    } else if (aktion) {
      const bisher = (nutzer?.proAktion || {})[row.campaignId] || 0;
      const rest = aktion.maxProNutzerCent > 0 ? Math.max(0, aktion.maxProNutzerCent - bisher) : Infinity;
      const zahlbar = Math.min(aktion.proEinreichungCent, rest, aktion.restbudgetCent);
      folge = zahlbar > 0
        ? { buchtCent: zahlbar, grund: null }
        : { buchtCent: 0, grund: rest <= 0 ? 'nutzer_am_limit' : aktion.restbudgetCent <= 0 ? 'budget_leer' : 'kein_betrag' };
    }
    return {
      id: s.id, kind: 'photo', row: stripPolicy(row), bilder, precheck: pre,
      prior: prior ? stripPolicy(prior) : null, gleicheEan: eigene,
      // EINE Ortsangabe statt vier Rohfeldern — siehe src/ort.js.
      ort: ortVonEinreichung(s.data()),
      nutzer, aktion, folge,
    };
  }));
  return { cases };
});

/**
 * Kachel-Endpunkt (01.10.2026) — liefert eine verkleinerte JPEG-Ansicht eines
 * Uploads, aber NUR mit einer von reviewCases ausgestellten, gültigen Signatur
 * (src/kachel.js). Ohne / mit falscher / abgelaufener Signatur: 403.
 *
 * Öffentlich aufrufbar (invoker public), weil ein <img>-Tag keinen
 * Anmelde-Header mitschicken kann — die Berechtigung steckt in der URL.
 * Lesen per Admin-SDK: hängt NICHT an öffentlichen Bucket-Rechten.
 *
 * sharp wird erst hier geladen: die übrigen Funktionen dieser Codebase
 * (Morgen-/Bon-Runde, Entscheidungen) brauchen libvips nicht, und ein
 * Ladefehler der nativen Bibliothek soll nur die Kacheln treffen, nicht die
 * ganze Konsole.
 *
 * concurrency 8: die Konsole lädt 7 Kacheln je Fall und die nächsten drei
 * Fälle vor; eine Instanz je Anfrage (wie die Extension) hieße viele
 * Kaltstarts. 1 GiB reicht für 8 gleichzeitige Bilder (≤ 20 MB Eingabe,
 * JPEG wird beim Laden bereits verkleinert).
 */
let _kachelBild = null;
const kachelBild = () => (_kachelBild ||= require('./src/kachelBild'));

function kachelAntwort(res, status, text) {
  res.set('Cache-Control', 'no-store');
  res.set('Content-Type', 'text/plain; charset=utf-8');
  res.status(status).send(text);
}

exports.reviewKachel = onRequest(
  {
    region: REGION, memory: '1GiB', cpu: 1, concurrency: 8, maxInstances: 10, timeoutSeconds: 60,
    invoker: 'public', secrets: [KACHEL_SCHLUESSEL],
  },
  async (req, res) => {
    res.set('X-Content-Type-Options', 'nosniff');
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.set('Allow', 'GET, HEAD');
      kachelAntwort(res, 405, 'Methode nicht erlaubt');
      return;
    }
    const urteil = pruefeKachelAnfrage(req.query, kachelSchluessel(), Date.now());
    if (!urteil.ok) {
      if (urteil.grund === 'schluessel_fehlt') {
        logger.error('reviewKachel ohne Schlüssel — Secret REVIEW_KACHEL_SIGNING_KEY prüfen');
        kachelAntwort(res, 500, 'Serverfehler');
      } else {
        // Kein Pfad im Log: wer hier landet, hat keine gültige Signatur.
        logger.warn('reviewKachel abgelehnt', { grund: urteil.grund });
        kachelAntwort(res, 403, 'Verboten');
      }
      return;
    }
    const { ladeBegrenzt, rendereKachel } = kachelBild();
    try {
      const roh = await ladeBegrenzt(storageBucket().file(urteil.pfad));
      const jpeg = await rendereKachel(roh, urteil.breite);
      res.set({
        'Content-Type': 'image/jpeg',
        'Content-Length': String(jpeg.length),
        'Content-Disposition': 'inline; filename="kachel.jpg"',
        'Cache-Control': KACHEL_CACHE,
      });
      res.status(200).end(jpeg);
    } catch (e) {
      const status = Number(e && e.status) || 500;
      const log = status >= 500 ? logger.error : logger.warn;
      log('reviewKachel fehlgeschlagen', { code: e && e.code, status, praefix: urteil.pfad.split('/')[0], fehler: String((e && e.message) || e).slice(0, 300) });
      kachelAntwort(res, status, status === 404 ? 'Nicht gefunden' : 'Kachel nicht verfügbar');
    }
  },
);


/**
 * Alle Einreichungen und Bons als Kartenpunkte (86cbet2nw / Ortsfrage 07.09.2026).
 *
 * Kompakt als Arrays statt Objekte: 8.000 Punkte wären als Objektliste rund
 * 900 KB, so sind es unter 300 KB. Gefiltert wird im Browser — die Daten sind
 * einmal geladen, jeder Filterwechsel ist dann sofort und kostet keinen Read.
 *
 * Punkt = [typ, lat, lon, zeit, quelle, markt, land, plz, ort, status, id, auffaellig[]]
 *   typ 0 = Produktfoto, 1 = Bon
 *   quelle 0 = Gerätestandort, 1 = Filiale laut Bon, 2 = Angabe des Nutzers
 */
/**
 * Zwischenspeicher für die Kartenpunkte.
 *
 * Jeder Aufruf liest sonst ALLE Einreichungen und Bons — Stand heute rund 8.100
 * Dokumente. Firestore-Reads sind der größte Serverposten des Projekts; die
 * Karte ist ein Werkzeug, das man am Tag mehrfach öffnet und dessen Bild sich
 * dabei kaum ändert. Fünf Minuten Aufbewahrung im Funktionsspeicher fangen die
 * Wiederholungen ab, ohne dass jemand veraltete Punkte zu sehen bekommt. Der
 * Aufrufer kann mit `frisch: true` erzwingen, dass neu gelesen wird.
 */
let kartenCache = null;
const KARTE_TTL_MS = 5 * 60 * 1000;

exports.reviewMapPoints = onCall({ region: REGION, memory: '1GiB', timeoutSeconds: 120 }, async (req) => {
  assertAdmin(req);
  if (!req.data?.frisch && kartenCache && Date.now() - kartenCache.stand < KARTE_TTL_MS) {
    return { ...kartenCache, ausCache: true };
  }
  // Auf die Karte kommen nur BEOBACHTETE Orte. `user_profile_region` (der aus
  // früheren Bons abgeleitete Wohnort) und `market_country` (nur das Land)
  // sagen nichts darüber, wo DIESE Einreichung entstanden ist — ein Wohnort
  // als Einkaufspunkt wäre derselbe Fehler wie die IP-Ortung, nur subtiler.
  const QUELLE = { geraet: 0, filiale: 1, nutzerangabe: 2 };
  const punkte = [];
  // „Ohne Ort" ist keine Erklärung — die Gründe sind verschieden und führen zu
  // verschiedenen Schlüssen: ein Altfall ohne jede Angabe ist etwas anderes als
  // einer, bei dem nur das Land des Marktes bekannt ist.
  const ohneOrt = { fotos: 0, bons: 0, nurLand: 0, wohnort: 0, garNichts: 0, ortNichtAufloesbar: 0, fotosAktuellOhne: 0, fotosAktuell: 0 };
  // Der Ortsschätzer läuft seit dem 15.08.2026. Alles davor kann keinen Ort
  // haben — alles danach schon, und dort ist ein fehlender Ort ein laufendes
  // Thema, kein Altbestand. Die Karte darf beides nicht in einen Topf werfen.
  const SCHAETZER_SEIT = Date.parse('2026-08-15');

  const [uploads, receipts] = await Promise.all([
    db.collection(COL).select('capture', 'priceReceipt', 'probableLocation', 'marketName', 'marketLand', 'status', 'createdAt', 'productName', 'campaignId').get(),
    db.collection('receipts').select('store', 'merchant', 'bonDate', 'status', 'createdAt', 'totalCents', 'campaignId').get(),
  ]);

  // Ortsverzeichnis aus den eigenen Bon-Adressen: das öffentliche Verzeichnis
  // kennt nur Hauptgemeinden, die Bons auch kleine Orte (siehe src/ort.js).
  const verzeichnis = ortsverzeichnisAusBons(
    receipts.docs.map((d) => d.data().store).filter((st) => st && st.city && st.zip),
  );

  for (const d of uploads.docs) {
    const x = d.data();
    const o = ortVonEinreichung(x, verzeichnis);
    const aktuell = (ms(x.createdAt) ?? 0) >= SCHAETZER_SEIT;
    if (aktuell) ohneOrt.fotosAktuell++;
    if (o.lat == null || o.lon == null || QUELLE[o.quelle] === undefined) {
      ohneOrt.fotos++;
      if (aktuell) ohneOrt.fotosAktuellOhne++;
      if (o.quelle === 'land') ohneOrt.nurLand++;
      else if (o.quelle === 'profil') ohneOrt.wohnort++;
      else if (o.quelle == null) ohneOrt.garNichts++;
      else ohneOrt.ortNichtAufloesbar++;
      continue;
    }
    punkte.push([
      0, Math.round(o.lat * 1e4) / 1e4, Math.round(o.lon * 1e4) / 1e4,
      ms(x.createdAt), QUELLE[o.quelle] ?? null,
      x.marketName || null, o.land || null, o.plz || null, o.ort || null,
      safeStatus(x.status), d.id,
      (o.auffaellig || []).map((a) => a.text),
    ]);
  }
  for (const d of receipts.docs) {
    const x = d.data();
    const o = ortVonBon(x, verzeichnis);
    if (o.lat == null || o.lon == null) { ohneOrt.bons++; continue; }
    punkte.push([
      1, Math.round(o.lat * 1e4) / 1e4, Math.round(o.lon * 1e4) / 1e4,
      ms(x.createdAt), QUELLE[o.quelle] ?? null,
      (x.merchant && x.merchant.name) || null, o.land || null, o.plz || null, o.ort || null,
      String(x.status || 'unbekannt'), d.id,
      (o.auffaellig || []).map((a) => a.text),
    ]);
  }

  kartenCache = {
    punkte,
    ohneOrt,
    gesamt: { fotos: uploads.size, bons: receipts.size },
    stand: Date.now(),
  };
  return { ...kartenCache, ausCache: false };
});

/* ─── Morgenrunde Produktfotos + Tagesbericht ───────────────────────────────
 *
 * Läuft täglich um 08:00 (Europe/Berlin), Logik in src/taeglicheRunde.js,
 * Wissen dahinter in WISSEN-FOTORUNDE.md.
 *
 * Scharf NUR, wenn `cashback_config/v1.fotoWorker === true` — sonst Trockenlauf,
 * der nur den Bericht schreibt. Ein Deploy schaltet also nichts still scharf
 * (gleiche Bauart wie der Schalter `ocrReferee`).
 *
 * Die Schalter der Bildschirm-Regel (`preisBildschirmRegel`) und des
 * Preisbelegs (`preisBelegRegel`, eigener Schalter seit der Nachprüfung
 * 05.10.2026) kommen aus DEMSELBEN Lesen von cashback_config/v1 — ein zweites
 * Lesen in der Runde könnte allein scheitern und eine Regel still auf
 * Beobachtung stellen (Prüfrunde 2, 04.10.2026). `?? null`: fehlt ein
 * Schalter, gilt 'shadow'.
 */
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { taeglicheRunde } = require('./src/taeglicheRunde');
const PROJEKT = process.env.GCLOUD_PROJECT || 'markendetektive-895f7';

// 30 Minuten: die Runde beginnt nach 18 Minuten nichts Neues mehr und wartet
// danach höchstens 5 Minuten auf die Buchungen.
// maxInstances 1 + concurrency 1: nie zwei Läufe desselben Wegs parallel
// (Kosten, Google-Limit). maxInstances allein reicht nicht — Gen2 nimmt sonst
// bis zu 80 Anfragen in DIESELBE Instanz (Prüfrunde 24.09.).
const RUNDE_OPTS = { region: REGION, timeoutSeconds: 1800, memory: '1GiB', maxInstances: 1, concurrency: 1 };

exports.fotoRundeTaeglich = onSchedule(
  { ...RUNDE_OPTS, schedule: '0 8 * * *', timeZone: 'Europe/Berlin', retryCount: 0 },
  async () => {
    const cfg = (await db.doc('cashback_config/v1').get()).data() || {};
    const scharf = cfg.fotoWorker === true;
    const bericht = await taeglicheRunde({ dryRun: !scharf, projekt: PROJEKT, ausloeser: 'zeitplan', preisBildschirmRegel: cfg.preisBildschirmRegel ?? null, preisBelegRegel: cfg.preisBelegRegel ?? null });
    logger.info(scharf ? 'Morgenrunde scharf gelaufen' : 'Morgenrunde als Trockenlauf (Schalter fotoWorker steht nicht auf true)', { lauf: bericht.lauf });
  },
);

/**
 * Manueller Anstoß — NUR mit Schlüssel. Auch ein Trockenlauf kostet
 * Google-Aufrufe (Nachlesen + Bildprüfung je offener Einreichung) und schreibt
 * nachgelesene Angaben; die Adresse ist öffentlich erreichbar (Cloud-Run-
 * Invoker allUsers), also darf sie ohne Schlüssel nichts anstoßen.
 * Scharf nur mit `scharf=1` UND eingeschaltetem Schalter — der Schalter gilt
 * für beide Wege.
 */
exports.fotoRundeManuell = onRequest(
  { ...RUNDE_OPTS, secrets: [CASHBACK_ADMIN_KEY] },
  async (req, res) => {
    if (!req.query.key || req.query.key !== CASHBACK_ADMIN_KEY.value()) {
      res.status(403).json({ error: 'Schlüssel fehlt oder falsch.' });
      return;
    }
    const cfg = (await db.doc('cashback_config/v1').get()).data() || {};
    const scharf = req.query.scharf === '1' && cfg.fotoWorker === true;
    const bericht = await taeglicheRunde({ dryRun: !scharf, projekt: PROJEKT, ausloeser: 'manuell', preisBildschirmRegel: cfg.preisBildschirmRegel ?? null, preisBelegRegel: cfg.preisBelegRegel ?? null });
    // Nur Zahlen zurück — die Listen (Einreichungs-IDs beginnen mit der uid)
    // stehen im Bericht in Firestore und im Dashboard, nicht in einer HTTP-Antwort.
    const { lauf, dryRun, geprueft, freigegeben, abgelehnt, offen, gebuchtCents, warnungen: warn } = bericht;
    res.json({ lauf, dryRun, geprueft, freigegeben, abgelehnt, offen, gebuchtCents, warnungen: (warn || []).map((w) => w.text) });
  },
);

/**
 * Bon-Runde: Bons in `review` jeden Morgen um 07:45 (Logik: src/bonRunde.js,
 * Regeln: src/bonRegeln.js). Läuft VOR der Foto-Runde, die das Ergebnis aus
 * `ops_bonrunden/{tag}` in ihren Tagesbericht übernimmt. Scharf nur mit
 * `cashback_config/v1.bonWorker === true`; sonst Trockenlauf.
 */
const { bonRunde } = require('./src/bonRunde');
exports.bonRundeTaeglich = onSchedule(
  { region: REGION, schedule: '45 7 * * *', timeZone: 'Europe/Berlin', retryCount: 0, timeoutSeconds: 900, memory: '1GiB', maxInstances: 1, concurrency: 1, secrets: [CASHBACK_ADMIN_KEY] },
  async () => {
    const cfg = (await db.doc('cashback_config/v1').get()).data() || {};
    const scharf = cfg.bonWorker === true;
    const b = await bonRunde({ dryRun: !scharf, projekt: PROJEKT, schluessel: scharf ? CASHBACK_ADMIN_KEY.value() : null, ausloeser: 'zeitplan' });
    logger.info(scharf ? 'Bon-Runde scharf gelaufen' : 'Bon-Runde als Trockenlauf (Schalter bonWorker steht nicht auf true)', { lauf: b.lauf, geprueft: b.geprueft });
  },
);

/** Tagesberichte fürs Dashboard (tagesbericht.html), neueste zuerst. */
exports.reviewTagesberichte = onCall({ region: REGION, timeoutSeconds: 30 }, async (req) => {
  assertAdmin(req);
  const anzahl = Math.min(Math.max(Number(req.data?.anzahl) || 45, 1), 120);
  const snap = await db.collection('ops_tagesberichte').orderBy('laufAt', 'desc').limit(anzahl + 1).get();
  const berichte = snap.docs
    .filter((d) => d.id !== 'aktuell')
    .slice(0, anzahl)
    .map((d) => {
      const x = d.data();
      return { ...x, id: d.id, laufAt: x.laufAt && x.laufAt.toMillis ? x.laufAt.toMillis() : null };
    });
  return { berichte };
});

/**
 * Statistik der letzten N Tage fürs Dashboard (Logik: src/statistik.js).
 * Nur lesend. Rund 16.000 Lesevorgänge pro frischer Berechnung (alle
 * crowd_uploads, Bons der Periode, je gebuchter Foto-Freigabe ein Ledger-
 * Dokument per fester ID) — deshalb 10 Minuten im Speicher gehalten.
 */
const { baueStatistik } = require('./src/statistik');
let statistikCache = { at: 0, tage: 0, daten: null };
exports.reviewStatistik = onCall({ region: REGION, memory: '1GiB', timeoutSeconds: 120, maxInstances: 2 }, async (req) => {
  assertAdmin(req);
  const tage = Math.min(Math.max(Number(req.data?.tage) || 60, 7), 120);
  if (statistikCache.daten && statistikCache.tage === tage && Date.now() - statistikCache.at < 10 * 60 * 1000) {
    return { ...statistikCache.daten, ausCache: true, stand: statistikCache.at };
  }
  const jetzt = Date.now();
  const ab = jetzt - tage * 24 * 60 * 60 * 1000;
  const [fotoSnap, bonSnap] = await Promise.all([
    db.collection('crowd_uploads').select('status', 'createdAt', 'reviewedAt', 'rejectReason', 'holdReasons', 'userId').get(),
    db.collection('receipts').where('createdAt', '>=', admin.firestore.Timestamp.fromMillis(ab)).select('status', 'createdAt', 'rejectReason', 'noRewardReason', 'cashbackCents').get(),
  ]);
  const fotos = fotoSnap.docs.map((d) => {
    const x = d.data();
    // Ältere Ablehnungen (vor der Konsole) tragen den Grund nur in holdReasons
    // („ean_fehlt", „fotos_unpassend: <Vision-Text>") — erster Eintrag, ohne Zusatz.
    const altGrund = Array.isArray(x.holdReasons) && x.holdReasons.length ? String(x.holdReasons[0]).split(':')[0].trim() : null;
    return { id: d.id, uid: x.userId || null, status: x.status || null, createdAt: ms(x.createdAt), reviewedAt: ms(x.reviewedAt), rejectReason: x.rejectReason || altGrund || null };
  });
  // Geld aus dem Ledger: nur für Freigaben, deren Entscheidung im Fenster liegen
  // KANN (reviewedAt im Fenster oder fehlend = Altbestand, dann entscheidet der Buchungstag).
  const kandidaten = fotos.filter((f) => f.status === 'approved' && f.uid && (f.reviewedAt == null || f.reviewedAt >= ab));
  const fotoBuchungen = new Map();
  for (let i = 0; i < kandidaten.length; i += 200) {
    const teil = kandidaten.slice(i, i + 200);
    const snaps = await db.getAll(...teil.map((f) => db.doc(`users/${f.uid}/cashback_ledger/crowd_${f.id}`)));
    snaps.forEach((s, j) => {
      if (!s.exists || s.get('type') !== 'earn') return;
      fotoBuchungen.set(teil[j].id, { cents: Number(s.get('cents')) || 0, at: ms(s.get('createdAt')) });
    });
  }
  const bons = bonSnap.docs.map((d) => {
    const x = d.data();
    return { status: x.status || null, createdAt: ms(x.createdAt), grund: x.rejectReason || x.noRewardReason || null, cents: Number(x.cashbackCents) || 0 };
  });
  const daten = baueStatistik({ jetzt, tage, fotos, fotoBuchungen, bons });
  statistikCache = { at: jetzt, tage, daten };
  return { ...daten, ausCache: false, stand: jetzt };
});

/**
 * Guthaben & Auszahlungen fürs Dashboard (Laden: src/auszahlungLaden.js,
 * Rechnen: src/auszahlung.js). Nur lesend. Rund 2.000–5.000 Lesevorgänge pro
 * frischer Berechnung, deshalb 10 Minuten im Speicher; `frisch: true` umgeht das.
 */
const { ladeAuszahlung } = require('./src/auszahlungLaden');
let auszahlungCache = { at: 0, daten: null };
exports.reviewAuszahlungen = onCall({ region: REGION, memory: '512MiB', timeoutSeconds: 120, maxInstances: 2 }, async (req) => {
  assertAdmin(req);
  if (auszahlungCache.daten && !req.data?.frisch && Date.now() - auszahlungCache.at < 10 * 60 * 1000) {
    return { ...auszahlungCache.daten, ausCache: true, stand: auszahlungCache.at };
  }
  const jetzt = Date.now();
  const daten = await ladeAuszahlung({ db, auth: admin.auth(), jetzt, logger });
  auszahlungCache = { at: jetzt, daten };
  return { ...daten, ausCache: false, stand: jetzt };
});
