/**
 * Konfiguration der Produktsuche (Hintergrundsuche für unbekannte Barcodes).
 *
 * Das Dokument `_meta/produktsuche` schreibt NUR der Server bzw. Patrick in
 * der Firebase-Console (Firestore-Regeln: finale deny-all, kein Client-Zugriff).
 * Fehlt es oder einzelne Felder, gelten die Standardwerte unten. Hochdrehen
 * und Anhalten gehen damit OHNE Deploy (Entscheidung 04.10.2026):
 *
 *   aktiv                  false hält jede bezahlte Suche sofort an
 *                          (wird in JEDER Beanspruchung neu gelesen)
 *   proLauf                höchstens so viele bezahlte Suchen je Lauf
 *                          (Takt: alle 10 Minuten)
 *   tagesDeckel            höchstens so viele bezahlte Suchen je Kalendertag
 *                          (Europe/Berlin) — harte Grenze, in derselben
 *                          Transaktion wie die Beanspruchung gezählt
 *   auffrischenNachTagen   nach wie vielen Tagen ein abgeschlossener Fall beim
 *                          nächsten Scan neu gesucht wird (liest die
 *                          Abfrage external-product-lookup, nicht dieser Prozessor)
 *   serperMindestGuthaben  unter diesem Serper-Guthaben wird nichts mehr bezahlt
 *   shopBilder             Bilder von Shopseiten anzeigen (liest
 *                          external-product-lookup; Patrick 04.10.: „ja“)
 *
 * Reine Funktionen, keine Seiteneffekte.
 *
 * Kopien derselben Standardwerte und Prüfregeln (Codebases teilen keinen
 * Code — bei Änderungen alle nachziehen):
 *   external-product-lookup/lib/konfiguration.js  (mitStandard)
 *   review-console/src/produktsuche.js            (konfigAus, nur Berichtsfelder)
 *
 * Zahlen dürfen als Zahl ODER als reine Ziffern im Text stehen (die Console
 * legt neue Felder als Text an). Ein ungültiger Eintrag bei aktiv, proLauf,
 * tagesDeckel oder serperMindestGuthaben hält die Suche an (Halt
 * 'konfig_ungueltig'), statt still auf den höheren Standard zu fallen.
 */

const KONFIG_PFAD = '_meta/produktsuche';

/**
 * Tageszähler je Kalendertag (Europe/Berlin):
 *   _meta/produktsuche_tage/tage/{YYYY-MM-DD}
 *   { tag, bearbeitet, gefunden, keineDaten, fehler, uebersprungen,
 *     serperRest, angehalten, kostenSchaetzungUsd, aktualisiertAm }
 *
 * Der Vertrag nannte `_meta/produktsuche_tage/{YYYY-MM-DD}` — das sind drei
 * Pfadteile und damit eine Sammlung, kein Dokument (Firestore wirft dort).
 * Die kleinste gültige Form fügt die Sammlung `tage` ein. Der Tagesbericht
 * (review-console) liest denselben Pfad.
 */
const TAGE_SAMMLUNG = '_meta/produktsuche_tage/tage';

/**
 * Zustand über Tage hinweg (nur der Prozessor schreibt; Elterndokument der
 * Tageszähler):
 *   _meta/produktsuche_tage
 *   { dienstAusfallInFolge, letzterDienstFehler, pausiertBisMs, aktualisiertAm }
 * Zwei dienstweite Fehler in Folge (KI, Suche, Schlüssel …) → Pause bis
 * pausiertBisMs (src/regeln.js pauseNachDienstAusfall). Steht nicht am
 * Tageszähler, damit eine Pause über Mitternacht nicht verfällt.
 */
const ZUSTAND_PFAD = '_meta/produktsuche_tage';

const STANDARD = Object.freeze({
  aktiv: true,
  proLauf: 1,
  tagesDeckel: 120,
  auffrischenNachTagen: 60,
  serperMindestGuthaben: 1000,
  shopBilder: false,
});

/**
 * Obergrenzen gegen Tippfehler am Geldweg. Ein Wert darüber wird gekappt
 * und als Warnung gemeldet, nicht still übernommen:
 * - proLauf: ein Lauf darf höchstens ~280 s neue Suchen beginnen
 *   (NEUE_EAN_BIS_MS); bei im Mittel 16 s je Suche sind mehr als 20 je Lauf
 *   ohnehin nicht zu schaffen.
 * - tagesDeckel: 5.000 Suchen ≈ 80 $ am Tag. Wer mehr will, ändert die
 *   Grenze hier bewusst (Deploy), nicht per Tippfehler in der Console.
 */
const GRENZEN = Object.freeze({
  proLauf: 20,
  tagesDeckel: 5000,
  auffrischenNachTagen: 3650,
  serperMindestGuthaben: 1_000_000,
});

/** Geschätzte Kosten je bezahlter Suche (Serper + KI + Apify + Rechenzeit),
 *  gemessen 02.–04.10.2026 an 273 Barcodes: ~0,016 $. Nur eine Schätzung
 *  für den Tagesbericht; die genauen KI-Kosten stehen je Aufruf in den
 *  Logzeilen `produktsuche_kosten` des nutrition-scraper. */
const KOSTEN_JE_SUCHE_USD = 0.016;

