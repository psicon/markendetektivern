'use strict';

/**
 * Gast-Übernahme Stufe 1 — Ticket vorbereiten und einlösen, Auszahlungs-
 * Schranke (siehe lib/gastUebernahme.js).
 */

const {
  erstelleGastUebernahme,
  kontoPruefen,
  tokenPruefen,
  sha256Hex,
  hashPasst,
  GUELTIG_MS,
  MAX_VORBEREITUNGEN_PRO_TAG,
  MAX_VERSUCHE_PRO_STUNDE,
} = require('../lib/gastUebernahme');

// 25.09.2026, 10:00 UTC (= 12:00 Berlin)
const T0 = Date.UTC(2026, 8, 25, 10, 0, 0);
const TAG_MS = 24 * 60 * 60 * 1000;
const ts = (ms) => ({ toMillis: () => ms, __ms: ms });

const GAST = 'gastAAAAAAAAAAAAAAAAAAAAAAAA';
const ZIEL = 'zielBBBBBBBBBBBBBBBBBBBBBBBB';
const GEHEIMNIS = 'k3yQ9x_-abcdefghijklmnopqrstuvwxyz0123456789'; // 43 Zeichen wie in der App
const HASH = sha256Hex(GEHEIMNIS);

const gast = { uid: GAST, disabled: false, providerData: [] };
const konto = { uid: ZIEL, disabled: false, providerData: [{ providerId: 'password' }], email: 'b@example.org' };

/** Firestore-merge: Maps werden zusammengeführt, alles andere ersetzt. */
function zusammenfuehren(alt, neu) {
  const out = { ...(alt || {}) };
  for (const [k, v] of Object.entries(neu)) {
    const istMap = v && typeof v === 'object' && !Array.isArray(v) && typeof v.toMillis !== 'function';
    out[k] = istMap && out[k] && typeof out[k] === 'object' ? zusammenfuehren(out[k], v) : v;
  }
  return out;
}

/** Minimale Firestore-/Auth-Nachbildung mit Schreibprotokoll. */
function welt({ docs = {}, nutzer = {}, config = {}, configFehler = false, getUserFehler = null } = {}) {
  const store = new Map(Object.entries(docs));
  const schreibvorgaenge = [];
  const logs = [];
  let jetzt = T0;

  const ref = (pfad) => ({
    pfad,
    async get() {
      const d = store.get(pfad);
      return { exists: d !== undefined, data: () => d };
    },
  });
  const db = {
    collection: (name) => ({ doc: (id) => ref(`${name}/${id}`) }),
    async runTransaction(fn) {
      return fn({
        get: (r) => r.get(),
        set(r, felder, opts) {
          schreibvorgaenge.push({ pfad: r.pfad, felder });
          store.set(r.pfad, opts && opts.merge ? zusammenfuehren(store.get(r.pfad), felder) : { ...felder });
        },
        update(r, felder) {
          schreibvorgaenge.push({ pfad: r.pfad, felder });
          store.set(r.pfad, { ...store.get(r.pfad), ...felder });
        },
      });
    },
  };
  const authAufrufe = [];
  const admin = {
    firestore: { Timestamp: { fromMillis: (ms) => ts(ms), now: () => ts(jetzt) } },
    auth: () => ({
      async getUser(uid) {
        authAufrufe.push(['getUser', uid]);
        if (getUserFehler) throw getUserFehler;
        if (!nutzer[uid]) throw Object.assign(new Error('no user'), { code: 'auth/user-not-found' });
        return nutzer[uid];
      },
      async updateUser(...a) {
        authAufrufe.push(['updateUser', ...a]);
      },
      async revokeRefreshTokens(...a) {
        authAufrufe.push(['revokeRefreshTokens', ...a]);
      },
    }),
  };
  const logger = {
    info: (...a) => logs.push(['info', ...a]),
    warn: (...a) => logs.push(['warn', ...a]),
    error: (...a) => logs.push(['error', ...a]),
  };
  const loadConfig = async (opts) => {
    if (configFehler) {
      if (opts && opts.strict) throw new Error('UNAVAILABLE');
      return {};
    }
    return { consentVersion: 'v1', ...config };
  };
  const dienst = erstelleGastUebernahme({ db, admin, logger, loadConfig, zeit: () => jetzt });
  return {
    ...dienst,
    store,
    schreibvorgaenge,
    logs,
    authAufrufe,
    uhr: (ms) => {
      jetzt = ms;
    },
    admin,
  };
}

