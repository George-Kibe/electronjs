import type { ComponentProps } from 'react';
import { Button } from './Button';
import { Modal } from './Modal';
import { NewDocumentForm } from './NewDocumentForm';

type FormProps = Omit<ComponentProps<typeof NewDocumentForm>, 'children'>;

/** File › New (Ctrl+N): the same form as the Welcome screen, in a dialog (FR-DOC-01). */
export function NewDocumentDialog({ onCancel, ...form }: FormProps & { onCancel: () => void }) {
  return (
    <Modal
      title="New document"
      onCancel={onCancel}
      footer={
        <Button onClick={onCancel} className="bg-ui-raised">
          Cancel
        </Button>
      }
    >
      <NewDocumentForm {...form}>
        {(valid) => (
          <Button type="submit" variant="primary" disabled={!valid} className="self-end">
            Create
          </Button>
        )}
      </NewDocumentForm>
    </Modal>
  );
}
