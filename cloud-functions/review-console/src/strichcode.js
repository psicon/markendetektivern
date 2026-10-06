'use strict';
/**
 * Fester Strichcode-Leser — Pflicht-Zeuge der Barcode-Korrektur (Prüfrunde
 * 06.10.2026, Befund „zwei unabhängige Lesungen").
 *
 * Warum: die beiden Lesungen, auf die sich die Korrektur zuerst stützte, sind
 * zwei Aufrufe DESSELBEN Modells auf demselben Bild. Gemessen am 06.10.2026:
 * auf Barcode-Fotos ohne lesbare Ziffern erfindet das Modell Nummern mit
 * gültiger Prüfziffer (G&G Fusilli: 4 von 4 Lesungen 4311501358917, das
 * Vollkornbrot derselben Person zum Teil dieselbe Nummer). Die Prüfziffer
 * schützt davor nicht. Dieser Leser arbeitet auf den STRICHEN, nicht auf den
 * gedruckten Ziffern — eine andere Fehlerquelle — und erfindet keine Nummer
 * ohne Striche.
 *
 * Leser: ZXing-C++ als WebAssembly (npm `zxing-wasm`, exakt 2.2.4 — die
 * Ausgabe hängt an der Version). Gemessen 06.10.2026 an 127 echten
 * Barcode-Fotos von Android-Einreichungen: 96 gelesen, Median 86 ms, höchstens
 * 249 ms je 12-MP-Foto; in 91 Fällen dieselbe Nummer wie OpenCV/Apple Vision,
 * in 5 eine andere (bei schlechten Fotos verliest er sich wie der
 * Android-Scanner, typisch in der linken Hälfte). Deshalb ist er ZEUGE, nicht
 * Richter: korrigiert wird nur, wenn er die Foto-Nummer der Modell-Lesungen
 * bestätigt UND weder die gespeicherte noch eine weitere Nummer liest
 * (werte.strichcodeUrteil).
 *
 * Zwei Fallen der Bibliothek (gemessen):
 *  - Formatnamen MIT Bindestrich ('EAN-13'); 'EAN13' liefert stumm nichts.
 *  - Ohne `wasmBinary` lädt sie die WASM-Datei zur Laufzeit von einem CDN —
 *    in der Cloud Function unannehmbar. Sie wird hier IMMER aus dem Paket
 *    gelesen.
 * Ausgabe: UPC-A und UPC-E kommen als 13-stellige GTIN („0…", UPC-E
 * ausgeklappt), EAN-8 achtstellig (Test mit erzeugten Codes in
 * __tests__/strichcode.test.js). Ein nicht dekodierbares Bild wirft nicht,
 * sondern liefert ein Ergebnis mit `error` — das wird hier zum Fehler.
 *
 * Speicher: stb_image dekodiert in Graustufen (1 Byte je Pixel) plus
 * Komponenten-Ebenen; ein baseline-JPEG 4:2:0 belegt so rund 2 Byte je Pixel
 * (12 MP → ~25 MB, 48 MP → ~100 MB, Prüfrunde 2). Der WASM-Speicher wächst
 * und schrumpft nicht; nach allen 127 Fotos stand er bei 122 MiB.
 * Gemessen über alle 127 Fotos: Prozess höchstens 284 MB (zwei gleichzeitig)
 * bzw. 272 MB (einzeln) — die Aufrufe laufen ohnehin nacheinander (WASM ist
 * synchron). Die Morgenrunde lag zuletzt bei höchstens 29 % von 1 GiB.
 *
 * Obergrenze der Bildgröße (Prüfrunde 1 zur Barcode-Korrektur, 06.10.2026):
 * der Speicher wächst mit der PIXELZAHL, nicht mit der Dateigröße — und eine
 * weiße Fläche komprimiert fast auf nichts. Gemessen: 324 MP in 4,9 MB →
 * 901 MB, 400 MP in 4,1 MB → 1.114 MB; die Upload-Regel (unter 8 MB) hält
 * so ein Bild nicht auf, über den Galerie-Weg lädt die App es unverändert
 * hoch. Zusammen mit der Runde (rund 300 MB) beendet Cloud Run die Instanz
 * dann in Schritt 4c, VOR jedem Schreibvorgang — kein Bericht, keine
 * Freigabe, und am nächsten Morgen ist derselbe Fall wieder Kandidat. Weder
 * try/catch noch die Zeitgrenze helfen (das WASM rechnet synchron). Deshalb
 * werden VOR dem Dekodieren nur Format und Abmessungen aus dem Dateikopf
 * gelesen (sharp `metadata()`, entpackt nichts, ~1 ms): nur JPEG und PNG
 * (die Formate, die der Leser dekodiert und die App hochlädt), höchstens
 * MAX_PIXEL. Alles andere → Fehler, also keine Korrektur (fail-closed).
 * Gemessen: 64 MP → Prozess 253 MB; das größte Barcode-Foto in Produktion
 * hat 48 MP (6000 × 8000, alle 4.459); unter den 127 gemessenen ist eines
 * mit 48 MP und eines mit 16 MP, der Rest höchstens 12,6 MP.
 *
 * Die Pixelgrenze allein reicht NICHT (Prüfrunde 2 zur Barcode-Korrektur,
 * 06.10.2026): der Speicher hängt an der KODIERUNG. stb_image dekodiert im
 * WASM-Speicher immer in voller Auflösung (tryDownscale greift erst danach),
 * ein progressives JPEG hält dabei alle Koeffizienten (2 Byte je Pixel und
 * Kanal), CMYK hat vier Kanäle, ein PNG mit 16 Bit und Alpha acht Byte je
 * Pixel — und der Puffer für die entpackten Daten wächst durch Verdoppeln
 * (bei PNG über den GANZEN Datenstrom, egal was der Kopf sagt — Prüfrunde 3:
 * 0,42 MB PNG → 872 MB; deshalb seitdem nur Baseline-JPEG, BILD_FORMATE).
 * Gemessen (frischer Prozess, Wachstum des WASM-Speichers je Pixel, bei
 * 12/24/48 MP): JPEG baseline 4:2:0 höchstens 2,2 B/px, baseline 4:4:4 3,7,
 * baseline CMYK 4,5, progressiv 4:4:4 10,5, progressiv CMYK 12,8; PNG RGB 8 Bit
 * 8,1, RGBA 8 Bit interlaced 15,9, RGBA 16 Bit interlaced 32,0. Mit 64 MP
 * wären das bis 2 GB — jede dieser Dateien bleibt unter der Upload-Grenze von
 * 8 MB, wenn die Fläche gleichförmig ist. Deshalb schätzt dekodierBytes() aus
 * dem Dateikopf eine OBERE Grenze dieses Speichers (Format, Kanäle, Bittiefe,
 * progressiv/interlaced), und bildPruefen lässt nur Bilder bis
 * MAX_DEKODIER_BYTES durch. Alle 127 echten Fotos (baseline 4:2:0, das
 * größte 48 MP → Schätzung 229 MB) bleiben darunter, ein baseline-JPEG mit
 * 64 MP gerade noch (305 MB).
 * Nachgemessen an je einem Bild GENAU an der Grenze (14 Kodierungen):
 * WASM-Speicher höchstens 289 MiB, Prozess höchstens 362 MB.
 * Messweg (bei jeder Änderung an Version oder LESE_OPTIONEN wiederholen): je
 * Kodierung ein Bild mit sharp erzeugen, in einem FRISCHEN Prozess lesen und
 * `HEAPU8.buffer.byteLength` des Moduls vor und nach dem Lesen vergleichen
 * (der WASM-Speicher schrumpft nie, ein zweites Bild im selben Prozess misst
 * nichts). __tests__/strichcode.test.js prüft dasselbe im Kleinen.
 */
