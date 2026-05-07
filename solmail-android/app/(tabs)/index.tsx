import { useEffect, useState } from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import * as Linking from 'expo-linking';
import { Feather } from '@expo/vector-icons';
import { getAuthSession, setAuthSession, setMobileToken } from '@/src/auth/session-store';
import { palette } from '@/constants/colors';

WebBrowser.maybeCompleteAuthSession();

export default function HomeScreen() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const backendUrl = process.env.EXPO_PUBLIC_BACKEND_URL;
  const appUrl = process.env.EXPO_PUBLIC_APP_URL ?? backendUrl?.replace(':8787', ':3000');
  const logoUri = appUrl ? `${appUrl}/solmail-logo.png` : null;

  useEffect(() => {
    const restoreSession = async () => {
      const authSession = await getAuthSession();
      if (authSession) {
        router.replace('/inbox');
      }
    };
    void restoreSession();
  }, [router]);

  const normalizeError = (err: unknown) => {
    const message = err instanceof Error ? err.message : 'Unknown error';
    if (message.includes('Found no installed wallet')) {
      return 'No compatible Solana wallet found on this device.';
    }
    return message;
  };

  const handleGetStarted = async () => {
    try {
      setBusy(true);
      setError(null);
      if (!backendUrl) {
        setError('Missing backend URL configuration.');
        return;
      }
      const redirectUrl = Linking.createURL('auth-callback', {
        scheme: 'solmailandroid',
        isTripleSlashed: false,
      });
      if (!appUrl) {
        setError('Missing app URL configuration.');
        return;
      }
      const authUrl = `${appUrl}/login?mobileRedirect=${encodeURIComponent(redirectUrl)}&autoProvider=google`;

      const result = await WebBrowser.openAuthSessionAsync(authUrl, redirectUrl);

      if (result.type === 'success') {
        const parsed = Linking.parse(result.url);
        const tokenParam =
          typeof parsed.queryParams?.token === 'string' ? parsed.queryParams.token : null;
        const sessionValue = tokenParam || `oauth:${Date.now()}`;
        await setAuthSession(sessionValue);
        if (tokenParam) await setMobileToken(tokenParam);
        router.replace('/inbox');
      } else if (result.type === 'cancel' || result.type === 'dismiss') {
        // Silent — user backed out.
      } else {
        await WebBrowser.openBrowserAsync(authUrl);
        setError('Complete login in the browser, then return to the app.');
      }
    } catch (err) {
      setError(`Sign-in failed: ${normalizeError(err)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={styles.shell} edges={['top', 'bottom']}>
      <View style={styles.hero}>
        <View style={styles.logoCircle}>
          <Image
            source={logoUri ? { uri: logoUri } : require('@/assets/images/icon.png')}
            defaultSource={require('@/assets/images/icon.png')}
            style={styles.logoImage}
          />
        </View>
        <Text style={styles.title}>SolMail</Text>
        <Text style={styles.tagline}>Micropayments for cold emailing that incentivize meaningful responses.</Text>
      </View>

      <View style={styles.actions}>
        <Pressable
          disabled={busy}
          style={({ pressed }) => [
            styles.primaryButton,
            (busy || pressed) && styles.primaryButtonPressed,
          ]}
          onPress={handleGetStarted}
        >
          {busy ? (
            <ActivityIndicator size="small" color={palette.surface} />
          ) : (
            <>
              <Feather name="log-in" size={18} color={palette.surface} />
              <Text style={styles.primaryButtonText}>Continue with Google</Text>
            </>
          )}
        </Pressable>

        {!!error && (
          <View style={styles.errorBanner}>
            <Feather name="alert-circle" size={14} color={palette.danger} />
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  shell: {
    flex: 1,
    padding: 32,
    backgroundColor: palette.surface,
    justifyContent: 'space-between',
  },
  hero: {
    alignItems: 'center',
    marginTop: 80,
  },
  logoCircle: {
    width: 84,
    height: 84,
    borderRadius: 42,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 24,
  },
  logoImage: {
    width: 56,
    height: 56,
    borderRadius: 14,
  },
  title: {
    color: palette.textPrimary,
    fontSize: 38,
    fontWeight: '700',
    letterSpacing: -0.5,
    marginBottom: 8,
  },
  tagline: {
    color: palette.textMuted,
    fontSize: 15,
    textAlign: 'center',
    paddingHorizontal: 16,
    lineHeight: 22,
  },
  actions: {
    gap: 14,
    marginBottom: 24,
  },
  primaryButton: {
    backgroundColor: '#fff',
    height: 52,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: palette.border,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  primaryButtonPressed: { opacity: 0.85 },
  primaryButtonText: { color: palette.surface, fontSize: 16, fontWeight: '600' },
  helper: {
    color: palette.textFaint,
    fontSize: 12,
    textAlign: 'center',
  },
  errorBanner: {
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#2a1a1f',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#5a2a32',
  },
  errorText: { color: palette.danger, fontSize: 13, flex: 1 },
});
