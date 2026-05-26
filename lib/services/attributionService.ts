/**
 * AttributionService — Channel-Attribution ohne User-Frage.
 *
 * User-Decision 2026-05-22: die "Wie hast du uns gefunden?"-Frage
 * wandert aus dem Onboarding-Funnel raus (T2). Stattdessen tracken
 * wir die Installation-Source automatisch über native Plattform-
 * APIs. Coverage-Ziel: ~80-90% der Channels ohne User-Friction.
 *
 * Implementation-Status (siehe ClickUp 86c9zbxy7):
 * - Skeleton + Persistenz fertig.
 * - **Native Modules sind NOCH NICHT installiert** (`expo prebuild`
 *   + EAS-Build erforderlich). Bis dahin: graceful degradation auf
 *   Firebase Analytics + Locale-Inference.
 *
 * Zu aktivieren (separater EAS-Build):
 *   yarn add react-native-apple-ads-attribution
 *   yarn add react-native-play-install-referrer
 *   yarn add expo-tracking-transparency
 *   expo prebuild --clean
 *   eas build --platform ios --profile production
 *   eas build --platform android --profile production
 *
 * Native APIs:
 * - **iOS**: AdServices Framework (built-in iOS 14.3+).
 *   Liefert Token → Apple-Server-Call → Campaign-ID + Source.
 *   Erkennt: Apple Search Ads, App Store organic.
 * - **Android**: Google Play Install Referrer API.
 *   Liefert UTM-Parameter + Click-ID aus Play-Store-Install-URL.
 *   Erkennt: Google Ads, AdMob, UTM-getaggte Web→App-Links,
 *   Play Store organic.
 *
 * NICHT abgedeckt (auch nicht nach Aktivierung):
 * - Meta-Ads, TikTok-Ads, Snapchat-Ads ohne UTM → braucht MMP
 *   (Branch.io/AppsFlyer/Adjust, $30+/Monat).
 * - Mund-zu-Mund-Empfehlungen (prinzipiell unmöglich).
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

// Storage-Keys
const KEY_ATTRIBUTION_CAPTURED = 'attribution_v1_captured';
const KEY_ATTRIBUTION_DATA = 'attribution_v1_data';

export interface AttributionData {
  source: string; // z.B. 'apple_search_ads', 'google_ads', 'organic', 'utm:instagram'
  channel?: string;
  campaign?: string;
  adGroup?: string;
  keyword?: string;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  utmContent?: string;
  rawPayload?: any;
  platform: 'ios' | 'android' | 'web';
  capturedAt: number; // unix ms
}

export class AttributionService {
  /**
   * Einmaliger Capture beim ersten App-Start. Idempotent — wenn
   * AsyncStorage-Flag bereits gesetzt, kein Re-Capture (Apple +
   * Google liefern den Token nur EINMAL nach Install).
   *
   * Aufrufer: app/_layout.tsx nach AuthProvider-Mount + auth-ready.
   * Result wird per Side-Effect an users/{uid}.attribution geschrieben
   * sobald uid verfügbar ist.
   */
  static async initialize(uid: string | null | undefined): Promise<AttributionData | null> {
    try {
      // Wenn schon capturet: aus Storage lesen und ggf. ans User-Doc
      // mirroren falls noch nicht (z.B. User war beim ersten Boot
      // noch nicht eingeloggt).
      const captured = await AsyncStorage.getItem(KEY_ATTRIBUTION_CAPTURED);
      if (captured === '1') {
        const raw = await AsyncStorage.getItem(KEY_ATTRIBUTION_DATA);
        const cached: AttributionData | null = raw ? JSON.parse(raw) : null;
        if (cached && uid) {
          await this.mirrorToUserDoc(uid, cached);
        }
        return cached;
      }

      // Fresh capture
      let data: AttributionData | null = null;
      if (Platform.OS === 'ios') {
        data = await this.captureIos();
      } else if (Platform.OS === 'android') {
        data = await this.captureAndroid();
      }

      if (!data) {
        // Module nicht installiert ODER User hat ATT abgelehnt ODER
        // keine Daten verfügbar → markiere als 'unknown' damit wir
        // nicht jeden App-Start neu versuchen.
        data = {
          source: 'unknown',
          platform: Platform.OS as 'ios' | 'android',
          capturedAt: Date.now(),
        };
      }

      await AsyncStorage.multiSet([
        [KEY_ATTRIBUTION_CAPTURED, '1'],
        [KEY_ATTRIBUTION_DATA, JSON.stringify(data)],
      ]);

      if (uid) {
        await this.mirrorToUserDoc(uid, data);
      }
      return data;
    } catch (err) {
      console.warn('[AttributionService] initialize failed:', err);
      return null;
    }
  }

  /**
   * iOS-Implementation. Erfordert `react-native-apple-ads-attribution`
   * (NICHT installiert — Module fehlen-Branch returnt null).
   *
   * Apple's AdServices Framework liefert nach Install einen
   * `attributionToken`, den wir gegen Apple's Server-API tauschen
   * (https://api-adservices.apple.com/api/v1/) — Apple returnt
   * Campaign-ID + Source.
   */
  private static async captureIos(): Promise<AttributionData | null> {
    try {
      // Conditional require — wenn Lib nicht installiert: gracefully null.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const mod = require('react-native-apple-ads-attribution');
      const attr = mod?.AppleAdsAttribution ?? mod?.default ?? mod;
      if (!attr?.getAppleAttributionData) return null;

      const payload = await attr.getAppleAttributionData();
      if (!payload) return null;

      // Apple-Payload-Shape (vereinfacht):
      // { attribution: boolean, orgId, campaignId, conversionType,
      //   adGroupId, countryOrRegion, keywordId, adId }
      return {
        source: payload.attribution ? 'apple_search_ads' : 'app_store_organic',
        campaign: payload.campaignId ? String(payload.campaignId) : undefined,
        adGroup: payload.adGroupId ? String(payload.adGroupId) : undefined,
        keyword: payload.keywordId ? String(payload.keywordId) : undefined,
        rawPayload: payload,
        platform: 'ios',
        capturedAt: Date.now(),
      };
    } catch (err) {
      // Lib nicht installiert ODER User hat ATT-Prompt abgelehnt
      // ODER Apple-Server liefert leeren Response — alles non-fatal.
      if (__DEV__) console.log('[AttributionService] iOS capture skipped:', (err as any)?.message);
      return null;
    }
  }

  /**
   * Android-Implementation. Erfordert `react-native-play-install-referrer`
   * (NICHT installiert — Module fehlen-Branch returnt null).
   *
   * Google Play Install Referrer API liefert die Referrer-URL die
   * den App-Install ausgelöst hat (z.B. Google-Ads-Click,
   * UTM-getaggter Web-Link).
   */
  private static async captureAndroid(): Promise<AttributionData | null> {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const mod = require('react-native-play-install-referrer');
      const ref = mod?.PlayInstallReferrer ?? mod?.default ?? mod;
      if (!ref?.getInstallReferrerInfo) return null;

      const payload: { installReferrer?: string } = await new Promise((resolve, reject) => {
        ref.getInstallReferrerInfo((info: any, error: any) => {
          if (error) reject(error);
          else resolve(info);
        });
      });

      if (!payload?.installReferrer) return null;

      // Referrer-String ist URL-encoded utm_*-Parameter:
      // "utm_source=google-play&utm_medium=organic" o.ä.
      const utm = parseUtmString(payload.installReferrer);
      return {
        source: utm.utm_source ?? 'google_play_organic',
        utmSource: utm.utm_source,
        utmMedium: utm.utm_medium,
        utmCampaign: utm.utm_campaign,
        utmContent: utm.utm_content,
        campaign: utm.utm_campaign,
        rawPayload: payload,
        platform: 'android',
        capturedAt: Date.now(),
      };
    } catch (err) {
      if (__DEV__) console.log('[AttributionService] Android capture skipped:', (err as any)?.message);
      return null;
    }
  }

  /** Schreibt Attribution-Daten ans users/{uid}-Doc. Merge, damit
   *  andere Felder am User-Doc unangetastet bleiben. Idempotent. */
  private static async mirrorToUserDoc(uid: string, data: AttributionData): Promise<void> {
    try {
      const { setDoc, doc, serverTimestamp } = await import('@react-native-firebase/firestore');
      const { db } = await import('@/lib/firebase');
      await setDoc(
        doc(db, 'users', uid),
        {
          attribution: {
            ...data,
            mirroredAt: serverTimestamp(),
          },
        },
        { merge: true },
      );
    } catch (err) {
      console.warn('[AttributionService] mirror to user-doc failed:', err);
    }
  }

  /** Read-only: gibt zuletzt erfasste Attribution-Daten zurück.
   *  Hilfreich für Debug-/Analytics-Screens. */
  static async getCached(): Promise<AttributionData | null> {
    try {
      const raw = await AsyncStorage.getItem(KEY_ATTRIBUTION_DATA);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  /** Für Debug-Reset. */
  static async reset(): Promise<void> {
    await AsyncStorage.multiRemove([KEY_ATTRIBUTION_CAPTURED, KEY_ATTRIBUTION_DATA]);
  }
}

/** Parsed eine URL-encoded UTM-String wie "utm_source=foo&utm_medium=bar"
 *  zu einem Key-Value-Object. Robust gegen leere/malformed Strings. */
function parseUtmString(s: string): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  try {
    // Manche Android-Referrer-Strings sind doppelt URL-encoded —
    // wir versuchen einen Decode-Pass. Wenn das nichts an dem
    // String ändert, sind wir schon im klartext.
    let decoded = s;
    try {
      const d = decodeURIComponent(s);
      if (d !== s) decoded = d;
    } catch {}
    decoded.split('&').forEach((pair) => {
      const [k, v] = pair.split('=');
      if (k && v) out[k.trim()] = v.trim();
    });
  } catch {}
  return out;
}
