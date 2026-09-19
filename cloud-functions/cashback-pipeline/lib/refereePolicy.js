'use strict';

/**
 * Zweitprüfung („Schiedsrichter") für unsicher gelesene Bons — die reinen
 * Entscheidungsregeln (ClickUp 86cbfvwge, Vorgabe Patrick 14.09.2026:
 * „ein fetteres Model drüber lassen, das dann entscheiden kann. Wenn das auch
 * nicht entscheiden kann, wird erst abgelehnt").
 *
 * Bisher wurde ein Bon, dessen Mehrfach-Lesung sich nicht sicher war
 * (Bewertung `none`/`low`), bei einem daten-abhängigen Grund sofort
 * abgelehnt. Der Nutzer fotografierte neu, bekam dieselbe unsichere Lesung und
 * dieselbe Ablehnung. Jetzt liest vor der Ablehnung ein stärkeres Modell mit
 * einem schärferen Prompt (Warenkorb-Rabatte, Vollständigkeit) nach.
 *
 * Hier stehen NUR die Regeln (ohne Firestore, ohne Modellaufruf), damit sie
 * isoliert getestet werden können. Der Aufruf liegt in lib/ocr_referee.js,
 * die Verdrahtung in index.js (Durchlauf 1 fordert an, Durchlauf 2 prüft).
 */

const { reconcile, basketDiscountCents, countEligibleItems } = require('./ocr');
const { moneyFieldAgreement, normMerchant } = require('./fieldAgreement');

/**
 * Gründe, die an der LESUNG hängen. Duplikate, Deckel, Budget oder
 * menschliche Entscheidungen sind keine Lesefrage — dort entscheidet ein
 * stärkeres Modell nichts.
 */
const REFEREE_REASONS = new Set([
  'reconciliation_delta',
  'no_bon_date',
  'not_a_receipt',
  'unknown_merchant',
  'bon_too_old',
]);

/** Nur hier war sich die Mehrfach-Lesung nicht sicher. */
const REFEREE_CONFIDENCES = new Set(['none', 'low']);

/** Schalter `cashback_config/v1.ocrReferee`: false | 'shadow' | true. */
function refereeMode(value) {
  return value === true || value === 'shadow' ? value : false;
}

/**
 * Soll vor der Ablehnung die Zweitprüfung laufen?
 *
 * Die Ausschlussregeln sind aus den Live-Daten abgeleitet (09.–14.09.2026):
 * ein Signal, das ALLE bisherigen Lesungen übereinstimmend zeigen, ändert ein
 * stärkeres Modell am selben Bild nicht — es kostet dann nur.
 *   • unknown_merchant: 36 Fälle, fast immer derselbe Name auf allen Lesungen
 *     (Rossmann, Action, Kioske) → Katalogfrage, keine Lesefrage.
 *   • bon_too_old: 16 Fälle, Datum auf allen Lesungen gleich.
 *   • not_a_receipt: ohne Markt UND Datum auf jeder Lesung ist es kein Bon.
 * reconciliation_delta und no_bon_date laufen immer: gerade die Bons mit
 * Warenkorb-Rabatt lesen alle Lesungen gleich — und falsch bewertet.
 *
 * @returns {{request: boolean, grund: string}}
 */
