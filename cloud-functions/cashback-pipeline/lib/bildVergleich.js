'use strict';

/**
 * Feinvergleich zweier Bon-Bilder (Entscheidung Patrick 04.10.2026: die
 * Bildprüfung beim Hochladen entschärfen, „sonst lesen").
 *
 * Warum: Der grobe Bildvergleich in enqueueCashback (dHash, 64 Bit, Abstand
 * ≤ 3) sperrte vom 04.09. bis 04.10. 200 Uploads als „schon eingereicht" —
 * nur 8 der 118 Bilder dahinter waren wirklich dasselbe Bild. Helle App-Bons
 * (Lidl Plus, Netto-App), Handy-Screenshots und A4-Rechnungen sehen für 64 Bit
 * alle gleich aus; auch Abstand 0 war in 5 von 11 Fällen ein anderes Bild. Und
 * gesperrte Uploads werden nie gelesen, jeder neue Versuch sperrt erneut.
 *
 * Darum: ein dHash-Treffer sperrt nur noch, wenn DIESER Vergleich dasselbe
 * Bild bestätigt. Er bildet die Messung scratchpad/bon-rueckblick/e_bild.js
 * 1:1 nach (gleiche Vorverarbeitung, gleiche Maße). Schwellen an den 200
 * gesperrten Uploads (e_mass.json) gemessen — beide müssen gelten:
 *   Seitenverhältnis |ln(a/b)| ≤ 0,01
 *   SSIM (256×256, Fenster 7, Schritt 2) ≥ 0,98
 * Ergebnis: genau die 6 pixelgleichen Bilder (SSIM ≥ 0,9928); das ähnlichste
 * andere Bild lag bei 0,9633.
 *
 * Die mittlere Pixelabweichung (64×64) wird nur noch MITGEMELDET, sie
 * entscheidet nicht (Prüfrunde 04.10.2026): sie trennte die 200 Fälle nicht
 * besser als SSIM, verwarf aber jede Kopie mit veränderter Helligkeit. An 60
 * echten Bon-Bildern nachgestellt (scratchpad/fix-r1/var.js), bestätigt von
 * den dHash-Treffern mit/ohne Abweichungs-Kriterium: neu gespeichert (JPEG
 * q70) 19/54 → 54/54, Helligkeit +8 % 0/46 → 46/46, Kontrast 4/57 → 55/57.
 * Mit dem Kriterium wäre fast jede bearbeitete Kopie eines bezahlten Bons
 * gelesen worden statt gesperrt. Beschnitt (2 % unten, 3 % am Rand) erkennt
 * der Vergleich in keiner Fassung (SSIM 0,4–0,7) — solche Kopien fängt die
 * Buchung (lib/doppelBon.js), darum wird der Feinvergleich erst mit deren
 * Regeln scharf (index.js, bildFeinModus).
 *
 * Eine Störung (Bild fehlt, Zeitlimit) ist KEIN Urteil: dann wird der Bon
 * gelesen. Gegen Doppelzahlung schützt die Buchung (lib/doppelBon.js).
 */

const sharp = require('sharp');

const VORSCHAU_KANTE = 1200;
const SCHWELLE_SEITEN = 0.01;
const SCHWELLE_SSIM = 0.98;

async function grau(klein, w, h) {
  const roh = await sharp(klein).grayscale().resize(w, h, { fit: 'fill', kernel: 'cubic' }).raw().toBuffer();
  if (roh.length !== w * h) throw new Error(`bildvergleich-groesse: ${roh.length} statt ${w * h} Bytes`);
  return roh;
}

/**
 * Bild für den Vergleich vorbereiten (wie e_bild.js: drehen, auf 1200 px
 * verkleinern, JPEG q88, dann Graustufen 256×256 und 64×64).
 * @param {Buffer} buf
 * @returns {Promise<{seiten:number, g256:Buffer, g64:Buffer}>}
 */
async function vorbereiten(buf) {
  const meta = await sharp(buf).metadata();
  const w = Number(meta.width) || 0;
  const h = Number(meta.height) || 0;
  if (!w || !h) throw new Error('bildvergleich-ohne-masse');
  // Seitenverhältnis NACH dem Drehen: EXIF-Orientierung 5–8 vertauscht Breite
  // und Höhe. (Die Messung nahm die Rohmaße; für Paare gleicher Orientierung
  // ist der Abstand identisch, für gemischte ist dieser Wert der richtige.)
  const gedreht = Number(meta.orientation) >= 5;
  const seiten = gedreht ? w / h : h / w;
  const klein = await sharp(buf)
    .rotate()
    .resize(VORSCHAU_KANTE, VORSCHAU_KANTE, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 88 })
    .toBuffer();
  const [g256, g64] = await Promise.all([grau(klein, 256, 256), grau(klein, 64, 64)]);
  return { seiten, g256, g64 };
}

