import { Button } from './Button';
import { Modal } from './Modal';

export type UnsavedChoice = 'save' | 'discard' | 'cancel';

/** "Save changes?" prompt before closing, opening another file, creating a new one or reverting (FR-DOC-11). */
export function UnsavedDialog({ name, onChoose }: { name: string; onChoose: (c: UnsavedChoice) => void }) {
  return (
    <Modal
      title="Save changes?"
      onCancel={() => onChoose('cancel')}
      footer={
        <>
          <Button onClick={() => onChoose('discard')} className="bg-ui-raised mr-auto">
            Don’t Save
          </Button>
          <Button onClick={() => onChoose('cancel')} className="bg-ui-raised">
            Cancel
          </Button>
          <Button variant="primary" onClick={() => onChoose('save')} data-autofocus>
            Save
          </Button>
        </>
      }
    >
      <p>Do you want to save the changes to “{name}”? Your changes will be lost if you don’t save them.</p>
    </Modal>
  );
}
