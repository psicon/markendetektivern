'use strict';
/**
 * Review-Rückstau auflösen (User-Auftrag 02.09.2026: "gib die 163 frei").
 * Entscheidet pro Review-Bon (chronologisch) und ruft den SERVER-Resolver
 * (resolveCashbackReview) — alle Writes laufen dort (Ledger-Transaktion mit
 * Caps, Mirror, purchased_products, Push). Dieses Skript entscheidet nur:
 *   0. Vorbedingung: nur Konfidenz-Holds (reviewReason ocr_confidence_*) mit
 *      berechnetem Cashback, OCR, Bon-Datum + Kampagne — alles andere bleibt
 *      im Review (ocr_unavailable / bon_date_future / forensics_software).
 *   1. Live-Duplikat (wie processCashback): gleicher User + gleicher Hash +
 *      Live-Status → reject/duplicate_content_self; anderer User + gleicher
 *      transactionHash → reject/duplicate_content_cross_user; anderer User +
 *      nur contentHash → SKIP (bleibt im Review, manuelle Sichtung).
 *   2. User hat für DIESES Bon-Datum schon eine aktive Gutschrift (Ledger →
 *      receipts.bonDate, plus früher in diesem Lauf) → no_reward/daily_cap_reached
 *      (= Pipeline-Semantik „max. ein vergüteter Bon pro Bon-Datum").
 *   3. sonst → approve (Server prüft Wochen-/Per-User-Cap + Budget in der Tx).
 * Vorbedingung: Lauf B (.repair-campaign.js) muss durch sein — kein Bon aus
 * dessen ID-Liste darf noch in Verarbeitung sein (sonst sähe der Datums-Check
 * dessen Gutschrift nicht). Der Ledger wird pro Bon FRISCH gelesen; der eigene
 * Bon ist ausgeschlossen — hat er selbst schon einen aktiven Earn (Wiederanlauf
 * nach Teilfehler NACH der Transaktion), wird 'approve' erzwungen (idempotent).
 * itemsHash-Zwillinge zählen wie in der Pipeline nur bei ≤5 min Bon-Uhrzeit-
 * Abstand.
 * Fail-fast: jeder Nicht-200 des Resolvers bricht den Lauf ab (Ergebnisdatei
 * wird nach jedem Bon geschrieben; Wiederanlauf ist idempotent — aufgelöste
 * Bons sind nicht mehr 'review').
 * ENV: CASHBACK_ADMIN_KEY (nie loggen!), DRY_RUN=1 → nur entscheiden.
 */
const admin = require('firebase-admin');
const fs = require('fs');
admin.initializeApp({ projectId: 'markendetektive-895f7' });
const db = admin.firestore();
const DRY = process.env.DRY_RUN === '1';
const KEY = process.env.CASHBACK_ADMIN_KEY || '';
const BASE = 'https://europe-west3-markendetektive-895f7.cloudfunctions.net/resolveCashbackReview';
const OUT = '.review-approve.result.json';
const LIVE = new Set(['approved', 'paid', 'no_reward', 'review', 'matched', 'ocr_pending']);
if (!DRY && !KEY) { console.error('CASHBACK_ADMIN_KEY fehlt'); process.exit(2); }

const hashesOf = (x) => [x.contentHash, x.transactionHash, x.itemsHash].filter((h) => typeof h === 'string' && h.length > 0);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const state = { dry: DRY, startedAt: new Date().toISOString(), tally: {}, results: [] };
const save = () => fs.writeFileSync(OUT, JSON.stringify(state, null, 1));
const bump = (k) => { state.tally[k] = (state.tally[k] || 0) + 1; };
const record = (x, plan, res) => { state.results.push({ id: x.id, uid: x.userId, bonDate: x.bonDate, campaignId: x.campaignId, plan, res }); save(); };

async function chunkedGetAll(refs) {
  const out = [];
  for (let i = 0; i < refs.length; i += 100) out.push(...(await db.getAll(...refs.slice(i, i + 100))));
  return out;
}

async function resolve(params) {
  const url = `${BASE}?${new URLSearchParams({ key: KEY, ...params }).toString()}`;
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(45_000) });
    let body = null;
    try { body = await r.json(); } catch { body = { raw: (await r.text().catch(() => '')).slice(0, 200) }; }
    return { http: r.status, ...body };
  } catch (e) {
    // Nie die URL loggen (enthält den Key) — nur die Fehlermeldung.
    return { http: 0, code: 'fetch_error', message: String((e && e.message) || e).slice(0, 200) };
  }
}

