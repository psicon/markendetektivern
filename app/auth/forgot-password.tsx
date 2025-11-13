import { ThemedText } from '@/components/ThemedText';
import { CustomIcon } from '@/components/ui/CustomIcon';
import { IconSymbol } from '@/components/ui/IconSymbol';
import { Colors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
import { auth } from '@/lib/firebase';
import { LinearGradient } from 'expo-linear-gradient';
import { Stack, useRouter } from 'expo-router';
import { sendPasswordResetEmail } from 'firebase/auth';
import React, { useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    Animated,
    Dimensions,
    ImageBackground,
    StyleSheet,
    TextInput,
    TouchableOpacity,
    View
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export default function ForgotPasswordScreen() {
  const router = useRouter();
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const insets = useSafeAreaInsets();
  const screenHeight = Dimensions.get('window').height;
  const isSmallDevice = screenHeight < 700;

  // Image loading state and animation
  const [imageLoaded, setImageLoaded] = useState(false);
  const fadeAnim = useState(new Animated.Value(0))[0];

  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [emailSent, setEmailSent] = useState(false);

  const handleImageLoad = () => {
    setImageLoaded(true);
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 300,
      useNativeDriver: true,
    }).start();
  };

  const handleResetPassword = async () => {
    if (!email.trim()) {
      Alert.alert('E-Mail erforderlich', 'Bitte gib deine E-Mail-Adresse ein.');
      return;
    }

    try {
      setLoading(true);
      await sendPasswordResetEmail(auth, email.trim());
      setEmailSent(true);
      Alert.alert(
        'E-Mail gesendet! ✅',
        'Wir haben dir eine E-Mail mit einem Link zum Zurücksetzen deines Passworts gesendet. Bitte überprüfe auch deinen Spam-Ordner.',
        [
          {
            text: 'OK',
            onPress: () => router.back()
          }
        ]
      );
    } catch (error: any) {
      console.error('Password reset error:', error);
      let errorMessage = 'Ein Fehler ist aufgetreten. Bitte versuche es später erneut.';
      
      switch (error.code) {
        case 'auth/invalid-email':
          errorMessage = 'Die eingegebene E-Mail-Adresse ist ungültig.';
          break;
        case 'auth/user-not-found':
          errorMessage = 'Es wurde kein Account mit dieser E-Mail-Adresse gefunden.';
          break;
        case 'auth/too-many-requests':
          errorMessage = 'Zu viele Anfragen. Bitte versuche es später erneut.';
          break;
      }
      
      Alert.alert('Fehler', errorMessage);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.container}>
      {/* Static background while image loads */}
      <View style={[styles.background, { backgroundColor: colorScheme === 'dark' ? '#000000' : '#f5f5f5' }]} />
      
      {/* Animated ImageBackground */}
      <Animated.View style={[styles.imageContainer, { opacity: fadeAnim }]}>
        <ImageBackground 
          source={require('@/assets/images/table-optimized.jpg')}
          style={styles.background}
          blurRadius={2}
          onLoad={handleImageLoad}
        />
      
      {/* Dynamic gradient overlay based on theme */}
      <LinearGradient
        colors={
          colorScheme === 'dark' 
            ? ['rgba(0,0,0,0.2)', 'rgba(0,0,0,0.5)', 'rgba(0,0,0,0.85)', 'rgba(0,0,0,0.98)']
            : ['rgba(0,0,0,0.2)', 'rgba(0,0,0,0.4)', 'rgba(0,0,0,0.7)', 'rgba(0,0,0,0.9)']
        }
        locations={[0, 0.3, 0.7, 1]}
        style={[styles.overlay, { paddingTop: insets.top + 20, paddingBottom: insets.bottom + 20 }]}
      >
        {/* Back Button */}
        <TouchableOpacity 
          style={styles.backButtonWithText}
          onPress={() => router.back()}
        >
          <IconSymbol name="chevron.left" size={20} color="white" />
          <ThemedText style={styles.backButtonText}>Zurück</ThemedText>
        </TouchableOpacity>

        {/* Logo */}
        <View style={[styles.logoContainer, isSmallDevice && styles.logoContainerSmall]}>
          <CustomIcon 
            name="iconBlack" 
            size={isSmallDevice ? 48 : 64} 
            color="white"
            style={styles.logoIcon}
          />
          <ThemedText style={[styles.logoText, isSmallDevice && styles.logoTextSmall]}>MarkenDetektive</ThemedText>
        </View>

        {/* Content */}
        <View style={[styles.content, isSmallDevice && styles.contentSmall]}>
          <ThemedText style={[styles.title, isSmallDevice && styles.titleSmall]}>
            Passwort vergessen?
          </ThemedText>
          
          <ThemedText style={[styles.description, isSmallDevice && styles.descriptionSmall]}>
            Kein Problem! Gib deine E-Mail-Adresse ein und wir senden dir einen Link zum Zurücksetzen deines Passworts.
          </ThemedText>

          <View style={styles.formContainer}>
            {/* Email Input */}
            <View style={styles.inputContainer}>
              <TextInput
                style={[styles.input, isSmallDevice && styles.inputSmall]}
                placeholder="E-Mail"
                placeholderTextColor="rgba(255, 255, 255, 0.7)"
                value={email}
                onChangeText={setEmail}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                editable={!emailSent}
              />
            </View>

            {/* Reset Button */}
            <TouchableOpacity 
              style={[styles.resetButton, { backgroundColor: colors.primary }, loading && { opacity: 0.7 }]}
              onPress={handleResetPassword}
              disabled={loading || emailSent}
            >
              {loading ? (
                <ActivityIndicator color="white" />
              ) : (
                <>
                  <IconSymbol name="envelope" size={20} color="white" />
                  <ThemedText style={styles.resetButtonText}>
                    {emailSent ? 'E-Mail gesendet' : 'Link senden'}
                  </ThemedText>
                </>
              )}
            </TouchableOpacity>

            {/* Back to Login */}
            <TouchableOpacity 
              style={styles.backToLogin}
              onPress={() => router.back()}
            >
              <ThemedText style={[styles.backToLoginText, { color: colors.primary }]}>
                Zurück zur Anmeldung
              </ThemedText>
            </TouchableOpacity>
          </View>
        </View>
      </LinearGradient>
      </Animated.View>
    </View>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  background: {
    flex: 1,
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  imageContainer: {
    flex: 1,
  },
  overlay: {
    flex: 1,
    paddingHorizontal: 24,
  },
  backButtonWithText: {
    position: 'absolute',
    top: 60,
    left: 0,
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 20,
    gap: 6,
    zIndex: 10,
  },
  backButtonText: {
    fontSize: 16,
    fontFamily: 'Nunito_500Medium',
    color: 'white',
  },
  logoContainer: {
    alignItems: 'center',
    marginTop: 40,
    gap: 5,
  },
  logoIcon: {
    marginBottom: 4,
  },
  logoText: {
    fontSize: 28,
    fontFamily: 'Nunito_700Bold',
    color: 'white',
    textAlign: 'center',
    lineHeight: 32,
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  title: {
    fontSize: 22,
    fontFamily: 'Nunito_700Bold',
    color: 'white',
    textAlign: 'center',
    marginBottom: 16,
  },
  description: {
    fontSize: 16,
    fontFamily: 'Nunito_400Regular',
    color: 'rgba(255, 255, 255, 0.8)',
    textAlign: 'center',
    marginBottom: 32,
    lineHeight: 22,
    paddingHorizontal: 20,
  },
  formContainer: {
    width: '100%',
    gap: 16,
  },
  inputContainer: {
    width: '100%',
  },
  input: {
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.3)',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 16,
    fontSize: 16,
    color: 'white',
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
  },
  resetButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    paddingVertical: 16,
    borderRadius: 12,
    gap: 12,
  },
  resetButtonText: {
    color: 'white',
    fontSize: 16,
    fontFamily: 'Nunito_600SemiBold',
  },
  backToLogin: {
    alignItems: 'center',
    marginTop: 8,
  },
  backToLoginText: {
    fontSize: 14,
    fontFamily: 'Nunito_600SemiBold',
  },
  // Small device styles
  logoContainerSmall: {
    marginTop: 30,
    gap: 3,
  },
  logoTextSmall: {
    fontSize: 24,
  },
  contentSmall: {
    paddingTop: 10,
  },
  titleSmall: {
    fontSize: 22,
    marginBottom: 10,
  },
  descriptionSmall: {
    fontSize: 14,
    marginBottom: 24,
    lineHeight: 20,
  },
  inputSmall: {
    paddingVertical: 12,
    paddingHorizontal: 14,
  }
});
