/**
 * preferenceProfileService — Slice B (Client-EWMA Producer).
 *
 * Leitet aus einer abgeschlossenen Journey (Rohsignale) ein Präferenz-Profil
 * ab und blendet es per EWMA in users/{uid}/profile/preferences. Hybrid-
 * Ansatz (ClickUp 86ca1h3fk): Client aktualisiert sofort bei Session-Ende
 * (completeJourney), eine scheduled Cloud Function macht später Drift/Decay
 * + die kategorie-basierten facts (petOwner etc., aus purchases).
 *
 * Vollständig additiv + fire-and-forget: liest/schreibt NUR das separate
 * profile/preferences-Doc, fasst journeys/userProfile nicht an. Wirft nie in
 * den Aufrufer (completeJourney bleibt unbeeinflusst).
 *
 * Verdikt-Mapping + Punkte-Tabellen siehe Task-Doku. "Punkte" sind INTERNE
 * Profil-Gewichte (keine sichtbaren Detektiv-Punkte).
 */

import { db } from '@/lib/firebase';
import { doc, getDoc, setDoc, serverTimestamp } from '@react-native-firebase/firestore';

export const PROFILE_DIMENSIONS = [
  'price',
  'brandLoyalty',
  'marketLoyalty',
  'contentQuality',
  'health',
  'sustainability',
  'exploration',
  'noNameOpenness',
  'thoroughness',
] as const;
export type ProfileDimension = (typeof PROFILE_DIMENSIONS)[number];

export interface PreferenceProfile {
  updatedAt?: any;
  method: 'hybrid';
  windowStart?: number;
  sampleCount: number;
  halfLifeDays: number;
  dimensions: Record<ProfileDimension, number>; // 0..1 EWMA
  confidence: Record<ProfileDimension, number>; // 0..1 (per-dim, evidenz-basiert)
  evidence: Record<ProfileDimension, number>; // # Sessions mit Signal je Dim
  // #3: Entdeckungs-Stil — kumulative Journey-Zähler je Methode.
  discoveryStyle?: { browse: number; search: number; scan: number };
}

const EWMA_ALPHA = 0.3; // Gewicht der aktuellen Session
const HALF_LIFE_DAYS = 45;

function zeroDims(): Record<ProfileDimension, number> {
  return PROFILE_DIMENSIONS.reduce(
    (acc, d) => {
      acc[d] = 0;
      return acc;
    },
    {} as Record<ProfileDimension, number>,
  );
}

type Journey = any;

/** Strongest decision made on a viewed product, or null. */
function decisionOf(vp: any): 'purchased' | 'converted' | 'cart' | 'favorite' | null {
  const actions: any[] = Array.isArray(vp?.actions) ? vp.actions : [];
  const has = (t: string) => actions.some((a) => a?.type === t);
  if (has('purchased')) return 'purchased';
  if (has('converted') || has('converted_from')) return 'converted';
  if (has('addedToCart')) return 'cart';
  if (has('addedToFavorites')) return 'favorite';
  return null;
}

/**
 * Rohe Session-Punkte pro Dimension aus einer Journey. Higher = stärker.
 */
