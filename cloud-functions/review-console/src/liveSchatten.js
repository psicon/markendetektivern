'use strict';
/**
 * Produktfoto-Prüfung live — Schritt 1: SCHATTENBETRIEB.
 *
 * Entscheidungen Patrick 05.11.2026 („Ja, so“, „Ja“, „Ja, Schatten selbst“):
 * zwei Wochen Schatten, dann Freigaben live, dann Ablehnungen; die Morgenrunde
 * bleibt als Nachlauf. Neue Konten (jünger als 7 Tage) und Vielreicher (über
 * 20 Einreichungen in 24 h) bleiben in der Morgenrunde (Betrugsschutz).
 * Entwurf: t8-fotopruefung-live.md (§ 1, § 3, § 7). Wissen und Grenzen:
 * WISSEN-FOTORUNDE.md, Abschnitt „Live-Schatten“.
 *
 * WAS DER SCHATTEN TUT
 *   Nach dem Namer (Signal `productNameOcrAt` gesetzt UND kein geplanter
 *   Nachlauf `namerNachlesenAb` — schattenAusloesen) stellt ein Trigger den
 *   Fall in eine Cloud-Tasks-Warteschlange (Takt, Wiederholung). Der Arbeiter
 *   rechnet ihn mit der MORGENRUNDE SELBST (`taeglicheRunde` mit `nurFaelle`):
 *   dieselbe ganze Sammlung, dieselbe Storage-Liste, dieselben Schritte,
 *   dieselben Anweisungen, dasselbe Modell mit denselben Einstellungen — keine
 *   zweite Kopie der Regeln (Fehler vom 20.09., WISSEN-FOTORUNDE.md). Das
 *   Ergebnis legt er in `crowd_live_schatten/{uploadId}` ab.
 * WAS ER NIE TUT
 *   Entscheiden. Kein Statuswechsel, keine Buchung, kein Push, keine Sperre,
 *   kein Schreibvorgang an `crowd_uploads` oder irgendeinem anderen
 *   bestehenden Dokument — `nurFaelle` erzwingt `nurLesen` (kein einziger
 *   Schreibvorgang der Runde). Nachgelesene Angaben bleiben nur im Speicher;
 *   die Morgenrunde liest sie morgens selbst noch einmal (so verdoppeln sich
 *   die Modellaufrufe für zwei Wochen, rund 2,2 €/Tag). Ein Nachlesen gibt es
 *   ohnehin nur, wenn dem Namer eine Angabe fehlt (rettungFuer).
 * WARUM EINE EIGENE SAMMLUNG statt eines Felds am Fall
 *   `crowd_uploads` liest der Einreicher selbst (firestore.rules). Ein Feld
 *   „wäre abgelehnt: Bildschirmfoto“ oder „Betrugsschutz“ am eigenen Dokument
 *   wäre eine Vorwarnung (dieselbe Abwägung wie bei `preisQuelle`,
 *   taeglicheRunde Schritt 7). Ein neues Feld dort bräuchte zudem einen
 *   Eintrag in der Sperrliste der Rules (sonst könnte ein Client es beim
 *   Anlegen vorbelegen) und weckte bei jedem Schreiben alle Trigger auf
 *   `crowd_uploads`. Die eigene Sammlung fällt unter den finalen deny-all —
 *   keine Rules-Änderung, kein Index.
 *
 * Schalter `cashback_config/v1.fotoLive` (wirkt ohne Deploy):
 *   false / fehlt / unbekannt → nichts (kein Auftrag, kein Modellaufruf);
 *   'shadow' → Schatten; true → in diesem Schritt NICHT gebaut, läuft wie
 *   'shadow' und wird gewarnt geloggt (`scharfAngefragt` am Ergebnis).
 */
const crypto = require('crypto');
const { taeglicheRunde } = require('./taeglicheRunde');
const { einreichZeit } = require('./werte');
const { SCHATTEN_COL, LAUF_HAENGT_MS, fehlerCode } = require('./liveSchattenBericht');

