import { Colors } from '@/constants/Colors';
import React from 'react';
import { Appearance, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { IconSymbol } from './ui/IconSymbol';

interface Props {
  children: React.ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
}

export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): State {
    // Update state so the next render will show the fallback UI
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    // IMMER loggen - auch in Production für TestFlight!
    console.error('🚨 ErrorBoundary caught an error:', error);
    console.error('📍 Component Stack:', errorInfo.componentStack);
    console.error('💥 Error Message:', error.message);
    console.error('📋 Error Stack:', error.stack);
    
    // Firebase Crashlytics: Send error to Firebase Console
    try {
      const crashlytics = require('@react-native-firebase/crashlytics').default;
      
      // Set custom attributes BEFORE recording error
      crashlytics().setAttribute('error_type', 'react_error_boundary');
      if (errorInfo.componentStack) {
        crashlytics().setAttribute('component_stack', String(errorInfo.componentStack).slice(0, 500));
      }
      
      // Log component stack
      crashlytics().log(`Component Stack: ${errorInfo.componentStack?.slice(0, 500)}`);
      
      // Record error (without second parameter - attributes are already set)
      crashlytics().recordError(error);
      
      console.log('✅ Error sent to Firebase Crashlytics');
    } catch (crashlyticsError) {
      console.warn('⚠️ Crashlytics not available:', crashlyticsError);
    }
  }

  render() {
    if (this.state.hasError) {
      return <ErrorFallback 
        error={this.state.error} 
        onReset={() => this.setState({ hasError: false, error: undefined })} 
      />;
    }

    return this.props.children;
  }
}

const ErrorFallback: React.FC<{ error?: Error; onReset: () => void }> = ({ error, onReset }) => {
  // Use Appearance API directly instead of hooks since we're outside ThemeProvider
  const colorScheme = Appearance.getColorScheme();
  const colors = Colors[colorScheme ?? 'light'];

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={styles.content}>
        <IconSymbol 
          name="exclamationmark.triangle" 
          size={64} 
          color={colors.error} 
        />
        
        <Text style={[styles.title, { color: colors.text }]}>
          Oops! Etwas ist schiefgelaufen
        </Text>
        
        <Text style={[styles.message, { color: colors.icon }]}>
          Ein unerwarteter Fehler ist aufgetreten. Bitte versuche es erneut.
        </Text>
        
        {/* FEHLER-DETAILS FÜR TESTFLIGHT */}
        {error && (
          <View style={[styles.errorDetails, { backgroundColor: colors.border }]}>
            <Text style={[styles.errorLabel, { color: colors.text }]}>Fehler:</Text>
            <Text style={[styles.errorText, { color: colors.text }]}>{error.message || 'Unbekannter Fehler'}</Text>
            
            <Text style={[styles.errorLabel, { color: colors.text }]}>Typ:</Text>
            <Text style={[styles.errorText, { color: colors.text }]}>{error.name || 'Unknown'}</Text>
            
            {error.stack && (
              <>
                <Text style={[styles.errorLabel, { color: colors.text }]}>Ort:</Text>
                <Text style={[styles.errorText, { color: colors.text }]} numberOfLines={5}>
                  {error.stack.split('\n').slice(0, 3).join('\n')}
                </Text>
              </>
            )}
            
            <Text style={[styles.errorHint, { color: colors.text }]}>
              📸 Bitte Screenshot an Entwickler senden!
            </Text>
          </View>
        )}
        
        <TouchableOpacity 
          style={[styles.button, { backgroundColor: colors.primary }]}
          onPress={onReset}
        >
          <Text style={styles.buttonText}>
            Erneut versuchen
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  content: {
    alignItems: 'center',
    maxWidth: 300,
  },
  title: {
    fontSize: 24,
    fontFamily: 'Nunito_600SemiBold',
    marginTop: 20,
    marginBottom: 12,
    textAlign: 'center',
  },
  message: {
    fontSize: 16,
    fontFamily: 'Nunito_400Regular',
    textAlign: 'center',
    lineHeight: 24,
    marginBottom: 30,
  },
  button: {
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
  },
  buttonText: {
    color: 'white',
    fontSize: 16,
    fontFamily: 'Nunito_600SemiBold',
  },
  errorDetails: {
    marginTop: 20,
    padding: 15,
    borderRadius: 8,
    width: '100%',
  },
  errorLabel: {
    fontSize: 14,
    fontFamily: 'Nunito_600SemiBold',
    marginTop: 8,
    marginBottom: 4,
  },
  errorText: {
    fontSize: 13,
    fontFamily: 'Nunito_400Regular',
    marginBottom: 8,
  },
  errorHint: {
    fontSize: 14,
    fontFamily: 'Nunito_600SemiBold',
    marginTop: 12,
    textAlign: 'center',
  },
});
