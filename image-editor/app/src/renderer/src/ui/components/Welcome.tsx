import { PRODUCT_NAME } from '@shared/constants';
import { Button } from './Button';
import { NewDocumentForm } from './NewDocumentForm';

type Props = { onNew: (w: number, h: number) => void; onOpen: () => void };

export function Welcome({ onNew, onOpen }: Props) {
  return (
    <div className="absolute inset-0 flex items-center justify-center">
      <div className="bg-ui-panel border-ui-border flex w-[420px] flex-col gap-4 rounded-lg border p-6 shadow-xl">
        <h1 className="text-lg font-semibold">{PRODUCT_NAME}</h1>
        <p className="text-ui-muted">
          Open an image or project, or create a new document. You can also drop a file here.
        </p>
        <Button variant="primary" onClick={onOpen} className="py-2">
          Open…
        </Button>
        <div className="border-ui-border flex flex-col gap-2 border-t pt-4">
          <span className="font-semibold">New document</span>
          <NewDocumentForm onCreate={onNew}>
            {(valid) => (
              <Button type="submit" disabled={!valid} className="bg-ui-raised self-start">
                Create
              </Button>
            )}
          </NewDocumentForm>
        </div>
      </div>
    </div>
  );
}
