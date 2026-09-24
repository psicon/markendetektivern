'use strict';

/**
 * „Ka-ching!"-Nachricht für Produktfotos (12487v2akvp, Texte 24.09.2026).
 *
 * Geprüft wird gegen eine kleine Firestore-Attrappe im Speicher, damit die
 * Eigenschaften, auf die es ankommt, wirklich ausgeführt werden:
 *   - zehn Freigaben kurz hintereinander → EINE Nachricht mit der Summe
 *   - dieselbe Freigabe zweimal zugestellt → wird nur einmal gezählt
 *   - solange noch Freigaben dazukommen, wird nicht gesendet (Ruhefenster)
 *   - abbestellt → keine Nachricht
 *   - Zahltag-Text nur, wenn GENAU diese Gutschrift die Schwelle überschreitet
 * dazu die Payload-Eigenschaften, die schon einmal teuer waren: kein `badge`
 * (1★-Rezension vom 07.09.2026) und der Android-Kanal `cashback`.
 */

jest.mock('firebase-functions', () => ({
  logger: { info: () => {}, warn: () => {}, error: () => {} },
}));

jest.mock('firebase-admin', () => {
  const store = new Map();
  global.__store = store;

  function anwenden(alt, neu) {
    const out = { ...(alt || {}) };
    for (const [k, v] of Object.entries(neu)) {
      if (v && v.__op === 'inc') out[k] = (Number(out[k]) || 0) + v.n;
      else if (v && v.__op === 'union') out[k] = Array.from(new Set([...(out[k] || []), ...v.werte]));
      else if (v && v.__op === 'ts') {
        const t = global.__jetzt;
        out[k] = { toMillis: () => t };
      } else out[k] = v;
    }
    return out;
  }
  const schreiben = (pfad, daten, opt) =>
    store.set(pfad, opt && opt.merge ? anwenden(store.get(pfad), daten) : anwenden({}, daten));
  function snap(pfad) {
    const d = store.get(pfad);
    return { exists: d !== undefined, id: pfad.split('/').pop(), ref: ref(pfad), data: () => d, get: (f) => (d ? d[f] : undefined) };
  }
  function ref(pfad) {
    return { path: pfad, id: pfad.split('/').pop(), get: async () => snap(pfad), set: async (d, o) => schreiben(pfad, d, o) };
  }
  const kinder = (c) =>
    [...store.keys()].filter((k) => k.startsWith(`${c}/`) && k.split('/').length === c.split('/').length + 1);

  const firestore = () => ({
    doc: (p) => ref(p),
    collection: (c) => ({
      doc: (id) => ref(`${c}/${id}`),
      get: async () => ({ docs: kinder(c).map(snap) }),
      where: (feld, _op, wert) => ({
        limit: () => ({
          get: async () => {
            const docs = kinder(c)
              .map(snap)
              .filter((s) => {
                const v = s.data()[feld];
                return v && typeof v.toMillis === 'function' && v.toMillis() <= wert.toMillis();
              });
            return { empty: docs.length === 0, docs };
          },
        }),
      }),
    }),
    batch: () => ({ delete: () => {}, commit: async () => {} }),
    runTransaction: async (fn) =>
      fn({
        get: async (r) => snap(r.path),
        set: (r, d, o) => schreiben(r.path, d, o),
        delete: (r) => store.delete(r.path),
      }),
  });
  firestore.FieldValue = {
    increment: (n) => ({ __op: 'inc', n }),
    arrayUnion: (...werte) => ({ __op: 'union', werte }),
    serverTimestamp: () => ({ __op: 'ts' }),
    delete: () => ({ __op: 'del' }),
  };
  firestore.Timestamp = { fromMillis: (ms) => ({ toMillis: () => ms }) };

  return {
    firestore,
    messaging: () => ({
      sendEachForMulticast: async (m) => {
        global.__versand.push(m);
        return { successCount: m.tokens.length, failureCount: 0, responses: m.tokens.map(() => ({ success: true })) };
      },
    }),
  };
});

const admin = require('firebase-admin');
const {
  zurSammlungHinzufuegen,
  gesammelteSenden,
  nachricht,
  betragText,
  auszahlbarGeworden,
  SAMMLER,
} = require('../src/push');

const T0 = 1_000_000_000_000;
const MINUTE = 60 * 1000;
const uploadRef = (id) => admin.firestore().doc(`crowd_uploads/${id}`);

