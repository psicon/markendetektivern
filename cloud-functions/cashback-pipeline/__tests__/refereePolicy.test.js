'use strict';
const { shouldRequestReferee, decideReferee, refereeFingerprint, refereeMode, infraVerhindert, einheitlicheUhrzeit } = require('../lib/refereePolicy');

/** Ein abgelehnter, unsicher gelesener Bon — Ausgangslage für die Zweitprüfung. */
const fall = (over = {}) => ({
  mode: true,
  status: 'rejected',
  rejectReason: 'reconciliation_delta',
  confidence: 'none',
  reads: [],
  parsed: { merchant: 'NETTO', bonDate: '2026-09-10' },
  reviewDecision: null,
  alreadyCredited: false,
  hasRequest: false,
  hasReferee: false,
  ...over,
});

/** Fingerabdruck einer in sich stimmigen Schiedsrichter-Lesung. */
const zeuge = (over = {}) => ({
  isReceipt: true,
  merchant: 'NETTO',
  bonCountry: 'DE',
  bonDate: '2026-09-10',
  bonTime: '18:02',
  totalCents: 3787,
  subtotalCents: 3987,
  itemCount: 10,
  eligibleItems: 10,
  reconOk: true,
  reconDirection: 'basket_discount',
  basketDiscountCents: 200,
  bonComplete: true,
  model: 'gemini-3.1-pro-preview',
  finishReason: 'STOP',
  ...over,
});

describe('refereeMode — nur true und shadow schalten ein', () => {
  test.each([[true, true], ['shadow', 'shadow'], [false, false], [undefined, false], ['true', false], [1, false]])(
    '%p → %p',
    (ein, aus) => expect(refereeMode(ein)).toBe(aus),
  );
});

