# Rewarded Ads Freeze Fix

## Problem
Nach dem Ansehen einer Rewarded Ad und erfolgreicher Freischaltung einer Kategorie fror die App ein. Die UI wurde korrekt angezeigt (Timer-Icon), aber Touch-Events funktionierten nicht mehr.

## Ursache
Das Problem war eine Kombination aus mehreren Faktoren:

1. **React Native Modal auf Android**: Das Standard Modal-Component hat bekannte Touch-Event-Probleme auf Android, besonders nach dem Schließen
2. **Race Conditions**: Zwischen Modal-Close und UI-Update gab es Timing-Probleme
3. **Loading State**: Der Loading-State wurde nicht immer korrekt zurückgesetzt

## Lösung

### 1. AndroidSafeModal verwenden
```typescript
// Vorher: Standard Modal
<Modal visible={visible} ...>

// Nachher: Platform-spezifisches Modal
const ModalComponent = Platform.OS === 'android' ? AndroidSafeModal : Modal;
<ModalComponent visible={visible} type="fullscreen" ...>
```

### 2. InteractionManager für Android
```typescript
// Android: Warte auf Interaktionen
if (Platform.OS === 'android') {
  InteractionManager.runAfterInteractions(() => {
    onUnlockSuccess();
  });
} else {
  // iOS: Kleiner Delay genügt
  setTimeout(() => {
    onUnlockSuccess();
  }, 100);
}
```

### 3. Reward erst nach dem Schließen verarbeiten
```typescript
// Reward-Callback NICHT mehr direkt während des Ads ausführen
rewardedAd.addAdEventListener(RewardedAdEventType.EARNED_REWARD, () => {
  // Nur merken, dass Reward verdient wurde
  this.rewardEarned = true;
});

rewardedAd.addAdEventListener(AdEventType.CLOSED, () => {
  if (this.rewardEarned && this.pendingCategoryId && this.onRewardCallback) {
    this.onRewardCallback(this.pendingCategoryId);
  }

  this.rewardEarned = false;
  this.pendingCategoryId = null;
});
```

### 4. Konsistentes State-Management
- Loading-State wird IMMER zurückgesetzt (Success + Error)
- Modal wird SOFORT geschlossen (kein Delay)
- UI-Update erfolgt NACH Modal-Close

### 5. Error Handling
- Error-Callback setzt Loading-State zurück
- Try-Catch in allen kritischen Bereichen

## Ergebnis
Die App friert nicht mehr ein nach dem Ansehen einer Rewarded Ad. Das Modal schließt sich sauber und die UI bleibt reaktiv.

## Wichtige Erkenntnisse
1. **Android Modals sind problematisch**: Verwende immer AndroidSafeModal für kritische Modals
2. **InteractionManager ist wichtig**: Auf Android sollte InteractionManager für UI-Updates nach Modals verwendet werden
3. **Reward erst nach Ad-Close**: UI-Updates erst nach dem Schließen des Ads durchführen, sonst bleiben Modals/Layer hängen
4. **State-Management**: Loading-States müssen in ALLEN Code-Pfaden zurückgesetzt werden
