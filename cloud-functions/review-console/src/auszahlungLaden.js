'use strict';
/**
 * Lädt die Daten für die Übersicht „Guthaben & Auszahlungen" (src/auszahlung.js)
 * — nur lesend. Getrennt von index.js, damit sich dieselbe Abfrage lokal gegen
 * die echten Daten ausprobieren lässt, ohne sie auszurollen.
 *
 *  - users mit cashback_balance_cents > 0 (nur dieses Feld),
 *  - Konto-Art je Person aus Firebase Auth (Pakete zu 100),
 *  - cashback_payouts (alle, wenige) — den Einlöse-Link nur, um Auszahlungen
 *    aus der Testumgebung von Tremendous zu erkennen; er verlässt den Server nie
 *    (er ist ein einlösbarer Geldwert),
 *  - Ledger der Personen ab der Hälfte der Schwelle (höchstens 60) und aller
 *    Empfänger von Auszahlungen (Testkonten erkennen).
 */
const { ms } = require('./duplicatePolicy');
const { baueAuszahlung, kontoArt, istTestLink, LISTE_AB } = require('./auszahlung');

/** Arbeitet eine Liste mit höchstens `n` gleichzeitigen Aufrufen ab. */
async function nebenlaeufig(liste, n, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, liste.length) }, async () => {
    while (i < liste.length) { const x = liste[i++]; await fn(x); }
  }));
}

async function ladeAuszahlung({ db, auth, jetzt, logger = console }) {
  const [cfg, nutzerSnap, payoutSnap] = await Promise.all([
    db.doc('cashback_config/v1').get(),
    db.collection('users').where('cashback_balance_cents', '>', 0).select('cashback_balance_cents').get(),
    db.collection('cashback_payouts').select('userId', 'status', 'amountCents', 'createdAt', 'sentAt', 'redemptionLink').get(),
  ]);
  // Gleiche Vorgabe wie requestPayout (cashback-pipeline): fehlt der Wert, gilt 10 €.
  const schwelleRoh = cfg.get('payoutThresholdCents');
  const schwelleCents = Number.isFinite(schwelleRoh) ? schwelleRoh : 1000;

  const nutzer = nutzerSnap.docs.map((d) => ({ uid: d.id, cents: Number(d.get('cashback_balance_cents')) || 0, konto: 'unbekannt' }));
  // Konto-Art je Person. Scheitert ein Paket, bleibt „unbekannt" stehen — die
  // Summen stimmen trotzdem, nur die Aufteilung nach Konto ist dann unscharf.
  let kontoFehler = 0;
  const nachUid = new Map(nutzer.map((n) => [n.uid, n]));
  const pakete = [];
  for (let i = 0; i < nutzer.length; i += 100) pakete.push(nutzer.slice(i, i + 100));
  await nebenlaeufig(pakete, 5, async (teil) => {
    try {
      const r = await auth.getUsers(teil.map((n) => ({ uid: n.uid })));
      r.users.forEach((au) => { const n = nachUid.get(au.uid); if (n) n.konto = kontoArt(au); });
    } catch (e) {
      kontoFehler += teil.length;
      logger.warn('Auszahlungsübersicht: Konto-Abfrage gescheitert', { anzahl: teil.length, fehler: e.message });
    }
  });

  const auszahlungen = payoutSnap.docs.map((d) => ({
    uid: d.get('userId') || null,
    status: d.get('status') || null,
    cents: Number(d.get('amountCents')) || 0,
    at: ms(d.get('sentAt')) ?? ms(d.get('createdAt')),
    testLink: istTestLink(d.get('redemptionLink')),
  }));

  // Ledger: vollständig für alle, die in der Liste stehen können (ab der Hälfte
  // der Schwelle oder mit Guthaben und früherer Auszahlung). Von Empfängern
  // ohne Guthaben nur die manuellen Buchungen — die reichen, um ein Testkonto
  // zu erkennen, und halten die Lesekosten klein.
  const ledger = new Map();
  const guthaben = new Map(nutzer.map((n) => [n.uid, n.cents]));
  const empfaenger = new Set(auszahlungen.map((p) => p.uid).filter(Boolean));
  const voll = new Set(nutzer.filter((n) => n.cents >= LISTE_AB * schwelleCents || empfaenger.has(n.uid)).map((n) => n.uid));
  const nurManuell = [...empfaenger].filter((uid) => !voll.has(uid) && !guthaben.has(uid));
  const eintrag = (d) => ({
    type: d.get('type') || null,
    cents: Number(d.get('cents')) || 0,
    at: ms(d.get('createdAt')),
    balanceAfter: Number.isFinite(d.get('balanceAfterCents')) ? d.get('balanceAfterCents') : null,
    payoutId: d.get('payoutId') || null,
    reason: d.get('reason') || null,
  });
  const felder = ['type', 'cents', 'createdAt', 'balanceAfterCents', 'payoutId', 'reason'];
  await nebenlaeufig([...voll], 10, async (uid) => {
    const s = await db.collection(`users/${uid}/cashback_ledger`).select(...felder).get();
    ledger.set(uid, s.docs.map(eintrag));
  });
  await nebenlaeufig(nurManuell, 10, async (uid) => {
    const s = await db.collection(`users/${uid}/cashback_ledger`).where('type', '==', 'admin_adjust').select(...felder).get();
    ledger.set(uid, s.docs.map(eintrag));
  });

  return { ...baueAuszahlung({ jetzt, schwelleCents, nutzer, ledger, auszahlungen }), kontoFehler };
}

module.exports = { ladeAuszahlung };
