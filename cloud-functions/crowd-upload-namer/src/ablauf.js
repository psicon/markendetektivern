'use strict';

/**
 * Wer liest wann? Sperre des Erstlaufs, Nachlauf-Zeitplan und die Felder,
 * die jeder Ausgang am Dokument hinterlässt.
 *
 * Anlass (26.09.2026): Seit dem 24.09. endeten 12 von 267 Erstlesungen
 * endgültig mit Fehler (8× 429, 3× 60-s-Grenze, 1× Dekodierfehler). Einen
 * zweiten Anlauf gab es nicht (Trigger ohne Wiederholung) — erst die
 * Morgenrunde las 12–14 Stunden später nach, und zwar in eigene Felder, die
 * die Prüfkonsole nicht kennt. priceImageKind und priceReceipt (Ortsquelle
 * „Kassenbon") fehlten bei allen 12 dauerhaft.
 *
 * Jetzt: ein vorübergehender Fehler plant `namerNachlesenAb`, der Nachlauf
 * (alle 15 Minuten) liest mit DERSELBEN Logik nach und schreibt in DIESELBEN
 * Felder. Wartezeiten 15 min → 1 h → 3 h → 8 h, danach bleibt der
 * Fehlervermerk stehen und die Morgenrunde ist zuständig.
 *
 * `namerNachlesenVersuch` = Nummer des zuletzt begonnenen Leseversuchs
 * (1 = Erstlauf, 2 = erster Nachlauf …). Der Nachlauf erhöht sie schon beim
 * Übernehmen: stirbt er mitten im Lesen, zählt der Versuch trotzdem, und ein
 * Dokument, das die Funktion immer wieder abstürzen lässt, kreist nicht ewig.
 *
 * Messbarkeit der Erstlesung: `productNameOcrFehlerErst` (Fehler des
 * Erstlaufs) bleibt stehen, `productNameOcrNachgelesenAt` markiert, dass der
 * Wert vom Nachlauf stammt.
 *
 * Der Nachlauf liest NUR offene Einreichungen (Status pending). Ob er auch
 * entschiedene ergänzen soll (priceImageKind, priceReceipt), ist eine offene
 * Entscheidung; bis dahin fasst er sie nicht an — wie vor dieser Änderung,
 * als nach einer Entscheidung ohnehin niemand mehr nachlas.
 *
 * Firestore und Zeitstempel werden hereingereicht (`db`, `werte`), damit die
 * Regeln ohne firebase-admin testbar sind.
 */

const crypto = require('node:crypto');
const { auswerten, patchFelder, istVoruebergehend, istMengenlimit } = require('./lesung');

const MIN = 60 * 1000;
/** Wartezeit nach dem gescheiterten Leseversuch Nr. n (Index n-1; 1 = Erstlauf). */
const WARTEZEITEN_MS = [15 * MIN, 60 * MIN, 180 * MIN, 480 * MIN];
/** Letzter erlaubter Leseversuch: Erstlauf + ein Nachlauf je Wartezeit. */
const MAX_VERSUCH = 1 + WARTEZEITEN_MS.length;
/** So lange hält ein begonnener Leseversuch das Dokument (> 540 s Nachlauf-Limit). */
const SPERRE_MS = 20 * MIN;
/** Sperre gegen einen zweiten Erstlauf (> 300 s Trigger-Limit). */
const LAUF_SPERRE_MS = 10 * MIN;

const tsMs = (v) => {
  if (v && typeof v.toMillis === 'function') return v.toMillis();
  if (v instanceof Date) return v.getTime();
  return 0;
};

/** Wann der nächste Versuch fällig ist — oder null, wenn keiner mehr kommt. */
function planNachFehlschlag(versuch, jetzt) {
  const warte = WARTEZEITEN_MS[versuch - 1];
  return warte == null ? null : { abMs: jetzt + warte };
}

/**
 * Darf der Erstlauf lesen? Die Sperre gilt je AUFRUF (`lauf`, zufällig), nicht
 * je Event-ID: Pub/Sub stellt dieselbe Nachricht gelegentlich doppelt zu (bei
 * der Bon-Pipeline belegt, gleiche Event-ID), und der Namer-Doppellauf vom
 * 24.09. startete 4 min nach dem ersten, während der noch las. Die eigene
 * Sperre dagegen blockiert nicht — sonst bräche der Lauf ab, wenn das
 * Admin-SDK die Anmelde-Transaktion nach einem Commit mit verlorener Antwort
 * wiederholt. Hat der Nachlauf übernommen (Versuch ≥ 2), ist der Erstlauf
 * vorbei, auch wenn seine Sperre längst abgelaufen ist.
 * @returns {'weg'|'erledigt'|'nachlauf'|'laeuft'|'frei'}
 */
