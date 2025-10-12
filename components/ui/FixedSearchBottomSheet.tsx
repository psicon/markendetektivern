import React from 'react';
import { KeyboardAvoidingView, Platform } from 'react-native';
import FixedAndroidModal from './FixedAndroidModal';
import { SearchBottomSheet } from './SearchBottomSheet';

interface FixedSearchBottomSheetProps {
  visible: boolean;
  onClose: () => void;
  searchBarY: number;
  searchBarHeight: number;
  colors: any;
  onSearch: (term: string) => void;
}

export const FixedSearchBottomSheet: React.FC<FixedSearchBottomSheetProps> = (props) => {
  if (Platform.OS === 'ios') {
    return <SearchBottomSheet {...props} />;
  }

  // Android: Use FixedAndroidModal with KeyboardAvoidingView
  return (
    <FixedAndroidModal
      visible={props.visible}
      onRequestClose={props.onClose}
      isBottomSheet={true}
    >
      <KeyboardAvoidingView 
        behavior="height"
        style={{ flex: 1 }}
      >
        <SearchBottomSheet {...props} />
      </KeyboardAvoidingView>
    </FixedAndroidModal>
  );
};

export default FixedSearchBottomSheet;

