'use client';

import { useTransition } from 'react';
import { Check, HandCoins, Loader2, Pencil, Plus, UserCheck, UserX } from 'lucide-react';
import { setAttendanceAction, setEmployeeActiveAction } from '@/app/actions';
import { FormDialog } from '@/components/form-dialog';
import {
  AdvanceForm,
  EditEmployeeForm,
  EmployeeForm,
  PostPayrollForm,
  type EmployeeDetails,
} from '@/components/forms/entry-forms';
import { Button } from '@/components/ui/button';
import { toast } from '@/hooks/use-toast';
import { formatKES } from '@/lib/money';
import { cn } from '@/lib/utils';

/** One tap marks someone present today; tap again to undo. */
export function AttendanceToggle({ employeeId, name, present }: { employeeId: string; name: string; present: boolean }) {
  const [pending, startTransition] = useTransition();
  return (
    <button
      type="button"
      role="switch"
      aria-checked={present}
      aria-label={`${name} present today`}
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const result = await setAttendanceAction({ employeeId, present: !present });
          if (!result.ok) toast({ variant: 'destructive', title: 'Not saved', description: result.error });
        })
      }
      className={cn(
        'flex h-11 w-full items-center justify-between gap-3 rounded-lg border px-3 text-left text-sm font-medium transition-colors',
        present ? 'border-primary bg-primary/10 text-foreground' : 'bg-card text-muted-foreground hover:bg-muted',
      )}
    >
      <span className="truncate">{name}</span>
      {pending ? (
        <Loader2 className="size-4 animate-spin" aria-hidden />
      ) : present ? (
        <span className="flex items-center gap-1 text-primary">
          <Check className="size-4" aria-hidden /> Present
        </span>
      ) : (
        <span>Mark present</span>
      )}
    </button>
  );
}

export function AddEmployeeButton() {
  return (
    <FormDialog
      trigger={
        <Button className="h-11 gap-2">
          <Plus className="size-4" aria-hidden /> Staff member
        </Button>
      }
      title="Add a staff member"
      description="Anyone you pay, with or without a login to the app."
    >
      {(close) => <EmployeeForm onDone={close} />}
    </FormDialog>
  );
}

export function EmployeeActions({ employee, active }: { employee: EmployeeDetails; active: boolean }) {
  const [pending, startTransition] = useTransition();
  return (
    <span className="inline-flex">
      {active && (
        <FormDialog
          trigger={
            <Button variant="ghost" size="icon" className="size-11" aria-label={`Give ${employee.name} an advance`} title="Advance">
              <HandCoins className="size-4" aria-hidden />
            </Button>
          }
          title={`Advance to ${employee.name}`}
          description="Paid out now and taken off their next pay."
        >
          {(close) => <AdvanceForm employeeId={employee.id} name={employee.name} onDone={close} />}
        </FormDialog>
      )}
      <FormDialog
        trigger={
          <Button variant="ghost" size="icon" className="size-11" aria-label={`Edit ${employee.name}`} title="Edit">
            <Pencil className="size-4" aria-hidden />
          </Button>
        }
        title={`Edit ${employee.name}`}
      >
        {(close) => <EditEmployeeForm employee={employee} onDone={close} />}
      </FormDialog>
      <Button
        variant="ghost"
        size="icon"
        className="size-11"
        disabled={pending}
        aria-label={active ? `${employee.name} has left` : `${employee.name} is back`}
        title={active ? 'Has left' : 'Back on the team'}
        onClick={() => {
          if (active && !confirm(`Mark ${employee.name} as having left? Their history stays.`)) return;
          startTransition(async () => {
            const result = await setEmployeeActiveAction({ employeeId: employee.id, active: !active });
            toast(
              result.ok
                ? { title: active ? `${employee.name} marked as left` : `${employee.name} is back on the team` }
                : { variant: 'destructive', title: 'Not changed', description: result.error },
            );
          });
        }}
      >
        {active ? <UserX className="size-4" aria-hidden /> : <UserCheck className="size-4" aria-hidden />}
      </Button>
    </span>
  );
}

export function PostPayrollButton({ month, monthLabel, netCents }: { month: string; monthLabel: string; netCents: number }) {
  return (
    <FormDialog
      trigger={<Button className="h-11 gap-2">Pay {formatKES(netCents)}</Button>}
      title={`Pay wages for ${monthLabel}`}
      description="This can only be done once per month."
    >
      {(close) => <PostPayrollForm month={month} netCents={netCents} onDone={close} />}
    </FormDialog>
  );
}