describe('shouldRequestReferee — wann das stärkere Modell nachliest', () => {
  test('unsichere Summenprobe: anfordern (auch im Beobachtungs-Modus)', () => {
    expect(shouldRequestReferee(fall()).request).toBe(true);
    expect(shouldRequestReferee(fall({ mode: 'shadow' })).request).toBe(true);
    expect(shouldRequestReferee(fall({ confidence: 'low', rejectReason: 'no_bon_date' })).request).toBe(true);
  });

  test('Schalter aus: nie', () => {
    expect(shouldRequestReferee(fall({ mode: false }))).toEqual({ request: false, grund: 'abgeschaltet' });
    expect(shouldRequestReferee(fall({ mode: undefined })).request).toBe(false);
  });

  test('nur abgelehnte Bons mit Lesegrund', () => {
    expect(shouldRequestReferee(fall({ status: 'approved' })).request).toBe(false);
    expect(shouldRequestReferee(fall({ status: 'review' })).request).toBe(false);
    // Duplikate, Deckel, Budget sind keine Lesefrage.
    for (const r of ['duplicate_content_self', 'duplicate_content_cross_user', 'below_min_items', 'max_retries_exceeded']) {
      expect(shouldRequestReferee(fall({ rejectReason: r })).grund).toBe('kein_lesegrund');
    }
  });

  test('sichere Lesung: nicht anfordern', () => {
    expect(shouldRequestReferee(fall({ confidence: 'high' })).grund).toBe('lesung_sicher');
    expect(shouldRequestReferee(fall({ confidence: 'medium' })).grund).toBe('lesung_sicher');
    // Rückfall-Engines ohne Bewertung (cv-hybrid, DocAI) laufen nicht in die Prüfung.
    expect(shouldRequestReferee(fall({ confidence: null })).grund).toBe('lesung_sicher');
  });

  test('ein Mensch hat entschieden oder es wurde schon gutgeschrieben: nie', () => {
    expect(shouldRequestReferee(fall({ reviewDecision: 'reject' })).grund).toBe('mensch_entschied');
    expect(shouldRequestReferee(fall({ alreadyCredited: true })).grund).toBe('schon_gutgeschrieben');
  });

  test('Schleifensperre: höchstens eine Prüfung pro Bon', () => {
    expect(shouldRequestReferee(fall({ hasRequest: true })).grund).toBe('schon_geprueft');
    expect(shouldRequestReferee(fall({ hasReferee: true })).grund).toBe('schon_geprueft');
  });

  describe('unknown_merchant', () => {
    const base = { rejectReason: 'unknown_merchant', confidence: 'low' };
    test('überall derselbe Name (Katalogfrage) → nicht anfordern', () => {
      const reads = [{ merchant: 'ROSSMANN' }, { merchant: 'Rossmann' }, { merchant: null }];
      expect(shouldRequestReferee(fall({ ...base, parsed: { merchant: 'ROSSMANN' }, reads })).grund).toBe('markt_stabil');
    });
    test('kein Markt gelesen → anfordern', () => {
      expect(shouldRequestReferee(fall({ ...base, parsed: { merchant: null } })).grund).toBe('markt_nicht_gelesen');
    });
    test('Lesungen uneinig → anfordern', () => {
      const reads = [{ merchant: 'NTO' }, { merchant: 'Netto' }];
      expect(shouldRequestReferee(fall({ ...base, parsed: { merchant: 'NTO' }, reads })).grund).toBe('markt_uneinig');
    });
    test('Lesungen, die gar keinen Bon sahen, zählen nicht als Widerspruch', () => {
      const reads = [{ merchant: 'ACTION' }, { merchant: 'Irgendwas', isReceipt: false }];
      expect(shouldRequestReferee(fall({ ...base, parsed: { merchant: 'ACTION' }, reads })).request).toBe(false);
    });
  });

  describe('bon_too_old', () => {
    const base = { rejectReason: 'bon_too_old', confidence: 'low' };
    test('Datum auf allen Lesungen gleich → nicht anfordern', () => {
      const reads = [{ bonDate: '2026-07-28' }, { bonDate: '2026-07-28' }];
      expect(shouldRequestReferee(fall({ ...base, reads })).grund).toBe('datum_stabil');
    });
    test('korrigiertes parsed-Datum erzeugt keinen künstlichen Widerspruch', () => {
      const reads = [{ bonDate: '2020-07-28' }, { bonDate: '2020-07-28' }];
      expect(shouldRequestReferee(fall({ ...base, parsed: { bonDate: '2026-07-28' }, reads })).request).toBe(false);
    });
    test('Lesungen mit verschiedenen Daten → anfordern', () => {
      const reads = [{ bonDate: '2026-07-28' }, { bonDate: '2026-09-08' }];
      expect(shouldRequestReferee(fall({ ...base, reads })).grund).toBe('datum_uneinig');
      expect(shouldRequestReferee(fall({ ...base, reads, einDatumInFrist: true })).request).toBe(true);
    });
    test('uneinig, aber kein gelesenes Datum in der Frist → nicht anfordern (kann nichts ändern)', () => {
      const reads = [{ bonDate: '2026-06-28' }, { bonDate: '2026-07-08' }];
      expect(shouldRequestReferee(fall({ ...base, reads, einDatumInFrist: false })).grund).toBe('kein_datum_in_frist');
    });
  });

  describe('not_a_receipt', () => {
    const base = { rejectReason: 'not_a_receipt' };
    test('weder Markt noch Datum auf irgendeiner Lesung → nicht anfordern', () => {
      const reads = [{ isReceipt: false, merchant: null, bonDate: null }, { isReceipt: false, merchant: null, bonDate: null }];
      expect(shouldRequestReferee(fall({ ...base, parsed: { isReceipt: false }, reads })).grund).toBe('kein_bon_merkmal');
    });
    test('eine Lesung fand einen Markt → anfordern', () => {
      const reads = [{ isReceipt: false, merchant: null }, { isReceipt: true, merchant: 'REWE' }];
      expect(shouldRequestReferee(fall({ ...base, parsed: { isReceipt: false }, reads })).grund).toBe('bon_merkmal_gelesen');
    });
  });
});

