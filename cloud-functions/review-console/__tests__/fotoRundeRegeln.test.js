'use strict';
/**
 * Regeln der Morgenrunde. Jeder Fall hier ist einer, der in den Handrunden
 * 09.–24.09.2026 vorkam und dort von Hand entschieden werden musste.
 */
const { entscheideFall, notbremse, bildBefund, fotoVorbefund, bildMitVorbefund, belegeVon, rundeOffenEintrag, rundeBefunde, AUSSER_GESAMTQUOTE, DOPPEL_GRUENDE, RUNDE_SPERREND } = require('../src/fotoRundeRegeln');
const WOCHE = 'sperre_woche_gleicher_nutzer';

const ok = { ok: true, problems: [], missing: [] };
const echt = { echt: true, loseWare: false, gleicheAnsicht: false, grund: '' };
// Normalfall: der Preis wurde gelesen (Namer oder Nachlesen).
const fall = (over = {}) => ({ comp: ok, dup: { verdict: 'ok', reason: null, lockUntil: null }, leer: [], unlesbar: [], wiederverwendet: false, audit: echt, auditFehler: null, rettungFehler: {}, preisVorhanden: true, ...over });

describe('Preis ist Pflicht (Entscheidung Patrick 26.09.2026)', () => {
  const ohnePreis = (audit, over = {}) => fall({ preisVorhanden: false, audit, ...over });
  it('kein Preis gelesen, Preisfoto zeigt keinen Preis → ablehnen preis_fehlt', () => {
    expect(entscheideFall(ohnePreis({ ...echt, preisSichtbar: false }))).toMatchObject({ entscheidung: 'ablehnen', grund: 'preis_fehlt' });
  });
  it('Preis auf dem Foto sichtbar, nur nicht gelesen → freigeben', () => {
    expect(entscheideFall(ohnePreis({ ...echt, preisSichtbar: true })).entscheidung).toBe('freigeben');
  });
  it('Preis gelesen → freigeben, auch wenn die Bildprüfung ihn nicht sah', () => {
    expect(entscheideFall(fall({ audit: { ...echt, preisSichtbar: false } })).entscheidung).toBe('freigeben');
  });
  it('Bildprüfung hat den Preis nicht beurteilt → offen, nicht raten', () => {
    expect(entscheideFall(ohnePreis({ ...echt }))).toMatchObject({ entscheidung: 'offen', grund: 'preis_unbeurteilt' });
  });
  it('Nachlesen des Preises an unserer Technik gescheitert → offen', () => {
    expect(entscheideFall(ohnePreis({ ...echt, preisSichtbar: false }, { rettungFehler: { preis: '429' } }))).toMatchObject({ entscheidung: 'offen', grund: 'nachlesen_gescheitert' });
  });
  it('lose Ware ohne Preis → ebenfalls preis_fehlt', () => {
    const e = entscheideFall(ohnePreis({ ...echt, loseWare: true, preisSichtbar: false }, { comp: { ok: false, problems: ['ean_fehlt'], missing: [] } }));
    expect(e).toMatchObject({ entscheidung: 'ablehnen', grund: 'preis_fehlt' });
  });
  it('lose Ware mit Preis → freigeben als lose Ware', () => {
    const e = entscheideFall(fall({ audit: { ...echt, loseWare: true }, comp: { ok: false, problems: ['ean_fehlt'], missing: [] } }));
    expect(e).toMatchObject({ entscheidung: 'freigeben', loseWare: true });
  });
  it('unpassende Fotos gehen weiter vor (genauerer Grund)', () => {
    expect(entscheideFall(ohnePreis({ ...echt, echt: false, preisSichtbar: false })).grund).toBe('fotos_unpassend');
  });

  // Gegenprüfung 26.09.: abgelehnt wird nur ohne jedes Gegenzeichen.
  it('Lesedienst sah ein Preisschild, Bildprüfung nicht → offen preis_unsicher statt Ablehnung', () => {
    const e = entscheideFall(ohnePreis({ ...echt, preisSichtbar: false }, { preisHinweis: 'Lesedienst sah auf dem Preisfoto: preisschild' }));
    expect(e).toMatchObject({ entscheidung: 'offen', grund: 'preis_unsicher' });
    expect(e.ctx.hinweis).toMatch(/preisschild/);
  });
  it('nur eine von zwei Nachlesungen fand einen Preis → offen preis_unsicher', () => {
    expect(entscheideFall(ohnePreis({ ...echt, preisSichtbar: false }, { rettungFehler: { preis: 'lesungen_uneinig' } })))
      .toMatchObject({ entscheidung: 'offen', grund: 'preis_unsicher' });
  });
  it('Preisfoto beim Hochladen beschädigt → offen, keine Ablehnung für unseren Fehler', () => {
    expect(entscheideFall(ohnePreis({ ...echt, preisSichtbar: false }, { preisBildDefekt: true }))).toMatchObject({ entscheidung: 'offen', grund: 'bild_defekt' });
  });
  it('Bildprüfung unsicher (null) → offen preis_unbeurteilt', () => {
    expect(entscheideFall(ohnePreis({ ...echt, preisSichtbar: null }))).toMatchObject({ entscheidung: 'offen', grund: 'preis_unbeurteilt' });
  });
  it('Gegenzeichen ohne Belang, wenn der Preis sichtbar ist → freigeben', () => {
    expect(entscheideFall(ohnePreis({ ...echt, preisSichtbar: true }, { preisHinweis: 'x', rettungFehler: { preis: 'lesungen_uneinig' } })).entscheidung).toBe('freigeben');
  });
  // Seit der Wochen-Regel (02.10.2026) hängt die Sperre nicht mehr am Preis —
  // ein unsicher gelesener Preis kann sie also weder lösen noch begründen.
  it('Wochen-Sperre ohne Preis und mit uneiniger Preis-Nachlesung → trotzdem ablehnen', () => {
    const e = entscheideFall(fall({ preisVorhanden: false, rettungFehler: { preis: 'lesungen_uneinig' }, dup: { verdict: 'locked', reason: WOCHE, lockUntil: 1 } }));
    expect(e).toMatchObject({ entscheidung: 'ablehnen', grund: WOCHE });
  });
});

