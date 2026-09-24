/**
 * Wann fragen wir nach Benachrichtigungen — und wann NICHT (09.09.2026).
 *
 * ═══ Der Befund, der das ausgelöst hat ═══
 *
 * Die App feuerte den System-Dialog, sobald eine Nutzerkennung existierte —
 * also beim allerersten Öffnen, anonym, bevor jemand irgendetwas gesehen
 * hatte. Gemessen am 09.09.2026 unter 33.841 iOS-Konten mit Statusfeld:
 *
 *     22.722  erlaubt
 *     10.665  ABGELEHNT          ← 31 %, dauerhaft
 *        454  nie beantwortet
 *
 * Auf iOS ist ein Nein endgültig: nur der Nutzer selbst kann es in den
 * Systemeinstellungen zurücknehmen, und das tut praktisch niemand. Der
 * Dialog ist keine Frage, sondern eine Ressource, die man einmal ausgibt.
 * Beim ersten Start ausgegeben heißt: zum schlechtesten denkbaren Kurs.
 *
 * ═══ Warum nicht „nach dem ersten Bon fragen" ═══
 *
 * Der naheliegende Vorschlag — die harte Frage an die erste Einreichung zu
 * hängen — ist an den eigenen Zahlen gescheitert. Von 283.965 Konten haben
 * **1.308 je irgendetwas eingereicht (0,46 %)**. Die Frage käme also bei
 * einem von 217 Nutzern an. Ausgerechnet die 99,5 %, die wir per Nachricht
 * zum ersten Bon bewegen wollen, hätten den lauten Kanal nie bekommen.
 *
 * Die Erlaubnis muss VOR dem Verhalten stehen, weil das Verhalten das ist,
 * was die Nachricht auslösen soll.
 *
 * ═══ Die Konstruktion ═══
 *
 *  1. Beim Start: PROVISORISCHE Erlaubnis (`fcmTokenService`, kein Dialog).
 *     Damit gibt es ab Minute eins einen Kanal zu ALLEN Nutzern. Die
 *     Nachrichten landen still in der Mitteilungszentrale und tragen unten
 *     „Behalten" / „Ausschalten" — wer „Behalten" tippt, hebt sich selbst
 *     auf die volle Erlaubnis. Die Nachricht ist ihr eigener Verkäufer.
 *  2. Die harte Frage kommt bei INTERESSE, nicht bei Einreichung: zweite
 *     Sitzung, oder die erste bedeutsame Handlung — was zuerst eintritt.
 *  3. Das eigene Sheet darf sich WIEDERHOLEN. Nur der System-Dialog ist
 *     einmalig; unser Sheet ist es nicht. Ein „Später" kostet nichts.
 *
 * Dieses Modul entscheidet ausschließlich Punkt 2 und 3. Es kennt weder
 * Firebase noch React — damit ist die Regel prüfbar, ohne eine App zu
 * starten.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

const SITZUNGEN = 'push_ask/v1/sitzungen';
const HANDLUNG = 'push_ask/v1/handlung';
const GEFRAGT_AM = 'push_ask/v1/zuletzt_gefragt';
const GEFRAGT_WIE_OFT = 'push_ask/v1/anzahl';

/** Ab der zweiten Sitzung: wer freiwillig zurückkommt, hat Interesse. */
export const SITZUNGEN_BIS_FRAGE = 2;
/**
 * Abstand zwischen zwei Anläufen. Sieben Tage sind lang genug, dass es
 * nicht drängelt, und kurz genug, dass die Gelegenheit nicht verfällt.
 */
export const TAGE_BIS_ERNEUT = 7;
/**
 * Nach drei „Später" ist die Antwort ein Nein, auch wenn sie nie
 * ausgesprochen wurde. Weiterfragen wäre Belästigung — und der Weg über
 * die Einstellungen bleibt jedem offen.
 */
export const MAX_ANLAEUFE = 3;

const TAG_MS = 24 * 60 * 60 * 1000;

/**
 * Handlungen, die Interesse belegen. BEWUSST breit: Stöbern, Vergleichen,
 * auf den Zettel legen zählt genauso wie Einreichen. Eine enge Definition
 * war der Fehler des ersten Entwurfs.
 */
export type Interessensignal =
  | 'produkt_angesehen'
  | 'vergleich_geoeffnet'
  | 'zettel_ergaenzt'
  | 'favorisiert'
  | 'bon_eingereicht'
  | 'foto_eingereicht';

const zahl = async (key: string): Promise<number> => {
  try {
    const v = await AsyncStorage.getItem(key);
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  } catch {
    return 0;
  }
};

/** Beim App-Start EINMAL aufrufen. Zählt die Sitzung. */
export async function sitzungBeginnt(): Promise<void> {
  try {
    await AsyncStorage.setItem(SITZUNGEN, String((await zahl(SITZUNGEN)) + 1));
  } catch {
    /* Zählen ist Beiwerk — ohne Zähler greift der Handlungs-Weg */
  }
}

/**
 * Eine bedeutsame Handlung melden. Idempotent: gespeichert wird nur, DASS
 * es eine gab, nicht wie viele — mehr braucht die Entscheidung nicht, und
 * so kostet jeder weitere Aufruf keinen Schreibvorgang.
 */