function sessionPoints(journey: Journey): Record<ProfileDimension, number> {
  const pts = zeroDims();
  const add = (d: ProfileDimension, n: number) => {
    pts[d] += n;
  };

  const viewed: any[] = Array.isArray(journey?.viewedProducts) ? journey.viewedProducts : [];
  let choseNoName = false;
  let brandIntent = false;

  // ── Entscheidungen × Verdikt × qualityEngaged ──────────────────────
  for (const vp of viewed) {
    const decision = decisionOf(vp);
    if (!decision) continue;
    const engaged = vp?.qualityEngagement?.engaged === true;
    const verdict: string | undefined = vp?.aiVerdict;
    const isNoName = vp?.productType === 'noname';

    if (engaged) add('thoroughness', 1);
    // #3: lange Betrachtungsdauer (viewDuration auf einer view-Action) =
    // Gründlichkeit, auch ohne explizites Aufklappen.
    const actions: any[] = Array.isArray(vp?.actions) ? vp.actions : [];
    if (actions.some((a) => a && typeof a.viewDuration === 'number' && a.viewDuration >= 8)) {
      add('thoroughness', 1);
    }

    if (decision === 'converted') {
      add('price', 2);
      add('noNameOpenness', 2);
      choseNoName = true;
      continue;
    }
    if (isNoName) {
      choseNoName = true;
      add('noNameOpenness', 1);
      if (engaged && verdict === 'besser') {
        add('contentQuality', 1);
        add('price', 1);
      } else if (engaged && verdict === 'gleichwertig') {
        add('price', 1);
      } else if (engaged && verdict === 'schlechter') {
        add('price', 2);
      } else {
        add('price', 1);
      }
    } else {
      // chose Marke
      if (verdict === 'besser') add('brandLoyalty', 2);
      else if (verdict === 'gleichwertig') add('brandLoyalty', 1);
      else if (verdict === 'schlechter' && engaged) add('contentQuality', 1);
      else add('brandLoyalty', 1);
    }
  }

  // ── Filter / Ansicht ───────────────────────────────────────────────
  const af = journey?.activeFilters ?? {};
  if (Array.isArray(af.markets) && af.markets.length > 0) add('marketLoyalty', 1);
  if (af.sortBy === 'price' || af.sortBy === 'savings') add('price', 1);
  if (Array.isArray(af.nutrition) && af.nutrition.length > 0) {
    add('health', Math.min(2, af.nutrition.length));
    add('contentQuality', 1);
  }
  if (Array.isArray(af.allergens) && af.allergens.length > 0) add('health', 1);
  // #3: Marken-Filter aktiv = Marken-Interesse; Suche = aktive Exploration.
  if (af.brandId) add('brandLoyalty', 1);
  if (af.searchQuery && String(af.searchQuery).trim()) add('exploration', 1);
  if (Array.isArray(af.stufe) && af.stufe.length > 0) add('exploration', 1);
  // Label-/Qualitäts-Filter (von Stöbern in activeFilters gespiegelt).
  if (af.labels?.bio) add('sustainability', 1);
  if (af.labels?.vegan || af.labels?.vegetarian) add('health', 1);
  if (af.kiQuality && af.kiQuality !== 'off') add('contentQuality', 1);

  // ENTKOPPELT von den Legacy-motivationSignals (User-Entscheidung): die
  // alten ms.{price,content,market}Signals würden DIESELBEN Filter doppelt
  // zählen, die wir oben schon präzise aus activeFilters ableiten. Wir lesen
  // sie daher NICHT mehr. brandIntent kommt aus den exakten Filtern.
  brandIntent = !!(af.brandId || (af.searchQuery && String(af.searchQuery).trim()));

  // ── Intent-Outcome-Divergenz: Marken-Intent → NoName gewählt ───────
  if (brandIntent && choseNoName) {
    add('noNameOpenness', 2);
  } else if (brandIntent && !choseNoName) {
    add('brandLoyalty', 1);
  }

  return pts;
}

/**
 * Aktualisiert das Profil aus einer abgeschlossenen Journey (fire-and-forget).
 */