describe('Aufnahmeort und Lesedienst', () => {
  it('Aufnahmeort passt nicht zum Markt → offen für den Menschen', () => {
    expect(entscheideFall(fall({ ortAuffaellig: 'Aufnahmeort liegt in Österreich, der Markt ist für DE hinterlegt' }))).toMatchObject({ entscheidung: 'offen', grund: 'ort_auffaellig' });
  });
  it('… aber ein fehlender Preis wird trotzdem abgelehnt (eindeutiger Grund zuerst)', () => {
    expect(entscheideFall(fall({ preisVorhanden: false, audit: { ...echt, preisSichtbar: false }, ortAuffaellig: 'x' })).grund).toBe('preis_fehlt');
  });
  it('Lesedienst liest noch nach → offen (die Runde prüft vorher, ob sein Termin nicht hängt)', () => {
    expect(entscheideFall(fall({ namerLaeuft: true }))).toMatchObject({ entscheidung: 'offen', grund: 'namer_laeuft_noch' });
  });
});

describe('entscheideFall', () => {
  it('alles sauber → freigeben', () => {
    expect(entscheideFall(fall()).entscheidung).toBe('freigeben');
  });

  it('Storage nicht lesbar → offen, NIE ablehnen (unsere Technik)', () => {
    const e = entscheideFall(fall({ unlesbar: ['front'], comp: { ok: false, problems: ['unvollstaendig'], missing: ['front'] } }));
    expect(e).toMatchObject({ entscheidung: 'offen', grund: 'bild_nicht_lesbar_infrastruktur' });
  });

  it('fehlende Pflichtfotos → ablehnen unvollstaendig mit Liste', () => {
    const e = entscheideFall(fall({ comp: { ok: false, problems: ['unvollstaendig'], missing: ['preis'] } }));
    expect(e).toMatchObject({ entscheidung: 'ablehnen', grund: 'unvollstaendig', ctx: { missing: ['preis'] } });
  });

  it('leere Datei (0 Byte) → ablehnen unvollstaendig', () => {
    expect(entscheideFall(fall({ leer: ['zutaten'] }))).toMatchObject({ entscheidung: 'ablehnen', grund: 'unvollstaendig' });
  });

  it('eigenes Doppel binnen einer Woche → ablehnen mit Sperrfrist', () => {
    const e = entscheideFall(fall({ dup: { verdict: 'locked', reason: WOCHE, lockUntil: 123 } }));
    expect(e).toMatchObject({ entscheidung: 'ablehnen', grund: WOCHE, ctx: { lockUntil: 123 } });
  });

  it('ältere eigene Einreichung noch offen → offen', () => {
    expect(entscheideFall(fall({ dup: { verdict: 'hold', reason: 'doppelt_eingereicht' } })).entscheidung).toBe('offen');
  });

  it('Bild aus früherer eigener Freigabe → ablehnen', () => {
    expect(entscheideFall(fall({ bild: { art: 'wiederverwendet', mit: ['a'] } })).grund).toBe('bilder_wiederverwendet');
  });

  it('kein Name nach Nachlesen → ablehnen; Nachlesen am Limit gescheitert → offen', () => {
    const comp = { ok: false, problems: ['kein_produktname'], missing: [] };
    expect(entscheideFall(fall({ comp })).grund).toBe('kein_produktname');
    expect(entscheideFall(fall({ comp, rettungFehler: { name: '429' } })).entscheidung).toBe('offen');
  });

  it('lose Ware: auch wenn alle Fotos das Waage-Etikett zeigen → angenommen (Bergkäse 24.09.)', () => {
    const comp = { ok: false, problems: ['ean_fehlt'], missing: [] };
    const e = entscheideFall(fall({ comp, audit: { ...echt, loseWare: true, gleicheAnsicht: true, traegtAngaben: false } }));
    expect(e).toMatchObject({ entscheidung: 'freigeben', loseWare: true });
  });

  it('lose Ware ohne Barcode wird ANGENOMMEN (Entscheidung 20.09.)', () => {
    const comp = { ok: false, problems: ['ean_fehlt'], missing: [] };
    const e = entscheideFall(fall({ comp, audit: { ...echt, loseWare: true } }));
    expect(e).toMatchObject({ entscheidung: 'freigeben', loseWare: true });
  });

  it('verpackte Ware ohne Barcode → ablehnen ean_fehlt; ohne Bildprüfung → offen', () => {
    const comp = { ok: false, problems: ['ean_fehlt'], missing: [] };
    expect(entscheideFall(fall({ comp })).grund).toBe('ean_fehlt');
    expect(entscheideFall(fall({ comp, audit: null, auditFehler: '429' })).entscheidung).toBe('offen');
    expect(entscheideFall(fall({ comp, rettungFehler: { ean: '500' } })).entscheidung).toBe('offen');
  });

  it('Bildprüfung gescheitert → offen, NIE freigeben', () => {
    const e = entscheideFall(fall({ audit: null, auditFehler: 'RESOURCE_EXHAUSTED' }));
    expect(e).toMatchObject({ entscheidung: 'offen', grund: 'bild_audit_gescheitert' });
  });

  it('abgeschnittene Datei (Bild nicht lesbar) → offen als bild_defekt', () => {
    const e = entscheideFall(fall({ audit: null, auditFehler: 'Failed to decode image data' }));
    expect(e).toMatchObject({ entscheidung: 'offen', grund: 'bild_defekt' });
  });

  it('fünfmal dieselbe Ansicht bei Ware MIT Angaben → ablehnen (Quark 24.09.)', () => {
    expect(entscheideFall(fall({ audit: { ...echt, gleicheAnsicht: true, traegtAngaben: true } })).grund).toBe('gleiche_ansicht_mehrfach');
    // ohne Aussage des Modells: streng bleiben
    expect(entscheideFall(fall({ audit: { ...echt, gleicheAnsicht: true } })).grund).toBe('gleiche_ansicht_mehrfach');
  });

  it('dieselbe Ansicht bei Frischware OHNE Angaben → freigeben (Nektarinen 24.09.)', () => {
    expect(entscheideFall(fall({ audit: { ...echt, gleicheAnsicht: true, traegtAngaben: false } }))).toMatchObject({ entscheidung: 'freigeben', ohneAngaben: true });
  });

  it('Frischware ohne Angaben, aber unecht → trotzdem ablehnen', () => {
    expect(entscheideFall(fall({ audit: { ...echt, echt: false, traegtAngaben: false } })).grund).toBe('fotos_unpassend');
  });

  it('unecht → ablehnen fotos_unpassend', () => {
    expect(entscheideFall(fall({ audit: { ...echt, echt: false, grund: 'Bildschirmfoto' } })).grund).toBe('fotos_unpassend');
  });
});

