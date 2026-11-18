import { forwardRef, type InputHTMLAttributes, type ReactNode } from 'react';
import { cn } from '@/lib/cn';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }>(
  function Input({ className, invalid, ...props }, ref) {
    return (
      <input
        ref={ref}
        className={cn(
          'clip-cut h-11 w-full bg-surface-2 px-3.5 text-sm text-text placeholder:text-dim [--cut:7px]',
          'shadow-[inset_0_0_0_1px_var(--color-line)] transition focus:shadow-[inset_0_0_0_1.5px_var(--color-accent)] focus:outline-none',
          invalid && 'shadow-[inset_0_0_0_1.5px_var(--color-danger)]',
          className,
        )}
        aria-invalid={invalid || undefined}
        {...props}
      />
    );
  },
);

export function Field({
  label,
  hint,
  error,
  htmlFor,
  children,
  className,
}: {
  label?: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  htmlFor?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      {label && (
        <label htmlFor={htmlFor} className="text-xs font-semibold uppercase tracking-wider text-muted">
          {label}
        </label>
      )}
      {children}
      {error ? (
        <p className="text-xs text-danger" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className="text-xs text-dim">{hint}</p>
      ) : null}
    </div>
  );
}
