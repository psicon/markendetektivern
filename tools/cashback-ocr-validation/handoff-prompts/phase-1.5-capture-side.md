# Handoff Prompt — Phase 1.5: Capture-Side Bon-Quality Enforcement

**Wo gehört das hin?** Eine neue Session in der App-Codebase (React Native / Expo).
Die OCR-Pipeline ist bereits in `tools/cashback-ocr-validation/` validiert und
funktioniert mit echten DACH-Bons (Cloud Vision + Gemini Flash Hybrid).

---

## Mission in einem Satz

Verhindere, dass schlechte Bon-Fotos überhaupt in die OCR-Pipeline kommen —
durch Live-Camera-Guidance VOR dem Capture, statt teurer Backend-Reparatur danach.

## Warum jetzt?

Im Phase-0-Validation-Tool haben wir gemessen:
- **33% Auto-Escalation-Rate** (Σ items ≠ Total → DocAI als Backup nötig)
- Hauptursache: Bons schräg/teilweise außerhalb des Frames, Reflexionen,
  Schatten, fehlende Ecken
- Backend kostet uns dann ~5¢ extra pro eskaliertem Bon (DocAI Expense
  Parser bei $0.05/page)
- Skaliert auf 1.5k Bons/Tag = ~$700/Monat **vermeidbare** Kosten,
  die wir mit kostenloser Client-Side-Detection eliminieren können.

Ziel: **Escalation-Rate < 10%** durch Capture-Quality-Enforcement.

## Was zu bauen ist

Ein Bon-Capture-Screen in der React-Native-App mit:

### 1. Live-Frame-Detection (rechteckiger Bon-Umriss)
- OpenCV (via `react-native-vision-camera` + Frame Processor) oder
  natives Module (iOS `VNDetectRectanglesRequest`, Android `MlKit
  DocumentScanner`).
- Zeichnet einen grünen Rahmen, wenn alle 4 Bon-Ecken im Frame sind.
- Roter Rahmen + Hinweistext, wenn:
  - Eine Ecke fehlt → "Bon gerade halten, alle Ecken sichtbar"
  - Zu schräg (>20° tilt) → "Bon flach hinlegen"
  - Zu nah/weit → "Näher" / "Etwas weiter weg"

### 2. Helligkeits-/Schärfe-Check
- Vor dem Auslösen: Mittlere Luminanz prüfen (nicht zu dunkel, nicht
  überstrahlt durch Blitz/Reflexion)
- Schärfe via Laplacian-Variance auf einem Downscale-Frame
  (gleicher Algo wie in `image_prep.py::_sharpness`)
- "Zu dunkel" / "Verwackelt — bitte Hand ruhig halten"

### 3. Auslöser-Gate
- Auslösen-Button NUR aktiv wenn:
  - Frame-Detection grün ✓
  - Sharpness > Schwelle (≥120 z.B.)
  - Helligkeit im Range (50–200 von 255)
- Wenn alle Gates grün: subtiler Haptic-Feedback "go!"

### 4. Post-Capture Auto-Crop
- Nach dem Auslösen sofort Perspective-Correction client-side anwenden
  (bewährter Algo lebt schon in
  `tools/cashback-ocr-validation/image_prep.py::_detect_receipt_corners`
  und `_perspective_correct`).
- Output: gerader, gecroppter Bon → upload an Backend.

### 5. Fallback-Pfad: "Trotzdem hochladen"
- User muss IMMER overriden können (für Edge-Cases: schon eingerollte
  Thermalbons, beschädigte Bons, …).
- Wenn manuell hochgeladen → Backend Auto-Escalate fängt's auf.

## Was DU NICHT machen sollst

- **Nicht** die OCR-Engine ändern. Die läuft in der Cloud und ist nicht
  Teil der App.
- **Nicht** Firestore-Schema oder Backend-Code anfassen — Phase 1
  Foundation ist eigene Session.
- **Nicht** auf die alte Capture-Implementation aufsetzen falls eine
  existiert — fang frisch an, sauberer Component.

## Akzeptanzkriterien

- Reale Test-Captures auf iOS+Android: 9 von 10 Captures erfüllen die
  Gates, 1 von 10 erfordert Override.
- Bon-Frame-Detection läuft mit ≥20fps (smooth UX, kein Stottern).
- Crop-Output sieht "DocAI-ready" aus: rechteckig, kein Hintergrund,
  Text gerade.
- A/B-vergleichbar: dieselben Bons durch alte (Foto + Backend-Crop) vs
  neue (Live-Crop) Pipeline → Δ-Rate misst sich.

## Hilfreiche Referenzen

- Bestehende Algorithmen (alle MIT-Lizenz, Python aber 1:1 in
  Swift/Kotlin/JS portierbar):
  - `tools/cashback-ocr-validation/image_prep.py::_detect_receipt_corners`
    (Canny + Contours + 4-Vertex-Approximation)
  - `tools/cashback-ocr-validation/image_prep.py::_perspective_correct`
    (Order corners + getPerspectiveTransform + warpPerspective)
- React-Native-Libs zum Vergleichen:
  - `react-native-vision-camera` (Frame Processors)
  - `@react-native-ml-kit/document-scanner` (Google ML Kit, fertige
    DocScan-Komponente — wahrscheinlich der schnellste Weg!)
  - `react-native-document-scanner-plugin` (community wrapper)

## Empfehlung Reihenfolge

1. **Spike 1 day**: ML Kit Document Scanner einbauen, schauen ob das
   90% der Arbeit erschlägt. Wenn ja → fertig.
2. Wenn ML Kit nicht flexibel genug: Custom Vision-Camera-Implementation
   mit Live-Edge-Detection.
3. Dann Helligkeits-/Schärfe-Gates obendrauf.
4. Test-Run mit 50 echten Bons quer durch DACH-Discounter.

## Erwarteter Impact

- Escalation-Rate: 33% → <10% → ~$735/Monat Backend-Kosten gespart
- Conversion: weniger "Bon abgelehnt"-Frust → höhere Cashback-Quote
- Latenz: Crop client-side erspart Backend-Round-Trip → User wartet weniger

---

**Next session start mit:** "Implement Phase 1.5 Capture-Side Bon-Quality
Enforcement gemäß `tools/cashback-ocr-validation/handoff-prompts/phase-1.5-capture-side.md`"
