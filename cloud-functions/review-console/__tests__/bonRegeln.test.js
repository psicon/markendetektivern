'use strict';
const {
  bearbeitbar, konfliktLage, betragsGrenzen, zwillingsUrteil, datumVergleich, jahrGestuetzt, marktPasst, abgleich,
  wirksameAktionId, budgetUrteil, beanstandungGilt, jahrUnmoeglich, entscheideBon,
} = require('../src/bonRegeln');

// Feld-Gate mit drei Zeugen — der Normalfall seit 19.09.
const fa = (konflikte, zeugen = 3) => ({ ok: konflikte.length === 0, zeugen, konflikte });
// Upload am 24.09.2026 — das Jahr zählt für „gelesenes Jahr liegt in der Zukunft".
const UP = Date.UTC(2026, 8, 24, 8, 0, 0);
const bon = (over = {}) => ({ id: 'b1', userId: 'u1', reviewReason: 'ocr_confidence_low', bonDate: '2026-09-23', bonTotalCents: 9374, cashbackCents: 8, eligibleItemCount: 20, bonTime: '10:45', createdMs: UP, merchant: { id: 'kaufland', name: 'Kaufland' }, campaignIdAngewandt: 'sep', ocrFieldAgreement: fa([]), updatedAt: 5000, ...over });
const zweit = (over = {}) => ({ istKassenbon: true, manipuliert: false, markt: 'Kaufland', datum: '2026-09-23', endsummeCent: 9374, anzahlPositionen: 22, grund: 'klar lesbar', ...over });

describe('bearbeitbar', () => {
  it('nur Konfidenz-Fälle', () => {
    expect(bearbeitbar(bon())).toBe(true);
    expect(bearbeitbar(bon({ reviewReason: 'ocr_confidence_medium' }))).toBe(true);
    ['bon_date_future', 'ocr_unavailable', 'forensics_software', 'ocr_confidence_null', undefined].forEach((r) => expect(bearbeitbar(bon({ reviewReason: r }))).toBe(false));
  });
});

describe('datumVergleich — echte Fehllesungen der Zweitlesung', () => {
  it('gleich', () => expect(datumVergleich('2026-09-23', '2026-09-23')).toBe('gleich'));
  it('nur das Jahr falsch gelesen (19.09.)', () => expect(datumVergleich('2026-09-18', '2020-09-18')).toBe('nur_jahr'));
  it('Tag und Jahr vertauscht (Kaufland 24.09.: 23.09.26 → 2023-09-26)', () => expect(datumVergleich('2026-09-23', '2023-09-26')).toBe('vertauscht'));
  it('anderer Tag / Monat → anders', () => {
    expect(datumVergleich('2026-09-23', '2026-09-21')).toBe('anders');
    expect(datumVergleich('2026-09-23', '2026-08-23')).toBe('anders');
  });
  it('leer oder Unsinn → unlesbar, NICHT „passt"', () => {
    expect(datumVergleich('2026-09-23', '')).toBe('unlesbar');
    expect(datumVergleich('2026-09-23', 'September')).toBe('unlesbar');
  });
  it('andere Schreibweisen desselben Datums werden verstanden', () => {
    expect(datumVergleich('2026-09-23', '2026-9-23')).toBe('gleich');
    expect(datumVergleich('2026-09-23', '23.09.26')).toBe('gleich');
    expect(datumVergleich('2026-09-23', '23.9.2026')).toBe('gleich');
    expect(datumVergleich('2026-09-23', '21.09.2026')).toBe('anders');
  });
});

