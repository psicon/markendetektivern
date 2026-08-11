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

  return { ok: false, grund: 'no_location' };
}

module.exports = { pruefeOrtsanforderung, GNADENFRIST_ALTE_CLIENTS };
