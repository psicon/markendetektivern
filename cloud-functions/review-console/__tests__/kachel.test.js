'use strict';
const {
  kachelUrl, pruefeKachelAnfrage, pfadZulaessig, ablaufFuer,
  RASTER_S, GUELTIG_MIN_S, MAX_HORIZONT_S, _signatur,
} = require('../src/kachel');

const BASIS = 'https://europe-west1-markendetektive-895f7.cloudfunctions.net/reviewKachel';
const KEY = 'a'.repeat(32) + '0123456789abcdef0123456789abcdef';
const FREMDER_KEY = 'b'.repeat(64);
const FOTO = 'crowduploads/Cy6DAtim6zTuJeh0ga22KYD491N2/c33731841cf8a781a0ec1928/produkt_1/images/front_84a59a2d1e2d10e5.jpg';
const BON = 'cashback-uploads/M6vFwmZexuUB2g0fUcaedBdp1Bz2/fde1582c926745ffaf754ebbba10ec7f.jpg';
const JETZT = Date.UTC(2026, 9, 1, 9, 17, 0);

/** URL → Query-Objekt, wie Express es liefert (einfache Strings). */
function query(url) {
  const u = new URL(url);
  return Object.fromEntries(u.searchParams.entries());
}
/** Gültige Signatur von Hand — das, was jemand mit dem Schlüssel bauen könnte. */
function handSigniert(pfad, breite, ablauf, key = KEY) {
  return { p: pfad, w: String(breite), e: String(ablauf), s: _signatur(pfad, breite, ablauf, key) };
}

describe('kachelUrl → pruefeKachelAnfrage', () => {
  it('gültige Signatur wird angenommen (Foto 520, Bon 1100)', () => {
    for (const [pfad, breite] of [[FOTO, 520], [BON, 1100]]) {
      const url = kachelUrl(BASIS, pfad, breite, KEY, JETZT);
      expect(url.startsWith(`${BASIS}?p=`)).toBe(true);
      expect(pruefeKachelAnfrage(query(url), KEY, JETZT + 60_000)).toEqual({ ok: true, pfad, breite });
    }
  });

  it('Sonderzeichen im Pfad überstehen die URL-Kodierung', () => {
    const pfad = 'crowduploads/u1/a b+c&d=e?f#g%20.jpg';
    const url = kachelUrl(BASIS, pfad, 520, KEY, JETZT);
    expect(pruefeKachelAnfrage(query(url), KEY, JETZT)).toEqual({ ok: true, pfad, breite: 520 });
  });

  it('abgelaufen → abgelehnt', () => {
    const url = kachelUrl(BASIS, FOTO, 520, KEY, JETZT);
    const ablauf = Number(query(url).e) * 1000;
    expect(pruefeKachelAnfrage(query(url), KEY, ablauf - 1000).ok).toBe(true);
    expect(pruefeKachelAnfrage(query(url), KEY, ablauf)).toEqual({ ok: false, grund: 'abgelaufen' });
    expect(pruefeKachelAnfrage(query(url), KEY, ablauf + 86_400_000)).toEqual({ ok: false, grund: 'abgelaufen' });
  });

  it('manipulierte Signatur → abgelehnt', () => {
    const q = query(kachelUrl(BASIS, FOTO, 520, KEY, JETZT));
    const kippe = q.s[5] === 'A' ? 'B' : 'A';
    const falsch = { ...q, s: q.s.slice(0, 5) + kippe + q.s.slice(6) };
    expect(pruefeKachelAnfrage(falsch, KEY, JETZT)).toEqual({ ok: false, grund: 'signatur_falsch' });
  });

  it('fremder Pfad mit echter Signatur eines anderen Pfads → abgelehnt', () => {
    const q = query(kachelUrl(BASIS, FOTO, 520, KEY, JETZT));
    const andererUpload = FOTO.replace('front_', 'preis_');
    expect(pruefeKachelAnfrage({ ...q, p: andererUpload }, KEY, JETZT)).toEqual({ ok: false, grund: 'signatur_falsch' });
    expect(pruefeKachelAnfrage({ ...q, p: BON }, KEY, JETZT)).toEqual({ ok: false, grund: 'signatur_falsch' });
  });

  it('Breite oder Ablauf verändert → abgelehnt', () => {
    const q = query(kachelUrl(BASIS, FOTO, 520, KEY, JETZT));
    expect(pruefeKachelAnfrage({ ...q, w: '1100' }, KEY, JETZT).grund).toBe('signatur_falsch');
    expect(pruefeKachelAnfrage({ ...q, e: String(Number(q.e) + RASTER_S) }, KEY, JETZT).grund).toBe('signatur_falsch');
  });

  it('mit einem anderen Schlüssel signiert → abgelehnt', () => {
    const q = query(kachelUrl(BASIS, FOTO, 520, FREMDER_KEY, JETZT));
    expect(pruefeKachelAnfrage(q, KEY, JETZT)).toEqual({ ok: false, grund: 'signatur_falsch' });
  });

  it('auch MIT gültiger HMAC: Pfad außerhalb der Upload-Bereiche → abgelehnt', () => {
    const ablauf = ablaufFuer(JETZT);
    for (const pfad of [
      'markenprodukte/abc.jpg',
      'crowduploads/../markenprodukte/abc.jpg',
      'crowduploads/u1//x.jpg',
      'crowduploads/u1/x.jpg/',
      'cashback-uploads/u1/./x.jpg',
      '/crowduploads/u1/x.jpg',
      'crowduploadsX/u1/x.jpg',
      'crowduploads/u1\\x.jpg',
      'crowduploads/u1/x\n.jpg',
      `crowduploads/${'x'.repeat(600)}.jpg`,
    ]) {
      expect(pruefeKachelAnfrage(handSigniert(pfad, 520, ablauf), KEY, JETZT)).toEqual({ ok: false, grund: 'pfad_nicht_erlaubt' });
    }
  });

  it('auch MIT gültiger HMAC: nicht vorgesehene Breite → abgelehnt', () => {
    const ablauf = ablaufFuer(JETZT);
    for (const breite of [4000, 1, 519, 521]) {
      expect(pruefeKachelAnfrage(handSigniert(FOTO, breite, ablauf), KEY, JETZT)).toEqual({ ok: false, grund: 'breite_nicht_erlaubt' });
    }
  });

  it('auch MIT gültiger HMAC: Ablauf weiter weg, als der Server je ausstellt → abgelehnt', () => {
    const jetztS = Math.floor(JETZT / 1000);
    const zuFern = jetztS + MAX_HORIZONT_S + 1;
    expect(pruefeKachelAnfrage(handSigniert(FOTO, 520, zuFern), KEY, JETZT)).toEqual({ ok: false, grund: 'ablauf_zu_fern' });
    expect(pruefeKachelAnfrage(handSigniert(FOTO, 520, jetztS + 365 * 86400), KEY, JETZT).grund).toBe('ablauf_zu_fern');
  });

  it('fehlende, mehrfache oder nicht-kanonische Parameter → abgelehnt', () => {
    const q = query(kachelUrl(BASIS, FOTO, 520, KEY, JETZT));
    for (const feld of ['p', 'w', 'e', 's']) {
      const ohne = { ...q }; delete ohne[feld];
      expect(pruefeKachelAnfrage(ohne, KEY, JETZT).grund).toBe('parameter_fehlen');
      expect(pruefeKachelAnfrage({ ...q, [feld]: [q[feld], q[feld]] }, KEY, JETZT).grund).toBe('parameter_fehlen');
      expect(pruefeKachelAnfrage({ ...q, [feld]: { x: q[feld] } }, KEY, JETZT).grund).toBe('parameter_fehlen');
    }
    expect(pruefeKachelAnfrage({ ...q, w: '0520' }, KEY, JETZT).grund).toBe('parameter_ungueltig');
    expect(pruefeKachelAnfrage({ ...q, w: '+520' }, KEY, JETZT).grund).toBe('parameter_ungueltig');
    expect(pruefeKachelAnfrage({ ...q, e: `${q.e}.0` }, KEY, JETZT).grund).toBe('parameter_ungueltig');
    expect(pruefeKachelAnfrage({ ...q, s: `${q.s}=` }, KEY, JETZT).grund).toBe('parameter_ungueltig');
    expect(pruefeKachelAnfrage({ ...q, s: q.s.slice(1) }, KEY, JETZT).grund).toBe('parameter_ungueltig');
    expect(pruefeKachelAnfrage(undefined, KEY, JETZT).grund).toBe('parameter_fehlen');
  });

  it('Alt-URL der Extension (operations=…) → abgelehnt', () => {
    const ops = encodeURIComponent(JSON.stringify([{ operation: 'input', type: 'gcs', source: FOTO }]));
    expect(pruefeKachelAnfrage(query(`${BASIS}?operations=${ops}`), KEY, JETZT).grund).toBe('parameter_fehlen');
  });
});

