'use strict';
/**
 * Bildschirmfotos als Preisbeleg (Patrick 04.10.2026: „ja, bau das") — reine
 * Funktionen, ohne Firestore und Storage, damit jede Regel einen Test hat
 * (__tests__/preisBildschirm.test.js). Benutzt von der Morgenrunde
 * (taeglicheRunde.js → fotoRundeRegeln.freigabe) und der Prüfkonsole
 * (einreichung.precheckOf) — EINE Regel für beide.
 *
 * ANLASS: 40 Einreichungen von 20 Personen zeigten als „Preis" ein
 * Bildschirmfoto (Händler-App, Online-Shop, Online-Prospekt, Google-Suche) —
 * alle bezahlt (5,77 €), 6 davon seit der Preis-Pflicht (26.09.). Der
 * Lesedienst las dort einen Preis und hielt das Bild meist für ein
 * Preisschild; die Bildprüfung nannte alle 40 „echt".
 *
 * ZWEI SIGNALE, gemessen am 04.10.2026 (scratchpad preisquelle/):
 *  1. Die Bildprüfung beantwortet im selben Aufruf, woher der Preis stammt
 *     (`preisQuelle`): im vollen Aufruf 40 von 40 Bildschirmfotos
 *     „bildschirm", keine von 54 schwierigen Gegenproben (e-Bons mit
 *     App-Rahmen, E-Paper-Schilder, Digitaldisplay im Markt) — nur mit dem
 *     Preisfoto 0 von 311 Nicht-Bildschirmen.
 *  2. Bildmerkmale der Datei (`bildschirmMerkmal`): kein Kamerahersteller in
 *     den EXIF-Daten UND (EXIF mit Aufnahmedatum/Software ODER PNG ODER
 *     Seitenverhältnis weder 4:3 noch 16:9). Kamerafotos 0 von 170; Fotos aus
 *     der App-Kamera sind zu 3.687 von 3.688 genau 4:3 und tragen höchstens
 *     einen EXIF-Rest OHNE Datum und Software (iOS: Ausrichtung, Auflösung,
 *     Pixelmaße — 49 von 294 Stichproben, Prüfrunde 2). Allein taugt das
 *     Merkmal nicht: auch e-Bons (127 von 127) und zugeschnittene Regalfotos
 *     haben es.
 *     ACHTUNG, Auswahl-Effekt (Prüfrunde 2, 04.10.2026): die 40 gemessenen
 *     Bildschirmfotos wurden über die Merkmal-Klasse gefunden — „40 von 40"
 *     belegt also nicht, dass JEDES Bildschirmfoto das Merkmal trägt. Außerhalb
 *     der Klasse lagen 2 weitere bezahlte (Billa-Online-Shop 1200×2152 ≈ 16:9;
 *     ein auf „2,79 € Aldi Süd" zugeschnittener App-Ausschnitt 446×248) — beide
 *     mit EXIF-Datum ohne Kamerahersteller, deshalb die EXIF-Bedingung oben.
 *     Bezahlte Bildschirmfotos im Bestand: mindestens 42.
 *
 * REGEL (Patrick: „ablehnen, wenn die Bildprüfung Bildschirm sagt UND die
 * Bildmerkmale passen; nur eins von beiden → für einen Menschen liegen
 * lassen"), siehe preisBildschirmBefund. Dazu ein drittes, unabhängiges
 * Zeichen, das schon am Dokument liegt: hat der Lesedienst einen Kassenbon
 * erkannt (lesedienstBonOf), wird nie abgelehnt — Gegenprüfung 04.10.2026.
 *
 * PREISBELEG „KASSENBON" (Entscheidung Claude im Auftrag Patricks,
 * 04.10.2026): ein „Kassenbon" ohne jedes Kassenbon-Merkmal (Warenkorb-Lücke)
 * oder von einem Händler, der keiner unserer Märkte ist, bleibt liegen —
 * siehe preisBelegBefund (Abschnitt „Preisbeleg") und WISSEN-FOTORUNDE.md.
 *
 * ZWEI SCHALTER (Nachprüfung 05.10.2026): Bildschirm-Regel
 * (`preisBildschirmRegel`) und Preisbeleg (`preisBelegRegel`) werden getrennt
 * geschaltet und getrennt weitergetragen (preisBildschirmLage). Hingen beide
 * an einem Schalter, gäbe das Zurücknehmen des Preisbelegs (etwa weil er zu
 * viele Bons inhabergeführter Märkte anhält) am nächsten Morgen auch jedes
 * angehaltene Bildschirmfoto frei — ohne dass ein Mensch es gesehen hat.
 */

/** Antworten der Bildprüfung auf „Woher stammt der Preis?" */
const PREIS_QUELLEN = Object.freeze(['laden', 'kassenbon', 'bildschirm', 'keiner', 'unklar']);
const QUELLE_SET = new Set(PREIS_QUELLEN);
/** Bildarten des Lesedienstes, die einen Kassenbon bedeuten (lesedienstBonOf). */
const BON_ARTEN = new Set(['kassenbon', 'beides']);

/** Interne Gründe (review.reason, Bericht). Am Dokument steht `fotos_unpassend` (duplicatePolicy.APP_GRUND). */
const PREIS_BILDSCHIRM = 'preis_bildschirm';
const PREIS_BILDSCHIRM_UNSICHER = 'preis_bildschirm_unsicher';
/** Offen, weil der Kopf des Preisfotos nicht abrufbar war (unsere Technik, kein Urteil). */
const PREIS_KOPF_NICHT_LESBAR = 'preis_kopf_nicht_lesbar';

/** So viele Bytes vom Anfang des Preisfotos genügen für Format, Maße und EXIF-Hersteller. */
const KOPF_BYTES = 192 * 1024;

/**
 * Schalter `cashback_config/v1.preisBildschirmRegel` (Bildschirm-Regel):
 *  - `false`     → aus: kein Bildkopf, kein Befund der Bildschirm-Regel; die
 *                  Frage nach der Preisquelle entfällt nur, wenn auch der
 *                  Preisbeleg aus ist (er braucht die Antwort „kassenbon").
 *  - `'shadow'`  → Beobachtung (Standard): Befund am Dokument und im Bericht, entschieden wird wie bisher.
 *  - `true`      → scharf: Ablehnung bzw. Liegenlassen nach preisBildschirmBefund.
 * Jeder andere Wert (fehlt, Tippfehler, 'true' als Text) gilt als 'shadow' —
 * die Richtung, die nichts ablehnt. Ein Tippfehler darf weder still scharf
 * schalten noch die Beobachtung abschalten; er steht aber gelb im Bericht
 * (schalterRohOf, Warnung `preisbildschirm_schalter_unbekannt`).
 * @returns {false|'shadow'|true}
 */
function modusPreisBildschirm(v) {
  if (v === true) return true;
  if (v === false) return false;
  return 'shadow';
}

/**
 * Schalter `cashback_config/v1.preisBelegRegel` (Preisbeleg „Kassenbon",
 * Nachprüfung 05.10.2026 — eigener Schalter, siehe Kopf der Datei). Werte
 * wie bei der Bildschirm-Regel: `false` aus (keine Unterfragen zum Kassenbon,
 * kein Befund), `'shadow'` Beobachtung (Standard), `true` scharf (nur liegen
 * lassen, nie ablehnen). Unbekannt → `'shadow'`, gelb im Bericht
 * (`preisbeleg_schalter_unbekannt`).
 * @returns {false|'shadow'|true}
 */
function modusPreisBeleg(v) {
  return modusPreisBildschirm(v);
}

/**
 * Rohwert des Schalters für den Bericht (Prüfrunde 2, 04.10.2026): ein
 * unbekannter Wert — etwa `"true"` als Text, wie ihn die Firebase-Konsole für
 * ein neues Feld vorschlägt — gilt als Beobachtung, und das darf nicht still
 * geschehen: der Bericht nennt ihn, warnungen() meldet ihn gelb.
 * @returns {{art:'fehlt'|'gueltig'|'unbekannt', roh:string|null}}
 */
function schalterRohOf(v) {
  if (v === undefined || v === null) return { art: 'fehlt', roh: null };
  if (v === true || v === false || v === 'shadow') return { art: 'gueltig', roh: String(v) };
  const text = typeof v === 'string' ? `"${v.slice(0, 20)}" (Text)` : `${String(v).slice(0, 20)} (${typeof v})`;
  return { art: 'unbekannt', roh: text };
}

/** Antwort der Bildprüfung → bekannter Wert oder null (fehlt / unbekannt). */
function preisQuelleOf(v) {
  const s = typeof v === 'string' ? v.trim().toLowerCase() : '';
  return QUELLE_SET.has(s) ? s : null;
}

/**
 * Hat der Lesedienst (crowd-upload-namer bzw. die Nachlesung der Runde) auf
 * dem Preisfoto einen Kassenbon erkannt? Ein ZWEITES, vom Bildschirm-Urteil
 * unabhängiges Zeichen, das schon am Dokument liegt (server-only,
 * firestore.rules crowdUploadServerFelder) — kostet nichts.
 * Gemessen 04.10.2026 (preisquelle/gt.json gegen analysen-0410/uploads.json):
 * 164 von 167 Kassenbons tragen es (`priceImageKind` kassenbon/beides bzw.
 * eine gelesene Bon-Kopfzeile in `priceReceipt`), 0 von 40 Bildschirmfotos.
 * Bewusst OHNE „preisschild": so hielt der Lesedienst 26 von 40
 * Bildschirmfotos — das Zeichen schaltete die Erkennung ab
 * (anders als werte.preisHinweisOf, das nur fragt, ob ÜBERHAUPT ein Preis da ist).
 */
