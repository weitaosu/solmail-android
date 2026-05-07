import { DarkTheme, ThemeProvider } from '@react-navigation/native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import 'react-native-reanimated';

import { MobileWalletProvider } from '@/src/wallet/mobile-wallet-provider';
import { palette } from '@/constants/colors';

export const unstable_settings = {
  anchor: '(tabs)',
};

const navTheme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    background: palette.surface,
    card: palette.surface,
    border: palette.divider,
    text: palette.textPrimary,
    primary: palette.accent,
    notification: palette.accent,
  },
};

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <MobileWalletProvider>
        <ThemeProvider value={navTheme}>
          <Stack screenOptions={{ contentStyle: { backgroundColor: palette.surface } }}>
            <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
            <Stack.Screen name="auth-callback" options={{ headerShown: false }} />
            <Stack.Screen name="inbox" options={{ headerShown: false }} />
            <Stack.Screen name="compose" options={{ headerShown: false, animation: 'slide_from_bottom' }} />
            <Stack.Screen name="thread/[id]" options={{ headerShown: false }} />
            <Stack.Screen name="modal" options={{ presentation: 'modal', title: 'Modal' }} />
          </Stack>
          <StatusBar style="light" backgroundColor={palette.surface} />
        </ThemeProvider>
      </MobileWalletProvider>
    </SafeAreaProvider>
  );
}
