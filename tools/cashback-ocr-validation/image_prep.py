"""
Image preprocessing for receipt OCR.

Three steps before sending the bon to OCR:
  1. EXIF rotation — phone photos often arrive rotated; OCR sees them
     sideways otherwise.
  2. Receipt boundary detection — find the 4 corners of the receipt
     in the photo (Canny + contour approximation).
  3. Perspective correction + crop — warp the bon to a flat
     rectangle, crop the background out.

All client-side, no API cost. Uses OpenCV.

Returns the processed image as bytes (JPEG-encoded) plus a
debug-info dict with the detected corner coordinates for visualization.
"""

from __future__ import annotations

import io
from dataclasses import dataclass
from typing import Optional

import cv2
import numpy as np
from PIL import Image, ImageOps


@dataclass
class PreprocessResult:
    output_bytes: bytes        # processed JPEG
    output_w: int
    output_h: int
    original_w: int
    original_h: int
    detected_corners: Optional[list[tuple[float, float]]]  # 4 (x, y) in original
    perspective_corrected: bool
    rotation_applied: int      # degrees CCW from EXIF
    sharpness_score: float     # higher = sharper. Used as a quality hint.
    notes: list[str]


# ---------------------------------------------------------------------------
# 1. EXIF rotation
# ---------------------------------------------------------------------------


def _apply_exif_rotation(pil_img: Image.Image) -> tuple[Image.Image, int]:
    """Apply EXIF orientation, return (rotated_image, degrees_applied)."""
    try:
        # Read EXIF orientation BEFORE PIL strips it
        exif = pil_img.getexif()
        orientation = exif.get(274, 1)  # 274 = Orientation tag
    except Exception:
        orientation = 1

    deg_map = {
        1: 0, 2: 0,  # normal / mirrored — no rotation
        3: 180, 4: 180,
        5: 90, 6: 270, 7: 270, 8: 90,
    }
    deg = deg_map.get(orientation, 0)

    rotated = ImageOps.exif_transpose(pil_img)
    return rotated, deg


# ---------------------------------------------------------------------------
# 2. Receipt boundary detection
# ---------------------------------------------------------------------------


