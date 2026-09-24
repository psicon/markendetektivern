'use strict';

/**
 * Entscheidet, ob eine Einreichung die Ortsanforderung des Reward-Programms
 * erfüllt.
 *
 * ═══ Warum das serverseitig gehört ═══
 *
 * Der Wizard verlangt den Ort seit dem place-Schritt verpflichtend — aber
 * nur bei Nutzern, die das Update haben. Eine ältere App reicht weiterhin
 * ohne Ortsangabe ein, und die Vergütung liefe durch. Eine Geld-Regel, die
 * nur im Client steht, ist keine Regel.
 *
 * ═══ Geprüft wird die TATSACHE, nicht die Bewertung ═══
 *
 * Bewusst wird NICHT auf `probableLocation.confidence` geprüft, obwohl das
 * naheliegt. Diese Bewertung stammt aus einem Modell, das sich ändern darf
 * (`crowd-upload-location/src/scorer.js`, versioniert). Hinge das Geld
 * daran, würde eine Modelländerung rückwirkend entscheiden, wer bezahlt
 * wird — und niemand würde es merken. Geld-Regeln knüpfen an Tatsachen an:
 * hat der Nutzer einen Ort angegeben oder nicht.
 *
 * ═══ Die Übergangsfrist ═══
 *
 * Ein sofortiges Durchgreifen träfe alle, die schlicht noch nicht
 * aktualisiert haben — 126 der 132 Einreicher waren in den letzten 30 Tagen
 * aktiv, und eine Update-Verbreitung dauert Wochen. Diese Leute haben
 * nichts falsch gemacht. Genau so entstand schon einmal die Lage
 * „144 freigegeben, 0 Cent ausgezahlt"; das darf sich nicht wiederholen.
 *
 * Deshalb greift die Anforderung dort, wo sie ERFÜLLBAR ist: Dokumente mit
 * `clientVersion` stammen aus einer App, die den Pflicht-Schritt kennt —
 * dort wird geprüft. Ohne `clientVersion` ist es eine alte App, die gar
 * nicht danach fragen konnte — dort wird vergütet.
 *
 * Wenn die Verbreitung steht, `GNADENFRIST_ALTE_CLIENTS` auf false setzen.
 * Das ist eine bewusste Entscheidung mit einem Datum, keine Einstellung,
 * die man vergisst: ab dann verdient niemand mehr ohne Ortsangabe.
 */

// 05.09.2026 (Orts-Audit): Die Gnadenfrist ist jetzt DATUMSBASIERT statt
// boolesch. Datenlage: Alt-Clients ohne clientVersion liefen mit der
// Android-Promotion (28.08.) aus — letzter Upload 01.09., seit 02.09. null.
// Dokumente, die VOR dem Stichtag entstanden sind, werden weiter vergütet
// (auch wenn sie erst später freigegeben werden — die Leute haben nichts
// falsch gemacht); ab dem Stichtag gilt die Ortsanforderung für alle.
const GNADENFRIST_BIS_ISO = '2026-09-02T00:00:00Z';
const GNADENFRIST_BIS_MS = Date.parse(GNADENFRIST_BIS_ISO);
/** Rückwärtskompatibel: true, solange Dokumente vor dem Stichtag existieren. */
const GNADENFRIST_ALTE_CLIENTS = true;

function createdAtMs(doc) {
  const c = doc?.createdAt;
  if (!c) return null;
  if (c instanceof Date) return c.getTime();
  if (typeof c.toMillis === 'function') return c.toMillis();
  if (typeof c === 'number') return c;
  if (typeof c === 'string') { const t = Date.parse(c); return Number.isFinite(t) ? t : null; }
  if (typeof c.seconds === 'number') return c.seconds * 1000;
  return null;
}

/**
 * Ortsrangfolge (Entscheidung Patrick, 24.09.2026):
 *   1. Filialadresse vom Kassenbon auf dem Preisfoto — steht belegt im Bild,
 *      zeigt den tatsächlichen Markt; wichtigste Quelle.
 *   2. GPS vom Gerät beim Aufnehmen.
 *   3. Ortsangabe (eingetippt) — nur als Rückfall.
 *   4. IP-Ortung — nur, wenn GPS technisch scheiterte (Freigabe erteilt, aber
 *      kein Fix: in der Filiale, zu Hause).
 * Die erste zutreffende Stufe bestimmt `grund` (landet als rewardLocationRule
 * am Dokument). Am Datenschema ändert sich nichts: gelesen werden nur
 * bestehende Felder, geschrieben werden nur bestehende Grund-Werte.
 */

/**
 * Harte Standortfreigabe-Pflicht (Entscheidung Patrick, 24.09.2026: wer am
 * Reward-Programm teilnimmt, MUSS die Freigabe erteilt haben — auch auf iOS).
 * Serverseitig greift sie ab der ersten App-Version je Plattform, die die
 * Pflicht auch in der App durchsetzt. Vorher würde sie Leute leer ausgehen
 * lassen, denen die installierte App ausdrücklich „Ort eintippen" anbietet —
 * genau das Muster „freigegeben, 0 Cent", das sich nicht wiederholen darf.
 * `null` = noch keine solche Version ausgeliefert. Beim Release den Build
 * eintragen (clientVersion.build, z. B. Android-versionCode / iOS-Build).
 */
