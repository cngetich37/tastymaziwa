'use client';

import type { ReactNode } from 'react';
import { useFormContext } from 'react-hook-form';
import { Loader2, type LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useHydrated } from '@/hooks/use-hydrated';
import { cn } from '@/lib/utils';

export { useHydrated };

interface BaseProps {
  name: string;
  label: string;
  description?: ReactNode;
}

type InputKind =
  | 'text'
  | 'money'
  | 'litres'
  | 'date'
  | 'tel'
  | 'email'
  | 'password'
  | 'current-password'
  | 'code';

const inputProps: Record<InputKind, React.InputHTMLAttributes<HTMLInputElement>> = {
  text: { type: 'text' },
  // type="text" + inputMode keeps exact decimal strings (type="number" can mangle them).
  money: { type: 'text', inputMode: 'decimal', autoComplete: 'off' },
  litres: { type: 'text', inputMode: 'decimal', autoComplete: 'off' },
  date: { type: 'date' },
  tel: { type: 'tel', inputMode: 'tel', autoComplete: 'tel' },
  email: { type: 'email', inputMode: 'email', autoComplete: 'email', autoCapitalize: 'none', spellCheck: false },
  password: { type: 'password', autoComplete: 'new-password' },
  'current-password': { type: 'password', autoComplete: 'current-password' },
  // one-time-code lets phones offer the code straight from the email notification.
  code: { type: 'text', inputMode: 'numeric', autoComplete: 'one-time-code', maxLength: 7 },
};

const suffixes: Partial<Record<InputKind, string>> = { money: 'KSh', litres: 'L' };

/** A one-tap value under an input, e.g. "1 L" or "Full balance". */
export interface Preset {
  label: string;
  value: string;
}

const chipClass = (selected: boolean) =>
  cn(
    'h-11 min-w-14 rounded-full border px-4 text-sm font-medium tabular-nums transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
    selected ? 'border-primary bg-primary/10 text-primary' : 'border-input bg-background hover:bg-muted',
  );

export function TextField({
  name,
  label,
  description,
  kind = 'text',
  placeholder,
  autoFocus,
  presets,
}: BaseProps & { kind?: InputKind; placeholder?: string; autoFocus?: boolean; presets?: Preset[] }) {
  const { control, setValue } = useFormContext();
  const suffix = suffixes[kind];
  return (
    <FormField
      control={control}
      name={name}
      render={({ field }) => (
        <FormItem>
          <FormLabel>{label}</FormLabel>
          <div className="relative">
            <FormControl>
              <Input
                {...inputProps[kind]}
                {...field}
                value={field.value ?? ''}
                placeholder={placeholder}
                autoFocus={autoFocus}
                className={cn('h-11 text-base', suffix && 'pr-12')}
              />
            </FormControl>
            {suffix && (
              <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-muted-foreground">
                {suffix}
              </span>
            )}
          </div>
          {presets && presets.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {presets.map((p) => (
                <button
                  key={p.value}
                  type="button"
                  className={chipClass(field.value === p.value)}
                  onClick={() => setValue(name, p.value, { shouldValidate: true, shouldDirty: true })}
                >
                  {p.label}
                </button>
              ))}
            </div>
          )}
          {description && <FormDescription>{description}</FormDescription>}
          <FormMessage />
        </FormItem>
      )}
    />
  );
}

export interface Option {
  value: string;
  label: string;
  icon?: LucideIcon;
}

export function SelectField({
  name,
  label,
  description,
  options,
  placeholder = 'Choose…',
}: BaseProps & { options: Option[]; placeholder?: string }) {
  const { control } = useFormContext();
  return (
    <FormField
      control={control}
      name={name}
      render={({ field }) => (
        <FormItem>
          <FormLabel>{label}</FormLabel>
          <Select onValueChange={field.onChange} value={field.value || undefined}>
            <FormControl>
              <SelectTrigger className="h-11 text-base">
                <SelectValue placeholder={placeholder} />
              </SelectTrigger>
            </FormControl>
            <SelectContent>
              {options.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {description && <FormDescription>{description}</FormDescription>}
          <FormMessage />
        </FormItem>
      )}
    />
  );
}

/** Large tap-target segmented choice (e.g. Cash / M-Pesa / Credit). */
export function ChoiceField({ name, label, options }: BaseProps & { options: Option[] }) {
  const { control } = useFormContext();
  return (
    <FormField
      control={control}
      name={name}
      render={({ field }) => (
        <FormItem>
          <FormLabel>{label}</FormLabel>
          <div role="radiogroup" aria-label={label} className="grid auto-cols-fr grid-flow-col gap-2">
            {options.map((o) => {
              const selected = field.value === o.value;
              return (
                <button
                  key={o.value}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => field.onChange(o.value)}
                  className={cn(
                    'flex min-h-11 items-center justify-center gap-2 rounded-lg border px-2 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
                    o.icon && 'min-h-14 flex-col gap-1',
                    selected
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'border-input bg-background hover:bg-muted',
                  )}
                >
                  {o.icon && <o.icon className="size-5" aria-hidden />}
                  {o.label}
                </button>
              );
            })}
          </div>
          <FormMessage />
        </FormItem>
      )}
    />
  );
}

/**
 * Disabled until hydrated: on a slow phone the server-rendered form is visible
 * before React attaches, and submitting then would send empty values (React
 * resets the controlled inputs when it hydrates).
 */
export function SubmitButton({ pending, children }: { pending: boolean; children: ReactNode }) {
  const hydrated = useHydrated();
  return (
    <Button type="submit" disabled={pending || !hydrated} className="h-11 w-full text-base">
      {pending ? (
        <>
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Saving…
        </>
      ) : (
        children
      )}
    </Button>
  );
}
