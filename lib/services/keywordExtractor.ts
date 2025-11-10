/**
 * Simple Keyword Extraction Service für Produktsuche
 */

export class KeywordExtractor {
  // Stopwords die wir für die Suche entfernen
  private static stopwords = new Set([
    // Artikel
    'der', 'die', 'das', 'den', 'dem', 'des', 'ein', 'eine', 'einer', 'eines',
    // Präpositionen
    'und', 'oder', 'mit', 'ohne', 'für', 'bei', 'aus', 'von', 'zu', 'in', 'im', 'am', 'an', 'auf', 'über', 'unter',
    // Mengenangaben & Verpackungen
    'g', 'kg', 'mg', 'l', 'ml', 'cl', 'dl',
    'stück', 'stk', 'pack', 'packung', 'dose', 'dosen', 'flasche', 'flaschen', 
    'becher', 'glas', 'gläser', 'beutel', 'tüte', 'karton', 'box', 'schachtel',
    'riegel', 'tafel', 'tafeln', 'rolle', 'rollen', 'scheiben', 'portion', 'portionen',
    // Zahlen
    '1', '2', '3', '4', '5', '6', '7', '8', '9', '0',
    // Sonstige häufige Wörter die nicht helfen
    'neu', 'alt', 'groß', 'klein', 'super', 'extra', 'plus', 'pro'
  ]);

  /**
   * Extrahiert relevante Keywords aus einem Produktnamen für Algolia-Suche
   * Entfernt nur Stopwords, keine komplexen Mappings (das macht Algolia)
   */
  static extractSearchQuery(productName: string): string {
    if (!productName) return '';
    
    // Normalisiere den Text
    const normalized = productName
      .toLowerCase()
      .replace(/[^\w\s\-äöüß]/g, ' ') // Entferne Sonderzeichen außer Bindestrich und Umlaute
      .replace(/\s+/g, ' ') // Multiple Spaces zu einem
      .trim();
    
    // Splitte in Wörter
    const words = normalized.split(' ');
    
    // Filtere Stopwords und zu kurze Wörter
    const filtered = words.filter(word => 
      word.length > 2 && 
      !this.stopwords.has(word) &&
      !this.isNumeric(word)
    );
    
    // Gib als String für Algolia zurück
    const query = filtered.join(' ');
    
    console.log(`🔍 Cleaned search query: "${productName}" → "${query}"`);
    
    return query;
  }
  
  private static isNumeric(str: string): boolean {
    return /^\d+$/.test(str);
  }
}
