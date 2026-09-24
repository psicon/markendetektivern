'use strict';

/**
 * „Ka-ching!"-Texte der Bon-Nachricht (Entscheidung Patrick, 24.09.2026):
 * das Geld steht in der Überschrift, die Detektiv-Sprache darunter.
 */

const { bonNachricht, betragText, auszahlbarGeworden } = require('../lib/pushTexte');

describe('bonNachricht', () => {
  it('Normalfall mit Markt', () => {
    expect(bonNachricht({ cents: 8, markt: 'Lidl', guthabenNachher: 340, schwelle: 1000 })).toEqual({
      title: 'Ka-ching! 💰 +0,08 € für dich',
      body: 'Dein Bon von Lidl ist geprüft. Weiter so, Spürnase!',
    });
  });

  it.each([[undefined], [''], ['   '], ['Ein sehr langer Marktname ohne Ende GmbH']])(
    'ohne brauchbaren Marktnamen (%p) → „Dein Bon"',
    (markt) => {
      expect(bonNachricht({ cents: 8, markt, guthabenNachher: 340, schwelle: 1000 }).body).toBe(
        'Dein Bon ist geprüft. Weiter so, Spürnase!',
      );
    },
  );

  it('„Dein Bon von …" funktioniert auch bei zusammengesetzten Namen', () => {
    expect(bonNachricht({ cents: 8, markt: 'Netto Marken-Discount' }).body).toBe(
      'Dein Bon von Netto Marken-Discount ist geprüft. Weiter so, Spürnase!',
    );
  });

  it('Zahltag nur, wenn genau dieser Bon die Schwelle überschreitet', () => {
    expect(bonNachricht({ cents: 8, markt: 'Lidl', guthabenNachher: 1004, schwelle: 1000 })).toEqual({
      title: 'Ka-ching! 🎉 10,04 € zum Auszahlen',
      body: 'Dein Bon von Lidl ist geprüft – dein Guthaben kannst du dir jetzt auszahlen lassen.',
    });
    // lag schon vorher darüber → keine zweite Feier
    expect(bonNachricht({ cents: 8, guthabenNachher: 1500, schwelle: 1000 }).title).toBe(
      'Ka-ching! 💰 +0,08 € für dich',
    );
  });

  it('ohne Schwelle aus der Config gilt der Standard 10,00 €', () => {
    expect(bonNachricht({ cents: 8, guthabenNachher: 1004 }).title).toBe('Ka-ching! 🎉 10,04 € zum Auszahlen');
  });

  it('ohne bekanntes Guthaben → normale Nachricht statt Absturz', () => {
    expect(bonNachricht({ cents: 8, guthabenNachher: null, schwelle: 1000 }).title).toBe(
      'Ka-ching! 💰 +0,08 € für dich',
    );
  });

  it('Titel bleiben unter 40 Zeichen, Texte unter 110 — auch mit langem Marktnamen', () => {
    const faelle = [
      bonNachricht({ cents: 8, markt: 'Lidl', guthabenNachher: 340, schwelle: 1000 }),
      bonNachricht({ cents: 800, markt: 'Netto Marken-Discount', guthabenNachher: 99999, schwelle: 1000 }),
      bonNachricht({ cents: 8, markt: 'Netto Marken-Discount', guthabenNachher: 1004, schwelle: 1000 }),
    ];
    for (const n of faelle) {
      expect([...n.title].length).toBeLessThanOrEqual(40);
      expect([...n.body].length).toBeLessThanOrEqual(110);
    }
  });
});

describe('Hilfsfunktionen', () => {
  it('betragText', () => {
    expect(betragText(8)).toBe('0,08 €');
    expect(betragText(1004)).toBe('10,04 €');
  });

  it('auszahlbarGeworden an den Grenzen', () => {
    expect(auszahlbarGeworden(1000, 8, 1000)).toBe(true);
    expect(auszahlbarGeworden(999, 8, 1000)).toBe(false);
    expect(auszahlbarGeworden(1008, 8, 1000)).toBe(false);
    expect(auszahlbarGeworden(NaN, 8, 1000)).toBe(false);
  });
});
