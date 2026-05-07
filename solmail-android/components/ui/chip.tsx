import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { palette } from '@/constants/colors';

type ChipProps = {
  label: string;
  onRemove?: () => void;
};

export function Chip({ label, onRemove }: ChipProps) {
  return (
    <View style={styles.chip}>
      <Text style={styles.label} numberOfLines={1}>
        {label}
      </Text>
      {onRemove && (
        <Pressable hitSlop={8} onPress={onRemove} style={styles.x}>
          <Feather name="x" size={12} color={palette.textSecondary} />
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: palette.surfaceElevated,
    borderRadius: 16,
    paddingHorizontal: 10,
    paddingVertical: 5,
    gap: 6,
    maxWidth: 220,
  },
  label: { color: palette.textPrimary, fontSize: 13 },
  x: { padding: 1 },
});
