'use strict';

/**
 * Welche Fotos gehen an Gemini — und was, wenn eines kaputt ist?
 *
 * Vorfall 25.09.2026: ein abgeschnittenes Hersteller-Foto (1 MiB, ohne
 * Bildende) ließ den ganzen Aufruf mit 400 „Failed to decode image data"
 * scheitern. Front und Preis waren einwandfrei, trotzdem blieben Name, Preis
 * und Hersteller leer, und die Morgenrunde hielt den Fall zwei Tage lang als
 * „bild_defekt" zurück. Darum:
 *  1. Jedes Foto vorab strukturell prüfen (src/bild.js) und defekte
 *     weglassen; ist front oder hersteller defekt, die Rückseite mitschicken
 *     (sie trägt oft Name und Herstellerangabe — die Morgenrunde nutzt sie
 *     genauso).
 *  2. Scheitert Gemini trotzdem am Dekodieren, nacheinander ohne hersteller,
 *     dann ohne preis lesen (höchstens 2 Zusatzaufrufe, je ein Versuch).
 *     front bleibt immer drin.
 * Jedes weggelassene Foto landet mit Grund in `defekt` → Feld
 * `productNameOcrBildDefekt`.
 *
 * Geprüft werden ALLE Fotos der Einreichung, nicht nur die gelesenen: von den
 * 9 bekannten abgeschnittenen Dateien lagen 5 in ean/rueckseite, und die
 * Prüfkonsole zeigt das Feld als Liste der beschädigten Fotos — ein leeres
 * Feld muss also „alle Fotos vollständig" heißen können. Die übrigen Slots
 * werden nur geladen und geprüft (eins nach dem anderen, Puffer sofort
 * verworfen), nie an Gemini geschickt; ein Ladefehler dort ist kein Fehler
 * der Lesung (`ungeprueft`).
 *
 * Abhängigkeiten (Storage, Gemini) werden hereingereicht, damit das Modul
 * ohne Cloud testbar ist.
 */

const { bildPruefen } = require('./bild');
const { NAME_STEPS, STEP_LABEL, PROMPT, istBildFehler } = require('./lesung');

const ERSATZ = 'rueckseite';
const ERSETZBAR = ['front', 'hersteller'];
const WEGLASS_REIHENFOLGE = ['hersteller', 'preis', ERSATZ];
const MAX_ZUSATZAUFRUFE = 2;

/**
 * Reine Auswahl. `pruefung`: Slot → Ergebnis von bildPruefen (fehlt der Slot
 * oder ist er null, gibt es kein Foto). `weg`: zusätzlich weggelassene Slots.
 * @returns {{senden: string[], ersatzNoetig: boolean}}
 */
function waehleFotos(pruefung, weg = []) {
  const brauchbar = (s) => Boolean(pruefung[s] && pruefung[s].ok) && !weg.includes(s);
  const senden = NAME_STEPS.filter(brauchbar);
  const ersatzNoetig = ERSETZBAR.some((s) => (pruefung[s] && !pruefung[s].ok) || weg.includes(s));
  if (ersatzNoetig && brauchbar(ERSATZ)) senden.push(ERSATZ);
  return { senden, ersatzNoetig };
}

/** Defekte Fotos fürs Dokument (ohne Puffer, ohne Hinweisfelder). */
function defekteFotos(pruefung) {
  return Object.entries(pruefung)
    .filter(([, p]) => p && !p.ok)
    .map(([slot, p]) => ({ slot, groesse: p.groesse, grund: p.grund }));
}

/**
 * Lädt, prüft und liest die Fotos einer Einreichung. Wirft nie — jeder
 * Ausgang kommt als Objekt zurück, damit Erstlauf und Nachlauf dieselben
 * Felder schreiben (src/ablauf.js `ausgangFelder`).
 *
 * @param {object} p
 * @param {Object<string,string>} p.images Slot → Storage-Pfad
 * @param {(pfad: string) => Promise<Buffer|null>} p.ladeBild null = Datei gibt es nicht; wirft bei allem anderen
 * @param {(parts: object[], opts?: {versuche?: number}) => Promise<{parsed: object, versuche: number}>} p.lese
 * @param {{warn: Function}} [p.logger]
 * @returns {Promise<{art: 'gelesen'|'ohne_bild'|'bilder_fehlen'|'bilder_defekt'|'fehler',
 *   parsed?: object, fehler?: Error, versuche: number, gesendet: string[], defekt: object[], ungeprueft: string[]}>}
 */