/** Aktive Gutschriften des Users: Map receiptId → bonDate (Ledger earn−reverse>0 → receipts.bonDate). */
async function creditedMap(uid) {
  const col = db.collection(`users/${uid}/cashback_ledger`);
  const [earns, reverses] = await Promise.all([col.where('type', '==', 'earn').get(), col.where('type', '==', 'reverse').get()]);
  const rid = (d) => { const v = d.data().receiptId; return typeof v === 'string' && v.length > 0 ? v : null; };
  const net = new Map();
  earns.docs.forEach((d) => { const r = rid(d); if (r) net.set(r, (net.get(r) || 0) + (d.data().cents || 0)); });
  reverses.docs.forEach((d) => { const r = rid(d); if (r) net.set(r, (net.get(r) || 0) - (d.data().cents || 0)); });
  const activeIds = [...net.entries()].filter(([, c]) => c > 0).map(([r]) => r);
  const map = new Map();
  if (activeIds.length) {
    const snaps = await chunkedGetAll(activeIds.map((r) => db.collection('receipts').doc(r)));
    snaps.forEach((sn) => { if (sn.exists) map.set(sn.id, sn.data().bonDate || null); });
  }
  return map;
}

// Pipeline-Helfer (index.js parseHHMM/bonTimesWithin): itemsHash-Treffer
// gelten nur bei ≤5 min Bon-Uhrzeit-Abstand als Duplikat.
function parseHHMM(t) {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(t || ''));
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}
function bonTimesWithin(a, b, maxMinutes) {
  const pa = parseHHMM(a); const pb = parseHHMM(b);
  if (pa == null || pb == null) return true;
  return Math.abs(pa - pb) <= maxMinutes;
}

/** Andere Receipts mit gleichem Hash + Live-Status (frische Query = sieht die Resolver-Writes dieses Laufs). */
async function liveTwins(x) {
  const out = new Map();
  for (const f of ['contentHash', 'transactionHash', 'itemsHash']) {
    if (!x[f]) continue;
    const q = await db.collection('receipts').where(f, '==', x[f]).limit(10).get();
    q.docs.forEach((o) => {
      if (o.id === x.id) return;
      const d = o.data();
      if (!LIVE.has(d.status)) return;
      const prev = out.get(o.id) || { id: o.id, userId: d.userId, status: d.status, bonTime: d.bonTime || null, createdMs: d.createdAt?.toMillis?.() || 0, fields: [] };
      prev.fields.push(f);
      out.set(o.id, prev);
    });
  }
  // Reiner itemsHash-Treffer zählt nur im 5-Minuten-Fenster (wie index.js).
  return [...out.values()].filter((t) => !(t.fields.length === 1 && t.fields[0] === 'itemsHash' && !bonTimesWithin(x.bonTime, t.bonTime, 5)));
}

/** Gate: Lauf B muss durch sein (keine Bons aus dessen ID-Liste mehr in Verarbeitung). */
async function assertRepairSettled() {
  let list = [];
  try { list = JSON.parse(fs.readFileSync('.repair-campaign.ids.json', 'utf8')); } catch { console.log('Hinweis: keine .repair-campaign.ids.json — Gate übersprungen'); return; }
  const snaps = list.length ? await chunkedGetAll(list.map((id) => db.collection('receipts').doc(id))) : [];
  const pending = snaps.filter((sn) => ['ocr_pending', 'processing'].includes(sn.data()?.status)).map((sn) => sn.id);
  if (pending.length) { console.error(`ABBRUCH: ${pending.length} Bons aus Lauf B noch in Verarbeitung: ${pending.slice(0, 5).join(' ')}…`); process.exit(5); }
  console.log(`Gate ok: ${snaps.length} Bons aus Lauf B sind final.`);
}

