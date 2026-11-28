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
  'file.close',
  'app.preferences',
  'edit.undo',
  'edit.redo',
  'edit.copyMerged',
  'edit.pasteNewDocument',
  'layer.new',
  'layer.newGroup',
  'layer.duplicate',
  'layer.delete',
  'layer.group',
  'layer.ungroup',
  'layer.bringForward',
  'layer.sendBackward',
  'layer.mergeDown',
  'layer.mergeVisible',
  'layer.flatten',
  'layer.alignLeft',
  'layer.alignHCenter',
  'layer.alignRight',
  'layer.alignTop',
  'layer.alignVCenter',
  'layer.alignBottom',
  'image.imageSize',
  'image.canvasSize',
  'image.rotate180',
  'image.rotate90cw',
  'image.rotate90ccw',
  'image.rotateArbitrary',
  'image.flipHorizontal',
  'image.flipVertical',
  'view.zoomIn',
  'view.zoomOut',
  'view.fit',
  'view.actualSize',
  'view.pixelGrid',
  'window.moveTab',
  'window.layers',
  'window.swatches',
  'window.history',
  'window.essentials',
  'window.photography',
  'window.resetWorkspace',
] as const;
export type MenuCommandId = (typeof MENU_COMMANDS)[number];

export function isMenuCommand(id: unknown): id is MenuCommandId {
  return typeof id === 'string' && (MENU_COMMANDS as readonly string[]).includes(id);
}
