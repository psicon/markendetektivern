/**
 * Stufe-Copy-Service — single source of truth für die Tier-Texte
 * (Header + Description) auf der Comparison-Page, im Stöbern-Filter
 * und in der SimilarityStagesModal.
 *
 * Zwei Quellen, eine Schnittstelle:
 *   1. Firebase Remote Config (Keys: tier0header / tier0description
 *      ... tier5header / tier5description). Marketing-editierbar
 *      ohne App-Release.
 *   2. Hardcoded Fallback in dieser Datei. Greift wenn Remote
 *      Config offline ist (Expo Go ohne native Firebase RC), wenn
 *      ein Key noch leer ist, oder wenn der Web-SDK-Fetch auf RN
 *      ausnahmsweise fehlschlägt. Der Fallback matched die aktuell
 *      in der Firebase Console gepflegten Werte 1:1, sodass der
 *      User auch ohne funktionierende RC die richtige Copy sieht.
 *
 * Lifecycle:
 *   • App-Boot ruft `loadStufeCopy()` einmal — fired-and-forget,
 *     blockiert nicht das UI. Nach Abschluss steht die RC-Copy
 *     im Modul-Cache.
 *   • Screens lesen via `getStufeCopy(tier)` synchron — liefert
 *     den Cache wenn vorhanden, sonst den Hardcoded-Fallback.
 *     Damit gibt's keine "leeren Frames" beim ersten Render.
 *   • `loadStufeCopy()` ist idempotent: re-runs hängen sich an die
 *     bestehende Promise an, kein doppelter RC-Fetch.
 */

import { remoteConfigService } from '@/lib/services/remoteConfigService';

export type StufeTier = 0 | 1 | 2 | 3 | 4 | 5;
export type StufeCopy = { label: string; line: string };

// Fallback-Texte für alle sechs Tiers. Werden 1:1 aus der Firebase
// Console synchronisiert — wenn dort Werte geändert werden,
// dieselben Strings hier nachziehen. Nicht weil RC sie sonst nicht
// lesen würde, sondern damit Expo-Go-Builds und der Erst-Frame vor
// fetchAndActivate denselben Inhalt zeigen.
const FALLBACK: Record<StufeTier, StufeCopy> = {
  5: {
    label: 'Identisch',
    line: 'Gleicher Markenhersteller und die Produkte sind gleich!',
  },
  4: {
    label: 'Nahezu identisch',
    line: 'Gleicher Hersteller, minimal abweichende Zusammensetzung/Zutaten.',
  },
  3: {
    label: 'Vergleichbar',
    line: 'Gleicher Hersteller, stark angepasste Zusammensetzung/Zutaten.',
  },
  2: {
    label: 'Markenhersteller',
    line: 'Kommt von Markenhersteller, dieser hat aber kein vergleichbares Produkt im Sortiment.',
  },
  1: {
    label: 'NoName-Hersteller',
    line: "Produziert ausschließlich Handelsmarken bzw. NoName's.",
  },
  0: {
    label: 'Produkt ist (noch) unbekannt',
    line: 'Bei diesem Produkt ist uns (noch) keine Stufe bzw. kein Hersteller bekannt. Wir aktualisieren unsere Daten regelmäßig.',
  },
};

const TIERS: readonly StufeTier[] = [0, 1, 2, 3, 4, 5];

let cache: Record<StufeTier, StufeCopy> | null = null;
let inflight: Promise<void> | null = null;

/**
 * Read the cached or fallback Stufe-Copy synchron. Sichere Default-
 * Funktion — wirft NIE, liefert immer einen verwendbaren Wert.
 */
export function getStufeCopy(tier: StufeTier): StufeCopy {
  return cache?.[tier] ?? FALLBACK[tier];
}

/**
 * Wie `getStufeCopy` aber für unbekannte numerische Eingaben (z.B.
 * direkt aus Firestore, wo `stufe` ein String ist). Mappt
 * Nicht-Stufen (NaN, < 0, > 5) auf 0 ("Produkt unbekannt").
 */
export function getStufeCopyForRaw(raw: unknown): StufeCopy {
  const n =
    typeof raw === 'number'
      ? raw
      : parseInt(String(raw ?? '').trim(), 10);
  if (Number.isFinite(n) && n >= 0 && n <= 5) {
    return getStufeCopy(n as StufeTier);
  }
  return getStufeCopy(0);
}

/**
 * Force a fresh fetch of all 12 tier keys (6 header + 6 description)
 * from Remote Config. Idempotent — paralleler Aufruf hängt sich an
 * den bestehenden inflight-Promise. Schmeißt nicht — Fehler werden
 * geloggt und der Cache bleibt unverändert (Fallback-Pfad).
 *
 * Recommended: einmal beim App-Boot aufrufen (in `app/_layout.tsx`
 * oder einem Provider). Pages dürfen es zusätzlich beim Mount
 * aufrufen wenn sie frische Werte brauchen — der inflight-Pattern
 * de-dupliziert das.
 */
export function loadStufeCopy(): Promise<void> {
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      // Force-Fetch: ohne den Aufruf hängen wir auf dem zuletzt
      // activated Config (12 h Default-TTL in Production).
      await remoteConfigService.fetchAndActivate();

      const fetches = TIERS.flatMap((t) => [
        remoteConfigService.getValue(`tier${t}header`),
        remoteConfigService.getValue(`tier${t}description`),
      ]);
      const results = await Promise.all(fetches);

      const next = {} as Record<StufeTier, StufeCopy>;
      let appliedFromRemote = 0;
      const rawSnapshot: Record<string, unknown> = {};

      for (let i = 0; i < TIERS.length; i++) {
        const tier = TIERS[i];
        const headerRaw = results[i * 2];
        const descRaw = results[i * 2 + 1];
        rawSnapshot[`tier${tier}header`] = headerRaw;
        rawSnapshot[`tier${tier}description`] = descRaw;

        const header =
          typeof headerRaw === 'string' && headerRaw.trim().length > 0
            ? headerRaw.trim()
            : FALLBACK[tier].label;
        const desc =
          typeof descRaw === 'string' && descRaw.trim().length > 0
            ? descRaw.trim()
            : FALLBACK[tier].line;

        if (header !== FALLBACK[tier].label) appliedFromRemote += 1;
        if (desc !== FALLBACK[tier].line) appliedFromRemote += 1;

        next[tier] = { label: header, line: desc };
      }

      cache = next;
      // Diagnose-Log: zeigt im Dev-Build wie viele der 12 Keys
      // wirklich aus Remote Config kamen + die Roh-Strings, damit
      // bei "wird nicht gezogen"-Bugs sofort sichtbar wird ob
      // a) der Service nichts liefert (alle null/empty),
      // b) Werte gleich dem Fallback sind (kein Console-Update),
      // c) Werte abweichen aber nicht angezeigt werden (UI-Bug).
      // eslint-disable-next-line no-console
      console.log(
        `📡 stufeCopy loaded: ${appliedFromRemote}/12 keys from Remote Config`,
        rawSnapshot,
      );
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('📡 stufeCopy fetch failed, using fallback', err);
    } finally {
      // Re-allow new fetches on the next call (z.B. nach App-Resume).
      inflight = null;
    }
  })();
  return inflight;
}
