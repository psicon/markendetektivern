# =============================================================================
# ProGuard/R8-Regeln fuer MarkenDetektive (Android-Release)
#
# STAND 20.09.2026 / 6.0.19: In diesem Release wird R8 erstmals scharf
# geschaltet (android.enableProguardInReleaseBuilds=true). shrinkResources
# bleibt AUS. Anlass: Google Play meldet "DEX-Codeoptimierung:
# Verschleierung 2 %" (Grenzwert 25 %).
#
# WARUM DIESE DATEI SO KURZ IST:
# Die frueheren zehn Pauschalregeln der Form "-keep class <paket>.** { *; }"
# nahmen 24.369 von 65.697 Klassen (37 %) des Release-DEX vorab von der
# Umbenennung aus - allein com.google.android.gms.** 14.467 Klassen (22 %).
# Genau das war die Ursache der gemeldeten 2 %. Alle zehn waren ueberfluessig:
# die Bibliotheken liefern ihre Regeln als consumerProguardFiles bzw. als
# proguard.txt im AAR selbst mit, und AGP speist sie ueber
# FILTERED_PROGUARD_RULES in den R8-Lauf ein.
#
# ZWEI MECHANISMEN, DIE HIER BEWUSST NICHT NACHGEBAUT WERDEN
# (beide am 20.09.2026 am echten Artefakt nachgewiesen, nicht angenommen):
#
#  1) MANIFEST-KLASSEN HAELT AAPT2 AUTOMATISCH.
#     aapt2 link --proguard auf dem gemergten Release-Manifest erzeugt
#     73 Keep-Regeln, darunter woertlich:
#       -keep class com.facebook.internal.FacebookInitProvider { <init>(); }
#       -keep class expo.modules.notifications.service.NotificationsService { <init>(); }
#       -keep class expo.modules.imagepicker.fileprovider.ImagePickerFileProvider { <init>(); }
#       -keep class io.invertase.firebase.messaging.ReactNativeFirebaseMessagingService { <init>(); }
#       -keep class de.markendetektive.MainActivity / MainApplication { <init>(); }
#     Dass AGP diese Datei an R8 weiterreicht, ist im Bytecode von AGP 8.13.0
#     belegt (ProguardConfigurableTask$CreationAction nennt
#     MERGED_AAPT_PROGUARD_FILE als Eingang).
#     -> KEINE Regel fuer irgendeine im AndroidManifest deklarierte Klasse.
#     Nachpruefen: aapt2 link --manifest <merged manifest> --proguard out.txt
#
#  2) DIE AGP-STANDARDDATEI (getDefaultProguardFile("proguard-android.txt"),
#     eingebunden in android/app/build.gradle) haelt bereits:
#       Zeile 34-36: -keepclasseswithmembernames,includedescriptorclasses
#                    class * { native <methods>; }   <- pinnt JEDE Klasse mit
#                    native-Methoden NAMENTLICH (wichtig fuer alle fbjni-Faelle)
#       Zeile 53:    enum valueOf/values
#       Zeile 56-58: Parcelable CREATOR
#       Zeile 62:    @android.webkit.JavascriptInterface <methods>
#     -> Fuer diese Muster hier nichts wiederholen.
#
# REGEL FUER KUENFTIGE SITZUNGEN:
# Bevor hier etwas hinzugefuegt wird, erst pruefen, ob die Bibliothek ihre
# Regeln selbst mitbringt:
#   grep -n consumerProguardFiles node_modules/<lib>/android/build.gradle
#   unzip -p <aar-aus-~/.gradle/caches> proguard.txt
# Und: NIE eine Pauschalregel ueber einen grossen Paketbaum zurueckholen.
# Jede Regel unten nennt ihren Beleg - ohne neuen Gegenbeleg nicht loeschen.
# =============================================================================


