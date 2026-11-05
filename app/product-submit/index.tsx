/**
 * Product-photo submissions overview ("Produktbilder — voller Datensatz").
 * Purple theme to distinguish from cashback bons. Lists the user's
 * submitted products (same card UI as the bon history) with status; opens
 * the wizard via the CTA. Cashback only shown while a product-photo
 * campaign is running.
 */

import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { Image as ExpoImage } from 'expo-image';
import { router, useNavigation } from 'expo-router';
import { safePush } from '@/lib/utils/safeNav';
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getDownloadURL, ref as storageRef } from '@react-native-firebase/storage';

import { DetailHeader, DETAIL_HEADER_ROW_HEIGHT } from '@/components/design/DetailHeader';
import { FilterSheet, OptionList } from '@/components/design/FilterSheet';
import { KontoSichernKarte } from '@/components/rewards/KontoSichernKarte';
import { fontFamilyVariants, fontWeight, radii } from '@/constants/tokens';
import { storage } from '@/lib/firebase';
import { useTokens } from '@/hooks/useTokens';
import { useAuth } from '@/lib/contexts/AuthContext';
import { hasValidCashbackConsent } from '@/lib/services/cashbackService';
import {
  PRODUCT_PHOTO_STEPS,
  getActiveProductCampaign,
  getActiveProductCampaigns,
  subscribeUserProductSubmissions,
  type ActiveProductCampaign,
  type ProductPhotoStep,
  type ProductSubmissionEntry,
} from '@/lib/services/productSubmit';
import {
  kickUploadQueue,
  removeJob,
  retryAllFailed,
  retryJob,
  sichtbareUploadJobs,
  subscribeUploadQueue,
  type UploadJob,
} from '@/lib/services/uploadQueue';
import { useNetworkStatus } from '@/lib/services/network';
import { setChosenProductCampaignId } from '@/lib/services/productCampaignChoice';
import { describeSubmission, type SubmissionStatusCopy } from '@/lib/utils/productSubmissionCopy';

const PURPLE = '#5b4f9c';
/** Bis hierhin Karten-Raster, darüber eine Auswahl-Zeile mit Sheet.
 *  Drei Karten passen über zwei Reihen, ohne den Erfassen-Knopf aus dem
 *  ersten Bildschirm zu drängen. */
const GRID_MAX = 3;

// 86cbam5ep: Status + Grund kommen aus describeSubmission (eine Quelle für
// Chip, Zeile und Detail-Karte). Farben je Tönung; kein „Abgelehnt"-Rot mehr —
// der Nutzer soll lernen, nicht sich schämen (Copy-Ton).
function toneVisual(copy: SubmissionStatusCopy) {
  switch (copy.tone) {
    case 'ok':
      return { color: '#2e7d32', bg: 'rgba(46,125,50,0.12)' };
    case 'held':
      return { color: '#8a5a00', bg: 'rgba(176,136,0,0.14)' };
    case 'pending':
    default:
      return { color: '#b08800', bg: 'rgba(176,136,0,0.12)' };
  }
}
function statusVisual(entry: ProductSubmissionEntry) {
  const copy = describeSubmission(entry);
  return { ...toneVisual(copy), label: copy.label, icon: copy.icon, copy };
}

const STEP_LABEL: Record<ProductPhotoStep, string> = PRODUCT_PHOTO_STEPS.reduce(
  (acc, s) => {
    acc[s.key] = s.label;
    return acc;
  },
  {} as Record<ProductPhotoStep, string>,
);

/** Normalize a country code/name to a SHORT 2-letter code (DE/AT/CH …).
 *  User-Vorgabe: Land bei eingereichten Produkten abgekürzt, nicht
 *  ausgeschrieben. Vollnamen + Codes werden auf den ISO-Code gemappt;
 *  Unbekanntes bleibt unverändert (ist i.d.R. schon ein Code). */
