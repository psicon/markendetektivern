package expo.modules.bonedgedetector

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Android stub. Always resolves to null so the JS layer falls back to
 * the manual crop screen. Real implementation could ship later via
 * Google ML Kit's Image Labeling + edge detection or a ported OpenCV
 * call — see iOS module for the contract.
 */
class BonEdgeDetectorModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("BonEdgeDetector")

    AsyncFunction("detectAndCropDocument") { _: String -> null as String? }
  }
}