function lesedienstBonOf(x, zusatzArten = []) {
  // Prüfrunde 3 (04.10.2026): `zusatzArten` = was die Nachlesung DIESES Laufs
  // im Preisfoto sah, auch wenn sie den Preis nicht übernahm (zwei Lesungen,
  // verschiedene Beträge) — dann steht ihre Bildart nicht am Dokument. Sah
  // dabei eine Lesung einen Bon, ist das ein Gegenzeichen wie jedes andere.
  // Nur in diese Richtung: ungeeinte Lesungen machen einen Fall nie
  // ablehnbar (lesedienstOhneBonOf liest sie nicht).
  if ((Array.isArray(zusatzArten) ? zusatzArten : []).some((a) => BON_ARTEN.has(String(a || '').trim().toLowerCase()))) return true;
  if (!x || typeof x !== 'object') return false;
  // Erst- UND Nachlesung: die Nachlesung ergänzt, sie ersetzt das Zeichen
  // nicht (Prüfrunde 2, 04.10.2026 — sonst hinge ein e-Bon, den die
  // Erstlesung erkannt hat, wieder an einer einzigen Modellantwort).
  if (lesedienstArten(x).some((a) => BON_ARTEN.has(a))) return true;
  const b = x.priceReceipt;
  return !!(b && typeof b === 'object' && (b.zip || b.city || b.street || b.merchant));
}

/** Was der Lesedienst im Preisfoto sah: Erstlesung und Nachlesung (taeglicheRunde), normalisiert. */
function lesedienstArten(x) {
  if (!x || typeof x !== 'object') return [];
  return [x.priceImageKind, x.priceRescueOcr && x.priceRescueOcr.priceImageKind]
    .map((v) => (typeof v === 'string' ? v.trim().toLowerCase() : ''))
    .filter(Boolean);
}

/**
 * Hat der Lesedienst das Preisfoto GELESEN und dabei KEINEN Kassenbon gesehen
 * (preisschild, produktfoto, sonstiges)? Gegenzeichen für die Antwort
 * „kassenbon" der Bildprüfung (Prüfrunde 2, 04.10.2026): Kassenbons sind
 * immer erlaubt — auf welche Antwort hin, darf nicht an EINER Lesung hängen.
 * „fehlt"/„unklar"/keine Lesung zählen nicht als Widerspruch (der Lesedienst
 * hat dann nichts gesagt). Gemessen: 164 von 167 Kassenbons trägt der
 * Lesedienst als Bon, die übrigen 3 hat er nicht gelesen; bei den 40
 * Bildschirmfotos sagte er 26× preisschild, 13× sonstiges.
 */
function lesedienstOhneBonOf(x, zusatzArten = []) {
  if (lesedienstBonOf(x, zusatzArten)) return false;
  return lesedienstArten(x).some((a) => a === 'preisschild' || a === 'produktfoto' || a === 'sonstiges');
}

/* ─────────────────────── Preisbeleg „Kassenbon" ─────────────────────── */
/*
 * Zwei Lücken der Antwort „kassenbon" (Entscheidung Claude im Auftrag
 * Patricks, 04.10.2026 — Patrick: „Kannst du selbst entscheiden?"). Beide
 * lassen einen Fall NUR für einen Menschen liegen (scharf: aus einer sonst
 * fälligen Freigabe wird ein offener Fall), in der Beobachtung werden sie nur
 * gezählt — abgelehnt wird darauf hin nie. Eigener Schalter
 * `preisBelegRegel` (modusPreisBeleg; bis zur Nachprüfung 05.10.2026 hing der
 * Preisbeleg am Schalter der Bildschirm-Regel).
 *
 *  1. Warenkorb-Lücke (Prüfrunde 3, 04.10.2026): ein auf Artikelzeilen
 *     zugeschnittener Online-Warenkorb oder eine Bestellliste hieß „kassenbon"
 *     und wurde still bezahlt — ob gekauft wurde, prüfte niemand. Jetzt muss
 *     der Beleg mindestens EIN Merkmal eines abgeschlossenen Einkaufs zeigen
 *     (Händler, Datum, Summe, Bon-/Beleg-Nr., Zahlung, Steuer-Kennzeichen) —
 *     laut Bildprüfung (`belegMerkmale`) ODER laut Lesedienst (gelesener
 *     Händlerkopf `priceReceipt`). Ein Händlerkopf des Lesedienstes allein
 *     genügt, damit kein echter Bon an EINER Modellantwort hängt; eine
 *     fehlende Antwort der Bildprüfung ist dagegen kein Freispruch.
 *     Die Steuer-Kennzeichen (A/B hinter den Preisen) gehören dazu: echte
 *     Bons, auf die Artikelzeilen zugeschnitten, tragen sie meist, ein
 *     Warenkorb nie. Gemessen 05.10.2026 (166 echte Bons mit „kassenbon",
 *     WISSEN-FOTORUNDE.md): 3 blieben liegen — eng auf Artikelzeilen ohne
 *     Kennzeichen zugeschnittene e-Bons, von einem Warenkorb nicht zu
 *     unterscheiden; ohne die Kennzeichen als Merkmal wären es 25 gewesen.
 *     Nachmessung (Nachprüfung 05.10.2026, 41 Kamerafotos von Papierbons
 *     ohne Lesedienst-Kopf): 4 bleiben liegen — Ausschnitte ohne jedes
 *     Merkmal (Preise abgeschnitten, zwei Artikelzeilen). Aldi Nords
 *     Kennzeichen „1"/„2" statt A/B erkennt die Bildprüfung als „steuer"
 *     (16 von 18); dieselbe Frage zweimal gestellt: 0 von 40 Wechseln
 *     zwischen „mit" und „ohne Merkmal" — eine Wiederholung vor dem Halt
 *     änderte nichts. Erwartet ~3–5 Halte pro Woche (WISSEN-FOTORUNDE.md).
 *     Eine Summe zählt als Merkmal (Vorgabe); ein Warenkorb,
 *     der seine Summenzeile zeigt, wird darum bezahlt (Lücke, gemessen 1 von
 *     2 synthetischen Fällen als „kassenbon").
 *  2. Rechnungen fremder Händler: für Bons gilt seit 04.10.2026 „nur unsere
 *     Märkte (Collection `discounter`), Amazon nein" (CLAUDE.md). Dieselbe
 *     Regel für den Preisbeleg: nennt die Bildprüfung als Händler
 *     (`belegHaendler`, die KETTE nach Name/Logo) einen, der keiner unserer
 *     Märkte ist — oder nennt sie keinen und der vom Lesedienst gelesene
 *     Filialname ist keiner —, und löst kein genannter Name auf einen unserer
 *     Märkte auf → liegen lassen. dm-, Rossmann-, REWE-Online usw. sind unsere
 *     Märkte und gelten. Der Lesedienst liest den FILIALNAMEN; inhabergeführte
 *     Märkte heißen dort „Krummenerl" oder „NK Südfilialen GmbH" (im Bestand
 *     24 von 1.172 gelesenen Händlernamen, alle REWE/EDEKA). Die Bildprüfung
 *     nennt dort meist die Kette (18 von 23 gemessen); ein Bon OHNE Kettenlogo
 *     („Krummenerl", REWE) bleibt liegen (5 von 23, ein Markt) — ein Mensch
 *     sieht es dem Bon auch nicht an. Erkannt: Amazon, Wreesmann, TK Maxx
 *     (3 von 3).
 */

/** Merkmale eines abgeschlossenen Einkaufs (Bildprüfung, `belegMerkmale`). */
const BELEG_MERKMALE = Object.freeze(['haendler', 'datum', 'summe', 'nummer', 'zahlung', 'steuer']);
const MERKMAL_SET = new Set(BELEG_MERKMALE);
/** Offen-Grund (review.reason / rundeOffen.grund) — EIN neutraler Code; welcher Befund, steht nur im Tagesbericht. */
const PREIS_BELEG_UNSICHER = 'preis_beleg_unsicher';
/** Welcher Befund (nur Tagesbericht — das Dokument liest der Einreicher selbst). */
const BELEG_OHNE_MERKMALE = 'ohne_merkmale';
const BELEG_FREMDER_HAENDLER = 'fremder_haendler';

/**
 * Antwort `belegMerkmale` → bekannte Merkmale (ohne Doppel) oder null = keine
 * verwertbare Antwort (fehlt, kein Liste, nur unbekannte Werte). Eine leere
 * Liste ist eine Antwort („keines zu sehen"). Werte wie `"haendler|summe"`
 * in einem Element werden zerlegt (die Vorlage in der Anweisung trennt mit |).
 */
function belegMerkmaleOf(v) {
  if (!Array.isArray(v)) return null;
  const roh = v.flatMap((m) => String(m == null ? '' : m).toLowerCase().split(/[|,;\s]+/)).filter(Boolean);
  const out = [...new Set(roh.filter((m) => MERKMAL_SET.has(m)))];
  if (!out.length && roh.length) return null;
  return out;
}

