'use strict';
/**
 * Bons seit 01.09.2026 mit no_reward/no_active_campaign der rückdatierten
 * September-Kampagne zuordnen und neu verarbeiten (User-Auftrag 02.09.:
 * "verarbeite die 120 nach"). OCR-Cache bleibt (kein Gemini-Call); die
 * Pipeline misst Kampagnenfenster + Alter gegen den Upload-Zeitpunkt und
 * wendet Caps/Dedup/Review-Gate regulär an.
 *
 * Tageslimit (Pipeline-Semantik: max. EIN vergüteter Bon pro Bon-Datum; die
 * Pipeline kennt aber nur das JÜNGSTE vergütete Datum): Entscheidung HIER,
 * und zwar SEQUENZIELL pro User — publish, warten bis final, dann für den
 * nächsten Bon desselben Users den Ledger FRISCH lesen (earn−reverse>0 →
 * receipts.bonDate). Datum schon vergütet → direkt no_reward/daily_cap_reached
 * (Doc + Mirror + purchased_products), außer der Bon ist ein Hash-Zwilling
 * eines Live-Bons — dann republish, damit die Pipeline ihn als Duplikat labelt.
 * Bons, die das Kampagnen-Alterslimit reißen würden, bleiben unangetastet.
 *
 * Wiederanlauf: hängende Bons (ocr_pending + repairedAt0209b) laufen in
 * derselben User-Reihenfolge mit (erneutes Publish ist harmlos: OCR-Cache +
 * Ledger-Idempotenz). IDs werden VOR dem Write gemerkt und gemergt.
 *   DRY_RUN=1 → nur planen.   VERIFY=1 → Stand der gemerkten IDs.
 */
const admin = require('firebase-admin');
const { PubSub } = require('@google-cloud/pubsub');
const fs = require('fs');
admin.initializeApp({ projectId: 'markendetektive-895f7' });
const db = admin.firestore();
const DRY = process.env.DRY_RUN === '1';
const VERIFY = process.env.VERIFY === '1';
const CAMPAIGN = 'september-2026';
const SINCE = new Date('2026-08-31T22:00:00Z');
const IDS = '.repair-campaign.ids.json';
const ERR = '.repair-campaign.errors.json';
const LOG = '.repair-campaign.result.json';
const PENDING = new Set(['ocr_pending', 'processing']);
const LIVE = new Set(['approved', 'paid', 'no_reward', 'review', 'matched', 'ocr_pending']);
const ts = () => admin.firestore.FieldValue.serverTimestamp();
const del = () => admin.firestore.FieldValue.delete();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const loadJson = (p, fb) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fb; } };
const ids = new Set(loadJson(IDS, []));
const saveIds = () => fs.writeFileSync(IDS, JSON.stringify([...ids]));
const result = { startedAt: new Date().toISOString(), entries: [] };
const logEntry = (e) => { result.entries.push(e); fs.writeFileSync(LOG, JSON.stringify(result, null, 1)); console.log(`  ${e.id} | ${e.bonDate} | ${e.action}${e.final ? ` → ${e.final}` : ''}${e.note ? ` (${e.note})` : ''}`); };

async function chunkedGetAll(refs) {
  const out = [];
  for (let i = 0; i < refs.length; i += 100) out.push(...(await db.getAll(...refs.slice(i, i + 100))));
  return out;
}

function tallyOf(snaps) {
  const tally = {}; const stuck = []; let cents = 0;
  snaps.forEach((sn) => {
    const x = sn.data() || {};
    const k = `${x.status}${x.rejectReason ? `(${x.rejectReason})` : ''}${x.reviewReason ? `[${x.reviewReason}]` : ''}`;
    tally[k] = (tally[k] || 0) + 1;
    if (PENDING.has(x.status)) stuck.push(sn.id);
    if (x.status === 'approved') cents += x.cashbackCents || 0;
  });
  return { tally, stuck, cents };
}

async function verify(exitAfter = true) {
  const list = [...ids];
  const snaps = list.length ? await chunkedGetAll(list.map((id) => db.collection('receipts').doc(id))) : [];
  const { tally, stuck, cents } = tallyOf(snaps);
  console.log(`gesamt=${snaps.length} pending=${stuck.length} approved-Cents=${cents}`);
  Object.entries(tally).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log(`  ${v}× ${k}`));
  if (stuck.length) console.log('noch offen:', stuck.join(' '));
  const errs = loadJson(ERR, []);
  if (errs.length) console.log('Publish-Fehler:', JSON.stringify(errs));
  if (exitAfter) process.exit(0);
  return stuck.length;
}

