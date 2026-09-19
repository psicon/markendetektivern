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
 *   /cashback/pending/{bonId}    — Bon-Detail (Ziel der Cashback-Push,
 *                                  cloud-functions/cashback-pipeline/lib/pushLinks.js)
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
 * AUCH ERLAUBT (beide in app.json registrierten Schemata):
 *   markendetektive://noname-detail/abc123
 *   markendetektivern://noname-detail/abc123
 *   → bevorzugt sind relative Pfade, weil expo-router das nativ kann.
 */

import { router } from 'expo-router';
import { InteractionManager } from 'react-native';

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
  '/join-list',
  // Stand in der Anleitung (PUSH_NOTIFICATIONS_GUIDE.md) schon als Ziel,
  // fehlte aber hier — ein solcher Link landete still auf der Startseite.
  '/notification-settings',
]);

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
  // markendetektive://… und markendetektivern://… → /…
  // Beide Schemata sind in app.json registriert. Bis 17.09.2026 kannte diese
  // Zeile nur das erste — der Server schickte aber das zweite, und jeder Tap
  // auf eine Cashback-Nachricht landete auf der Startseite.
  path = path.replace(/^markendetektive(?:rn)?:\/\//i, '/');
  // https://markendetektive.de/… → /…
  path = path.replace(/^https?:\/\/[^/]+/, '');
  if (!path.startsWith('/')) path = '/' + path;
  // `schema:///pfad` ergäbe sonst `//pfad` und keinen erkennbaren Stamm.
  path = path.replace(/^\/{2,}/, '/');

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
 * Steht die erste Route der App schon (Startseite → Tabs)?
 *
 * ═══ Warum es das braucht (17.09.2026) ═══
 *
 * Öffnet ein Tap die beendete App, holt `fcmDeepLinks` die Nachricht 500 ms
 * nach dem Start und navigiert. `app/index.tsx` entscheidet aber erst NACH
 * der Consent-Abfrage (Android: Netzaufruf, bis zu 6 s) über die erste Route
 * und ruft dann `router.replace('/(tabs)')`. Ein `replace` ersetzt den
 * OBERSTEN Bildschirm — also genau das Ziel der Nachricht. Der Nutzer landete
 * auf der Startseite, obwohl das Routing formal „funktionierte".
 *
 * Deshalb wird ein Ziel, das vor diesem Moment ankommt, nur vorgemerkt und
 * erst ausgeführt, wenn die erste echte Route steht UND ein Nutzer da ist
 * (`initialeRouteGesetzt`, aus dem PushNotificationProvider). „Echte Route"
 * (`istErsteEchteRoute`) heißt: kein Bildschirm, der gleich selbst per
 * `replace` weiterleitet — also nicht die Startseite, nicht das Onboarding,
 * nicht die Anmeldung (`auth/welcome` ersetzt nach dem Login durch die Tabs).
 * Die Tabs oder ein per Link direkt geöffneter Bildschirm (Einladung), bei
 * dem die Startseite gar nicht erst läuft, zählen.
 */
let initialeRouteSteht = false;
let vorgemerkterPfad: string | null = null;

/** Bildschirme, die selbst gleich per `replace` weiterleiten. */
const WEITERLEITENDE_STAEMME = new Set(['index', 'onboarding', 'auth']);

/** Steht mit diesen expo-router-Segmenten eine Route, die bleibt? */
export function istErsteEchteRoute(segmente: readonly string[]): boolean {
  return segmente.length > 0 && !WEITERLEITENDE_STAEMME.has(segmente[0]);
}

/**
 * Derselbe Tap kommt unter Android ZWEIMAL an: expo-notifications sieht
 * FCM-Taps ebenfalls (ExpoNotificationLifecycleListener reicht jede
 * Start-/neue Intent mit Extras weiter), und RNFB meldet sie über
 * getInitialNotification/onNotificationOpenedApp. Bis 17.09.2026 fiel das
 * nicht auf, weil der Cashback-Link auf beiden Wegen unauflösbar war. Jetzt
 * würde jeder Tap die Bon-Seite zweimal stapeln — deshalb öffnet dasselbe
 * Ziel innerhalb dieses Fensters nur einmal.
 */
const DOPPELTAP_FENSTER_MS = 5000;
let zuletzt: { pfad: string; zeit: number } | null = null;

function istWiederholung(pfad: string): boolean {
  const jetzt = Date.now();
  if (zuletzt && zuletzt.pfad === pfad && jetzt - zuletzt.zeit < DOPPELTAP_FENSTER_MS) return true;
  zuletzt = { pfad, zeit: jetzt };
  return false;
}

/** Vom PushNotificationProvider aufgerufen, sobald die erste Route steht. Idempotent. */
export function initialeRouteGesetzt(): void {
  if (initialeRouteSteht) return;
  initialeRouteSteht = true;
  const pfad = vorgemerkterPfad;
  vorgemerkterPfad = null;
  if (!pfad) return;
  // Erst nach dem Übergang: der `replace` der Startseite animiert noch, und
  // ein `push` mittendrin landete unter dem neuen Bildschirm.
  InteractionManager.runAfterInteractions(() => {
    pfadOeffnen(pfad);
  });
}

/**
 * Die Wurzel der App wird neu aufgebaut (Android kann die Activity zerstören,
 * während der JS-Prozess weiterläuft). Dann läuft auch die Startseite wieder
 * — Ziele müssen bis zur nächsten echten Route erneut warten.
 */
export function initialeRouteZuruecksetzen(): void {
  initialeRouteSteht = false;
  vorgemerkterPfad = null;
}

function pfadOeffnen(path: string): boolean {
  try {
    router.push(path as any);
    return true;
  } catch (e) {
    // Kein Ausweich-`replace`: es würde den Bildschirm ersetzen, auf dem der
    // Nutzer gerade ist. Dort zu bleiben ist die harmlosere Folge.
    console.warn('[pushDeepLink] navigation failed:', (e as any)?.message, 'path=', path);
    return false;
  }
}

/**
 * Führt die Navigation aus. Verwendet expo-router's globalen `router`.
 *
 * Vor `initialeRouteGesetzt()` wird ein gültiges Ziel nur vorgemerkt (der
 * letzte Tap gewinnt).
 *
 * Ein fehlendes oder ungültiges Ziel bewirkt NICHTS. Bis 17.09.2026 folgte
 * darauf `router.replace('/(tabs)')` — und das ersetzte unter iOS die gerade
 * geöffnete Bon-Seite: RNFB meldet den Tap mit Link, danach meldet
 * expo-notifications denselben Tap ohne Daten. Ein Tap ohne Ziel lässt den
 * Nutzer dort, wo die App ihn ohnehin hinführt.
 */
export function navigateToDeepLink(rawPath: unknown): boolean {
  const path = resolveDeepLink(rawPath);
  // Zweite Meldung desselben Taps (siehe DOPPELTAP_FENSTER_MS): nichts tun.
  if (path && istWiederholung(path)) return true;
  if (!initialeRouteSteht) {
    if (path) vorgemerkterPfad = path;
    return !!path;
  }
  if (!path) return false;
  return pfadOeffnen(path);
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
