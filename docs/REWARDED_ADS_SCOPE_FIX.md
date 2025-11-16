# Rewarded Ads Scope Fix

## Problem
Bei dem Tippen auf eine gesperrte Kategorie kam der Fehler:
```
Property 'reloadCategories' doesn't exist
```

## Ursache
Die Funktionen `reloadCategories` (in index.tsx) und `loadCategories` (in explore.tsx) waren innerhalb von `useEffect` Hooks definiert. Dadurch waren sie nicht im Scope der Komponente verfügbar und konnten nicht als Props an `LockedCategoryModal` übergeben werden.

## Lösung

### 1. index.tsx
```typescript
// VORHER - innerhalb useEffect
useEffect(() => {
  const reloadCategories = async () => {
    // ...
  };
});

// NACHHER - außerhalb useEffect
const reloadCategories = async () => {
  // ...
};

useEffect(() => {
  // ...
});
```

### 2. explore.tsx
```typescript
// VORHER - innerhalb useEffect
useEffect(() => {
  const loadCategories = async () => {
    // ...
  };
});

// NACHHER - außerhalb useEffect
const loadCategories = async () => {
  // ...
};

useEffect(() => {
  // ...
});
```

## Wichtige Hinweise

1. **Dependencies**: Die Funktionen sollten NICHT als Dependencies in ihren eigenen useEffects hinzugefügt werden, da sie von den gleichen Werten abhängen (würde zu Endlosschleifen führen).

2. **Scope**: Funktionen, die als Props übergeben werden sollen, müssen im Component-Scope (nicht in useEffect) definiert sein.

3. **Performance**: Die Funktionen werden bei jedem Render neu erstellt, aber das ist in diesem Fall kein Performance-Problem, da sie nur bei Modal-Interaktionen aufgerufen werden.
