import ExpoModulesCore
import AVFoundation
import Vision
import CoreImage
import ImageIO
import UIKit

/// Runtime-tunable scanner parameters (passed live from JS so the open
/// scanner can be tuned without a rebuild). Defaults = the shipped values.
struct ScannerTuning: Record {
  // Document-segmenter acceptance for the LIVE overlay. Confidence is a
  // weak gate (segmenter is almost always confident), so the real levers
  // are area + aspect of the detected quad.
  @Field var docMinConfidence: Double = 0.2
  @Field var docMinArea: Double = 0.06
  @Field var docMaxArea: Double = 0.90
  @Field var docMaxWHRatio: Double = 0.85
  /// Min bon height fraction to call the text "readable" (close enough);
  /// below this we hint "näher ran".
  @Field var minReadableHeight: Double = 0.55
  @Field var persistenceFrames: Int = 50
  @Field var visionHz: Double = 20
  @Field var smoothing: Double = 0.5
  // Rectangle-detector fallback params (not surfaced in the panel).
  @Field var minAspect: Double = 0.2
  @Field var maxAspect: Double = 1.0
  @Field var minSize: Double = 0.2
  @Field var quadratureTolerance: Double = 25
  @Field var maxObservations: Int = 6

  func docParamsLive() -> BonVision.DocParams {
    BonVision.DocParams(
      minConfidence: VNConfidence(docMinConfidence),
      minArea: CGFloat(docMinArea),
      maxArea: CGFloat(docMaxArea),
      maxWHRatio: CGFloat(docMaxWHRatio)
    )
  }

  func rectFallbackParams() -> BonVision.RectParams {
    BonVision.RectParams(
      minConfidence: 0.4,
      minAspect: Float(minAspect),
      maxAspect: Float(maxAspect),
      minSize: Float(minSize),
      quadratureTolerance: Float(quadratureTolerance),
      maxObservations: maxObservations
    )
  }
}

/// Zustand, den die Sitzungs-Beobachter (beliebiger Thread), sessionQueue und
/// der Main-Thread teilen — darum unter einem Lock. Eigenes Objekt statt
/// Felder der View, damit die Beobachter-Blöcke die View nie festhalten.
private final class SitzungsZustand {
  private let lock = NSLock()
  private var _unterbrechungsGrund: String?
  private var _gewuenscht = false
  private var _lief = false
  private var _laufzeitFehler = false

  private func mitLock<T>(_ arbeit: () -> T) -> T {
    lock.lock()
    defer { lock.unlock() }
    return arbeit()
  }

  /// Grund der laufenden Unterbrechung (JS-Code, siehe unterbrechungsCode),
  /// nil = keine Unterbrechung oder Grund unbekannt.
  var unterbrechungsGrund: String? {
    get { mitLock { _unterbrechungsGrund } }
    set { mitLock { _unterbrechungsGrund = newValue } }
  }
  /// JS will die Kamera laufen sehen (Prop isActive).
  var gewuenscht: Bool {
    get { mitLock { _gewuenscht } }
    set { mitLock { _gewuenscht = newValue } }
  }
  /// Der letzte Start der Sitzung ist geglückt (didStartRunning). Während eines
  /// Neustart-Versuchs false — scheitert er, bleibt es dabei (keine Schleife).
  var lief: Bool {
    get { mitLock { _lief } }
    set { mitLock { _lief = newValue } }
  }
  /// Seit dem letzten geglückten Start kam ein Laufzeitfehler. Aussagekräftig
  /// nur, solange die Sitzung steht (requestCapture prüft beides).
  var laufzeitFehler: Bool {
    get { mitLock { _laufzeitFehler } }
    set { mitLock { _laufzeitFehler = newValue } }
  }
}

