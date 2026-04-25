# Project notes for Claude Code

## Design system rules (apply everywhere, retroactively too)

**Tab switches always use the swipeable-pill pattern.**
Whenever a screen has internal tabs (e.g. Stöbern's Eigenmarken/Marken,
Detail page's Inhaltsstoffe/Nährwerte, Rewards' Einlösen/Bestenliste,
any future page with tab-style selectors):

- Visually they are `SegmentedTabs` — pill-style, raised active segment
  on a white card, equal-width segments.
- Mechanically they are wired to a `PagerView` (react-native-pager-view)
  so the user can swipe horizontally between them. The PagerView's
  `onPageSelected` updates the SegmentedTabs' `value`, and tapping a
  pill calls `pagerRef.current?.setPage(idx)` so the two stay in sync.
- The animation between tabs is the native page-swipe animation — NOT
  a JS-driven crossfade or translate. PagerView gets this for free
  via UIPageViewController on iOS / ViewPager2 on Android.
- Pages stay mounted (default PagerView behaviour) so swiping back is
  instant; data inside each page can lazy-load on first focus if it's
  expensive.

Stöbern is the reference implementation. Use the same setPage / shared
scroll-handler pattern there as a template.

## Other notes

- Header chrome is BlurView on iOS, tinted opaque View on Android (the
  expo-blur fallback on Android is poor). Content scrolls under the
  chrome via absolute positioning + a paddingTop on the ScrollView
  equal to `insets.top + <chrome-height>`.
- Reanimated 3 is the only animation system in use — no JS-driven
  Animated.Value. Everything goes through useAnimatedStyle /
  useAnimatedScrollHandler so animations stay on the UI thread on
  both platforms.
