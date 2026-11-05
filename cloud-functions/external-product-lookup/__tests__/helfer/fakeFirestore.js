/**
 * Kleiner Firestore-Ersatz im Speicher für die Ablauf-Tests von index.js.
 * Kann genau das, was external-product-lookup benutzt: doc/collection,
 * get/set(merge)/update, where (==, in, array-contains-any) + limit + select,
 * runTransaction, FieldValue (serverTimestamp, delete, increment), Timestamp.
 * Kein Ersatz für den Emulator — er prüft Abläufe, nicht Firestore selbst.
 */

'use strict';

class FakeTimestamp {
  constructor(ms) {
    this._ms = ms;
  }
  toMillis() {
    return this._ms;
  }
  toDate() {
    return new Date(this._ms);
  }
  static fromDate(d) {
    return new FakeTimestamp(d.getTime());
  }
  static fromMillis(ms) {
    return new FakeTimestamp(ms);
  }
}

const SENTINEL = Symbol('sentinel');
const FieldValue = {
  serverTimestamp: () => ({ [SENTINEL]: 'serverTimestamp' }),
  delete: () => ({ [SENTINEL]: 'delete' }),
  increment: (n) => ({ [SENTINEL]: 'increment', n }),
};

function holeFeld(obj, pfad) {
  return pfad.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

class FakeDb {
  constructor(jetzt = () => Date.now()) {
    this.daten = new Map();
    this.jetzt = jetzt;
    this.schreibvorgaenge = [];
  }
  settings() {}
  doc(pfad) {
    return new FakeDocRef(this, pfad);
  }
  collection(name) {
    return new FakeQuery(this, name, []);
  }
  async runTransaction(fn) {
    const tx = {
      get: (ref) => ref.get(),
      set: (ref, d, o) => ref._schreibe(d, o && o.merge),
      update: (ref, d) => ref._aktualisiere(d),
      delete: (ref) => {
        this.schreibvorgaenge.push(['delete', ref.path]);
        this.daten.delete(ref.path);
      },
    };
    return fn(tx);
  }
  // Test-Helfer
  lies(pfad) {
    const d = this.daten.get(pfad);
    return d === undefined ? undefined : d;
  }
  lege(pfad, daten) {
    this.daten.set(pfad, { ...daten });
  }
  _wende(alt, d, merge) {
    const out = merge ? { ...(alt || {}) } : {};
    for (const [k, v] of Object.entries(d)) {
      if (v === undefined) continue; // ignoreUndefinedProperties
      if (v && v[SENTINEL] === 'delete') {
        delete out[k];
      } else if (v && v[SENTINEL] === 'serverTimestamp') {
        out[k] = new FakeTimestamp(this.jetzt());
      } else if (v && v[SENTINEL] === 'increment') {
        out[k] = (typeof out[k] === 'number' ? out[k] : 0) + v.n;
      } else if (v instanceof Date) {
        out[k] = FakeTimestamp.fromDate(v);
      } else {
        out[k] = v;
      }
    }
    return out;
  }
}

class FakeDocRef {
  constructor(db, pfad) {
    this.db = db;
    this.path = pfad;
    this.id = pfad.split('/').pop();
  }
  async get() {
    const d = this.db.daten.get(this.path);
    return { exists: d !== undefined, id: this.id, ref: this, data: () => (d === undefined ? undefined : { ...d }) };
  }
  async set(d, o) {
    this._schreibe(d, o && o.merge);
  }
  async update(d) {
    this._aktualisiere(d);
  }
  async delete() {
    this.db.schreibvorgaenge.push(['delete', this.path]);
    this.db.daten.delete(this.path);
  }
  _schreibe(d, merge) {
    this.db.schreibvorgaenge.push([merge ? 'merge' : 'set', this.path]);
    this.db.daten.set(this.path, this.db._wende(this.db.daten.get(this.path), d, merge));
  }
  _aktualisiere(d) {
    if (!this.db.daten.has(this.path)) {
      const e = new Error(`NOT_FOUND: ${this.path}`);
      e.code = 5;
      throw e;
    }
    this.db.schreibvorgaenge.push(['update', this.path]);
    this.db.daten.set(this.path, this.db._wende(this.db.daten.get(this.path), d, true));
  }
}

class FakeQuery {
  constructor(db, sammlung, filter, grenze = Infinity) {
    this.db = db;
    this.sammlung = sammlung;
    this.filter = filter;
    this.grenze = grenze;
  }
  doc(id) {
    return new FakeDocRef(this.db, `${this.sammlung}/${id}`);
  }
  where(feld, op, wert) {
    return new FakeQuery(this.db, this.sammlung, [...this.filter, { feld, op, wert }], this.grenze);
  }
  limit(n) {
    return new FakeQuery(this.db, this.sammlung, this.filter, n);
  }
  select() {
    return this;
  }
  async get() {
    const docs = [];
    for (const [pfad, d] of this.db.daten) {
      const teile = pfad.split('/');
      if (teile.length !== 2 || teile[0] !== this.sammlung) continue;
      const passt = this.filter.every(({ feld, op, wert }) => {
        const v = holeFeld(d, feld);
        if (op === '==') return v === wert;
        if (op === 'in') return wert.includes(v);
        if (op === 'array-contains-any') return Array.isArray(v) && v.some((x) => wert.includes(x));
        throw new Error(`op ${op} nicht unterstützt`);
      });
      if (passt) docs.push({ id: teile[1], ref: new FakeDocRef(this.db, pfad), data: () => ({ ...d }) });
      if (docs.length >= this.grenze) break;
    }
    return { empty: docs.length === 0, size: docs.length, docs };
  }
}

module.exports = { FakeDb, FakeTimestamp, FieldValue };
