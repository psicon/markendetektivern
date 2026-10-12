'use strict';
/**
 * Steuer-QR-Code auf dem Kassenbon als kostenloser Zeuge (Patrick 12.10.2026: „mach 1“).
 *
 * Deutschland (KassenSichV § 6, DSFinV-K, Format „V0“, freiwillig): Kassen-Seriennummer,
 * Vorgangsart, Vorgangsdaten mit Bruttobetrag je Steuersatz, Transaktionsnummer,
 * Signaturzähler, Start- und Endzeit (ISO, meist UTC mit „Z“), Signatur.
 * Österreich (RKSV, Pflicht): „_R1-AT…_Kassen-ID_Belegnr_Datum-Zeit (Ortszeit)_Beträge…“.
 *
 * Gemessen 12.10.2026 an 150 Test-Bons: 14 tragen einen lesbaren Code (Kaufland 9/18,
 * ALDI Nord 4/12, Billa 1/1); bei allen 13 deutschen stimmte die Summe auf den Cent.
 *
 * Liefert {format, kasse, transaktion, summeCents, datum, zeiten[]} oder null. Wirft nie.
 * WASM immer aus dem Paket laden (sonst lädt zxing-wasm von einem CDN).
 */

const fs = require('fs');
const sharp = require('sharp');

let modul = null;
function laden() {
  if (!modul) {
    modul = (async () => {
      const zx = require('zxing-wasm/reader');
      await zx.prepareZXingModule({ overrides: { wasmBinary: fs.readFileSync(require.resolve('zxing-wasm/reader/zxing_reader.wasm')) } });
      return zx;
    })();
  }
  return modul;
}

const cent = (s) => {
  const n = Number(String(s).replace(',', '.'));
  return Number.isFinite(n) ? Math.round(n * 100) : null;
};

/** ISO-Zeitpunkt → {datum, zeit} in der Ortszeit (UTC mit „Z“ wird umgerechnet). */
function ortszeit(iso, zone) {
  const s = String(iso || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s)) return null;
  if (/Z$|[+-]\d{2}:?\d{2}$/.test(s)) {
    const d = new Date(s);
    if (!Number.isFinite(d.getTime())) return null;
    const f = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(d);
    const t = Object.fromEntries(f.map((p) => [p.type, p.value]));
    return { datum: `${t.year}-${t.month}-${t.day}`, zeit: `${t.hour}:${t.minute}` };
  }
  return { datum: s.slice(0, 10), zeit: s.slice(11, 16) };
}

/** Text eines QR-Codes deuten. */
function deuten(text) {
  const t = String(text || '');
  if (t.startsWith('V0;')) {
    const f = t.split(';');
    if (f.length < 8 || !/^Kassenbeleg/i.test(f[2] || '')) return null;
    const teile = String(f[3] || '').split('^');
    if (!/^Beleg$/i.test(teile[0] || '')) return null;
    const betraege = String(teile[1] || '').split('_').map(cent);
    if (!betraege.length || betraege.some((b) => b == null)) return null;
    const zeiten = [ortszeit(f[6], 'Europe/Berlin'), ortszeit(f[7], 'Europe/Berlin')].filter(Boolean);
    if (!zeiten.length) return null;
    return {
      format: 'tse',
      kasse: String(f[1] || '').trim() || null,
      transaktion: /^\d+$/.test(f[4] || '') ? f[4] : null,
      summeCents: betraege.reduce((a, b) => a + b, 0),
      datum: zeiten[zeiten.length - 1].datum,
      zeiten: zeiten.map((z) => z.zeit),
    };
  }
  if (/^_R1-AT\d+_/.test(t)) {
    const f = t.split('_');
    // _R1-AT1 _ Kassen-ID _ Belegnr _ Zeitpunkt _ 5 Beträge _ …
    if (f.length < 10) return null;
    const z = ortszeit(f[4], 'Europe/Vienna');
    const betraege = f.slice(5, 10).map(cent);
    if (!z || betraege.some((b) => b == null)) return null;
    return { format: 'rksv', kasse: f[2] || null, transaktion: f[3] || null, summeCents: betraege.reduce((a, b) => a + b, 0), datum: z.datum, zeiten: [z.zeit] };
  }
  return null;
}

/**
 * Steuer-QR-Code im Bild suchen. Verkleinert auf 2000 px Breite (Speicher), sucht bis
 * zu 3 QR-Codes und nimmt den ersten deutbaren. Zeitlimit 6 s. Wirft nie.
 */
async function kassenQrLesen(bytes, { zeitMs = 6000 } = {}) {
  let uhr;
  try {
    const arbeit = (async () => {
      const bild = await sharp(bytes, { limitInputPixels: 120e6 }).rotate().resize({ width: 2000, withoutEnlargement: true }).png().toBuffer();
      const zx = await laden();
      const treffer = await zx.readBarcodes(bild, { formats: ['QRCode'], tryHarder: true, maxNumberOfSymbols: 3 });
      for (const x of treffer || []) {
        const d = deuten(x.text);
        if (d) return d;
      }
      return null;
    })();
    const grenze = new Promise((r) => { uhr = setTimeout(() => r(null), zeitMs); });
    return await Promise.race([arbeit.catch(() => null), grenze]);
  } catch (e) {
    return null;
  } finally {
    clearTimeout(uhr);
  }
}

module.exports = { kassenQrLesen, deuten, ortszeit };
