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

/**
 * BonScannerView — live receipt scanner with manual shutter.
 *
 * Apple's VNDocumentCameraViewController detects edges live but forces
 * an auto-shutter we can't disable. This view gives us BOTH:
 *   - a live edge-detection overlay (per-frame VNDetectRectangles,
 *     drawn as a CAShapeLayer over the camera preview), AND
 *   - a manual shutter (JS bumps `captureSignal`; we grab the next
 *     frame, warp it flat via CIPerspectiveCorrection, emit onCapture).
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
  let onCapture = EventDispatcher()
  let onError = EventDispatcher()
  let onEdgesDetected = EventDispatcher()
  // Live readability/quality: "none" | "far" | "ok" (fired on change).
  let onQuality = EventDispatcher()
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

  private var configured = false
  private var wantActive = false
  private var lastSignal = 0

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
  }

  deinit {
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
    wantActive = active
    configureIfNeeded()
    sessionQueue.async { [weak self] in
      guard let self = self else { return }
      if active {
        if self.configured && !self.session.isRunning { self.session.startRunning() }
      } else {
        if self.session.isRunning { self.session.stopRunning() }
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

  /// JS bumps an incrementing signal to request a capture. We take a
  /// full-resolution still via AVCapturePhotoOutput (delegate below).
  func requestCapture(signal: Int) {
    guard signal > 0, signal != lastSignal else { return }
    lastSignal = signal
    sessionQueue.async { [weak self] in
      guard let self = self, self.configured, self.session.isRunning else { return }
      let settings = AVCapturePhotoSettings()
      settings.isHighResolutionPhotoEnabled = true
      self.photoOutput.capturePhoto(with: settings, delegate: self)
    }
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
        DispatchQueue.main.async { self.onError(["message": "camera_unavailable"]) }
        return
      }
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

      if self.wantActive && !self.session.isRunning {
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
  public func photoOutput(
    _ output: AVCapturePhotoOutput,
    didFinishProcessingPhoto photo: AVCapturePhoto,
    error: Error?
  ) {
    if error != nil {
      DispatchQueue.main.async { [weak self] in self?.onError(["message": "capture_failed"]) }
      return
    }
    guard let cg = photo.cgImageRepresentation() else {
      DispatchQueue.main.async { [weak self] in self?.onError(["message": "capture_failed"]) }
      return
    }
    // Apply the still's EXIF orientation so we work upright, matching the
    // portrait live frames.
    let rawOrientation = (photo.metadata[String(kCGImagePropertyOrientation)] as? NSNumber)?.uint32Value ?? 1
    let cgOrientation = CGImagePropertyOrientation(rawValue: rawOrientation) ?? .up
    let oriented = CIImage(cgImage: cg).oriented(cgOrientation)

    // Raw mode (product labels): no segmentation/warp — just the upright
    // full-frame photo. The live overlay + readability hint already guided
    // the user; we don't want a deskewed doc-scanner crop here.
    if rawCapture {
      let r = BonVision.renderJPEG(ciImage: oriented)
      DispatchQueue.main.async { [weak self] in
        guard let self = self else { return }
        if let r = r { self.onCapture(r) } else { self.onError(["message": "capture_failed"]) }
      }
      return
    }

    // Lenient — the user is pointing at a bon and tapped; accept whatever
    // document fills the still (rectangle detector as fallback).
    let t = tuning
    let result: [String: Any]?
    let context = CIContext()
    if let uprightCG = context.createCGImage(oriented, from: oriented.extent) {
      let lenient = BonVision.DocParams(minConfidence: 0.0, minArea: 0.02, maxArea: 0.99, maxWHRatio: 3.0)
      let obs = BonVision.detectDocument(cgImage: uprightCG, params: lenient)
        ?? BonVision.detectRectangle(cgImage: uprightCG, params: t.rectFallbackParams())
      result = obs != nil
        ? BonVision.warpAndWriteJPEG(ciImage: oriented, observation: obs!)
        : BonVision.renderJPEG(ciImage: oriented)
    } else {
      result = BonVision.renderJPEG(ciImage: oriented)
    }

    DispatchQueue.main.async { [weak self] in
      guard let self = self else { return }
      if let r = result {
        self.onCapture(r)
      } else {
        self.onError(["message": "capture_failed"])
      }
    }
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
