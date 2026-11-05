'use strict';

/**
 * Nachlauf der Bon-Artikel-Zuordnung (08.10.2026).
 *
 * Anlass: Mit dem Zeitlimit im Matcher endet eine Zeile, deren Gemini-Pick,
 * Einbettung oder Vektorsuche hängt, jetzt geplant mit einem eindeutigen
 * Fehlercode ('pick-timeout', 'pick-429', 'shortlist-timeout', 'embed-failed').
 * Die Zeile trägt danach aber `matchVersion`, und alle drei Leser überspringen
 * sie: der Trigger feuert nur beim Anlegen, matchReceiptManual und
 * matchBacklogManual nur mit force. Ohne Nachlauf blieben diese Zeilen für
 * immer ohne Zuordnung, obwohl nur Vertex kurz langsam war.
 *
 * `matchVersion` wegzulassen wäre falsch: dann nähme matchReceiptManual (ohne
 * noClose) die Zeile auf und könnte heutige Einkaufszettel-Einträge zu einem
 * alten Bon abhaken.
 *
 * Ablauf:
 *  • Der Matcher legt beim Schreiben eines solchen Fehlers im SELBEN Batch einen
 *    Eintrag `receiptMatchNachlauf/{uid}__{ppId}` an (`planeNachlauf`).
 *  • `nachlauf()` läuft alle 15 Minuten, nimmt fällige Einträge, übernimmt sie
 *    per Transaktion und ordnet die Zeile neu zu — IMMER mit noClose (kein
 *    nachträgliches Abhaken von Einkaufszetteln), mit dem Alias-Lexikon (hat
 *    inzwischen eine andere Zeile den Begriff gelernt, ist der Nachlauf gratis).
 *  • Wartezeiten 15 min → 1 h → 6 h. Danach `matchNachlauf: 'erschoepft'` am
 *    Dokument, der Eintrag verschwindet.
 *
 * Warum eine eigene Collection statt eines Felds an purchased_products: die
 * Abfrage über alle Nutzer bräuchte einen Sammel-Index (collection group) auf
 * dem Feld. Live gibt es für purchased_products nur den auf `normKey`
 * (gemessen 08.10.2026). Eine Abfrage auf einem Feld einer normalen Collection
 * hat ihren Index automatisch.
 *
 * Der Zähler `versuche` steigt beim ÜBERNEHMEN (wie beim Namer-Nachlauf):
 * stirbt ein Lauf mitten in der Zeile, zählt der Versuch trotzdem, und eine
 * Zeile, die die Funktion immer wieder abstürzen lässt, kreist nicht ewig.
 * `planeNachlauf` schreibt den Zähler nie, er kann also auch durch ein
 * erneutes Scheitern auf einem Hand-Endpunkt nicht zurückgesetzt werden.
 *
 * Altbestand (Prüfbefund 08.10.2026): Bis zu diesem Stand schrieb der Matcher
 * JEDEN Pick-Fehler, auch jeden Zeitabbruch der Störung ab 01.10., als
 * 'pick-failed' — ohne `pickAttempts`, das erst der neue Code mitschreibt.
 * 'pick-failed' steht bewusst nicht in NACHLAUF_GRUENDE (beim neuen Code heißt
 * er „Anfrage selbst falsch“, z. B. 400). Diese alten Zeilen entstehen nie von
 * selbst als Eintrag; sie plant nur das Einmal-Skript
 * `.nachlauf-altbestand-0810.js` (Trockenlauf Standard, schreibt nur mit
 * SCHREIBEN=1 — ob es schreibend läuft, entscheidet Patrick). Seine Einträge
 * tragen `altbestand: true`; nur für sie nimmt `nachlaufUrteil` auch die
 * Arten aus `altbestandArt` an. Dieselbe Funktion wählt im Skript die Zeilen
 * aus — eine Regel, zwei Leser. Zeilen ohne `matchVersion` NIE über
 * matchReceiptManual nachholen: dort fehlt noClose.
 *
 * Firestore, Uhr und matchLine werden hereingereicht, damit die Regeln ohne
 * firebase-admin testbar sind.
 */

