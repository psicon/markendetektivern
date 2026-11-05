'use strict';
/**
 * Live-Schatten gegen Morgenrunde — der Abgleich im Tagesbericht
 * (Entscheidung Patrick 05.11.2026: „Ja, so“ — zwei Wochen Schatten, dann
 * Freigaben live, dann Ablehnungen). Grundlage für den Schritt „Freigaben live“.
 *
 * Rein lesend und rein rechnend: die Morgenrunde ruft das NACH allen
 * Entscheidungen auf, kurz vor dem Bericht. Ein Lesefehler kostet höchstens
 * diesen Teil des Berichts (`unlesbar`), nie den Bericht oder eine
 * Entscheidung.
 *
 * Datenschutz (Entwurf t8 § 5): nur Zahlen, Gründe und gehashte
 * Fall-Kennungen — keine Nutzer-ID, keine Produktnamen, keine Fotos. Die
 * Einreichungs-ID beginnt mit der uid, deshalb nur ihr Hash (`fallKennung`).
 *
 * Wer schreibt was: src/liveSchatten.js legt je Einreichung genau ein Dokument
 * in `crowd_live_schatten/{uploadId}` an (server-only, finaler deny-all der
 * Rules). Hier wird nur gelesen.
 */
const crypto = require('crypto');

const SCHATTEN_COL = 'crowd_live_schatten';
/** Höchstens so viele Paare je Bericht als Einzelzeile (der Rest nur gezählt). */
const MAX_FAELLE = 300;
/** Ab dieser Größe des Tagesberichts (Firestore-Grenze 1 MiB) entfallen die Einzelfälle des Schattens. */
const BERICHT_MAX_BYTES = 900 * 1024;
/** χ²-Grenze für p < 0,05 bei einem Freiheitsgrad (McNemar). */
const CHI2_GRENZE_5_PROZENT = 3.841;

/** Ein Lauf ohne Ergebnis gilt nach dieser Zeit als abgebrochen (src/liveSchatten.js übernimmt ihn neu; der Bericht zählt ihn als `haengt`). */
const LAUF_HAENGT_MS = 12 * 60 * 1000;
/** Ein Schatten-Ergebnis wird an genau einem Morgen verglichen: dem ersten Lauf nach seinem Ergebnis (Fenster 24 h). */
const VERGLEICH_FENSTER_MS = 24 * 60 * 60 * 1000;

/** Fehler → kurzer Code ohne Freitext (keine Pfade, keine uid). */
function fehlerCode(e) {
  if (e && typeof e.code === 'string' && /^[a-z0-9_/.-]{1,60}$/i.test(e.code)) return e.code;
  const t = String((e && e.message) || e || '');
  if (/zeit_abgelaufen/.test(t)) return 'zeit_abgelaufen';
  const m = t.match(/\b(RESOURCE_EXHAUSTED|UNAVAILABLE|DEADLINE_EXCEEDED|INVALID_ARGUMENT|ABORTED|INTERNAL|NOT_FOUND|PERMISSION_DENIED|429|500|503)\b/);
  return m ? m[1] : 'fehler';
}

/** Gehashte Fall-Kennung — für Bericht und Abgleich über Tage, ohne die uid zu zeigen. */
const fallKennung = (id) => crypto.createHash('sha256').update(String(id)).digest('hex').slice(0, 12);

/** Quantil nach dem Rang-Verfahren (nearest rank) — `null` ohne Werte. */
function quantil(werte, q) {
  const v = werte.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const i = Math.min(v.length - 1, Math.max(0, Math.ceil(q * v.length) - 1));
  return v[i];
}

const ENTSCHEIDUNGEN = new Set(['freigeben', 'ablehnen', 'offen']);

/** Was der Schatten zu einem Fall sagt — aus seinem Dokument (oder `fehlt`). */
function schattenSeite(s, jetzt = null) {
  if (!s) return { art: 'fehlt', grund: null };
  if (s.status === 'fertig') {
    // Technischer Rückfall (Bildprüfung/Nachlesung gescheitert): kein Regel-Ergebnis.
    if (s.ergebnis === 'offen' && s.technisch) return { art: 'technisch', grund: s.technisch.bildpruefung || (s.technisch.nachlesen ? `nachlesen_${s.technisch.nachlesen.join('_')}` : '?') };
    return { art: s.ergebnis || 'unbekannt', grund: s.grund || null };
  }
  if (s.status === 'fehler') return { art: 'fehler', grund: s.fehler ? String(s.fehler).slice(0, 60) : null };
  if (s.status === 'laeuft' && jetzt != null && jetzt - (Number(s.startedMs) || 0) >= LAUF_HAENGT_MS) return { art: 'haengt', grund: null };
  return { art: s.status || 'unbekannt', grund: null };
}

/** Zeitpunkt des Schatten-Ergebnisses (oder seines letzten Stands). */
const schattenZeit = (s) => Number(s.fertigMs) || Number(s.fehlerMs) || Number(s.startedMs) || null;