/** Antwort `belegHaendler` → Name oder null (leer, „unbekannt", „nicht erkennbar" …). */
function belegHaendlerOf(v) {
  const s = typeof v === 'string' ? v.trim().replace(/\s+/g, ' ').slice(0, 60) : '';
  if (!s || /^(?:-+|…|\.\.\.|keine?r?|unbekannt|nicht erkennbar|nicht lesbar|n\/?a|none|null)$/i.test(s)) return null;
  return s;
}

/** Hat der Lesedienst auf dem Preisfoto einen Bon-Kopf gelesen (Händlername oder Anschrift)? */
function lesedienstKopfOf(x) {
  const b = x && typeof x === 'object' ? x.priceReceipt : null;
  return !!(b && typeof b === 'object' && (b.merchant || b.street || b.zip || b.city));
}

/** Kleinschreibung ohne Akzente, ß→ss, „R E W E" → „rewe", in Wörter zerlegt. */
function haendlerWoerter(s) {
  return String(s || '').toLowerCase().replace(/ß/g, 'ss').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/(?<![a-z0-9])(?:[a-z][\s.]){2,}[a-z](?![a-z0-9])/g, (m) => m.replace(/[\s.]/g, ''))
    .split(/[^a-z0-9]+/).filter(Boolean);
}

/**
 * Ketten unserer Märkte, fest im Code — der Rückfall, wenn die Collection
 * `discounter` nicht lesbar ist, und die Vertriebslinien, unter denen unsere
 * Märkte auf dem Bon stehen (wie cashback-pipeline/lib/merchant.js ALIASES).
 * Stand 05.10.2026: 20 Einträge in `discounter` (DE/AT/CH).
 */
const UNSERE_KETTEN = Object.freeze([
  'aldi', 'hofer', 'lidl', 'kaufland', 'rewe', 'edeka', 'penny', 'netto', 'norma', 'globus', 'dm', 'rossmann', 'muller', 'mueller', 'spar', 'billa',
  // REWE-Gruppe
  'nahkauf',
  // EDEKA-Gruppe: Marktkauf, E center, Neukauf, nah & gut, diska (EDEKA Nordbayern)
  'marktkauf', 'ecenter', 'neukauf', 'diska',
  // SPAR Österreich
  'eurospar', 'interspar',
]);
/** Mehrteilige Linien (Wortfolgen): „E center", „E aktiv", „nah & gut". */
const UNSERE_FOLGEN = Object.freeze([['e', 'center'], ['e', 'aktiv'], ['nah', 'gut']]);
/** Wörter aus `discounter`-Namen, die keine Kette bezeichnen. */
const NAME_STOPP = new Set(['markt', 'maerkte', 'markendiscount', 'discount', 'nord', 'sud', 'sued', 'suisse', 'schweiz', 'osterreich', 'de', 'at', 'ch', 'gmbh', 'kg', 'online']);

/**
 * Schlüssel unserer Märkte: das erste Wort jedes `discounter`-Namens, das
 * keine Gattung ist („Netto Markendiscount" → netto, „Aldi Süd" → aldi),
 * dazu UNSERE_KETTEN. Kommt ein Markt in `discounter` dazu (etwa Picnic),
 * gilt er ohne Codeänderung.
 * @param {string[]|null} namen  Namen aus `discounter` (null = nicht lesbar → nur der feste Teil)
 * @returns {Set<string>}
 */
function marktSchluessel(namen) {
  const s = new Set(UNSERE_KETTEN);
  for (const n of Array.isArray(namen) ? namen : []) {
    const w = haendlerWoerter(n).find((x) => !NAME_STOPP.has(x) && x.length >= 2);
    if (w) s.add(w);
  }
  return s;
}

/**
 * Ist `name` einer unserer Märkte? true / false / null (kein Name).
 * Ganze Wörter (auch „R E W E"), dazu Komposita, die mit einem Schlüssel ab
 * fünf Buchstaben BEGINNEN („Edekamarkt", „Kauflandmarkt"); kürzere nur als
 * ganzes Wort („Spar" nicht in „Sparkasse", „dm" nicht in „Admiral"). Keine
 * Tippfehler-Toleranz: die Bon-Pipeline machte damit aus „Das" dm und aus
 * „denns" Penny (Bericht Bon-Doppelzahlung, 04.10.2026).
 */
function unserMarkt(name, schluessel = marktSchluessel(null)) {
  const w = haendlerWoerter(name);
  if (!w.length) return null;
  if (w.some((x) => schluessel.has(x))) return true;
  if (w.some((x) => [...schluessel].some((k) => k.length >= 5 && x.length > k.length && x.startsWith(k)))) return true;
  return UNSERE_FOLGEN.some(([a, b]) => w.some((x, i) => x === a && w[i + 1] === b));
}

/**
 * Befund zum Preisbeleg — nur bei der Antwort „kassenbon", sonst nichts.
 * @param {{quelle:string|null, merkmale:string[]|null, haendler:string|null, lesedienstKopf:boolean, lesedienstHaendler:string|null, schluessel?:Set<string>}} e
 * @returns {{grund:'ohne_merkmale'|'fremder_haendler'|null, ohneMerkmale:boolean, fremd:boolean, unser:boolean|null}}
 *   `unser`: true = ein genannter Name löst auf einen unserer Märkte auf;
 *   false = die Bildprüfung nennt einen fremden — oder nennt keinen, und der
 *   Filialname des Lesedienstes ist keiner unserer Märkte; null = kein
 *   Händler genannt.
 */
function preisBelegBefund({ quelle, merkmale = null, haendler = null, lesedienstKopf = false, lesedienstHaendler = null, schluessel } = {}) {
  const leer = { grund: null, ohneMerkmale: false, fremd: false, unser: null };
  if (preisQuelleOf(quelle) !== 'kassenbon') return leer;
  const s = schluessel instanceof Set ? schluessel : marktSchluessel(null);
  const uModell = belegHaendlerOf(haendler) ? unserMarkt(haendler, s) : null;
  const uLese = typeof lesedienstHaendler === 'string' && lesedienstHaendler.trim() ? unserMarkt(lesedienstHaendler, s) : null;
  // Ein auflösender Name genügt (der Lesedienst liest inhabergeführte Märkte
  // mit dem Inhaber, die Bildprüfung nennt dort meist die Kette). Fremd ist
  // ein Beleg nur, wenn KEIN Name auflöst: die Bildprüfung nennt einen
  // fremden, oder sie nennt keinen und der Lesedienst einen fremden.
  const unser = uModell === true || uLese === true ? true : uModell === false || (uModell === null && uLese === false) ? false : null;
  const fremd = unser === false;
  // Ein genannter Händler (belegHaendler) zählt NICHT als Merkmal: das Modell
  // kann die Kette auch aus dem Produkt („K-Classic") oder dem Layout
  // erschließen — ein Kaufland-Warenkorb hätte dann ein „Merkmal".
  const ohneMerkmale = !lesedienstKopf && !(Array.isArray(merkmale) && merkmale.length);
  return { grund: fremd ? BELEG_FREMDER_HAENDLER : ohneMerkmale ? BELEG_OHNE_MERKMALE : null, ohneMerkmale, fremd, unser };
}

/* ─────────────────────────── Bildkopf ─────────────────────────── */

/**
 * Kennung eines EXIF-Blocks (TIFF) [start, ende):
 *  - `hersteller`: Tag 0x010F „Make" in IFD0, sonst null,
 *  - `spur`: der Block trägt Software (0x0131, IFD0) oder ein Aufnahmedatum
 *    (0x9003 DateTimeOriginal, im EXIF-Unterverzeichnis 0x8769).
 * Warum `spur` (Prüfrunde 2, 04.10.2026): Android-Bildschirmfotos und in
 * einer Galerie-App zugeschnittene Bilder tragen Datum bzw. Software, aber
 * keinen Kamerahersteller. Die App-Kamera schreibt nie Datum oder Software —
 * auf iOS steht dort ein EXIF-Rest aus Ausrichtung, Auflösung und Pixelmaßen
 * (49 von 294 Stichproben, alle ohne 0x0131/0x9003). Ein bloßer EXIF-Block
 * taugt deshalb NICHT als Zeichen — er hätte jedes sechste App-Kamera-Foto
 * zum „Bildschirm" gemacht.
 * Nicht lesbar → { hersteller: null, spur: false }.
 */