/**
 * BonScannerView — live receipt scanner with manual shutter.
 *
 * Apple's VNDocumentCameraViewController detects edges live but forces
 * an auto-shutter we can't disable. This view gives us BOTH:
 *   - a live edge-detection overlay (per-frame VNDetectRectangles,
 *     drawn as a CAShapeLayer over the camera preview), AND
 *   - a manual shutter (JS sets `captureSignal` to a fresh, strictly
 *     increasing ID; we grab the next frame, warp it flat via
 *     CIPerspectiveCorrection, emit onCapture). Every answer to a capture
 *     — onCaptureStarted (acknowledgement), onCapture AND onError — carries
 *     that ID as `signalId`, so JS can match it to the tap, give slow image
 *     processing its own deadline, and drop late answers
 *     (aufnahmeZuordnung.ts).
 *
 * Portrait-locked (receipt scanning is portrait) so the Vision↔preview
 * coordinate mapping stays simple and robust: we deliver frames in
 * .portrait, run Vision with .up, and map normalized corners to the
 * preview layer via `layerPointConverted(fromCaptureDevicePoint:)`
 * (which correctly accounts for .resizeAspectFill gravity).
 *
 * Shared detection/warp logic lives in BonVision so the live overlay
 * and the final crop agree, and the static gallery path is unchanged.
 */
public class BonScannerView: ExpoView, AVCaptureVideoDataOutputSampleBufferDelegate, AVCapturePhotoCaptureDelegate {

  // ── JS events ──────────────────────────────────────────────────────
  // Quittung: die Kamera hat eine Aufnahme angenommen (willBeginCaptureFor).
  // JS wechselt damit von der kurzen Start- auf die lange Aufbereitungsgrenze.
  let onCaptureStarted = EventDispatcher()
  let onCapture = EventDispatcher()
  let onError = EventDispatcher()
  let onEdgesDetected = EventDispatcher()
  // Live readability/quality: "none" | "far" | "ok" (fired on change).
  let onQuality = EventDispatcher()
  // Fires after the capture session has actually stopped (isActive → false),
  // so a consumer can hand the back camera off to another stack (expo-camera)
  // deterministically instead of guessing with a timeout.
  let onSessionStopped = EventDispatcher()
  private var lastQualityStatus = ""

  // ── Capture stack ──────────────────────────────────────────────────
  private let session = AVCaptureSession()
  private var previewLayer: AVCaptureVideoPreviewLayer!
  private let videoOutput = AVCaptureVideoDataOutput()
  private let photoOutput = AVCapturePhotoOutput()
  private let overlayLayer = CAShapeLayer()
  private var device: AVCaptureDevice?

  private let sessionQueue = DispatchQueue(label: "bon.scanner.session")
  private let videoQueue = DispatchQueue(label: "bon.scanner.video", qos: .userInitiated)
  // Bildaufbereitung (Rendern, Vision, Entzerren, JPEG) läuft hier und NICHT
  // im Photo-Delegate: AVCapturePhotoOutput stellt alle Delegate-Rückrufe auf
  // EINER gemeinsamen Queue zu (AVCapturePhotoOutput.h). Schwere Arbeit dort
  // verzögert die Quittung (willBeginCaptureFor) jeder weiteren Aufnahme.
  // Parallel statt seriell: eine hängende Aufbereitung (dafür gibt es in JS
  // die Bild-Grenze) hielte sonst jede weitere Aufnahme dieser Ansicht in der
  // Warteschlange fest. Geteilt wird nichts (bereiteAuf ist statisch), und
  // JS lässt nur eine offene Aufnahme zu — parallel laufen zwei also nur
  // nach einer abgelaufenen Bild-Grenze.
  private let processingQueue = DispatchQueue(
    label: "bon.scanner.processing", qos: .userInitiated, attributes: .concurrent
  )

  private var configured = false
  // Nur auf sessionQueue: Einrichtung fand keine nutzbare Kamera.
  private var kameraFehlt = false
  private let zustand = SitzungsZustand()
  private var sitzungsBeobachter: [NSObjectProtocol] = []
  private var lastSignal = 0

  // Signal-ID je laufender Aufnahme (AVCapturePhotoSettings.uniqueID → ID aus
  // JS). Die Photo-Delegate-Rückrufe kommen auf einer Queue von AVFoundation,
  // nicht auf sessionQueue — deshalb das Lock.
  private let signalLock = NSLock()
  private var signalByPhotoID: [Int64: Int] = [:]

  // When true, capture() returns the full upright frame WITHOUT perspective
  // warp/crop — the live overlay + readability hint still run, but the saved
  // photo is a normal picture (used for product labels, not bon scanning).
  private var rawCapture = false

