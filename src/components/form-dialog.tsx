'use client';

import { useState, type ComponentProps, type ReactNode } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

/**
 * On phones the dialog becomes a bottom sheet: it slides up from the bottom,
 * where thumbs reach, instead of floating mid-screen. Pure CSS, no extra JS.
 * The data-[state] overrides cancel the desktop zoom/slide-from-centre animation.
 */
const BOTTOM_SHEET =
  'max-h-[92dvh] overflow-y-auto sm:max-w-md ' +
  'max-sm:inset-x-0 max-sm:top-auto max-sm:bottom-0 max-sm:left-0 max-sm:max-w-none max-sm:translate-x-0 max-sm:translate-y-0 ' +
  'max-sm:rounded-t-2xl max-sm:border-x-0 max-sm:border-b-0 max-sm:px-4 max-sm:pt-3 max-sm:pb-[calc(1.25rem+env(safe-area-inset-bottom))] ' +
  'max-sm:data-[state=open]:[--tw-enter-translate-x:0] max-sm:data-[state=open]:[--tw-enter-scale:1] max-sm:data-[state=open]:[--tw-enter-translate-y:100%] ' +
  'max-sm:data-[state=closed]:[--tw-exit-translate-x:0] max-sm:data-[state=closed]:[--tw-exit-scale:1] max-sm:data-[state=closed]:[--tw-exit-translate-y:100%]';

/** DialogContent that is a centred dialog on desktop and a bottom sheet on phones. */
export function SheetDialogContent({ className, children, ...props }: ComponentProps<typeof DialogContent>) {
  return (
    <DialogContent aria-describedby={undefined} className={cn(BOTTOM_SHEET, className)} {...props}>
      <div aria-hidden className="mx-auto h-1.5 w-10 rounded-full bg-muted-foreground/30 sm:hidden" />
      {children}
    </DialogContent>
  );
}

/** A dialog whose form closes it on success via the `close` callback. */
export function FormDialog({
  trigger,
  title,
  description,
  children,
}: {
  trigger: ReactNode;
  title: string;
  description?: string;
  children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <SheetDialogContent>
        <DialogHeader className="text-left">
          <DialogTitle className="pr-8 text-xl">{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        {open && children(() => setOpen(false))}
      </SheetDialogContent>
    </Dialog>
  );
}