const fs = require('fs');
const { pruefzifferOk, gtin14 } = require('./werte');

/** Version des Lesers — steht an jeder Korrektur (eanKorrektur.zeuge.leser). */
const LESER = 'zxing-wasm 2.2.4';
const FORMATE = Object.freeze(['EAN-13', 'EAN-8', 'UPC-A', 'UPC-E']);
// Dieselben Einstellungen wie in der Messung vom 06.10.2026. `textMode: 'HRI'`
// ist der Standard und liefert UPC-E ausgeklappt; ausdrücklich gesetzt, damit
// ein geänderter Standard nicht still andere Nummern erzeugt.
const LESE_OPTIONEN = Object.freeze({
  formats: [...FORMATE], tryHarder: true, tryRotate: true, tryInvert: false, tryDownscale: true,
  maxNumberOfSymbols: 4, textMode: 'HRI',
});
/** Höchstens so lange je Bild (Laden + Lesen). Das Lesen selbst ist synchron und lässt sich nicht unterbrechen (gemessen ≤ 249 ms). */
const ZEIT_MS = 15000;
/** Höchstens so viele Pixel dekodiert der Leser (siehe oben: Obergrenze der Bildgröße). */
const MAX_PIXEL = 64 * 1000 * 1000;
/**
 * Formate laut Dateikopf, die der Leser bekommt (sharp-Namen). Nur JPEG, und
 * nur Baseline (`isProgressive === false`, siehe bildPruefen): Prüfrunde 3
 * zur Barcode-Korrektur (06.10.2026) zeigte ein PNG von 0,42 MB, dessen Kopf
 * 7 MB versprach und das den Leser auf 872 MB trieb — stb_image entpackt den
 * ganzen Datenstrom, egal was der Kopf sagt. Die App lädt ausschließlich
 * JPEG hoch (alle Barcode-Fotos der letzten 30 Tage, Stichprobe von 400
 * durchgehend Baseline); alles andere ist kein Fall für die automatische
 * Korrektur und bleibt beim Menschen (fail-closed).
 */
