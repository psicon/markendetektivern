/**
 * currentRoute — modul-level Spiegel der aktuellen expo-router-Pathname.
 *
 * Gespeist vom AnalyticsProvider (der ohnehin `usePathname()` hört).
 * Erlaubt Nicht-Hook-Code — z.B. dem `onTap` eines global gefeuerten
 * Banners — zu prüfen, auf welchem Screen der User gerade ist, ohne
 * selbst ein React-Hook zu sein.
 *
 * Genutzt u.a. um redundante Navigation zu vermeiden (ClickUp 86caak83r:
 * der Cashback-Banner-Tap soll nicht erneut auf die Cashback-Seite
 * leiten, wenn der User bereits dort ist).
 *
 * Hinweis: expo-router liefert in `usePathname()` den Pfad OHNE die
 * Group-Segmente, d.h. `app/(tabs)/rewards.tsx` → `/rewards`.
 */

let currentPathname = '';

export function setCurrentPathname(pathname: string): void {
  currentPathname = pathname || '';
}

export function getCurrentPathname(): string {
  return currentPathname;
}
