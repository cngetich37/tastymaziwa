'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState, useTransition, type ReactNode } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { signIn } from 'next-auth/react';
import { z } from 'zod';
import {
  requestLoginCodeAction,
  requestPasswordResetAction,
  requestSignupAction,
  resetPasswordAction,
} from '@/app/auth-actions';
import { SubmitButton, TextField } from '@/components/forms/fields';
import { Form } from '@/components/ui/form';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { ActionResult } from '@/lib/action-result';
import {
  codeField,
  forgotPasswordSchema,
  passwordLoginSchema,
  requestCodeSchema,
  resetPasswordSchema,
  signupSchema,
} from '@/lib/validation';

// --- shared ------------------------------------------------------------------------

/** Same-site relative paths only: "//evil.com" and "/\evil.com" are absolute to browsers. */
function useCallbackUrl(): string {
  const requested = useSearchParams().get('callbackUrl') ?? '/';
  return /^\/(?![/\\])/.test(requested) ? requested : '/';
}

const SIGN_IN_ERRORS: Record<string, string> = {
  invalid: "That didn't work. Check your details and try again.",
  expired: 'That code has expired. Request a new one.',
  too_many_attempts: 'Too many wrong attempts. Request a new code.',
  rate_limited: 'Too many failed attempts. Wait 15 minutes, or sign in with an email code instead.',
};

function Notice({ tone = 'info', children }: { tone?: 'info' | 'error' | 'success'; children: ReactNode }) {
  const styles = {
    info: 'border-border bg-muted text-foreground',
    error: 'border-red-600/30 bg-red-600/10 text-red-700 dark:text-red-300',
    success: 'border-green-600/30 bg-green-600/10 text-green-800 dark:text-green-300',
  }[tone];
  return (
    <div role={tone === 'error' ? 'alert' : 'status'} className={`rounded-md border p-3 text-sm ${styles}`}>
      {children}
    </div>
  );
}

function useSubmit() {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const run = (fn: () => Promise<void>) => {
    setError(null);
    startTransition(fn);
  };
  return { pending, error, setError, run };
}

const actionError = (result: ActionResult<unknown>) => (result.ok ? null : result.error);

const codeSchema = z.object({ code: codeField });

/** Step 2 of code flows: enter the 6-digit code. */
function CodeStep({
  email,
  onSubmitCode,
  onResend,
  pending,
  error,
  submitLabel,
}: {
  email: string;
  onSubmitCode: (code: string) => void;
  onResend: () => void;
  pending: boolean;
  error: string | null;
  submitLabel: string;
}) {
  const form = useForm<z.input<typeof codeSchema>, unknown, z.output<typeof codeSchema>>({
    resolver: zodResolver(codeSchema),
    defaultValues: { code: '' },
  });
  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit((v) => onSubmitCode(v.code))} className="grid gap-4" noValidate>
        <Notice>
          We sent a 6-digit code to <strong>{email}</strong>. It may take a minute to arrive.
        </Notice>
        {error && <Notice tone="error">{error}</Notice>}
        <TextField name="code" label="Code" kind="code" placeholder="123456" autoFocus />
        <SubmitButton pending={pending}>{submitLabel}</SubmitButton>
        <button type="button" onClick={onResend} disabled={pending} className="text-sm text-primary underline-offset-2 hover:underline">
          Didn&apos;t get it? Send a new code
        </button>
      </form>
    </Form>
  );
}

// --- sign in -------------------------------------------------------------------------

export function LoginForm() {
  const params = useSearchParams();
  const reason = params.get('reason');
  return (
    <div className="grid gap-4">
      {reason === 'expired' && <Notice>Your session expired. Please sign in again.</Notice>}
      {params.get('reset') === '1' && <Notice tone="success">Password updated. Sign in with your new password.</Notice>}
      <Tabs defaultValue="password">
        <TabsList className="mb-4 grid w-full grid-cols-2">
          <TabsTrigger value="password" className="h-9">With password</TabsTrigger>
          <TabsTrigger value="code" className="h-9">Email me a code</TabsTrigger>
        </TabsList>
        <TabsContent value="password">
          <PasswordLogin />
        </TabsContent>
        <TabsContent value="code">
          <CodeLogin />
        </TabsContent>
      </Tabs>
      <p className="text-center text-sm text-muted-foreground">
        New here?{' '}
        <Link href="/signup" className="font-medium text-primary underline-offset-2 hover:underline">
          Create your shop
        </Link>
      </p>
    </div>
  );
}