/**
 * Abgleich je Fall: Schatten (zur Einreich-Zeit) gegen Morgenrunde (08:00).
 *
 * @param {Array<{id:string, entscheidung:string, grund:string|null, uebersprungen?:boolean}>} plan  Plan der Runde nach dem Schreiben
 * @param {Map<string, object>} schattenVon  uploadId → Dokument aus crowd_live_schatten
 * @param {{jetzt?:number|null}} [o]  Start der Runde. Mit ihm zählt jedes Schatten-Ergebnis an
 *   GENAU einem Morgen (Prüfrunde 05.11.2026): ein Fall, den die Runde offen lässt, steht am
 *   nächsten Morgen wieder im Plan — ohne Fenster würde er erneut verglichen und b/c der
 *   McNemar-Summe über zwei Wochen aufgebläht. Älter als 24 h → `schonVerglichen`; erst nach
 *   dem Start fertig → `nachRundenstart` (verglichen am nächsten Morgen, falls dann noch offen).
 */
function schattenVergleich(plan, schattenVon, { jetzt = null } = {}) {
  const zaehle = (o, k) => { o[k] = (o[k] || 0) + 1; };
  const paare = {};
  const jeGrund = {}; // nach Grund der Runde (Freigabe = 'freigegeben')
  const jeSchattenGrund = {}; // nach Grund des Schattens
  const betrugsschutz = { anzahl: 0, gruende: {} };
  const rueckfaelle = { anzahl: 0, gruende: {} };
  const faelle = [];
  const gesamtMs = [];
  const modelMs = [];
  let verglichen = 0; let gleich = 0; let gleichMitGrund = 0;
  let fehlt = 0; let fehler = 0; let laeuft = 0; let haengt = 0; let uebersprungen = 0; let schonEntschieden = 0;
  let schonVerglichen = 0; let nachRundenstart = 0;
  const technisch = { anzahl: 0, gruende: {} };
  let schattenFreiRundeNicht = 0; let rundeFreiSchattenNicht = 0;
  const lockerer = []; const strenger = [];
  for (const p of plan) {
    const s = schattenVon.get(p.id) || null;
    const sch = schattenSeite(s, jetzt);
    const runde = p.uebersprungen ? 'uebersprungen' : p.entscheidung;
    if (sch.art === 'fehlt') { fehlt++; continue; }
    if (jetzt != null && sch.art !== 'laeuft' && sch.art !== 'haengt') {
      const t = schattenZeit(s);
      if (t != null && t <= jetzt - VERGLEICH_FENSTER_MS) { schonVerglichen++; continue; }
      if (t != null && t > jetzt) { nachRundenstart++; continue; }
    }
    if (sch.art === 'fehler') fehler++;
    if (sch.art === 'laeuft') laeuft++;
    if (sch.art === 'haengt') haengt++;
    if (sch.art === 'technisch') { technisch.anzahl++; zaehle(technisch.gruende, sch.grund || '?'); }
    if (sch.art === 'schon_entschieden') schonEntschieden++;
    if (sch.art === 'betrugsschutz') { betrugsschutz.anzahl++; zaehle(betrugsschutz.gruende, sch.grund || '?'); }
    if (sch.art === 'offen') { rueckfaelle.anzahl++; zaehle(rueckfaelle.gruende, sch.grund || '?'); }
    if (s && ENTSCHEIDUNGEN.has(sch.art)) {
      if (Number.isFinite(s.gesamtMs)) gesamtMs.push(s.gesamtMs);
      if (Number.isFinite(s.modelMs)) modelMs.push(s.modelMs);
    }
    if (runde === 'uebersprungen') uebersprungen++;
    const vergleichbar = ENTSCHEIDUNGEN.has(sch.art) && ENTSCHEIDUNGEN.has(runde);
    if (faelle.length < MAX_FAELLE) {
      faelle.push({
        f: fallKennung(p.id), schatten: sch.art, schattenGrund: sch.grund, runde, rundeGrund: p.grund || null,
        ...(s && Number.isFinite(s.gesamtMs) ? { ms: s.gesamtMs } : {}),
      });
    }
    if (!vergleichbar) continue;
    verglichen++;
    zaehle(paare, `${sch.art}|${runde}`);
    const istGleich = sch.art === runde;
    const istGleichMitGrund = istGleich && (runde === 'freigeben' || (sch.grund || null) === (p.grund || null));
    if (istGleich) gleich++;
    if (istGleichMitGrund) gleichMitGrund++;
    const rk = runde === 'freigeben' ? 'freigegeben' : p.grund || '?';
    jeGrund[rk] = jeGrund[rk] || { anzahl: 0, gleich: 0 };
    jeGrund[rk].anzahl++;
    if (istGleichMitGrund) jeGrund[rk].gleich++;
    const sk = sch.art === 'freigeben' ? 'freigegeben' : sch.grund || '?';
    jeSchattenGrund[sk] = jeSchattenGrund[sk] || { anzahl: 0, gleich: 0 };
    jeSchattenGrund[sk].anzahl++;
    if (istGleichMitGrund) jeSchattenGrund[sk].gleich++;
    // „Lockerer“ (Entwurf t8 § 5, Ziel 0): live frei, Runde ablehnen oder offen.
    if (sch.art === 'freigeben' && runde !== 'freigeben') {
      schattenFreiRundeNicht++;
      if (lockerer.length < 50) lockerer.push({ f: fallKennung(p.id), runde, rundeGrund: p.grund || null });
    }
    if (runde === 'freigeben' && sch.art !== 'freigeben') {
      rundeFreiSchattenNicht++;
      if (strenger.length < 50) strenger.push({ f: fallKennung(p.id), schatten: sch.art, schattenGrund: sch.grund });
    }
  }
  // McNemar über die abweichenden Paare „frei / nicht frei“ (mit Stetigkeitskorrektur).
  const b = schattenFreiRundeNicht; const c = rundeFreiSchattenNicht;
  const chi2 = b + c ? ((Math.abs(b - c) - 1) ** 2) / (b + c) : null;
  const anteil = (n) => (verglichen ? Math.round((1000 * n) / verglichen) / 1000 : null);
  return {
    aktiv: plan.some((p) => schattenVon.has(p.id)),
    faelleRunde: plan.length,
    verglichen, gleich, gleichMitGrund,
    uebereinstimmung: anteil(gleich), uebereinstimmungMitGrund: anteil(gleichMitGrund),
    // Schlüssel „Schatten|Runde“.
    paare, jeGrund, jeSchattenGrund,
    schattenFreiRundeNicht, rundeFreiSchattenNicht, lockerer, strenger,
    mcnemar: { b, c, chi2: chi2 == null ? null : Math.round(chi2 * 1000) / 1000, signifikant: chi2 != null && chi2 > CHI2_GRENZE_5_PROZENT },
    dauer: {
      // Ab Upload (Server-Zeitpunkt des Dokuments) bis zum Ergebnis des Schattens.
      gesamtMedianMs: quantil(gesamtMs, 0.5), gesamtP99Ms: quantil(gesamtMs, 0.99),
      modellMedianMs: quantil(modelMs, 0.5), modellP99Ms: quantil(modelMs, 0.99),
      gemessen: gesamtMs.length,
    },
    // `rueckfaelle`: Schatten „offen“ nach den Regeln; `technisch`: offen, weil Bildprüfung oder Nachlesung an der Technik scheiterten.
    betrugsschutz, rueckfaelle, technisch,
    fehler, laeuft, haengt, fehlt, uebersprungen, schonEntschieden, schonVerglichen, nachRundenstart,
    faelle,
  };
}

