import type { ImageEditorBridge } from '@shared/ipc-contract';

declare global {
  interface Window {
    api: ImageEditorBridge;
  }
}
