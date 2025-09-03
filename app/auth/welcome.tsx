import { ThemedText } from '@/components/ThemedText';
import { CustomIcon } from '@/components/ui/CustomIcon';
import { IconSymbol } from '@/components/ui/IconSymbol';
import { Colors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
import { useAuth } from '@/lib/contexts/AuthContext';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { Alert, Animated, Dimensions, ImageBackground, Platform, StyleSheet, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export default function WelcomeScreen() {
  const router = useRouter();
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const insets = useSafeAreaInsets();
  const screenHeight = Dimensions.get('window').height;
  const isSmallScreen = screenHeight < 700; // iPhone SE, etc.

  
  // States
  const [imageLoaded, setImageLoaded] = useState(false);
  const fadeAnim = useState(new Animated.Value(0))[0];

  const { signInWithGoogle, signInWithApple } = useAuth();

  const handleGoogleSignIn = async () => {
    try {
      await signInWithGoogle();
      router.replace('/(tabs)');
    } catch (error: any) {
      console.error('Google Sign-In error:', error);
      Alert.alert('Google Anmeldung fehlgeschlagen', error.message || 'Ein Fehler ist aufgetreten');
    }
  };

  const handleAppleSignIn = async () => {
    try {
      await signInWithApple();
      router.replace('/(tabs)');
    } catch (error: any) {
      console.error('Apple Sign-In error:', error);
      Alert.alert('Apple Anmeldung fehlgeschlagen', error.message || 'Ein Fehler ist aufgetreten');
    }
  };

  const handleImageLoad = () => {
    setImageLoaded(true);
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 500, // 500ms smooth fade in
      useNativeDriver: true,
    }).start();
  };



  return (
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
            ? ['transparent', 'rgba(0,0,0,0.3)', 'rgba(0,0,0,0.8)', 'rgba(0,0,0,0.95)']
            : ['transparent', 'rgba(0,0,0,0.2)', 'rgba(0,0,0,0.6)', 'rgba(0,0,0,0.85)']
        }
        locations={[0, 0.3, 0.7, 1]}
        style={[
          styles.overlay, 
          { 
            paddingTop: insets.top + (isSmallScreen ? 10 : 20), 
            paddingBottom: insets.bottom + (isSmallScreen ? 10 : 20) 
          }
        ]}
      >
        {/* Back Button - nur wenn wir navigiert wurden */}
        {router.canGoBack() && (
          <TouchableOpacity 
            style={styles.backButton}
            onPress={() => router.back()}
          >
            <IconSymbol name="chevron.left" size={24} color="white" />
          </TouchableOpacity>
        )}

        {/* Logo */}
        <View style={[styles.logoContainer, isSmallScreen && styles.logoContainerSmall]}>
          <CustomIcon 
            name="iconBlack" 
            size={isSmallScreen ? 60 : 80} 
            color="white"
            style={styles.logoIcon}
          />
          <ThemedText style={[styles.logoText, isSmallScreen && styles.logoTextSmall]}>MarkenDetektive</ThemedText>
        </View>

        {/* Content */}
        <View style={styles.content}>
          <ThemedText style={[styles.subTitle, isSmallScreen && styles.subTitleSmall]}>Wir zeigen dir,{'\n'}wer dahinter steckt!</ThemedText>
          
          <View style={styles.authButtons}>
            <ThemedText style={[styles.subtitle, isSmallScreen && styles.subtitleSmall]}>Jetzt kostenlos registrieren:</ThemedText>
            
            <TouchableOpacity 
              style={[
                styles.emailButton, 
                { backgroundColor: colors.primary },
                isSmallScreen && styles.emailButtonSmall
              ]}
              onPress={() => router.push('/auth/register')}
            >
              <IconSymbol name="envelope" size={20} color="white" />
              <ThemedText style={styles.emailButtonText}>E-Mail</ThemedText>
            </TouchableOpacity>

            <ThemedText style={styles.orText}>Oder direkt mit:</ThemedText>

            {/* Google Sign-In (nur Android - iOS vorerst deaktiviert) */}
            {Platform.OS === 'android' && (
              <TouchableOpacity 
                style={[styles.socialButton, isSmallScreen && styles.socialButtonSmall]} 
                onPress={handleGoogleSignIn}
              >
                <View style={styles.googleIconContainer}>
                  <ThemedText style={styles.googleIcon}>G</ThemedText>
                </View>
                <ThemedText style={styles.socialButtonText}>Google</ThemedText>
              </TouchableOpacity>
            )}

            {/* Apple Sign-In (nur iOS) */}
            {Platform.OS === 'ios' && (
              <TouchableOpacity 
                style={[styles.socialButtonDark, isSmallScreen && styles.socialButtonDarkSmall]} 
                onPress={handleAppleSignIn}
              >
                <IconSymbol name="apple.logo" size={20} color="white" />
                <ThemedText style={styles.socialButtonTextDark}>Apple Account</ThemedText>
              </TouchableOpacity>
            )}

            {/* Login Button */}
            <TouchableOpacity 
              style={[
                styles.secondaryButton, 
                { marginTop: -1 },
                isSmallScreen && styles.secondaryButtonSmall
              ]}
              onPress={() => router.push('/auth/login')}
            >
              <IconSymbol name="person.circle" size={18} color="rgba(255,255,255,0.9)" />
              <ThemedText style={styles.secondaryButtonText}>Bereits angemeldet: Login</ThemedText>
            </TouchableOpacity>



            <ThemedText style={styles.termsText}>
              Ich akzeptiere: <ThemedText style={[styles.termsLink, { color: colors.primary }]}>AGB + Datenschutz</ThemedText>
            </ThemedText>
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
  logoContainerSmall: {
    marginTop: 40,
    gap: 6,
  },
  logoIcon: {
    marginBottom: 4,
  },
  logoText: {
    fontSize: 32,
    fontFamily: 'Nunito_700Bold',
    color: 'white',
    textAlign: 'center',
    lineHeight: 36,
  },
  logoTextSmall: {
    fontSize: 26,
    lineHeight: 30,
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  title: {
    fontSize: 32,
    fontFamily: 'Nunito_700Bold',
    color: 'white',
    textAlign: 'center',
    marginBottom: 60,
    lineHeight: 38,
  },
  subTitle: {
    fontSize: 22,
    fontFamily: 'Nunito_600SemiBold',
    color: 'white',
    textAlign: 'center',
    marginBottom: 10,
   },
  subTitleSmall: {
    fontSize: 18,
    marginBottom: 5,
  },
  authButtons: {
    width: '100%',
    alignItems: 'center',
  },
  subtitle: {
    fontSize: 14,
    color: 'rgba(255, 255, 255, 0.7)',
    marginBottom: 16,
    textAlign: 'center',
  },
  subtitleSmall: {
    fontSize: 12,
    marginBottom: 12,
  },
  emailButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    paddingVertical: 16,
    borderRadius: 12,
    marginBottom: 24,
    gap: 12,
  },
  emailButtonSmall: {
    paddingVertical: 12,
    marginBottom: 16,
    gap: 8,
  },
  emailButtonText: {
    color: 'white',
    fontSize: 16,
    fontFamily: 'Nunito_600SemiBold',
  },
  orText: {
    fontSize: 14,
    color: 'rgba(255, 255, 255, 0.7)',
    marginBottom: 12,
    textAlign: 'center',
  },
  secondaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 12,
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
    gap: 8,
  },
  secondaryButtonSmall: {
    marginTop: 8,
    paddingVertical: 10,
    paddingHorizontal: 16,
    gap: 6,
  },
  secondaryButtonText: {
    fontSize: 15,
    fontFamily: 'Nunito_500Medium',
    color: 'rgba(255,255,255,0.9)',
  },
  socialButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    paddingVertical: 16,
    borderRadius: 12,
    backgroundColor: 'white',
    marginBottom: 12,
    gap: 12,
  },
  socialButtonSmall: {
    paddingVertical: 12,
    marginBottom: 8,
    gap: 8,
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
  socialButtonDarkSmall: {
    paddingVertical: 12,
    marginBottom: 20,
    gap: 8,
  },
  googleIconContainer: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#ffffff',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 4,
  },
  googleIcon: {
    fontSize: 14,
    fontFamily: 'Nunito_700Bold',
    color: '#4285F4',
    textAlign: 'center',
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

  termsText: {
    fontSize: 12,
    marginTop: 10,
    color: 'rgba(255, 255, 255, 0.6)',
    textAlign: 'center',
  },
  termsLink: {
    fontFamily: 'Nunito_600SemiBold',
  },

});
