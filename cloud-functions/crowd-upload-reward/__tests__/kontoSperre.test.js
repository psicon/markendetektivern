'use strict';

/**
 * Kontosperre für Produktfotos (Entscheidung Patrick 02.10.2026, „Ja, dann
 * sperr die Konten"). Geprüft gegen den ECHTEN Trigger onCrowdUploadApproved
 * mit einer Firestore-Attrappe:
 *
 *   - gesperrt → keine Buchung, Ergebnis `not_credited / konto_gesperrt` am
 *     Dokument (nie still), kein „Ka-ching!", kein Budgetverbrauch. Bewusst
 *     OHNE `rewardSkipped` — daraus leitet die ausgelieferte App den
 *     Standort-Hinweis ab, der hier falsch wäre.
 *   - nicht gesperrt → Buchung wie bisher.
 *   - Sperre nicht lesbar → nichts buchen; jung: werfen (Eventarc stellt
 *     erneut zu), nach Ablauf der Wiederholungsfrist sichtbar vermerken.
 *   - Bereits Gebuchtes bleibt gebucht.
 *
 * Die Regel selbst (istGesperrt) und der Kopie-Abgleich liegen bei der Quelle:
 * cloud-functions/cashback-pipeline/__tests__/kontoSperre.test.js.
 */

// Die Firestore-Attrappe stammt aus den Tests der Quelle — nur Testcode, im
// Laufzeitcode teilen die Codebases nichts.
jest.mock('firebase-admin', () =>
  require('../../cashback-pipeline/__tests__/helpers/fakeAdmin').erstelleFakeAdmin(),
);
jest.mock('firebase-functions/logger', () => ({ info: () => {}, warn: () => {}, error: () => {} }));
jest.mock('firebase-functions', () => ({ logger: { info: () => {}, warn: () => {}, error: () => {} } }));
jest.mock('firebase-functions/v2/firestore', () => ({ onDocumentUpdated: (_opts, h) => h }));
jest.mock('firebase-functions/v2/scheduler', () => ({ onSchedule: (_opts, h) => h }));
jest.mock('../src/push', () => ({
  zurSammlungHinzufuegen: async (x) => {
    global.__sammlung.push(x);
  },
  gesammelteSenden: async () => {},
}));

const admin = require('firebase-admin');
const { onCrowdUploadApproved } = require('../index');

const fake = admin.__fake;
const db = admin.firestore();
const UID = '7onx-test';
const STUNDE = 60 * 60 * 1000;

function einreichung(extra = {}) {
  return {
    userId: UID,
    status: 'approved',
    campaignId: 'foto-okt',
    ean: '4000000000000',
    capture: { gps: { lat: 48.7, lng: 9.6 }, gpsStatus: 'ok' },
    clientVersion: { platform: 'android', app: '6.0.21', build: '1250' },
    ...extra,
  };
}

/** Freigabe-Ereignis pending → approved; `alterMs` = wie alt das Ereignis ist. */
async function freigeben(id = 'u1', { alterMs = 0, daten = einreichung() } = {}) {
  fake.store.set(`crowd_uploads/${id}`, daten);
  return onCrowdUploadApproved({
    params: { id },
    time: new Date(Date.now() - alterMs).toISOString(),
    data: {
      before: { data: () => ({ ...daten, status: 'pending' }) },
      after: { data: () => daten, ref: db.doc(`crowd_uploads/${id}`) },
    },
  });
}

const ledger = () =>
  [...fake.store.entries()].filter(([k]) => k.startsWith(`users/${UID}/cashback_ledger/`)).map(([, v]) => v);

beforeEach(() => {
  fake.zuruecksetzen();
  global.__sammlung = [];
  fake.store.set('cashback_campaigns/foto-okt', {
    kind: 'product_photos', active: true, cashbackPerBonCents: 16, budgetRemainingCents: 1000, maxPerUserCents: 500,
  });
  fake.store.set(`users/${UID}`, { cashback_balance_cents: 40, cashback_lifetime_cents: 1061 });
});

describe('Produktfotos: gesperrtes Konto', () => {
  test('keine Buchung, Grund am Dokument, keine Nachricht, kein Budget', async () => {
    fake.store.set(`cashback_sperren/${UID}`, { gesperrt: true, grund: 'falsche EANs', quelle: 'Entscheidung Patrick 02.10.2026' });
    await freigeben();

    expect(ledger()).toHaveLength(0);
    expect(fake.store.get(`users/${UID}`)).toMatchObject({ cashback_balance_cents: 40, cashback_lifetime_cents: 1061 });
    expect(fake.store.get('cashback_campaigns/foto-okt').budgetRemainingCents).toBe(1000);
    const doc = fake.store.get('crowd_uploads/u1');
    expect(doc).toMatchObject({ rewardResult: 'not_credited', rewardCents: 0, rewardNotCreditedReason: 'konto_gesperrt' });
    expect(doc.rewardSkipped).toBeUndefined();
    expect(global.__sammlung).toHaveLength(0);
  });

  test('nicht gesperrt → Buchung wie bisher', async () => {
    await freigeben();
    const eintraege = ledger();
    expect(eintraege).toHaveLength(1);
    expect(eintraege[0]).toMatchObject({ type: 'earn', cents: 16, campaignId: 'foto-okt', crowdUploadId: 'u1' });
    expect(fake.store.get(`users/${UID}`).cashback_balance_cents).toBe(56);
    expect(fake.store.get('crowd_uploads/u1')).toMatchObject({ rewardResult: 'credited', rewardCents: 16 });
    expect(global.__sammlung).toHaveLength(1);
  });

  test('Sperre aufgehoben (gesperrt: false) → Buchung wie bisher', async () => {
    fake.store.set(`cashback_sperren/${UID}`, { gesperrt: false, grund: 'aufgehoben' });
    await freigeben();
    expect(ledger()).toHaveLength(1);
  });

  test('Sperre nicht lesbar, frisches Ereignis → werfen (Wiederholung), nichts gebucht, kein Vermerk', async () => {
    fake.fehler.add(`cashback_sperren/${UID}`);
    await expect(freigeben()).rejects.toThrow(/UNAVAILABLE/);
    expect(ledger()).toHaveLength(0);
    expect(fake.store.get('crowd_uploads/u1').rewardResult).toBeUndefined();
  });

  test('Sperre nicht lesbar nach Ablauf der Wiederholungsfrist → sichtbar „technischer_fehler", nie still', async () => {
    fake.fehler.add(`cashback_sperren/${UID}`);
    await freigeben('u1', { alterMs: 13 * STUNDE });
    expect(ledger()).toHaveLength(0);
    expect(fake.store.get('crowd_uploads/u1')).toMatchObject({
      rewardResult: 'not_credited', rewardNotCreditedReason: 'technischer_fehler',
    });
  });

  test('vor der Sperre Gebuchtes bleibt gebucht', async () => {
    fake.store.set(`users/${UID}/cashback_ledger/crowd_u1`, {
      type: 'earn', cents: 16, campaignId: 'foto-okt', crowdUploadId: 'u1', createdAt: fake.zeit(Date.now() - 48 * STUNDE),
    });
    fake.store.set(`cashback_sperren/${UID}`, { gesperrt: true });
    await freigeben();
    expect(ledger()).toEqual([expect.objectContaining({ type: 'earn', cents: 16 })]);
    expect(fake.store.get('crowd_uploads/u1')).toMatchObject({ rewardResult: 'credited', rewardCents: 16 });
  });
});
