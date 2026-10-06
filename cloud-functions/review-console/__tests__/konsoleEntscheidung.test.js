'use strict';
/**
 * Prüfkonsole (index.js, reviewDecideUploads / reviewQueue) gegen einen
 * In-Memory-Firestore — die Verdrahtung der Entscheidungen Patrick vom
 * 02.10.2026:
 *  - gesperrte Konten gibt die Konsole NIE frei, auch nicht mit force,
 *  - ein Lesefehler der Sperre führt nicht zur Freigabe,
 *  - Wochen-Sperre und abweichende Barcode-Nummer blockieren ohne force,
 *  - eine Ablehnung wegen Wochen-Sperre (auch mit dem alten 30-Tage-Code einer
 *    noch nicht neu ausgerollten Oberfläche) landet als `doppelt_eingereicht`.
 */
const mockStore = new Map();
const mockLage = { sperreFehler: false };
const mockCreate = new Map(); // Dokumentpfad → Server-Zeitpunkt (createTime)
const mockSentinel = { __feld: 'serverTimestamp' };
const mockDelete = { __feld: 'delete' };

function kopie(v) {
  if (Array.isArray(v)) return v.map(kopie);
  if (v && typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, kopie(x)]));
  return v;
}
function snapshot(pfad, daten) {
  const d = daten === undefined ? undefined : kopie(daten);
  const createTime = mockCreate.has(pfad) ? { toMillis: () => mockCreate.get(pfad) } : undefined;
  return { id: pfad.split('/').pop(), exists: d !== undefined, createTime, data: () => (d === undefined ? undefined : kopie(d)), get: (f) => (d === undefined ? undefined : kopie(d[f])) };
}
function docRef(pfad) {
  return {
    path: pfad, id: pfad.split('/').pop(),
    get: async () => {
      if (pfad.startsWith('cashback_sperren/') && mockLage.sperreFehler) throw new Error('UNAVAILABLE');
      return snapshot(pfad, mockStore.get(pfad));
    },
  };
}
function query(sammlung, filter = []) {
  return {
    where: (f, op, v) => query(sammlung, [...filter, [f, op, v]]),
    select: () => query(sammlung, filter),
    limit: () => query(sammlung, filter),
    count: () => ({ get: async () => ({ data: () => ({ count: 0 }) }) }),
    get: async () => {
      if (sammlung === 'cashback_sperren' && mockLage.sperreFehler) throw new Error('UNAVAILABLE');
      const docs = [...mockStore.entries()]
        .filter(([p]) => p.startsWith(`${sammlung}/`) && p.split('/').length === 2)
        .filter(([, d]) => filter.every(([f, op, v]) => {
          const wert = f.split('.').reduce((o, k) => (o == null ? undefined : o[k]), d);
          return op === '==' ? wert === v : op === 'in' ? v.includes(wert) : true;
        }))
        .map(([p, d]) => snapshot(p, d));
      return { docs, size: docs.length, empty: !docs.length };
    },
  };
}
function anwenden(pfad, daten) {
  const neu = { ...(mockStore.get(pfad) || {}) };
  for (const [k, v] of Object.entries(kopie(daten))) {
    if (v && v.__feld === 'delete') delete neu[k];
    else neu[k] = v;
  }
  mockStore.set(pfad, neu);
}
const mockDb = {
  collection: (name) => ({ ...query(name), doc: (id) => docRef(`${name}/${id}`) }),
  doc: (pfad) => docRef(pfad),
  getAll: async (...args) => Promise.all(args.filter((a) => a && a.path).map((r) => r.get())),
  runTransaction: async (fn) => {
    const ops = [];
    const r = await fn({ get: (x) => x.get(), update: (ref, daten) => ops.push([ref.path, daten]) });
    for (const [p, d] of ops) anwenden(p, d);
    return r;
  },
};

jest.mock('firebase-admin', () => {
  const firestore = () => mockDb;
  firestore.Timestamp = { fromMillis: (t) => ({ toMillis: () => t }) };
  return { initializeApp: () => {}, firestore, storage: () => ({ bucket: () => ({ name: 'b', file: () => ({ getMetadata: async () => [{}] }) }) }) };
});
jest.mock('firebase-admin/firestore', () => ({ FieldValue: { serverTimestamp: () => mockSentinel, delete: () => mockDelete } }));
jest.mock('firebase-functions/logger', () => ({ info: () => {}, warn: () => {}, error: () => {} }));
jest.mock('firebase-functions/params', () => ({ defineSecret: () => ({ value: () => 'k' }) }));
jest.mock('firebase-functions/v2/scheduler', () => ({ onSchedule: (o, fn) => fn }));
jest.mock('firebase-functions/v2/https', () => ({
  onCall: (o, fn) => fn,
  onRequest: (o, fn) => fn,
  HttpsError: class HttpsError extends Error { constructor(code, msg) { super(msg); this.code = code; } },
}));

const konsole = require('../index');