/**
 * Zahl aus dem Dokument: Zahlen und reine Ziffern als Text ('500') —
 * die Firebase-Console legt ein neues Feld standardmäßig als Text an
 * (Prüfrunde 2, 04.10.2026). Ganze Zahl ≥ min, über max gekappt; sonst null.
 */
function ganzeZahl(v, min, max) {
  const n = typeof v === 'string' && /^\s*\d+\s*$/.test(v) ? Number(v.trim()) : v;
  if (typeof n !== 'number' || !Number.isFinite(n) || !Number.isInteger(n)) return null;
  if (n < min) return null;
  return Math.min(n, max);
}

/**
 * Wert bei einem ungültigen Eintrag: Die Geld-Grenzen HALTEN an — wer einen
 * Wert bewusst einträgt, will meist senken oder anhalten; fiele ein
 * Tippfehler still auf den höheren Standard zurück, liefe die Suche weiter
 * und bezahlte (Prüfrunde 2). auffrischenNachTagen steuert kein Geld direkt
 * → Standard.
 */
const BEI_UNGUELTIG = Object.freeze({
  proLauf: 0,
  tagesDeckel: 0,
  serperMindestGuthaben: GRENZEN.serperMindestGuthaben,
  auffrischenNachTagen: STANDARD.auffrischenNachTagen,
});
/** Felder, deren ungültiger Eintrag die Suche anhält (`konfig.ungueltig`). */
const HALT_BEI_UNGUELTIG = new Set(['aktiv', 'proLauf', 'tagesDeckel', 'serperMindestGuthaben']);

/**
 * Führt das gelesene Dokument mit den Standardwerten zusammen und prüft jeden
 * Wert. Ziffern als Text gelten als Zahl. Ungültige Werte (falscher Typ,
 * negativ, keine ganze Zahl) halten bei den Geld-Grenzen an (BEI_UNGUELTIG)
 * und stehen in `konfig.ungueltig` — der Lauf vermerkt dann den Halt
 * 'konfig_ungueltig', der Tagesbericht meldet ihn rot. `aktiv`: alles außer
 * `true` hält an, wenn das Feld gesetzt ist (ein Schalter, den jemand bewusst
 * angefasst hat, darf durch einen Tippfehler nicht wieder Geld ausgeben);
 * ein Nicht-Wahrheitswert zählt außerdem als ungültig.
 *
 * @param {object|undefined|null} roh  Daten von _meta/produktsuche (oder nichts)
 * @returns {{ konfig: object, warnungen: string[] }}  konfig.ungueltig: Feldnamen
 */
function normalisiereKonfig(roh) {
  const d = roh && typeof roh === 'object' ? roh : {};
  const warnungen = [];
  const konfig = { ...STANDARD, ungueltig: [] };

  if (d.aktiv !== undefined) {
    if (d.aktiv === true) konfig.aktiv = true;
    else {
      konfig.aktiv = false;
      if (d.aktiv !== false) {
        konfig.ungueltig.push('aktiv');
        warnungen.push(`aktiv=${JSON.stringify(d.aktiv)} ist kein Wahrheitswert — angehalten`);
      }
    }
  }

  const zahlen = [
    ['proLauf', 0],
    ['tagesDeckel', 0],
    ['auffrischenNachTagen', 1],
    ['serperMindestGuthaben', 0],
  ];
  for (const [feld, min] of zahlen) {
    if (d[feld] === undefined) continue;
    const wert = ganzeZahl(d[feld], min, GRENZEN[feld]);
    if (wert === null) {
      konfig[feld] = BEI_UNGUELTIG[feld];
      if (HALT_BEI_UNGUELTIG.has(feld)) {
        konfig.ungueltig.push(feld);
        warnungen.push(`${feld}=${JSON.stringify(d[feld])} ungültig — angehalten`);
      } else {
        warnungen.push(`${feld}=${JSON.stringify(d[feld])} ungültig — Standard ${STANDARD[feld]}`);
      }
      continue;
    }
    if (wert !== Number(String(d[feld]).trim())) warnungen.push(`${feld}=${d[feld]} über der Grenze — auf ${wert} gekappt`);
    konfig[feld] = wert;
  }

  if (d.shopBilder !== undefined) {
    if (typeof d.shopBilder === 'boolean') konfig.shopBilder = d.shopBilder;
    else warnungen.push(`shopBilder=${JSON.stringify(d.shopBilder)} ist kein Wahrheitswert — Standard false`);
  }

  return { konfig, warnungen };
}

const BERLIN_TAG = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Berlin',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** Kalendertag in Europe/Berlin als 'YYYY-MM-DD' (Tageszähler, Tagesdeckel). */
function berlinTag(ms) {
  return BERLIN_TAG.format(new Date(ms));
}

/** Pfad des Tageszählers für einen Tag. */
function tagPfad(tag) {
  return `${TAGE_SAMMLUNG}/${tag}`;
}

module.exports = {
  KONFIG_PFAD,
  ZUSTAND_PFAD,
  STANDARD,
  GRENZEN,
  BEI_UNGUELTIG,
  KOSTEN_JE_SUCHE_USD,
  normalisiereKonfig,
  berlinTag,
  tagPfad,
};
