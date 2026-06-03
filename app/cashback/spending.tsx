/**
 * Ausgaben — Spending-Statistik aus den eingereichten Bons.
 *
 * Quelle: /users/{uid}/cashback_status/* (der Mirror, den der Verlauf
 * eh nutzt). Gezählt werden ALLE echten Käufe über `bonTotalCents` —
 * inkl. Nicht-Partner-Märkte (unknown_merchant), gecappte + zu alte Bons;
 * NUR Duplikate / Nicht-Bons / Fehler-Zustände fließen NICHT ein (kein
 * Doppelzählen). Händler kanonisch aus der `discounter`-Stammliste (Logo +
 * Name + Land). Aggregation client-seitig: Gesamtsumme, pro Händler,
 * Monatsverlauf, mit Zeitraum-Filter.
 *
 * Kategorie-Aufschlüsselung („für was") kommt später mit dem
 * Produkt-Matching — Roh-Artikelnamen lassen sich vorher nicht sauber
 * gruppieren. UI-Konventionen: DetailHeader, theme-Tokens, keine Emojis.
 */

import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { router, useNavigation } from 'expo-router';
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Image, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { DetailHeader, DETAIL_HEADER_ROW_HEIGHT } from '@/components/design/DetailHeader';
import { fontFamily, fontWeight } from '@/constants/tokens';
import { useTokens } from '@/hooks/useTokens';
import { fetchAllCashbackEntries, type CashbackStatusEntry } from '@/lib/services/cashbackUpload';
import { FirestoreService } from '@/lib/services/firestore';
import { formatCents } from '@/lib/types/cashback';

// Ausgaben-Sicht (86ca0wbg7): ALLE echten Käufe zählen — auch Nicht-Partner-
// Märkte (unknown_merchant), gecappte (campaign_budget/monthly_cap) und zu alte
// Bons. NUR offensichtlicher Junk raus: Duplikate (sonst Doppelzählung), Nicht-
// Bons, sowie nicht-finale/Fehler-Zustände. So tauchen auch „andere Händler"
// auf, die hochgeladen wurden (z.B. MPREIS).
const NON_SPEND_STATUS = new Set(['uploading', 'upload_failed', 'superseded', 'ocr_pending', 'failed']);
// not_a_receipt = kein echter Kauf → IMMER raus.
const NOT_A_RECEIPT_REASON = /not_a_receipt/i;
// Duplikate (gleicher Kauf mehrfach hochgeladen) → toggle-bar: Default
// ausgeblendet (sonst Doppelzählung), aber einblendbar.
const DUPLICATE_REASON = /duplicate/i;

// Zeitraum-Presets (Tage; 0 = alles).
const PERIODS: [string, string][] = [
  ['all', 'Alles'],
  ['365', '12 Monate'],
  ['90', '90 Tage'],
  ['30', '30 Tage'],
];

const MONTH_LABELS = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];

function merchantLabel(e: CashbackStatusEntry): string {
  // merchantRaw = der vom OCR erkannte Markt-Name (auch bei Nicht-Partnern da)
  // → so steht da der echte Name statt "Unbekannter Markt".
  return e.merchantDisplayName || e.merchantName || e.merchant || e.merchantRaw || 'Unbekannter Markt';
}

