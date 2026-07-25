import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { isExpoGo } from '../utils/platform';
import { adMobService } from './adMobService';

// Counter Keys — nur SCAN ist verdrahtet (barcode-scanner). Die früheren
// PRODUCT_VIEW/SEARCH-Zähler waren nie an einer Callsite und wurden entfernt,
// um keine zusätzliche Ad-Friktion einzuführen (Stufe 1: bessere Reviews).
const COUNTER_KEYS = {
  SCAN: '@interstitial_scan_count',
  LAST_SHOWN: '@interstitial_last_shown',
  LIFETIME_ACTIONS: '@interstitial_lifetime_actions', // monotone Lebensdauer-Aktionen
  DAY_COUNT: '@interstitial_day_count', // "YYYY-MM-DD:n" — Tages-Deckel
};

// Thresholds
const THRESHOLDS = {
  SCAN: 5, // Nach jedem 5. Scan
};

// Tages-Deckel. Zusammen mit MIN_TIME_BETWEEN_ADS begrenzt das einen
// Einkauf mit 20 Scans auf 1-2 Vollbild-Ads statt bisher 4-6.
// Anlass: 16 negative Reviews (Schnitt 1,56) mit Zitaten wie "Nach
// jedem 2. Scan WERBUNG" und "Einfach zu viel Werbung!" — SCAN:3 und
// die 1-Minute waren seit Oktober 2025 unverändert, für WIEDERKEHRENDE
// User (Grace-Period einmal durch = für immer durch) war die Kadenz
// also identisch zu der beklagten Version.
const MAX_ADS_PER_DAY = 3;
// Pro App-Session (In-Memory, kein Storage) — verhindert, dass eine
// einzige lange Einkaufs-Session mehrfach unterbrochen wird.
const MAX_ADS_PER_SESSION = 2;

// Grace-Period für NEUE User (App-Store-Reviews: "Werbung schon nach paar
// Produkten" zerstört den ersten Eindruck). Die ersten N qualifizierenden
// Aktionen (Produktaufrufe + Scans + Suchen, über die gesamte App-Lebens-
// dauer gezählt) bleiben KOMPLETT werbefrei — Full-Page-Ads kommen erst
// danach, mit der normalen Frequenz. ~12 ≈ eine entspannte erste Session.
const GRACE_PERIOD_ACTIONS = 12;

// Minimum time between ads (in milliseconds)
const MIN_TIME_BETWEEN_ADS = 240000; // 4 Minuten

// Maximale Lade-Versuche nach einem ERROR. Vorher lief hier eine
// UNBEGRENZTE 5-s-Retry-Schleife — die feuerte für ALLE User weiter,
// auch für Premium (der Ad-Load ist nicht premium-gegated, nur das
// Anzeigen).
const MAX_LOAD_ATTEMPTS = 3;

class InterstitialAdService {
  private interstitialAd: any = null;
  private isLoaded = false;
  private isShowing = false;
  /** Ads in DIESER App-Session (In-Memory, absichtlich nicht persistiert). */
  private shownThisSession = 0;
  /** Lade-Versuche nach ERROR — deckelt die frühere Endlos-Schleife. */
  private loadAttempts = 0;

  async initialize() {
    if (isExpoGo()) {
      console.log('📱 InterstitialAdService: Skipping in Expo Go');
      return;
    }

    try {
      // Android: Consent prüfen
      if (Platform.OS === 'android') {
        const { consentService } = require('./consentService');
        
        // Initialisiere Consent falls noch nicht geschehen
        const consentStatus = consentService.getConsentStatus();
        if (consentStatus === 'UNKNOWN') {
          console.log('🔄 InterstitialAd: Initializing consent service...');
          await consentService.initialize();
        }
        
        // Prüfe ob Ads gezeigt werden können
        const canShowAds = consentService.canShowAds();
        if (!canShowAds) {
          console.log('⏭️ InterstitialAd: Skipping (consent required, not obtained)');
          return;
        }
      }
      // iOS: Direkt fortfahren (wie in 5.0.1)
      
      const { InterstitialAd, TestIds, AdEventType } = require('react-native-google-mobile-ads');
      
      // Get ad unit ID (test in dev, real in production)
      const adUnitId = __DEV__ 
        ? TestIds.INTERSTITIAL 
        : adMobService.getAdUnitId('interstitial');

      // Create interstitial instance mit Consent-basierten Options
      // iOS: NON-Personalized Ads (kein UMP implementiert = kein Consent = non-personalized required)
      // Android: Dynamisch basierend auf Consent Status
      let adRequestOptions = { requestNonPersonalizedAdsOnly: true }; // iOS Default - MUSS true sein!
      if (Platform.OS === 'android') {
        const { consentService } = require('./consentService');
        adRequestOptions = consentService.getAdRequestOptions();
      }
      
      console.log('📊 Interstitial Ad Request Options:', {
        ...adRequestOptions,
        platform: Platform.OS
      });
      
      this.interstitialAd = InterstitialAd.createForAdRequest(adUnitId, adRequestOptions);

      // Set up event listeners
      this.interstitialAd.addAdEventListener(AdEventType.LOADED, () => {
        console.log('✅ Interstitial loaded');
        this.isLoaded = true;
        this.loadAttempts = 0;
      });

      this.interstitialAd.addAdEventListener(AdEventType.ERROR, (error: any) => {
        console.log('❌ Interstitial failed to load:', error);
        this.isLoaded = false;
        // Gedeckelter Retry (vorher: unbegrenzte 5-s-Schleife, die auch
        // für Premium-User endlos weiterlief).
        this.loadAttempts += 1;
        if (this.loadAttempts >= MAX_LOAD_ATTEMPTS) {
          console.log(`⛔ Interstitial: ${MAX_LOAD_ATTEMPTS} Lade-Versuche erschöpft — kein weiterer Retry`);
          return;
        }
        setTimeout(() => {
          console.log(`🔄 Retrying interstitial load (${this.loadAttempts}/${MAX_LOAD_ATTEMPTS})...`);
          this.loadAd();
        }, 5000);
      });

      this.interstitialAd.addAdEventListener(AdEventType.CLOSED, () => {
        console.log('🔄 Interstitial closed, loading next one');
        this.isShowing = false;
        this.isLoaded = false;
        // Load next ad immediately
        this.loadAd();
      });

      // Load first ad
      this.loadAd();
      
      // Preload backup ad after a delay
      setTimeout(() => {
        if (!this.isLoaded && !this.isShowing) {
          console.log('⏰ Preloading backup interstitial...');
          this.loadAd();
        }
      }, 3000);
    } catch (error) {
      console.error('❌ InterstitialAdService init error:', error);
    }
  }