describe('Schlüssel', () => {
  it('fehlt oder zu kurz → keine URL, Prüfung meldet Serverfehler statt Verbot', () => {
    for (const k of [undefined, null, '', 'kurz', 'x'.repeat(31)]) {
      expect(kachelUrl(BASIS, FOTO, 520, k, JETZT)).toBeNull();
      expect(pruefeKachelAnfrage({ p: FOTO, w: '520', e: '1', s: 'x' }, k, JETZT)).toEqual({ ok: false, grund: 'schluessel_fehlt' });
    }
  });
});

describe('kachelUrl stellt nur Erlaubtes aus', () => {
  it('kein Pfad / fremder Bereich / andere Breite → null', () => {
    expect(kachelUrl(BASIS, null, 520, KEY, JETZT)).toBeNull();
    expect(kachelUrl(BASIS, 'markenprodukte/x.jpg', 520, KEY, JETZT)).toBeNull();
    expect(kachelUrl(BASIS, FOTO, 800, KEY, JETZT)).toBeNull();
  });
  it('pfadZulaessig für echte Pfade', () => {
    expect(pfadZulaessig(FOTO)).toBe(true);
    expect(pfadZulaessig(BON)).toBe(true);
  });
});

describe('Ablauf-Raster (Browser-Cache)', () => {
  it('gültig mindestens 6, höchstens 12 Stunden', () => {
    for (let t = JETZT; t < JETZT + 2 * RASTER_S * 1000; t += 7 * 60 * 1000) {
      const rest = ablaufFuer(t) - t / 1000;
      expect(rest).toBeGreaterThanOrEqual(GUELTIG_MIN_S);
      expect(rest).toBeLessThanOrEqual(GUELTIG_MIN_S + RASTER_S);
      expect(rest).toBeLessThan(MAX_HORIZONT_S);
    }
  });
  it('innerhalb eines Rasters bleibt die URL gleich, danach wechselt sie', () => {
    const start = Math.ceil(JETZT / 1000 / RASTER_S) * RASTER_S * 1000; // Rastergrenze
    const a = kachelUrl(BASIS, FOTO, 520, KEY, start + 1000);
    const b = kachelUrl(BASIS, FOTO, 520, KEY, start + (RASTER_S - 1) * 1000);
    const c = kachelUrl(BASIS, FOTO, 520, KEY, start + (RASTER_S + 1) * 1000);
    expect(a).toBe(b);
    expect(c).not.toBe(a);
  });
});
