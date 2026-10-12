'use strict';

/** Steuer-QR-Code als Zeuge (12.10.2026). */
const { deuten, ortszeit } = require('../lib/kassenQr');

test('deutscher TSE-Code: Summe je Steuersatz, Zeiten in Ortszeit', () => {
  const d = deuten('V0;DE2640SCO09;Kassenbeleg-V1;Beleg^7.46_10.08_0.00_0.00_0.00^17.54:Unbar;1359667;2737286;2026-09-21T17:44:37.000Z;2026-09-21T17:44:57.000Z;ecdsa;unixTime;sig;key');
  expect(d).toEqual({ format: 'tse', kasse: 'DE2640SCO09', transaktion: '1359667', summeCents: 1754, datum: '2026-09-21', zeiten: ['19:44', '19:44'] });
});

test('Datum nach Umrechnung: kurz vor Mitternacht UTC ist schon der nächste Tag', () => {
  const d = deuten('V0;X;Kassenbeleg-V1;Beleg^1.00_0.00_0.00_0.00_0.00^1.00:Bar;5;6;2026-10-09T22:30:00.000Z;2026-10-09T22:31:00.000Z;a;b;c;d');
  expect(d.datum).toBe('2026-10-10');
  expect(d.zeiten).toEqual(['00:30', '00:31']);
});

test('österreichischer RKSV-Code', () => {
  const d = deuten('_R1-AT1_KASSE1_4711_2026-10-09T13:49:12_10,17_0,00_0,00_0,00_0,00_xyz_abc_def');
  expect(d).toMatchObject({ format: 'rksv', kasse: 'KASSE1', transaktion: '4711', summeCents: 1017, datum: '2026-10-09', zeiten: ['13:49'] });
});

test('fremde QR-Codes und Abbrüche werden ignoriert', () => {
  expect(deuten('https://kaufland.de/app')).toBeNull();
  expect(deuten('V0;X;AVBelegabbruch;Beleg^1.00^1.00:Bar;5;6;2026-10-09T10:00:00Z;2026-10-09T10:01:00Z')).toBeNull();
  expect(deuten('V0;X;Kassenbeleg-V1;Bestellung^1.00^1.00:Bar;5;6;2026-10-09T10:00:00Z;2026-10-09T10:01:00Z')).toBeNull();
});

test('Zeit ohne Zonenangabe gilt als Ortszeit', () => {
  expect(ortszeit('2026-10-09T13:49:12', 'Europe/Berlin')).toEqual({ datum: '2026-10-09', zeit: '13:49' });
});
