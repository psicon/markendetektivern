/**
 * Survey-/Umfrage-Schema (ClickUp 86ca8fbpz).
 *
 * Kanonische Quelle ist RevealyIQs `polls`-Collection in
 * `markendetektive-895f7` (dort werden Umfragen angelegt). Die App
 * LIEST `polls` direkt und SCHREIBT Antworten nach `poll_responses`
 * (genau dort wertet RevealyIQs Dashboard aus). Dieses File spiegelt
 * RevealyIQs Poll-Schema 1:1 und erweitert es um die drei Felder, die
 * RevealyIQ für die App-Integration zusätzlich trägt:
 *   • profileTargeting — Eingrenzung übers Präferenz-Profil
 *   • trigger          — allgemein vs. an eine App-Action gebunden
 *   • rewardCents      — Cashback-Taler-Belohnung pro Abschluss
 *
 * gender / regions / favoriteMarkets sind in RevealyIQs Enums kodiert;
 * das Mapping auf die App-Felder (users/{uid}) macht lib/services/
 * surveyTargeting.ts. Nicht hier "eindeutschen" — sonst driftet das
 * Schema von der Anlage-Seite weg.
 */

import type { ProfileDimension } from '@/lib/services/preferenceProfileService';
import type { ActionType } from '@/lib/types/achievements';

export type PollQuestionType = 'single_choice' | 'multiple_choice' | 'text';

export interface PollQuestion {
  id: string;
  questionText: string;
  questionType: PollQuestionType;
  order: number;
  /** Firebase-Storage-URL (optional, RevealyIQ erlaubt Bild pro Frage). */
  imageUrl?: string;
  required: boolean;
  /** Für single_choice / multiple_choice. */
  options?: string[];
}

/** RevealyIQ-Gender-Enum (NICHT die App-Strings 'Männlich' etc.). */
export type PollGender = 'male' | 'female' | 'diverse' | 'prefer_not_to_say';

export interface PollTargeting {
  /** RevealyIQ-Market-IDs/-Slugs — gemappt auf users.favoriteMarket. */
  favoriteMarkets?: string[];
  gender?: PollGender[];
  minAge?: number;
  maxAge?: number;
  /** RevealyIQ-Region-Enum (Bundesländer) — gemappt auf users.bundesland. */
  regions?: string[];
  isPremium?: boolean;
}

/**
 * Profil-Targeting (App-Erweiterung): die Umfrage erscheint nur, wenn
 * der User in JEDER gelisteten Dimension den Schwellwert erreicht. Das
 * Profil hat ~100 % Coverage (aus Journey-Tracking abgeleitet), daher
 * das mächtigste Targeting — RevealyIQs Basis-Targeting kann es nicht.
 */
export interface PollProfileTarget {
  dimension: ProfileDimension;
  /** EWMA-Wert-Schwelle 0..1 (>=). */
  min: number;
  /** Optionale Mindest-Confidence 0..1 (>=), sonst 0. */
  minConfidence?: number;
}

/**
 * Trigger: 'general' (erscheint in der Umfragen-Liste im Rewards-Tab)
 * oder 'action' (wird nach einer App-Action als Sheet eingeblendet).
 * Fehlt das Feld → wie 'general' behandelt (RevealyIQ-Altbestand).
 */
export type PollTrigger =
  | { type: 'general' }
  | {
      type: 'action';
      /** App-Action, nach der die Umfrage erscheint (z.B. complete_shopping). */
      action: ActionType;
      /** Frühestens wieder nach N Stunden anbieten (Default surveyConfig). */
      cooldownHours?: number;
    };

export type PollStatus =
  | 'draft'
  | 'active'
  | 'paused'
  | 'completed'
  | 'archived';

