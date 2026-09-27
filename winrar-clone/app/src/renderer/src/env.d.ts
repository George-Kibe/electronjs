import type { WinrarCloneBridge } from '@shared/ipc-contract';

declare global {
  interface Window {
    api: WinrarCloneBridge;
  }
}