function tiffKennung(b, start, ende) {
  const leer = { hersteller: null, spur: false };
  try {
    if (ende - start < 8) return leer;
    const bo = b.toString('ascii', start, start + 2);
    if (bo !== 'II' && bo !== 'MM') return leer;
    const le = bo === 'II';
    const u16 = (p) => (p >= start && p + 2 <= ende ? (le ? b.readUInt16LE(p) : b.readUInt16BE(p)) : null);
    const u32 = (p) => (p >= start && p + 4 <= ende ? (le ? b.readUInt32LE(p) : b.readUInt32BE(p)) : null);
    if (u16(start + 2) !== 42) return leer;
    /** Einträge eines Verzeichnisses (Tag → Eintragsposition); null, wenn nicht lesbar. */
    const verzeichnis = (off) => {
      if (off == null) return null;
      const ifd = start + off;
      const n = u16(ifd);
      if (n == null || n > 1000) return null;
      const out = new Map();
      for (let i = 0; i < n; i++) {
        const e = ifd + 2 + i * 12;
        if (e + 12 > ende) break;
        out.set(u16(e), e);
      }
      return out;
    };
    const ifd0 = verzeichnis(u32(start + 4));
    if (!ifd0) return leer;
    let hersteller = null;
    const make = ifd0.get(0x010f);
    if (make != null) {
      const len = u32(make + 4);
      if (len && len <= 256) {
        const p = len > 4 ? start + u32(make + 8) : make + 8;
        if (p + len <= ende) hersteller = b.toString('latin1', p, p + len).replace(/\0+$/, '').trim() || null;
      }
    }
    let spur = ifd0.has(0x0131);
    const exifZeiger = ifd0.get(0x8769);
    if (!spur && exifZeiger != null) {
      const exif = verzeichnis(u32(exifZeiger + 8));
      spur = !!(exif && exif.has(0x9003));
    }
    return { hersteller, spur };
  } catch {
    return leer;
  }
}

/**
 * Format, Maße und EXIF-Hersteller aus dem Anfang einer Bilddatei — ohne
 * Bibliothek, weil sharp an abgeschnittenen JPEGs scheitert (Messung
 * 04.10.2026: 1 von 2 gekürzten Galeriefotos). Maße so, wie sie in der Datei
 * stehen (die EXIF-Drehung ändert das Seitenverhältnis nicht, nur die Richtung).
 * @param {Buffer} b  die ersten KOPF_BYTES der Datei
 * @returns {{format:'png'|'jpg'|'webp'|'heic'|'unbekannt', breite:number|null, hoehe:number|null, kameraHersteller:string|null, exifSpur:boolean}}
 *   `exifSpur`: EXIF mit Software oder Aufnahmedatum (tiffKennung)
 */
function bildKopf(b) {
  const leer = (format) => ({ format, breite: null, hoehe: null, kameraHersteller: null, exifSpur: false });
  if (!Buffer.isBuffer(b) || b.length < 12) return leer('unbekannt');
  // PNG: Maße im IHDR, EXIF (selten) im Abschnitt eXIf.
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) {
    if (b.length < 24) return leer('png');
    let k = { hersteller: null, spur: false };
    let i = 8;
    while (i + 8 <= b.length) {
      const len = b.readUInt32BE(i);
      const typ = b.toString('ascii', i + 4, i + 8);
      if (typ === 'eXIf') { k = tiffKennung(b, i + 8, Math.min(b.length, i + 8 + len)); break; }
      if (typ === 'IDAT' || typ === 'IEND') break;
      i += 12 + len;
    }
    return { format: 'png', breite: b.readUInt32BE(16) || null, hoehe: b.readUInt32BE(20) || null, kameraHersteller: k.hersteller, exifSpur: k.spur };
  }
  if (b[0] === 0xff && b[1] === 0xd8) {
    let k = null;
    let i = 2;
    while (i + 4 <= b.length) {
      if (b[i] !== 0xff) { i++; continue; }
      const m = b[i + 1];
      // Füllbytes, Marker ohne Länge
      if (m === 0xff) { i++; continue; }
      if (m === 0x01 || (m >= 0xd0 && m <= 0xd8)) { i += 2; continue; }
      if (m === 0xd9 || m === 0xda) break;
      const len = b.readUInt16BE(i + 2);
      if (len < 2) break;
      if (m === 0xe1 && k == null && i + 10 <= b.length && b.toString('latin1', i + 4, i + 10) === 'Exif\0\0') {
        k = tiffKennung(b, i + 10, Math.min(b.length, i + 2 + len));
      }
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
        if (i + 9 > b.length) break;
        return { format: 'jpg', breite: b.readUInt16BE(i + 7) || null, hoehe: b.readUInt16BE(i + 5) || null, kameraHersteller: k ? k.hersteller : null, exifSpur: !!(k && k.spur) };
      }
      i += 2 + len;
    }
    return { format: 'jpg', breite: null, hoehe: null, kameraHersteller: k ? k.hersteller : null, exifSpur: !!(k && k.spur) };
  }
  if (b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') return leer('webp');
  if (b.toString('ascii', 4, 12).includes('ftyp')) return leer('heic');
  return leer('unbekannt');
}

/** Kameraformat: 4:3 oder 16:9, Toleranz wie in der Messung (±0,012 auf kurz/lang). */
function kameraFormat(q) {
  return q != null && (Math.abs(q - 0.75) < 0.012 || Math.abs(q - 0.5625) < 0.012);
}

/**
 * Passen die Bildmerkmale zu einem Bildschirmfoto? Definition der Messung vom
 * 04.10.2026 (analysen-0410/schirm.js, Klasse „schirm"), ergänzt in Prüfrunde 2:
 *  - Kamerahersteller in den EXIF-Daten → nein (Galeriefoto, auch zugeschnitten),
 *  - EXIF mit Software oder Aufnahmedatum, aber ohne Hersteller → ja
 *    (Android-Bildschirmfoto, in der Galerie zugeschnitten — auch im Format
 *    4:3/16:9; im Bestand genau 3 Preisfotos mehr als nach der Messung: 2
 *    bezahlte Bildschirmfotos und 1 nachbearbeitetes Regalfoto, das mit
 *    „laden" nur liegen bleibt),
 *  - PNG → ja,
 *  - Seitenverhältnis 4:3 oder 16:9 → nein (App-Kamera bzw. Kamera),
 *  - sonst → ja.
 * Bleibt still (Merkmal „nein"): JEDES Bildschirmfoto, das als JPEG ohne
 * EXIF im Format 4:3 oder 16:9 ankommt (z. B. über einen Messenger) — auch
 * OHNE Zuschnitt, denn so sind die Bildschirme selbst: iPad 2048×1536 und
 * 2732×2048 (4:3), 16:9-Handys wie iPhone 8/SE (750×1334) oder ältere
 * Androids (1080×1920), Monitore und Laptops (1920×1080, 1366×768;
 * Prüfrunde 3, 04.10.2026). Dann hängt alles an der Antwort der Bildprüfung:
 * „bildschirm" → liegen lassen, „laden" → still bezahlt (WISSEN-FOTORUNDE.md,
 * Lücken).
 * Maße nicht lesbar (Datei nicht abrufbar, WebP/HEIC, Kopf zu kurz) → null =
 * unbekannt. Unbekannt zählt NIE als „passt" — sonst lehnte ein Lesefehler
 * unserer Technik eine Einreichung ab. Umgekehrt gibt ein nicht abrufbarer
 * Kopf auch nichts frei (preisBildschirmBefund, `kopfGescheitert`).
 * @param {ReturnType<typeof bildKopf>|null} kopf
 * @returns {boolean|null}
 */
function bildschirmMerkmal(kopf) {
  if (!kopf || !kopf.breite || !kopf.hoehe) return null;
  if (kopf.kameraHersteller) return false;
  if (kopf.exifSpur === true) return true;
  if (kopf.format === 'png') return true;
  const q = Math.min(kopf.breite, kopf.hoehe) / Math.max(kopf.breite, kopf.hoehe);
  return !kameraFormat(q);
}

/* ─────────────────────────── Regel ─────────────────────────── */