describe('jahrGestuetzt', () => {
  const mitReads = (daten) => bon({ ocr: { robust: { reads: daten.map((d) => ({ bonDate: d })) } } });
  it('Mehrheit der Erstlesungen hat das andere Jahr (bon_mtsimmybac4knh)', () => {
    expect(jahrGestuetzt(mitReads(['2025-09-10', '2025-09-10', '2025-09-10', '2026-09-10']), '2025-09-10')).toBe(true);
  });
  it('Erstlesungen einig auf gespeichertes Jahr', () => {
    expect(jahrGestuetzt(mitReads(['2026-09-10', '2026-09-10', '2026-09-10']), '2020-09-10')).toBe(false);
  });
  it('keine Einzellesungen → nicht gestützt', () => expect(jahrGestuetzt(bon(), '2020-09-10')).toBe(false));
  it('schon EINE Erstlesung mit dem anderen Jahr reicht', () => {
    expect(jahrGestuetzt(mitReads(['2026-09-10', '2026-09-10', '2025-09-10']), '2025-09-10')).toBe(true);
  });
  it('Datums-Konflikt nur über den Tag, alle Erstlesungen im selben Jahr → kein Jahreszweifel (bon_mu362…)', () => {
    const b = bon({ bonDate: '2026-09-15', ocrFieldAgreement: fa(['bonDate', 'bonTime']), ocr: { robust: { reads: ['2026-09-15', '2026-09-15', '2026-09-19'].map((d) => ({ bonDate: d })) } } });
    expect(abgleich(b, zweit({ datum: '2025-09-15' })).gruende).not.toContain('jahr_unsicher');
  });
});

describe('marktPasst', () => {
  it('Schreibweise egal', () => {
    expect(marktPasst(bon({ merchant: { id: 'netto', name: 'Netto Marken-Discount' } }), 'NETTO Marken-Discount AG & Co. KG')).toBe(true);
    expect(marktPasst(bon({ merchant: { id: 'aldi-sued', name: 'ALDI SÜD' } }), 'Aldi Süd')).toBe(true);
  });
  it('kurze Namen (dm) als ganzes Wort, Rohname vom Bonkopf zählt (Prüfrunde 3)', () => {
    const dm = bon({ merchant: { id: 'dm', name: 'dm', raw: 'dm-drogerie markt' } });
    expect(marktPasst(dm, 'dm-drogerie markt')).toBe(true);
    expect(marktPasst(dm, 'DM DROGERIE MARKT')).toBe(true);
    expect(marktPasst(dm, 'dm')).toBe(true);
    expect(marktPasst(dm, 'Admiral Getränke')).toBe(false);
    const edeka = bon({ merchant: { id: 'edeka', name: 'EDEKA', raw: 'FFFrische-Center Hochner' } });
    expect(marktPasst(edeka, 'HOCHNER FFFRISCHE')).toBe(true);
  });
  it('Gattungs- und Rechtsformwörter machen keine fremde Kette passend (Prüfrunde 4)', () => {
    const rewe = bon({ merchant: { id: 'rewe', name: 'REWE', raw: 'REWE Markt GmbH' } });
    expect(marktPasst(rewe, 'TEDi GmbH & Co. KG')).toBe(false);
    expect(marktPasst(rewe, 'Aral Tankstelle GmbH')).toBe(false);
    expect(marktPasst(rewe, 'Markt')).toBe(false);
    expect(marktPasst(bon({ merchant: { id: 'dm', name: 'dm', raw: 'dm-drogerie markt' } }), 'Müller Drogerie Markt')).toBe(false);
    expect(marktPasst(bon({ merchant: { id: 'rewe', name: 'REWE', raw: 'REWE CENTER' } }), 'E center HERKULES')).toBe(false);
  });
  it('Himmelsrichtungen und andere Ketten in der Lesung (Prüfrunde 5)', () => {
    expect(marktPasst(bon({ merchant: { id: 'aldi-nord', name: 'Aldi Nord' } }), 'Netto Nord')).toBe(false);
    expect(marktPasst(bon({ merchant: { id: 'aldi-nord', name: 'Aldi Nord' } }), 'ALDI Nord')).toBe(true);
    expect(marktPasst(bon({ merchant: { id: 'edeka', name: 'EDEKA', raw: 'EDEKA Schäfer' } }), 'REWE Schäfer OHG')).toBe(false);
    expect(marktPasst(bon({ merchant: { id: 'edeka', name: 'EDEKA', raw: "Joh's R E W E CENTER" } }), "Joh's R E W E CENTER")).toBe(false);
    expect(marktPasst(bon({ merchant: { id: 'rewe', name: 'REWE', raw: "Joh's R E W E CENTER" } }), 'R E W E Center')).toBe(true);
  });
  it('„E center" ist EDEKA', () => {
    expect(marktPasst(bon({ merchant: { id: 'edeka', name: 'EDEKA', raw: 'E center' } }), 'E center')).toBe(true);
    expect(marktPasst(bon({ merchant: { id: 'edeka', name: 'EDEKA', raw: 'E-Center' } }), 'E-Center Mustermann')).toBe(true);
  });
  it('ein gemeinsamer Vorname im Rohnamen reicht nicht', () => {
    expect(marktPasst(bon({ merchant: { id: 'lidl', name: 'Lidl', raw: 'Michael Seidl e.K.' } }), 'Michael Brücken Kaufpark')).toBe(false);
    expect(marktPasst(bon({ merchant: { id: 'lidl', name: 'Lidl', raw: 'Michael Seidl e.K.' } }), 'Michael Seidl e.K.')).toBe(true);
    expect(marktPasst(bon({ merchant: { id: 'edeka', name: 'EDEKA', raw: 'Edeka Michael Müller' } }), 'REWE Michael Schmidt')).toBe(false);
  });
  it('anderer Markt / leer / zu kurz → nein', () => {
    expect(marktPasst(bon(), 'Lidl')).toBe(false);
    expect(marktPasst(bon(), '')).toBe(false);
    expect(marktPasst(bon(), 'K')).toBe(false);
  });
});

