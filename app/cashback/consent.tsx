/**
 * Cashback consent — gate before any Bon upload.
 *
 * Design intent: pitch the value first ("hier kommt Geld zurück"),
 * walk through the 3-step flow visually, THEN cover the legal
 * minimums in a compact bullet list. Keeps users from bouncing on
 * a wall of DSGVO text.
 *
 * If consent is already valid (current version + recorded), the
 * mount effect routes straight to /cashback/capture so this screen
 * shows up exactly once.
 */

import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useLocalSearchParams, useNavigation } from 'expo-router';
import { safePush } from '@/lib/utils/safeNav';
import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  ActivityIndicator,
  Alert,
  AppState,
  Image,
  type ImageSourcePropType,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as WebBrowser from 'expo-web-browser';

import {
  DETAIL_HEADER_ROW_HEIGHT,
  DetailHeader,
} from '@/components/design/DetailHeader';
import { fontFamily, fontWeight } from '@/constants/tokens';
import { useTokens } from '@/hooks/useTokens';
import { useAuth } from '@/lib/contexts/AuthContext';
import {
  acceptCashbackConsent,
  getCashbackConfig,
  hasValidCashbackConsent,
} from '@/lib/services/cashbackService';
import { standortAnfordern, standortStatus } from '@/lib/services/captureContext';
import { consentService } from '@/lib/services/consentService';

const PRIVACY_URL = 'https://markendetektive.de/datenschutz';
const TERMS_URL = 'https://markendetektive.de/agb';

// Drei Anzeige-Varianten desselben (EINEN) Cashback-Consents — je nachdem,
// aus welchem Verdien-Flow der User kommt (ClickUp 86cagb5gh): Bons (Default),
// Produktbilder, Umfragen. Rechtlich ist es dieselbe Einwilligung
// (users/{uid}.cashback_consent, eine Version) — nur Hero + Steps + CTA
// sprechen die jeweilige Aktion an, damit "Bons" nicht in einem
// Produktbilder-/Umfragen-Kontext steht.
type ConsentVariant = 'receipt' | 'product' | 'survey';

// Three-step "so einfach" flow — numbered circles + crisp labels.
// Concrete (not "wie magisch"), but the magic of the auto-OCR is the
// hero, so middle step is a tiny aha-moment.
// T17.29: "So einfach geht's"-Steps mit klarer Zeitachse — User wollte
// wissen "wann bekomme ich was?". Schritt 1+2 sind Aktionen, Schritt 3
// die Belohnung. Mit Hinweis dass Cashback automatisch gutgeschrieben
// wird sobald der Bon geprüft ist (meist Minuten).
const PRAEMIEN_STEP = {
  icon: 'gift-outline',
  title: 'Attraktive Prämien & Gutscheine',
  sub: 'Ab 10 € einlösen — Gutschein deiner Wahl oder Auszahlung aufs Konto',
};

const STEPS_BY_VARIANT: Record<ConsentVariant, { icon: string; title: string; sub: string }[]> = {
  receipt: [
    {
      icon: 'camera-outline',
      title: 'Foto vom Bon machen',
      sub: 'Direkt nach dem Einkauf',
    },
    {
      icon: 'auto-fix',
      title: 'Cashback wird gutgeschrieben',
      sub: 'Sobald der Bon geprüft ist — meist in wenigen Minuten',
    },
    PRAEMIEN_STEP,
  ],
  product: [
    {
      icon: 'camera-outline',
      title: 'Produkt im Markt fotografieren',
      sub: 'Ein paar Fotos direkt am Regal — die App führt dich durch',
    },
    {
      icon: 'auto-fix',
      title: 'Cashback wird gutgeschrieben',
      sub: 'Sobald dein Datensatz geprüft ist',
    },
    PRAEMIEN_STEP,
  ],
  survey: [
    {
      icon: 'message-question-outline',
      title: 'Umfrage beantworten',
      sub: 'Direkt in der App — in wenigen Minuten erledigt',
    },
    {
      icon: 'auto-fix',
      title: 'Cashback wird gutgeschrieben',
      sub: 'Direkt nach dem Absenden',
    },
    PRAEMIEN_STEP,
  ],
};

// Hero-Copy pro Variante. Produkt-Wortlaut ist User-Vorgabe (86cagb5gh):
// "Hol dir Geld für echte Detektivarbeit und unterstütze uns beim
// Enttarnen neuer Produkte." `bodyBold` wird im Body fett hervorgehoben.
const HERO_BY_VARIANT: Record<
  ConsentVariant,
  { eyebrow: string; title: string; bodyPre: string; bodyBold: string; bodyPost: string }
