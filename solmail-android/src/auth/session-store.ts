import * as SecureStore from 'expo-secure-store';

const AUTH_SESSION_KEY = 'solmail.auth.session';
const MOBILE_TOKEN_KEY = 'solmail.auth.mobile_token';

export async function getAuthSession() {
  return SecureStore.getItemAsync(AUTH_SESSION_KEY);
}

export async function setAuthSession(value: string) {
  return SecureStore.setItemAsync(AUTH_SESSION_KEY, value);
}

export async function clearAuthSession() {
  return SecureStore.deleteItemAsync(AUTH_SESSION_KEY);
}

export async function getMobileToken() {
  return SecureStore.getItemAsync(MOBILE_TOKEN_KEY);
}

export async function setMobileToken(token: string) {
  return SecureStore.setItemAsync(MOBILE_TOKEN_KEY, token);
}

export async function clearMobileToken() {
  return SecureStore.deleteItemAsync(MOBILE_TOKEN_KEY);
}

