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
              cmd('Check for Updates…', 'help.checkForUpdates'),
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
        cmd('Close', 'file.close', 'CmdOrCtrl+W'),
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
        cmd('Clear', 'edit.clear', 'Delete'),
        { type: 'separator' },
        cmd('Free Transform', 'edit.freeTransform', 'CmdOrCtrl+T'),
        {
          label: 'Transform',
          submenu: [
            cmd('Rotate 180°', 'edit.rotate180'),
            cmd('Rotate 90° Clockwise', 'edit.rotate90cw'),
            cmd('Rotate 90° Counter Clockwise', 'edit.rotate90ccw'),
            { type: 'separator' },
            cmd('Flip Horizontal', 'edit.flipHorizontal'),
            cmd('Flip Vertical', 'edit.flipVertical'),
          ],
        },
        // Hidden but active: Ctrl/⌘+A in text fields (macOS needs the role). On the canvas the renderer
        // handles the key and Select › All selects every pixel instead.
        { role: 'selectAll', visible: false },
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
        {
          label: 'Adjustments',
          submenu: [
            cmd('Brightness/Contrast…', 'image.adjust.brightness-contrast'),
            cmd('Levels…', 'image.adjust.levels', 'CmdOrCtrl+L'),
            cmd('Curves…', 'image.adjust.curves', 'CmdOrCtrl+M'),
            cmd('Exposure…', 'image.adjust.exposure'),
            { type: 'separator' },
            cmd('Vibrance…', 'image.adjust.vibrance'),
            cmd('Hue/Saturation…', 'image.adjust.hue-saturation', 'CmdOrCtrl+U'),
            cmd('Color Balance…', 'image.adjust.color-balance', 'CmdOrCtrl+B'),
            cmd('Black & White…', 'image.adjust.black-white', 'CmdOrCtrl+Alt+Shift+B'),
            cmd('Photo Filter…', 'image.adjust.photo-filter'),
            { type: 'separator' },
            cmd('Invert', 'image.adjust.invert', 'CmdOrCtrl+I'),
            cmd('Posterize…', 'image.adjust.posterize'),
            cmd('Threshold…', 'image.adjust.threshold'),
          ],
        },
        { type: 'separator' },
        cmd('Auto Tone', 'image.autoTone', 'CmdOrCtrl+Shift+L'),
        cmd('Auto Contrast', 'image.autoContrast', 'CmdOrCtrl+Alt+Shift+L'),
        cmd('Auto Color', 'image.autoColor', 'CmdOrCtrl+Shift+B'),
        { type: 'separator' },
        cmd('Image Size…', 'image.imageSize', 'CmdOrCtrl+Alt+I'),
        cmd('Canvas Size…', 'image.canvasSize', 'CmdOrCtrl+Alt+C'),
        cmd('Crop', 'image.cropToSelection'),
        cmd('Trim…', 'image.trim'),
        cmd('Reveal All', 'image.revealAll'),
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
        {
          label: 'New Adjustment Layer',
          submenu: [
            cmd('Brightness/Contrast', 'layer.adjustment.brightness-contrast'),
            cmd('Levels', 'layer.adjustment.levels'),
            cmd('Curves', 'layer.adjustment.curves'),
            cmd('Exposure', 'layer.adjustment.exposure'),
            { type: 'separator' },
            cmd('Vibrance', 'layer.adjustment.vibrance'),
            cmd('Hue/Saturation', 'layer.adjustment.hue-saturation'),
            cmd('Color Balance', 'layer.adjustment.color-balance'),
            cmd('Black & White', 'layer.adjustment.black-white'),
            cmd('Photo Filter', 'layer.adjustment.photo-filter'),
            { type: 'separator' },
            cmd('Invert', 'layer.adjustment.invert'),
            cmd('Posterize', 'layer.adjustment.posterize'),
            cmd('Threshold', 'layer.adjustment.threshold'),
          ],
        },
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
        cmd('Rasterize Type', 'layer.rasterizeType'),
        { type: 'separator' },
        cmd('Create Clipping Mask', 'layer.clip', 'CmdOrCtrl+Alt+G'),
        cmd('Release Clipping Mask', 'layer.unclip'),
        {
          label: 'Layer Mask',
          submenu: [
            cmd('Reveal All', 'layer.maskRevealAll'),
            cmd('Hide All', 'layer.maskHideAll'),
            cmd('Reveal Selection', 'layer.maskRevealSelection'),
            cmd('Hide Selection', 'layer.maskHideSelection'),
            { type: 'separator' },
            cmd('Delete', 'layer.maskDelete'),
            cmd('Apply', 'layer.maskApply'),
            { type: 'separator' },
            cmd('Disable / Enable', 'layer.maskToggle'),
            cmd('Unlink / Link', 'layer.maskLink'),
          ],
        },
        { type: 'separator' },
        {
          // One layer aligns to the canvas, several to each other (FR-LAY-08).
          label: 'Align',
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
        {
          label: 'Distribute',
          submenu: [
            cmd('Left Edges', 'layer.distributeLeft'),
            cmd('Horizontal Centers', 'layer.distributeHCenter'),
            cmd('Right Edges', 'layer.distributeRight'),
            { type: 'separator' },
            cmd('Top Edges', 'layer.distributeTop'),
            cmd('Vertical Centers', 'layer.distributeVCenter'),
            cmd('Bottom Edges', 'layer.distributeBottom'),
          ],
        },
      ],
    },
    {
      label: 'Select',
      submenu: [
        cmd('All', 'select.all', 'CmdOrCtrl+A'),
        cmd('Deselect', 'select.deselect', 'CmdOrCtrl+D'),
        cmd('Reselect', 'select.reselect', 'CmdOrCtrl+Shift+D'),
        cmd('Inverse', 'select.inverse', 'CmdOrCtrl+Shift+I'),
        { type: 'separator' },
        cmd('Color Range…', 'select.colorRange'),
        {
          label: 'Modify',
          submenu: [
            cmd('Border…', 'select.border'),
            cmd('Smooth…', 'select.smooth'),
            cmd('Expand…', 'select.expand'),
            cmd('Contract…', 'select.contract'),
            cmd('Feather…', 'select.feather', 'Shift+F6'),
          ],
        },
      ],
    },
    {
      label: 'Filter',
      submenu: [
        cmd('Last Filter', 'filter.last', 'CmdOrCtrl+Alt+F'),
        { type: 'separator' },
        {
          label: 'Blur',
          submenu: [
            cmd('Gaussian Blur…', 'filter.gaussian-blur'),
            cmd('Box Blur…', 'filter.box-blur'),
            cmd('Motion Blur…', 'filter.motion-blur'),
          ],
        },
        {
          label: 'Noise',
          submenu: [cmd('Add Noise…', 'filter.add-noise'), cmd('Reduce Noise…', 'filter.reduce-noise')],
        },
        { label: 'Pixelate', submenu: [cmd('Mosaic…', 'filter.mosaic')] },
        { label: 'Render', submenu: [cmd('Vignette…', 'filter.vignette')] },
        {
          label: 'Sharpen',
          submenu: [cmd('Sharpen', 'filter.sharpen'), cmd('Unsharp Mask…', 'filter.unsharp-mask')],
        },
        {
          label: 'Stylize',
          submenu: [cmd('Emboss…', 'filter.emboss'), cmd('Find Edges', 'filter.find-edges')],
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
        { type: 'separator' },
        cmd('Rulers', 'view.rulers', 'CmdOrCtrl+R'),
        cmd('Grid', 'view.grid', "CmdOrCtrl+'"),
        cmd('Guides', 'view.guides', 'CmdOrCtrl+;'),
        cmd('Snap', 'view.snap', 'CmdOrCtrl+Shift+;'),
        cmd('Lock Guides', 'view.lockGuides', 'CmdOrCtrl+Alt+;'),
        cmd('Clear Guides', 'view.clearGuides'),
        cmd('New Guide…', 'view.newGuide'),
      ],
    },
    // Not role 'windowMenu': its native "Close Window" would take Ctrl/⌘+W from File › Close (a tab).
    {
      label: 'Window',
      submenu: [
        cmd('Move Tab to New Window', 'window.moveTab'),
        { type: 'separator' },
        cmd('Layers', 'window.layers'),
        cmd('Swatches', 'window.swatches'),
        cmd('History', 'window.history'),
        cmd('Properties', 'window.properties'),
        cmd('Histogram', 'window.histogram'),
        cmd('Navigator', 'window.navigator'),
        { type: 'separator' },
        {
          label: 'Workspace',
          submenu: [
            cmd('Essentials', 'window.essentials'),
            cmd('Photography', 'window.photography'),
            { type: 'separator' },
            cmd('Reset Workspace', 'window.resetWorkspace'),
          ],
        },
        { type: 'separator' },
        // Without the role's Ctrl/⌘+M accelerator: that key is Image › Adjustments › Curves (as in Photoshop).
        { role: 'minimize', accelerator: 'CmdOrCtrl+Alt+M' },
        ...(mac
          ? ([{ role: 'zoom' }, { type: 'separator' }, { role: 'front' }] as MenuItemConstructorOptions[])
          : []),
      ],
    },
    // macOS keeps these in the app menu (above), as its apps do.
    ...(mac
      ? []
      : [
          {
            label: 'Help',
            submenu: [
              cmd('Check for Updates…', 'help.checkForUpdates'),
              { type: 'separator' },
              { role: 'about', label: `About ${PRODUCT_NAME}` },
            ],
          } as MenuItemConstructorOptions,
        ]),
  ];
}
