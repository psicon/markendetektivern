/**
 * Bon Crop Screen — Phase 1.5.2.
 *
 * Pure-JS rectangular crop UI. User drags a crop rectangle over the
 * captured image; corners are draggable. Output goes through
 * expo-image-manipulator and the cropped URI replaces the review's
 * source image.
 *
 * NOTE: requires `expo-image-manipulator` linked into the dev client.
 * Install + rebuild via `npx expo run:ios --device`.
 *
 * For perfect auto-detect Bon-Crop (Edge-Detection + Perspective
 * Correction) we still need ML-Kit Document Scanner — Phase 1.5.3.
 */

import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { Image as ExpoImage } from 'expo-image';
import * as ImageManipulator from 'expo-image-manipulator';
import { router, useLocalSearchParams, useNavigation } from 'expo-router';
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Dimensions,
  Image,
  PanResponder,
  Pressable,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { fontFamily, fontWeight } from '@/constants/tokens';
import { useTokens } from '@/hooks/useTokens';
import { buildCapturedBon } from '@/lib/utils/cashbackImage';

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');

const TOP_BAR_HEIGHT = 56;
const BOTTOM_BAR_HEIGHT = 88;
const HANDLE_SIZE = 28;
const HANDLE_HALF = HANDLE_SIZE / 2;
const MIN_RECT = 80;

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export default function CashbackCropScreen() {
  const params = useLocalSearchParams<{
    uri: string;
    width?: string;
    height?: string;
    source?: 'live_camera' | 'upload';
  }>();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const { theme } = useTokens();

  useLayoutEffect(() => {
    navigation.setOptions({ headerShown: false });
  }, [navigation]);

  const imgUri = String(params.uri ?? '');
  const naturalW = Number(params.width ?? 0);
  const naturalH = Number(params.height ?? 0);

  // Compute the on-screen image rect (contentFit:'contain' inside the
  // canvas area). We need this to convert screen coords → image coords
  // when calling ImageManipulator.crop.
  const canvasTop = insets.top + TOP_BAR_HEIGHT;
  const canvasBottom = SCREEN_H - insets.bottom - BOTTOM_BAR_HEIGHT;
  const canvasH = Math.max(0, canvasBottom - canvasTop);
  const canvasW = SCREEN_W;

  const fittedSize = useMemo(() => {
    if (!naturalW || !naturalH || !canvasW || !canvasH) {
      return { w: canvasW, h: canvasH, x: 0, y: 0 };
    }
    const scale = Math.min(canvasW / naturalW, canvasH / naturalH);
    const w = naturalW * scale;
    const h = naturalH * scale;
    return {
      w,
      h,
      x: (canvasW - w) / 2,
      y: canvasTop + (canvasH - h) / 2,
    };
  }, [naturalW, naturalH, canvasW, canvasH, canvasTop]);

  // Initial crop = full image (so user just shrinks). Inset 8 so handles
  // are visible.
  const [rect, setRect] = useState<Rect>(() => ({
    x: fittedSize.x + 8,
    y: fittedSize.y + 8,
    w: Math.max(MIN_RECT, fittedSize.w - 16),
    h: Math.max(MIN_RECT, fittedSize.h - 16),
  }));
  const rectRef = useRef(rect);
  useEffect(() => {
    rectRef.current = rect;
  }, [rect]);

  // Reset rect when image fits change (orientation, etc.)
  useEffect(() => {
    setRect({
      x: fittedSize.x + 8,
      y: fittedSize.y + 8,
      w: Math.max(MIN_RECT, fittedSize.w - 16),
      h: Math.max(MIN_RECT, fittedSize.h - 16),
    });
  }, [fittedSize.x, fittedSize.y, fittedSize.w, fittedSize.h]);

  const [cropping, setCropping] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ─── Drag handlers ────────────────────────────────────────────────

  const startRef = useRef<Rect>(rect);

  const clamp = useCallback(
    (next: Rect): Rect => {
      const minX = fittedSize.x;
      const minY = fittedSize.y;
      const maxX = fittedSize.x + fittedSize.w;
      const maxY = fittedSize.y + fittedSize.h;
      const x = Math.max(minX, Math.min(next.x, maxX - MIN_RECT));
      const y = Math.max(minY, Math.min(next.y, maxY - MIN_RECT));
      const w = Math.max(MIN_RECT, Math.min(next.w, maxX - x));
      const h = Math.max(MIN_RECT, Math.min(next.h, maxY - y));
      return { x, y, w, h };
    },
    [fittedSize.x, fittedSize.y, fittedSize.w, fittedSize.h],
  );

  const makeCornerResponder = (corner: 'tl' | 'tr' | 'bl' | 'br') =>
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        startRef.current = rectRef.current;
      },
      onPanResponderMove: (_, gesture) => {
        const s = startRef.current;
        let next: Rect = { ...s };
        if (corner === 'tl') {
          next = { x: s.x + gesture.dx, y: s.y + gesture.dy, w: s.w - gesture.dx, h: s.h - gesture.dy };
        } else if (corner === 'tr') {
          next = { x: s.x, y: s.y + gesture.dy, w: s.w + gesture.dx, h: s.h - gesture.dy };
        } else if (corner === 'bl') {
          next = { x: s.x + gesture.dx, y: s.y, w: s.w - gesture.dx, h: s.h + gesture.dy };
        } else {
          next = { x: s.x, y: s.y, w: s.w + gesture.dx, h: s.h + gesture.dy };
        }
        setRect(clamp(next));
      },
    });

  const moveResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: () => {
          startRef.current = rectRef.current;
        },
        onPanResponderMove: (_, gesture) => {
          const s = startRef.current;
          setRect(clamp({ x: s.x + gesture.dx, y: s.y + gesture.dy, w: s.w, h: s.h }));
        },
      }),
    [clamp],
  );

  const cornerResponders = {
    tl: useMemo(() => makeCornerResponder('tl'), [clamp]),
    tr: useMemo(() => makeCornerResponder('tr'), [clamp]),
    bl: useMemo(() => makeCornerResponder('bl'), [clamp]),
    br: useMemo(() => makeCornerResponder('br'), [clamp]),
  };

  // ─── Apply crop ───────────────────────────────────────────────────

  const handleApply = useCallback(async () => {
    if (!imgUri || !naturalW || !naturalH || cropping) return;
    setCropping(true);
    try {
      // Convert screen rect → image rect (factor by display↔natural ratio).
      const scaleX = naturalW / fittedSize.w;
      const scaleY = naturalH / fittedSize.h;
      const cropParams = {
        originX: Math.max(0, Math.round((rect.x - fittedSize.x) * scaleX)),
        originY: Math.max(0, Math.round((rect.y - fittedSize.y) * scaleY)),
        width: Math.round(rect.w * scaleX),
        height: Math.round(rect.h * scaleY),
      };

      const result = await ImageManipulator.manipulateAsync(
        imgUri,
        [{ crop: cropParams }],
        { compress: 0.9, format: ImageManipulator.SaveFormat.JPEG },
      );
      const bon = await buildCapturedBon(result.uri, result.width, result.height);

      router.replace({
        pathname: '/cashback/review',
        params: {
          uri: bon.uri,
          width: String(bon.width),
          height: String(bon.height),
          hash: bon.bytesHash,
          brightness: String(bon.approxBrightness),
          size: String(bon.sizeBytes),
          source: (params.source as any) || 'live_camera',
        },
      });
    } catch (e: any) {
      console.warn('⚠️ crop failed', e?.message);
      const msg = String(e?.message || e?.code || '');
      const friendly = /not.*registered|native|nativemodule/i.test(msg)
        ? 'Crop braucht ein App-Update: im Terminal "npx expo run:ios --device" laufen lassen, dann ist das Native-Modul drin.'
        : `Zuschneiden fehlgeschlagen: ${msg || 'unbekannter Fehler'}`;
      setError(friendly);
      setCropping(false);
    }
  }, [imgUri, naturalW, naturalH, rect, fittedSize, cropping, params.source]);

  const handleCancel = useCallback(() => {
    router.back();
  }, []);

  if (!imgUri) {
    return (
      <View style={[styles.root, { backgroundColor: '#000' }]}>
        <ActivityIndicator color="#fff" />
      </View>
    );
  }

  return (
    <View style={[styles.root, { backgroundColor: '#000' }]}>
      <StatusBar barStyle="light-content" />

      {/* Top bar */}
      <View style={[styles.topBar, { paddingTop: insets.top + 6, height: insets.top + TOP_BAR_HEIGHT }]}>
        <Pressable onPress={handleCancel} style={styles.iconButton} hitSlop={10}>
          <MaterialCommunityIcons name="close" size={24} color="#fff" />
        </Pressable>
        <Text style={styles.topTitle}>Zuschneiden</Text>
        <View style={styles.iconButton} />
      </View>

      {/* Image canvas */}
      <View style={[styles.canvas, { top: canvasTop, height: canvasH }]}>
        <Image
          source={{ uri: imgUri }}
          style={{
            position: 'absolute',
            left: fittedSize.x,
            top: 0, // canvas already starts at canvasTop
            width: fittedSize.w,
            height: fittedSize.h,
          }}
          resizeMode="contain"
        />

        {/* Dim overlay outside the rect (4 strips) */}
        <View style={[styles.dim, { left: 0, top: 0, right: 0, height: rect.y - canvasTop }]} />
        <View style={[styles.dim, { left: 0, top: rect.y - canvasTop + rect.h, right: 0, bottom: 0 }]} />
        <View style={[styles.dim, { left: 0, top: rect.y - canvasTop, width: rect.x, height: rect.h }]} />
        <View style={[styles.dim, { left: rect.x + rect.w, top: rect.y - canvasTop, right: 0, height: rect.h }]} />

        {/* Crop rectangle */}
        <View
          {...moveResponder.panHandlers}
          style={{
            position: 'absolute',
            left: rect.x,
            top: rect.y - canvasTop,
            width: rect.w,
            height: rect.h,
            borderWidth: 2,
            borderColor: '#ffd44b',
          }}
        >
          {/* Grid lines (rule of thirds) */}
          <View style={[styles.grid, { left: rect.w / 3, top: 0, width: 1, height: rect.h }]} />
          <View style={[styles.grid, { left: (rect.w * 2) / 3, top: 0, width: 1, height: rect.h }]} />
          <View style={[styles.grid, { left: 0, top: rect.h / 3, height: 1, width: rect.w }]} />
          <View style={[styles.grid, { left: 0, top: (rect.h * 2) / 3, height: 1, width: rect.w }]} />
        </View>

        {/* Corner handles */}
        {(['tl', 'tr', 'bl', 'br'] as const).map((c) => {
          const left = c === 'tl' || c === 'bl' ? rect.x - HANDLE_HALF : rect.x + rect.w - HANDLE_HALF;
          const top =
            (c === 'tl' || c === 'tr' ? rect.y : rect.y + rect.h) - canvasTop - HANDLE_HALF;
          return (
            <View
              key={c}
              {...cornerResponders[c].panHandlers}
              style={{
                position: 'absolute',
                left,
                top,
                width: HANDLE_SIZE,
                height: HANDLE_SIZE,
                borderRadius: HANDLE_HALF,
                backgroundColor: '#ffd44b',
                borderWidth: 2,
                borderColor: '#000',
              }}
            />
          );
        })}
      </View>

      {error ? (
        <View style={[styles.errorBanner, { bottom: insets.bottom + BOTTOM_BAR_HEIGHT + 8 }]}>
          <MaterialCommunityIcons name="alert-circle-outline" size={16} color="#fff" />
          <Text style={styles.errorBannerText}>{error}</Text>
        </View>
      ) : null}

      {/* Bottom bar */}
      <View
        style={[
          styles.bottomBar,
          {
            paddingBottom: insets.bottom + 14,
            height: insets.bottom + BOTTOM_BAR_HEIGHT,
          },
        ]}
      >
        <Pressable onPress={handleCancel} style={[styles.bottomBtn, styles.bottomBtnSecondary]}>
          <Text style={styles.bottomBtnSecondaryText}>Abbrechen</Text>
        </Pressable>
        <Pressable onPress={handleApply} disabled={cropping} style={[styles.bottomBtn, styles.bottomBtnPrimary]}>
          {cropping ? (
            <ActivityIndicator color="#000" />
          ) : (
            <>
              <MaterialCommunityIcons name="crop" size={18} color="#000" />
              <Text style={styles.bottomBtnPrimaryText}>Zuschneiden</Text>
            </>
          )}
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  topBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.6)',
    zIndex: 10,
  },
  topTitle: {
    flex: 1,
    textAlign: 'center',
    color: '#fff',
    fontFamily: fontFamily.heading,
    fontWeight: fontWeight.bold as any,
    fontSize: 16,
  },
  iconButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  canvas: {
    position: 'absolute',
    left: 0,
    right: 0,
  },
  dim: {
    position: 'absolute',
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  grid: {
    position: 'absolute',
    backgroundColor: 'rgba(255,212,75,0.5)',
  },
  bottomBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingTop: 14,
    paddingHorizontal: 16,
    flexDirection: 'row',
    gap: 10,
    backgroundColor: 'rgba(0,0,0,0.7)',
  },
  bottomBtn: {
    flex: 1,
    height: 50,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  bottomBtnPrimary: { backgroundColor: '#ffd44b' },
  bottomBtnPrimaryText: {
    color: '#000',
    fontFamily: fontFamily.body,
    fontWeight: fontWeight.bold as any,
    fontSize: 15,
  },
  bottomBtnSecondary: {
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.3)',
  },
  bottomBtnSecondaryText: {
    color: '#fff',
    fontFamily: fontFamily.body,
    fontWeight: fontWeight.bold as any,
    fontSize: 15,
  },
  errorBanner: {
    position: 'absolute',
    left: 16,
    right: 16,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    padding: 12,
    borderRadius: 12,
    backgroundColor: 'rgba(214,96,58,0.92)',
  },
  errorBannerText: {
    flex: 1,
    color: '#fff',
    fontFamily: fontFamily.body,
    fontSize: 13,
    lineHeight: 18,
  },
});
