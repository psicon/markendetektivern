'use strict';

/**
 * Feinvergleich der Bon-Bilder (lib/bildVergleich.js, 04.10.2026). Bilder
 * werden hier synthetisch erzeugt (helle Fläche mit Zeilen wie ein Bon). Die
 * Schwellen selbst sind an den 200 echten gesperrten Uploads gemessen; eine
 * lesende Gegenprobe mit diesem Modul ergab dort genau dieselben 6 Treffer.
 */

const sharp = require('sharp');
const B = require('../lib/bildVergleich');

/** SVG eines Bons: Zeilen links (Artikel) und rechts (Preise). */
function bonSvg({ w = 900, h = 1600, zeilen = 50, versatz = 0, saat = 1 } = {}) {
  let r = saat;
  const rnd = () => { r = (r * 16807) % 2147483647; return r / 2147483647; };
  const teile = [];
  for (let i = 0; i < zeilen; i++) {
    const y = 60 + i * 28;
    teile.push(`<rect x="${40 + versatz}" y="${y}" width="${80 + Math.floor(rnd() * 300)}" height="14" fill="#222"/>`);
    teile.push(`<rect x="${w - 140 + versatz}" y="${y}" width="${60 + Math.floor(rnd() * 40)}" height="14" fill="#222"/>`);
  }
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="100%" height="100%" fill="#f4f2ec"/>${teile.join('')}</svg>`);
}
const jpeg = (svg, quality = 92) => sharp(svg).jpeg({ quality }).toBuffer();

let original;
beforeAll(async () => {
  original = await jpeg(bonSvg());
});

describe('gleichesBild', () => {
  test('dasselbe Bild, neu gespeichert (andere JPEG-Qualität) → gleich', async () => {
    const v = B.gleichesBild(await B.vorbereiten(original), await B.vorbereiten(await jpeg(bonSvg(), 60)));
    expect(v).toMatchObject({ gleich: true, seitenDiff: 0 });
    expect(v.ssim).toBeGreaterThanOrEqual(B.SCHWELLE_SSIM);
  });

  test('bearbeitete Kopie (Helligkeit +8 %, Kontrast) → gleich; die Abweichung entscheidet nicht', async () => {
    const a = await B.vorbereiten(original);
    const heller = B.gleichesBild(a, await B.vorbereiten(await sharp(original).modulate({ brightness: 1.08 }).jpeg({ quality: 90 }).toBuffer()));
    expect(heller.gleich).toBe(true);
    // Mit dem früheren Kriterium (Abweichung ≤ 0,002) wäre diese Kopie gelesen worden.
    expect(heller.abweichung).toBeGreaterThan(0.002);
    const kontrast = B.gleichesBild(a, await B.vorbereiten(await sharp(original).linear(1.1, -10).jpeg({ quality: 90 }).toBuffer()));
    expect(kontrast.gleich).toBe(true);
  });

  test('derselbe Inhalt um 4 px verschoben → nicht gleich', async () => {
    const v = B.gleichesBild(await B.vorbereiten(original), await B.vorbereiten(await jpeg(bonSvg({ versatz: 4 }))));
    expect(v.gleich).toBe(false);
  });

  test('anderer Bon gleicher Bauart (heller App-Bon-Effekt) → nicht gleich', async () => {
    const v = B.gleichesBild(await B.vorbereiten(original), await B.vorbereiten(await jpeg(bonSvg({ saat: 7 }))));
    expect(v.gleich).toBe(false);
    expect(v.ssim).toBeLessThan(B.SCHWELLE_SSIM);
  });

  test('anderes Seitenverhältnis → nicht gleich', async () => {
    const v = B.gleichesBild(await B.vorbereiten(original), await B.vorbereiten(await jpeg(bonSvg({ h: 1500 }))));
    expect(v.gleich).toBe(false);
    expect(v.seitenDiff).toBeGreaterThan(B.SCHWELLE_SEITEN);
  });

  test('EXIF-Drehung: Seitenverhältnis nach dem Drehen', async () => {
    const quer = await sharp(bonSvg()).rotate(90).jpeg().withMetadata({ orientation: 6 }).toBuffer();
    const a = await B.vorbereiten(original);
    const b = await B.vorbereiten(quer);
    expect(b.seiten).toBeCloseTo(a.seiten, 2);
  });

  test('kein Bild → Fehler (der Aufrufer liest dann)', async () => {
    await expect(B.vorbereiten(Buffer.from('bon'))).rejects.toThrow();
  });
});

describe('pruefeKandidaten', () => {
  test('nächster Kandidat zuerst; bestätigt beim ersten gleichen Bild', async () => {
    const anders = await jpeg(bonSvg({ saat: 9 }));
    const dateien = { 'a.jpg': anders, 'b.jpg': await jpeg(bonSvg(), 70) };
    const geladen = [];
    const r = await B.pruefeKandidaten({
      neuBytes: original,
      kandidaten: [{ id: 'B', distanz: 2, pfad: 'b.jpg' }, { id: 'A', distanz: 0, pfad: 'a.jpg' }],
      laden: async (p) => { geladen.push(p); return dateien[p]; },
    });
    expect(geladen).toEqual(['a.jpg', 'b.jpg']);
    expect(r.bestaetigt).toMatchObject({ kandidat: 'B', bestaetigt: true });
    expect(r.ergebnisse.map((e) => [e.kandidat, e.bestaetigt])).toEqual([['A', false], ['B', true]]);
  });

  test('höchstens 3 Kandidaten', async () => {
    const anders = await jpeg(bonSvg({ saat: 3 }));
    let n = 0;
    const r = await B.pruefeKandidaten({
      neuBytes: original,
      kandidaten: [0, 1, 2, 3, 3].map((d, i) => ({ id: `k${i}`, distanz: d, pfad: 'x' })),
      laden: async () => { n++; return anders; },
    });
    expect(n).toBe(3);
    expect(r.bestaetigt).toBeNull();
  });

  test('früheres Bild fehlt → kein Urteil, nicht bestätigt, mit Fehler', async () => {
    const r = await B.pruefeKandidaten({
      neuBytes: original,
      kandidaten: [{ id: 'K', distanz: 1, pfad: 'weg.jpg' }, { id: 'L', distanz: 2, pfad: null }],
      laden: async () => { throw new Error('No such object'); },
    });
    expect(r.bestaetigt).toBeNull();
    expect(r.ergebnisse).toEqual([
      { kandidat: 'K', distanz: 1, bestaetigt: false, fehler: 'No such object' },
      { kandidat: 'L', distanz: 2, bestaetigt: false, fehler: 'kein_bildpfad' },
    ]);
  });

  test('Zeitlimit → kein Urteil, weitere Kandidaten entfallen', async () => {
    const r = await B.pruefeKandidaten({
      neuBytes: original,
      kandidaten: [{ id: 'K', distanz: 0, pfad: 'a' }, { id: 'L', distanz: 1, pfad: 'b' }],
      laden: () => new Promise(() => {}),
      budgetMs: 300,
    });
    expect(r.bestaetigt).toBeNull();
    expect(r.ergebnisse).toEqual([{ kandidat: 'K', distanz: 0, bestaetigt: false, fehler: 'zeitlimit' }]);
  });

  test('ohne Kandidaten nichts tun', async () => {
    expect(await B.pruefeKandidaten({ neuBytes: original, kandidaten: [], laden: async () => { throw new Error('nie'); } }))
      .toEqual({ bestaetigt: null, ergebnisse: [] });
  });
});
