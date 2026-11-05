'use strict';
const { pushErlaubt } = require('../lib/pushPolicy');

describe('pushErlaubt — die Abbestellung muss greifen, darf aber niemanden mitreißen', () => {
  test('ein ausdrückliches Nein hält den Push zurück', () => {
    // Genau der Fall aus 86cbfdq5j: der Schalter schrieb dieses false seit
    // Mai 2026, und gelesen hat es nie jemand.
    const r = pushErlaubt({ pushNotificationsEnabled: false });
    expect(r.erlaubt).toBe(false);
    expect(r.grund).toBe('abbestellt');
  });

  test('ein ausdrückliches Ja sendet', () => {
    expect(pushErlaubt({ pushNotificationsEnabled: true }).erlaubt).toBe(true);
  });

  test('fehlendes Feld sendet — 283.728 von 283.756 Konten haben es nie gesetzt', () => {
    // Der teure Fehler wäre hier: „nicht gesetzt" als „aus" zu lesen. Dann
    // hätte der Deploy alle Nachrichten der App abgeschaltet, und zwar
    // lautlos.
    expect(pushErlaubt({ name: 'Ohne Einstellung' }).erlaubt).toBe(true);
    expect(pushErlaubt({ pushNotificationsEnabled: undefined }).erlaubt).toBe(true);
    expect(pushErlaubt({ pushNotificationsEnabled: null }).erlaubt).toBe(true);
  });

  test('kein Nutzerdokument oder Lesefehler sendet — fail-open', () => {
    // Ein Firestore-Fehler ist keine Aussage über den Willen des Nutzers.
    for (const eingabe of [null, undefined, 'kaputt', 42]) {
      const r = pushErlaubt(eingabe);
      expect(r.erlaubt).toBe(true);
      expect(r.grund).toBe('kein_nutzerdokument');
    }
  });

  test('nur der Wert false zählt als Nein — keine wahrheitsähnlichen Werte', () => {
    // Ein leerer String oder eine 0 im Feld wäre ein Datenfehler, kein
    // Widerspruch. Im Zweifel senden statt stumm zu verstummen.
    expect(pushErlaubt({ pushNotificationsEnabled: 0 }).erlaubt).toBe(true);
    expect(pushErlaubt({ pushNotificationsEnabled: '' }).erlaubt).toBe(true);
    expect(pushErlaubt({ pushNotificationsEnabled: 'false' }).erlaubt).toBe(true);
  });
});