const NACHLAUF_COLLECTION = 'receiptMatchNachlauf';

/** Fehlercodes, bei denen ein späterer Versuch Aussicht hat (alles Zeit/Kontingent). */
const NACHLAUF_GRUENDE = Object.freeze(new Set(['pick-timeout', 'pick-429', 'shortlist-timeout', 'embed-failed']));

const MIN = 60 * 1000;
/** Wartezeit nach dem gescheiterten Versuch Nr. n (Index n; 0 = Trigger/Hand-Endpunkt). */
const WARTEZEITEN_MS = Object.freeze([15 * MIN, 60 * MIN, 360 * MIN]);
/** Höchstzahl der Nachlauf-Versuche je Zeile (nach Trigger + 3 Nachläufen ist Schluss). */
const MAX_NACHLAEUFE = WARTEZEITEN_MS.length;
/** So lange hält ein begonnener Nachlauf-Versuch den Eintrag (> 540 s Function-Limit). */
const SPERRE_MS = 20 * MIN;

/** Laufgrenzen eines Durchgangs (Function-Timeout 540 s). */
const LAUF_ZEIT_MS = 540_000;
const LAUF_RESERVE_MS = 30_000; // Bericht + Kaltstart
/** Höchstdauer einer Zeile (= ZEILEN_BUDGET_MS im Matcher). */
const ZEILE_MAX_MS = 100_000;
/** Darunter beginnt der Durchgang keine Zeile mehr (Einbettung + ein Pick-Versuch). */
const ZEILE_MIN_REST_MS = 40_000;
/** Zeilen je Durchgang. Nacheinander, also höchstens ein Gemini-Aufruf gleichzeitig. */
const LAUF_MAX_ZEILEN = 40;
/** So viele erneute Zeit-/Kontingentfehler in Folge → Vertex ist krank, Durchgang endet. */
const FEHLER_IN_FOLGE_STOPP = 3;

/** Takt der geplanten Funktion matchNachlauf (index.js, '*\/15 * * * *'). */
const TAKT_MS = 15 * MIN;
/**
 * Altbestand-Einträge je Takt fällig (Skript .nachlauf-altbestand-0810.js).
 * Kleiner als LAUF_MAX_ZEILEN, damit frische Fehler im selben Durchgang Platz
 * haben und der Altbestand den Nachlauf nicht über Stunden verstopft.
 */
const ALTBESTAND_JE_TAKT = 20;

/** Arten von Altbestand-Zeilen, die nur ein Altbestand-Eintrag nachholt. */
const ALTBESTAND_ART = Object.freeze({
  // alter Code: jeder Pick-Fehler (auch Zeitabbruch) als 'pick-failed', ohne pickAttempts
  PICK_FAILED_ALT: 'pick-failed-alt',
  // nie fertig geschrieben: weder Status noch matchVersion (Lauf vorher beendet)
  OHNE_STAND: 'ohne-stand',
  // Ausnahme im Trigger (index.js catch: matchError = Fehlertext, keine matchVersion)
  TRIGGER_AUSNAHME: 'trigger-ausnahme',
});

const PP_PFAD = /^users\/([^/]+)\/purchased_products\/([^/]+)$/;

const tsMs = (v) => {
  if (v == null) return null;
  if (typeof v.toMillis === 'function') return v.toMillis();
  if (v instanceof Date) return v.getTime();
  if (typeof v === 'number') return v;
  return null;
};

/** `{ uid, ppId }` aus `users/{uid}/purchased_products/{ppId}` — sonst null. */
function pfadTeile(ppPath) {
  const m = PP_PFAD.exec(String(ppPath || ''));
  return m ? { uid: m[1], ppId: m[2] } : null;
}