def _detect_receipt_corners(img_cv: np.ndarray) -> Optional[np.ndarray]:
    """Find 4 corners of the receipt rectangle in the image.

    Approach:
      - Resize to fixed working width for stability
      - Grayscale + bilateral filter (preserve edges, smooth noise)
      - Canny edge detection
      - Find contours, sort by area
      - Look for largest 4-vertex polygon that takes >20% of image
    Returns array shape (4, 2) of (x, y) in ORIGINAL image coords, or None.
    """
    h0, w0 = img_cv.shape[:2]
    # Downscale for stability — find edges in a smaller image
    target_w = 800
    scale = target_w / float(w0)
    if scale < 1.0:
        small = cv2.resize(img_cv, (target_w, int(h0 * scale)))
    else:
        small = img_cv.copy()
        scale = 1.0

    gray = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY)
    gray = cv2.bilateralFilter(gray, 9, 75, 75)
    edges = cv2.Canny(gray, 50, 150)
    edges = cv2.dilate(edges, np.ones((3, 3), np.uint8), iterations=1)

    contours, _ = cv2.findContours(edges, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        return None

    contours = sorted(contours, key=cv2.contourArea, reverse=True)[:8]

    img_area = small.shape[0] * small.shape[1]

    for c in contours:
        peri = cv2.arcLength(c, True)
        approx = cv2.approxPolyDP(c, 0.02 * peri, True)

        if len(approx) == 4 and cv2.contourArea(c) > 0.20 * img_area:
            corners_small = approx.reshape(4, 2).astype(np.float32)
            # Scale back to original image coords
            corners_orig = corners_small / scale
            return corners_orig

    return None


def _order_corners(pts: np.ndarray) -> np.ndarray:
    """Return points ordered as [top-left, top-right, bottom-right, bottom-left]."""
    rect = np.zeros((4, 2), dtype=np.float32)
    s = pts.sum(axis=1)
    diff = np.diff(pts, axis=1).flatten()
    rect[0] = pts[np.argmin(s)]      # top-left = smallest x+y
    rect[2] = pts[np.argmax(s)]      # bottom-right = largest x+y
    rect[1] = pts[np.argmin(diff)]   # top-right = smallest y-x
    rect[3] = pts[np.argmax(diff)]   # bottom-left = largest y-x
    return rect


def _perspective_correct(img_cv: np.ndarray, corners: np.ndarray) -> np.ndarray:
    """Warp the quadrilateral defined by `corners` to a flat rectangle."""
    rect = _order_corners(corners)
    tl, tr, br, bl = rect

    # Output dimensions = max of opposing sides
    width_top = np.linalg.norm(tr - tl)
    width_bot = np.linalg.norm(br - bl)
    height_l = np.linalg.norm(bl - tl)
    height_r = np.linalg.norm(br - tr)
    out_w = int(max(width_top, width_bot))
    out_h = int(max(height_l, height_r))

    if out_w < 100 or out_h < 100:
        return img_cv  # too small, give up

    dst = np.array([
        [0, 0],
        [out_w - 1, 0],
        [out_w - 1, out_h - 1],
        [0, out_h - 1],
    ], dtype=np.float32)

    M = cv2.getPerspectiveTransform(rect, dst)
    return cv2.warpPerspective(img_cv, M, (out_w, out_h))


# ---------------------------------------------------------------------------
# 3. Sharpness heuristic
# ---------------------------------------------------------------------------


def _sharpness(img_cv: np.ndarray) -> float:
    """Variance-of-Laplacian: higher means sharper. <100 = blurry."""
    gray = cv2.cvtColor(img_cv, cv2.COLOR_BGR2GRAY)
    return float(cv2.Laplacian(gray, cv2.CV_64F).var())


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------


def preprocess(image_bytes: bytes, max_dim: int = 3500) -> PreprocessResult:
    """Run the full pipeline.

    DESIGN PRINCIPLE — non-destructive when possible:
      - If no transformation is needed (no rotation, no perspective fix,
        already <max_dim) → return ORIGINAL BYTES UNCHANGED. No re-encode,
        no quality loss. This avoids degrading OCR input when preprocessing
        has nothing useful to do.
      - If only EXIF rotation is needed → re-encode at quality 95 (light).
      - If perspective correction was applied → image already changed,
        re-encode at quality 95.
      - Resize cap is 3500px (was 2000) so item-text resolution survives.
        Thermal-receipt item lines are ~30-40px tall on phone photos;
        downsizing to 1500px halves that to 15-20px which DocAI/Gemini
        struggle with.

    Args:
      image_bytes: raw JPEG/PNG/HEIC bytes
      max_dim: cap the longer edge AFTER preprocessing (3500 default — only
               resize if image is larger).

    Returns PreprocessResult with output bytes (possibly identical to input).
    """
    notes: list[str] = []

    # Open via PIL (handles HEIC if pillow_heif is installed; else just JPG/PNG)
    pil = Image.open(io.BytesIO(image_bytes))
    pil = pil.convert("RGB")
    pil, deg = _apply_exif_rotation(pil)
    if deg:
        notes.append(f"EXIF rotation applied: {deg}°")

    original_w, original_h = pil.size
    img_cv = cv2.cvtColor(np.array(pil), cv2.COLOR_RGB2BGR)

    # Try to detect receipt corners and perspective-correct
    corners = _detect_receipt_corners(img_cv)
    perspective_corrected = False
    if corners is not None:
        try:
            warped = _perspective_correct(img_cv, corners)
            # Only accept the warp if it preserves at least 60% of the image
            # area — guards against mis-detecting a small inner rectangle
            # (e.g. the Summe-box) as the receipt boundary.
            warped_area = warped.shape[0] * warped.shape[1]
            orig_area = img_cv.shape[0] * img_cv.shape[1]
            if (warped.shape[0] >= 100 and warped.shape[1] >= 100
                    and warped_area >= 0.6 * orig_area):
                img_cv = warped
                perspective_corrected = True
                notes.append("Receipt corners detected — perspective-corrected")
            else:
                notes.append(
                    f"Detected corners cover only {warped_area/orig_area:.0%} "
                    "of image — likely a sub-region, skipping correction"
                )
                corners = None  # don't store potentially-bad corners
        except Exception as e:  # noqa: BLE001
            notes.append(f"Perspective correction failed: {e}")
            corners = None
    else:
        notes.append("No receipt corners detected — using full image as-is")

    # Cap dimensions (smaller image = fewer OCR tokens / faster)
    h, w = img_cv.shape[:2]
    needs_resize = max(h, w) > max_dim
    if needs_resize:
        scale = max_dim / float(max(h, w))
        img_cv = cv2.resize(img_cv, (int(w * scale), int(h * scale)),
                            interpolation=cv2.INTER_AREA)
        notes.append(f"Resized to fit max_dim={max_dim}")

    # Auto-rotate to portrait orientation.
    # Phone landscape photos of vertical receipts produce wide images where
    # the receipt text runs left-to-right. Cash-register receipts are
    # predominantly portrait (taller than wide), so if width > height we
    # rotate 90° CW to put the text upright.
    h, w = img_cv.shape[:2]
    rotated_to_portrait = False
    if w > h * 1.2:  # 1.2 threshold avoids nearly-square edge cases
        img_cv = cv2.rotate(img_cv, cv2.ROTATE_90_CLOCKWISE)
        rotated_to_portrait = True
        notes.append("Auto-rotated 90° CW to portrait orientation")

    # Sharpness check (informational, does not modify image)
    sharpness = _sharpness(img_cv)
    if sharpness < 100:
        notes.append(f"⚠ Low sharpness {sharpness:.0f} — may impact OCR")

    # ---------------------------------------------------------------
    # Decide whether to return original bytes or re-encode.
    # If we made NO destructive changes, return original. This preserves
    # the source quality entirely.
    # ---------------------------------------------------------------
    no_changes = (
        deg == 0
        and not perspective_corrected
        and not needs_resize
        and not rotated_to_portrait
    )
    if no_changes:
        notes.append("No transformation needed — original bytes preserved")
        return PreprocessResult(
            output_bytes=image_bytes,
            output_w=original_w,
            output_h=original_h,
            original_w=original_w,
            original_h=original_h,
            detected_corners=None,
            perspective_corrected=False,
            rotation_applied=0,
            sharpness_score=sharpness,
            notes=notes,
        )

    # Re-encode the modified image. Quality 95 to minimize artifacts.
    out_h, out_w = img_cv.shape[:2]
    ok, buf = cv2.imencode(".jpg", img_cv, [cv2.IMWRITE_JPEG_QUALITY, 95])
    if not ok:
        return PreprocessResult(
            output_bytes=image_bytes,
            output_w=original_w,
            output_h=original_h,
            original_w=original_w,
            original_h=original_h,
            detected_corners=None,
            perspective_corrected=False,
            rotation_applied=deg,
            sharpness_score=sharpness,
            notes=notes + ["JPEG encode failed, returning original bytes"],
        )

    return PreprocessResult(
        output_bytes=buf.tobytes(),
        output_w=out_w,
        output_h=out_h,
        original_w=original_w,
        original_h=original_h,
        detected_corners=[(float(c[0]), float(c[1])) for c in corners] if corners is not None else None,
        perspective_corrected=perspective_corrected,
        rotation_applied=deg,
        sharpness_score=sharpness,
        notes=notes,
    )
