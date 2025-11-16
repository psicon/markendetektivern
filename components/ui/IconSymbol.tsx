// Fallback for using MaterialIcons on Android and web.

import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { SymbolViewProps, SymbolWeight } from 'expo-symbols';
import { ComponentProps } from 'react';
import { OpaqueColorValue, type StyleProp, type TextStyle } from 'react-native';

type IconMapping = Record<SymbolViewProps['name'], ComponentProps<typeof MaterialCommunityIcons>['name']>;
type IconSymbolName = keyof typeof MAPPING;

/**
 * Add your SF Symbols to Material Icons mappings here.
 * - see Material Icons in the [Icons Directory](https://icons.expo.fyi).
 * - see SF Symbols in the [SF Symbols](https://developer.apple.com/sf-symbols/) app.
 */
const MAPPING = {
  // Navigation
  'house.fill': 'home',
  'chevron.left': 'chevron-left',
  'chevron.right': 'chevron-right',
  'chevron.left.forwardslash.chevron.right': 'code-tags',
  'arrow.right': 'arrow-right',
  'arrow.left.arrow.right': 'swap-horizontal',
  'line.3.horizontal': 'menu',
  'chevron.down': 'chevron-down',
  'chevron.up': 'chevron-up',
  'arrow.left': 'arrow-left',
  'arrow.clockwise': 'refresh',
  'arrow.uturn.left': 'undo',
  'arrow.uturn.right': 'redo',
  'person.crop.circle.badge.plus': 'account-plus',
  
  // User/Person
  'person.circle': 'account-circle',
  'person.circle.fill': 'account-circle',
  'person.badge.plus': 'account-plus',
  'person.2': 'account-multiple',
  'person.crop.circle.badge.questionmark': 'help',
  
  // Common Actions
  'square.and.pencil': 'pencil',
  'square.and.arrow.up': 'share-variant',
  'magnifyingglass': 'magnify',
  'xmark': 'close',
  'xmark.circle': 'close-circle-outline',
  'xmark.circle.fill': 'close-circle',
  'checkmark': 'check',
  'checkmark.circle.fill': 'check-circle',
  'info.circle': 'information',
  'plus.circle.fill': 'plus-circle',
  'trash': 'trash-can-outline',
  'trash.fill': 'trash-can',
  'hand.thumbsup.fill': 'thumb-up',
  'hand.thumbsdown.fill': 'thumb-down',
  'bell.slash': 'bell-off-outline',
  'bell': 'bell-outline',
  
  // Objects
  'play.rectangle.fill': 'play-box-outline',
  'envelope': 'email-outline',
  'calendar': 'calendar',
  'location.fill': 'map-marker',
  'mappin.circle.fill': 'map-marker',
  'cart': 'cart-outline',
  'cart.fill': 'cart',
  'cart.badge.plus': 'cart-plus',
  'heart': 'heart-outline',
  'heart.fill': 'heart',
  'star': 'star-outline',
  'star.fill': 'star',
  'lightbulb': 'lightbulb-outline',
  'crown': 'crown',
  'crown.fill': 'crown',
  'shield': 'shield-outline',
  'doc': 'file-document-outline',
  'doc.text': 'file-document',
  'newspaper': 'newspaper',
  'photo': 'image-outline',
  'sparkles': 'auto-fix',
  'barcode': 'barcode-scan',
  'gift': 'gift-outline',
  'gift.fill': 'gift',
  'plus': 'plus',
  'tag.fill': 'tag',
  'lightbulb.max.fill': 'lightbulb-on',
  'clock.badge.checkmark': 'clock-check',
  'lock': 'lock',
  'lock.fill': 'lock',
  'flame.fill': 'fire',
  'folder.fill': 'folder',
  'clock': 'clock-outline',
  'clock.fill': 'clock',
  'trophy': 'trophy-outline',
  'trophy.fill': 'trophy',
  'eurosign.circle.fill': 'currency-eur',
  'icloud.and.arrow.up': 'cloud-upload-outline',
  'building.2': 'office-building',
  'leaf': 'leaf',
  'leaf.fill': 'leaf',
  'bubble.left.and.bubble.right': 'forum',
  'camera.fill': 'camera',
  'keyboard': 'keyboard',
  'wand.and.stars': 'wizard-hat',
  'lightbulb.fill': 'lightbulb-on',
  'exclamationmark.triangle.fill': 'alert-outline',
  
  // Charts/Data
  'chart.bar': 'chart-bar',
  'chart.bar.xaxis': 'chart-line',
  'chart.bar.fill': 'chart-bar',
  'chart.line.uptrend.xyaxis': 'trending-up',
  'square.grid.2x2': 'view-grid-outline',
  'list.bullet': 'format-list-bulleted',
  'line.3.horizontal': 'menu',
  
  // Business/Shop
  'storefront': 'storefront-outline',
  'cube': 'cube-outline',
  'cube.box': 'archive',
  'eurosign': 'currency-eur',
  'percent': 'percent',
  'scale.3d': 'scale-balance',
  'chart.bar': 'chart-bar',
  'chart.bar.xaxis': 'chart-box',
  'chart.bar.fill': 'chart-bar',
  'chart.line.uptrend.xyaxis': 'chart-line',
  'percent': 'percent',
  'square.grid.2x2': 'view-grid',
  'square.and.pencil': 'pencil-box',
  'number': 'pound',
  'keyboard': 'keyboard',
  'camera.rotate': 'camera-flip',
  'bubble.left.and.bubble.right': 'message-text',
  'building.2': 'office-building',
  'flame.fill': 'fire',
  'clock.fill': 'clock',
  'spark': 'flash',
  'clock': 'clock-outline',
  'crown': 'crown-outline',
  'crown.fill': 'crown',
  'leaf': 'leaf',
  'bubble.left': 'message-outline',
  'lock': 'lock',
  'lock.open': 'lock-open',
  'folder.fill': 'folder',
  'eurosign': 'currency-eur',
  
  // Settings/Tools
  'gear': 'cog',
  'paperplane.fill': 'send',
  'bolt': 'flash-outline',
  'bolt.fill': 'flash',
  'camera.rotate': 'camera-switch',
  
  // Alerts
  'exclamationmark.triangle': 'alert-outline',
  'questionmark.circle': 'help-circle-outline',
  'circle': 'checkbox-blank-circle-outline',
  'circle.fill': 'circle',
  'square': 'square-outline',
  'checkmark.square.fill': 'checkbox-marked',
  'line.3.horizontal.decrease': 'filter-outline',
  'line.horizontal.3.decrease': 'filter-outline',
  'textformat.abc': 'format-letter-case',
  'pawprint': 'paw',
  'rosette': 'seal',
  'sparkle.magnifyingglass': 'magnify-plus-outline',
  'sun.max': 'white-balance-sunny',
  'magnifyingglass.circle': 'magnify',
  'magnifyingglass.circle.fill': 'magnify',
  'eurosign.circle': 'currency-eur',
  'target': 'target',
  'arrow.triangle.2.circlepath': 'sync',
  'tag': 'tag-outline',
  
  // Brand specific
  'apple.logo': 'apple-ios',
  'moon': 'weather-night',
  'number': 'pound',
  'wineglass': 'glass-wine',
  'cup.and.saucer': 'coffee',
  'birthday.cake': 'cake-variant',
  'drop.fill': 'water',
  'fork.knife': 'silverware-fork-knife',
  'fish': 'fish',
  'bag': 'bag-personal-outline',
  'snowflake': 'snowflake',
  'archivebox': 'archive',
  'heart.circle': 'heart-circle',
  'pawprint.fill': 'paw',
  'cross.case': 'medical-bag',
} as IconMapping;

/**
 * An icon component that uses native SF Symbols on iOS, and Material Icons on Android and web.
 * This ensures a consistent look across platforms, and optimal resource usage.
 * Icon `name`s are based on SF Symbols and require manual mapping to Material Icons.
 */
export function IconSymbol({
  name,
  size = 24,
  color,
  style,
}: {
  name: IconSymbolName;
  size?: number;
  color: string | OpaqueColorValue;
  style?: StyleProp<TextStyle>;
  weight?: SymbolWeight;
}) {
  // Use mapped icon or fallback to a default icon
  const iconName = MAPPING[name] || 'help-circle-outline';
  
  // Log unmapped icons in development
  if (__DEV__ && !MAPPING[name]) {
    console.warn(`IconSymbol: No mapping found for "${name}", using fallback icon`);
  }
  
  return <MaterialCommunityIcons color={color} size={size} name={iconName} style={style} />;
}