/** Doc-ID des Nachlauf-Eintrags zu `users/{uid}/purchased_products/{ppId}` — sonst null. */
function nachlaufDocId(ppPath) {
  const t = pfadTeile(ppPath);
  return t ? `${t.uid}__${t.ppId}` : null;
}

/**
 * Ist diese Bon-Zeile Altbestand, den nur ein Altbestand-Eintrag nachholt?
 * Pure Funktion; liefert eine Art aus ALTBESTAND_ART oder null. Nicht
 * vergütete Bons (rewardEligible === false) nie — der Trigger ordnet sie auch
 * nicht zu (86caf62v6).
 */
function altbestandArt(pp) {
  if (!pp || typeof pp !== 'object') return null;
  if (pp.rewardEligible === false) return null;
  if (pp.matchStatus === 'error' && pp.matchError === 'pick-failed' && pp.pickAttempts == null) return ALTBESTAND_ART.PICK_FAILED_ALT;
  if (pp.matchVersion == null) {
    if (pp.matchStatus == null) return ALTBESTAND_ART.OHNE_STAND;
    if (pp.matchStatus === 'error') return ALTBESTAND_ART.TRIGGER_AUSNAHME;
  }
  return null;
}

/**
 * Eintrag für eine Altbestand-Zeile (Einmal-Skript). Pure Funktion.
 * Fälligkeit verteilt: Nr. `index` wird im Takt floor(index / ALTBESTAND_JE_TAKT)
 * fällig. Kein `versuche` (drei Nachläufe wie jede andere Zeile).
 * @param {object} p
 * @param {string} p.ppPath
 * @param {object} p.pp        aktuelle Daten der Zeile
 * @param {number} p.index     laufende Nummer im Skriptlauf
 * @param {number} p.jetzt     ms
 * @param {Set<string>} [p.arten] erlaubte Arten (Standard: nur PICK_FAILED_ALT)
 * @returns {null | {art, docId, daten, ppFelder}}
 */
function planeAltbestand({ ppPath, pp, index = 0, jetzt, arten = new Set([ALTBESTAND_ART.PICK_FAILED_ALT]) }) {
  const art = altbestandArt(pp);
  if (!art || !arten.has(art)) return null;
  const teile = pfadTeile(ppPath);
  if (!teile) return null;
  const takt = Math.floor((Number.isInteger(index) && index > 0 ? index : 0) / ALTBESTAND_JE_TAKT);
  return {
    art,
    docId: `${teile.uid}__${teile.ppId}`,
    daten: {
      uid: teile.uid,
      ppId: teile.ppId,
      ppPath,
      matchError: pp.matchError || null,
      altbestand: true,
      altArt: art,
      naechsterAt: new Date(jetzt + takt * TAKT_MS),
      laufBis: null,
      aktualisiertAt: new Date(jetzt),
    },
    ppFelder: { matchNachlauf: 'geplant' },
  };
}

/**
 * Was soll nach einem Fehler einer Zeile geschehen? Pure Funktion.
 * @param {object} p
 * @param {string} p.ppPath   Pfad der Bon-Zeile
 * @param {string} p.matchError Fehlercode am Dokument
 * @param {number} p.versuch  Nummer des gerade gescheiterten Nachlaufs (0 = Trigger/Hand-Endpunkt)
 * @param {number} p.jetzt    ms
 * @returns {null | {aktion:'planen', docId, daten, ppFelder} | {aktion:'erschoepft', docId, ppFelder}}
 *   null = kein Nachlauf (Fehler nicht wiederholbar oder Pfad unbekannt).
 */
