import ExpoModulesCore
import AVFoundation
import Vision
import CoreImage
import UIKit

/// Runtime-tunable scanner parameters (passed live from JS so the open
/// scanner can be tuned without a rebuild). Defaults = the shipped values.
struct ScannerTuning: Record {
  // Document-segmentation confidence floors (primary detector).
  @Field var liveMinConfidence: Double = 0.3
  @Field var captureMinConfidence: Double = 0.3
  @Field var persistenceFrames: Int = 50
  @Field var visionHz: Double = 20
  @Field var smoothing: Double = 0.5
  // Rectangle-detector fallback params (not surfaced in the panel).
  @Field var minAspect: Double = 0.2
  @Field var maxAspect: Double = 1.0
  @Field var minSize: Double = 0.2
  @Field var quadratureTolerance: Double = 25
  @Field var maxObservations: Int = 6

  func liveParams() -> BonVision.RectParams {
    BonVision.RectParams(
      minConfidence: Float(liveMinConfidence),
      minAspect: Float(minAspect),
      maxAspect: Float(maxAspect),
      minSize: Float(minSize),
      quadratureTolerance: Float(quadratureTolerance),
      maxObservations: maxObservations
    )
  }

  func captureParams() -> BonVision.RectParams {
    var p = liveParams()
    p.minConfidence = Float(captureMinConfidence)
    return p
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
public class BonScannerView: ExpoView, AVCaptureVideoDataOutputSampleBufferDelegate {

  // ── JS events ──────────────────────────────────────────────────────
  let onCapture = EventDispatcher()
  let onError = EventDispatcher()
  let onEdgesDetected = EventDispatcher()

  // ── Capture stack ──────────────────────────────────────────────────
  private let session = AVCaptureSession()
  private var previewLayer: AVCaptureVideoPreviewLayer!
  private let videoOutput = AVCaptureVideoDataOutput()
  private let overlayLayer = CAShapeLayer()
  private var device: AVCaptureDevice?

  private let sessionQueue = DispatchQueue(label: "bon.scanner.session")
  private let videoQueue = DispatchQueue(label: "bon.scanner.video", qos: .userInitiated)

  private var configured = false
  private var wantActive = false
  private var lastSignal = 0
  private var pendingCapture = false

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

  /// JS bumps an incrementing signal to request a capture. We grab the
  /// next delivered frame (guarantees a valid pixel buffer) and warp it.
  func requestCapture(signal: Int) {
    guard signal > 0, signal != lastSignal else { return }
    lastSignal = signal
    pendingCapture = true
  }

  // ── Session configuration ─────────────────────────────────────────
  private func configureIfNeeded() {
    sessionQueue.async { [weak self] in
      guard let self = self, !self.configured else { return }
      self.session.beginConfiguration()
      self.session.sessionPreset = .photo

      guard
        let dev = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .back),
        let input = try? AVCaptureDeviceInput(device: dev),
        self.session.canAddInput(input)
      else {
        self.session.commitConfiguration()
        DispatchQueue.main.async { self.onError(["message": "camera_unavailable"]) }
        return
      }
      self.device = dev
      self.session.addInput(input)

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

    if pendingCapture {
      pendingCapture = false
      handleCapture(pixelBuffer: pixelBuffer)
      return
    }

    let t = tuning
    let now = CACurrentMediaTime()
    if now - lastVisionTime < 1.0 / max(t.visionHz, 1.0) { return }
    lastVisionTime = now

    let bufW = CGFloat(CVPixelBufferGetWidth(pixelBuffer))
    let bufH = CGFloat(CVPixelBufferGetHeight(pixelBuffer))
    // ML document segmenter: returns exactly one document, no
    // logo/barcode/table false-positives to disambiguate.
    let obs = BonVision.detectDocument(
      pixelBuffer: pixelBuffer,
      minConfidence: VNConfidence(t.liveMinConfidence)
    )
    DispatchQueue.main.async { [weak self] in
      self?.updateOverlay(obs, bufferW: bufW, bufferH: bufH)
    }
  }

  // ── Capture: warp the frozen frame flat ────────────────────────────
  private func handleCapture(pixelBuffer: CVPixelBuffer) {
    let ciImage = CIImage(cvPixelBuffer: pixelBuffer)
    let t = tuning
    // Same ML segmenter as the live overlay (rectangle detector as
    // fallback) so the crop matches what the user saw marked.
    let obs = BonVision.detectDocument(
      pixelBuffer: pixelBuffer,
      minConfidence: VNConfidence(t.captureMinConfidence)
    ) ?? BonVision.detectRectangle(pixelBuffer: pixelBuffer, params: t.captureParams())
    let result: [String: Any]?
    if let obs = obs {
      result = BonVision.warpAndWriteJPEG(ciImage: ciImage, observation: obs)
    } else {
      // No clear quad → ship the raw (upright) frame; OCR copes.
      result = BonVision.renderJPEG(ciImage: ciImage)
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
