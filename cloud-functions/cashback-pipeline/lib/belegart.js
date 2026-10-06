'use strict';

/**
 * Belegart einer Lesung — Kassenbon, App-Kassenbon oder Online-Bestellung
 * (Prompt v1.5, Entscheidung Patrick 04.10.2026).
 *
 * Patricks Regeln: es zählen nur Kassenbons; ein App-Kassenbon nach einem
 * Einkauf im Laden (Lidl Plus, Netto-App …) ist ein Kassenbon. Eine Online-
 * Bestellung zählt genau dann, wenn der Händler einer UNSERER Märkte ist
 * (Sammlung `discounter`: dm, Rossmann, REWE, EDEKA … ja; Amazon nein; Picnic
 * und Knuspr nicht, solange sie kein Markt sind). Über den Markt entscheidet
 * weiter `resolveMerchant` — hier wird nur festgestellt, WAS für ein Beleg es
 * ist, und eine Lieferanschrift aus den Daten genommen.
 *
 * Datenschutz (Vorfall bon_mtu6wj0anmcck4): Auf Online-Rechnungen steht im
 * Kopf die LIEFER- bzw. Rechnungsanschrift des Kunden, einmal mit Vor- und
 * Nachnamen. Bis v1.4 landete sie als „Filialadresse" in receipts.store, in
 * users.region und in purchased_products.storeStreet. Darum wird sie hier
 * entfernt — bei JEDER Gemini-Lesung (lib/ocr.js), noch bevor etwas
 * gespeichert wird, und ohne Schalter.
 *
 * Endbetrag einer Online-Rechnung (Prüfrunde 04.10.2026): dm.de-Rechnungen
 * sind mehrseitige PDFs, hochgeladen wird meist Seite 1 — die Summe steht erst
 * später. v1.4 setzte dort die Artikelsumme als Endbetrag ein, und die beiden
 * dm-Online-Bestellungen der letzten 60 Tage wurden bezahlt; v1.5 liefert
 * richtig `totalCents: null`, damit ginge jede solche Rechnung als
 * reconciliation_delta unter — mit einem App-Text, der zum vollständigen
 * Fotografieren rät, was bei einem PDF nicht geht. Das wäre eine stille
 * Einschränkung von Patricks Regel („Online-Bestellungen unserer Märkte
 * zählen, dm ja"). Darum: Online-Bestellung ohne Endbetrag → Artikelsumme als
 * Endbetrag, vermerkt als `summeAusArtikeln: true` (wie v1.4, jetzt sichtbar).
 * Ob ein fremder Händler dahintersteht, entscheidet weiter der Markt-Resolver.
 * Nachprüfung 05.10.2026: dasselbe gilt für einen APP-Kassenbon (Lidl Plus …).
 * Ein langer App-Bon passt nicht auf einen Bildschirm; v1.4 setzte bei einem
 * Screenshot ohne sichtbare Summe die Artikelsumme ein und bezahlte, v1.5
 * liefert `totalCents: null` — ohne Ausgleich würde jeder solche Bon still als
 * reconciliation_delta abgelehnt (gemessen 1 von 10 App-Bons), gegen Patricks
 * „App-Kassenbons zählen" und ohne Schalter. Darum auch hier Artikelsumme +
 * `summeAusArtikeln: true`; ob die Summe Pflicht wird, entscheidet der Schalter
 * `cashback_config/v1.appSummePflicht` in index.js (Default false = wie v1.4).
 * Ein gedruckter Ladenbon ohne lesbare Summe bleibt ein Teilfoto.
 * Prüfrunde 2 (04.10.2026): damit geht der Abgleich auch für JEDE einzelne
 * Seite einer mehrseitigen Rechnung auf (echter Fall: dm-Bestellung, vier
 * Seiten binnen zwei Minuten). Dieselbe Person bekommt sie trotzdem nur einmal
 * bezahlt: Regel `seite` in lib/doppelBon.js (Schalter doppelOnlineSeite) —
 * gleicher Markt und Tag, beide Online-Bestellungen, eine ohne gedruckte Summe.
 * Nachprüfung 05.10.2026: ebenso jeder Bildschirmabschnitt EINES App-Bons
 * (echte Fälle Lidl 16.07. und 21.09.: zwei Scrollbilder, beide ohne Summe).
 * Die Regel deckt deshalb auch App-Bons (nur selber Tag) und ist per Code-
 * Default AN: diese Ergänzung wirkt ohne Schalter, also muss es ihr Schutz
 * auch — sonst zahlte schon der Deploy jeden Abschnitt einzeln.
 */

const BELEGARTEN = new Set(['kassenbon', 'app_kassenbon', 'online_bestellung', 'sonstiges']);
// Felder, die erst Prompt v1.5 liefert (lib/prompt.js).
const V15_FELDER = ['belegart', 'bestellnummer', 'bonComplete'];
// Belegarten, bei denen ein fehlender Endbetrag aus den Artikeln kommt: eine
// Rechnungsseite ohne Summe und ein App-Screenshot, auf dem sie weggescrollt ist.
const SUMME_AUS_ARTIKELN = new Set(['online_bestellung', 'app_kassenbon']);