/** Bon-Daten mit aktiver Gutschrift (Ledger earn−reverse>0 → receipts.bonDate) — IMMER frisch. */
async function creditedDates(uid) {
  const col = db.collection(`users/${uid}/cashback_ledger`);
  const [earns, reverses] = await Promise.all([col.where('type', '==', 'earn').get(), col.where('type', '==', 'reverse').get()]);
  const rid = (d) => { const v = d.data().receiptId; return typeof v === 'string' && v.length > 0 ? v : null; };
  const net = new Map();
  earns.docs.forEach((d) => { const r = rid(d); if (r) net.set(r, (net.get(r) || 0) + (d.data().cents || 0)); });
  reverses.docs.forEach((d) => { const r = rid(d); if (r) net.set(r, (net.get(r) || 0) - (d.data().cents || 0)); });
  const active = [...net.entries()].filter(([, c]) => c > 0).map(([r]) => r);
  const dates = new Set();
  if (active.length) {
    const snaps = await chunkedGetAll(active.map((r) => db.collection('receipts').doc(r)));
    snaps.forEach((sn) => { if (sn.exists && sn.data().bonDate) dates.add(sn.data().bonDate); });
  }
  return dates;
}

/** Gibt es einen Live-Bon desselben Users mit gleichem contentHash/itemsHash? (→ Pipeline soll „Duplikat" labeln) */
async function hasLiveHashTwin(id, x) {
  for (const f of ['contentHash', 'itemsHash']) {
    if (!x[f]) continue;
    const q = await db.collection('receipts').where(f, '==', x[f]).limit(10).get();
    if (q.docs.some((o) => o.id !== id && o.data().userId === x.userId && LIVE.has(o.data().status))) return true;
  }
  return false;
}

async function publishWithRetry(topic, id, uid) {
  let lastErr = null;
  for (let i = 0; i < 3; i++) {
    try {
      await topic.publishMessage({ json: { cashbackId: id, uid }, attributes: { uid, cashbackId: id } });
      return true;
    } catch (e) { lastErr = e; await sleep(1000 * 3 ** i); }
  }
  const errs = loadJson(ERR, []);
  errs.push({ id, err: String(lastErr && lastErr.message).slice(0, 200) });
  fs.writeFileSync(ERR, JSON.stringify(errs));
  console.error(`PUBLISH-FEHLER ${id}: ${lastErr && lastErr.message}`);
  return false;
}

async function pollFinal(id, timeoutMs) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    await sleep(5000);
    const sn = await db.collection('receipts').doc(id).get();
    const st = sn.data()?.status;
    if (st && !PENDING.has(st)) return `${st}${sn.data().rejectReason ? `(${sn.data().rejectReason})` : ''}${sn.data().reviewReason ? `[${sn.data().reviewReason}]` : ''}`;
  }
  return null;
}

async function setDailyCapDirect(d, x) {
  await d.ref.update({
    campaignId: CAMPAIGN, campaignIdBackfilledAt: ts(),
    status: 'no_reward', rejectReason: 'daily_cap_reached', cashbackCents: 0,
    repairedAt0209b: ts(), repairDecision: 'daily_cap_direct', updatedAt: ts(),
  });
  await db.doc(`users/${x.userId}/cashback_status/${d.id}`).set(
    { status: 'no_reward', rejectReason: 'daily_cap_reached', cashbackCents: 0, updatedAt: ts() }, { merge: true },
  );
  const pp = await db.collection(`users/${x.userId}/purchased_products`).where('receiptId', '==', d.id).get();
  await Promise.all(pp.docs.map((p) => p.ref.set({ bonStatus: 'no_reward', rejectReason: 'daily_cap_reached' }, { merge: true })));
}

async function republish(topic, d, x, alreadyPending) {
  if (!alreadyPending) {
    await d.ref.update({
      campaignId: CAMPAIGN, campaignIdBackfilledAt: ts(),
      status: 'ocr_pending', rejectReason: del(), attempts: del(),
      repairedAt0209b: ts(), updatedAt: ts(),
    });
    await db.doc(`users/${x.userId}/cashback_status/${d.id}`).set(
      { status: 'ocr_pending', rejectReason: del(), updatedAt: ts() }, { merge: true },
    );
  }
  return publishWithRetry(topic, d.id, x.userId);
}