describe('notbremse', () => {
  const plan = (freigaben, bildAbgelehnt, sonstAbgelehnt = 0) => [
    ...Array.from({ length: freigaben }, () => ({ entscheidung: 'freigeben', grund: null, audit: echt })),
    ...Array.from({ length: bildAbgelehnt }, () => ({ entscheidung: 'ablehnen', grund: 'fotos_unpassend', audit: { ...echt, echt: false } })),
    ...Array.from({ length: sonstAbgelehnt }, () => ({ entscheidung: 'ablehnen', grund: 'unvollstaendig', audit: null })),
  ];

  it('normaler Tag (2 von 231 unpassend, wie am 24.09.) → keine Bremse', () => {
    const p = plan(229, 2);
    const b = notbremse(p, { schnittQuote: 0.05 });
    expect(b).toMatchObject({ bild: false, gesamt: false });
    expect(p.filter((x) => x.entscheidung === 'ablehnen')).toHaveLength(2);
  });

  it('Bildprüfung kippt (15 von 60) → deren Ablehnungen bleiben offen, Freigaben laufen', () => {
    const p = plan(45, 15);
    const b = notbremse(p, { schnittQuote: null });
    expect(b.bild).toBe(true);
    expect(p.filter((x) => x.entscheidung === 'ablehnen')).toHaveLength(0);
    expect(p.filter((x) => x.entscheidung === 'freigeben')).toHaveLength(45);
    expect(p.find((x) => x.grund === 'notbremse_bildpruefung').zurueckgehaltenGrund).toBe('fotos_unpassend');
  });

  it('Gesamtquote über dem Doppelten des Schnitts → alle Ablehnungen zurückgehalten', () => {
    const p = plan(40, 0, 20);
    const b = notbremse(p, { schnittQuote: 0.1 });
    expect(b.gesamt).toBe(true);
    expect(p.filter((x) => x.entscheidung === 'ablehnen')).toHaveLength(0);
  });

  it('wenige Ablehnungen lösen nie aus', () => {
    const p = plan(3, 0, 4);
    expect(notbremse(p, { schnittQuote: 0.01 }).gesamt).toBe(false);
  });

  const preisPlan = (freigaben, preisFehlt) => [
    ...Array.from({ length: freigaben }, () => ({ entscheidung: 'freigeben', grund: null, audit: { ...echt, preisSichtbar: true } })),
    ...Array.from({ length: preisFehlt }, () => ({ entscheidung: 'ablehnen', grund: 'preis_fehlt', audit: { ...echt, preisSichtbar: false } })),
  ];
  it('Preis fehlt im üblichen Maß (20 von 188, gut 10 %) → keine Bremse', () => {
    const p = preisPlan(168, 20);
    expect(notbremse(p, { schnittQuote: 0.104 })).toMatchObject({ preis: false, gesamt: false });
    expect(p.filter((x) => x.grund === 'preis_fehlt')).toHaveLength(20);
  });
  // Gegenprüfung 26.09.: mit „Preis fehlt" in der Gesamtquote hätte die Bremse
  // an einem normalen Tag ausgelöst (vorher 21 von 100 > 2 × 10,4 %).
  it('üblicher Tag mit Preis-Pflicht (10 andere + 11 Preis von 100) → keine Gesamt-Bremse', () => {
    const p = [...preisPlan(79, 11), ...plan(0, 0, 10)];
    expect(notbremse(p, { schnittQuote: 0.104 })).toMatchObject({ gesamt: false, preis: false });
    expect(p.filter((x) => x.entscheidung === 'ablehnen')).toHaveLength(21);
  });
  it('kippt die Gesamtquote wirklich, werden auch Preis-Ablehnungen gehalten', () => {
    const p = [...preisPlan(40, 3), ...plan(0, 0, 20)];
    expect(notbremse(p, { schnittQuote: 0.1 }).gesamt).toBe(true);
    expect(p.filter((x) => x.entscheidung === 'ablehnen')).toHaveLength(0);
    expect(p.filter((x) => x.zurueckgehaltenGrund === 'preis_fehlt')).toHaveLength(3);
  });
  it('Preis fehlt angeblich bei fast der Hälfte → Bildprüfung verdächtig, Ablehnungen zurückgehalten', () => {
    const p = preisPlan(30, 25);
    const b = notbremse(p, { schnittQuote: null });
    expect(b.preis).toBe(true);
    expect(p.filter((x) => x.entscheidung === 'ablehnen')).toHaveLength(0);
    expect(p.find((x) => x.grund === 'notbremse_preis').zurueckgehaltenGrund).toBe('preis_fehlt');
  });
});

describe('Nachlese-Fehler sind kein Urteil (Gegenprüfung 24.09.)', () => {
  it('Speichern der Nachlesung gescheitert → kein Name führt NICHT zur Ablehnung', () => {
    const comp = { ok: false, problems: ['kein_produktname'], missing: [] };
    expect(entscheideFall(fall({ comp, rettungFehler: { alles: 'UNAVAILABLE' } })).entscheidung).toBe('offen');
  });
  it('dasselbe für den Barcode', () => {
    const comp = { ok: false, problems: ['ean_fehlt'], missing: [] };
    expect(entscheideFall(fall({ comp, rettungFehler: { alles: 'DEADLINE_EXCEEDED' } })).entscheidung).toBe('offen');
  });
  it('Wochen-Sperre ist ein Urteil über Person, EAN und Zeit — gescheitertes Preis-Nachlesen ändert nichts', () => {
    const dup = { verdict: 'locked', reason: WOCHE, lockUntil: 1 };
    expect(entscheideFall(fall({ dup, preisVorhanden: false, rettungFehler: { preis: '429' } })).entscheidung).toBe('ablehnen');
    expect(entscheideFall(fall({ dup, preisVorhanden: false })).entscheidung).toBe('ablehnen');
  });
  it('Arbeitszeit abgelaufen: Name und Barcode nicht nachgelesen ist kein „fehlt" (26.09.)', () => {
    const { rettungNichtGeschafft } = require('../src/fotoRundeRegeln');
    const rf = rettungNichtGeschafft();
    expect(rf.preis).toBe('zeit_abgelaufen');
    expect(entscheideFall(fall({ comp: { ok: false, problems: ['kein_produktname'], missing: [] }, rettungFehler: rf })).entscheidung).toBe('offen');
    expect(entscheideFall(fall({ comp: { ok: false, problems: ['ean_fehlt'], missing: [] }, rettungFehler: rf })).entscheidung).toBe('offen');
    // … und kein Preis gelesen ist dann kein „Preis fehlt".
    expect(entscheideFall(fall({ preisVorhanden: false, audit: { ...echt, preisSichtbar: false }, rettungFehler: rf })))
      .toMatchObject({ entscheidung: 'offen', grund: 'nachlesen_gescheitert', ctx: { hinweis: 'zeit_abgelaufen' } });
  });
});

