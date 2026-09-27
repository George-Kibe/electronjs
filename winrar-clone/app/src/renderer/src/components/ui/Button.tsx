import type { ButtonHTMLAttributes } from 'react';

type Props = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'ghost' };

const styles: Record<NonNullable<Props['variant']>, string> = {
  primary: 'bg-brand text-brand-contrast hover:opacity-90',
  secondary: 'bg-raised text-text border border-border hover:bg-border/60',
  ghost: 'text-text hover:bg-raised',
};

export function Button({ variant = 'secondary', className = '', type = 'button', ...rest }: Props) {
  return (
    <button
      type={type}
      className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[13px] font-medium disabled:opacity-50 ${styles[variant]} ${className}`}
      {...rest}
    />
  );
}