const BILD_FORMATE = Object.freeze(['jpeg']);
/**
 * Höchstens so viel WASM-Speicher darf das Dekodieren nach dekodierBytes()
 * belegen. Mit der Runde (zuletzt höchstens rund 300 MB) bleibt die Instanz
 * damit unter 1 GiB, auch wenn die Schätzung voll ausgeschöpft wird. Die
 * Aufrufe laufen nacheinander (WASM ist synchron), der Speicher wird
 * wiederverwendet — zwei Bilder belegen nicht die Summe.
 */
const MAX_DEKODIER_BYTES = 320 * 1000 * 1000;

/**
 * Obere Schätzung des WASM-Speichers (Byte), den der Leser beim Dekodieren
 * dieses Bildes belegt (stb_image in zxing-wasm, siehe oben) — allein aus dem
 * Dateikopf (sharp `metadata()`). Nur Baseline-JPEG wird überhaupt gelesen
 * (BILD_FORMATE), alles andere ergibt Infinity. Faktor über allen gemessenen
 * Werten: je Kanal 1,25 Byte (Komponenten-Ebenen, als wäre nichts
 * unterabgetastet) plus 1 Byte Graustufen-Ausgabe; Rand auf ganze Blöcke
 * (je Seite + 16). Unbekannte Kanalzahl zählt wie vier (fail-closed).
 * @param {{format?:string, width?:number, height?:number, channels?:number, isProgressive?:boolean}} m
 * @returns {number}  Byte; Infinity, wenn nichts Verlässliches im Kopf steht
 */
function dekodierBytes(m) {
  const b = m && m.width; const h = m && m.height;
  if (!Number.isInteger(b) || !Number.isInteger(h) || b <= 0 || h <= 0) return Infinity;
  if (m.format !== 'jpeg' || m.isProgressive !== false) return Infinity;
  const kanaele = Number.isInteger(m.channels) && m.channels >= 1 && m.channels <= 4 ? m.channels : 4;
  return Math.ceil((b + 16) * (h + 16) * (kanaele * 1.25 + 1));
}

const kurz = (v) => String((v && v.message) || v || 'unbekannt').slice(0, 120);

/** Promise mit Zeitgrenze — danach Fehler `zeit_abgelaufen` (die Arbeit selbst läuft weiter, ihr Ergebnis wird verworfen). */
function mitZeit(promise, ms) {
  let t;
  const grenze = new Promise((_, nein) => { t = setTimeout(() => nein(new Error('zeit_abgelaufen')), ms); });
  return Promise.race([promise, grenze]).finally(() => clearTimeout(t));
}

/**
 * Rohergebnisse des Lesers → gültige Nummern (rein, ohne Netz).
 * Nur Treffer mit `isValid`, in einem der vier Formate und mit gültiger
 * GTIN-Prüfziffer; je GTIN einmal (gtin14), in der Schreibweise des Lesers.
 * `voll` (Prüfrunde 2 zur Barcode-Korrektur, 06.10.2026): der Leser hat so
 * viele Strichcodes geliefert, wie er höchstens liefert
 * (`maxNumberOfSymbols`) — weitere, darunter die gespeicherte Nummer, können
 * fehlen. Dann bestätigt er keine Korrektur (werte.strichcodeUrteil).
 * Gemessen an den 127 Fotos: höchstens 3 Treffer, nie die Grenze.
 * @param {Array<{isValid?:boolean, text?:string, format?:string, error?:string}>} roh
 * @returns {{gelesen:string[], voll?:true}|{fehler:string}}
 */
function nummernAus(roh) {
  if (!Array.isArray(roh)) return { fehler: 'keine_antwort' };
  const gueltig = roh.filter((r) => r && r.isValid === true && FORMATE.includes(r.format));
  // Bild nicht dekodierbar: kein Treffer, aber eine Fehlermeldung („Failed to
  // load image from memory") — kein Urteil über den Strichcode.
  const fehler = roh.find((r) => r && r.isValid !== true && r.error);
  if (!gueltig.length && fehler) return { fehler: `bild: ${kurz(fehler.error)}` };
  const gesehen = new Set();
  const gelesen = [];
  for (const r of gueltig) {
    const z = String(r.text || '').replace(/\D/g, '');
    if (!pruefzifferOk(z)) continue;
    const k = gtin14(z);
    if (gesehen.has(k)) continue;
    gesehen.add(k);
    gelesen.push(z);
  }
  const treffer = roh.filter((r) => r && FORMATE.includes(r.format)).length;
  return { gelesen, ...(treffer >= LESE_OPTIONEN.maxNumberOfSymbols ? { voll: true } : {}) };
}