export default function SpendingScreen() {
  const { theme } = useTokens();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();

  useLayoutEffect(() => {
    navigation.setOptions({ headerShown: false });
  }, [navigation]);

  const [entries, setEntries] = useState<CashbackStatusEntry[] | null>(null);
  const [period, setPeriod] = useState<string>('all');

  useEffect(() => {
    let alive = true;
    fetchAllCashbackEntries()
      .then((rows) => {
        if (alive) setEntries(rows);
      })
      .catch(() => {
        if (alive) setEntries([]);
      });
    return () => {
      alive = false;
    };
  }, []);

  const headerOffset = insets.top + DETAIL_HEADER_ROW_HEIGHT;
  const primary = theme.primary ?? '#0d8575';

  // 86ca0wbg7 — kanonische Discounter (Stammliste), gecacht. Markt wird per
  // discounterId (exakt) → Fallback Slug/Name + Land aufgelöst → korrekte
  // Logos/Namen/Länder, neue Märkte automatisch.
  const [discounters, setDiscounters] = useState<any[]>([]);
  useEffect(() => {
    let alive = true;
    FirestoreService.getDiscounter()
      .then((d) => { if (alive) setDiscounters(d as any[]); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);
  const discIndex = useMemo(() => {
    const normD = (s: string) =>
      String(s || '').toLowerCase()
        .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
        .replace(/[^a-z0-9]/g, '');
    const byId = new Map<string, any>();
    const byName: { n: string; d: any }[] = [];
    discounters.forEach((d) => { byId.set(d.id, d); byName.push({ n: normD(d.name), d }); });
    return { byId, byName, normD };
  }, [discounters]);
  const resolveDiscounter = useCallback(
    (e: CashbackStatusEntry): any | null => {
      const dId = (e as any).discounterId;
      if (dId && discIndex.byId.has(dId)) return discIndex.byId.get(dId);
      const cand = discIndex.normD((e as any).merchantId || e.merchantName || e.merchant || '');
      if (!cand) return null;
      const matches = discIndex.byName
        .filter(({ n }) => n && (n.includes(cand) || cand.includes(n)))
        .map((x) => x.d);
      if (!matches.length) return null;
      const want = String((e as any).merchantLand || '').toUpperCase();
      return (
        matches.find((d) => String(d.land || '').toUpperCase() === want) ||
        matches.find((d) => String(d.land || '').toUpperCase() === 'DE') ||
        matches[0]
      );
    },
    [discIndex],
  );

  // Nur Käufe mit bekanntem Datum + Betrag; nach Zeitraum gefiltert.
  const spend = useMemo(() => {
    const rows = (entries ?? []).filter(
      (e) =>
        typeof e.bonTotalCents === 'number' &&
        e.bonTotalCents! > 0 &&
        typeof e.bonDate === 'string' &&
        /^\d{4}-\d{2}-\d{2}/.test(e.bonDate!) &&
        !NON_SPEND_STATUS.has(e.status ?? '') &&
        !(e.rejectReason && NOT_A_RECEIPT_REASON.test(e.rejectReason)),
      // Duplikate bleiben im Basis-Set → werden erst in visibleSpend per
      // Toggle aus-/eingeblendet.
    );
    const days = parseInt(period, 10);
    if (Number.isFinite(days) && days > 0) {
      const cutoff = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
      return rows.filter((e) => (e.bonDate as string).slice(0, 10) >= cutoff);
    }
    return rows;
  }, [entries, period]);

  // Toggle: nur „bekannte"/akzeptierte Märkte (= in der discounter-Stammliste
  // auflösbar). Aus → auch unbekannte/nicht-akzeptierte Märkte. Filtert die
  // ganze Sicht (Total + Chart + Händler), damit die Zahlen konsistent bleiben.
  const [knownOnly, setKnownOnly] = useState(false);
  // Toggle: Duplikate (gleicher Kauf mehrfach hochgeladen) ausblenden. Default
  // AN → korrekte Summe ohne Doppelzählung; aus → Duplikate fließen mit ein.
  const [hideDuplicates, setHideDuplicates] = useState(true);
  const isDup = useCallback(
    (e: CashbackStatusEntry) => !!(e.rejectReason && DUPLICATE_REASON.test(e.rejectReason)),
    [],
  );
  const hasDuplicates = useMemo(() => spend.some(isDup), [spend, isDup]);
  const visibleSpend = useMemo(
    () =>
      spend.filter(
        (e) =>
          (!knownOnly || !!resolveDiscounter(e)) &&
          (!hideDuplicates || !isDup(e)),
      ),
    [spend, knownOnly, hideDuplicates, resolveDiscounter, isDup],
  );

  const totalCents = useMemo(() => visibleSpend.reduce((s, e) => s + (e.bonTotalCents ?? 0), 0), [visibleSpend]);

  // Pro Händler: Summe + Bon-Anzahl + known-Flag, absteigend nach Summe.
  const byMerchant = useMemo(() => {
    const map = new Map<string, { label: string; cents: number; count: number; logoUrl: string | null; known: boolean }>();
    for (const e of visibleSpend) {
      const disc = resolveDiscounter(e);
      const discLand = disc?.land ? String(disc.land).toUpperCase() : null;
      const label = disc
        ? (discLand ? `${disc.name} (${discLand})` : disc.name)
        : merchantLabel(e);
      const key = disc?.id || e.merchantId || label;
      const logoUrl: string | null = disc?.bild || (e as any).merchantLogoUrl || null;
      const cur = map.get(key) ?? { label, cents: 0, count: 0, logoUrl, known: !!disc };
      cur.cents += e.bonTotalCents ?? 0;
      cur.count += 1;
      map.set(key, cur);
    }
    return Array.from(map.values()).sort((a, b) => b.cents - a.cents);
  }, [visibleSpend, resolveDiscounter]);

  // Monatsverlauf: letzte ≤12 Monate mit Daten, aufsteigend.
  const byMonth = useMemo(() => {
    const map = new Map<string, number>();
    for (const e of visibleSpend) {
      const m = (e.bonDate as string).slice(0, 7); // YYYY-MM
      map.set(m, (map.get(m) ?? 0) + (e.bonTotalCents ?? 0));
    }
    return Array.from(map.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .slice(-12);
  }, [visibleSpend]);

  // Gibt es überhaupt unbekannte Märkte? (steuert, ob der Toggle sinnvoll ist)
  const hasUnknown = useMemo(() => spend.some((e) => !resolveDiscounter(e)), [spend, resolveDiscounter]);

  const maxMerchant = byMerchant[0]?.cents ?? 1;
  const maxMonth = byMonth.reduce((m, [, c]) => Math.max(m, c), 1);
  const loading = entries === null;
  const empty = !loading && visibleSpend.length === 0;

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <DetailHeader title="Ausgaben" onBack={() => router.back()} />

      {loading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={primary} />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={{ paddingTop: headerOffset + 12, paddingBottom: insets.bottom + 32 }}
          showsVerticalScrollIndicator={false}
        >
          {/* Zeitraum-Pills */}
          <View style={{ flexDirection: 'row', gap: 8, paddingHorizontal: 20 }}>
            {PERIODS.map(([k, label]) => {
              const active = period === k;
              return (
                <Pressable
                  key={k}
                  onPress={() => setPeriod(k)}
                  style={{
                    flex: 1,
                    height: 34,
                    borderRadius: 10,
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: active ? primary : theme.surface,
                    borderWidth: 1,
                    borderColor: active ? primary : theme.border,
                  }}
                >
                  <Text
                    style={{
                      fontFamily,
                      fontWeight: fontWeight.bold as any,
                      fontSize: 12,
                      color: active ? '#fff' : theme.textMuted,
                    }}
                  >
                    {label}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          {/* Summen-Hero */}
          <View style={{ paddingHorizontal: 20, paddingTop: 14 }}>
            <View
              style={{
                borderRadius: 18,
                padding: 18,
                backgroundColor: theme.surface,
                borderWidth: 1,
                borderColor: theme.border,
              }}
            >
              <Text
                style={{
                  fontFamily,
                  fontWeight: fontWeight.bold as any,
                  fontSize: 11,
                  letterSpacing: 0.6,
                  color: theme.textMuted,
                  textTransform: 'uppercase',
                }}
              >
                Gesamt ausgegeben
              </Text>
              <Text
                style={{
                  fontFamily,
                  fontWeight: fontWeight.extraBold,
                  fontSize: 34,
                  letterSpacing: -0.8,
                  color: theme.text,
                  marginTop: 2,
                }}
              >
                {formatCents(totalCents)}
              </Text>
              <Text style={{ fontFamily, fontWeight: fontWeight.medium, fontSize: 12, color: theme.textMuted, marginTop: 2 }}>
                aus {spend.length} {spend.length === 1 ? 'Bon' : 'Bons'}
              </Text>
            </View>
          </View>

          {empty ? (
            <View style={{ alignItems: 'center', paddingTop: 48, paddingHorizontal: 32 }}>
              <MaterialCommunityIcons name="chart-box-outline" size={44} color={theme.textMuted} />
              <Text
                style={{
                  fontFamily,
                  fontWeight: fontWeight.medium,
                  fontSize: 13,
                  color: theme.textMuted,
                  textAlign: 'center',
                  marginTop: 12,
                  lineHeight: 19,
                }}
              >
                Noch keine Ausgaben im gewählten Zeitraum. Reiche Bons ein — sie zählen hier zur Übersicht.
              </Text>
            </View>
          ) : (
            <>
              {/* Monatsverlauf */}
              {byMonth.length > 1 ? (
                <View style={{ paddingHorizontal: 20, paddingTop: 24 }}>
                  <Text style={{ fontFamily, fontWeight: fontWeight.extraBold, fontSize: 20, color: theme.text, letterSpacing: -0.2, marginBottom: 14 }}>
                    Monatsverlauf
                  </Text>
                  <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 6, height: 110 }}>
                    {byMonth.map(([m, c]) => {
                      const h = Math.max(4, Math.round((c / maxMonth) * 84));
                      const monthIdx = parseInt(m.slice(5, 7), 10) - 1;
                      return (
                        <View key={m} style={{ flex: 1, alignItems: 'center', gap: 4 }}>
                          <Text style={{ fontFamily, fontWeight: fontWeight.bold as any, fontSize: 8, color: theme.textMuted }}>
                            {Math.round(c / 100)}
                          </Text>
                          <View style={{ width: '70%', height: h, borderRadius: 4, backgroundColor: primary }} />
                          <Text style={{ fontFamily, fontWeight: fontWeight.medium, fontSize: 9, color: theme.textMuted }}>
                            {MONTH_LABELS[monthIdx] ?? ''}
                          </Text>
                        </View>
                      );
                    })}
                  </View>
                </View>
              ) : null}

              {/* Nach Händler */}
              <View style={{ paddingHorizontal: 20, paddingTop: 24 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, gap: 8 }}>
                  <Text style={{ fontFamily, fontWeight: fontWeight.extraBold, fontSize: 20, color: theme.text, letterSpacing: -0.2 }}>
                    Nach Händler
                  </Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                    {hasUnknown ? (
                      <Pressable
                        onPress={() => setKnownOnly((v) => !v)}
                        hitSlop={8}
                        style={({ pressed }) => ({
                          flexDirection: 'row',
                          alignItems: 'center',
                          gap: 5,
                          paddingHorizontal: 10,
                          paddingVertical: 6,
                          borderRadius: 999,
                          backgroundColor: knownOnly ? (theme.primaryContainer ?? theme.surfaceAlt) : theme.surface,
                          borderWidth: 1,
                          borderColor: knownOnly ? primary : (theme.border ?? 'rgba(0,0,0,0.08)'),
                          opacity: pressed ? 0.7 : 1,
                        })}
                      >
                        <MaterialCommunityIcons
                          name={knownOnly ? 'eye-off-outline' : 'eye-outline'}
                          size={14}
                          color={knownOnly ? primary : theme.textMuted}
                        />
                        <Text style={{ fontFamily, fontWeight: fontWeight.bold as any, fontSize: 11, color: knownOnly ? primary : theme.textMuted }}>
                          {knownOnly ? 'Unbekannte aus' : 'Unbekannte ein'}
                        </Text>
                      </Pressable>
                    ) : null}
                    {hasDuplicates ? (
                      <Pressable
                        onPress={() => setHideDuplicates((v) => !v)}
                        hitSlop={8}
                        style={({ pressed }) => ({
                          flexDirection: 'row',
                          alignItems: 'center',
                          gap: 5,
                          paddingHorizontal: 10,
                          paddingVertical: 6,
                          borderRadius: 999,
                          backgroundColor: hideDuplicates ? (theme.primaryContainer ?? theme.surfaceAlt) : theme.surface,
                          borderWidth: 1,
                          borderColor: hideDuplicates ? primary : (theme.border ?? 'rgba(0,0,0,0.08)'),
                          opacity: pressed ? 0.7 : 1,
                        })}
                      >
                        <MaterialCommunityIcons
                          name="content-copy"
                          size={13}
                          color={hideDuplicates ? primary : theme.textMuted}
                        />
                        <Text style={{ fontFamily, fontWeight: fontWeight.bold as any, fontSize: 11, color: hideDuplicates ? primary : theme.textMuted }}>
                          {hideDuplicates ? 'Duplikate aus' : 'Duplikate ein'}
                        </Text>
                      </Pressable>
                    ) : null}
                  </View>
                </View>
                <View style={{ gap: 12 }}>
                  {byMerchant.map((m) => {
                    const pct = Math.max(4, Math.round((m.cents / maxMerchant) * 100));
                    return (
                      <View key={m.label} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                        {/* Discounter-Logo (kanonisch) — Fallback: Storefront-Icon
                            für nicht-im-Stamm Märkte. Padding, damit das Logo nicht
                            vom Kreis angeschnitten wird. */}
                        {m.logoUrl ? (
                          <View style={{ width: 36, height: 36, borderRadius: 18, overflow: 'hidden', backgroundColor: '#ffffff', borderWidth: 1, borderColor: theme.border ?? 'rgba(0,0,0,0.06)', alignItems: 'center', justifyContent: 'center', padding: 6 }}>
                            <Image source={{ uri: m.logoUrl }} style={{ width: '100%', height: '100%' }} resizeMode="contain" />
                          </View>
                        ) : (
                          <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: theme.surfaceAlt ?? theme.border, alignItems: 'center', justifyContent: 'center' }}>
                            <MaterialCommunityIcons name="storefront-outline" size={18} color={theme.textMuted} />
                          </View>
                        )}
                        <View style={{ flex: 1, minWidth: 0 }}>
                          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 5 }}>
                            <Text numberOfLines={1} style={{ flex: 1, fontFamily, fontWeight: fontWeight.bold as any, fontSize: 13, color: theme.text }}>
                              {m.label}
                            </Text>
                            <Text style={{ fontFamily, fontWeight: fontWeight.extraBold, fontSize: 13, color: theme.text, marginLeft: 8 }}>
                              {formatCents(m.cents)}
                            </Text>
                          </View>
                          <View style={{ height: 8, borderRadius: 4, backgroundColor: theme.surfaceAlt ?? theme.border, overflow: 'hidden' }}>
                            {/* known/akzeptiert = grün (primary), unbekannt/nicht-akzeptiert = grau */}
                            <View style={{ width: `${pct}%`, height: '100%', borderRadius: 4, backgroundColor: m.known ? primary : (theme.textMuted ?? '#9aa5a8') }} />
                          </View>
                          <Text style={{ fontFamily, fontWeight: fontWeight.medium, fontSize: 11, color: theme.textMuted, marginTop: 3 }}>
                            {m.count} {m.count === 1 ? 'Bon' : 'Bons'}{m.known ? '' : ' · nicht akzeptiert'}
                          </Text>
                        </View>
                      </View>
                    );
                  })}
                </View>
              </View>

              {/* Hinweis: Kategorie-Aufschlüsselung folgt mit Produkt-Matching */}
              <View style={{ paddingHorizontal: 20, paddingTop: 22 }}>
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 10,
                    padding: 14,
                    borderRadius: 16,
                    backgroundColor: theme.surface,
                    borderWidth: 1,
                    borderColor: theme.border,
                  }}
                >
                  <MaterialCommunityIcons name="shape-outline" size={20} color={theme.textMuted} />
                  <Text style={{ flex: 1, fontFamily, fontWeight: fontWeight.medium, fontSize: 12, color: theme.textMuted, lineHeight: 17 }}>
                    Eine Aufschlüsselung „wofür" (nach Produkt-Kategorie) kommt bald — sobald die erkannten Artikel zugeordnet sind.
                  </Text>
                </View>
              </View>
            </>
          )}
        </ScrollView>
      )}
    </View>
  );
}
