/**
 * Zentrale Toast-Messages für die gesamte App
 * Mit Template-Interpolation für dynamische Werte
 */

/**
 * Toast-Themes mit Light/Dark Mode und Text-Farben
 * User erkennt an Farbe sofort die Aktion-Kategorie
 */
export const TOAST_THEMES = {
  light: {
    POINTS: { 
      background: '#FFCC00', 
      text: 'black',
      button: { background: 'rgba(255,255,255,0.25)', text: '#ffffff' }
    },
    FAVORITES: { 
      background: '#e87676', 
      text: '#ffffff',
      button: { background: 'rgba(255,255,255,0.25)', text: '#ffffff' }
    },
    SHOPPING: { 
      background: '#4caf50', 
      text: '#ffffff',
      button: { background: 'rgba(255,255,255,0.25)', text: '#ffffff' }
    },
    RATINGS: { 
      background: '#9c27b0', 
      text: '#ffffff',
      button: { background: 'rgba(255,255,255,0.25)', text: '#ffffff' }
    },
    STREAK: { 
      background: '#ff9800', 
      text: '#ffffff',
      button: { background: 'rgba(255, 255, 255, 0.25)', text: '#ffffff' }
    },
    ERROR: { 
      background: '#ff3b30', 
      text: '#ffffff',
      button: { background: 'rgba(255,255,255,0.25)', text: '#ffffff' }
    },
    INFO: { 
      background: '#2196f3', 
      text: '#ffffff',
      button: { background: 'rgba(255,255,255,0.25)', text: '#ffffff' }
    },
    ANTI_ABUSE: { 
      background: '#FF9500', 
      text: '#ffffff',
      button: { background: 'rgba(255,255,255,0.25)', text: '#ffffff' }
    },
  },
  dark: {
    POINTS: { 
      background: '#FFCC00', 
      text: '#000000',
      button: { background: 'rgba(0,0,0,0.2)', text: '#000000' }
    },
    FAVORITES: { 
      background: '#ff8a9b', 
      text: '#000000',
      button: { background: 'rgba(0,0,0,0.2)', text: '#000000' }
    },
    SHOPPING: { 
      background: '#66bb6a', 
      text: '#000000',
      button: { background: 'rgba(0,0,0,0.2)', text: '#000000' }
    },
    RATINGS: { 
      background: '#ba68c8', 
      text: '#ffffff',
      button: { background: 'rgba(255,255,255,0.25)', text: '#ffffff' }
    },
    STREAK: { 
      background: '#ffb74d', 
      text: '#000000',
      button: { background: 'rgba(0,0,0,0.2)', text: '#000000' }
    },
    ERROR: { 
      background: '#ff5252', 
      text: '#ffffff',
      button: { background: 'rgba(255,255,255,0.25)', text: '#ffffff' }
    },
    INFO: { 
      background: '#42a5f5', 
      text: '#000000',
      button: { background: 'rgba(0,0,0,0.2)', text: '#000000' }
    },
    ANTI_ABUSE: { 
      background: '#ffb74d', 
      text: '#000000',
      button: { background: 'rgba(0,0,0,0.2)', text: '#000000' }
    },
  }
} as const;

/**
 * Legacy: Einfache Farben für Rückwärtskompatibilität
 */
export const TOAST_COLORS = {
  POINTS: '#bf9b30',      // 🎯 Gelb für Punkte
  FAVORITES: '#e87676',   // 💖 Rosa für Favoriten  
  SHOPPING: '#4caf50',    // 🛒 Grün für Einkaufszettel
  RATINGS: '#9c27b0',     // ⭐ Lila für Bewertungen
  STREAK: '#ff9800',      // 🔥 Orange für Streaks
  ERROR: '#ff3b30',       // ❌ Rot für Fehler
  INFO: '#2196f3',        // 💡 Blau für Infos
} as const;

/**
 * Toast-Kategorien
 */
export type ToastCategory = keyof typeof TOAST_THEMES.light;

/**
 * Helper: Hole Theme-Farben basierend auf colorScheme
 */
export function getToastTheme(colorScheme: 'light' | 'dark' | null) {
  return TOAST_THEMES[colorScheme || 'light'];
}

/**
 * Toast-Anzeigezeiten in Millisekunden (pro Kategorie konfigurierbar)
 */