function erstlaufUrteil(doc, jetzt, lauf = null) {
  if (!doc) return 'weg';
  if (doc.productNameOcrAt) return 'erledigt';
  if (Number(doc.namerNachlesenVersuch) >= 2) return 'nachlauf';
  const sperre = doc.namerLauf;
  if (sperre && jetzt - tsMs(sperre.at) < LAUF_SPERRE_MS && !(lauf && sperre.lauf === lauf)) return 'laeuft';
  return 'frei';
}

const istOffen = (doc) => !doc.status || doc.status === 'pending';

/**
 * Darf der Nachlauf dieses Dokument übernehmen?
 * @returns {{aktion: 'weg'|'nicht_faellig'|'erledigt'|'entschieden'|'erschoepft'|'uebernehmen', versuch?: number}}
 */
function nachlaufUrteil(doc, jetzt) {
  if (!doc) return { aktion: 'weg' };
  if (!doc.namerNachlesenAb || tsMs(doc.namerNachlesenAb) > jetzt) return { aktion: 'nicht_faellig' };
  if (doc.productNameOcr) return { aktion: 'erledigt' };
  // Erstlauf fertig ohne Fehler (z. B. Name nicht lesbar) — nichts nachzulesen.
  if (doc.productNameOcrAt && !doc.productNameOcrFehler) return { aktion: 'erledigt' };
  if (!istOffen(doc)) return { aktion: 'entschieden' };
  const bisher = Number(doc.namerNachlesenVersuch) || 1;
  if (bisher >= MAX_VERSUCH) return { aktion: 'erschoepft' };
  return { aktion: 'uebernehmen', versuch: bisher + 1 };
}

function fehlerVermerk(fehler, { versuche, voruebergehend }, werte) {
  return {
    grund: String((fehler && fehler.message) || fehler).slice(0, 200),
    versuche: versuche || null,
    voruebergehend,
    at: werte.stamp(),
  };
}

/**
 * Die Felder zu einem Ausgang von `leseEinreichung` (src/fotos.js). Erstlauf
 * und Nachlauf schreiben dieselben Felder — nur so sieht die Prüfkonsole den
 * nachgelesenen Namen, und priceReceipt stößt die Ortsbewertung an.
 *
 * @param {object} ausgang Ergebnis von leseEinreichung
 * @param {object} ctx
 * @param {number} ctx.versuch 1 = Erstlauf, ≥ 2 = Nachlauf
 * @param {object} ctx.frisch aktueller Dokumentstand
 * @param {number} ctx.jetzt ms
 * @param {{stamp: Function, ts: Function, loeschen: Function}} ctx.werte
 * @returns {{felder: object, ergebnis?: object}}
 */
function ausgangFelder(ausgang, { versuch, frisch = {}, jetzt, werte }) {
  const erstlauf = versuch === 1;
  const felder = {};
  if (erstlauf || !frisch.productNameOcrAt) felder.productNameOcrAt = werte.stamp();
  if (ausgang.defekt && ausgang.defekt.length) felder.productNameOcrBildDefekt = ausgang.defekt;

  if (ausgang.art === 'gelesen') {
    const ergebnis = auswerten(ausgang.parsed, { hatPreisBild: ausgang.gesendet.includes('preis') });
    Object.assign(felder, patchFelder(ergebnis, {
      userName: frisch.productName,
      // Während des Lesens entschieden → keinen Namen einsetzen, den niemand geprüft hat.
      nameErlaubt: istOffen(frisch),
      herstellerGelesen: ausgang.gesendet.includes('hersteller'),
    }));
    felder.namerNachlesenAb = werte.loeschen();
    if (!erstlauf) {
      felder.productNameOcrNachgelesenAt = werte.stamp();
      felder.productNameOcrFehler = werte.loeschen();
    }
    return { felder, ergebnis };
  }

  if (ausgang.art === 'ohne_bild' && erstlauf) {
    // Keine Namer-Fotos: kein Fehler, nur „versucht" (bisheriges Verhalten).
    felder.productNameOcr = null;
    felder.namerNachlesenAb = werte.loeschen();
    return { felder };
  }

  // Fehler, defekte oder fehlende Fotos. Grund = Ausgang, wenn kein Fehlerobjekt.
  const fehler = ausgang.fehler || new Error(ausgang.art);
  const voruebergehend = ausgang.art === 'fehler' && istVoruebergehend(fehler);
  const angaben = { versuche: ausgang.versuche, voruebergehend };
  if (erstlauf) felder.productNameOcr = null;
  felder.productNameOcrFehler = fehlerVermerk(fehler, angaben, werte);
  const plan = voruebergehend ? planNachFehlschlag(versuch, jetzt) : null;
  if (plan) {
    felder.namerNachlesenAb = werte.ts(plan.abMs);
    felder.namerNachlesenVersuch = versuch;
  } else {
    felder.namerNachlesenAb = werte.loeschen();
  }
  if (erstlauf && voruebergehend) felder.productNameOcrFehlerErst = fehlerVermerk(fehler, angaben, werte);
  return { felder };
}

