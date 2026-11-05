package de.markendetektive
import expo.modules.splashscreen.SplashScreenManager

import android.os.Build
import android.os.Bundle

import androidx.lifecycle.Lifecycle

import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate
import com.facebook.react.modules.core.PermissionListener

import expo.modules.ReactActivityDelegateWrapper

class MainActivity : ReactActivity() {
  /**
   * Berechtigungs-Ergebnisse sofort zustellen, wenn die App ohnehin läuft
   * (Vorfall 25.09.2026, Pixel 8 / Android 16, Build 6.0.20-1246).
   *
   * React Native hält das Ergebnis jeder Laufzeit-Berechtigung zurück, bis
   * die Activity das nächste Mal `onResume` durchläuft
   * (ReactActivityDelegate.mPermissionsCallback); die Expo-Hülle stellt es
   * zusätzlich zeitversetzt über eine Coroutine zu. Steht der Ausgang schon
   * fest (erteilt oder dauerhaft verweigert), beantwortet Android die Anfrage
   * ohne sichtbaren Dialog — auf neueren Geräten dabei ohne die Activity zu
   * pausieren. Dann kam das Ergebnis erst nach Sperren/Entsperren an: ewiger
   * Spinner auf „Akzeptieren“, „Einstellungen öffnen“ ohne Wirkung, und Expo
   * parkte jede weitere Anfrage (Kamera, Mitteilungen) dahinter.
   *
   * Hier: Hörer selbst halten, Ergebnis sofort zustellen, wenn die Activity
   * RESUMED ist, sonst wie bisher beim nächsten `onResume`. Ein Hörer auf
   * einmal wie in React Native.
   *
   * - Alle Zugriffe laufen auf dem Hauptthread: Expo ruft `requestPermissions`
   *   von seinem Hintergrund-Thread auf (vorher legte die Expo-Hülle das auf
   *   den Hauptthread; ohne das gäbe es einen Wettlauf mit der Zustellung).
   * - Hörer und zurückgehaltenes Ergebnis leben prozessweit (companion): wird
   *   die Activity bei offenem Dialog neu erstellt (Faltgerät, Anzeigegröße),
   *   erreicht das Ergebnis trotzdem den wartenden Hörer, statt dass Expo
   *   jede weitere Anfrage für immer parkt.
   */
  companion object {
    private var berechtigungsHoerer: PermissionListener? = null
    private var ausstehendesErgebnis: (() -> Unit)? = null
  }

  override fun requestPermissions(permissions: Array<String>, requestCode: Int, listener: PermissionListener?) {
    // Auf dem Hauptthread synchron (Folgeanfrage aus einem Expo-Hörer),
    // sonst in dessen Warteschlange — Expo hält dabei sein Schloss nicht fest.
    runOnUiThread {
      berechtigungsHoerer = listener
      requestPermissions(permissions, requestCode)
    }
  }

  @Suppress("DEPRECATION")
  override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<String>, grantResults: IntArray) {
    // Der React-Native-Weg bleibt bestehen, hat aber keinen Hörer mehr und tut nichts.
    super.onRequestPermissionsResult(requestCode, permissions, grantResults)
    // Den Hörer JETZT festhalten: das Ergebnis gehört zu der Anfrage, die es
    // ausgelöst hat, auch wenn bis zur Zustellung eine neue gestellt wird.
    val hoerer = berechtigungsHoerer ?: return
    val zustellen = {
      if (hoerer.onRequestPermissionsResult(requestCode, permissions, grantResults)) {
        // Nur löschen, wenn der Hörer nicht schon eine Folgeanfrage gestellt hat.
        if (berechtigungsHoerer === hoerer) berechtigungsHoerer = null
      }
    }
    if (lifecycle.currentState.isAtLeast(Lifecycle.State.RESUMED)) {
      zustellen()
    } else {
      ausstehendesErgebnis = zustellen
    }
  }

  override fun onResume() {
    super.onResume()
    val offen = ausstehendesErgebnis
    ausstehendesErgebnis = null
    offen?.invoke()
  }

  override fun onCreate(savedInstanceState: Bundle?) {
    // Set the theme to AppTheme BEFORE onCreate to support
    // coloring the background, status bar, and navigation bar.
    // This is required for expo-splash-screen.
    // setTheme(R.style.AppTheme);
    // @generated begin expo-splashscreen - expo prebuild (DO NOT MODIFY) sync-f3ff59a738c56c9a6119210cb55f0b613eb8b6af
    SplashScreenManager.registerOnActivity(this)
    // @generated end expo-splashscreen
    super.onCreate(null)
  }

  /**
   * Returns the name of the main component registered from JavaScript. This is used to schedule
   * rendering of the component.
   */
  override fun getMainComponentName(): String = "main"

  /**
   * Returns the instance of the [ReactActivityDelegate]. We use [DefaultReactActivityDelegate]
   * which allows you to enable New Architecture with a single boolean flags [fabricEnabled]
   */
  override fun createReactActivityDelegate(): ReactActivityDelegate {
    return ReactActivityDelegateWrapper(
          this,
          BuildConfig.IS_NEW_ARCHITECTURE_ENABLED,
          object : DefaultReactActivityDelegate(
              this,
              mainComponentName,
              fabricEnabled
          ){})
  }

  /**
    * Align the back button behavior with Android S
    * where moving root activities to background instead of finishing activities.
    * @see <a href="https://developer.android.com/reference/android/app/Activity#onBackPressed()">onBackPressed</a>
    */
  override fun invokeDefaultOnBackPressed() {
      if (Build.VERSION.SDK_INT <= Build.VERSION_CODES.R) {
          if (!moveTaskToBack(false)) {
              // For non-root activities, use the default implementation to finish them.
              super.invokeDefaultOnBackPressed()
          }
          return
      }

      // Use the default back button implementation on Android S
      // because it's doing more than [Activity.moveTaskToBack] in fact.
      super.invokeDefaultOnBackPressed()
  }
}