// Wörter im Kopf (Händlerzeile, Zusatzzeile), die eine Bestellung verraten —
// auch ohne Belegart (Bestand vor v1.5, cv-hybrid, DocAI). Bewusst eng: ein
// Treffer nimmt einem Ladenbon nur die Filialadresse, nie das Geld.
const ONLINE_STICHWORT_RE = /liefer\s*-?\s*(adresse|anschrift)|rechnungs\s*-?\s*(adresse|anschrift)|bestell\s*-?\s*(nummer|nr\b)|auftrags\s*-?\s*(nummer|nr\b)/i;
// „Onlineshop" allein ist schwach: ein BILLA-Ladenbon wirbt im Kopf damit
// (bon_mu6iw4amnnalyq, mit Uhrzeit). Es zählt deshalb nur ohne Uhrzeit — die
// dm-Online-Rechnungen tragen fast nie eine (Suchlauf 04.10.2026).
const ONLINE_SCHWACH_RE = /online\s*-?\s*shop/i;

/** Steht im Kopf der Lesung ein Online-Stichwort? */
function onlineStichwort(parsed) {
  if (!parsed || typeof parsed !== 'object') return false;
  const kopf = [parsed.merchant, parsed.merchantSubtitle]
    .filter((v) => typeof v === 'string')
    .join('\n');
  if (ONLINE_STICHWORT_RE.test(kopf)) return true;
  return ONLINE_SCHWACH_RE.test(kopf) && !parsed.bonTime;
}

/**
 * Online-Merkmal einer Lesung: 'modell' (Belegart online_bestellung),
 * 'stichwort' (Kopf verrät eine Bestellung) oder null.
 */
function onlineMerkmal(parsed) {
  if (!parsed || typeof parsed !== 'object') return null;
  if (parsed.onlineMerkmal === 'modell' || parsed.onlineMerkmal === 'stichwort') return parsed.onlineMerkmal;
  if (parsed.belegart === 'online_bestellung') return 'modell';
  return onlineStichwort(parsed) ? 'stichwort' : null;
}

/**
 * Normalisiert die v1.5-Felder einer Lesung und entfernt bei einer Online-
 * Bestellung jede Anschrift aus dem Kopf. Gibt eine KOPIE zurück; idempotent.
 * @param {object} parsed  ocr.parsed
 * @returns {object}
 */
function belegBereinigen(parsed) {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return parsed;
  const out = { ...parsed };
  // Eine Lesung ohne jedes v1.5-Feld (Prompt v1.4 hinter dem Schalter
  // cashback_config/v1.ocrPrompt, Bestand, cv-hybrid, DocAI) bekommt keine
  // neuen Felder dazu — sie bleibt, wie v1.4 sie gespeichert hätte. Die
  // Anschrift-Bereinigung über Stichworte unten gilt trotzdem (Datenschutz).
  if (V15_FELDER.some((k) => Object.prototype.hasOwnProperty.call(out, k))) {
    const art = typeof out.belegart === 'string' ? out.belegart.trim().toLowerCase() : null;
    out.belegart = art && BELEGARTEN.has(art) ? art : null;
    // Bestellnummer nur bei einer Bestellung — auf einem Ladenbon wäre jede
    // Nummer eine Kassen-, Bon- oder Kundennummer.
    const nr = typeof out.bestellnummer === 'string' ? out.bestellnummer.trim().slice(0, 40) : null;
    out.bestellnummer = out.belegart === 'online_bestellung' && nr ? nr : null;
    out.bonComplete = out.bonComplete === true ? true : out.bonComplete === false ? false : null;
  }
  if (SUMME_AUS_ARTIKELN.has(out.belegart) && !Number.isFinite(out.totalCents) && Array.isArray(out.items)) {
    // Dieselbe Summe wie reconcile() in lib/ocr.js.
    const summe = out.items.reduce((acc, it) => acc + (it && Number.isFinite(it.priceCents) ? it.priceCents : 0), 0);
    if (summe > 0) {
      out.totalCents = summe;
      out.summeAusArtikeln = true;
    }
  }
  const merkmal = onlineMerkmal(out);
  if (merkmal) {
    out.onlineMerkmal = merkmal;
    out.merchantSubtitle = null;
    out.storeAddress = null;
  } else {
    delete out.onlineMerkmal;
  }
  return out;
}

/** Ist die Lesung laut Modell eine Online-Bestellung? (Grundlage für die Händlerregel.) */
function istOnlineBestellung(parsed) {
  return Boolean(parsed && parsed.belegart === 'online_bestellung');
}

module.exports = { BELEGARTEN, ONLINE_STICHWORT_RE, onlineStichwort, onlineMerkmal, belegBereinigen, istOnlineBestellung };
