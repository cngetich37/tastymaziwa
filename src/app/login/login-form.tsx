'use client';
import { signIn } from 'next-auth/react';
import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';
import { Logo } from '@/components/logo';

export function LoginForm() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const searchParams = useSearchParams();
  // Only allow same-site relative paths, never an absolute URL (open redirect).
  const requested = searchParams.get('callbackUrl') ?? '/';
  // Rejects "//evil.com" and "/\evil.com", which browsers treat as absolute.
  const callbackUrl = /^\/(?![/\\])/.test(requested) ? requested : '/';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    
    const res = await signIn('credentials', {
      username,
      password,
      redirect: false,
    });

    if (res?.error) {
      setError('Invalid username or password');
      setLoading(false);
    } else {
      router.push(callbackUrl);
      router.refresh();
    }
  };

  return (
    <Card className="w-full max-w-md glass-card border-border shadow-xl">
      <CardHeader className="space-y-2">
        <div className="flex items-center justify-center mb-6 mt-4">
          <Logo />
        </div>
        <CardTitle className="text-3xl font-bold tracking-tight text-center font-headline gradient-text">TastyMaziwa</CardTitle>
        <CardDescription className="text-center text-sm">Sign in to record today&apos;s milk</CardDescription>
      </CardHeader>
      <form onSubmit={handleSubmit}>
        <CardContent className="grid gap-6">
          {error && <div className="text-sm text-destructive text-center font-medium bg-destructive/10 border border-destructive/20 p-2 rounded-md animate-in slide-in-from-top-2">{error}</div>}
          <div className="grid gap-2">
            <label htmlFor="username" className="text-sm font-medium leading-none">Username</label>
            <input id="username" type="text" autoComplete="username" autoCapitalize="none" className="flex h-11 w-full rounded-md border border-input/50 bg-background/50 backdrop-blur-xs px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50" value={username} onChange={e => setUsername(e.target.value)} required disabled={loading} />
          </div>
          <div className="grid gap-2">
            <label htmlFor="password" className="text-sm font-medium leading-none">Password</label>
            <input id="password" type="password" autoComplete="current-password" className="flex h-11 w-full rounded-md border border-input/50 bg-background/50 backdrop-blur-xs px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50" value={password} onChange={e => setPassword(e.target.value)} required disabled={loading} />
          </div>
        </CardContent>
        <CardFooter className="pb-8">
          <button type="submit" disabled={loading} className="w-full inline-flex items-center justify-center rounded-md text-sm font-bold ring-offset-background transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 bg-primary text-primary-foreground hover:bg-primary/90 hover:shadow-lg hover:-translate-y-0.5 transform duration-200 h-11 px-8 py-2">
            {loading ? 'Signing in...' : 'Sign In'}
          </button>
        </CardFooter>
      </form>
    </Card>
  );
}
