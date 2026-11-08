'use client';

import { useTransition } from 'react';
import { useForm, type DefaultValues, type FieldValues, type Path } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import type { z } from 'zod';
import { toast } from '@/hooks/use-toast';
import type { ActionResult } from '@/lib/action-result';

interface Options<T> {
  success: string | ((data: T) => string);
  onSuccess?: (data: T) => void;
  /** Keep the submitted values after success (edit forms) instead of clearing. */
  keepValues?: boolean;
}

/**
 * react-hook-form + Zod on the client for instant feedback, then the raw
 * string values go to the server action, which validates them again.
 */
export function useActionForm<S extends z.ZodType<FieldValues, FieldValues>, T>(
  schema: S,
  action: (raw: z.input<S>) => Promise<ActionResult<T>>,
  defaultValues: z.input<S>,
  options: Options<T>,
) {
  const form = useForm<z.input<S>, unknown, z.output<S>>({
    // Explicit type arguments select the zod 4 overload for a generic schema.
    resolver: zodResolver<FieldValues, unknown, FieldValues, S>(schema),
    defaultValues: defaultValues as DefaultValues<z.input<S>>,
  });
  const [pending, startTransition] = useTransition();

  const onSubmit = form.handleSubmit(() => {
    const raw = form.getValues();
    startTransition(async () => {
      const result = await action(raw);
      if (result.ok) {
        const message =
          typeof options.success === 'function' ? options.success(result.data) : options.success;
        toast({ title: message });
        form.reset(options.keepValues ? raw : defaultValues);
        options.onSuccess?.(result.data);
        return;
      }
      for (const [field, messages] of Object.entries(result.fieldErrors ?? {})) {
        if (messages?.[0]) form.setError(field as Path<z.input<S>>, { message: messages[0] });
      }
      toast({ variant: 'destructive', title: 'Not saved', description: result.error });
    });
  });

  return { form, onSubmit, pending };
}
