/**
 * Single source of truth for starting the product-photo submission flow
 * from a GENERIC entry point (Rewards-Tile, Kampagnen-Card, Home
 * Schnellzugriff, future CTAs …). ClickUp 86cagb5gh.
 *
 * Gate-Regel: Läuft gerade eine product_photos-Aktion MIT Reward, muss der
 * User den Cashback-Consent akzeptiert haben, bevor er in den Flow geht —
 * sonst würde er einreichen, ohne zu wissen, dass es Geld gäbe (bzw. ohne
 * dass der Server ihm den Reward gutschreiben darf). Ohne laufende Aktion
 * (oder wenn die Kampagnen-Abfrage fehlschlägt) bleibt der Flow ungegatet:
 * Datensammlung ist immer möglich, auch anonym.
 *
 * Takes the caller's already-subscribed consent state (useCashbackUserState
 * ().hasConsent) so it doesn't open a second /users/{uid} listener — same
 * contract as startReceiptScanFlow.
 */

import { router } from 'expo-router';

import { consentService } from '@/lib/services/consentService';
import { getActiveProductCampaign } from '@/lib/services/productSubmit';

export async function startProductSubmitFlow(hasConsent: boolean): Promise<void> {
  let paysReward = false;
  try {
    const campaign = await getActiveProductCampaign();
    paysReward = !!campaign && campaign.rewardCents > 0;
  } catch {
    // Kampagnen-Lookup fehlgeschlagen (offline etc.) → kein Gate; die
    // Einreichung selbst funktioniert offline über die Upload-Queue.
  }

  if (paysReward && !hasConsent) {
    // Consent-Screen in der Produktbilder-Variante; nach Akzeptieren
    // routet er selbst weiter nach /product-submit (from=product).
    router.push('/cashback/consent?from=product' as any);
    return;
  }

  if (paysReward) {
    // 86cagb57g: aktives Cashback-Engagement → ggf. den beim App-Start
    // abgelehnten Tracking-Consent (UMP, Android) erneut anbieten.
    await consentService.ensureTrackingConsentAtCashback();
  }

  router.push('/product-submit' as any);
}