# -----------------------------------------------------------------------------
# 1) Lesbare Stacktraces nach der Verschleierung (Crashlytics / Play Console)
# -----------------------------------------------------------------------------
# PFLICHT. Die AGP-Standarddatei haelt SourceFile/LineNumberTable NICHT
# (geprueft: 0 Treffer in proguard-android.txt). Ohne diese Zeilen verlieren
# ALLE Release-Stacktraces Datei und Zeilennummer - unwiederbringlich, denn
# die mapping.txt uebersetzt nur Namen zurueck, sie stellt keine fehlende
# Zeileninformation wieder her. Das wuerde ausgerechnet das Werkzeug
# entwerten, mit dem Abstuerze untersucht werden (vgl. den armeabi-v7a-Crash
# in docs/CRASH_ANALYSIS_6011_2026-07-20.md).
# Kostet KEINE Verschleierung: haelt nur Attribute, keine Namen.
# -renamesourcefileattribute ersetzt den echten Dateinamen durch den
# konstanten Platzhalter "SourceFile" - die Quellstruktur bleibt verborgen,
# Crashlytics loest die Zeilen trotzdem ueber die mapping.txt auf.
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile

# Annotationen und generische Signaturen erhalten. Kosten ebenfalls keine
# Verschleierung (Attribute, keine Namen). Bestand seit jeher; *Annotation*
# ist bewusst breiter als der AGP-Default, der RuntimeInvisibleAnnotations
# nicht auffuehrt - davon haengen u. a. die @androidx.annotation.Keep-Regeln
# von play-services-basement ab.
-keepattributes *Annotation*
-keepattributes Signature


# -----------------------------------------------------------------------------
# 2) Hermes Intl / Unicode  --  DER EINE ECHTE LAUFZEITBRUCH
# -----------------------------------------------------------------------------
# hermes-android:0.79.7 liefert KEINE consumer-Regeln mit
#   (unzip -l hermes-android-0.79.7-*.aar | grep -i proguard  ->  0 Treffer),
# und react-android deckt com.facebook.hermes.** nirgends ab.
#
# libhermes.so sucht diese fuenf Klassen zur Laufzeit per JNI ueber ihren
# NAMEN. Nachgewiesen am ausgelieferten Artefakt:
#   tr -c '[:print:]' '\n' < jni/arm64-v8a/libhermes.so \
#     | grep -oE 'com/facebook/(hermes|jni)/[A-Za-z0-9_$/]+' | sort -u
#
# Warum kein bestehender Mechanismus greift:
#   - kein consumer-proguard im AAR (s. o.),
#   - die Klassen haben KEINE native-Methoden -> die AGP-Default-Regel
#     "native <methods>" laeuft ins Leere,
#   - sie tragen kein @DoNotStrip,
#   - und schlimmer als Umbenennung: KEIN Java-Code referenziert sie. Sie
#     existieren nur als Rueckruf-Ziel fuer libhermes.so, R8 wuerde sie also
#     restlos ENTFERNEN, nicht bloss umbenennen.
#
# Folge ohne diese Regeln: Intl.*, Number.toLocaleString,
# Date.toLocaleDateString/-TimeString und String.localeCompare laufen in ein
# fehlgeschlagenes FindClass. Im Debug faellt das nie auf.
# Betroffenheit ist nicht theoretisch: 63 Fundstellen im eigenen Code
# (u. a. app/achievements.tsx, app/profile.tsx, app/purchase-history.tsx,
# app/purchase-statistics.tsx) - und CLAUDE.md schreibt toLocaleString('de-DE')
# als Projektstandard fuer Zahlen vor.
#
# Zuschnitt: bewusst nur diese fuenf. Die uebrigen ~73 Klassen unter
# com.facebook.hermes.intl (IPlatformCollator, LocaleObjectICU,
# JSRangeErrorException, die Enums ...) werden nur aus Java heraus benutzt,
# tauchen in der Deskriptorliste der .so nicht auf und duerfen verschleiert
# werden.
-keep class com.facebook.hermes.intl.Intl { *; }
-keep class com.facebook.hermes.intl.Collator { *; }
-keep class com.facebook.hermes.intl.DateTimeFormat { *; }
-keep class com.facebook.hermes.intl.NumberFormat { *; }
-keep class com.facebook.hermes.unicode.AndroidUnicodeUtils { *; }


