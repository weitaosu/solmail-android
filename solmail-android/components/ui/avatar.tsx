import { Image, StyleSheet, Text, View } from 'react-native';
import { avatarColorFor } from '@/constants/colors';

type AvatarProps = {
  /** Used for color hash + initial fallback. Pass email or display name. */
  seed: string;
  size?: number;
  imageUri?: string | null;
  /** Override the displayed character. Defaults to first letter of seed. */
  initial?: string;
};

export function Avatar({ seed, size = 40, imageUri, initial }: AvatarProps) {
  const dim = { width: size, height: size, borderRadius: size / 2 };
  if (imageUri && imageUri.startsWith('http')) {
    return <Image source={{ uri: imageUri }} style={[styles.img, dim]} />;
  }
  const ch = (initial ?? seed.trim().charAt(0) ?? '?').toUpperCase();
  const bg = avatarColorFor(seed || ch);
  return (
    <View style={[styles.fallback, dim, { backgroundColor: bg }]}>
      <Text style={[styles.text, { fontSize: Math.round(size * 0.42) }]}>{ch}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  img: { backgroundColor: '#1a1f2a' },
  fallback: { alignItems: 'center', justifyContent: 'center' },
  text: { color: '#fff', fontWeight: '700' },
});
