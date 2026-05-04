import ExpoModulesCore
import Vision
import CoreImage
import UIKit

/**
 * BonEdgeDetectorModule
 *
 * Auto-detects the document quadrilateral in a static image and
 * returns a perspective-corrected, cropped JPEG URI.
 *
 * Pipeline:
 *   1. Load the input image (URI or file path)
 *   2. VNDetectRectanglesRequest finds the largest plausible rect
 *      (configured for receipts: aspect ratio 0.2-1.0, min size 0.2)
 *   3. CIPerspectiveCorrection warps the four detected corners into
 *      a rectangle (axis-aligned)
 *   4. Output written as JPEG to the cache dir; return the file URI
 *
 * Returns:
 *   - { uri, width, height } on success
 *   - null when no document quad is found (caller falls back to
 *     manual crop)
 */
public class BonEdgeDetectorModule: Module {
  public func definition() -> ModuleDefinition {
    Name("BonEdgeDetector")

    AsyncFunction("detectAndCropDocument") { (uri: String, promise: Promise) in
      DispatchQueue.global(qos: .userInitiated).async {
        do {
          let result = try Self.detectAndCrop(uri: uri)
          promise.resolve(result)
        } catch {
          // Resolve null instead of rejecting — caller treats null as
          // "no detection, use manual crop" which is the same fallback
          // path as a thrown error. Keeping the Promise type clean.
          promise.resolve(nil)
        }
      }
    }
  }

  // MARK: - Detection + warp

  private static func detectAndCrop(uri: String) throws -> [String: Any]? {
    guard let inputImage = loadCIImage(from: uri) else {
      return nil
    }

    let cgImage = renderCGImage(from: inputImage)
    guard let cg = cgImage else { return nil }

    let request = VNDetectRectanglesRequest()
    request.minimumAspectRatio = 0.2 // bons are tall (≈0.25 width:height)
    request.maximumAspectRatio = 1.0
    request.minimumSize = 0.2 // at least 20% of image bounds
    request.maximumObservations = 4
    request.minimumConfidence = 0.6
    request.quadratureTolerance = 25.0 // up to 25° off-square

    let handler = VNImageRequestHandler(cgImage: cg, orientation: .up, options: [:])
    try handler.perform([request])

    guard
      let rectangles = request.results as? [VNRectangleObservation],
      let rect = pickBestRectangle(rectangles)
    else {
      return nil
    }

    // VNRectangleObservation corners are normalized 0..1 with origin
    // BOTTOM-LEFT (Vision coordinate system). CIPerspectiveCorrection
    // expects pixel-space points with origin BOTTOM-LEFT (Core Image
    // coordinate system, same handedness). So we just multiply by
    // image extent.
    let extent = inputImage.extent
    let toPixel = { (p: CGPoint) -> CGPoint in
      CGPoint(x: p.x * extent.width, y: p.y * extent.height)
    }

    let topLeft = toPixel(rect.topLeft)
    let topRight = toPixel(rect.topRight)
    let bottomLeft = toPixel(rect.bottomLeft)
    let bottomRight = toPixel(rect.bottomRight)

    guard let filter = CIFilter(name: "CIPerspectiveCorrection") else {
      return nil
    }
    filter.setValue(inputImage, forKey: kCIInputImageKey)
    filter.setValue(CIVector(cgPoint: topLeft), forKey: "inputTopLeft")
    filter.setValue(CIVector(cgPoint: topRight), forKey: "inputTopRight")
    filter.setValue(CIVector(cgPoint: bottomLeft), forKey: "inputBottomLeft")
    filter.setValue(CIVector(cgPoint: bottomRight), forKey: "inputBottomRight")

    guard let outputImage = filter.outputImage else { return nil }

    let context = CIContext()
    guard let outCG = context.createCGImage(outputImage, from: outputImage.extent) else {
      return nil
    }

    let outImage = UIImage(cgImage: outCG)
    guard let jpegData = outImage.jpegData(compressionQuality: 0.9) else {
      return nil
    }

    let dir = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
    let filename = "bon-cropped-\(UUID().uuidString).jpg"
    let outURL = dir.appendingPathComponent(filename)
    try jpegData.write(to: outURL, options: .atomic)

    return [
      "uri": outURL.absoluteString,
      "width": Int(outCG.width),
      "height": Int(outCG.height)
    ]
  }

  /// Pick the highest-confidence rectangle; on ties prefer the largest area.
  private static func pickBestRectangle(_ list: [VNRectangleObservation]) -> VNRectangleObservation? {
    return list.max(by: { lhs, rhs in
      if abs(lhs.confidence - rhs.confidence) > 0.01 {
        return lhs.confidence < rhs.confidence
      }
      return lhs.boundingBox.area < rhs.boundingBox.area
    })
  }

  private static func loadCIImage(from uri: String) -> CIImage? {
    if let url = URL(string: uri), let img = CIImage(contentsOf: url) {
      return img
    }
    // Strip "file://" prefix and retry as path
    let path: String
    if uri.hasPrefix("file://") {
      path = String(uri.dropFirst("file://".count))
    } else {
      path = uri
    }
    let url = URL(fileURLWithPath: path)
    return CIImage(contentsOf: url)
  }

  private static func renderCGImage(from ciImage: CIImage) -> CGImage? {
    let context = CIContext()
    return context.createCGImage(ciImage, from: ciImage.extent)
  }
}

private extension CGRect {
  var area: CGFloat { width * height }
}