/**
 * Erstlauf anmelden — in einer Transaktion gegen den FRISCHEN Stand. Die
 * frühere Prüfung sah `event.data`, also den Stand bei Anlage, und konnte
 * eine zweite Zustellung nie erkennen. Setzt zugleich `namerNachlesenAb` als
 * Sicherheitsnetz: stirbt der Lauf ohne zu schreiben (Zeitlimit, Speicher),
 * findet ihn der Nachlauf nach SPERRE_MS.
 *
 * Wirft nie: ist die Sperre nicht setzbar, wird gelesen wie vor dieser
 * Änderung — ein Firestore-Aussetzer darf keine Einreichung liegen lassen
 * (`lauf` ist dann null, erstlaufAbschliessen prüft keinen Besitz).
 * @returns {Promise<{urteil: string, daten: object|null, lauf: string|null, sperre?: object, ohneSperre?: boolean, fehler?: string}>}
 */
async function erstlaufBeginnen({ db, ref, eventId, jetzt, werte, lauf = crypto.randomUUID() }) {
  try {
    return await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const daten = snap.exists ? snap.data() : null;
      const urteil = erstlaufUrteil(daten, jetzt, lauf);
      if (urteil !== 'frei') return { urteil, daten, lauf, sperre: daten && daten.namerLauf };
      tx.update(ref, {
        namerLauf: { eventId: eventId || null, lauf, at: werte.ts(jetzt) },
        namerNachlesenAb: werte.ts(jetzt + SPERRE_MS),
      });
      return { urteil, daten, lauf };
    });
  } catch (e) {
    return { urteil: 'frei', daten: null, lauf: null, ohneSperre: true, fehler: e.message };
  }
}

/**
 * Erstlauf: Ergebnis schreiben — nur, wenn der Fall noch diesem Aufruf gehört.
 * Vorher war es ein blindes update: eine verspätete zweite Zustellung hätte
 * einen vom Nachlauf schon gelesenen Namen mit null überschrieben und dessen
 * Versuchszählung auf 1 zurückgesetzt. Die Felder rechnet ausgangFelder gegen
 * den frischen Stand (Nutzername, Status).
 * @returns {Promise<{status: 'weg'|'fremd'|'schon_gelesen'|'geschrieben', felder?: object, ergebnis?: object}>}
 */
async function erstlaufAbschliessen({ db, ref, lauf, ausgang, jetzt, werte }) {
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return { status: 'weg' };
    const frisch = snap.data();
    if (Number(frisch.namerNachlesenVersuch) >= 2) return { status: 'fremd' };
    if (lauf && !(frisch.namerLauf && frisch.namerLauf.lauf === lauf)) return { status: 'fremd' };
    if (!lauf && frisch.productNameOcrAt) return { status: 'schon_gelesen' };
    const { felder, ergebnis } = ausgangFelder(ausgang, { versuch: 1, frisch, jetzt, werte });
    tx.update(ref, felder);
    return { status: 'geschrieben', felder, ergebnis };
  });
}

/** Nachlauf: Dokument übernehmen (Transaktion). Räumt erledigte, entschiedene und erschöpfte Fälle aus der Abfrage. */
async function nachlaufUebernehmen({ db, ref, jetzt, werte }) {
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const daten = snap.exists ? snap.data() : null;
    const urteil = nachlaufUrteil(daten, jetzt);
    if (['erledigt', 'entschieden', 'erschoepft'].includes(urteil.aktion)) {
      tx.update(ref, { namerNachlesenAb: werte.loeschen() });
    } else if (urteil.aktion === 'uebernehmen') {
      const felder = { namerNachlesenAb: werte.ts(jetzt + SPERRE_MS), namerNachlesenVersuch: urteil.versuch };
      // Erstlauf ohne jedes Ergebnis abgebrochen — für die Messung festhalten.
      if (!daten.productNameOcrAt && !daten.productNameOcrFehlerErst) {
        felder.productNameOcrFehlerErst = { grund: 'erstlauf_abgebrochen', versuche: null, voruebergehend: true, at: werte.stamp() };
      }
      tx.update(ref, felder);
    }
    return { ...urteil, daten };
  });
}

