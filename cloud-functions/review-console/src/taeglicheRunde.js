'use strict';
/**
 * Morgenrunde Produktfotos — jeden Tag 08:00 (Europe/Berlin).
 *
 * Macht, was bis zum 24.09.2026 von Hand lief: fehlende Angaben aus den Fotos
 * nachlesen, die Regeln der Prüfkonsole anwenden, die Bilder ansehen,
 * entscheiden und einen Tagesbericht mit Warnungen schreiben. Die Nachricht an
 * die Nutzer verschickt der Sammler in crowd-upload-reward (eine pro Person,
 * gebündelt über alle Freigaben — auch die aus der Prüfkonsole). Das Wissen dahinter steht in
 * WISSEN-FOTORUNDE.md — wer hier etwas ändert, ändert zuerst dort.
 *
 * WARUM DAS IN DER PRÜFKONSOLE LIEGT und nicht in einer eigenen Codebase: die
 * Doppel-Regel (`duplicatePolicy.js`) wird hier gepflegt. Ein Worker mit
 * eigener Kopie hätte den Fehler vom 20.09. wiederholt — ein Skript entschied
 * nach einer Regelfassung, die Stunden zuvor überholt war (8 von 14
 * Ablehnungen wären falsch gewesen).
 *
 * WAS ER ENTSCHEIDET (Entscheidung Patrick 24.09.: „beides automatisch")
 *   Freigaben und Ablehnungen, nach `fotoRundeRegeln.entscheideFall`.
 * WAS ER LIEGEN LÄSST (`wartetAufDich` im Bericht)
 *   Alles, was an unserer Technik hängt: Storage nicht lesbar, Bildprüfung
 *   oder Nachlesen am Google-Limit gescheitert, beschädigte Datei — alles,
 *   was die Notbremse zurückhält, und jede Abweichung der Barcode-Nummer.
 *   Mit `preisBildschirmRegel: true` auch ein Preisfoto, das vielleicht ein
 *   Bildschirmfoto ist (src/preisBildschirm.js, Patrick 04.10.2026), und mit
 *   `preisBelegRegel: true` einen „Kassenbon" ohne jedes Kassenbon-Merkmal
 *   oder von einem Händler, der keiner unserer Märkte ist (Entscheidung
 *   Claude im Auftrag Patricks, 04.10.2026; eigener Schalter seit der
 *   Nachprüfung 05.10.2026).
 *   Einreichungen gesperrter Konten liegen STUMM (eigener Zähler im Bericht,
 *   nicht in `wartetAufDich`).
 * WAS ER NIE TUT
 *   Geld buchen. Eine Freigabe setzt nur den Status; buchen tut
 *   `crowd-upload-reward`, wie bei jeder anderen Freigabe.
 *
 * Schalter: `cashback_config/v1.fotoWorker === true` → scharf. Sonst
 * Trockenlauf: liest, prüft, schreibt nur den Bericht (plus nachgelesene
 * Angaben in die eigenen *RescueOcr-Felder — die zählen danach in Runde UND
 * Prüfkonsole mit, siehe src/werte.js — und die Befunde für die Prüfkonsole:
 * `eanFotoOcr` und `review.rundeOffen`).
 *
 * WAS DIE KONSOLE VON DER RUNDE ERFÄHRT (Prüfrunde 2, 02.10.2026): jeder Fall,
 * der nach dem Lauf offen ist, trägt `review.rundeOffen` (Grund, Hinweis,
 * sperrende Befunde — fotoRundeRegeln.rundeOffenEintrag). Die Konsole kennt
 * weder den Foto-Abgleich noch die zweite Barcode-Lesung; ohne dieses Feld
 * stand ein Fall, den die Runde wegen eines Fotos eines anderen Kontos liegen
 * ließ, dort als „ok" mit Freigabe-Taste.
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');
const { FieldValue } = require('firebase-admin/firestore');
const logger = require('firebase-functions/logger');
const { GoogleGenAI } = require('@google/genai');
const { evaluateDuplicate, completenessCheck, dupZumSpeichern, appGrund, REASON } = require('./duplicatePolicy');
const {
  entscheideFall, bildBefund, fotoVorbefund, bildMitVorbefund, belegeVon, notbremse, nameAusLesungen, eanAusLesungen, rettungNichtGeschafft, rundeOffenEintrag, preisBildschirmGemeldet,
  BILD_GRUENDE, AUSSER_GESAMTQUOTE, KONTO_GESPERRT, EIGENE_BREMSEN,
} = require('./fotoRundeRegeln');
// Werte-Helfer gemeinsam mit der Prüfkonsole (index.js/einreichung.js) — eine Quelle.
const {
  eanOf, nameOf, preisOf, policyOf, einreichZeit, pruefzifferOk, vollstaendigkeitOf, preisHinweisOf, eanSchluessel, PREIS_ARTEN,
  eanFotoBefund, eanFotoBestaetigen, eanFotoOhneZweitlesung, eanFotoVorbefund, eanFotoMitVorbefund, eanFotoEintrag, EAN_HALTEN,
} = require('./werte');
const { SPERREN, ladeSperren, kontoSperreVon, sperreAusDaten } = require('./kontoSperre');
const { auffaelligkeiten } = require('./ort');
const { bildDefektOf } = require('./einreichung');
const { warnungen } = require('./warnungen');
const { mitWiederholung, arbeite, schlafe } = require('./ki');
const {
  modusPreisBildschirm, modusPreisBeleg, schalterRohOf, preisQuelleOf, lesedienstBonOf, lesedienstOhneBonOf, bildKopf, bildschirmMerkmal, preisBildschirmLage,
  preisBildschirmVorbefund, preisBildschirmMitVorbefund,
  PREIS_QUELLEN, PREIS_BILDSCHIRM, PREIS_BILDSCHIRM_UNSICHER, KOPF_BYTES,
  BELEG_MERKMALE, PREIS_BELEG_UNSICHER, BELEG_OHNE_MERKMALE, BELEG_FREMDER_HAENDLER,
  belegMerkmaleOf, belegHaendlerOf, lesedienstKopfOf, preisBelegBefund, marktSchluessel, keinBonVon,
  REGEL_BILDSCHIRM, REGEL_BELEG, preisBildschirmZaehlart,
} = require('./preisBildschirm');

const COL = 'crowd_uploads';
const BERICHTE = 'ops_tagesberichte';
const REQUIRED = ['front', 'rueckseite', 'hersteller', 'ean', 'naehrwerte', 'zutaten', 'preis'];
// Bild-Wiederverwendung zählt nur für die produkt-identifizierenden Fotos:
// ein gemeinsames Regal-Preisschild zweier Sorten ist plausibel (Befund 13.09.).
const IDENTITY_SLOTS = new Set(['front', 'rueckseite', 'hersteller', 'ean', 'naehrwerte', 'zutaten']);
const MODELL = 'gemini-3.5-flash';
// 4 parallel: mit 8 liefen am 24.09. zwei Durchgänge zu je ~8 % ins Google-Limit.
const PARALLEL_KI = 4;
const ENTSCHEIDER = 'worker-fotorunde';
// Nach dieser Zeit beginnt die Runde nichts Neues mehr; der Rest ist morgen dran.
// Die Function darf 30 Minuten laufen — Luft für Schreiben und Buchungs-Abwarten.
const ARBEITSZEIT_MS = 18 * 60 * 1000;
/** Präfix aller Produktfoto-Dateien — für den Abgleich gegen ALLE früheren Einreichungen. */
const UPLOAD_PRAEFIX = 'crowduploads/';
/** Ab hier gilt ein geplanter Nachlauf des Lesedienstes als hängend (Takt: 15 min). */
const NAMER_HAENGT_MS = 2 * 60 * 60 * 1000;
const BUCHUNG_WARTEN_MS = 5 * 60 * 1000;
/** Bildkopf des Preisfotos: Zeitgrenze je Abruf und für den ganzen Schritt (Bildschirmfoto als Preisbeleg). */
const KOPF_ZEIT_MS = 20 * 1000;
const KOPF_SCHRITT_MS = 3 * 60 * 1000;
/** Konto beim Schreiben gesperrt vorgefunden (Schritt 7) — liegt wie KONTO_GESPERRT stumm. */
const KONTO_GESPERRT_IM_LAUF = 'konto_gesperrt_im_lauf';