describe('Nachlesen: lesbar heißt nicht wortgleich (Hinweis APP_ORIGINAL 24.09.)', () => {
  const { nameAusLesungen, eanAusLesungen } = require('../src/fotoRundeRegeln');
  const gtin = (c) => c === '4061464833821';

  it('zwei leicht verschiedene Namen → Name übernommen, Alternative gemerkt', () => {
    expect(nameAusLesungen({ name: 'K-Classic Mango Eis', sicher: true }, { name: 'K Classic Mango-Eis mit Stücken', sicher: true }))
      .toEqual({ name: 'K-Classic Mango Eis', alternative: 'K Classic Mango-Eis mit Stücken' });
  });
  it('gleiche Namen → keine Alternative', () => {
    expect(nameAusLesungen({ name: 'Milsani Skyr', sicher: true }, { name: 'milsani skyr', sicher: true })).toEqual({ name: 'Milsani Skyr', alternative: null });
  });
  it('nur eine Lesung findet einen Namen → unsicher (bleibt offen)', () => {
    expect(nameAusLesungen({ name: 'Milsani Skyr', sicher: true }, { name: '', sicher: false })).toEqual({ unsicher: true });
  });
  it('keine Lesung → kein Name', () => {
    expect(nameAusLesungen({ name: '', sicher: false }, { name: '', sicher: false })).toEqual({});
  });
  it('EAN bleibt streng: nur zweimal gleich mit Prüfziffer', () => {
    expect(eanAusLesungen({ ean: '4061464833821' }, { ean: '4061464833821' }, gtin)).toEqual({ ean: '4061464833821' });
    expect(eanAusLesungen({ ean: '4061464833821' }, { ean: '4061464833828' }, gtin)).toEqual({ unsicher: true });
    expect(eanAusLesungen({ ean: '' , sicher: false }, { ean: '', sicher: false }, gtin)).toEqual({});
  });
  it('unsichere Lesung führt zu „offen", nicht zur Ablehnung', () => {
    expect(entscheideFall(fall({ comp: { ok: false, problems: ['kein_produktname'], missing: [] }, rettungFehler: { name: 'lesungen_uneinig' } })))
      .toMatchObject({ entscheidung: 'offen', grund: 'lesung_unsicher' });
    expect(entscheideFall(fall({ comp: { ok: false, problems: ['ean_fehlt'], missing: [] }, rettungFehler: { ean: 'lesungen_uneinig' } })))
      .toMatchObject({ entscheidung: 'offen', grund: 'lesung_unsicher' });
  });
});

describe('Gesperrte Konten (Entscheidung Patrick 02.10.2026)', () => {
  // „nicht freigeben" — stumm liegen lassen, NICHT ablehnen (Prüfrunde 02.10.:
  // eine Ablehnung ist endgültig und für den Nutzer sichtbar).
  it('gesperrt → offen konto_gesperrt (stumm), vor allem anderen — nie Ablehnung, nie Freigabe', () => {
    expect(entscheideFall(fall({ kontoSperre: 'gesperrt' }))).toMatchObject({ entscheidung: 'offen', grund: 'konto_gesperrt' });
    // auch wenn sonst nur Technik im Weg stünde oder gar nichts geprüft ist
    expect(entscheideFall({ kontoSperre: 'gesperrt' })).toMatchObject({ entscheidung: 'offen', grund: 'konto_gesperrt' });
    expect(entscheideFall(fall({ kontoSperre: 'gesperrt', unlesbar: ['front'] })).grund).toBe('konto_gesperrt');
    // auch nicht, wenn es sonst einen echten Ablehngrund gäbe
    expect(entscheideFall(fall({ kontoSperre: 'gesperrt', comp: { ok: false, problems: ['unvollstaendig'], missing: ['preis'] } })).entscheidung).toBe('offen');
    expect(entscheideFall(fall({ kontoSperre: 'gesperrt', dup: { verdict: 'locked', reason: WOCHE, lockUntil: 1 } })).entscheidung).toBe('offen');
  });
  it('Sperrliste nicht lesbar → NIE freigeben, aber auch nicht ablehnen', () => {
    expect(entscheideFall(fall({ kontoSperre: 'unbekannt' }))).toMatchObject({ entscheidung: 'offen', grund: 'kontosperre_unbekannt' });
  });
  it('… echte Mängel werden trotzdem abgelehnt (eine Ablehnung nützt einem gesperrten Konto nichts)', () => {
    expect(entscheideFall(fall({ kontoSperre: 'unbekannt', comp: { ok: false, problems: ['unvollstaendig'], missing: ['preis'] } })).grund).toBe('unvollstaendig');
    expect(entscheideFall(fall({ kontoSperre: 'unbekannt', preisVorhanden: false, audit: { ...echt, preisSichtbar: false } })).grund).toBe('preis_fehlt');
  });
  it('nicht gesperrt (null) → normal', () => {
    expect(entscheideFall(fall({ kontoSperre: null })).entscheidung).toBe('freigeben');
  });
});