describe('abgleich', () => {
  it('alles stimmig', () => expect(abgleich(bon(), zweit())).toEqual({ ok: true, gruende: [] }));
  it('Summe weicht > 1 € ab', () => expect(abgleich(bon(), zweit({ endsummeCent: 9900 })).gruende).toContain('summe_widerspricht'));
  it('Summe weicht ≤ 1 € ab → ok', () => expect(abgleich(bon(), zweit({ endsummeCent: 9400 })).ok).toBe(true));
  it('kein Bon / Bearbeitung', () => {
    expect(abgleich(bon(), zweit({ istKassenbon: false })).gruende).toContain('kein_kassenbon');
    expect(abgleich(bon(), zweit({ manipuliert: true })).gruende).toContain('manipulationsverdacht');
  });
  it('leere Zweitlesung ist kein ok', () => expect(abgleich(bon(), {}).ok).toBe(false));
  it('NUR istKassenbon gelesen → nicht bestätigt (Prüfrunde 24.09.)', () => {
    const a = abgleich(bon(), { istKassenbon: true });
    expect(a.ok).toBe(false);
    expect(a.gruende).toEqual(expect.arrayContaining(['datum_nicht_gelesen', 'summe_nicht_gelesen']));
  });
  it('Endsumme 0 → nicht bestätigt (bon_mu3v9…, mehrseitige Rechnung)', () => {
    expect(abgleich(bon(), zweit({ endsummeCent: 0 })).gruende).toContain('summe_nicht_gelesen');
  });
  it('gespeicherte Endsumme fehlt → nicht bestätigt', () => {
    expect(abgleich(bon({ bonTotalCents: undefined }), zweit()).gruende).toContain('summe_nicht_gelesen');
  });
  it('nur Jahr anders und nichts spricht dagegen → ok', () => expect(abgleich(bon(), zweit({ datum: '2020-09-23' })).ok).toBe(true));
  it('gelesenes Jahr liegt nach dem Upload → immer Fehllesung, auch bei Datums-Konflikt (bon_mu362…: 2028)', () => {
    expect(jahrUnmoeglich(bon(), '2028-09-23')).toBe(true);
    expect(jahrUnmoeglich(bon(), '2025-09-23')).toBe(false);
    expect(abgleich(bon({ ocrFieldAgreement: fa(['bonDate']) }), zweit({ datum: '2028-09-23' })).ok).toBe(true);
  });
  it('nur Jahr anders, aber Pipeline hat das Datum korrigiert → jahr_unsicher', () => {
    expect(abgleich(bon({ bonDateCorrection: { from: '2025-09-23' } }), zweit({ datum: '2025-09-23' })).gruende).toContain('jahr_unsicher');
  });
  it('Vorjahres-Korrektur der Pipeline hält IMMER an — auch wenn die Zweitlesung das Upload-Jahr oder ein unmögliches liest', () => {
    const b = bon({ bonDate: '2026-09-23', bonDateCorrection: { from: '2025-09-23', to: '2026-09-23', reason: 'year_misread_same_day' } });
    expect(abgleich(b, zweit({ datum: '2026-09-23' })).gruende).toContain('jahr_unsicher');
    expect(abgleich(b, zweit({ datum: '2028-09-23' })).gruende).toContain('jahr_unsicher');
  });
  it('Datum in deutscher Schreibweise zählt auch für die Jahresprüfung (Prüfrunde 5)', () => {
    const b = bon({ ocrFieldAgreement: fa(['bonDate']), ocr: { robust: { reads: [{ bonDate: '2026-09-23' }, { bonDate: '2025-09-23' }] } } });
    expect(abgleich(b, zweit({ datum: '23.09.25' })).gruende).toContain('jahr_unsicher');
    expect(abgleich(bon(), zweit({ datum: '23.09.28' })).ok).toBe(true); // Zukunftsjahr = Fehllesung
  });
  it('Korrektur 2020 → 2026, Zweitlesung liest ein drittes Jahr → Zweifel', () => {
    const b = bon({ bonDateCorrection: { from: '2020-09-23', to: '2026-09-23' } });
    expect(abgleich(b, zweit({ datum: '2025-09-23' })).gruende).toContain('jahr_unsicher');
  });
  it('Korrektur aus einem Zukunftsjahr (2028 → 2026) ist eine Fehllesung und hält nicht an', () => {
    const b = bon({ bonDateCorrection: { from: '2028-09-23', to: '2026-09-23' } });
    expect(abgleich(b, zweit()).ok).toBe(true);
  });
  it('alte Korrektur (2020 → 2026) erklärt dieselbe Fehllesung der Zweitlesung', () => {
    const b = bon({ bonDateCorrection: { from: '2020-09-23', to: '2026-09-23' }, ocr: { robust: { reads: [{ bonDate: '2020-09-23' }, { bonDate: '2020-09-23' }] } } });
    expect(abgleich(b, zweit({ datum: '2020-09-23' })).ok).toBe(true);
  });
  it('nur Jahr anders bei Datums-Konflikt im Feld-Gate → jahr_unsicher', () => {
    expect(abgleich(bon({ ocrFieldAgreement: fa(['bonDate']) }), zweit({ datum: '2025-09-23' })).gruende).toContain('jahr_unsicher');
  });
  describe('Konflikte des Feld-Gates werden strenger geprüft', () => {
    it('Summe uneinig → 2 ct statt 1 €', () => {
      expect(abgleich(bon({ ocrFieldAgreement: fa(['totalCents']) }), zweit({ endsummeCent: 9400 })).gruende).toContain('summe_widerspricht');
      expect(abgleich(bon({ ocrFieldAgreement: fa(['totalCents']) }), zweit({ endsummeCent: 9375 })).ok).toBe(true);
    });
    it('Markt uneinig → Zweitlesung muss den Markt bestätigen', () => {
      expect(abgleich(bon({ ocrFieldAgreement: fa(['markt']) }), zweit({ markt: 'Lidl' })).gruende).toContain('markt_widerspricht');
      expect(abgleich(bon({ ocrFieldAgreement: fa(['markt']) }), zweit()).ok).toBe(true);
    });
    it('Betrag uneinig → Mensch', () => {
      expect(abgleich(bon({ ocrFieldAgreement: fa(['betrag']) }), zweit()).gruende).toContain('betrag_uneinig');
    });
    it('ohne Konflikt wird der Markt nicht verglichen (schon über den Katalog aufgelöst)', () => {
      expect(abgleich(bon(), zweit({ markt: 'Kaufland Filiale 1234 Hamburg' })).ok).toBe(true);
    });
  });
});