describe('decideReferee — zwei übereinstimmende Zeugen entscheiden', () => {
  test('zwei stimmige, gleiche Lesungen → entschieden, erste gewählt', () => {
    const r = decideReferee([zeuge(), zeuge({ itemCount: 11 })]);
    expect(r).toMatchObject({ decided: true, chosenIndex: 0, grund: 'zwei_lesungen_einig', zeugen: 2 });
  });

  test('eine Lesung allein entscheidet nie', () => {
    expect(decideReferee([zeuge()])).toMatchObject({ decided: false, grund: 'zu_wenige_zeugen', zeugen: 1 });
  });

  test('abgeschnittener Bon ist kein Zeuge, auch wenn die Summe aufgeht', () => {
    const r = decideReferee([zeuge({ bonComplete: false }), zeuge({ bonComplete: false })]);
    expect(r).toMatchObject({ decided: false, grund: 'zu_wenige_zeugen', zeugen: 0 });
  });

  test('ohne Summenprobe, Datum oder Markt kein Zeuge', () => {
    expect(decideReferee([zeuge({ reconOk: false }), zeuge()]).decided).toBe(false);
    expect(decideReferee([zeuge({ bonDate: null }), zeuge()]).decided).toBe(false);
    expect(decideReferee([zeuge({ merchant: '  ' }), zeuge()]).decided).toBe(false);
    expect(decideReferee([zeuge({ isReceipt: false }), zeuge()]).decided).toBe(false);
  });

  test('unklare Vollständigkeit (null) schließt nicht aus', () => {
    expect(decideReferee([zeuge({ bonComplete: null }), zeuge({ bonComplete: null })]).decided).toBe(true);
  });

  test('verschiedene Endsummen → uneinig, Konflikt benannt', () => {
    const r = decideReferee([zeuge(), zeuge({ totalCents: 3788 })]);
    expect(r).toMatchObject({ decided: false, grund: 'felder_uneinig' });
    expect(r.konflikte).toContain('totalCents');
  });

  test('eine abweichende Lesung macht zwei übereinstimmende nicht ungültig', () => {
    const r = decideReferee([zeuge({ bonDate: '2026-09-01' }), zeuge(), zeuge()]);
    expect(r).toMatchObject({ decided: true, chosenIndex: 1 });
  });

  test('Markt über den Resolver-Schlüssel, nicht über den Rohtext', () => {
    const merchantKey = (m) => (/netto|nto/i.test(m) ? 'id:netto' : `roh:${m}`);
    expect(decideReferee([zeuge({ merchant: 'NETTO Marken-Discount' }), zeuge({ merchant: 'NTO' })], { merchantKey }).decided).toBe(true);
    expect(decideReferee([zeuge({ merchant: 'NETTO Marken-Discount' }), zeuge({ merchant: 'NTO' })]).decided).toBe(false);
  });

  test('anrechenbare Artikel müssen EXAKT gleich sein (Aktion steht erst später fest)', () => {
    expect(decideReferee([zeuge({ eligibleItems: 4 }), zeuge({ eligibleItems: 3 })]).decided).toBe(false);
    expect(decideReferee([zeuge({ eligibleItems: 9 }), zeuge({ eligibleItems: 12 })]).decided).toBe(false);
    // Auch eine übergebene Betrags-Tabelle weicht das nicht auf.
    expect(decideReferee([zeuge({ eligibleItems: 9 }), zeuge({ eligibleItems: 12 })], { betragFuer: () => 8 }).decided).toBe(false);
  });

  test('wählt die Lesung MIT Uhrzeit (sonst fällt der kontenübergreifende Doppel-Schlüssel weg)', () => {
    expect(decideReferee([zeuge({ bonTime: null }), zeuge({ bonTime: '18:02' })])).toMatchObject({ decided: true, chosenIndex: 1 });
    expect(decideReferee([zeuge({ bonTime: '18:02' }), zeuge({ bonTime: null })])).toMatchObject({ decided: true, chosenIndex: 0 });
  });

  describe('gegen die Erstlesungen (plausibel)', () => {
    const prior = [
      { isReceipt: true, totalCents: 3787, eligibleItems: 10, bonDate: '2026-09-10' },
      { isReceipt: true, totalCents: 3787, eligibleItems: 9, bonDate: '2026-09-10' },
    ];

    test('übereinstimmende Werte → entschieden', () => {
      expect(decideReferee([zeuge(), zeuge()], { prior }).decided).toBe(true);
    });

    test('Endsumme, die keine Erstlesung gesehen hat → kein Zeuge', () => {
      const r = decideReferee([zeuge({ totalCents: 3700 }), zeuge({ totalCents: 3700 })], { prior });
      expect(r).toMatchObject({ decided: false, grund: 'widerspricht_erstlesung' });
    });

    test('Warenkorb-Rabatt mit mehr Artikeln als jede Erstlesung → kein Zeuge (erfundene Verdopplung)', () => {
      const r = decideReferee([zeuge({ eligibleItems: 12 }), zeuge({ eligibleItems: 12 })], { prior });
      expect(r.decided).toBe(false);
      // Ohne Warenkorb-Rabatt darf die Zweitprüfung mehr Artikel finden (abgeschnittene Erstlesung).
      const ohneRabatt = { reconDirection: 'undershoot', basketDiscountCents: 0, eligibleItems: 12 };
      expect(decideReferee([zeuge(ohneRabatt), zeuge(ohneRabatt)], { prior }).decided).toBe(true);
    });

    test('bon_too_old: nur ein schon gelesenes Datum zählt, kein neues', () => {
      const alt = [{ isReceipt: true, totalCents: 3787, eligibleItems: 10, bonDate: '2026-07-10' }, { isReceipt: true, totalCents: 3787, eligibleItems: 10, bonDate: '2026-09-01' }];
      expect(decideReferee([zeuge({ bonDate: '2026-09-09' }), zeuge({ bonDate: '2026-09-09' })], { prior: alt, reason: 'bon_too_old' }).decided).toBe(false);
      expect(decideReferee([zeuge({ bonDate: '2026-09-01' }), zeuge({ bonDate: '2026-09-01' })], { prior: alt, reason: 'bon_too_old' }).decided).toBe(true);
      // Bei anderen Gründen ist ein neu gelesenes Datum erlaubt (z. B. no_bon_date).
      expect(decideReferee([zeuge({ bonDate: '2026-09-09' }), zeuge({ bonDate: '2026-09-09' })], { prior: alt, reason: 'reconciliation_delta' }).decided).toBe(true);
    });

    test('ohne Artikelzahl in den Erstlesungen trägt der Rabatt-Weg nicht (z. B. not_a_receipt)', () => {
      expect(decideReferee([zeuge(), zeuge()], { prior: [{ isReceipt: false, totalCents: 1 }] }).decided).toBe(false);
      // Ein Bon ohne Warenkorb-Rabatt bleibt entscheidbar.
      const ohneRabatt = { reconDirection: 'match', basketDiscountCents: 0 };
      expect(decideReferee([zeuge(ohneRabatt), zeuge(ohneRabatt)], { prior: [{ isReceipt: false, totalCents: 1 }] }).decided).toBe(true);
    });

    test('liefert das Zeugen-Paar der Entscheidung', () => {
      const r = decideReferee([zeuge({ totalCents: 1 }), zeuge(), zeuge()], { prior });
      expect(r).toMatchObject({ decided: true, paar: [1, 2] });
    });
  });
});

