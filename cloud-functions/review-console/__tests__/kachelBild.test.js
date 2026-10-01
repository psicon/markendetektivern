'use strict';
const { PassThrough } = require('stream');
const sharp = require('sharp');
const { ladeBegrenzt, rendereKachel, KachelFehler, QUALITAET } = require('../src/kachelBild');

/** Testbild mit einem Farbverlauf (damit JPEG etwas zu tun hat). */
async function bild(breite, hoehe, { orientierung, format = 'jpeg' } = {}) {
  const raw = Buffer.alloc(breite * hoehe * 3);
  for (let y = 0; y < hoehe; y++) {
    for (let x = 0; x < breite; x++) {
      const i = (y * breite + x) * 3;
      raw[i] = (x * 255) / breite; raw[i + 1] = (y * 255) / hoehe; raw[i + 2] = 128;
    }
  }
  let s = sharp(raw, { raw: { width: breite, height: hoehe, channels: 3 } });
  if (orientierung) s = s.withMetadata({ orientation: orientierung });
  return format === 'png' ? s.png().toBuffer() : s.jpeg({ quality: 90 }).toBuffer();
}

/** Nachgebautes @google-cloud/storage File: liefert Chunks oder einen Fehler. */
function datei({ chunks = [], fehler = null } = {}) {
  return {
    zerstoert: false,
    createReadStream() {
      const s = new PassThrough();
      const self = this;
      const orig = s.destroy.bind(s);
      s.destroy = (...a) => { self.zerstoert = true; return orig(...a); };
      setImmediate(() => {
        if (fehler) { s.emit('error', fehler); return; }
        for (const c of chunks) { if (self.zerstoert) return; s.write(c); }
        s.end();
      });
      return s;
    },
  };
}

describe('rendereKachel', () => {
  it('Breite wie angefordert, Höhe proportional, JPEG', async () => {
    const out = await rendereKachel(await bild(2448, 3264), 520);
    const m = await sharp(out).metadata();
    expect([m.format, m.width, m.height]).toEqual(['jpeg', 520, 693]); // wie die Extension beim echten Foto
    expect(m.orientation).toBeUndefined(); // keine EXIF-Reste in der Ausgabe
  });

  it('kleinere Originale werden wie bei der Extension auf die Breite gebracht', async () => {
    const out = await rendereKachel(await bild(478, 3164), 1100);
    const m = await sharp(out).metadata();
    expect([m.width, m.height]).toEqual([1100, 7281]); // gemessen an der Extension, Bon 01.10.2026
  });

  it('EXIF-Orientierung 6 wird aufgerichtet (Extension lieferte quer)', async () => {
    const quer = await bild(4000, 1848, { orientierung: 6 });
    const m = await sharp(await rendereKachel(quer, 520)).metadata();
    expect(m.width).toBe(520);
    expect(m.height).toBe(Math.round((4000 * 520) / 1848));
  });

  it('PNG (z. B. Screenshot eines E-Bons) → JPEG', async () => {
    const m = await sharp(await rendereKachel(await bild(800, 1200, { format: 'png' }), 520)).metadata();
    expect([m.format, m.width]).toEqual(['jpeg', 520]);
  });

  it('abgeschnittener Upload wird trotzdem angezeigt', async () => {
    const voll = await bild(1200, 1600);
    const halb = voll.subarray(0, Math.floor(voll.length * 0.6));
    const m = await sharp(await rendereKachel(halb, 520)).metadata();
    expect([m.format, m.width]).toEqual(['jpeg', 520]);
  });

  it('kein Bild → KachelFehler 415', async () => {
    await expect(rendereKachel(Buffer.from('%PDF-1.4 kein Bild'), 520)).rejects.toMatchObject({ code: 'kein_bild', status: 415 });
    await expect(rendereKachel(Buffer.alloc(0), 520)).rejects.toBeInstanceOf(KachelFehler);
  });

  it('Qualität bleibt 72 wie bei der Extension', () => {
    expect(QUALITAET).toBe(72);
  });
});

describe('ladeBegrenzt', () => {
  it('setzt die Chunks zusammen', async () => {
    const buf = await ladeBegrenzt(datei({ chunks: [Buffer.from('ab'), Buffer.from('cd')] }), 10);
    expect(buf.toString()).toBe('abcd');
  });

  it('bricht über der Obergrenze ab (413) und schließt den Strom', async () => {
    const d = datei({ chunks: [Buffer.alloc(6), Buffer.alloc(6), Buffer.alloc(6)] });
    await expect(ladeBegrenzt(d, 10)).rejects.toMatchObject({ code: 'zu_gross', status: 413 });
    expect(d.zerstoert).toBe(true);
  });

  it('fehlendes Objekt → 404', async () => {
    const e = Object.assign(new Error('No such object: bucket/x.jpg'), { code: 404 });
    await expect(ladeBegrenzt(datei({ fehler: e }))).rejects.toMatchObject({ code: 'nicht_gefunden', status: 404 });
  });

  it('anderer Storage-Fehler → 502', async () => {
    const e = Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' });
    await expect(ladeBegrenzt(datei({ fehler: e }))).rejects.toMatchObject({ code: 'storage_fehler', status: 502 });
  });
});
