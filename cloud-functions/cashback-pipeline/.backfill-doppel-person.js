'use strict';
/**
 * Bestand in den Personen-Index nachtragen (Nachprüfung 05.10.2026, lib/doppelBon.js).
 *
 * `cashback_bon_person/{uid}.eintraege.{receiptId}` schreibt die Buchung erst ab
 * dem Deploy. Bis der Index die letzten 95 Tage abdeckt, kennt die Regel
 * `doppelDatum` jenseits von 8 Tagen nur Gutschriften seit dem Deploy — und der
 * scharfe Bild-Feinvergleich ließe die beschnittene Kopie jedes vorher bezahlten
 * Bons mit geändertem Datum durch. Darum wartet `bildFeinvergleich: true` auf
 * `cashback_config/v1.doppelBestandIndexiert === true`, das NUR dieses Skript
 * nach grünem VERIFY setzt.
 *
 * Je Person eine Transaktion: Ledger (Earn − Storno) und Personen-Index frisch
 * gelesen, für jeden noch BEZAHLTEN Bon mit Bon-Datum in den letzten 95 Tagen
 * die Lesung aus `receipts/{id}` ergänzt (nie ersetzt; nur Bons DIESER Person —
 * ein über eine fremde clientUploadId überschriebenes Dokument wird gemeldet,
 * nicht eingetragen). Abgelaufene Einträge räumt dieselbe Funktion wie die
 * Buchung weg. Läuft eine Gutschrift oder ein Storno gleichzeitig, wiederholt
 * Firestore die Transaktion.
 *
 *   (ohne Variable)  Trockenlauf: zählt, schreibt nichts.
 *   SCHREIBEN=1      trägt nach.
 *   VERIFY=1         prüft, exit 1 bei fehlenden Einträgen.
 *   VERIFY=1 SCHALTER=1  setzt nach grünem VERIFY doppelBestandIndexiert: true.
 *
 * Erst nach dem Deploy der Pipeline laufen lassen (sonst fehlen Gutschriften aus
 * dem Fenster dazwischen), danach VERIFY. Admin-SDK mit ADC des Nutzerkontos,
 * aus einem Ordner mit firebase-admin starten (dieser).
 */
const {
  PERSON_SAMMLUNG,
  PERSON_AUFBEWAHRUNG_TAGE,
  identitaetAusBon,
  personLesungAus,
  personEintragWert,
  personAufraeumen,
  tageAbstand,
} = require('./lib/doppelBon');

const heute = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Berlin' });

/** Aktive Bons (Earn − Storno > 0) einer Person, in der Transaktion gelesen. */
async function aktiveBons(tx, uRef) {
  const col = uRef.collection('cashback_ledger');
  const [earns, reverses] = await Promise.all([tx.get(col.where('type', '==', 'earn')), tx.get(col.where('type', '==', 'reverse'))]);
  const netto = new Map();
  const rid = (d) => (typeof d.data().receiptId === 'string' && d.data().receiptId ? d.data().receiptId : null);
  earns.docs.forEach((d) => { const r = rid(d); if (r) netto.set(r, (netto.get(r) || 0) + (d.data().cents || 0)); });
  reverses.docs.forEach((d) => { const r = rid(d); if (r) netto.set(r, (netto.get(r) || 0) - (d.data().cents || 0)); });
  return [...netto.entries()].filter(([, c]) => c > 0).map(([r]) => r);
}

/**
 * Kern des Laufs (für Tests mit der Firestore-Attrappe getrennt).
 * @returns {Promise<{st:object, beispiele:object, gruen:boolean|null}>}
 */