/**
 * Befund aus Antwort der Bildprüfung, Bildmerkmalen und dem Lesedienst — für
 * die Runde. Die Konsole übernimmt den Befund, den die Runde am Fall
 * hinterlässt (`review.rundeOffen.preisBildschirm`), statt ihn nachzurechnen:
 * die Eingaben (Dateimerkmale) stehen bewusst nicht am Dokument.
 *
 *  - „bildschirm" UND Merkmale passen UND der Lesedienst hat das Preisfoto
 *    GELESEN und dabei KEINEN Kassenbon gesehen (`lesedienstOhneBon`:
 *    preisschild/produktfoto/sonstiges) → `ablehnen` (gemessen: 40 von 40
 *    Bildschirmfotos der Merkmal-Klasse, keine Fehlablehnung; 39 der 40
 *    tragen dieses Zeichen — 26× preisschild, 13× sonstiges).
 *  - „bildschirm" sonst → `halten`:
 *     · ohne passende Merkmale (auch: unbekannt) — so sähe ein mit der
 *       App-Kamera abfotografierter Bildschirm aus (gemessen 0 von 170
 *       Kamerafotos; wie oft es vorkommt, ist offen);
 *     · der Lesedienst sah einen Kassenbon — dann widersprechen sich zwei
 *       Lesungen, und e-Bons tragen die Merkmale IMMER (127 von 127). Ohne
 *       dieses Zeichen hinge der Schutz der e-Bons an einer einzigen
 *       Modellantwort, und ein Modellwechsel lehnte sie still ab
 *       (Gegenprüfung 04.10.2026; „abgelehnt wird nur ohne jedes
 *       Gegenzeichen", wie bei der Preis-Pflicht);
 *     · der Lesedienst hat das Preisfoto NICHT gelesen (Erstlesung
 *       gescheitert, Nachlesung an Google-Limit oder Zeitgrenze gescheitert,
 *       `productNameOcrFehler`) — Prüfrunde 3, 04.10.2026. Dann fehlt genau
 *       der Abgleich, der einen e-Bon vor einer einzelnen Fehlantwort
 *       schützt; ein Technikfehler darf nicht zur Ablehnung führen, die an
 *       EINER Modellantwort hängt. Kostet gemessen 1 von 40 (ein Fall vom
 *       11.09. ohne Bildart-Feld; alle 6 seit dem 26.09. tragen das Zeichen).
 *  - „laden" MIT passenden Merkmalen → `halten` (meist zugeschnittene echte
 *    Regalfotos, ~1 pro Woche; fing im Modus nur mit Preisfoto 1
 *    Bildschirmfoto ab).
 *  - „keiner" MIT passenden Merkmalen → `halten`, wie eine fehlende Antwort
 *    (Prüfrunde 3, 04.10.2026): las der Lesedienst trotzdem einen Preis, ist
 *    die Preis-Pflicht erfüllt, und es würde bezahlt, obwohl sich zwei
 *    Lesungen widersprechen und die Datei wie ein Bildschirm aussieht. Ohne
 *    gelesenen Preis bleibt es bei „Preis fehlt" (ein Halte-Befund macht nur
 *    aus einer Freigabe einen offenen Fall). Gemessen 0 von 31
 *    „keiner"-Antworten mit gelesenem Preis — kostet nichts.
 *  - „unklar" → `halten` (z. B. Papierprospekt; gemessen 3 von 351, alle Bildschirmfotos).
 *  - Antwort fehlt, Merkmale passen → `halten` (keine Antwort ist kein Freispruch).
 *  - „laden", „keiner" oder Antwort fehlt, und der Kopf des Preisfotos war
 *    NICHT ABRUFBAR (`kopfGescheitert`: Storage-Fehler, Zeitgrenze) →
 *    `halten`. Der Abgleich, der die Freigabe hätte verhindern können, fehlt —
 *    dann keine Freigabe (wie kontosperre_unbekannt,
 *    foto_abgleich_gescheitert; Entscheidung Patrick 02.10.2026). Ein Format,
 *    aus dem sich keine Maße lesen lassen (WebP, HEIC), ist dagegen kein
 *    Technikfehler: kein Befund.
 *  - „kassenbon" → kein Befund. Kassenbons zählen immer, auch e-Bons und
 *    Bons aus Händler-Apps als Bildschirmfoto (Entscheidung Patrick
 *    04.10.2026, CLAUDE.md: „Screenshots eines Kassenbons aus Händler-Apps …
 *    zählen als Kassenbon"). Gemessen 127 von 127 Bon-Dateien richtig als
 *    „kassenbon", kein Bildschirmfoto je als „kassenbon". EINE Ausnahme
 *    (Prüfrunde 2, 04.10.2026): Merkmale passen (oder der Kopf war nicht
 *    abrufbar — Prüfrunde 3: ohne Kopf gibt die Regel nichts frei) UND der
 *    Lesedienst hat das Preisfoto gelesen und dabei KEINEN Bon gesehen →
 *    `halten`. Dann widersprechen sich zwei Lesungen in genau der Richtung, in
 *    der bezahlt wird (Warenkorb oder Bestellübersicht einer Händler-App als
 *    „Bon", oder ein Modellwechsel) — ohne dieses Gegenzeichen hinge die
 *    Bezahlung an EINER Antwort. Gemessen kostet das nichts: 0 von 167
 *    Kassenbons trägt der Lesedienst als „kein Bon" (164 als Bon, 3 ungelesen).
 *    Dazu der Befund zum Preisbeleg (`belegGrund`, preisBelegBefund —
 *    Entscheidung Claude im Auftrag Patricks 04.10.2026): ein „Kassenbon"
 *    ohne jedes Kassenbon-Merkmal (Warenkorb-Lücke aus Prüfrunde 3) oder von
 *    einem Händler, der keiner unserer Märkte ist (Amazon …) → `halten`, nie
 *    `ablehnen`. Der Bericht zählt weiter jeden „Kassenbon", den der
 *    Lesedienst nicht als Bon las (`kassenbonLesedienstOhneBon`).
 *    Wörtlich genommen („nur eins von beiden → liegen lassen") lägen ~34
 *    e-Bons pro Woche bei Patrick — diese Lesart ist ihm zur Entscheidung
 *    vorgelegt, der Bericht zählt die Fälle (`kassenbonMitMerkmal`).
 *  - sonst („laden"/„keiner" ohne Merkmale, Kopf gelesen) → kein Befund.
 *
 * Der Befund BEIDER Regeln zusammen, ohne Blick auf die Schalter. Was davon
 * wirkt, entscheidet preisBildschirmLage — je Regel unter ihrem eigenen
 * Schalter (Nachprüfung 05.10.2026).
 *
 * @param {{quelle:string|null, merkmal:boolean|null, lesedienstBon?:boolean, lesedienstOhneBon?:boolean, kopfGescheitert?:boolean, belegGrund?:string|null}} e
 * @returns {'ablehnen'|'halten'|null}
 */
function preisBildschirmBefund({ quelle, merkmal, lesedienstBon = false, lesedienstOhneBon = false, kopfGescheitert = false, belegGrund = null } = {}) {
  const q = preisQuelleOf(quelle);
  const m = merkmal === true;
  const ohneKopf = kopfGescheitert === true;
  // Der Lesedienst hat das Preisfoto gelesen und KEINEN Bon gesehen — das
  // einzige Lesedienst-Zeichen, auf das hin abgelehnt bzw. ein „Kassenbon"
  // angezweifelt wird. Fehlt die Lesung, hat er nichts gesagt.
  const keinBon = keinBonVon({ lesedienstBon, lesedienstOhneBon });
  if (q === 'kassenbon') return ((m || ohneKopf) && keinBon) || belegGrundOf(belegGrund) ? 'halten' : null;
  if (q === 'bildschirm') return m && keinBon ? 'ablehnen' : 'halten';
  if (q === 'unklar') return 'halten';
  // „laden", „keiner" und fehlende Antwort: halten bei passenden Merkmalen oder ohne lesbaren Kopf.
  return m || ohneKopf ? 'halten' : null;
}

/** Der Lesedienst hat das Preisfoto gelesen und keinen Bon gesehen (siehe preisBildschirmBefund). */
function keinBonVon(pb) {
  return !!pb && pb.lesedienstOhneBon === true && pb.lesedienstBon !== true;
}

/** Bekannter Befund zum Preisbeleg oder null. */
function belegGrundOf(v) {
  return v === BELEG_OHNE_MERKMALE || v === BELEG_FREMDER_HAENDLER ? v : null;
}

/* ──────────────── Zwei Regeln, zwei Schalter (Nachprüfung 05.10.2026) ──────────────── */

/** Die Regeln, je mit eigenem Schalter. Reihenfolge = Vorrang beim Halte-Grund. */
const REGEL_BILDSCHIRM = 'bildschirm';
const REGEL_BELEG = 'beleg';
const REGELN = Object.freeze([REGEL_BILDSCHIRM, REGEL_BELEG]);

/**
 * Schalter einer Regel aus der Eingabe der Runde: `modus` (Bildschirm-Regel)
 * bzw. `belegModus` (Preisbeleg). Fehlt der Wert oder ist er unbekannt →
 * 'shadow': ohne ausdrücklich scharfen Schalter wirkt keine Regel, und nie
 * schaltet der Schalter der einen Regel die andere mit.
 * @returns {false|'shadow'|true}
 */
function schalterVon(pb, regel) {
  return modusPreisBildschirm(pb ? (regel === REGEL_BELEG ? pb.belegModus : pb.modus) : undefined);
}

/**
 * Befund je Regel, aus den Feldern der Eingabe (nie aus einem gespeicherten
 * Gesamtbefund). Eine Regel mit Schalter `false` liefert null.
 *  - `bildschirm`: preisBildschirmBefund ohne den Preisbeleg
 *    (auch „Kassenbon" + Bildschirm-Merkmale + Lesedienst ohne Bon, Prüfrunde 2);
 *  - `beleg`: 'halten' bei einem Preisbeleg-Befund (nur „kassenbon").
 * @returns {{bildschirm:'ablehnen'|'halten'|null, beleg:'halten'|null}}
 */
function preisBildschirmTeile(pb) {
  if (!pb || typeof pb !== 'object') return { bildschirm: null, beleg: null };
  const bildschirm = schalterVon(pb, REGEL_BILDSCHIRM) === false ? null : preisBildschirmBefund({ ...pb, belegGrund: null });
  const beleg = schalterVon(pb, REGEL_BELEG) !== false && preisQuelleOf(pb.quelle) === 'kassenbon' && belegGrundOf(pb.belegGrund) ? 'halten' : null;
  return { bildschirm, beleg };
}

/**
 * Grund eines heutigen Halts der Bildschirm-Regel: nur der fehlende Bildkopf
 * (Technik) → PREIS_KOPF_NICHT_LESBAR, damit ein Storage-Ausfall nicht als
 * „Modell liest anders" gemeldet wird. „Nur der Kopf" heißt: die Antwort
 * allein hätte nicht gehalten (laden, keiner, kassenbon, keine Antwort) — bei
 * „bildschirm" und „unklar" hält die Antwort selbst. Sonst PREIS_BILDSCHIRM_UNSICHER.
 */
