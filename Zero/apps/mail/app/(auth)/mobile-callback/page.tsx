import { useEffect } from 'react';
import { useSearchParams } from 'react-router';

export default function MobileCallbackPage() {
  const [searchParams] = useSearchParams();

  useEffect(() => {
    const redirectTarget = searchParams.get('redirect');
    if (redirectTarget) {
      window.location.replace(redirectTarget);
    }
  }, [searchParams]);

  const redirectTarget = searchParams.get('redirect');

  return (
    <div className="flex min-h-screen w-full flex-col items-center justify-center gap-3 bg-[#111111] p-6 text-white">
      <p className="text-xl font-semibold">Finishing sign-in...</p>
      <p className="text-sm text-white/70">Returning you to SolMail app.</p>
      {redirectTarget && (
        <a className="text-sm underline underline-offset-4" href={redirectTarget}>
          Open app manually
        </a>
      )}
    </div>
  );
}