> = {
  receipt: {
    eyebrow: 'Geld zurück fürs Einkaufen',
    title: 'Hol dir Geld für deine Bons',
    // Keine hardcodierten Konditionen (Cent-Beträge, Wochen-Limits) — die
    // sind config-/aktionsgetrieben und würden hier veralten. Einzige
    // stabile Aussage: bis zu 1 € pro Bon (User-Vorgabe 2026-06-10).
    bodyPre: 'Bon fotografieren, hochladen und ',
    bodyBold: 'bis zu 1 € pro Bon',
    bodyPost: ' sichern — die aktuellen Aktionen siehst du in der App.',
  },
  product: {
    eyebrow: 'Geld für Detektivarbeit',
    title: 'Hol dir Geld für echte Detektivarbeit',
    bodyPre: 'Unterstütze uns beim ',
    bodyBold: 'Enttarnen neuer Produkte',
    bodyPost: ' — fotografiere Produkte im Markt und sichere dir die Prämie der aktuellen Aktion.',
  },
  survey: {
    eyebrow: 'Geld für deine Meinung',
    title: 'Hol dir Geld für deine Antworten',
    bodyPre: 'Kurze Umfrage beantworten und ',
    bodyBold: 'Cashback sichern',
    bodyPost: ' — die aktuellen Umfragen siehst du in der App.',
  },
};

// Prämien-Katalog für den Auto-Marquee unter Schritt 3. `image` ist
// optional vorbereitet: sobald echte Logo-Assets definiert sind
// (kleine PNGs, ~32×32), hier eintragen — der Chip rendert dann das
// Bild statt des Icons. Bis dahin Icon + Label. Reihenfolge =
// Anzeige-Reihenfolge im Loop. "Oder spenden ❤" gehört bewusst dazu
// (User-Vorgabe 2026-06-10).
const REWARDS: {
  key: string;
  label: string;
  icon: string;
  image?: ImageSourcePropType;
  /** Abweichende Render-Größe für Wortmarken (Default 30×30). */
  imageWidth?: number;
  imageHeight?: number;
  /** Einkaufsgutschein-Partner → kleines schräges Ticket-Badge überm Logo. */
  voucher?: boolean;
}[] = [
  {
    key: 'rewe',
    label: 'REWE',
    icon: 'cart-outline',
    image: require('@/assets/rewards/rewe.png'),
    voucher: true,
  },
  {
    key: 'kaufland',
    label: 'Kaufland',
    icon: 'cart-outline',
    image: require('@/assets/rewards/kaufland.png'),
    voucher: true,
  },
  {
    key: 'rossmann',
    label: 'Rossmann',
    icon: 'cart-outline',
    image: require('@/assets/rewards/rossmann.png'),
    voucher: true,
  },
  {
    key: 'amazon',
    label: 'Amazon',
    icon: 'shopping-outline',
    image: require('@/assets/rewards/amazon.png'),
    voucher: true,
  },
  {
    // Wortmarke sagt schon "VISA" — Label ergänzt nur "Prepaid".
    key: 'visa',
    label: 'VISA Prepaid',
    icon: 'credit-card-outline',
    image: require('@/assets/rewards/visa.png'),
    imageWidth: 52,
    imageHeight: 17,
  },
  {
    key: 'paypal',
    label: 'PayPal',
    icon: 'wallet-outline',
    image: require('@/assets/rewards/paypal.png'),
  },
  { key: 'bank', label: 'Bankkonto', icon: 'bank-outline' },
  { key: 'spende', label: 'Oder spenden', icon: 'hand-heart-outline' },
  { key: 'mehr', label: 'und viele mehr', icon: 'dots-horizontal' },
];

/**
 * Endlos durchlaufender Prämien-Strip (Reanimated 3, UI-Thread).
 * Zwei identische Chip-Reihen nebeneinander; translateX läuft linear
 * von 0 auf -Reihenbreite und springt nahtlos zurück → Endlos-Loop.
 * Nicht interaktiv — reine Appetit-Anzeige der Einlöse-Optionen.
 */