const TAG_MS = 24 * 60 * 60 * 1000;
const T0 = Date.UTC(2026, 9, 2, 10, 0, 0);
const EAN = '4061464833821';
const ANDERE = '4000417025005';
const FOTOS = Object.fromEntries(['front', 'rueckseite', 'hersteller', 'ean', 'naehrwerte', 'zutaten', 'preis'].map((s) => [s, `crowduploads/u/x/${s}.jpg`]));
const ts = (n) => ({ toMillis: () => n });
const lege = (id, extra = {}) => mockStore.set(`crowd_uploads/${id}`, {
  userId: 'u1', ean: EAN, status: 'pending', createdAt: ts(T0), marketId: 'rewe', images: FOTOS,
  productNameOcr: 'Skyr', priceOcr: { priceCents: 129 }, manufacturerOcr: { name: 'Milsani' }, ...extra,
});
const admin = { auth: { uid: 'patrick', token: { admin: true } } };
const entscheide = (data) => konsole.reviewDecideUploads({ ...admin, data });
const doc = (id) => mockStore.get(`crowd_uploads/${id}`);

beforeEach(() => { mockStore.clear(); mockCreate.clear(); mockLage.sperreFehler = false; });

describe('Freigabe in der Prüfkonsole', () => {
  it('sauberer Fall → freigegeben', async () => {
    lege('k');
    const r = await entscheide({ ids: ['k'], decision: 'approve' });
    expect(r.results[0]).toMatchObject({ outcome: 'approved' });
    expect(doc('k').status).toBe('approved');
  });

  it('gesperrtes Konto → verweigert, AUCH mit force und Begründung', async () => {
    mockStore.set('cashback_sperren/u1', { gesperrt: true, quelle: 'Entscheidung Patrick 02.10.2026' });
    lege('k');
    const ohne = await entscheide({ ids: ['k'], decision: 'approve' });
    expect(ohne.results[0]).toEqual({ id: 'k', outcome: 'refused', reason: 'konto_gesperrt' });
    const mit = await entscheide({ ids: ['k'], decision: 'approve', force: true, note: 'ich will aber' });
    expect(mit.results[0]).toEqual({ id: 'k', outcome: 'refused', reason: 'konto_gesperrt' });
    expect(doc('k').status).toBe('pending');
  });

  it('unklarer Sperr-Eintrag (ohne gesperrt-Feld) → gesperrt wie auf der Gutschrift-Seite, verweigert auch mit force (Prüfrunde 2)', async () => {
    mockStore.set('cashback_sperren/u1', { grund: 'ohne gesperrt-Feld' });
    lege('k');
    expect((await entscheide({ ids: ['k'], decision: 'approve', force: true, note: 'x x x' })).results[0]).toMatchObject({ outcome: 'refused', reason: 'konto_gesperrt' });
  });

  it('Sperre nicht lesbar → keine Freigabe (Fehler statt Freigabe)', async () => {
    mockLage.sperreFehler = true;
    lege('k');
    const r = await entscheide({ ids: ['k'], decision: 'approve', force: true, note: 'trotzdem' });
    expect(r.results[0].outcome).toBe('error');
    expect(doc('k').status).toBe('pending');
  });

  it('Wochen-Sperre: eigene Freigabe 3 Tage vorher mit anderem Preis → blockiert, mit force + Notiz möglich', async () => {
    lege('alt', { status: 'approved', createdAt: ts(T0 - 3 * TAG_MS), priceOcr: { priceCents: 99 }, marketId: 'netto' });
    lege('k');
    const r = await entscheide({ ids: ['k'], decision: 'approve' });
    expect(r.results[0]).toMatchObject({ outcome: 'blocked', reason: 'sperre_woche_gleicher_nutzer' });
    const f = await entscheide({ ids: ['k'], decision: 'approve', force: true, note: 'Patrick: neues Rezept' });
    expect(f.results[0].outcome).toBe('approved');
    expect(doc('k').review).toMatchObject({ forced: true, forcedNote: 'Patrick: neues Rezept' });
  });

  it('Barcode-Foto zeigt andere Nummer → blockiert (ein Mensch entscheidet mit Begründung)', async () => {
    lege('k', { eanFotoOcr: { ean: ANDERE, befund: 'abweichend' } });
    const r = await entscheide({ ids: ['k'], decision: 'approve' });
    expect(r.results[0]).toMatchObject({ outcome: 'blocked', reason: 'ean_abweichend' });
  });

  it('zwei Lesungen der Runde uneinig → blockiert als ean_unsicher', async () => {
    lege('k', { eanFotoOcr: { ean: ANDERE, befund: 'unsicher', zweit: null } });
    const r = await entscheide({ ids: ['k'], decision: 'approve' });
    expect(r.results[0]).toMatchObject({ outcome: 'blocked', reason: 'ean_unsicher' });
  });

  it('Wochen-Sperre über eine andere Schreibweise derselben GTIN („0" + EAN-13) → blockiert (Prüfrunde 02.10.)', async () => {
    lege('alt', { status: 'approved', createdAt: ts(T0 - 2 * TAG_MS) });
    lege('k', { ean: '0' + EAN });
    const r = await entscheide({ ids: ['k'], decision: 'approve' });
    expect(r.results[0]).toMatchObject({ outcome: 'blocked', reason: 'sperre_woche_gleicher_nutzer' });
    // und umgekehrt, auch über die nachgelesene EAN
    mockStore.clear();
    lege('alt', { status: 'approved', createdAt: ts(T0 - 2 * TAG_MS), ean: null, eanRescueOcr: '0' + EAN });
    lege('k');
    expect((await entscheide({ ids: ['k'], decision: 'approve' })).results[0]).toMatchObject({ outcome: 'blocked', reason: 'sperre_woche_gleicher_nutzer' });
  });

  it('verschobenes createdAt hebt die Wochen-Sperre nicht auf: es gilt der Server-Zeitpunkt (Prüfrunde 02.10.)', async () => {
    lege('alt', { status: 'approved', createdAt: ts(T0 - 2 * TAG_MS) });
    lege('k', { createdAt: ts(T0 - 40 * TAG_MS) });
    mockCreate.set('crowd_uploads/k', T0);
    const r = await entscheide({ ids: ['k'], decision: 'approve' });
    expect(r.results[0]).toMatchObject({ outcome: 'blocked', reason: 'sperre_woche_gleicher_nutzer' });
  });
});

