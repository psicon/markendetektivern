import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { safePush } from '@/lib/utils/safeNav';
import React, { useCallback, useState } from 'react';
import {
  Image as RNImage,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native';
import { useIsFocused } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { LinearTransition } from 'react-native-reanimated';

import {
  REWARDS_ANCHOR_EARN,
  REWARDS_ANCHOR_HERO,
  REWARDS_ANCHOR_REDEEM,
  RewardsWalkthrough,
} from '@/components/coachmarks/RewardsWalkthrough';
import { FilterSheet } from '@/components/design/FilterSheet';
import { fontFamily, fontWeight } from '@/constants/tokens';
import { useCoachmark } from '@/hooks/useCoachmark';
import { useCoachmarkAnchor } from '@/hooks/useCoachmarkAnchor';
import { useColorScheme } from '@/hooks/useColorScheme';
import { useTokens } from '@/hooks/useTokens';
import { useAuth } from '@/lib/contexts/AuthContext';
import { useCashbackUserState } from '@/lib/hooks/useCashbackUserState';
import { getActiveCashbackCampaigns, getCashbackConfig, type ActiveCampaign } from '@/lib/services/cashbackService';
import { useWeeklyReceiptCount } from '@/lib/hooks/useWeeklyReceiptCount';
import { showInfoToast } from '@/lib/services/ui/toast';

// ─── Cashback fallback ─────────────────────────────────────────────────
// Wenn kein User eingeloggt ist (oder das Cashback-Backend offline)
// rendert die UI mit einem 0,00 € Fallback. Live-Werte kommen aus
// `useCashbackUserState()` via Firestore-Snapshot — siehe
// CASHBACK_ARCHITECTURE.md §3.3 (User-Felder).
const CASHBACK_FALLBACK_EUR = 0.0;
const PAYOUT_THRESHOLD = 10.0;

// The reward catalogue (15+ partner brands) was previously rendered
// inline as a 2-column grid here. Per-product UX moved to a single
// big "Cashback einlösen" CTA below; the catalogue lives behind that
// button on a third-party provider page (separate flow, not
// implemented yet).

// T17.24: usedThisWeek war hardcoded → User sah fake-counters
// ("2/6 Woche", "14/20 Woche") die nie zur Realität gehörten. Photo-
// Submission gibt's eh noch nicht (steht in achievements.ts als
// „später"). Counter wird jetzt live aus useWeeklyReceiptCount
// hydratiert, Photo-Card sagt ehrlich „Bald verfügbar".
const RECEIPT_LIMIT = { perWeek: 6, eurEach: 0.08 };
const PHOTO_LIMIT = { perWeek: 20, eurEach: 0.1 };
const SURVEY_AVAILABLE = false;
const PHOTO_SUBMISSION_AVAILABLE = false;

// Single source of truth for the three earn-action cards. The same
// data feeds the Schnellzugriff tile + (formerly) the "Taler verdienen"
// list. List was removed because it duplicated everything the tiles
// already conveyed; the tiles now show the per-week status inline.
type EarnAction = {
  k: 'receipt' | 'photo' | 'survey';
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
  label: string; // tile label, "\n" splits the two lines
  bg: string;
  dark: boolean;
  reward: string; // pill copy: "0,08 €", "0,10 €", "wenn verfügb."
  available: boolean;
  statusLabel: string; // "2/6 diese Woche" / "Aktuell keine Umfrage" / "Limit erreicht"
  progress?: number; // 0..1 — undefined for survey (no weekly counter)
};

function buildEarnActions(weeklyReceiptCount: number): EarnAction[] {
  const receiptAvailable = weeklyReceiptCount < RECEIPT_LIMIT.perWeek;
  return [
    {
      k: 'receipt',
      icon: 'receipt',
      label: 'Kassenbon\nscannen',
      bg: '#0d8575',
      dark: true,
      reward: `${RECEIPT_LIMIT.eurEach.toFixed(2).replace('.', ',')} €`,
      available: receiptAvailable,
      statusLabel: receiptAvailable
        ? `${weeklyReceiptCount}/${RECEIPT_LIMIT.perWeek} Woche`
        : 'Limit erreicht',
      progress: weeklyReceiptCount / RECEIPT_LIMIT.perWeek,
    },
    {
      k: 'photo',
      icon: 'camera-plus-outline',
      label: 'Produkte\neinreichen',
      bg: '#5b4f9c',
      dark: true,
      reward: `${PHOTO_LIMIT.eurEach.toFixed(2).replace('.', ',')} €`,
      available: PHOTO_SUBMISSION_AVAILABLE,
      statusLabel: PHOTO_SUBMISSION_AVAILABLE ? `0/${PHOTO_LIMIT.perWeek} Woche` : 'Bald verfügbar',
      // Kein Progress solange Feature nicht aktiv ist.
      progress: undefined,
    },
    {
      k: 'survey',
      icon: 'poll',
      label: 'Umfragen',
      bg: '#dde2e4',
      dark: false,
      reward: '0,20-2,50 €',
      available: SURVEY_AVAILABLE,
      statusLabel: SURVEY_AVAILABLE ? 'Verfügbar' : 'Aktuell keine',
    },
  ];
}

const HEADER_ROW_HEIGHT = 52;

export default function RewardsScreen() {
  const { theme } = useTokens();
  const scheme = useColorScheme() ?? 'light';
  const insets = useSafeAreaInsets();
  const { user, userProfile } = useAuth();
  // iOS-Status-Bar-Tap-Fix: scrollsToTop nur wenn dieser Tab
  // gerade aktiv ist. Sonst hat iOS >1 aktive UIScrollViews (alle
  // 3 Tabs bleiben gemountet) und blockt den Tap.
  const isFocused = useIsFocused();

  // Per-Screen Coachmark.
  const rewardsCoachmark = useCoachmark('rewards');
  const [helpOpen, setHelpOpen] = useState(false);

  // Bestenliste lebt jetzt unter Errungenschaften (eigener Tab dort).
  // Hier nur noch der Einlösen-Flow → keine Tabs, kein PagerView,
  // kein Gamification-Toggle-Geraffel mehr nötig.
  // Chrome inner padding: 8 top + 52 row + 14 bottom = 74. Match.
  const chromeHeight = insets.top + 8 + HEADER_ROW_HEIGHT + 14;

  const ChromeContent = (
    <View style={{ paddingHorizontal: 20, paddingTop: 8, paddingBottom: 14 }}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
          height: HEADER_ROW_HEIGHT,
        }}
      >
        <Text
          style={{
            flex: 1,
            fontFamily,
            fontWeight: fontWeight.extraBold,
            fontSize: 26,
            letterSpacing: -0.4,
            color: theme.text,
          }}
        >
          Belohnungen
        </Text>

        <Pressable
          onPress={() => setHelpOpen(true)}
          style={({ pressed }) => ({
            height: 34,
            paddingHorizontal: 12,
            borderRadius: 17,
            backgroundColor: theme.primaryContainer ?? theme.surfaceAlt,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 5,
            opacity: pressed ? 0.7 : 1,
          })}
          hitSlop={6}
        >
          <MaterialCommunityIcons
            name="help-circle-outline"
            size={15}
            color={theme.primary}
          />
          <Text
            style={{
              fontFamily,
              fontWeight: fontWeight.bold,
              fontSize: 12,
              color: theme.primary,
            }}
          >
            So geht's
          </Text>
        </Pressable>

        <Pressable
          onPress={() =>
            safePush(user ? ('/profile' as any) : ('/auth/welcome' as any))
          }
          style={({ pressed }) => ({
            width: 34,
            height: 34,
            borderRadius: 17,
            backgroundColor: theme.surfaceAlt,
            alignItems: 'center',
            justifyContent: 'center',
            overflow: 'hidden',
            opacity: pressed ? 0.7 : 1,
          })}
        >
          {(userProfile as any)?.photo_url || user?.photoURL ? (
            <RNImage
              source={{
                uri: ((userProfile as any)?.photo_url || user?.photoURL) as string,
              }}
              style={{ width: '100%', height: '100%' }}
              resizeMode="cover"
            />
          ) : (
            <MaterialCommunityIcons
              name="account-outline"
              size={20}
              color={theme.textMuted}
            />
          )}
        </Pressable>
      </View>
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <ScrollView
        scrollsToTop={isFocused}
        contentContainerStyle={{
          paddingTop: chromeHeight,
          paddingBottom: 120,
        }}
        showsVerticalScrollIndicator={false}
      >
        <RedeemTab />
      </ScrollView>

      {/* Chrome — absolute from y=0 (covers status-bar zone too) so
          scrolling content doesn't bleed up into the Dynamic Island
          area. paddingTop applies to the chrome material itself, not
          a wrapper above it — that was the bug in v1. */}
      {Platform.OS === 'ios' ? (
        <BlurView
          tint={scheme === 'dark' ? 'dark' : 'light'}
          intensity={80}
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            zIndex: 10,
            paddingTop: insets.top,
          }}
        >
          {ChromeContent}
        </BlurView>
      ) : (
        <View
          pointerEvents="box-none"
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            zIndex: 10,
            paddingTop: insets.top,
            backgroundColor:
              scheme === 'dark'
                ? 'rgba(15,18,20,0.92)'
                : 'rgba(245,247,248,0.92)',
          }}
        >
          {ChromeContent}
        </View>
      )}

      {/* "So geht's" help sheet — same FilterSheet component used
          for the Region-Setup + Achievements info, so all bottom
          sheets in the app share the slide-up animation, drag
          handle, backdrop fade and pan-to-dismiss gesture. */}
      <FilterSheet
        visible={helpOpen}
        title="So funktioniert's"
        onClose={() => setHelpOpen(false)}
      >
        <RewardsHelpContent />
      </FilterSheet>

      {/* T17.26: Per-Screen Walkthrough (Belohnungen) — jetzt
          Spotlight-basiert statt Slide-Modal. Pointet auf Hero,
          Verdienen-Row und Einlösen-Card mit motivierender Copy
          und konkreten Zahlen. */}
      <RewardsWalkthrough
        visible={rewardsCoachmark.visible}
        onDismiss={rewardsCoachmark.dismiss}
      />
    </View>
  );
}

