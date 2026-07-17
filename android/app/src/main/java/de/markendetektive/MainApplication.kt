package de.markendetektive

import android.app.Application
import android.content.Intent
import android.content.pm.PackageManager
import android.content.res.Configuration
import android.net.Uri
import android.widget.Toast

import com.facebook.react.PackageList
import com.facebook.react.ReactApplication
import com.facebook.react.ReactNativeHost
import com.facebook.react.ReactPackage
import com.facebook.react.ReactHost
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.load
import com.facebook.react.defaults.DefaultReactNativeHost
import com.facebook.react.soloader.OpenSourceMergedSoMapping
import com.facebook.soloader.SoLoader

import expo.modules.ApplicationLifecycleDispatcher
import expo.modules.ReactNativeHostWrapper

class MainApplication : Application(), ReactApplication {

  override val reactNativeHost: ReactNativeHost = ReactNativeHostWrapper(
        this,
        object : DefaultReactNativeHost(this) {
          override fun getPackages(): List<ReactPackage> {
            val packages = PackageList(this).packages
            // Packages that cannot be autolinked yet can be added manually here, for example:
            // packages.add(MyReactNativePackage())
            return packages
          }

          override fun getJSMainModuleName(): String = ".expo/.virtual-metro-entry"

          override fun getUseDeveloperSupport(): Boolean = BuildConfig.DEBUG

          override val isNewArchEnabled: Boolean = BuildConfig.IS_NEW_ARCHITECTURE_ENABLED
          override val isHermesEnabled: Boolean = BuildConfig.IS_HERMES_ENABLED
      }
  )

  override val reactHost: ReactHost
    get() = ReactNativeHostWrapper.createReactHost(applicationContext, reactNativeHost)

  // Missing-Splits-Guard (Crashlytics-Top-Issue 2026-07: SoLoaderDSONotFoundError
  // "couldn't find DSO to load: libreactnative.so" in onCreate). Ursache: App
  // wurde OHNE ihre ABI-Splits installiert (Sideload/App-Sharing/kaputtes
  // Delta-Update) → native Libs fehlen → Boot-Crash-Loop.
  // Erkennung wie Googles eingestellte missing-splits-Library (play:core 1.10.x,
  // mit targetSdk 35 nicht mehr nutzbar): bundletool injiziert bei AAB-Builds das
  // Meta-Data "com.android.vending.splits.required" ins Base-Manifest — ist es
  // gesetzt, aber es sind KEINE Splits installiert, ist die Installation kaputt.
  // Universal-APKs (bundletool --mode=universal, unser Device-Test-Workflow) und
  // lokale Debug-APKs tragen das Meta-Data NICHT → Guard bleibt dort inaktiv.
  private fun isMissingRequiredSplits(): Boolean {
    return try {
      val ai = packageManager.getApplicationInfo(packageName, PackageManager.GET_META_DATA)
      val splitsRequired = ai.metaData?.getBoolean("com.android.vending.splits.required", false) ?: false
      splitsRequired && ai.splitSourceDirs.isNullOrEmpty()
    } catch (e: Exception) {
      false // im Zweifel normal booten
    }
  }

  // Erkennt, ob ein Throwable ein NATIVE-LADE-Fehler ist (fehlende .so / DSO).
  // Das ist der Kern des Missing-Splits-Problems, wenn NUR der ABI-Split fehlt
  // (Base + Sprach-/Density-Splits sind da → isMissingRequiredSplits() greift
  // NICHT, weil splitSourceDirs nicht leer ist). Wir laufen die cause-Kette ab
  // und matchen sehr eng, damit ECHTE App-Bugs weiterhin normal crashen/gemeldet
  // werden (kein Verstecken, kein Falsch-Positiv fuer intakte Installs).
  private fun isNativeLoadFailure(root: Throwable): Boolean {
    var e: Throwable? = root
    var depth = 0
    while (e != null && depth < 12) {
      if (e is UnsatisfiedLinkError) return true
      val cn = e.javaClass.name
      if (cn.contains("SoLoader") || cn.contains("DSONotFound")) return true
      val msg = e.message ?: ""
      if (msg.contains("couldn't find DSO") ||
          msg.contains("libreactnative") ||
          msg.contains("libhermes") ||
          msg.contains("dlopen failed")) return true
      e = e.cause
      depth++
    }
    return false
  }

  // Unvollstaendige Installation: freundlich in den Play Store leiten und den
  // Prozess beenden, BEVOR/NACHDEM ein nativer Lade-Fehler auftritt — statt
  // Crash-Loop oeffnet jeder App-Tap die Store-Seite zum Neu-Installieren.
  private fun redirectToPlayStoreAndDie() {
    runCatching {
      Toast.makeText(
        this,
        "MarkenDetektive ist unvollständig installiert — bitte über den Play Store neu installieren (vorher deinstallieren).",
        Toast.LENGTH_LONG,
      ).show()
      startActivity(
        Intent(Intent.ACTION_VIEW, Uri.parse("market://details?id=$packageName"))
          .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
      )
    }
    android.os.Process.killProcess(android.os.Process.myPid())
  }

  override fun onCreate() {
    // Schnell-Pfad: gar KEINE Splits installiert (Base-only-Install, z.B. per
    // App-Sharing) → vor jeder nativen Ladung abfangen.
    if (isMissingRequiredSplits()) {
      redirectToPlayStoreAndDie()
      return
    }
    // Robuster Catch-All: der native Load kann auch fehlschlagen, wenn NUR der
    // ABI-Split fehlt (andere Splits vorhanden). Dann wirft SoLoader/RN einen
    // UnsatisfiedLinkError / SoLoaderDSONotFoundError beim Laden von
    // libreactnative.so. Topologie-unabhaengig abfangen und in den Store leiten;
    // alles andere unveraendert weiterwerfen (echte Bugs bleiben sichtbar).
    try {
      super.onCreate()
      SoLoader.init(this, OpenSourceMergedSoMapping)
      if (BuildConfig.IS_NEW_ARCHITECTURE_ENABLED) {
        // If you opted-in for the New Architecture, we load the native entry point for this app.
        load()
      }
      ApplicationLifecycleDispatcher.onApplicationCreate(this)
    } catch (t: Throwable) {
      if (isNativeLoadFailure(t)) {
        redirectToPlayStoreAndDie()
      } else {
        throw t
      }
    }
  }

  override fun onConfigurationChanged(newConfig: Configuration) {
    super.onConfigurationChanged(newConfig)
    ApplicationLifecycleDispatcher.onConfigurationChanged(this, newConfig)
  }
}
