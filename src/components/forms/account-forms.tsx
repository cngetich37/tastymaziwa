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
  resendInviteAction,
  setUserActiveAction,
  setUserRoleAction,
  updateProfileAction,
} from '@/app/actions';
import { Loader2, MoreVertical } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
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

export interface TeamMember {
  id: string;
  name: string;
  role: 'owner' | 'attendant';
  active: boolean;
  invited: boolean;
}

/** Per-member actions for owners: role, resend invite, (de)activate. */
export function TeamMemberMenu({ member }: { member: TeamMember }) {
  const [pending, startTransition] = useTransition();

  const run = (fn: () => Promise<{ ok: true } | { ok: false; error: string }>, success: string) =>
    startTransition(async () => {
      const result = await fn();
      toast(result.ok ? { title: success } : { variant: 'destructive', title: 'Not changed', description: result.error });
    });

  const nextRole = member.role === 'owner' ? 'attendant' : 'owner';

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="h-9 w-9" disabled={pending} aria-label={`Actions for ${member.name}`}>
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <MoreVertical className="h-4 w-4" />}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="truncate">{member.name}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {member.active && (
          <DropdownMenuItem
            onSelect={() => {
              if (
                nextRole === 'owner' &&
                !confirm(`Make ${member.name} an owner? They'll see profit, reverse entries and manage the team.`)
              )
                return;
              run(
                () => setUserRoleAction({ userId: member.id, role: nextRole }),
                `${member.name} is now ${nextRole === 'owner' ? 'an owner' : 'an attendant'}`,
              );
            }}
          >
            {nextRole === 'owner' ? 'Make owner' : 'Make attendant'}
          </DropdownMenuItem>
        )}
        {member.active && member.invited && (
          <DropdownMenuItem
            onSelect={() => run(() => resendInviteAction({ userId: member.id }), `Invite sent again to ${member.name}`)}
          >
            Resend invite
          </DropdownMenuItem>
        )}
        <DropdownMenuItem
          className={member.active ? 'text-red-600 focus:text-red-600 dark:text-red-400' : undefined}
          onSelect={() => {
            if (member.active && !confirm(`Deactivate ${member.name}? They'll be signed out and can't sign in again.`)) return;
            run(
              () => setUserActiveAction({ userId: member.id, active: !member.active }),
              member.active ? `${member.name} deactivated` : `${member.name} reactivated`,
            );
          }}
        >
          {member.active ? 'Deactivate' : 'Reactivate'}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
