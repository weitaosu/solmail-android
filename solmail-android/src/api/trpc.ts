import { createTRPCProxyClient, httpBatchLink } from '@trpc/client';
import superjson from 'superjson';
import { getMobileToken } from '@/src/auth/session-store';

const backendUrl = process.env.EXPO_PUBLIC_BACKEND_URL;

if (!backendUrl) {
  throw new Error('Missing EXPO_PUBLIC_BACKEND_URL');
}

export const trpc = createTRPCProxyClient<any>({
  links: [
    httpBatchLink({
      url: `${backendUrl}/api/trpc`,
      transformer: superjson,
      async fetch(url, options) {
        const token = await getMobileToken();
        const headers = new Headers(options?.headers);
        if (token) {
          headers.set('Authorization', `Bearer ${token}`);
        }
        return fetch(url, {
          ...options,
          headers,
          credentials: 'include',
        });
      },
    }),
  ],
});