// ────────────────────────────────────────────────────────────────────────
// EINLÖSEN TAB
// ────────────────────────────────────────────────────────────────────────

function RedeemTab() {
  const { theme } = useTokens();
  const scheme = useColorScheme() ?? 'light';
  // Live cashback state from Firestore. Falls back to 0,00 € when
  // the user isn't signed in or the backend hasn't seeded the field
  // yet (Phase 1 deploys the fields lazy via the Cloud Function).
  const cashback = useCashbackUserState();
  const cashbackEur = cashback.uid
    ? cashback.balanceCents / 100
    : CASHBACK_FALLBACK_EUR;
  // Auszahlungs-Schwelle + Monatslimit aus dem remote-konfigurierbaren
  // cashback_config/v1 (Fallback = Default-Konstanten). So lässt sich die
  // Schwelle ohne App-Update ändern.
  const [payoutThreshold, setPayoutThreshold] = useState(PAYOUT_THRESHOLD);
  const [monthlyMaxCents, setMonthlyMaxCents] = useState(0);
  const [campaignsEnabled, setCampaignsEnabled] = useState(false);
  const [campaigns, setCampaigns] = useState<ActiveCampaign[]>([]);
  React.useEffect(() => {
    let alive = true;
    getCashbackConfig()
      .then((c) => {
        if (!alive) return;
        if (typeof c.payoutThresholdCents === 'number') {
          setPayoutThreshold(c.payoutThresholdCents / 100);
        }
        if (typeof c.monthlyMaxCents === 'number') setMonthlyMaxCents(c.monthlyMaxCents);
        setCampaignsEnabled(Boolean(c.campaignsEnabled));
      })
      .catch(() => {});
    getActiveCashbackCampaigns()
      .then((c) => {
        if (alive) setCampaigns(c);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  // T17.24: Echter Wochen-Counter aus Firestore — ersetzt die
  // hardcoded fake-Werte.
  const weeklyReceiptCount = useWeeklyReceiptCount();
  const earnActions = React.useMemo(
    () => buildEarnActions(weeklyReceiptCount),
    [weeklyReceiptCount],
  );

  // T17.26: Anchors für den Spotlight-Walkthrough — Cashback-Hero,
  // Schnellzugriff-Row (Verdienen), Einlösen-Card.
  const heroAnchor = useCoachmarkAnchor(REWARDS_ANCHOR_HERO);
  const earnAnchor = useCoachmarkAnchor(REWARDS_ANCHOR_EARN);
  const redeemAnchor = useCoachmarkAnchor(REWARDS_ANCHOR_REDEEM);
  const pct = Math.min(
    100,
    Math.round((cashbackEur / payoutThreshold) * 100),
  );
  const canRedeem = cashbackEur >= payoutThreshold;
  const gapEur = (payoutThreshold - cashbackEur)
    .toFixed(2)
    .replace('.', ',');

  // Tap target for "Bon scannen" — routes through consent gate first.
  // If the user already accepted the current consent version we skip
  // straight to the capture screen.
  const onScanBon = useCallback(() => {
    if (!cashback.uid) {
      router.push('/auth/login');
      return;
    }
    if (cashback.hasConsent) {
      router.push('/cashback/capture');
    } else {
      router.push('/cashback/consent');
    }
  }, [cashback.uid, cashback.hasConsent]);

  return (
    <>
      {/* ── Hero: Cashback-Taler ──
          1:1 mirror of the StatusHero on the Bestenliste tab so the
          two heroes have IDENTICAL height + structure (no layout
          jump on tab swipe, both cards read the same way):
            • 52 px circle on the left (money icon ↔ user avatar)
            • Middle column: title + status chip
            • Right column: big number + matching "currency pill"
            • One progress bar (here: payout threshold)
            • Bottom row of three info chips
          The currency pill (💰 CASHBACK-TALER) sits where the
          STATUS-PKT pill sits on the StatusHero — same shape, same
          position, so the user pattern-matches between the two. */}
      <View style={{ paddingHorizontal: 20, paddingTop: 4 }}>
        {/* T17.27: Anchor um den echten Card-Inhalt, NICHT am
            paddingHorizontal-Wrapper — sonst spotlightet das Cutout
            +40 px ungenutzten Padding-Bereich rundherum. */}
        <View ref={heroAnchor.ref} onLayout={heroAnchor.onLayout}>
        <LinearGradient
          colors={['#0a6f62', '#0d8575', '#10a18a']}
          start={{ x: -1, y: 0.34 }}
          end={{ x: 1, y: -0.34 }}
          style={{
            borderRadius: 18,
            paddingHorizontal: 14,
            paddingVertical: 12,
            overflow: 'hidden',
            // Natürliche Höhe (kein fixes HERO_HEIGHT mehr): die
            // Bestenliste lebt jetzt unter Errungenschaften, es gibt
            // hier kein Pager-Geschwister mehr, mit dem die Höhe matchen
            // müsste. Tighter = weniger toter Whitespace.
          }}
        ><View style={{ gap: 12 }}>
          {/* Top row: 52 px money-icon-circle | title + status chip
              | big balance + currency pill — mirrors StatusHero's
              "avatar | name+level chip | big pts + label" layout. */}
          {/* `alignItems: stretch` makes both content columns
              fill the row's height (= 52 from the avatar). Each
              column then uses `justifyContent: space-between` so
              its pill sits at the BOTTOM. Both pills end up on
              the same baseline → guaranteed alignment. */}
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'stretch',
              gap: 12,
              minHeight: 52,
            }}
          >
            <View
              style={{
                width: 52,
                height: 52,
                borderRadius: 26,
                backgroundColor: 'rgba(255,255,255,0.22)',
                alignItems: 'center',
                justifyContent: 'center',
                borderWidth: 2,
                borderColor: 'rgba(255,255,255,0.55)',
              }}
            >
              <MaterialCommunityIcons
                name="cash-multiple"
                size={26}
                color="#ffd44b"
              />
            </View>
            <View
              style={{
                flex: 1,
                minWidth: 0,
                justifyContent: 'space-between',
              }}
            >
              <Text
                numberOfLines={1}
                style={{
                  fontFamily,
                  fontWeight: fontWeight.extraBold,
                  fontSize: 17,
                  color: '#fff',
                  letterSpacing: -0.2,
                }}
              >
                Cashback-Konto
              </Text>
              <HeroPill
                icon={canRedeem ? 'gift-outline' : 'progress-clock'}
                label={
                  canRedeem
                    ? 'Bereit zur Auszahlung'
                    : `Noch ${gapEur} € bis Auszahlung`
                }
              />
            </View>
            <View
              style={{
                alignItems: 'flex-end',
                justifyContent: 'space-between',
              }}
            >
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'flex-end',
                  gap: 2,
                }}
              >
                <Text
                  style={{
                    fontFamily,
                    fontWeight: fontWeight.extraBold,
                    fontSize: 24,
                    lineHeight: 28,
                    letterSpacing: -0.4,
                    color: '#fff',
                  }}
                >
                  {cashbackEur.toFixed(2).replace('.', ',')}
                </Text>
                <Text
                  style={{
                    fontFamily,
                    fontWeight: fontWeight.extraBold,
                    fontSize: 14,
                    lineHeight: 20,
                    color: '#fff',
                    opacity: 0.95,
                    marginBottom: 1,
                  }}
                >
                  €
                </Text>
              </View>
              <HeroPill icon="cash" label="Cashback-Taler" />
            </View>
          </View>

          {/* Progress bar to next payout — uses the same `ProgressBar`
              helper as the StatusHero so the two cards literally
              share their progress visual. */}
          <ProgressBar
            icon="gift-outline"
            label={
              canRedeem ? 'Bereit zur Auszahlung' : 'Auszahlungs-Schwelle'
            }
            current={`${cashbackEur.toFixed(2).replace('.', ',')} €`}
            required={`${payoutThreshold.toFixed(2).replace('.', ',')} €`}
            pct={pct}
          />
          {monthlyMaxCents > 0 ? (
            <Text
              style={{
                fontFamily,
                fontWeight: fontWeight.medium,
                fontSize: 11,
                color: 'rgba(255,255,255,0.8)',
                textAlign: 'center',
                marginTop: 8,
              }}
            >
              Monatslimit: max. {(monthlyMaxCents / 100).toFixed(2).replace('.', ',')} € Cashback pro Monat
            </Text>
          ) : null}
          </View>
        </LinearGradient>
        </View>

      </View>

      {/* ── Aktive Aktionen — echte Liste (mehrere gleichzeitig möglich,
          User wählt beim Einreichen die Aktion) ── */}
      {campaigns.length > 0 ? (
        <View style={{ paddingHorizontal: 20, paddingTop: 22 }}>
          <SectionHeader
            title="Aktive Aktionen"
            sub={`${campaigns.length} ${campaigns.length === 1 ? 'Aktion' : 'Aktionen'}`}
          />
          <View style={{ gap: 10, marginTop: 10 }}>
            {campaigns.map((c) => (
              <CampaignListItem key={c.id} campaign={c} onScanBon={onScanBon} scheme={scheme} />
            ))}
          </View>
        </View>
      ) : campaignsEnabled ? (
        <View style={{ paddingHorizontal: 20, paddingTop: 22 }}>
          <SectionHeader title="Aktive Aktionen" />
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 10,
              marginTop: 10,
              padding: 14,
              borderRadius: 16,
              backgroundColor: theme.surface,
            }}
          >
            <MaterialCommunityIcons name="tag-off-outline" size={20} color={theme.textMuted} />
            <Text
              style={{
                flex: 1,
                fontFamily,
                fontWeight: fontWeight.medium,
                fontSize: 12,
                color: theme.textMuted,
                lineHeight: 17,
              }}
            >
              Aktuell läuft keine Cashback-Aktion. Bons einreichen geht weiter — Vergütung gibt es mit der nächsten Aktion.
            </Text>
          </View>
        </View>
      ) : null}

      {/* ── Quick actions row ── */}
      <View style={{ paddingHorizontal: 20, paddingTop: 22 }}>
        {/* T17.27: Anchor um Section-Title + Card-Row, NICHT
            am padding-Wrapper. */}
        <View ref={earnAnchor.ref} onLayout={earnAnchor.onLayout}>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {earnActions.map((a) => (
            <QuickActionTile
              key={a.k}
              action={a}
              onCashbackTap={a.k === 'receipt' ? onScanBon : undefined}
            />
          ))}
        </View>
        </View>
      </View>

      {/* ── Bons-Verlauf row ── */}
      <View style={{ paddingHorizontal: 20, paddingTop: 10 }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Bons-Verlauf öffnen"
          onPress={() => router.push('/cashback/history')}
          style={({ pressed }) => ({
            flexDirection: 'row',
            alignItems: 'center',
            backgroundColor: theme.surface,
            borderRadius: 14,
            borderWidth: 1,
            borderColor: theme.border,
            paddingHorizontal: 14,
            paddingVertical: 12,
            gap: 12,
            opacity: pressed ? 0.9 : 1,
          })}
        >
          <View
            style={{
              width: 38,
              height: 38,
              borderRadius: 19,
              backgroundColor: (theme.primary ?? '#0d8575') + '18',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <MaterialCommunityIcons
              name="clipboard-list-outline"
              size={20}
              color={theme.primary ?? '#0d8575'}
            />
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text
              style={{
                fontFamily,
                fontWeight: fontWeight.bold,
                fontSize: 14,
                color: theme.text,
              }}
            >
              Meine Bons
            </Text>
            <Text
              style={{
                fontFamily,
                fontSize: 12,
                color: theme.textSub,
                marginTop: 2,
              }}
              numberOfLines={1}
            >
              Verlauf, Status & abgelehnte Bons ansehen
            </Text>
          </View>
          <MaterialCommunityIcons
            name="chevron-right"
            size={20}
            color={theme.textMuted}
          />
        </Pressable>
      </View>

      {/* ── Einlösen — ein Button, kein eigener Screen. Primary-getönt,
          gleiche Zeilen-Form wie „Meine Bons" darüber → die beiden
          Buttons sitzen dicht gruppiert. Partner-Auszahlung folgt. */}
      <View style={{ paddingHorizontal: 20, paddingTop: 10, paddingBottom: 8 }}>
        <Pressable
          ref={redeemAnchor.ref}
          onLayout={redeemAnchor.onLayout}
          accessibilityRole="button"
          accessibilityLabel="Cashback einlösen"
          onPress={() =>
            showInfoToast(
              canRedeem
                ? 'Auszahlung wird bald über unseren Partner verfügbar sein.'
                : `Noch ${gapEur} € bis zur ${payoutThreshold.toFixed(2).replace('.', ',')} €-Schwelle.`,
              'info',
              scheme,
            )
          }
          style={({ pressed }) => ({
            flexDirection: 'row',
            alignItems: 'center',
            gap: 12,
            backgroundColor: theme.primaryContainer ?? theme.surface,
            borderRadius: 14,
            paddingHorizontal: 14,
            paddingVertical: 12,
            opacity: pressed ? 0.9 : 1,
          })}
        >
          <View
            style={{
              width: 38,
              height: 38,
              borderRadius: 19,
              backgroundColor: (theme.primary ?? '#0d8575') + '22',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <MaterialCommunityIcons name="gift-outline" size={20} color={theme.primary} />
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={{ fontFamily, fontWeight: fontWeight.bold, fontSize: 14, color: theme.text }}>
              Cashback einlösen
            </Text>
            <Text
              style={{ fontFamily, fontSize: 12, color: theme.textSub, marginTop: 2 }}
              numberOfLines={1}
            >
              {canRedeem
                ? 'Bereit — Gutscheine, PayPal, Visa-Prepaid oder Spende'
                : `Noch ${gapEur} € bis zur ${payoutThreshold.toFixed(2).replace('.', ',')} €-Schwelle`}
            </Text>
          </View>
        </Pressable>
      </View>
    </>
  );
}

// ─── Aktive-Aktion Listen-Item ──────────────────────────────────────────
// Ausklappbare Card für die „Aktive Aktionen"-Liste. Eingeklappt:
// typ-Icon + Name (umbricht, wird NICHT abgeschnitten) + Sub-Beschreibung
// + Restlaufzeit-Pill + Verfügbarkeits-Balken. Ausgeklappt zusätzlich:
// volle Beschreibung, verfügbare Märkte + Aktions-Button (Kassenbon /
// Produktbilder / Umfrage — je nach `campaign.kind`). Kein grauer Rand.
const AnimatedCampaignCard = Animated.createAnimatedComponent(Pressable);

// Farbe + Icon je Aktions-Typ — 1:1 aus den Schnellzugriff-Tiles
// (buildEarnActions). `dark` = farbiges Tile mit weißer fg; Umfrage ist
// hell-grau mit dunkler fg. Siehe CLAUDE.md „Earn-Action-Farben".
const CAMPAIGN_KINDS: Record<
  NonNullable<ActiveCampaign['kind']>,
  { icon: keyof typeof MaterialCommunityIcons.glyphMap; bg: string; dark: boolean; cta: string }
> = {
  receipt: { icon: 'receipt', bg: '#0d8575', dark: true, cta: 'Kassenbon scannen' },
  product_photos: { icon: 'camera-plus-outline', bg: '#5b4f9c', dark: true, cta: 'Produktbilder einreichen' },
  survey: { icon: 'poll', bg: '#dde2e4', dark: false, cta: 'Umfrage starten' },
};

function CampaignListItem({
  campaign,
  onScanBon,
  scheme,
}: {
  campaign: ActiveCampaign;
  onScanBon: () => void;
  scheme: 'light' | 'dark';
}) {
  const { theme } = useTokens();
  const [expanded, setExpanded] = useState(false);

  const kind = campaign.kind ?? 'receipt';
  const meta = CAMPAIGN_KINDS[kind];
  const fg = meta.dark ? '#fff' : '#191c1d';

  const daysLeft = Math.max(0, Math.ceil((campaign.endMs - Date.now()) / 86_400_000));
  // Dringlichkeit: ≤1 Tag rot, ≤3 Tage gelb, sonst neutral.
  const urgentColor = daysLeft <= 1 ? '#ef4444' : daysLeft <= 3 ? '#f59e0b' : null;
  const pct =
    campaign.budgetTotalCents > 0
      ? Math.max(0, Math.min(100, Math.round((campaign.budgetRemainingCents / campaign.budgetTotalCents) * 100)))
      : 0;
  const budgetColor = pct > 50 ? '#10a18a' : pct > 15 ? '#f59e0b' : '#ef4444';

  const description = (campaign.description || '').trim() || 'Cashback auf deinen Einkauf';

  const fmtEur = (cents: number) =>
    (cents / 100).toLocaleString('de-DE', { minimumFractionDigits: 0, maximumFractionDigits: 0 });

  const onAction = () => {
    if (kind === 'receipt') {
      onScanBon();
    } else if (kind === 'product_photos') {
      showInfoToast('Produktbilder-Einreichung ist bald verfügbar.', 'info', scheme);
    } else {
      showInfoToast('Aktuell ist keine Umfrage verfügbar.', 'info', scheme);
    }
  };

  return (
    <AnimatedCampaignCard
      layout={LinearTransition.duration(220)}
      onPress={() => setExpanded((v) => !v)}
      style={{
        padding: 14,
        borderRadius: 16,
        backgroundColor: theme.surface,
        overflow: 'hidden',
      }}
    >
      {/* Kopf: typ-Icon | Name (umbricht) + Beschreibung | Restlaufzeit + Chevron */}
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
        <View
          style={{
            width: 38,
            height: 38,
            borderRadius: 19,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: meta.bg,
          }}
        >
          <MaterialCommunityIcons name={meta.icon} size={19} color={fg} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text
            style={{
              fontFamily,
              fontWeight: fontWeight.extraBold,
              fontSize: 15,
              color: theme.text,
              letterSpacing: -0.2,
            }}
          >
            {campaign.title || 'Cashback-Aktion'}
          </Text>
          <Text
            numberOfLines={expanded ? undefined : 1}
            style={{
              fontFamily,
              fontWeight: fontWeight.medium,
              fontSize: 11,
              color: theme.textMuted,
              marginTop: 2,
              lineHeight: 15,
            }}
          >
            {description}
          </Text>
        </View>
        <View style={{ alignItems: 'flex-end', gap: 6 }}>
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 4,
              paddingHorizontal: 9,
              paddingVertical: 5,
              borderRadius: 999,
              backgroundColor: urgentColor ? urgentColor + '1c' : theme.surfaceAlt ?? theme.bg,
            }}
          >
            <MaterialCommunityIcons name="clock-outline" size={12} color={urgentColor ?? theme.textMuted} />
            <Text style={{ fontFamily, fontWeight: fontWeight.bold as any, fontSize: 11, color: urgentColor ?? theme.text }}>
              {daysLeft === 0 ? 'Letzter Tag' : `noch ${daysLeft} ${daysLeft === 1 ? 'Tag' : 'Tage'}`}
            </Text>
          </View>
          <MaterialCommunityIcons
            name={expanded ? 'chevron-up' : 'chevron-down'}
            size={18}
            color={theme.textMuted}
          />
        </View>
      </View>

      {/* Verfügbarkeits-Balken (immer sichtbar) */}
      <View style={{ marginTop: 12 }}>
        <View
          style={{
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'baseline',
            marginBottom: 6,
          }}
        >
          <Text style={{ fontFamily, fontWeight: fontWeight.bold as any, fontSize: 11, color: theme.textMuted }}>
            {fmtEur(campaign.budgetRemainingCents)} € von {fmtEur(campaign.budgetTotalCents)} € übrig
          </Text>
          <Text style={{ fontFamily, fontWeight: fontWeight.extraBold, fontSize: 11, color: budgetColor }}>
            {pct}%
          </Text>
        </View>
        <View style={{ height: 6, borderRadius: 3, backgroundColor: theme.surfaceAlt ?? theme.border, overflow: 'hidden' }}>
          <View style={{ width: `${pct}%`, height: '100%', borderRadius: 3, backgroundColor: budgetColor }} />
        </View>
      </View>

      {/* Ausgeklappt: Märkte + Details + Aktions-Button */}
      {expanded ? (
        <View style={{ marginTop: 14, gap: 12 }}>
          {/* Konfigurierte Eckdaten als Chips */}
          {(typeof campaign.cashbackPerBonCents === 'number' && campaign.cashbackPerBonCents > 0) ||
          (typeof campaign.minItems === 'number' && campaign.minItems > 0) ? (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
              {typeof campaign.cashbackPerBonCents === 'number' && campaign.cashbackPerBonCents > 0 ? (
                <CampaignChip
                  theme={theme}
                  icon="cash"
                  label={`${(campaign.cashbackPerBonCents / 100).toFixed(2).replace('.', ',')} € pro Bon`}
                />
              ) : null}
              {typeof campaign.minItems === 'number' && campaign.minItems > 0 ? (
                <CampaignChip theme={theme} icon="basket-outline" label={`ab ${campaign.minItems} Artikeln`} />
              ) : null}
            </View>
          ) : null}

          {/* Aktions-Button — je nach Aktions-Typ */}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={meta.cta}
            onPress={onAction}
            style={({ pressed }) => ({
              height: 46,
              borderRadius: 12,
              backgroundColor: meta.bg,
              alignItems: 'center',
              justifyContent: 'center',
              flexDirection: 'row',
              gap: 8,
              opacity: pressed ? 0.9 : 1,
            })}
          >
            <MaterialCommunityIcons name={meta.icon} size={18} color={fg} />
            <Text style={{ fontFamily, fontWeight: fontWeight.extraBold, fontSize: 14, color: fg, letterSpacing: 0.2 }}>
              {meta.cta}
            </Text>
          </Pressable>
        </View>
      ) : null}
    </AnimatedCampaignCard>
  );
}

// Kleiner getönter Chip für Aktions-Eckdaten + Märkte.
function CampaignChip({
  theme,
  icon,
  label,
}: {
  theme: ReturnType<typeof useTokens>['theme'];
  icon: string;
  label: string;
}) {
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        paddingHorizontal: 9,
        paddingVertical: 5,
        borderRadius: 999,
        backgroundColor: theme.surfaceAlt ?? theme.bg,
      }}
    >
      <MaterialCommunityIcons name={icon as any} size={12} color={theme.textMuted} />
      <Text style={{ fontFamily, fontWeight: fontWeight.bold as any, fontSize: 11, color: theme.text }}>{label}</Text>
    </View>
  );
}

