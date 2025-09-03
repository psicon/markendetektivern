import { Colors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
import { useAuth } from '@/lib/contexts/AuthContext';
import { ratingPromptService } from '@/lib/services/ratingPrompt';
import { LinearGradient } from 'expo-linear-gradient';
import React, { useState } from 'react';
import { Alert, Dimensions, Modal, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { IconSymbol } from './IconSymbol';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

interface AppRatingModalProps {
  visible: boolean;
  onClose: () => void;
}

type RatingStep = 'initial' | 'store' | 'feedback';

export const AppRatingModal: React.FC<AppRatingModalProps> = ({ visible, onClose }) => {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const { user, userProfile } = useAuth();
  
  const [currentStep, setCurrentStep] = useState<RatingStep>('initial');
  const [feedback, setFeedback] = useState('');
  const [ratingDocId, setRatingDocId] = useState<string | undefined>(undefined);

  const handleClose = () => {
    setCurrentStep('initial');
    setFeedback('');
    setRatingDocId(undefined);
    onClose();
  };

  const handleThumbsUp = async () => {
    console.log('👍 Thumbs up clicked - saving to Firestore immediately');
    if (user?.uid) {
      const currentLevel = userProfile?.stats?.currentLevel || userProfile?.level || 1;
      console.log(`📊 User Level: ${currentLevel}`);
      const docId = await ratingPromptService.markAsRated(user.uid, 'positive', currentLevel);
      setRatingDocId(docId);
      console.log('✅ Positive rating saved to Firestore with level:', currentLevel);
    }
    setCurrentStep('store');
  };

  const handleThumbsDown = async () => {
    console.log('👎 Thumbs down clicked - saving to Firestore immediately');
    if (user?.uid) {
      const currentLevel = userProfile?.stats?.currentLevel || userProfile?.level || 1;
      console.log(`📊 User Level: ${currentLevel}`);
      const docId = await ratingPromptService.markAsRated(user.uid, 'negative', currentLevel);
      setRatingDocId(docId);
      console.log('✅ Negative rating saved to Firestore with level:', currentLevel);
    }
    setCurrentStep('feedback');
  };

  const handleSubmitFeedback = async () => {
    console.log('📝 Feedback submitted:', feedback);
    try {
      if (user?.uid && feedback.trim()) {
        // Add feedback to existing Firestore document
        await ratingPromptService.saveFeedback(user.uid, feedback.trim(), ratingDocId);
        console.log('✅ Feedback added to Firestore document:', ratingDocId);
      }
      Alert.alert('Danke!', 'Dein Feedback wurde gespeichert.');
      handleClose();
    } catch (error) {
      console.error('Feedback error:', error);
      Alert.alert('Danke!', 'Dein Feedback wurde gespeichert.'); // Still show success to user
    }
  };

  const handleSkipFeedback = () => {
    console.log('⏭️ Feedback skipped - rating already saved');
    handleClose();
  };

  const handleStoreReview = () => {
    console.log('⭐ Store review requested');
    ratingPromptService.requestStoreReview();
    handleClose();
  };

  if (!visible) return null;

  const renderInitialStep = () => (
    <>
      {/* App Icon */}
      <View style={styles.iconContainer}>
        <IconSymbol name="heart.fill" size={60} color="white" />
      </View>

      {/* Title */}
      <Text style={styles.title}>Wie findest du MarkenDetektive?</Text>
      <Text style={styles.subtitle}>Deine Meinung hilft uns, die App zu verbessern!</Text>

      {/* Rating Buttons */}
      <View style={styles.ratingContainer}>
        <TouchableOpacity style={styles.ratingButton} onPress={handleThumbsUp}>
          <IconSymbol name="hand.thumbsup.fill" size={32} color="white" />
          <Text style={styles.ratingButtonText}>Gefällt mir</Text>
        </TouchableOpacity>
        
        <TouchableOpacity style={styles.ratingButton} onPress={handleThumbsDown}>
          <IconSymbol name="hand.thumbsdown.fill" size={32} color="white" />
          <Text style={styles.ratingButtonText}>Gefällt mir nicht</Text>
        </TouchableOpacity>
      </View>
    </>
  );

  const renderStoreStep = () => (
    <>
      <View style={styles.iconContainer}>
        <IconSymbol name="star.fill" size={60} color="white" />
      </View>

      <Text style={styles.title}>Fantastisch!</Text>
      <Text style={styles.subtitle}>Würdest du uns im App Store bewerten?</Text>

      <View style={styles.buttonContainer}>
        <TouchableOpacity style={styles.primaryButton} onPress={handleStoreReview}>
          <IconSymbol name="star" size={18} color="#667eea" />
          <Text style={styles.primaryButtonText}>Im Store bewerten</Text>
        </TouchableOpacity>
        
        <TouchableOpacity style={styles.secondaryButton} onPress={handleClose}>
          <Text style={styles.secondaryButtonText}>Später</Text>
        </TouchableOpacity>
      </View>
    </>
  );

  const renderFeedbackStep = () => (
    <>
      <View style={styles.iconContainer}>
        <IconSymbol name="lightbulb.fill" size={60} color="white" />
      </View>

      <Text style={styles.title}>Was können wir verbessern?</Text>
      <Text style={styles.subtitle}>Dein Feedback hilft uns, MarkenDetektive besser zu machen!</Text>

      <View style={styles.feedbackContainer}>
        <TextInput
          style={styles.feedbackInput}
          placeholder="Dein Feedback (optional)..."
          placeholderTextColor="#666"
          value={feedback}
          onChangeText={setFeedback}
          multiline
          numberOfLines={4}
          textAlignVertical="top"
        />
      </View>

      <View style={styles.buttonContainer}>
        <TouchableOpacity style={styles.primaryButton} onPress={handleSubmitFeedback}>
          <IconSymbol name="paperplane.fill" size={18} color="#667eea" />
          <Text style={styles.primaryButtonText}>Feedback senden</Text>
        </TouchableOpacity>
        
        <TouchableOpacity style={styles.secondaryButton} onPress={handleSkipFeedback}>
          <Text style={styles.secondaryButtonText}>Überspringen</Text>
        </TouchableOpacity>
      </View>
    </>
  );

  if (!visible) return null;

  return (
    <Modal visible={visible} transparent animationType="fade">
      <View style={styles.overlay}>
        <View style={styles.modalContainer}>
          <LinearGradient
            colors={['#667eea', '#764ba2']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.gradientBackground}
          >
            {/* Close Button */}
            <TouchableOpacity style={styles.closeButton} onPress={handleClose}>
              <IconSymbol name="xmark" size={16} color="rgba(255,255,255,0.9)" />
            </TouchableOpacity>

            {/* Content based on current step */}
            {currentStep === 'initial' && renderInitialStep()}
            {currentStep === 'store' && renderStoreStep()}
            {currentStep === 'feedback' && renderFeedbackStep()}
          </LinearGradient>
        </View>
      </View>
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
  modalContainer: {
    width: SCREEN_WIDTH * 0.85,
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
    backgroundColor: 'rgba(255,255,255,0.1)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  iconContainer: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: 'rgba(255,255,255,0.2)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 24,
    marginTop: 20,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: 'white',
    textAlign: 'center',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 14,
    fontWeight: '400',
    color: 'rgba(255,255,255,0.9)',
    textAlign: 'center',
    marginBottom: 32,
    lineHeight: 20,
  },
  ratingContainer: {
    flexDirection: 'row',
    gap: 20,
    marginBottom: 20,
  },
  ratingButton: {
    backgroundColor: 'rgba(255,255,255,0.2)',
    borderRadius: 12,
    paddingVertical: 20,
    paddingHorizontal: 24,
    alignItems: 'center',
    flex: 1,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.3)',
  },
  ratingButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: 'white',
    marginTop: 8,
    textAlign: 'center',
  },
  feedbackContainer: {
    width: '100%',
    marginBottom: 24,
  },
  feedbackInput: {
    backgroundColor: 'rgba(255,255,255,0.9)',
    borderRadius: 12,
    padding: 16,
    fontSize: 16,
    color: '#333',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.3)',
    minHeight: 100,
  },
  buttonContainer: {
    width: '100%',
    gap: 12,
  },
  primaryButton: {
    backgroundColor: 'rgba(255,255,255,0.9)',
    borderRadius: 12,
    paddingVertical: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  primaryButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#667eea',
  },
  secondaryButton: {
    backgroundColor: 'rgba(255,255,255,0.2)',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.3)',
  },
  secondaryButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: 'white',
  },
});