# -----------------------------------------------------------------------------
# 3) Expo: die generierte Modulliste
# -----------------------------------------------------------------------------
# expo.modules.ExpoModulesPackageList ist der EINZIGE Einstiegspunkt fuer alle
# autogelinkten Expo-Module und wird ausschliesslich ueber ihren Namen geladen:
#   expo-modules-core/.../kotlin/ExpoModulesHelper.kt:9
#     Class.forName("expo.modules.ExpoModulesPackageList")
#       .getConstructor().newInstance() as ModulesProvider
#   expo/android/src/main/java/expo/modules/ExpoModulesPackage.kt:23  (ebenso)
# Eine statische Referenz existiert NIRGENDS.
#
# Die von expo mitgelieferte Regel reicht NICHT: sie lautet
#   -keepclassmembers public class expo.modules.ExpoModulesPackageList { public *; }
# (expo/android/proguard-rules.pro:21-23). -keepclassmembers haelt nur Member,
# FALLS die Klasse ohnehin ueberlebt - es macht die Klasse nicht zum
# Entry-Point und schuetzt ihren Namen nicht.
#
# Fehlermodus ist STILL, nicht laut: alle Aufrufer fangen die Exception ab und
# liefern emptyList()/null. Die App startet dann ohne ein einziges natives
# Expo-Modul. Genau deshalb steht diese Regel hier.
# <init>() ist ausgeschrieben, weil getConstructor() ihn braucht und R8 im
# full mode (AGP-8-Default, hier nicht abgeschaltet) den Standardkonstruktor
# bei "-keep class X" nicht mehr implizit behaelt.
-keep class expo.modules.ExpoModulesPackageList {
    public <init>();
    public *;
}

# Alles UEBRIGE unter expo.modules.** braucht nichts von uns:
# expo-modules-core setzt consumerProguardFiles (android/build.gradle:76) und
# liefert app-weite Wildcards fuer @DoNotStrip, Record, SharedObject,
# Enumerable, ExpoView, ComposeProps und Module. Die Modulklassen selbst duerfen
# ausdruecklich verschleiert werden (proguard-rules.pro:15
# "-keep,allowoptimization,allowobfuscation class * extends ...modules.Module"),
# weil der JS-seitige Name aus dem String-Literal in Name("...") kommt.
# Geprueft und unauffaellig: expo-camera, -image, -blur, -crypto, -haptics,
# -linear-gradient, -linking, -web-browser, -image-manipulator, -location,
# -tracking-transparency, -font, -file-system, -keep-awake, -asset, -constants,
# -application, -device, -splash-screen, -system-ui, -navigation-bar sowie
# unser eigenes modules/bon-edge-detector.

# AUSNAHME: der AppLoader steht als android:value im Manifest, nicht als
# android:name. aapt2 haelt nur android:name VON KOMPONENTEN
# (application/activity/service/receiver/provider) - Klassennamen in
# android:value oder in meta-data-Schluesseln sind NICHT gedeckt.
# AppLoaderProvider.createLoader() liest den Wert und laedt ihn per Namen:
#   expo-modules-core/.../apploader/AppLoaderProvider.kt:26-34
#     metaData.getString("org.unimodules.core.AppLoader#$name")
#       -> Class.forName(loaderClassName).getDeclaredConstructor(Context)
# expo-modules-core/android/proguard-rules.pro erwaehnt die Klasse NICHT
# (geprueft).
# Pruefschritt bei neuen Bibliotheken - das gemergte Manifest absuchen:
#   grep -oE 'android:value="[a-z][a-zA-Z0-9_.$]*\.[A-Z][a-zA-Z0-9_.$]*"' \
#     android/app/build/intermediates/merged_manifest/release/*/AndroidManifest.xml
# Stand 20.09.2026 liefert das vier Werte. Drei davon sind nachweislich
# fremdgedeckt: Camera2Config$DefaultProvider (camera-camera2-1.4.1.aar/
# proguard.txt haelt ihn woertlich), CredentialProviderPlayServicesImpl
# (credentials-play-services-auth/proguard.txt: -keep class
# androidx.credentials.playservices.**) und ComponentRegistrar (Abschnitt
# "bewusst nicht enthalten"). Der vierte ist dieser hier.
-keep class expo.modules.adapters.react.apploader.RNHeadlessAppLoader {
    public <init>(android.content.Context);
}