async function lauf() {
  await assertRepairSettled();
  const s = await db.collection('receipts').where('status', '==', 'review').get();
  const all = s.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => a.createdAt.toMillis() - b.createdAt.toMillis());
  console.log(`Review-Bons: ${all.length}${DRY ? ' (DRY RUN)' : ''}`);

  // 0) Vorbedingungen
  const docs = [];
  for (const x of all) {
    const rr = String(x.reviewReason || '');
    const ok = /^ocr_confidence_(low|medium|none)$/.test(rr)
      && Number(x.cashbackCents) > 0 && Array.isArray(x.ocr?.parsed?.items) && !!x.bonDate && !!x.campaignId;
    if (ok) { docs.push(x); continue; }
    const plan = { decision: 'skip', reason: `precondition:${rr || 'no_reason'}|cents=${x.cashbackCents ?? 'n/a'}|ocr=${!!x.ocr?.parsed}|campaign=${x.campaignId || 'null'}` };
    bump('skip:precondition'); record(x, plan, null);
    console.log(`${x.id} | ${x.bonDate} | SKIP (${plan.reason})`);
  }

  // Budget je Kampagne muss für die Freigaben reichen (sonst würden die Bons final auf no_reward laufen)
  const need = {};
  docs.forEach((x) => { need[x.campaignId] = (need[x.campaignId] || 0) + Number(x.cashbackCents); });
  for (const [cid, cents] of Object.entries(need)) {
    const c = await db.collection('cashback_campaigns').doc(cid).get();
    const rem = c.exists ? Number(c.data().budgetRemainingCents) || 0 : -1;
    console.log(`Budget ${cid}: benötigt ≤ ${cents} ct, verfügbar ${rem} ct`);
    if (rem < cents) { console.error('ABBRUCH: Kampagnen-Budget reicht nicht'); process.exit(4); }
  }

  const simulatedDates = new Set();
  for (const x of docs) {
    // Ledger FRISCH pro Bon (sieht Gutschriften aus Lauf B / Live-Uploads /
    // diesem Lauf); eigener Bon zählt nicht als „Datum belegt".
    const cm = await creditedMap(x.userId);
    const ownEarn = cm.has(x.id);
    const dates = new Set([...cm.entries()].filter(([rid, bd]) => rid !== x.id && bd).map(([, bd]) => bd));
    const twins = await liveTwins(x);
    // Chronologie wie in der Pipeline: das ÄLTERE Doc ist das Original. Ein
    // jüngerer Zwilling, der selbst noch 'review' ist, macht x nicht zum
    // Duplikat — er wird später in diesem Lauf als Duplikat von x abgelehnt.
    const selfTwin = twins.find((t) => t.userId === x.userId && !(t.status === 'review' && t.createdMs > x.createdAt.toMillis()));
    const crossTx = twins.find((t) => t.userId !== x.userId && t.fields.includes('transactionHash'));
    const crossContentOnly = twins.find((t) => t.userId !== x.userId && !t.fields.includes('transactionHash'));
    let plan;
    if (ownEarn) plan = { decision: 'approve' }; // Wiederanlauf nach Teilfehler: Earn existiert → idempotent finalisieren
    else if (selfTwin) plan = { decision: 'reject', reason: 'duplicate_content_self', duplicateOf: selfTwin.id, priorStatus: selfTwin.status };
    else if (crossTx) plan = { decision: 'reject', reason: 'duplicate_content_cross_user', duplicateOf: crossTx.id, priorStatus: crossTx.status };
    else if (crossContentOnly) plan = { decision: 'skip', reason: `cross_user_content_match:${crossContentOnly.id}(${crossContentOnly.status})` };
    else if (dates.has(x.bonDate) || (DRY && simulatedDates.has(`${x.userId}|${x.bonDate}`))) plan = { decision: 'no_reward', reason: 'daily_cap_reached' };
    else plan = { decision: 'approve' };

    if (plan.decision === 'skip') {
      bump('skip:cross_user_content_match'); record(x, plan, null);
      console.log(`${x.id} | ${x.bonDate} | ${x.campaignId} | SKIP bleibt im Review (${plan.reason})`);
      continue;
    }

    let res = null;
    if (DRY) {
      // (Ledger-Simulation nur grob: gleiches Datum desselben Users später im Lauf → daily_cap)
      if (plan.decision === 'approve') simulatedDates.add(`${x.userId}|${x.bonDate}`);
    } else {
      res = await resolve({ receiptId: x.id, ...plan });
      if (res.http !== 200) {
        bump(`abbruch:HTTP${res.http}:${res.code || ''}`); record(x, plan, res);
        console.error(`ABBRUCH bei ${x.id}: HTTP ${res.http} ${res.code || ''} ${res.message || ''}`);
        process.exit(3);
      }
      await sleep(250);
    }
    const outcome = res
      ? `${res.status}${res.capReason ? `(${res.capReason})` : ''}${res.rejectReason ? `(${res.rejectReason})` : ''}`
      : `plan:${plan.decision}${plan.reason ? `/${plan.reason}` : ''}`;
    bump(outcome); record(x, plan, res);
    console.log(`${x.id} | ${x.bonDate} | ${x.campaignId} | ${outcome}${plan.duplicateOf ? ` dupOf=${plan.duplicateOf}` : ''}`);
  }
  state.finishedAt = new Date().toISOString();
  save();
  console.log('Ergebnis:', JSON.stringify(state.tally));
  console.log(`gutgeschrieben: ${state.results.reduce((a, r) => a + (r.res?.creditedCents || 0), 0)} ct`);
  process.exit(0);
}
lauf().catch((e) => { save(); console.error('ABBRUCH', e.message); process.exit(1); });
