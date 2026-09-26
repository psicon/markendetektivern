import { Alert } from 'react-native';

import { auth } from '@/lib/firebase';
import { AuthRueckkehr } from '@/lib/services/authRueckkehr';
import {
  bonsVorWechselAbarbeiten,
  gesperrteFreigeben,
  pausiereBonQueue,
  setzeBonQueueFort,
} from '@/lib/services/bonUploadQueue';
import { GastBestand } from '@/lib/services/gastBestand';
import { GastUebernahme } from '@/lib/services/gastUebernahme';
import { isOnline } from '@/lib/services/network';
import {
  pausiereUploadQueue,
  setzeUploadQueueFort,
  uploadsVorWechselAbarbeiten,
} from '@/lib/services/uploadQueue';
import { isEffectivelyAnonymous } from '@/lib/utils/authIdentity';

/**
 * Wechsel eines Gastes in ein BESTEHENDES Konto (Entscheidung 25.09.2026
 * „erst einreichen, dann Konto", Bauanleitung Schritt 26).
 *
 * Es gibt vier Stellen, an denen ein Gast seine uid verliert: Anbieter-
 * Konflikt beim Verknüpfen (Google/Apple/Facebook), E-Mail-Anmeldung als Gast,
 * Registrierung mit schon vergebener E-Mail und die geführte Facebook-
 * Verknüpfung. Alle vier laufen durch `inBestehendesKontoWechseln`:
 *
 *   1. Kein Gast → direkt anmelden, sonst nichts.
 *   2. Gast OHNE Einreichungen → genau der Ablauf von vorher (Bestätigung,
 *      anmelden). Kein Besitznachweis, kein Hinweis, keine Netzrunde.
 *   3. Gast MIT Einreichungen → Mitnahme-Dialog (immer, keine 60-Minuten-
 *      Automatik), dann solange der Gast noch angemeldet ist:
 *        a) Besitznachweis sichern (`GastUebernahme.vorbereiten`) — danach
 *           ist er nicht mehr zu erbringen;
 *        b) offene Uploads des Gastes fertig hochladen (auch gescheiterte
 *           erneut) — nach dem Wechsel dürften sie bis zur Server-Übernahme
 *           nicht laufen; dauert es zu lange, darf der Nutzer trotzdem weiter;
 *        c) erst dann anmelden, Zielkonto merken, einlösen. In Stufe 1
 *           antwortet der Server mit `pausiert`; der Eintrag bleibt und wird
 *           bei Start/Vordergrund erneut versucht.
 *      Klappt a) nicht, kann der Nutzer trotzdem in sein Konto — er wird nie
 *      aus dem eigenen Konto ausgesperrt (Prüfrunde 1).
 *
 * Während des eigentlichen Wechsels ruhen beide Upload-Warteschlangen, damit
 * kein Auftrag mit halb gewechselter Identität startet.
 */

/**
 * Wechsel abgebrochen, weil der Besitznachweis bei vorhandenem Bestand nicht
 * gesichert werden konnte. Kein Defekt: die Anmelde-Bildschirme zeigen dafür
 * einen kurzen Hinweis (lib/utils/authFehler.ts).
 */
export const KONTO_UMZUG_OFFLINE = 'auth/konto-umzug-offline';

const OFFLINE_TEXT =
  'Deine Einreichungen nehmen wir gleich mit – dafür brauchen wir kurz Netz. Bitte gleich nochmal versuchen.';

/** Wie lange je Runde auf offene Gast-Uploads gewartet wird. */
const ABARBEITEN_MS = 20_000;

/**
 * Eine Mitnahme-Bestätigung gilt zehn Minuten für denselben Gast UND dieselbe
 * Ziel-E-Mail. Der Weg Facebook → „Konto hat ein Passwort" ruft den Wechsel
 * zweimal auf (erst der Anbieter-Versuch, dann die Passwort-Eingabe) — ohne
 * das käme der Dialog doppelt (Prüfrunde 1). Für ein anderes oder unbekanntes
 * Zielkonto wird erneut gefragt (Prüfrunde 2).
 */
