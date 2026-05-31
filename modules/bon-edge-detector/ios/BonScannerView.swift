import ExpoModulesCore
import AVFoundation
import Vision
import CoreImage
import UIKit

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

  // Vision throttle for the live overlay (capture is unthrottled).
  private var lastVisionTime: CFTimeInterval = 0
  private let visionInterval: CFTimeInterval = 0.1 // ~10 Hz

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
    sessionQueue.async { [session] in
      if session.isRunning { session.stopRunning() }
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

    let now = CACurrentMediaTime()
    if now - lastVisionTime < visionInterval { return }
    lastVisionTime = now

    let obs = BonVision.detectRectangle(pixelBuffer: pixelBuffer)
    DispatchQueue.main.async { [weak self] in self?.updateOverlay(obs) }
  }

  // ── Capture: warp the frozen frame flat ────────────────────────────
  private func handleCapture(pixelBuffer: CVPixelBuffer) {
    let ciImage = CIImage(cvPixelBuffer: pixelBuffer)
    let obs = BonVision.detectRectangle(pixelBuffer: pixelBuffer)
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
  private func updateOverlay(_ obs: VNRectangleObservation?) {
    guard let obs = obs else {
      framesWithoutQuad += 1
      if framesWithoutQuad > 5 {
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

    // Vision normalized (origin bottom-left) → AVF metadata (origin
    // top-left): flip Y. layerPointConverted then handles gravity.
    let raw = [obs.topLeft, obs.topRight, obs.bottomRight, obs.bottomLeft].map { p -> CGPoint in
      let meta = CGPoint(x: p.x, y: 1 - p.y)
      return previewLayer.layerPointConverted(fromCaptureDevicePoint: meta)
    }

    let pts: [CGPoint]
    if let prev = smoothed, prev.count == raw.count {
      pts = zip(prev, raw).map { CGPoint(x: $0.x * 0.5 + $1.x * 0.5, y: $0.y * 0.5 + $1.y * 0.5) }
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