# -----------------------------------------------------------------------------
# 4) expo-notifications: Java-Serialisierung in den SharedPreferences
# -----------------------------------------------------------------------------
# service/delegates/Base64Serialization.kt schreibt und liest diese Objekte
# per ObjectOutputStream/ObjectInputStream (benutzt von
# SharedPreferencesNotificationsStore und ...NotificationCategoriesStore).
# Ein Java-Serialisierungsstrom traegt den vollqualifizierten Klassennamen,
# und wo keine serialVersionUID deklariert ist, wird sie aus Klassen- UND
# Membernamen berechnet - Umbenennen aendert sie also. expo-notifications
# liefert keine eigenen Regeln, und die AGP-Standarddatei enthaelt KEINE
# Serializable-Regel (nur Parcelable-CREATOR).
#
# Heute ist der Defekt schlafend: die einzige Aufrufstelle der App
# (lib/services/pushNotificationService.ts:286) uebergibt trigger: null, und
# ExpoSchedulingDelegate bricht bei null-Trigger vor dem Speicher ab. Betroffen
# waeren Alt-Eintraege von Bestandsgeraeten und jede kuenftige echte Planung -
# und der Lesepfad faengt ClassNotFoundException ab, geplante Benachrichtigungen
# verschwaenden also LAUTLOS statt zu crashen. Darum vorsorglich gehalten.
#
# -keepnames statt -keep: pinnt nur die Namen, die Member bleiben optimierbar.
-keepnames class expo.modules.notifications.notifications.model.NotificationRequest
-keepnames class expo.modules.notifications.notifications.model.NotificationContent
-keepnames class expo.modules.notifications.notifications.model.NotificationCategory
-keepnames class expo.modules.notifications.notifications.model.NotificationAction
-keepnames interface expo.modules.notifications.notifications.interfaces.SchedulableNotificationTrigger
-keepnames class expo.modules.notifications.notifications.triggers.**

# Der Tap-Pfad einer ZUGESTELLTEN Push-Nachricht. Anderer Mechanismus als die
# Serialisierung oben, gleiche Ursache: Parcel.writeParcelable schreibt den
# VOLLQUALIFIZIERTEN Klassennamen in den Datenstrom, readParcelable loest ihn
# ueber diesen Namen wieder auf.
# expo-notifications stellt die Nachricht selbst zu (ExpoFirebaseMessagingService,
# android/src/main/AndroidManifest.xml:7) und legt Notification + Action als
# Parcelable-Extras in den Tap-PendingIntent (NotificationsService.kt:453-454,
# ab Android 12 ueber NotificationForwarderActivity, :461-463).
# ABLAUF, DER OHNE DIESE ZEILEN ABSTUERZT: Nutzer hat eine ungelesene Nachricht
# im Schacht, installiert das Update, tippt danach die ALTE Nachricht an. Das
# Parcel traegt noch die Namen der Vorgaengerversion, die neue kennt sie nicht
# mehr -> NotificationForwarderActivity.onCreate (:16-18, ohne jede
# Fehlerbehandlung) stirbt. Genau der Pfad, der am 17.09.2026 repariert wurde.
# ACHTUNG, ZWEI VERSCHIEDENE PAKETE: model.triggers (FirebaseNotificationTrigger,
# die zugestellte Push) und notifications.triggers (geplante Ausloeser) - am
# Dateibaum geprueft, nicht abgeleitet.
-keepnames class expo.modules.notifications.notifications.model.Notification
-keepnames class expo.modules.notifications.notifications.model.NotificationResponse
-keepnames class expo.modules.notifications.notifications.model.TextInputNotificationResponse
-keepnames class expo.modules.notifications.notifications.model.TextInputNotificationAction
-keepnames class expo.modules.notifications.notifications.model.RemoteNotificationContent
-keepnames class expo.modules.notifications.notifications.model.triggers.**

# Feldnamen der serialisierten Objekte (statische und transiente Felder sind
# nicht Teil des Serialisierungsstroms und duerfen umbenannt werden).
# Die nicht-privaten METHODEN gehoeren mit dazu: ObjectStreamClass.
# computeDefaultSUID bildet die Standard-serialVersionUID aus Klassennamen,
# Feldern UND allen nicht-privaten Methoden samt Deskriptor. Nur die Felder zu
# pinnen haelt die UID also NICHT stabil - die Regel haette ihr eigenes
# Versprechen nicht eingeloest. Genau eine Klasse deklariert eine eigene UID
# (NotificationContent.java:203) und schreibt ihren Strom ohnehin von Hand.
-keepclassmembernames class expo.modules.notifications.notifications.model.Notification* {
    !static !transient <fields>;
    !private <methods>;
}
-keepclassmembernames class expo.modules.notifications.notifications.triggers.** {
    !static !transient <fields>;
    !private <methods>;
}

