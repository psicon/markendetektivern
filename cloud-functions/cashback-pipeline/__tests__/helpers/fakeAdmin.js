'use strict';

/**
 * firebase-admin-Attrappe im Speicher für Tests, die index.js laden
 * (Kontosperre 02.10.2026). Bildet nur ab, was die Geldwege brauchen:
 * Dokumente, einfache Abfragen (==), Transaktionen mit gepufferten
 * Schreibvorgängen, FieldValue-Platzhalter und Firebase Auth.
 *
 * Fehler-Einspritzung: `fake.fehler.add(pfad)` lässt jeden Lesevorgang auf
 * diesem Dokument (bzw. dieser Sammlung bei Abfragen) scheitern — auch in
 * Transaktionen. So lässt sich „Sperre nicht lesbar" nachstellen.
 */

function erstelleFakeAdmin() {
  const store = new Map();
  const fehler = new Set();
  const benutzer = new Map(); // uid → UserRecord-artig
  const tokens = new Map(); // idToken → uid
  let jetzt = Date.now();
  let naechsteId = 0;

  const istPlatzhalter = (v) => v && typeof v === 'object' && typeof v.__op === 'string';
  const istZeit = (v) => v && typeof v === 'object' && typeof v.toMillis === 'function';
  const istObjekt = (v) => v && typeof v === 'object' && !Array.isArray(v) && !istZeit(v) && !istPlatzhalter(v);
  const zeit = (ms) => ({ toMillis: () => ms, toDate: () => new Date(ms), __zeit: ms });

  function platzhalterAnwenden(alt, v) {
    if (v.__op === 'inc') return (Number(alt) || 0) + v.n;
    if (v.__op === 'ts') return zeit(jetzt);
    if (v.__op === 'union') return Array.from(new Set([...(Array.isArray(alt) ? alt : []), ...v.werte]));
    if (v.__op === 'remove') return (Array.isArray(alt) ? alt : []).filter((x) => !v.werte.includes(x));
    throw new Error(`unbekannter Platzhalter ${v.__op}`);
  }

  /** Tief zusammenführen (set mit merge) bzw. frisch aufbauen (alt = undefined). */
  function zusammenfuehren(alt, neu) {
    const out = istObjekt(alt) ? { ...alt } : {};
    for (const [k, v] of Object.entries(neu)) {
      if (istPlatzhalter(v)) {
        if (v.__op === 'del') delete out[k];
        else out[k] = platzhalterAnwenden(out[k], v);
      } else if (istObjekt(v)) {
        out[k] = zusammenfuehren(out[k], v);
      } else {
        out[k] = v;
      }
    }
    return out;
  }

  function aktualisieren(alt, neu) {
    const out = JSON.parse(JSON.stringify(alt || {}), (k, v) => (v && typeof v === 'object' && '__zeit' in v ? zeit(v.__zeit) : v));
    for (const [schluessel, v] of Object.entries(neu)) {
      const teile = schluessel.split('.');
      let ziel = out;
      for (const t of teile.slice(0, -1)) {
        if (!istObjekt(ziel[t])) ziel[t] = {};
        ziel = ziel[t];
      }
      const letzter = teile[teile.length - 1];
      if (istPlatzhalter(v)) {
        if (v.__op === 'del') delete ziel[letzter];
        else ziel[letzter] = platzhalterAnwenden(ziel[letzter], v);
      } else if (istObjekt(v)) {
        ziel[letzter] = zusammenfuehren(undefined, v);
      } else {
        ziel[letzter] = v;
      }
    }
    return out;
  }

  function lesbar(pfad) {
    if (fehler.has(pfad)) {
      const e = new Error(`UNAVAILABLE: Attrappe kann ${pfad} nicht lesen`);
      e.code = 14;
      throw e;
    }
  }

  function feldLesen(daten, feld) {
    return String(feld).split('.').reduce((o, t) => (o == null ? undefined : o[t]), daten);
  }

  function snap(pfad) {
    const d = store.get(pfad);
    return {
      exists: d !== undefined,
      id: pfad.split('/').pop(),
      ref: ref(pfad),
      data: () => d,
      get: (f) => (d === undefined ? undefined : feldLesen(d, f)),
    };
  }

  function schreiben(pfad, daten, opt) {
    store.set(pfad, opt && opt.merge ? zusammenfuehren(store.get(pfad), daten) : zusammenfuehren(undefined, daten));
  }
  function aendern(pfad, daten) {
    if (!store.has(pfad)) {
      const e = new Error(`NOT_FOUND: ${pfad}`);
      e.code = 5;
      throw e;
    }
    store.set(pfad, aktualisieren(store.get(pfad), daten));
  }

  function ref(pfad) {
    return {
      id: pfad.split('/').pop(),
      path: pfad,
      get: async () => {
        lesbar(pfad);
        return snap(pfad);
      },
      set: async (d, o) => schreiben(pfad, d, o),
      update: async (d) => aendern(pfad, d),
      delete: async () => store.delete(pfad),
      collection: (sub) => sammlung(`${pfad}/${sub}`),
    };
  }

  function kinder(pfad) {
    const tiefe = pfad.split('/').length + 1;
    return [...store.keys()].filter((k) => k.startsWith(`${pfad}/`) && k.split('/').length === tiefe);
  }

  function abfrage(pfad, filter, grenze) {
    return {
      __abfrage: true,
      where: (feld, op, wert) => abfrage(pfad, [...filter, { feld, op, wert }], grenze),
      limit: (n) => abfrage(pfad, filter, n),
      select: () => abfrage(pfad, filter, grenze),
      orderBy: () => abfrage(pfad, filter, grenze),
      get: async () => {
        lesbar(pfad);
        let docs = kinder(pfad)
          .map(snap)
          .filter((s) => filter.every(({ feld, op, wert }) => {
            const v = feldLesen(s.data(), feld);
            if (op === '==') return v === wert;
            if (op === '>') return v > wert;
            if (op === 'array-contains') return Array.isArray(v) && v.includes(wert);
            throw new Error(`Operator ${op} nicht nachgebildet`);
          }));
        if (Number.isFinite(grenze)) docs = docs.slice(0, grenze);
        return { empty: docs.length === 0, size: docs.length, docs };
      },
    };
  }

  function sammlung(pfad) {
    return {
      ...abfrage(pfad, [], undefined),
      path: pfad,
      doc: (id) => ref(`${pfad}/${id || `auto${++naechsteId}`}`),
    };
  }

  const db = {
    doc: (p) => ref(p),
    collection: (p) => sammlung(p),
    batch: () => {
      const ops = [];
      return {
        set: (r, d, o) => ops.push(() => schreiben(r.path, d, o)),
        update: (r, d) => ops.push(() => aendern(r.path, d)),
        delete: (r) => ops.push(() => store.delete(r.path)),
        commit: async () => ops.forEach((f) => f()),
      };
    },
    // Lesen sofort, Schreiben gepuffert bis zum Erfolg des Callbacks — wirft
    // der Callback, bleibt der Bestand unverändert (wie bei Firestore).
    runTransaction: async (fn) => {
      const ops = [];
      const tx = {
        get: async (r) => (r.__abfrage ? r.get() : r.get()),
        set: (r, d, o) => { ops.push(() => schreiben(r.path, d, o)); return tx; },
        update: (r, d) => { ops.push(() => aendern(r.path, d)); return tx; },
        delete: (r) => { ops.push(() => store.delete(r.path)); return tx; },
      };
      const ergebnis = await fn(tx);
      ops.forEach((f) => f());
      return ergebnis;
    },
  };

  const firestore = () => db;
  firestore.FieldValue = {
    increment: (n) => ({ __op: 'inc', n }),
    serverTimestamp: () => ({ __op: 'ts' }),
    delete: () => ({ __op: 'del' }),
    arrayUnion: (...werte) => ({ __op: 'union', werte }),
    arrayRemove: (...werte) => ({ __op: 'remove', werte }),
  };
  firestore.Timestamp = {
    now: () => zeit(jetzt),
    fromMillis: (ms) => zeit(ms),
    fromDate: (d) => zeit(d.getTime()),
  };

  const auth = {
    verifyIdToken: async (tok) => {
      if (!tokens.has(tok)) {
        const e = new Error('ungültiges Token');
        e.code = 'auth/argument-error';
        throw e;
      }
      return { uid: tokens.get(tok) };
    },
    getUser: async (uid) => {
      if (!benutzer.has(uid)) {
        const e = new Error('kein Nutzer');
        e.code = 'auth/user-not-found';
        throw e;
      }
      return benutzer.get(uid);
    },
  };

  return {
    apps: [],
    initializeApp: () => {},
    firestore,
    auth: () => auth,
    messaging: () => ({ sendEachForMulticast: async () => ({ successCount: 0, failureCount: 0, responses: [] }) }),
    // Bon-Bild: der Bon-Lauf lädt es immer, auch wenn die Texterkennung aus
    // dem Zwischenspeicher am Dokument kommt.
    storage: () => ({
      bucket: () => ({
        file: () => ({
          download: async () => [Buffer.from('bon')],
          getMetadata: async () => [{ size: 3, contentType: 'image/jpeg' }],
        }),
      }),
    }),
    __fake: {
      store,
      fehler,
      benutzer,
      tokens,
      setzeJetzt: (ms) => { jetzt = ms; },
      zeit,
      zuruecksetzen: () => {
        store.clear();
        fehler.clear();
        benutzer.clear();
        tokens.clear();
      },
    },
  };
}

module.exports = { erstelleFakeAdmin };
