/**
 * Commands the native menu can send to the renderer (docs/04 §2.5). The renderer owns the keyboard
 * shortcuts (useShortcuts); menu accelerators are shown for discoverability but not registered, so a key
 * press never runs a command twice.
 */
export const MENU_COMMANDS = [
  'file.new',
  'file.open',
  'file.save',
  'file.saveAs',
  'file.exportAs',
  'file.quickExport',
  'file.revert',
  'edit.undo',
  'edit.redo',
  'view.zoomIn',
  'view.zoomOut',
  'view.fit',
  'view.actualSize',
] as const;
export type MenuCommandId = (typeof MENU_COMMANDS)[number];

export function isMenuCommand(id: unknown): id is MenuCommandId {
  return typeof id === 'string' && (MENU_COMMANDS as readonly string[]).includes(id);
}
