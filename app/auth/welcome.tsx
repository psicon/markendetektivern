import { ThemedText } from '@/components/ThemedText';
import { CustomIcon } from '@/components/ui/CustomIcon';
import { IconSymbol } from '@/components/ui/IconSymbol';
import { Colors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { Animated, Dimensions, ImageBackground, StyleSheet, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export default function WelcomeScreen() {
  const router = useRouter();
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const insets = useSafeAreaInsets();
  const screenHeight = Dimensions.get('window').height;
  
  // Image loading state and animation
  const [imageLoaded, setImageLoaded] = useState(false);
  const fadeAnim = useState(new Animated.Value(0))[0];

  const handleGoogleSignIn = () => {
    // TODO: Implement Google Sign In
    console.log('Google Sign In pressed');
    // For now, redirect to register as fallback
    router.push('/auth/register');
  };

  const handleAppleSignIn = () => {
    // TODO: Implement Apple Sign In
    console.log('Apple Sign In pressed');
    // For now, redirect to register as fallback
    router.push('/auth/register');
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
            size={80} 
            color="white"
            style={styles.logoIcon}
          />
          <ThemedText style={styles.logoText}>MarkenDetektive</ThemedText>
        </View>

        {/* Content */}
        <View style={styles.content}>
          <ThemedText style={styles.subTitle}>Wir zeigen dir,{'\n'}wer dahinter steckt!</ThemedText>
          
          <View style={styles.authButtons}>
            <ThemedText style={styles.subtitle}>Jetzt kostenlos registrieren:</ThemedText>
            
            <TouchableOpacity 
              style={[styles.emailButton, { backgroundColor: colors.primary }]}
              onPress={() => router.push('/auth/register')}
            >
              <IconSymbol name="envelope" size={20} color="white" />
              <ThemedText style={styles.emailButtonText}>E-Mail</ThemedText>
            </TouchableOpacity>

            <ThemedText style={styles.orText}>Oder direkt mit:</ThemedText>

            <TouchableOpacity style={styles.socialButton} onPress={handleGoogleSignIn}>
              <ThemedText style={styles.googleIcon}>G</ThemedText>
              <ThemedText style={styles.socialButtonText}>Google</ThemedText>
            </TouchableOpacity>

            <TouchableOpacity style={styles.socialButtonDark} onPress={handleAppleSignIn}>
              <IconSymbol name="apple.logo" size={20} color="white" />
              <ThemedText style={styles.socialButtonTextDark}>Apple Account</ThemedText>
            </TouchableOpacity>

            <View style={styles.loginSection}>
              <ThemedText style={styles.loginText}>Du hast schon einen Account?</ThemedText>
              <TouchableOpacity onPress={() => router.push('/auth/login')}>
                <ThemedText style={[styles.loginLink, { color: colors.primary }]}>Login!</ThemedText>
              </TouchableOpacity>
            </View>

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
  emailButtonText: {
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
    marginBottom: 12,
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
  loginSection: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 24,
    gap: 4,
  },
  loginText: {
    fontSize: 14,

    color: 'rgba(255, 255, 255, 0.7)',
  },
  loginLink: {
    fontSize: 14,
    fontFamily: 'Nunito_600SemiBold',
  },
  termsText: {
    fontSize: 12,

    color: 'rgba(255, 255, 255, 0.6)',
    textAlign: 'center',
  },
  termsLink: {
    fontFamily: 'Nunito_600SemiBold',
  },
});
