import { Suspense } from 'react';
import { LoginForm } from './login-form';

export default function LoginPage() {
  return (
    <div className="relative flex min-h-dvh w-full items-center justify-center bg-background p-4 animate-in fade-in duration-700">
      <div className="absolute inset-0 -z-10 h-full w-full bg-background bg-[radial-gradient(#e5e7eb_1px,transparent_1px)] dark:bg-[radial-gradient(#ffffff22_1px,transparent_1px)] bg-size-[16px_16px] mask-[radial-gradient(ellipse_50%_50%_at_50%_50%,#000_70%,transparent_100%)] opacity-50"></div>
      <Suspense>
        <LoginForm />
      </Suspense>
    </div>
  );
}
