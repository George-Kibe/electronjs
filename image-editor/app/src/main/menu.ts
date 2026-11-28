import type { MenuItemConstructorOptions } from 'electron';
import { PRODUCT_NAME } from '@shared/constants';
import type { MenuCommandId } from '@shared/menu';

/**
 * Native application menu (docs/03 §3, docs/04 §2.5). Items forward a command id to the renderer.
 * Accelerators are shown but not registered (`registerAccelerator: false`): the renderer's keymap handles
 * the keys, so a shortcut never fires twice. Standard roles (quit, text editing, window) stay native.
 */
/** File › Open Recent: entries (newest first) and the actions main performs for them. */
export type RecentMenu = {
  items: Array<{ id: string; label: string }>;
  open(id: string): void;
  clear(): void;
};

export function menuTemplate(
  platform: NodeJS.Platform,
  send: (id: MenuCommandId) => void,
  recent: RecentMenu = { items: [], open: () => undefined, clear: () => undefined },
): MenuItemConstructorOptions[] {
  const cmd = (label: string, id: MenuCommandId, accelerator?: string): MenuItemConstructorOptions => ({
    label,
    click: () => send(id),
    ...(accelerator ? { accelerator, registerAccelerator: false } : {}),
  });
  const mac = platform === 'darwin';
  return [
    ...(mac
      ? [
          {
            label: PRODUCT_NAME,
            submenu: [
              { role: 'about' },
              { type: 'separator' },
              cmd('Settings…', 'app.preferences', 'Cmd+,'),
              { type: 'separator' },
              { role: 'hide' },
              { role: 'hideOthers' },
              { role: 'unhide' },
              { type: 'separator' },
              { role: 'quit' },
            ],
          } as MenuItemConstructorOptions,
        ]
      : []),
    {
      label: 'File',
      submenu: [
        cmd('New…', 'file.new', 'CmdOrCtrl+N'),
        cmd('Open…', 'file.open', 'CmdOrCtrl+O'),
        {
          label: 'Open Recent',
          submenu: [
            ...recent.items.map((r): MenuItemConstructorOptions => ({
              label: r.label,
              click: () => recent.open(r.id),
            })),
            ...(recent.items.length ? [{ type: 'separator' } as MenuItemConstructorOptions] : []),
            { label: 'Clear Recent', enabled: recent.items.length > 0, click: () => recent.clear() },
          ],
        },
        { type: 'separator' },
        cmd('Save', 'file.save', 'CmdOrCtrl+S'),
        cmd('Save As…', 'file.saveAs', 'CmdOrCtrl+Shift+S'),
        cmd('Revert', 'file.revert'),
        { type: 'separator' },
        cmd('Export As…', 'file.exportAs', 'CmdOrCtrl+Alt+Shift+W'),
        cmd('Quick Export as PNG', 'file.quickExport', "CmdOrCtrl+Alt+Shift+'"),
        ...(mac
          ? []
          : [
              { type: 'separator' } as MenuItemConstructorOptions,
              { role: 'quit' } as MenuItemConstructorOptions,
            ]),
      ],
    },
    {
      label: 'Edit',
      submenu: [
        cmd('Undo', 'edit.undo', 'CmdOrCtrl+Z'),
        cmd('Redo', 'edit.redo', 'CmdOrCtrl+Shift+Z'),
        { type: 'separator' },
        // Text fields in dialogs need the native clipboard roles.
        // Native roles: text fields keep working, and on the canvas the renderer handles the DOM
        // copy/paste events (FR-DOC-12).
        { role: 'cut' },
        { role: 'copy' },
        cmd('Copy Merged', 'edit.copyMerged', 'CmdOrCtrl+Shift+C'),
        { role: 'paste' },
        cmd('Paste as New Document', 'edit.pasteNewDocument'),
        { role: 'selectAll' },
        ...(mac
          ? []
          : [
              { type: 'separator' } as MenuItemConstructorOptions,
              cmd('Preferences…', 'app.preferences', 'Ctrl+,'),
            ]),
      ],
    },
    {
      label: 'Image',
      submenu: [
        cmd('Image Size…', 'image.imageSize', 'CmdOrCtrl+Alt+I'),
        cmd('Canvas Size…', 'image.canvasSize', 'CmdOrCtrl+Alt+C'),
        {
          label: 'Image Rotation',
          submenu: [
            cmd('180°', 'image.rotate180'),
            cmd('90° Clockwise', 'image.rotate90cw'),
            cmd('90° Counter Clockwise', 'image.rotate90ccw'),
            cmd('Arbitrary…', 'image.rotateArbitrary'),
            { type: 'separator' },
            cmd('Flip Canvas Horizontal', 'image.flipHorizontal'),
            cmd('Flip Canvas Vertical', 'image.flipVertical'),
          ],
        },
      ],
    },
    {
      label: 'Layer',
      submenu: [
        cmd('New Layer', 'layer.new', 'CmdOrCtrl+Shift+N'),
        cmd('New Group', 'layer.newGroup'),
        cmd('Duplicate Layer', 'layer.duplicate', 'CmdOrCtrl+J'),
        cmd('Delete Layer', 'layer.delete'),
        { type: 'separator' },
        cmd('Group Layers', 'layer.group', 'CmdOrCtrl+G'),
        cmd('Ungroup Layers', 'layer.ungroup', 'CmdOrCtrl+Shift+G'),
        cmd('Bring Forward', 'layer.bringForward', 'CmdOrCtrl+]'),
        cmd('Send Backward', 'layer.sendBackward', 'CmdOrCtrl+['),
        { type: 'separator' },
        cmd('Merge Down', 'layer.mergeDown', 'CmdOrCtrl+E'),
        cmd('Merge Visible', 'layer.mergeVisible', 'CmdOrCtrl+Shift+E'),
        cmd('Flatten Image', 'layer.flatten'),
        { type: 'separator' },
        {
          label: 'Align to Canvas',
          submenu: [
            cmd('Left Edges', 'layer.alignLeft'),
            cmd('Horizontal Centers', 'layer.alignHCenter'),
            cmd('Right Edges', 'layer.alignRight'),
            { type: 'separator' },
            cmd('Top Edges', 'layer.alignTop'),
            cmd('Vertical Centers', 'layer.alignVCenter'),
            cmd('Bottom Edges', 'layer.alignBottom'),
          ],
        },
      ],
    },
    {
      label: 'View',
      submenu: [
        cmd('Zoom In', 'view.zoomIn', 'CmdOrCtrl+='),
        cmd('Zoom Out', 'view.zoomOut', 'CmdOrCtrl+-'),
        cmd('Fit on Screen', 'view.fit', 'CmdOrCtrl+0'),
        cmd('100 %', 'view.actualSize', 'CmdOrCtrl+1'),
        { type: 'separator' },
        cmd('Pixel Grid', 'view.pixelGrid'),
      ],
    },
    { role: 'windowMenu' },
  ];
}
