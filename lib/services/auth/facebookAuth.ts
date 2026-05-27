// Facebook Sign-In — TEMPORÄR DEAKTIVIERT (T17.11)
//
// react-native-fbsdk-next 13.4.3 + FBSDKCoreKit 18.0.3 sind mit iOS 26.1
// + RN-New-Architecture aktuell inkompatibel. Jede SDK-Init-Methode
// (Settings.initializeSDK, Settings.setAdvertiserTrackingEnabled,
// LoginManager.logOut, ApplicationDelegate.shared.application(_,
// didFinishLaunchingWithOptions:)) wirft eine NSException die von
// JS-try/catch nicht eingefangen werden kann — der RCTTurboModule-
// Layer rethrowt sie als objc_exception → SIGABRT.
//
// Wir haben den Boot-Crash neutralisiert (FacebookAutoInitEnabled=NO
// + Patch in FacebookAppDelegate.swift + AppDelegate.swift cleanup),
// aber jede Form von SDK-Aufruf zur Login-Zeit triggert denselben
// Crash erneut (siehe Build 1180 Crash via performVoidMethodInvocation).
//
// Bis wir entweder
//   a) eine FB-SDK-Version finden die mit iOS 26.1 funktioniert, oder
//   b) eine Native-Swift-Bridge schreiben die NSException via Obj-C
//      @try/@catch sicher abfängt
// ist FB-Login ausgeschaltet. UI-Button bleibt sichtbar, Tap zeigt
// einen freundlichen Info-Toast. Apple/Google/Email-Login funktionieren
// weiter ungestört.

import { FirebaseAuthTypes } from '@react-native-firebase/auth';

export interface FacebookCredentialBundle {
  credential: FirebaseAuthTypes.AuthCredential;
  email?: string | null;
  displayName?: string | null;
  photoURL?: string | null;
}

export const FB_SDK_UNAVAILABLE = 'auth/facebook-sdk-unavailable';

export const isFacebookAuthAvailable = async (): Promise<boolean> => false;

export const getFacebookCredential =
  async (): Promise<FacebookCredentialBundle | null> => {
    const err: any = new Error(
      'Facebook-Login wird derzeit überarbeitet. Bitte nutze Apple, Google oder E-Mail.',
    );
    err.code = FB_SDK_UNAVAILABLE;
    throw err;
  };

export const signOutFacebook = async (): Promise<void> => {
  // No-op — kein SDK-Call (würde NSException werfen).
};
