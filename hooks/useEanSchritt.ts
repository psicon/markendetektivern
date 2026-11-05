/**
 * EAN-Schritt des Foto-Assistenten: Live-Lesungen bestätigen, das EAN-Foto
 * aufnehmen, die Nummer übernehmen oder erfragen.
 *
 * Anlass (06.10.2026): Der Assistent übernahm die erste Live-Lesung und löste
 * sofort aus — auf Android trugen 5,9 % der lesbaren Barcode-Fotos eine
 * falsche Nummer. Jetzt gilt:
 *  - Auslösen erst nach bestätigter Lesung (`barcodeBestaetigung.ts`).
 *  - Android liest das fertige Foto nach; weicht es ab, bestätigt der Nutzer
 *    die Nummer (vorbefüllt mit der Foto-Lesung) — nie ohne Nummer speichern.
 *  - Nach `EINTIPPEN_NACH_MS` ohne Bestätigung: „Nummer eintippen“.
 *  - Selbst ausgelöst / Galerie: Nummer vom Foto, sonst erfragen.
 *
 * Der Automat lebt in einem Ref: Kamera-Ereignisse kommen mehrmals pro
 * Sekunde, ein State-Update je Lesung renderte den ganzen Assistenten neu.
 */
import * as Haptics from 'expo-haptics';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';

import type { BildschirmAktiv } from '@/hooks/useBildschirmAktiv';
import { leseBarcodesAusFoto } from '@/lib/services/barcodeFoto';
import {
  belastbareKandidaten,
  entscheideEan,
  erstelleBarcodeBestaetigung,
  type EanAnlass,
  type EanNachfrageGrund,
  type FotoLesung,
} from '@/lib/utils/barcodeBestaetigung';

/**
 * Nach so langer Suche ohne Bestätigung bieten wir das Eintippen an. Normal
 * bestätigt die Kamera in 0,3–1 s; vier Sekunden heißen: der Code ist schwer
 * lesbar (Folie, Knick, Wölbung) — dann soll niemand weiter wedeln müssen.
 */
export const EINTIPPEN_NACH_MS = 4000;

/** iPhone ohne Nachlesen: dort liest die Live-Kamera zuverlässig (0,5 % falsch). */
const NICHT_NACHGELESEN: FotoLesung = { nummern: [], gescheitert: false };

export interface EanAbfrage {
  uri: string;
  grund: EanNachfrageGrund;
  vorschlag: string;
  vorschlaege: string[];
}

