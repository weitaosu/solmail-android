import { authProviders, customProviders, isProviderEnabled } from '../lib/auth-providers';
import type { HonoContext } from '../ctx';
import { SignJWT } from 'jose';
import { Hono } from 'hono';

const publicRouter = new Hono<HonoContext>();

publicRouter.get('/providers', async (c) => {
  const env = c.env as unknown as Record<string, string>;
  const isProd = env.NODE_ENV === 'production';

  const authProviderStatus = authProviders(env).map((provider) => {
    const envVarStatus =
      provider.envVarInfo?.map((envVar) => {
        const envVarName = envVar.name as keyof typeof env;
        return {
          name: envVar.name,
          set: !!env[envVarName],
          source: envVar.source,
          defaultValue: envVar.defaultValue,
        };
      }) || [];

    return {
      id: provider.id,
      name: provider.name,
      enabled: isProviderEnabled(provider, env),
      required: provider.required,
      envVarInfo: provider.envVarInfo,
      envVarStatus,
    };
  });

  const customProviderStatus = customProviders.map((provider) => {
    return {
      id: provider.id,
      name: provider.name,
      enabled: true,
      isCustom: provider.isCustom,
      customRedirectPath: provider.customRedirectPath,
      envVarStatus: [],
    };
  });

  const allProviders = [...customProviderStatus, ...authProviderStatus];

  return c.json({
    allProviders,
    isProd,
  });
});

publicRouter.get('/mobile-auth-callback', async (c) => {
  const redirect = c.req.query('redirect');
  if (!redirect || !redirect.startsWith('solmailandroid://')) {
    return c.text('Invalid redirect', 400);
  }

  const session = await c.var.auth.api.getSession({ headers: c.req.raw.headers });
  if (!session?.user?.id) {
    return c.redirect('/login?error=required_scopes_missing');
  }

  const secret = new TextEncoder().encode(c.env.JWT_SECRET);
  const mobileToken = await new SignJWT({ typ: 'mobile-auth' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer('zero-mobile-auth')
    .setAudience('zero-mobile-app')
    .setSubject(session.user.id)
    .setExpirationTime('7d')
    .sign(secret);

  const separator = redirect.includes('?') ? '&' : '?';
  return c.redirect(`${redirect}${separator}token=${encodeURIComponent(mobileToken)}`);
});

export { publicRouter };
