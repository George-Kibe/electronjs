import { useEffect, useRef, useState, type ReactNode } from 'react';
import { MAX_DOCUMENT_SIDE } from '@shared/constants';
import {
  defaultOptions,
  ExportFormat,
  FORMAT_INFO,
  type ExportOptions,
  type MetadataPolicy,
} from '@shared/export-options';
import type { Editor } from '../../engine/editor';
import { errorMessage } from '../../lib/api';
import { encodeExport } from '../../lib/files';
import { Button } from './Button';
import { Modal } from './Modal';

const MIME: Partial<Record<ExportFormat, string>> = {
  png: 'image/png',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  avif: 'image/avif',
  gif: 'image/gif',
  bmp: 'image/bmp',
};

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 ** 2).toFixed(2)} MB`;
}

const toHex = ([r, g, b]: readonly number[]) =>
  `#${[r, g, b].map((v) => v!.toString(16).padStart(2, '0')).join('')}`;
const fromHex = (hex: string): [number, number, number] =>
  [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex items-center justify-between gap-3 py-1">
      <span className="text-ui-muted">{label}</span>
      {children}
    </label>
  );
}

const field = 'bg-ui-bg border-ui-border rounded border px-1.5 py-1';

type Props = {
  editor: Editor;
  initial: ExportOptions;
  onExport: (options: ExportOptions) => void;
  onCancel: () => void;
};