describe('zwillingsUrteil', () => {
  const t = (over) => ({ id: 't1', userId: 'u1', status: 'approved', bonTime: '10:45', createdMs: UP - 500, fields: ['contentHash'], ...over });
  it('eigener, schon entschiedener Zwilling → Doppel derselben Person', () => {
    expect(zwillingsUrteil(bon(), [t()])).toMatchObject({ entscheidung: 'ablehnen', grund: 'duplicate_content_self', duplicateOf: 't1' });
  });
  it('eigener JÜNGERER Zwilling noch offen (review/ocr_pending) → dieser Bon ist das Original', () => {
    expect(zwillingsUrteil(bon(), [t({ status: 'review', createdMs: UP + 1000 })])).toBeNull();
    expect(zwillingsUrteil(bon(), [t({ status: 'ocr_pending', createdMs: UP + 1000 })])).toBeNull();
  });
  it('eigener ÄLTERER Zwilling noch offen → nicht ablehnen, liegen lassen', () => {
    expect(zwillingsUrteil(bon(), [t({ status: 'review', createdMs: UP - 500 })])).toMatchObject({ entscheidung: 'offen', grund: 'zwilling_unentschieden' });
  });
  it('fremder entschiedener Zwilling mit gleicher Transaktion → Doppel über Konten', () => {
    expect(zwillingsUrteil(bon(), [t({ userId: 'u2', fields: ['transactionHash'] })])).toMatchObject({ grund: 'duplicate_content_cross_user' });
  });
  it('fremder Zwilling mit gleicher Transaktion, noch in Prüfung → nie ablehnen (sonst gegenseitig beide weg)', () => {
    expect(zwillingsUrteil(bon(), [t({ userId: 'u2', status: 'review', createdMs: UP + 1000, fields: ['transactionHash'] })])).toBeNull();
    expect(zwillingsUrteil(bon(), [t({ userId: 'u2', status: 'review', createdMs: UP - 500, fields: ['transactionHash'] })])).toMatchObject({ entscheidung: 'offen', grund: 'zwilling_unentschieden' });
  });
  it('fremder Zwilling nur mit gleichem Inhalt → Mensch', () => {
    expect(zwillingsUrteil(bon(), [t({ userId: 'u2' })])).toMatchObject({ entscheidung: 'offen', grund: 'inhalt_wie_bon_anderer_person' });
  });
  it('reiner Artikel-Treffer mit großem Uhrzeit-Abstand zählt nicht', () => {
    expect(zwillingsUrteil(bon(), [t({ fields: ['itemsHash'], bonTime: '18:00' })])).toBeNull();
  });
  it('… außer die Uhrzeit ist unsicher gelesen → Mensch', () => {
    expect(zwillingsUrteil(bon(), [t({ fields: ['itemsHash'], bonTime: '18:00' })], { zeitUnsicher: true })).toMatchObject({ entscheidung: 'offen', grund: 'zwilling_unsicher' });
  });
  it('reiner Artikel-Treffer ohne Uhrzeit → zählt (sicherheitshalber, wie Pipeline)', () => {
    expect(zwillingsUrteil(bon({ bonTime: null }), [t({ fields: ['itemsHash'], bonTime: '18:00' })])).toMatchObject({ grund: 'duplicate_content_self' });
  });
  it('abgelehnter Zwilling zählt nicht (nicht live)', () => {
    expect(zwillingsUrteil(bon(), [t({ status: 'rejected' })])).toBeNull();
  });
  it('fremde Kopie mit gleichem Markt/Tag/Endsumme (contentHash), andere Uhrzeit → Mensch (CLAUDE.md 02.09.)', () => {
    expect(zwillingsUrteil(bon(), [t({ userId: 'u2', bonTime: '18:02', fields: ['contentHash'] })])).toMatchObject({ entscheidung: 'offen', grund: 'inhalt_wie_bon_anderer_person' });
  });
});

