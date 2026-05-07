import { useEffect } from 'react';
import { useRouter } from 'expo-router';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import * as Linking from 'expo-linking';
import { setAuthSession, setMobileToken } from '@/src/auth/session-store';

export default function AuthCallbackScreen() {
  const router = useRouter();

  useEffect(() => {
    const finishSignIn = async () => {
      const initialUrl = await Linking.getInitialURL();
      const parsed = initialUrl ? Linking.parse(initialUrl) : null;
      const tokenParam =
        typeof parsed?.queryParams?.token === 'string' ? parsed.queryParams.token : null;
      const sessionValue = tokenParam || `oauth:${Date.now()}`;

      await setAuthSession(sessionValue);
      if (tokenParam) {
        await setMobileToken(tokenParam);
      }
      router.replace('/inbox');
    };

    void finishSignIn();
  }, [router]);

  return (
    <View style={styles.container}>
      <ActivityIndicator size="large" color="#1f7de8" />
      <Text style={styles.title}>Signing you in...</Text>
      <Text style={styles.subtitle}>Redirecting to inbox</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0e0e11',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 12,
  },
  title: { color: '#f5f5f5', fontSize: 22, fontWeight: '700' },
  subtitle: { color: '#bcbcbc', fontSize: 14 },
});