describe('refereeFingerprint', () => {
  test('Warenkorb-Rabatt mit Belegkette zählt als stimmig', () => {
    const fp = refereeFingerprint({
      model: 'gemini-3.1-pro-preview',
      finishReason: 'STOP',
      parsed: {
        isReceipt: true, merchant: 'NETTO', bonDate: '2026-09-11', totalCents: 7504, subtotalCents: 7899,
        items: [{ name: 'A', priceCents: 7899 }],
        basketDiscounts: [{ label: '5% Rabatt Warenkorb', cents: 395 }],
        bonComplete: true,
      },
    });
    expect(fp).toMatchObject({ reconOk: true, reconDirection: 'basket_discount', basketDiscountCents: 395, bonComplete: true, eligibleItems: 1 });
  });

  test('keine undefined-Werte (Firestore lehnt sie ab)', () => {
    const fp = refereeFingerprint({ parsed: {} });
    expect(Object.values(fp).every((v) => v !== undefined)).toBe(true);
    expect(fp.isReceipt).toBe(false);
  });
});

describe('infraVerhindert — ein Ausfall ist keine Aussage über den Bon', () => {
  test('keine einzige Lesung → verhindert', () => {
    expect(infraVerhindert({ verdict: 'failed', failedAttempts: 3 })).toBe(true);
  });
  test('ein Zeuge + ein Ausfall hätte entscheiden können → verhindert', () => {
    expect(infraVerhindert({ verdict: 'undecided', zeugen: 1, failedAttempts: 1, failures: ['x: 429'] })).toBe(true);
  });
  test('ein Zeuge + Frist erreicht → verhindert', () => {
    expect(infraVerhindert({ verdict: 'undecided', zeugen: 1, failedAttempts: 0, failures: ['frist_erreicht'] })).toBe(true);
  });
  test('ohne Ausfall unentschieden → echte Aussage (ablehnen)', () => {
    expect(infraVerhindert({ verdict: 'undecided', zeugen: 1, failedAttempts: 0, failures: [] })).toBe(false);
    expect(infraVerhindert({ verdict: 'undecided', zeugen: 0, failedAttempts: 0, failures: [] })).toBe(false);
  });
  test('kein Zeuge, ein Ausfall: auch mit der Lesung wären es höchstens 1 → echte Aussage', () => {
    expect(infraVerhindert({ verdict: 'undecided', zeugen: 0, failedAttempts: 1, failures: ['x: 429'] })).toBe(false);
  });
  test('entschieden ist nie verhindert', () => {
    expect(infraVerhindert({ verdict: 'decided', zeugen: 2, failedAttempts: 2 })).toBe(false);
    expect(infraVerhindert(null)).toBe(false);
  });
});

