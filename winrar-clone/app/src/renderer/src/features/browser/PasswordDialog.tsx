import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Button } from '../../components/ui/Button';

type Props = {
  archiveName: string;
  wrongPassword: boolean;
  busy: boolean;
  onSubmit: (password: string) => void;
  onCancel: () => void;
};

export function PasswordDialog({ archiveName, wrongPassword, busy, onSubmit, onCancel }: Props) {
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    input.current?.focus();
  }, [wrongPassword]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (password) onSubmit(password);
  };

  return (
    <div className="fixed inset-0 flex items-center justify-center bg-black/40" role="presentation">
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby="pw-title"
        onSubmit={submit}
        onKeyDown={(e) => e.key === 'Escape' && onCancel()}
        className="bg-panel border-border flex w-96 flex-col gap-3 rounded-lg border p-5 shadow-xl"
      >
        <h2 id="pw-title" className="font-semibold">
          Password required
        </h2>
        <p className="text-muted break-all">“{archiveName}” is encrypted. Enter its password to continue.</p>
        <label className="flex flex-col gap-1">
          <span>Password</span>
          <input
            ref={input}
            type={show ? 'text' : 'password'}
            value={password}
            autoComplete="off"
            onChange={(e) => setPassword(e.target.value)}
            aria-invalid={wrongPassword}
            aria-describedby={wrongPassword ? 'pw-error' : undefined}
            className="border-border bg-bg rounded-md border px-2 py-1.5"
          />
        </label>
        <label className="text-muted flex items-center gap-2">
          <input type="checkbox" checked={show} onChange={(e) => setShow(e.target.checked)} /> Show password
        </label>
        {wrongPassword && (
          <p id="pw-error" role="alert" className="text-danger">
            That password is incorrect. Try again.
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button onClick={onCancel}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={!password || busy}>
            {busy ? 'Opening…' : 'Open'}
          </Button>
        </div>
      </form>
    </div>
  );
}
