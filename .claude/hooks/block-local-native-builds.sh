#!/bin/bash
# Hook: PreToolUse / Bash
# Zweck: blockt lokale Native-Builds (Android Gradle, iOS xcodebuild,
#         pod install in android-Kontext, etc.). CLAUDE.md-Regel
#         "Builds & deploys — ALWAYS via EAS, NEVER local" wird damit
#         technisch durchgesetzt.
#
# Hat im April 2026 1 h verbrannt mit Java-14-vs-17 + ANDROID_HOME-
# Stress, soll nicht nochmal passieren.
#
# WICHTIG: nur das ERSTE Kommando der Bash-Zeile checken — Commit-
# Messages, Heredocs, Doku-Strings enthalten oft die Forbidden-
# Patterns als Text. Wenn wir die ganze Command-String greppen,
# blocken wir uns selbst beim Commit dieser Hook-Doku.

set -e

INPUT=$(cat)
CMD=$(echo "$INPUT" | jq -r '.tool_input.command // empty')

# First-line + first-word extrahieren. Bash führt das aus was am
# Anfang steht; Heredoc-Content ist Argument-String, nicht executable.
FIRST_LINE=$(echo "$CMD" | head -1)
FIRST_WORD=$(echo "$FIRST_LINE" | awk '{print $1}')

BLOCK=0
case "$FIRST_WORD" in
  cd)
    # `cd <path> && ./gradlew …` — nur wenn der Pfad "android"
    # enthält (z.B. `cd android && ./gradlew assembleRelease`)
    if echo "$FIRST_LINE" | grep -qE '^cd[[:space:]]+[^;&|]*android[^;&|]*&&[[:space:]]*\./gradlew'; then
      BLOCK=1
    fi
    ;;
  ./gradlew|gradlew)
    # Direkter gradlew-Aufruf
    BLOCK=1
    ;;
  xcodebuild)
    # iOS native build
    BLOCK=1
    ;;
esac

if [ "$BLOCK" = "1" ]; then
  cat <<'EOF'
{"decision": "block", "reason": "Lokale Native-Builds sind verboten. Nur EAS Build verwenden:\n  • Android: eas build --platform android --profile production --non-interactive --no-wait\n  • iOS:     eas build --platform ios --profile production --non-interactive --no-wait\n\nSiehe CLAUDE.md → 'Builds & deploys — ALWAYS via EAS, NEVER local'."}
EOF
fi

exit 0