function planeNachlauf({ ppPath, matchError, versuch = 0, jetzt }) {
  if (!NACHLAUF_GRUENDE.has(matchError)) return null;
  const teile = pfadTeile(ppPath);
  if (!teile) return null;
  const docId = `${teile.uid}__${teile.ppId}`;
  const n = Number.isInteger(versuch) && versuch > 0 ? versuch : 0;
  if (n >= MAX_NACHLAEUFE) {
    return { aktion: 'erschoepft', docId, ppFelder: { matchNachlauf: 'erschoepft' } };
  }
  // Aus dem Pfad, nicht aus docId.split('__'): eine ppId mit '__' würde sonst gekürzt.
  const { uid, ppId } = teile;
  return {
    aktion: 'planen',
    docId,
    // Kein `versuche` hier (siehe Kopf). laufBis: null gibt einen Anspruch frei.
    daten: {
      uid,
      ppId,
      ppPath,
      matchError,
      naechsterAt: new Date(jetzt + WARTEZEITEN_MS[n]),
      laufBis: null,
      aktualisiertAt: new Date(jetzt),
    },
    ppFelder: { matchNachlauf: 'geplant' },
  };
}

/**
 * Darf der Nachlauf diesen Eintrag jetzt übernehmen? Pure Funktion.
 * @returns {{aktion:'weg'|'nicht_faellig'|'gesperrt'} | {aktion:'raeumen', grund} | {aktion:'erschoepft'} | {aktion:'uebernehmen', versuch}}
 */
function nachlaufUrteil(eintrag, pp, jetzt) {
  if (!eintrag) return { aktion: 'weg' };
  const faellig = tsMs(eintrag.naechsterAt);
  if (faellig == null || faellig > jetzt) return { aktion: 'nicht_faellig' };
  const laufBis = tsMs(eintrag.laufBis);
  if (laufBis != null && laufBis > jetzt) return { aktion: 'gesperrt' };
  if (!pp) return { aktion: 'raeumen', grund: 'zeile_fehlt' };
  const zeitFehler = pp.matchStatus === 'error' && NACHLAUF_GRUENDE.has(pp.matchError);
  // Altbestand nur über einen ausdrücklich so geplanten Eintrag (Kopf).
  const altOffen = eintrag.altbestand === true && altbestandArt(pp) !== null;
  if (!zeitFehler && !altOffen) return { aktion: 'raeumen', grund: 'erledigt' };
  // Nicht vergütete Bons ordnet der Trigger nicht zu (receiptMatch-Schutz,
  // 86caf62v6); der Nachlauf ebenso wenig.
  if (pp.rewardEligible === false) return { aktion: 'raeumen', grund: 'nicht_verguetet' };
  const versuch = (Number(eintrag.versuche) || 0) + 1;
  if (versuch > MAX_NACHLAEUFE) return { aktion: 'erschoepft' };
  return { aktion: 'uebernehmen', versuch };
}

/** Eintrag übernehmen (Transaktion). Räumt erledigte und erschöpfte Fälle aus der Abfrage. */
async function nachlaufUebernehmen({ db, ref, jetzt }) {
  return db.runTransaction(async (tx) => {
    const s = await tx.get(ref);
    const eintrag = s.exists ? s.data() : null;
    const ppRef = eintrag && eintrag.ppPath ? db.doc(eintrag.ppPath) : null;
    const ppSnap = ppRef ? await tx.get(ppRef) : null;
    const pp = ppSnap && ppSnap.exists ? ppSnap.data() : null;
    const urteil = nachlaufUrteil(eintrag, pp, jetzt);
    if (urteil.aktion === 'raeumen') {
      tx.delete(ref);
    } else if (urteil.aktion === 'erschoepft') {
      tx.delete(ref);
      if (pp) tx.set(ppRef, { matchNachlauf: 'erschoepft' }, { merge: true });
    } else if (urteil.aktion === 'uebernehmen') {
      const laufBis = new Date(jetzt + SPERRE_MS);
      tx.update(ref, { versuche: urteil.versuch, laufBis, aktualisiertAt: new Date(jetzt) });
      return { ...urteil, laufBisMs: laufBis.getTime(), eintrag, pp, ppRef };
    }
    return urteil;
  });
}

