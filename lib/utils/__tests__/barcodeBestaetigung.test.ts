import fixture from './fixtures/barcodePaare.json';
import {
  belastbareKandidaten,
  eingabeHinweis,
  entscheideEan,
  erstelleBarcodeBestaetigung,
  type BestaetigungsStand,
} from '../barcodeBestaetigung';
import { gleicheGtin, istRisikoform, pruefzifferStimmt } from '../gtin';

const PAARE: [string, string][] = fixture.paare.map(([falsch, richtig]) => [falsch, richtig]);

const A = '4337256984164'; // normal (DE)
const B = '4101530002055'; // normal (DE), zweiter Code im Bild
const C = '4101530014126'; // Regaletikett

/** Lesungen im festen Takt einspeisen, letzten Stand zurückgeben. */
function speise(folge: string[], schrittMs = 100, start = 1_000) {
  const b = erstelleBarcodeBestaetigung();
  const staende: BestaetigungsStand[] = [];
  folge.forEach((n, i) => staende.push(b.lesen(n, start + i * schrittMs)));
  return { b, staende, letzter: staende[staende.length - 1] };
}

describe('Bestätigung — Grundregeln', () => {
  it('eine einzelne Lesung bestätigt nichts', () => {
    expect(speise([A]).letzter).toEqual({ art: 'offen' });
  });

  it('drei gleiche Lesungen bestätigen eine normale Nummer', () => {
    const { staende } = speise([A, A, A]);
    expect(staende.map((s) => s.art)).toEqual(['offen', 'offen', 'bestaetigt']);
    expect(staende[2]).toEqual({ art: 'bestaetigt', nummer: A });
  });

  it('zwei gleiche Lesungen mit ≥ 600 ms Abstand genügen (500-ms-Filter von expo-camera)', () => {
    expect(speise([A, A], 600).letzter).toEqual({ art: 'bestaetigt', nummer: A });
    expect(speise([A, A], 599).letzter).toEqual({ art: 'offen' });
  });

  it('ungültige Prüfziffer zählt nie', () => {
    expect(speise(['4337256984165', '4337256984165', '4337256984165', '4337256984165']).letzter).toEqual({
      art: 'offen',
    });
  });

  it('Lesungen außerhalb des 3-s-Fensters verfallen', () => {
    const b = erstelleBarcodeBestaetigung();
    b.lesen(A, 0);
    b.lesen(A, 100);
    // dritte Lesung lange danach: die alten sind verfallen, und die Zeitregel
    // greift nicht über das Fenster hinweg
    expect(b.lesen(A, 5_000)).toEqual({ art: 'offen' });
  });

  it('Risikoform braucht 5 Lesungen (oder 3 über ≥ 1,2 s)', () => {
    const r = '20117221';
    expect(istRisikoform(r)).toBe(true);
    const { staende } = speise([r, r, r, r, r]);
    expect(staende.map((s) => s.art)).toEqual(['offen', 'offen', 'offen', 'offen', 'bestaetigt']);
    expect(speise([r, r], 700).letzter).toEqual({ art: 'offen' });
    expect(speise([r, r, r], 600).letzter).toEqual({ art: 'bestaetigt', nummer: r });
  });

  it('12- und 13-stellige Schreibweise zählen gemeinsam, zurück kommt die gelesene', () => {
    const lang = '0036000291452';
    const kurz = '036000291452';
    const { letzter } = speise([kurz, lang, kurz, lang, kurz]);
    expect(letzter).toEqual({ art: 'bestaetigt', nummer: kurz });
  });

  it('zuruecksetzen leert den Zähler', () => {
    const b = erstelleBarcodeBestaetigung();
    b.lesen(A, 0);
    b.lesen(A, 100);
    b.zuruecksetzen();
    expect(b.lesen(A, 200)).toEqual({ art: 'offen' });
  });
});

