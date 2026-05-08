// withLayoutContext-Wrapper für react-native-bottom-tabs (Callstack)
// damit expo-router's File-based-Routing weiter funktioniert. Pattern
// 1:1 aus den Callstack-Docs (oss.callstack.com/react-native-bottom-tabs).
//
// Rollback: dieses File + die Imports in `(tabs)/_layout.tsx`
// entfernen, USE_NATIVE_TABS-Flag dort auf false → die alte JS-
// Implementation übernimmt wieder.

import { withLayoutContext } from 'expo-router';
import {
  createNativeBottomTabNavigator,
  type NativeBottomTabNavigationOptions,
  type NativeBottomTabNavigationEventMap,
} from '@bottom-tabs/react-navigation';
import type { ParamListBase, TabNavigationState } from '@react-navigation/native';

const BottomTabNavigator = createNativeBottomTabNavigator().Navigator;

export const NativeTabs = withLayoutContext<
  NativeBottomTabNavigationOptions,
  typeof BottomTabNavigator,
  TabNavigationState<ParamListBase>,
  NativeBottomTabNavigationEventMap
>(BottomTabNavigator);