/**
 * Nach dem Versuch: Eintrag entfernen — nur, wenn der Anspruch noch uns
 * gehört (ein Hand-Endpunkt kann die Zeile inzwischen neu geplant haben).
 */
async function nachlaufEntfernen({ db, ref, laufBisMs }) {
  return db.runTransaction(async (tx) => {
    const s = await tx.get(ref);
    if (!s.exists) return 'weg';
    if (tsMs(s.data().laufBis) !== laufBisMs) return 'fremd';
    tx.delete(ref);
    return 'entfernt';
  });
}

/**
 * matchLine hat geworfen (kein Fehlercode am Dokument): Anspruch freigeben und
 * mit derselben Wartezeit neu planen; nach dem letzten Versuch erschöpft.
 */
async function nachlaufNachAusnahme({ db, ref, laufBisMs, versuch, jetzt }) {
  return db.runTransaction(async (tx) => {
    const s = await tx.get(ref);
    if (!s.exists) return 'weg';
    const eintrag = s.data();
    if (tsMs(eintrag.laufBis) !== laufBisMs) return 'fremd';
    if (versuch >= MAX_NACHLAEUFE) {
      tx.delete(ref);
      if (eintrag.ppPath) tx.set(db.doc(eintrag.ppPath), { matchNachlauf: 'erschoepft' }, { merge: true });
      return 'erschoepft';
    }
    tx.update(ref, { naechsterAt: new Date(jetzt + WARTEZEITEN_MS[versuch]), laufBis: null, aktualisiertAt: new Date(jetzt) });
    return 'neu_geplant';
  });
}

/** Kontext für matchLine aus der gespeicherten Bon-Zeile — wie im Trigger. */
function zeilenKontext(pp, ppRef, uid) {
  return {
    itemName: pp.itemName,
    marktSlug: pp.merchantId,
    priceCents: pp.priceCents || 0,
    userId: uid,
    receiptId: pp.receiptId || null,
    ppRef,
    merchantName: pp.merchantName || null,
    merchantLand: pp.merchantLand || null,
    bonDate: pp.bonDate || null,
  };
}

/**
 * Ein Durchgang. Nacheinander, höchstens `limit` fällige Einträge, älteste
 * zuerst. Endet früher, wenn die Restzeit für eine Zeile nicht mehr reicht oder
 * `FEHLER_IN_FOLGE_STOPP` Zeilen in Folge wieder an Zeit/Kontingent scheitern
 * (der Rest bleibt fällig für den nächsten Durchgang, ohne Versuch zu verbrauchen).
 *
 * @param {object} p
 * @param {Function} p.matchLine matcher.matchLine
 */
