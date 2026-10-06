/**
 * EAN-Eingabe im Foto-Assistenten: die Nummer zum Foto bestätigen, wählen oder
 * eintippen. Erscheint, wenn die Nummer nicht eindeutig feststeht
 * (`entscheideEan` in `lib/utils/barcodeBestaetigung.ts`): Foto und
 * Live-Scan lesen verschiedene Nummern, zwei Codes im Bild, Code nicht lesbar
 * oder der Nutzer will selbst tippen. Das Foto ist schon aufgenommen und wird
 * mit der bestätigten Nummer übernommen.
 *
 * Prüft die Prüfziffer, bevor übernommen wird — ein Zahlendreher landete
 * sonst als falsche EAN in der Einreichung.
 */
import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { eingabeHinweis, type EanNachfrageGrund } from '@/lib/utils/barcodeBestaetigung';

const PURPLE = '#5b4f9c';

const TEXTE: Record<EanNachfrageGrund, { titel: string; text: string }> = {
  abweichung: {
    titel: 'Kurz die Nummer prüfen',
    text: 'Auf dem Foto lesen wir eine etwas andere Nummer als beim Scannen. Stimmt sie mit der Nummer unter dem Strichcode überein? Bei Bedarf einfach korrigieren.',
  },
  mehrdeutig: {
    titel: 'Welche Nummer gehört zum Produkt?',
    text: 'Im Bild sind mehrere Strichcodes. Tippe die Nummer an, die auf der Packung steht – oder gib sie ein.',
  },
  eintippen: {
    titel: 'Nummer eintippen',
    text: 'Tippe die Nummer unter dem Strichcode ein – dein Foto wird übernommen.',
  },
  unlesbar: {
    titel: 'EAN eingeben',
    text: 'Der Strichcode ließ sich aus dem Bild nicht automatisch lesen. Tippe die Nummer unter dem Barcode ein – dein Bild wird trotzdem übernommen.',
  },
};

export function EanEingabe(props: {
  grund: EanNachfrageGrund;
  vorschlag: string;
  vorschlaege: string[];
  topInset: number;
  onUebernehmen: (nummer: string) => void;
  /** Foto ohne Nummer übernehmen — nur angeboten, wenn nichts lesbar war. */
  onOhneNummer: () => void;
  onAbbrechen: () => void;
}) {
  const { grund, vorschlag, vorschlaege, topInset, onUebernehmen, onOhneNummer, onAbbrechen } = props;
  // Nur wenn gar nichts lesbar war (sonst säße fest, wessen Code samt Ziffern
  // unleserlich ist). Liegt eine Nummer vor — Abweichung, zwei Codes, Foto-
  // Lesung —, nie ohne Nummer: dann lehnte der Server oft mit `ean_fehlt` ab.
  const ohneNummerErlaubt =
    (grund === 'unlesbar' || grund === 'eintippen') && !vorschlag && vorschlaege.length === 0;
  const [wert, setWert] = useState(vorschlag);
  const [hinweis, setHinweis] = useState<string | null>(null);
  const texte = TEXTE[grund];

  const uebernehmen = () => {
    const ziffern = wert.replace(/\D/g, '');
    const h = eingabeHinweis(ziffern);
    if (h) {
      setHinweis(h);
      return;
    }
    onUebernehmen(ziffern);
  };

  return (
    <View style={[styles.overlay, { paddingTop: topInset }]}>
      <View style={styles.card}>
        <Text style={styles.title}>{texte.titel}</Text>
        <Text style={styles.sub}>{texte.text}</Text>
        {vorschlaege.length > 0 ? (
          <View style={styles.chipRow}>
            {vorschlaege.map((n) => {
              const aktiv = n === wert;
              return (
                <Pressable
                  key={n}
                  onPress={() => {
                    setWert(n);
                    setHinweis(null);
                  }}
                  style={[styles.chip, aktiv && styles.chipAktiv]}
                >
                  <Text style={[styles.chipText, aktiv && styles.chipTextAktiv]}>{n}</Text>
                </Pressable>
              );
            })}
          </View>
        ) : null}
        <TextInput
          style={styles.input}
          value={wert}
          onChangeText={(t) => {
            setWert(t.replace(/\D/g, '').slice(0, 14));
            setHinweis(null);
          }}
          keyboardType="number-pad"
          placeholder="z. B. 4337256984164"
          placeholderTextColor="rgba(0,0,0,0.35)"
          // Mit Vorschlägen erst die Auswahl zeigen — die Tastatur verdeckte sie sonst.
          autoFocus={!vorschlag && vorschlaege.length === 0}
          maxLength={14}
          returnKeyType="done"
          onSubmitEditing={uebernehmen}
        />
        {hinweis ? <Text style={styles.hinweis}>{hinweis}</Text> : null}
        <View style={styles.btnRow}>
          <Pressable onPress={onAbbrechen} style={[styles.btn, styles.btnGhost]}>
            <Text style={styles.btnGhostText}>Abbrechen</Text>
          </Pressable>
          <Pressable onPress={uebernehmen} style={[styles.btn, styles.btnPrimary]}>
            <Text style={styles.btnPrimaryText}>Übernehmen</Text>
          </Pressable>
        </View>
        {ohneNummerErlaubt ? (
          <Pressable onPress={onOhneNummer} hitSlop={8} style={styles.ohneNummer}>
            <Text style={styles.ohneNummerText}>Nummer nicht lesbar? Ohne Nummer weiter</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.72)', alignItems: 'center', paddingHorizontal: 24 },
  card: { width: '100%', maxWidth: 380, backgroundColor: '#fff', borderRadius: 18, padding: 20, gap: 12 },
  title: { fontSize: 18, fontWeight: '800', color: '#191c1d', letterSpacing: -0.2 },
  sub: { fontSize: 13, fontWeight: '500', color: '#5a6166', lineHeight: 18 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 12, borderWidth: 1.5, borderColor: '#d5dadd', backgroundColor: '#f6f8f9' },
  chipAktiv: { borderColor: PURPLE, backgroundColor: 'rgba(91,79,156,0.10)' },
  chipText: { fontSize: 15, fontWeight: '700', color: '#191c1d', letterSpacing: 0.6 },
  chipTextAktiv: { color: PURPLE },
  input: { height: 52, borderRadius: 12, borderWidth: 1.5, borderColor: '#d5dadd', backgroundColor: '#f6f8f9', paddingHorizontal: 14, fontSize: 18, fontWeight: '700', color: '#191c1d', letterSpacing: 1 },
  hinweis: { fontSize: 13, fontWeight: '600', color: '#8a5a00', lineHeight: 18 },
  btnRow: { flexDirection: 'row', gap: 10, marginTop: 4 },
  btn: { flex: 1, height: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  btnGhost: { backgroundColor: '#eef1f2' },
  btnGhostText: { fontSize: 15, fontWeight: '700', color: '#5a6166' },
  btnPrimary: { backgroundColor: PURPLE },
  btnPrimaryText: { fontSize: 15, fontWeight: '800', color: '#fff' },
  ohneNummer: { alignSelf: 'center', paddingVertical: 4 },
  ohneNummerText: { fontSize: 13, fontWeight: '600', color: '#5a6166', textDecorationLine: 'underline' },
});