function PasswordLogin() {
  const router = useRouter();
  const callbackUrl = useCallbackUrl();
  const { pending, error, setError, run } = useSubmit();
  const form = useForm<z.input<typeof passwordLoginSchema>, unknown, z.output<typeof passwordLoginSchema>>({
    resolver: zodResolver(passwordLoginSchema),
    defaultValues: { email: '', password: '' },
  });
  const onSubmit = form.handleSubmit((values) =>
    run(async () => {
      const res = await signIn('password', { ...values, redirect: false });
      if (res?.error) {
        setError(SIGN_IN_ERRORS[res.code ?? 'invalid'] ?? SIGN_IN_ERRORS.invalid);
        return;
      }
      router.push(callbackUrl);
      router.refresh();
    }),
  );
  return (
    <Form {...form}>
      <form onSubmit={onSubmit} className="grid gap-4" noValidate>
        {error && <Notice tone="error">{error}</Notice>}
        <TextField name="email" label="Email" kind="email" />
        <TextField name="password" label="Password" kind="current-password" />
        <div className="-mt-2 text-right">
          <Link href="/forgot-password" className="text-sm text-primary underline-offset-2 hover:underline">
            Forgot password?
          </Link>
        </div>
        <SubmitButton pending={pending}>Sign in</SubmitButton>
      </form>
    </Form>
  );
}

function CodeLogin() {
  const router = useRouter();
  const callbackUrl = useCallbackUrl();
  const [email, setEmail] = useState<string | null>(null);
  const { pending, error, setError, run } = useSubmit();
  const form = useForm<z.input<typeof requestCodeSchema>, unknown, z.output<typeof requestCodeSchema>>({
    resolver: zodResolver(requestCodeSchema),
    defaultValues: { email: '' },
  });

  const sendCode = (address: string) =>
    run(async () => {
      const result = await requestLoginCodeAction({ email: address });
      const err = actionError(result);
      if (err) setError(err);
      else setEmail(address);
    });

  if (email) {
    return (
      <CodeStep
        email={email}
        pending={pending}
        error={error}
        submitLabel="Sign in"
        onResend={() => sendCode(email)}
        onSubmitCode={(code) =>
          run(async () => {
            const res = await signIn('email-code', { email, code, intent: 'login', redirect: false });
            if (res?.error) {
              setError(SIGN_IN_ERRORS[res.code ?? 'invalid'] ?? SIGN_IN_ERRORS.invalid);
              return;
            }
            router.push(callbackUrl);
            router.refresh();
          })
        }
      />
    );
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit((v) => sendCode(v.email))} className="grid gap-4" noValidate>
        {error && <Notice tone="error">{error}</Notice>}
        <TextField name="email" label="Email" kind="email" description="No password needed — we'll email you a 6-digit code." />
        <SubmitButton pending={pending}>Send code</SubmitButton>
      </form>
    </Form>
  );
}

// --- sign up -------------------------------------------------------------------------