beforeEach(() => {
  global.__store.clear();
  global.__versand = [];
  global.__jetzt = T0;
  global.__store.set('users/u1', { cashback_balance_cents: 340 });
  global.__store.set('users/u1/fcmTokens/d1', { token: 'TOK1' });
  global.__store.set('cashback_config/v1', { payoutThresholdCents: 1000 });
});

async function freigeben(id, cents = 16, uid = 'u1', guthaben = null) {
  global.__store.set(`crowd_uploads/${id}`, { status: 'approved', userId: uid });
  const extra = guthaben ? { guthabenVorher: guthaben[0], guthabenNachher: guthaben[1] } : {};
  return zurSammlungHinzufuegen({ uploadRef: uploadRef(id), uploadId: id, uid, cents, ...extra });
}

describe('Texte', () => {
  it.each([
    [16, '0,16 €'],
    [8, '0,08 €'],
    [48, '0,48 €'],
    [1002, '10,02 €'],
  ])('%i Cent → %s', (c, erwartet) => expect(betragText(c)).toBe(erwartet));

  it('Normalfall: Geld in der Überschrift, Detektiv-Sprache darunter', () => {
    expect(nachricht({ cents: 16, guthabenNachher: 340 })).toEqual({
      title: 'Ka-ching! 💰 +0,16 € für dich',
      body: 'Deine Produktfotos sind freigegeben. Starke Detektivarbeit!',
    });
  });

  it('Zahltag-Text nur mit dem Merker aus der Buchung', () => {
    expect(nachricht({ cents: 16, guthabenNachher: 1006, schwelleUeberschritten: true }).title).toBe(
      'Ka-ching! 🎉 10,06 € zum Auszahlen',
    );
    // ohne Merker: normale Nachricht, auch wenn das Guthaben hoch ist
    expect(nachricht({ cents: 16, guthabenNachher: 1200 }).title).toBe('Ka-ching! 💰 +0,16 € für dich');
  });

  it('Merker gesetzt, aber Guthaben unbekannt → normale Nachricht statt kaputter Zahl', () => {
    expect(nachricht({ cents: 16, guthabenNachher: undefined, schwelleUeberschritten: true }).title).toBe(
      'Ka-ching! 💰 +0,16 € für dich',
    );
  });

  it('Grenzfälle der Schwelle', () => {
    expect(auszahlbarGeworden(1000, 16, 1000)).toBe(true); // genau erreicht
    expect(auszahlbarGeworden(999, 16, 1000)).toBe(false); // knapp darunter
    expect(auszahlbarGeworden(1016, 16, 1000)).toBe(false); // lag schon bei 1000
  });

  it('Titel bleiben unter 40 Zeichen, Texte unter 110', () => {
    for (const n of [
      nachricht({ cents: 16, guthabenNachher: 340 }),
      nachricht({ cents: 1600, guthabenNachher: 99999, schwelleUeberschritten: true }),
    ]) {
      expect([...n.title].length).toBeLessThanOrEqual(40);
      expect([...n.body].length).toBeLessThanOrEqual(110);
    }
  });
});

