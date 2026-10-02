'use strict';

/**
 * survey-reward gegen den ECHTEN index.js mit der Firestore-Attrappe der
 * Geld-Tests (cashback-pipeline/__tests__/helpers/fakeAdmin.js).
 *
 * Prüfrunde 02.10.2026:
 *  - Kontosperre (Entscheidung Patrick 02.10.2026): gesperrtes Konto bekommt
 *    keinen Taler; aufgehobene Sperre zahlt wieder; Lesefehler zahlt nicht.
 *  - Nur Umfragen mit status 'active' zahlen — eine selbst geschriebene
 *    Antwort auf einen Entwurf bringt nichts.
 *  - 7d8e91b (bisher nie ausgerollt, kommt mit diesem Deploy): Antworten nach
 *    Ende (+1 h Kulanz) oder vor Beginn zahlen nicht.
 *  - Was bisher galt, gilt weiter: Einwilligung + registriertes Konto, ein
 *    Taler je Umfrage (completion), Deckel und Budget (per_answer).
 */

jest.mock('firebase-admin', () => require('../../cashback-pipeline/__tests__/helpers/fakeAdmin').erstelleFakeAdmin());
jest.mock('firebase-functions', () => ({
  logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
}));
jest.mock('firebase-functions/v2/firestore', () => ({ onDocumentCreated: (_opts, h) => h }));

const admin = require('firebase-admin');
const { onPollResponseCreated } = require('../index');

const fake = admin.__fake;
const UID = 'nutzer1';
const JETZT = Date.parse('2026-10-02T12:00:00Z');
const TAG = 86400e3;
let laufendeNr = 0;

function umfrage(id, daten) {
  fake.store.set(`polls/${id}`, {
    status: 'active',
    rewardCents: 10,
    rewardTrigger: 'completion',
    startDate: fake.zeit(JETZT - 5 * TAG),
    endDate: fake.zeit(JETZT + 5 * TAG),
    questions: [{ id: 'q1' }],
    ...daten,
  });
}

/** Antwort anlegen und den Trigger laufen lassen (wie Firestore: Ereignis mit Zeitpunkt des Schreibens). */
async function antworten(pollId, { uid = UID, zeit = JETZT } = {}) {
  const id = `r${++laufendeNr}`;
  const daten = { userId: uid, pollId };
  fake.store.set(`poll_responses/${id}`, daten);
  await onPollResponseCreated({
    params: { id },
    time: new Date(zeit).toISOString(),
    data: { data: () => daten },
  });
  return id;
}

function ledger(uid = UID) {
  return [...fake.store.entries()]
    .filter(([k]) => k.startsWith(`users/${uid}/cashback_ledger/`))
    .map(([, v]) => v);
}
const guthaben = (uid = UID) => fake.store.get(`users/${uid}`)?.cashback_balance_cents ?? 0;

beforeEach(() => {
  fake.zuruecksetzen();
  fake.setzeJetzt(JETZT);
  fake.store.set('cashback_config/v1', { consentVersion: 'v2.0-2026-06' });
  fake.store.set(`users/${UID}`, {
    cashback_balance_cents: 40,
    cashback_lifetime_cents: 100,
    cashback_consent: { accepted: true, version: 'v2.0-2026-06' },
  });
  fake.benutzer.set(UID, { uid: UID, providerData: [{ providerId: 'google.com' }] });
});