function bildschirmGrundHeute(pb) {
  const q = preisQuelleOf(pb.quelle);
  return q !== 'bildschirm' && q !== 'unklar' && pb.merkmal !== true && pb.kopfGescheitert === true ? PREIS_KOPF_NICHT_LESBAR : PREIS_BILDSCHIRM_UNSICHER;
}

/**
 * Regeln eines Befunds aus einem früheren scharfen Lauf. `regeln` am Eintrag
 * (seit 05.10.2026); ältere Einträge kennen nur `art: 'beleg'` (Preisbeleg)
 * bzw. nichts (Bildschirm-Regel). Ein „ablehnen" kommt immer aus der
 * Bildschirm-Regel — der Preisbeleg lehnt nie ab.
 * @returns {string[]}
 */
function vorbefundRegeln(v) {
  if (!v || typeof v !== 'object') return [];
  if (v.befund === 'ablehnen') return [REGEL_BILDSCHIRM];
  const r = Array.isArray(v.regeln) ? REGELN.filter((x) => v.regeln.includes(x)) : [];
  if (r.length) return r;
  return [v.art === 'beleg' ? REGEL_BELEG : REGEL_BILDSCHIRM];
}

/**
 * Was der Befund bedeutet — JE REGEL unter ihrem eigenen Schalter
 * (Nachprüfung 05.10.2026: hingen beide an einem Schalter, gab das
 * Zurücknehmen der einen Regel am nächsten Morgen auch die Halte der anderen
 * frei, ohne dass ein Mensch sie gesehen hatte).
 *
 *  - `scharf: false` (Standard): was beobachtet wird — jede Regel, deren
 *    Schalter nicht `false` ist. Für den Bericht und den Beobachtungs-Eintrag.
 *  - `scharf: true`: was WIRKT — nur Regeln mit Schalter `true`.
 *
 * Ein Befund eines früheren scharfen Laufs (`vorbefund`, aus
 * preisBildschirmMitVorbefund) hält nur für die Regeln, deren Schalter heute
 * scharf ist; nimmt man eine Regel zurück, endet nur IHR Halt. Mit Vorbefund
 * wird nie abgelehnt (ein haltender Vorbefund verschärft höchstens zu
 * „halten", preisBildschirmMitVorbefund) — auch nicht, wenn die Regel des
 * Vorbefunds zurückgenommen ist und heute die Bildschirm-Regel „ablehnen"
 * liest: der Fall liegt schon, und jeder weitere Morgen wäre eine neue
 * Chance auf eine Ablehnung, die an EINER Modellantwort hängt. Das gilt für
 * BEIDE Rückwege und für jeden folgenden Morgen: `ablehnenGesperrt` steht am
 * Fall, bis ein Mensch entscheidet (preisBildschirmEintrag). Bei `'shadow'`
 * reist am Morgen der Rücknahme zusätzlich der Vorbefund zur Beobachtung mit
 * (`vorbefund`, für den Bericht), weitergetragen wird danach nur die Sperre
 * (Nachprüfung 05.10.2026: mit `false` wurde ein gehaltener Preisbeleg auf
 * eine einzige neue „bildschirm"-Lesung hin abgelehnt, mit `'shadow'` blieb er
 * liegen; Nachprüfung 06.10.2026: an einem Morgen ohne Bildprüfung oder ohne
 * Befund ging die Sperre verloren).
 *
 * Grund des Halts: ein übernommener Befund behält seine Art (Bildschirm geht
 * vor Preisbeleg); sonst Bildschirm-Verdacht vor Preisbeleg vor nicht
 * abrufbarem Bildkopf. `regeln` sind die Regeln, deren Befund über das FOTO
 * den Halt trägt — sie werden weitergetragen (preisBildschirmEintrag); ein
 * Halt nur wegen des nicht abrufbaren Bildkopfs gehört nicht dazu (morgen
 * neu prüfen, wie foto_abgleich_gescheitert).
 *
 * Für den Tagesbericht (preisBildschirmZaehlart, Nachprüfung 05.10.2026):
 * `vorRegeln` = Regeln, deren Befund eines FRÜHEREN scharfen Laufs hier gilt
 * (in `regeln` enthalten) — auch eine von der Notbremse zurückgehaltene
 * Ablehnung, die heute erneut „ablehnen" liest (`vorbefundSeit`); `kopf` =
 * die Bildschirm-Regel hält heute (auch) wegen des nicht abrufbaren Bildkopfs.
 *
 * @param {object|null} pb  Eingabe der Runde (pbVon) bzw. preisBildschirmMitVorbefund
 * @param {{scharf?:boolean}} [o]
 * @returns {{befund:'ablehnen'|'halten'|null, regeln:string[], grund:string|null, ausVorbefund:boolean, vorRegeln:string[], kopf:boolean}}
 */
function preisBildschirmLage(pb, { scharf = false } = {}) {
  const leer = { befund: null, regeln: [], grund: null, ausVorbefund: false, vorRegeln: [], kopf: false };
  if (!pb || typeof pb !== 'object') return leer;
  const gilt = (r) => (scharf ? schalterVon(pb, r) === true : schalterVon(pb, r) !== false);
  const t = preisBildschirmTeile(pb);
  if (!pb.vorbefund && pb.ablehnenGesperrt !== true && t.bildschirm === 'ablehnen' && gilt(REGEL_BILDSCHIRM)) {
    return { befund: 'ablehnen', regeln: [REGEL_BILDSCHIRM], grund: PREIS_BILDSCHIRM, ausVorbefund: false, vorRegeln: pb.vorbefundSeit ? [REGEL_BILDSCHIRM] : [], kopf: false };
  }
  const vor = pb.vorbefund ? vorbefundRegeln(pb.vorbefund).filter(gilt) : [];
  const regeln = new Set(vor);
  let nurKopf = false;
  if (t.bildschirm && gilt(REGEL_BILDSCHIRM)) {
    if (t.bildschirm === 'halten' && bildschirmGrundHeute(pb) === PREIS_KOPF_NICHT_LESBAR) nurKopf = true;
    else regeln.add(REGEL_BILDSCHIRM);
  }
  if (t.beleg && gilt(REGEL_BELEG)) regeln.add(REGEL_BELEG);
  if (!regeln.size && !nurKopf) return leer;
  const geordnet = REGELN.filter((r) => regeln.has(r));
  let grund;
  if (vor.length) grund = vor.includes(REGEL_BILDSCHIRM) ? PREIS_BILDSCHIRM_UNSICHER : PREIS_BELEG_UNSICHER;
  else if (regeln.has(REGEL_BILDSCHIRM)) grund = PREIS_BILDSCHIRM_UNSICHER;
  else if (regeln.has(REGEL_BELEG)) grund = PREIS_BELEG_UNSICHER;
  else grund = PREIS_KOPF_NICHT_LESBAR;
  return { befund: 'halten', regeln: geordnet, grund, ausVorbefund: vor.length > 0, vorRegeln: REGELN.filter((r) => vor.includes(r)), kopf: nurKopf };
}

/**
 * Grund eines offenen Falls mit Halte-Befund (beobachtet, preisBildschirmLage):
 *  - ein „Kassenbon", der nur wegen des Preisbelegs liegt (ohne Merkmale,
 *    fremder Händler — preisBelegBefund) → PREIS_BELEG_UNSICHER. Das gilt
 *    auch, wenn zusätzlich der Bildkopf fehlte: der Beleg-Befund ist ein
 *    Urteil über das Foto und wird weitergetragen, der fehlende Kopf nicht.
 *    Passen dagegen die Dateimerkmale UND widerspricht der Lesedienst, ist es
 *    der Bildschirm-Verdacht (PREIS_BILDSCHIRM_UNSICHER);
 *  - nur der fehlende Bildkopf (Technik) → PREIS_KOPF_NICHT_LESBAR;
 *  - sonst PREIS_BILDSCHIRM_UNSICHER.
 * Ein übernommener Befund behält seine Art.
 */
function preisBildschirmHalteGrund(pb) {
  return preisBildschirmLage(pb).grund || PREIS_BILDSCHIRM_UNSICHER;
}

/**
 * Wie ein Fall im Tagesbericht zählt — je Regel und nur an EINEM Morgen
 * (Nachprüfung 05.10.2026). Vorher zählte jeder Fall mit Befund in den
 * Zeilen der Bildschirm-Regel, auch ein reiner Preisbeleg-Fall, und ein
 * scharf gehaltener Fall erneut an jedem Morgen, an dem er auf Patrick
 * wartete — beides blähte genau die Zahlen auf, nach denen die Regeln scharf
 * geschaltet werden.
 *
 *  - Wirkt heute ein Befund eines früheren scharfen Laufs (`vorWirkt`), lag
 *    der Fall schon: er zählt NUR unter `ausVortagen` (je Regel dieses
 *    Befunds, und nur solange er offen bleibt) — nicht noch einmal als
 *    heutiger Befund, auch wenn heute eine Regel erneut anschlägt.
 *  - Sonst `frisch`: die Regeln, deren HEUTIGER Befund den Fall trägt — die
 *    Bildschirm-Regel auch bei einem Halt nur wegen des nicht abrufbaren
 *    Bildkopfs (`kopf`). Ein Befund eines früheren Laufs, dessen Regel
 *    zurückgenommen ist (`vor`), zählt nicht als heutiger Befund.
 *
 * @param {{regeln?:string[], vor?:string[], vorWirkt?:string[], kopf?:boolean}|null} f  preisBildschirmFall (fotoRundeRegeln.freigabe)
 * @param {string} entscheidung  endgültige Entscheidung des Laufs (nach Notbremse und Schreiben)
 * @returns {{frisch:string[], ausVortagen:string[]}}
 */
