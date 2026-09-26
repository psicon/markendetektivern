import AsyncStorage from '@react-native-async-storage/async-storage';

import { OnboardingService } from '@/lib/services/onboardingService';

/**
 * Wohin es nach der Anmeldung zurückgeht (Entscheidung 25.09.2026 „erst
 * einreichen, dann Konto"). Bisher endete jeder Anmeldeweg fest auf Home —
 * wer von „Konto sichern" am Bon kam, landete woanders.
 *
 * Einziger Schreiber von `auth_rueckkehr_v1` = { ziel, bis }. Nur eine
 * Whitelist von Zielen ist erlaubt (kein offener Redirect). Gültig 30 min
 * und zusätzlich im Speicher gehalten, weil Apple-/Google-/Facebook-Sheets
 * die App in den Hintergrund schicken.
 */

const KEY = 'auth_rueckkehr_v1';
const GUELTIG_MS = 30 * 60 * 1000;
const ERLAUBT: RegExp[] = [
  /^\/cashback\/pending\/[A-Za-z0-9_-]{1,64}$/,
  /^\/cashback\/history$/,
  /^\/product-submit$/,
  /^\/\(tabs\)\/rewards$/,
  /^\/cashback\/consent\?from=(receipt|product|rewards|survey|settings)$/,
];

let imSpeicher: { ziel: string; bis: number } | null = null;

function erlaubt(ziel: string): boolean {
  return ERLAUBT.some((r) => r.test(ziel));
}

async function lesen(): Promise<{ ziel: string; bis: number } | null> {
  if (imSpeicher) return imSpeicher;
  try {
    const raw = await AsyncStorage.getItem(KEY);
    const v = raw ? JSON.parse(raw) : null;
    if (v && typeof v.ziel === 'string' && typeof v.bis === 'number') imSpeicher = v;
  } catch {
    // ohne Ziel geht es wie bisher nach Home
  }
  return imSpeicher;
}

async function schreiben(v: { ziel: string; bis: number } | null): Promise<void> {
  imSpeicher = v;
  try {
    if (v) await AsyncStorage.setItem(KEY, JSON.stringify(v));
    else await AsyncStorage.removeItem(KEY);
  } catch {
    // Speicherfehler → Rücksprung fällt auf Home zurück, nichts blockiert.
  }
}

type RouterLike = {
  replace: (href: any) => void;
  push: (href: any) => void;
  canDismiss?: () => boolean;
  dismissAll?: () => void;
};

export const AuthRueckkehr = {
  /** Ziel für die nächste erfolgreiche Anmeldung vormerken (nur Whitelist). */
  async merke(ziel: string): Promise<void> {
    if (!erlaubt(ziel)) return;
    await schreiben({ ziel, bis: Date.now() + GUELTIG_MS });
  },

  /**
   * Nach einem Wechsel in ein BESTEHENDES Konto gibt es den Bon-Spiegel unter
   * der neuen uid noch nicht — dann lieber in die Bon-Liste als in ein
   * leeres Detail.
   */
  async nachKontowechsel(): Promise<void> {
    const v = await lesen();
    if (v && v.ziel.startsWith('/cashback/pending/')) {
      await schreiben({ ziel: '/cashback/history', bis: v.bis });
    }
  },

  /** Ziel lesen und verbrauchen (null, wenn keins oder abgelaufen). */
  async nehmen(): Promise<string | null> {
    const v = await lesen();
    await schreiben(null);
    if (!v || v.bis < Date.now() || !erlaubt(v.ziel)) return null;
    return v.ziel;
  },

  /**
   * Abschluss jedes erfolgreichen Anmeldewegs: Onboarding als erledigt
   * markieren, dann zum vorgemerkten Ziel — sonst wie bisher Home.
   */
  async abschliessen(router: RouterLike): Promise<void> {
    await OnboardingService.markCompleted();
    const ziel = await AuthRueckkehr.nehmen();
    // Anmelde-Screens UND den Ursprungsscreen verlassen: sonst lagen nach
    // dem Ersetzen Ursprung und Tabs doppelt im Stapel, und „Zurück" führte
    // nach einem Kontowechsel auf eine Seite der alten uid (Prüfrunde 2).
    try {
      if (router.canDismiss?.()) router.dismissAll?.();
    } catch {
      // ohne Aufräumen geht es wie bisher weiter
    }
    if (!ziel) {
      router.replace('/(tabs)');
      return;
    }
    if (ziel === '/(tabs)/rewards') {
      router.replace(ziel);
      return;
    }
    // Home als Basis, damit „Zurück" vom Ziel einen sinnvollen Stand hat.
    router.replace('/(tabs)');
    router.push(ziel);
  },
};