// ─── "So geht's" help sheet content ─────────────────────────────────────
//
// Rendered inside the shared `FilterSheet` (which provides chrome:
// drag handle, title row, animations, backdrop). The body is split
// into TWO sections matching the screen's two tabs:
//   • Einlösen — Cashback-Taler model + earn methods + payout
//   • Bestenliste — Detektiv-Punkte, Levels, Streak, Liga
// Each section gets a small icon-prefix header so the user can
// jump straight to the half they care about.

function RewardsHelpContent() {
  return (
    <View style={{ paddingBottom: 8 }}>
      {/* ── Einlösen / Cashback-Taler ── */}
      <HelpSectionHeader
        icon="treasure-chest"
        title="Einlösen — Cashback-Taler"
      />
      <HelpBlock
        icon="treasure-chest"
        iconColor="#0d8575"
        title="Cashback-Taler"
        body="Sammle Cashback-Taler bei jeder Aktion (Bons hochladen, Produktbilder einreichen, Umfragen beantworten). Ab 10 € Guthaben kannst du auszahlen lassen."
      />
      <HelpBlock
        icon="receipt"
        iconColor="#0d8575"
        title="Kassenbon hochladen"
        body="Bis zu 0,08 € pro Bon, max. 6 Bons pro Woche. Wir erkennen automatisch den Markt und die gekauften Produkte für unsere Markt-Insights."
      />
      <HelpBlock
        icon="camera-outline"
        iconColor="#5b4f9c"
        title="Produktbilder einreichen"
        body="0,10 € pro Produkt-Set (7 Fotos: Front, Rückseite, Barcode, Zutaten, Nährwerte, Hersteller, Preis). Hilft uns, die Datenbank vollständig zu halten."
      />
      <HelpBlock
        icon="poll"
        iconColor="#dde2e4"
        title="Umfragen"
        body="0,20 € – 2,00 € je nach Länge. Nur verfügbar, wenn gerade eine passende Umfrage aktiv ist — wir benachrichtigen dich automatisch."
      />
      <HelpBlock
        icon="gift-outline"
        iconColor="#0d8575"
        title="Auszahlung"
        body="Tausche dein Cashback bei unseren Partnern in Gutscheine (Amazon, Rewe, Apple…), eine PayPal-Auszahlung, eine Visa-Prepaid oder eine Spende um."
      />

      {/* ── Bestenliste / Detektiv-Punkte ── */}
      <HelpSectionHeader
        icon="trophy-outline"
        title="Bestenliste — Detektiv-Punkte"
      />
      <HelpBlock
        icon="star-four-points"
        iconColor="#f5b301"
        title="Detektiv-Punkte sammeln"
        body="Produkt scannen +2 · Suchen +1 · Vergleich anschauen +3 · Einkaufszettel abschließen +5 · Bewertung schreiben +2 · erste Aktion +10."
      />
      <HelpBlock
        icon="star-circle"
        iconColor="#bf8636"
        title="Levels & Aufstieg"
        body="Mit Punkten und Ersparnissen steigst du im Level auf. Jedes Level schaltet eine neue Produktkategorie frei (Veggie, Getränke, Baby, …)."
      />
      <HelpBlock
        icon="fire"
        iconColor="#ffb84a"
        title="Streak & Freezes"
        body="Sei jeden Tag aktiv und deine Streak wächst. Verpasst du einen Tag, schützt dich ein Freeze-Token (alle 14 Tage gibt's einen, max. 2 gleichzeitig)."
      />
      <HelpBlock
        icon="map-marker-radius"
        iconColor="#0d6efd"
        title="Liga & Region"
        body="In der Bestenliste vergleichst du dich mit ganz Deutschland — als einzelner Detektiv (Overall) oder als Region (Bundesländer + Städte). Wird täglich aktualisiert."
      />
    </View>
  );
}