/** SSIM wie in der Messung: Fenster 7×7, Schritt 2, ohne Gewichtung. */
function ssim(a, b, W, H, win = 7) {
  const C1 = (0.01 * 255) ** 2;
  const C2 = (0.03 * 255) ** 2;
  let tot = 0;
  let n = 0;
  for (let y = 0; y + win <= H; y += 2) {
    for (let x = 0; x + win <= W; x += 2) {
      let ma = 0;
      let mb = 0;
      for (let j = 0; j < win; j++) {
        for (let i = 0; i < win; i++) {
          const k = (y + j) * W + x + i;
          ma += a[k];
          mb += b[k];
        }
      }
      const N = win * win;
      ma /= N;
      mb /= N;
      let va = 0;
      let vb = 0;
      let cv = 0;
      for (let j = 0; j < win; j++) {
        for (let i = 0; i < win; i++) {
          const k = (y + j) * W + x + i;
          const da = a[k] - ma;
          const db = b[k] - mb;
          va += da * da;
          vb += db * db;
          cv += da * db;
        }
      }
      va /= N - 1;
      vb /= N - 1;
      cv /= N - 1;
      tot += ((2 * ma * mb + C1) * (2 * cv + C2)) / ((ma * ma + mb * mb + C1) * (va + vb + C2));
      n++;
    }
  }
  return tot / n;
}

/** Mittlere absolute Pixelabweichung, auf 0–1 normiert. */
function abweichung(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]);
  return s / a.length / 255;
}

const rund = (v, n = 4) => Math.round(v * 10 ** n) / 10 ** n;

/**
 * Sind zwei vorbereitete Bilder dasselbe Bild?
 * @returns {{gleich:boolean, ssim:number, abweichung:number, seitenDiff:number}}
 */
function gleichesBild(a, b) {
  const seitenDiff = Math.abs(Math.log(a.seiten / b.seiten));
  const s = ssim(a.g256, b.g256, 256, 256);
  const m = abweichung(a.g64, b.g64);
  return {
    // Abweichung nur zur Auskunft (siehe Kopf) — sie entscheidet nicht.
    gleich: seitenDiff <= SCHWELLE_SEITEN && s >= SCHWELLE_SSIM,
    ssim: rund(s),
    abweichung: rund(m),
    seitenDiff: rund(seitenDiff),
  };
}

/**
 * Prüft die dHash-Kandidaten der Reihe nach (nächster zuerst), bis einer
 * dasselbe Bild bestätigt, die Kandidaten aus sind oder die Zeit abläuft.
 *
 * @param {object} o
 * @param {Buffer} o.neuBytes                 das hochgeladene Bild
 * @param {Array<{id:string, distanz:number, pfad:string}>} o.kandidaten
 * @param {(pfad:string) => Promise<Buffer>} o.laden  früheres Bild holen
 * @param {number} [o.budgetMs=15000]         zusammen, für alle Kandidaten
 * @param {number} [o.maxKandidaten=3]
 * @returns {Promise<{bestaetigt: object|null, ergebnisse: object[]}>}
 *   ergebnisse[i] = {kandidat, distanz, bestaetigt, ssim?, abweichung?, seitenDiff?, fehler?}
 */
async function pruefeKandidaten({ neuBytes, kandidaten, laden, budgetMs = 15000, maxKandidaten = 3 }) {
  const ergebnisse = [];
  const liste = [...(kandidaten || [])].sort((x, y) => x.distanz - y.distanz).slice(0, maxKandidaten);
  if (!liste.length) return { bestaetigt: null, ergebnisse };
  const ende = Date.now() + budgetMs;
  const zeitlimit = () => Object.assign(new Error('zeitlimit'), { code: 'zeitlimit' });
  // Jede Stufe bekommt nur die Restzeit; ein später fertiges Bild wird ignoriert.
  const mitFrist = (p) => {
    const rest = ende - Date.now();
    if (rest <= 0) {
      p.catch(() => {});
      return Promise.reject(zeitlimit());
    }
    let timer = null;
    return Promise.race([
      p,
      new Promise((_, reject) => { timer = setTimeout(() => reject(zeitlimit()), rest); }),
    ]).finally(() => clearTimeout(timer));
  };
  let neu = null;
  try {
    neu = await mitFrist(vorbereiten(neuBytes));
  } catch (e) {
    const fehler = e && e.code === 'zeitlimit' ? 'zeitlimit' : String((e && e.message) || e).slice(0, 120);
    liste.forEach((k) => ergebnisse.push({ kandidat: k.id, distanz: k.distanz, bestaetigt: false, fehler }));
    return { bestaetigt: null, ergebnisse };
  }
  for (const k of liste) {
    try {
      if (!k.pfad) throw new Error('kein_bildpfad');
      const alt = await mitFrist((async () => vorbereiten(await laden(k.pfad)))());
      const v = gleichesBild(neu, alt);
      const e = { kandidat: k.id, distanz: k.distanz, bestaetigt: v.gleich, ssim: v.ssim, abweichung: v.abweichung, seitenDiff: v.seitenDiff };
      ergebnisse.push(e);
      if (v.gleich) return { bestaetigt: e, ergebnisse };
    } catch (err) {
      const fehler = err && err.code === 'zeitlimit' ? 'zeitlimit' : String((err && err.message) || err).slice(0, 120);
      ergebnisse.push({ kandidat: k.id, distanz: k.distanz, bestaetigt: false, fehler });
      if (fehler === 'zeitlimit') break;
    }
  }
  return { bestaetigt: null, ergebnisse };
}

module.exports = {
  vorbereiten,
  gleichesBild,
  pruefeKandidaten,
  ssim,
  abweichung,
  SCHWELLE_SEITEN,
  SCHWELLE_SSIM,
};
