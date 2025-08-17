import { ThemedText } from '@/components/ThemedText';
import { CustomIcon } from '@/components/ui/CustomIcon';
import { IconSymbol } from '@/components/ui/IconSymbol';
import { Colors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
import { useAuth } from '@/lib/contexts/AuthContext';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    Animated,
    Dimensions,
    ImageBackground,
    Platform,
    StyleSheet,
    TextInput,
    TouchableOpacity,
    View
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export default function LoginScreen() {
  const router = useRouter();
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const { signIn, signInWithGoogle, signInWithApple, isAppleAuthAvailable } = useAuth();
  const insets = useSafeAreaInsets();
  const screenHeight = Dimensions.get('window').height;

  // Image loading state and animation
  const [imageLoaded, setImageLoaded] = useState(false);
  const fadeAnim = useState(new Animated.Value(0))[0];

  const [formData, setFormData] = useState({
    email: '',
    password: ''
  });
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const handleLogin = async () => {
    if (!formData.email || !formData.password) {
      Alert.alert('Fehler', 'Bitte fülle alle Felder aus.');
      return;
    }

    setLoading(true);

    try {
      await signIn(formData.email, formData.password);
      router.replace('/(tabs)');
    } catch (error: any) {
      console.error('Login error:', error);
      
      let errorMessage = 'Ein Fehler ist aufgetreten.';
      if (error.code === 'auth/user-not-found') {
        errorMessage = 'Kein Account mit dieser E-Mail-Adresse gefunden.';
      } else if (error.code === 'auth/wrong-password') {
        errorMessage = 'Falsches Passwort.';
      } else if (error.code === 'auth/invalid-email') {
        errorMessage = 'Die E-Mail-Adresse ist ungültig.';
      } else if (error.code === 'auth/too-many-requests') {
        errorMessage = 'Zu viele Anmeldeversuche. Versuche es später erneut.';
      }
      
      Alert.alert('Anmeldung fehlgeschlagen', errorMessage);
    } finally {
      setLoading(false);
    }
  };

  const handleImageLoad = () => {
    setImageLoaded(true);
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 500,
      useNativeDriver: true,
    }).start();
  };

  const handleGoogleSignIn = async () => {
    try {
      setLoading(true);
      await signInWithGoogle();
      router.replace('/(tabs)');
    } catch (error: any) {
      console.error('Google Sign-In error:', error);
      Alert.alert('Google Anmeldung fehlgeschlagen', error.message || 'Ein Fehler ist aufgetreten');
    } finally {
      setLoading(false);
    }
  };

  const handleAppleSignIn = async () => {
    try {
      // Check if Apple Sign-In is available
      const isAvailable = await isAppleAuthAvailable();
      if (!isAvailable) {
        Alert.alert('Nicht verfügbar', 'Apple Sign-In ist auf diesem Gerät nicht verfügbar');
        return;
      }
      
      setLoading(true);
      await signInWithApple();
      router.replace('/(tabs)');
    } catch (error: any) {
      console.error('Apple Sign-In error:', error);
      Alert.alert('Apple Anmeldung fehlgeschlagen', error.message || 'Ein Fehler ist aufgetreten');
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      {/* Static background while image loads */}
      <View style={[styles.background, { backgroundColor: colorScheme === 'dark' ? '#000000' : '#f5f5f5' }]} />
      
      {/* Animated ImageBackground */}
      <Animated.View style={[styles.imageContainer, { opacity: fadeAnim }]}>
        <ImageBackground 
          source={require('@/assets/images/table.jpg')}
          style={styles.background}
          blurRadius={2}
          onLoad={handleImageLoad}
        />
      
      {/* Dynamic gradient overlay based on theme */}
      <LinearGradient
        colors={
          colorScheme === 'dark' 
            ? ['transparent', 'rgba(0,0,0,0.3)', 'rgba(0,0,0,0.8)', 'rgba(0,0,0,0.95)']
            : ['transparent', 'rgba(0,0,0,0.2)', 'rgba(0,0,0,0.6)', 'rgba(0,0,0,0.85)']
        }
        locations={[0, 0.3, 0.7, 1]}
        style={[styles.overlay, { paddingTop: insets.top + 20, paddingBottom: insets.bottom + 20 }]}
      >
        {/* Back Button */}
        <TouchableOpacity 
          style={styles.backButton}
          onPress={() => router.back()}
        >
          <IconSymbol name="chevron.left" size={24} color="white" />
        </TouchableOpacity>

        {/* Logo */}
        <View style={styles.logoContainer}>
          <CustomIcon 
            name="iconBlack" 
            size={64} 
            color="white"
            style={styles.logoIcon}
          />
          <ThemedText style={styles.logoText}>MarkenDetektive</ThemedText>
        </View>

        {/* Content */}
        <View style={styles.content}>
          <ThemedText style={styles.subTitle}>Willkommen zurück!</ThemedText>
          
          <View style={styles.authButtons}>
            {/* Form Fields */}
            <View style={styles.formContainer}>
              {/* Email Input */}
              <View style={styles.inputContainer}>
                <TextInput
                  style={styles.input}
                  placeholder="E-Mail"
                  placeholderTextColor="rgba(255, 255, 255, 0.7)"
                  value={formData.email}
                  onChangeText={(text) => setFormData(prev => ({ ...prev, email: text }))}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoCorrect={false}
                />
              </View>

              {/* Password Input */}
              <View style={styles.inputContainer}>
                <View style={styles.passwordContainer}>
                  <TextInput
                    style={styles.passwordInput}
                    placeholder="Passwort"
                    placeholderTextColor="rgba(255, 255, 255, 0.7)"
                    value={formData.password}
                    onChangeText={(text) => setFormData(prev => ({ ...prev, password: text }))}
                    secureTextEntry={!showPassword}
                    autoCapitalize="none"
                    autoCorrect={false}
                  />
                  <TouchableOpacity
                    style={styles.eyeButton}
                    onPress={() => setShowPassword(!showPassword)}
                  >
                    <IconSymbol 
                      name={showPassword ? "eye.slash" : "eye"} 
                      size={20} 
                      color="rgba(255, 255, 255, 0.7)" 
                    />
                  </TouchableOpacity>
                </View>
              </View>

              {/* Forgot Password */}
              <TouchableOpacity style={styles.forgotPassword}>
                <ThemedText style={[styles.forgotPasswordText, { color: colors.primary }]}>
                  Passwort vergessen?
                </ThemedText>
              </TouchableOpacity>
            </View>

            {/* Login Button */}
            <TouchableOpacity 
              style={[styles.loginButton, { backgroundColor: colors.primary }, loading && { opacity: 0.7 }]}
              onPress={handleLogin}
              disabled={loading}
            >
              {loading ? (
                <ActivityIndicator color="white" />
              ) : (
                <>
                  <IconSymbol name="envelope" size={20} color="white" />
                  <ThemedText style={styles.loginButtonText}>Anmelden</ThemedText>
                </>
              )}
            </TouchableOpacity>

            <ThemedText style={styles.orText}>Oder direkt mit:</ThemedText>

            {/* Platform-specific Social Buttons */}
            {Platform.OS === 'android' && (
              <TouchableOpacity style={styles.socialButton} onPress={handleGoogleSignIn}>
                <ThemedText style={styles.googleIcon}>G</ThemedText>
                <ThemedText style={styles.socialButtonText}>Google</ThemedText>
              </TouchableOpacity>
            )}

            {Platform.OS === 'ios' && (
              <TouchableOpacity style={styles.socialButtonDark} onPress={handleAppleSignIn}>
                <IconSymbol name="apple.logo" size={20} color="white" />
                <ThemedText style={styles.socialButtonTextDark}>Apple Account</ThemedText>
              </TouchableOpacity>
            )}

            <View style={styles.registerSection}>
              <ThemedText style={styles.registerText}>Noch kein Account?</ThemedText>
              <TouchableOpacity onPress={() => router.push('/auth/register')}>
                <ThemedText style={[styles.registerLink, { color: colors.primary }]}>Registrieren!</ThemedText>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </LinearGradient>
      </Animated.View>
    </View>
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
  backButton: {
    position: 'absolute',
    top: 60,
    left: 0,
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 10,
  },
  logoContainer: {
    alignItems: 'center',
    marginTop: 80,
    gap: 10,
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
  subTitle: {
    fontSize: 22,
    fontFamily: 'Nunito_600SemiBold',
    color: 'white',
    textAlign: 'center',
    marginBottom: 40,
  },
  authButtons: {
    width: '100%',
    alignItems: 'center',
  },
  formContainer: {
    width: '100%',
    marginBottom: 20,
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
  passwordContainer: {
    position: 'relative',
  },
  passwordInput: {
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.3)',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 16,
    paddingRight: 50,
    fontSize: 16,

    color: 'white',
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
  },
  eyeButton: {
    position: 'absolute',
    right: 16,
    top: 18,
    width: 24,
    height: 24,
    justifyContent: 'center',
    alignItems: 'center',
  },
  forgotPassword: {
    alignSelf: 'flex-end',
    marginTop: 8,
  },
  forgotPasswordText: {
    fontSize: 14,
    fontFamily: 'Nunito_500Medium',
  },
  loginButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    paddingVertical: 16,
    borderRadius: 12,
    marginBottom: 20,
    gap: 12,
  },
  loginButtonText: {
    color: 'white',
    fontSize: 16,
    fontFamily: 'Nunito_600SemiBold',
  },
  orText: {
    fontSize: 14,

    color: 'rgba(255, 255, 255, 0.7)',
    marginBottom: 16,
  },
  socialButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    paddingVertical: 16,
    borderRadius: 12,
    backgroundColor: 'white',
    marginBottom: 32,
    gap: 12,
  },
  socialButtonDark: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    paddingVertical: 16,
    borderRadius: 12,
    backgroundColor: '#000',
    marginBottom: 32,
    gap: 12,
  },
  googleIcon: {
    fontSize: 20,
    fontFamily: 'Nunito_700Bold',
    color: '#4285F4',
  },
  socialButtonText: {
    fontSize: 16,
    fontFamily: 'Nunito_600SemiBold',
    color: '#333',
  },
  socialButtonTextDark: {
    fontSize: 16,
    fontFamily: 'Nunito_600SemiBold',
    color: 'white',
  },
  registerSection: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  registerText: {
    fontSize: 14,

    color: 'rgba(255, 255, 255, 0.7)',
  },
  registerLink: {
    fontSize: 14,
    fontFamily: 'Nunito_600SemiBold',
  },
});