/** Nachlauf: Ergebnis schreiben — nur, wenn der Anspruch noch uns gehört. */
async function nachlaufAbschliessen({ db, ref, versuch, ausgang, jetzt, werte }) {
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return { status: 'weg' };
    const frisch = snap.data();
    if (Number(frisch.namerNachlesenVersuch) !== versuch) return { status: 'fremd' };
    if (frisch.productNameOcr) {
      tx.update(ref, { namerNachlesenAb: werte.loeschen() });
      return { status: 'schon_gelesen' };
    }
    // Während des Lesens entschieden (z. B. Morgenrunde): nichts nachtragen,
    // der Nachlauf fasst entschiedene Fälle nicht an (siehe Kopf).
    if (!istOffen(frisch)) {
      tx.update(ref, { namerNachlesenAb: werte.loeschen() });
      return { status: 'entschieden' };
    }
    const { felder, ergebnis } = ausgangFelder(ausgang, { versuch, frisch, jetzt, werte });
    tx.update(ref, felder);
    return { status: 'geschrieben', felder, ergebnis };
  });
}

const schlafenStandard = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Ein Nachlauf-Durchgang. Höchstens `limit` fällige Einreichungen, zwei
 * parallel mit Zufallsversatz. Das Mengenlimit (429) teilt sich der Namer mit
 * der Bon-Pipeline: nach `max429InFolge` Ablehnungen in Folge beginnt der
 * Durchgang nichts Neues mehr (der Rest bleibt fällig für den nächsten).
 * Nach `neueBisMs` ebenfalls nicht — ein Dokument braucht im ungünstigsten
 * Fall rund 4 min (Wiederholungen + 2 Dekodier-Rückfälle), das Limit ist 9 min.
 *
 * @param {object} p
 * @param {(daten: object, opts: {beobachter: Function, id: string}) => Promise<object>} p.lesen leseEinreichung, gebunden
 */
async function nachlauf({
  db, werte, lesen, logger = null,
  jetzt = () => Date.now(), schlafen = schlafenStandard, zufall = Math.random,
  limit = 25, parallel = 2, neueBisMs = 4 * MIN, max429InFolge = 3,
}) {
  const start = jetzt();
  const snap = await db.collection('crowd_uploads').where('namerNachlesenAb', '<=', werte.ts(start)).limit(limit).get();
  const offen = snap.docs.map((d) => d.ref);
  // verworfen = gelesen, aber nicht geschrieben (Fall inzwischen entschieden oder fremd übernommen).
  const bericht = { gefunden: offen.length, gelesen: 0, fehlgeschlagen: 0, verworfen: 0, uebersprungen: 0, fehlerIntern: 0, abbruch: null };
  let mengenlimitInFolge = 0;
  const beobachter = ({ ok, fehler }) => {
    mengenlimitInFolge = !ok && istMengenlimit(fehler) ? mengenlimitInFolge + 1 : 0;
  };

  const arbeiter = async () => {
    for (;;) {
      if (mengenlimitInFolge >= max429InFolge) { bericht.abbruch = 'mengenlimit'; return; }
      if (jetzt() - start > neueBisMs) { bericht.abbruch = 'zeit'; return; }
      const ref = offen.shift();
      if (!ref) return;
      // Versatz, damit beide Arbeiter Gemini nicht im Gleichtakt treffen.
      await schlafen(Math.floor(zufall() * 2000));
      try {
        const anspruch = await nachlaufUebernehmen({ db, ref, jetzt: jetzt(), werte });
        if (anspruch.aktion !== 'uebernehmen') {
          bericht.uebersprungen++;
          continue;
        }
        const ausgang = await lesen(anspruch.daten, { beobachter, id: ref.id });
        const r = await nachlaufAbschliessen({ db, ref, versuch: anspruch.versuch, ausgang, jetzt: jetzt(), werte });
        if (ausgang.art === 'gelesen') bericht.gelesen++;
        else bericht.fehlgeschlagen++;
        if (r.status !== 'geschrieben') bericht.verworfen++;
        if (logger) {
          logger.info('namer-nachlauf: Einreichung', {
            id: ref.id, versuch: anspruch.versuch, ausgang: ausgang.art, schreiben: r.status,
            name: r.ergebnis ? r.ergebnis.name : null, gesendet: ausgang.gesendet, defekt: ausgang.defekt.length,
            fehler: ausgang.fehler ? String(ausgang.fehler.message).slice(0, 120) : null,
          });
        }
      } catch (e) {
        // Anspruch (falls gesetzt) verfällt nach SPERRE_MS; der Versuch ist schon gezählt.
        bericht.fehlerIntern++;
        if (logger) logger.error('namer-nachlauf: Einreichung nicht bearbeitet', { id: ref.id, err: e.message });
      }
    }
  };
  await Promise.all(Array.from({ length: parallel }, arbeiter));
  return bericht;
}

module.exports = {
  WARTEZEITEN_MS,
  MAX_VERSUCH,
  SPERRE_MS,
  LAUF_SPERRE_MS,
  planNachFehlschlag,
  erstlaufUrteil,
  nachlaufUrteil,
  ausgangFelder,
  erstlaufBeginnen,
  erstlaufAbschliessen,
  nachlaufUebernehmen,
  nachlaufAbschliessen,
  nachlauf,
};
