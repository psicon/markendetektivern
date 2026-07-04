/**
 * Produktkarten teilen — HTTPS-Links auf die product-share-Landing-Page
 * (Hosting-Rewrite /p/** → CF product-share, per-Produkt OG-Vorschau).
 *
 * Link-Format (muss mit cloud-functions/product-share/index.js KINDS
 * synchron bleiben):
 *   /p/n/<produktId>   → noname-detail (Stufe 1/2)
 *   /p/vn/<produktId>  → product-comparison?type=noname
 *   /p/vm/<markenId>   → product-comparison?type=brand
 *
 * Immer HTTPS-Links teilen, NIE das Custom-Scheme (iOS-Kamera/Messenger
 * öffnen `markendetektivern://` nicht — gleiche Regel wie Einladungs-Links).
 */

import { Platform, Share } from 'react-native';

import achievementService from '@/lib/services/achievementService';

const SHARE_LINK_BASE = 'https://markendetektive-895f7.web.app/p';

export type ProductShareKind = 'n' | 'vn' | 'vm';

export function productShareUrl(kind: ProductShareKind, id: string): string {
  return `${SHARE_LINK_BASE}/${kind}/${encodeURIComponent(id)}`;
}

/**
 * Öffnet das native Share-Sheet. Fire-and-forget-sicher: Fehler/Abbruch
 * sind still; Achievement-Tracking (`share_app`) nur nach tatsächlichem
 * Teilen (iOS meldet dismissedAction — Android immer sharedAction).
 */
export async function shareProduct(opts: {
  kind: ProductShareKind;
  id: string;
  name: string;
  uid?: string | null;
  /** Ersparnis fürs Message-Copy — nur bei >0 gerendert (Copy-Ton-Regel:
   *  Abwesenheit nie negativ formulieren). */
  savingsPct?: number | null;
  savingsEur?: number | null;
  /** Name des Marken-Originals für "gegenüber X". */
  vsBrandName?: string | null;
}): Promise<void> {
  const url = productShareUrl(opts.kind, opts.id);
  const name = (opts.name || '').trim();
  const pct =
    typeof opts.savingsPct === 'number' && opts.savingsPct > 0
      ? Math.round(opts.savingsPct)
      : null;
  const eur = typeof opts.savingsEur === 'number' && opts.savingsEur > 0 ? opts.savingsEur : null;
  const vs = (opts.vsBrandName || '').trim();

  // Message = Mini-Pitch, nicht nur ein Link (User-Vorgabe 2026-07-04):
  // konkreter Fund + harte Zahl + Aufforderung. Emoji bewusst nur hier im
  // Outward-Share-Text (App-UI bleibt emoji-frei).
  const lines = [name ? `🕵️ Detektiv-Fund: ${name}` : '🕵️ Detektiv-Fund bei MarkenDetektive'];
  if (pct) {
    const eurPart = eur ? ` – das sind ${eur.toFixed(2).replace('.', ',')} € pro Packung` : '';
    lines.push(`Spart ${pct} % gegenüber ${vs || 'dem Markenprodukt'}${eurPart}.`);
    lines.push('Selbst nachprüfen & mitsparen – kostenlos in der MarkenDetektive-App:');
  } else {
    lines.push('Preis-Check & günstige Alternativen – kostenlos in der MarkenDetektive-App:');
  }
  const text = lines.join('\n');
  try {
    // iOS: url SEPARAT übergeben — nur dann rendern iMessage & Co. die
    // Rich-Link-Karte (Bild + Titel von der Landing-Page). Text+Link in
    // EINER message bleibt dort Plain-Text. Android kennt kein url-Feld
    // → Link gehört in die message (WhatsApp unfurlt beides).
    const res = await Share.share(
      Platform.OS === 'ios' ? { message: text, url } : { message: `${text}\n${url}` },
    );
    if (res.action === Share.dismissedAction) return;
    if (opts.uid) {
      achievementService.trackAction(opts.uid, 'share_app').catch(() => {});
    }
  } catch {
    // Share-Sheet nicht verfügbar/abgebrochen → kein User-facing Fehler.
  }
}