describe('Budget', () => {
  it('wirksame Aktion: angewandte vor gewählter, null ist eine Antwort', () => {
    expect(wirksameAktionId({ campaignId: 'aug', campaignIdAngewandt: 'sep' })).toBe('sep');
    expect(wirksameAktionId({ campaignId: 'aug', campaignIdAngewandt: null })).toBeNull();
    expect(wirksameAktionId({ campaignId: 'aug' })).toBe('aug');
  });
  it('reicht → null', () => expect(budgetUrteil(bon(), { budgetRemainingCents: 500 })).toBeNull());
  it('ohne Budgetfeld → wie im Resolver 0, also offen (nicht „unbegrenzt")', () => {
    expect(budgetUrteil(bon(), {})).toMatchObject({ grund: 'budget_leer' });
  });
  it('leer oder zu knapp → offen, nicht endgültig „ohne Prämie"', () => {
    expect(budgetUrteil(bon(), { budgetRemainingCents: 0 })).toMatchObject({ entscheidung: 'offen', grund: 'budget_leer' });
    expect(budgetUrteil(bon({ cashbackCents: 8 }), { budgetRemainingCents: 5 })).toMatchObject({ grund: 'budget_leer' });
  });
  it('keine Aktion → offen', () => {
    expect(budgetUrteil(bon({ campaignIdAngewandt: null }), null)).toMatchObject({ grund: 'keine_aktion' });
    expect(budgetUrteil(bon(), null)).toMatchObject({ grund: 'keine_aktion' });
  });
});

