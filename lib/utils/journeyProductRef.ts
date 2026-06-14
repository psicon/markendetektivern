/**
 * Pure Helfer für Journey-productRefs.
 *
 * Aus `journeyTrackingService.ts` extrahiert, damit unit-testbar (der Service
 * importiert RN-Firebase + hält ein Singleton mit Modul-Seiteneffekten).
 */

export type JourneyProductType = 'brand' | 'noname' | 'external';

/**
 * Firestore-Collection für eine productRef je productType. Externe Produkte
 * (productId = EAN) zeigen auf external_products — NICHT auf ein nicht-
 * existentes produkte/{EAN} (Bogus-Ref, Datenstruktur-Schutz). EINZIGE Quelle
 * der Wahrheit für alle productRef-Builder im journeyTrackingService.
 */
export function collectionForProductType(t: JourneyProductType): string {
  return t === 'brand'
    ? 'markenProdukte'
    : t === 'external'
    ? 'external_products'
    : 'produkte';
}