export function SignupForm() {
  const router = useRouter();
  const [pendingSignup, setPendingSignup] = useState<z.input<typeof signupSchema> | null>(null);
  const { pending, error, setError, run } = useSubmit();
  const form = useForm<z.input<typeof signupSchema>, unknown, z.output<typeof signupSchema>>({
    resolver: zodResolver(signupSchema),
    defaultValues: { shopName: '', name: '', email: '', password: '' },
  });

  const request = (raw: z.input<typeof signupSchema>) =>
    run(async () => {
      const result = await requestSignupAction(raw);
      if (!result.ok) {
        for (const [field, messages] of Object.entries(result.fieldErrors ?? {})) {
          if (messages?.[0]) form.setError(field as keyof typeof raw, { message: messages[0] });
        }
        setError(result.error);
        return;
      }
      setPendingSignup(raw);
    });

  if (pendingSignup) {
    const email = signupSchema.shape.email.parse(pendingSignup.email);
    return (
      <div className="grid gap-4">
        <CodeStep
          email={email}
          pending={pending}
          error={error}
          submitLabel="Create my shop"
          onResend={() => request(pendingSignup)}
          onSubmitCode={(code) =>
            run(async () => {
              const res = await signIn('email-code', { email, code, intent: 'signup', redirect: false });
              if (res?.error) {
                setError(SIGN_IN_ERRORS[res.code ?? 'invalid'] ?? SIGN_IN_ERRORS.invalid);
                return;
              }
              router.push('/');
              router.refresh();
            })
          }
        />
        <button type="button" onClick={() => setPendingSignup(null)} className="text-sm text-muted-foreground underline-offset-2 hover:underline">
          Use a different email
        </button>
      </div>
    );
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(() => request(form.getValues()))} className="grid gap-4" noValidate>
        {error && <Notice tone="error">{error}</Notice>}
        <TextField name="shopName" label="Shop name" placeholder="e.g. Mama Njeri Dairy" autoFocus />
        <TextField name="name" label="Your name" />
        <TextField name="email" label="Email" kind="email" />
        <TextField name="password" label="Password" kind="password" description="At least 10 characters." />
        <SubmitButton pending={pending}>Continue</SubmitButton>
        <p className="text-center text-sm text-muted-foreground">
          Already have an account?{' '}
          <Link href="/login" className="font-medium text-primary underline-offset-2 hover:underline">
            Sign in
          </Link>
        </p>
      </form>
    </Form>
  );
}

// --- password reset ----------------------------------------------------------------------

export function ForgotPasswordForm() {
  const [sentTo, setSentTo] = useState<string | null>(null);
  const { pending, error, setError, run } = useSubmit();
  const form = useForm<z.input<typeof forgotPasswordSchema>, unknown, z.output<typeof forgotPasswordSchema>>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: { email: '' },
  });

  if (sentTo) {
    return (
      <div className="grid gap-4">
        <Notice tone="success">
          If an account exists for <strong>{sentTo}</strong>, we&apos;ve emailed a link to reset your password. It
          expires in 30 minutes.
        </Notice>
        <Link href="/login" className="text-center text-sm text-primary underline-offset-2 hover:underline">
          Back to sign in
        </Link>
      </div>
    );
  }

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit((v) =>
          run(async () => {
            const result = await requestPasswordResetAction(v);
            const err = actionError(result);
            if (err) setError(err);
            else setSentTo(v.email);
          }),
        )}
        className="grid gap-4"
        noValidate
      >
        {error && <Notice tone="error">{error}</Notice>}
        <TextField name="email" label="Email" kind="email" autoFocus />
        <SubmitButton pending={pending}>Email me a reset link</SubmitButton>
        <Link href="/login" className="text-center text-sm text-muted-foreground underline-offset-2 hover:underline">
          Back to sign in
        </Link>
      </form>
    </Form>
  );
}

export function ResetPasswordForm({ token }: { token: string }) {
  const router = useRouter();
  const { pending, error, setError, run } = useSubmit();
  const form = useForm<z.input<typeof resetPasswordSchema>, unknown, z.output<typeof resetPasswordSchema>>({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: { token, password: '', confirmPassword: '' },
  });
  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(() =>
          run(async () => {
            const result = await resetPasswordAction(form.getValues());
            const err = actionError(result);
            if (err) setError(err);
            else router.push('/login?reset=1');
          }),
        )}
        className="grid gap-4"
        noValidate
      >
        {error && <Notice tone="error">{error}</Notice>}
        <TextField name="password" label="New password" kind="password" description="At least 10 characters." autoFocus />
        <TextField name="confirmPassword" label="Confirm new password" kind="password" />
        <SubmitButton pending={pending}>Save password</SubmitButton>
      </form>
    </Form>
  );
}