# Die Standard-Haken der Java-Serialisierung, eng auf dieses Paket begrenzt
# (nicht app-weit, das waere unnoetig teuer).
-keepclassmembers class expo.modules.notifications.** implements java.io.Serializable {
    static final long serialVersionUID;
    private static final java.io.ObjectStreamField[] serialPersistentFields;
    private void writeObject(java.io.ObjectOutputStream);
    private void readObject(java.io.ObjectInputStream);
    java.lang.Object writeReplace();
    java.lang.Object readResolve();
}


# -----------------------------------------------------------------------------
# 5) UMP -> Firebase Analytics: Einwilligungs-Weitergabe (Google Consent Mode)
# -----------------------------------------------------------------------------
# DATENSCHUTZ-RELEVANT, NICHT WEGKUERZEN - auch wenn die Regel wie ein
# ueberfluessiges Firebase-Symbol aussieht. Der Aufrufer sitzt in der
# UMP-Bibliothek, nicht in Firebase.
#
# com.google.android.ump:user-messaging-platform:3.2.0 (kommt als
# api-Dependency ueber react-native-google-mobile-ads) hat UEBERHAUPT KEINE
# proguard.txt im AAR (geprueft), reflektiert aber in Firebase Analytics
# hinein, um die Nutzer-Einwilligung weiterzureichen. Genau eine der 143
# Klassen tut das - com.google.android.gms.internal.consent_sdk.zzam.
# Per javap im Konstantenpool belegt:
#     Class.forName("com.google.firebase.analytics.FirebaseAnalytics")
#     getDeclaredMethod("getInstance", Context.class)
#     getDeclaredMethod("setConsent", Map.class)
#     Class.forName("...FirebaseAnalytics$ConsentStatus") / ("...$ConsentType")
#     + valueOf(String)
# Die Zielmethoden existieren real (play-services-measurement-api:23.0.0):
#     public static FirebaseAnalytics getInstance(android.content.Context)
#     public void setConsent(java.util.Map<...ConsentType, ...ConsentStatus>)
#
# Niemand haelt diese Namen: firebase-analytics-23.0.0.aar hat keine
# proguard.txt, die von play-services-measurement-api enthaelt nur -dontwarn
# und einen Proto-Feld-Keep. Bis 6.0.18 ueberlebte der Pfad nur zufaellig durch
# das inzwischen entfernte "-keep class com.google.firebase.** { *; }".
#
# Ohne diese Regel scheitert die Weitergabe STILL - nur
# Log.w("UserMessagingPlatform", "No Firebase class found."). Die App wuerde
# dann weiter Analytics erheben, obwohl der Nutzer im UMP-Dialog abgelehnt hat.
# Das ist ein Einwilligungs-/DSGVO-Problem, kein Absturz - also nichts, was
# ein Rauchtest zeigen wuerde.
-keep class com.google.firebase.analytics.FirebaseAnalytics {
    public static com.google.firebase.analytics.FirebaseAnalytics getInstance(android.content.Context);
    public void setConsent(java.util.Map);
}
# Die beiden Enums vollstaendig: UMP ruft valueOf(String) mit Literalen auf,
# die Konstantennamen muessen also erhalten bleiben. Zwei winzige Klassen.
-keep class com.google.firebase.analytics.FirebaseAnalytics$ConsentStatus { *; }
-keep class com.google.firebase.analytics.FirebaseAnalytics$ConsentType { *; }


