import { useNavigation } from 'expo-router';
import { useEffect, useMemo, useRef } from 'react';

export interface BildschirmAktiv {
  /** Die Komponente ist noch montiert — nur dann darf State gesetzt werden. */
  gemountet: () => boolean;
  /** Montiert UND sichtbar vorn (nicht verlassen, nicht überdeckt). Nur dann
   *  darf nach einem langen await navigiert oder ein Hinweis gezeigt werden. */
  aktiv: () => boolean;
}

/**
 * Lebenszyklus für lange awaits in Kamera-Screens (Aufnahme, Hash, Entzerren):
 * Nach dem await ist der Screen womöglich schon verlassen — X getippt, eine
 * Push-Nachricht hat per router.push ein anderes Ziel geöffnet. Ein
 * `router.replace` träfe dann die Route, die der Nutzer gerade sieht; ein
 * Dialog erschiene über einer fremden Seite.
 *
 * Liest den Fokus beim Aufruf (`navigation.isFocused()`), statt ihn in einem
 * Ref mitzuführen — dadurch stimmt er auch in Übergängen, in denen noch kein
 * Fokus-Effekt gelaufen ist.
 */
export function useBildschirmAktiv(): BildschirmAktiv {
  const navigation = useNavigation();
  const gemountetRef = useRef(true);

  useEffect(() => {
    gemountetRef.current = true;
    return () => {
      gemountetRef.current = false;
    };
  }, []);

  return useMemo(
    () => ({
      gemountet: () => gemountetRef.current,
      aktiv: () => gemountetRef.current && navigation.isFocused(),
    }),
    [navigation],
  );
}