describe('schwache Lesungslage (weniger als zwei stimmige Lesungen)', () => {
  it('kein Vermerk / < 2 Zeugen / none → alle Felder gelten als uneinig', () => {
    expect(konfliktLage(bon({ ocrFieldAgreement: null })).schwach).toBe(true);
    expect(konfliktLage(bon({ ocrFieldAgreement: fa([], 1) })).schwach).toBe(true);
    expect(konfliktLage(bon({ reviewReason: 'ocr_confidence_none' })).schwach).toBe(true);
    expect(konfliktLage(bon({ ocrFieldAgreement: fa([], 1) })).konflikte).toEqual(expect.arrayContaining(['markt', 'bonDate', 'totalCents', 'bonTime']));
    expect(konfliktLage(bon()).schwach).toBe(false);
  });
  const schwach = (over = {}) => bon({ ocrFieldAgreement: fa([], 1), ...over });
  it('stimmig und weit weg von jeder Grenze → freigeben', () => {
    expect(entscheideBon({ bon: schwach(), zweit: zweit(), grenzen: [4, 8] }).entscheidung).toBe('freigeben');
  });
  it('Summe streng (±2 ct)', () => expect(abgleich(schwach(), zweit({ endsummeCent: 9400 })).gruende).toContain('summe_widerspricht'));
  it('Artikelzahl knapp über einer Grenze → Mensch (bon_mufb80qgcrfg8k: 6 bei Mindestzahl 6)', () => {
    expect(abgleich(schwach({ eligibleItemCount: 6 }), zweit({ anzahlPositionen: 8 }), { grenzen: [6] }).gruende).toContain('artikelzahl_knapp');
    expect(abgleich(schwach({ eligibleItemCount: 9 }), zweit({ anzahlPositionen: 10 }), { grenzen: [4, 8] }).gruende).toContain('artikelzahl_knapp');
    expect(abgleich(schwach({ eligibleItemCount: 12 }), zweit({ anzahlPositionen: 13 }), { grenzen: [4, 8] }).ok).toBe(true);
  });
  // Haikus erste Lesung aus der Pipeline (ohne Artikelnamen), Felder wie am Bon.
  const mitHaiku = (h = {}, robust = {}) => schwach({ eligibleItemCount: 6, ocr: { robust: { zeuge: { ersterLeser: 'claude-haiku-5-5', ersteLesung: { summe: 9374, artikel: 6, summenprobe: true, ...h } }, ...robust } } });
  it('Artikelzahl knapp, aber Haiku zählte dieselbe Zahl (Summenprobe ok, gleiche Summe) → freigeben (15.10.2026)', () => {
    expect(entscheideBon({ bon: mitHaiku(), zweit: zweit({ anzahlPositionen: 8 }), grenzen: [6] }))
      .toEqual({ entscheidung: 'freigeben', grund: null, hinweis: 'Artikelzahl 6: Haiku zählte gleich' });
  });
  it('… nicht bei anderer Zahl (auch nicht bei gleicher Stufe), ohne Summenprobe, anderer Summe oder wenn Haikus Lesung selbst gilt', () => {
    const knapp = (b) => abgleich(b, zweit({ anzahlPositionen: 8 }), { grenzen: [6] });
    [mitHaiku({ artikel: 7 }), mitHaiku({ artikel: 5 }), mitHaiku({ summenprobe: false }), mitHaiku({ summenprobe: undefined }),
      mitHaiku({ summe: 9375 }), mitHaiku({ summe: null }), mitHaiku({ artikel: undefined }), mitHaiku({}, { ersterLeser: 'claude-haiku-5-5' }),
      schwach({ eligibleItemCount: 6, ocr: { robust: { zeuge: { status: 'nicht_gefragt', grund: 'summenprobe' } } } }),
    ].forEach((b) => {
      const a = knapp(b);
      expect(a.gruende).toContain('artikelzahl_knapp');
      expect(a.artikelzahlHaiku).toBeUndefined();
    });
  });
  it('… ein Widerspruch der Zweitlesung bleibt beim Menschen, auch wenn Haiku gleich zählte', () => {
    expect(abgleich(mitHaiku(), zweit({ anzahlPositionen: 5 }), { grenzen: [6] }).gruende).toEqual(['artikelzahl_widerspricht']);
  });
  it('… weit weg von jeder Grenze ändert Haiku nichts (kein Hinweis)', () => {
    const b = { ...mitHaiku({ artikel: 20 }), eligibleItemCount: 20 };
    expect(entscheideBon({ bon: b, zweit: zweit(), grenzen: [6] })).toEqual({ entscheidung: 'freigeben', grund: null });
  });
  it('Zweitlesung fällt unter eine Grenze, die die gespeicherte Zahl erreicht → Widerspruch', () => {
    expect(abgleich(schwach({ eligibleItemCount: 9 }), zweit({ anzahlPositionen: 5 }), { grenzen: [6] }).gruende).toContain('artikelzahl_widerspricht');
  });
  it('… weit weg von jeder Grenze ändert eine Abweichung nichts (Prüfrunde 3: 59 vs. 57, 53 vs. 39 bei Grenze 6)', () => {
    expect(abgleich(schwach({ eligibleItemCount: 59 }), zweit({ anzahlPositionen: 57 }), { grenzen: [6] }).ok).toBe(true);
    expect(abgleich(schwach({ eligibleItemCount: 53 }), zweit({ anzahlPositionen: 39 }), { grenzen: [6] }).ok).toBe(true);
  });
  it('keine Zeilen gelesen → nicht gelesen', () => {
    expect(abgleich(schwach(), zweit({ anzahlPositionen: 0 }), { grenzen: [4] }).gruende).toContain('artikelzahl_nicht_gelesen');
  });
  it('nur Jahr falsch gelesen → bei schwacher Lage nicht mehr tolerant', () => {
    expect(abgleich(schwach(), zweit({ datum: '2020-09-23' })).gruende).toContain('jahr_unsicher');
  });
  it('bei guter Lage wird die Artikelzahl nicht verglichen', () => {
    expect(abgleich(bon({ eligibleItemCount: 6 }), zweit({ anzahlPositionen: 0 }), { grenzen: [6] }).ok).toBe(true);
  });
});

