'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  changePasswordAction,
  confirmEmailChangeAction,
  renameShopAction,
  requestEmailChangeAction,
  setUserActiveAction,
  updateProfileAction,
} from '@/app/actions';
import { Button } from '@/components/ui/button';
import { Form } from '@/components/ui/form';
import { toast } from '@/hooks/use-toast';
import { changePasswordSchema, codeField, profileSchema, requestEmailChangeSchema, shopSchema } from '@/lib/validation';
import { SubmitButton, TextField } from './fields';
import { useActionForm } from './use-action-form';

export function ProfileForm({ name }: { name: string }) {
  const { form, onSubmit, pending } = useActionForm(profileSchema, updateProfileAction, { name }, {
    success: 'Name updated',
    keepValues: true,
  });
  return (
    <Form {...form}>
      <form onSubmit={onSubmit} className="grid gap-4" noValidate>
        <TextField name="name" label="Your name" />
        <SubmitButton pending={pending}>Save</SubmitButton>
      </form>
    </Form>
  );
}

export function ShopNameForm({ name }: { name: string }) {
  const { form, onSubmit, pending } = useActionForm(shopSchema, renameShopAction, { name }, {
    success: 'Shop renamed',
    keepValues: true,
  });
  return (
    <Form {...form}>
      <form onSubmit={onSubmit} className="flex items-end gap-2" noValidate>
        <div className="flex-1">
          <TextField name="name" label="Shop name" />
        </div>
        <Button type="submit" disabled={pending} className="h-11">
          Save
        </Button>
      </form>
    </Form>
  );
}

export function ChangePasswordForm({ hasPassword }: { hasPassword: boolean }) {
  const { form, onSubmit, pending } = useActionForm(
    changePasswordSchema,
    changePasswordAction,
    { currentPassword: '', password: '', confirmPassword: '' },
    { success: hasPassword ? 'Password changed. Other devices were signed out.' : 'Password set' },
  );
  return (
    <Form {...form}>
      <form onSubmit={onSubmit} className="grid gap-4" noValidate>
        {hasPassword && <TextField name="currentPassword" label="Current password" kind="current-password" />}
        <TextField name="password" label="New password" kind="password" description="At least 10 characters." />
        <TextField name="confirmPassword" label="Confirm new password" kind="password" />
        <SubmitButton pending={pending}>{hasPassword ? 'Change password' : 'Set password'}</SubmitButton>
      </form>
    </Form>
  );
}

const codeOnly = z.object({ code: codeField });

/** Two steps: send a code to the new address, then confirm it. */
export function ChangeEmailForm({ currentEmail }: { currentEmail: string }) {
  const router = useRouter();
  const [newEmail, setNewEmail] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const emailForm = useForm<z.input<typeof requestEmailChangeSchema>, unknown, z.output<typeof requestEmailChangeSchema>>({
    resolver: zodResolver(requestEmailChangeSchema),
    defaultValues: { email: '' },
  });
  const codeForm = useForm<z.input<typeof codeOnly>, unknown, z.output<typeof codeOnly>>({
    resolver: zodResolver(codeOnly),
    defaultValues: { code: '' },
  });

  const fail = (error: string) => {
    toast({ variant: 'destructive', title: 'Not changed', description: error });
  };

  if (newEmail) {
    return (
      <Form {...codeForm}>
        <form
          noValidate
          className="grid gap-4"
          onSubmit={codeForm.handleSubmit(() =>
            startTransition(async () => {
              const result = await confirmEmailChangeAction({ email: newEmail, code: codeForm.getValues('code') });
              if (!result.ok) return fail(result.error);
              toast({ title: 'Email updated', description: `You now sign in with ${newEmail}.` });
              setNewEmail(null);
              codeForm.reset();
              router.refresh();
            }),
          )}
        >
          <p className="text-sm text-muted-foreground">
            Enter the code we sent to <strong className="text-foreground">{newEmail}</strong>.
          </p>
          <TextField name="code" label="Code" kind="code" autoFocus />
          <div className="flex gap-2">
            <Button type="button" variant="outline" className="h-11" onClick={() => setNewEmail(null)}>
              Cancel
            </Button>
            <div className="flex-1">
              <SubmitButton pending={pending}>Confirm new email</SubmitButton>
            </div>
          </div>
        </form>
      </Form>
    );
  }

  return (
    <Form {...emailForm}>
      <form
        noValidate
        className="grid gap-4"
        onSubmit={emailForm.handleSubmit((values) =>
          startTransition(async () => {
            const result = await requestEmailChangeAction(emailForm.getValues());
            if (!result.ok) return fail(result.error);
            setNewEmail(values.email);
          }),
        )}
      >
        <p className="text-sm text-muted-foreground">
          Currently <strong className="text-foreground">{currentEmail}</strong>
        </p>
        <TextField name="email" label="New email" kind="email" />
        <SubmitButton pending={pending}>Send confirmation code</SubmitButton>
      </form>
    </Form>
  );
}

export function UserActiveToggle({ userId, active, name }: { userId: string; active: boolean; name: string }) {
  const [pending, startTransition] = useTransition();
  return (
    <Button
      size="sm"
      variant="ghost"
      className={active ? 'h-8 px-2 text-xs text-red-600 dark:text-red-400' : 'h-8 px-2 text-xs'}
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          if (active && !confirm(`Deactivate ${name}? They'll be signed out and can't sign in again.`)) return;
          const result = await setUserActiveAction({ userId, active: !active });
          toast(
            result.ok
              ? { title: active ? `${name} deactivated` : `${name} reactivated` }
              : { variant: 'destructive', title: 'Not changed', description: result.error },
          );
        })
      }
    >
      {active ? 'Deactivate' : 'Reactivate'}
    </Button>
  );
}