const BESTAETIGUNG_GILT_MS = 10 * 60 * 1000;
let mitnahmeBestaetigt: { uid: string; email: string; bis: number } | null = null;

function normEmail(email: string | null | undefined): string | null {
  const e = (email ?? '').trim().toLowerCase();
  return e.includes('@') ? e : null;
}

type CodeFehler = Error & { code: string };

function codeFehler(code: string, message: string): CodeFehler {
  const err = new Error(message) as CodeFehler;
  err.code = code;
  return err;
}

/**
 * Abbruch, so wie ihn alle Anmelde-Bildschirme heute kennen: `auth/cancelled`
 * wird dort still behandelt (Formular bleibt offen, kein Toast).
 */
function abbruchFehler(): CodeFehler {
  return codeFehler('auth/cancelled', 'Anmeldung abgebrochen');
}

/** p***@web.de — genug zum Wiedererkennen, nicht genug zum Ausspähen. */
export function maskiereEmail(email: string | null | undefined): string | null {
  const e = (email ?? '').trim();
  const at = e.lastIndexOf('@');
  if (at < 1 || at >= e.length - 1) return null;
  return `${e[0]}***${e.slice(at)}`;
}

/**
 * Confirm-Dialog, wenn ein Gast OHNE Einreichungen in ein bestehendes Konto
 * wechselt. Liefert true, wenn der User fortfahren will, sonst false.
 * (Unverändert aus AuthContext verschoben.)
 *
 * ClickUp 86ca7f3xn (2026-06-11):
 * - FRISCHE Anon-Session (< 60 Min, typisch: erste Anmeldung direkt
 *   nach dem Onboarding) → KEIN Dialog, einfach mit dem bestehenden
 *   Konto fortfahren. Da ist nichts Wertvolles zu verlieren, und
 *   ein Warn-Dialog beim allerersten Login ist doppelt verwirrend.
 * - Sonst: positive Formulierung ("Mit diesem Konto fortfahren"
 *   statt rotem "Konto wechseln") + faktischer Hinweis, dass die
 *   Gast-Daten nicht übernommen werden.
 */
