import { NativeEventEmitter, NativeModules, Platform } from 'react-native';

const { AVFoundationBarcodeScanner } = NativeModules;

export interface BarcodeResult {
  type: string;
  data: string;
}

export interface NativeScannerEvents {
  onBarcodeDetected: (barcode: BarcodeResult) => void;
  onCameraReady: () => void;
  onError: (error: string) => void;
}

class NativeBarcodeScannerService {
  private eventEmitter: NativeEventEmitter | null = null;
  private isInitialized = false;

  constructor() {
    // Graceful degradation: Native Module nur verfügbar in Production Builds
    if (Platform.OS === 'ios' && AVFoundationBarcodeScanner) {
      this.eventEmitter = new NativeEventEmitter(AVFoundationBarcodeScanner);
      console.log('🍎 Native iOS AVFoundation Scanner available');
    } else {
      console.log('📱 Native Scanner not available - using Expo Go fallback');
    }
  }

  /**
   * Initialize the native camera scanner
   */
  async initializeCamera(): Promise<void> {
    if (Platform.OS !== 'ios' || !AVFoundationBarcodeScanner) {
      throw new Error('Native scanner only available on iOS production builds');
    }

    try {
      await AVFoundationBarcodeScanner.initializeCamera();
      this.isInitialized = true;
      console.log('🎥 iOS AVFoundation Camera initialized');
    } catch (error) {
      console.error('❌ Native camera initialization failed:', error);
      throw error;
    }
  }

  /**
   * Start barcode scanning
   */
  async startScanning(): Promise<void> {
    if (!this.isInitialized) {
      await this.initializeCamera();
    }

    try {
      await AVFoundationBarcodeScanner.startScanning();
      console.log('🔍 iOS Native barcode scanning started');
    } catch (error) {
      console.error('❌ Failed to start scanning:', error);
      throw error;
    }
  }

  /**
   * Stop barcode scanning
   */
  async stopScanning(): Promise<void> {
    if (!this.isInitialized || Platform.OS !== 'ios') {
      return;
    }

    try {
      await AVFoundationBarcodeScanner.stopScanning();
      console.log('⏸️ iOS Native barcode scanning stopped');
    } catch (error) {
      console.error('❌ Failed to stop scanning:', error);
    }
  }

  /**
   * Toggle torch (flash) on/off
   */
  async toggleTorch(): Promise<boolean> {
    if (!this.isInitialized || Platform.OS !== 'ios') {
      return false;
    }

    try {
      const isEnabled = await AVFoundationBarcodeScanner.toggleTorch();
      console.log(`💡 iOS Native torch ${isEnabled ? 'enabled' : 'disabled'}`);
      return isEnabled;
    } catch (error) {
      console.error('❌ Failed to toggle torch:', error);
      return false;
    }
  }

  /**
   * Switch camera (front/back)
   */
  async switchCamera(): Promise<void> {
    if (!this.isInitialized || Platform.OS !== 'ios') {
      return;
    }

    try {
      await AVFoundationBarcodeScanner.switchCameraType();
      console.log('🔄 iOS Native camera switched');
    } catch (error) {
      console.error('❌ Failed to switch camera:', error);
      throw error;
    }
  }

  /**
   * Register event listeners
   */
  registerListeners(events: NativeScannerEvents) {
    if (!this.eventEmitter) {
      console.warn('⚠️ Native scanner event emitter not available');
      return () => {};
    }

    const subscriptions = [
      this.eventEmitter.addListener('onBarcodeDetected', events.onBarcodeDetected),
      this.eventEmitter.addListener('onCameraReady', events.onCameraReady),
      this.eventEmitter.addListener('onError', events.onError),
    ];

    // Return cleanup function
    return () => {
      subscriptions.forEach(subscription => subscription.remove());
    };
  }

  /**
   * Check if native scanner is available
   */
  isAvailable(): boolean {
    return Platform.OS === 'ios' && !!AVFoundationBarcodeScanner;
  }

  /**
   * Cleanup resources
   */
  async cleanup(): Promise<void> {
    await this.stopScanning();
    this.isInitialized = false;
  }
}

export const nativeBarcodeScannerService = new NativeBarcodeScannerService();
