import React from 'react';
import { Platform, SafeAreaView, StyleSheet, TouchableOpacity } from 'react-native';
import ImageView from 'react-native-image-viewing';
import { IconSymbol } from './IconSymbol';

interface ImageViewerProps {
  images: Array<{ uri: string }>;
  imageIndex?: number;
  visible: boolean;
  onRequestClose: () => void;
}

export const ImageViewer: React.FC<ImageViewerProps> = ({
  images,
  imageIndex = 0,
  visible,
  onRequestClose,
}) => {
  const HeaderComponent = () => (
    <SafeAreaView style={styles.header}>
      <TouchableOpacity
        style={styles.closeButton}
        onPress={onRequestClose}
        hitSlop={{ top: 20, bottom: 20, left: 20, right: 20 }}
      >
        <IconSymbol name="xmark.circle.fill" size={32} color="white" />
      </TouchableOpacity>
    </SafeAreaView>
  );

  return (
    <ImageView
      images={images}
      imageIndex={imageIndex}
      visible={visible}
      onRequestClose={onRequestClose}
      swipeToCloseEnabled={true}
      doubleTapToZoomEnabled={true}
      HeaderComponent={HeaderComponent}
      FooterComponent={() => null}
      presentationStyle={Platform.OS === 'ios' ? 'overFullScreen' : 'fullScreen'}
    />
  );
};

const styles = StyleSheet.create({
  header: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 999,
  },
  closeButton: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 60 : 20, // iOS: Unter der Dynamic Island/Notch
    right: 20,
    backgroundColor: 'rgba(0,0,0,0.5)',
    borderRadius: 20,
    padding: 8,
  },
});

export default ImageViewer;
