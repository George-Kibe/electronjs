import { useEffect, useId, useRef, type ReactNode } from 'react';

type Props = {
  title: string;
  onCancel: () => void;
  children: ReactNode;
  footer: ReactNode;
  width?: string;
};

/** Modal dialog (docs/03 §7): labelled, focus moves in and returns on close, Escape cancels, Tab stays inside. */
export function Modal({ title, onCancel, children, footer, width = 'w-[420px]' }: Props) {
  const titleId = useId();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const node = ref.current;
    const focusables = () =>
      [
        ...(node?.querySelectorAll<HTMLElement>(
          'button, input, select, textarea, [tabindex]:not([tabindex="-1"])',
        ) ?? []),
      ].filter((el) => !el.hasAttribute('disabled'));
    (node?.querySelector<HTMLElement>('[data-autofocus]') ?? focusables()[0])?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onCancel();
      } else if (e.key === 'Tab') {
        const items = focusables();
        if (items.length === 0) return;
        const first = items[0]!;
        const last = items.at(-1)!;
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
      e.stopPropagation(); // editor shortcuts stay off while a dialog is open
    };
    node?.addEventListener('keydown', onKey);
    return () => {
      node?.removeEventListener('keydown', onKey);
      previous?.focus?.();
    };
  }, [onCancel]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={`bg-ui-panel border-ui-border flex max-h-[90vh] ${width} flex-col rounded-lg border shadow-2xl`}
      >
        <h2 id={titleId} className="border-ui-border border-b px-4 py-3 text-sm font-semibold">
          {title}
        </h2>
        <div className="min-h-0 flex-1 overflow-auto px-4 py-3">{children}</div>
        <div className="border-ui-border flex justify-end gap-2 border-t px-4 py-3">{footer}</div>
      </div>
    </div>
  );
}