function shouldRequestReferee(input = {}) {
  const {
    mode, status, rejectReason, confidence, reads, parsed,
    reviewDecision, alreadyCredited, hasRequest, hasReferee, einDatumInFrist,
  } = input;
  if (!refereeMode(mode)) return { request: false, grund: 'abgeschaltet' };
  if (status !== 'rejected') return { request: false, grund: 'nicht_abgelehnt' };
  if (!REFEREE_REASONS.has(rejectReason)) return { request: false, grund: 'kein_lesegrund' };
  if (!REFEREE_CONFIDENCES.has(confidence)) return { request: false, grund: 'lesung_sicher' };
  // Eine menschliche Entscheidung wird nie automatisch überstimmt; ein schon
  // gutgeschriebener Bon wird nicht noch einmal angefasst.
  if (reviewDecision) return { request: false, grund: 'mensch_entschied' };
  if (alreadyCredited) return { request: false, grund: 'schon_gutgeschrieben' };
  // Schleifensperre: genau EINE Zweitprüfung pro Bon.
  if (hasRequest || hasReferee) return { request: false, grund: 'schon_geprueft' };

  const bonLesungen = (Array.isArray(reads) ? reads : []).filter((r) => r && r.isReceipt !== false);

  if (rejectReason === 'unknown_merchant') {
    const gelesen = normMerchant(parsed?.merchant);
    if (!gelesen) return { request: true, grund: 'markt_nicht_gelesen' };
    const namen = bonLesungen.map((r) => normMerchant(r.merchant)).filter(Boolean);
    return namen.every((n) => n === gelesen)
      ? { request: false, grund: 'markt_stabil' }
      : { request: true, grund: 'markt_uneinig' };
  }

  if (rejectReason === 'bon_too_old') {
    // Die Rohdaten der Lesungen vergleichen, nicht `parsed.bonDate`: das hat
    // die Jahres-Plausibilisierung in index.js eventuell schon korrigiert und
    // wäre dann ein künstlicher zweiter Wert. Die gewählte Lesung steckt
    // ohnehin in `reads`.
    const quelle = bonLesungen.length ? bonLesungen.map((r) => r.bonDate) : [parsed?.bonDate];
    const daten = new Set(quelle.filter(Boolean));
    if (daten.size <= 1) return { request: false, grund: 'datum_stabil' };
    // Liegt kein einziges gelesenes Datum in der Frist, kann die Prüfung am
    // Ergebnis nichts ändern (sie darf nur zwischen gelesenen Daten wählen,
    // siehe plausibel()). Unbekannt (null) → anfordern.
    if (einDatumInFrist === false) return { request: false, grund: 'kein_datum_in_frist' };
    return { request: true, grund: 'datum_uneinig' };
  }

  if (rejectReason === 'not_a_receipt') {
    const alle = Array.isArray(reads) ? reads : [];
    const merkmal = Boolean(parsed?.merchant || parsed?.bonDate)
      || alle.some((r) => r && (r.merchant || r.bonDate));
    return merkmal
      ? { request: true, grund: 'bon_merkmal_gelesen' }
      : { request: false, grund: 'kein_bon_merkmal' };
  }

  return { request: true, grund: rejectReason };
}

/**
 * Fingerabdruck einer Schiedsrichter-Lesung. Anders als `readFingerprint` in
 * ocr_robust zählt hier die ERWEITERTE Summenprobe (Warenkorb-Rabatt) und die
 * Selbstauskunft zur Vollständigkeit. Keine `undefined`-Werte (Firestore).
 */
function refereeFingerprint(read) {
  const p = (read && read.parsed) || {};
  const recon = reconcile(p);
  return {
    isReceipt: p.isReceipt === true,
    merchant: p.merchant == null ? null : String(p.merchant).slice(0, 120),
    bonCountry: p.bonCountry == null ? null : String(p.bonCountry).slice(0, 8),
    bonDate: typeof p.bonDate === 'string' ? p.bonDate.slice(0, 10) : null,
    bonTime: typeof p.bonTime === 'string' ? p.bonTime.slice(0, 5) : null,
    totalCents: Number.isFinite(p.totalCents) ? p.totalCents : null,
    subtotalCents: Number.isFinite(p.subtotalCents) ? p.subtotalCents : null,
    itemCount: Array.isArray(p.items) ? p.items.length : 0,
    eligibleItems: countEligibleItems(p),
    reconOk: recon.ok === true,
    reconDirection: recon.direction || null,
    basketDiscountCents: basketDiscountCents(p),
    bonComplete: p.bonComplete === true ? true : p.bonComplete === false ? false : null,
    model: read && read.model ? String(read.model) : null,
    finishReason: read && read.finishReason ? String(read.finishReason) : null,
  };
}

