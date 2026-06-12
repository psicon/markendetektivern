import { useColorScheme } from '@/hooks/useColorScheme';
import { useAuth } from '@/lib/contexts/AuthContext';
import { ratingPromptService } from '@/lib/services/ratingPrompt';
import { showInfoToast } from '@/lib/services/ui/toast';
import { LinearGradient } from 'expo-linear-gradient';
import React, { useState } from 'react';
import {
  Dimensions,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { IconSymbol } from './IconSymbol';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

interface AppRatingModalProps {
  visible: boolean;
  onClose: () => void;
}

type RatingStep = 'initial' | 'store' | 'feedback';

/**
 * Feedback-Kategorien der "Geht so"-Route — 1-Tap-Chips statt
 * Freitext-Pflicht (niedrige Huerde, strukturiertes Feedback).
 */
const FEEDBACK_CHIPS: { key: string; label: string }[] = [
  { key: 'products', label: 'Zu wenige Produkte' },
  { key: 'bugs', label: 'Fehler / Abstürze' },
  { key: 'ux', label: 'Unübersichtlich' },
  { key: 'prices', label: 'Preise stimmen nicht' },
  { key: 'other', label: 'Sonstiges' },
];

/**
 * App-Rating-Funnel (Redesign 2026-06-12, psychologische Hebel):
 *
 *  1. REZIPROZITÄT: Headline spiegelt zuerst den ERHALTENEN Wert
 *     (echte Gesamtersparnis bzw. Detektiv-Level), dann erst die
 *     Frage — die Bitte fühlt sich wie ein fairer Tausch an.
 *  2. ASYMMETRIE: positive Antwort ist der visuell primäre, voll
 *     gefüllte Button mit konkreter Sprache ('Ja, richtig gut!');
 *     'Geht so' ist ein dezenter Ghost darunter. Beide ehrlich
 *     vorhanden (Store-konform), aber mit klarer Führung.
 *  3. HELFER-FRAMING im Store-Schritt: 'Hilf anderen Sparfüchsen,
 *     uns zu finden' schlägt die Ich-Bitte 'bewerte uns'. Der
 *     native In-App-Review-Prompt (requestStoreReview) minimiert
 *     die Reibung.
 *  4. Negative Route: 1-Tap-Kategorie-Chips + optionaler Freitext;
 *     diese Nutzer werden nie zum Store geleitet.
 *  5. HYGIENE: X/Später = 60-Tage-Cooldown (markDismissed), nach
 *     einer Antwort nie wieder (hasRated, wie bisher).
 */
export const AppRatingModal: React.FC<AppRatingModalProps> = ({ visible, onClose }) => {
  const colorScheme = useColorScheme();
  void colorScheme; // Modal ist auf dem Gradient self-contained.
  const { user, userProfile } = useAuth();

  const [currentStep, setCurrentStep] = useState<RatingStep>('initial');
  const [feedback, setFeedback] = useState('');
  const [selectedChips, setSelectedChips] = useState<string[]>([]);
  const [ratingDocId, setRatingDocId] = useState<string | undefined>(undefined);

  const totalSavings = Number(userProfile?.totalSavings ?? 0);
  const level = Number(
    userProfile?.stats?.currentLevel ?? (userProfile as any)?.level ?? 1,
  );
  const savingsLabel = `${totalSavings.toFixed(2).replace('.', ',')} €`;

  const resetAndClose = () => {
    setCurrentStep('initial');
    setFeedback('');
    setSelectedChips([]);
    setRatingDocId(undefined);
    onClose();
  };

  /** X / 'Später' im initial-Step: Cooldown setzen, damit der Prompt
   *  nicht beim nächsten Trigger sofort wieder nervt. */
  const handleDismiss = () => {
    if (user?.uid) void ratingPromptService.markDismissed(user.uid);
    resetAndClose();
  };

  const handlePositive = async () => {
    if (user?.uid) {
      const docId = await ratingPromptService.markAsRated(user.uid, 'positive', level);
      setRatingDocId(docId);
    }
    setCurrentStep('store');
  };

  const handleNegative = async () => {
    if (user?.uid) {
      const docId = await ratingPromptService.markAsRated(user.uid, 'negative', level);
      setRatingDocId(docId);
    }
    setCurrentStep('feedback');
  };

  const handleStoreReview = () => {
    void ratingPromptService.requestStoreReview();
    resetAndClose();
  };

  const toggleChip = (key: string) =>
    setSelectedChips((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key],
    );

  const handleSubmitFeedback = async () => {
    try {
      if (user?.uid && (feedback.trim() || selectedChips.length > 0)) {
        await ratingPromptService.saveFeedback(
          user.uid,
          feedback.trim(),
          ratingDocId,
          selectedChips,
        );
      }
    } catch (error) {
      console.error('Feedback error:', error);
    }
    resetAndClose();
    showInfoToast('Danke dir — das hilft uns wirklich weiter! 💚', 'success');
  };

  if (!visible) return null;

  // ─── Step 1: Wert spiegeln + asymmetrische Frage ──────────────────
  const renderInitialStep = () => {
    const hasSavings = totalSavings >= 0.5;
    return (
      <>
        <View style={styles.iconContainer}>
          <IconSymbol
            name={hasSavings ? 'eurosign.circle.fill' : 'heart.fill'}
            size={52}
            color="white"
          />
        </View>

        {hasSavings ? (
          <>
            <Text style={styles.eyebrow}>DU HAST MIT MARKENDETEKTIVE SCHON</Text>
            <Text style={styles.heroNumber}>{savingsLabel}</Text>
            <Text style={styles.heroSuffix}>gespart 🎉</Text>
          </>
        ) : (
          <Text style={styles.title}>
            Du bist schon Level-{level}-Detektiv! 🕵️
          </Text>
        )}
        <Text style={styles.subtitle}>Macht dir MarkenDetektive Freude?</Text>

        {/* Asymmetrie: Positiv = primärer, voll gefüllter Button. */}
        <View style={styles.buttonContainer}>
          <TouchableOpacity style={styles.primaryButton} onPress={handlePositive}>
            <IconSymbol name="hand.thumbsup.fill" size={20} color="#5b4f9c" />
            <Text style={styles.primaryButtonText}>Ja, richtig gut!</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.ghostButton} onPress={handleNegative}>
            <Text style={styles.ghostButtonText}>Geht so</Text>
          </TouchableOpacity>
        </View>
      </>
    );
  };

  // ─── Step 2 (nur nach Ja): Helfer-Framing + nativer Review ────────
  const renderStoreStep = () => (
    <>
      <View style={styles.iconContainer}>
        <IconSymbol name="star.fill" size={52} color="#ffd44b" />
      </View>

      <Text style={styles.title}>Danke dir! 💚</Text>
      <Text style={styles.subtitle}>
        Hilf anderen Sparfüchsen, uns zu finden — eine Bewertung dauert keine
        10 Sekunden und macht für uns einen riesigen Unterschied.
      </Text>

      <View style={styles.buttonContainer}>
        <TouchableOpacity style={styles.primaryButton} onPress={handleStoreReview}>
          <IconSymbol name="star.fill" size={18} color="#5b4f9c" />
          <Text style={styles.primaryButtonText}>
            {Platform.OS === 'ios' ? 'Im App Store unterstützen' : 'Im Play Store unterstützen'}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.ghostButton} onPress={handleDismiss}>
          <Text style={styles.ghostButtonText}>Später</Text>
        </TouchableOpacity>
      </View>
    </>
  );

  // ─── Step 3 (nur nach Geht so): Chips + optionaler Freitext ───────
  const renderFeedbackStep = () => (
    <>
      <View style={styles.iconContainer}>
        <IconSymbol name="lightbulb.fill" size={52} color="white" />
      </View>

      <Text style={styles.title}>Was sollten wir besser machen?</Text>
      <Text style={styles.subtitle}>
        Tippe an, was dich stört — wir lesen jedes Feedback.
      </Text>

      <View style={styles.chipWrap}>
        {FEEDBACK_CHIPS.map((chip) => {
          const on = selectedChips.includes(chip.key);
          return (
            <Pressable
              key={chip.key}
              onPress={() => toggleChip(chip.key)}
              style={[styles.chip, on && styles.chipActive]}
            >
              <Text style={[styles.chipText, on && styles.chipTextActive]}>
                {chip.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <View style={styles.feedbackContainer}>
        <TextInput
          style={styles.feedbackInput}
          placeholder="Magst du es kurz beschreiben? (optional)"
          placeholderTextColor="#888"
          value={feedback}
          onChangeText={setFeedback}
          multiline
          numberOfLines={3}
          textAlignVertical="top"
        />
      </View>

      <View style={styles.buttonContainer}>
        <TouchableOpacity
          style={[
            styles.primaryButton,
            selectedChips.length === 0 && !feedback.trim() && styles.primaryButtonDisabled,
          ]}
          onPress={handleSubmitFeedback}
          disabled={selectedChips.length === 0 && !feedback.trim()}
        >
          <IconSymbol name="paperplane.fill" size={18} color="#5b4f9c" />
          <Text style={styles.primaryButtonText}>Feedback senden</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.ghostButton} onPress={resetAndClose}>
          <Text style={styles.ghostButtonText}>Überspringen</Text>
        </TouchableOpacity>
      </View>
    </>
  );

  return (
    <Modal visible={visible} transparent animationType="fade">
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <View style={[styles.overlay, currentStep === 'feedback' && styles.overlayKeyboard]}>
          <View style={styles.modalContainer}>
            <LinearGradient
              colors={['#667eea', '#764ba2']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.gradientBackground}
            >
              <TouchableOpacity style={styles.closeButton} onPress={handleDismiss}>
                <IconSymbol name="xmark" size={16} color="rgba(255,255,255,0.9)" />
              </TouchableOpacity>

              {currentStep === 'initial' && renderInitialStep()}
              {currentStep === 'store' && renderStoreStep()}
              {currentStep === 'feedback' && renderFeedbackStep()}
            </LinearGradient>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  overlayKeyboard: {
    justifyContent: 'flex-start',
    paddingTop: Platform.OS === 'ios' ? 80 : 40,
  },
  modalContainer: {
    width: SCREEN_WIDTH * 0.88,
    maxWidth: 400,
    borderRadius: 20,
    overflow: 'hidden',
  },
  gradientBackground: {
    padding: 24,
    alignItems: 'center',
  },
  closeButton: {
    position: 'absolute',
    top: 16,
    right: 16,
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.12)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 2,
  },
  iconContainer: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: 'rgba(255,255,255,0.2)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 18,
    marginTop: 16,
  },
  eyebrow: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.8,
    color: 'rgba(255,255,255,0.85)',
    textAlign: 'center',
  },
  heroNumber: {
    fontSize: 44,
    fontWeight: '800',
    letterSpacing: -1,
    color: 'white',
    textAlign: 'center',
    marginTop: 2,
  },
  heroSuffix: {
    fontSize: 16,
    fontWeight: '700',
    color: 'rgba(255,255,255,0.95)',
    textAlign: 'center',
    marginTop: 2,
    marginBottom: 6,
  },
  title: {
    fontSize: 20,
    fontWeight: '800',
    color: 'white',
    textAlign: 'center',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 14,
    fontWeight: '500',
    color: 'rgba(255,255,255,0.92)',
    textAlign: 'center',
    marginBottom: 24,
    lineHeight: 20,
    maxWidth: 300,
  },
  buttonContainer: {
    width: '100%',
    gap: 10,
  },
  primaryButton: {
    backgroundColor: '#ffffff',
    borderRadius: 14,
    paddingVertical: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowOffset: { width: 0, height: 3 },
    shadowRadius: 8,
    elevation: 4,
  },
  primaryButtonDisabled: {
    opacity: 0.55,
  },
  primaryButtonText: {
    fontSize: 16,
    fontWeight: '800',
    color: '#5b4f9c',
  },
  ghostButton: {
    paddingVertical: 12,
    alignItems: 'center',
  },
  ghostButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.75)',
  },
  chipWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 8,
    marginBottom: 14,
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.14)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.35)',
  },
  chipActive: {
    backgroundColor: '#ffffff',
    borderColor: '#ffffff',
  },
  chipText: {
    fontSize: 13,
    fontWeight: '600',
    color: 'white',
  },
  chipTextActive: {
    color: '#5b4f9c',
  },
  feedbackContainer: {
    width: '100%',
    marginBottom: 16,
  },
  feedbackInput: {
    backgroundColor: 'rgba(255,255,255,0.95)',
    borderRadius: 12,
    padding: 14,
    fontSize: 15,
    color: '#222',
    minHeight: 76,
  },
});