describe('Bestätigung — zwei Codes im Bild', () => {
  it('A, B, A, B, A: nicht eindeutig, der Nutzer entscheidet', () => {
    const { letzter } = speise([A, B, A, B, A]);
    expect(letzter).toEqual({ art: 'mehrdeutig', nummern: [A, B] });
  });

  it('A, B, A, B … endet nie in einer stillen Bestätigung (eine Serienregel bestätigte nie)', () => {
    const { staende } = speise([A, B, A, B, A, B, A, B]);
    expect(staende.some((s) => s.art === 'bestaetigt')).toBe(false);
    expect(staende.some((s) => s.art === 'mehrdeutig')).toBe(true);
  });

  it('ein einzelner Ausreißer stört die Bestätigung nicht', () => {
    expect(speise([A, C, A, A]).letzter).toEqual({ art: 'bestaetigt', nummer: A });
  });

  it('kandidaten: häufigste zuerst', () => {
    const { b } = speise([A, B, B]);
    expect(b.kandidaten(1_300)).toEqual([
      { nummer: B, anzahl: 2 },
      { nummer: A, anzahl: 1 },
    ]);
    expect(belastbareKandidaten(b.kandidaten(1_300))).toEqual([B]);
  });
});

describe('Bestätigung — echte Fehllesungen aus dem Feld (06.10.2026)', () => {
  // Paare mit gültiger richtiger Nummer; zwei Fälle hat der feste Leser selbst
  // falsch gelesen (11 Stellen) und sind hier ohne Aussage.
  const nutzbar = PAARE.filter(([f, r]) => pruefzifferStimmt(r) && !gleicheGtin(f, r));

  it('die Testdaten sind die erwarteten Feldfälle', () => {
    expect(PAARE.length).toBe(127);
    expect(nutzbar.length).toBeGreaterThanOrEqual(125);
  });

  it.each(nutzbar)('falsch %s, dann richtig %s ×n ⇒ richtig', (falsch, richtig) => {
    const folge = [falsch, richtig, richtig, richtig, richtig, richtig];
    const { staende } = speise(folge);
    const erster = staende.find((s) => s.art !== 'offen');
    expect(erster).toEqual({ art: 'bestaetigt', nummer: richtig });
    // nie die falsche Nummer
    expect(staende.some((s) => s.art === 'bestaetigt' && s.nummer === falsch)).toBe(false);
  });

  it.each(nutzbar)('einzelner Ausreißer %s ⇒ nichts', (falsch) => {
    expect(speise([falsch]).letzter).toEqual({ art: 'offen' });
  });

  it('falsch, richtig, richtig, richtig ⇒ richtig (für jede normale richtige Nummer)', () => {
    for (const [falsch, richtig] of nutzbar.filter(([, r]) => !istRisikoform(r))) {
      expect(speise([falsch, richtig, richtig, richtig]).letzter).toEqual({ art: 'bestaetigt', nummer: richtig });
    }
  });
});

