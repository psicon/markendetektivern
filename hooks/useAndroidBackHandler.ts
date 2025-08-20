import { useEffect } from 'react';
import { BackHandler, Platform } from 'react-native';

/**
 * Custom hook to handle Android back button
 * @param handler - Function to call when back button is pressed. Return true to prevent default behavior
 */
export const useAndroidBackHandler = (handler: () => boolean) => {
  useEffect(() => {
    if (Platform.OS !== 'android') return;

    const backHandler = BackHandler.addEventListener(
      'hardwareBackPress',
      handler
    );

    return () => backHandler.remove();
  }, [handler]);
};