describe('Bisheriges Verhalten bleibt', () => {
  test('aktive, laufende Umfrage zahlt einmal (completion)', async () => {
    umfrage('p1');
    await antworten('p1');
    await antworten('p1');
    expect(ledger()).toHaveLength(1);
    expect(ledger()[0]).toMatchObject({ type: 'earn', cents: 10, surveyPollId: 'p1', reason: 'survey' });
    expect(guthaben()).toBe(50);
  });

  test('per_answer mit Deckel', async () => {
    umfrage('p1', { rewardTrigger: 'per_answer', rewardCents: 5, maxPerUser: 2 });
    await antworten('p1');
    await antworten('p1');
    await antworten('p1');
    expect(ledger()).toHaveLength(2);
    expect(guthaben()).toBe(50);
  });

  test('ohne Einwilligung bzw. als Gast kein Taler', async () => {
    umfrage('p1');
    fake.store.set(`users/${UID}`, { cashback_balance_cents: 0 });
    await antworten('p1');
    expect(ledger()).toHaveLength(0);
    fake.store.set(`users/${UID}`, { cashback_consent: { accepted: true, version: 'v2.0-2026-06' } });
    fake.benutzer.set(UID, { uid: UID, providerData: [] });
    await antworten('p1');
    expect(ledger()).toHaveLength(0);
  });
});

describe('Kontosperre (Entscheidung Patrick 02.10.2026)', () => {
  test('gesperrt → kein Taler, Guthaben unverändert, Antwort bleibt gespeichert', async () => {
    umfrage('p1');
    fake.store.set(`cashback_sperren/${UID}`, { gesperrt: true, grund: 'test', quelle: 'Entscheidung Patrick 02.10.2026' });
    const id = await antworten('p1');
    expect(ledger()).toHaveLength(0);
    expect(guthaben()).toBe(40);
    expect(fake.store.has(`poll_responses/${id}`)).toBe(true);
  });

  test('gesperrt: false (aufgehoben) → zahlt wieder', async () => {
    umfrage('p1');
    fake.store.set(`cashback_sperren/${UID}`, { gesperrt: false });
    await antworten('p1');
    expect(ledger()).toHaveLength(1);
  });

  test('Sperre nicht lesbar → kein Taler, nichts halb geschrieben', async () => {
    umfrage('p1', { budgetCents: 100 });
    fake.fehler.add(`cashback_sperren/${UID}`);
    await antworten('p1');
    expect(ledger()).toHaveLength(0);
    expect(guthaben()).toBe(40);
    expect(fake.store.get('polls/p1').budgetRemainingCents).toBeUndefined();
  });

  test('Sperre eines ANDEREN Kontos ändert nichts', async () => {
    umfrage('p1');
    fake.store.set('cashback_sperren/jemandAnderes', { gesperrt: true });
    await antworten('p1');
    expect(ledger()).toHaveLength(1);
  });
});

describe('Nur Umfragen, die eine App zeigen kann', () => {
  test.each([['draft'], ['closed'], [undefined]])('status %s → kein Taler', async (status) => {
    umfrage('p1', { status });
    await antworten('p1');
    expect(ledger()).toHaveLength(0);
  });

  test('Nachbau des Angriffs: Antworten auf Entwürfe mit 10 € + 2 € → nichts', async () => {
    umfrage('gross', { status: 'draft', rewardCents: 1000, maxPerUser: 1 });
    umfrage('mittel', { status: 'draft', rewardCents: 200, maxPerUser: 1 });
    await antworten('gross');
    await antworten('mittel');
    expect(ledger()).toHaveLength(0);
    expect(guthaben()).toBe(40);
  });
});

describe('Zeitfenster (7d8e91b, kommt mit diesem Deploy)', () => {
  test('nach Ende + 1 h → kein Taler', async () => {
    umfrage('p1', { endDate: fake.zeit(JETZT - 2 * 3600e3) });
    await antworten('p1');
    expect(ledger()).toHaveLength(0);
  });

  test('knapp nach Ende (innerhalb 1 h Kulanz) → Taler', async () => {
    umfrage('p1', { endDate: fake.zeit(JETZT - 30 * 60e3) });
    await antworten('p1');
    expect(ledger()).toHaveLength(1);
  });

  test('vor Beginn → kein Taler', async () => {
    umfrage('p1', { startDate: fake.zeit(JETZT + TAG) });
    await antworten('p1');
    expect(ledger()).toHaveLength(0);
  });
});
