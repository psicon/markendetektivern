// app/edit-profile.tsx
//
// Profil-Editor — neu im Design-System:
//   • DetailHeader (Back + Title + Save-Slot mit Spinner-State)
//   • Theme-Tokens via useTokens, weg von Colors[colorScheme]
//   • Avatar oben, dann zwei Surface-Cards (Identität + Optionales)
//   • SegmentedTabs-Style Gender-Pills, Date-Picker im FilterSheet
//   • LocationPicker / MarketSelector bleiben (existierende Modals)
//   • Spinner-States nur INLINE in Buttons (Save / Avatar-Upload),
//     nirgends zentral — folgt dem Loader-Triage-Rule aus CLAUDE.md
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import DateTimePicker from '@react-native-community/datetimepicker';
import * as ImagePicker from 'expo-image-picker';
import { router, useNavigation } from 'expo-router';
import { updateProfile } from 'firebase/auth';
import { doc, getDoc, serverTimestamp, updateDoc } from 'firebase/firestore';
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import React, { useEffect, useLayoutEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  DETAIL_HEADER_ROW_HEIGHT,
  DetailHeader,
} from '@/components/design/DetailHeader';
import { FilterSheet } from '@/components/design/FilterSheet';
import { fontFamily, fontWeight, radii } from '@/constants/tokens';
import { useTokens } from '@/hooks/useTokens';
import { LocationPicker } from '@/components/ui/LocationPicker';
import { MarketSelector } from '@/components/ui/MarketSelector';
import { useAuth } from '@/lib/contexts/AuthContext';
import { db, storage } from '@/lib/firebase';
import { Discounter, FirestoreDocument } from '@/lib/types/firestore';

interface FormData {
  displayName: string;
  realName: string;
  email: string;
  birthDate: Date | null;
  gender: string;
  location: string;
  photoURL: string;
  favoriteMarket: FirestoreDocument<Discounter> | null;
}

const GENDER_OPTIONS = ['Männlich', 'Weiblich', 'Divers'] as const;

const FLAG_BY_COUNTRY: Record<string, string> = {
  Deutschland: '🇩🇪',
  DE: '🇩🇪',
  Germany: '🇩🇪',
  Schweiz: '🇨🇭',
  CH: '🇨🇭',
  Switzerland: '🇨🇭',
  Österreich: '🇦🇹',
  AT: '🇦🇹',
  Austria: '🇦🇹',
};
const flagFor = (country?: string) => (country && FLAG_BY_COUNTRY[country]) || '🏳️';