describe('Nummer vom Barcode-Foto (Entscheidung Patrick 02.10.2026)', () => {
  const ab = { art: 'abweichend', gelesen: '4000417025005', gespeichert: '4061464833821' };
  it('abweichend → offen ean_abweichend mit Hinweis, nie Freigabe', () => {
    const e = entscheideFall(fall({ eanFoto: ab }));
    expect(e).toMatchObject({ entscheidung: 'offen', grund: 'ean_abweichend' });
    expect(e.ctx.hinweis).toMatch(/4000417025005/);
    expect(entscheideFall(fall({ eanFoto: ab, eanFotoHinweis: 'eigene Freigabe vom 01.10.' })).ctx.hinweis).toMatch(/01\.10\./);
  });
  it('gleich oder kein Urteil → normal weiter', () => {
    expect(entscheideFall(fall({ eanFoto: { art: 'gleich' } })).entscheidung).toBe('freigeben');
    expect(entscheideFall(fall({ eanFoto: { art: 'kein_urteil' } })).entscheidung).toBe('freigeben');
  });
  it('zweite Lesung bestätigt weder die eine noch die andere Nummer → offen ean_unsicher, nie Freigabe (Prüfrunde 02.10.)', () => {
    const e = entscheideFall(fall({ eanFoto: { ...ab, art: 'unsicher', zweit: '4001382088125' } }));
    expect(e).toMatchObject({ entscheidung: 'offen', grund: 'ean_unsicher' });
    expect(e.ctx.hinweis).toMatch(/4001382088125/);
    expect(entscheideFall(fall({ eanFoto: { ...ab, art: 'unsicher', zweit: null } })).ctx.hinweis).toMatch(/nicht lesbar/);
  });
  it('Abweichung geht der Wochen-Sperre VOR: die rechnet mit der womöglich falschen gespeicherten EAN (Prüfrunde 02.10.)', () => {
    const locked = { verdict: 'locked', reason: WOCHE, lockUntil: 1 };
    expect(entscheideFall(fall({ eanFoto: ab, dup: locked }))).toMatchObject({ entscheidung: 'offen', grund: 'ean_abweichend' });
    expect(entscheideFall(fall({ eanFoto: { ...ab, art: 'unsicher' }, dup: locked }))).toMatchObject({ entscheidung: 'offen', grund: 'ean_unsicher' });
    // ohne Zweifel an der Nummer bleibt die Sperre
    expect(entscheideFall(fall({ eanFoto: { art: 'gleich' }, dup: locked })).grund).toBe(WOCHE);
  });
  it('fehlende Fotos gehen vor', () => {
    expect(entscheideFall(fall({ eanFoto: ab, comp: { ok: false, problems: ['unvollstaendig'], missing: ['ean'] } })).grund).toBe('unvollstaendig');
  });
});

describe('Foto-Abgleich gegen alle früheren Einreichungen (Entscheidung Patrick 02.10.2026)', () => {
  const T = 1_000_000;
  const welt = (eintraege) => (id) => (eintraege[id] ? { ...eintraege[id] } : null);

  it('die älteste Einreichung einer Gruppe bekommt nie einen Befund', () => {
    const info = welt({ a: { userId: 'u1', createdAt: T, status: 'approved' }, b: { userId: 'u1', createdAt: T + 1, status: 'pending' } });
    expect(bildBefund('a', ['b'], info)).toBeNull();
  });
  it('ältere eigene Freigabe → wiederverwendet', () => {
    const info = welt({ a: { userId: 'u1', createdAt: T, status: 'approved' }, b: { userId: 'u1', createdAt: T + 1, status: 'pending' } });
    expect(bildBefund('b', ['a'], info)).toEqual({ art: 'wiederverwendet', mit: ['a'] });
  });
  it('ältere eigene noch offen → halten, bis sie entschieden ist', () => {
    const info = welt({ a: { userId: 'u1', createdAt: T, status: 'pending' }, b: { userId: 'u1', createdAt: T + 1, status: 'pending' } });
    expect(bildBefund('b', ['a'], info)).toEqual({ art: 'aeltere_offen', mit: ['a'] });
  });
  it('ältere eigene ABGELEHNT wegen behebbarem Mangel → kein Befund (erlaubte Korrektur, normal prüfen)', () => {
    for (const grund of [undefined, null, 'unvollstaendig', 'ean_fehlt', 'kein_produktname', 'preis_fehlt', 'fotos_unpassend', 'konto_gesperrt']) {
      const info = welt({ a: { userId: 'u1', createdAt: T, status: 'rejected', grund }, b: { userId: 'u1', createdAt: T + 1, status: 'pending' } });
      expect(bildBefund('b', ['a'], info)).toBeNull();
    }
  });
  it('ältere eigene als DOPPEL abgelehnt, das Produkt ist für diese Person bezahlt → wiederverwendet (Fotos einer Woche später erneut einreichen ist kein neuer Einkauf, Prüfrunde 02.10.)', () => {
    const bezahlt = (uid, ean) => uid === 'u1' && ean === 'E1';
    for (const grund of ['sperre_woche_gleicher_nutzer', 'doppelt_eingereicht', 'sperre_30_tage_gleicher_nutzer', 'bilder_wiederverwendet', 'produkt_bereits_verguetet']) {
      expect(DOPPEL_GRUENDE.has(grund)).toBe(true);
      const info = welt({ a: { userId: 'u1', createdAt: T, status: 'rejected', grund, ean: 'E1' }, b: { userId: 'u1', createdAt: T + 8 * 86400000, status: 'pending' } });
      expect(bildBefund('b', ['a'], info, bezahlt)).toEqual({ art: 'wiederverwendet', mit: ['a'] });
    }
    // fremde Doppel-Sperre (Altbestand bis 20.09.) belegt keine eigene Zahlung
    expect(DOPPEL_GRUENDE.has('sperre_30_tage_anderer_nutzer')).toBe(false);
  });
  it('… aber NICHT, wenn keine Kopie je bezahlt wurde (Vorfall 10.09.: alle Kopien abgelehnt) — eine Kopie muss übrig bleiben (Prüfrunde 2)', () => {
    const info = welt({ a: { userId: 'u1', createdAt: T, status: 'rejected', grund: 'doppelt_eingereicht', ean: 'E1' }, b: { userId: 'u1', createdAt: T + 8 * 86400000, status: 'pending' } });
    expect(bildBefund('b', ['a'], info, () => false)).toBeNull();
    // ohne Auskunft über Freigaben zählt eine Doppel-Ablehnung nie als Beleg
    expect(bildBefund('b', ['a'], info)).toBeNull();
    // eine ältere FREIGEGEBENE Kopie in der Gruppe belegt dagegen immer
    const mitFrei = welt({ ...{ a: { userId: 'u1', createdAt: T, status: 'rejected', grund: 'doppelt_eingereicht', ean: 'E1' } }, f: { userId: 'u1', createdAt: T - 1, status: 'approved' }, b: { userId: 'u1', createdAt: T + 8 * 86400000, status: 'pending' } });
    expect(bildBefund('b', ['a', 'f'], mitFrei, () => false)).toEqual({ art: 'wiederverwendet', mit: ['f'] });
  });
  it('fremdes Konto mit identischem Foto → halten für den Menschen, egal welcher Status', () => {
    for (const status of ['approved', 'rejected', 'pending']) {
      const info = welt({ a: { userId: 'u2', createdAt: T, status }, b: { userId: 'u1', createdAt: T + 1, status: 'pending' } });
      expect(bildBefund('b', ['a'], info)).toEqual({ art: 'fremdes_konto', mit: ['a'] });
    }
  });
  it('Gleichstand der Zeit: die kleinere ID gilt als älter — genau eine Kopie bleibt ohne Befund', () => {
    const info = welt({ a: { userId: 'u1', createdAt: T, status: 'approved' }, b: { userId: 'u1', createdAt: T, status: 'approved' } });
    expect(bildBefund('a', ['b'], info)).toBeNull();
    expect(bildBefund('b', ['a'], info)).toMatchObject({ art: 'wiederverwendet' });
  });
  it('Befund im Entscheid: wiederverwendet → ablehnen, aeltere_offen / fremdes_konto → offen', () => {
    expect(entscheideFall(fall({ bild: { art: 'wiederverwendet', mit: ['a'] } })).grund).toBe('bilder_wiederverwendet');
    expect(entscheideFall(fall({ bild: { art: 'aeltere_offen', mit: ['a'] } }))).toMatchObject({ entscheidung: 'offen', grund: 'foto_aeltere_offen' });
    expect(entscheideFall(fall({ bild: { art: 'fremdes_konto', mit: ['a'] } }))).toMatchObject({ entscheidung: 'offen', grund: 'foto_fremdes_konto' });
  });
  it('Doppel derselben Person mit denselben Dateien heißt doppelt, nicht „wiederverwendet" (Text vom 10.09.)', () => {
    const e = entscheideFall(fall({ dup: { verdict: 'locked', reason: WOCHE, lockUntil: 1 }, bild: { art: 'wiederverwendet', mit: ['a'] } }));
    expect(e.grund).toBe(WOCHE);
  });
  it('Abgleich nicht möglich (Storage-Liste gescheitert) → keine Freigabe, aber Ablehnungen bleiben möglich', () => {
    expect(entscheideFall(fall({ fotoAbgleichFehlt: true }))).toMatchObject({ entscheidung: 'offen', grund: 'foto_abgleich_gescheitert' });
    expect(entscheideFall(fall({ fotoAbgleichFehlt: true, comp: { ok: false, problems: ['unvollstaendig'], missing: ['preis'] } })).entscheidung).toBe('ablehnen');
  });
});