const job = (felder) => ({
  status: 'vorbereitet',
  ticketHashes: [HASH],
  gueltigBis: ts(T0 + 10 * TAG_MS),
  vorbereitungen: { tag: '2026-09-25', anzahl: 1 },
  ...felder,
});

// ─── vorbereiten ────────────────────────────────────────────────────

describe('vorbereiten', () => {
  it('legt den Job an: vorbereitet, ein Hash, gültig 30 Tage, eine Vorbereitung', async () => {
    const w = welt({ nutzer: { [GAST]: gast } });
    const r = await w.vorbereiten({ gastUid: GAST, ticketHash: HASH });
    expect(r.http).toBe(200);
    expect(r.body).toEqual({ ok: true, gueltigBis: new Date(T0 + GUELTIG_MS).toISOString() });
    const j = w.store.get(`gast_uebernahmen/${GAST}`);
    expect(j.status).toBe('vorbereitet');
    expect(j.ticketHashes).toEqual([HASH]);
    expect(j.gueltigBis.toMillis()).toBe(T0 + GUELTIG_MS);
    expect(j.vorbereitungen).toEqual({ tag: '2026-09-25', anzahl: 1 });
    expect(j.nachUid).toBeUndefined();
  });

  it('ungültiger Hash → 400, nichts geschrieben', async () => {
    const w = welt({ nutzer: { [GAST]: gast } });
    for (const h of [undefined, '', 'abc', HASH.toUpperCase(), `${HASH}0`, GEHEIMNIS]) {
      expect(await w.vorbereiten({ gastUid: GAST, ticketHash: h })).toEqual({ http: 400, body: { code: 'hash_ungueltig' } });
    }
    expect(w.schreibvorgaenge).toHaveLength(0);
  });

  it('kein Gast (Konto mit Anmeldeweg oder gesperrt) → 403 kein_gast', async () => {
    const w = welt({ nutzer: { [GAST]: { ...gast, providerData: [{ providerId: 'google.com' }] } } });
    expect(await w.vorbereiten({ gastUid: GAST, ticketHash: HASH })).toEqual({ http: 403, body: { code: 'kein_gast' } });
    const w2 = welt({ nutzer: { [GAST]: { ...gast, disabled: true } } });
    expect(await w2.vorbereiten({ gastUid: GAST, ticketHash: HASH })).toEqual({ http: 403, body: { code: 'kein_gast' } });
    expect(w.schreibvorgaenge).toHaveLength(0);
    expect(w2.schreibvorgaenge).toHaveLength(0);
  });

  it('getUser scheitert technisch → 503, nichts geschrieben', async () => {
    const w = welt({ nutzer: { [GAST]: gast }, getUserFehler: Object.assign(new Error('x'), { code: 'auth/internal-error' }) });
    expect(await w.vorbereiten({ gastUid: GAST, ticketHash: HASH })).toEqual({ http: 503, body: { code: 'konto_pruefung_fehlgeschlagen' } });
    expect(w.schreibvorgaenge).toHaveLength(0);
  });

  it('Tageslimit: 10 Vorbereitungen je Berliner Tag, die 11. → 429, am nächsten Tag wieder frei', async () => {
    const w = welt({ nutzer: { [GAST]: gast } });
    for (let i = 0; i < MAX_VORBEREITUNGEN_PRO_TAG; i++) {
      expect((await w.vorbereiten({ gastUid: GAST, ticketHash: HASH })).http).toBe(200);
    }
    expect(await w.vorbereiten({ gastUid: GAST, ticketHash: HASH })).toEqual({ http: 429, body: { code: 'zu_viele_vorbereitungen' } });
    expect(w.store.get(`gast_uebernahmen/${GAST}`).vorbereitungen.anzahl).toBe(MAX_VORBEREITUNGEN_PRO_TAG);
    // 23:30 Berlin am selben Tag ist noch derselbe Tag …
    w.uhr(Date.UTC(2026, 8, 25, 21, 30));
    expect((await w.vorbereiten({ gastUid: GAST, ticketHash: HASH })).http).toBe(429);
    // … 00:30 Berlin ist der nächste.
    w.uhr(Date.UTC(2026, 8, 25, 22, 30));
    expect((await w.vorbereiten({ gastUid: GAST, ticketHash: HASH })).http).toBe(200);
    expect(w.store.get(`gast_uebernahmen/${GAST}`).vorbereitungen).toEqual({ tag: '2026-09-26', anzahl: 1 });
  });

  it('Hash-Menge: höchstens 5, der älteste fliegt raus, derselbe Hash steht nie doppelt', async () => {
    const w = welt({ nutzer: { [GAST]: gast } });
    const hashes = [1, 2, 3, 4, 5, 6, 7].map((i) => sha256Hex(`geheimnis-${i}-xxxxxxxxxxxxxxxx`));
    for (const h of hashes) await w.vorbereiten({ gastUid: GAST, ticketHash: h });
    expect(w.store.get(`gast_uebernahmen/${GAST}`).ticketHashes).toEqual(hashes.slice(2));
    // Wiederholung eines vorhandenen Hashes: rückt ans Ende, keine Dublette.
    await w.vorbereiten({ gastUid: GAST, ticketHash: hashes[3] });
    const jetzt = w.store.get(`gast_uebernahmen/${GAST}`).ticketHashes;
    expect(jetzt).toHaveLength(5);
    expect(new Set(jetzt).size).toBe(5);
    expect(jetzt[4]).toBe(hashes[3]);
  });

  it('gueltigBis bleibt bei weiteren Vorbereitungen, wird also nicht verlängert', async () => {
    const w = welt({ nutzer: { [GAST]: gast } });
    await w.vorbereiten({ gastUid: GAST, ticketHash: HASH });
    w.uhr(T0 + 3 * TAG_MS);
    const r = await w.vorbereiten({ gastUid: GAST, ticketHash: sha256Hex('anderes-geheimnis-123456') });
    expect(r.body.gueltigBis).toBe(new Date(T0 + GUELTIG_MS).toISOString());
    expect(w.store.get(`gast_uebernahmen/${GAST}`).gueltigBis.toMillis()).toBe(T0 + GUELTIG_MS);
  });

  it('abgelaufener, nie gebundener Job startet neu: neue Frist, alte Hashes verworfen', async () => {
    const alt = sha256Hex('altes-geheimnis-1234567890');
    const w = welt({
      nutzer: { [GAST]: gast },
      docs: { [`gast_uebernahmen/${GAST}`]: job({ ticketHashes: [alt], gueltigBis: ts(T0 - 1), status: 'verfallen' }) },
    });
    const r = await w.vorbereiten({ gastUid: GAST, ticketHash: HASH });
    expect(r.http).toBe(200);
    const j = w.store.get(`gast_uebernahmen/${GAST}`);
    expect(j.status).toBe('vorbereitet');
    expect(j.ticketHashes).toEqual([HASH]);
    expect(j.gueltigBis.toMillis()).toBe(T0 + GUELTIG_MS);
  });

  it('schon gebunden → 409 schon_gebunden, nichts geschrieben', async () => {
    const w = welt({
      nutzer: { [GAST]: gast },
      docs: { [`gast_uebernahmen/${GAST}`]: job({ nachUid: ZIEL, status: 'laeuft', ticketHashes: undefined }) },
    });
    expect(await w.vorbereiten({ gastUid: GAST, ticketHash: HASH })).toEqual({ http: 409, body: { code: 'schon_gebunden' } });
    expect(w.schreibvorgaenge).toHaveLength(0);
  });
});