function RewardsMarquee({
  theme,
  accent,
  compact,
}: {
  theme: any;
  accent: string;
  compact: boolean;
}) {
  const [rowWidth, setRowWidth] = useState(0);
  const offset = useSharedValue(0);

  useEffect(() => {
    if (rowWidth > 0) {
      offset.value = 0;
      // ~33 px/s — gemütlich lesbar, nicht hektisch.
      offset.value = withRepeat(
        withTiming(-rowWidth, {
          duration: rowWidth * 30,
          easing: Easing.linear,
        }),
        -1,
        false,
      );
    }
  }, [rowWidth, offset]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: offset.value }],
  }));

  // Leichter Shimmer auf den Logos (User-Vorgabe 2026-06-10):
  // sanfter Opacity-Puls im Tempo des Skeleton-Shimmers — lebendig,
  // ohne unruhig zu werden.
  const shine = useSharedValue(0);
  useEffect(() => {
    shine.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 1200, easing: Easing.inOut(Easing.quad) }),
        withTiming(0, { duration: 1200, easing: Easing.inOut(Easing.quad) }),
      ),
      -1,
      false,
    );
  }, [shine]);
  const shineStyle = useAnimatedStyle(() => ({
    opacity: 0.78 + shine.value * 0.22,
  }));

  // Logo-Strip statt Chip-Pills: jedes Item ist eine schmale Spalte
  // (Logo bzw. Icon oben, dezente 10px-Caption darunter) — die
  // "Partner-Logos"-Optik aus Fintech-/Cashback-Apps. Keine Rahmen,
  // keine Button-Anmutung.
  const itemColumn = {
    width: 84,
    alignItems: 'center' as const,
    gap: 5,
  };
  const logoBox = {
    width: 56,
    height: 38,
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
  };
  // Kleines, schräg gestelltes Gutschein-Ticket in Primary — sitzt
  // in der oberen Ecke über den Einkaufsgutschein-Logos.
  const voucherBadge = {
    position: 'absolute' as const,
    top: -6,
    right: -2,
    width: 21,
    height: 21,
    borderRadius: 10.5,
    backgroundColor: theme.surface,
    borderWidth: 1,
    borderColor: theme.border ?? 'rgba(0,0,0,0.06)',
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    transform: [{ rotate: '-18deg' }],
  };
  const caption = {
    color: theme.textSub,
    fontSize: 10,
    fontFamily,
    fontWeight: fontWeight.semibold as any,
    textAlign: 'center' as const,
  };

  const renderRow = (measure: boolean) => (
    <View
      style={{ flexDirection: 'row' }}
      onLayout={
        measure
          ? (e) => setRowWidth(Math.round(e.nativeEvent.layout.width))
          : undefined
      }
    >
      {REWARDS.map((item) => (
        <View key={item.key} style={itemColumn}>
          <Animated.View style={[logoBox, shineStyle]}>
            {item.image ? (
              <Image
                source={item.image}
                style={{
                  width: item.imageWidth ?? 30,
                  height: item.imageHeight ?? 30,
                  borderRadius: 6,
                }}
                resizeMode="contain"
              />
            ) : (
              <MaterialCommunityIcons
                name={item.icon as any}
                size={26}
                color={accent}
              />
            )}
            {item.voucher ? (
              <View style={voucherBadge}>
                <MaterialCommunityIcons
                  name="ticket-percent"
                  size={13}
                  color={accent}
                />
              </View>
            ) : null}
          </Animated.View>
          <Text style={caption} numberOfLines={1}>
            {item.label}
          </Text>
        </View>
      ))}
    </View>
  );

  return (
    <View style={{ overflow: 'hidden' }}>
      <Animated.View style={[{ flexDirection: 'row' }, animatedStyle]}>
        {renderRow(true)}
        {renderRow(false)}
      </Animated.View>
      {/* Edge-Fades — der Loop taucht weich aus dem Seitenhintergrund
          auf statt hart an der Kante zu schneiden. */}
      <LinearGradient
        colors={[theme.bg, `${theme.bg}00`]}
        start={{ x: 0, y: 0.5 }}
        end={{ x: 1, y: 0.5 }}
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          bottom: 0,
          width: 32,
        }}
        pointerEvents="none"
      />
      <LinearGradient
        colors={[`${theme.bg}00`, theme.bg]}
        start={{ x: 0, y: 0.5 }}
        end={{ x: 1, y: 0.5 }}
        style={{
          position: 'absolute',
          right: 0,
          top: 0,
          bottom: 0,
          width: 32,
        }}
        pointerEvents="none"
      />
    </View>
  );
}

// Trust-Badges — sitzen DIREKT über dem Akzeptieren-Button (Best
// Practice: Safety-Signale am Entscheidungspunkt, nicht als eigene
// Listen-Sektion). Nur Headlines (User-Vorgabe 2026-06-10), die
// Langfassung steht in Datenschutzerklärung + AGB (Links im Footer).
//
// Consent-Struktur (ClickUp 86caf62v6, Go-Live): bewusstes LAYERED CONSENT —
// die Kurz-Headline hier + die rechtsverbindliche Einwilligung in der Footer-
// Zeile ("Mit Akzeptieren stimmst du AGB & Datenschutzerklärung zu", beide
// verlinkt). "Anonyme Marktdaten" = die App wertet Einkaufs-/Nutzungsdaten
// ANONYMISIERT/aggregiert aus und gibt diese Markt-Statistiken entgeltlich an
// Handels-/Industriepartner weiter (B2B). Die vollständige, informierte
// Aufklärung dazu steht in der verlinkten Datenschutzerklärung + AGB §8.2 —
// Rechtsgrundlage Einwilligung (Art. 6 Abs. 1 lit. a DSGVO). Finale rechtliche
// Abnahme (insb. Benennung des Auszahlungs-Drittanbieters + Drittland) erfolgt
// auf Doc-Ebene durch den Anwalt, nicht im App-Text.
// Der Standort steht hier, WEIL er Teilnahmebedingung ist (Entscheidung
// 11.08.2026): Der Aufnahme- bzw. Einkaufsort gehört zum vergüteten
// Datensatz, ohne ihn gibt es keine Teilnahme am Reward-Programm. Genau
// deshalb muss er VOR dem Tippen auf „Akzeptieren" sichtbar sein — sonst
// löst der Knopf einen Standort-Dialog aus, von dem vorher nie die Rede
// war, und die Bedingung wäre weder informiert noch durchsetzbar.
//
// „Jederzeit widerrufbar" ist bewusst raus: Es wäre irreführend neben
// einer Bedingung, deren Wegfall die Teilnahme beendet. Der Widerruf
// bleibt selbstverständlich möglich — er beendet dann eben die Teilnahme,
// und genau das sagt die Datenschutzerklärung.
const TRUST: { icon: string; label: string }[] = [
  { icon: 'shield-check-outline', label: 'EU-Datenschutz' },
  { icon: 'chart-box-outline', label: 'Anonyme Marktdaten' },
  { icon: 'map-marker-outline', label: 'Standort erforderlich' },
];

