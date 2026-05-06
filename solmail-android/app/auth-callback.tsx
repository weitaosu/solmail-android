import { useEffect } from 'react';
import { useRouter } from 'expo-router';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

export default function AuthCallbackScreen() {
  const router = useRouter();

  useEffect(() => {
    // Custom-tab OAuth returns to this route through deep-link callbackURL.
    // For now we route directly to inbox after callback.
    const timer = setTimeout(() => {
      router.replace('/inbox');
    }, 250);

    return () => clearTimeout(timer);
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