function preisBildschirmZaehlart(f, entscheidung) {
  if (!f || typeof f !== 'object') return { frisch: [], ausVortagen: [] };
  const liste = (v) => (Array.isArray(v) ? REGELN.filter((r) => v.includes(r)) : []);
  const vorWirkt = liste(f.vorWirkt);
  if (vorWirkt.length) return { frisch: [], ausVortagen: entscheidung === 'offen' ? vorWirkt : [] };
  const vor = liste(f.vor);
  const heute = new Set(liste(f.regeln));
  if (f.kopf === true) heute.add(REGEL_BILDSCHIRM);
  return { frisch: REGELN.filter((r) => heute.has(r) && !vor.includes(r)), ausVortagen: [] };
}

/**
 * Hinweis für den Menschen — landet in `review.rundeOffen.hinweis`, also an
 * einem Dokument, das der Einreicher selbst lesen darf (firestore.rules
 * `crowd_uploads` read für den Eigentümer; die App lädt das ganze Dokument,
 * productSubmit.subscribeUserProductSubmissions). Deshalb NUR das Urteil,
 * nie woran es hängt (Dateiformat, Seitenverhältnis, Kamerahersteller, die
 * Begründung des Modells) — sonst lädt der Hinweis zum Umgehen ein
 * (Gegenprüfung 04.10.2026; vgl. kontoSperre). Die Einzelheiten stehen nur
 * im Tagesbericht (`preisBildschirm.faelle` bzw. `preisBildschirm.beleg.faelle`, nur für Admins).
 * Beschrieben wird, was WIRKT (preisBildschirmLage scharf); wirkt nichts,
 * das Beobachtete.
 */
function preisBildschirmHinweis(pb = {}) {
  const wirkt = preisBildschirmLage(pb, { scharf: true });
  const l = wirkt.befund ? wirkt : preisBildschirmLage(pb);
  if (l.befund === 'ablehnen') return 'Preisfoto zeigt einen Bildschirm (App, Online-Shop, Prospekt) — Einzelheiten im Tagesbericht';
  // Preisbeleg (05.10.2026): bewusst ohne „Warenkorb" oder „Händler" — wer
  // liest, woran es hing, schneidet beim nächsten Mal den Kopf ab bzw. eine
  // Summenzeile dazu. Welcher Befund, steht nur im Tagesbericht.
  if (l.ausVorbefund) {
    const seit = (pb.vorbefund && pb.vorbefund.seit) || 'früheren Lauf';
    if (l.grund === PREIS_BELEG_UNSICHER) return `Preisbeleg unsicher — Befund vom ${seit}, gilt bis zur Entscheidung in der Konsole`;
    return `Preisquelle unsicher (vielleicht ein Bildschirmfoto) — Befund vom ${seit}, gilt bis zur Entscheidung in der Konsole`;
  }
  if (l.grund === PREIS_BELEG_UNSICHER) return 'Preisbeleg unsicher — Preisfoto bitte selbst ansehen, Einzelheiten im Tagesbericht';
  if (l.grund === PREIS_KOPF_NICHT_LESBAR) return 'Preisfoto-Datei war nicht abrufbar (Technik) — Preisfoto bitte selbst ansehen';
  return 'Preisquelle unsicher (vielleicht ein Bildschirmfoto) — Preisfoto bitte selbst ansehen, Einzelheiten im Tagesbericht';
}

/**
 * Was am Dokument landet (`review.rundeOffen.preisBildschirm`, nur bei einem
 * nach dem Lauf offenen Fall mit Befund). `review` steht in der Sperrliste
 * von firestore.rules — die App darf es beim Anlegen nicht mitschicken, also
 * kann sich niemand einen Befund vorgeben. Nur Modus, Befund, seit wann er
 * steht und welche Regeln ihn tragen: OHNE Antwort und Begründung des
 * Modells, ohne Dateimerkmale — das Dokument liest der Einreicher selbst
 * (siehe preisBildschirmHinweis).
 *  - `modus: true` + `regeln`: Regeln, deren SCHARFER Befund den Fall hält
 *    bzw. ablehnt (preisBildschirmLage scharf) — der nächste Lauf übernimmt
 *    sie je Regel (preisBildschirmVorbefund), und nur der Schalter der
 *    jeweiligen Regel hebt sie wieder auf (Nachprüfung 05.10.2026).
 *  - `modus: 'shadow'`: wirkt nichts, das Beobachtete — nur Hinweis in der
 *    Konsole, nie übernommen.
 *  - `seit`: Lauf, in dem der übernommene Befund zuerst stand, sonst dieser Lauf.
 *  - `art: 'beleg'`: der Halt-Grund ist der Preisbeleg — für den Hinweis in
 *    der Konsole. Bewusst nur „beleg", nicht welcher der beiden Befunde.
 *  - `ablehnenGesperrt` + `gesperrtSeit`: die Sperre gegen eine automatische
 *    Ablehnung (siehe unten) und der Lauf, in dem eine scharfe Regel den Fall
 *    zuerst angehalten hat. Steht auch OHNE heutigen Befund da — dann ist sie
 *    der ganze Eintrag (`{ablehnenGesperrt, gesperrtSeit}`; die Konsole zeigt
 *    dazu keinen Hinweis, einreichung.preisBildschirmOf verlangt einen Befund).
 * Ein Halt NUR wegen des nicht abrufbaren Bildkopfs landet hier nicht: er ist
 * kein Befund über das Foto, sondern ein Technikfehler — der Grund steht in
 * `review.rundeOffen.grund` (PREIS_KOPF_NICHT_LESBAR), und der nächste Lauf
 * prüft neu, statt den Halt für immer zu übernehmen (wie
 * foto_abgleich_gescheitert, das auch nicht weitergetragen wird).
 *
 * Sperre (Nachprüfung 06.10.2026): ein Fall, den eine SCHARFE Regel einmal
 * angehalten hat, wird von der Runde nie mehr auf eine Bildschirm-Lesung hin
 * abgelehnt — auch nicht, nachdem seine Regel zurückgenommen ist
 * (preisBildschirmMitVorbefund). Vorher stand sie nur im Speicher des Laufs
 * und überlebte nur, wenn am Morgen der Rücknahme ein neuer scharfer Befund
 * entstand: scheiterte an dem Morgen die Bildprüfung (429, Zeitgrenze), oder
 * lag der Fall aus einem anderen Grund (Ort auffällig) und wurde ohne Befund
 * gelesen, war sie am nächsten Morgen weg — und eine einzige
 * „bildschirm"-Antwort lehnte den Fall endgültig ab. Ein Technikfehler
 * entschied so mittelbar über eine Ablehnung. Die Sperre hält, bis ein Mensch
 * in der Konsole entscheidet (jede Entscheidung dort ersetzt `review`).
 * Sie sagt nichts darüber, woran der Halt hing — das Dokument liest der
 * Einreicher selbst.
 */
function preisBildschirmEintrag(pb, { lauf = null } = {}) {
  if (!pb) return null;
  const wirkt = preisBildschirmLage(pb, { scharf: true });
  const scharf = wirkt.regeln.length > 0;
  const l = scharf ? wirkt : preisBildschirmLage(pb);
  const s = (v) => (typeof v === 'string' && v ? v.slice(0, 40) : null);
  let befund = null;
  if (l.regeln.length) {
    const seitVor = l.ausVorbefund ? s(pb.vorbefund && pb.vorbefund.seit) : l.befund === 'ablehnen' ? s(pb.vorbefundSeit) : null;
    befund = {
      modus: scharf ? true : 'shadow',
      befund: l.befund,
      seit: seitVor || s(lauf),
      ...(scharf ? { regeln: l.regeln } : {}),
      ...(l.grund === PREIS_BELEG_UNSICHER ? { art: 'beleg' } : {}),
    };
  }
  // Gesperrt: heute hält eine scharfe Regel den Fall, oder die Sperre eines
  // früheren Laufs reist mit (preisBildschirmMitVorbefund). Eine von der
  // Notbremse zurückgehaltene Ablehnung sperrt nicht (`befund: 'ablehnen'`).
  const haeltHeute = scharf && wirkt.befund === 'halten';
  if (!haeltHeute && pb.ablehnenGesperrt !== true) return befund;
  return {
    ...(befund || {}),
    ablehnenGesperrt: true,
    gesperrtSeit: s(pb.gesperrtSeit) || (haeltHeute && befund ? befund.seit : null) || s(lauf),
  };
}

