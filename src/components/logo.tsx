import { LOGO_SHAPES_SMALL, type LogoFill } from '@/lib/brand';
import { cn } from '@/lib/utils';

const fillClass: Record<LogoFill, string> = {
  milk: 'fill-brand-milk',
  blue: 'fill-brand',
  butter: 'fill-butter',
};
const strokeClass: Record<LogoFill, string> = {
  milk: 'stroke-brand-milk',
  blue: 'stroke-brand',
  butter: 'stroke-butter',
};

/** The churn mark. Fixed brand colours, so it looks the same in both themes. */
export function Logo({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" aria-hidden className={cn('h-8 w-8 shrink-0', className)}>
      <rect width="32" height="32" rx="8" className="fill-brand" />
      {LOGO_SHAPES_SMALL.map((s) =>
        s.stroke ? (
          <path key={s.d} d={s.d} fill="none" strokeWidth="1.6" strokeLinecap="round" className={strokeClass[s.fill]} />
        ) : (
          <path key={s.d} d={s.d} className={fillClass[s.fill]} />
        ),
      )}
    </svg>
  );
}