/** Export As (FR-DOC-05, docs/03 §5.8): options, live size estimate and a before/after preview. */
export function ExportDialog({ editor, initial, onExport, onCancel }: Props) {
  const doc = editor.getSnapshot().doc!;
  const [options, setOptions] = useState<ExportOptions>(initial);
  /** The latest finished encode and the options it was made with (stale while options change). */
  const [estimate, setEstimate] = useState<{ bytes: number; url: string | null; for: ExportOptions } | null>(
    null,
  );
  const [problem, setProblem] = useState<{ message: string; for: ExportOptions } | null>(null);
  const [showBefore, setShowBefore] = useState(false);
  const [before, setBefore] = useState<string | null>(null);
  const seq = useRef(0);
  const urls = useRef<{ after: string | null; before: string | null }>({ after: null, before: null });
  const [constrain, setConstrain] = useState(true);
  const info = FORMAT_INFO[options.format];
  const set = (patch: Partial<ExportOptions>) => setOptions((o) => ({ ...o, ...patch }));

  // Debounced real encode: the size and the "after" preview are exactly what will be written.
  useEffect(() => {
    const id = ++seq.current;
    const timer = window.setTimeout(async () => {
      const snapshot = editor.getDocSnapshot();
      if (!snapshot) return;
      try {
        const bytes = await encodeExport(snapshot, editor.documentVersion, options);
        if (id !== seq.current) return;
        const mime = MIME[options.format];
        const url = mime ? URL.createObjectURL(new Blob([bytes as BlobPart], { type: mime })) : null;
        if (urls.current.after) URL.revokeObjectURL(urls.current.after);
        urls.current.after = url;
        setEstimate({ bytes: bytes.byteLength, url, for: options });
        setProblem(null);
      } catch (err) {
        if (id === seq.current) setProblem({ message: errorMessage(err), for: options });
      }
    }, 350);
    return () => window.clearTimeout(timer);
  }, [editor, options]);

  // "Before": lossless PNG at the same size, made once when first asked for.
  useEffect(() => {
    if (!showBefore || before) return;
    const snapshot = editor.getDocSnapshot();
    if (!snapshot) return;
    void encodeExport(snapshot, editor.documentVersion, {
      ...defaultOptions('png'),
      compressionLevel: 1,
      resize: options.resize,
      embedIcc: false,
      metadata: 'remove-all',
    }).then(
      (bytes) => {
        const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'image/png' }));
        urls.current.before = url;
        setBefore(url);
      },
      (err) => setProblem({ message: errorMessage(err), for: options }),
    );
  }, [showBefore, before, editor, options]);

  // Blob URLs are revoked when replaced and when the dialog closes.
  useEffect(() => {
    const u = urls.current;
    return () => {
      if (u.after) URL.revokeObjectURL(u.after);
      if (u.before) URL.revokeObjectURL(u.before);
    };
  }, []);

  const resize = options.resize ?? { width: doc.width, height: doc.height };
  const setResize = (w: number, h: number) =>
    set({ resize: w === doc.width && h === doc.height ? null : { width: w, height: h } });
  const validSize = [resize.width, resize.height].every(
    (v) => Number.isInteger(v) && v >= 1 && v <= MAX_DOCUMENT_SIDE,
  );
  const previewUrl = showBefore ? before : estimate?.url;

  return (
    <Modal
      title="Export As"
      width="w-[860px]"
      onCancel={onCancel}
      footer={
        <>
          <span className="text-ui-muted mr-auto self-center" role="status" aria-live="polite">
            {problem?.for === options ? (
              <span className="text-danger">{problem.message}</span>
            ) : estimate?.for !== options ? (
              'Estimating size…'
            ) : (
              `Estimated size: ${formatBytes(estimate.bytes)}`
            )}
          </span>
          <Button onClick={onCancel} className="bg-ui-raised">
            Cancel
          </Button>
          <Button variant="primary" disabled={!validSize} onClick={() => onExport(options)} data-autofocus>
            Export…
          </Button>
        </>
      }
    >
      <div className="flex gap-4">
        <div className="bg-ui-bg border-ui-border flex h-[420px] min-w-0 flex-1 flex-col rounded border">
          <div className="border-ui-border flex gap-1 border-b p-1" role="group" aria-label="Preview">
            <Button active={!showBefore} onClick={() => setShowBefore(false)}>
              After
            </Button>
            <Button active={showBefore} onClick={() => setShowBefore(true)}>
              Before
            </Button>
          </div>
          <div className="min-h-0 flex-1 overflow-auto">
            {previewUrl ? (
              <img
                src={previewUrl}
                alt={showBefore ? 'Original' : 'Exported result'}
                className="max-w-none [image-rendering:pixelated]"
              />
            ) : (
              <p className="text-ui-muted p-4">
                {!showBefore && estimate && !estimate.url
                  ? `No preview for ${info.label}.`
                  : 'Preparing preview…'}
              </p>
            )}
          </div>
        </div>

        <div className="flex w-64 flex-col">
          <Row label="Format">
            <select
              className={field}
              value={options.format}
              onChange={(e) => {
                const format = ExportFormat.parse(e.target.value);
                setOptions((o) => ({
                  ...defaultOptions(format),
                  resize: o.resize,
                  metadata: o.metadata,
                  matte: o.matte,
                }));
              }}
            >
              {ExportFormat.options.map((f) => (
                <option key={f} value={f}>
                  {FORMAT_INFO[f].label}
                </option>
              ))}
            </select>
          </Row>

          {(options.format === 'jpeg' ||
            options.format === 'avif' ||
            (options.format === 'webp' && !options.lossless)) && (
            <Row label={`Quality ${options.quality}`}>
              <input
                type="range"
                min={1}
                max={100}
                value={options.quality}
                aria-label="Quality"
                onChange={(e) => set({ quality: Number(e.target.value) })}
              />
            </Row>
          )}
          {options.format === 'webp' && (
            <Row label="Lossless">
              <input
                type="checkbox"
                checked={options.lossless}
                onChange={(e) => set({ lossless: e.target.checked })}
              />
            </Row>
          )}
          {options.format === 'jpeg' && (
            <>
              <Row label="Progressive">
                <input
                  type="checkbox"
                  checked={options.progressive}
                  onChange={(e) => set({ progressive: e.target.checked })}
                />
              </Row>
              <Row label="Chroma">
                <select
                  className={field}
                  value={options.chroma}
                  onChange={(e) => set({ chroma: e.target.value as ExportOptions['chroma'] })}
                >
                  <option value="auto">Automatic</option>
                  <option value="4:2:0">4:2:0 (smaller)</option>
                  <option value="4:4:4">4:4:4 (sharper colour)</option>
                </select>
              </Row>
            </>
          )}
          {options.format === 'png' && (
            <>
              <Row label={`Compression ${options.compressionLevel}`}>
                <input
                  type="range"
                  min={0}
                  max={9}
                  value={options.compressionLevel}
                  aria-label="Compression level"
                  onChange={(e) => set({ compressionLevel: Number(e.target.value) })}
                />
              </Row>
              <Row label="Reduce colours (palette)">
                <input
                  type="checkbox"
                  checked={options.palette}
                  onChange={(e) => set({ palette: e.target.checked })}
                />
              </Row>
            </>
          )}
          {((options.format === 'png' && options.palette) || options.format === 'gif') && (
            <Row label="Colours">
              <input
                type="number"
                min={2}
                max={256}
                className={`${field} w-20`}
                value={options.colours}
                onChange={(e) => set({ colours: Math.min(256, Math.max(2, Number(e.target.value) || 2)) })}
              />
            </Row>
          )}
          {options.format === 'bmp' && (
            <Row label="Bit depth">
              <select
                className={field}
                value={options.bmpBits}
                onChange={(e) => set({ bmpBits: Number(e.target.value) === 32 ? 32 : 24 })}
              >
                <option value={24}>24-bit</option>
                <option value={32}>32-bit (with transparency)</option>
              </select>
            </Row>
          )}
          {(options.format === 'jpeg' || (options.format === 'bmp' && options.bmpBits === 24)) && (
            <Row label="Transparent areas">
              <input
                type="color"
                aria-label="Matte colour"
                value={toHex(options.matte)}
                onChange={(e) => set({ matte: fromHex(e.target.value) })}
              />
            </Row>
          )}

          <fieldset className="border-ui-border mt-2 border-t pt-2">
            <legend className="text-ui-muted px-1">Image size</legend>
            <div className="flex items-center gap-1">
              {(['width', 'height'] as const).map((side) => (
                <input
                  key={side}
                  type="number"
                  min={1}
                  max={MAX_DOCUMENT_SIDE}
                  aria-label={side === 'width' ? 'Export width' : 'Export height'}
                  className={`${field} w-20`}
                  value={resize[side]}
                  onChange={(e) => {
                    const v = Math.round(Number(e.target.value));
                    if (!constrain)
                      return setResize(
                        side === 'width' ? v : resize.width,
                        side === 'height' ? v : resize.height,
                      );
                    const ratio = doc.width / doc.height;
                    const w = side === 'width' ? v : Math.max(1, Math.round(v * ratio));
                    const h = side === 'height' ? v : Math.max(1, Math.round(v / ratio));
                    setResize(w, h);
                  }}
                />
              ))}
              <span className="text-ui-muted">px</span>
            </div>
            <label className="mt-1 flex items-center gap-2">
              <input type="checkbox" checked={constrain} onChange={(e) => setConstrain(e.target.checked)} />
              <span className="text-ui-muted">Keep proportions</span>
            </label>
          </fieldset>

          <fieldset className="border-ui-border mt-2 border-t pt-2">
            <legend className="text-ui-muted px-1">Metadata</legend>
            {info.metadata ? (
              <select
                className={`${field} w-full`}
                aria-label="Metadata"
                value={options.metadata}
                onChange={(e) => set({ metadata: e.target.value as MetadataPolicy })}
              >
                <option value="remove-gps">Remove location (GPS)</option>
                <option value="keep">Keep metadata</option>
                <option value="remove-all">Remove all</option>
              </select>
            ) : (
              <p className="text-ui-muted">{info.label} files are exported without camera metadata.</p>
            )}
            {info.icc && (
              <label className="mt-1 flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={options.embedIcc}
                  onChange={(e) => set({ embedIcc: e.target.checked })}
                />
                <span className="text-ui-muted">Embed sRGB colour profile</span>
              </label>
            )}
          </fieldset>
        </div>
      </div>
    </Modal>
  );
}
