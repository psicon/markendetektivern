import { linkWithCredential, User } from 'firebase/auth';
import { collection, doc, getDocs, writeBatch } from 'firebase/firestore';
import { db } from '../firebase';

/**
 * Service für die Migration von anonymen User-Daten zur registrierten Account
 */
class AnonymousDataMigrationService {
  private static instance: AnonymousDataMigrationService;

  public static getInstance(): AnonymousDataMigrationService {
    if (!AnonymousDataMigrationService.instance) {
      AnonymousDataMigrationService.instance = new AnonymousDataMigrationService();
    }
    return AnonymousDataMigrationService.instance;
  }

  /**
   * Migriert alle Daten eines anonymen Users zu einem registrierten Account
   */
  async migrateAnonymousDataToRegistered(
    anonymousUser: User,
    credential: any
  ): Promise<User> {
    console.log('🔄 Starte Daten-Migration von anonym zu registriert...');
    
    try {
      // 1. Account mit Credential verknüpfen
      const linkedUser = await linkWithCredential(anonymousUser, credential);
      console.log('✅ Account erfolgreich verknüpft:', linkedUser.user.uid);

      // 2. User Profile in Firestore aktualisieren
      await this.updateUserProfileForRegistration(linkedUser.user);

      // 3. Alle gespeicherten Daten sind bereits unter der gleichen UID
      // (Firebase Anonymous Auth behält die UID bei linkWithCredential)
      
      console.log('✅ Daten-Migration abgeschlossen für User:', linkedUser.user.uid);
      return linkedUser.user;

    } catch (error) {
      console.error('❌ Fehler bei der Daten-Migration:', error);
      throw new Error(`Migration fehlgeschlagen: ${error}`);
    }
  }

  /**
   * Aktualisiert das User-Profil nach der Registrierung
   */
  private async updateUserProfileForRegistration(user: User): Promise<void> {
    try {
      const userRef = doc(db, 'users', user.uid);
      const batch = writeBatch(db);

      // Update User-Profil mit echten Daten
      batch.update(userRef, {
        email: user.email,
        display_name: user.displayName || user.email?.split('@')[0] || 'Benutzer',
        photo_url: user.photoURL || '',
        registrationCompleted: new Date(),
        isAnonymous: false // Wichtig: Anonymus-Flag entfernen
      });

      await batch.commit();
      console.log('✅ User-Profil aktualisiert nach Registration');

    } catch (error) {
      console.warn('⚠️ Profil-Update nach Registration fehlgeschlagen:', error);
      // Nicht kritisch - Migration kann trotzdem fortgesetzt werden
    }
  }

  /**
   * Überprüft ob ein User migrationsberechtigt ist
   */
  isEligibleForMigration(user: User | null): boolean {
    return !!(user && user.isAnonymous);
  }

  /**
   * Zählt vorhandene Daten eines anonymen Users
   */
  async getAnonymousDataSummary(userId: string): Promise<{
    favorites: number;
    cartItems: number;
    ratings: number;
    scanHistory: number;
    searchHistory: number;
  }> {
    try {
      const promises = [
        this.countCollection(`users/${userId}/favorites`),
        this.countCollection(`users/${userId}/einkaufswagen`),
        this.countCollection(`users/${userId}/ratings`),
        this.countCollection(`users/${userId}/scanHistory`),
        this.countCollection(`users/${userId}/searchHistory`)
      ];

      const [favorites, cartItems, ratings, scanHistory, searchHistory] = await Promise.all(promises);

      return {
        favorites,
        cartItems,
        ratings,
        scanHistory,
        searchHistory
      };

    } catch (error) {
      console.warn('⚠️ Fehler beim Zählen der anonymen Daten:', error);
      return {
        favorites: 0,
        cartItems: 0,
        ratings: 0,
        scanHistory: 0,
        searchHistory: 0
      };
    }
  }

  /**
   * Hilfsfunktion zum Zählen von Dokumenten in einer Collection
   */
  private async countCollection(collectionPath: string): Promise<number> {
    try {
      const snapshot = await getDocs(collection(db, collectionPath));
      return snapshot.size;
    } catch (error) {
      return 0;
    }
  }
}

export const anonymousDataMigrationService = AnonymousDataMigrationService.getInstance();
export default anonymousDataMigrationService;
