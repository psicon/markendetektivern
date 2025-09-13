/**
 * Einfacher Overlay Manager für die Koordination von UI-Overlays
 * Verhindert, dass sich Batch-Aktionen und Gamification-Overlays überschneiden
 */
class OverlayManager {
  private batchActionActive = false;
  private pendingOverlays: (() => void)[] = [];

  /**
   * Markiert eine Batch-Aktion als aktiv
   */
  setBatchActionActive(active: boolean) {
    this.batchActionActive = active;
    
    // Wenn Batch-Aktion beendet, zeige alle wartenden Overlays
    if (!active && this.pendingOverlays.length > 0) {
      // Kurze Verzögerung für smoothen Übergang
      setTimeout(() => {
        const overlay = this.pendingOverlays.shift();
        if (overlay) overlay();
      }, 500);
    }
  }

  /**
   * Prüft ob eine Batch-Aktion läuft
   */
  isBatchActionActive(): boolean {
    return this.batchActionActive;
  }

  /**
   * Zeigt ein Overlay oder stellt es in die Warteschlange
   */
  showOverlay(showFunction: () => void) {
    if (this.batchActionActive) {
      // Batch-Aktion läuft -> in Warteschlange
      this.pendingOverlays.push(showFunction);
    } else {
      // Kein Konflikt -> direkt zeigen
      showFunction();
    }
  }

  /**
   * Leert die Warteschlange (z.B. bei Screen-Wechsel)
   */
  clearPendingOverlays() {
    this.pendingOverlays = [];
  }
}

// Singleton Instance
export const overlayManager = new OverlayManager();
