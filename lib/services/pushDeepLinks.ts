/**
 * Push-Deep-Link-Schema
 *
 * Wenn eine Push-Notification gesendet wird (manuell aus Firebase Console
 * ODER aus einer Cloud Function), kann sie ein `data.deepLink`-Feld
 * mitgeben. Beim Tap auf die Notification routet die App den User auf
 * die spezifische Seite — kein App-Start zur Home-Page.
 *
 * Erlaubte Schemas (Beispiele):
 *   /(tabs)/index                — Home-Tab
 *   /(tabs)/explore              — Stöbern
 *   /(tabs)/explore?query=Bier   — Stöbern mit vorgesetzter Suche
 *   /(tabs)/rewards              — Belohnungen-Tab
 *   /(tabs)/rewards?campaign=ID  — Belohnungen mit Kampagnen-Highlight
 *   /noname-detail/{produktId}   — NoName-Detail
 *   /product-comparison/{id}     — Markenprodukt-Vergleich
 *   /external-product/{ean}      — Externe Produktdaten
 *   /cashback/review/{bonId}     — Bon-Detail
 *   /achievements                — Achievements / Level
 *   /shopping-list               — Einkaufszettel
 *   /favorites                   — Favoriten
 *   /history                     — Suchverlauf
 *   /profile                     — Profil
 *
 * FIREBASE-CONSOLE-USAGE:
 *   Beim Push-Composer "Erweiterte Optionen → Custom Data":
 *     Key:   deepLink
 *     Value: /noname-detail/abc123
 *
 *   Optional auch für Image:
 *     Notification → Image-URL setzen (HTTPS).
 *     Empfohlene Größe: 1024×512 (2:1), max 1 MB, jpg/png.
 *
 * COULD ALSO BE:
 *   markendetektive://noname-detail/abc123  (Universal Link)
 *   → wir nehmen relative Pfade weil expo-router das nativ kann.
 */

import { router } from 'expo-router';

/** Whitelist erlaubter Root-Routen (alles andere wird ignoriert/Fallback). */
const ALLOWED_ROOTS = new Set([
  '/(tabs)',
  '/noname-detail',
  '/product-comparison',
  '/external-product',
  '/cashback',
  '/achievements',
  '/shopping-list',
  '/favorites',
  '/history',
  '/profile',
  '/edit-profile',
  '/tipps-und-tricks',
  '/purchase-history',
  '/surveys',
  '/shared-lists',
  '/shared-list',
  '/join-list',
]);

/** Default-Route wenn der Deep-Link fehlt / nicht parsebar / nicht erlaubt. */
const DEFAULT_ROUTE = '/(tabs)';

/**
 * Validiert + normalisiert einen Deep-Link-String aus einem Push-Payload.
 * Returnt einen sicheren Pfad zum Routen oder null wenn ungültig.
 */
export function resolveDeepLink(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  // Cleane Pfade: kein protokoll, mit / am Anfang
  let path = trimmed;
  // markendetektive://… → /…
  path = path.replace(/^markendetektive:\/\//, '/');
  // https://markendetektive.de/… → /…
  path = path.replace(/^https?:\/\/[^/]+/, '');
  if (!path.startsWith('/')) path = '/' + path;

  // Pfad-Root prüfen
  const root = path.split('?')[0].split('/').slice(0, 2).join('/') || '/';
  const rootWithGroup = root + (path.includes('/(tabs)') ? '' : '');
  // Erlauben wenn explizit oder /(tabs)/... pattern
  const isTabs = path.startsWith('/(tabs)');
  const matchedRoot = Array.from(ALLOWED_ROOTS).find((r) => path.startsWith(r));
  if (!isTabs && !matchedRoot) {
    console.warn('[pushDeepLink] not allowed:', path);
    return null;
  }
  return path;
}

/**
 * Führt die Navigation aus. Verwendet expo-router's globalen `router`.
 *
 * **Wichtig**: muss aus dem App-Tree heraus aufgerufen werden (Router
 * muss bereits gemountet sein). Der Caller kann das via setTimeout
 * defer'n falls die App noch im Cold-Start ist.
 */
export function navigateToDeepLink(rawPath: unknown): boolean {
  const path = resolveDeepLink(rawPath);
  if (!path) {
    // Default: Home-Tab
    try {
      router.replace(DEFAULT_ROUTE as any);
    } catch (e) {
      console.warn('[pushDeepLink] default-route failed:', (e as any)?.message);
    }
    return false;
  }
  try {
    router.push(path as any);
    return true;
  } catch (e) {
    console.warn('[pushDeepLink] navigation failed:', (e as any)?.message, 'path=', path);
    // Fallback auf Home
    try {
      router.replace(DEFAULT_ROUTE as any);
    } catch {}
    return false;
  }
}

/**
 * Liest `deepLink` aus einem Push-Notification-Data-Payload.
 * Akzeptiert beide gebräuchlichen Felder (deepLink + url).
 */
export function extractDeepLink(data: any): string | null {
  if (!data || typeof data !== 'object') return null;
  return (data.deepLink || data.deeplink || data.url || data.link || null) as
    | string
    | null;
}
