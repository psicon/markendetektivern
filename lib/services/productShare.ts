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
}): Promise<void> {
  const url = productShareUrl(opts.kind, opts.id);
  const name = (opts.name || '').trim();
  const text = name
    ? `${name} – entdeckt mit MarkenDetektive`
    : 'Entdeckt mit MarkenDetektive';
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
