import type { ButtonHTMLAttributes } from 'react';

type Props = ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean; variant?: 'primary' | 'plain' };

export function Button({
  active = false,
  variant = 'plain',
  className = '',
  type = 'button',
  ...rest
}: Props) {
  const base = 'inline-flex items-center justify-center gap-1 rounded px-2 py-1 disabled:opacity-40';
  const look =
    variant === 'primary'
      ? 'bg-brand text-white hover:opacity-90'
      : active
        ? 'bg-ui-raised text-ui-text ring-1 ring-brand'
        : 'text-ui-text hover:bg-ui-raised';
  return <button type={type} className={`${base} ${look} ${className}`} {...rest} />;
}
