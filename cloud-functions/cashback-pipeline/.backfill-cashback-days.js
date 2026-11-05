'use strict';
/**
 * Backfill/Repair users/{uid}/cashback_days/{YYYY-MM-DD}.receiptIds aus dem
 * Ledger — TRANSAKTIONAL pro User (Ledger + Receipts + Tages-Docs in einer
 * Transaktion gelesen, Tages-Docs auf die AKTIVE Menge gesetzt: fügt hinzu
 * UND entfernt stale Einträge; leere Docs werden gelöscht). Setzt zusätzlich
 * `bonDate` auf Legacy-Ledger-Earns (separat, gechunkt).
 *   DRY_RUN=1 → Statistik inkl. stale/fehlend.   VERIFY=1 → Abgleich, exit 1 bei missing ODER extra.
 */
const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'markendetektive-895f7' });
const db = admin.firestore();
const DRY = process.env.DRY_RUN === '1';
const VERIFY = process.env.VERIFY === '1';
const FV = admin.firestore.FieldValue;
const isDay = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);

/** Aktive Receipts (earn−reverse>0) → Map receiptId→bonDate; Unauflösbare gezählt. */
async function activeMap(tx, uRef) {
  const col = uRef.collection('cashback_ledger');
  const [earns, reverses] = await Promise.all([tx.get(col.where('type', '==', 'earn')), tx.get(col.where('type', '==', 'reverse'))]);
  const rid = (d) => { const v = d.data().receiptId; return typeof v === 'string' && v ? v : null; };
  const net = new Map();
  earns.docs.forEach((d) => { const r = rid(d); if (r) net.set(r, (net.get(r) || 0) + (d.data().cents || 0)); });
  reverses.docs.forEach((d) => { const r = rid(d); if (r) net.set(r, (net.get(r) || 0) - (d.data().cents || 0)); });
  const active = [...net.entries()].filter(([, c]) => c > 0).map(([r]) => r);
  const dateOf = new Map(); const unresolvable = [];
  if (active.length) {
    const snaps = await tx.getAll(...active.map((r) => db.collection('receipts').doc(r)));
    snaps.forEach((sn) => { const bd = sn.exists ? sn.data().bonDate : null; if (isDay(bd)) dateOf.set(sn.id, bd); else unresolvable.push(sn.id); });
  }
  return { dateOf, earns, unresolvable, activeCount: active.length };
}

(async () => {
  const users = await db.collection('users').where('cashback_lifetime_cents', '>', 0).select('cashback_lifetime_cents').get();
  console.log(`User mit Lifetime>0: ${users.size}${DRY ? ' (DRY RUN)' : VERIFY ? ' (VERIFY)' : ''}`);
  const st = { users: 0, receipts: 0, days: 0, multi: 0, added: 0, removed: 0, deleted: 0, ledgerDated: 0, missing: 0, extra: 0, unresolvable: 0 };
  const ex = { missing: [], extra: [], unresolvable: [] };
  for (const u of users.docs) {
    let ledgerUpdates = [];
    await db.runTransaction(async (tx) => {
      ledgerUpdates = [];
      const { dateOf, earns, unresolvable, activeCount } = await activeMap(tx, u.ref);
      if (!activeCount) return;
      st.users++; st.receipts += activeCount; st.unresolvable += unresolvable.length;
      unresolvable.slice(0, 2).forEach((id) => ex.unresolvable.length < 5 && ex.unresolvable.push(`${u.id.slice(0, 6)}… ${id}`));
      const want = new Map(); // day → Set(ids)
      dateOf.forEach((day, id) => { if (!want.has(day)) want.set(day, new Set()); want.get(day).add(id); });
      const existing = await tx.get(u.ref.collection('cashback_days'));
      const have = new Map(existing.docs.map((d) => [d.id, new Set(Array.isArray(d.data().receiptIds) ? d.data().receiptIds : [])]));
      const allDays = new Set([...want.keys(), ...have.keys()]);
      for (const day of allDays) {
        const w = want.get(day) || new Set(); const h = have.get(day) || new Set();
        const add = [...w].filter((id) => !h.has(id)); const rem = [...h].filter((id) => !w.has(id));
        if (w.size) { st.days++; if (w.size > 1) st.multi++; }
        if (VERIFY) {
          st.missing += add.length; st.extra += rem.length;
          add.slice(0, 2).forEach((id) => ex.missing.length < 5 && ex.missing.push(`${u.id.slice(0, 6)}… ${day} ${id}`));
          rem.slice(0, 2).forEach((id) => ex.extra.length < 5 && ex.extra.push(`${u.id.slice(0, 6)}… ${day} ${id}`));
          continue;
        }
        if (!add.length && !rem.length) continue;
        st.added += add.length; st.removed += rem.length;
        if (DRY) continue;
        const ref = u.ref.collection('cashback_days').doc(day);
        if (w.size === 0) { tx.delete(ref); st.deleted++; }
        else tx.set(ref, { bonDate: day, receiptIds: [...w], updatedAt: FV.serverTimestamp(), backfilledAt: FV.serverTimestamp() }, { merge: true });
      }
      earns.docs.forEach((d) => { const bd = dateOf.get(d.data().receiptId); if (bd && !isDay(d.data().bonDate)) ledgerUpdates.push([d.ref, bd]); });
    });
    if (!VERIFY && ledgerUpdates.length) {
      st.ledgerDated += ledgerUpdates.length;
      if (!DRY) for (let i = 0; i < ledgerUpdates.length; i += 400) { const b = db.batch(); ledgerUpdates.slice(i, i + 400).forEach(([ref, bd]) => b.set(ref, { bonDate: bd }, { merge: true })); await b.commit(); }
    }
  }
  if (VERIFY) {
    console.log(`VERIFY: User ${st.users} | aktive Receipts ${st.receipts} | fehlend ${st.missing} | stale ${st.extra} | unauflösbar (kein Receipt/Datum) ${st.unresolvable}`);
    if (ex.missing.length) console.log('  fehlend:', ex.missing.join(' | '));
    if (ex.extra.length) console.log('  stale:', ex.extra.join(' | '));
    if (ex.unresolvable.length) console.log('  unauflösbar:', ex.unresolvable.join(' | '));
    process.exit(st.missing || st.extra ? 1 : 0);
  }
  console.log(`User ${st.users} | aktive Receipts ${st.receipts} | Tages-Docs ${st.days} (>1 Bon: ${st.multi}) | +${st.added} / −${st.removed} IDs, ${st.deleted} Docs gelöscht | Ledger-Earns datiert ${st.ledgerDated} | unauflösbar ${st.unresolvable}`);
  if (ex.unresolvable.length) console.log('  unauflösbar:', ex.unresolvable.join(' | '));
  process.exit(0);
})().catch((e) => { console.error('ABBRUCH', e); process.exit(1); });