const ms = (v) => (v && typeof v.toMillis === 'function' ? v.toMillis() : typeof v === 'number' ? v : null);
const fmtDate = (m) => (m ? new Date(m).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Europe/Berlin' }) : null);
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const berlinTag = (t) => new Date(t).toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' });
const berlinZeit = (t) => new Date(t).toLocaleTimeString('sv-SE', { timeZone: 'Europe/Berlin' }).replace(/:/g, '');

/** Interner Vermerk am Dokument. Was der NUTZER liest, steht in
 *  lib/utils/productSubmissionCopy.ts (REASON_COPY) — jeder Grund hier braucht dort einen Eintrag. */
function noteFor(reason, ctx = {}) {
  const until = fmtDate(ctx.lockUntil);
  switch (reason) {
    case REASON.SAME_USER_WEEK: return `Dieses Produkt hast du diese Woche schon eingereicht — die erste Einreichung zählt. Ab ${until || 'nächster Woche'} zählt derselbe Artikel wieder.`;
    case 'unvollstaendig': return `Es fehlen Fotos (${(ctx.missing || []).join(', ') || 'siehe Liste'}). Mit allen sieben Ansichten klappt es beim nächsten Mal.`;
    case 'ean_fehlt': return 'Der Barcode (EAN, 8–14 Ziffern) ordnet das Produkt eindeutig zu — beim nächsten Mal bitte scannen oder eintippen.';
    case 'kein_produktname': return 'Der Produktname war nicht erkennbar — Vorderseite gut ausgeleuchtet und ohne Spiegelung, dann passt es.';
    case 'bilder_wiederverwendet': return 'Dieselben Fotos wurden schon für eine andere Einreichung verwendet — jedes Produkt braucht eigene Aufnahmen.';
    case 'fotos_unpassend': return 'Die Fotos zeigen nicht das erwartete Produkt oder nicht die verlangten Ansichten.';
    case 'gleiche_ansicht_mehrfach': return 'Fast alle Fotos zeigen dieselbe Ansicht — Zutaten, Nährwerte, Hersteller und Preis brauchen wir einzeln.';
    case 'preis_fehlt': return 'Auf dem Preisfoto war kein Preis zu sehen — beim nächsten Mal das Preisschild am Regal oder den Kassenbon fotografieren.';
    case PREIS_BILDSCHIRM: return 'Das Preisfoto zeigt einen Bildschirm (App, Online-Shop, Prospekt) — der Preis zählt vom Preisschild im Markt oder vom Kassenbon, gern auch als e-Bon.';
    default: return 'Danke fürs Einreichen — beim nächsten Datensatz geht es weiter.';
  }
}

/* ─────────────────────────── Anweisungen an das Modell ─────────────────────────── */
// Sie entscheiden mit, was freigegeben wird — deshalb gehen sie in die
// Regelversion ein (regelVersion): eine geänderte Anweisung meldet der
// Bericht wie eine geänderte Regel.

const PROMPT_NAME = 'Lies den PRODUKTNAMEN von der Verpackung. JSON: {"name":"…","sicher":true|false}. name = Marke + Bezeichnung + Sorte, ohne Menge und Preis. Nicht zweifelsfrei lesbar → name leer, sicher false.';
const PROMPT_EAN = 'Lies die EAN/GTIN unter dem Strichcode. JSON: {"ean":"nur Ziffern","sicher":true|false}. Vollständig und in gedruckter Reihenfolge. Nicht zweifelsfrei lesbar oder kein Strichcode → leer. Nichts raten.';
const PROMPT_PREIS = [
  'Lies zwei Angaben, sonst nichts. JSON: {"priceCents":0,"priceImageKind":"","manufacturer":""}.',
  'priceCents: Verkaufspreis DIESES Produkts in Cent (1,99 € → 199), vom Regal-Preisschild oder der Bon-Zeile.',
  'NICHT den Grundpreis (€/kg), NICHT den durchgestrichenen Preis, NICHT die Bon-Endsumme. Kein Preis sichtbar → 0.',
  'priceImageKind: "preisschild" | "kassenbon" | "beides" | "produktfoto" | "sonstiges".',
  'manufacturer: Inverkehrbringer laut Verpackung als Firmenname ohne Adresse. Nicht lesbar → leer.',
  'Nichts raten — ein erfundener Wert ist schlechter als ein leeres Feld.',
].join('\n');
const AUDIT_ZEILEN = Object.freeze([
  'Erwartung je Schritt: front=Vorderseite, rueckseite=Rückseite, hersteller=Hersteller-/Adressangabe, ean=Barcode, naehrwerte=Nährwerttabelle, zutaten=Zutatenliste, preis=Preisschild oder Bon.',
  'JSON: {"echt":true|false,"loseWare":true|false,"traegtAngaben":true|false,"gleicheAnsicht":true|false,"preisSichtbar":true|false|null,"eanFoto":"","grund":"kurz"}.',
  'echt=false NUR bei eindeutigem Ausschluss: kein reales Produkt, abfotografierter Bildschirm, fremde Motive, Schritte grob falsch belegt.',
  'Unscharf, angeschnitten oder zwei vertauschte Schritte = trotzdem echt=true.',
  // 26.09.2026 (Entscheidung Patrick): der Preis ist Pflicht. Die Frage
  // steht getrennt von „echt" — ein fehlender Preis macht die übrigen
  // Fotos nicht unecht, er wird eigens entschieden (fotoRundeRegeln.freigabe).
  'preisSichtbar: ist auf den Fotos ein lesbarer Verkaufspreis dieses Produkts zu sehen — meist auf dem Foto "preis": Preisschild am Regal, Waage-Etikett mit Preis, Preisaufkleber auf der Packung oder Kassenbon mit dem Artikel? Ein Preis auf einem anderen Foto dieser Einreichung zählt ebenfalls.',
  'preisSichtbar=false NUR, wenn eindeutig kein Preis zu sehen ist (das Preis-Foto zeigt nochmal das Produkt, den Tisch, den Einkaufswagen o. Ä.). Bist du unsicher — Preis angeschnitten, unscharf, Zuordnung zum Produkt unklar —, dann null.',
  'Ein fehlender Preis allein ist KEIN Grund für echt=false — dafür gibt es preisSichtbar.',
  'Ein und dasselbe Foto darf mehrere Schritte abdecken, wenn dort wirklich mehrere Angaben stehen — auf vielen Rückseiten stehen Zutaten, Nährwerte und Anschrift zusammen. Das ist KEIN Mangel.',
  // 24.09.2026: fünf von sieben Fotos zeigten nur den Barcode am Becherboden.
  // Vergleich am selben Tag: Nektarinen im Netz und Bergkäse von der Theke
  // wurden fälschlich als „dieselbe Ansicht" gewertet — beide tragen gar
  // keine Zutaten-/Nährwertangaben, ihr einziges Etikett war vollständig
  // fotografiert (vier unabhängige Gutachten). Deshalb die Frage getrennt:
  'traegtAngaben: trägt DIESES Produkt von Natur aus eine Zutatenliste oder Nährwerttabelle? false bei unverarbeitetem frischem Obst und Gemüse (auch im Netz, in der Schale, mit Banderole und echtem Barcode), frischen Kräutern, Eiern und Ware von der Frischetheke. true bei verarbeiteten, verpackten Lebensmitteln und bei Drogerieartikeln mit Inhaltsstoffliste.',
  'gleicheAnsicht=true NUR, wenn mindestens fünf Fotos dasselbe Motiv zeigen UND dadurch Angaben fehlen, die dieses Produkt tatsächlich trägt (z. B. Zutaten und Nährwerte stehen auf der Packung, fotografiert wurde aber immer nur Vorderseite oder Barcode). Trägt das Produkt keine weiteren Angaben und ist sein Etikett lesbar fotografiert, ist gleicheAnsicht=false.',
  'loseWare=true bei unverpackter Ware ohne Produkt-Barcode (Kräuterbund, Obst, Frischetheke mit Waage-Etikett).',
  // 02.10.2026 (Entscheidung Patrick, „Super-Vorschlag"): die Nummer vom
  // Barcode-Foto gegen die gespeicherte prüfen. Bewusst OHNE die gespeicherte
  // EAN im Auftrag (bildAudit nennt sie nicht mehr) — sonst schreibt das
  // Modell sie ab, statt zu lesen.
  'eanFoto: die Ziffern unter dem Strichcode auf dem Foto "ean", vollständig und in gedruckter Reihenfolge, nur Ziffern. Nicht vollständig und zweifelsfrei lesbar, kein Strichcode auf diesem Foto oder nur ein Waage-/Preisetikett → leer. Nichts raten, nichts ergänzen.',
]);
const AUDIT_ANWEISUNG = AUDIT_ZEILEN.join('\n');

// 04.10.2026 (Patrick: „ja, bau das"): Woher stammt der Preis? Wortgleich die
// Fassung, die am selben Tag gemessen wurde (scratchpad preisquelle/messen.js,
// FRAGE und JSON_NEU): im vollen Aufruf 40 von 40 Bildschirmfotos
// „bildschirm", keine von 54 schwierigen Gegenproben; nur mit dem Preisfoto
// 0 von 311 Nicht-Bildschirmen, 167 von 167 Kassenbons richtig. Wer hier ein
// Wort ändert, misst neu. Kostet ~440 Eingabe- und ~25 Ausgabe-Token je Fall
// im ohnehin laufenden Aufruf (~3 $ im Monat zum Listenpreis).
// Gefragt, sobald einer der beiden Schalter (`preisBildschirmRegel`,
// `preisBelegRegel`) nicht aus ist — der Preisbeleg braucht die Antwort
// „kassenbon".
// Mit den Unterfragen zum Kassenbon (unten) am 05.10.2026 neu gemessen: die
// Antworten auf preisQuelle blieben stabil (Bildschirmfotos 40/40, Laden
// 22/22, kein Preis 8/8, Kassenbons 166/167), siehe WISSEN-FOTORUNDE.md.
const PREIS_QUELLE_JSON = `"preisQuelle":"${PREIS_QUELLEN.join('|')}","preisQuelleGrund":"kurz"`;
const PREIS_QUELLE_FRAGE = Object.freeze([
  'preisQuelle: Woher stammt der Preis auf dem Foto "preis"? Genau einer dieser Werte:',
  '- "laden": im Geschäft fotografiert — Preisschild am Regal, auch ein elektronisches Preisschild (E-Paper-Etikett, kleines Display an der Regalkante), Waage-Etikett, Preisaufkleber auf der Packung, Aktionsschild oder Plakat im Markt, Display an Waage, Selbstbedienungskasse oder Preisterminal im Markt.',
  '- "kassenbon": Kassenbon oder Rechnung, gedruckt oder digital — auch ein Bildschirmfoto eines e-Bons, eines Bons in einer Händler-App oder einer Rechnung, auch nur ein Ausschnitt mit Bon-Zeilen.',
  '- "bildschirm": Bildschirmfoto oder abfotografierter Bildschirm, der KEIN Bon ist — Produktseite einer Händler-App oder eines Online-Shops, Online-Prospekt, Suchergebnis (z. B. Google), Vergleichs-App, KI-Antwort. Erkennbar z. B. an Statusleiste mit Uhrzeit/Akku, Adress- oder Suchleiste, Knöpfen wie „In den Warenkorb", Bewertungssternen, freigestelltem Produktbild auf weißem Grund, Bildschirmraster. Zeigt ein Bildschirmfoto seinerseits ein Foto eines Preisschilds (etwa in einer Such- oder Vergleichs-App), ist es "bildschirm".',
  '- "keiner": auf dem Foto "preis" ist kein Preis zu sehen.',
  '- "unklar": nicht sicher zuzuordnen, z. B. ein Werbeprospekt aus Papier oder du schwankst zwischen zwei Werten.',
  'Ein e-Bon oder eine Rechnung ist immer "kassenbon", auch als Bildschirmfoto. Ein elektronisches Preisschild im Regal ist immer "laden".',
  'preisQuelleGrund: woran du die Quelle erkennst, höchstens zehn Wörter.',
]);
// 05.10.2026 (Entscheidung Claude im Auftrag Patricks, 04.10.: „Kannst du
// selbst entscheiden?"): zwei Unterfragen zum Kassenbon im SELBEN Aufruf —
// zeigt der Beleg Merkmale eines abgeschlossenen Einkaufs (Warenkorb-Lücke),
// und von welchem Händler stammt er (Rechnungen fremder Händler)? Ausgewertet
// in src/preisBildschirm.js (preisBelegBefund), nur bei „kassenbon"; beide
// Befunde lassen nur liegen, nie ab. Wortgleich die Fassung, die am 05.10.
// gemessen wurde (scratchpad pb-beleg/) — wer hier ein Wort ändert, misst neu.
// Nur gefragt, wenn `preisBelegRegel` nicht aus ist.
const PREIS_BELEG_JSON = `"belegHaendler":"…","belegMerkmale":["${BELEG_MERKMALE.join('|')}"]`;
const PREIS_BELEG_FRAGE = Object.freeze([
  'Nur wenn preisQuelle "kassenbon" ist — sonst belegHaendler leer und belegMerkmale eine leere Liste:',
  'belegHaendler: von welchem Geschäft bzw. welcher Handelskette stammt der Beleg — nach Name, Logo oder Kopf (z. B. "REWE", "EDEKA", "Lidl", "dm", "Amazon")? Bei einem inhabergeführten Markt die Kette, nicht den Inhaber. Nicht erkennbar → leer. Nichts raten.',
  'belegMerkmale: welche dieser Merkmale eines abgeschlossenen Einkaufs sind auf dem Foto "preis" zu sehen? Jedes zutreffende aus: "haendler" (Name oder Logo des Geschäfts), "datum" (Kaufdatum oder Uhrzeit), "summe" (Summe, Gesamtbetrag oder „zu zahlen"), "nummer" (Bon-, Kassen-, Beleg-, Rechnungs- oder Bestellnummer, TSE-Angaben), "zahlung" (bar, Karte, EC, Rückgeld), "steuer" (MwSt.-Aufstellung oder Steuerkennzeichen wie A/B hinter den Preisen). Ist keines davon zu sehen — etwa nur Artikelzeilen mit Preisen, ein Warenkorb oder eine Einkaufsliste —, dann eine leere Liste.',
]);
/**
 * Prüfanweisungen mit den Zusatzfragen: JSON-Zeile erweitert, Fragen am Ende —
 * je wortgleich wie gemessen:
 *  - nur Preisquelle (Preisbeleg aus): die Fassung vom 04.10.2026;
 *  - Preisquelle + Unterfragen zum Kassenbon: die Fassung vom 05.10.2026.
 */
const AUDIT_ANWEISUNG_PREISQUELLE = AUDIT_ZEILEN
  .map((z) => (z.startsWith('JSON: {') ? z.replace('"grund":"kurz"}', `"grund":"kurz",${PREIS_QUELLE_JSON}}`) : z))
  .concat(PREIS_QUELLE_FRAGE)
  .join('\n');
const AUDIT_ANWEISUNG_PREISBELEG = AUDIT_ZEILEN
  .map((z) => (z.startsWith('JSON: {') ? z.replace('"grund":"kurz"}', `"grund":"kurz",${PREIS_QUELLE_JSON},${PREIS_BELEG_JSON}}`) : z))
  .concat(PREIS_QUELLE_FRAGE, PREIS_BELEG_FRAGE)
  .join('\n');

/* ─────────────────────────── Bilder lesen ─────────────────────────── */

const teil = (bucket, slot, pfad) => [{ text: `— Foto "${slot}":` }, { fileData: { fileUri: `gs://${bucket}/${pfad}`, mimeType: 'image/jpeg' } }];

async function frage(ai, bucket, images, slots, text) {
  const parts = [];
  for (const s of slots) if (images[s]) parts.push(...teil(bucket, s, images[s]));
  parts.push({ text });
  const r = await mitWiederholung(() => ai.models.generateContent({
    model: MODELL,
    contents: [{ role: 'user', parts }],
    // MIT Denken: der Namer liest mit thinkingBudget 0 und übersieht dabei
    // genau die Angaben, die hier fehlen.
    config: { responseMimeType: 'application/json', temperature: 0, maxOutputTokens: 8000, thinkingConfig: { thinkingLevel: 'LOW' } },
  }));
  return JSON.parse(String(r.text ?? '').replace(/^```json\s*|```\s*$/g, ''));
}

/**
 * Fehlende Angaben nachlesen. Übernommen wird nur, was ZWEI unabhängige
 * Lesungen gleich lesen; alles landet in EIGENEN Feldern, damit messbar
 * bleibt, wie gut die Ersterkennung liest. Gibt zurück, was übernommen wurde
 * und woran das Nachlesen technisch scheiterte (das ist kein Urteil).
 * `preisArten`: was die beiden Lesungen von Preis/Hersteller im Preisfoto sahen,
 * auch wenn nichts übernommen wurde (Bildschirmfoto als Preisbeleg, Prüfrunde 3).
 */
async function rettungFuer(ai, bucket, ref, x, { schreiben = true } = {}) {
  const patch = {};
  const fehler = {};
  let preisArten = [];
  const offenName = !nameOf(x);
  const offenEan = !eanOf(x) && !!x.images?.ean;
  const offenPreis = !preisOf(x);
  const offenHersteller = !(x.manufacturerOcr && String(x.manufacturerOcr.name || '').trim()) && !x.manufacturerRescueOcr;
  if (!offenName && !offenEan && !offenPreis && !offenHersteller) return { patch: null, fehler, preisArten };

  if (offenName) {
    const p = PROMPT_NAME;
    try {
      const [a, b] = [await frage(ai, bucket, x.images, ['front', 'rueckseite'], p), await frage(ai, bucket, x.images, ['front', 'rueckseite'], p)];
      const r = nameAusLesungen(a, b);
      if (r.name) {
        patch.productNameRescueOcr = r.name;
        if (r.alternative) patch.productNameRescueAlternative = r.alternative;
      } else if (r.unsicher) fehler.name = 'lesungen_uneinig';
    } catch (e) { fehler.name = String(e.message).slice(0, 120); }
  }
  if (offenEan) {
    const p = PROMPT_EAN;
    try {
      const [a, b] = [await frage(ai, bucket, x.images, ['ean', 'rueckseite', 'front'], p), await frage(ai, bucket, x.images, ['ean', 'rueckseite', 'front'], p)];
      // Streng: unter den EAN-losen Einreichungen ist viel lose Ware, und ein
      // Modell, das nach einer Nummer gefragt wird, liefert dort gern die vom
      // Waage-Etikett (Befund 19.09.). Händlerinterne Codes (02, 20–29) bestehen
      // die Prüfziffer — deshalb die zweite Lesung.
      const r = eanAusLesungen(a, b, pruefzifferOk);
      if (r.ean) patch.eanRescueOcr = r.ean;
      else if (r.unsicher) fehler.ean = 'lesungen_uneinig';
    } catch (e) { fehler.ean = String(e.message).slice(0, 120); }
  }
  if (offenPreis || offenHersteller) {
    try {
      const r = await preisUndHersteller(ai, bucket, x, { preis: offenPreis, hersteller: offenHersteller });
      Object.assign(patch, r.patch);
      // Auch die Hersteller-Nachlesung liest das Preisfoto mit (gleiche Anweisung).
      preisArten = r.arten;
      if (r.preisUnsicher) fehler.preis = 'lesungen_uneinig';
    } catch (e) { fehler.preis = String(e.message).slice(0, 120); }
  }
  if (!Object.keys(patch).length) return { patch: null, fehler, preisArten };
  if (!schreiben) return { patch, fehler, preisArten };
  patch.rescueAt = FieldValue.serverTimestamp();
  patch.rescueQuelle = `${MODELL}/vertex mit Denken, zwei übereinstimmende Lesungen (Morgenrunde)`;
  await ref.set(patch, { merge: true });
  return { patch, fehler, preisArten };
}

/**
 * Preis und/oder Hersteller nachlesen — zwei Lesungen, übernommen nur bei
 * Übereinstimmung. Wirft bei technischen Fehlern (der Aufrufer entscheidet).
 *
 * `preisUnsicher`: der Preis wurde NICHT übernommen, aber mindestens eine
 * Lesung sah einen Preis oder ein Preisschild/einen Kassenbon. Dann darf die
 * Runde nicht „Preis fehlt" ablehnen (Preis-Pflicht 26.09.) — ein Mensch sieht hin.
 *
 * `arten`: die Bildart beider Lesungen (priceImageKind), normalisiert — auch
 * ohne Übernahme. Sahen sie verschiedene Preise, steht nichts am Dokument;
 * sah eine davon einen Kassenbon, ist das trotzdem ein Gegenzeichen gegen die
 * Ablehnung als Bildschirmfoto (preisBildschirm.lesedienstBonOf, Prüfrunde 3).
 */
async function preisUndHersteller(ai, bucket, x, { preis, hersteller }) {
  const patch = {};
  const p = PROMPT_PREIS;
  const slots = ['preis', 'hersteller', 'rueckseite', 'front'];
  const [a, b] = [await frage(ai, bucket, x.images || {}, slots, p), await frage(ai, bucket, x.images || {}, slots, p)];
  const ca = Number.isFinite(a.priceCents) && a.priceCents > 0 ? Math.round(a.priceCents) : null;
  const cb = Number.isFinite(b.priceCents) && b.priceCents > 0 ? Math.round(b.priceCents) : null;
  // Bei ~40 % der Einreichungen zeigt das „Preis"-Foto nur nochmal das Produkt.
  if (preis && ca && ca === cb && ca <= 20000 && PREIS_ARTEN.includes(String(a.priceImageKind || '').toLowerCase())) {
    patch.priceRescueOcr = { priceCents: ca, currency: 'EUR', priceImageKind: String(a.priceImageKind).toLowerCase() };
  }
  if (hersteller && a.manufacturer && norm(a.manufacturer) === norm(b.manufacturer)) {
    patch.manufacturerRescueOcr = { name: String(a.manufacturer).slice(0, 140) };
  }
  const sahPreis = (l) => (Number.isFinite(l.priceCents) && l.priceCents > 0) || PREIS_ARTEN.includes(String(l.priceImageKind || '').toLowerCase());
  const preisUnsicher = !!preis && !patch.priceRescueOcr && (sahPreis(a) || sahPreis(b));
  const arten = [a, b].map((l) => String((l && l.priceImageKind) || '').trim().toLowerCase()).filter(Boolean);
  return { patch, preisUnsicher, arten };
}


/**
 * Bildprüfung: sieht alle sieben Fotos an. Mit `preisQuelle` beantwortet sie
 * im selben Aufruf, woher der Preis stammt (Bildschirmfoto als Preisbeleg,
 * 04.10.2026), mit `beleg` zusätzlich die Unterfragen zum Kassenbon
 * (05.10.2026) — kein zusätzlicher Aufruf.
 */
async function bildAudit(ai, bucket, x, { preisQuelle = false, beleg = false } = {}) {
  const parts = [];
  for (const s of REQUIRED) if (x.images?.[s]) parts.push(...teil(bucket, s, x.images[s]));
  parts.push({
    text: [
      'Du prüfst eine Produkt-Einreichung (die Fotos sind oben je Schritt benannt).',
      // Ohne gespeicherte EAN: das Modell liest sie selbst (eanFoto) — mit der
      // erwarteten Nummer im Auftrag schriebe es sie ab (02.10.2026).
      `Erwartet: echtes Einzelhandels-Produkt "${nameOf(x) || 'unbekannt'}".`,
      !preisQuelle ? AUDIT_ANWEISUNG : beleg ? AUDIT_ANWEISUNG_PREISBELEG : AUDIT_ANWEISUNG_PREISQUELLE,
    ].join('\n'),
  });
  const r = await mitWiederholung(() => ai.models.generateContent({
    model: MODELL, contents: [{ role: 'user', parts }],
    config: { responseMimeType: 'application/json', temperature: 0, maxOutputTokens: 8000, thinkingConfig: { thinkingLevel: 'LOW' } },
  }));
  return bildAuditAntwort(JSON.parse(String(r.text ?? '').replace(/^```json\s*|```\s*$/g, '')), { preisQuelle, beleg: preisQuelle && beleg });
}

/**
 * Antwort der Bildprüfung → bereinigte Felder (rein, für Runde, Tests und
 * Messskripte). Wirft, wenn `echt` fehlt — dann gibt es kein Urteil.
 */
function bildAuditAntwort(roh, { preisQuelle = false, beleg = false } = {}) {
  // Gelegentlich kommt das Objekt in eine Liste verpackt zurück (gemessen
  // 05.10.2026: 1 von 272 Antworten) — derselbe Inhalt, kein Grund für einen
  // gescheiterten Fall. Mehr als ein Element ist keine eindeutige Antwort.
  const p = Array.isArray(roh) && roh.length === 1 ? roh[0] : roh;
  if (!p || typeof p !== 'object' || Array.isArray(p) || typeof p.echt !== 'boolean') throw new Error('Bildprüfung ohne verwertbare Antwort');
  return {
    echt: p.echt !== false, loseWare: p.loseWare === true, traegtAngaben: p.traegtAngaben !== false, gleicheAnsicht: p.gleicheAnsicht === true,
    // null = nicht beurteilt → die Runde lässt den Fall liegen, statt zu raten.
    preisSichtbar: typeof p.preisSichtbar === 'boolean' ? p.preisSichtbar : null,
    // Nur Ziffern; ob es eine gültige GTIN ist, prüft werte.eanFotoBefund.
    eanFoto: String(p.eanFoto ?? '').replace(/\D/g, '').slice(0, 14) || null,
    grund: String(p.grund || '').slice(0, 140),
    // Fehlt die Antwort oder ist sie unbekannt → null. Das ist kein Freispruch:
    // passen die Bildmerkmale, bleibt der Fall liegen (preisBildschirmBefund).
    ...(preisQuelle ? {
      preisQuelle: preisQuelleOf(p.preisQuelle), preisQuelleGrund: String(p.preisQuelleGrund || '').slice(0, 80) || null,
    } : {}),
    // Unterfragen zum Kassenbon (05.10.2026, src/preisBildschirm.js
    // preisBelegBefund) — nur, wenn gefragt (`preisBelegRegel` nicht aus).
    // belegMerkmale null = keine verwertbare Antwort — das ist kein Freispruch
    // (ohne Händlerkopf des Lesedienstes bleibt ein „Kassenbon" dann liegen).
    ...(preisQuelle && beleg ? {
      belegHaendler: belegHaendlerOf(p.belegHaendler), belegMerkmale: belegMerkmaleOf(p.belegMerkmale),
    } : {}),
  };
}

/**
 * Bildmerkmale des Preisfotos (src/preisBildschirm.js): die ersten KOPF_BYTES
 * der Datei — ~120 Abrufe à 192 KB am Tag. Ein Lesefehler ist kein Urteil:
 * `merkmal: null` zählt nie als „passt" (die Regel lehnt dann nicht ab).
 * Mit Zeitgrenze je Abruf: ein hängender Abruf darf die Runde nicht über ihre
 * Laufzeit schieben.
 */
async function preisFotoKopf(storage, x, zeitgrenzeMs = KOPF_ZEIT_MS) {
  const pfad = x.images && x.images.preis;
  if (!pfad) return { kopf: null, merkmal: null, fehler: 'kein_preisfoto' };
  let uhr = null;
  try {
    const [buf] = await Promise.race([
      storage.file(String(pfad)).download({ start: 0, end: KOPF_BYTES - 1 }),
      new Promise((_, nein) => { uhr = setTimeout(() => nein(new Error('zeit_abgelaufen')), zeitgrenzeMs); }),
    ]);
    const kopf = bildKopf(buf);
    return { kopf, merkmal: bildschirmMerkmal(kopf), fehler: null };
  } catch (e) {
    return { kopf: null, merkmal: null, fehler: String(e && e.message).slice(0, 120) };
  } finally {
    clearTimeout(uhr);
  }
}

/* ─────────────────────────── Hilfen ─────────────────────────── */

/**
 * Namen unserer Märkte (Collection `discounter`, ~20 Dokumente) für den
 * Händler-Abgleich des Preisbelegs. Nicht lesbar → `unlesbar`, und der
 * Abgleich nimmt nur die Ketten im Code (preisBildschirm.UNSERE_KETTEN — sie
 * decken alle heutigen Märkte ab). Kein Abbruch: der Abgleich lässt höchstens
 * liegen, und ein neu aufgenommener Markt bliebe nur bis zum nächsten Lauf
 * „fremd".
 */
async function ladeMaerkte(db) {
  try {
    const q = await db.collection('discounter').get();
    return { namen: q.docs.map((d) => d.get('name')).filter((n) => typeof n === 'string' && n.trim()), unlesbar: false };
  } catch (e) {
    logger.warn('discounter nicht lesbar — Händler-Abgleich nur mit festen Ketten', { fehler: String(e && e.message).slice(0, 160) });
    return { namen: null, unlesbar: true };
  }
}

function regelVersion(preisBildschirmModus, preisBelegModus) {
  const h = crypto.createHash('sha1');
  // werte.js gehört dazu: es bestimmt, welche EAN, welcher Preis und welcher
  // Hersteller in die Regeln eingehen; ort.js, wann der Aufnahmeort auffällt.
  // kontoSperre.js: welche Konten als gesperrt gelten (02.10.2026).
  // preisBildschirm.js: Bildschirmfoto als Preisbeleg (04.10.2026).
  for (const f of ['duplicatePolicy.js', 'fotoRundeRegeln.js', 'werte.js', 'ort.js', 'kontoSperre.js', 'preisBildschirm.js']) h.update(fs.readFileSync(path.join(__dirname, f)));
  // Ebenso die Anweisungen an das Modell: sie entscheiden mit (Gegenprüfung 26.09.).
  h.update([PROMPT_NAME, PROMPT_EAN, PROMPT_PREIS, AUDIT_ANWEISUNG, AUDIT_ANWEISUNG_PREISQUELLE, AUDIT_ANWEISUNG_PREISBELEG].join('\n'));
  // Und die Schalter der Bildschirm-Regel und des Preisbelegs: von 'shadow'
  // auf true entscheidet die Runde anders — der Bericht meldet das wie eine
  // geänderte Regel.
  h.update(`preisBildschirmRegel=${String(preisBildschirmModus)};preisBelegRegel=${String(preisBelegModus)}`);
  return h.digest('hex').slice(0, 10);
}

/** Ablehnungsquote der letzten 30 Tage (nach Entscheidungszeit). */
function schnittQuote(alle, jetzt) {
  const ab = jetzt - 30 * 24 * 60 * 60 * 1000;
  let fr = 0; let ab2 = 0;
  for (const d of alle) {
    const t = ms(d.x.reviewedAt);
    if (!t || t < ab) continue;
    if (d.x.status === 'approved') fr++;
    // Gründe mit eigener Bremse zählen nicht mit — sonst verschöbe eine neue
    // oder verschärfte Regel den Vergleichswert der Gesamt-Notbremse (siehe
    // fotoRundeRegeln.notbremse). Die Wochen-Sperre steht am Dokument unter dem
    // App-Code (doppelt_eingereicht), ihr interner Grund in review.reason.
    else if (d.x.status === 'rejected' && !AUSSER_GESAMTQUOTE.has(d.x.rejectReason) && !AUSSER_GESAMTQUOTE.has(d.x.review && d.x.review.reason)) ab2++;
  }
  return fr + ab2 >= 30 ? ab2 / (fr + ab2) : null;
}

async function bonLage(db, jetzt) {
  const [review, letzte, cfg] = await Promise.all([
    db.collection('receipts').where('status', '==', 'review').select('createdAt').get(),
    db.collection('receipts').where('createdAt', '>=', admin.firestore.Timestamp.fromMillis(jetzt - 24 * 60 * 60 * 1000)).select('status', 'rejectReason', 'noRewardReason').get(),
    db.doc('cashback_config/v1').get(),
  ]);
  const aeltester = review.docs.map((d) => ms(d.get('createdAt'))).filter(Boolean).sort((a, b) => a - b)[0];
  const status = {}; const gruende = {}; let ohneAktion = 0;
  letzte.docs.forEach((d) => {
    const s = d.get('status') || '?'; status[s] = (status[s] || 0) + 1;
    const g = d.get('rejectReason') || d.get('noRewardReason');
    if (g) gruende[g] = (gruende[g] || 0) + 1;
    if (g === 'no_active_campaign') ohneAktion++;
  });
  // Zweitprüfung: die Bon-Pipeline zählt je BERLINER Tag
  // (cashback_referee_usage/{todayBerlin()}). Drei Tage lesen, damit das
  // Fenster wirklich mindestens 48 h abdeckt (um 08:00 wären zwei Tage nur ~32 h).
  const tage = [0, 1, 2].map((i) => berlinTag(jetzt - i * 24 * 60 * 60 * 1000));
  const nutzung = await Promise.all(tage.map((t) => db.doc(`cashback_referee_usage/${t}`).get()));
  const schalter = cfg.get('ocrReferee');
  return {
    bons: {
      inPruefung: review.size,
      aeltesteTage: aeltester ? Math.floor((jetzt - aeltester) / (24 * 60 * 60 * 1000)) : null,
      letzte24h: { gesamt: letzte.size, status, gruende, ohneAktion },
    },
    zweitpruefung: {
      eingeschaltet: schalter === true || schalter === 'shadow',
      modus: schalter ?? null,
      laeufeLetzte48h: nutzung.reduce((s, d) => s + (Number(d.get('runs')) || 0), 0),
    },
    fotoWorkerScharf: cfg.get('fotoWorker') === true,
    bonWorkerScharf: cfg.get('bonWorker') === true,
  };
}

async function aktionsLage(db) {
  const s = await db.collection('cashback_campaigns').get();
  return s.docs.map((d) => ({
    id: d.id, kind: d.get('kind') || null, active: d.get('active') === true,
    startAt: ms(d.get('startAt')) || 0, endAt: ms(d.get('endAt')) || 0,
    budgetRemainingCents: d.get('budgetRemainingCents') ?? null, budgetTotalCents: d.get('budgetTotalCents') ?? null,
    cashbackPerBonCents: d.get('cashbackPerBonCents') ?? null,
  }));
}

/* ─────────────────────────── Der Lauf ─────────────────────────── */

/**
 * Alle Produktfoto-Dateien mit md5 und Größe — EINE Liste statt einer Abfrage
 * je Datei. Gemessen 02.10.2026: 28.741 Dateien in 6 Seiten, 3,4 s. Damit
 * lässt sich jedes Identitätsfoto gegen ALLE früheren Einreichungen prüfen
 * (Entscheidung Patrick 02.10.2026), nicht nur gegen die im Lauf offenen.
 * @returns {Promise<Map<string,{md5:string|null,size:number}>|null>} null = Liste gescheitert
 */
async function dateiListe(storage) {
  try {
    const out = new Map();
    let query = { prefix: UPLOAD_PRAEFIX, autoPaginate: false, maxResults: 5000, fields: 'items(name,md5Hash,size),nextPageToken' };
    for (;;) {
      const [files, next] = await storage.getFiles(query);
      for (const f of files) {
        // Mit `fields` liefert die Bibliothek rohe Objekte statt File-Instanzen.
        const m = f.metadata || f;
        out.set(f.name, { md5: m.md5Hash || null, size: Number(m.size) || 0 });
      }
      if (!next || !next.pageToken) return out;
      query = { ...query, pageToken: next.pageToken };
    }
  } catch (e) {
    logger.warn('Storage-Liste der Uploads gescheitert — heute keine Freigaben', { fehler: String(e && e.message).slice(0, 160) });
    return null;
  }
}

/**
 * @param {object} opts
 * @param {string[]} [opts.vergleich]  REIN RECHNEN über schon entschiedene Fälle:
 *   diese IDs gelten als offen (nur im Speicher), es wird nichts nachgelesen,
 *   nichts geschrieben und kein Bericht angelegt; zurück kommt der Plan.
 *   Zweck: eine Regel- oder Prompt-Änderung gegen echte Entscheidungen prüfen
 *   (erstmals 24.09.2026: Runde gegen die Handrunde desselben Tages).
 * @param {boolean} [opts.nurLesen]  Trockenlauf OHNE jeden Schreibvorgang über
 *   die heute offenen Fälle: liest nach und prüft (Ergebnisse nur im
 *   Speicher), schreibt weder nachgelesene Angaben noch `eanFotoOcr` noch
 *   einen Bericht; zurück kommt der Plan mit den Eingaben je Fall. Zweck: eine
 *   Regeländerung vor dem Ausrollen gegen echte Daten prüfen (erstmals
 *   02.10.2026, Wochen-Sperre). Der normale Trockenlauf (`dryRun`) schreibt
 *   dagegen Nachlesungen und Bericht.
 * @param {number} [opts.arbeitszeitMs]  Nach dieser Zeit beginnt die Runde nichts Neues mehr.
 * @param {*} [opts.preisBildschirmRegel]  Rohwert des Schalters der Bildschirm-Regel
 *   (`cashback_config/v1.preisBildschirmRegel`; false | 'shadow' | true, fehlt = null).
 * @param {*} [opts.preisBelegRegel]  Rohwert des Schalters des Preisbelegs
 *   (`cashback_config/v1.preisBelegRegel`; ebenso). index.js reicht beide aus
 *   seinem eigenen Lesen von cashback_config/v1 durch; fehlt einer
 *   (undefined), liest die Runde selbst — scheitert das, bricht sie ab
 *   (src/preisBildschirm.js modusPreisBildschirm, modusPreisBeleg).
 */
async function taeglicheRunde({ dryRun = false, projekt, bucketName, ausloeser = 'zeitplan', vergleich = null, nurLesen = false, arbeitszeitMs = ARBEITSZEIT_MS, preisBildschirmRegel, preisBelegRegel } = {}) {
  if (vergleich || nurLesen) dryRun = true;
  // Nachgelesene Angaben und die Foto-Nummer sind Tatsachen über die Fotos und
  // werden auch im normalen Trockenlauf gespeichert — nur nicht beim reinen Rechnen.
  const schreibtAngaben = !vergleich && !nurLesen;
  const db = admin.firestore();
  const bucket = bucketName || `${projekt}.appspot.com`;
  const ai = new GoogleGenAI({ vertexai: true, project: projekt, location: 'global' });
  const start = Date.now();
  const frist = start + arbeitszeitMs;
  const tag = berlinTag(start);
  const lauf = `${tag}_${berlinZeit(start)}${dryRun ? '_trocken' : ''}`;

  // Bildschirmfoto als Preisbeleg (Patrick 04.10.2026): Schalter
  // `cashback_config/v1.preisBildschirmRegel` — false | 'shadow' | true,
  // fehlt er oder ist er unbekannt, gilt 'shadow' (ein unbekannter Wert steht
  // gelb im Bericht, schalterRohOf). Ein NICHT LESBARER Schalter ist kein
  // Wert: in 'shadow' hielte ein Befund aus einem scharfen Lauf nichts mehr,
  // angehaltene Fälle würden ohne Menschen freigegeben (Prüfrunde 2,
  // 04.10.2026). index.js reicht den Wert aus seinem eigenen Lesen durch
  // (scheitert das, läuft gar nichts); liest die Runde selbst und scheitert,
  // bricht sie ab — wie bei jedem anderen Fehler beim Laden.
  // Preisbeleg „Kassenbon": EIGENER Schalter `preisBelegRegel`, gleiche Werte
  // (Nachprüfung 05.10.2026) — wer eine der beiden Regeln zurücknimmt, gibt
  // nur deren angehaltene Fälle frei, nie die der anderen
  // (preisBildschirm.preisBildschirmLage). Gelesen im selben Zug.
  let pbRoh = preisBildschirmRegel;
  let belegRoh = preisBelegRegel;
  if (pbRoh === undefined || belegRoh === undefined) {
    let cfg;
    try { cfg = (await db.doc('cashback_config/v1').get()).data() || {}; }
    catch (e) { throw new Error(`Schalter preisBildschirmRegel/preisBelegRegel nicht lesbar — Lauf abgebrochen (${String(e && e.message).slice(0, 120)})`); }
    if (pbRoh === undefined) pbRoh = cfg.preisBildschirmRegel ?? null;
    if (belegRoh === undefined) belegRoh = cfg.preisBelegRegel ?? null;
  }
  const pbModus = modusPreisBildschirm(pbRoh);
  const pbSchalter = schalterRohOf(pbRoh);
  const belegModus = modusPreisBeleg(belegRoh);
  const belegSchalter = schalterRohOf(belegRoh);
  // Die Frage nach der Preisquelle braucht jede der beiden Regeln (der
  // Preisbeleg greift nur bei „kassenbon"); den Bildkopf nur die Bildschirm-Regel.
  const preisFrage = pbModus !== false || belegModus !== false;

  // Märkte aus `discounter` für den Händler-Abgleich des Preisbelegs (05.10.2026,
  // preisBildschirm.preisBelegBefund) — nur mit eingeschaltetem Preisbeleg.
  const [alleSnap, sperren, maerkte] = await Promise.all([db.collection(COL).get(), ladeSperren(db), belegModus !== false ? ladeMaerkte(db) : Promise.resolve({ namen: null, unlesbar: false })]);
  const marktSchluesselHeute = marktSchluessel(maerkte.namen);
  // `zeit`: Server-Zeitpunkt des Dokuments (createTime) — die Regeln rechnen
  // damit, nicht mit dem vom Client geschriebenen `createdAt` (werte.einreichZeit).
  const alle = alleSnap.docs.map((d) => ({ id: d.id, ref: d.ref, x: d.data(), zeit: einreichZeit(d.data(), d.createTime) }));
  if (vergleich) {
    const ids = new Set(vergleich);
    // Die Entscheidung von damals ausblenden: Status wieder offen, Entscheidungs-
    // felder weg — nur im Speicher. Nachgelesene Angaben (*RescueOcr) bleiben,
    // die hätte die Runde genauso erzeugt.
    alle.forEach((d) => {
      if (!ids.has(d.id)) return;
      d.vorher = { status: d.x.status, rejectReason: d.x.rejectReason || null };
      d.x = { ...d.x, status: 'pending' };
      delete d.x.rejectReason; delete d.x.reviewedAt; delete d.x.review;
    });
  }
  const pending = alle
    .filter((d) => d.x.status === 'pending' && (!vergleich || d.vorher))
    .sort((a, b) => (a.zeit ?? 0) - (b.zeit ?? 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  // 0) Gesperrte Konten (Entscheidung Patrick 02.10.2026). Für sie wird nichts
  //    nachgelesen und nichts angesehen — sie bleiben ohnehin liegen.
  const kontoVon = new Map(pending.map((d) => [d.id, kontoSperreVon(sperren, d.x.userId)]));
  const zuBearbeiten = pending.filter((d) => kontoVon.get(d.id) !== 'gesperrt');

  // 1) Fehlende Angaben nachlesen
  const nachgelesen = { name: 0, ean: 0, preis: 0, hersteller: 0 };
  const rettungFehler = new Map();
  // Bildarten der Preis-Nachlesung dieses Laufs (auch ohne Übernahme) — für
  // das Lesedienst-Gegenzeichen der Bildschirm-Regel (Schritt 4a).
  const nachleseArten = new Map();
  const nichtNachgelesen = vergleich ? [] : await arbeite(zuBearbeiten, async (d) => {
    try {
      const { patch, fehler, preisArten } = await rettungFuer(ai, bucket, d.ref, d.x, { schreiben: schreibtAngaben });
      if (Object.keys(fehler).length) rettungFehler.set(d.id, fehler);
      if (preisArten && preisArten.length) nachleseArten.set(d.id, preisArten);
      if (patch) {
        Object.assign(d.x, patch);
        if (patch.productNameRescueOcr) nachgelesen.name++;
        if (patch.eanRescueOcr) nachgelesen.ean++;
        if (patch.priceRescueOcr) nachgelesen.preis++;
        if (patch.manufacturerRescueOcr) nachgelesen.hersteller++;
      }
    } catch (e) {
      rettungFehler.set(d.id, { alles: String(e.message).slice(0, 120) });
    }
  }, PARALLEL_KI, frist);
  nichtNachgelesen.forEach((d) => rettungFehler.set(d.id, rettungNichtGeschafft()));

  // 2) Bilddateien: leer, unlesbar, oder schon in einer FRÜHEREN Einreichung —
  //    gegen ALLE Einreichungen (Entscheidung Patrick 02.10.2026). Vorher nur
  //    gegen die im Lauf offenen; seit Beginn 1 Freigabe trotz identischem Foto
  //    einer eigenen älteren Freigabe, 2 mit Foto eines fremden Kontos.
  const storage = admin.storage().bucket(bucket);
  const liste = await dateiListe(storage);
  const metaVon = new Map();
  await arbeite(zuBearbeiten, async (d) => {
    const metas = await Promise.all(Object.entries(d.x.images || {}).map(async ([k, p]) => {
      const bekannt = liste && liste.get(String(p));
      if (bekannt) return { k, p, md5: bekannt.md5, size: bekannt.size };
      // Nicht in der Liste (gerade hochgeladen, anderer Pfad, Liste gescheitert): einzeln nachsehen.
      try { const [m] = await storage.file(String(p)).getMetadata(); return { k, p, md5: m.md5Hash || null, size: Number(m.size) || 0 }; }
      catch { return { k, p, md5: null, size: -1 }; }
    }));
    metaVon.set(d.id, metas);
  }, 20, null);
  // Gruppen gleicher Identitätsfotos: gleicher Speicherpfad oder gleiche Bytes
  // (md5, nur nicht-leere Dateien — alle leeren Dateien hätten dieselbe md5).
  const gruppen = new Map();
  const merke = (key, id) => { if (!gruppen.has(key)) gruppen.set(key, new Set()); gruppen.get(key).add(id); };
  for (const d of alle) {
    const eigene = metaVon.get(d.id);
    for (const [k, p] of Object.entries(d.x.images || {})) {
      if (!IDENTITY_SLOTS.has(k)) continue;
      merke(`p:${p}`, d.id);
      const m = eigene ? eigene.find((e) => e.k === k) : liste && liste.get(String(p));
      if (m && m.md5 && m.size > 0) merke(`m:${m.md5}`, d.id);
    }
  }
  const partnerVon = new Map();
  for (const ids of gruppen.values()) {
    if (ids.size < 2) continue;
    for (const i of ids) {
      if (!partnerVon.has(i)) partnerVon.set(i, new Set());
      for (const j of ids) if (j !== i) partnerVon.get(i).add(j);
    }
  }
  // Ließ sich der Foto-Befund eines Falls heute VOLLSTÄNDIG berechnen? Nein bei
  // gescheiterter Storage-Liste (ältere, schon entschiedene Einreichungen nur
  // über den Pfad) und bei einem Identitätsfoto, das nicht abrufbar ist oder
  // keine md5 trägt. Dann gilt der Befund des Vortags weiter
  // (fotoRundeRegeln.bildMitVorbefund, Schlussprüfung 03.10.2026).
  const fotoVollstaendig = (id) => liste != null
    && !(metaVon.get(id) || []).some((m) => IDENTITY_SLOTS.has(m.k) && (m.size < 0 || (m.size > 0 && !m.md5)));

  // 3) Vorprüfung, die ohne Reihenfolge auskommt
  const vor = new Map();
  for (const d of zuBearbeiten) {
    const x = d.x;
    const comp = completenessCheck(vollstaendigkeitOf(x), REQUIRED);
    const metas = metaVon.get(d.id) || [];
    vor.set(d.id, { comp, leer: metas.filter((m) => m.size === 0).map((m) => m.k), unlesbar: metas.filter((m) => m.size < 0).map((m) => m.k) });
  }

  // 4) Bildprüfung für alles, dem nicht schon ein Foto fehlt
  const zuPruefen = zuBearbeiten.filter((d) => { const v = vor.get(d.id); return !v.comp.problems.includes('unvollstaendig') && !v.leer.length && !v.unlesbar.length; });
  const audit = new Map(); const auditFehler = new Map();
  const nichtGeprueft = await arbeite(zuPruefen, async (d) => {
    try { audit.set(d.id, await bildAudit(ai, bucket, d.x, { preisQuelle: preisFrage, beleg: belegModus !== false })); }
    catch (e) { auditFehler.set(d.id, String(e.message).slice(0, 140)); }
  }, PARALLEL_KI, frist);
  nichtGeprueft.forEach((d) => auditFehler.set(d.id, 'zeit_abgelaufen'));

  // 4a) Bildmerkmale des Preisfotos (Bildschirmfoto als Preisbeleg, 04.10.2026)
  //     — nur für geprüfte Fälle; die Regel greift erst in der Freigabe, und
  //     dorthin kommt kein Fall ohne Bildprüfung. Auch bei „kassenbon":
  //     der Bericht zählt, wie viele e-Bons die Merkmale tragen (offene Frage
  //     an Patrick, preisBildschirm.preisBildschirmBefund).
  //     Eigene Zeitgrenze (3 min ab hier, auch wenn die Arbeitszeit schon um
  //     ist): was nicht mehr gelesen wird, gilt als „Merkmale unbekannt" und
  //     „Kopf nicht abrufbar" — nie ein Ablehnungsgrund, aber auch kein
  //     Freispruch: ohne Kopf gibt die Regel nichts frei (kopfGescheitert).
  //     Dazu das Gegenzeichen des Lesedienstes (lesedienstBonOf, aus dem
  //     Dokument inkl. der eben nachgelesenen Werte und der Bildarten einer
  //     ungeeinten Preis-Nachlesung): sah er einen Kassenbon, wird nie
  //     abgelehnt (Gegenprüfung 04.10.2026). Abgelehnt wird nur, wenn er das
  //     Preisfoto GELESEN und keinen Bon gesehen hat (Prüfrunde 3) — las er es
  //     nicht, bleibt ein „Bildschirm" liegen. Ein „Kassenbon" mit Merkmalen
  //     (oder ohne abrufbaren Kopf), den der Lesedienst las und nicht als Bon
  //     sah, wird nicht bezahlt, sondern liegen gelassen (lesedienstOhneBonOf,
  //     Prüfrunde 2).
  //     Den Bildkopf liest die Runde nur für die Bildschirm-Regel; ist nur der
  //     Preisbeleg an, bleibt er ungelesen (kein Abruf, kein Technikfehler).
  //     Jede Eingabe trägt beide Schalter (`modus`, `belegModus`) — was davon
  //     wirkt, entscheidet preisBildschirmLage je Regel (Nachprüfung 05.10.2026).
  const pbVon = new Map();
  if (preisFrage) {
    const mitKopf = (d, k) => {
      const a = audit.get(d.id);
      // Auch was die Preis-Nachlesung dieses Laufs sah, ohne dass der Preis
      // übernommen wurde (Prüfrunde 3, 04.10.2026): ein Bon-Zeichen dort zählt.
      const zusatz = nachleseArten.get(d.id) || [];
      // Preisbeleg „Kassenbon" (Entscheidung Claude im Auftrag Patricks,
      // 04.10.2026): ohne jedes Kassenbon-Merkmal (Warenkorb-Lücke) oder von
      // einem fremden Händler → liegen lassen (preisBelegBefund). Nur mit
      // eingeschaltetem Preisbeleg — sonst wurde nicht gefragt.
      const lesedienstHaendler = d.x.priceReceipt && typeof d.x.priceReceipt.merchant === 'string' ? d.x.priceReceipt.merchant.slice(0, 80) : null;
      const beleg = belegModus === false ? null : preisBelegBefund({
        quelle: a.preisQuelle ?? null, merkmale: a.belegMerkmale ?? null, haendler: a.belegHaendler ?? null,
        lesedienstKopf: lesedienstKopfOf(d.x), lesedienstHaendler, schluessel: marktSchluesselHeute,
      });
      const e = {
        modus: pbModus, belegModus, quelle: a.preisQuelle ?? null, grund: a.preisQuelleGrund ?? null,
        merkmal: k.merkmal, kopf: k.kopf, kopfFehler: k.fehler, kopfGescheitert: !!k.fehler,
        lesedienstBon: lesedienstBonOf(d.x, zusatz), lesedienstOhneBon: lesedienstOhneBonOf(d.x, zusatz),
        belegGrund: beleg ? beleg.grund : null,
        beleg: beleg ? { haendler: a.belegHaendler ?? null, merkmale: a.belegMerkmale ?? null, lesedienstHaendler, unser: beleg.unser, ohneMerkmale: beleg.ohneMerkmale, fremd: beleg.fremd } : null,
      };
      // Beobachteter Befund (beide Regeln, sofern ihr Schalter nicht aus ist).
      pbVon.set(d.id, { ...e, befund: preisBildschirmLage(e).befund });
    };
    const geprueft = zuPruefen.filter((d) => audit.has(d.id));
    if (pbModus !== false) {
      const ohneKopf = await arbeite(geprueft, async (d) => {
        mitKopf(d, await preisFotoKopf(storage, d.x));
      }, 20, Date.now() + KOPF_SCHRITT_MS);
      ohneKopf.forEach((d) => mitKopf(d, { kopf: null, merkmal: null, fehler: 'zeit_abgelaufen' }));
    } else {
      geprueft.forEach((d) => mitKopf(d, { kopf: null, merkmal: null, fehler: null }));
    }
  }

  // 4b) Nummer vom Barcode-Foto gegen die gespeicherte (Entscheidung Patrick
  //     02.10.2026). Gelesen im Aufruf der Bildprüfung — kein Zusatzaufruf.
  //     Eine ZWEITE Lesung allein des Barcode-Fotos (eanFotoBestaetigen) gibt
  //     es nur
  //      - bei einer Abweichung (gemessen ~3 %): dieselbe Nummer → bestätigt;
  //        die gespeicherte → gleich; sonst → unsicher (ebenfalls halten),
  //      - bei einer Lesung mit falscher Prüfziffer, die an mehr als zwei
  //        Stellen von der gespeicherten abweicht (`zweifelhaft`, Prüfrunde 2):
  //        die gespeicherte → gleich, sonst → unsicher.
  //     Mit Arbeitszeit-Grenze: was keine zweite Lesung mehr bekommt (Zeit,
  //     Technik), bleibt angehalten — nie freigegeben (eanFotoOhneZweitlesung).
  //     Ein Halte-Befund eines früheren Laufs (eanFotoVorbefund) gilt weiter,
  //     egal was heute gelesen wird — auch zwei Lesungen der gespeicherten
  //     Nummer heben ihn nicht auf (Schlussprüfung 03.10.2026). Nur ein Mensch
  //     in der Konsole entscheidet (force + Notiz).
  //     Am Dokument abgelegt (`eanFotoOcr`, als Ganzes ersetzt), damit die
  //     Prüfkonsole und der nächste Lauf dasselbe sehen.
  const eanFoto = new Map();
  const vorbefundVon = new Map();
  for (const d of zuBearbeiten) {
    const v = eanFotoVorbefund(d.x);
    if (v) vorbefundVon.set(d.id, v);
  }
  for (const d of zuPruefen) {
    const a = audit.get(d.id);
    if (a) eanFoto.set(d.id, eanFotoBefund(d.x.ean, a.eanFoto));
  }
  // Ein heutiges „gleich" braucht keine zweite Lesung: ohne alten Befund geht
  // es ohnehin weiter, mit altem Befund hebt es nichts auf.
  const zuBestaetigen = zuPruefen.filter((d) => {
    const b = eanFoto.get(d.id);
    return !!b && (b.art === 'abweichend' || b.art === 'zweifelhaft');
  });
  const ohneZweitlesung = await arbeite(zuBestaetigen, async (d) => {
    try {
      const zweit = await frage(ai, bucket, d.x.images || {}, ['ean'], PROMPT_EAN);
      eanFoto.set(d.id, eanFotoBestaetigen(eanFoto.get(d.id), zweit && zweit.sicher !== false ? zweit.ean : null));
    } catch (e) {
      eanFoto.set(d.id, eanFotoOhneZweitlesung(eanFoto.get(d.id), String(e.message)));
    }
  }, PARALLEL_KI, frist);
  ohneZweitlesung.forEach((d) => eanFoto.set(d.id, eanFotoOhneZweitlesung(eanFoto.get(d.id), 'zeit_abgelaufen')));
  for (const [id, v] of vorbefundVon) eanFoto.set(id, eanFotoMitVorbefund(eanFoto.get(id) || null, v));
  const refVon = new Map(pending.map((d) => [d.id, d.ref]));
  const eanFotoStand = { nichtGespeichert: 0, nichtGespeichertHalten: 0 };
  if (schreibtAngaben) {
    // Ein übernommener alter Befund wird nicht neu geschrieben — außer er stand
    // nur im Rückfall (`review.rundeOffen.eanFoto`), weil `eanFotoOcr` damals
    // nicht gespeichert werden konnte.
    const zuSpeichern = [...eanFoto.entries()].filter(([, b]) => !(b.vorbefund && b.vorbefund.quelle === 'eanFotoOcr'));
    await arbeite(zuSpeichern, async ([id, b]) => {
      try {
        await refVon.get(id).update({ eanFotoOcr: { ...eanFotoEintrag(b), at: FieldValue.serverTimestamp(), quelle: `${MODELL}/vertex, Bildprüfung der Morgenrunde`, lauf } });
      } catch (e) {
        // Die Konsole und der nächste Lauf sehen den Halte-Befund trotzdem:
        // er steht auch in review.rundeOffen (Schritt 7b). Gezählt, gemeldet.
        eanFotoStand.nichtGespeichert++;
        if (EAN_HALTEN.has(b.art)) eanFotoStand.nichtGespeichertHalten++;
        logger.warn('eanFotoOcr nicht gespeichert', { id, fehler: String(e.message).slice(0, 160) });
      }
    }, 20, null);
  }

  // 5) Chronologisch entscheiden — eine im selben Lauf entschiedene Einreichung
  //    ist für die nächste derselben EAN Referenz bzw. kein offener Vorgänger mehr.
  //    Gruppiert nach GTIN in jeder Schreibweise (eanSchluessel): „0" + EAN-13
  //    darf die Wochen-Sperre nicht umgehen (Prüfrunde 02.10.2026).
  const byEan = new Map();
  const merkeEan = (key, v) => { if (!byEan.has(key)) byEan.set(key, []); byEan.get(key).push(v); };
  alle.forEach((d) => {
    const e = eanOf(d.x);
    if (e) merkeEan(eanSchluessel(e), policyOf(d.id, d.x, d.zeit));
  });
  const statusJetzt = new Map(alle.map((d) => [d.id, d.x.status]));
  const nachbarn = (ean, ohneId) => (byEan.get(eanSchluessel(ean)) || []).filter((o) => o.id !== ohneId).map((o) => ({ ...o, status: statusJetzt.get(o.id) || o.status }));
  // Ablehngrund je Einreichung (intern, sonst der Code am Dokument) — für
  // bildBefund: Fotos einer als Doppel abgelehnten Einreichung zählen als wiederverwendet.
  const grundJetzt = new Map(alle.map((d) => [d.id, (d.x.review && d.x.review.reason) || d.x.rejectReason || null]));
  const infoVon = new Map(alle.map((d) => [d.id, { userId: d.x.userId ?? null, createdAt: d.zeit, ean: eanSchluessel(eanOf(d.x)) }]));
  const info = (id) => (infoVon.has(id) ? { ...infoVon.get(id), status: statusJetzt.get(id), grund: grundJetzt.get(id) } : null);
  // Ist das Produkt für diese Person bezahlt? (bildBefund: eine als Doppel
  // abgelehnte ältere Einreichung zählt nur dann als Beleg, Prüfrunde 2.)
  const freigabeVon = (uid, eanKey) => (byEan.get(eanKey) || []).some((o) => o.userId === uid && statusJetzt.get(o.id) === 'approved');
  const datumVon = (id) => { const t = infoVon.get(id) && infoVon.get(id).createdAt; return t ? fmtDate(t) : '?'; };
  const plan = [];
  for (const d of pending) {
    const kontoSperre = kontoVon.get(d.id);
    if (kontoSperre === 'gesperrt') {
      // Stumm liegen lassen (fotoRundeRegeln.entscheideFall) — der Status bleibt pending.
      const e = entscheideFall({ kontoSperre });
      plan.push({ ...d, ...e, comp: { ok: true, problems: [], missing: [] }, dup: { verdict: 'ok', reason: null, lockUntil: null }, audit: null, eingabe: { kontoSperre } });
      continue;
    }
    const v = vor.get(d.id);
    const andere = nachbarn(eanOf(d.x), d.id);
    const dup = eanOf(d.x) ? evaluateDuplicate(policyOf(d.id, d.x, d.zeit), andere) : { verdict: 'ok', reason: null, lockUntil: null };
    // Die Doppel-Prüfung zusätzlich unter der Nummer vom Barcode-Foto — eine
    // falsch getippte EAN soll die Wochen-Sperre nicht umgehen. Weicht die
    // Nummer ab, bleibt der Fall ohnehin liegen; der Befund steht im Hinweis.
    const ef = eanFoto.get(d.id) || null;
    let eanFotoHinweis = null;
    if (ef && ef.art === 'abweichend') {
      const dupFoto = evaluateDuplicate({ ...policyOf(d.id, d.x, d.zeit), ean: ef.gelesen }, nachbarn(ef.gelesen, d.id));
      eanFotoHinweis = `Barcode-Foto zeigt ${ef.gelesen}, gespeichert ist ${ef.gespeichert}`
        + (ef.bestaetigt === false ? ' (zweite Lesung gescheitert)' : '')
        + (dupFoto.verdict === 'locked' ? ` — unter der Foto-Nummer gibt es eine eigene Freigabe vom ${datumVon(dupFoto.priorId)} (Wochen-Sperre)`
          : dupFoto.verdict === 'hold' ? ' — unter der Foto-Nummer liegt eine ältere eigene, noch offene Einreichung' : '');
    }
    if (ef && ef.vorbefund) {
      // Halte-Befund eines früheren Laufs: sagen, dass er weiter gilt und was heute gelesen wurde.
      const basis = eanFotoHinweis || `Barcode-Foto: erste Lesung ${ef.gelesen || 'ungültig'}, zweite ${ef.zweit || 'nicht lesbar'}, gespeichert ist ${ef.gespeichert}`;
      const h = ef.heute;
      const heute = !h ? 'heute keine Bildprüfung'
        : h.art === 'kein_urteil' ? `heute kein Urteil${h.gelesen ? ` (${h.gelesen})` : ''}`
          : `heute ${h.art}${h.gelesen ? ` (${h.gelesen})` : ''}`;
      eanFotoHinweis = `${basis} — Befund vom ${ef.vorbefund.lauf || 'früheren Lauf'}, gilt bis zur Entscheidung in der Konsole; ${heute}`;
    }
    const rf = { ...(rettungFehler.get(d.id) || {}) };
    const gps = d.x.capture && d.x.capture.gps;
    const ort = gps ? auffaelligkeiten({ lat: gps.lat, lon: gps.lon, genauigkeitM: gps.accuracyM, erwartetesLand: d.x.marketLand, quelle: 'geraet' })
      .find((a) => a.art === 'ausland' || a.art === 'landabweichung' || a.art === 'simulator') : null;
    // Der Nachlauf des Lesedienstes läuft alle 15 min. Liegt sein Termin mehr
    // als zwei Stunden zurück, hängt er — dann entscheidet die Runde selbst
    // (sie liest ja ohnehin nach), statt den Fall ewig liegen zu lassen.
    const namerAb = ms(d.x.namerNachlesenAb);
    // Beschädigtes Preisfoto: vom Lesedienst erkannt, oder die Dateigröße ist
    // ein glattes Vielfaches von 512 KiB — genau dort brach der Android-Upload
    // ab (firebase-storage 22.0.1). Ein echtes JPEG endet praktisch nie so.
    const preisMeta = (metaVon.get(d.id) || []).find((m) => m.k === 'preis');
    const preisBildDefekt = bildDefektOf(d.x).some((b) => b.slot === 'preis') || !!(preisMeta && preisMeta.size > 0 && preisMeta.size % 524288 === 0);
    const eingabe = {
      kontoSperre, comp: v.comp, dup, leer: v.leer, unlesbar: v.unlesbar,
      bild: bildMitVorbefund(bildBefund(d.id, partnerVon.get(d.id) || [], info, freigabeVon), fotoVorbefund(d.x), { vollstaendig: fotoVollstaendig(d.id) }),
      fotoAbgleichFehlt: liste == null,
      eanFoto: ef, eanFotoHinweis,
      audit: audit.get(d.id) || null, auditFehler: auditFehler.get(d.id) || null, rettungFehler: rf,
      preisVorhanden: !!preisOf(d.x), preisHinweis: preisHinweisOf(d.x), ortAuffaellig: ort ? ort.text : null,
      namerLaeuft: namerAb != null && namerAb > start - NAMER_HAENGT_MS, preisBildDefekt,
      // Ein scharfer Befund eines früheren Laufs gilt weiter, auch ohne
      // heutige Bildprüfung — je Regel nur unter IHREM Schalter
      // (preisBildschirm.preisBildschirmMitVorbefund, Nachprüfung 05.10.2026).
      preisBildschirm: preisBildschirmMitVorbefund(pbVon.get(d.id) || null, preisBildschirmVorbefund(d.x), { bildschirm: pbModus, beleg: belegModus }),
    };
    const e = entscheideFall(eingabe);
    plan.push({ ...d, ...e, comp: v.comp, dup, audit: audit.get(d.id) || null, eingabe });
    if (e.entscheidung === 'freigeben') statusJetzt.set(d.id, 'approved');
    else if (e.entscheidung === 'ablehnen') { statusJetzt.set(d.id, 'rejected'); grundJetzt.set(d.id, e.grund); }
  }

  // 6) Notbremse
  const bremse = notbremse(plan, { schnittQuote: schnittQuote(alle, start) });

  if (vergleich || nurLesen) {
    return {
      notbremse: bremse,
      fotoAbgleich: { dateien: liste ? liste.size : null },
      kontoSperren: sperren ? [...sperren.values()].filter((x) => sperreAusDaten(x) === 'gesperrt').length : null,
      plan: plan.map((p) => ({
        id: p.id, userId: p.x.userId ?? null, name: String(nameOf(p.x) || '?').slice(0, 60), markt: p.x.marketName || null,
        entscheidung: p.entscheidung, grund: p.grund, hinweis: p.ctx?.hinweis || null, loseWare: !!p.loseWare, zurueckgehalten: p.zurueckgehaltenGrund || null,
        preisBildschirmFall: p.preisBildschirmFall || null,
        audit: p.audit || null, auditFehler: auditFehler.get(p.id) || null,
        // Eingaben inkl. der (nur im Speicher) nachgelesenen Werte — damit sich
        // ein Lauf nach alter Regel daneben rechnen lässt.
        eingabe: p.eingabe, policy: policyOf(p.id, p.x, p.zeit), vorher: p.vorher,
      })),
    };
  }

  // 7) Schreiben — chronologisch, also jede Referenz vor dem Fall, der sich auf sie stützt.
  //    `geschrieben`: was in diesem Lauf tatsächlich gespeichert wurde.
  const imPlan = new Set(plan.map((p) => p.id));
  const geschrieben = new Set();
  if (!dryRun) {
    for (const p of plan) {
      if (p.entscheidung === 'offen') continue;
      // Eine Ablehnung, die eine andere Einreichung als Beleg nimmt, nur mit
      // mindestens einem feststehenden Beleg (fotoRundeRegeln.belegeVon).
      const belege = belegeVon(p);
      if (belege && !belege.some((id) => !imPlan.has(id) || geschrieben.has(id))) {
        p.zurueckgehaltenGrund = p.grund;
        p.entscheidung = 'offen';
        p.grund = 'beleg_nicht_geschrieben';
        p.ctx = { ...(p.ctx || {}), hinweis: `Stützt sich auf ${belege.slice(0, 3).join(', ')} — dort wurde heute nichts gespeichert` };
        continue;
      }
      // Mit Doppel-Befund (Referenz, „Anders"): ohne ihn fehlt in der Prüfkonsole
      // genau bei den Sperr-Ablehnungen die Grundlage fürs Zurückholen.
      const precheck = {
        verdict: p.comp.ok ? (p.dup.verdict === 'ok' ? 'ok' : p.dup.verdict) : 'incomplete',
        reasons: [...p.comp.problems, ...(p.dup.reason ? [p.dup.reason] : [])],
        dup: dupZumSpeichern(p.dup),
      };
      // Die Antwort auf „Woher stammt der Preis?" (preisQuelle) bewusst NICHT
      // am Dokument: das liest der Einreicher selbst (firestore.rules), und
      // in der Beobachtungswoche stünde an jedem bezahlten Bildschirmfoto,
      // dass es erkannt wurde — eine Woche Vorwarnung. Antworten, Befunde und
      // Dateiangaben stehen im Tagesbericht (`preisBildschirm`, nur Admins);
      // eine Ablehnung trägt `review.reason: 'preis_bildschirm'`.
      const bild = p.audit ? { echt: p.audit.echt, loseWare: p.audit.loseWare, traegtAngaben: p.audit.traegtAngaben, gleicheAnsicht: p.audit.gleicheAnsicht, preisSichtbar: p.audit.preisSichtbar, grund: p.audit.grund } : null;
      try {
        // Ergebnis der Transaktion als Rückgabe, nicht als Flag aus dem Callback:
        // Firestore wiederholt den Callback bei Konflikten.
        const ausgang = await db.runTransaction(async (tx) => {
          const s = await tx.get(p.ref);
          if (!s.exists || s.data().status !== 'pending') return 'uebersprungen';
          // Die Runde dauert bis zu 18 min. Hat der Lesedienst in der Zeit doch
          // einen Preis oder ein Preisschild gefunden, ist „Preis fehlt" überholt
          // — nicht ablehnen, morgen neu entscheiden (Gegenprüfung 26.09.).
          if (p.grund === 'preis_fehlt' && (preisOf(s.data()) || preisHinweisOf(s.data()))) return 'uebersprungen';
          // Ebenso „Bildschirmfoto": erkennt der Lesedienst inzwischen einen
          // Kassenbon, widersprechen sich zwei Lesungen — nicht ablehnen
          // (preisBildschirm.preisBildschirmBefund), morgen neu entscheiden.
          if (p.grund === PREIS_BILDSCHIRM && lesedienstBonOf(s.data())) return 'uebersprungen';
          // Kontosperre im Moment des Schreibens nachlesen — vor JEDER
          // Entscheidung, auch vor einer Ablehnung (Schlussprüfung 03.10.2026):
          // war die Sperrliste beim Laden nicht lesbar, galten alle Konten als
          // `unbekannt` und ein gesperrtes wurde voll bearbeitet und sichtbar
          // abgelehnt. Gesperrt → unverändert liegen lassen (stumm). Lesefehler
          // → Wurf → offen (schreib_fehler), also weder Freigabe noch Ablehnung.
          const uid = s.data().userId;
          const sperre = uid ? sperreAusDaten((await tx.get(db.collection(SPERREN).doc(uid))).data()) : null;
          if (sperre === 'gesperrt') return KONTO_GESPERRT_IM_LAUF;
          if (p.entscheidung === 'freigeben') {
            tx.update(p.ref, {
              status: 'approved', reviewedAt: FieldValue.serverTimestamp(), reviewedBy: ENTSCHEIDER, updatedAt: FieldValue.serverTimestamp(),
              review: { precheck, decidedBy: ENTSCHEIDER, forced: false, bildAudit: bild, lauf },
              holdReasons: FieldValue.delete(), rejectReason: FieldValue.delete(),
              // KEINE Push-Merker setzen: die Nachricht schickt der Sammler in
              // crowd-upload-reward. Ein hier gesetztes `rewardPushSentAt` hielte
              // er für „schon verschickt" — die Person bekäme gar nichts.
              ...(p.loseWare ? { loseWare: { art: 'vom_bildaudit_erkannt', markiertAm: FieldValue.serverTimestamp() } } : {}),
              ...(p.ohneAngaben ? { frischwareOhneAngaben: true } : {}),
            });
          } else {
            // Am Dokument steht der Code, nach dem die APP ihren Text wählt
            // (appGrund, siehe duplicatePolicy.APP_GRUND); der interne Grund
            // bleibt in review.reason für Bericht, Notbremse und Auswertung.
            const code = appGrund(p.grund);
            tx.update(p.ref, {
              status: 'rejected', rejectReason: code, holdReasons: [...new Set([...(s.data().holdReasons || []), code])],
              reviewNote: noteFor(p.grund, p.ctx), reviewedAt: FieldValue.serverTimestamp(), reviewedBy: ENTSCHEIDER, updatedAt: FieldValue.serverTimestamp(),
              review: { precheck, decidedBy: ENTSCHEIDER, reason: p.grund, lockUntil: p.ctx.lockUntil || null, bildAudit: bild, lauf },
            });
          }
          return 'geschrieben';
        });
        if (ausgang === 'geschrieben') geschrieben.add(p.id);
        else if (ausgang === 'uebersprungen') p.uebersprungen = true;
        else {
          p.zurueckgehaltenGrund = p.grund;
          p.entscheidung = 'offen';
          p.grund = ausgang;
        }
      } catch (e) {
        // Ein einzelner Schreibfehler darf die Runde nicht abbrechen (kein
        // Bericht, restliche Fälle unentschieden, retryCount 0). Der Fall
        // bleibt pending und ist morgen wieder dran; der Bericht warnt rot.
        logger.warn('Entscheidung nicht geschrieben', { id: p.id, fehler: String(e.message).slice(0, 160) });
        p.zurueckgehaltenGrund = p.grund;
        p.entscheidung = 'offen';
        p.grund = 'schreib_fehler';
        p.ctx = { ...(p.ctx || {}), hinweis: String(e.message).slice(0, 120) };
      }
    }
  }

  // 7b) Was nach dem Lauf offen ist, mit Grund und sperrenden Befunden am
  //     Dokument (`review.rundeOffen`, Prüfrunde 2, 02.10.2026) — die
  //     Prüfkonsole leitet daraus `hold` ab (Freigabe nur mit force + Notiz).
  //     Auch im Trockenlauf (dann bleibt jeder Fall offen; `geplant` sagt,
  //     was die Runde getan hätte). Ein Eintrag eines früheren Laufs, der
  //     heute nicht mehr zutrifft, wird entfernt — außer seine Foto-Befunde
  //     gelten weiter (fotoRundeRegeln.bildMitVorbefund) oder er trägt die
  //     Sperre gegen eine Ablehnung (preisBildschirm.preisBildschirmEintrag);
  //     ein übersprungener Fall behält ihn unverändert. Gesperrte Konten:
  //     nichts (sie liegen stumm), auch nicht, wenn die Sperre erst beim
  //     Schreiben auffiel. In einer Transaktion: hat inzwischen jemand
  //     entschieden, bleibt das Dokument unberührt.
  const rundeOffenStand = { geschrieben: 0, entfernt: 0, fehler: 0, fehlerSperrend: 0 };
  if (schreibtAngaben) {
    const kandidaten = plan.filter((p) => p.grund !== KONTO_GESPERRT && p.grund !== KONTO_GESPERRT_IM_LAUF && !geschrieben.has(p.id));
    await arbeite(kandidaten, async (p) => {
      // Übersprungen (Status geändert, Preis bzw. Kassenbon inzwischen
      // gefunden): heute kein Urteil — der Eintrag des Vortags bleibt, wie er
      // ist. Vorher wurde er entfernt, und mit ihm, was weiter gelten soll,
      // etwa die Sperre gegen eine Ablehnung (preisBildschirm.preisBildschirmEintrag,
      // Nachprüfung 06.10.2026). Ein entschiedener Fall bekäme ohnehin nichts.
      if (p.uebersprungen) return;
      const eintrag = rundeOffenEintrag(p, { lauf, trocken: dryRun });
      const alt = !!(p.x.review && typeof p.x.review === 'object' && p.x.review.rundeOffen);
      if (!eintrag && !alt) return;
      try {
        const ausgang = await db.runTransaction(async (tx) => {
          const snap = await tx.get(p.ref);
          if (!snap.exists || snap.data().status !== 'pending') return null;
          tx.update(p.ref, { 'review.rundeOffen': eintrag ? { ...eintrag, at: FieldValue.serverTimestamp() } : FieldValue.delete() });
          return eintrag ? 'geschrieben' : 'entfernt';
        });
        if (ausgang) rundeOffenStand[ausgang]++;
      } catch (e) {
        rundeOffenStand.fehler++;
        // Auch ein scharfer Halt der Bildschirm-Regel: er ist nicht sperrend
        // (die Konsole gibt ohne Notiz frei), aber ohne den Eintrag kennt der
        // nächste Lauf ihn nicht (preisBildschirmVorbefund) und gäbe den Fall
        // bei einer anderen Lesung frei (Prüfrunde 2, 04.10.2026).
        if (eintrag && (eintrag.sperrend.length || (eintrag.preisBildschirm && eintrag.preisBildschirm.modus === true))) rundeOffenStand.fehlerSperrend++;
        logger.warn('review.rundeOffen nicht gespeichert', { id: p.id, fehler: String(e.message).slice(0, 160) });
      }
    }, 20, null);
  }

  // 8) Auf die Buchungen warten — nur für die Zahlen im Bericht (gebucht,
  //    Personen). Die Nachricht an die Nutzer verschickt der Sammler selbst.
  const freigegeben = plan.filter((p) => p.entscheidung === 'freigeben' && !p.uebersprungen);
  let gebucht = [];
  let buchungAusstehend = 0;
  if (!dryRun && freigegeben.length) {
    const bis = Date.now() + BUCHUNG_WARTEN_MS;
    let stand = [];
    for (;;) {
      stand = [];
      for (let i = 0; i < freigegeben.length; i += 100) {
        const snaps = await db.getAll(...freigegeben.slice(i, i + 100).map((p) => p.ref));
        snaps.forEach((s) => stand.push({ id: s.id, uid: s.get('userId'), rewardResult: s.get('rewardResult'), rewardCents: s.get('rewardCents'), grund: s.get('rewardNotCreditedReason') || null }));
      }
      if (stand.every((s) => s.rewardResult) || Date.now() > bis) break;
      await schlafe(15000);
    }
    gebucht = stand;
    buchungAusstehend = stand.filter((s) => !s.rewardResult).length;
  }

  // 9) Lage bei Bons und Aktionen, Warnungen
  const [lage, aktionen, vorher, bonSnap] = await Promise.all([bonLage(db, start), aktionsLage(db), db.doc(`${BERICHTE}/aktuell`).get(), db.doc(`ops_bonrunden/${tag}`).get().catch((e) => { logger.warn('ops_bonrunden nicht lesbar', { tag, fehler: String(e && e.message).slice(0, 160) }); return null; })]);
  // Ergebnis der Bon-Runde von 07:45 (src/bonRunde.js) in denselben Bericht.
  const bonRundeRoh = (d) => (({ laufAt, ...rest }) => ({ ...rest, laufAt: laufAt && laufAt.toMillis ? laufAt.toMillis() : null }))(d);
  // Ein Lesefehler beim Bon-Bericht darf den Tagesbericht nicht kosten — die
  // Entscheidungen der Foto-Runde sind zu diesem Zeitpunkt schon geschrieben
  // (Prüfrunde 4). Gilt nur für ops_bonrunden; die übrigen Lage-Abfragen oben
  // sind wie bisher ungeschützt.
  let bonRundeUnbekannt = bonSnap == null;
  let bonRundeHeute = bonSnap && bonSnap.exists ? bonRundeRoh(bonSnap.data()) : null;
  // Kein fertiger Bericht: läuft sie noch, oder ist sie abgebrochen? Nach
  // 15 min (Laufzeitgrenze der Function) steht ein Lauf-Dokument auf `laeuft`
  // nur noch, wenn die Function beendet wurde, ohne den Bericht zu schreiben.
  let bonAbgebrochen = false; let bonLaeuftNoch = false; let bonNachgereicht = null;
  if (bonSnap && !bonSnap.exists) {
    const laeufe = await db.collection('ops_bonrunden').where('tag', '==', tag).limit(10).get()
      .then((q) => q.docs).catch((e) => { logger.warn('ops_bonrunden-Läufe nicht lesbar', { tag, fehler: String(e && e.message).slice(0, 160) }); bonRundeUnbekannt = true; return []; });
    // Zwischen den beiden Lesevorgängen fertig geworden? Dann diesen Bericht nehmen.
    const fertig = laeufe.filter((d) => d.get('laeuft') === false)
      .sort((a, b) => ((b.get('laufAt')?.toMillis?.() || 0) - (a.get('laufAt')?.toMillis?.() || 0)))[0];
    if (fertig) bonNachgereicht = fertig.data();
    else laeufe.filter((d) => d.get('laeuft') === true).forEach((d) => {
      const at = d.get('laufAt'); const alt = at && at.toMillis ? Date.now() - at.toMillis() : Infinity;
      if (alt > 15 * 60 * 1000) bonAbgebrochen = true; else bonLaeuftNoch = true;
    });
  }
  if (bonNachgereicht) bonRundeHeute = bonRundeRoh(bonNachgereicht);
  const version = regelVersion(pbModus, belegModus);
  const zaehle = (liste, feld) => liste.reduce((a, p) => { const k = p[feld] || '?'; a[k] = (a[k] || 0) + 1; return a; }, {});
  const abgelehnt = plan.filter((p) => p.entscheidung === 'ablehnen' && !p.uebersprungen);
  // Notbremse: Ablehnungen, die eine Bremse an einem Vortag zurückgehalten
  // hatte und heute doch geschrieben wurden (im Trockenlauf: geplant), weil
  // sie nicht mehr griff — eigens gezählt und gelb gemeldet (Nachprüfung
  // 06.10.2026). Nach dem Schreiben gezählt: übersprungene oder nicht
  // geschriebene Fälle sind dann schon offen.
  const ausVortagenAbgelehnt = zaehle(abgelehnt.filter((p) => p.ausVortagAbgelehnt), 'ausVortagAbgelehnt');
  for (const [schalter, n] of Object.entries(ausVortagenAbgelehnt)) {
    const b = EIGENE_BREMSEN.find((x) => x.schalter === schalter);
    if (b && b.textAbgelehnt) bremse.gelb.push({ code: `notbremse_vortage_abgelehnt_${schalter}`, text: b.textAbgelehnt(n, dryRun) });
  }
  // Gesperrte Konten liegen stumm und dauerhaft — sie warten NICHT auf eine
  // Entscheidung und zählen deshalb getrennt (sonst füllten sie „wartet auf
  // dich" und die Warnung „wartet seit X Tagen" jeden Morgen).
  const gesperrtOffen = plan.filter((p) => p.entscheidung === 'offen' && p.grund === KONTO_GESPERRT);
  const eanHaltenNeu = [...eanFoto.values()].filter((b) => EAN_HALTEN.has(b.art) && !b.vorbefund).length;
  const offen = plan.filter((p) => p.entscheidung === 'offen' && p.grund !== KONTO_GESPERRT);
  // Bildschirmfoto als Preisbeleg (Patrick 04.10.2026). In der
  // Beobachtungswoche ist das die Messung: wie oft die Regel gegriffen hätte
  // und wie oft dadurch eine Freigabe weggefallen wäre (`stattFreigabe`).
  const pbAlle = [...pbVon.values()];
  // Fälle, die schon an einem Vortag mit Befund liegen blieben (Eintrag
  // `review.rundeOffen.preisBildschirm` am Dokument, scharf wie Beobachtung):
  // die beiden Widerspruchs-Zähler unten zählen sie nicht erneut, sonst kam
  // dieselbe Warnung „Lesung des Modells prüfen" jeden Morgen wieder, solange
  // der Fall auf Patrick wartet (Nachprüfung 06.10.2026; wie pbFrischGehalten).
  // „Schon gemeldet" heißt: von einem ECHTEN Lauf (fotoRundeRegeln.preisBildschirmGemeldet,
  // Abschlussprüfung 06.10.2026). Ein manueller Trockenlauf schreibt den
  // Eintrag, aber nie `aktuell` — galt er als gemeldet, fehlte die Warnung im
  // Morgen-Chat, ausgerechnet nach einem Kontroll-Trockenlauf nach einem Deploy.
  const pbSchonGemeldet = new Set(plan.filter((p) => {
    const ro = p.x && p.x.review && typeof p.x.review === 'object' ? p.x.review.rundeOffen : null;
    return !!preisBildschirmGemeldet(ro);
  }).map((p) => p.id));
  // Für die Zählung „heute" gegen „aus Vortagen" gilt dasselbe: ein Befund
  // eines früheren Laufs, den nur ein Trockenlauf gesehen hat, ist im Bericht
  // ein heutiger (entschieden wird mit ihm wie bisher — er hält weiter).
  // Sonst fehlten nach einem Trockenlauf auch „hält viele" und „statt Freigabe".
  const pbFallFuerBericht = (p) => {
    const f = p.preisBildschirmFall;
    if (!f || pbSchonGemeldet.has(p.id)) return f;
    const { vor, vorWirkt, ...heute } = f;
    return heute;
  };
  const pbAlleFrisch = [...pbVon].filter(([id]) => !pbSchonGemeldet.has(id)).map(([, e]) => e);
  const pbAlleAlt = [...pbVon].filter(([id]) => pbSchonGemeldet.has(id)).map(([, e]) => e);
  const istTrotzBon = (e) => e.quelle === 'bildschirm' && e.lesedienstBon;
  const istBonWiderspruch = (e) => e.quelle === 'kassenbon' && e.befund === 'halten' && keinBonVon(e);
  const pbFaelle = plan.filter((p) => p.preisBildschirmFall);
  // Je Regel und nur an EINEM Morgen gezählt (preisBildschirm.preisBildschirmZaehlart,
  // Nachprüfung 05.10.2026): ein reiner Preisbeleg-Fall nicht in den Zeilen
  // der Bildschirm-Regel, und ein Fall, den ein Befund eines früheren Laufs
  // weiter hält, nur unter „aus Vortagen" — nicht jeden Morgen erneut als
  // „statt Freigabe".
  const pbZaehl = new Map(pbFaelle.map((p) => [p.id, preisBildschirmZaehlart(pbFallFuerBericht(p), p.entscheidung)]));
  const pbFrisch = (regel) => pbFaelle.filter((p) => pbZaehl.get(p.id).frisch.includes(regel));
  const pbAusVortagen = (regel) => pbFaelle.filter((p) => pbZaehl.get(p.id).ausVortagen.includes(regel)).length;
  const pbSchirmFrisch = pbFrisch(REGEL_BILDSCHIRM);
  const pbBelegFrisch = pbFrisch(REGEL_BELEG);
  // Frische Halte-Befunde (ohne die eines früheren Laufs, die sonst täglich
  // dieselbe Warnung auslösten, solange der Fall auf Patrick wartet). Ein
  // früherer Befund, dessen Regel zurückgenommen ist, hält nichts mehr — hält
  // heute die andere Regel, ist das ein frischer Halt.
  const pbFrischGehalten = (grund) => plan.filter((p) => p.entscheidung === 'offen' && p.grund === grund && !(pbFallFuerBericht(p) && pbFallFuerBericht(p).vorWirkt)).length;
  const pbZaehle = (liste, f) => liste.reduce((a, x) => { const k = f(x); a[k] = (a[k] || 0) + 1; return a; }, {});
  const pbDatei = (e) => (e.kopf ? `${e.kopf.format} ${e.kopf.breite || '?'}×${e.kopf.hoehe || '?'}${e.kopf.kameraHersteller ? ' Kamera' : ''}` : (e.kopfFehler || null));
  // Prüfrunde 3 (04.10.2026): JEDER „Kassenbon", den der Lesedienst las und
  // NICHT als Bon sah — unabhängig von den Merkmalen. Mit Merkmalen bleibt er
  // liegen, ohne wird er bezahlt: Kamerafoto eines Papierbons, das der
  // Lesedienst falsch einordnet — oder ein auf Bon-Zeilen zugeschnittener
  // Warenkorb, als 4:3 ohne EXIF weitergegeben (WISSEN-FOTORUNDE.md, Lücken).
  // Gemessen 0 von 167 Kassenbons; die Zahl zeigt, ob der Weg genutzt wird.
  const pbKassenbonOhneBon = plan.filter((p) => {
    const e = pbVon.get(p.id);
    return e && e.quelle === 'kassenbon' && keinBonVon(e);
  });
  // Preisbeleg „Kassenbon" (05.10.2026): Befunde je Fall, unabhängig davon,
  // ob sie etwas ändern (Beobachtung = Messung). Nur mit eingeschaltetem
  // Preisbeleg — sonst wurde nicht gefragt, und jeder „Kassenbon" sähe aus
  // wie einer ohne Antwort.
  const pbKassenbon = belegModus === false ? [] : pbAlle.filter((e) => e.quelle === 'kassenbon');
  // Liste „Preisbeleg": heutige Befunde UND Fälle, die ein Preisbeleg-Befund
  // trägt (auch aus einem früheren Lauf, wenn heute nichts mehr gefunden wird).
  const pbRegelnVon = (p) => (p.preisBildschirmFall && Array.isArray(p.preisBildschirmFall.regeln) ? p.preisBildschirmFall.regeln : []);
  const pbBelegFaelle = plan.filter((p) => { const e = pbVon.get(p.id); return (e && e.belegGrund) || pbRegelnVon(p).includes(REGEL_BELEG); });
  // Liste oben: nur Fälle der Bildschirm-Regel (auch ein Halt nur wegen des Bildkopfs).
  const pbSchirmFaelle = pbFaelle.filter((p) => pbRegelnVon(p).includes(REGEL_BILDSCHIRM) || p.preisBildschirmFall.kopf === true);
  // Seit wann der Befund eines früheren Laufs steht (auch eine von der Notbremse zurückgehaltene Ablehnung).
  const pbSeit = (p) => {
    if (!p.preisBildschirmFall || !p.preisBildschirmFall.vorbefund) return null;
    const e = (p.eingabe && p.eingabe.preisBildschirm) || {};
    return (e.vorbefund && e.vorbefund.seit) || e.vorbefundSeit || 'früherer Lauf';
  };
  const preisBildschirm = {
    // Schalter der Bildschirm-Regel; der des Preisbelegs steht unter `beleg.modus`.
    modus: pbModus,
    // Rohwert, wenn er nicht false/'shadow'/true ist (gilt als Beobachtung, gelbe Warnung).
    ...(pbSchalter.art === 'unbekannt' ? { schalterUnbekannt: pbSchalter.roh } : {}),
    befragt: pbAlle.length,
    quellen: pbZaehle(pbAlle, (e) => e.quelle || 'ohne_antwort'),
    merkmal: pbZaehle(pbAlle, (e) => (e.merkmal === true ? 'ja' : e.merkmal === false ? 'nein' : 'unbekannt')),
    // Kassenbons mit Bildschirm-Merkmalen (meist e-Bons): bleiben unberührt,
    // außer der Lesedienst las das Foto und sah keinen Bon (eigene Zahl
    // unten) — nach wörtlicher Lesart („nur eins von beiden → liegen lassen")
    // lägen sie alle bei Patrick. Offene Entscheidung, hier gezählt.
    kassenbonMitMerkmal: pbAlle.filter((e) => e.quelle === 'kassenbon' && e.merkmal === true).length,
    // Bildprüfung „Bildschirm", Lesedienst „Kassenbon" — gemessen 0 von 167
    // Kassenbons; mehr deutet auf eine geänderte Lesart des Modells (Warnung).
    // Nur Fälle ohne Befund eines Vortags; die übrigen getrennt, ohne Warnung.
    bildschirmTrotzBon: pbAlleFrisch.filter(istTrotzBon).length,
    bildschirmTrotzBonAusVortagen: pbAlleAlt.filter(istTrotzBon).length,
    // Bildprüfung „Kassenbon", der Lesedienst las das Foto und sah KEINEN
    // Bon, und der Befund lautet „liegen lassen" (wirkt nur scharf, siehe
    // `…Liegt`) — gemessen 0 von 126 (Prüfrunde 2,
    // 04.10.2026). Mehr deutet auf eine geänderte Lesart oder auf
    // Warenkörbe/Bestellübersichten als „Bon" (Warnung
    // preisquelle_bon_widerspruch). NUR mit diesem Widerspruch: seit dem
    // Preisbeleg (05.10.2026) liegt ein „Kassenbon" auch ohne Merkmale oder
    // von einem fremden Händler, obwohl der Lesedienst den Bon sah — das zählt
    // `beleg` (Nachprüfung 05.10.: sonst 11 von 189 Kassenbons hier, alle mit
    // Lesedienst-Bon, und eine Warnung etwa einmal pro Woche ohne Grund).
    kassenbonOhneLesedienstBon: pbAlleFrisch.filter(istBonWiderspruch).length,
    // … davon heute wirklich angehalten (scharfe Regel) — in der Beobachtung
    // werden sie bezahlt, die Warnung sagt das (Nachprüfung 06.10.2026).
    kassenbonOhneLesedienstBonLiegt: pbAlleFrisch.filter((e) => istBonWiderspruch(e) && preisBildschirmLage(e, { scharf: true }).befund === 'halten').length,
    kassenbonOhneLesedienstBonAusVortagen: pbAlleAlt.filter(istBonWiderspruch).length,
    // Alle davon, auch ohne Merkmale (bezahlt) — mit Fällen zum Ansehen.
    kassenbonLesedienstOhneBon: pbKassenbonOhneBon.length,
    kassenbonLesedienstOhneBonFaelle: pbKassenbonOhneBon.slice(0, 20).map((p) => {
      const e = pbVon.get(p.id);
      return {
        id: p.id, name: String(nameOf(p.x) || '?').slice(0, 60), markt: p.x.marketName || null,
        entscheidung: p.uebersprungen ? 'uebersprungen' : p.entscheidung, merkmal: e.merkmal,
        lesedienst: String(p.x.priceImageKind || (p.x.priceRescueOcr && p.x.priceRescueOcr.priceImageKind) || '').slice(0, 20) || null,
        quelleGrund: e.grund || null, datei: pbDatei(e),
      };
    }),
    kopfNichtAbrufbar: pbAlle.filter((e) => e.kopfGescheitert).length,
    // Preisbeleg „Kassenbon" (Entscheidung Claude im Auftrag Patricks,
    // 04.10.2026): ohne Kassenbon-Merkmale (Warenkorb?) bzw. Beleg eines
    // Händlers, der keiner unserer Märkte ist (Amazon …). Gemessen 05.10.:
    // 3 von 166 echten Bons ohne Merkmale (eng zugeschnittene e-Bons), 5 von
    // 23 Bons inhabergeführter Märkte ohne Kettenlogo als „fremd";
    // Nachmessung: 4 von 41 Papierbon-Fotos ohne Lesedienst-Kopf (Ausschnitte).
    beleg: {
      // Eigener Schalter `preisBelegRegel` (Nachprüfung 05.10.2026).
      modus: belegModus,
      ...(belegSchalter.art === 'unbekannt' ? { schalterUnbekannt: belegSchalter.roh } : {}),
      kassenbon: pbKassenbon.length,
      ohneMerkmale: pbKassenbon.filter((e) => e.belegGrund === BELEG_OHNE_MERKMALE).length,
      fremderHaendler: pbKassenbon.filter((e) => e.belegGrund === BELEG_FREMDER_HAENDLER).length,
      // Ohne Regel freigegeben, mit scharfer Regel liegen geblieben — nur
      // heutige Befunde (ein Fall, den beide Regeln halten, zählt auch hier).
      stattFreigabe: pbBelegFrisch.filter((p) => p.preisBildschirmFall.ohneRegel === 'freigeben').length,
      // Liegt weiter wegen eines Preisbeleg-Befunds eines früheren Laufs.
      ausVortagen: pbAusVortagen(REGEL_BELEG),
      // Keine verwertbare Antwort auf „belegMerkmale" — ohne Händlerkopf des Lesedienstes bleibt der Fall dann liegen.
      merkmaleOhneAntwort: pbKassenbon.filter((e) => !e.beleg || e.beleg.merkmale === null).length,
      // Liste `discounter` nicht lesbar → Abgleich nur gegen die Ketten im Code (UNSERE_KETTEN).
      maerkteUnlesbar: !!maerkte.unlesbar,
      faelle: pbBelegFaelle.slice(0, 30).map((p) => {
        // Ein Fall aus einem früheren Lauf kann heute ohne Bildprüfung sein.
        const e = pbVon.get(p.id) || {};
        const b = e.beleg || {};
        return {
          id: p.id, name: String(nameOf(p.x) || '?').slice(0, 60), markt: p.x.marketName || null,
          befund: e.belegGrund || null, entscheidung: p.uebersprungen ? 'uebersprungen' : p.entscheidung,
          ohneRegel: p.preisBildschirmFall ? p.preisBildschirmFall.ohneRegel : null,
          wirkt: !!(p.preisBildschirmFall && p.preisBildschirmFall.wirkt),
          haendler: b.haendler ?? null, lesedienstHaendler: b.lesedienstHaendler ?? null, merkmale: b.merkmale ?? null,
          quelleGrund: e.grund || null,
          vorbefund: pbSeit(p),
        };
      }),
    },
    // Fälle, die ein Befund eines früheren Laufs heute weiter liegen lässt
    // (beide Regeln, jeder Fall einmal; je Regel: `ausVortagen`, `beleg.ausVortagen`).
    vorbefund: pbFaelle.filter((p) => pbZaehl.get(p.id).ausVortagen.length).length,
    // Bildschirm-Regel, nur heutige Befunde (preisBildschirmZaehlart).
    befundAblehnen: pbSchirmFrisch.filter((p) => p.preisBildschirmFall.befund === 'ablehnen').length,
    // `halten` ändert nur etwas, wo sonst freigegeben würde.
    befundHalten: pbSchirmFrisch.filter((p) => p.preisBildschirmFall.befund === 'halten' && p.preisBildschirmFall.ohneRegel === 'freigeben').length,
    stattFreigabe: pbSchirmFrisch.filter((p) => p.preisBildschirmFall.ohneRegel === 'freigeben').length,
    // Liegt weiter wegen eines Befunds der Bildschirm-Regel aus einem früheren Lauf.
    ausVortagen: pbAusVortagen(REGEL_BILDSCHIRM),
    // Ein scharfer Befund eines früheren Laufs stand am Dokument, seine Regel
    // ist zurückgenommen ('shadow' oder false) und der Fall heute freigegeben.
    nachRuecknahmeFrei: plan.filter((p) => p.entscheidung === 'freigeben' && !p.uebersprungen && preisBildschirmVorbefund(p.x)).length,
    faelle: pbSchirmFaelle.slice(0, 50).map((p) => {
      const e = p.eingabe.preisBildschirm;
      return {
        id: p.id, name: String(nameOf(p.x) || '?').slice(0, 60), markt: p.x.marketName || null,
        befund: p.preisBildschirmFall.befund, ohneRegel: p.preisBildschirmFall.ohneRegel, entscheidung: p.uebersprungen ? 'uebersprungen' : p.entscheidung,
        // Hat ein scharfer Schalter gewirkt? (je Regel, preisBildschirmLage)
        wirkt: !!p.preisBildschirmFall.wirkt,
        quelle: e.quelle, quelleGrund: e.grund || null, merkmal: e.merkmal, lesedienstBon: !!e.lesedienstBon,
        // Preisbeleg (05.10.2026): welcher Befund, und welcher Händler genannt wurde.
        beleg: e.belegGrund || null, belegHaendler: (e.beleg && (e.beleg.haendler || e.beleg.lesedienstHaendler)) || null,
        vorbefund: pbSeit(p),
        datei: pbDatei(e),
      };
    }),
  };
  const runde = {
    geprueft: pending.length, offen: offen.length,
    auditVersucht: zuPruefen.length - nichtGeprueft.length, auditFehler: [...auditFehler.values()].filter((f) => f !== 'zeit_abgelaufen').length,
    nichtGeschafft: new Set([...nichtNachgelesen, ...nichtGeprueft].map((d) => d.id)).size,
    schreibFehler: plan.filter((p) => p.grund === 'schreib_fehler').length,
    // Ohne diese beiden Abgleiche gibt die Runde nichts frei (fail-closed).
    fotoAbgleichGescheitert: liste == null,
    kontoSperrenUnlesbar: sperren == null,
    // Was liegen bleibt, wartet auf einen Menschen — seit wann?
    aeltesteOffenTage: offen.length ? Math.floor((start - Math.min(...offen.map((p) => ms(p.x.createdAt) ?? start))) / (24 * 60 * 60 * 1000)) : null,
    // Prüfrunde 2: heute NEU wegen der Barcode-Nummer angehalten (ein Sprung
    // deutet eher auf das Modell als auf die Einreichungen) …
    eanHaltenNeu,
    // … und Halte-Befunde, die die Prüfkonsole nicht sieht.
    haltBefundNichtGespeichert: rundeOffenStand.fehlerSperrend,
    eanFotoNichtGespeichert: eanFotoStand.nichtGespeichertHalten,
    // Bildschirmfoto als Preisbeleg: beantwortet die Bildprüfung die Frage
    // nicht mehr (Modelländerung), erkennt die Regel still nichts mehr.
    preisQuelleBefragt: pbAlle.length,
    preisQuelleOhneAntwort: pbAlle.filter((e) => !e.quelle).length,
    preisBildschirmHalten: pbFrischGehalten(PREIS_BILDSCHIRM_UNSICHER),
    // Preisbeleg (05.10.2026): heute NEU liegen gelassen, Antworten ohne Merkmal-Liste, Märkte-Liste.
    preisBelegHalten: pbFrischGehalten(PREIS_BELEG_UNSICHER),
    preisBelegKassenbon: preisBildschirm.beleg.kassenbon,
    preisBelegOhneAntwort: preisBildschirm.beleg.merkmaleOhneAntwort,
    preisBelegMaerkteUnlesbar: preisBildschirm.beleg.maerkteUnlesbar,
    preisBildschirmTrotzBon: preisBildschirm.bildschirmTrotzBon,
    preisBildschirmBonWiderspruch: preisBildschirm.kassenbonOhneLesedienstBon,
    preisBildschirmBonWiderspruchLiegt: preisBildschirm.kassenbonOhneLesedienstBonLiegt,
    preisBildschirmSchalterUnbekannt: pbSchalter.art === 'unbekannt' ? pbSchalter.roh : null,
    preisBelegSchalterUnbekannt: belegSchalter.art === 'unbekannt' ? belegSchalter.roh : null,
    preisKopfNichtAbrufbar: preisBildschirm.kopfNichtAbrufbar,
    // Nur scharf hält ein nicht abrufbarer Kopf Freigaben an (Prüfrunde 3).
    preisBildschirmScharf: pbModus === true,
  };
  const warn = warnungen({
    jetzt: start, aktionen, zweitpruefung: lage.zweitpruefung, bons: lage.bons, runde, notbremse: bremse,
    regelVersion: { alt: vorher.exists ? vorher.get('regelVersion') || null : null, neu: version },
    bonRunde: { scharf: lage.bonWorkerScharf, bericht: bonRundeHeute, abgebrochen: bonAbgebrochen, laeuftNoch: bonLaeuftNoch, unbekannt: bonRundeUnbekannt },
  });
  const gebuchtCents = gebucht.filter((s) => s.rewardResult === 'credited').reduce((s, g) => s + (Number(g.rewardCents) || 0), 0);
  const fall = (p) => ({ id: p.id, name: String(nameOf(p.x) || '?').slice(0, 60), markt: p.x.marketName || null, grund: p.grund, hinweis: p.ctx?.hinweis || null, zurueckgehalten: p.zurueckgehaltenGrund || null });

  const bericht = {
    lauf, tag, ausloeser, dryRun,
    laufAt: FieldValue.serverTimestamp(),
    dauerSekunden: Math.round((Date.now() - start) / 1000),
    regelVersion: version, modell: MODELL,
    geprueft: pending.length,
    freigegeben: dryRun ? plan.filter((p) => p.entscheidung === 'freigeben').length : freigegeben.length,
    abgelehnt: abgelehnt.length,
    offen: offen.length,
    loseWare: plan.filter((p) => p.loseWare).length,
    gebuchtCents, buchungAusstehend,
    personenBezahlt: new Set(gebucht.filter((s) => s.rewardResult === 'credited').map((s) => s.uid)).size,
    // Freigegeben, aber nicht gebucht (Pro-Kopf-Deckel, Budget leer …) — der
    // Grund steht am Dokument; hier nur gezählt, damit es im Bericht auffällt.
    nichtGebucht: zaehle(gebucht.filter((s) => s.rewardResult && s.rewardResult !== 'credited'), 'grund'),
    nachgelesen,
    ablehnGruende: zaehle(abgelehnt, 'grund'),
    offenGruende: zaehle(offen, 'grund'),
    bildpruefung: { versucht: runde.auditVersucht, gescheitert: runde.auditFehler, unpassend: plan.filter((p) => BILD_GRUENDE.has(p.grund) || BILD_GRUENDE.has(p.zurueckgehaltenGrund)).length },
    nichtGeschafft: runde.nichtGeschafft,
    schreibFehler: runde.schreibFehler,
    notbremse: {
      bild: bremse.bild, gesamt: bremse.gesamt, preis: bremse.preis, woche: bremse.woche, bildschirm: bremse.bildschirm,
      // Bildschirm-Bremse (Nachprüfung 06.10.2026): mitgehaltene Fälle aus
      // Vortagen, und solche, die heute doch abgelehnt wurden (Bremse griff
      // nicht mehr; im Trockenlauf geplant). Ob nur gelb gewarnt wurde, steht
      // in `warnungen` (notbremse_vortage_*).
      ...(bremse.ausVortagen ? { ausVortagen: bremse.ausVortagen } : {}),
      ...(Object.keys(ausVortagenAbgelehnt).length ? { ausVortagenAbgelehnt } : {}),
    },
    // Bildschirmfoto als Preisbeleg (Patrick 04.10.2026) — Zahlen und Fälle.
    preisBildschirm,
    // Neu 02.10.2026 (Entscheidungen Patrick): Nummer vom Barcode-Foto, Abgleich
    // gegen alle früheren Fotos, gesperrte Konten — nur Zahlen, die Fälle stehen
    // in wartetAufDich bzw. abgelehntListe.
    eanFoto: zaehle([...eanFoto.values()], 'art'),
    // Prüfrunde 2: alte Barcode-Halte-Befunde, die weiter gelten (aufgehoben
    // wird keiner mehr automatisch, Schlussprüfung 03.10.2026).
    eanFotoVorbefund: { haelt: [...eanFoto.values()].filter((b) => b.vorbefund).length },
    // Foto-Befunde früherer Läufe, die heute übernommen wurden (nicht
    // nachprüfbar, oder fremdes Konto bis zur Entscheidung in der Konsole).
    fotoVorbefund: { haelt: plan.filter((p) => p.eingabe && p.eingabe.bild && p.eingabe.bild.vorbefund).length },
    eanFotoNichtGespeichert: eanFotoStand.nichtGespeichert,
    // Was die Prüfkonsole von der Runde erfährt (review.rundeOffen).
    rundeOffen: rundeOffenStand,
    fotoAbgleich: { dateien: liste ? liste.size : null, gescheitert: liste == null, unvollstaendig: zuBearbeiten.filter((d) => !fotoVollstaendig(d.id)).length },
    kontoSperren: { aktiv: sperren ? [...sperren.values()].filter((x) => sperreAusDaten(x) === 'gesperrt').length : null, unlesbar: sperren == null, offenEinreichungen: gesperrtOffen.length },
    wartetAufDich: offen.slice(0, 100).map(fall),
    abgelehntListe: abgelehnt.slice(0, 100).map(fall),
    bons: lage.bons,
    zweitpruefung: lage.zweitpruefung,
    bonRunde: bonRundeHeute,
    aktionen: aktionen.filter((a) => a.active && a.endAt > start - 7 * 24 * 60 * 60 * 1000).map(({ id, kind, startAt, endAt, budgetRemainingCents, budgetTotalCents, cashbackPerBonCents }) => ({ id, kind, startAt, endAt, budgetRemainingCents, budgetTotalCents, cashbackPerBonCents })),
    warnungen: warn,
  };
  await db.collection(BERICHTE).doc(lauf).set(bericht);
  // `aktuell` liest der Morgen-Chat. Geschrieben von jedem ZEITPLAN-Lauf, auch
  // als Trockenlauf (mit dryRun:true) — sonst meldete der Chat bei
  // ausgeschaltetem Schalter jeden Morgen „nicht gelaufen" und die Warnungen des
  // Laufs kämen nie an (Gegenprüfung 24.09.). Manuelle Läufe schreiben es nie.
  if (ausloeser === 'zeitplan') await db.collection(BERICHTE).doc('aktuell').set(bericht);
  logger.info('Morgenrunde fertig', { lauf, geprueft: bericht.geprueft, freigegeben: bericht.freigegeben, abgelehnt: bericht.abgelehnt, offen: bericht.offen, warnungen: warn.length });
  return { ...bericht, laufAt: new Date().toISOString() };
}

module.exports = {
  taeglicheRunde, noteFor, preisFotoKopf,
  // Für Tests und für Messskripte, die die Anweisung WORTGLEICH brauchen.
  AUDIT_ANWEISUNG, AUDIT_ANWEISUNG_PREISQUELLE, AUDIT_ANWEISUNG_PREISBELEG, bildAuditAntwort,
};