async function lauf() {
  if (VERIFY) return verify();
  const camp = await db.collection('cashback_campaigns').doc(CAMPAIGN).get();
  if (!camp.exists || camp.data().active !== true) throw new Error(`Kampagne ${CAMPAIGN} fehlt oder inaktiv`);
  const c = camp.data();
  const maxAge = Number.isFinite(c.maxAgeDays) ? c.maxAgeDays : 9999;
  console.log(`Kampagne ${CAMPAIGN}: startAt=${c.startAt.toDate().toISOString()} budget=${c.budgetRemainingCents} ct/Bon=${c.cashbackPerBonCents ?? 'tiers'} weeklyCap=${c.weeklyBonCap} perUser=${c.maxPerUserCents} maxAgeDays=${maxAge}`);

  const s = await db.collection('receipts').where('createdAt', '>=', SINCE).get();
  const isKandidat = (x) => x.status === 'no_reward' && x.rejectReason === 'no_active_campaign' && !x.campaignId && x.createdAt.toMillis() >= c.startAt.toMillis();
  const isHaengend = (x) => !!x.repairedAt0209b && PENDING.has(x.status) && x.campaignId === CAMPAIGN;
  const alle = s.docs.filter((d) => isKandidat(d.data()) || isHaengend(d.data()))
    .sort((a, b) => a.data().createdAt.toMillis() - b.data().createdAt.toMillis());
  const byUser = new Map();
  alle.forEach((d) => { const u = d.data().userId; if (!byUser.has(u)) byUser.set(u, []); byUser.get(u).push(d); });
  const nK = alle.filter((d) => isKandidat(d.data())).length;
  console.log(`Kandidaten: ${nK} | hängend aus früherem Lauf: ${alle.length - nK} | User: ${byUser.size}${DRY ? ' (DRY RUN)' : ''}`);

  // Vorab: Alterslimit (gegen Upload-Zeit) — diese bleiben unangetastet
  const zuAlt = new Set();
  for (const d of alle) {
    const x = d.data();
    if (!x.bonDate) continue;
    const age = (x.createdAt.toMillis() - Date.parse(x.bonDate)) / 86_400_000;
    if (age > maxAge) zuAlt.add(d.id);
  }
  if (DRY) {
    for (const [uid, docs] of byUser) {
      console.log(`User ${uid.slice(0, 8)}… (${docs.length} Bons)`);
      docs.forEach((d) => { const x = d.data(); console.log(`    ${d.id} | upload ${x.createdAt.toDate().toISOString()} | bonDate ${x.bonDate} | ${x.merchant?.id || '?'} | conf=${x.ocr?.robust?.confidence || '?'} | ${zuAlt.has(d.id) ? 'SKIP zu alt' : isHaengend(x) ? 'hängend→republish' : 'republish/daily_cap (Ledger entscheidet zur Laufzeit)'}`); });
    }
    console.log(`Plan: ${alle.length - zuAlt.size} zu verarbeiten, ${zuAlt.size} zu alt (unangetastet), ${[...byUser.values()].filter((v) => v.length > 1).length} User mit >1 Bon (sequenziell mit Polling)`);
    process.exit(0);
  }

  const topic = new PubSub({ projectId: 'markendetektive-895f7' }).topic('cashback-ocr-jobs');
  let nPub = 0; let nCap = 0; let nSkip = 0;
  for (const [uid, docs] of byUser) {
    const multi = docs.length > 1;
    for (const d of docs) {
      const x = d.data();
      if (zuAlt.has(d.id)) { nSkip++; logEntry({ id: d.id, uid, bonDate: x.bonDate, action: 'skip_too_old' }); continue; }
      ids.add(d.id); saveIds();
      const haengend = isHaengend(x);
      if (!haengend && x.bonDate) {
        const dates = await creditedDates(uid); // FRISCH — sieht die Gutschrift des vorherigen Bons dieses Users
        if (dates.has(x.bonDate) && !(await hasLiveHashTwin(d.id, x))) {
          await setDailyCapDirect(d, x);
          nCap++;
          logEntry({ id: d.id, uid, bonDate: x.bonDate, action: 'daily_cap_direct' });
          continue;
        }
      }
      const ok = await republish(topic, d, x, haengend);
      if (ok) nPub++;
      const final = multi ? await pollFinal(d.id, 240_000) : null;
      logEntry({ id: d.id, uid, bonDate: x.bonDate, action: haengend ? 'republish_haengend' : 'republish', final, note: multi && !final ? 'TIMEOUT beim Warten — nächster Bon liest den Ledger trotzdem frisch' : null });
      if (!multi) await sleep(2500);
    }
  }
  console.log(`Republiziert: ${nPub} | direkt daily_cap: ${nCap} | zu alt übersprungen: ${nSkip}`);
  // Abschluss: warten bis alles final ist (max. 15 min), dann Stand ausgeben
  const t0 = Date.now();
  while (Date.now() - t0 < 900_000) {
    const snaps = await chunkedGetAll([...ids].map((id) => db.collection('receipts').doc(id)));
    const { stuck } = tallyOf(snaps);
    if (!stuck.length) break;
    console.log(`… ${stuck.length} noch in Verarbeitung`);
    await sleep(15_000);
  }
  await verify();
}
lauf().catch((e) => { console.error('ABBRUCH', e); process.exit(1); });
