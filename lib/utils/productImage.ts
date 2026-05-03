/**
 * Product-image accessor — single source of truth for which image
 * URL to render for a given product.
 *
 * Three cleaned variants are produced by the image-cleanup pipeline
 * (see `cloud-functions/image-cleanup/`):
 *   • `bildClean`     — WebP, ≤ 512 px long-side. App-default. Smallest
 *                        file size, fastest network load. Use for all
 *                        list / card / grid / search-result renders.
 *   • `bildCleanPng`  — PNG, ≤ 1024 px. Higher quality, larger file.
 *                        Use for detail-screen heroes where the
 *                        product is shown big.
 *   • `bildCleanHq`   — PNG, ≤ 1600 px. Highest quality, biggest file.
 *                        Reference / archival quality. Rarely used in
 *                        the live app.
 *
 * The helper always falls back to the original `bild` URL when the
 * requested variant isn't yet available (during backfill, or if the
 * pipeline failed for that product). Old app builds keep reading
 * `bild` directly — they're unaffected.
 *
 * Variants:
 *   getProductImage(p)            → app WebP, fallback `bild`
 *   getProductImage(p, 'app')     → same
 *   getProductImage(p, 'png')     → png 1024, fallback app, fallback bild
 *   getProductImage(p, 'hq')      → hq 1600,  fallback png, fallback app, fallback bild
 *
 * Loose `any` typing on purpose — the helper is called from places
 * that hold partial product shapes (search results, top-products
 * aggregator items, etc.) where the full Produkte/MarkenProdukte
 * interfaces aren't available.
 */
export type ProductImageVariant = 'app' | 'png' | 'hq';

export function getProductImage(
  product:
    | {
        bildClean?: string | null;
        bildCleanPng?: string | null;
        bildCleanHq?: string | null;
        bild?: string | null;
      }
    | null
    | undefined,
  variant: ProductImageVariant = 'app',
): string | null {
  if (!product) return null;
  // Build the preference chain for the requested variant. Each chain
  // falls back to a smaller variant first, then to the original.
  const ok = (s: unknown): s is string =>
    typeof s === 'string' && s.length > 0;
  const { bildClean, bildCleanPng, bildCleanHq, bild } = product;
  const chain: Array<string | null | undefined> =
    variant === 'hq'
      ? [bildCleanHq, bildCleanPng, bildClean, bild]
      : variant === 'png'
        ? [bildCleanPng, bildClean, bild]
        : [bildClean, bild];
  for (const url of chain) {
    if (ok(url)) return url;
  }
  return null;
}