/**
 * Passt eine Schiedsrichter-Lesung zu dem, was die unabhängigen Erstlesungen
 * übereinstimmend gesehen haben? (Review 14.09.) Zwei Lesungen DESSELBEN
 * Modells mit demselben Prompt sind korreliert — was sie gemeinsam erfinden,
 * darf nicht als Beleg durchgehen. Deshalb nur Werte, die in den Erstlesungen
 * schon vorkommen:
 *   • Endsumme: muss eine der Erstlesungen genauso gelesen haben (die
 *     Endsumme lasen die Erstlesungen in 30 von 31 Fällen einheitlich).
 *   • Warenkorb-Rabatt: nicht mehr anrechenbare Artikel als die höchste
 *     Erstlesung — sonst könnte ein erfundener Rabatt doppelt gelesene
 *     Artikel legitimieren.
 *   • bon_too_old: das Datum muss eines der gelesenen sein — die Prüfung
 *     wählt zwischen Lesarten, sie erfindet kein neues Datum.
 * Ohne Erstlesungen mit dem jeweiligen Wert entfällt die Einzelprüfung.
 *
 * @param {object} fp       Fingerabdruck der Schiedsrichter-Lesung.
 * @param {object} [kontext] {prior: Array<{isReceipt,totalCents,eligibleItems,bonDate}>, reason}
 */
function plausibel(fp, kontext = {}) {
  const prior = (Array.isArray(kontext.prior) ? kontext.prior : []).filter((r) => r && r.isReceipt !== false);
  const summen = new Set(prior.map((r) => r.totalCents).filter(Number.isFinite));
  if (summen.size && !summen.has(fp.totalCents)) return false;
  if (fp.reconDirection === 'basket_discount') {
    // Ohne eine einzige Erstlesung mit Artikelzahl (z. B. not_a_receipt, alle
    // Erstlesungen „kein Bon") gibt es keinen Maßstab gegen eine erfundene
    // Rabattzeile — dann trägt der Rabatt-Weg nicht (Review Runde 2).
    const zahlen = prior.map((r) => r.eligibleItems).filter(Number.isFinite);
    if (!zahlen.length || fp.eligibleItems > Math.max(...zahlen)) return false;
  }
  if (kontext.reason === 'bon_too_old') {
    const daten = new Set(prior.map((r) => r.bonDate).filter(Boolean));
    if (daten.size && !daten.has(fp.bonDate)) return false;
  }
  return true;
}

/**
 * Taugt eine Lesung als Zeuge? In sich stimmig, vollständig, mit Markt und
 * Datum — und plausibel gegenüber den Erstlesungen (wenn übergeben).
 */
function istZeuge(fp, kontext) {
  return Boolean(
    fp
    && fp.isReceipt === true
    && fp.reconOk === true
    && fp.bonComplete !== false
    && fp.bonDate
    && normMerchant(fp.merchant)
    && (!kontext || plausibel(fp, kontext)),
  );
}

/**
 * Entschieden ist, sobald ZWEI Zeugen über die geldrelevanten Felder
 * übereinstimmen — Markt (über den Resolver), Datum, Endsumme, Betrag aus der
 * Artikelzahl, Uhrzeit. Das ist dieselbe Prüfung, die das Freigabe-Gate 6w
 * für `low`/`medium` nutzt (lib/fieldAgreement.js), nur paarweise: eine
 * abweichende dritte Lesung macht zwei übereinstimmende nicht ungültig.
 *
 * Der Betrag wird über die EXAKTE Zahl anrechenbarer Artikel verglichen, nicht
 * über eine Aktions-Tabelle: welche Aktion am Ende zahlt, steht erst nach der
 * regionalen Korrektur fest (Review 14.09.) — exakt gleich ist für jede
 * Tabelle gleich.
 *
 * @param {Array} fps Fingerabdrücke in Lesereihenfolge.
 * @param {object} opts {merchantKey, prior, reason}
 * @returns {{decided: boolean, chosenIndex: number|null, paar: number[]|null, grund: string, zeugen: number, konflikte: string[]}}
 */