function HelpSectionHeader({
  icon,
  title,
}: {
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
  title: string;
}) {
  const { theme } = useTokens();
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        marginBottom: 14,
        // Extra top-margin only when this header doesn't sit at the
        // very top of the sheet (i.e. for the second section). The
        // first one already has padding via FilterSheet content.
        marginTop: 4,
      }}
    >
      <MaterialCommunityIcons name={icon} size={16} color={theme.primary} />
      <Text
        style={{
          fontFamily,
          fontWeight: fontWeight.extraBold,
          fontSize: 13,
          color: theme.primary,
          letterSpacing: 0.5,
          textTransform: 'uppercase',
        }}
      >
        {title}
      </Text>
      <View
        style={{
          flex: 1,
          height: 1,
          backgroundColor: theme.border,
          marginLeft: 4,
        }}
      />
    </View>
  );
}

function HelpBlock({
  icon,
  iconColor,
  title,
  body,
}: {
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
  iconColor: string;
  title: string;
  body: string;
}) {
  const { theme } = useTokens();
  return (
    <View
      style={{
        flexDirection: 'row',
        gap: 12,
        marginBottom: 14,
      }}
    >
      <View
        style={{
          width: 36,
          height: 36,
          borderRadius: 10,
          backgroundColor: theme.surfaceAlt,
          alignItems: 'center',
          justifyContent: 'center',
          marginTop: 1,
        }}
      >
        <MaterialCommunityIcons name={icon} size={18} color={iconColor} />
      </View>
      <View style={{ flex: 1 }}>
        <Text
          style={{
            fontFamily,
            fontWeight: fontWeight.extraBold,
            fontSize: 14,
            color: theme.text,
            marginBottom: 2,
          }}
        >
          {title}
        </Text>
        <Text
          style={{
            fontFamily,
            fontWeight: fontWeight.medium,
            fontSize: 12,
            lineHeight: 17,
            color: theme.textSub ?? theme.textMuted,
          }}
        >
          {body}
        </Text>
      </View>
    </View>
  );
}