describe('Sammeln und Versenden', () => {
  it('zehn Freigaben hintereinander → genau EINE Nachricht mit der Summe', async () => {
    for (let i = 0; i < 10; i++) await freigeben(`up${i}`);
    global.__jetzt = T0 + 2 * MINUTE;

    const r = await gesammelteSenden({ jetztMs: T0 + 2 * MINUTE });

    expect(global.__versand).toHaveLength(1);
    expect(r.gesendet).toBe(1);
    const m = global.__versand[0];
    expect(m.notification.title).toBe('Ka-ching! 💰 +1,60 € für dich');
    expect(m.data.anzahl).toBe('10');
    expect(global.__store.has(`${SAMMLER}/u1`)).toBe(false); // abgeholt
  });

  it('dieselbe Freigabe zweimal zugestellt → wird nur einmal gezählt', async () => {
    expect(await freigeben('up1')).toBe(true);
    expect(await zurSammlungHinzufuegen({ uploadRef: uploadRef('up1'), uploadId: 'up1', uid: 'u1', cents: 16 })).toBe(false);
    expect(global.__store.get(`${SAMMLER}/u1`).cents).toBe(16);
    expect(global.__store.get(`${SAMMLER}/u1`).anzahl).toBe(1);
  });

  it('während noch Freigaben kommen, wird nicht gesendet', async () => {
    await freigeben('up1');
    global.__jetzt = T0 + 30 * 1000; // zweite Freigabe 30 s später
    await freigeben('up2');

    // Lauf 45 s nach der zweiten Freigabe: Ruhe noch nicht erreicht
    await gesammelteSenden({ jetztMs: T0 + 75 * 1000 });
    expect(global.__versand).toHaveLength(0);

    // nächster Lauf: jetzt still genug → eine Nachricht mit beiden
    await gesammelteSenden({ jetztMs: T0 + 3 * MINUTE });
    expect(global.__versand).toHaveLength(1);
    expect(global.__versand[0].notification.title).toBe('Ka-ching! 💰 +0,32 € für dich');
  });

  it('zweiter Zeitplan-Lauf nach dem Versand schickt nichts noch einmal', async () => {
    await freigeben('up1');
    await gesammelteSenden({ jetztMs: T0 + 2 * MINUTE });
    await gesammelteSenden({ jetztMs: T0 + 3 * MINUTE });
    expect(global.__versand).toHaveLength(1);
  });

  it('abbestellt → keine Nachricht', async () => {
    global.__store.set('users/u1', { cashback_balance_cents: 340, pushNotificationsEnabled: false });
    await freigeben('up1');
    await gesammelteSenden({ jetztMs: T0 + 2 * MINUTE });
    expect(global.__versand).toHaveLength(0);
  });

  it('fehlendes Nutzerdokument hält NICHT zurück (fail-open)', async () => {
    global.__store.delete('users/u1');
    await freigeben('up1');
    await gesammelteSenden({ jetztMs: T0 + 2 * MINUTE });
    expect(global.__versand).toHaveLength(1);
  });

  it('0 Cent → nichts vorgemerkt', async () => {
    expect(await freigeben('up1', 0)).toBe(false);
    expect(global.__store.has(`${SAMMLER}/u1`)).toBe(false);
  });

  it('Zahltag, wenn eine Buchung des Bündels die Schwelle überschreitet', async () => {
    await freigeben('up1', 16, 'u1', [978, 994]); // noch darunter
    await freigeben('up2', 16, 'u1', [994, 1010]); // diese überschreitet
    global.__store.set('users/u1', { cashback_balance_cents: 1010 });
    await gesammelteSenden({ jetztMs: T0 + 2 * MINUTE });
    expect(global.__versand[0].notification.title).toBe('Ka-ching! 🎉 10,10 € zum Auszahlen');
  });

  it('kein zweiter Zahltag: Bon hat die Schwelle schon überschritten, das Foto im Sammler nicht', async () => {
    // Foto bucht 980 → 996 (darunter), dann bucht ein Bon 996 → 1006 und
    // meldet selbst den Zahltag. Der Sammler darf ihn NICHT noch einmal melden.
    await freigeben('up1', 16, 'u1', [980, 996]);
    global.__store.set('users/u1', { cashback_balance_cents: 1006 });
    await gesammelteSenden({ jetztMs: T0 + 2 * MINUTE });
    expect(global.__versand[0].notification.title).toBe('Ka-ching! 💰 +0,16 € für dich');
  });

  it('Not-Aus: nichts verschickt, Sammler bleibt für später liegen', async () => {
    global.__store.set('cashback_config/v1', { payoutThresholdCents: 1000, crowdPushAus: true });
    await freigeben('up1');
    const r = await gesammelteSenden({ jetztMs: T0 + 2 * MINUTE });
    expect(r.abgeschaltet).toBe(true);
    expect(global.__versand).toHaveLength(0);
    expect(global.__store.has(`${SAMMLER}/u1`)).toBe(true);

    // wieder eingeschaltet → geht gesammelt raus
    global.__store.set('cashback_config/v1', { payoutThresholdCents: 1000 });
    await gesammelteSenden({ jetztMs: T0 + 3 * MINUTE });
    expect(global.__versand).toHaveLength(1);
  });

  it('Payload: Ziel, Art, kein badge, Kanal cashback, push_log mit allen IDs', async () => {
    await freigeben('up1');
    await freigeben('up2');
    await gesammelteSenden({ jetztMs: T0 + 2 * MINUTE });

    const m = global.__versand[0];
    expect(m.data.deepLink).toBe('/product-submit');
    expect(m.data.kind).toBe('crowd_reward');
    expect(m.data.pushId).toMatch(/^p_/);
    // Die rote Eins, die nie wieder wegging — darf nicht zurückkommen.
    expect(m.apns.payload.aps.badge).toBeUndefined();
    // Kanal, den die App wirklich anlegt. Ein fremder Name = keine Anzeige.
    expect(m.android.notification.channelId).toBe('cashback');

    const log = global.__store.get(`push_log/${m.data.pushId}`);
    expect(log.crowdUploadIds.sort()).toEqual(['up1', 'up2']);
    expect(log.cents).toBe(32);
  });
});