export const TOAST_DURATIONS = {
  POINTS: 3000,      // 🎯 Punkte: Schnelle Bestätigung 
  FAVORITES: 2500,   // 💖 Favoriten: Schnelle Bestätigung
  SHOPPING: 3000,    // 🛒 Einkaufszettel: Standard 
  RATINGS: 3500,     // ⭐ Bewertungen: Etwas länger
  STREAK: 4000,      // 🔥 Streaks: Celebration, länger zeigen
  ERROR: 5000,       // ❌ Fehler: Wichtig, länger sichtbar
  INFO: 3000,        // 💡 Infos: Standard
  ANTI_ABUSE: 6000,  // ⚠️ Anti-Abuse: Wichtige Warnings, lange zeigen
} as const;

/**
 * Helper: Hole Anzeigezeit für Toast-Kategorie
 */
export const getToastDuration = (category: ToastCategory): number => {
  return TOAST_DURATIONS[category] || TOAST_DURATIONS.INFO; // Fallback auf INFO
};

/**
 * Helper: Format time in German (für dedupe window)
 */
export const formatTimeLeft = (seconds: number): string => {
  if (seconds < 60) {
    return `${seconds} Sekunden`;
  } else if (seconds < 3600) {
    const minutes = Math.floor(seconds / 60);
    return `${minutes} ${minutes === 1 ? 'Minute' : 'Minuten'}`;
  } else {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    if (minutes === 0) {
      return `${hours} ${hours === 1 ? 'Stunde' : 'Stunden'}`;
    }
    return `${hours}:${minutes.toString().padStart(2, '0')} Stunden`;
  }
};