function normalizeLand(land?: string | null): string | null {
  if (!land) return null;
  const map: { [k: string]: string } = {
    DE: 'DE',
    Germany: 'DE',
    Deutschland: 'DE',
    AT: 'AT',
    Austria: 'AT',
    Österreich: 'AT',
    CH: 'CH',
    Switzerland: 'CH',
    Schweiz: 'CH',
  };
  return map[land] || land;
}

function formatAbsolute(ts?: any): string {
  const ms = ts?.toMillis?.() ?? 0;
  if (!ms) return '';
  return new Date(ms).toLocaleString('de-DE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatRelative(ts?: any): string {
  const ms = ts?.toMillis?.() ?? 0;
  if (!ms) return '';
  const diff = Date.now() - ms;
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'gerade eben';
  if (min < 60) return `vor ${min} Min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `vor ${h} Std`;
  const d = Math.floor(h / 24);
  if (d === 1) return 'gestern';
  if (d < 7) return `vor ${d} Tagen`;
  return new Date(ms).toLocaleDateString('de-DE');
}

export default function ProductSubmitOverview() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const { theme, shadows } = useTokens();
  const [rows, setRows] = useState<ProductSubmissionEntry[]>([]);
  const [rohQueue, setQueue] = useState<UploadJob[]>([]);
  const net = useNetworkStatus();
  const [loaded, setLoaded] = useState(false);
  const [campaign, setCampaign] = useState<ActiveProductCampaign | null>(null);
  // Alle laufenden Produktaktionen — bei mehr als einer wählt der Nutzer hier,
  // für welche er erfasst (05.09.2026; vorher gewann stumm die oberste).
  const [campaigns, setCampaigns] = useState<ActiveProductCampaign[]>([]);
  // Ab GRID_MAX Aktionen wird aus dem Karten-Raster eine Auswahl-Zeile mit
  // Sheet: zehn Karten würden den „Produkt erfassen"-Knopf aus dem Bild
  // schieben, und horizontales Scrollen versteckt Optionen, statt sie zu
  // zeigen. Im Sheet stehen alle untereinander (OptionList, gleicher Haken).
  const [pickerOpen, setPickerOpen] = useState(false);
  // Tapped submission → detail sheet. URLs are resolved lazily (Storage
  // paths → download URLs) only when a row is opened.
  const [detailRow, setDetailRow] = useState<ProductSubmissionEntry | null>(null);
  const [detailUrls, setDetailUrls] = useState<Partial<Record<ProductPhotoStep, string>>>({});

  useLayoutEffect(() => {
    navigation.setOptions({ headerShown: false });
  }, [navigation]);

  useEffect(() => {
    const unsub = subscribeUserProductSubmissions((r) => {
      setRows(r);
      setLoaded(true);
    });
    return unsub;
  }, []);

  // In-flight background uploads (the single status surface). Kick the
  // queue on mount so any offline/failed jobs resume now that we're here.
  useEffect(() => {
    const unsub = subscribeUploadQueue(setQueue);
    kickUploadQueue();
    return unsub;
  }, []);

  useEffect(() => {
    let alive = true;
    Promise.all([getActiveProductCampaigns(), getActiveProductCampaign()]).then(([list, c]) => {
      if (!alive) return;
      setCampaigns(list);
      setCampaign(c);
    });
    return () => {
      alive = false;
    };
  }, []);

  const chooseCampaign = useCallback((c: ActiveProductCampaign) => {
    setCampaign(c);
    void setChosenProductCampaignId(c.campaignId);
  }, []);

  /** „0,16 €" bzw. null, wenn die Aktion keinen Betrag je Datensatz definiert. */
  const rewardLabel = useCallback(
    (c: ActiveProductCampaign) => (c.rewardCents > 0 ? `${(c.rewardCents / 100).toFixed(2).replace('.', ',')} €` : null),
    [],
  );

  // Hard guard (86cagb5gh, Spiegel von cashback/capture.tsx): Läuft gerade
  // eine product_photos-Aktion MIT Reward und der Consent fehlt, zurück in
  // den Consent (Produktbilder-Variante) — fängt Deep-Links/alte Callsites,
  // die am Gate-Service (startProductSubmitFlow) vorbei hierher routen.
  // OHNE laufende Aktion bleibt der Screen ungegatet (Datensammlung ist
  // immer möglich, auch anonym).
  const { user, isAnonymous } = useAuth();
  // Nur Aufträge dieses Kontos (oder vom Server bestätigt übernommene) —
  // nach einem Kontowechsel wartende Gast-Aufträge gehören nicht hierher.
  const queue = useMemo(() => sichtbareUploadJobs(rohQueue), [rohQueue, user?.uid]);
  useEffect(() => {
    if (!campaign || campaign.rewardCents <= 0) return;
    let alive = true;
    (async () => {
      const valid = user?.uid ? await hasValidCashbackConsent(user.uid) : false;
      if (alive && !valid) router.replace('/cashback/consent?from=product' as any);
    })();
    return () => {
      alive = false;
    };
  }, [campaign, user?.uid]);

  // Resolve the selected submission's image paths to download URLs.
  useEffect(() => {
    if (!detailRow?.images) {
      setDetailUrls({});
      return;
    }
    let alive = true;
    setDetailUrls({});
    const entries = Object.entries(detailRow.images) as [ProductPhotoStep, string][];
    Promise.all(
      entries.map(async ([step, path]) => {
        try {
          const url = await getDownloadURL(storageRef(storage, path));
          return [step, url] as const;
        } catch {
          return null;
        }
      }),
    ).then((pairs) => {
      if (!alive) return;
      const next: Partial<Record<ProductPhotoStep, string>> = {};
      pairs.forEach((p) => {
        if (p) next[p[0]] = p[1];
      });
      setDetailUrls(next);
    });
    return () => {
      alive = false;
    };
  }, [detailRow]);

  const total = rows.length;
  const headerOffset = insets.top + DETAIL_HEADER_ROW_HEIGHT;
  const stepTotal = PRODUCT_PHOTO_STEPS.length;
  const rewardEur =
    campaign && campaign.rewardCents > 0
      ? (campaign.rewardCents / 100).toFixed(2).replace('.', ',')
      : null;

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <DetailHeader title="Produktbilder" onBack={() => router.back()} />

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingTop: headerOffset + 8, paddingBottom: insets.bottom + 110 }}
        showsVerticalScrollIndicator={false}
      >
        {/* Hero */}
        <View style={{ marginHorizontal: 16 }}>
          <View style={{ borderRadius: radii.xl, backgroundColor: PURPLE, padding: 16, gap: 6, ...(shadows.md ?? {}) }}>
            <Text style={{ color: '#fff', fontFamily: fontFamilyVariants.heading, fontWeight: fontWeight.extraBold as any, fontSize: 18 }}>
              Vollen Datensatz einreichen
            </Text>
            <Text style={{ color: 'rgba(255,255,255,0.9)', fontFamily: fontFamilyVariants.body, fontSize: 13, lineHeight: 19 }}>
              Fotografiere ein Produkt aus {stepTotal} Ansichten (Front, Rückseite, Hersteller, EAN, Nährwerte, Zutaten, Preis) und hilf, unsere Datenbank zu vervollständigen.
            </Text>
            {rewardEur ? (
              <Text style={{ color: '#ffd44b', fontFamily: fontFamilyVariants.body, fontWeight: fontWeight.bold as any, fontSize: 13, marginTop: 2 }}>
                Aktuell {rewardEur} € pro komplettem Datensatz
              </Text>
            ) : null}
          </View>
        </View>

        {/* Aktions-Auswahl — nur wenn mehrere Produktaktionen laufen. Gleiches
            Muster wie ScopeCard (Belohnungen): aktive Karte = primaryContainer
            + 1.5px Primary-Rand. Die Wahl gilt für den Wizard (Single Source:
            productCampaignChoice) und bleibt über App-Starts erhalten. */}
        {campaigns.length > 1 ? (
          <View style={{ marginHorizontal: 16, marginTop: 12, gap: 8 }}>
            <Text style={{ fontFamily: fontFamilyVariants.body, fontWeight: fontWeight.semibold as any, fontSize: 12, color: theme.textMuted, letterSpacing: 0.3 }}>
              FÜR WELCHE AKTION ERFASST DU?
            </Text>
            {campaigns.length <= GRID_MAX ? (
              <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
                {campaigns.map((c) => {
                  const active = campaign?.campaignId === c.campaignId;
                  const eur = rewardLabel(c);
                  return (
                    <Pressable
                      key={c.campaignId}
                      accessibilityRole="button"
                      accessibilityState={{ selected: active }}
                      onPress={() => chooseCampaign(c)}
                      style={{
                        flexGrow: 1,
                        flexBasis: '45%',
                        minHeight: 50,
                        borderRadius: radii.md,
                        paddingHorizontal: 10,
                        paddingVertical: 8,
                        backgroundColor: active ? theme.primaryContainer : theme.surface,
                        borderWidth: active ? 1.5 : 1,
                        borderColor: active ? theme.primary : theme.border,
                        ...(active ? shadows.sm ?? {} : {}),
                      }}
                    >
                      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 6 }}>
                        <Text numberOfLines={2} style={{ flex: 1, fontFamily: fontFamilyVariants.body, fontWeight: fontWeight.extraBold as any, fontSize: 13, color: theme.text }}>
                          {c.title}
                        </Text>
                        {/* Der Haken macht die Auswahl auch ohne Farbvergleich
                            erkennbar (Rand allein reicht bei Rot-Grün-Schwäche nicht). */}
                        {active ? (
                          <MaterialCommunityIcons name="check-circle" size={18} color={theme.primary} style={{ marginTop: -1 }} />
                        ) : null}
                      </View>
                      <Text style={{ fontFamily: fontFamilyVariants.body, fontWeight: fontWeight.medium as any, fontSize: 10, color: theme.textMuted, marginTop: 2 }}>
                        {eur ? `${eur} pro Datensatz` : 'Ohne Prämie — hilft der Datenbank'}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            ) : (
              <Pressable
                accessibilityRole="button"
                accessibilityHint="Öffnet die Liste aller laufenden Aktionen"
                onPress={() => setPickerOpen(true)}
                style={{
                  minHeight: 50,
                  borderRadius: radii.md,
                  paddingHorizontal: 12,
                  paddingVertical: 9,
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 10,
                  backgroundColor: theme.primaryContainer,
                  borderWidth: 1.5,
                  borderColor: theme.primary,
                  ...(shadows.sm ?? {}),
                }}
              >
                <MaterialCommunityIcons name="check-circle" size={20} color={theme.primary} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text numberOfLines={1} style={{ fontFamily: fontFamilyVariants.body, fontWeight: fontWeight.extraBold as any, fontSize: 13, color: theme.text }}>
                    {campaign?.title ?? 'Aktion wählen'}
                  </Text>
                  <Text style={{ fontFamily: fontFamilyVariants.body, fontWeight: fontWeight.medium as any, fontSize: 10, color: theme.textMuted, marginTop: 2 }}>
                    {campaign
                      ? `${rewardLabel(campaign) ? rewardLabel(campaign) + ' pro Datensatz' : 'Ohne Prämie'} · ${campaigns.length} Aktionen zur Auswahl`
                      : `${campaigns.length} Aktionen zur Auswahl`}
                  </Text>
                </View>
                <MaterialCommunityIcons name="chevron-down" size={20} color={theme.textMuted} />
              </Pressable>
            )}
          </View>
        ) : null}

        {/* CTA */}
        <View style={{ marginHorizontal: 16, marginTop: 12 }}>
          <Pressable
            onPress={() => safePush('/product-submit/wizard')}
            style={({ pressed }) => ({
              height: 52,
              borderRadius: 14,
              backgroundColor: PURPLE,
              alignItems: 'center',
              justifyContent: 'center',
              flexDirection: 'row',
              gap: 8,
              opacity: pressed ? 0.9 : 1,
            })}
          >
            <MaterialCommunityIcons name="camera-plus-outline" size={18} color="#fff" />
            <Text style={{ color: '#fff', fontFamily: fontFamilyVariants.body, fontWeight: fontWeight.bold as any, fontSize: 15 }}>
              Produkt erfassen
            </Text>
          </Pressable>
        </View>

        {/* Gäste mit mindestens einer Einreichung oder einem Auftrag:
            Belohnung per Konto sichern. */}
        {isAnonymous && (total > 0 || queue.length > 0) ? (
          <View style={{ marginHorizontal: 16, marginTop: 12 }}>
            <KontoSichernKarte ziel="/product-submit" />
          </View>
        ) : null}

        {/* Background upload queue — the single status surface for in-flight
            uploads. One row per job (progress + retry), no overlays even when
            many submissions wait offline. Jobs disappear here and reappear as
            'In Prüfung' below once their Firestore doc is written. */}
        {queue.length > 0 ? (
          <View>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, marginTop: 22, marginBottom: 10 }}>
              <Text style={{ color: theme.text, fontFamily: fontFamilyVariants.heading, fontWeight: fontWeight.extraBold as any, fontSize: 20, letterSpacing: -0.2 }}>
                Wird hochgeladen
              </Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
                {queue.filter((j) => j.status === 'failed').length > 1 ? (
                  <Pressable onPress={() => retryAllFailed()} hitSlop={8}>
                    <Text style={{ color: PURPLE, fontFamily: fontFamilyVariants.body, fontWeight: fontWeight.bold as any, fontSize: 13 }}>
                      Alle erneut
                    </Text>
                  </Pressable>
                ) : null}
                <Text style={{ color: theme.textMuted ?? theme.textSub, fontFamily: fontFamilyVariants.body, fontSize: 12 }}>
                  {queue.length}
                </Text>
              </View>
            </View>
            {!net.online ? (
              <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center', backgroundColor: 'rgba(176,136,0,0.10)', borderRadius: radii.lg, borderWidth: 1, borderColor: 'rgba(176,136,0,0.25)', paddingHorizontal: 14, paddingVertical: 12, marginHorizontal: 16, marginBottom: 10 }}>
                <MaterialCommunityIcons name="wifi-off" size={20} color="#b08800" />
                <Text style={{ flex: 1, color: theme.textSub, fontFamily: fontFamilyVariants.body, fontSize: 13, lineHeight: 18 }}>
                  Kein Internet — deine Uploads starten automatisch, sobald die Verbindung wieder da ist.
                </Text>
              </View>
            ) : null}
            {queue.map((j) => {
              const failed = j.status === 'failed';
              const uploading = j.status === 'uploading';
              const title = j.productName || `Produkt ${j.productIndex ?? ''}`.trim();
              const land = normalizeLand(j.marketLand);
              const marketLine = j.marketName ? `${j.marketName}${land ? ` (${land})` : ''}` : '';
              const accent = failed ? '#d6603a' : PURPLE;
              const icon = failed ? 'cloud-alert' : uploading ? 'cloud-upload-outline' : 'cloud-clock-outline';
              const statusLabel = failed
                ? 'Upload fehlgeschlagen'
                : uploading
                  ? `Wird hochgeladen … ${j.progress} %`
                  : net.online
                    ? 'In der Warteschlange …'
                    : 'Wartet auf Internetverbindung …';
              return (
                <View
                  key={j.id}
                  style={{
                    flexDirection: 'row',
                    alignItems: failed ? 'flex-start' : 'center',
                    backgroundColor: theme.surface,
                    borderRadius: radii.lg,
                    borderWidth: 1,
                    borderColor: failed ? 'rgba(214,96,58,0.35)' : theme.border ?? 'rgba(0,0,0,0.06)',
                    paddingHorizontal: 14,
                    paddingVertical: 14,
                    marginHorizontal: 16,
                    marginBottom: 10,
                    gap: 12,
                  }}
                >
                  <View style={{ width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: failed ? 'rgba(214,96,58,0.12)' : 'rgba(91,79,156,0.12)' }}>
                    <MaterialCommunityIcons name={icon as any} size={22} color={accent} />
                  </View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text numberOfLines={1} style={{ color: theme.text, fontFamily: fontFamilyVariants.heading, fontWeight: fontWeight.extraBold as any, fontSize: 16, letterSpacing: -0.2 }}>
                      {title}
                    </Text>
                    {marketLine ? (
                      <Text numberOfLines={1} style={{ color: theme.textSub, fontFamily: fontFamilyVariants.body, fontSize: 12, marginTop: 2 }}>
                        {marketLine}
                      </Text>
                    ) : null}
                    <Text numberOfLines={1} style={{ color: accent, fontFamily: fontFamilyVariants.body, fontWeight: fontWeight.medium as any, fontSize: 12, marginTop: 4 }}>
                      {statusLabel}
                    </Text>
                    {failed ? (
                      <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
                        <Pressable
                          onPress={() => retryJob(j.id)}
                          style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: PURPLE, paddingHorizontal: 12, paddingVertical: 7, borderRadius: radii.md, opacity: pressed ? 0.85 : 1 })}
                        >
                          <MaterialCommunityIcons name="refresh" size={14} color="#fff" />
                          <Text style={{ color: '#fff', fontFamily: fontFamilyVariants.body, fontWeight: fontWeight.bold as any, fontSize: 13 }}>
                            Erneut versuchen
                          </Text>
                        </Pressable>
                        <Pressable
                          onPress={() => removeJob(j.id)}
                          style={({ pressed }) => ({ paddingHorizontal: 12, paddingVertical: 7, borderRadius: radii.md, backgroundColor: theme.surfaceAlt ?? 'rgba(0,0,0,0.05)', opacity: pressed ? 0.85 : 1 })}
                        >
                          <Text style={{ color: theme.textSub, fontFamily: fontFamilyVariants.body, fontWeight: fontWeight.medium as any, fontSize: 13 }}>
                            Verwerfen
                          </Text>
                        </Pressable>
                      </View>
                    ) : (
                      <View style={{ height: 5, borderRadius: 3, backgroundColor: theme.surfaceAlt ?? 'rgba(0,0,0,0.08)', overflow: 'hidden', marginTop: 8 }}>
                        <View style={{ width: `${Math.max(3, Math.min(100, j.progress))}%`, height: '100%', borderRadius: 3, backgroundColor: PURPLE }} />
                      </View>
                    )}
                  </View>
                </View>
              );
            })}
          </View>
        ) : null}

        {/* Section header */}
        <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', paddingHorizontal: 20, marginTop: 22, marginBottom: 10 }}>
          <Text style={{ color: theme.text, fontFamily: fontFamilyVariants.heading, fontWeight: fontWeight.extraBold as any, fontSize: 20, letterSpacing: -0.2 }}>
            Zuletzt eingereicht
          </Text>
          <Text style={{ color: theme.textMuted ?? theme.textSub, fontFamily: fontFamilyVariants.body, fontSize: 12 }}>
            {total}
          </Text>
        </View>

        {/* List */}
        {!loaded ? null : total === 0 ? (
          <View style={{ marginHorizontal: 16, padding: 28, borderRadius: radii.lg, backgroundColor: theme.surfaceAlt ?? theme.surface, borderWidth: 1, borderColor: theme.border, alignItems: 'center', gap: 8 }}>
            <MaterialCommunityIcons name="package-variant-closed" size={44} color={theme.textMuted ?? theme.textSub} />
            <Text style={{ color: theme.text, fontFamily: fontFamilyVariants.body, fontWeight: fontWeight.bold as any, fontSize: 15 }}>
              Noch keine Produkte
            </Text>
            <Text style={{ color: theme.textSub, fontFamily: fontFamilyVariants.body, fontSize: 13, textAlign: 'center', maxWidth: 260, lineHeight: 19 }}>
              Erfasse dein erstes Produkt und hilf, die Datenbank zu vervollständigen.
            </Text>
          </View>
        ) : (
          rows.slice(0, 20).map((r) => {
            const v = statusVisual(r);
            const title = r.productName || `Produkt ${r.productIndex ?? ''}`.trim();
            const land = normalizeLand(r.marketLand);
            const marketLine = r.marketName ? `${r.marketName}${land ? ` (${land})` : ''} · ` : '';
            return (
              <Pressable
                key={r.id}
                onPress={() => setDetailRow(r)}
                style={({ pressed }) => ({
                  flexDirection: 'row',
                  alignItems: 'center',
                  backgroundColor: theme.surface,
                  borderRadius: radii.lg,
                  borderWidth: 1,
                  borderColor: theme.border ?? 'rgba(0,0,0,0.06)',
                  paddingHorizontal: 14,
                  paddingVertical: 14,
                  marginHorizontal: 16,
                  marginBottom: 10,
                  gap: 12,
                  opacity: pressed ? 0.7 : 1,
                })}
              >
                <View style={{ width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: v.bg }}>
                  <MaterialCommunityIcons name={v.icon as any} size={22} color={v.color} />
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text numberOfLines={1} style={{ color: theme.text, fontFamily: fontFamilyVariants.heading, fontWeight: fontWeight.extraBold as any, fontSize: 16, letterSpacing: -0.2 }}>
                    {title}
                  </Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 }}>
                    <Text style={{ color: v.color, backgroundColor: v.bg, fontFamily: fontFamilyVariants.medium, fontWeight: fontWeight.medium as any, fontSize: 11, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999, overflow: 'hidden' }}>
                      {v.label}
                    </Text>
                    <Text numberOfLines={1} style={{ flex: 1, color: theme.textSub, fontFamily: fontFamilyVariants.body, fontSize: 12 }}>
                      {marketLine}
                      {formatRelative(r.createdAt)}
                    </Text>
                  </View>
                  {v.copy.tone === 'held' ? (
                    <Text numberOfLines={1} style={{ color: v.color, fontFamily: fontFamilyVariants.body, fontSize: 12, marginTop: 4 }}>
                      {v.copy.headline}
                    </Text>
                  ) : null}
                </View>
                <MaterialCommunityIcons name="chevron-right" size={24} color={theme.textMuted ?? theme.textSub} />
              </Pressable>
            );
          })
        )}
      </ScrollView>

      {/* Submission detail sheet (tap a row) */}
      <FilterSheet
        visible={pickerOpen}
        title="Für welche Aktion erfasst du?"
        onClose={() => setPickerOpen(false)}
      >
        <OptionList
          value={campaign?.campaignId ?? ''}
          options={campaigns.map((c) => {
            const eur = rewardLabel(c);
            return [c.campaignId, eur ? `${c.title} · ${eur}` : c.title] as const;
          })}
          onChange={(id) => {
            const next = campaigns.find((c) => c.campaignId === id);
            if (next) chooseCampaign(next);
            setPickerOpen(false);
          }}
        />
      </FilterSheet>

      <FilterSheet
        visible={!!detailRow}
        title={detailRow ? detailRow.productName || `Produkt ${detailRow.productIndex ?? ''}`.trim() : ''}
        onClose={() => setDetailRow(null)}
      >
        {detailRow
          ? (() => {
              const v = statusVisual(detailRow);
              const land = normalizeLand(detailRow.marketLand);
              return (
                <View style={{ paddingBottom: 8, gap: 14 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <Text style={{ color: v.color, backgroundColor: v.bg, fontFamily: fontFamilyVariants.medium, fontWeight: fontWeight.medium as any, fontSize: 12, paddingHorizontal: 10, paddingVertical: 3, borderRadius: 999, overflow: 'hidden' }}>
                      {v.label}
                    </Text>
                    {detailRow.marketName ? (
                      <Text style={{ color: theme.text, fontFamily: fontFamilyVariants.body, fontWeight: fontWeight.bold as any, fontSize: 14 }}>
                        {detailRow.marketName}
                        {land ? ` (${land})` : ''}
                      </Text>
                    ) : null}
                  </View>

                  {/* Status-Karte: Grund + nächster Schritt (86cbam5ep) */}
                  <View style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start', backgroundColor: v.bg, borderRadius: 12, padding: 12 }}>
                    <MaterialCommunityIcons name={v.icon as any} size={18} color={v.color} style={{ marginTop: 1 }} />
                    <View style={{ flex: 1, gap: 3 }}>
                      <Text style={{ color: theme.text, fontFamily: fontFamilyVariants.body, fontWeight: fontWeight.bold as any, fontSize: 13 }}>
                        {v.copy.headline}
                      </Text>
                      <Text style={{ color: theme.textSub, fontFamily: fontFamilyVariants.body, fontSize: 13, lineHeight: 18 }}>
                        {v.copy.body}
                      </Text>
                    </View>
                  </View>

                  <View style={{ gap: 3 }}>
                    {formatAbsolute(detailRow.createdAt) ? (
                      <Text style={{ color: theme.textSub, fontFamily: fontFamilyVariants.body, fontSize: 13 }}>
                        Eingereicht: {formatAbsolute(detailRow.createdAt)}
                      </Text>
                    ) : null}
                    {detailRow.ean ? (
                      <Text style={{ color: theme.textSub, fontFamily: fontFamilyVariants.body, fontSize: 13 }}>EAN: {detailRow.ean}</Text>
                    ) : null}
                    <Text style={{ color: theme.textSub, fontFamily: fontFamilyVariants.body, fontSize: 13 }}>
                      {detailRow.stepCount ?? Object.keys(detailRow.images ?? {}).length}/{stepTotal} Ansichten
                    </Text>
                  </View>

                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
                    {PRODUCT_PHOTO_STEPS.map((s) => {
                      const url = detailUrls[s.key];
                      const has = !!detailRow.images?.[s.key];
                      return (
                        <View
                          key={s.key}
                          style={[styles.detThumb, { borderColor: has ? PURPLE : theme.border, backgroundColor: theme.surfaceAlt ?? '#eee' }]}
                        >
                          {url ? (
                            <ExpoImage source={{ uri: url }} style={StyleSheet.absoluteFillObject} contentFit="cover" />
                          ) : (
                            <MaterialCommunityIcons name={(has ? 'image-outline' : s.icon) as any} size={24} color={theme.textMuted ?? theme.textSub} />
                          )}
                          <View style={styles.detThumbLabel}>
                            <Text numberOfLines={1} style={{ color: '#fff', fontFamily: fontFamilyVariants.body, fontSize: 10, fontWeight: fontWeight.bold as any }}>
                              {STEP_LABEL[s.key]}
                            </Text>
                          </View>
                        </View>
                      );
                    })}
                  </View>
                </View>
              );
            })()
          : null}
      </FilterSheet>
    </View>
  );
}

const styles = StyleSheet.create({
  detThumb: { width: '31%', aspectRatio: 0.8, borderRadius: 12, borderWidth: 1.5, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  detThumbLabel: { position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: 'rgba(0,0,0,0.55)', paddingHorizontal: 6, paddingVertical: 3 },
});