  private loadAd() {
    if (this.interstitialAd && !this.isLoaded) {
      console.log('📥 Loading interstitial ad...');
      this.interstitialAd.load();
    } else {
      console.log('⚠️ Cannot load ad:', { hasAd: !!this.interstitialAd, isLoaded: this.isLoaded });
    }
  }

  private async canShowAd(): Promise<boolean> {
    // Grace-Period für neue User: erst NACH GRACE_PERIOD_ACTIONS qualifizierenden
    // Aktionen überhaupt Full-Page-Ads zeigen (sauberer erster Eindruck).
    try {
      const lifetimeStr = await AsyncStorage.getItem(COUNTER_KEYS.LIFETIME_ACTIONS);
      const lifetime = lifetimeStr ? parseInt(lifetimeStr, 10) || 0 : 0;
      if (lifetime < GRACE_PERIOD_ACTIONS) {
        console.log(`🆕 Ad-Grace-Period aktiv (${lifetime}/${GRACE_PERIOD_ACTIONS}) — noch keine Interstitials`);
        return false;
      }
    } catch {
      /* im Zweifel weiter (Counter nicht lesbar) */
    }

    // Session-Deckel (In-Memory) — eine lange Einkaufs-Session wird
    // nicht mehrfach unterbrochen.
    if (this.shownThisSession >= MAX_ADS_PER_SESSION) {
      console.log(`🛑 Session-Deckel erreicht (${this.shownThisSession}/${MAX_ADS_PER_SESSION})`);
      return false;
    }

    // Tages-Deckel (persistiert). Fehler beim Lesen => im Zweifel
    // WEITER, aber lieber konservativ: ein nicht lesbarer Zähler darf
    // keine Ad-Flut erzeugen, also gilt dann nur der Session-Deckel.
    if ((await this.getTodayCount()) >= MAX_ADS_PER_DAY) {
      console.log(`🛑 Tages-Deckel erreicht (${MAX_ADS_PER_DAY})`);
      return false;
    }

    // Check last shown time
    const lastShownStr = await AsyncStorage.getItem(COUNTER_KEYS.LAST_SHOWN);
    if (lastShownStr) {
      const lastShown = parseInt(lastShownStr);
      const timeSinceLastAd = Date.now() - lastShown;
      if (timeSinceLastAd < MIN_TIME_BETWEEN_ADS) {
        console.log(`⏱️ Too soon since last ad (${Math.round(timeSinceLastAd / 1000)}s ago)`);
        return false;
      }
    }
    return true;
  }

  /** Lokaler Tages-Schlüssel (Gerätezeit — bewusst, kein Server-Roundtrip). */
  private todayKey(): string {
    const d = new Date();
    const p = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }

  private async getTodayCount(): Promise<number> {
    try {
      const raw = await AsyncStorage.getItem(COUNTER_KEYS.DAY_COUNT);
      if (!raw) return 0;
      const [day, n] = raw.split(':');
      if (day !== this.todayKey()) return 0; // anderer Tag => Zähler ist stale
      const parsed = parseInt(n ?? '', 10);
      return Number.isFinite(parsed) ? parsed : 0;
    } catch {
      return 0;
    }
  }

