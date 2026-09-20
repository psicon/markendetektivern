'use strict';

/**
 * Die vier Abnahmekriterien aus ClickUp 12487v2akvp, ohne Firestore:
 *   1. Gutschrift → genau EIN Push, mit Betrag und richtigem Ziel
 *   2. abbestellt → kein Push
 *   3. Redelivery (Merker steht) → kein zweiter Push
 *   4. keine Buchung (cents 0) → kein Push
 *
 * Dazu die zwei Payload-Eigenschaften, die schon einmal teuer waren:
 * kein `badge` (1★-Rezension vom 07.09.2026) und der Android-Kanal
 * `cashback`, den die App tatsächlich anlegt.
 */

jest.mock('firebase-functions', () => ({
  logger: { info: () => {}, warn: () => {}, error: () => {} },
}));

jest.mock('firebase-admin', () => {
  const firestore = () => ({
    doc: (pfad) => ({
      get: async () => ({
        exists: global.__nutzer !== null,
        data: () => global.__nutzer,
      }),
      set: async (daten) => {
        global.__geschrieben.push({ pfad, daten });
      },
    }),
    collection: () => ({
      get: async () => ({
        docs: global.__tokens.map((t) => ({ id: t.id, get: (feld) => t[feld] })),
      }),
    }),
    batch: () => ({ delete: () => {}, commit: async () => {} }),
    runTransaction: async (fn) =>
      fn({
        get: async () => ({ get: (feld) => (feld === 'rewardPushSentAt' ? global.__merker : undefined) }),
        set: () => {
          global.__merker = '__ts__';
        },
      }),
  });
  firestore.FieldValue = { serverTimestamp: () => '__ts__', delete: () => '__del__' };
  return {
    firestore,
    messaging: () => ({
      sendEachForMulticast: async (m) => {
        global.__versand.push(m);
        return {
          successCount: m.tokens.length,
          failureCount: 0,
          responses: m.tokens.map(() => ({ success: true })),
        };
      },
    }),
  };
});

const { sendeVerguetungPush, betragText, nachricht } = require('../src/push');

const uploadRef = { id: 'up1' };

beforeEach(() => {
  global.__nutzer = {};
  global.__tokens = [{ id: 'd1', token: 'TOK1' }];
  global.__merker = undefined;
  global.__versand = [];
  global.__geschrieben = [];
});

describe('Betrag und Text', () => {
  it.each([
    [15, '0,15 €'],
    [5, '0,05 €'],
    [100, '1,00 €'],
    [1234, '12,34 €'],
  ])('%i Cent → %s', (cents, erwartet) => {
    expect(betragText(cents)).toBe(erwartet);
  });

  it('nennt den Betrag und verspricht nichts über den Katalog', () => {
    const { title, body } = nachricht(15);
    expect(title).toContain('0,15 €');
    expect(body).toMatch(/Guthaben/);
    expect(`${title} ${body}`).not.toMatch(/Katalog/i);
  });
});

describe('sendeVerguetungPush', () => {
  it('Gutschrift: genau ein Versand, Merker gesetzt, Payload stimmt', async () => {
    const r = await sendeVerguetungPush({ uploadRef, uploadId: 'up1', uid: 'u1', cents: 15 });

    expect(global.__versand).toHaveLength(1);
    expect(r.sent).toBe(1);

    const m = global.__versand[0];
    expect(m.notification.title).toContain('0,15 €');
    expect(m.data.deepLink).toBe('/product-submit');
    expect(m.data.kind).toBe('crowd_reward');
    expect(m.data.crowdUploadId).toBe('up1');
    expect(m.data.pushId).toMatch(/^p_/);

    // Die rote Eins, die nie wieder wegging — darf nicht zurückkommen.
    expect(m.apns.payload.aps.badge).toBeUndefined();
    // Kanal, den die App wirklich anlegt. Ein fremder Name = keine Anzeige.
    expect(m.android.notification.channelId).toBe('cashback');

    expect(global.__merker).toBe('__ts__');
    expect(global.__geschrieben.some((g) => g.pfad.startsWith('push_log/'))).toBe(true);
  });

  it('abbestellt: kein Versand', async () => {
    global.__nutzer = { pushNotificationsEnabled: false };
    const r = await sendeVerguetungPush({ uploadRef, uploadId: 'up1', uid: 'u1', cents: 15 });
    expect(global.__versand).toHaveLength(0);
    expect(r.skipped).toBe('keine_empfaenger');
  });

  it('Lesefehler am Nutzerdokument hält NICHT zurück (fail-open)', async () => {
    global.__nutzer = null; // Dokument fehlt
    await sendeVerguetungPush({ uploadRef, uploadId: 'up1', uid: 'u1', cents: 15 });
    expect(global.__versand).toHaveLength(1);
  });

  it('Redelivery: Merker steht bereits → kein zweiter Versand', async () => {
    global.__merker = '__ts__';
    const r = await sendeVerguetungPush({ uploadRef, uploadId: 'up1', uid: 'u1', cents: 15 });
    expect(global.__versand).toHaveLength(0);
    expect(r.skipped).toBe('schon_verschickt');
  });

  it('zweimal hintereinander aufgerufen: nur der erste sendet', async () => {
    await sendeVerguetungPush({ uploadRef, uploadId: 'up1', uid: 'u1', cents: 15 });
    await sendeVerguetungPush({ uploadRef, uploadId: 'up1', uid: 'u1', cents: 15 });
    expect(global.__versand).toHaveLength(1);
  });

  it('ohne Buchung (0 Cent): kein Versand und kein Merker', async () => {
    const r = await sendeVerguetungPush({ uploadRef, uploadId: 'up1', uid: 'u1', cents: 0 });
    expect(global.__versand).toHaveLength(0);
    expect(global.__merker).toBeUndefined();
    expect(r.skipped).toBe('nichts_gebucht');
  });

  it('ohne Token: kein Versand, kein Merker verbraucht', async () => {
    global.__tokens = [];
    await sendeVerguetungPush({ uploadRef, uploadId: 'up1', uid: 'u1', cents: 15 });
    expect(global.__versand).toHaveLength(0);
    expect(global.__merker).toBeUndefined();
  });
});
