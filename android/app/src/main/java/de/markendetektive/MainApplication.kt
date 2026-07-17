package de.markendetektive

import android.app.Application
import android.content.res.Configuration

import com.facebook.react.PackageList
import com.facebook.react.ReactApplication
import com.facebook.react.ReactNativeHost
import com.facebook.react.ReactPackage
import com.facebook.react.ReactHost
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.load
import com.facebook.react.defaults.DefaultReactNativeHost
import com.facebook.react.soloader.OpenSourceMergedSoMapping
import com.facebook.soloader.SoLoader

import com.google.android.play.core.missingsplits.MissingSplitsManagerFactory

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

  override fun onCreate() {
    // Missing-Splits-Guard (Crashlytics-Top-Issue 2026-07: SoLoaderDSONotFoundError
    // "couldn't find DSO to load: libreactnative.so" in onCreate). Ursache: App
    // wurde OHNE ihre ABI-Splits installiert (Sideload/App-Sharing/kaputtes
    // Delta-Update) → native Libs fehlen → Boot-Crash-Loop. Google-Pattern:
    // App deaktivieren + Play zeigt den "Neu installieren"-Dialog, statt dass
    // SoLoader.init unten crasht. MUSS vor super.onCreate() und jeder weiteren
    // Initialisierung laufen. Universal-APKs (bundletool-Device-Test-Workflow)
    // sind vollstaendig und triggern den Guard NICHT.
    if (MissingSplitsManagerFactory.create(this).disableAppIfMissingRequiredSplits()) {
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
