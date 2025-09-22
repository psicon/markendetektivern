/**
 * Anonymer Location Service - ohne User Permissions
 * Optimiert für Deutschland mit einfachen Fallbacks
 */

export interface LocationData {
  lat: number;
  lon: number;
  city: string;
  geohash5: string;
  source: 'ip' | 'fallback';
}

export class AnonymousLocationService {
  private static cache: LocationData | null = null;
  private static cacheExpiry: number = 0;
  
  /**
   * Holt Location-Daten ohne User Permission
   */
  static async getLocation(): Promise<LocationData | null> {
    // Cache für 1 Stunde
    if (this.cache && Date.now() < this.cacheExpiry) {
      return this.cache;
    }
    
    try {
      // Versuch 1: IP-basierte Location (schnell & genau)
      const ipLocation = await this.getLocationFromIP();
      if (ipLocation) {
        this.cache = ipLocation;
        this.cacheExpiry = Date.now() + (60 * 60 * 1000); // 1 Stunde
        return ipLocation;
      }
      
      // Versuch 2: Einfacher Fallback
      const fallbackLocation = this.getFallbackLocation();
      this.cache = fallbackLocation;
      this.cacheExpiry = Date.now() + (10 * 60 * 1000); // 10 Minuten
      return fallbackLocation;
      
    } catch (error) {
      console.log('📍 Location detection failed, using fallback');
      return this.getFallbackLocation();
    }
  }
  
  /**
   * IP-basierte Location (ipapi.co)
   */
  private static async getLocationFromIP(): Promise<LocationData | null> {
    try {
      console.log('🌐 Versuche IP-Location via ipapi.co...');
      
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 2000); // 2s timeout
      
      const response = await fetch('https://ipapi.co/json/', {
        signal: controller.signal
      });
      clearTimeout(timeoutId);
      
      console.log('🌐 IP-API Response Status:', response.status);
      
      if (!response.ok) {
        console.warn('⚠️ IP-API Response nicht OK:', response.status);
        return null;
      }
      
      const data = await response.json();
      console.log('🌐 IP-API Daten:', {
        country: data.country_code,
        city: data.city,
        hasCoords: !!(data.latitude && data.longitude)
      });
      
      // Deutschland, Österreich und Schweiz verarbeiten
      if ((data.country_code === 'DE' || data.country_code === 'AT' || data.country_code === 'CH') && 
          data.latitude && data.longitude) {
        const lat = Math.round(data.latitude * 20) / 20; // Anonymisiert auf ~5km
        const lon = Math.round(data.longitude * 20) / 20;
        
        const result = {
          lat,
          lon,
          city: data.city || data.country_name || 'DACH-Region',
          geohash5: this.coordinatesToGeohash5(lat, lon),
          source: 'ip' as const
        };
        
        console.log('✅ IP-Location erfolgreich:', result);
        return result;
      } else if (data.country_code) {
        console.log('ℹ️ Land erkannt aber nicht DACH-Region:', data.country_code);
        return null;
      } else {
        console.warn('⚠️ Keine Koordinaten in IP-Response');
        return null;
      }
      
    } catch (error) {
      console.error('❌ IP-Location Fehler:', error);
      return null;
    }
  }
  
  /**
   * Einfacher Fallback - nur wenn IP komplett fehlschlägt
   */
  private static getFallbackLocation(): LocationData {
    // DACH-Region Zentrum (nur bei komplettem IP-Ausfall)
    const lat = 51.15; // Anonymisiert
    const lon = 10.45;  // Anonymisiert
    
    return {
      lat,
      lon,
      city: 'DACH-Region',
      geohash5: this.coordinatesToGeohash5(lat, lon),
      source: 'fallback'
    };
  }
  
  /**
   * Koordinaten zu Geohash5 (kompatibel mit Analytics)
   */
  private static coordinatesToGeohash5(lat: number, lon: number): string {
    const latBucket = Math.floor(lat * 20) / 20;
    const lonBucket = Math.floor(lon * 20) / 20;
    return `${latBucket.toFixed(2)}_${lonBucket.toFixed(2)}`;
  }
  
  /**
   * Cache löschen (für Testing)
   */
  static clearCache(): void {
    this.cache = null;
    this.cacheExpiry = 0;
  }
}
