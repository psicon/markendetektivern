/**
 * Single source of truth for starting a receipt scan from a GENERIC entry
 * point (Home Schnellzugriff, "Meine Bons", future CTAs …).
 *
 * Honours the SAME action selection as the Belohnungen tab so no entry
 * point can scan without picking the campaign (Bug 86ca24dk4):
 *   - Aktions-Modus + >1 Kassenbon-Aktion → route to Belohnungen (?scan=1)
 *     where the picker lives.
 *   - exactly 1 Aktion → preselect it.
 *   - no Aktions-Modus / 0 Aktionen → set the campaign to null (never leave
 *     a stale selection) and go straight to capture.
 * Then route via the consent gate when consent isn't accepted yet.
 *
 * Takes the caller's already-subscribed cashback state (uid + hasConsent)
 * so it doesn't open a second /users/{uid} listener.
 */

import { router } from 'expo-router';

import { getActiveCashbackCampaigns, getCashbackConfig } from '@/lib/services/cashbackService';
import { setSelectedCampaignId } from '@/lib/services/cashbackUpload';
import { consentService } from '@/lib/services/consentService';

export async function startReceiptScanFlow(
  uid: string | null,
  hasConsent: boolean,
): Promise<void> {
  if (!uid) {
    router.push('/auth/login');
    return;
  }

  let campaignsEnabled = false;
  let receiptCampaigns: { id: string }[] = [];
  try {
    const cfg = await getCashbackConfig();
    campaignsEnabled = Boolean(cfg.campaignsEnabled);
    if (campaignsEnabled) {
      const all = await getActiveCashbackCampaigns();
      receiptCampaigns = all.filter((c) => (c.kind ?? 'receipt') === 'receipt');
    }
  } catch {
    // Fall through to the no-campaign path on any config error.
  }

  if (campaignsEnabled && receiptCampaigns.length > 1) {
    router.push('/(tabs)/rewards?scan=1' as any);
    return;
  }

  setSelectedCampaignId(
    campaignsEnabled && receiptCampaigns.length === 1 ? receiptCampaigns[0].id : null,
  );
  if (hasConsent) {
    // 86cagb57g: beim App-Start abgelehnten Tracking-Consent (UMP, Android)
    // einmal pro Session erneut anbieten — DANN in den Scanner (das native
    // Formular soll nicht über der Kamera-Permission hängen).
    await consentService.ensureTrackingConsentAtCashback();
    router.push('/cashback/capture');
    return;
  }
  // Echter Scan-Intent → nach Consent in den Bon-Scanner (from=receipt).
  router.push('/cashback/consent?from=receipt');
}
