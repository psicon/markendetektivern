// useGamificationEnabled — React-Hook der live ein Boolean liefert,
// ob die spielerischen Inhalte aktuell aktiviert sind.
//
// Der zugrundeliegende `gamificationSettingsService` cached den
// State im Speicher und benachrichtigt Listener bei Toggle-
// Änderungen. Der Hook abonniert beim Mount, deregistriert beim
// Unmount, und triggert Re-Renders der Consumer wenn der State
// flippt — sodass Level-Cards / Badges / Tabs etc. sofort
// erscheinen oder verschwinden ohne App-Neustart.
//
// Beim allerersten Mount läuft der Service evtl. noch nicht aus
// AsyncStorage geladen — wir nehmen dann `true` (= enabled) als
// optimistic default an. Das vermeidet UI-Flicker beim Cold Start
// (Level-Card zeigt sich kurz, dann wird sie ausgeblendet weil
// User sie disabled hat). Die Async-Load triggert dann ein
// Re-Render mit dem korrekten Wert.

import { useEffect, useState } from 'react';
import { gamificationSettingsService } from '@/lib/services/gamificationSettingsService';

export function useGamificationEnabled(): boolean {
  const [enabled, setEnabled] = useState<boolean>(() => {
    // Lazy-Initial: synchroner Cache-Read. Wenn `null`, optimistic
    // default `true` — siehe Block-Kommentar oben.
    const cached = gamificationSettingsService.getCachedEnabled();
    return cached ?? true;
  });

  useEffect(() => {
    let cancelled = false;
    // Cold-Start: Service hat evtl. noch keinen Storage-Read
    // gemacht. loadInitial liefert nach Read den finalen Wert,
    // bei dem wir das Optimistic-Default überschreiben.
    (async () => {
      const v = await gamificationSettingsService.loadInitial();
      if (!cancelled) setEnabled(v);
    })();
    // Live-Updates: subscribe, beim Toggle-Change setEnabled.
    const off = gamificationSettingsService.subscribe(setEnabled);
    return () => {
      cancelled = true;
      off();
    };
  }, []);

  return enabled;
}
