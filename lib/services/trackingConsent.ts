/**
 * Markt-Daten-Consent-Gate — Single Source of Truth für die Frage
 * "dürfen Verhaltens-/Journey-Daten dieses Users erhoben werden?"
 * (ClickUp 86ca6u6xd).
 *
 * Rechtsgrundlage ist der Cashback-Consent ab v2.0: dessen Text deckt
 * neben den Bon-Daten auch die App-Nutzung ab ("Anonyme Marktdaten").
 * Ohne gültigen Consent in der AKTUELLEN Version (Config-Doc
 * cashback_config/v1) wird NICHTS in die Journey-Pipeline geschrieben
 * und keine IP-Standortabfrage gemacht.
 *
 * Design:
 * - Module-level Flag, default `false` → privacy by default. Bis der
 *   User-Snapshot da ist, wird nicht getrackt (konservativ; die ersten
 *   Sekunden einer Session können für consentete User entfallen).
 * - `startMarketDataConsentSync(uid)` hängt sich an den bestehenden
 *   User-Snapshot (subscribeCashbackUserState) — kein zusätzlicher
 *   Listener-Pfad, kein zweiter Storage-Key. Gleiche Semantik wie
 *   useCashbackUserState.hasConsent (accepted + Versions-Vergleich;
 *   solange die Config lädt, zählt nur accepted).
 * - Konsumenten (journeyTrackingService, AnonymousLocationService)
 *   prüfen synchron via `isMarketDataConsentGranted()` — Tracking-
 *   Pfade sind fire-and-forget und dürfen nirgends awaiten.
 *
 * GA4/analyticsService ist hier BEWUSST nicht gegated: das ist
 * interne Produkt-Analytik, nicht Teil der verkauften Marktdaten.
 * Opt-Out dafür kommt mit dem Einstellungs-Toggle (Arbeitspaket [5]).
 */

import {
  getCashbackConfig,
  subscribeCashbackUserState,
} from './cashbackService';

let granted = false;
let unsubscribe: (() => void) | null = null;

/** Synchroner Check für alle Tracking-Schreibpfade. */
export function isMarketDataConsentGranted(): boolean {
  return granted;
}

/**
 * Consent-Status für den User live halten. Pro App-Session genau
 * einmal pro UID starten (AnalyticsProvider). Ersetzt eine evtl.
 * laufende Subscription (Account-Wechsel).
 *
 * `onChange` feuert bei jeder Änderung des Gate-Werts (auch beim
 * ersten Ermitteln) — z.B. um loadActiveJourney erst dann zu starten,
 * wenn der Consent bestätigt ist (der Snapshot kommt async, ein
 * sofortiger Call würde am Gate abprallen).
 */
export function startMarketDataConsentSync(
  uid: string,
  onChange?: (granted: boolean) => void,
): () => void {
  stopMarketDataConsentSync();

  let requiredVersion: string | null = null;
  let consent: { accepted?: boolean; version?: string } | null = null;

  const recompute = () => {
    const next =
      Boolean(consent?.accepted) &&
      (requiredVersion === null || consent?.version === requiredVersion);
    if (next !== granted) {
      granted = next;
      onChange?.(granted);
    }
  };

  getCashbackConfig()
    .then((config) => {
      requiredVersion = config.consentVersion;
      recompute();
    })
    .catch(() => {
      /* Config nicht ladbar → Fallback: nur accepted zählt */
    });

  unsubscribe = subscribeCashbackUserState(uid, (snapshot) => {
    consent = snapshot.consent;
    recompute();
  });

  return stopMarketDataConsentSync;
}

/** Logout / User-Wechsel: Subscription beenden, Gate schließen. */
export function stopMarketDataConsentSync(): void {
  unsubscribe?.();
  unsubscribe = null;
  granted = false;
}
