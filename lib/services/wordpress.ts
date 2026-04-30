/**
 * WordPress API Service für markendetektive.de/blog
 */

export interface WordPressPost {
  id: number;
  date: string;
  title: {
    rendered: string;
  };
  content: {
    rendered: string;
  };
  excerpt: {
    rendered: string;
  };
  link: string;
  featured_media: number;
  featured_image_url?: string;
  _embedded?: {
    'wp:featuredmedia'?: Array<{
      id: number;
      source_url: string;
      alt_text: string;
      media_details: {
        width: number;
        height: number;
        sizes: {
          [key: string]: {
            source_url: string;
            width: number;
            height: number;
          };
        };
      };
    }>;
  };
}

export interface WordPressApiResponse {
  posts: WordPressPost[];
  total: number;
  totalPages: number;
}

// ─── In-memory news cache ────────────────────────────────────────
//
// The home tab fetches WordPress posts on every mount. The blog
// updates a few times per week — refetching every tab focus is
// wasteful and shows up as a slow "Neuigkeiten" skeleton on what
// should be an instant render. 5-min TTL keeps the section
// near-instant on revisits without serving stale content for long.
const NEWS_CACHE_TTL_MS = 5 * 60 * 1000;
// Hartes Request-Timeout als Schutz gegen "ewig hängenden" Fetch.
// Wenn die WordPress-API hängt (Server tot, DNS-Stall, Netzwerk weg),
// würde der News-Skeleton sonst auf dem Home-Tab dauerhaft drehen.
// 25 s sind großzügig genug, damit die API auch unter Last (mehrere
// User parallel, Cold-Start am Hosting) durchkommt, und kurz genug,
// dass der Empty-State irgendwann sichtbar wird statt nie. Wenn die
// Antwort nach 25 s noch nicht da ist, ist die API faktisch unverfügbar
// und wir sollten den Empty-State zeigen.
const NEWS_REQUEST_TIMEOUT_MS = 25_000;
type NewsCacheEntry = { value: WordPressApiResponse; expiresAt: number };
const newsCache = new Map<string, NewsCacheEntry>();
const newsInflight = new Map<string, Promise<WordPressApiResponse>>();

class WordPressService {
  private readonly baseUrl = 'https://markendetektive.de/wp-json/wp/v2';

  /**
   * Holt die neuesten Blog-Posts (5-min in-memory cache).
   */
  async getLatestPosts(limit: number = 5): Promise<WordPressApiResponse> {
    return this.getLatestPostsPaginated(limit, 1);
  }

  /**
   * Holt Blog-Posts mit Pagination
   */
  async getLatestPostsPaginated(limit: number = 5, page: number = 1): Promise<WordPressApiResponse> {
    const cacheKey = `${limit}:${page}`;

    // Cache hit
    const hit = newsCache.get(cacheKey);
    if (hit && Date.now() < hit.expiresAt) return hit.value;

    // Inflight de-dup (parallel callers share one network round-trip)
    const inflight = newsInflight.get(cacheKey);
    if (inflight) return inflight;

    const promise = (async () => {
      // AbortController + setTimeout-basiertes Hard-Timeout.
      // `signal` wird an `fetch` übergeben — bei Timeout wird die
      // laufende Connection sauber abgebrochen, RN gibt den Socket
      // frei und der `await` wirft einen AbortError, den wir unten
      // gleich wie jeden anderen Fehler behandeln.
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), NEWS_REQUEST_TIMEOUT_MS);
      try {
        const response = await fetch(
          `${this.baseUrl}/posts?per_page=${limit}&page=${page}&_embed=wp:featuredmedia&status=publish&orderby=date&order=desc`,
          {
            method: 'GET',
            headers: {
              'Accept': 'application/json',
              'Content-Type': 'application/json',
            },
            signal: controller.signal,
          }
        );

        if (!response.ok) {
          throw new Error(`WordPress API error: ${response.status} ${response.statusText}`);
        }

        const posts: WordPressPost[] = await response.json();

        // Extrahiere Featured Images
        const postsWithImages = posts.map(post => ({
          ...post,
          featured_image_url: this.extractFeaturedImageUrl(post)
        }));

        const result: WordPressApiResponse = {
          posts: postsWithImages,
          total: parseInt(response.headers.get('X-WP-Total') || '0'),
          totalPages: parseInt(response.headers.get('X-WP-TotalPages') || '0')
        };
        newsCache.set(cacheKey, { value: result, expiresAt: Date.now() + NEWS_CACHE_TTL_MS });
        return result;
      } catch (error: any) {
        // AbortError != echter Fehler — nur freundlicher Warn, damit
        // der Crashlytics-Stream nicht volläuft, wenn WP-API mal
        // 5+ Sekunden braucht.
        if (error?.name === 'AbortError') {
          console.warn(
            `⏱️ WordPress posts fetch timed out after ${NEWS_REQUEST_TIMEOUT_MS}ms — section will show empty state`,
          );
        } else {
          console.error('❌ Error fetching WordPress posts:', error);
        }
        throw error;
      } finally {
        clearTimeout(timeoutId);
        newsInflight.delete(cacheKey);
      }
    })();

    newsInflight.set(cacheKey, promise);
    return promise;
  }

  /**
   * Extrahiert die Featured Image URL aus dem Post
   */
  private extractFeaturedImageUrl(post: WordPressPost): string | undefined {
    // Versuche zuerst _embedded
    if (post._embedded?.['wp:featuredmedia']?.[0]) {
      const media = post._embedded['wp:featuredmedia'][0];
      
      // Bevorzuge medium_large oder medium für bessere Performance
      if (media.media_details?.sizes?.medium_large) {
        return media.media_details.sizes.medium_large.source_url;
      }
      
      if (media.media_details?.sizes?.medium) {
        return media.media_details.sizes.medium.source_url;
      }
      
      // Fallback auf full size
      return media.source_url;
    }
    
    return undefined;
  }

  /**
   * Bereinigt HTML aus WordPress Content
   */
  static cleanHtml(html: string): string {
    return html
      .replace(/<[^>]*>/g, '') // Entferne HTML Tags
      .replace(/&nbsp;/g, ' ') // Ersetze &nbsp;
      .replace(/&amp;/g, '&') // Ersetze &amp;
      .replace(/&lt;/g, '<') // Ersetze &lt;
      .replace(/&gt;/g, '>') // Ersetze &gt;
      .replace(/&quot;/g, '"') // Ersetze &quot;
      .replace(/&#8217;/g, "'") // Ersetze &#8217;
      .replace(/&#8220;/g, '"') // Ersetze &#8220;
      .replace(/&#8221;/g, '"') // Ersetze &#8221;
      .trim();
  }

  /**
   * Formatiert das Datum für die Anzeige
   */
  static formatDate(dateString: string): string {
    const date = new Date(dateString);
    const now = new Date();
    const diffTime = Math.abs(now.getTime() - date.getTime());
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    if (diffDays === 1) {
      return 'Gestern';
    } else if (diffDays < 7) {
      return `vor ${diffDays} Tagen`;
    } else if (diffDays < 30) {
      const weeks = Math.floor(diffDays / 7);
      return `vor ${weeks} Woche${weeks > 1 ? 'n' : ''}`;
    } else {
      return date.toLocaleDateString('de-DE', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric'
      });
    }
  }
}

export { WordPressService };
export default WordPressService;
