import { Button } from './Button';
import { Modal } from './Modal';
import { NewDocumentForm } from './NewDocumentForm';

export function NewDocumentDialog({
  onCreate,
  onCancel,
}: {
  onCreate: (w: number, h: number) => void;
  onCancel: () => void;
}) {
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
      <NewDocumentForm onCreate={onCreate}>
        {(valid) => (
          <Button type="submit" variant="primary" disabled={!valid} className="self-end">
            Create
          </Button>
        )}
      </NewDocumentForm>
    </Modal>
  );
}
