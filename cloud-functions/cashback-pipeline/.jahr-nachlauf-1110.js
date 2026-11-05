'use strict';
/**
 * Nachlauf 11.10.2026 (Patrick: „ja, lass die 19 Bons neu durchlaufen“): Bons, die seit
 * 10.09. nur wegen einer verlesenen Jahreszahl als zu alt abgelehnt wurden, mit der
 * erweiterten Jahreskorrektur (lib/bonDatum.js, Commit 20b31116) neu entscheiden lassen.
 * Die gespeicherte Texterkennung bleibt (Cache-Pfad, kein neuer Modellaufruf); die
 * Pipeline entscheidet über Tageslimit, Aktion und Betrag. Je Nutzer nacheinander.
 * DRY_RUN=1 (Standard) schreibt nichts. Ergebnis: .jahr-nachlauf-1110.result.json
 */
const admin = require('firebase-admin');
const fs = require('fs');
const { PubSub } = require('@google-cloud/pubsub');
const { plausibilizeBonDate } = require('./lib/bonDatum');
admin.initializeApp({ projectId: 'markendetektive-895f7' });
const db = admin.firestore();
const F = admin.firestore.FieldValue;
const DRY = process.env.DRY_RUN !== '0';
const ERG = '.jahr-nachlauf-1110.result.json';
const schlafen = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const s = await db.collection('receipts').where('rejectReason', '==', 'bon_too_old').get();
  const faelle = [];
  s.forEach((d) => {
    const x = d.data();
    const up = x.createdAt && x.createdAt.toDate();
    if (!up || up < new Date('2026-09-10T00:00:00Z') || x.status !== 'rejected') return;
    const roh = x.ocr && x.ocr.parsed && x.ocr.parsed.bonDate;
    const p = plausibilizeBonDate(roh, up, { maxTage: 7 });
    if (p.corrected && p.corrected.reason === 'year_misread_recent') faelle.push({ id: d.id, uid: x.userId, roh, neu: p.bonDate, upload: up.toISOString().slice(0, 10), campaignId: x.campaignId || null });
  });
  console.log(`Kandidaten: ${faelle.length}${DRY ? ' (Trockenlauf)' : ''}`);
  faelle.forEach((f) => console.log(' ', f.id, f.roh, '→', f.neu, 'upload', f.upload, 'aktion', f.campaignId, 'uid', String(f.uid).slice(0, 6)));
  if (DRY) process.exit(0);
  const erg = fs.existsSync(ERG) ? JSON.parse(fs.readFileSync(ERG, 'utf8')) : {};
  const topic = new PubSub({ projectId: 'markendetektive-895f7' }).topic('cashback-ocr-jobs');
  const proNutzer = {};
  faelle.forEach((f) => { (proNutzer[f.uid] = proNutzer[f.uid] || []).push(f); });
  await Promise.all(Object.values(proNutzer).map(async (liste) => {
    for (const f of liste) {
      if (erg[f.id] && erg[f.id].fertig) continue;
      const ref = db.doc(`receipts/${f.id}`);
      await ref.update({
        status: 'ocr_pending', rejectReason: F.delete(), attempts: F.delete(), lastError: F.delete(),
        nachverarbeitet: { at: F.serverTimestamp(), grund: 'Jahreskorrektur 7-Tage-Fenster (Commit 20b31116), Patrick 11.10.2026' },
        updatedAt: F.serverTimestamp(),
      });
      await db.doc(`users/${f.uid}/cashback_status/${f.id}`).set({ status: 'ocr_pending', receiptId: f.id, cashbackCents: 0, rejectReason: F.delete(), isClientPlaceholder: false, updatedAt: F.serverTimestamp() }, { merge: true });
      erg[f.id] = { gestartet: new Date().toISOString() };
      fs.writeFileSync(ERG, JSON.stringify(erg, null, 1));
      for (let v = 0; v < 3; v++) {
        try { await topic.publishMessage({ json: { cashbackId: f.id, uid: f.uid }, attributes: { uid: f.uid, cashbackId: f.id } }); break; } catch (e) { if (v === 2) throw e; await schlafen(2000); }
      }
      let x = null;
      for (let t = 0; t < 36; t++) { await schlafen(5000); x = (await ref.get()).data(); if (x.status !== 'ocr_pending') break; }
      erg[f.id] = { ...erg[f.id], fertig: x.status !== 'ocr_pending', status: x.status, grund: x.rejectReason || x.reviewReason || null, cent: x.cashbackCents || 0, bonDate: x.bonDate || null };
      fs.writeFileSync(ERG, JSON.stringify(erg, null, 1));
      console.log(f.id, '→', x.status, x.rejectReason || x.reviewReason || '', (x.cashbackCents || 0) + ' ct', x.bonDate);
    }
  }));
  process.exit(0);
})().catch((e) => { console.error('ABBRUCH:', e.message); process.exit(1); });
