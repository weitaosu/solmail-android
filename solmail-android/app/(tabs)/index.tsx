import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useMobileWallet } from '@/src/wallet/mobile-wallet-provider';
import { useRouter } from 'expo-router';

export default function HomeScreen() {
  const { account, connect, signIn, disconnect } = useMobileWallet();
  const router = useRouter();
  const [status, setStatus] = useState('Ready');
  const [busy, setBusy] = useState(false);
  const [backendStatus, setBackendStatus] = useState('Checking...');

  useEffect(() => {
    const checkBackend = async () => {
      const backendUrl = process.env.EXPO_PUBLIC_BACKEND_URL;
      if (!backendUrl) {
        setBackendStatus('Missing EXPO_PUBLIC_BACKEND_URL');
        return;
      }
      try {
        const res = await fetch(`${backendUrl}/api/public/providers`);
        setBackendStatus(res.ok ? 'Connected' : `Error ${res.status}`);
      } catch {
        setBackendStatus('Not reachable');
      }
    };
    void checkBackend();
  }, []);

  const normalizeError = (error: unknown) => {
    const message = error instanceof Error ? error.message : 'Unknown error';
    if (message.includes('Found no installed wallet')) {
      return 'No compatible wallet found. Install/setup a Solana wallet on this device.';
    }
    return message;
  };

  const handleConnect = async () => {
    try {
      setBusy(true);
      setStatus('Connecting...');
      await connect();
      setStatus('Connected');
    } catch (error) {
      setStatus(`Connect failed: ${normalizeError(error)}`);
    } finally {
      setBusy(false);
    }
  };

  const handleSignIn = async () => {
    try {
      setBusy(true);
      setStatus('Signing in...');
      await signIn();
      setStatus('SIWS success. Continue to inbox.');
    } catch (error) {
      setStatus(`Sign-in failed: ${normalizeError(error)}`);
    } finally {
      setBusy(false);
    }
  };

  const handleDisconnect = async () => {
    try {
      setBusy(true);
      setStatus('Disconnecting...');
      await disconnect();
      setStatus('Disconnected');
    } catch (error) {
      setStatus(`Disconnect failed: ${normalizeError(error)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Login to SolMail</Text>
      <Text style={styles.subtitle}>Sign in with your installed wallet</Text>
      <View style={styles.errorBox}>
        <Text style={styles.errorLabel}>Status</Text>
        <Text style={styles.errorText}>{status}</Text>
      </View>
      <Text style={styles.label}>Backend: {backendStatus}</Text>
      <Text style={styles.label}>Address: {account?.publicKey.toBase58() || 'Not connected'}</Text>
      <Pressable disabled={busy} style={[styles.button, busy && styles.buttonDisabled]} onPress={handleConnect}>
        <Text style={styles.buttonText}>{busy ? 'Please wait...' : 'Connect Wallet'}</Text>
      </Pressable>
      <Pressable disabled={busy} style={[styles.button, busy && styles.buttonDisabled]} onPress={handleSignIn}>
        <Text style={styles.buttonText}>{busy ? 'Please wait...' : 'Sign In (SIWS)'}</Text>
      </Pressable>
      <Pressable disabled={busy} style={[styles.buttonSecondary, busy && styles.buttonDisabled]} onPress={handleDisconnect}>
        <Text style={styles.buttonText}>Disconnect</Text>
      </Pressable>
      {account && (
        <Pressable style={styles.button} onPress={() => router.push('/inbox')}>
          <Text style={styles.buttonText}>Continue to Inbox</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 24,
    justifyContent: 'center',
    gap: 12,
    backgroundColor: '#0e0e11',
  },
  title: { fontSize: 42, fontWeight: '700', color: '#f5f5f5' },
  subtitle: { fontSize: 18, color: '#bcbcbc', marginBottom: 10 },
  label: { fontSize: 14, color: '#d2d2d2' },
  errorBox: {
    borderWidth: 1,
    borderColor: '#a65d2b',
    borderRadius: 10,
    backgroundColor: '#332216',
    padding: 12,
    marginBottom: 10,
  },
  errorLabel: { color: '#f2b990', fontWeight: '600', marginBottom: 4 },
  errorText: { color: '#f5d2b9', fontSize: 14 },
  button: {
    backgroundColor: '#1f7de8',
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: 'center',
  },
  buttonSecondary: {
    backgroundColor: '#2a2a30',
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: 'center',
  },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: '#fff', fontWeight: '700', fontSize: 18 },
});
