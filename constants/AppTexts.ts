export const AppTexts = {
  // Stufen-Texte für NoName-Produkte (Fallback, später Remote Config)
  stufe: {
    0: {
      title: "Produkt ist (noch) unbekannt",
      description: "Bei diesem Produkt ist uns (noch) keine Stufe bzw. kein Hersteller bekannt. Wir aktualisieren unsere Datenbank kontinuierlich, um Ihnen die bestmöglichen Informationen zu liefern.",
      color: "#6b7280"
    },
    1: {
      title: "Reiner NoName-Hersteller",
      description: "Dieser Hersteller hat nach unseren Recherchen keine Verbindungen zu Markenherstellern oder -produkten. Das Produkt wird ausschließlich als Handelsmarke produziert.",
      color: "#ef2d1a"
    },
    2: {
      title: "Markenhersteller ohne vergleichbares Produkt",
      description: "Dieser Hersteller produziert auch für bekannte Marken, aber aktuell kein mit dem NoName-Produkt vergleichbares Markenprodukt. Es besteht jedoch eine Verbindung zu Markenprodukten.",
      color: "#f5720e"
    },
    3: {
      title: "Vergleichbar zum Markenprodukt",
      description: "Dieser Hersteller stellt sowohl ein NoName-Produkt als auch ein Markenprodukt her, die sich in Nährwerten und Geschmack ähneln, aber dennoch Unterschiede aufweisen können.",
      color: "#fbc801"
    },
    4: {
      title: "Sehr ähnlich zum Markenprodukt",
      description: "Dieser Hersteller stellt sowohl das NoName-Produkt als auch das Markenprodukt her, die sich in Nährwerten und Geschmack sehr ähnlich sind. Nur minimale Unterschiede sind feststellbar.",
      color: "#73c928"
    },
    5: {
      title: "Identisch zum Markenprodukt",
      description: "Dieser Hersteller stellt sowohl das NoName-Produkt als auch das Markenprodukt her, bei denen die Zusammensetzung und der Geschmack praktisch identisch sind. Sie erhalten die gleiche Qualität zum günstigeren Preis.",
      color: "#0d8575"
    }
  },

  // Weitere App-Texte können hier hinzugefügt werden
  general: {
    loading: "Wird geladen...",
    error: "Ein Fehler ist aufgetreten",
    retry: "Erneut versuchen"
  }
};

// Helper-Funktion für Stufen-Titel
export const getStufenTitle = (stufe: number): string => {
  return AppTexts.stufe[stufe as keyof typeof AppTexts.stufe]?.title || `Stufe ${stufe}`;
};

// Helper-Funktion für Stufen-Beschreibung
export const getStufenDescription = (stufe: number): string => {
  return AppTexts.stufe[stufe as keyof typeof AppTexts.stufe]?.description || "Keine Beschreibung verfügbar";
};

// Helper-Funktion für Stufen-Farbe
export const getStufenColor = (stufe: number): string => {
  return AppTexts.stufe[stufe as keyof typeof AppTexts.stufe]?.color || "#73c928";
};