/**
 * Befund eines FRÜHEREN, SCHARFEN Laufs aus `review.rundeOffen.preisBildschirm`
 * (Gegenprüfung 04.10.2026, analog fotoRundeRegeln.fotoVorbefund und
 * werte.eanFotoVorbefund). Ein Befund aus der Beobachtung hält nichts.
 * `regeln`: welche Regeln ihn tragen (vorbefundRegeln) — er hält je Regel nur
 * unter deren Schalter (preisBildschirmLage).
 * Die Sperre gegen eine automatische Ablehnung (`ablehnenGesperrt`,
 * preisBildschirmEintrag) kommt mit — auch an einem Eintrag ohne scharfen
 * Befund; dann `befund: null` (hält nichts, sperrt nur die Ablehnung).
 * @returns {{befund:'ablehnen'|'halten'|null, seit:string|null, regeln:string[], ablehnenGesperrt?:true, gesperrtSeit?:string|null}|null}
 */
function preisBildschirmVorbefund(x) {
  const ro = x && x.review && typeof x.review === 'object' && x.review.rundeOffen && typeof x.review.rundeOffen === 'object' ? x.review.rundeOffen : null;
  const pb = ro && ro.preisBildschirm && typeof ro.preisBildschirm === 'object' ? ro.preisBildschirm : null;
  if (!pb) return null;
  const s = (v) => (typeof v === 'string' && v ? v.slice(0, 40) : null);
  const sperre = pb.ablehnenGesperrt === true ? { ablehnenGesperrt: true, gesperrtSeit: s(pb.gesperrtSeit) } : null;
  if (pb.modus !== true || !(pb.befund === 'ablehnen' || pb.befund === 'halten')) {
    return sperre ? { befund: null, seit: null, regeln: [], ...sperre } : null;
  }
  return { befund: pb.befund, seit: s(pb.seit) || s(ro.lauf), regeln: vorbefundRegeln(pb), ...(sperre || {}) };
}

/**
 * Heutigen Befund mit dem eines früheren scharfen Laufs verbinden. Ein einmal
 * angehaltener Fall wird NIE automatisch freigegeben — auch nicht, wenn das
 * Modell am nächsten Morgen anders antwortet oder die Bildprüfung scheitert
 * (dann fehlte der Hinweis sonst in der Konsole). Der Vorbefund verschärft
 * höchstens zu „halten", nie zur Ablehnung (heute nicht nachgeprüft).
 * Ein Vorbefund „halten" wird auch durch eine heutige Ablehn-Lesung NICHT zur
 * Ablehnung (Prüfrunde 3, 04.10.2026): der Fall liegt, weil ein Mensch
 * hinsehen soll — und gehalten wurde er, weil sich etwas widersprach (etwa
 * „laden" oder „kassenbon" zu einer Datei, die wie ein Bildschirm aussieht).
 * Würde jeden Morgen neu gefragt und die erste „bildschirm"-Antwort
 * entschiede, wüchse die Wahrscheinlichkeit einer Ablehnung mit jedem Tag, den
 * der Fall auf Patrick wartet; die Antwort des Vortags steht bewusst nicht am
 * Dokument (preisBildschirmEintrag), ginge also verloren. Nur ein Vorbefund
 * „ablehnen" (von der Notbremse zurückgehalten) darf bei heutiger
 * Ablehn-Lesung abgelehnt werden.
 *
 * Aufheben kann nur ein Mensch in der Konsole (jede Entscheidung dort ersetzt
 * `review`) — oder der Schalter DER REGEL, die den Befund trägt
 * (Nachprüfung 05.10.2026): `false` nimmt ihren Befund weg, in `'shadow'`
 * hält er nichts mehr und reist nur an diesem Morgen zur Beobachtung mit
 * (preisBildschirmLage) — am Dokument steht danach nur noch die Sperre gegen
 * eine Ablehnung (siehe unten). Der Schalter der anderen Regel berührt ihn nie.
 *
 * Auch mit `false` lehnt der heutige Lauf einen gehaltenen Fall nicht ab
 * (Nachprüfung 05.10.2026): nimmt der Schalter ALLE Regeln des früheren
 * Halts weg, bleibt nur die Sperre — `ablehnenGesperrt` am heutigen Befund
 * (bei `'shadow'` ebenso, neben dem mitreisenden Vorbefund).
 * Liest die Bildschirm-Regel heute „ablehnen", hält sie den Fall dann nur
 * (preis_bildschirm_unsicher), genau wie beim Rückweg über `'shadow'`. Vorher
 * wurde ein Preisbeleg-Halt nach `preisBelegRegel: false` auf eine einzige
 * neue „bildschirm"-Lesung hin endgültig abgelehnt. Eine von der Notbremse
 * zurückgehaltene Ablehnung (Vorbefund „ablehnen") ist kein Halt für einen
 * Menschen — ihre Regel ist die Bildschirm-Regel, und ist die aus, lehnt heute
 * ohnehin nichts ab.
 *
 * Die Sperre reist mit, bis ein Mensch entscheidet (Nachprüfung 06.10.2026):
 * `ablehnenGesperrt` + `gesperrtSeit` stehen am Ergebnis, sobald der frühere
 * Lauf den Fall angehalten hatte (Vorbefund „halten") oder selbst schon eine
 * Sperre trug — auch OHNE heutige Bildprüfung und auch, wenn beide Schalter
 * aus sind. Dann ist das Ergebnis eine Eingabe ohne Befund, die nur die
 * Sperre trägt (preisBildschirmEintrag schreibt sie zurück). Vorher gab dieser
 * Weg `null` bzw. eine herabgestufte Beobachtung zurück, und am Morgen darauf
 * lehnte eine einzige „bildschirm"-Lesung den Fall ab.
 *
 * @param {object|null} heute  Eingabe der Runde (pbVon) oder null (keine Bildprüfung heute)
 * @param {{befund:string|null, seit:string|null, regeln?:string[], ablehnenGesperrt?:boolean, gesperrtSeit?:string|null}|null} vorher  preisBildschirmVorbefund
 * @param {{bildschirm:false|'shadow'|true, beleg:false|'shadow'|true}} modi  heutige Schalter je Regel
 */
function preisBildschirmMitVorbefund(heute, vorher, modi) {
  if (!modi || typeof modi !== 'object') throw new TypeError('preisBildschirmMitVorbefund: Schalter je Regel erwartet ({bildschirm, beleg})');
  const m = { [REGEL_BILDSCHIRM]: modusPreisBildschirm(modi.bildschirm), [REGEL_BELEG]: modusPreisBeleg(modi.beleg) };
  const gesperrtVorher = !!vorher && (vorher.ablehnenGesperrt === true || vorher.befund === 'halten');
  const sperre = gesperrtVorher
    ? { ablehnenGesperrt: true, gesperrtSeit: vorher.gesperrtSeit || (vorher.befund === 'halten' ? vorher.seit : null) || null }
    : null;
  // Ohne heutige Bildprüfung: eine Eingabe ohne jeden Befund, nur die Schalter (und ggf. die Sperre).
  const ohneLesung = { quelle: null, grund: null, merkmal: null, lesedienstBon: false, lesedienstOhneBon: false, kopfGescheitert: false, belegGrund: null };
  if (m[REGEL_BILDSCHIRM] === false && m[REGEL_BELEG] === false) {
    return sperre ? { ...ohneLesung, modus: false, belegModus: false, befund: null, ...sperre } : null;
  }
  const vor = vorher && vorher.befund ? vorbefundRegeln(vorher).filter((r) => m[r] !== false) : [];
  if (!vor.length) {
    if (!sperre) return heute;
    const gesperrt = { ...(heute || { ...ohneLesung, modus: m[REGEL_BILDSCHIRM], belegModus: m[REGEL_BELEG] }), ...sperre };
    return { ...gesperrt, befund: preisBildschirmLage(gesperrt).befund };
  }
  const heuteBefund = heute ? preisBildschirmLage(heute).befund : null;
  if (heuteBefund === 'ablehnen' && vorher.befund === 'ablehnen' && !sperre) return { ...heute, vorbefundSeit: vorher.seit };
  return {
    ...(heute || ohneLesung),
    modus: m[REGEL_BILDSCHIRM],
    belegModus: m[REGEL_BELEG],
    befund: 'halten',
    vorbefund: { befund: vorher.befund, seit: vorher.seit, regeln: vor },
    heute: heuteBefund,
    ...(sperre || {}),
  };
}

module.exports = {
  PREIS_QUELLEN, PREIS_BILDSCHIRM, PREIS_BILDSCHIRM_UNSICHER, PREIS_KOPF_NICHT_LESBAR, KOPF_BYTES,
  modusPreisBildschirm, modusPreisBeleg, schalterRohOf, preisQuelleOf, lesedienstBonOf, lesedienstOhneBonOf, bildKopf, tiffKennung, bildschirmMerkmal, kameraFormat,
  preisBildschirmBefund, keinBonVon, preisBildschirmHalteGrund, preisBildschirmHinweis, preisBildschirmEintrag,
  preisBildschirmVorbefund, preisBildschirmMitVorbefund,
  REGEL_BILDSCHIRM, REGEL_BELEG, REGELN, preisBildschirmTeile, preisBildschirmLage, vorbefundRegeln, preisBildschirmZaehlart,
  BELEG_MERKMALE, PREIS_BELEG_UNSICHER, BELEG_OHNE_MERKMALE, BELEG_FREMDER_HAENDLER, UNSERE_KETTEN,
  belegMerkmaleOf, belegHaendlerOf, lesedienstKopfOf, haendlerWoerter, marktSchluessel, unserMarkt, preisBelegBefund, belegGrundOf,
};