const SCHALTER = 'fotoLive';
/**
 * Stichprobe (Kosten, 05.11.2026): `cashback_config/v1.fotoLiveAnteil`, Anteil der
 * Einreichungen 0…1, Standard 0,5 — wirkt ohne Deploy. Deterministisch je ID
 * (inStichprobe); geprüft VOR dem Einstellen: ein Fall außerhalb bekommt keinen
 * Auftrag, kostet also weder Modell noch Lesen. Der Bericht zählt ihn unter `fehlt`.
 */
const SCHALTER_ANTEIL = 'fotoLiveAnteil';
const ANTEIL_STANDARD = 0.5;
/**
 * Betrugsschutz (Entscheidung Patrick 05.11.2026: „Ja“) — EINE Stelle.
 * Solche Fälle simuliert der Schatten nicht, er vermerkt nur, dass sie in der
 * Morgenrunde blieben (`wuerdeMorgenrunde: 'betrugsschutz'`).
 */
const BETRUGSSCHUTZ = Object.freeze({
  /** Konto jünger als so viele Tage (Firebase-Auth `creationTime`) → Morgenrunde. */
  kontoMindestTage: 7,
  /** Mehr als so viele Einreichungen derselben Person in 24 h (inkl. dieser) → Morgenrunde. */
  hoechstensJe24h: 20,
});
const TAG_MS = 24 * 60 * 60 * 1000;
/** Arbeitszeit je Fall: danach beginnt die Runde nichts Neues (Rest = Rückfall „offen“). Function-Timeout 540 s. */
const ARBEITSZEIT_MS = 4 * 60 * 1000;
/** Versuche je Auftrag (Cloud Tasks retryConfig.maxAttempts, index.js). */
const VERSUCHE = 3;
/** Takt der Warteschlange (index.js): so viele Fälle gleichzeitig, so viele je Sekunde. */
// Für die ersten Tage 1 gleichzeitig (Auflage PO 05.11.2026 „kein Risiko für den
// Produktivbetrieb“): kaum Last auf dem Vertex-Kontingent von Namer und Bon-OCR.
// Mehr erst nach Messung — Änderung hier, per Deploy (index.js liest TAKT).
const TAKT = Object.freeze({ gleichzeitig: 1, jeSekunde: 1 });
/** Kosten-Kennung: zusätzlich zum Zweck der Runde, damit die Rechnung den Schatten trennt. */
const KENNUNG_WEG = 'live-schatten';

const ms = (v) => (v && typeof v.toMillis === 'function' ? v.toMillis() : typeof v === 'number' ? v : null);

/** Rohwert des Schalters → Modus. Nur 'shadow' und true schalten ein; true läuft hier als Schatten. */
function fotoLiveModus(roh) {
  if (roh === 'shadow') return { an: true, modus: 'shadow', scharfAngefragt: false, roh };
  if (roh === true) return { an: true, modus: 'shadow', scharfAngefragt: true, roh };
  const unbekannt = roh != null && roh !== false;
  return { an: false, modus: false, scharfAngefragt: false, roh: unbekannt ? String(JSON.stringify(roh)).slice(0, 40) : roh ?? null, unbekannt };
}

