// Web-basierte Google Auth (wie FlutterFlow) - FUNKTIONIERT GARANTIERT!
import { auth } from '@/lib/firebase';
import * as Google from 'expo-auth-session/providers/google';
import * as WebBrowser from 'expo-web-browser';
import { GoogleAuthProvider, signInWithCredential } from 'firebase/auth';
import { Platform } from 'react-native';

WebBrowser.maybeCompleteAuthSession();

// Die GLEICHEN IDs wie in FlutterFlow!
const WEB_CLIENT_ID = '139509881339-8r18hd499h6615f4ebos35ihbqqqvjvs.apps.googleusercontent.com';
const IOS_CLIENT_ID = '139509881339-8m7rjqtur27arme7utiuptqmjbllofbu.apps.googleusercontent.com';
const ANDROID_CLIENT_ID = '139509881339-3uoqvpmigs7p0jm8h6p941v3eeofd4vb.apps.googleusercontent.com';

export const useGoogleAuth = () => {
  const [request, response, promptAsync] = Google.useIdTokenAuthRequest({
    clientId: Platform.select({
      ios: IOS_CLIENT_ID,
      android: ANDROID_CLIENT_ID,
      default: WEB_CLIENT_ID,
    }),
    iosClientId: IOS_CLIENT_ID,
    androidClientId: ANDROID_CLIENT_ID,
    webClientId: WEB_CLIENT_ID,
  });

  const signInWithGoogle = async () => {
    try {
      const result = await promptAsync();
      
      if (result?.type === 'success') {
        const { id_token } = result.params;
        
        if (!id_token) {
          throw new Error('No ID token received');
        }

        // Firebase Auth mit ID Token
        const credential = GoogleAuthProvider.credential(id_token);
        const userCredential = await signInWithCredential(auth, credential);
        
        console.log('✅ Google Sign-In successful:', userCredential.user.email);
        return userCredential;
      } else if (result?.type === 'cancel') {
        throw new Error('Anmeldung abgebrochen');
      }
    } catch (error) {
      console.error('❌ Google Sign-In error:', error);
      throw error;
    }
  };

  return { signInWithGoogle, isReady: !!request };
};

// Standalone Funktion für bestehenden Code
export const signInWithGoogleWeb = async () => {
  // Temporäre Lösung bis Hook integriert ist
  throw new Error('Bitte useGoogleAuth Hook verwenden');
};