export default function EditProfileScreen() {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const { theme, brand, shadows } = useTokens();
  const { user, refreshUserProfile } = useAuth();

  // ─── Form state ──────────────────────────────────────────────────
  const [formData, setFormData] = useState<FormData>({
    displayName: user?.displayName || '',
    realName: '',
    email: user?.email || '',
    birthDate: null,
    gender: '',
    location: '',
    photoURL: user?.photoURL || '',
    favoriteMarket: null,
  });

  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showLocationPicker, setShowLocationPicker] = useState(false);
  const [showMarketSelector, setShowMarketSelector] = useState(false);

  // Hide native stack header — DetailHeader takes over.
  useLayoutEffect(() => {
    navigation.setOptions({ headerShown: false });
  }, [navigation]);

  // ─── Initial load ────────────────────────────────────────────────
  useEffect(() => {
    if (!user?.uid) return;
    let alive = true;
    (async () => {
      try {
        const userDoc = await getDoc(doc(db, 'users', user.uid));
        if (!alive || !userDoc.exists()) return;
        const data = userDoc.data() as any;
        setFormData((prev) => ({
          ...prev,
          displayName: data.display_name || user.displayName || '',
          realName: data.real_name || '',
          birthDate: data.birthDate?.toDate?.() ?? null,
          gender: data.gender || '',
          location: data.location || '',
          photoURL: data.photo_url || user.photoURL || '',
          favoriteMarket:
            data.favoriteMarket && data.favoriteMarketName
              ? ({
                  id: data.favoriteMarket,
                  name: data.favoriteMarketName,
                  // Country isn't persisted on the user doc — flag
                  // falls back to the white flag if missing.
                  land: 'Deutschland',
                } as any)
              : null,
        }));
      } catch (e) {
        console.warn('EditProfile: load failed', e);
      }
    })();
    return () => { alive = false; };
  }, [user?.uid]);

  // ─── Save ────────────────────────────────────────────────────────
  const handleSave = async () => {
    if (!user) return;
    if (!formData.displayName.trim()) {
      Alert.alert('Fehler', 'Anzeigename ist ein Pflichtfeld.');
      return;
    }
    setSaving(true);
    try {
      await updateProfile(user, {
        displayName: formData.displayName,
        photoURL: formData.photoURL,
      });
      await updateDoc(doc(db, 'users', user.uid), {
        display_name: formData.displayName,
        real_name: formData.realName,
        photo_url: formData.photoURL,
        birthDate: formData.birthDate,
        gender: formData.gender,
        location: formData.location,
        favoriteMarket: formData.favoriteMarket?.id || null,
        favoriteMarketName: formData.favoriteMarket?.name || null,
        updatedAt: serverTimestamp(),
      });
      await refreshUserProfile();
      Alert.alert('Erfolg', 'Profil wurde aktualisiert', [
        { text: 'OK', onPress: () => router.back() },
      ]);
    } catch (e) {
      console.warn('EditProfile: save failed', e);
      Alert.alert('Fehler', 'Profil konnte nicht aktualisiert werden');
    } finally {
      setSaving(false);
    }
  };

  // ─── Photo upload ────────────────────────────────────────────────
  const pickImage = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert(
        'Berechtigung erforderlich',
        'Wir benötigen Zugriff auf deine Fotos, um dein Profilbild zu ändern.',
      );
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });
    if (!result.canceled) {
      await uploadImage(result.assets[0].uri);
    }
  };

  const uploadImage = async (uri: string) => {
    if (!user) return;
    setUploading(true);
    try {
      const response = await fetch(uri);
      const blob = await response.blob();
      const storageRef = ref(storage, `profilePictures/${user.uid}`);
      await uploadBytes(storageRef, blob);
      const downloadURL = await getDownloadURL(storageRef);
      setFormData((prev) => ({ ...prev, photoURL: downloadURL }));
      await updateProfile(user, { photoURL: downloadURL });
      await refreshUserProfile();
    } catch (e) {
      console.warn('EditProfile: upload failed', e);
      Alert.alert('Fehler', 'Profilbild konnte nicht hochgeladen werden');
    } finally {
      setUploading(false);
    }
  };

  // ─── Render ──────────────────────────────────────────────────────
  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={{
            paddingTop: insets.top + DETAIL_HEADER_ROW_HEIGHT + 12,
            paddingBottom: insets.bottom + 32,
          }}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* ─── Avatar block ─── */}
          <View style={{ alignItems: 'center', marginBottom: 18 }}>
            <Pressable
              onPress={pickImage}
              disabled={uploading}
              style={({ pressed }) => ({
                opacity: pressed ? 0.85 : 1,
                alignItems: 'center',
              })}
            >
              <View
                style={{
                  width: 104,
                  height: 104,
                  borderRadius: 52,
                  backgroundColor: theme.surfaceAlt,
                  borderWidth: 2,
                  borderColor: brand.primary,
                  alignItems: 'center',
                  justifyContent: 'center',
                  overflow: 'hidden',
                  ...shadows.sm,
                }}
              >
                {formData.photoURL ? (
                  <Image
                    source={{ uri: formData.photoURL }}
                    style={{ width: '100%', height: '100%' }}
                  />
                ) : (
                  <MaterialCommunityIcons
                    name="account"
                    size={56}
                    color={theme.textMuted}
                  />
                )}
                {/* Camera overlay badge — bottom-right */}
                <View
                  style={{
                    position: 'absolute',
                    right: 4,
                    bottom: 4,
                    width: 30,
                    height: 30,
                    borderRadius: 15,
                    backgroundColor: brand.primary,
                    borderWidth: 2.5,
                    borderColor: theme.bg,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  {uploading ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <MaterialCommunityIcons name="camera" size={14} color="#fff" />
                  )}
                </View>
              </View>
              <Text
                style={{
                  marginTop: 10,
                  fontFamily,
                  fontWeight: fontWeight.bold,
                  fontSize: 13,
                  color: brand.primary,
                  letterSpacing: -0.1,
                }}
              >
                {uploading ? 'Wird hochgeladen…' : 'Foto ändern'}
              </Text>
            </Pressable>
          </View>

          {/* ─── Identity card ─── */}
          <Card>
            <SectionTitle>Identität</SectionTitle>

            <Field
              label="Anzeigename"
              helper="Wird für Kommentare und Bewertungen verwendet"
            >
              <ClearableInput
                value={formData.displayName}
                onChangeText={(t) => setFormData((p) => ({ ...p, displayName: t }))}
                placeholder="Dein Anzeigename"
              />
            </Field>

            <Field
              label="Richtiger Name"
              helper="Für persönliche Daten und Rechnungen"
            >
              <ClearableInput
                value={formData.realName}
                onChangeText={(t) => setFormData((p) => ({ ...p, realName: t }))}
                placeholder="Dein vollständiger Name"
              />
            </Field>

            <Field
              label="E-Mail"
              helper="E-Mail-Adresse kann nicht geändert werden"
              last
            >
              <ReadOnlyValue>{formData.email || '—'}</ReadOnlyValue>
            </Field>
          </Card>

          {/* ─── Optional info card ─── */}
          <Card style={{ marginTop: 16 }}>
            <SectionTitle>Optionale Informationen</SectionTitle>

            {/* Birth Date */}
            <Field label="Geburtsdatum">
              <SelectRow
                onPress={() => setShowDatePicker(true)}
                icon="calendar"
                placeholder="Datum auswählen"
                value={
                  formData.birthDate
                    ? formData.birthDate.toLocaleDateString('de-DE')
                    : ''
                }
              />
            </Field>

            {/* Gender */}
            <Field label="Geschlecht">
              <View style={{ flexDirection: 'row', gap: 8 }}>
                {GENDER_OPTIONS.map((opt) => {
                  const on = formData.gender === opt;
                  return (
                    <Pressable
                      key={opt}
                      onPress={() => setFormData((p) => ({ ...p, gender: opt }))}
                      style={({ pressed }) => ({
                        flex: 1,
                        height: 44,
                        borderRadius: 22,
                        alignItems: 'center',
                        justifyContent: 'center',
                        backgroundColor: on ? brand.primary : theme.surfaceAlt,
                        borderWidth: 1,
                        borderColor: on ? brand.primary : theme.border,
                        opacity: pressed ? 0.75 : 1,
                      })}
                    >
                      <Text
                        style={{
                          fontFamily,
                          fontWeight: fontWeight.bold,
                          fontSize: 13,
                          color: on ? '#fff' : theme.text,
                          letterSpacing: -0.1,
                        }}
                      >
                        {opt}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </Field>

            {/* Location */}
            <Field
              label="Einkaufsort"
              helper="Hilft uns, lokale Angebote und Märkte zu finden"
            >
              <SelectRow
                onPress={() => setShowLocationPicker(true)}
                icon="map-marker-outline"
                placeholder="Standort auswählen"
                value={formData.location}
              />
            </Field>

            {/* Favorite Market */}
            <Field
              label="Lieblingsmarkt"
              helper="Wo kaufst du am liebsten ein?"
              last
            >
              <SelectRow
                onPress={() => setShowMarketSelector(true)}
                icon="storefront-outline"
                placeholder="Markt auswählen"
                value={
                  formData.favoriteMarket
                    ? `${flagFor((formData.favoriteMarket as any).land)} ${formData.favoriteMarket.name}`
                    : ''
                }
              />
            </Field>
          </Card>

          {/* ─── Save button (full-width pill) ─── */}
          <Pressable
            onPress={handleSave}
            disabled={saving}
            style={({ pressed }) => ({
              marginTop: 22,
              marginHorizontal: 20,
              height: 52,
              borderRadius: radii.full,
              backgroundColor: brand.primary,
              alignItems: 'center',
              justifyContent: 'center',
              opacity: saving ? 0.7 : pressed ? 0.9 : 1,
              ...shadows.sm,
            })}
          >
            {saving ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Text
                style={{
                  fontFamily,
                  fontWeight: fontWeight.extraBold,
                  fontSize: 15,
                  color: '#fff',
                  letterSpacing: -0.1,
                }}
              >
                Änderungen speichern
              </Text>
            )}
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>

      {/* DetailHeader — Back + Title + Save-Slot. The save in the
          right slot is a quick-access duplicate of the bottom CTA;
          spinner state mirrors the bottom button. */}
      <DetailHeader
        title="Profil bearbeiten"
        onBack={() => router.back()}
        right={
          <Pressable
            onPress={handleSave}
            disabled={saving}
            hitSlop={6}
            style={({ pressed }) => ({
              width: 36,
              height: 36,
              borderRadius: 18,
              backgroundColor: theme.surfaceAlt,
              alignItems: 'center',
              justifyContent: 'center',
              opacity: saving ? 0.5 : pressed ? 0.7 : 1,
            })}
          >
            {saving ? (
              <ActivityIndicator size="small" color={theme.textMuted} />
            ) : (
              <MaterialCommunityIcons
                name="check"
                size={20}
                color={theme.textMuted}
              />
            )}
          </Pressable>
        }
      />

      {/* Date picker — Android: native dialog, iOS: FilterSheet wrap */}
      {Platform.OS === 'android' && showDatePicker ? (
        <DateTimePicker
          value={formData.birthDate || new Date(2000, 0, 1)}
          mode="date"
          display="default"
          maximumDate={new Date()}
          onChange={(event, selectedDate) => {
            setShowDatePicker(false);
            if (event.type === 'set' && selectedDate) {
              setFormData((p) => ({ ...p, birthDate: selectedDate }));
            }
          }}
        />
      ) : null}

      {Platform.OS === 'ios' ? (
        <FilterSheet
          visible={showDatePicker}
          title="Geburtsdatum"
          onClose={() => setShowDatePicker(false)}
        >
          <View style={{ paddingBottom: 8 }}>
            <DateTimePicker
              value={formData.birthDate || new Date(2000, 0, 1)}
              mode="date"
              display="spinner"
              locale="de_DE"
              maximumDate={new Date()}
              onChange={(_event, selectedDate) => {
                if (selectedDate) {
                  setFormData((p) => ({ ...p, birthDate: selectedDate }));
                }
              }}
              textColor={theme.text}
            />
          </View>
        </FilterSheet>
      ) : null}

      {/* Location + Market pickers — keep using the existing modal
          components (legacy but functional). Future redesign can
          fold these into FilterSheet too. */}
      <LocationPicker
        visible={showLocationPicker}
        onClose={() => setShowLocationPicker(false)}
        onSelect={(locationData) => {
          setFormData((p) => ({ ...p, location: locationData.address }));
          setShowLocationPicker(false);
        }}
        currentLocation={formData.location}
        placeholder="Einkaufsort oder Stadt suchen…"
      />

      <MarketSelector
        visible={showMarketSelector}
        onClose={() => setShowMarketSelector(false)}
        onSelect={(market) => {
          setFormData((p) => ({ ...p, favoriteMarket: market }));
        }}
        selectedMarketId={formData.favoriteMarket?.id}
        title="Lieblingsmarkt wählen"
      />
    </View>
  );
}

// ────────────────────────────────────────────────────────────────────
// Inline subcomponents — small helpers kept in-file because they're
// only used here. The same shape (Card → SectionTitle → Field) is
// reused from /profile.tsx for visual consistency between the two.
// ────────────────────────────────────────────────────────────────────

function Card({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: any;
}) {
  const { theme, shadows } = useTokens();
  return (
    <View
      style={[
        {
          marginHorizontal: 16,
          padding: 16,
          paddingTop: 14,
          borderRadius: radii.lg,
          backgroundColor: theme.surface,
          ...shadows.sm,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  const { theme } = useTokens();
  return (
    <Text
      style={{
        fontFamily,
        fontWeight: fontWeight.extraBold,
        fontSize: 16,
        color: theme.text,
        letterSpacing: -0.2,
        marginBottom: 12,
      }}
    >
      {children}
    </Text>
  );
}

function Field({
  label,
  helper,
  last,
  children,
}: {
  label: string;
  helper?: string;
  last?: boolean;
  children: React.ReactNode;
}) {
  const { theme } = useTokens();
  return (
    <View style={{ marginBottom: last ? 0 : 16 }}>
      <Text
        style={{
          fontFamily,
          fontWeight: fontWeight.bold,
          fontSize: 13,
          color: theme.text,
          marginBottom: 6,
        }}
      >
        {label}
      </Text>
      {children}
      {helper ? (
        <Text
          style={{
            fontFamily,
            fontWeight: fontWeight.medium,
            fontSize: 11,
            color: theme.textMuted,
            marginTop: 6,
          }}
        >
          {helper}
        </Text>
      ) : null}
    </View>
  );
}

function ClearableInput({
  value,
  onChangeText,
  placeholder,
}: {
  value: string;
  onChangeText: (t: string) => void;
  placeholder?: string;
}) {
  const { theme } = useTokens();
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: theme.surfaceAlt,
        borderRadius: 12,
        paddingHorizontal: 14,
        paddingVertical: 10,
      }}
    >
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={theme.textMuted}
        style={{
          flex: 1,
          fontFamily,
          fontWeight: fontWeight.medium,
          fontSize: 15,
          color: theme.text,
          padding: 0,
        }}
      />
      {value.length > 0 ? (
        <Pressable onPress={() => onChangeText('')} hitSlop={8}>
          <MaterialCommunityIcons
            name="close-circle"
            size={18}
            color={theme.textMuted}
          />
        </Pressable>
      ) : null}
    </View>
  );
}

function ReadOnlyValue({ children }: { children: React.ReactNode }) {
  const { theme } = useTokens();
  return (
    <View
      style={{
        backgroundColor: theme.surfaceAlt,
        borderRadius: 12,
        paddingHorizontal: 14,
        paddingVertical: 12,
        opacity: 0.65,
      }}
    >
      <Text
        style={{
          fontFamily,
          fontWeight: fontWeight.medium,
          fontSize: 15,
          color: theme.text,
        }}
      >
        {children}
      </Text>
    </View>
  );
}

function SelectRow({
  onPress,
  icon,
  value,
  placeholder,
}: {
  onPress: () => void;
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
  value?: string;
  placeholder: string;
}) {
  const { theme } = useTokens();
  const filled = !!value && value.length > 0;
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: theme.surfaceAlt,
        borderRadius: 12,
        paddingHorizontal: 14,
        paddingVertical: 12,
        gap: 10,
        opacity: pressed ? 0.85 : 1,
      })}
    >
      <Text
        numberOfLines={1}
        style={{
          flex: 1,
          fontFamily,
          fontWeight: fontWeight.medium,
          fontSize: 15,
          color: filled ? theme.text : theme.textMuted,
        }}
      >
        {filled ? value : placeholder}
      </Text>
      <MaterialCommunityIcons name={icon} size={20} color={theme.textMuted} />
    </Pressable>
  );
}