export const TOAST_MESSAGES = {
  // 🎯 PUNKTE & GAMIFICATION
  POINTS: {
    scan_product: '📸 Produkt gescannt',
    search_product: '🔍 Produkt gesucht', 
    view_comparison: '👀 Vergleich angeschaut',
    complete_shopping: '🛒 Einkauf abgeschlossen',
    convert_product: '🔄 Produkt umgewandelt',
    submit_rating: '⭐ Bewertung abgegeben',
    save_product: '💖 Favorit gespeichert',
    daily_streak: '🔥 Täglicher Streak',
    first_action_any: '🎉 Erste Aktion',
    share_app: '🤝 App geteilt',
    submit_product: '📦 Produkt eingereicht',
    create_list: '🧾 Liste erstellt',
    mission_daily_done: '🎯 Tägliche Mission',
    mission_weekly_done: '🌟 Wöchentliche Mission',
    savings_total: '💸 Spar-Meilenstein'
  },

  // ❤️ FAVORITEN (konsistent für alle Produkttypen)
  FAVORITES: {
    added: '💖 Zu Favoriten hinzugefügt: {productName}',
    removed: '💔 Aus Favoriten entfernt: {productName}',
    addError: '❌ Fehler beim Speichern des Favoriten',
    removeError: '❌ Fehler beim Entfernen des Favoriten',
    authRequired: '❌ Bitte melde dich an, um Favoriten zu speichern'
  },

  // 🛒 EINKAUFSZETTEL (konsistent für alle Produkttypen & Stufen)
  SHOPPING: {
    // Hinzufügen (konsistent für NoName Stufe 1,2,3+ & Marken)
    addedToCart: '🛒 Zum Einkaufszettel hinzugefügt: {productName}',
    alreadyInCart: '💡 Produkt ist bereits im Einkaufszettel',
    addToCartError: '❌ Produkt konnte nicht hinzugefügt werden',
    addToCartAuthRequired: '❌ Bitte melde dich an, um Produkte hinzuzufügen',
    
    // Bulk-Hinzufügen
    bulkAddedSuccess: '🛒 {count} {countText} hinzugefügt!',
    bulkAddedPartial: '⚠️ {successCount} hinzugefügt, {errorCount} Fehler',
    bulkAddError: '❌ Fehler beim Hinzufügen zum Einkaufszettel',
    selectFirstPrompt: '🛒 Wähle zuerst Produkte zum Umwandeln aus!',
    
    // Umwandlung (Marke → NoName)
    convertedWithSavings: '🔄 Umgewandelt! Du sparst €{savings} mit dem NoName-Produkt!',
    convertedSimple: '🔄 Produkt erfolgreich umgewandelt!',
    convertError: '❌ Umwandlung fehlgeschlagen. Versuch es nochmal!',
    bulkConvertSuccess: '🎉 Fantastisch! Du sparst €{savings} mit NoName-Produkten!',
    bulkConvertError: '❌ Umwandlung fehlgeschlagen. Keine Sorge, versuch es nochmal!',
    
    // Gekauft markieren
    purchasedWithSavings: '💰 Gekauft! Du hast €{savings} gespart - super gemacht!',
    purchasedSimple: '✅ Produkt als gekauft markiert!',
    customItemPurchased: '📝 Freitext-Eintrag erledigt!',
    purchaseError: '❌ Markierung fehlgeschlagen. Probier es nochmal!',
    
    // Bulk-Gekauft
    bulkPurchasedMixed: '🏆 Fantastic! Alle {totalCount} Einträge erledigt! ({dbCount} Produkte, €{savings} gespart + {customCount} Freitext-Einträge)',
    bulkPurchasedProducts: '🏆 Wow! Alle {count} Produkte als gekauft markiert! Du hast €{savings} gespart!',
    bulkPurchasedCustom: '📝 Alle {count} Freitext-Einträge erledigt!',
    bulkPurchaseError: '❌ Oops! Markierung fehlgeschlagen. Versuch es nochmal!',
    
    // Entfernen
    removedFromCart: '🛒 Produkt vom Einkaufszettel entfernt',
    removeError: '❌ Entfernen fehlgeschlagen. Versuch es nochmal!',
    
    // Loading
    loadError: '❌ Einkaufszettel konnte nicht geladen werden'
  },

  // ⭐ BEWERTUNGEN
  RATINGS: {
    ratingRequired: '❌ Bitte gib eine Gesamtbewertung ab',
    ratingUpdated: '⭐ Deine Bewertung wurde aktualisiert!',
    ratingSaved: '⭐ Deine Bewertung wurde gespeichert!',
    ratingError: '❌ Bewertung konnte nicht gespeichert werden',
    authRequired: '❌ Kein Benutzer angemeldet'
  },

  // 📝 CUSTOM ITEMS (Freitext)
  CUSTOM: {
    success: '✅ {message}', // Dynamisch aus Modal
    error: '❌ {message}'    // Dynamisch aus Modal
  },

  // 🔥 STREAK SYSTEM
  STREAK: {
    withPoints: '🔥 {days} {dayText} Streak! +{points} Punkte',
    withoutPoints: '🔥 {days} {dayText} Streak!'
  },

  // 🚨 ALLGEMEINE FEHLER
  ERRORS: {
    authRequired: '❌ Bitte melde dich an',
    generalError: '❌ Ein Fehler ist aufgetreten. Versuch es nochmal!'
  },
  ANTI_ABUSE: {
    oneTimeRestriction: '⚠️ Diese Action kann nur einmal ausgeführt werden',
    dedupeWindow: '⏳ Bitte warte {timeLeft} bevor du diese Action wiederholst um wieder Punkte zu erhalten',
    dailyCapReached: '📅 Tageslimit fürs Punkte sammeln erreicht! Du kannst diese Action heute nicht mehr ausführen',
    weeklyCapReached: '📊 Wochenlimit fürs Punkte sammeln erreicht! Du kannst diese Action diese Woche nicht mehr ausführen'
  }
} as const;

/**
 * Template-Interpolation Helper
 * Ersetzt {variable} Platzhalter mit echten Werten
 */
export function interpolateMessage(
  template: string, 
  variables: Record<string, string | number>
): string {
  return template.replace(/\{(\w+)\}/g, (match, key) => {
    const value = variables[key];
    return value !== undefined ? String(value) : match;
  });
}

/**
 * Helper für häufige Pluralisierung
 */
export function getCountText(count: number): string {
  return count === 1 ? 'Produkt' : 'Produkte';
}

/**
 * Formatiert Geldbeträge konsistent
 */
export function formatSavings(amount: number): string {
  return amount.toFixed(2);
}

/**
 * Extrahiert das erste Emoji aus einer Message
 */
export function extractEmoji(message: string): { emoji: string; text: string } {
  // Verbesserte Emoji-Regex für alle Unicode-Bereiche inklusive Modifiers
  const emojiRegex = /[\u{1F000}-\u{1F9FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]|[\u{1F600}-\u{1F64F}]|[\u{1F300}-\u{1F5FF}]|[\u{1F680}-\u{1F6FF}]|[\u{1F1E0}-\u{1F1FF}]/u;
  
  const match = message.match(emojiRegex);
  if (match) {
    const emoji = match[0];
    const text = message.replace(emoji, '').trim();
    return { emoji, text };
  }
  
  // Fallback: kein Emoji gefunden
  return { emoji: '✅', text: message };
}