export async function interesseGezeigt(_signal: Interessensignal): Promise<void> {
  try {
    if ((await AsyncStorage.getItem(HANDLUNG)) === 'ja') return;
    await AsyncStorage.setItem(HANDLUNG, 'ja');
  } catch {
    /* dann entscheidet der Sitzungszähler */
  }
}

export interface FrageLage {
  /** Systemberechtigung: nur bei 'offen' ist der Dialog überhaupt noch zu haben. */
  berechtigung: 'offen' | 'erteilt' | 'abgelehnt';
  /** Ist gerade ein anderes Sheet oder eine Umfrage sichtbar? */
  etwasOffen: boolean;
  /**
   * Hat der Nutzer in der App ausdrücklich abbestellt? Dann wird nicht
   * nachgehakt (Projektregel: jede Verweigerung braucht einen Leser). Seit
   * 17.09.2026 wichtig, weil Android-13+-Nutzer ohne Systemerlaubnis jetzt als
   * „offen" gelten — vorher schloss der Status „denied" sie zufällig mit aus.
   * Optional, damit bestehende Aufrufer ohne Angabe wie bisher fragen.
   */
  abbestellt?: boolean;
  jetzt: number;
}

export type FrageUrteil =
  | { fragen: true }
  | {
      fragen: false;
      grund:
        | 'berechtigung_erteilt'
        | 'berechtigung_abgelehnt'
        | 'nutzer_hat_abbestellt'
        | 'anderes_sheet_offen'
        | 'kein_interesse'
        | 'zu_frueh_nach_letzter_frage'
        | 'genug_gefragt';
    };

/**
 * Soll das erklärende Sheet jetzt gezeigt werden?
 *
 * Alle Zustände kommen als Parameter herein, damit die Regel ohne
 * Speicher, ohne Uhr und ohne App prüfbar ist.
 */
export function darfFragen(
  lage: FrageLage,
  stand: { sitzungen: number; handlung: boolean; zuletztGefragt: number; anlaeufe: number },
): FrageUrteil {
  // Erteilt ist erteilt — und ein abgelehnter Dialog lässt sich auf iOS
  // ohnehin nicht erneut öffnen. In beiden Fällen wäre das Sheet eine
  // Frage ohne Wirkung.
  if (lage.berechtigung === 'erteilt') return { fragen: false, grund: 'berechtigung_erteilt' };
  if (lage.berechtigung === 'abgelehnt') return { fragen: false, grund: 'berechtigung_abgelehnt' };
  if (lage.abbestellt) return { fragen: false, grund: 'nutzer_hat_abbestellt' };

  // Zwei Sheets gleichzeitig lassen iOS hart einfrieren (CLAUDE.md,
  // 86ca8g2p9). Die Frage kann warten, ein eingefrorenes Gerät nicht.
  if (lage.etwasOffen) return { fragen: false, grund: 'anderes_sheet_offen' };

  if (stand.anlaeufe >= MAX_ANLAEUFE) return { fragen: false, grund: 'genug_gefragt' };

  if (stand.zuletztGefragt > 0 && lage.jetzt - stand.zuletztGefragt < TAGE_BIS_ERNEUT * TAG_MS) {
    return { fragen: false, grund: 'zu_frueh_nach_letzter_frage' };
  }

  // Der Kern: zweite Sitzung ODER eine bedeutsame Handlung. Das „oder" ist
  // die ganze Pointe — wer nur stöbert, wird trotzdem gefragt.
  const interesse = stand.sitzungen >= SITZUNGEN_BIS_FRAGE || stand.handlung;
  if (!interesse) return { fragen: false, grund: 'kein_interesse' };

  return { fragen: true };
}

/** Den gespeicherten Stand einsammeln. */
export async function ladeStand(): Promise<{
  sitzungen: number;
  handlung: boolean;
  zuletztGefragt: number;
  anlaeufe: number;
}> {
  let handlung = false;
  try {
    handlung = (await AsyncStorage.getItem(HANDLUNG)) === 'ja';
  } catch {
    /* Standard: keine Handlung bekannt */
  }
  return {
    sitzungen: await zahl(SITZUNGEN),
    handlung,
    zuletztGefragt: await zahl(GEFRAGT_AM),
    anlaeufe: await zahl(GEFRAGT_WIE_OFT),
  };
}

/**
 * Festhalten, dass gefragt wurde — VOR dem Anzeigen aufrufen, nicht danach.
 *
 * Sonst fragt ein Absturz oder ein Wegwischen zwischen Anzeige und Notiz
 * beim nächsten Start sofort erneut. Dieselbe Reihenfolge wie beim
 * Bewertungs-Dialog: erst verbuchen, dann zeigen.
 */
export async function frageVermerkt(jetzt: number): Promise<void> {
  try {
    await AsyncStorage.setItem(GEFRAGT_AM, String(jetzt));
    await AsyncStorage.setItem(GEFRAGT_WIE_OFT, String((await zahl(GEFRAGT_WIE_OFT)) + 1));
  } catch {
    /* im schlimmsten Fall fragen wir einmal zu oft */
  }
}

/** Nur für Tests. */
export async function _resetPushAskForTests(): Promise<void> {
  for (const k of [SITZUNGEN, HANDLUNG, GEFRAGT_AM, GEFRAGT_WIE_OFT]) {
    await AsyncStorage.removeItem(k).catch(() => {});
  }
}