/* ── Ladeschicht ── */

let modul = null; // Promise des geladenen Lesers — einmal je Instanz

/**
 * Leser einmal je Instanz laden; die WASM-Datei IMMER aus dem Paket (sonst
 * CDN). Scheitert es, versucht es der nächste Aufruf neu.
 * Bewusst erst hier geladen (wie sharp in index.js): alle Functions dieser
 * Codebase laden taeglicheRunde.js mit, den Leser braucht nur die Runde, und
 * dort nur für Korrektur-Kandidaten.
 */
function laden() {
  if (!modul) {
    modul = (async () => {
      const zx = require('zxing-wasm/reader');
      const wasmBinary = fs.readFileSync(require.resolve('zxing-wasm/reader/zxing_reader.wasm'));
      await zx.prepareZXingModule({ overrides: { wasmBinary }, fireImmediately: true });
      return zx;
    })();
    modul.catch(() => { modul = null; });
  }
  return modul;
}

/**
 * Darf der Leser dieses Bild dekodieren? Format und Abmessungen nur aus dem
 * Dateikopf (sharp `metadata()` entpackt keine Pixel; sharps eigene
 * Pixelgrenze ist aus, entschieden wird hier). Nur Baseline-JPEG, höchstens
 * `maxPixel` — und höchstens `maxBytes` geschätzter Dekodier-Speicher
 * (dekodierBytes; Prüfrunde 2 zur Barcode-Korrektur). Unlesbarer Kopf,
 * anderes Format, fehlende Abmessungen → Fehler.
 * sharp wird erst hier geladen (wie der Leser selbst, siehe laden()).
 * @returns {Promise<{fehler:string}|null>}  null = darf gelesen werden
 */
async function bildPruefen(bild, { maxPixel = MAX_PIXEL, maxBytes = MAX_DEKODIER_BYTES } = {}) {
  let m;
  try {
    m = await require('sharp')(bild, { limitInputPixels: false }).metadata();
  } catch (e) {
    return { fehler: `bildkopf: ${kurz(e)}` };
  }
  if (!BILD_FORMATE.includes(m && m.format)) return { fehler: `bildformat: ${String((m && m.format) || 'unbekannt').slice(0, 20)}` };
  if (m.isProgressive !== false) return { fehler: 'bildformat: jpeg progressiv' };
  const { width: b, height: h } = m;
  if (!Number.isInteger(b) || !Number.isInteger(h) || b <= 0 || h <= 0) return { fehler: 'bildkopf: ohne Abmessungen' };
  if (b * h > maxPixel) return { fehler: `bild_zu_gross: ${b}x${h}` };
  const bytes = dekodierBytes(m);
  if (!(bytes <= maxBytes)) {
    const art = `${m.format} ${Number.isInteger(m.channels) ? m.channels : '?'}K`;
    return { fehler: `bild_zu_aufwendig: ${b}x${h} ${art}, ~${Number.isFinite(bytes) ? Math.round(bytes / 1e6) : '?'} MB` };
  }
  return null;
}

/**
 * Ein Bild lesen. Wirft nie: Fehler, Zeitüberschreitung, unlesbare Datei,
 * zu großes Bild (bildPruefen) → `{fehler}`; sonst `{gelesen}` (kann leer
 * sein: keine Striche gefunden).
 * @param {Buffer|Uint8Array} bild  die JPEG-Datei in voller Auflösung (nicht die Kachel)
 */
async function liesBild(bild, { zeitMs = ZEIT_MS, maxPixel = MAX_PIXEL, maxBytes = MAX_DEKODIER_BYTES } = {}) {
  try {
    if (!bild || !bild.length) return { fehler: 'leere_datei' };
    // VOR dem Dekodieren: ein zu großes Bild sprengt sonst den Speicher der Instanz.
    const nein = await bildPruefen(bild, { maxPixel, maxBytes });
    if (nein) return nein;
    const daten = new Uint8Array(bild.buffer, bild.byteOffset, bild.byteLength);
    const roh = await mitZeit(laden().then((zx) => zx.readBarcodes(daten, LESE_OPTIONEN)), zeitMs);
    return nummernAus(roh);
  } catch (e) {
    return { fehler: kurz(e) };
  }
}

module.exports = { liesBild, bildPruefen, dekodierBytes, nummernAus, mitZeit, LESER, FORMATE, LESE_OPTIONEN, ZEIT_MS, MAX_PIXEL, MAX_DEKODIER_BYTES, BILD_FORMATE };