/** FNV-1a über die ID, 32 Bit, IMMER unsigned (`>>> 0`) — sonst würden negative Werte die Stichprobe verschieben. */
function hash32(text) {
  let h = 0x811c9dc5;
  const t = String(text);
  for (let i = 0; i < t.length; i++) {
    h ^= t.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** Rohwert von `fotoLiveAnteil` → Anteil 0…1; fehlt er oder ist er keine Zahl in 0…1, gilt der Standard 0,5. */
function anteilVon(roh) {
  return typeof roh === 'number' && Number.isFinite(roh) && roh >= 0 && roh <= 1 ? roh : ANTEIL_STANDARD;
}

/** Nimmt die Einreichung an der Stichprobe teil? hash32(id) mod 1000 < Anteil × 1000. */
function inStichprobe(id, anteil) {
  return hash32(id) % 1000 < Math.round(anteilVon(anteil) * 1000);
}

/** Hat der Namer fertig gelesen — ohne geplanten Nachlauf (crowd-upload-namer src/ablauf.js)? */
function namerFertig(x) {
  return !!x && x.productNameOcrAt != null && x.namerNachlesenAb == null;
}

/**
 * Auslöser: der Fall ist offen und der Namer ist GERADE fertig geworden. Das
 * Ergebnis-Dokument des Schattens liegt in einer anderen Sammlung, löst also
 * nichts erneut aus; jedes spätere Update (Ortsbewertung, Runde) ändert an
 * `namerFertig` nichts mehr.
 */
function schattenAusloesen(vorher, nachher) {
  return !!nachher && nachher.status === 'pending' && namerFertig(nachher) && !namerFertig(vorher);
}

/** Name des Auftrags: je Einreichung genau einer (Cloud Tasks verwirft einen zweiten mit demselben Namen). */
const auftragsName = (id) => `schatten-${crypto.createHash('sha256').update(String(id)).digest('hex').slice(0, 40)}`;

/**
 * Betrugsschutz-Urteil (rein). `kontoErstelltMs` null = Alter unbekannt →
 * Morgenrunde (die vorsichtige Richtung: die Regel hält nur zurück).
 * @returns {{grund:'neues_konto'|'kontoalter_unbekannt'|'vielreicher', kontoTage?:number|null, einreichungen24h?:number}|null}
 */
function betrugsschutzUrteil({ kontoErstelltMs, uploadMs, einreichungen24h }) {
  if (!Number.isFinite(kontoErstelltMs)) return { grund: 'kontoalter_unbekannt', kontoTage: null };
  const tage = (uploadMs - kontoErstelltMs) / TAG_MS;
  if (tage < BETRUGSSCHUTZ.kontoMindestTage) return { grund: 'neues_konto', kontoTage: Math.floor(Math.max(0, tage)) };
  if (einreichungen24h > BETRUGSSCHUTZ.hoechstensJe24h) return { grund: 'vielreicher', einreichungen24h };
  return null;
}

/**
 * Einreichungen derselben Person in den 24 h bis zu dieser (Server-Zeitpunkt,
 * werte.einreichZeit — wie die Regeln). Einzelfeld-Abfrage auf `userId`
 * (Standard-Index, die Prüfkonsole nutzt sie schon).
 */
async function einreichungen24h(db, uid, uploadMs) {
  const q = await db.collection('crowd_uploads').where('userId', '==', uid).get();
  return q.docs.filter((d) => {
    const t = einreichZeit(d.data(), d.createTime);
    return t != null && t > uploadMs - TAG_MS && t <= uploadMs;
  }).length;
}

/**
 * Derselbe Gemini-Client, nur gemessen: Aufrufe und Dauer. Anfrage, Modell,
 * Anweisungen, temperature und thinkingLevel bleiben unberührt — nur die
 * Kosten-Kennung bekommt `weg: live-schatten` dazu.
 */
function messendeKi(ai, messung) {
  return {
    models: {
      generateContent: async (anfrage) => {
        const t = Date.now();
        messung.aufrufe++;
        try {
          const config = anfrage && anfrage.config ? anfrage.config : {};
          return await ai.models.generateContent({ ...anfrage, config: { ...config, labels: { ...(config.labels || {}), weg: KENNUNG_WEG } } });
        } finally {
          messung.ms += Date.now() - t;
        }
      },
    },
  };
}

/** Plan-Eintrag der Runde → Ergebnis des Schattens (nur Codes, keine Texte mit Nummern oder Namen). */
function ergebnisAusPlan(e) {
  const ergebnis = e.entscheidung;
  // Technischer Rückfall (Prüfrunde 05.11.2026): Bildprüfung oder Nachlesung an
  // unserer Technik gescheitert (429, Zeitgrenze, Datei). Nur Codes — der
  // Abgleich zählt solche Fälle getrennt von Regel-Ergebnissen.
  const rf = (e.eingabe && e.eingabe.rettungFehler) || {};
  const nachlesen = Object.entries(rf).filter(([, v]) => v && v !== 'lesungen_uneinig').map(([k]) => k).sort();
  const technisch = e.auditFehler || nachlesen.length
    ? { ...(e.auditFehler ? { bildpruefung: fehlerCode(e.auditFehler) } : {}), ...(nachlesen.length ? { nachlesen } : {}) }
    : null;
  return {
    technisch,
    ergebnis,
    grund: e.grund || null,
    zurueckgehalten: e.zurueckgehalten || null,
    zweifel: Array.isArray(e.zweifel) && e.zweifel.length ? e.zweifel : null,
    loseWare: !!e.loseWare,
    // Was in Schritt 2 („Freigaben live“) geschähe: nur Freigaben live, alles andere morgens.
    wuerdeLive: ergebnis === 'freigeben',
    wuerdeMorgenrunde: ergebnis === 'freigeben' ? null : ergebnis === 'ablehnen' ? 'ablehnung' : 'offen',
  };
}

/** Schalter der Runde aus EINEM Lesen von cashback_config/v1 — wie index.js (fotoRundeTaeglich). */
const rundeSchalter = (cfg) => ({
  preisBildschirmRegel: cfg.preisBildschirmRegel ?? null, preisBelegRegel: cfg.preisBelegRegel ?? null,
  barcodeKorrektur: cfg.barcodeKorrektur ?? null, haushaltRegel: cfg.haushaltRegel ?? null, zweifelFreigabe: cfg.zweifelFreigabe ?? null,
});

/**
 * Den Fall übernehmen — in einer Transaktion, nur am eigenen Dokument.
 * Doppelte Zustellung (Cloud Tasks „mindestens einmal“, ein zweiter
 * Trigger-Lauf): ist der Fall fertig, nichts; läuft gerade ein anderer Lauf,
 * nichts; hängt ein Lauf länger als LAUF_HAENGT_MS oder scheiterte er,
 * übernimmt dieser. Eine Wiederholung DESSELBEN Auftrags (höherer Versuch)
 * übernimmt sofort: Cloud Tasks wiederholt erst, wenn der vorige Versuch
 * vorbei ist (Frist 600 s > Laufzeitgrenze 540 s) — sonst bliebe ein Fall nach
 * einem Abbruch an der Laufzeitgrenze für immer auf `laeuft`.
 * @returns {Promise<{art:'weg'|'fertig'|'laeuft'|'uebernommen', x?:object, uploadMs?:number|null}>}
 */
async function uebernehmen(db, id, { lauf, versuch, auftrag, jetzt, werte }) {
  // Die Einreichung AUSSERHALB der Transaktion lesen (Prüfrunde 05.11.2026): ein
  // Lesen in der Transaktion sperrt das Dokument, und der Schatten soll keine
  // Transaktion von Runde, Namer, Konsole oder Vergütung aufhalten.
  const u = await db.collection('crowd_uploads').doc(id).get();
  if (!u.exists) return { art: 'weg' };
  const ref = db.collection(SCHATTEN_COL).doc(id);
  return db.runTransaction(async (tx) => {
    const s = await tx.get(ref);
    const alt = s.exists ? s.data() : null;
    if (alt && alt.status === 'fertig') return { art: 'fertig' };
    const wiederholung = !!(alt && auftrag && alt.auftrag === auftrag && versuch > (Number(alt.versuch) || 0));
    if (alt && alt.status === 'laeuft' && !wiederholung && jetzt - (Number(alt.startedMs) || 0) < LAUF_HAENGT_MS) return { art: 'laeuft' };
    const x = u.data();
    const uploadMs = einreichZeit(x, u.createTime);
    tx.set(ref, {
      status: 'laeuft', lauf, versuch, auftrag: auftrag || null,
      startedAt: werte.stamp(), startedMs: jetzt, uploadMs: uploadMs ?? null,
      ...(alt ? { vorherigerLauf: { lauf: alt.lauf || null, status: alt.status || null, fehler: alt.fehler || null } } : {}),
    });
    return { art: 'uebernommen', x, uploadMs };
  });
}

/** Ergebnis schreiben — nur, wenn der Fall noch diesem Lauf gehört. */
async function abschliessen(db, id, lauf, felder) {
  const ref = db.collection(SCHATTEN_COL).doc(id);
  return db.runTransaction(async (tx) => {
    const s = await tx.get(ref);
    if (!s.exists || s.data().lauf !== lauf) return 'fremd';
    tx.set(ref, felder, { merge: true });
    return 'geschrieben';
  });
}

/**
 * Einen Fall im Schatten rechnen. Abhängigkeiten werden hereingereicht
 * (Tests, Emulator); `runde` ist im Betrieb immer die Morgenrunde selbst.
 *
 * @param {object} o
 * @param {object} o.db  Firestore (Admin)
 * @param {string} o.id  Einreichung (crowd_uploads/{id})
 * @param {string} o.projekt
 * @param {string} [o.bucketName]
 * @param {object} o.ai  Gemini-Client (Vertex „global“, wie die Runde)
 * @param {(uid:string)=>Promise<number|null>} o.kontoErstellt  Erstellzeitpunkt des Kontos (ms) oder null
 * @param {number} [o.versuch]  0 = erster Versuch (Cloud Tasks retryCount)
 * @param {string} [o.auftrag]  Kennung des Auftrags (Cloud Tasks)
 * @param {object} o.werte  { stamp: () => serverTimestamp }
 * @param {object} [o.logger]
 * @param {Function} [o.runde]  Vorgabe: taeglicheRunde
 * @param {() => number} [o.uhr]
 * @returns {Promise<{status:string, ergebnis?:string}>}
 */
async function schattenFall({ db, id, projekt, bucketName, ai, kontoErstellt, versuch = 0, auftrag = null, werte, logger = null, runde = taeglicheRunde, uhr = Date.now }) {
  const cfg = (await db.doc('cashback_config/v1').get()).data() || {};
  const modus = fotoLiveModus(cfg[SCHALTER]);
  if (!modus.an) return { status: 'aus' };
  if (modus.scharfAngefragt && logger) logger.warn('fotoLive=true ist in Schritt 1 nicht gebaut — der Fall läuft als Schatten', { id });

  const start = uhr();
  const lauf = `schatten_${start.toString(36)}_${crypto.randomBytes(3).toString('hex')}`;
  const a = await uebernehmen(db, id, { lauf, versuch, auftrag, jetzt: start, werte });
  if (a.art !== 'uebernommen') return { status: a.art };

  const basis = { modus: modus.modus, scharfAngefragt: modus.scharfAngefragt };
  const fertig = async (felder) => {
    const ende = uhr();
    const status = await abschliessen(db, id, lauf, {
      ...basis, ...felder, status: 'fertig', fertigAt: werte.stamp(), fertigMs: ende,
      dauerMs: ende - start, gesamtMs: a.uploadMs != null ? ende - a.uploadMs : null,
    });
    return { status: status === 'geschrieben' ? 'fertig' : status, ergebnis: felder.ergebnis };
  };

  try {
    if (a.x.status !== 'pending') return await fertig({ ergebnis: 'schon_entschieden', grund: String(a.x.status || '?') });
    // Betrugsschutz vor jedem Modellaufruf: solche Fälle bleiben in der Morgenrunde.
    const uid = a.x.userId || null;
    let kontoMs = null;
    try { kontoMs = uid ? await kontoErstellt(uid) : null; } catch (e) { kontoMs = null; }
    const anzahl = uid ? await einreichungen24h(db, uid, a.uploadMs ?? start) : 0;
    const schutz = betrugsschutzUrteil({ kontoErstelltMs: kontoMs, uploadMs: a.uploadMs ?? start, einreichungen24h: anzahl });
    if (schutz) {
      return await fertig({ ergebnis: 'betrugsschutz', grund: schutz.grund, wuerdeLive: false, wuerdeMorgenrunde: 'betrugsschutz', betrugsschutz: schutz });
    }

    const messung = { aufrufe: 0, ms: 0 };
    const r = await runde({
      projekt, bucketName, ausloeser: 'live-schatten', nurFaelle: [id], arbeitszeitMs: ARBEITSZEIT_MS,
      ai: messendeKi(ai, messung), ...rundeSchalter(cfg),
    });
    const e = (r.plan || []).find((p) => p.id === id);
    // Nicht im Plan: inzwischen entschieden oder gelöscht (die Runde lädt neu).
    if (!e) return await fertig({ ergebnis: 'schon_entschieden', grund: 'nicht_offen_beim_laden', regelVersion: r.regelVersion || null, modelMs: messung.ms, modellAufrufe: messung.aufrufe });
    return await fertig({ ...ergebnisAusPlan(e), regelVersion: r.regelVersion || null, modelMs: messung.ms, modellAufrufe: messung.aufrufe, ...(r.zeiten ? { ladeMs: r.zeiten.ladeMs, listeMs: r.zeiten.listeMs } : {}) });
  } catch (err) {
    // Am Dokument nur ein Code — ein Firestore-Fehlertext kann Pfade mit der uid tragen.
    const fehler = fehlerCode(err);
    if (logger) logger.warn('Live-Schatten: Fall nicht gerechnet', { id, versuch, fehler, text: String((err && err.message) || err).slice(0, 160) });
    await abschliessen(db, id, lauf, { status: 'fehler', fehler, fehlerMs: uhr(), versuch }).catch(() => null);
    // Cloud Tasks wiederholt, solange Versuche übrig sind; der letzte bleibt als Fehler stehen.
    if (versuch < VERSUCHE - 1) throw err;
    return { status: 'fehler' };
  }
}

/**
 * Trigger-Seite: prüft den Übergang und stellt den Auftrag ein. Der Schalter
 * wird erst gelesen, wenn der Übergang passt (der Trigger läuft bei JEDEM
 * Update einer Einreichung). Ein zweiter Auftrag derselben Einreichung wird
 * von Cloud Tasks verworfen (`task-already-exists`) — kein Fehler.
 * @returns {Promise<'kein_uebergang'|'aus'|'ausserhalb_stichprobe'|'eingestellt'|'schon_eingestellt'>}
 */
async function ausloeserFall({ db, id, vorher, nachher, einstellen, logger = null }) {
  if (!schattenAusloesen(vorher, nachher)) return 'kein_uebergang';
  let cfg = {};
  try { cfg = (await db.doc('cashback_config/v1').get()).data() || {}; } catch (e) {
    if (logger) logger.warn('Live-Schatten: Schalter nicht lesbar — kein Auftrag', { id, fehler: String(e && e.message).slice(0, 120) });
    return 'aus';
  }
  const modus = fotoLiveModus(cfg[SCHALTER]);
  if (!modus.an) {
    if (modus.unbekannt && logger) logger.warn('Live-Schatten: unbekannter Wert von fotoLive — gilt als aus', { roh: modus.roh });
    return 'aus';
  }
  if (!inStichprobe(id, cfg[SCHALTER_ANTEIL])) return 'ausserhalb_stichprobe';
  try {
    await einstellen({ id }, auftragsName(id));
    return 'eingestellt';
  } catch (e) {
    if (e && (e.code === 'functions/task-already-exists' || /already exists/i.test(String(e.message)))) return 'schon_eingestellt';
    throw e;
  }
}

module.exports = {
  SCHALTER, SCHALTER_ANTEIL, ANTEIL_STANDARD, hash32, anteilVon, inStichprobe, BETRUGSSCHUTZ, ARBEITSZEIT_MS, LAUF_HAENGT_MS, VERSUCHE, TAKT, KENNUNG_WEG,
  fotoLiveModus, namerFertig, schattenAusloesen, auftragsName, betrugsschutzUrteil, einreichungen24h,
  messendeKi, ergebnisAusPlan, rundeSchalter, uebernehmen, abschliessen, schattenFall, ausloeserFall,
};