describe('Ablehnung in der Prüfkonsole: Code am Dokument für die App', () => {
  it('Wochen-Sperre → rejectReason doppelt_eingereicht, gewählter Grund in review.reason, Frist gesetzt', async () => {
    lege('alt', { status: 'approved', createdAt: ts(T0 - 2 * TAG_MS) });
    lege('k');
    await entscheide({ ids: ['k'], decision: 'reject', reason: 'sperre_woche_gleicher_nutzer' });
    expect(doc('k')).toMatchObject({ status: 'rejected', rejectReason: 'doppelt_eingereicht', holdReasons: ['doppelt_eingereicht'] });
    expect(doc('k').review).toMatchObject({ reason: 'sperre_woche_gleicher_nutzer', lockUntil: T0 - 2 * TAG_MS + 7 * TAG_MS });
  });

  it('alter 30-Tage-Code aus einer noch nicht neu ausgerollten Oberfläche → ebenfalls doppelt_eingereicht', async () => {
    lege('k');
    await entscheide({ ids: ['k'], decision: 'reject', reason: 'sperre_30_tage_gleicher_nutzer' });
    expect(doc('k')).toMatchObject({ rejectReason: 'doppelt_eingereicht', review: { reason: 'sperre_30_tage_gleicher_nutzer' } });
  });

  it('andere Gründe bleiben unverändert', async () => {
    lege('k');
    await entscheide({ ids: ['k'], decision: 'reject', reason: 'unvollstaendig' });
    expect(doc('k').rejectReason).toBe('unvollstaendig');
  });
});

describe('Warteschlange', () => {
  it('zeigt gesperrte Konten als gesperrt (am Ende), unabhängig vom EAN-Zwischenspeicher', async () => {
    lege('k');
    lege('j', { userId: 'u2', ean: ANDERE, createdAt: ts(T0 + 1000) });
    mockStore.set('cashback_sperren/u1', { gesperrt: true });
    const r = await konsole.reviewQueue({ ...admin, data: { type: 'photos' } });
    expect(r.rows.map((x) => x.id)).toEqual(['j', 'k']);
    expect(r.rows[1]).toMatchObject({ id: 'k', verdict: 'locked', reasons: ['konto_gesperrt'], gesperrt: true });
    expect(r.rows[0].verdict).toBe('ok');
    expect(r.counts.gesperrt).toBe(1);
  });
});

describe('Fallansicht (reviewGetUpload): Nachbarn in jeder Schreibweise', () => {
  it('Freigabe unter „0" + EAN-13 ist Nachbar und Referenz der Wochen-Sperre', async () => {
    lege('alt', { status: 'approved', createdAt: ts(T0 - 2 * TAG_MS), ean: '0' + EAN });
    lege('k');
    const r = await konsole.reviewGetUpload({ ...admin, data: { id: 'k' } });
    expect(r.sameEan.map((x) => x.id)).toEqual(['alt']);
    expect(r.precheck).toMatchObject({ verdict: 'locked', dup: { priorId: 'alt' } });
    expect(r.prior.id).toBe('alt');
  });
});