/** Schatten-Dokumente zu den Fällen der Runde laden (getAll in Stücken) und abgleichen. Wirft nie. */
async function schattenFuerBericht(db, plan, logger = null, jetzt = null) {
  try {
    const ids = plan.map((p) => p.id);
    const schattenVon = new Map();
    for (let i = 0; i < ids.length; i += 100) {
      const refs = ids.slice(i, i + 100).map((id) => db.collection(SCHATTEN_COL).doc(id));
      if (!refs.length) continue;
      const snaps = await db.getAll(...refs);
      for (const s of snaps) if (s.exists) schattenVon.set(s.id, s.data());
    }
    return schattenVergleich(plan, schattenVon, { jetzt });
  } catch (e) {
    if (logger) logger.warn('Live-Schatten für den Bericht nicht lesbar', { fehler: String(e && e.message).slice(0, 160) });
    return { aktiv: null, unlesbar: true };
  }
}

/** Ungefähre Größe eines Dokuments in Byte (JSON, UTF-8) — null, wenn nicht messbar. */
function groesseVon(obj) {
  try { return Buffer.byteLength(JSON.stringify(obj), 'utf8'); } catch (e) { return null; }
}

/**
 * Der Schatten-Teil für den Bericht `bericht[feld]` — bei mehr als BERICHT_MAX_BYTES
 * ohne die Einzelfälle (`faelle`, `lockerer`, `strenger`), mit allen Kennzahlen.
 * Wirft nie; ändert sonst nichts am Bericht.
 */
function schattenFuerGroesse(bericht, feld, max = BERICHT_MAX_BYTES) {
  const ls = bericht && bericht[feld];
  if (!ls || typeof ls !== 'object') return ls;
  const g = groesseVon(bericht);
  if (g == null || g <= max) return ls;
  const { faelle, lockerer, strenger, ...rest } = ls;
  return { ...rest, einzelfaelleWeggelassen: true, berichtBytes: g };
}

module.exports = {
  BERICHT_MAX_BYTES, groesseVon, schattenFuerGroesse, SCHATTEN_COL, LAUF_HAENGT_MS, VERGLEICH_FENSTER_MS, fehlerCode, fallKennung, quantil, schattenSeite, schattenVergleich, schattenFuerBericht, MAX_FAELLE };
