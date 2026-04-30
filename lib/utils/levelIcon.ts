import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';

/**
 * Maps the Firestore-stored Level icon name (which uses SF-symbol-
 * style strings like "pawprint.fill", "rosette") to the matching
 * MaterialCommunityIcons glyph. Single source of truth so the home-
 * tab level card and the Errungenschaften screen render the same
 * icon for the same level.
 */
export function mdiForLevelIcon(
  name: string | undefined | null,
): keyof typeof MaterialCommunityIcons.glyphMap {
  if (!name) return 'medal-outline';
  const n = name.toLowerCase();
  if (n.includes('paw')) return 'paw';
  if (n.includes('trophy')) return 'trophy';
  if (n.includes('star')) return 'star';
  if (n.includes('crown')) return 'crown';
  if (n.includes('lightbulb') || n.includes('bulb')) return 'lightbulb';
  if (n.includes('bookmark')) return 'bookmark';
  if (n.includes('rosette') || n.includes('badge')) return 'medal';
  if (n.includes('flame') || n.includes('fire')) return 'fire';
  return 'medal-outline';
}

/**
 * Two-stop gradient for a level. Combines the level's primary
 * (`baseColor`, from the Firestore Level config) with a second tone
 * that varies by level ID — same mapping the legacy /achievements
 * screen used so users see consistent colour identity for the
 * same level across the app.
 *
 *   Lvl 1 → primary → Braun  (#9E6B50)
 *   Lvl 2 → primary → Orange (#FF9800)
 *   Lvl 3 → primary → Grün   (#4CAF50)
 *   Lvl 4 → primary → Gold   (#FFC107)
 *   Lvl 5 → primary → Rot    (#FF5252)
 *   6+   → primary → Braun
 *
 * Falls back to a neutral teal pair if no base colour is provided.
 */
export function levelGradient(
  levelId: number,
  baseColor?: string | null,
): [string, string] {
  const fallback: [string, string] = ['#0a6f62', '#10a18a'];
  if (!baseColor) return fallback;
  switch (levelId) {
    case 1: return [baseColor, '#9E6B50'];
    case 2: return [baseColor, '#FF9800'];
    case 3: return [baseColor, '#4CAF50'];
    case 4: return [baseColor, '#FFC107'];
    case 5: return [baseColor, '#FF5252'];
    default: return [baseColor, '#9E6B50'];
  }
}

/**
 * Diagonal start/end points used app-wide for level gradients.
 * Same vector as `CurrentLevelHero` in the Errungenschaften screen
 * so the visual feel matches everywhere.
 */
export const LEVEL_GRADIENT_START = { x: -1, y: 0.34 };
export const LEVEL_GRADIENT_END = { x: 1, y: -0.34 };
