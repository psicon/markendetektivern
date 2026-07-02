/**
 * Text-Patch (zwei Anliegen, ein Render-Hook):
 *
 * 1) GLOBALER maxFontSizeMultiplier-Deckel (BEIDE Plattformen, A11y).
 *    Die App hat überall FIXE Kartenhöhen. Ohne Deckel läuft schon bei
 *    Samsung/Xiaomi „Schrift größer" (~115 %) der Karten-Text über und
 *    schneidet ab. Wir deckeln das System-Schriftwachstum global bei
 *    DEFAULT_MAX_FONT_SCALE (1.3 = 130 %) — Text bleibt gut lesbar, aber
 *    sprengt die Layouts nicht mehr. Callsites können den Wert überschreiben
 *    (eigener `maxFontSizeMultiplier`) oder mit `allowFontScaling={false}`
 *    ganz abschalten; beides respektieren wir.
 *
 * 2) ANDROID Nunito-Font-Resolution (nur Android).
 *    React Native + Android wendet fontWeight NICHT auf custom Fonts an.
 *    `{ fontFamily: 'Nunito', fontWeight: '700' }` sucht eine Font „Nunito",
 *    findet keine (nur `Nunito_400Regular` … `Nunito_700Bold` sind geladen)
 *    und fällt still auf System-Default zurück. iOS resolvet das nativ
 *    korrekt. Der Patch resolvet `Nunito` + weight zur passenden
 *    Nunito_XXX-Variante und entfernt das (dann störende) fontWeight.
 *
 * Side-effect-import: in `app/_layout.tsx` ganz oben einmal importieren,
 * dann ist der Patch global aktiv.
 *
 * Forbidden Pattern Hinweis: Text.render zu patchen ist sonst meist ein
 * Anti-Pattern wegen RN-Version-Drift. Hier ist's der minimal-invasive Weg —
 * die Alternative (überall manuell `maxFontSizeMultiplier` + `<NunitoText>`
 * setzen) ist bei ~440 Callsites nicht praktikabel. Die Render-Signatur
 * (props, ref) ist ab RN 0.76+ stabil.
 *
 * Falls der Patch je durch ein RN-Upgrade bricht: Android-Texte rendern
 * wieder in System-Font und der Font-Scale-Deckel entfällt — die App
 * funktioniert weiter, nur Typo/Skalierung sind visuell nicht ideal.
 */

import { Platform, Text, TextInput, type StyleProp, type TextStyle } from 'react-native';
import {
  NUNITO_BOLD,
  NUNITO_MEDIUM,
  NUNITO_REGULAR,
  NUNITO_SEMIBOLD,
} from '@/constants/tokens/typography';

// Deckel für das System-Schriftwachstum (siehe Anliegen 1 oben).
const DEFAULT_MAX_FONT_SCALE = 1.3;

const isAndroid = Platform.OS === 'android';

// ─── Style-Flattening Helper ─────────────────────────────────────────
// RN-Styles können Arrays von Arrays/Objects sein. StyleSheet.flatten()
// liefert den final-resolved fontFamily/fontWeight.
const flatten = (style: StyleProp<TextStyle>): TextStyle => {
  // require statt static import — vermeidet Circular falls StyleSheet
  // selber irgendwann von dieser Datei abhängt.
  const StyleSheet = require('react-native').StyleSheet;
  return StyleSheet.flatten(style) || {};
};

const resolveNunito = (weight?: TextStyle['fontWeight']): string => {
  const w = String(weight ?? '');
  if (w === 'bold' || w === '700' || w === '800' || w === '900') return NUNITO_BOLD;
  if (w === '600') return NUNITO_SEMIBOLD;
  if (w === '500') return NUNITO_MEDIUM;
  return NUNITO_REGULAR;
};

// Cache der Resolutions — spart bei dichten Listen (Stöbern: 1000+ Renders).
const cache = new Map<string, string>();
const resolveCached = (weight?: TextStyle['fontWeight']): string => {
  const key = String(weight ?? '');
  let v = cache.get(key);
  if (!v) {
    v = resolveNunito(weight);
    cache.set(key, v);
  }
  return v;
};

// ─── Render-Patch (Text + TextInput) ─────────────────────────────────
type AnyComponent = any;
const patchRender = (Component: AnyComponent, name: string) => {
  const originalRender = Component.render;
  if (!originalRender) {
    console.warn(`[androidTextFontPatch] ${name}.render unavailable — skipping`);
    return;
  }
  // WICHTIG (RN 0.79): Wir modifizieren die INPUT-Props (das `style`/die Props
  // die an Text/TextInput übergeben werden), NICHT das gerenderte Output-
  // Element. Ab RN 0.76+ destrukturiert Text seinen `style`, sodass der User-
  // Style nicht mehr auf `element.props.style` liegt. Input-Modifikation ist
  // version-robust: die forwardRef-Render-Signatur ist (props, ref).
  Component.render = function patchedRender(props: any, ref: any) {
    if (props) {
      // (1) Cross-Platform: globaler maxFontSizeMultiplier-Deckel. Nur setzen
      // wenn die Callsite nichts eigenes vorgibt UND Font-Scaling nicht
      // explizit abgeschaltet ist.
      if (
        props.maxFontSizeMultiplier == null &&
        props.allowFontScaling !== false
      ) {
        props = { ...props, maxFontSizeMultiplier: DEFAULT_MAX_FONT_SCALE };
      }

      // (2) Nur Android: Nunito-fontWeight-Resolution.
      if (isAndroid && props.style) {
        const flat = flatten(props.style);
        const fam = flat.fontFamily;
        if (fam === 'Nunito') {
          // (a) bare 'Nunito' → passende geladene Variante, Weight weg.
          const resolved = resolveCached(flat.fontWeight);
          if (resolved !== 'Nunito') {
            const next: any = { ...flat, fontFamily: resolved };
            delete next.fontWeight;
            props = { ...props, style: next };
          }
        } else if (
          typeof fam === 'string' &&
          fam.indexOf('Nunito_') === 0 &&
          flat.fontWeight != null
        ) {
          // (b) bereits explizite Variante ABER mit fontWeight daneben →
          // Weight droppen, sonst greift derselbe Mismatch-Fallback.
          const next: any = { ...flat };
          delete next.fontWeight;
          props = { ...props, style: next };
        }
      }
    }
    return originalRender.call(this, props, ref);
  };
};

patchRender(Text, 'Text');
patchRender(TextInput, 'TextInput');

// no-op default export — Datei wird via side-effect-import benutzt.
export {};