async function leseEinreichung({ images, ladeBild, lese, logger = null, id = null }) {
  const pruefung = {};
  const puffer = {};
  const ungeprueft = [];
  const stand = { versuche: 0, speicherGestoert: false };

  const pruefen = (slot, pfad, buf) => {
    if (buf == null) {
      pruefung[slot] = null;
      if (logger) logger.warn('namer: Foto fehlt im Storage', { id, slot, pfad });
      return null;
    }
    const p = bildPruefen(buf);
    pruefung[slot] = p;
    if (!p.ok && logger) logger.warn('namer: Foto defekt', { id, slot, groesse: p.groesse, grund: p.grund, zweierPotenz: p.zweierPotenz });
    return p;
  };

  // Namer-Fotos (und Ersatz): Puffer bleibt für den Aufruf. Ladefehler → später nachlesen.
  const laden = async (slot) => {
    const pfad = images[slot];
    if (!pfad || slot in pruefung) return;
    let buf;
    try {
      buf = await ladeBild(pfad);
    } catch (e) {
      stand.speicherGestoert = true;
      throw Object.assign(new Error(`bild_download_fehlgeschlagen (${slot}): ${e && e.message}`), { voruebergehend: true });
    }
    const p = pruefen(slot, pfad, buf);
    if (p && p.ok) puffer[slot] = buf;
  };

  const parts = (slots) => [
    { text: PROMPT },
    // Jedes Bild bekommt seine Beschriftung davor — sonst rät das Modell,
    // welche Ansicht es gerade sieht.
    ...slots.flatMap((s) => [
      { text: `${STEP_LABEL[s] || s}:` },
      { inlineData: { mimeType: pruefung[s].mimeType, data: puffer[s].toString('base64') } },
    ]),
  ];

  const lesenKern = async () => {
    try {
      const pfade = NAME_STEPS.filter((s) => images[s]);
      if (!pfade.length) return { art: 'ohne_bild' };
      for (const s of pfade) await laden(s);
      let auswahl = waehleFotos(pruefung);
      if (auswahl.ersatzNoetig) {
        await laden(ERSATZ);
        auswahl = waehleFotos(pruefung);
      }
      if (!auswahl.senden.length) {
        return { art: defekteFotos(pruefung).length ? 'bilder_defekt' : 'bilder_fehlen' };
      }

      const gesendet = auswahl.senden;
      try {
        const r = await lese(parts(gesendet));
        stand.versuche += r.versuche;
        return { art: 'gelesen', parsed: r.parsed, gesendet };
      } catch (e) {
        stand.versuche += e.versuche || 1;
        if (!istBildFehler(e)) return { art: 'fehler', fehler: e, gesendet };
        // Rückfall: das Foto finden, an dem Gemini scheitert. Jeder Versuch
        // lässt genau EINEN Verdächtigen weg — klappt er, ist der Schuldige klar.
        const kandidaten = WEGLASS_REIHENFOLGE.filter((s) => gesendet.includes(s)).slice(0, MAX_ZUSATZAUFRUFE);
        for (const verdacht of kandidaten) {
          if (ERSETZBAR.includes(verdacht)) await laden(ERSATZ);
          const ohne = waehleFotos(pruefung, [verdacht]).senden;
          if (!ohne.length) continue;
          try {
            const r = await lese(parts(ohne), { versuche: 1 });
            stand.versuche += 1;
            pruefung[verdacht] = { ...pruefung[verdacht], ok: false, grund: 'nicht_dekodierbar' };
            if (logger) logger.warn('namer: Foto nicht dekodierbar, ohne es gelesen', { id, slot: verdacht, groesse: pruefung[verdacht].groesse });
            return { art: 'gelesen', parsed: r.parsed, gesendet: ohne };
          } catch (e2) {
            stand.versuche += 1;
            if (!istBildFehler(e2)) return { art: 'fehler', fehler: e2, gesendet: ohne };
          }
        }
        const endgueltig = Object.assign(new Error(`bild_nicht_dekodierbar: ${String(e.message || e).slice(0, 160)}`), { voruebergehend: false });
        return { art: 'fehler', fehler: endgueltig, gesendet };
      }
    } catch (e) {
      return { art: 'fehler', fehler: e instanceof Error ? e : new Error(String(e)) };
    }
  };

  // Übrige Fotos nur prüfen. Nach einem Speicherfehler nicht: der Nachlauf
  // prüft beim nächsten Versuch ohnehin alles, und jeder weitere Abruf
  // verlängerte nur die Laufzeit.
  const uebrigePruefen = async () => {
    if (stand.speicherGestoert) return;
    for (const [slot, pfad] of Object.entries(images)) {
      if (typeof pfad !== 'string' || !pfad || slot in pruefung) continue;
      try {
        pruefen(slot, pfad, await ladeBild(pfad));
      } catch (e) {
        ungeprueft.push(slot);
        if (logger) logger.warn('namer: Foto nicht prüfbar', { id, slot, err: e && e.message });
      }
    }
  };

  const aus = await lesenKern();
  for (const s of Object.keys(puffer)) delete puffer[s];
  await uebrigePruefen();
  return { versuche: stand.versuche, gesendet: [], ...aus, defekt: defekteFotos(pruefung), ungeprueft };
}

module.exports = { waehleFotos, defekteFotos, leseEinreichung, ERSATZ, MAX_ZUSATZAUFRUFE };