describe('Befunde der Morgenrunde (review.rundeOffen, Prüfrunde 2, 02.10.2026)', () => {
  const rundeOffen = (code, extra = {}) => ({ review: { rundeOffen: { grund: code, hinweis: 'Gleiches Foto bei anderem Konto: x', sperrend: [code], lauf: '2026-10-02_080000', trocken: false, ...extra } } });

  it('Foto eines anderen Kontos: ohne force blockiert — mit force + Notiz freigegeben, der Eintrag geht mit', async () => {
    lege('k', rundeOffen('foto_fremdes_konto'));
    const r = await entscheide({ ids: ['k'], decision: 'approve' });
    expect(r.results[0]).toMatchObject({ outcome: 'blocked', reason: 'foto_fremdes_konto' });
    expect(doc('k').status).toBe('pending');
    // force ohne Notiz lehnt der Server ab
    await expect(entscheide({ ids: ['k'], decision: 'approve', force: true })).rejects.toThrow(/Notiz/);
    const f = await entscheide({ ids: ['k'], decision: 'approve', force: true, note: 'Familienkonto, gleiches Foto geteilt' });
    expect(f.results[0].outcome).toBe('approved');
    expect(doc('k').review).toMatchObject({ forced: true, forcedNote: 'Familienkonto, gleiches Foto geteilt', precheck: { verdict: 'hold', reasons: ['foto_fremdes_konto'] } });
    expect(doc('k').review.rundeOffen).toBeUndefined();
  });

  it('jeder sperrende Befund blockiert ohne force', async () => {
    for (const code of ['foto_aeltere_offen', 'bilder_wiederverwendet', 'ean_abweichend', 'ean_unsicher']) {
      mockStore.clear();
      lege('k', rundeOffen(code));
      expect((await entscheide({ ids: ['k'], decision: 'approve' })).results[0]).toMatchObject({ outcome: 'blocked', reason: code });
    }
  });

  it('Barcode-Befund nur in rundeOffen (eanFotoOcr nicht gespeichert) → trotzdem blockiert', async () => {
    lege('k', rundeOffen('ean_abweichend', { eanFoto: { befund: 'abweichend', ean: ANDERE, bestaetigt: true } }));
    expect(doc('k').eanFotoOcr).toBeUndefined();
    expect((await entscheide({ ids: ['k'], decision: 'approve' })).results[0]).toMatchObject({ outcome: 'blocked', reason: 'ean_abweichend' });
  });

  it('gespeicherter Barcode-Befund mit ungültiger erster Lesung → blockiert als ean_unsicher', async () => {
    lege('k', { eanFotoOcr: { ean: '4013602313647', befund: 'unsicher', zweit: null } });
    expect((await entscheide({ ids: ['k'], decision: 'approve' })).results[0]).toMatchObject({ outcome: 'blocked', reason: 'ean_unsicher' });
  });

  it('nur Information (z. B. Bildprüfung gescheitert) → Freigabe ohne force möglich', async () => {
    lege('k', rundeOffen('bild_audit_gescheitert', { sperrend: [] }));
    expect((await entscheide({ ids: ['k'], decision: 'approve' })).results[0].outcome).toBe('approved');
  });

  // Nachprüfung 06.10.2026: die Sperre der Morgenrunde gegen eine automatische
  // Ablehnung (Bildschirmfoto/Preisbeleg) gilt nur für die Runde. Die Konsole
  // zeigt dazu keinen Hinweis, gibt ohne Notiz frei, und jede Entscheidung
  // nimmt sie mit — danach entscheidet ein Mensch, nicht mehr die Runde.
  it('Sperre der Runde gegen eine Ablehnung: kein Hinweis, Freigabe ohne force, die Entscheidung nimmt sie mit', async () => {
    const sperre = { preisBildschirm: { ablehnenGesperrt: true, gesperrtSeit: '2026-10-05_080000' } };
    lege('f', rundeOffen('ort_auffaellig', { sperrend: [], ...sperre }));
    lege('a', rundeOffen('ort_auffaellig', { sperrend: [], ...sperre }));
    const q = await konsole.reviewQueue({ ...admin, data: { type: 'photos' } });
    for (const id of ['f', 'a']) expect(q.rows.find((r) => r.id === id).verdict).toBe('ok');
    const c = await konsole.reviewCases({ ...admin, data: { type: 'photos', ids: ['f'] } });
    expect(c.cases[0].precheck.hinweise.filter((h) => h.startsWith('preis_bildschirm') || h.startsWith('preis_beleg'))).toEqual([]);
    expect(c.cases[0].row.rundeOffen).not.toHaveProperty('preisBildschirm');
    expect((await entscheide({ ids: ['f'], decision: 'approve' })).results[0].outcome).toBe('approved');
    expect(doc('f').review.rundeOffen).toBeUndefined();
    await entscheide({ ids: ['a'], decision: 'reject', reason: 'fotos_unpassend' });
    expect(doc('a').status).toBe('rejected');
    expect(doc('a').review.rundeOffen).toBeUndefined();
  });

  // Entscheidung Patrick 06.10.2026: Fälle der Bildschirm-Notbremse liegen,
  // bis ein Mensch sie entscheidet — die Runde lehnt sie nie mehr selbst ab.
  // Die Konsole bleibt frei: Freigabe ohne force, Ablehnung, „Zurückstellen"
  // lässt Merker und Sperre stehen.
  it('Fall der Bildschirm-Notbremse (Merker + Sperre): Freigabe ohne force, Ablehnung möglich, „Zurückstellen" lässt die Sperre stehen', async () => {
    const pbSperre = { modus: true, befund: 'halten', seit: '2026-10-05_080000', regeln: ['bildschirm'], ablehnenGesperrt: true, gesperrtSeit: '2026-10-05_080000' };
    const nb = (grund) => rundeOffen(grund, { sperrend: [], hinweis: null, notbremseEcht: 'notbremse_preis_bildschirm', preisBildschirm: pbSperre });
    lege('f', nb('preis_bildschirm_unsicher'));
    lege('a', nb('notbremse_preis_bildschirm'));
    lege('h', nb('preis_bildschirm_unsicher'));
    expect((await entscheide({ ids: ['f'], decision: 'approve' })).results[0].outcome).toBe('approved');
    expect(doc('f').review.rundeOffen).toBeUndefined();
    await entscheide({ ids: ['a'], decision: 'reject', reason: 'fotos_unpassend' });
    expect(doc('a')).toMatchObject({ status: 'rejected', rejectReason: 'fotos_unpassend' });
    expect(doc('a').review.rundeOffen).toBeUndefined();
    await entscheide({ ids: ['h'], decision: 'hold', reason: 'nachfragen' });
    expect(doc('h')).toMatchObject({ status: 'pending', review: { rundeOffen: { notbremseEcht: 'notbremse_preis_bildschirm', preisBildschirm: { ablehnenGesperrt: true } } } });
  });

  it('Ablehnung nimmt den Eintrag mit; „Zurückstellen" (hold) lässt ihn stehen', async () => {
    lege('a', rundeOffen('foto_fremdes_konto'));
    lege('h', rundeOffen('foto_fremdes_konto'));
    await entscheide({ ids: ['a'], decision: 'reject', reason: 'bilder_wiederverwendet' });
    expect(doc('a').review.rundeOffen).toBeUndefined();
    await entscheide({ ids: ['h'], decision: 'hold', reason: 'nachfragen' });
    expect(doc('h').review.rundeOffen).toMatchObject({ sperrend: ['foto_fremdes_konto'] });
  });

  it('Warteschlange und Fallansicht zeigen „zurückhalten" mit dem Grund der Runde', async () => {
    lege('k', rundeOffen('foto_fremdes_konto'));
    const q = await konsole.reviewQueue({ ...admin, data: { type: 'photos' } });
    expect(q.rows[0]).toMatchObject({ id: 'k', verdict: 'hold', reasons: ['foto_fremdes_konto'] });
    const c = await konsole.reviewCases({ ...admin, data: { type: 'photos', ids: ['k'] } });
    expect(c.cases[0].precheck).toMatchObject({ verdict: 'hold', reasons: ['foto_fremdes_konto'], quelle: 'frisch' });
    expect(c.cases[0].row.rundeOffen).toMatchObject({ grund: 'foto_fremdes_konto', hinweis: 'Gleiches Foto bei anderem Konto: x', sperrend: ['foto_fremdes_konto'] });
    const g = await konsole.reviewGetUpload({ ...admin, data: { id: 'k' } });
    expect(g.precheck).toMatchObject({ verdict: 'hold', reasons: ['foto_fremdes_konto'] });
  });
});