  // All knobs live here, settable live from JS (see ScannerTuning).
  private var tuning = ScannerTuning()

  // Vision throttle for the live overlay (capture is unthrottled).
  private var lastVisionTime: CFTimeInterval = 0

  // Overlay smoothing + visibility.
  private var smoothed: [CGPoint]? = nil
  private var framesWithoutQuad = 0
  private var edgesVisible = false

  // ── Init / layout ──────────────────────────────────────────────────
  public required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    backgroundColor = .black

    previewLayer = AVCaptureVideoPreviewLayer(session: session)
    previewLayer.videoGravity = .resizeAspectFill
    layer.addSublayer(previewLayer)

    overlayLayer.fillColor = UIColor(red: 0.05, green: 0.52, blue: 0.46, alpha: 0.18).cgColor
    overlayLayer.strokeColor = UIColor(red: 0.05, green: 0.52, blue: 0.46, alpha: 0.95).cgColor
    overlayLayer.lineWidth = 3
    overlayLayer.lineJoin = .round
    layer.addSublayer(overlayLayer)

    // Die Beobachter fassen die View nicht an (nur Sitzung, Queue und
    // `zustand`): so fällt ihre letzte Referenz nie auf einem fremden Thread.
    let nc = NotificationCenter.default
    let sitzung = self.session
    let sitzungsQueue = self.sessionQueue
    let zustand = self.zustand

    // Unterbrechungsgrund merken: isInterrupted sagt nur DASS, nicht WARUM —
    // und nur mit dem Grund kann JS den richtigen Ausweg nennen (Vollbild vs.
    // andere App schließen). Direkt hier unter dem Lock gesetzt, nicht über
    // sessionQueue: dort stünde der Setzer hinter einem laufenden
    // startRunning, während isInterrupted schon true ist — ein Tipp in dieser
    // Lücke meldete die Unterbrechung ohne Grund. Nach Ende der Unterbrechung
    // startet die Sitzung von selbst wieder (AVCaptureSession.h).
    sitzungsBeobachter.append(nc.addObserver(
      forName: AVCaptureSession.wasInterruptedNotification, object: sitzung, queue: nil
    ) { note in
      zustand.unterbrechungsGrund = BonScannerView.unterbrechungsCode(note)
    })
    sitzungsBeobachter.append(nc.addObserver(
      forName: AVCaptureSession.interruptionEndedNotification, object: sitzung, queue: nil
    ) { _ in
      zustand.unterbrechungsGrund = nil
    })

