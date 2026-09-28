/**
 * Unsaved-changes guard for one window (FR-DOC-11). Closing or quitting with unsaved changes is stopped
 * and handed to the renderer, which asks Save / Don't Save / Cancel and then calls `allowClose()`.
 */
export class CloseGuard {
  private edited = false;
  private allowed = false;
  private quitting = false;
  private quitAfterClose = false;

  constructor(
    private readonly askRenderer: () => void,
    private readonly actions: { close(): void; quit(): void },
  ) {}

  setEdited(edited: boolean): void {
    this.edited = edited;
  }

  get isEdited(): boolean {
    return this.edited;
  }

  /** app 'before-quit'. */
  onBeforeQuit(): void {
    this.quitting = true;
  }

  /** BrowserWindow 'close'. */
  onClose(event: { preventDefault(): void }): void {
    if (!this.edited || this.allowed) return;
    event.preventDefault();
    // Electron cancels the quit when a window refuses to close; remember it to resume after the prompt.
    this.quitAfterClose = this.quitting;
    this.quitting = false;
    this.askRenderer();
  }

  /** The user chose Save (and it succeeded) or Don't Save. */
  allowClose(): void {
    this.allowed = true;
    this.actions.close();
    if (this.quitAfterClose) this.actions.quit();
  }
}