export default function CashbackConsentScreen() {
  const { theme } = useTokens();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const { user, isAnonymous } = useAuth();
  // Kompakt-Modus für kleine Displays (iPhone SE-Klasse): engere
  // Paddings, damit Hero + alle 3 Steps ohne Scrollen sichtbar sind.
  const { height: winHeight } = useWindowDimensions();
  const compact = winHeight < 700;
  // Context-aware Routing (ClickUp 86ca8h…): der Consent-Screen darf NICHT
  // mehr blind in den Bon-Scanner springen. Wohin es nach dem Akzeptieren
  // (bzw. wenn Consent schon gültig ist) geht, hängt vom `from`-Parameter ab:
  //   • 'receipt'  → Bon-Scanner (/cashback/capture)  — NUR echte Scan-Intents
  //   • 'product'  → Produkt-Einreichung (/product-submit)
  //   • 'survey'   → Umfragen-Übersicht (/surveys)
  //   • sonst (settings/rewards/leer) → zurück (kein Auto-Scanner)
  const params = useLocalSearchParams<{ from?: string }>();
  const from = params.from ?? '';

  // Anzeige-Variante (86cagb5gh): Copy folgt dem Verdien-Flow, aus dem der
  // User kommt. rewards/settings/leer bleiben bei der Bon-Copy (Default).
  const variant: ConsentVariant =
    from === 'product' ? 'product' : from === 'survey' ? 'survey' : 'receipt';
  const steps = STEPS_BY_VARIANT[variant];
  const hero = HERO_BY_VARIANT[variant];

  const goAfterConsent = useCallback(() => {
    if (from === 'receipt') {
      router.replace('/cashback/capture');
    } else if (from === 'product') {
      router.replace('/product-submit' as any);
    } else if (from === 'survey') {
      // Umfragen-Intent (86cagb5gh) → zurück in die Umfragen-Übersicht
      // (replace, damit der Consent nicht im Back-Stack bleibt).
      router.replace('/surveys' as any);
    } else if (from === 'rewards') {
      // Aktivierung aus dem Rewards-Kontext (Card / Umfrage-Nudge / Auto-
      // Prompt) → nach dem Akzeptieren auf den Rewards-Tab (replace, damit
      // der Consent nicht im Back-Stack bleibt). 86ca8hnmb.
      router.replace('/(tabs)/rewards' as any);
    } else if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/(tabs)/rewards' as any);
    }
  }, [from]);

  // CTA-Label spiegelt den Folge-Schritt (kein "Bon scannen" wenn gar nicht
  // gescannt wird).
  const ctaFollowupLabel =
    from === 'receipt'
      ? 'Akzeptieren & Bon scannen'
      : from === 'product' || from === 'survey'
        ? 'Akzeptieren & fortfahren'
        : 'Akzeptieren';

  // AGB/Datenschutz im IN-APP-Browser öffnen (SFSafariViewController /
  // Custom Tab) statt extern in Safari — User-Vorgabe 2026-06-11.
  // Gleiche Konvention wie profile.tsx; Linking nur als Fallback.
  const openLegalLink = async (url: string) => {
    try {
      await WebBrowser.openBrowserAsync(url, {
        presentationStyle: WebBrowser.WebBrowserPresentationStyle.AUTOMATIC,
        controlsColor: accent,
        toolbarColor: theme.bg,
      });
    } catch {
      Linking.openURL(url);
    }
  };

  const [, setConsentVersion] = useState<string>('');
  const [isSubmitting, setSubmitting] = useState(false);
  const [hasAccepted, setHasAccepted] = useState(false);
  /**
   * Spiegel auf `handleAccept`, damit der „Standort freigeben"-Knopf im
   * Hinweis-Dialog den Vorgang erneut anstoßen kann. Ein direkter
   * Selbstbezug in `useCallback` ginge nicht, und den Callback über die
   * Abhängigkeiten hereinzureichen würde eine Endlosschleife bauen.
   */
  const handleAcceptRef = useRef<() => void>(() => {});
  /** Gesetzt, sobald die Standortfreigabe verweigert wurde. */
  const [standortFehlt, setStandortFehlt] = useState<'denied' | null>(null);

  /**
   * Wer in die Einstellungen geht und zurückkommt, soll nicht raten müssen,
   * ob es geklappt hat. Beim Zurückkehren wird der Status neu gelesen und
   * die Anleitung verschwindet, sobald die Freigabe steht.
   *
   * Bewusst KEIN automatisches Fortfahren: Die Rückkehr in die App heißt
   * nicht zwangsläufig, dass jemand gerade die Berechtigung erteilt hat —
   * er kann aus jedem beliebigen Grund in den Einstellungen gewesen sein.
   * Der letzte Schritt bleibt seiner.
   */
  useEffect(() => {
    if (!standortFehlt) return;
    const sub = AppState.addEventListener('change', (s) => {
      if (s !== 'active') return;
      void standortStatus().then((status) => {
        if (status === 'granted_precise' || status === 'granted_coarse') {
          setStandortFehlt(null);
        }
      });
    });
    return () => sub.remove();
  }, [standortFehlt]);

  useLayoutEffect(() => {
    navigation.setOptions({ headerShown: false });
  }, [navigation]);

  useEffect(() => {
    let alive = true;
    (async () => {
      const config = await getCashbackConfig();
      if (!alive) return;
      setConsentVersion(config.consentVersion);
      if (user?.uid) {
        const valid = await hasValidCashbackConsent(user.uid);
        if (alive && valid) {
          // Consent schon gültig → context-aware weiter (kein Auto-Scanner
          // außer from=receipt).
          goAfterConsent();
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, [user?.uid, goAfterConsent]);

  /**
   * Was passiert, wenn die Standortfreigabe nicht erteilt wird.
   *
   * Das übliche Muster guter Apps — und der Grund dafür: Nach einer
   * endgültigen Ablehnung zeigt iOS den System-Dialog NIE wieder an. Ein
   * erneuter Aufruf läuft still ins Leere und wirkt wie ein Defekt.
   * Deshalb übernimmt hier ein eigener Hinweis mit dem Weg in die
   * Einstellungen.
   *
   * Der zweite Knopf ist kein Nachgeben, sondern der Kern der Sache: Die
   * Anforderung des Reward-Programms lautet „sag uns, wo du bist" — nicht
   * „gib GPS frei". Der Ort lässt sich im Wizard genauso eintippen, und
   * das erfüllt die Bedingung vollwertig. Ohne JEDE Ortsangabe gibt es
   * keine Vergütung; das setzt `crowd-upload-reward` serverseitig durch,
   * nicht dieser Dialog. Eine Sackgasse an dieser Stelle würde nur Leute
   * verlieren, die den Ort bereitwillig eintippen würden.
   */
  /**
   * Reaktion auf eine verweigerte Standortfreigabe.
   *
   * Zwei Fälle, die sich grundlegend unterscheiden:
   *
   * 'not_asked' — der Dialog wurde weggetippt, das System fragt weiter.
   *   Ein kurzer Alert mit einem zweiten Versuch reicht.
   *
   * 'denied' — endgültig abgelehnt. iOS zeigt den System-Dialog dann NIE
   *   wieder; ein erneuter Aufruf kehrt still zurück und wirkt wie ein
   *   Defekt. Hier übernimmt die feste Anleitung auf dem Screen, weil sie
   *   auch dann noch da ist, wenn der Nutzer aus den Einstellungen
   *   zurückkommt — ein Alert wäre längst weg.
   */
  const zeigeStandortHinweis = useCallback((status: string, erneutVersuchen: () => void) => {
    if (status === 'denied') {
      setStandortFehlt('denied');
      return;
    }
    Alert.alert(
      'Standort wird benötigt',
      'Der Ort gehört zu jedem Datensatz, den wir vergüten — nur so ist nachvollziehbar, ' +
        'wo ein Produkt oder Preis wirklich zu finden war. Gib den Standort frei, dann kann es losgehen.',
      [
        { text: 'Später', style: 'cancel' as const },
        { text: 'Standort freigeben', onPress: erneutVersuchen },
      ],
    );
  }, []);

  const handleAccept = useCallback(async () => {
    if (!user?.uid) {
      Alert.alert(
        'Bitte erst anmelden',
        'Cashback ist nur für angemeldete Konten verfügbar.',
        [
          { text: 'Abbrechen', style: 'cancel' },
          { text: 'Zum Login', onPress: () => safePush('/auth/login') },
        ],
      );
      return;
    }
    if (isAnonymous) {
      Alert.alert(
        'Konto erforderlich',
        'Für Cashback brauchst du ein vollständiges Konto.',
        [
          { text: 'Abbrechen', style: 'cancel' },
          { text: 'Konto erstellen', onPress: () => safePush('/auth/register') },
        ],
      );
      return;
    }

    setSubmitting(true);
    try {
      // Standortfreigabe ist Teilnahmebedingung für das gesamte
      // Reward-Programm — Bons, Produktfotos UND Umfragen (Entscheidung
      // 11.08.2026). Der Ort gehört zum vergüteten Datensatz; ohne ihn
      // keine Teilnahme.
      //
      // ZUERST fragen, DANN speichern: Sonst entstünde ein halber Zustand —
      // Consent gespeichert, Bedingung nicht erfüllt. `hasValidCashbackConsent`
      // würde dann true liefern für jemanden, der gar nicht teilnehmen darf.
      // „Angenommen" muss heißen: vollständig angenommen.
      const status = await standortAnfordern();
      if (status !== 'granted_precise' && status !== 'granted_coarse') {
        setSubmitting(false);
        zeigeStandortHinweis(status, handleAcceptRef.current);
        return;
      }

      await acceptCashbackConsent(user.uid);
      setHasAccepted(true);
      // 86cagb57g: Wer den App-Start-Tracking-Consent (UMP, Android)
      // abgelehnt hatte, bekommt ihn beim Cashback-Aktivieren erneut —
      // VOR der Navigation, damit das native Formular nicht über einem
      // bereits ersetzten Screen hängt. iOS/erteilter Consent: No-op.
      await consentService.ensureTrackingConsentAtCashback();
      setTimeout(() => {
        goAfterConsent();
      }, 300);
    } catch (error: any) {
      console.warn('acceptCashbackConsent failed:', error);
      Alert.alert(
        'Speichern fehlgeschlagen',
        'Bitte prüfe deine Internetverbindung und versuch es erneut.',
      );
    } finally {
      setSubmitting(false);
    }
  }, [user?.uid, isAnonymous, goAfterConsent, zeigeStandortHinweis]);

  // Nach jedem Render aktualisieren, damit der Dialog-Knopf nie eine
  // veraltete Closure aufruft.
  handleAcceptRef.current = handleAccept;

  const handleCancel = useCallback(() => router.back(), []);

  const chromeHeight = insets.top + DETAIL_HEADER_ROW_HEIGHT;
  const accent = theme.primary ?? '#0d8575';

  const styles = useMemo(
    () => ({
      // Hero — brand-teal gradient (same vector as the Cashback
      // hero on Belohnungen so this screen reads as part of that
      // family). Big headline, Konditionen bewusst ohne harte Zahlen.
      hero: {
        marginHorizontal: 20,
        marginTop: 4,
        borderRadius: 18,
        paddingHorizontal: 18,
        paddingVertical: 12,
        overflow: 'hidden' as const,
      },
      heroIcon: {
        width: 38,
        height: 38,
        borderRadius: 12,
        backgroundColor: 'rgba(255,255,255,0.22)',
        alignItems: 'center' as const,
        justifyContent: 'center' as const,
      },
      heroEyebrow: {
        color: 'rgba(255,255,255,0.85)',
        fontSize: 11,
        fontFamily,
        fontWeight: fontWeight.bold as any,
        letterSpacing: 0.8,
        textTransform: 'uppercase' as const,
        marginTop: compact ? 8 : 9,
      },
      heroTitle: {
        color: '#fff',
        fontSize: compact ? 21 : 24,
        fontFamily,
        fontWeight: fontWeight.extraBold as any,
        letterSpacing: -0.4,
        marginTop: 4,
      },
      heroBody: {
        color: 'rgba(255,255,255,0.92)',
        fontSize: 13,
        lineHeight: 19,
        fontFamily,
        marginTop: 6,
      },
      sectionLabel: {
        color: theme.textMuted,
        fontSize: 11,
        fontFamily,
        fontWeight: fontWeight.bold as any,
        letterSpacing: 0.7,
        textTransform: 'uppercase' as const,
        marginHorizontal: 20,
        marginTop: 0,
        marginBottom: compact ? 6 : 10,
      },

      // Step row — circle with the step number + title + sub. Three
      // of these stacked, no card chrome — keeps the page airy.
      stepsCard: {
        marginHorizontal: 20,
        backgroundColor: theme.surface,
        borderRadius: 18,
        borderWidth: 1,
        borderColor: theme.border ?? 'rgba(0,0,0,0.06)',
        paddingHorizontal: 14,
        paddingVertical: compact ? 8 : 10,
      },
      stepRow: {
        flexDirection: 'row' as const,
        alignItems: 'center' as const,
        gap: 12,
        paddingHorizontal: 4,
        paddingVertical: compact ? 4 : 6,
      },
      // Timeline-Segment zwischen den Step-Kreisen (Kreis 38px,
      // Zentrum bei 4 + 19 = 23 -> Linie bei 22).
      stepConnector: {
        width: 2,
        height: compact ? 8 : 12,
        backgroundColor: `${accent}30`,
        marginLeft: 22,
        borderRadius: 1,
      },
      marqueeLabel: {
        color: theme.textMuted,
        fontSize: 11,
        fontFamily,
        fontWeight: fontWeight.bold as any,
        letterSpacing: 0.7,
        textTransform: 'uppercase' as const,
        textAlign: 'center' as const,
        marginBottom: compact ? 5 : 8,
      },
      stepCircle: {
        width: 38,
        height: 38,
        borderRadius: 19,
        backgroundColor: accent + '18',
        alignItems: 'center' as const,
        justifyContent: 'center' as const,
        position: 'relative' as const,
      },
      stepNumber: {
        position: 'absolute' as const,
        top: -4,
        right: -4,
        width: 18,
        height: 18,
        borderRadius: 9,
        backgroundColor: accent,
        alignItems: 'center' as const,
        justifyContent: 'center' as const,
      },
      stepNumberText: {
        color: '#fff',
        fontSize: 10,
        fontFamily,
        fontWeight: fontWeight.extraBold as any,
      },
      stepTitle: {
        color: theme.text,
        fontSize: 14,
        fontFamily,
        fontWeight: fontWeight.bold as any,
      },
      stepSub: {
        color: theme.textSub,
        fontSize: 12,
        fontFamily,
        marginTop: 2,
      },

      // Trust-Badges über dem CTA — drei gleichbreite Icon-Spalten,
      // bewusst ohne Karten-Chrome (Tonalität der Step-Kreise).
      trustRow: {
        flexDirection: 'row' as const,
        alignItems: 'center' as const,
        justifyContent: 'center' as const,
        gap: 14,
        paddingTop: compact ? 4 : 6,
        paddingBottom: 2,
      },
      trustItem: {
        flexDirection: 'row' as const,
        alignItems: 'center' as const,
        gap: 4,
      },
      trustLabel: {
        color: theme.textSub,
        fontSize: 10,
        fontFamily,
        fontWeight: fontWeight.semibold as any,
      },
      // Klein + zentriert ganz unten im Footer, unter "Jetzt nicht".
      legalText: {
        marginTop: 2,
        paddingHorizontal: 8,
        color: theme.textMuted,
        fontSize: 10,
        lineHeight: 14,
        fontFamily,
        textAlign: 'center' as const,
      },
      legalLink: {
        color: accent,
        textDecorationLine: 'underline' as const,
      },

      footer: {
        paddingHorizontal: 16,
        paddingTop: compact ? 8 : 10,
        paddingBottom: insets.bottom + (compact ? 6 : 10),
        gap: compact ? 4 : 6,
        borderTopWidth: 1,
        borderTopColor: theme.border ?? 'rgba(0,0,0,0.06)',
        backgroundColor: theme.bg,
      },
      // Anleitung bei verweigerter Standortfreigabe — sitzt über dem
      // Akzeptieren-Knopf, damit der Zusammenhang unmittelbar ist.
      locHint: {
        backgroundColor: theme.surfaceAlt,
        borderRadius: 14,
        borderWidth: 1,
        borderColor: theme.border,
        padding: 14,
        gap: 8,
        marginBottom: 12,
      },
      locHintHead: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 7 },
      locHintTitle: {
        fontFamily,
        fontWeight: fontWeight.bold as any,
        fontSize: 14,
        color: theme.text,
      },
      locHintBody: {
        fontFamily,
        fontWeight: fontWeight.medium as any,
        fontSize: 12,
        lineHeight: 17,
        color: theme.textSub,
      },
      locStep: { flexDirection: 'row' as const, alignItems: 'flex-start' as const, gap: 8 },
      locStepNum: {
        fontFamily,
        fontWeight: fontWeight.bold as any,
        fontSize: 11,
        color: accent,
        // Feste Breite hält die Textspalte bündig — bei einstelligen
        // Schrittzahlen reicht das, tabular-nums braucht es dafür nicht.
        width: 14,
      },
      locStepText: {
        flex: 1,
        fontFamily,
        fontWeight: fontWeight.medium as any,
        fontSize: 12,
        lineHeight: 17,
        color: theme.text,
      },
      locHintBtn: {
        flexDirection: 'row' as const,
        alignItems: 'center' as const,
        justifyContent: 'center' as const,
        gap: 7,
        height: 42,
        borderRadius: 12,
        backgroundColor: accent,
        marginTop: 2,
      },
      locHintBtnText: {
        color: '#fff',
        fontFamily,
        fontWeight: fontWeight.bold as any,
        fontSize: 13,
      },
      acceptButton: {
        backgroundColor: accent,
        borderRadius: 14,
        height: compact ? 48 : 52,
        alignItems: 'center' as const,
        justifyContent: 'center' as const,
        flexDirection: 'row' as const,
        gap: 8,
        opacity: isSubmitting ? 0.7 : 1,
      },
      acceptText: {
        color: '#fff',
        fontFamily,
        fontWeight: fontWeight.extraBold as any,
        fontSize: 15,
        letterSpacing: 0.2,
      },
    }),
    [theme, accent, insets.bottom, isSubmitting, compact],
  );

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      {/* Modal-Präsentation (slide_from_bottom): KEIN Zurück-Pfeil —
          der suggeriert einen Push-Stack. Schließen über "Jetzt nicht"
          oben rechts oder Swipe-down (gestureEnabled). */}
      <DetailHeader
        title="Cashback"
        right={
          <Pressable
            accessibilityRole="button"
            onPress={handleCancel}
            hitSlop={8}
            style={{ paddingHorizontal: 4, paddingVertical: 8 }}
          >
            <Text
              style={{
                fontFamily,
                fontWeight: fontWeight.semibold as any,
                fontSize: 13,
                color: theme.textSub,
              }}
            >
              Jetzt nicht
            </Text>
          </Pressable>
        }
      />
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{
          paddingTop: chromeHeight + 4,
          paddingBottom: compact ? 16 : 24,
          // Auf hohen Displays (Pro Max/Plus) waechst der Content auf
          // die volle Viewport-Hoehe; die flexiblen Spacer zwischen
          // den Sektionen verteilen den Ueberschuss gleichmaessig,
          // statt ihn als Loch vorm Footer zu sammeln. Auf kleinen
          // Displays kollabieren die Spacer auf ihre minHeight.
          flexGrow: 1,
        }}
        showsVerticalScrollIndicator={false}
      >
        {/* Hero — value pitch */}
        <LinearGradient
          colors={['#0a6f62', '#0d8575', '#10a18a']}
          start={{ x: -1, y: 0.34 }}
          end={{ x: 1, y: -0.34 }}
          style={styles.hero}
        >
          <View style={styles.heroIcon}>
            <MaterialCommunityIcons
              name="cash-multiple"
              size={20}
              color="#fff"
            />
          </View>
          <Text style={styles.heroEyebrow}>{hero.eyebrow}</Text>
          <Text style={styles.heroTitle}>{hero.title}</Text>
          {/* Copy pro Variante aus HERO_BY_VARIANT (86cagb5gh) — keine
              hardcodierten Konditionen, die sind config-/aktionsgetrieben.
              Aktuelle Aktionen zeigt der Rewards-Tab. */}
          <Text style={styles.heroBody}>
            {hero.bodyPre}
            <Text style={{ fontWeight: fontWeight.extraBold as any, color: '#fff' }}>
              {hero.bodyBold}
            </Text>
            {hero.bodyPost}
          </Text>
        </LinearGradient>

        <View style={{ flexGrow: 1, minHeight: compact ? 10 : 14 }} />

        {/* So einfach geht's — Surface-Card mit Timeline-Linie
            zwischen den Step-Kreisen (Design-System: Card radius 18,
            Border, shadows.sm wie die Belohnungen-Cards). */}
        <Text style={styles.sectionLabel}>So einfach geht's</Text>
        <View style={styles.stepsCard}>
          {steps.map((step, idx) => (
            <View key={step.title}>
            {idx > 0 ? <View style={styles.stepConnector} /> : null}
            <View style={styles.stepRow}>
              <View style={styles.stepCircle}>
                <MaterialCommunityIcons
                  name={step.icon as any}
                  size={18}
                  color={accent}
                />
                <View style={styles.stepNumber}>
                  <Text style={styles.stepNumberText}>{idx + 1}</Text>
                </View>
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.stepTitle}>{step.title}</Text>
                <Text style={styles.stepSub}>{step.sub}</Text>
              </View>
            </View>
            </View>
          ))}
        </View>

        <View style={{ flexGrow: 1, minHeight: compact ? 8 : 12 }} />

        {/* Prämien-Marquee mit eigenem Label — die Einlöse-Optionen
            haengen nicht mehr beziehungslos im Raum. */}
        <Text style={styles.marqueeLabel}>Einlösbar bei</Text>
        <RewardsMarquee theme={theme} accent={accent} compact={compact} />

        <View style={{ flexGrow: 1.4, minHeight: 4 }} />
      </ScrollView>

      <View style={styles.footer}>
        {/* Anleitung bleibt STEHEN, statt als Alert zu verschwinden: Der
            Nutzer liest sie, während er in den Einstellungen sucht, und
            findet sie bei der Rückkehr noch vor. Ein Dialog wäre genau
            dann weg, wenn man ihn braucht. */}
        {standortFehlt === 'denied' && (
          <View style={styles.locHint}>
            <View style={styles.locHintHead}>
              <MaterialCommunityIcons name="map-marker-alert-outline" size={16} color={accent} />
              <Text style={styles.locHintTitle}>Standort noch freigeben</Text>
            </View>
            <Text style={styles.locHintBody}>
              Der Ort gehört zu jedem Datensatz, den wir vergüten. Ohne ihn ist keine
              Teilnahme möglich — freigeben kannst du ihn jederzeit:
            </Text>
            {(Platform.OS === 'ios'
              ? [
                  'Einstellungen öffnen (Knopf unten)',
                  'Auf „Standort" tippen',
                  '„Beim Verwenden der App" auswählen',
                  'Zurück in die App — dann auf Akzeptieren',
                ]
              : [
                  'Einstellungen öffnen (Knopf unten)',
                  'Auf „Berechtigungen" → „Standort" tippen',
                  '„Nur während der Nutzung der App zulassen" wählen',
                  '„Genauen Standort verwenden" einschalten',
                  'Zurück in die App — dann auf Akzeptieren',
                ]
            ).map((s, i) => (
              <View key={s} style={styles.locStep}>
                <Text style={styles.locStepNum}>{i + 1}</Text>
                <Text style={styles.locStepText}>{s}</Text>
              </View>
            ))}
            <Pressable
              accessibilityRole="button"
              onPress={() => Linking.openSettings()}
              style={styles.locHintBtn}
            >
              <MaterialCommunityIcons name="cog-outline" size={16} color="#fff" />
              <Text style={styles.locHintBtnText}>Einstellungen öffnen</Text>
            </Pressable>
          </View>
        )}

        <Pressable
          accessibilityRole="button"
          disabled={isSubmitting || hasAccepted}
          style={styles.acceptButton}
          onPress={handleAccept}
        >
          {isSubmitting ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <>
              <MaterialCommunityIcons
                name={hasAccepted ? 'check-circle' : 'arrow-right-circle'}
                size={18}
                color="#fff"
              />
              <Text style={styles.acceptText}>
                {hasAccepted ? 'Gespeichert' : ctaFollowupLabel}
              </Text>
            </>
          )}
        </Pressable>

        {/* Trust-Badges UNTER den Buttons (User-Vorgabe 2026-06-10:
            nicht vom Akzeptieren ablenken) — drei dezente Icon-
            Spalten, gleiche Tonalität wie die Step-Kreise. */}
        <View style={styles.trustRow}>
          {TRUST.map((item) => (
            <View key={item.label} style={styles.trustItem}>
              <MaterialCommunityIcons
                name={item.icon as any}
                size={13}
                color={accent}
              />
              <Text style={styles.trustLabel}>{item.label}</Text>
            </View>
          ))}
        </View>

        {/* Legal-Zeile ganz unten, klein unter "Jetzt nicht"
            (User-Vorgabe 2026-06-10). */}
        <Text
          style={styles.legalText}
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.82}
        >
          Mit "Akzeptieren" stimmst du{' '}
          <Text
            style={styles.legalLink}
            onPress={() => openLegalLink(TERMS_URL)}
          >
            AGB
          </Text>
          {' '}&{' '}
          <Text
            style={styles.legalLink}
            onPress={() => openLegalLink(PRIVACY_URL)}
          >
            Datenschutzerklärung
          </Text>
          {' '}zu.
        </Text>
      </View>
    </View>
  );
}
