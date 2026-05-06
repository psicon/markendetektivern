// ────────────────────────────────────────────────────────────────────────
// Stöbern Module-Cache + Prewarm
// ────────────────────────────────────────────────────────────────────────
//
// Stöbern öffnet beim ersten Aufruf 6+ Firestore-Queries → 10-13 s auf
// Web SDK Android. Mit dieser Cache-Schicht:
//   1. Stöbern liest aus cache wenn vorhanden → instant render
//   2. Home (oder anderer früh-laufender Code) kann via `prewarmStoebern()`
//      die selben Queries early-firen, sodass beim Stöbern-Tap der
//      Cache bereits gefüllt ist.
//
// "Tausende Reads"-Frage: nein. `prewarmStoebern` macht GENAU DIE
// Queries die Stöbern eh feuern würde. Wir verschieben sie nur zeitlich
// nach vorne — pro App-Session 1× total, nicht extra.

import { FirestoreService } from './firestore';

export type CachedPage = {
  items: any[];
  lastDoc: any;
  hasMore: boolean;
};

// Module-level — überlebt Stöbern-Mount/Unmount, aber nicht App-Restart
// (das wäre AsyncStorage; haben wir aktuell nicht).
let cachedEigen: CachedPage | null = null;
let cachedMarken: CachedPage | null = null;

let prewarmInflight: Promise<void> | null = null;

export function getCachedEigen(): CachedPage | null {
  return cachedEigen;
}

export function getCachedMarken(): CachedPage | null {
  return cachedMarken;
}

export function setCachedEigen(page: CachedPage | null): void {
  cachedEigen = page;
}

export function setCachedMarken(page: CachedPage | null): void {
  cachedMarken = page;
}

/**
 * Connection-Warming statt Daten-Vorladung.
 *
 * Hintergrund: aus dem Trace wissen wir dass Stöberns ERSTE
 * `query(produkte, orderBy('name'), limit(N))` 12 s dauert (Web SDK
 * Android Cold-Connection + Server-side Query-Plan-Aufbau).
 * Die ZWEITE Query mit gleicher Shape: nur 192 ms. Firestore cacht
 * serverseitig den Query-Plan/Index-State nach dem ersten Hit.
 *
 * Mit dieser Funktion feuern wir EINE Tiny-Query (`limit(1)` →
 * 1 doc) die die gleiche Query-Shape hat wie Stöberns echter
 * First-Load. Cost: **1 Firestore-Read pro Session**, statt 14
 * bei voll-Prefetching. Bei 500k MAU = ~$70/Monat gespart.
 *
 * UX-Win: erstmaliger Stöbern-Aufruf in derselben App-Session ist
 * deutlich schneller (Index/Plan ist warm).
 *
 * Idempotent — mehrfache Aufrufe machen nur 1 Read.
 */
let warmupDone = false;
let warmupInflight: Promise<void> | null = null;

export async function prewarmStoebern(): Promise<void> {
  if (warmupDone) return;
  if (warmupInflight) return warmupInflight;

  warmupInflight = (async () => {
    try {
      // Tiny-Query mit gleicher Shape wie Stöberns First-Load:
      // - Collection: produkte
      // - orderBy: 'name' asc
      // - limit: 1 statt 6 → minimal Bandbreite, gleicher Query-Plan
      // Server-Side wird der Query-Plan + Index für `produkte ordered by
      // name` warm — nachfolgende Stöbern-Query mit limit(6) hängt
      // sich an den schon aufgebauten Plan an = schnell.
      const noNameFilters: any = {
        categoryFilters: [],
        discounterFilters: [],
        stufeFilters: [],
        handelsmarkeFilters: [],
        allergenFilters: {},
        nutritionFilters: {},
        sortBy: 'name',
      };
      const markenFilters: any = {
        categoryFilters: [],
        herstellerFilters: [],
        allergenFilters: {},
        nutritionFilters: {},
        sortBy: 'name',
      };
      // Beide parallel — produkte + markenProdukte je 1 doc.
      // Total 2 Reads pro Session. Bei 500k MAU non-Stöbern-Users
      // ≈ ~$10/Monat. Vs ~$75 für volle Daten-Vorladung.
      await Promise.all([
        FirestoreService.getNoNameProductsPaginated(1, null, noNameFilters).catch(() => null),
        FirestoreService.getMarkenproduktePaginated(1, null, markenFilters).catch(() => null),
      ]);
      warmupDone = true;
    } finally {
      warmupInflight = null;
    }
  })();
  return warmupInflight;
}