describe('Schlussprüfung 03.10.2026: Zurückholen und Referenz-ID', () => {
  it('Zurückholen einer Runden-Ablehnung „wiederverwendet" behält den Grund — danach Freigabe nur mit force + Notiz', async () => {
    lege('k', { status: 'rejected', rejectReason: 'bilder_wiederverwendet', holdReasons: ['bilder_wiederverwendet'], reviewedBy: 'worker-fotorunde', review: { decidedBy: 'worker-fotorunde', reason: 'bilder_wiederverwendet', lauf: '2026-10-02_080000' } });
    const r = await entscheide({ ids: ['k'], decision: 'reopen' });
    expect(r.results[0].outcome).toBe('reopened');
    expect(doc('k')).toMatchObject({ status: 'pending', review: { reopenedBy: 'patrick', wiedereroeffnet: { vorherGrund: 'bilder_wiederverwendet', vorherIntern: 'bilder_wiederverwendet', vorherVon: 'worker-fotorunde' } } });
    expect(doc('k').rejectReason).toBeUndefined();
    const ohne = await entscheide({ ids: ['k'], decision: 'approve' });
    expect(ohne.results[0]).toMatchObject({ outcome: 'blocked', reason: 'zurueckgeholt_doppel' });
    expect(doc('k').status).toBe('pending');
    const mit = await entscheide({ ids: ['k'], decision: 'approve', force: true, note: 'eigene neue Fotos, nur gleicher Hintergrund' });
    expect(mit.results[0].outcome).toBe('approved');
    expect(doc('k').review).toMatchObject({ forced: true, precheck: { verdict: 'hold', reasons: ['zurueckgeholt_doppel'] } });
  });

  it('… Wochen-Sperre (am Dokument doppelt_eingereicht) ebenso; ein behebbarer Grund hält nicht', async () => {
    lege('w', { status: 'rejected', rejectReason: 'doppelt_eingereicht', review: { decidedBy: 'worker-fotorunde', reason: 'sperre_woche_gleicher_nutzer' } });
    await entscheide({ ids: ['w'], decision: 'reopen' });
    expect(doc('w').review.wiedereroeffnet).toMatchObject({ vorherGrund: 'doppelt_eingereicht', vorherIntern: 'sperre_woche_gleicher_nutzer' });
    expect((await entscheide({ ids: ['w'], decision: 'approve' })).results[0]).toMatchObject({ outcome: 'blocked', reason: 'zurueckgeholt_doppel' });
    lege('u', { userId: 'u2', ean: ANDERE, status: 'rejected', rejectReason: 'unvollstaendig', review: { decidedBy: 'patrick', reason: 'unvollstaendig' } });
    await entscheide({ ids: ['u'], decision: 'reopen' });
    expect((await entscheide({ ids: ['u'], decision: 'approve' })).results[0].outcome).toBe('approved');
  });

  it('Freigabe mit FREMDER Referenz derselben EAN: am Dokument keine fremde Referenz-ID', async () => {
    lege('u9_fremd', { userId: 'u9', status: 'approved', createdAt: ts(T0 - 40 * TAG_MS) });
    lege('u1_k');
    const r = await entscheide({ ids: ['u1_k'], decision: 'approve' });
    expect(r.results[0].outcome).toBe('approved');
    expect(doc('u1_k').review.precheck.dup).toMatchObject({ verdict: 'ok', priorId: null, sameUser: false });
    expect(JSON.stringify(doc('u1_k').review)).not.toContain('u9');
  });
});