export function useEanSchritt(opts: {
  /** EAN-Schritt sichtbar, Kamera bereit, keine Aufnahme läuft. */
  aktiv: boolean;
  /** Kamera bereit (onCameraReady) — Pflicht vor jedem Auslösen. */
  kameraBereit: boolean;
  /** Ein Foto aufnehmen; `null` = kein Bild (Hinweis schon gezeigt). */
  fotoAufnehmen: () => Promise<string | null>;
  onCaptured: (uri: string) => void;
  setEanCode: (code: string | null) => void;
  setCapturing: (v: boolean) => void;
  bildschirm: BildschirmAktiv;
}) {
  const { aktiv, kameraBereit, fotoAufnehmen, onCaptured, setEanCode, setCapturing, bildschirm } = opts;
  const automat = useRef(erstelleBarcodeBestaetigung());
  /** Scan für diesen Durchgang erledigt/gesperrt (Ref: greift sofort). */
  const erledigtRef = useRef(false);
  /**
   * Durchgangs-Zähler: jeder Neustart (Schritt-/Phasenwechsel, Abbruch) macht
   * eine noch laufende Aufnahme ungültig — ihr Foto darf dann weder in ein
   * Fach noch in eine Nachfrage (Zurück-Pfeil während der Aufnahme).
   */
  const durchgangRef = useRef(0);
  const [abfrage, setAbfrage] = useState<EanAbfrage | null>(null);
  const [eintippenAnbieten, setEintippenAnbieten] = useState(false);

  const live = aktiv && !abfrage;
  useEffect(() => {
    if (!live) {
      setEintippenAnbieten(false);
      return;
    }
    const t = setTimeout(() => setEintippenAnbieten(true), EINTIPPEN_NACH_MS);
    return () => clearTimeout(t);
  }, [live]);

  /** Scan neu scharf schalten (Schritt-/Phasenwechsel, Abbruch, kein Foto). */
  const neuStarten = useCallback(() => {
    durchgangRef.current += 1;
    erledigtRef.current = false;
    automat.current.zuruecksetzen();
  }, []);

  const erfassen = useCallback(
    async (anlass: EanAnlass, nummern: string[] = []) => {
      if (erledigtRef.current || !kameraBereit) return;
      erledigtRef.current = true;
      const durchgang = durchgangRef.current;
      const gueltig = () => bildschirm.aktiv() && durchgangRef.current === durchgang;
      setCapturing(true);
      let uebergeben = false;
      try {
        const uri = await fotoAufnehmen();
        if (!uri || !gueltig()) return;
        const foto =
          anlass === 'bestaetigt' && Platform.OS !== 'android' ? NICHT_NACHGELESEN : await leseBarcodesAusFoto(uri);
        if (!gueltig()) return;
        const d = entscheideEan({
          anlass,
          bestaetigt: anlass === 'bestaetigt' ? nummern[0] : null,
          foto,
          live: anlass === 'mehrdeutig' ? nummern : belastbareKandidaten(automat.current.kandidaten(Date.now())),
        });
        uebergeben = true;
        if (d.art === 'uebernehmen') {
          setEanCode(d.nummer);
          if (anlass !== 'bestaetigt') {
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
          }
          onCaptured(uri);
        } else {
          setAbfrage({ uri, grund: d.grund, vorschlag: d.vorschlag, vorschlaege: d.vorschlaege });
        }
      } finally {
        // Kein Foto übergeben: Scan wieder scharf — außer ein Neustart kam
        // dazwischen, der hat das schon getan.
        if (!uebergeben && durchgangRef.current === durchgang) neuStarten();
        if (bildschirm.gemountet()) setCapturing(false);
      }
    },
    [kameraBereit, fotoAufnehmen, bildschirm, onCaptured, setEanCode, setCapturing, neuStarten],
  );

  /**
   * Eine Live-Lesung von `onBarcodeScanned`. Vor `kameraBereit` wird nichts
   * gezählt und nichts konsumiert — die folgenden Frames liefern sie erneut.
   */
  const lesung = useCallback(
    (data: string | undefined) => {
      if (erledigtRef.current || !kameraBereit || abfrage) return;
      const stand = automat.current.lesen((data || '').trim(), Date.now());
      if (stand.art === 'bestaetigt') {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        void erfassen('bestaetigt', [stand.nummer]);
      } else if (stand.art === 'mehrdeutig') {
        void erfassen('mehrdeutig', stand.nummern);
      }
    },
    [kameraBereit, abfrage, erfassen],
  );

  /** Galeriebild im EAN-Schritt: Nummer lesen, sonst erfragen. */
  const galerieBild = useCallback(
    async (uri: string) => {
      setCapturing(true);
      let foto: FotoLesung;
      try {
        foto = await leseBarcodesAusFoto(uri);
      } finally {
        if (bildschirm.gemountet()) setCapturing(false);
      }
      if (!bildschirm.aktiv()) return;
      erledigtRef.current = true;
      const d = entscheideEan({ anlass: 'galerie', foto, live: [] });
      if (d.art === 'nachfragen') {
        setAbfrage({ uri, grund: d.grund, vorschlag: d.vorschlag, vorschlaege: d.vorschlaege });
        return;
      }
      setEanCode(d.nummer);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      onCaptured(uri);
    },
    [bildschirm, onCaptured, setEanCode, setCapturing],
  );

  /** Nummer aus der Eingabe (Prüfziffer prüft `EanEingabe`) samt Foto übernehmen. */
  const uebernehmen = useCallback(
    (nummer: string) => {
      const uri = abfrage?.uri;
      setAbfrage(null);
      if (!uri) return;
      setEanCode(nummer);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      onCaptured(uri);
    },
    [abfrage, onCaptured, setEanCode],
  );

  /**
   * Nur wenn gar keine Nummer lesbar war (`EanEingabe` zeigt den Weg nur dann): Foto ohne
   * Nummer übernehmen — wie früher; der Server liest sie dann vom Foto nach.
   * Ohne diesen Ausweg säße fest, wessen Strichcode samt Ziffern unleserlich
   * ist. Bei einer Abweichung oder zwei Codes gibt es ihn bewusst nicht.
   */
  const ohneNummer = useCallback(() => {
    const uri = abfrage?.uri;
    setAbfrage(null);
    if (!uri) return;
    // Eine Nummer aus einer früheren Aufnahme darf nicht am neuen Foto hängen.
    setEanCode(null);
    onCaptured(uri);
  }, [abfrage, onCaptured, setEanCode]);

  /** Eingabe verworfen: Foto verwerfen, Live-Scan neu starten. */
  const abbrechen = useCallback(() => {
    setAbfrage(null);
    neuStarten();
  }, [neuStarten]);

  return { lesung, erfassen, galerieBild, uebernehmen, ohneNummer, abbrechen, neuStarten, abfrage, eintippenAnbieten };
}
