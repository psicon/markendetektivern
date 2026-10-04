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
 * Schalter `cashback_config/v1.preisBildschirmRegel`:
 *  - `false`     → aus: keine Zusatzfrage an das Modell, kein Bildkopf, nichts am Dokument.
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
 *    LÜCKE (Prüfrunde 3): ein auf Bon-Zeilen zugeschnittener Warenkorb, als
 *    4:3 ohne EXIF, wird bezahlt, wenn das Modell „kassenbon" sagt — auch mit
 *    Merkmalen, wenn der Lesedienst ebenfalls einen Bon liest. Der Bericht
 *    zählt und listet jeden „Kassenbon", den der Lesedienst nicht als Bon las
 *    (`kassenbonLesedienstOhneBon`), damit der Weg messbar ist
 *    (WISSEN-FOTORUNDE.md, Lücken). OFFEN: dieselbe Entscheidung lässt
 *    Online-Bestellungen nur bei UNSEREN Märkten gelten („Amazon nein") — ob
 *    das auch für den Preisbeleg gilt (Amazon-Rechnung zu einem
 *    Netto-Produkt), entscheidet Patrick; heute zählt jede Rechnung
 *    (WISSEN-FOTORUNDE.md, offene Punkte). Wörtlich genommen („nur eins von
 *    beiden → liegen lassen") lägen ~34 e-Bons pro Woche bei Patrick — diese
 *    Lesart ist ihm zur Entscheidung vorgelegt, der Bericht zählt die Fälle
 *    (`kassenbonMitMerkmal`).
 *  - sonst („laden"/„keiner" ohne Merkmale, Kopf gelesen) → kein Befund.
 *
 * @param {{quelle:string|null, merkmal:boolean|null, lesedienstBon?:boolean, lesedienstOhneBon?:boolean, kopfGescheitert?:boolean}} e
 * @returns {'ablehnen'|'halten'|null}
 */
function preisBildschirmBefund({ quelle, merkmal, lesedienstBon = false, lesedienstOhneBon = false, kopfGescheitert = false } = {}) {
  const q = preisQuelleOf(quelle);
  const m = merkmal === true;
  const ohneKopf = kopfGescheitert === true;
  // Der Lesedienst hat das Preisfoto gelesen und KEINEN Bon gesehen — das
  // einzige Lesedienst-Zeichen, auf das hin abgelehnt bzw. ein „Kassenbon"
  // angezweifelt wird. Fehlt die Lesung, hat er nichts gesagt.
  const keinBon = lesedienstOhneBon === true && lesedienstBon !== true;
  if (q === 'kassenbon') return (m || ohneKopf) && keinBon ? 'halten' : null;
  if (q === 'bildschirm') return m && keinBon ? 'ablehnen' : 'halten';
  if (q === 'unklar') return 'halten';
  // „laden", „keiner" und fehlende Antwort: halten bei passenden Merkmalen oder ohne lesbaren Kopf.
  return m || ohneKopf ? 'halten' : null;
}

/**
 * Grund eines offenen Falls mit Halte-Befund: nur der fehlende Bildkopf
 * (Technik) → PREIS_KOPF_NICHT_LESBAR, damit ein Storage-Ausfall nicht als
 * „Modell liest anders" gemeldet wird; sonst PREIS_BILDSCHIRM_UNSICHER.
 * „Nur der Kopf" heißt: die Antwort allein hätte nicht gehalten (laden,
 * keiner, kassenbon, keine Antwort) — bei „bildschirm" und „unklar" hält die
 * Antwort selbst.
 */
function preisBildschirmHalteGrund(pb) {
  if (!pb || pb.vorbefund) return PREIS_BILDSCHIRM_UNSICHER;
  const q = preisQuelleOf(pb.quelle);
  if (q !== 'bildschirm' && q !== 'unklar' && pb.merkmal !== true && pb.kopfGescheitert === true) return PREIS_KOPF_NICHT_LESBAR;
  return PREIS_BILDSCHIRM_UNSICHER;
}

/**
 * Hinweis für den Menschen — landet in `review.rundeOffen.hinweis`, also an
 * einem Dokument, das der Einreicher selbst lesen darf (firestore.rules
 * `crowd_uploads` read für den Eigentümer; die App lädt das ganze Dokument,
 * productSubmit.subscribeUserProductSubmissions). Deshalb NUR das Urteil,
 * nie woran es hängt (Dateiformat, Seitenverhältnis, Kamerahersteller, die
 * Begründung des Modells) — sonst lädt der Hinweis zum Umgehen ein
 * (Gegenprüfung 04.10.2026; vgl. kontoSperre). Die Einzelheiten stehen nur
 * im Tagesbericht (`preisBildschirm.faelle`, nur für Admins).
 */
function preisBildschirmHinweis(pb = {}) {
  if (pb.vorbefund) {
    return `Preisquelle unsicher (vielleicht ein Bildschirmfoto) — Befund vom ${pb.vorbefund.seit || 'früheren Lauf'}, gilt bis zur Entscheidung in der Konsole`;
  }
  if (pb.befund === 'ablehnen') return 'Preisfoto zeigt einen Bildschirm (App, Online-Shop, Prospekt) — Einzelheiten im Tagesbericht';
  if (preisBildschirmHalteGrund(pb) === PREIS_KOPF_NICHT_LESBAR) return 'Preisfoto-Datei war nicht abrufbar (Technik) — Preisfoto bitte selbst ansehen';
  return 'Preisquelle unsicher (vielleicht ein Bildschirmfoto) — Preisfoto bitte selbst ansehen, Einzelheiten im Tagesbericht';
}

/**
 * Was am Dokument landet (`review.rundeOffen.preisBildschirm`, nur bei einem
 * nach dem Lauf offenen Fall mit Befund). `review` steht in der Sperrliste
 * von firestore.rules — die App darf es beim Anlegen nicht mitschicken, also
 * kann sich niemand einen Befund vorgeben. Nur Modus, Befund und seit wann er
 * steht: OHNE Antwort und Begründung des Modells, ohne Dateimerkmale — das
 * Dokument liest der Einreicher selbst (siehe preisBildschirmHinweis).
 * `seit`: Lauf, in dem der Befund zuerst stand — der nächste Lauf übernimmt
 * einen scharfen Befund damit (preisBildschirmVorbefund).
 * Ein Halt NUR wegen des nicht abrufbaren Bildkopfs landet hier nicht: er ist
 * kein Befund über das Foto, sondern ein Technikfehler — der Grund steht in
 * `review.rundeOffen.grund` (PREIS_KOPF_NICHT_LESBAR), und der nächste Lauf
 * prüft neu, statt den Halt für immer zu übernehmen (wie
 * foto_abgleich_gescheitert, das auch nicht weitergetragen wird).
 */
function preisBildschirmEintrag(pb, { lauf = null } = {}) {
  if (!pb) return null;
  const befund = pb.befund === 'ablehnen' || pb.befund === 'halten' ? pb.befund : null;
  if (!befund) return null;
  if (befund === 'halten' && preisBildschirmHalteGrund(pb) === PREIS_KOPF_NICHT_LESBAR) return null;
  const s = (v) => (typeof v === 'string' && v ? v.slice(0, 40) : null);
  return {
    modus: pb.modus === true ? true : 'shadow',
    befund,
    seit: s(pb.vorbefund && pb.vorbefund.seit) || s(lauf),
  };
}

/**
 * Befund eines FRÜHEREN, SCHARFEN Laufs aus `review.rundeOffen.preisBildschirm`
 * (Gegenprüfung 04.10.2026, analog fotoRundeRegeln.fotoVorbefund und
 * werte.eanFotoVorbefund). Ein Befund aus der Beobachtung hält nichts.
 * @returns {{befund:'ablehnen'|'halten', seit:string|null}|null}
 */
function preisBildschirmVorbefund(x) {
  const ro = x && x.review && typeof x.review === 'object' && x.review.rundeOffen && typeof x.review.rundeOffen === 'object' ? x.review.rundeOffen : null;
  const pb = ro && ro.preisBildschirm && typeof ro.preisBildschirm === 'object' ? ro.preisBildschirm : null;
  if (!pb || pb.modus !== true || !(pb.befund === 'ablehnen' || pb.befund === 'halten')) return null;
  const s = (v) => (typeof v === 'string' && v ? v.slice(0, 40) : null);
  return { befund: pb.befund, seit: s(pb.seit) || s(ro.lauf) };
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
 * Ablehn-Lesung abgelehnt werden. Aufheben kann nur ein Mensch in der Konsole
 * (jede Entscheidung dort ersetzt `review`) — oder der Schalter (`false`
 * nimmt alles weg; in `'shadow'` hält der Befund nichts mehr).
 *
 * @param {object|null} heute  Eingabe der Runde (pbVon) oder null (keine Bildprüfung heute)
 * @param {{befund:string, seit:string|null}|null} vorher  preisBildschirmVorbefund
 * @param {false|'shadow'|true} modus  heutiger Schalter
 */
function preisBildschirmMitVorbefund(heute, vorher, modus) {
  if (modus === false) return null;
  if (!vorher) return heute;
  if (heute && heute.befund === 'ablehnen' && vorher.befund === 'ablehnen') return { ...heute, vorbefundSeit: vorher.seit };
  return {
    ...(heute || { quelle: null, grund: null, merkmal: null, lesedienstBon: false, lesedienstOhneBon: false, kopfGescheitert: false }),
    modus,
    befund: 'halten',
    vorbefund: { befund: vorher.befund, seit: vorher.seit },
    heute: heute ? heute.befund : null,
  };
}

module.exports = {
  PREIS_QUELLEN, PREIS_BILDSCHIRM, PREIS_BILDSCHIRM_UNSICHER, PREIS_KOPF_NICHT_LESBAR, KOPF_BYTES,
  modusPreisBildschirm, schalterRohOf, preisQuelleOf, lesedienstBonOf, lesedienstOhneBonOf, bildKopf, tiffKennung, bildschirmMerkmal, kameraFormat,
  preisBildschirmBefund, preisBildschirmHalteGrund, preisBildschirmHinweis, preisBildschirmEintrag,
  preisBildschirmVorbefund, preisBildschirmMitVorbefund,
};