# -----------------------------------------------------------------------------
# 6) fbjni: Klassen, die beim JNI_OnLoad ueber Literal-Deskriptoren aufgeloest
#    werden und selbst KEIN Klassen-@DoNotStrip tragen
# -----------------------------------------------------------------------------
# Alle vier haengen ihren Namensschutz derzeit allein an der AGP-Default-Regel
# "-keepclasseswithmembernames ... native <methods>". Das greift, weil sie
# native-Methoden deklarieren - ist aber eine indirekte Zusicherung aus einer
# Datei, die wir nicht kontrollieren, und R8 full mode legt Keep-Regeln
# strenger aus. Die Zeilen machen es ausdruecklich.
# -keepnames pinnt nur den Klassennamen; die Member bleiben verschleierbar,
# vier Klassennamen sind fuer die Quote bedeutungslos.
# Fehlerbild ohne sie: harter Absturz bei der JNI-Registrierung beim Start.

# react-native-screens: Deskriptor "Lcom/swmansion/rnscreens/NativeProxy;"
# in android/src/main/cpp/NativeProxy.h
-keepnames class com.swmansion.rnscreens.NativeProxy

# react-native-reanimated 3.17.5: die mitgelieferten Regeln decken nur
# com.swmansion.reanimated.** ab. Der ausgelagerte Worklets-Teil liegt im
# SEPARATEN Paket com.swmansion.worklets und wird beim JNI_OnLoad ueber
# "Lcom/swmansion/worklets/AndroidUIScheduler;" aufgeloest
# (cpp/worklets/android/AndroidUIScheduler.h, WorkletsOnLoad.cpp).
-keepnames class com.swmansion.worklets.AndroidUIScheduler

# @shopify/react-native-skia registriert seine JNI-Typen EAGER
# (android/cpp/jni/JniLoad.cpp). SkiaManager traegt bereits Klassen-@DoNotStrip,
# diese beiden NICHT. Deskriptoren in JniPlatformContext.h bzw.
# JniSkiaPictureView.h. Skia ist aktiv in Benutzung (components/ui/EdgeGlow.tsx;
# Canvas ist auf Android genau SkiaPictureView).
-keepnames class com.shopify.reactnative.skia.PlatformContext
-keepnames class com.shopify.reactnative.skia.SkiaPictureView

# Der Startpfad JEDES Nutzers: MainApplication.onCreate ruft
# SoLoader.init(this, OpenSourceMergedSoMapping) (MainApplication.kt:123), und
# libhermestooling.so traegt den Klassennamen
# com/facebook/react/soloader/OpenSourceMergedSoMapping in ihrer
# Zeichenkettentabelle - er wird also zur Laufzeit ueber den NAMEN aufgeloest.
# Gleiche indirekte Absicherung wie die vier daruber (AGP-Default-Regel
# "native <methods>"), aber als einzige auf dem Startpfad. Ein Name.
-keepnames class com.facebook.react.soloader.OpenSourceMergedSoMapping


# -----------------------------------------------------------------------------
# 6b) Klassennamen, die FREMDER Code zur Laufzeit als Zeichenkette vergleicht
# -----------------------------------------------------------------------------
# Kein JNI, sondern getSimpleName(). Reanimated erkennt Screens-Views daran,
# ob ihr EINFACHER Klassenname einem Literal entspricht:
#   reanimated/.../layoutReanimation/ScreensHelper.java:85 (isInstanceOf)
#   mit den Literalen aus :64-81, dazu Snapshot.java:268 und
#   SharedTransitionManager.java:595/607.
# react-native-screens liefert KEINE eigenen Regeln (kein consumerProguardFiles,
# keine .pro-Datei - beides geprueft), es haelt diese Namen also niemand sonst.
# Nach der Umbenennung heisst Screen z. B. "a", jeder Vergleich ist dauerhaft
# falsch: die gemeinsamen Element-Uebergaenge und Teile der Layout-Animationen
# laufen still ins Leere. Kein Absturz, aber dauerhaft kaputte Navigation.
# WICHTIG FUER SPAETERE DURCHSICHTEN: Es gibt zu diesen fuenf Zeilen KEINEN
# statischen Aufrufer - das ist genau der Punkt. Nicht als "unbenutzt" loeschen.
-keepnames class com.swmansion.rnscreens.Screen
-keepnames class com.swmansion.rnscreens.ScreenStack
-keepnames class com.swmansion.rnscreens.ScreenContainer
-keepnames class com.swmansion.rnscreens.ScreenFragment
-keepnames class com.swmansion.rnscreens.stack.views.ScreensCoordinatorLayout