describe('Barcode-Korrektur der Morgenrunde in der Konsole (Entscheidung Patrick 06.10.2026)', () => {
  // gespeichert EAN (Scanner), korrigiert ANDERE (Foto, zweimal gleich)
  const korrektur = { eanKorrektur: { ean: ANDERE, vorher: EAN, lesungen: [ANDERE, ANDERE], aus: 'heute', lauf: 'L1', zeuge: { art: 'striche', gelesen: [ANDERE] } }, eanFotoOcr: { ean: ANDERE, befund: 'korrigiert', vorher: EAN } };

  it('korrigierte Einreichung ohne Doppel → Freigabe ohne force', async () => {
    lege('k', korrektur);
    const r = await entscheide({ ids: ['k'], decision: 'approve' });
    expect(r.results[0]).toMatchObject({ outcome: 'approved', precheck: { verdict: 'ok', reasons: [] } });
  });

  it('eigene Freigabe unter der GESPEICHERTEN (alten) Nummer binnen 7 Tagen → blockiert (ean_alt_doppelt), mit force + Notiz frei', async () => {
    lege('alt', { status: 'approved', createdAt: ts(T0 - 2 * TAG_MS) });
    lege('k', korrektur);
    const ohne = await entscheide({ ids: ['k'], decision: 'approve' });
    expect(ohne.results[0]).toMatchObject({ outcome: 'blocked', reason: 'ean_alt_doppelt' });
    expect(doc('k').status).toBe('pending');
    const mit = await entscheide({ ids: ['k'], decision: 'approve', force: true, note: 'anderes Produkt, Scanner hat falsch gelesen' });
    expect(mit.results[0].outcome).toBe('approved');
  });

  it('eigene Freigabe, deren EAN NUR über eine Korrektur stimmt (eanKorrektur.ean), sperrt die Freigabe unter der korrigierten Nummer', async () => {
    lege('frueher', { ean: '4001382088125', eanKorrektur: { ean: ANDERE, vorher: '4001382088125', zeuge: { art: 'striche', gelesen: [ANDERE] } }, status: 'approved', createdAt: ts(T0 - 2 * TAG_MS) });
    lege('k', { ean: ANDERE });
    const r = await entscheide({ ids: ['k'], decision: 'approve' });
    expect(r.results[0]).toMatchObject({ outcome: 'blocked', reason: 'sperre_woche_gleicher_nutzer' });
  });

  it('… eine eigene, von DIESER Nummer weg korrigierte Freigabe dieser Woche sperrt nicht unter der effektiven EAN, hält aber an (ean_alt_doppelt, Prüfrunde 06.10.)', async () => {
    // frueher: gespeichert EAN, korrigiert auf eine andere — k: wieder EAN, Foto ohne Befund.
    // Ohne die Korrektur von `frueher` wäre k gesperrt; durch sie darf k nicht durchrutschen.
    lege('frueher', { ean: EAN, eanKorrektur: { ean: '4001382088125', vorher: EAN, zeuge: { art: 'striche', gelesen: ['4001382088125'] } }, status: 'approved', createdAt: ts(T0 - 2 * TAG_MS) });
    lege('k');
    const r = await entscheide({ ids: ['k'], decision: 'approve' });
    expect(r.results[0]).toMatchObject({ outcome: 'blocked', reason: 'ean_alt_doppelt', precheck: { dup: { verdict: 'ok' }, dupAlt: { verdict: 'locked', priorId: 'frueher' } } });
    expect(doc('k').status).toBe('pending');
  });

  it('… dieselbe Lage bei einem FREMDEN Konto → frei (fremde Einreichungen sperren nicht, 20.09.)', async () => {
    lege('frueher', { userId: 'u2', ean: EAN, eanKorrektur: { ean: '4001382088125', vorher: EAN, zeuge: { art: 'striche', gelesen: ['4001382088125'] } }, status: 'approved', createdAt: ts(T0 - 2 * TAG_MS) });
    lege('k');
    expect((await entscheide({ ids: ['k'], decision: 'approve' })).results[0].outcome).toBe('approved');
  });

  it('… beide von derselben alten Nummer weg korrigiert (auf VERSCHIEDENE Nummern) → hält an (ean_alt_doppelt)', async () => {
    lege('frueher', { ean: EAN, eanKorrektur: { ean: '4001382088125', vorher: EAN, zeuge: { art: 'striche', gelesen: ['4001382088125'] } }, status: 'approved', createdAt: ts(T0 - 2 * TAG_MS) });
    lege('k', korrektur);
    const r = await entscheide({ ids: ['k'], decision: 'approve' });
    expect(r.results[0]).toMatchObject({ outcome: 'blocked', reason: 'ean_alt_doppelt' });
  });

  it('Warteschlange und Fallansicht zeigen die korrigierte Nummer und halten bei Doppel unter der alten', async () => {
    lege('alt', { status: 'approved', createdAt: ts(T0 - 2 * TAG_MS) });
    lege('k', korrektur);
    // Am EAN-Zwischenspeicher der Warteschlange (2 min) vorbei — sonst gälte der Index eines früheren Tests.
    const spaeter = Date.now() + 10 * 60 * 1000;
    const spy = jest.spyOn(Date, 'now').mockReturnValue(spaeter);
    try {
      const q = await konsole.reviewQueue({ ...admin, data: { type: 'photos' } });
      expect(q.rows.find((x) => x.id === 'k')).toMatchObject({ ean: ANDERE, eanKorrigiert: true, verdict: 'hold', reasons: ['ean_alt_doppelt'] });
    } finally { spy.mockRestore(); }
    const f = await konsole.reviewGetUpload({ ...admin, data: { id: 'k' } });
    expect(f.row).toMatchObject({ ean: EAN, anzeigeEan: ANDERE, eanKorrektur: { ean: ANDERE, vorher: EAN } });
    expect(f.precheck).toMatchObject({ verdict: 'hold', reasons: ['ean_alt_doppelt'], dupAlt: { verdict: 'locked', priorId: 'alt' } });
    const c = await konsole.reviewCases({ ...admin, data: { type: 'photos', ids: ['k'] } });
    expect(c.cases[0].precheck).toMatchObject({ verdict: 'hold', reasons: ['ean_alt_doppelt'] });
  });
});