  private async bumpTodayCount(): Promise<void> {
    try {
      const cur = await this.getTodayCount();
      await AsyncStorage.setItem(COUNTER_KEYS.DAY_COUNT, `${this.todayKey()}:${cur + 1}`);
    } catch {
      /* nicht fatal */
    }
  }

  private async updateLastShownTime() {
    await AsyncStorage.setItem(COUNTER_KEYS.LAST_SHOWN, Date.now().toString());
  }

  // Monotone Lebensdauer-Zählung qualifizierender Aktionen (für die Grace-
  // Period). Wird einmal pro track*-Call erhöht; nie zurückgesetzt (außer
  // resetCounters/Dev). Deckelt bei GRACE_PERIOD_ACTIONS, damit der Wert
  // nicht unbegrenzt wächst.
  private async bumpLifetimeActions() {
    try {
      const str = await AsyncStorage.getItem(COUNTER_KEYS.LIFETIME_ACTIONS);
      const cur = str ? parseInt(str, 10) || 0 : 0;
      if (cur < GRACE_PERIOD_ACTIONS) {
        await AsyncStorage.setItem(COUNTER_KEYS.LIFETIME_ACTIONS, String(cur + 1));
      }
    } catch {
      /* nicht fatal */
    }
  }

  async showIfReady(isPremium: boolean) {
    console.log('🎯 showIfReady called:', {
      isPremium,
      isLoaded: this.isLoaded,
      isShowing: this.isShowing,
      shownThisSession: this.shownThisSession,
    });
    
    // Skip if premium
    if (isPremium) {
      console.log('👑 Skipping interstitial - user has premium');
      return;
    }

    // Skip in Expo Go
    if (isExpoGo()) {
      console.log('📱 Would show interstitial (Expo Go)');
      return;
    }

    // iOS: Consent nicht prüfen (nicht kritisch)
    if (Platform.OS === 'android') {
      // Android: Prüfe Consent Status
      try {
        const { consentService } = require('./consentService');
        const canShowAds = consentService.canShowAds();
        if (!canShowAds) {
          console.log('⏭️ Interstitial: Skipping (no consent)');
          return;
        }
      } catch (err) {
        console.warn('⚠️ Interstitial: Could not check consent, allowing anyway');
      }
    }

    // Check if enough time has passed
    if (!(await this.canShowAd())) {
      return;
    }

    // Show ad if loaded
    if (this.interstitialAd && this.isLoaded && !this.isShowing) {
      try {
        this.isShowing = true;
        console.log('🚀 Showing interstitial ad now!');
        await this.interstitialAd.show();
        await this.updateLastShownTime();
        this.shownThisSession += 1;
        await this.bumpTodayCount();
        this.isLoaded = false; // Mark as not loaded after showing
      } catch (error) {
        console.error('❌ Error showing interstitial:', error);
        this.isShowing = false;
      }
    } else {
      console.log('⏳ Interstitial not ready:', { 
        hasAd: !!this.interstitialAd, 
        isLoaded: this.isLoaded, 
        isShowing: this.isShowing 
      });
      
      // Nur vorladen — NICHT verzögert nachfeuern.
      //
      // Vorher lief hier ein 3x-2-s-Retry: das Ad konnte bis ~6 s NACH
      // dem Scan über die inzwischen geöffnete Produktseite fallen
      // ("Video stört beim Einkaufen", "obwohl man sich brav den
      // Werbespot angesehen hat, geht es nicht weiter"). Ein
      // Interstitial gehört an einen Übergangs-Moment oder gar nicht —
      // ist es nicht rechtzeitig da, greift eben der nächste Trigger.
      if (!this.isLoaded) {
        this.loadAd();
      }
    }
  }

  async trackScan(isPremium: boolean) {
    await this.bumpLifetimeActions();
    const countStr = await AsyncStorage.getItem(COUNTER_KEYS.SCAN) || '0';
    const count = parseInt(countStr) + 1;
    
    console.log(`📷 Scan count: ${count}/${THRESHOLDS.SCAN}`);
    
    if (count >= THRESHOLDS.SCAN) {
      await AsyncStorage.setItem(COUNTER_KEYS.SCAN, '0');
      await this.showIfReady(isPremium);
    } else {
      await AsyncStorage.setItem(COUNTER_KEYS.SCAN, count.toString());
      // Preload ad when getting close to threshold
      if (count === THRESHOLDS.SCAN - 1) {
        this.preloadIfNeeded();
      }
    }
  }

  private preloadIfNeeded() {
    if (!this.isLoaded && !this.isShowing && this.interstitialAd) {
      console.log('🔮 Preloading interstitial ad (threshold approaching)...');
      this.loadAd();
    }
  }

  // Reset all counters (useful for testing)
  async resetCounters() {
    await AsyncStorage.multiRemove([
      COUNTER_KEYS.SCAN,
      COUNTER_KEYS.LAST_SHOWN,
      COUNTER_KEYS.LIFETIME_ACTIONS,
    ]);
    console.log('🔄 All interstitial counters reset');
  }
}

export const interstitialAdService = new InterstitialAdService();
