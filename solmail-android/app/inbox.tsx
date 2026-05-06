import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useMobileWallet } from '@/src/wallet/mobile-wallet-provider';

export default function InboxScreen() {
  const router = useRouter();
  const { account } = useMobileWallet();

  return (
    <View style={styles.container}>
      <Text style={styles.title}>SolMail Inbox</Text>
      <Text style={styles.subtitle}>Native inbox flow starts here.</Text>
      <Text style={styles.label}>Connected wallet:</Text>
      <Text style={styles.address}>{account?.publicKey.toBase58() || 'Not connected'}</Text>
      <Text style={styles.todo}>Next: wire tRPC mail list and thread screens.</Text>
      <Pressable style={styles.button} onPress={() => router.replace('/')}>
        <Text style={styles.buttonText}>Back to Login</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0e0e11',
    padding: 24,
    justifyContent: 'center',
    gap: 12,
  },
  title: { color: '#f5f5f5', fontSize: 34, fontWeight: '700' },
  subtitle: { color: '#bcbcbc', fontSize: 16, marginBottom: 8 },
  label: { color: '#bcbcbc', fontSize: 14 },
  address: { color: '#f5f5f5', fontSize: 12 },
  todo: { color: '#f2b990', fontSize: 14, marginTop: 8 },
  button: {
    marginTop: 12,
    backgroundColor: '#1f7de8',
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: 'center',
  },
  buttonText: { color: '#fff', fontWeight: '700', fontSize: 16 },
});