describe('betragsGrenzen', () => {
  it('Aktion mit Stufen', () => expect(betragsGrenzen({ minItems: 6, tiers: [{ minItems: 6 }, { minItems: 12 }] }, {})).toEqual([6, 12]));
  it('Aktion mit festem Betrag → nur die Mindestzahl', () => expect(betragsGrenzen({ minItems: 5, cashbackPerBonCents: 8 }, { tiers: [{ minItems: 4 }, { minItems: 8 }] })).toEqual([5]));
  it('ohne Aktion → Konfiguration', () => expect(betragsGrenzen(null, { minItemsForPayout: 4, tiers: [{ minItems: 4 }, { minItems: 8 }] })).toEqual([4, 8]));
});

describe('entscheideBon', () => {
  it('stimmig → freigeben', () => expect(entscheideBon({ bon: bon(), zweit: zweit() }).entscheidung).toBe('freigeben'));
  it('Prüfgrund außerhalb Konfidenz → offen', () => expect(entscheideBon({ bon: bon({ reviewReason: 'bon_date_future' }), zweit: zweit() }).entscheidung).toBe('offen'));
  it('Zweitlesung gescheitert → offen, nie freigeben, als Technik markiert', () => {
    expect(entscheideBon({ bon: bon(), zweitFehler: '429' })).toMatchObject({ entscheidung: 'offen', grund: 'zweitlesung_gescheitert', technik: true });
    expect(entscheideBon({ bon: bon(), zweitFehler: 'kein Bildpfad' }).technik).toBe(false);
  });
  it('Bild nicht dekodierbar → bild_defekt mit Merker-Grund, keine Technik', () => {
    expect(entscheideBon({ bon: bon(), zweitFehler: '400 INVALID_ARGUMENT: Failed to decode image data' })).toMatchObject({ entscheidung: 'offen', grund: 'bild_defekt', gruende: ['bild_defekt'] });
  });
  it('anderer 400 von Google (Modell-Änderung) → Technik, kein „Bild defekt"', () => {
    const e = entscheideBon({ bon: bon(), zweitFehler: '400 INVALID_ARGUMENT: Thinking level is not supported for this model' });
    expect(e).toMatchObject({ grund: 'zweitlesung_gescheitert', technik: true });
    expect(e.gruende).toBeUndefined();
  });
  it('Widerspruch → offen, mit allen Gründen', () => {
    expect(entscheideBon({ bon: bon(), zweit: zweit({ datum: '2026-09-01', istKassenbon: false }) })).toMatchObject({ entscheidung: 'offen', grund: 'kein_kassenbon', gruende: ['kein_kassenbon', 'datum_widerspricht'] });
  });
  it('früher schon widersprochen → bleibt liegen, auch wenn die neue Lesung passt', () => {
    expect(entscheideBon({ bon: bon({ bonRundeBeanstandet: { tag: '2026-09-24', gruende: ['kein_kassenbon'], updatedAtMs: 5000 } }), zweit: zweit() })).toMatchObject({ entscheidung: 'offen', grund: 'frueher_beanstandet' });
  });
  it('… aber nicht mehr, wenn der Bon seitdem neu verarbeitet wurde', () => {
    const b = bon({ updatedAt: 9000, bonRundeBeanstandet: { tag: '2026-09-24', gruende: ['kein_kassenbon'], updatedAtMs: 5000 } });
    expect(beanstandungGilt(b)).toBe(false);
    expect(entscheideBon({ bon: b, zweit: zweit() }).entscheidung).toBe('freigeben');
  });
  it('kein Betrag → offen (die Runde entscheidet nie „ohne Prämie")', () => {
    expect(entscheideBon({ bon: bon({ cashbackCents: 0, eligibleItemCount: 3 }), zweit: zweit() })).toMatchObject({ entscheidung: 'offen', grund: 'kein_betrag' });
  });
  it('Doppel geht vor allem anderen', () => {
    const z = { entscheidung: 'ablehnen', grund: 'duplicate_content_self', duplicateOf: 'x', priorStatus: 'approved' };
    expect(entscheideBon({ bon: bon(), zwilling: z, zweit: zweit() })).toBe(z);
  });
});