describe('Rückweg: Barcode-Korrektur verwerfen (Prüfrunde 06.10.2026)', () => {
  const korrektur = { eanKorrektur: { ean: ANDERE, vorher: EAN, lesungen: [ANDERE, ANDERE], aus: 'heute', lauf: 'L1', zeuge: { art: 'striche', gelesen: [ANDERE] } }, eanFotoOcr: { ean: ANDERE, befund: 'korrigiert', vorher: EAN } };
  const verwerfen = (id, note = 'Scanner-Nummer stimmt, Foto zeigt Umverpackung') => entscheide({ ids: [id], decision: 'ean_korrektur_verwerfen', note });

  it('offene Einreichung: setzt nur den Vermerk (Audit bleibt), entscheidet nichts; danach hält die Konsole an der Foto-Abweichung (force + Notiz)', async () => {
    lege('k', korrektur);
    const r = await verwerfen('k');
    expect(r.results[0]).toMatchObject({ outcome: 'korrektur_verworfen', ean: ANDERE });
    expect(doc('k')).toMatchObject({ status: 'pending', ean: EAN, eanKorrektur: { ean: ANDERE, vorher: EAN } });
    expect(doc('k').eanKorrekturVerworfen).toMatchObject({ by: 'patrick', notiz: 'Scanner-Nummer stimmt, Foto zeigt Umverpackung', ean: ANDERE, vorher: EAN, status: 'pending', at: mockSentinel });
    const f = await konsole.reviewGetUpload({ ...admin, data: { id: 'k' } });
    expect(f.row).toMatchObject({ anzeigeEan: EAN, eanKorrektur: null, eanKorrekturVerworfen: { ean: ANDERE, vorher: EAN } });
    const ohne = await entscheide({ ids: ['k'], decision: 'approve' });
    expect(ohne.results[0]).toMatchObject({ outcome: 'blocked', reason: 'ean_abweichend' });
    const mit = await entscheide({ ids: ['k'], decision: 'approve', force: true, note: 'gespeicherte Nummer geprüft' });
    expect(mit.results[0].outcome).toBe('approved');
  });

  it('nur mit Notiz und nur für EINE Einreichung; ohne gültige Korrektur bzw. zweimal → nichts geändert', async () => {
    lege('k', korrektur);
    lege('k2', korrektur);
    await expect(entscheide({ ids: ['k'], decision: 'ean_korrektur_verwerfen' })).rejects.toMatchObject({ code: 'invalid-argument' });
    await expect(entscheide({ ids: ['k'], decision: 'ean_korrektur_verwerfen', note: ' x ' })).rejects.toMatchObject({ code: 'invalid-argument' });
    await expect(entscheide({ ids: ['k', 'k2'], decision: 'ean_korrektur_verwerfen', note: 'stimmt so' })).rejects.toMatchObject({ code: 'invalid-argument' });
    expect(doc('k').eanKorrekturVerworfen).toBeUndefined();
    lege('ohne');
    expect((await verwerfen('ohne')).results[0]).toMatchObject({ outcome: 'skipped', reason: 'keine_korrektur' });
    await verwerfen('k');
    const vorher = doc('k').eanKorrekturVerworfen;
    expect((await verwerfen('k', 'nochmal')).results[0]).toMatchObject({ outcome: 'skipped', reason: 'schon_verworfen' });
    expect(doc('k').eanKorrekturVerworfen).toEqual(vorher);
  });

  it('auch nach einer FREIGABE: danach zählt die gespeicherte Nummer für die Wochen-Sperre künftiger Einreichungen', async () => {
    lege('frei', { ...korrektur, status: 'approved', createdAt: ts(T0 - 2 * TAG_MS) });
    lege('neu', { createdAt: ts(T0) });
    // vorher: nur über die alte Nummer verwandt → angehalten (ean_alt_doppelt), nicht gesperrt
    expect((await entscheide({ ids: ['neu'], decision: 'approve' })).results[0]).toMatchObject({ outcome: 'blocked', reason: 'ean_alt_doppelt' });
    expect((await verwerfen('frei')).results[0].outcome).toBe('korrektur_verworfen');
    expect(doc('frei').status).toBe('approved');
    expect((await entscheide({ ids: ['neu'], decision: 'approve' })).results[0]).toMatchObject({ outcome: 'blocked', reason: 'sperre_woche_gleicher_nutzer' });
  });

  it('… und eine eigene Einreichung mit der VERWORFENEN Foto-Nummer hält (ean_alt_doppelt) — gleich, ob dazwischen eine Runde lief (Prüfrunde 1 zur Barcode-Korrektur)', async () => {
    lege('frei', { ...korrektur, status: 'approved', createdAt: ts(T0 - 2 * TAG_MS) });
    expect((await verwerfen('frei')).results[0].outcome).toBe('korrektur_verworfen');
    expect(doc('frei').eanFotoOcr).toMatchObject({ befund: 'korrigiert' }); // keine Runde dazwischen
    lege('neu', { ean: ANDERE, createdAt: ts(T0) });
    expect((await entscheide({ ids: ['neu'], decision: 'approve' })).results[0]).toMatchObject({ outcome: 'blocked', reason: 'ean_alt_doppelt' });
    expect(doc('neu').status).toBe('pending');
  });

  it('Warteschlange: eine verworfene Korrektur zählt im EAN-Index nicht mehr (Feld im select)', async () => {
    lege('frei', { ...korrektur, status: 'approved', createdAt: ts(T0 - 2 * TAG_MS), eanKorrekturVerworfen: { by: 'patrick', notiz: 'stimmt' } });
    lege('neu', { ean: ANDERE, createdAt: ts(T0) });
    const spy = jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 20 * 60 * 1000);
    try {
      const q = await konsole.reviewQueue({ ...admin, data: { type: 'photos' } });
      // unter ANDERE gibt es keine eigene Freigabe mehr — die Korrektur von `frei` ist verworfen,
      // also keine Wochen-Sperre (ohne das Feld im select stünde hier `locked`). Die verworfene
      // Foto-Nummer gehört aber weiter zu den Nummern der Freigabe (werte.eanFotoFreigegebenOf,
      // Prüfrunde 1 zur Barcode-Korrektur) → Halt `ean_alt_doppelt`, wie in der Morgenrunde.
      expect(q.rows.find((x) => x.id === 'neu')).toMatchObject({ ean: ANDERE, verdict: 'hold', reasons: ['ean_alt_doppelt'] });
    } finally { spy.mockRestore(); }
  });
});

