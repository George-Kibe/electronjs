import type { WinrarCloneApi } from '@shared/ipc-contract';

declare global {
  interface Window {
    api: WinrarCloneApi;
  }
}