async function nachtragen({ db, FV, SCHREIBEN = false, VERIFY = false, SCHALTER = false, tag = heute(), log = console.log }) {
  const users = await db.collection('users').where('cashback_lifetime_cents', '>', 0).select('cashback_lifetime_cents').get();
  const modus = VERIFY ? 'VERIFY' : SCHREIBEN ? 'SCHREIBEN' : 'TROCKENLAUF';
  // Trockenlauf und VERIFY lesen nur — ohne Sperren, damit laufende Buchungen
  // nicht warten (schreibende Transaktionen sperren gelesene Dokumente).
  const schreibend = SCHREIBEN && !VERIFY;
  log(`${modus}: ${users.size} Personen mit Gutschriften, Stichtag ${tag}`);
  const st = { personen: 0, bezahlt: 0, imFenster: 0, schonDa: 0, nachgetragen: 0, fehlend: 0, ohneDatum: 0, fremd: 0, ohneDokument: 0, aufgeraeumt: 0 };
  const beispiele = { fehlend: [], fremd: [] };
  for (const u of users.docs) {
    // Erst nach dem letzten Versuch zählen (Transaktionen werden wiederholt).
    let lokal = null;
    const fehlendHier = [];
    const fremdHier = [];
    await db.runTransaction(async (tx) => {
      lokal = { bezahlt: 0, imFenster: 0, schonDa: 0, nachgetragen: 0, fehlend: 0, ohneDatum: 0, fremd: 0, ohneDokument: 0, aufgeraeumt: 0 };
      fehlendHier.length = 0;
      fremdHier.length = 0;
      const aktiv = await aktiveBons(tx, u.ref);
      if (!aktiv.length) { lokal = null; return; }
      const personRef = db.collection(PERSON_SAMMLUNG).doc(u.id);
      const personSnap = await tx.get(personRef);
      const eintraege = personSnap.exists && personSnap.data().eintraege && typeof personSnap.data().eintraege === 'object'
        ? personSnap.data().eintraege
        : {};
      // Nur die Felder, die identitaetAusBon liest — Bon-Dokumente tragen die
      // ganze Texterkennung.
      const snaps = await tx.getAll(...aktiv.map((id) => db.collection('receipts').doc(id)), {
        fieldMask: ['userId', 'bonDate', 'bonTime', 'bonTotalCents', 'merchant', 'items', 'ocr.parsed'],
      });
      const neu = {};
      for (const sn of snaps) {
        lokal.bezahlt++;
        if (!sn.exists) { lokal.ohneDokument++; continue; }
        const bon = sn.data();
        if (bon.userId && bon.userId !== u.id) {
          lokal.fremd++;
          fremdHier.push(sn.id);
          continue;
        }
        const id = identitaetAusBon(bon);
        const lesung = personLesungAus(id);
        if (!lesung) { lokal.ohneDatum++; continue; }
        const abstand = tageAbstand(tag, lesung.t);
        if (abstand == null || (lesung.t < tag && abstand > PERSON_AUFBEWAHRUNG_TAGE)) continue;
        lokal.imFenster++;
        const wert = personEintragWert(eintraege[sn.id], lesung);
        if (!wert) { lokal.schonDa++; continue; }
        if (VERIFY) {
          // Der Bon steht gar nicht im Index → fehlt. Steht er unter einer
          // anderen Lesung, sperrt er dort schon (die Buchung ergänzt nur).
          if (!eintraege[sn.id]) {
            lokal.fehlend++;
            fehlendHier.push(`${u.id.slice(0, 6)}… ${sn.id}`);
          } else {
            lokal.schonDa++;
          }
          continue;
        }
        neu[sn.id] = wert;
      }
      // Aufräumen wie die Buchung (abgelaufen, zu voll) — über alten und neuen Stand.
      const weg = new Set(personAufraeumen({ ...eintraege, ...neu }, tag));
      const loeschen = [...weg].filter((id) => eintraege[id]);
      const eintragen = Object.entries(neu).filter(([id]) => !weg.has(id));
      lokal.aufgeraeumt = loeschen.length;
      lokal.nachgetragen = eintragen.length;
      if (SCHREIBEN && !VERIFY && (eintragen.length || loeschen.length)) {
        tx.set(
          personRef,
          {
            eintraege: {
              ...Object.fromEntries(loeschen.map((id) => [id, FV.delete()])),
              ...Object.fromEntries(eintragen),
            },
            updatedAt: FV.serverTimestamp(),
            backfilledAt: FV.serverTimestamp(),
          },
          { merge: true },
        );
      }
    }, schreibend ? undefined : { readOnly: true });
    if (!lokal) continue;
    st.personen++;
    for (const k of Object.keys(lokal)) st[k] += lokal[k];
    for (const x of fehlendHier) if (beispiele.fehlend.length < 5) beispiele.fehlend.push(x);
    for (const x of fremdHier) if (beispiele.fremd.length < 5) beispiele.fremd.push(x);
  }
  log(JSON.stringify(st));
  if (beispiele.fehlend.length) log('fehlend (Beispiele):', beispiele.fehlend.join(' | '));
  if (beispiele.fremd.length) log('fremdes Dokument unter eigener Gutschrift (Beispiele):', beispiele.fremd.join(' | '));
  if (!VERIFY) return { st, beispiele, gruen: null };
  if (st.fehlend > 0) {
    log('VERIFY ROT — doppelBestandIndexiert bleibt aus.');
    return { st, beispiele, gruen: false };
  }
  log('VERIFY GRÜN.');
  if (SCHALTER) {
    await db.doc('cashback_config/v1').set({
      doppelBestandIndexiert: true,
      doppelBestandIndexiertNote: `Personen-Index nachgetragen, VERIFY grün am ${tag} (.backfill-doppel-person.js): ${st.imFenster} bezahlte Bons der letzten ${PERSON_AUFBEWAHRUNG_TAGE} Tage, 0 fehlend.`,
    }, { merge: true });
    log('cashback_config/v1.doppelBestandIndexiert = true gesetzt.');
  }
  return { st, beispiele, gruen: true };
}

module.exports = { nachtragen };

if (require.main === module) {
  const admin = require('firebase-admin');
  admin.initializeApp({ projectId: 'markendetektive-895f7' });
  nachtragen({
    db: admin.firestore(),
    FV: admin.firestore.FieldValue,
    SCHREIBEN: process.env.SCHREIBEN === '1',
    VERIFY: process.env.VERIFY === '1',
    SCHALTER: process.env.SCHALTER === '1',
  })
    .then(({ gruen }) => { if (gruen === false) process.exit(1); })
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
