'use strict';

/**
 * Firestore-Attrappe im Speicher für die Lauf-Tests des Prozessors. Bildet
 * nur ab, was src/lauf.js braucht — mit den Eigenschaften, auf die es dort
 * ankommt:
 *   - orderBy lässt Dokumente OHNE das Feld weg (wie Firestore),
 *   - Transaktionen laufen nacheinander (gleichwertig zur optimistischen
 *     Wiederholung von Firestore), Schreibvorgänge erst am Ende,
 *   - update auf ein fehlendes Dokument wirft NOT_FOUND.
 *
 * Fehler-Einspritzung:
 *   fake.scheitern.orderBy.add('rang')      Abfrage mit orderBy('rang') wirft
 *   fake.scheitern.sammlungen.add('produkte') jede Abfrage dort wirft
 *   fake.scheitern.dokumente.add(pfad)      jedes Lesen dieses Dokuments wirft
 */

class Zeit {
  constructor(ms) {
    this.ms = ms;
  }
  toMillis() {
    return this.ms;
  }
}

function erstelleFakeFirestore({ jetzt = () => Date.now() } = {}) {
  const store = new Map();
  const scheitern = { orderBy: new Set(), sammlungen: new Set(), dokumente: new Set() };

  const FieldValue = {
    serverTimestamp: () => ({ __op: 'ts' }),
    increment: (n) => ({ __op: 'inc', n }),
    delete: () => ({ __op: 'del' }),
  };
  const Timestamp = { fromMillis: (ms) => new Zeit(ms) };

  const istPlatzhalter = (v) => v && typeof v === 'object' && typeof v.__op === 'string';
  const istObjekt = (v) => v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Zeit) && !istPlatzhalter(v);
  const kopie = (v) => {
    if (v instanceof Zeit) return new Zeit(v.ms);
    if (Array.isArray(v)) return v.map(kopie);
    if (istObjekt(v)) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, kopie(x)]));
    return v;
  };

  function wert(alt, v) {
    if (!istPlatzhalter(v)) return kopie(v);
    if (v.__op === 'ts') return new Zeit(jetzt());
    if (v.__op === 'inc') return (typeof alt === 'number' ? alt : 0) + v.n;
    throw new Error(`Platzhalter ${v.__op} hier nicht erlaubt`);
  }

  function zusammenfuehren(alt, neu) {
    const out = istObjekt(alt) ? { ...alt } : {};
    for (const [k, v] of Object.entries(neu)) {
      if (istPlatzhalter(v) && v.__op === 'del') delete out[k];
      else if (istObjekt(v)) out[k] = zusammenfuehren(out[k], v);
      else out[k] = wert(out[k], v);
    }
    return out;
  }

  function setzen(pfad, daten, opt) {
    const basis = opt && opt.merge ? store.get(pfad) : undefined;
    store.set(pfad, zusammenfuehren(basis, daten));
  }

  function aendern(pfad, daten) {
    if (!store.has(pfad)) {
      const e = new Error(`NOT_FOUND: ${pfad}`);
      e.code = 5;
      throw e;
    }
    const out = { ...store.get(pfad) };
    for (const [k, v] of Object.entries(daten)) {
      if (k.includes('.')) throw new Error('Punkt-Pfade in update nicht nachgebildet');
      if (istPlatzhalter(v) && v.__op === 'del') delete out[k];
      else out[k] = wert(out[k], v);
    }
    store.set(pfad, out);
  }

  function lesbar(pfad) {
    if (scheitern.dokumente.has(pfad)) {
      const e = new Error(`UNAVAILABLE: ${pfad}`);
      e.code = 14;
      throw e;
    }
  }

  const feld = (daten, f) => String(f).split('.').reduce((o, t) => (o == null ? undefined : o[t]), daten);

  function snap(pfad) {
    const d = store.get(pfad);
    return {
      id: pfad.split('/').pop(),
      exists: d !== undefined,
      ref: ref(pfad),
      data: () => (d === undefined ? undefined : kopie(d)),
      get: (f) => (d === undefined ? undefined : kopie(feld(d, f))),
    };
  }

  function ref(pfad) {
    const teile = pfad.split('/');
    if (teile.length % 2 !== 0) throw new Error(`kein Dokumentpfad: ${pfad}`);
    return {
      id: teile[teile.length - 1],
      path: pfad,
      get: async () => {
        lesbar(pfad);
        return snap(pfad);
      },
      set: async (d, o) => setzen(pfad, d, o),
      update: async (d) => aendern(pfad, d),
      collection: (sub) => sammlung(`${pfad}/${sub}`),
    };
  }

  const vergleichbar = (v) => (v instanceof Zeit ? v.ms : v);

  function abfrage(pfad, filter, sortierung, grenze, nach = null) {
    const weiter = (f, s, g, n = nach) => abfrage(pfad, f, s, g, n);
    return {
      where: (f, op, w) => weiter([...filter, { f, op, w }], sortierung, grenze),
      orderBy: (f, richtung = 'asc') => weiter(filter, [...sortierung, { f, richtung }], grenze),
      limit: (n) => weiter(filter, sortierung, n),
      // Cursor wie Firestore: hinter dem Dokument in derselben Sortierung
      // (gleiche Sortierwerte: nach der Dokument-ID).
      startAfter: (snapshot) => weiter(filter, sortierung, grenze, snapshot),
      select: () => weiter(filter, sortierung, grenze),
      get: async () => {
        const sammlungsName = pfad.split('/')[0];
        if (scheitern.sammlungen.has(sammlungsName) || scheitern.sammlungen.has(pfad)) {
          throw new Error(`UNAVAILABLE: Abfrage auf ${pfad}`);
        }
        for (const s of sortierung) {
          if (scheitern.orderBy.has(s.f)) {
            const e = new Error(`FAILED_PRECONDITION: The query requires an index (${s.f})`);
            e.code = 9;
            throw e;
          }
        }
        const tiefe = pfad.split('/').length + 1;
        let docs = [...store.keys()]
          .filter((k) => k.startsWith(`${pfad}/`) && k.split('/').length === tiefe)
          .map(snap)
          .filter((s) => filter.every(({ f, op, w }) => {
            const v = feld(s.data(), f);
            if (op === '==') return v === w;
            if (op === '<') return v !== undefined && vergleichbar(v) < vergleichbar(w);
            if (op === 'in') return w.includes(v);
            if (op === 'array-contains-any') return Array.isArray(v) && v.some((x) => w.includes(x));
            throw new Error(`Operator ${op} nicht nachgebildet`);
          }));
        for (const { f } of sortierung) docs = docs.filter((s) => feld(s.data(), f) !== undefined);
        if (sortierung.length > 0) {
          docs.sort((a, b) => {
            for (const { f, richtung } of sortierung) {
              const x = vergleichbar(feld(a.data(), f));
              const y = vergleichbar(feld(b.data(), f));
              if (x === y) continue;
              const r = x < y ? -1 : 1;
              return richtung === 'desc' ? -r : r;
            }
            return a.id < b.id ? -1 : 1;
          });
        }
        if (nach) {
          const vergleiche = (a, b) => {
            for (const { f, richtung } of sortierung) {
              const x = vergleichbar(feld(a.data(), f));
              const y = vergleichbar(feld(b.data(), f));
              if (x === y) continue;
              const r = x < y ? -1 : 1;
              return richtung === 'desc' ? -r : r;
            }
            return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
          };
          docs = docs.filter((s) => vergleiche(s, nach) > 0);
        }
        if (Number.isFinite(grenze)) docs = docs.slice(0, grenze);
        return { empty: docs.length === 0, size: docs.length, docs };
      },
    };
  }

  function sammlung(pfad) {
    const q = abfrage(pfad, [], [], undefined);
    return { ...q, doc: (id) => ref(`${pfad}/${id}`) };
  }

  let kette = Promise.resolve();
  async function runTransaction(fn) {
    const lauf = kette.then(async () => {
      const schreiben = [];
      const tx = {
        get: async (r) => {
          lesbar(r.path);
          return snap(r.path);
        },
        getAll: async (...refs) => refs.map((r) => {
          lesbar(r.path);
          return snap(r.path);
        }),
        update: (r, d) => schreiben.push(() => aendern(r.path, d)),
        set: (r, d, o) => schreiben.push(() => setzen(r.path, d, o)),
      };
      const ergebnis = await fn(tx);
      schreiben.forEach((w) => w());
      return ergebnis;
    });
    kette = lauf.catch(() => {});
    return lauf;
  }

  function batch() {
    const schreiben = [];
    return {
      update: (r, d) => schreiben.push(() => aendern(r.path, d)),
      set: (r, d, o) => schreiben.push(() => setzen(r.path, d, o)),
      commit: async () => schreiben.forEach((w) => w()),
    };
  }

  const db = {
    collection: (pfad) => sammlung(pfad),
    doc: (pfad) => ref(pfad),
    runTransaction,
    batch,
  };

  return {
    db,
    FieldValue,
    Timestamp,
    Zeit,
    scheitern,
    setze: (pfad, daten) => store.set(pfad, kopie(daten)),
    lies: (pfad) => (store.has(pfad) ? kopie(store.get(pfad)) : undefined),
  };
}

module.exports = { erstelleFakeFirestore, Zeit };
