/**
 * Barcode aus einem fertigen Foto lesen (Nachlesen nach der Aufnahme,
 * Galeriebild). Android: ML Kit über expo-camera `scanFromURLAsync` (liefert
 * ALLE Codes im Bild). iOS: Apple Vision über `scanBarcodeFromImage` —
 * expo-camera liest dort aus Standbildern nur QR-Codes.
 *
 * Wirft nie. Ein technischer Fehlschlag (Fehler, Zeitgrenze, Modul fehlt im
 * Binary) ist KEINE Aussage über das Bild und wird als `gescheitert` gemeldet.
 */
import { scanFromURLAsync } from 'expo-camera';
import { Platform } from 'react-native';
import { scanBarcodeFromImage } from 'bon-edge-detector';

import { mitZeitlimit } from '@/lib/services/berechtigungsWaechter';
import type { FotoLesung } from '@/lib/utils/barcodeBestaetigung';
import { gleicheGtin, pruefzifferStimmt } from '@/lib/utils/gtin';

/** Nachlesen eines 12-MP-Fotos dauert auf Mittelklasse-Geräten < 1 s. */
export const FOTO_LESEN_LIMIT_MS = 4000;

/** Produkt-Barcodes des Foto-Assistenten. Ohne `upc_e`: in 60 Tagen nur Fehllesungen. */
export const PRODUKT_BARCODE_TYPEN = ['ean13', 'ean8', 'upc_a'] as const;

const ZEITGRENZE = Symbol('zeitgrenze');

export async function leseBarcodesAusFoto(uri: string): Promise<FotoLesung> {
  try {
    let roh: string[];
    if (Platform.OS === 'ios') {
      const code = await mitZeitlimit(scanBarcodeFromImage(uri), FOTO_LESEN_LIMIT_MS, ZEITGRENZE);
      if (code === ZEITGRENZE) return { nummern: [], gescheitert: true };
      roh = code ? [code] : [];
    } else {
      const scans = await mitZeitlimit(
        scanFromURLAsync(uri, [...PRODUKT_BARCODE_TYPEN]),
        FOTO_LESEN_LIMIT_MS,
        ZEITGRENZE,
      );
      if (scans === ZEITGRENZE) return { nummern: [], gescheitert: true };
      roh = (scans ?? []).map((s) => (s?.data ?? '').trim());
    }
    const nummern: string[] = [];
    for (const n of roh) {
      if (pruefzifferStimmt(n) && !nummern.some((a) => gleicheGtin(a, n))) nummern.push(n);
    }
    return { nummern, gescheitert: false };
  } catch {
    return { nummern: [], gescheitert: true };
  }
}
