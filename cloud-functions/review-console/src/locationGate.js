'use strict';

/**
 * ╔══════════════════════════════════════════════════════════════════════╗
 * ║  KOPIE aus cloud-functions/crowd-upload-reward/src/locationGate.js   ║
 * ║  Bei Änderungen BEIDE nachziehen — wie bei targeting.js.             ║
 * ╚══════════════════════════════════════════════════════════════════════╝
 *
 * Warum kopiert statt nacherzählt: Die Vorschau „Freigabe bucht X €" im
 * Prüfwerkzeug hatte die Regel zuerst frei nachgebaut und kannte zwei ihrer
 * fünf Durchlässe nicht — die Gnadenfrist für alte App-Stände und den Fall
 * „GPS-Fix blieb aus". Ergebnis: bei einer von elf offenen Einreichungen
 * stand rot „bucht nichts", während der Trigger 16 Cent bucht. Für die Kasse
 * harmlos, für den Menschen nicht: wer die Zeile ernst nimmt, lehnt eine
 * einwandfreie Einreichung als wertlos ab.
 *
 * Codebases teilen in diesem Projekt keinen Code. Eine Kopie mit dieser
 * Warnung ist ehrlicher als eine zweite, halbe Fassung derselben Regel.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *
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
 * @param {object} doc Das crowd_uploads-Dokument.
 * @returns {{ok: true} | {ok: false, grund: string}}
 */
function pruefeOrtsanforderung(doc) {
  const capture = doc?.capture || null;

  // Der Nutzer hat den Ort selbst angegeben — per Standortfreigabe oder
  // durch Eintippen. Beide Wege zählen gleich: die Anforderung lautet
  // „sag uns wo", nicht „gib GPS frei". Alles andere wäre nach Art. 5
  // Abs. 1 lit. c (Datenminimierung) auch nicht zu halten — wenn ein
  // eingetippter Ort den Datensatz erfüllt, darf GPS nicht der einzige
  // Weg sein.
  const hatOrt = Boolean(capture?.confirmedPlace || capture?.gps);
  if (hatOrt) return { ok: true };

  // 06.09.2026: Manche Nutzer fotografieren als „Preis" den KASSENBON statt
  // des Regal-Etiketts (17,5 % einer Stichprobe von 40). Der Bon-Kopf trägt
  // die Filialadresse — eine härtere Tatsache als jede Selbstauskunft und
  // genauer als ein GPS-Raster. `crowd-upload-namer` liest sie im ohnehin
  // stattfindenden OCR-Aufruf mit und legt sie als `priceReceipt` ab.
  // Das ist KEINE Lockerung der Ortspflicht, sondern eine zusätzliche Quelle,
  // die sie erfüllt: der Ort steht belegt im eingereichten Bild.
  const bon = doc?.priceReceipt;
  if (bon && bon.complete && bon.zip && bon.city) {
    return { ok: true, grund: 'ort_aus_kassenbon' };
  }

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

  // 03.09.2026 (Freigabe Patrick): Der Wizard (≤ 6.0.15, Commit 18b8cb6)
  // überspringt den Orts-Schritt, sobald die Standortberechtigung erteilt
  // ist, und verlässt sich auf den GPS-Fix. Bleibt der aus (gpsStatus
  // unavailable/timeout — 53 von 55 ortlosen Einreichungen einer Runde, alle
  // Android 6.0.15), gibt es KEINEN Fallback zur manuellen Ortsangabe: der
  // Nutzer wurde nie gefragt. Das ist dieselbe Lage wie beim alten Client —
  // die App konnte die Pflichtangabe nicht einholen, nicht der Nutzer hat
  // sie verweigert. Deshalb vergüten, mit eigenem Grund (auswertbar), bis der
  // Wizard den Fallback hat. 'denied' bleibt no_location: da hat der Nutzer
  // die Berechtigung verweigert UND den angebotenen Orts-Schritt übersprungen.
  const gpsStatus = String(capture?.gpsStatus || '');
  if (gpsStatus === 'unavailable' || gpsStatus === 'timeout') {
    return { ok: true, grund: 'gps_fix_fehlt_schritt_uebersprungen' };
  }

  return { ok: false, grund: 'no_location' };
}

module.exports = { pruefeOrtsanforderung, GNADENFRIST_ALTE_CLIENTS, GNADENFRIST_BIS_ISO };