describe('einheitlicheUhrzeit — der Doppel-Schlüssel darf nicht an einer Minderheits-Lesung hängen', () => {
  const l = (bonTime, over = {}) => ({ isReceipt: true, bonTime, ...over });
  test('alle Erstlesungen gleich → diese Uhrzeit', () => {
    expect(einheitlicheUhrzeit([l('08:19'), l('08:19'), l('08:19')])).toBe('08:19');
  });
  test('uneinig → null (dann bleibt es bei der Zweitprüfung)', () => {
    expect(einheitlicheUhrzeit([l('08:19'), l('06:21')])).toBeNull();
  });
  test('weniger als zwei Zeitangaben → null', () => {
    expect(einheitlicheUhrzeit([l('08:19'), l(null)])).toBeNull();
    expect(einheitlicheUhrzeit([])).toBeNull();
    expect(einheitlicheUhrzeit(null)).toBeNull();
  });
  test('Lesungen ohne Bon zählen nicht mit', () => {
    expect(einheitlicheUhrzeit([l('08:19'), l('08:19'), l('23:59', { isReceipt: false })])).toBe('08:19');
  });
  test('Sekunden werden abgeschnitten', () => {
    expect(einheitlicheUhrzeit([l('08:19:44'), l('08:19:02')])).toBe('08:19');
  });
});
