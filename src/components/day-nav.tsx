'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { addDays, type BusinessDate } from '@/lib/dates';

/** Step through a day page (Sales, Deliveries) one business day at a time. */
export function DayNav({ date, today, basePath }: { date: BusinessDate; today: BusinessDate; basePath: string }) {
  const router = useRouter();
  const href = (d: BusinessDate) => (d === today ? basePath : `${basePath}?date=${d}`);
  const isToday = date === today;

  return (
    <nav aria-label="Choose a day" className="flex items-center gap-2">
      <Button asChild variant="outline" size="icon" className="size-11 shrink-0">
        <Link href={href(addDays(date, -1))} aria-label="Previous day">
          <ChevronLeft className="size-5" aria-hidden />
        </Link>
      </Button>
      <input
        type="date"
        aria-label="Day"
        value={date}
        max={today}
        onChange={(e) => e.target.value && router.push(href(e.target.value))}
        className="h-11 min-w-0 flex-1 rounded-md border border-input bg-background px-3 text-base sm:max-w-48"
      />
      {isToday ? (
        <Button variant="outline" size="icon" className="size-11 shrink-0" disabled aria-label="Next day">
          <ChevronRight className="size-5" aria-hidden />
        </Button>
      ) : (
        <>
          <Button asChild variant="outline" size="icon" className="size-11 shrink-0">
            <Link href={href(addDays(date, 1))} aria-label="Next day">
              <ChevronRight className="size-5" aria-hidden />
            </Link>
          </Button>
          <Button asChild variant="ghost" className="h-11 shrink-0">
            <Link href={basePath}>Today</Link>
          </Button>
        </>
      )}
    </nav>
  );
}