# Unser eigener Schutz gegen unvollstaendige Installationen vergleicht in
# MainApplication.kt:78-79 den Klassennamen des Fehlers gegen "SoLoader" und
# "DSONotFound". soloader-0.12.1.aar bringt keine proguard.txt mit (geprueft),
# die Namen haelt also niemand. Praktisch gedeckt ist der Fall schon durch
# Zeile 77 (e is UnsatisfiedLinkError - alle drei Fehlerklassen erben davon),
# diese zwei Namen halten den ausdruecklichen Zweig zusaetzlich am Leben.
-keepnames class com.facebook.soloader.SoLoaderDSONotFoundError
-keepnames class com.facebook.soloader.SoLoaderULError


# -----------------------------------------------------------------------------
# 7) React-Native-Kern: eine Luecke in den mitgelieferten Regeln von 0.79.7
# -----------------------------------------------------------------------------
# libreactnative.so sucht auf com.facebook.react.runtime.ReactHostImpl die
# Methode "reload" per GetMethodID mit Rueckgabetyp
# com.facebook.react.interfaces.TaskInterface
# (jni/react/runtime/jni/JReactHostInspectorTarget.h).
# Weder ReactHostImpl.reload (ReactHostImpl.java:488) noch TaskInterface tragen
# @DoNotStrip - die drei Nachbarmethoden schon, offensichtlich ein Versehen
# upstream.
# Praktisches Risiko niedrig: der Pfad haengt am Fusebox-Inspector, der im
# Release ausgeschaltet ist. Kostet zwei Namen, schliesst die Luecke trotzdem.
# Alles Uebrige im RN-Kern deckt react-android selbst ab - das AAR bringt eine
# proguard.txt mit (u. a. @DoNotStrip, NativeModule, JavaScriptModule,
# @ReactProp, com.facebook.jni.**, yoga).
-keep class com.facebook.react.interfaces.TaskInterface { *; }
-keepclassmembers class com.facebook.react.runtime.ReactHostImpl {
    com.facebook.react.interfaces.TaskInterface reload(java.lang.String);
}


# -----------------------------------------------------------------------------
# 8) Warnungen unterdruecken
# -----------------------------------------------------------------------------
# Beeinflussen die Verschleierungsquote NICHT (-dontwarn verhindert keine
# Umbenennung). Bleiben stehen, weil ein entferntes -dontwarn den Build an
# einer unaufloesbaren Referenz scheitern lassen kann.
-dontwarn io.invertase.firebase.**
-dontwarn com.google.android.gms.ads.**

# ---- Fehlende Klassen, die R8 sonst zum ABBRUCH bringen -------------------
# Das ist kein Feinschliff: AGP 8.13 macht aus "Missing classes detected while
# running R8" einen FEHLER, nicht eine Warnung. Ohne diese Zeilen scheitert
# :app:minifyReleaseWithR8 - der Build kommt gar nicht erst zustande.
# Gemessen am ausgelieferten Artefakt (app-release.aab, DEX-class_defs gegen
# type_ids) und gegen ALLE 239 Consumer-Regeldateien im Gradle-Cache abgeglichen.
#
# camera-extensions haelt per eigener Consumer-Regel zehn Adapterklassen
# zwingend am Leben, deren Supertypen unter androidx.camera.extensions.impl.**
# nie im APK liegen (die Implementierung liefert der Geraetehersteller).
-dontwarn androidx.camera.extensions.impl.**
# Fensterverwaltung: androidx.window spricht optionale OEM-Erweiterungen an.
-dontwarn androidx.window.extensions.**
-dontwarn androidx.window.sidecar.**
# Paging kommt transitiv ueber Room/AsyncStorage, wird aber nicht benutzt.
-dontwarn androidx.paging.**
# Aus derselben Messung, Erreichbarkeit nicht abschliessend geprueft - schadet
# nicht, da -dontwarn nur Warnungen unterdrueckt und keine Umbenennung verhindert.
-dontwarn com.google.api.client.http.**
-dontwarn org.joda.time.**
#
# TLS-Anbieter, die okhttp optional anspricht. okhttp 4.9.2 (der Pin von
# React Native 0.79.7) kennt nur -dontwarn fuer ConscryptPlatform; die drei
# Zeilen kamen erst mit 4.11.0. Heute gewinnt 4.11.0 zufaellig ueber
# glide:okhttp3-integration - faellt diese transitive Hochstufung weg, bricht
# der Build ohne die Zeilen genauso ab. Darum stehen sie hier selbst.
-dontwarn org.conscrypt.**
-dontwarn org.bouncycastle.**
-dontwarn org.openjsse.**
#
# VERBINDLICH ist danach nur der echte Lauf: nach einem R8-Durchlauf listet
# android/app/build/outputs/mapping/release/missing_rules.txt vollstaendig, was
# noch fehlt. Diese Datei uebernehmen, nicht raten.


