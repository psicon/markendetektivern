#!/bin/bash

echo "📱 Warte auf Android Device..."
adb wait-for-device

echo "🧹 Lösche alte Logs..."
adb logcat -c

echo "🚀 Starte App..."
adb shell monkey -p de.markendetektive -c android.intent.category.LAUNCHER 1

echo "⏳ Warte 5 Sekunden..."
sleep 5

echo "📋 Hole Crash-Logs..."
adb logcat -d | grep -E "AndroidRuntime|FATAL EXCEPTION|de.markendetektive" > crash-log.txt

echo "✅ Crash-Log gespeichert in: crash-log.txt"
echo ""
echo "🔍 Letzte Fehler:"
tail -20 crash-log.txt