async function nachlauf({ db, matchLine, logger = null, jetzt = () => Date.now(), limit = LAUF_MAX_ZEILEN, laufEndeAt = null }) {
  const start = jetzt();
  const ende = Number.isFinite(laufEndeAt) ? laufEndeAt : start + LAUF_ZEIT_MS - LAUF_RESERVE_MS;
  const snap = await db
    .collection(NACHLAUF_COLLECTION)
    .where('naechsterAt', '<=', new Date(start))
    .orderBy('naechsterAt')
    .limit(limit)
    .get();
  const bericht = {
    gefunden: snap.docs.length,
    versucht: 0,
    gerettet: 0, // Zuordnung oder sonstiger fertiger Status (needs_review, unmapped …)
    erneutFehler: 0, // wieder Zeit/Kontingent → neu geplant oder erschöpft
    endgueltigFehler: 0, // anderer Fehler (z. B. 400) → kein weiterer Nachlauf
    erschoepft: 0,
    geraeumt: 0,
    uebersprungen: 0,
    fehlerIntern: 0,
    abbruch: null,
    status: {},
  };
  let fehlerInFolge = 0;

  for (const doc of snap.docs) {
    if (fehlerInFolge >= FEHLER_IN_FOLGE_STOPP) {
      bericht.abbruch = 'fehlerserie';
      break;
    }
    if (ende - jetzt() < ZEILE_MIN_REST_MS) {
      bericht.abbruch = 'zeit';
      break;
    }
    const ref = doc.ref;
    let anspruch = null;
    try {
      anspruch = await nachlaufUebernehmen({ db, ref, jetzt: jetzt() });
      if (anspruch.aktion === 'raeumen') {
        bericht.geraeumt++;
        continue;
      }
      if (anspruch.aktion === 'erschoepft') {
        bericht.erschoepft++;
        continue;
      }
      if (anspruch.aktion !== 'uebernehmen') {
        bericht.uebersprungen++;
        continue;
      }
      bericht.versucht++;
      const uid = anspruch.eintrag.uid || (PP_PFAD.exec(anspruch.eintrag.ppPath) || [])[1] || null;
      const deadlineAt = Math.min(jetzt() + ZEILE_MAX_MS, ende);
      const r = await matchLine(zeilenKontext(anspruch.pp, anspruch.ppRef, uid), {
        // NIE abhaken: der Bon ist beim Nachlauf mindestens 15 min alt, ein
        // inzwischen neu auf den Zettel gesetzter Artikel wäre sonst weg.
        noClose: true,
        deadlineAt,
        nachlaufVersuch: anspruch.versuch,
      });
      const status = r && r.status ? r.status : 'unbekannt';
      bericht.status[status] = (bericht.status[status] || 0) + 1;
      if (status === 'error' && NACHLAUF_GRUENDE.has(r.reason)) {
        // matchLine hat im selben Batch neu geplant bzw. als erschöpft markiert.
        bericht.erneutFehler++;
        if (anspruch.versuch >= MAX_NACHLAEUFE) bericht.erschoepft++;
        fehlerInFolge++;
      } else {
        if (status === 'error') bericht.endgueltigFehler++;
        else bericht.gerettet++;
        fehlerInFolge = 0;
        await nachlaufEntfernen({ db, ref, laufBisMs: anspruch.laufBisMs });
      }
      if (logger) {
        logger.info('zuordnung-nachlauf: Zeile', {
          ppPath: anspruch.eintrag.ppPath,
          versuch: anspruch.versuch,
          vorher: anspruch.pp.matchError,
          status,
          reason: (r && r.reason) || null,
        });
      }
    } catch (e) {
      bericht.fehlerIntern++;
      fehlerInFolge++;
      if (logger) logger.error('zuordnung-nachlauf: Zeile nicht bearbeitet', { id: ref.id, err: e.message });
      if (anspruch && anspruch.aktion === 'uebernehmen') {
        await nachlaufNachAusnahme({ db, ref, laufBisMs: anspruch.laufBisMs, versuch: anspruch.versuch, jetzt: jetzt() }).catch((e2) => {
          // Anspruch verfällt nach SPERRE_MS; der Versuch ist schon gezählt.
          if (logger) logger.error('zuordnung-nachlauf: Neuplanung gescheitert', { id: ref.id, err: e2.message });
        });
      }
    }
  }
  return bericht;
}

module.exports = {
  NACHLAUF_COLLECTION,
  NACHLAUF_GRUENDE,
  WARTEZEITEN_MS,
  MAX_NACHLAEUFE,
  SPERRE_MS,
  LAUF_ZEIT_MS,
  LAUF_RESERVE_MS,
  ZEILE_MAX_MS,
  ZEILE_MIN_REST_MS,
  LAUF_MAX_ZEILEN,
  FEHLER_IN_FOLGE_STOPP,
  TAKT_MS,
  ALTBESTAND_JE_TAKT,
  ALTBESTAND_ART,
  nachlaufDocId,
  pfadTeile,
  altbestandArt,
  planeAltbestand,
  planeNachlauf,
  nachlaufUrteil,
  nachlaufUebernehmen,
  nachlaufEntfernen,
  nachlaufNachAusnahme,
  zeilenKontext,
  nachlauf,
};