    // Laufzeitfehler (z. B. Neustart der Mediendienste) halten die Sitzung
    // an, ohne sie zu unterbrechen — nichts startet sie von selbst neu, und
    // jeder Tipp meldete dauerhaft „läuft noch nicht“ (JS: „gleich bereit“).
    // Wie Apples AVCam: nach mediaServicesWereReset neu starten, sofern die
    // Kamera gewünscht ist und der letzte Start geglückt war (sonst liefe ein
    // scheiternder Neustart in eine Schleife). Bleibt sie aus, meldet
    // requestCapture `camera_unavailable` statt „gleich bereit“.
    sitzungsBeobachter.append(nc.addObserver(
      forName: AVCaptureSession.runtimeErrorNotification, object: sitzung, queue: nil
    ) { note in
      let code = (note.userInfo?[AVCaptureSessionErrorKey] as? AVError)?.code
      sitzungsQueue.async {
        // Vorsorglich als gestört markieren, BEVOR neu gestartet wird:
        // didStartRunning (auch das des Neustarts unten) nimmt es zurück.
        // Gemeldet wird es nur, solange die Sitzung wirklich steht
        // (requestCapture) — ein Fehler ohne Stillstand bleibt folgenlos.
        zustand.laufzeitFehler = true
        if code == .mediaServicesWereReset, zustand.lief, zustand.gewuenscht {
          // Ein Versuch je geglücktem Start: scheitert er, kommt der nächste
          // Laufzeitfehler mit lief == false an und startet nichts mehr.
          // Läuft die Sitzung doch noch, ist startRunning wirkungslos.
          zustand.lief = false
          sitzung.startRunning()
        }
      }
    })
    sitzungsBeobachter.append(nc.addObserver(
      forName: AVCaptureSession.didStartRunningNotification, object: sitzung, queue: nil
    ) { _ in
      zustand.lief = true
      zustand.laufzeitFehler = false
    })
  }

  deinit {
    sitzungsBeobachter.forEach { NotificationCenter.default.removeObserver($0) }
    let capturedSession = session
    sessionQueue.async {
      if capturedSession.isRunning { capturedSession.stopRunning() }
    }
  }

  public override func layoutSubviews() {
    super.layoutSubviews()
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    previewLayer.frame = bounds
    overlayLayer.frame = bounds
    CATransaction.commit()
  }

  // ── Props from JS ──────────────────────────────────────────────────
  func setActive(_ active: Bool) {
    zustand.gewuenscht = active
    configureIfNeeded()
    sessionQueue.async { [weak self] in
      guard let self = self else { return }
      if active {
        if self.configured && !self.session.isRunning { self.session.startRunning() }
      } else {
        if self.session.isRunning { self.session.stopRunning() }
        // Session is fully released now → tell JS (deterministic camera-stack
        // handoff; consumer mounts the next camera only after this fires).
        self.onSessionStopped([:])
      }
    }
  }

  func setTorch(_ on: Bool) {
    sessionQueue.async { [weak self] in
      guard let self = self, let dev = self.device, dev.hasTorch else { return }
      do {
        try dev.lockForConfiguration()
        dev.torchMode = on ? .on : .off
        dev.unlockForConfiguration()
      } catch { /* torch toggle is best-effort */ }
    }
  }

  /// Live tuning from JS (no rebuild needed). Applied on the next frame.
  func applyTuning(_ t: ScannerTuning) {
    tuning = t
  }

  /// Capture mode: false (default) = deskew/warp to a flat document (bon).
  /// true = keep the full upright photo, overlay/hint stay as guidance only.
  func setRawCapture(_ v: Bool) {
    rawCapture = v
  }

  /// JS sets a fresh signal ID to request a capture. We take a
  /// full-resolution still via AVCapturePhotoOutput (delegate below).
  func requestCapture(signal: Int) {
    guard signal > 0, signal != lastSignal else { return }
    lastSignal = signal
    sessionQueue.async { [weak self] in
      guard let self = self else { return }
      // Läuft die Sitzung nicht (Start/Stopp im Gange, Unterbrechung, keine
      // Kamera), kam bis 28.09.2026 gar keine Antwort — der Auslöser in JS
      // drehte endlos. Jetzt sofort melden, mit der ID dieses Tipps.
      if self.kameraFehlt {
        self.melde("camera_unavailable", signalId: signal)
        return
      }
      // Unterbrechung ZUERST prüfen: während einer Unterbrechung hält die
      // Sitzung an (isRunning == false), sie fiele sonst unter „läuft noch
      // nicht“ — und JS verspräche „gleich bereit“, obwohl die Kamera im
      // Nebeneinander-Modus oder bei belegter Kamera gesperrt BLEIBT.
      if self.session.isInterrupted {
        self.melde("session_interrupted", signalId: signal, grund: self.zustand.unterbrechungsGrund)
        return
      }
      // Nach einem Laufzeitfehler, den kein Neustart behoben hat, wird die
      // Kamera nicht „gleich bereit“ — ehrlich melden (JS: Galerie anbieten).
      if !self.session.isRunning && self.zustand.laufzeitFehler {
        self.melde("camera_unavailable", signalId: signal)
        return
      }
      // Die Verbindungsprüfung verhindert zudem die Ausnahme, die
      // capturePhoto ohne aktive Videoverbindung wirft.
      guard
        self.configured,
        self.session.isRunning,
        let conn = self.photoOutput.connection(with: .video),
        conn.isEnabled,
        conn.isActive
      else {
        self.melde("session_not_running", signalId: signal)
        return
      }
      let settings = AVCapturePhotoSettings()
      settings.isHighResolutionPhotoEnabled = true
      self.merkeSignal(signal, fuer: settings.uniqueID)
      self.photoOutput.capturePhoto(with: settings, delegate: self)
    }
  }

  private func merkeSignal(_ signal: Int, fuer photoID: Int64) {
    signalLock.lock()
    signalByPhotoID[photoID] = signal
    signalLock.unlock()
  }

  /// Löst die Signal-ID einer Aufnahme genau einmal ein.
  private func nimmSignal(fuer photoID: Int64) -> Int? {
    signalLock.lock()
    defer { signalLock.unlock() }
    return signalByPhotoID.removeValue(forKey: photoID)
  }

  /// Liest die Signal-ID, ohne sie einzulösen (Quittung).
  private func siehSignal(fuer photoID: Int64) -> Int? {
    signalLock.lock()
    defer { signalLock.unlock() }
    return signalByPhotoID[photoID]
  }

  /// Meldet einen Aufnahmefehler an JS (auf dem Main-Thread).
  private func melde(_ code: String, signalId: Int?, grund: String? = nil) {
    var payload = BonScannerView.mitSignal(["message": code], signalId)
    if let grund = grund { payload["reason"] = grund }
    DispatchQueue.main.async { [weak self] in self?.onError(payload) }
  }

  /// AVCaptureSession.InterruptionReason → Code für JS
  /// (KameraUnterbrechungsGrund in aufnahmeZuordnung.ts).
  private static func unterbrechungsCode(_ note: Notification) -> String? {
    guard
      let roh = (note.userInfo?[AVCaptureSessionInterruptionReasonKey] as? NSNumber)?.intValue,
      let grund = AVCaptureSession.InterruptionReason(rawValue: roh)
    else { return nil }
    switch grund {
    case .videoDeviceNotAvailableWithMultipleForegroundApps: return "multitasking"
    case .videoDeviceInUseByAnotherClient, .audioDeviceInUseByAnotherClient: return "other_client"
    case .videoDeviceNotAvailableDueToSystemPressure: return "system_pressure"
    case .videoDeviceNotAvailableInBackground: return "background"
    default: return nil
    }
  }

  /// Hängt die Signal-ID an ein Event (fehlt sie, bleibt das Event wie früher).
  private static func mitSignal(_ payload: [String: Any], _ signalId: Int?) -> [String: Any] {
    guard let signalId = signalId else { return payload }
    var p = payload
    p["signalId"] = signalId
    return p
  }

  private func meldeAufnahmeFehler(_ signalId: Int?) {
    melde("capture_failed", signalId: signalId)
  }

  // ── Session configuration ─────────────────────────────────────────
  private func configureIfNeeded() {
    sessionQueue.async { [weak self] in
      guard let self = self, !self.configured else { return }
      self.session.beginConfiguration()
      self.session.sessionPreset = .photo

      // Prefer a virtual camera that auto-switches to the ultra-wide lens
      // for macro (triple → dual-wide), so close-up labels actually focus;
      // fall back to the plain wide-angle on phones without those. The
      // camera-stack handoff to expo-camera (EAN step) is handled JS-side
      // with a release gap so this doesn't cause a frozen session.
      let preferred: [AVCaptureDevice.DeviceType] = [
        .builtInTripleCamera,
        .builtInDualWideCamera,
        .builtInWideAngleCamera,
      ]
      var picked: AVCaptureDevice?
      for type in preferred {
        if let d = AVCaptureDevice.default(type, for: .video, position: .back) {
          picked = d
          break
        }
      }
      guard
        let dev = picked,
        let input = try? AVCaptureDeviceInput(device: dev),
        self.session.canAddInput(input)
      else {
        self.session.commitConfiguration()
        // Auslöser-Tipps melden das ab jetzt als camera_unavailable statt
        // „gleich bereit“ (setActive versucht die Einrichtung erneut).
        self.kameraFehlt = true
        DispatchQueue.main.async { self.onError(["message": "camera_unavailable"]) }
        return
      }
      self.kameraFehlt = false
      self.device = dev
      self.session.addInput(input)

      // Continuous autofocus across the full range so the user can hold a
      // label close and it stays sharp (wide-angle focuses to ~10cm — no
      // extreme macro, but a clear win over no focus config at all).
      do {
        try dev.lockForConfiguration()
        if dev.isFocusModeSupported(.continuousAutoFocus) {
          dev.focusMode = .continuousAutoFocus
        }
        if dev.isSmoothAutoFocusSupported {
          dev.isSmoothAutoFocusEnabled = true
        }
        if dev.isAutoFocusRangeRestrictionSupported {
          dev.autoFocusRangeRestriction = .none
        }
        dev.isSubjectAreaChangeMonitoringEnabled = true
        if dev.isExposureModeSupported(.continuousAutoExposure) {
          dev.exposureMode = .continuousAutoExposure
        }
        dev.unlockForConfiguration()
      } catch {
        // Focus tuning is best-effort; the camera still works without it.
      }

      self.videoOutput.videoSettings = [
        kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA,
      ]
      self.videoOutput.alwaysDiscardsLateVideoFrames = true
      self.videoOutput.setSampleBufferDelegate(self, queue: self.videoQueue)
      if self.session.canAddOutput(self.videoOutput) {
        self.session.addOutput(self.videoOutput)
      }

      // Deliver frames already rotated to portrait so Vision runs .up.
      if let conn = self.videoOutput.connection(with: .video), conn.isVideoOrientationSupported {
        conn.videoOrientation = .portrait
      }

      // Full-resolution still output for the actual capture (the live
      // overlay stays on the lower-res video stream). ~12MP vs ~2MP →
      // materially better OCR on fine receipt print.
      if self.session.canAddOutput(self.photoOutput) {
        self.session.addOutput(self.photoOutput)
        self.photoOutput.isHighResolutionCaptureEnabled = true
        if let pconn = self.photoOutput.connection(with: .video), pconn.isVideoOrientationSupported {
          pconn.videoOrientation = .portrait
        }
      }

      self.session.commitConfiguration()
      self.configured = true

      DispatchQueue.main.async {
        if let conn = self.previewLayer.connection, conn.isVideoOrientationSupported {
          conn.videoOrientation = .portrait
        }
      }

      if self.zustand.gewuenscht && !self.session.isRunning {
        self.session.startRunning()
      }
    }
  }

  // ── Frame delegate ─────────────────────────────────────────────────
  public func captureOutput(
    _ output: AVCaptureOutput,
    didOutput sampleBuffer: CMSampleBuffer,
    from connection: AVCaptureConnection
  ) {
    guard let pixelBuffer = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }

    let t = tuning
    let now = CACurrentMediaTime()
    if now - lastVisionTime < 1.0 / max(t.visionHz, 1.0) { return }
    lastVisionTime = now

    let bufW = CGFloat(CVPixelBufferGetWidth(pixelBuffer))
    let bufH = CGFloat(CVPixelBufferGetHeight(pixelBuffer))
    // ML document segmenter, gated on area+aspect so we only mark a
    // real bon (not the table the segmenter would otherwise return).
    let obs = BonVision.detectDocument(pixelBuffer: pixelBuffer, params: t.docParamsLive())
    // Readability: bon height fraction → "far" (too small to read) vs "ok".
    let status: String
    if let obs = obs {
      status = obs.boundingBox.height >= CGFloat(t.minReadableHeight) ? "ok" : "far"
    } else {
      status = "none"
    }
    DispatchQueue.main.async { [weak self] in
      self?.updateOverlay(obs, bufferW: bufW, bufferH: bufH)
      self?.emitQuality(status)
    }
  }

  private func emitQuality(_ status: String) {
    guard status != lastQualityStatus else { return }
    lastQualityStatus = status
    onQuality(["status": status])
  }

  // ── Capture: full-res still → segment → warp flat ──────────────────

  /// Erster Rückruf jeder Aufnahme („so bald wie möglich nach
  /// capturePhoto“, AVCapturePhotoOutput.h). Ab hier ist ein letzter
  /// Rückruf (didFinishCaptureFor) garantiert → JS darf der Aufbereitung
  /// eine großzügige Zeitgrenze geben, statt ein langsames Bild zu verwerfen.
  public func photoOutput(
    _ output: AVCapturePhotoOutput,
    willBeginCaptureFor resolvedSettings: AVCaptureResolvedPhotoSettings
  ) {
    guard let signalId = siehSignal(fuer: resolvedSettings.uniqueID) else { return }
    DispatchQueue.main.async { [weak self] in self?.onCaptureStarted(["signalId": signalId]) }
  }

  public func photoOutput(
    _ output: AVCapturePhotoOutput,
    didFinishProcessingPhoto photo: AVCapturePhoto,
    error: Error?
  ) {
    // ID einlösen, bevor irgendetwas schiefgehen kann — didFinishCaptureFor
    // meldet dann nur noch Aufnahmen, die hier nie angekommen sind.
    let signalId = nimmSignal(fuer: photo.resolvedSettings.uniqueID)
    if error != nil {
      meldeAufnahmeFehler(signalId)
      return
    }
    // Einstellungen zum Zeitpunkt der Aufnahme festhalten, dann die schwere
    // Arbeit von der gemeinsamen Delegate-Queue nehmen (siehe processingQueue).
    let raw = rawCapture
    let t = tuning
    // Die Aufbereitung hält die View NICHT fest: bereiteAuf ist statisch, und
    // die schwache Referenz wird erst auf dem Main-Thread gelesen (die Blöcke
    // fangen die Variable, laden sie aber nicht vorher). Früher hielt
    // `self?.bereiteAuf(…)` die View für die ganze Aufbereitung — wurde der
    // Bildschirm währenddessen geschlossen, fiel ihre letzte Referenz auf der
    // Hintergrund-Queue (UIView/CALayer-Freigabe außerhalb des Main-Threads),
    // und das fertige JPEG blieb ohne Empfänger in Caches liegen.
    weak var ziel = self
    processingQueue.async {
      let ergebnis = BonScannerView.bereiteAuf(photo, raw: raw, tuning: t)
      DispatchQueue.main.async {
        guard let view = ziel else {
          // Niemand mehr da, der das Bild verwenden oder löschen könnte.
          BonScannerView.loescheVerwaistesBild(ergebnis)
          return
        }
        if let r = ergebnis {
          view.onCapture(BonScannerView.mitSignal(r, signalId))
        } else {
          view.onError(BonScannerView.mitSignal(["message": "capture_failed"], signalId))
        }
      }
    }
  }

  /// Rendert das Foto zum fertigen JPEG (Payload für onCapture), nil bei
  /// Fehlschlag. Statisch und ohne Zugriff auf die View: läuft auf
  /// processingQueue, auch nachdem der Bildschirm geschlossen wurde.
  private static func bereiteAuf(_ photo: AVCapturePhoto, raw: Bool, tuning t: ScannerTuning) -> [String: Any]? {
    guard let cg = photo.cgImageRepresentation() else { return nil }
    // Apply the still's EXIF orientation so we work upright, matching the
    // portrait live frames.
    let rawOrientation = (photo.metadata[String(kCGImagePropertyOrientation)] as? NSNumber)?.uint32Value ?? 1
    let cgOrientation = CGImagePropertyOrientation(rawValue: rawOrientation) ?? .up
    let oriented = CIImage(cgImage: cg).oriented(cgOrientation)

    // Raw mode (product labels): no segmentation/warp — just the upright
    // full-frame photo. The live overlay + readability hint already guided
    // the user; we don't want a deskewed doc-scanner crop here.
    if raw {
      return BonVision.renderJPEG(ciImage: oriented)
    }

    // Lenient — the user is pointing at a bon and tapped; accept whatever
    // document fills the still (rectangle detector as fallback).
    let context = CIContext()
    guard let uprightCG = context.createCGImage(oriented, from: oriented.extent) else {
      return BonVision.renderJPEG(ciImage: oriented)
    }
    let lenient = BonVision.DocParams(minConfidence: 0.0, minArea: 0.02, maxArea: 0.99, maxWHRatio: 3.0)
    let obs = BonVision.detectDocument(cgImage: uprightCG, params: lenient)
      ?? BonVision.detectRectangle(cgImage: uprightCG, params: t.rectFallbackParams())
    if let obs = obs {
      return BonVision.warpAndWriteJPEG(ciImage: oriented, observation: obs)
    }
    return BonVision.renderJPEG(ciImage: oriented)
  }

  /// Löscht das JPEG einer Aufnahme, deren Ansicht es nicht mehr gibt
  /// (best effort, abseits des Main-Threads).
  private static func loescheVerwaistesBild(_ ergebnis: [String: Any]?) {
    guard
      let roh = ergebnis?["uri"] as? String,
      let url = URL(string: roh),
      url.isFileURL
    else { return }
    DispatchQueue.global(qos: .utility).async {
      try? FileManager.default.removeItem(at: url)
    }
  }

  /// Letzter Rückruf jeder Aufnahme. Kam für sie nie ein Bild an (Abbruch vor
  /// der Verarbeitung), wartete JS sonst bis zur Zeitgrenze.
  public func photoOutput(
    _ output: AVCapturePhotoOutput,
    didFinishCaptureFor resolvedSettings: AVCaptureResolvedPhotoSettings,
    error: Error?
  ) {
    guard let signalId = nimmSignal(fuer: resolvedSettings.uniqueID) else { return }
    meldeAufnahmeFehler(signalId)
  }

  // ── Live overlay ───────────────────────────────────────────────────
  //
  // We map Vision's normalized corners to screen points OURSELVES via
  // aspect-fill math (the preview uses .resizeAspectFill) rather than
  // `previewLayer.layerPointConverted(fromCaptureDevicePoint:)`, which
  // expects sensor-space (landscape) coords and mis-rotates our
  // portrait-rotated frames. Deterministic and matches what the user
  // sees frame-for-frame.
  private func updateOverlay(_ obs: VNRectangleObservation?, bufferW: CGFloat, bufferH: CGFloat) {
    // Raw mode (product labels): never draw the document polygon — it reads
    // like a doc scanner. The readability hint (emitQuality) still runs; this
    // view just stays a plain camera with a text hint.
    if rawCapture {
      if overlayLayer.path != nil {
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        overlayLayer.path = nil
        CATransaction.commit()
      }
      return
    }
    guard let obs = obs else {
      framesWithoutQuad += 1
      // Hold the last good quad through brief dropouts (persistence);
      // only clear after a sustained miss.
      if framesWithoutQuad > tuning.persistenceFrames {
        smoothed = nil
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        overlayLayer.path = nil
        CATransaction.commit()
        if edgesVisible {
          edgesVisible = false
          onEdgesDetected(["visible": false])
        }
      }
      return
    }
    framesWithoutQuad = 0

    let viewW = bounds.width
    let viewH = bounds.height
    guard viewW > 0, viewH > 0, bufferW > 0, bufferH > 0 else { return }

    // Aspect-fill the (portrait) buffer into the view: fill the view,
    // crop the overflowing dimension, center the rest.
    let imgAspect = bufferW / bufferH
    let viewAspect = viewW / viewH
    let drawW: CGFloat
    let drawH: CGFloat
    let offX: CGFloat
    let offY: CGFloat
    if imgAspect > viewAspect {
      drawH = viewH
      drawW = viewH * imgAspect
      offX = (viewW - drawW) / 2
      offY = 0
    } else {
      drawW = viewW
      drawH = viewW / imgAspect
      offX = 0
      offY = (viewH - drawH) / 2
    }

    // Vision normalized, origin bottom-left → screen (origin top-left).
    let map = { (p: CGPoint) -> CGPoint in
      CGPoint(x: offX + p.x * drawW, y: offY + (1 - p.y) * drawH)
    }
    let raw = [obs.topLeft, obs.topRight, obs.bottomRight, obs.bottomLeft].map(map)

    let pts: [CGPoint]
    if let prev = smoothed, prev.count == raw.count {
      // smoothing = weight on previous (higher = smoother but laggier).
      let s = CGFloat(min(max(tuning.smoothing, 0), 0.95))
      pts = zip(prev, raw).map {
        CGPoint(x: $0.x * s + $1.x * (1 - s), y: $0.y * s + $1.y * (1 - s))
      }
    } else {
      pts = raw
    }
    smoothed = pts

    let path = UIBezierPath()
    path.move(to: pts[0])
    for p in pts.dropFirst() { path.addLine(to: p) }
    path.close()

    CATransaction.begin()
    CATransaction.setDisableActions(true)
    overlayLayer.path = path.cgPath
    CATransaction.commit()

    if !edgesVisible {
      edgesVisible = true
      onEdgesDetected(["visible": true])
    }
  }
}