describe('entscheideEan — nach der Aufnahme', () => {
  const ohneFoto = { nummern: [], gescheitert: false };

  it('bestätigt + Foto liest dieselbe Nummer ⇒ übernehmen', () => {
    expect(entscheideEan({ anlass: 'bestaetigt', bestaetigt: A, foto: { nummern: [A], gescheitert: false }, live: [] }))
      .toEqual({ art: 'uebernehmen', nummer: A });
  });

  it('bestätigt (12-stellig live, iPhone) + Foto 13-stellig ⇒ gelesene Schreibweise bleibt', () => {
    expect(
      entscheideEan({
        anlass: 'bestaetigt',
        bestaetigt: '036000291452',
        foto: { nummern: ['0036000291452'], gescheitert: false },
        live: [],
      }),
    ).toEqual({ art: 'uebernehmen', nummer: '036000291452' });
  });

  it('bestätigt + Nachlesen gescheitert oder unlesbar ⇒ bestätigte Nummer behalten', () => {
    expect(entscheideEan({ anlass: 'bestaetigt', bestaetigt: A, foto: { nummern: [], gescheitert: true }, live: [] }))
      .toEqual({ art: 'uebernehmen', nummer: A });
    expect(entscheideEan({ anlass: 'bestaetigt', bestaetigt: A, foto: ohneFoto, live: [] }))
      .toEqual({ art: 'uebernehmen', nummer: A });
  });

  it('bestätigt + Foto liest ANDERE Nummer ⇒ nachfragen, vorbefüllt mit der Foto-Lesung', () => {
    expect(entscheideEan({ anlass: 'bestaetigt', bestaetigt: A, foto: { nummern: [B], gescheitert: false }, live: [] }))
      .toEqual({ art: 'nachfragen', grund: 'abweichung', vorschlag: B, vorschlaege: [B, A] });
  });

  it('mehrdeutig ⇒ immer nachfragen; Foto-Treffer wird Vorschlag', () => {
    expect(entscheideEan({ anlass: 'mehrdeutig', foto: { nummern: [B], gescheitert: false }, live: [A, B] }))
      .toEqual({ art: 'nachfragen', grund: 'mehrdeutig', vorschlag: B, vorschlaege: [A, B] });
    expect(entscheideEan({ anlass: 'mehrdeutig', foto: ohneFoto, live: [A, B] }))
      .toEqual({ art: 'nachfragen', grund: 'mehrdeutig', vorschlag: '', vorschlaege: [A, B] });
  });

  it('selbst ausgelöst: eine Foto-Nummer ohne Widerspruch ⇒ übernehmen', () => {
    expect(entscheideEan({ anlass: 'ausloeser', foto: { nummern: [A], gescheitert: false }, live: [] }))
      .toEqual({ art: 'uebernehmen', nummer: A });
    expect(entscheideEan({ anlass: 'ausloeser', foto: { nummern: [A], gescheitert: false }, live: [A] }))
      .toEqual({ art: 'uebernehmen', nummer: A });
  });

  it('selbst ausgelöst: Foto widerspricht belastbarer Live-Lesung ⇒ nachfragen', () => {
    expect(entscheideEan({ anlass: 'ausloeser', foto: { nummern: [A], gescheitert: false }, live: [B] }))
      .toEqual({ art: 'nachfragen', grund: 'abweichung', vorschlag: A, vorschlaege: [A, B] });
  });

  it('selbst ausgelöst, nichts lesbar ⇒ eintippen (nie still ohne Nummer)', () => {
    expect(entscheideEan({ anlass: 'ausloeser', foto: { nummern: [], gescheitert: true }, live: [] }))
      .toEqual({ art: 'nachfragen', grund: 'unlesbar', vorschlag: '', vorschlaege: [] });
  });

  it('mehrere Codes auf dem Foto ⇒ wählen lassen', () => {
    expect(entscheideEan({ anlass: 'galerie', foto: { nummern: [A, C], gescheitert: false }, live: [] }))
      .toEqual({ art: 'nachfragen', grund: 'mehrdeutig', vorschlag: '', vorschlaege: [A, C] });
  });

  it('„Nummer eintippen“ fragt immer, vorbefüllt mit der besten Lesung', () => {
    expect(entscheideEan({ anlass: 'eintippen', foto: { nummern: [A], gescheitert: false }, live: [] }))
      .toEqual({ art: 'nachfragen', grund: 'eintippen', vorschlag: A, vorschlaege: [A] });
    expect(entscheideEan({ anlass: 'eintippen', foto: ohneFoto, live: [B] }))
      .toEqual({ art: 'nachfragen', grund: 'eintippen', vorschlag: B, vorschlaege: [B] });
  });

  it('ungültige Nummern werden nie vorgeschlagen', () => {
    expect(entscheideEan({ anlass: 'ausloeser', foto: { nummern: ['4337256984165'], gescheitert: false }, live: [] }))
      .toEqual({ art: 'nachfragen', grund: 'unlesbar', vorschlag: '', vorschlaege: [] });
  });
});

describe('eingabeHinweis — eingetippte Nummer', () => {
  it('gültige Nummer: kein Hinweis', () => {
    expect(eingabeHinweis('4337256984164')).toBeNull();
    expect(eingabeHinweis('20117221')).toBeNull();
  });

  it('Zahlendreher und falsche Länge: freundlicher Hinweis', () => {
    expect(eingabeHinweis('4337256984146')).toMatch(/Ziffer vertauscht/);
    expect(eingabeHinweis('433725698')).toMatch(/13 Ziffern/);
  });
});