# =============================================================================
# BEWUSST NICHT MEHR ENTHALTEN  (Stand 6.0.19) - bitte nicht zurueckholen,
# ohne den jeweiligen Gegenbeleg zu widerlegen:
#
#   -keep class com.swmansion.reanimated.** { *; }
#   -keep class com.facebook.react.turbomodule.** { *; }
#       zeichengleich mit Zeile 1-2 von
#       node_modules/react-native-reanimated/android/proguard-rules.pro,
#       das per consumerProguardFiles (build.gradle:269) eingebunden ist.
#       turbomodule zusaetzlich durch react-android/proguard.txt abgedeckt.
#
#   -keep class com.google.firebase.** { *; }            (2.706 Klassen)
#       Component-Discovery deckt firebase-components:19.0.0 selbst ab:
#       "-keep class * implements ...ComponentRegistrar { void <init>(); }"
#       - inkl. Konstruktor, also auch unter R8 full mode tragfaehig.
#       Die 26 Registrare stehen als meta-data-Strings im Manifest.
#       Manifest-Komponenten (FirebaseInitProvider, FirebaseMessagingService,
#       SessionLifecycleService, GenericIdpActivity, RecaptchaActivity) haelt
#       aapt2. AUSNAHME: FirebaseAnalytics, siehe Abschnitt 5.
#
#   -keep class com.google.android.gms.** { *; }         (14.467 Klassen =
#       22 % des DEX - der mit Abstand groesste Einzelposten gegen die
#       Play-Kennzahl). play-services-basement liefert selbst die Regeln fuer
#       SafeParcelable, Parcelable-CREATOR, ReflectedParcelable, @Keep,
#       @KeepName und @DynamiteApi; die measurement-AARs den Proto-Feld-Keep;
#       firebase-auth einen eigenen Keep auf com.google.android.gms.internal.**.
#
#   -keep class com.google.android.gms.ads.** { *; }
#   -keep class com.google.ads.** { *; }
#   -keep class io.invertase.googlemobileads.** { *; }
#       play-services-ads(-api):24.6.0 bringt proguard.txt mit (ClientApi,
#       LiteSdkInfo, WorkManagerUtil, MediationAdapter, AdapterSettings);
#       der RN-Wrapper faellt unter die RN-Regel
#       "-keep class * implements ...bridge.NativeModule { *; }".
#       Der npa=1-Pfad laeuft ueber AdMobAdapter, den die Mediation-Regel haelt.
#
#   -keep class com.revenuecat.** { *; }
#       wortgleich in purchases-9.7.2.aar/proguard.txt. Deckt auch den
#       RN-Wrapper ab (Paket com.revenuecat.purchases.react).
#
#   -keep class io.invertase.firebase.** { *; }
#       NativeModules ueber die RN-Regel, die drei Messaging-Klassen und beide
#       InitProvider ueber aapt2, der Registrar ueber die ComponentRegistrar-
#       Regel.
#
#   -keep class expo.modules.** { *; }
#       ersetzt durch die vier engen Abschnitte 3 und 4 oben.
#
# Ebenfalls NICHT aufgenommen, obwohl vorgeschlagen: Keep-Regeln fuer
# com.facebook.internal.FacebookInitProvider, com.facebook.CustomTabMainActivity,
# die beiden Facebook-BroadcastReceiver, die drei expo-notifications-Services,
# ImagePickerFileProvider und com.canhub.cropper.CropImageActivity. Alle neun
# stehen nachweislich in der aapt2-Ausgabe (siehe Kopf, Mechanismus 1).
# =============================================================================
