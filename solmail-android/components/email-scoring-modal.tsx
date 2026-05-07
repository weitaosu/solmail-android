import { Feather } from '@expo/vector-icons';
import { useEffect } from 'react';
import {
  ActivityIndicator,
  Modal,
  StyleSheet,
  Text,
  TouchableWithoutFeedback,
  View,
} from 'react-native';

import { palette } from '../constants/colors';

type Props = {
  visible: boolean;
  onDismiss: () => void;
  /** undefined while still scoring; true = approved, false = not approved. */
  pass?: boolean;
};

/**
 * Quick reply-quality check modal. Shows a spinner while scoring, then a
 * green check (pass) or red X (fail) for ~2s before auto-dismissing. Mirrors
 * the web variant in apps/mail/components/mail/email-scoring-modal.tsx.
 */
export function EmailScoringModal({ visible, onDismiss, pass }: Props) {
  const isLoading = pass === undefined;

  useEffect(() => {
    if (!visible || isLoading) return;
    const timer = setTimeout(onDismiss, 2000);
    return () => clearTimeout(timer);
  }, [visible, isLoading, onDismiss]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={isLoading ? undefined : onDismiss}
    >
      <TouchableWithoutFeedback onPress={isLoading ? undefined : onDismiss}>
        <View style={styles.backdrop}>
          <TouchableWithoutFeedback>
            <View style={styles.card}>
              {isLoading ? (
                <>
                  <ActivityIndicator color={palette.accent} size="large" />
                  <Text style={styles.title}>Checking reply…</Text>
                  <Text style={styles.subtitle}>One moment.</Text>
                </>
              ) : pass ? (
                <>
                  <Feather name="check-circle" size={48} color={palette.success} />
                  <Text style={styles.title}>Reply approved</Text>
                  <Text style={styles.subtitle}>Funds released to your wallet.</Text>
                </>
              ) : (
                <>
                  <Feather name="x-circle" size={48} color={palette.danger} />
                  <Text style={styles.title}>Reply not approved</Text>
                  <Text style={styles.subtitle}>Funds returning to sender.</Text>
                </>
              )}
            </View>
          </TouchableWithoutFeedback>
        </View>
      </TouchableWithoutFeedback>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.55)',
    paddingHorizontal: 32,
  },
  card: {
    width: '100%',
    maxWidth: 320,
    paddingVertical: 28,
    paddingHorizontal: 24,
    borderRadius: 16,
    backgroundColor: palette.surfaceElevated,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: palette.border,
    alignItems: 'center',
    gap: 12,
  },
  title: {
    color: palette.textPrimary,
    fontSize: 17,
    fontWeight: '600',
    textAlign: 'center',
  },
  subtitle: {
    color: palette.textMuted,
    fontSize: 14,
    textAlign: 'center',
  },
});