// ─── Sub-components ────────────────────────────────────────────────────

function SectionHeader({ title, sub }: { title: string; sub?: string }) {
  const { theme } = useTokens();
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'baseline',
        justifyContent: 'space-between',
      }}
    >
      <Text
        style={{
          fontFamily,
          fontWeight: fontWeight.extraBold,
          fontSize: 20,
          color: theme.text,
          letterSpacing: -0.2,
        }}
      >
        {title}
      </Text>
      {sub ? (
        <Text
          style={{
            fontFamily,
            fontWeight: fontWeight.medium,
            fontSize: 12,
            color: theme.textMuted,
          }}
        >
          {sub}
        </Text>
      ) : null}
    </View>
  );
}

function QuickActionTile({
  action,
  onCashbackTap,
}: {
  action: EarnAction;
  onCashbackTap?: () => void;
}) {
  const fg = action.dark ? '#fff' : '#191c1d';
  // Bar fill colour: white-overlay on dark tiles, brand teal on light.
  const barTrack = action.dark ? 'rgba(255,255,255,0.22)' : 'rgba(0,0,0,0.08)';
  const barFill = action.dark ? '#fff' : '#0d8575';
  const showProgress = typeof action.progress === 'number';
  return (
    <Pressable
      onPress={() => {
        // 'receipt' = Bon-Scan via Cashback-Flow (Consent → Capture →
        // Review → Pending). NOT the barcode scanner — that's a
        // completely separate Stöbern-flow for product lookup.
        if (action.k === 'receipt') {
          onCashbackTap?.();
        }
        // photo + survey wire up later
      }}
      style={({ pressed }) => ({
        flex: 1,
        minHeight: 112,
        backgroundColor: action.bg,
        borderRadius: 14,
        padding: 12,
        justifyContent: 'space-between',
        opacity: pressed ? 0.85 : 1,
      })}
    >
      {/* Top row — icon left, reward chip top-right corner. */}
      <View
        style={{
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
        }}
      >
        <MaterialCommunityIcons name={action.icon} size={22} color={fg} />
        <View
          style={{
            paddingHorizontal: 6,
            paddingVertical: 2,
            borderRadius: 4,
            backgroundColor: action.dark
              ? 'rgba(255,255,255,0.2)'
              : 'rgba(13,133,117,0.14)',
          }}
        >
          <Text
            style={{
              fontFamily,
              fontWeight: fontWeight.extraBold,
              fontSize: 9,
              letterSpacing: 0.4,
              color: action.dark ? '#fff' : '#0d8575',
            }}
          >
            {action.reward}
          </Text>
        </View>
      </View>

      <View>
        <Text
          style={{
            fontFamily,
            fontWeight: fontWeight.bold,
            fontSize: 12,
            lineHeight: 14,
            color: fg,
          }}
        >
          {action.label}
        </Text>

        <Text
          numberOfLines={1}
          style={{
            fontFamily,
            fontWeight: fontWeight.medium,
            fontSize: 10,
            color: action.dark ? 'rgba(255,255,255,0.85)' : 'rgba(0,0,0,0.55)',
            marginTop: 6,
          }}
        >
          {action.statusLabel}
        </Text>

        {showProgress ? (
          <View
            style={{
              height: 3,
              borderRadius: 2,
              backgroundColor: barTrack,
              marginTop: 4,
              overflow: 'hidden',
            }}
          >
            <View
              style={{
                width: `${Math.min(100, Math.round((action.progress ?? 0) * 100))}%`,
                height: '100%',
                backgroundColor: barFill,
              }}
            />
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}

// HeroPill + ProgressBar — small white-on-gradient atoms used inside
// the cashback hero card. Same shapes as the Bestenliste hero (also
// duplicated in components/rewards/Bestenliste.tsx) — kept inline
// here so RedeemTab has zero cross-file deps for its hero.
function HeroPill({
  icon,
  label,
}: {
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
  label: string;
}) {
  return (
    <View
      style={{
        alignSelf: 'flex-start',
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        paddingHorizontal: 8,
        paddingVertical: 3,
        borderRadius: 10,
        backgroundColor: 'rgba(255,255,255,0.22)',
      }}
    >
      <MaterialCommunityIcons name={icon} size={11} color="#ffd44b" />
      <Text
        numberOfLines={1}
        style={{
          fontFamily,
          fontWeight: fontWeight.extraBold,
          fontSize: 10,
          color: '#fff',
          letterSpacing: 0.4,
        }}
      >
        {label}
      </Text>
    </View>
  );
}

function ProgressBar({
  icon,
  label,
  current,
  required,
  pct,
}: {
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
  label: string;
  current: string;
  required: string;
  pct: number;
}) {
  return (
    <View>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          marginBottom: 5,
        }}
      >
        <MaterialCommunityIcons
          name={icon}
          size={13}
          color="#fff"
          style={{ opacity: 0.95 }}
        />
        <Text
          numberOfLines={1}
          style={{
            flex: 1,
            marginLeft: 6,
            fontFamily,
            fontWeight: fontWeight.bold,
            fontSize: 12,
            color: '#fff',
            opacity: 0.95,
          }}
        >
          {label}
        </Text>
        <Text
          style={{
            fontFamily,
            fontWeight: fontWeight.extraBold,
            fontSize: 12,
            color: '#fff',
          }}
        >
          {current} / {required}
        </Text>
      </View>
      <View
        style={{
          height: 5,
          backgroundColor: 'rgba(255,255,255,0.22)',
          borderRadius: 3,
          overflow: 'hidden',
        }}
      >
        <View
          style={{
            width: `${Math.max(0, Math.min(100, pct))}%`,
            height: '100%',
            backgroundColor: '#fff',
            borderRadius: 3,
          }}
        />
      </View>
    </View>
  );
}