export function confirmAccountSwitch(): Promise<boolean> {
  const createdAt = auth.currentUser?.metadata?.creationTime;
  if (createdAt) {
    const ageMs = Date.now() - new Date(createdAt).getTime();
    // 60 Min statt 5 (ClickUp 86ca7x1m2): Onboarding + Walkthrough
    // dauern laenger als 5 Min — die 'erste Anmeldung direkt nach
    // der Installation' fiel sonst aus dem Fenster und bekam den
    // Dialog doch. 60 Min deckt die gesamte Erst-Session ab.
    if (Number.isFinite(ageMs) && ageMs >= 0 && ageMs < 60 * 60 * 1000) {
      return Promise.resolve(true);
    }
  }
  return new Promise((resolve) => {
    // Copy-Ton-Regel + ClickUp 86ca7x1m2: kein 'nicht übernommen'
    // (Negativ-Frame), Button kurz und eindeutig.
    Alert.alert(
      'Du hast bereits ein Konto',
      'Mit diesem Konto bist du schon einmal angemeldet gewesen. ' +
        'Du machst genau dort weiter, wo du damit aufgehört hast — ' +
        'mit deinen Punkten, Favoriten und Listen aus diesem Konto.',
      [
        { text: 'Abbrechen', style: 'cancel', onPress: () => resolve(false) },
        {
          text: 'Ok, fortfahren!',
          onPress: () => resolve(true),
        },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    );
  });
}

/**
 * Mitnahme-Dialog für Gäste MIT Einreichungen. Erscheint immer — auch in der
 * ersten Stunde und auch dort, wo ein anderes Sheet schon bestätigt hat —,
 * weil hier Bons und Guthaben den Besitzer wechseln.
 */
function bestaetigeMitnahme(zielEmail: string | null | undefined): Promise<boolean> {
  const maskiert = maskiereEmail(zielEmail);
  return new Promise((resolve) => {
    Alert.alert(
      'Willkommen zurück!',
      `Deine Bons, Fotos und dein Guthaben nehmen wir mit in dein Konto${maskiert ? ` ${maskiert}` : ''}.`,
      [
        { text: 'Abbrechen', style: 'cancel', onPress: () => resolve(false) },
        { text: 'Mitnehmen & anmelden', onPress: () => resolve(true) },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    );
  });
}

/**
 * Der Besitznachweis ließ sich nicht sichern (Server/Netz). Der Nutzer darf
 * trotzdem in sein Konto — sonst sperrte ein Serverfehler ihn aus dem eigenen
 * Konto aus. Liefert 'nochmal' | 'anmelden' | 'abbrechen'.
 */
function fragNachFehlschlag(): Promise<'nochmal' | 'anmelden' | 'abbrechen'> {
  return new Promise((resolve) => {
    Alert.alert(
      'Mitnahme klappt gerade nicht',
      'Versuch es gleich nochmal. Wenn du dich jetzt anmeldest, bleiben deine Gast-Einreichungen erst einmal beim Gast-Zugang – unser Support hilft dir beim Übertragen.',
      [
        { text: 'Abbrechen', style: 'cancel', onPress: () => resolve('abbrechen') },
        { text: 'Jetzt anmelden', onPress: () => resolve('anmelden') },
        { text: 'Nochmal versuchen', onPress: () => resolve('nochmal') },
      ],
      { cancelable: true, onDismiss: () => resolve('abbrechen') },
    );
  });
}

/**
 * Uploads laufen noch — weiter warten, trotzdem anmelden (der Rest bleibt auf
 * dem Gerät und folgt nach der Übertragung) oder abbrechen. Nie still
 * zurücklassen, nie aussperren (Prüfrunde 2).
 */
function fragWeiterWarten(gesichert: boolean): Promise<'warten' | 'anmelden' | 'abbrechen'> {
  // Ohne gesicherten Besitznachweis gibt es keine Mitnahme — dann nichts
  // versprechen (Nachprüfung Runde 2).
  const text = gesichert
    ? 'Deine Einreichungen werden noch hochgeladen. Einen Moment noch, dann nehmen wir alles mit – oder melde dich schon an, der Rest folgt später.'
    : 'Deine Einreichungen werden noch gespeichert. Einen Moment noch – oder melde dich schon an.';
  return new Promise((resolve) => {
    Alert.alert(
      'Gleich fertig',
      text,
      [
        { text: 'Abbrechen', style: 'cancel', onPress: () => resolve('abbrechen') },
        { text: 'Jetzt anmelden', onPress: () => resolve('anmelden') },
        { text: 'Weiter warten', onPress: () => resolve('warten') },
      ],
      { cancelable: true, onDismiss: () => resolve('abbrechen') },
    );
  });
}

/** Offene Uploads des Gastes hochladen, solange er noch angemeldet ist. */
async function uploadsAbarbeiten(vonUid: string, gesichert: boolean): Promise<void> {
  for (;;) {
    const [bons, fotos] = await Promise.all([
      bonsVorWechselAbarbeiten(vonUid, ABARBEITEN_MS),
      uploadsVorWechselAbarbeiten(vonUid, ABARBEITEN_MS),
    ]);
    if (bons && fotos) return;
    const wahl = await fragWeiterWarten(gesichert);
    if (wahl === 'abbrechen') throw abbruchFehler();
    if (wahl === 'anmelden') return;
  }
}

export interface KontoWechselOptionen<T> {
  /** E-Mail des Zielkontos, falls bekannt — nur maskiert angezeigt. */
  zielEmail?: string | null;
  /**
   * true, wenn ein anderes UI den Wechsel schon bestätigt hat (Facebook-
   * Link-Sheet). Gilt nur ohne Bestand — mit Bestand kommt der Mitnahme-
   * Dialog trotzdem.
   */
  dialogUeberspringen?: boolean;
  /** Der eigentliche Anmeldeschritt, der die uid wechselt. */
  anmelden: () => Promise<T>;
}

/**
 * Einziger Weg, auf dem ein Gast in ein bestehendes Konto wechselt.
 * Wirft `auth/cancelled` bei Ablehnung und `auth/konto-umzug-offline`, wenn
 * bei vorhandenem Bestand kein Netz da ist. Fehler aus `anmelden()` kommen
 * unverändert durch.
 */
export async function inBestehendesKontoWechseln<T>(opts: KontoWechselOptionen<T>): Promise<T> {
  const vorher = auth.currentUser;
  if (!vorher || !isEffectivelyAnonymous(vorher)) return opts.anmelden();
  const vonUid = vorher.uid;

  // Wirft nicht: im Zweifel gilt „hat Bestand" (lib/services/gastBestand.ts).
  const bestand = await GastBestand.hat(vonUid);

  if (!bestand) {
    // Der Normalfall — exakt wie vor dem Umbau.
    const weiter = opts.dialogUeberspringen ? true : await confirmAccountSwitch();
    if (!weiter) throw abbruchFehler();
    return opts.anmelden();
  }

  const zielEmail = normEmail(opts.zielEmail);
  const schonBestaetigt =
    !!zielEmail &&
    mitnahmeBestaetigt?.uid === vonUid &&
    mitnahmeBestaetigt.email === zielEmail &&
    mitnahmeBestaetigt.bis > Date.now();
  if (!schonBestaetigt) {
    if (!(await bestaetigeMitnahme(opts.zielEmail))) throw abbruchFehler();
    mitnahmeBestaetigt = zielEmail
      ? { uid: vonUid, email: zielEmail, bis: Date.now() + BESTAETIGUNG_GILT_MS }
      : null;
  }
  // Ohne Netz scheitert die Anmeldung ohnehin — nicht erst drei Versuche warten.
  if (!isOnline()) throw codeFehler(KONTO_UMZUG_OFFLINE, OFFLINE_TEXT);

  let gesichert = false;
  for (;;) {
    const ergebnis = await GastUebernahme.vorbereiten(vonUid);
    if (ergebnis === 'ok') {
      gesichert = true;
      break;
    }
    if (ergebnis === 'offline') throw codeFehler(KONTO_UMZUG_OFFLINE, OFFLINE_TEXT);
    const wahl = await fragNachFehlschlag();
    if (wahl === 'abbrechen') throw abbruchFehler();
    if (wahl === 'anmelden') break;
  }

  // Auch ohne gesicherten Nachweis: solange der Gast angemeldet ist, landen
  // seine Einreichungen samt Gutschrift auf dem Server — sonst lägen sie nur
  // auf dem Gerät, und auch der Support könnte nichts übertragen (Prüfrunde 2).
  await uploadsAbarbeiten(vonUid, gesichert);

  pausiereBonQueue();
  pausiereUploadQueue();
  try {
    const ergebnis = await opts.anmelden();

    const neueUid = auth.currentUser?.uid ?? null;
    if (neueUid && neueUid !== vonUid) {
      mitnahmeBestaetigt = null;
      // Die Bon-Seite des Gastes gibt es unter der neuen uid nicht.
      await AuthRueckkehr.nachKontowechsel();
      if (gesichert) {
        try {
          await GastUebernahme.zielMerken(vonUid, neueUid);
        } catch (e) {
          // Die Anmeldung selbst hat geklappt — sie darf hieran nicht scheitern.
          console.warn('[kontoWechsel] Zielkonto konnte nicht gemerkt werden:', (e as Error)?.message);
        }
        void GastUebernahme.einloesenAlle();
      }
    }
    return ergebnis;
  } finally {
    setzeBonQueueFort();
    setzeUploadQueueFort();
  }
}

/**
 * Nach erfolgreichem Verknüpfen (Gast → Konto, uid bleibt): Aufträge, die nur
 * auf ein Konto gewartet haben, wieder freigeben. Wirft nie.
 */
export function nachVerknuepfung(): void {
  try {
    void Promise.resolve(gesperrteFreigeben(['konto_erforderlich'])).catch((e) =>
      console.warn('[kontoWechsel] Freigabe gesperrter Aufträge fehlgeschlagen:', e?.message),
    );
  } catch (e) {
    console.warn('[kontoWechsel] Freigabe gesperrter Aufträge fehlgeschlagen:', (e as Error)?.message);
  }
}