describe('Notbremse: neue Gründe mit eigener Bremse (02.10.2026)', () => {
  const frei = (n) => Array.from({ length: n }, () => ({ entscheidung: 'freigeben', grund: null, audit: echt }));
  const ab = (n, grund) => Array.from({ length: n }, () => ({ entscheidung: 'ablehnen', grund, audit: echt }));

  it('Wochen-Sperre zählt nicht in die Gesamtquote', () => {
    expect(AUSSER_GESAMTQUOTE.has(WOCHE)).toBe(true);
    expect(AUSSER_GESAMTQUOTE.has('sperre_30_tage_gleicher_nutzer')).toBe(true);
    expect(AUSSER_GESAMTQUOTE.has('preis_fehlt')).toBe(true);
    // gemessen: 3,3 % Wochen-Sperren — an einem Tag mit 10 weiteren Ablehnungen
    // bei Schnitt 8 % darf die Gesamt-Bremse nicht anspringen
    const p = [...frei(110), ...ab(5, WOCHE), ...ab(9, 'unvollstaendig')];
    expect(notbremse(p, { schnittQuote: 0.08 })).toMatchObject({ gesamt: false, woche: false });
    expect(p.filter((x) => x.entscheidung === 'ablehnen')).toHaveLength(14);
  });
  it('gesperrte Konten brauchen keine Bremse: sie werden nicht abgelehnt', () => {
    expect(AUSSER_GESAMTQUOTE.has('konto_gesperrt')).toBe(false);
    const p = [...frei(10), ...Array.from({ length: 15 }, () => ({ entscheidung: 'offen', grund: 'konto_gesperrt', audit: null }))];
    expect(notbremse(p, { schnittQuote: 0.05 })).toEqual({ bild: false, gesamt: false, preis: false, woche: false, text: [] });
  });
  it('Wochen-Sperre trifft ungewöhnlich viele (≥ 10 und > 15 %) → zurückgehalten', () => {
    const p = [...frei(40), ...ab(12, WOCHE)];
    const b = notbremse(p, { schnittQuote: null });
    expect(b.woche).toBe(true);
    expect(p.filter((x) => x.grund === 'notbremse_wochensperre')).toHaveLength(12);
    expect(p.filter((x) => x.entscheidung === 'freigeben')).toHaveLength(40);
  });
  it('kippt die Gesamtquote, werden auch Wochen-Sperren gehalten', () => {
    const p = [...frei(40), ...ab(20, 'unvollstaendig'), ...ab(2, WOCHE)];
    expect(notbremse(p, { schnittQuote: 0.1 }).gesamt).toBe(true);
    expect(p.filter((x) => x.entscheidung === 'ablehnen')).toHaveLength(0);
  });
});

describe('Belege einer Ablehnung (Prüfrunde 02.10.2026)', () => {
  it('Wochen-Sperre stützt sich auf ALLE eigenen Freigaben im Fenster', () => {
    expect(belegeVon({ entscheidung: 'ablehnen', grund: WOCHE, dup: { priorId: 'a', priorIds: ['a', 'b'] } })).toEqual(['a', 'b']);
    expect(belegeVon({ entscheidung: 'ablehnen', grund: WOCHE, dup: { priorId: 'a' } })).toEqual(['a']);
  });
  it('wiederverwendete Fotos stützen sich auf die älteren Einreichungen mit demselben Foto', () => {
    expect(belegeVon({ entscheidung: 'ablehnen', grund: 'bilder_wiederverwendet', eingabe: { bild: { art: 'wiederverwendet', mit: ['x', 'y'] } } })).toEqual(['x', 'y']);
  });
  it('alles andere hängt an keinem Beleg', () => {
    expect(belegeVon({ entscheidung: 'ablehnen', grund: 'unvollstaendig' })).toBeNull();
    expect(belegeVon({ entscheidung: 'freigeben', grund: null })).toBeNull();
    expect(belegeVon({ entscheidung: 'offen', grund: WOCHE, dup: { priorId: 'a' } })).toBeNull();
  });
});