function decideReferee(fps, opts = {}) {
  const liste = Array.isArray(fps) ? fps : [];
  const kontext = opts.prior ? { prior: opts.prior, reason: opts.reason } : null;
  const zeugen = liste.map((fp, i) => (istZeuge(fp, kontext) ? i : -1)).filter((i) => i >= 0);
  if (zeugen.length < 2) {
    const verworfen = kontext ? liste.filter((fp) => istZeuge(fp) && !plausibel(fp, kontext)).length : 0;
    return {
      decided: false,
      chosenIndex: null,
      paar: null,
      grund: verworfen ? 'widerspricht_erstlesung' : 'zu_wenige_zeugen',
      zeugen: zeugen.length,
      konflikte: [],
    };
  }
  const agreement = { merchantKey: opts.merchantKey, betragFuer: (n) => n };
  const konflikte = new Set();
  for (let a = 0; a < zeugen.length; a++) {
    for (let b = a + 1; b < zeugen.length; b++) {
      const fa = liste[zeugen[a]];
      const fb = liste[zeugen[b]];
      const r = moneyFieldAgreement([fa, fb], agreement);
      if (r.ok) {
        // Die Lesung MIT Uhrzeit wählen: ohne sie entfällt der kontenüber-
        // greifende Doppel-Schlüssel (transactionHash) — zwei Konten könnten
        // denselben Bon einreichen.
        const chosenIndex = !fa.bonTime && fb.bonTime ? zeugen[b] : zeugen[a];
        return {
          decided: true,
          chosenIndex,
          paar: [zeugen[a], zeugen[b]],
          grund: 'zwei_lesungen_einig',
          zeugen: zeugen.length,
          konflikte: [],
        };
      }
      r.konflikte.forEach((k) => konflikte.add(k));
    }
  }
  return { decided: false, chosenIndex: null, paar: null, grund: 'felder_uneinig', zeugen: zeugen.length, konflikte: [...konflikte] };
}

/**
 * Hat die Infrastruktur die Entscheidung verhindert (Review Runde 3)? Keine
 * Lesung kam zurück — oder die ausgefallenen Lesungen (429/Timeout/Frist)
 * hätten rechnerisch die fehlenden Zeugen stellen können. Dann ist
 * „unentschieden" keine Aussage über den Bon (Regel seit Incident 19.08.).
 *
 * @param {object} result Ergebnis von runReferee.
 */
function infraVerhindert(result) {
  if (!result) return false;
  if (result.verdict === 'failed') return true;
  if (result.verdict !== 'undecided') return false;
  const frist = (result.failures || []).includes('frist_erreicht') ? 1 : 0;
  const ausfaelle = (result.failedAttempts || 0) + frist;
  return ausfaelle > 0 && (result.zeugen || 0) + ausfaelle >= 2;
}

/**
 * Uhrzeit aus den Erstlesungen, wenn die sich einig sind (Review 19.09.).
 *
 * Die Uhrzeit ist der einzige Teil des kontenübergreifenden Doppel-Schlüssels
 * (`transactionHash` = Markt | Datum | Uhrzeit | Summe), den die Zweitprüfung
 * mitbringt, ohne dass ihn irgendeine Prüfung absichert: `plausibel()` schaut
 * auf Endsumme, Artikelzahl und Datum, nicht auf die Uhr, und im Zeugen-Paar
 * gilt eine FEHLENDE Uhrzeit nicht als Widerspruch. Im Praxistest 19.09. las
 * eine von drei Prüf-Lesungen 06:21 statt 08:19 (sechs Erstlesungen
 * einheitlich 08:19) — gerettet hat nur, dass zufällig das andere Paar gewann.
 * Mit einer Minderheits-Uhrzeit im Schlüssel könnten zwei Konten denselben Bon
 * einreichen, ohne dass die Doppel-Erkennung greift.
 *
 * Deshalb: die Entscheidung NICHT verwerfen (die Uhrzeit trägt kein Geld),
 * sondern den Schlüssel richtig stellen — lesen die Erstlesungen einheitlich
 * eine Uhrzeit, gilt sie. Sind sie uneinig oder haben keine, bleibt es bei der
 * Prüf-Lesung.
 *
 * @param {Array} priorReads Erstlesungen (ocr.robust.reads).
 * @returns {string|null} einheitliche Uhrzeit oder null
 */
function einheitlicheUhrzeit(priorReads) {
  const zeiten = (Array.isArray(priorReads) ? priorReads : [])
    .filter((r) => r && r.isReceipt !== false)
    .map((r) => (typeof r.bonTime === 'string' ? r.bonTime.slice(0, 5) : null))
    .filter((t) => t);
  if (zeiten.length < 2) return null;
  return new Set(zeiten).size === 1 ? zeiten[0] : null;
}

module.exports = {
  REFEREE_REASONS,
  infraVerhindert,
  einheitlicheUhrzeit,
  refereeMode,
  shouldRequestReferee,
  refereeFingerprint,
  plausibel,
  istZeuge,
  decideReferee,
};