// ─── einloesen ──────────────────────────────────────────────────────

describe('einloesen (Stufe 1)', () => {
  const basis = (extra = {}) => ({
    nutzer: { [GAST]: gast, [ZIEL]: konto },
    docs: { [`gast_uebernahmen/${GAST}`]: job() },
    ...extra,
  });
  const nurVersuchszaehler = (w) =>
    w.schreibvorgaenge.every((s) => s.pfad === `gast_uebernahme_ziele/${ZIEL}` && Object.keys(s.felder).join() === 'versuche');

  it('gültiges Ticket, Schalter aus → 200 pausiert, außer dem Versuchszähler kein Write', async () => {
    const w = welt(basis());
    const vorher = JSON.stringify(w.store.get(`gast_uebernahmen/${GAST}`));
    const r = await w.einloesen({ zielUid: ZIEL, gastUid: GAST, geheimnis: GEHEIMNIS });
    expect(r).toEqual({ http: 200, body: { status: 'pausiert' } });
    expect(nurVersuchszaehler(w)).toBe(true);
    expect(JSON.stringify(w.store.get(`gast_uebernahmen/${GAST}`))).toBe(vorher);
    expect(w.authAufrufe.filter(([a]) => a !== 'getUser')).toEqual([]);
  });

  it('Schalter an → trotzdem pausiert (Stufe 2 fehlt), kein Binden, Warnung im Log', async () => {
    const w = welt(basis({ config: { gastUebernahmeAktiv: true } }));
    const r = await w.einloesen({ zielUid: ZIEL, gastUid: GAST, geheimnis: GEHEIMNIS });
    expect(r).toEqual({ http: 200, body: { status: 'pausiert' } });
    expect(nurVersuchszaehler(w)).toBe(true);
    expect(w.store.get(`gast_uebernahmen/${GAST}`).nachUid).toBeUndefined();
    expect(w.authAufrufe.filter(([a]) => a !== 'getUser')).toEqual([]);
    expect(w.logs.some(([lvl, msg]) => lvl === 'warn' && msg === 'gastUebernahme: Stufe 2 fehlt')).toBe(true);
  });

  it('Schalter nicht genau true (z. B. "true", 1) → pausiert ohne Warnung', async () => {
    for (const wert of ['true', 1, 'shadow']) {
      const w = welt(basis({ config: { gastUebernahmeAktiv: wert } }));
      expect((await w.einloesen({ zielUid: ZIEL, gastUid: GAST, geheimnis: GEHEIMNIS })).body).toEqual({ status: 'pausiert' });
      expect(w.logs.some(([lvl]) => lvl === 'warn')).toBe(false);
    }
  });

  it('falsches Geheimnis → 403 ticket_ungueltig', async () => {
    const w = welt(basis());
    expect(await w.einloesen({ zielUid: ZIEL, gastUid: GAST, geheimnis: `${GEHEIMNIS}x` })).toEqual({
      http: 403,
      body: { code: 'ticket_ungueltig' },
    });
    expect(nurVersuchszaehler(w)).toBe(true);
  });

  it('eines von mehreren gültigen Hashes passt → ok', async () => {
    const andere = [1, 2, 3, 4].map((i) => sha256Hex(`x-${i}-yyyyyyyyyyyyyyyyyy`));
    const w = welt(basis({ docs: { [`gast_uebernahmen/${GAST}`]: job({ ticketHashes: [andere[0], HASH, ...andere.slice(1)] }) } }));
    expect((await w.einloesen({ zielUid: ZIEL, gastUid: GAST, geheimnis: GEHEIMNIS })).http).toBe(200);
  });

  it('abgelaufen → 410, aber erst nach bestandener Hash-Prüfung', async () => {
    const w = welt(basis({ docs: { [`gast_uebernahmen/${GAST}`]: job({ gueltigBis: ts(T0 - 1) }) } }));
    expect(await w.einloesen({ zielUid: ZIEL, gastUid: GAST, geheimnis: GEHEIMNIS })).toEqual({ http: 410, body: { code: 'abgelaufen' } });
    // Wer das Geheimnis nicht hat, erfährt nichts über den Ablauf.
    expect((await w.einloesen({ zielUid: ZIEL, gastUid: GAST, geheimnis: `${GEHEIMNIS}x` })).body.code).toBe('ticket_ungueltig');
    const w2 = welt(basis({ docs: { [`gast_uebernahmen/${GAST}`]: job({ status: 'verfallen' }) } }));
    expect((await w2.einloesen({ zielUid: ZIEL, gastUid: GAST, geheimnis: GEHEIMNIS })).http).toBe(410);
  });

  it('Ziel = Gast → 400, nicht einmal der Zähler wird geschrieben', async () => {
    const w = welt(basis());
    expect(await w.einloesen({ zielUid: GAST, gastUid: GAST, geheimnis: GEHEIMNIS })).toEqual({ http: 400, body: { code: 'gleiches_konto' } });
    expect(w.schreibvorgaenge).toHaveLength(0);
  });

  it('unvollständige Anfrage → 400', async () => {
    const w = welt(basis());
    expect((await w.einloesen({ zielUid: ZIEL, gastUid: undefined, geheimnis: GEHEIMNIS })).http).toBe(400);
    expect((await w.einloesen({ zielUid: ZIEL, gastUid: 'a/b', geheimnis: GEHEIMNIS })).http).toBe(400);
    expect((await w.einloesen({ zielUid: ZIEL, gastUid: GAST, geheimnis: 'kurz' })).http).toBe(400);
    expect((await w.einloesen({ zielUid: ZIEL, gastUid: GAST, geheimnis: 42 })).http).toBe(400);
    expect(w.schreibvorgaenge).toHaveLength(0);
  });

  it('Ziel unregistriert oder gesperrt → 403 konto_erforderlich; getUser-Fehler → 503', async () => {
    const w = welt(basis({ nutzer: { [GAST]: gast, [ZIEL]: { ...konto, providerData: [] } } }));
    expect(await w.einloesen({ zielUid: ZIEL, gastUid: GAST, geheimnis: GEHEIMNIS })).toEqual({ http: 403, body: { code: 'konto_erforderlich' } });
    const w2 = welt(basis({ nutzer: { [GAST]: gast, [ZIEL]: { ...konto, disabled: true } } }));
    expect((await w2.einloesen({ zielUid: ZIEL, gastUid: GAST, geheimnis: GEHEIMNIS })).body.code).toBe('konto_erforderlich');
    const w3 = welt(basis({ getUserFehler: new Error('ECONNRESET') }));
    expect(await w3.einloesen({ zielUid: ZIEL, gastUid: GAST, geheimnis: GEHEIMNIS })).toEqual({
      http: 503,
      body: { code: 'konto_pruefung_fehlgeschlagen' },
    });
  });

  it('kein Job → 404 kein_ticket', async () => {
    const w = welt(basis({ docs: {} }));
    expect(await w.einloesen({ zielUid: ZIEL, gastUid: GAST, geheimnis: GEHEIMNIS })).toEqual({ http: 404, body: { code: 'kein_ticket' } });
  });

  it('an ein anderes Konto gebunden → 409 schon_gebunden', async () => {
    const w = welt(basis({ docs: { [`gast_uebernahmen/${GAST}`]: job({ nachUid: 'jemandAnderes', status: 'laeuft', ticketHashes: undefined }) } }));
    expect(await w.einloesen({ zielUid: ZIEL, gastUid: GAST, geheimnis: GEHEIMNIS })).toEqual({ http: 409, body: { code: 'schon_gebunden' } });
  });

  it('Konfiguration nicht lesbar → 503 statt Rückfall auf Standardwerte', async () => {
    const w = welt(basis({ configFehler: true }));
    expect(await w.einloesen({ zielUid: ZIEL, gastUid: GAST, geheimnis: GEHEIMNIS })).toEqual({
      http: 503,
      body: { code: 'konfiguration_nicht_lesbar' },
    });
  });

  it('Drossel: 20 Versuche je Stunde und Aufrufer, der 21. → 429, nächste Stunde wieder frei', async () => {
    const w = welt(basis());
    for (let i = 0; i < MAX_VERSUCHE_PRO_STUNDE; i++) {
      // auch Fehlversuche zählen
      await w.einloesen({ zielUid: ZIEL, gastUid: GAST, geheimnis: `${GEHEIMNIS}${i}` });
    }
    expect(await w.einloesen({ zielUid: ZIEL, gastUid: GAST, geheimnis: GEHEIMNIS })).toEqual({ http: 429, body: { code: 'zu_viele_versuche' } });
    expect(w.store.get(`gast_uebernahme_ziele/${ZIEL}`).versuche.anzahl).toBe(MAX_VERSUCHE_PRO_STUNDE);
    w.uhr(Date.UTC(2026, 8, 25, 11, 0, 0));
    expect((await w.einloesen({ zielUid: ZIEL, gastUid: GAST, geheimnis: GEHEIMNIS })).http).toBe(200);
    expect(w.store.get(`gast_uebernahme_ziele/${ZIEL}`).versuche).toEqual({ stunde: '2026-09-25T11', anzahl: 1 });
  });

  it('Drossel gilt je Aufrufer, nicht je Gast (keine Sperre eines Tickets durch Fremde)', async () => {
    const FREMD = 'fremdCCCCCCCCCCCCCCCCCCCCCCC';
    const w = welt(basis({ nutzer: { [GAST]: gast, [ZIEL]: konto, [FREMD]: { ...konto, uid: FREMD } } }));
    for (let i = 0; i < MAX_VERSUCHE_PRO_STUNDE + 5; i++) {
      await w.einloesen({ zielUid: FREMD, gastUid: GAST, geheimnis: `falsch-${i}-zzzzzzzzzzzzzzzz` });
    }
    expect((await w.einloesen({ zielUid: ZIEL, gastUid: GAST, geheimnis: GEHEIMNIS })).body).toEqual({ status: 'pausiert' });
  });
});

