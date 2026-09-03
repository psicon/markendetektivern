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

const GNADENFRIST_ALTE_CLIENTS = true;

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

  // Kein Ort. Konnte diese App überhaupt danach fragen?
  const kanntePflichtSchritt = Boolean(doc?.clientVersion);
  if (!kanntePflichtSchritt && GNADENFRIST_ALTE_CLIENTS) {
    return { ok: true, grund: 'gnadenfrist_alter_client' };
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

module.exports = { pruefeOrtsanforderung, GNADENFRIST_ALTE_CLIENTS };
