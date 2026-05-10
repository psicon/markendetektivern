#!/bin/bash
# Hook: PostToolUse / Edit | Write | NotebookEdit
# Zweck: greppt frisch geschriebenen Code nach bekannten Forbidden
#        Patterns (siehe CLAUDE.md → "Forbidden Patterns"). Blockt
#        nicht — gibt nur Reminder via stderr aus.
#
# Match-Liste = Patterns die mehrfach in einer Falle endeten.
# Erweitern wenn neue "sicher gelernt"-Punkte in CLAUDE.md
# auftauchen.

set -e

INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')

# Nur auf .ts/.tsx-Files reagieren — JS-Skripte / JSON / md egal.
case "$FILE_PATH" in
  *.ts|*.tsx) ;;
  *) exit 0 ;;
esac

# File-Inhalt lesen — erst nach dem Edit, also live-Stand.
[ ! -f "$FILE_PATH" ] && exit 0
CONTENT=$(cat "$FILE_PATH")

WARNINGS=()

# 1) experimentalBlurMethod auf Android = Surface-Stops
if echo "$CONTENT" | grep -qE 'experimentalBlurMethod[[:space:]]*=[[:space:]]*["'\'']dimezisBlurView["'\'']'; then
  # Nur warnen wenn das File NICHT in einer iOS-spezifischen Branch
  # ist — Heuristik: file mention nicht "iOS" / "Platform.OS === 'ios'"
  # in unmittelbarer Nähe? Zu komplex für ein Bash-grep — wir warnen
  # immer, mit Hinweis dass iOS-only ok ist.
  WARNINGS+=("⚠️  experimentalBlurMethod='dimezisBlurView' gefunden in $FILE_PATH — auf Android causes Surface-Stops / Grey-Screens. Nur in iOS-spezifischen Branches verwenden (Platform.OS === 'ios').")
fi

# 2) Skia BackdropBlur als RN-Backdrop (häufiger Fehler)
if echo "$CONTENT" | grep -qE '<BackdropBlur'; then
  if ! echo "$FILE_PATH" | grep -qE '(test|spec|story)'; then
    WARNINGS+=("⚠️  <BackdropBlur> aus @shopify/react-native-skia gefunden in $FILE_PATH — sampled NUR Skia-Canvas-internen Content, NICHT die RN-Views darunter. Falls das als BlurView-Ersatz gedacht ist: funktioniert nicht. Siehe CLAUDE.md → Forbidden Patterns.")
  fi
fi

# 3) Boot-Pfad-Sleeps — explizit nur in app/_layout.tsx + app/index.tsx
case "$FILE_PATH" in
  */app/_layout.tsx|*/app/index.tsx|*/components/ui/FontLoader.tsx)
    if echo "$CONTENT" | grep -qE 'await new Promise\(.*setTimeout'; then
      WARNINGS+=("⚠️  await new Promise(setTimeout) in Boot-Pfad ($FILE_PATH) — auf Android = Whitescreen, weil Custom-SplashScreen-Overlay nur iOS mountet. Nutze stattdessen InteractionManager.runAfterInteractions oder lass die Verzögerung weg.")
    fi
    ;;
esac

# 4) await import('react-native') — triggert PushNotificationIOS-Crash
if echo "$CONTENT" | grep -qE "await\s+import\s*\(\s*['\"]react-native['\"]"; then
  WARNINGS+=("⚠️  await import('react-native') in $FILE_PATH — triggert metroImportAll → PushNotificationIOS lazy getter → NativeEventEmitter(null) crash. RN-imports MÜSSEN statisch am File-Top stehen.")
fi

# 5) initializeFirestore mit persistentLocalCache — Web-only API
if echo "$CONTENT" | grep -qE 'initializeFirestore.*persistentLocalCache|persistentSingleTabManager'; then
  WARNINGS+=("⚠️  initializeFirestore mit persistentLocalCache/persistentSingleTabManager in $FILE_PATH — Web-only API. Auf RN crash via NativeEventEmitter. Nutze getFirestore(app) (in-memory cache, default).")
fi

# Output via stderr — Claude sieht das im PostToolUse-Result.
if [ ${#WARNINGS[@]} -gt 0 ]; then
  printf '%s\n' "${WARNINGS[@]}" >&2
fi

exit 0