describe('Prüfrunde 06.10.2026 (Runde 3): Freigabe mit bestätigt abweichender Foto-Nummer, Strichcode-Zeuge', () => {
  // Kartoffel Knödel (ecL21IfZ…_1): gespeichert 070012398358, Foto zweimal 4012448397358, am 05.10. mit force freigegeben.
  const K = '070012398358';
  const FK = '4012448397358';
  const frei = (extra = {}) => lege('frei', {
    ean: K, status: 'approved', createdAt: ts(T0 - 2 * TAG_MS),
    eanFotoOcr: { ean: FK, befund: 'abweichend', bestaetigt: true, lauf: '2026-10-05_080000' }, ...extra,
  });

  it('neue eigene Einreichung mit der Foto-Nummer binnen 7 Tagen → angehalten (ean_alt_doppelt), nie abgelehnt; mit force + Notiz frei', async () => {
    frei();
    lege('k', { ean: FK });
    const ohne = await entscheide({ ids: ['k'], decision: 'approve' });
    expect(ohne.results[0]).toMatchObject({ outcome: 'blocked', reason: 'ean_alt_doppelt', precheck: { dup: { verdict: 'ok' }, dupAlt: { verdict: 'locked', priorId: 'frei' } } });
    expect(doc('k').status).toBe('pending');
    const f = await konsole.reviewGetUpload({ ...admin, data: { id: 'k' } });
    expect(f.precheck).toMatchObject({ verdict: 'hold', reasons: ['ean_alt_doppelt'] });
    const mit = await entscheide({ ids: ['k'], decision: 'approve', force: true, note: 'anderes Produkt geprüft' });
    expect(mit.results[0].outcome).toBe('approved');
  });

  it('… fremdes Konto, Foto-Nummer unbestätigt oder Einreichung nicht freigegeben → kein Halt', async () => {
    for (const extra of [
      { userId: 'u2' },
      { eanFotoOcr: { ean: FK, befund: 'abweichend', bestaetigt: false, lauf: 'L' } },
      { status: 'pending' },
    ]) {
      mockStore.clear();
      frei(extra);
      lege('k', { ean: FK, createdAt: ts(T0 + 1000) });
      const r = await entscheide({ ids: ['k'], decision: 'approve' });
      expect(r.results[0].outcome).not.toBe('blocked');
    }
  });

  it('Warteschlange hält ebenso (Index liest eanFotoOcr mit)', async () => {
    frei();
    lege('k', { ean: FK });
    // Am EAN-Zwischenspeicher (2 min) der früheren Tests vorbei — die stellen die Uhr bis +20 min.
    const spy = jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 60 * 60 * 1000);
    try {
      const q = await konsole.reviewQueue({ ...admin, data: { type: 'photos' } });
      expect(q.rows.find((x) => x.id === 'k')).toMatchObject({ verdict: 'hold', reasons: ['ean_alt_doppelt'] });
    } finally { spy.mockRestore(); }
  });

  it('Fallansicht zeigt den Strichcode-Zeugen der Korrektur; eine Korrektur ohne Zeugen gilt nicht', async () => {
    const korr = { ean: ANDERE, vorher: EAN, lesungen: [ANDERE, ANDERE], aus: 'heute', lauf: 'L1' };
    lege('k', { eanKorrektur: { ...korr, zeuge: { art: 'striche', gelesen: [ANDERE], leser: 'zxing-wasm 2.2.4' } } });
    const f = await konsole.reviewGetUpload({ ...admin, data: { id: 'k' } });
    expect(f.row).toMatchObject({ anzeigeEan: ANDERE, eanKorrektur: { ean: ANDERE, vorher: EAN, zeuge: { gelesen: [ANDERE], leser: 'zxing-wasm 2.2.4' } } });
    lege('ohne', { eanKorrektur: korr });
    const g = await konsole.reviewGetUpload({ ...admin, data: { id: 'ohne' } });
    expect(g.row).toMatchObject({ anzeigeEan: EAN, eanKorrektur: null });
  });
});