describe('Halte-Grund für die Prüfkonsole (review.rundeOffen, Prüfrunde 2, 02.10.2026)', () => {
  const plan = (eingabe, extra = {}) => ({ ...entscheideFall(fall(eingabe)), eingabe: fall(eingabe), ...extra });

  it('fremdes Konto → Eintrag mit Grund und sperrendem Befund — OHNE die IDs des fremden Kontos (das Dokument liest der Einreicher)', () => {
    const p = plan({ bild: { art: 'fremdes_konto', mit: ['fremdUid123_s1_0', 'fremdUid123_s2_0'] } });
    expect(p.ctx.hinweis).toMatch(/fremdUid123/); // der Bericht (nur Admins) nennt sie
    const e = rundeOffenEintrag(p, { lauf: 'L' });
    expect(e).toEqual({
      grund: 'foto_fremdes_konto', hinweis: 'Gleiches Foto bei 2 Einreichungen eines anderen Kontos — welche, steht im Tagesbericht', zurueckgehalten: null,
      sperrend: ['foto_fremdes_konto'], fotoSeit: 'L', eanFoto: null, lauf: 'L', trocken: false,
    });
    expect(JSON.stringify(e)).not.toMatch(/fremdUid123/);
    expect(rundeOffenEintrag(plan({ bild: { art: 'fremdes_konto', mit: ['x'] } }), {}).hinweis).toBe('Gleiches Foto bei 1 Einreichung eines anderen Kontos — welche, steht im Tagesbericht');
  });
  it('JEDER Befund wird gemeldet, nicht nur der erste Grund (Barcode geht dem Foto vor, die ältere offene derselben EAN beiden)', () => {
    const ab = { art: 'abweichend', gelesen: '4000417025005', gespeichert: '4061464833821', bestaetigt: true };
    const e = rundeOffenEintrag(plan({ eanFoto: ab, bild: { art: 'aeltere_offen', mit: ['x'] }, dup: { verdict: 'hold', reason: 'doppelt_eingereicht', lockUntil: null } }), { lauf: 'L' });
    expect(e).toMatchObject({ grund: 'ean_abweichend', sperrend: ['foto_aeltere_offen', 'ean_abweichend'], eanFoto: { befund: 'abweichend', ean: '4000417025005', bestaetigt: true } });
  });
  it('unsicher (auch zweifelhaft) → ean_unsicher mit Rückfall-Befund für die nächste Runde', () => {
    expect(rundeBefunde({ eanFoto: { art: 'zweifelhaft' } })).toEqual(['ean_unsicher']);
    const e = rundeOffenEintrag(plan({ eanFoto: { art: 'unsicher', gelesen: null, roh: '123', zweit: '4001382088125', gespeichert: '4061464833821' } }), {});
    expect(e).toMatchObject({ grund: 'ean_unsicher', sperrend: ['ean_unsicher'], eanFoto: { befund: 'unsicher', ean: '123', zweit: '4001382088125' } });
  });
  it('ohne sperrenden Befund: nur Information (Bildprüfung gescheitert, zurückgehalten …)', () => {
    expect(rundeOffenEintrag(plan({ audit: null, auditFehler: '429' }), { lauf: 'L' })).toMatchObject({ grund: 'bild_audit_gescheitert', hinweis: '429', sperrend: [] });
    const zurueck = { entscheidung: 'offen', grund: 'notbremse_quote', zurueckgehaltenGrund: 'fotos_unpassend', ctx: {}, eingabe: fall({}) };
    expect(rundeOffenEintrag(zurueck, {})).toMatchObject({ grund: 'notbremse_quote', zurueckgehalten: 'fotos_unpassend', sperrend: [] });
  });
  it('… eine wegen Notbremse zurückgehaltene Ablehnung wegen wiederverwendeter Fotos bleibt sperrend', () => {
    const p = plan({ bild: { art: 'wiederverwendet', mit: ['a'] } });
    notbremse([p, ...Array.from({ length: 12 }, () => ({ entscheidung: 'ablehnen', grund: 'unvollstaendig' }))], { schnittQuote: 0.02 });
    expect(p).toMatchObject({ entscheidung: 'offen', grund: 'notbremse_quote' });
    expect(rundeOffenEintrag(p, {})).toMatchObject({ zurueckgehalten: 'bilder_wiederverwendet', sperrend: ['bilder_wiederverwendet'] });
  });
  it('Trockenlauf: geplanter Entscheid steht als `geplant`; eine geplante Freigabe ohne Befund hinterlässt nichts', () => {
    expect(rundeOffenEintrag(plan({ bild: { art: 'wiederverwendet', mit: ['a'] } }), { trocken: true })).toMatchObject({ grund: 'bilder_wiederverwendet', geplant: 'ablehnen', trocken: true });
    expect(rundeOffenEintrag(plan({}), { trocken: true })).toBeNull();
  });
  it('gesperrtes Konto → nichts (liegt stumm, die Konsole liest die Sperre selbst)', () => {
    expect(rundeOffenEintrag(plan({ kontoSperre: 'gesperrt', bild: { art: 'fremdes_konto', mit: ['a'] } }), {})).toBeNull();
    expect(rundeOffenEintrag(null, {})).toBeNull();
  });
  it('RUNDE_SPERREND: genau die Befunde, die die Konsole nicht selbst prüfen kann', () => {
    expect([...RUNDE_SPERREND].sort()).toEqual(['bilder_wiederverwendet', 'ean_abweichend', 'ean_unsicher', 'foto_aeltere_offen', 'foto_fremdes_konto']);
  });
  it('entscheideFall: zweifelhaft (sollte nach der zweiten Lesung nie ankommen) hält wie unsicher', () => {
    expect(entscheideFall(fall({ eanFoto: { art: 'zweifelhaft', roh: '4013602313647', gelesen: null, gespeichert: '4250231136474' } })))
      .toMatchObject({ entscheidung: 'offen', grund: 'ean_unsicher' });
  });
});

