/**
 * Side-effect-Modul: registriert RNFBs setBackgroundMessageHandler auf
 * MODUL-Ebene (RNFB verlangt Registrierung außerhalb des React-Lifecycles,
 * vor dem ersten Mount — deshalb Side-effect-Import in app/_layout.tsx,
 * gleiches Muster wie androidTextFontPatch). ClickUp 86cb7gfc9.
 *
 * Unsere Pushes sind notification+data (die Anzeige übernimmt das System-
 * Tray) — der Handler ist reine No-op-Sicherheit: ohne ihn warnt RNFB bei
 * Hintergrund-Messages („No background message handler registered") und
 * Android kann Headless-Task-Fehler loggen. Das Tap-Routing läuft separat
 * über fcmDeepLinks.ts.
 */

import { isMessagingLinked } from './fcmTokenService';

if (isMessagingLinked()) {
  // Dynamisch + linked-Guard: ein statischer Import crasht Dev-Clients,
  // deren natives Modul (noch) nicht eingebaut ist — gleiche Vorsicht wie
  // fcmTokenService.getMessagingModule().
  void import('@react-native-firebase/messaging')
    .then((mod: any) => {
      const Messaging = mod?.default ?? mod;
      try {
        Messaging().setBackgroundMessageHandler(async () => {});
      } catch (e: any) {
        console.warn('[fcm] setBackgroundMessageHandler failed:', e?.message);
      }
    })
    .catch(() => {});
}

export {};
