import React, { useEffect } from 'react';
import { Platform } from 'react-native';
import { isExpoGo } from '@/lib/utils/platform';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import { Camera } from 'expo-camera';

/**
 * PermissionBootstrap
 *
 * Fordert beim ersten App-Start (nur iOS, nicht Expo Go) die wichtigsten
 * Berechtigungen an, falls sie noch nie abgefragt wurden. Dadurch erscheinen
 * die Schalter in den iOS-Einstellungen und Nutzer sehen verlässliche Prompts.
 *
 * Hinweis: Apple Guidelines empfehlen kontextbezogene Prompts. Diese Logik
 * fragt nur an, wenn Status "undetermined" ist und stellt damit sicher,
 * dass bestehende Entscheidungen respektiert werden.
 */
export const PermissionBootstrap: React.FC = () => {
  useEffect(() => {
    // Nur auf iOS in Standalone/TestFlight, nicht in Expo Go
    if (Platform.OS !== 'ios' || isExpoGo()) {
      return;
    }

    const ensurePermissions = async () => {
      try {
        // Kamera
        try {
          const cam = await Camera.getCameraPermissionsAsync();
          if (cam.status === 'undetermined') {
            await Camera.requestCameraPermissionsAsync();
          }
        } catch {}

        // Fotos
        try {
          const photos = await ImagePicker.getMediaLibraryPermissionsAsync();
          if (photos.status === 'undetermined') {
            await ImagePicker.requestMediaLibraryPermissionsAsync();
          }
        } catch {}

        // Standort (Foreground)
        try {
          const loc = await Location.getForegroundPermissionsAsync();
          if (loc.status === 'undetermined') {
            await Location.requestForegroundPermissionsAsync();
          }
        } catch {}
      } catch {}
    };

    // Etwas verzögern, um UI-Initialisierung nicht zu stören
    const timer = setTimeout(ensurePermissions, 800);
    return () => clearTimeout(timer);
  }, []);

  return null;
};

export default PermissionBootstrap;