describe('Foto-Befund eines früheren Laufs (Schlussprüfung 03.10.2026)', () => {
  const ro = (sperrend, extra = {}) => ({ review: { rundeOffen: { grund: sperrend[0] || 'x', sperrend, lauf: '2026-10-03_080000', ...extra } } });

  it('fotoVorbefund: der stärkste Foto-Code aus rundeOffen.sperrend, seit = fotoSeit, sonst Lauf des Eintrags', () => {
    expect(fotoVorbefund(ro(['foto_fremdes_konto']))).toEqual({ art: 'fremdes_konto', seit: '2026-10-03_080000' });
    expect(fotoVorbefund(ro(['foto_aeltere_offen', 'bilder_wiederverwendet'], { fotoSeit: '2026-10-01_080000' }))).toEqual({ art: 'wiederverwendet', seit: '2026-10-01_080000' });
    expect(fotoVorbefund(ro(['ean_abweichend', 'foto_aeltere_offen']))).toMatchObject({ art: 'aeltere_offen' });
    for (const x of [ro([]), ro(['ean_abweichend']), ro(['erfunden']), { review: { rundeOffen: { sperrend: 'foto_fremdes_konto' } } }, { review: {} }, {}, null]) {
      expect(fotoVorbefund(x)).toBeNull();
    }
  });

  const v = (art, seit = 'L1') => ({ art, seit });
  const heute = (art) => ({ art, mit: ['x'] });

  it('ohne früheren Befund → der heutige, unverändert', () => {
    const h = heute('wiederverwendet');
    expect(bildMitVorbefund(h, null, { vollstaendig: true })).toBe(h);
    expect(bildMitVorbefund(null, null, { vollstaendig: false })).toBeNull();
  });
  it('heute vollständig gerechnet: eigene Befunde (aeltere_offen, wiederverwendet) werden NICHT übernommen — die Konsolen-Entscheidung über die ältere löst sie', () => {
    expect(bildMitVorbefund(null, v('aeltere_offen'), { vollstaendig: true })).toBeNull();
    expect(bildMitVorbefund(null, v('wiederverwendet'), { vollstaendig: true })).toBeNull();
    expect(bildMitVorbefund(heute('wiederverwendet'), v('aeltere_offen'), { vollstaendig: true })).toEqual(heute('wiederverwendet'));
    // derselbe Befund wie gestern: bleibt der heutige (mit IDs), seit dem ersten Lauf
    expect(bildMitVorbefund(heute('aeltere_offen'), v('aeltere_offen'), { vollstaendig: true })).toEqual({ art: 'aeltere_offen', mit: ['x'], seit: 'L1' });
  });
  it('fremdes Konto gilt IMMER weiter, bis ein Mensch entscheidet — auch wenn heute vollständig nichts mehr zu finden ist (Original überschrieben)', () => {
    expect(bildMitVorbefund(null, v('fremdes_konto'), { vollstaendig: true })).toEqual({ art: 'fremdes_konto', mit: [], seit: 'L1', vorbefund: { grund: 'bis_zur_entscheidung' }, heute: null });
    // ein heute schwächerer Befund verdrängt ihn nicht, steht aber daneben
    expect(bildMitVorbefund(heute('wiederverwendet'), v('fremdes_konto'), { vollstaendig: true })).toMatchObject({ art: 'fremdes_konto', vorbefund: expect.any(Object), heute: 'wiederverwendet' });
    // heute wieder fremdes Konto → der heutige (frische IDs für den Bericht)
    expect(bildMitVorbefund(heute('fremdes_konto'), v('fremdes_konto'), { vollstaendig: true })).toEqual({ art: 'fremdes_konto', mit: ['x'], seit: 'L1' });
  });
  it('heute NICHT vollständig (Liste gescheitert, Datei fehlt, md5 fehlt): jeder frühere Foto-Befund gilt weiter, ein stärkerer heutiger geht vor', () => {
    for (const art of ['fremdes_konto', 'wiederverwendet', 'aeltere_offen']) {
      expect(bildMitVorbefund(null, v(art), { vollstaendig: false })).toMatchObject({ art, mit: [], seit: 'L1', vorbefund: { grund: art === 'fremdes_konto' ? 'bis_zur_entscheidung' : 'heute_nicht_pruefbar' } });
    }
    expect(bildMitVorbefund(heute('aeltere_offen'), v('wiederverwendet'), { vollstaendig: false })).toMatchObject({ art: 'wiederverwendet', vorbefund: expect.any(Object), heute: 'aeltere_offen' });
    expect(bildMitVorbefund(heute('fremdes_konto'), v('aeltere_offen'), { vollstaendig: false })).toEqual(heute('fremdes_konto'));
    // ohne Angabe gilt „nicht vollständig" (fail-closed)
    expect(bildMitVorbefund(null, v('aeltere_offen'))).toMatchObject({ vorbefund: expect.any(Object) });
  });

  it('entscheideFall: ein übernommener Befund hält nur an — auch „wiederverwendet" wird NIE zur Ablehnung', () => {
    for (const [art, grund] of [['fremdes_konto', 'foto_fremdes_konto'], ['wiederverwendet', 'bilder_wiederverwendet'], ['aeltere_offen', 'foto_aeltere_offen']]) {
      const bild = bildMitVorbefund(null, v(art, '2026-10-02_080000'), { vollstaendig: false });
      const e = entscheideFall(fall({ bild, fotoAbgleichFehlt: true }));
      expect(e).toMatchObject({ entscheidung: 'offen', grund });
      expect(e.ctx.hinweis).toMatch(/Befund vom 2026-10-02_080000/);
    }
    expect(entscheideFall(fall({ bild: bildMitVorbefund(null, v('fremdes_konto'), { vollstaendig: true }) })).ctx.hinweis).toMatch(/gilt bis zur Entscheidung in der Konsole/);
    // Gegenprobe: ein heute berechneter Befund lehnt weiter ab
    expect(entscheideFall(fall({ bild: heute('wiederverwendet') })).entscheidung).toBe('ablehnen');
  });

  it('rundeOffenEintrag: übernommener Befund bleibt sperrend, mit fotoSeit des ersten Laufs, heutigem Zusatzbefund und OHNE IDs', () => {
    const bild = bildMitVorbefund({ art: 'wiederverwendet', mit: ['u1_eigen'] }, { art: 'fremdes_konto', seit: 'L1' }, { vollstaendig: true });
    const eingabe = fall({ bild });
    const e = rundeOffenEintrag({ ...entscheideFall(eingabe), eingabe }, { lauf: 'L2' });
    expect(e).toMatchObject({ grund: 'foto_fremdes_konto', sperrend: ['foto_fremdes_konto', 'bilder_wiederverwendet'], fotoSeit: 'L1', lauf: 'L2' });
    expect(e.hinweis).toMatch(/anderen Konto.*Befund vom L1, gilt bis zur Entscheidung in der Konsole; heute: bilder_wiederverwendet/);
    expect(rundeBefunde(eingabe)).toEqual(['foto_fremdes_konto', 'bilder_wiederverwendet']);
    // fotoSeit nur mit Foto-Befund
    expect(rundeOffenEintrag({ ...entscheideFall(fall({ audit: null, auditFehler: '429' })), eingabe: fall({ audit: null }) }, { lauf: 'L2' }).fotoSeit).toBeUndefined();
  });
});
