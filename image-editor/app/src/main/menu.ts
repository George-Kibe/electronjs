import type { MenuItemConstructorOptions } from 'electron';
import { PRODUCT_NAME } from '@shared/constants';
import type { MenuCommandId } from '@shared/menu';

/**
 * Native application menu (docs/03 §3, docs/04 §2.5). Items forward a command id to the renderer.
 * Accelerators are shown but not registered (`registerAccelerator: false`): the renderer's keymap handles
 * the keys, so a shortcut never fires twice. Standard roles (quit, text editing, window) stay native.
 */
export function menuTemplate(
  platform: NodeJS.Platform,
  send: (id: MenuCommandId) => void,
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
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
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
      ],
    },
    {
      label: 'View',
      submenu: [
        cmd('Zoom In', 'view.zoomIn', 'CmdOrCtrl+='),
        cmd('Zoom Out', 'view.zoomOut', 'CmdOrCtrl+-'),
        cmd('Fit on Screen', 'view.fit', 'CmdOrCtrl+0'),
        cmd('100 %', 'view.actualSize', 'CmdOrCtrl+1'),
      ],
    },
    { role: 'windowMenu' },
  ];
}