export interface Poll {
  id: string;
  title: string;
  description?: string;
  status: PollStatus;
  questions: PollQuestion[];
  targeting: PollTargeting;
  // ── App-Erweiterungen (86ca8fbpz) ──
  profileTargeting?: PollProfileTarget[];
  trigger?: PollTrigger;
  /** Cashback-Taler in Cent pro Vergütung (0/fehlt = keine). */
  rewardCents?: number;
  /**
   * WANN vergütet wird:
   *   • 'completion' (Default) — EINMALIGE Pauschale bei Abschluss der
   *     Umfrage. Umfrage danach nicht mehr ausgespielt. Sinnvoll für
   *     allgemeine Umfragen.
   *   • 'per_answer' — bei JEDER Beantwortung. Die (action-getriggerte)
   *     Umfrage wird wiederholt ausgespielt; jede Antwort zahlt.
   *   • 'none' — keine Vergütung (reine Datensammlung). Action-Umfragen
   *     bleiben wiederholbar, allgemeine bleiben einmalig.
   */
  rewardTrigger?: 'completion' | 'per_answer' | 'none';
  /**
   * Eigenes Gesamt-Budget der Umfrage in Cent (optional). Wenn gesetzt,
   * wird es pro Vergütung dekrementiert; bei 0 wird die Umfrage nicht mehr
   * ausgespielt. Fehlt das Feld → kein Budget-Limit. (Ersetzt die frühere
   * Campaign-Verknüpfung — Umfragen sind jetzt eigenständig.)
   */
  budgetCents?: number;
  budgetRemainingCents?: number;
  /**
   * Max. Anzahl VERGÜTETER Antworten PRO USER (optional). Schützt bei
   * per_answer davor, dass ein User dieselbe Umfrage beliebig oft für
   * Cashback ausfüllt. Fehlt das Feld → kein Per-User-Limit. (completion
   * ist ohnehin einmalig.)
   */
  maxPerUser?: number;
  /** Wie eine action-getriggerte Umfrage erscheint: 'immediate' = Sheet
   *  sofort nach der Aktion; 'hint' = dezenter, antippbarer Hinweis mit
   *  Verdienst-Möglichkeit. Default 'immediate'. (general-Polls ignorieren
   *  das — sie leben in der Umfragen-Liste.) */
  actionDisplay?: 'immediate' | 'hint';
  /** Produkt-Targeting (action-Trigger): Umfrage nur ausspielen, wenn die
   *  Aktion eines dieser Produkte betrifft (produkte/markenProdukte-Doc-ID).
   *  Leer/fehlt = alle Produkte. */
  targetProductIds?: string[];
  /** Marken-/Hersteller-Targeting (action-Trigger): Umfrage nur, wenn das
   *  betroffene Produkt zu einer dieser Marken/Hersteller gehört
   *  (hersteller/hersteller_new-Doc-ID). Leer/fehlt = alle Marken. */
  targetBrandIds?: string[];
  // ── Zeitsteuerung (ISO-Strings, RevealyIQ-Konvention) ──
  startDate?: string;
  endDate?: string;
  createdBy?: string;
  createdAt?: string;
  updatedAt?: string;
  totalViews?: number;
  totalResponses?: number;
  responseRate?: number;
}

export interface PollAnswer {
  questionId: string;
  questionType: PollQuestionType;
  /** String bei text/single_choice, String[] bei multiple_choice. */
  answer: string | string[];
}

export interface PollResponse {
  id?: string;
  pollId: string;
  userId: string;
  answers: PollAnswer[];
  /** ISO-Strings (RevealyIQ-Konvention). */
  completedAt: string;
  startedAt: string;
  timeSpentSeconds: number;
  /** Snapshot des Users zum Antwortzeitpunkt (für die B2B-Auswertung). */
  userContext: {
    favoriteMarket?: string;
    gender?: string;
    age?: number;
    region?: string;
    isPremium?: boolean;
  };
}

/** Normalisiert den Trigger eines (ggf. alten) Poll-Docs. */
export function pollTriggerOf(poll: Pick<Poll, 'trigger'>): PollTrigger {
  return poll.trigger?.type === 'action' ? poll.trigger : { type: 'general' };
}

/**
 * Darf diese Umfrage MEHRFACH beantwortet werden (vs. einmalig)?
 *   • per_answer            → ja (jede Antwort zählt/zahlt)
 *   • none + action-Trigger → ja (wiederholte Datensammlung, gratis)
 *   • sonst (completion / none+general) → nein (einmalig)
 */
export function isPollRepeatable(poll: Pick<Poll, 'trigger' | 'rewardTrigger'>): boolean {
  const rt = poll.rewardTrigger ?? 'completion';
  if (rt === 'per_answer') return true;
  if (rt === 'none' && pollTriggerOf(poll).type === 'action') return true;
  return false;
}
