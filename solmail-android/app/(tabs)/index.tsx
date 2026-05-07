import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useMobileWallet } from '@/src/wallet/mobile-wallet-provider';
import { useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import * as Linking from 'expo-linking';
import { getAuthSession, setAuthSession, setMobileToken } from '@/src/auth/session-store';

WebBrowser.maybeCompleteAuthSession();

export default function HomeScreen() {
  const { account, signIn, disconnect } = useMobileWallet();
  const router = useRouter();
  const [status, setStatus] = useState('Ready');
  const [busy, setBusy] = useState(false);
  const [backendStatus, setBackendStatus] = useState('Checking...');

  useEffect(() => {
    const restoreSession = async () => {
      const authSession = await getAuthSession();
      if (authSession) {
        router.replace('/inbox');
      }
    };

    void restoreSession();
  }, [router]);

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

  const handleGetStarted = async () => {
    try {
      setBusy(true);
      setStatus('Opening Google login...');
      const backendUrl = process.env.EXPO_PUBLIC_BACKEND_URL;
      if (!backendUrl) {
        setStatus('Missing backend URL');
        return;
      }
      const redirectUrl = Linking.createURL('auth-callback', {
        scheme: 'solmailandroid',
        isTripleSlashed: false,
      });
      const appUrl = backendUrl.replace(':8787', ':3000');
      const callbackUrl = `${backendUrl}/api/public/mobile-auth-callback?redirect=${encodeURIComponent(
        redirectUrl,
      )}`;
      const authUrl = `${appUrl}/login?mobileRedirect=${encodeURIComponent(
        redirectUrl,
      )}&callbackURL=${encodeURIComponent(callbackUrl)}&autoProvider=google`;

      const result = await WebBrowser.openAuthSessionAsync(authUrl, redirectUrl);

      if (result.type === 'success') {
        const parsed = Linking.parse(result.url);
        const tokenParam =
          typeof parsed.queryParams?.token === 'string' ? parsed.queryParams.token : null;
        const sessionValue = tokenParam || `oauth:${Date.now()}`;
        await setAuthSession(sessionValue);
        if (tokenParam) {
          await setMobileToken(tokenParam);
        }
        setStatus('Google auth complete. Opening inbox...');
        router.replace('/inbox');
      } else if (result.type === 'cancel' || result.type === 'dismiss') {
        setStatus('Google login cancelled.');
      } else {
        // Fallback: keep prior browser-based flow if custom tab auth session fails.
        await WebBrowser.openBrowserAsync(authUrl);
        setStatus('Complete Google login in browser.');
      }
    } catch (error) {
      setStatus(`Get started failed: ${normalizeError(error)}`);
    } finally {
      setBusy(false);
    }
  };

  const normalizeError = (error: unknown) => {
    const message = error instanceof Error ? error.message : 'Unknown error';
    if (message.includes('Found no installed wallet')) {
      return 'No compatible wallet found. Install/setup a Solana wallet on this device.';
    }
    return message;
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
      <Text style={styles.subtitle}>Get started with your Google account</Text>
      <View style={styles.errorBox}>
        <Text style={styles.errorLabel}>Status</Text>
        <Text style={styles.errorText}>{status}</Text>
      </View>
      <Text style={styles.label}>Backend: {backendStatus}</Text>
      <Text style={styles.label}>Address: {account?.publicKey.toBase58() || 'Not connected'}</Text>
      <Pressable disabled={busy} style={[styles.button, busy && styles.buttonDisabled]} onPress={handleGetStarted}>
        <Text style={styles.buttonText}>{busy ? 'Please wait...' : 'Get Started'}</Text>
      </Pressable>
      <Text style={styles.helper}>After Google login, come back here to connect wallet.</Text>
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
  helper: { color: '#bcbcbc', fontSize: 13 },
});