export async function updateFromJourney(uid: string | null | undefined, journey: Journey): Promise<void> {
  try {
    if (!uid || !journey) return;
    const pts = sessionPoints(journey);
    const total = PROFILE_DIMENSIONS.reduce((s, d) => s + pts[d], 0);
    if (total <= 0) return; // keine verwertbaren Signale → kein Write

    // Session-Score je Dimension = relativer Anteil (0..1), summiert ~1.
    const sessionScore = zeroDims();
    for (const d of PROFILE_DIMENSIONS) sessionScore[d] = pts[d] / total;

    const ref = doc(db, 'users', uid, 'profile', 'preferences');
    const snap = await getDoc(ref);
    const prev = (snap.exists() ? (snap.data() as Partial<PreferenceProfile>) : null) ?? null;

    const prevDims = prev?.dimensions ?? null;
    const prevEvidence = prev?.evidence ?? null;
    const sampleCount = (prev?.sampleCount ?? 0) + 1;

    const dimensions = zeroDims();
    const confidence = zeroDims();
    const evidence = zeroDims();
    for (const d of PROFILE_DIMENSIONS) {
      const old = typeof prevDims?.[d] === 'number' ? prevDims![d] : null;
      dimensions[d] = old == null ? sessionScore[d] : old * (1 - EWMA_ALPHA) + sessionScore[d] * EWMA_ALPHA;
      // Logik-Fix #3: Confidence PRO DIMENSION aus der Evidenz — zählt nur
      // Sessions, in denen DIESE Dimension tatsächlich ein Signal bekam
      // (~8 Sessions mit Signal → ~1). Eine Achse ohne Signal bleibt unsicher.
      const ev = (typeof prevEvidence?.[d] === 'number' ? prevEvidence![d] : 0) + (pts[d] > 0 ? 1 : 0);
      evidence[d] = ev;
      confidence[d] = Math.min(1, ev / 8);
    }

    // #3: Entdeckungs-Stil fortschreiben.
    const prevStyle = (prev as any)?.discoveryStyle ?? { browse: 0, search: 0, scan: 0 };
    const dm = journey?.discoveryMethod;
    const styleKey = dm === 'search' ? 'search' : dm === 'scan' ? 'scan' : 'browse';
    const discoveryStyle = {
      browse: prevStyle.browse ?? 0,
      search: prevStyle.search ?? 0,
      scan: prevStyle.scan ?? 0,
    };
    discoveryStyle[styleKey] += 1;

    const out: PreferenceProfile = {
      method: 'hybrid',
      windowStart: prev?.windowStart ?? Date.now(),
      sampleCount,
      halfLifeDays: HALF_LIFE_DAYS,
      dimensions,
      confidence,
      evidence,
      discoveryStyle,
      updatedAt: serverTimestamp(),
    };
    await setDoc(ref, out, { merge: true });
  } catch (e) {
    // fire-and-forget: darf completeJourney nie beeinflussen
    console.warn('preferenceProfile updateFromJourney failed (ignored)', (e as any)?.message);
  }
}

/**
 * declared > inferred (ClickUp 86ca8fbpz): vom User explizit Angegebenes
 * (profile.declared, vom CF aus dem User-Doc gespiegelt) überschreibt die
 * abgeleiteten Dimensionen mit voller Confidence. Aus hooks/
 * usePreferenceProfile hierher gezogen, damit der non-React surveyService
 * (Eligibility-Filterung) dieselbe Logik nutzt — eine Quelle.
 */
export function mergeDeclaredProfile(p: any): PreferenceProfile {
  const d = p?.declared;
  if (!d) return p;
  const dims = { ...(p.dimensions || {}) };
  const conf = { ...(p.confidence || {}) };
  const boost = (dim: string) => {
    dims[dim] = Math.max(typeof dims[dim] === 'number' ? dims[dim] : 0, 0.6);
    conf[dim] = 1;
  };
  if (d.favoriteMarket) boost('marketLoyalty');
  if (Array.isArray(d.dietary) && d.dietary.length) boost('health');
  if (Array.isArray(d.caresAbout)) {
    if (d.caresAbout.some((x: string) => ['sustainability', 'bio', 'regional', 'eco'].includes(x)))
      boost('sustainability');
    if (d.caresAbout.includes('quality')) boost('contentQuality');
    if (d.caresAbout.includes('price')) boost('price');
  }
  return { ...p, dimensions: dims, confidence: conf };
}

/**
 * Liest users/{uid}/profile/preferences (declared-gemerged) — standalone,
 * für Services außerhalb von React (z.B. surveyTargeting). KEIN Modul-
 * Cache hier (der lebt im Hook); Aufrufer sollten selbst cachen.
 */
export async function getPreferenceProfile(
  uid: string | null | undefined,
): Promise<PreferenceProfile | null> {
  if (!uid) return null;
  try {
    const snap = await getDoc(doc(db, 'users', uid, 'profile', 'preferences'));
    return snap.exists() ? mergeDeclaredProfile(snap.data()) : null;
  } catch {
    return null;
  }
}

export const preferenceProfileService = { updateFromJourney, getPreferenceProfile };
