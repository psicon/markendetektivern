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

  override fun onCreate() {
    if (isMissingRequiredSplits()) {
      // Unvollstaendige Installation: freundlich in den Play Store leiten und
      // den Prozess beenden, BEVOR SoLoader/RN irgendetwas Natives laedt (das
      // wuerde nur wieder crashen). Kein Crash-Loop mehr — jeder App-Tap
      // oeffnet stattdessen die Store-Seite zum Neu-Installieren.
      runCatching {
        Toast.makeText(
          this,
          "MarkenDetektive ist unvollständig installiert — bitte über den Play Store neu installieren.",
          Toast.LENGTH_LONG,
        ).show()
        startActivity(
          Intent(Intent.ACTION_VIEW, Uri.parse("market://details?id=$packageName"))
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
        )
      }
      android.os.Process.killProcess(android.os.Process.myPid())
      return
    }
    super.onCreate()
    SoLoader.init(this, OpenSourceMergedSoMapping)
    if (BuildConfig.IS_NEW_ARCHITECTURE_ENABLED) {
      // If you opted-in for the New Architecture, we load the native entry point for this app.
      load()
    }
    ApplicationLifecycleDispatcher.onApplicationCreate(this)
  }

  override fun onConfigurationChanged(newConfig: Configuration) {
    super.onConfigurationChanged(newConfig)
    ApplicationLifecycleDispatcher.onConfigurationChanged(this, newConfig)
  }
}