describe('Geheimnis und Hash landen nie im Log', () => {
  it('weder beim Vorbereiten noch beim Einlösen, weder bei Erfolg noch bei Fehler', async () => {
    const w = welt({ nutzer: { [GAST]: gast, [ZIEL]: konto }, config: { gastUebernahmeAktiv: true } });
    await w.vorbereiten({ gastUid: GAST, ticketHash: HASH });
    await w.einloesen({ zielUid: ZIEL, gastUid: GAST, geheimnis: GEHEIMNIS });
    await w.einloesen({ zielUid: ZIEL, gastUid: GAST, geheimnis: `${GEHEIMNIS}x` });
    const text = JSON.stringify(w.logs);
    expect(w.logs.length).toBeGreaterThan(0);
    expect(text).not.toContain(GEHEIMNIS);
    expect(text).not.toContain(HASH);
    expect(text).not.toContain(HASH.slice(0, 12));
  });
});

// ─── Hilfsfunktionen ────────────────────────────────────────────────

describe('hashPasst', () => {
  it('prüft gegen alle gültigen Einträge und ignoriert Müll', () => {
    expect(hashPasst(GEHEIMNIS, [HASH])).toBe(true);
    expect(hashPasst(GEHEIMNIS, ['kaputt', null, 42, HASH.toUpperCase(), HASH])).toBe(true);
    expect(hashPasst(GEHEIMNIS, ['kaputt', HASH.toUpperCase()])).toBe(false);
    expect(hashPasst(GEHEIMNIS, undefined)).toBe(false);
  });

  it('SHA-256 als Hex über UTF-8 — wie expo-crypto digestStringAsync in der App', () => {
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});

describe('kontoPruefen (Schranke vor requestPayout)', () => {
  const adminMit = (nutzer, fehler) => ({
    auth: () => ({
      async getUser() {
        if (fehler) throw fehler;
        return nutzer;
      },
    }),
  });

  it('registriert mit E-Mail → frei', async () => {
    expect(await kontoPruefen(adminMit(konto), ZIEL, { emailPflicht: true })).toBeNull();
  });

  it('Gast (kein Anmeldeweg) → 403 konto_erforderlich', async () => {
    expect(await kontoPruefen(adminMit(gast), GAST, { emailPflicht: true })).toEqual({ http: 403, body: { code: 'konto_erforderlich' } });
  });

  it('gesperrt → 403 konto_erforderlich', async () => {
    expect(await kontoPruefen(adminMit({ ...konto, disabled: true }), ZIEL, { emailPflicht: true })).toEqual({
      http: 403,
      body: { code: 'konto_erforderlich' },
    });
  });

  it('providerData fehlt ganz → kein Konto (fail-closed)', async () => {
    expect((await kontoPruefen(adminMit({ uid: ZIEL, email: 'b@x.de' }), ZIEL, { emailPflicht: true })).body.code).toBe('konto_erforderlich');
  });

  it('ohne E-Mail → 403 email_fehlt, aber nur mit emailPflicht', async () => {
    const ohne = { ...konto, email: undefined, providerData: [{ providerId: 'phone' }] };
    expect(await kontoPruefen(adminMit(ohne), ZIEL, { emailPflicht: true })).toEqual({ http: 403, body: { code: 'email_fehlt' } });
    expect(await kontoPruefen(adminMit(ohne), ZIEL)).toBeNull();
  });

  it('getUser scheitert technisch → 503 (keine Aussage über den Nutzer)', async () => {
    expect(await kontoPruefen(adminMit(null, new Error('deadline exceeded')), ZIEL, { emailPflicht: true })).toEqual({
      http: 503,
      body: { code: 'konto_pruefung_fehlgeschlagen' },
    });
  });

  it('Konto gelöscht → 403 konto_erforderlich', async () => {
    const weg = Object.assign(new Error('no user'), { code: 'auth/user-not-found' });
    expect((await kontoPruefen(adminMit(null, weg), ZIEL, { emailPflicht: true })).body.code).toBe('konto_erforderlich');
  });
});

describe('tokenPruefen', () => {
  const adminMit = (verify) => {
    const aufrufe = [];
    return {
      aufrufe,
      auth: () => ({
        async verifyIdToken(...a) {
          aufrufe.push(a);
          return verify();
        },
      }),
    };
  };
  const req = (authorization) => ({ headers: authorization === undefined ? {} : { authorization } });
  const logger = { warn: () => {} };

  it('prüft mit checkRevoked und liefert die uid', async () => {
    const a = adminMit(() => ({ uid: ZIEL }));
    expect(await tokenPruefen(a, req('Bearer abc'), logger)).toEqual({ uid: ZIEL });
    expect(a.aufrufe).toEqual([['abc', true]]);
  });

  it('ohne Bearer → 401', async () => {
    expect((await tokenPruefen(adminMit(() => ({ uid: ZIEL })), req(undefined), logger)).fehler.http).toBe(401);
    expect((await tokenPruefen(adminMit(() => ({ uid: ZIEL })), req('Basic xyz'), logger)).fehler.http).toBe(401);
  });

  it('widerrufen, gesperrt, abgelaufen → 401', async () => {
    for (const code of ['auth/id-token-revoked', 'auth/user-disabled', 'auth/id-token-expired', 'auth/argument-error']) {
      const a = adminMit(() => {
        throw Object.assign(new Error(code), { code });
      });
      expect(await tokenPruefen(a, req('Bearer abc'), logger)).toEqual({ fehler: { http: 401, body: { code: 'unauthenticated' } } });
    }
  });

  it('Auth nicht erreichbar → 503, damit die App ihr Ticket nicht verwirft', async () => {
    const a = adminMit(() => {
      throw Object.assign(new Error('socket hang up'), { code: 'app/network-error' });
    });
    expect(await tokenPruefen(a, req('Bearer abc'), logger)).toEqual({ fehler: { http: 503, body: { code: 'auth_nicht_erreichbar' } } });
  });
});