const STANDORTPFLICHT_AB_BUILD = { android: null, ios: null };

/** Die App schreibt diese Werte, wenn die Freigabe NICHT erteilt ist (captureContext.ts). */
const FREIGABE_FEHLT = new Set(['denied', 'not_asked']);

function standortpflichtGilt(doc, ab) {
  const cv = doc?.clientVersion;
  const schwelle = cv && ab ? ab[String(cv.platform || '').toLowerCase()] : null;
  const build = Number(cv?.build);
  return schwelle != null && Number.isFinite(build) && build >= Number(schwelle);
}

/**
 * Verwertbare IP-Ortung? `source: 'fallback'` ist der DACH-Mittelpunkt, den
 * die App einträgt, wenn die IP-Abfrage scheiterte — kein Ort (CLAUDE.md).
 */
function ipOrtNutzbar(jl) {
  if (!jl || typeof jl !== 'object') return false;
  if (String(jl.source || '') === 'fallback') return false;
  return Boolean(jl.city) || (Number.isFinite(Number(jl.lat)) && Number.isFinite(Number(jl.lon)));
}

/**
 * @param {object} doc Das crowd_uploads-Dokument.
 * @param {object} [opts]
 * @param {{android: number|null, ios: number|null}} [opts.standortpflichtAb]  für Tests
 * @returns {{ok: true, grund?: string} | {ok: false, grund: string}}
 */
function pruefeOrtsanforderung(doc, opts = {}) {
  const capture = doc?.capture || null;
  const gpsStatus = String(capture?.gpsStatus || '');

  // 0) Harte Freigabe-Pflicht — erst ab der App-Version, die sie durchsetzt.
  if (standortpflichtGilt(doc, opts.standortpflichtAb || STANDORTPFLICHT_AB_BUILD) && FREIGABE_FEHLT.has(gpsStatus)) {
    return { ok: false, grund: 'no_location' };
  }

  // 1) Kassenbon auf dem Preisfoto. Manche Nutzer fotografieren als „Preis"
  // den Bon statt des Regal-Etiketts (30 % in den 30 Tagen bis 24.09.). Der
  // Bon-Kopf trägt die Filialadresse; crowd-upload-namer liest sie im
  // ohnehin stattfindenden OCR-Aufruf mit (`priceReceipt`).
  const bon = doc?.priceReceipt;
  if (bon && bon.complete && bon.zip && bon.city) {
    return { ok: true, grund: 'ort_aus_kassenbon' };
  }

  // 2) GPS und 3) Ortsangabe. Beide tragen seit jeher denselben Grund
  // (`ort_vorhanden`, vom Aufrufer gesetzt) — unverändert, damit keine neuen
  // Werte in rewardLocationRule entstehen.
  if (capture?.gps) return { ok: true };
  if (capture?.confirmedPlace) return { ok: true };

  // Kein Ort. Konnte diese App überhaupt danach fragen?
  const kanntePflichtSchritt = Boolean(doc?.clientVersion);
  if (!kanntePflichtSchritt && GNADENFRIST_ALTE_CLIENTS) {
    const created = createdAtMs(doc);
    // Vor dem Stichtag entstanden → Gnadenfrist. Ohne createdAt (anomal)
    // oder danach → wie ein aktueller Client behandeln.
    if (created != null && created < GNADENFRIST_BIS_MS) {
      return { ok: true, grund: 'gnadenfrist_alter_client' };
    }
  }

  // 4) IP-Ortung als letzte Stufe: nur wenn GPS technisch scheiterte
  // (unavailable/timeout — Freigabe erteilt, aber kein Fix) UND eine
  // verwertbare IP-Ortung vorliegt. Der Grund-Wert stammt aus der Regel vom
  // 03.09.2026 (Android 6.0.15 übersprang den Orts-Schritt): bis 24.09. wurde
  // dort ganz ohne Ort vergütet; seit der Rangfolge nur noch mit IP-Ortung
  // (gemessen: 38 von 42 Fällen in 30 Tagen hatten eine).
  // 'denied' bleibt no_location: da hat der Nutzer die Berechtigung
  // verweigert UND den angebotenen Orts-Schritt übersprungen.
  if ((gpsStatus === 'unavailable' || gpsStatus === 'timeout') && ipOrtNutzbar(doc?.journeyLocation)) {
    return { ok: true, grund: 'gps_fix_fehlt_schritt_uebersprungen' };
  }

  return { ok: false, grund: 'no_location' };
}

module.exports = { pruefeOrtsanforderung, GNADENFRIST_ALTE_CLIENTS, GNADENFRIST_BIS_ISO, STANDORTPFLICHT_AB_BUILD };
