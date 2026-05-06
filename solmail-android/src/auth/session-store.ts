import * as SecureStore from 'expo-secure-store';

const AUTH_SESSION_KEY = 'solmail.auth.session';

export async function getAuthSession() {
  return SecureStore.getItemAsync(AUTH_SESSION_KEY);
}

export async function setAuthSession(value: string) {
  return SecureStore.setItemAsync(AUTH_SESSION_KEY, value);
}

export async function clearAuthSession() {
  return SecureStore.deleteItemAsync(AUTH_SESSION_KEY);
}

