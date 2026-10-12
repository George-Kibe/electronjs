import { useState, type ReactNode } from 'react';
import { memoryBudgetBytes, type Settings, type SettingsPatch } from '@shared/settings';
import { Button } from './Button';
import { Modal } from './Modal';

type Props = {
  settings: Settings;
  totalMemoryBytes: number;
  onChange: (patch: SettingsPatch) => void;
  onClose: () => void;
};

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[150px_1fr] items-start gap-3 py-1.5">
      <span className="text-ui-muted pt-1">{label}</span>
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2">{children}</div>
        {hint && <p className="text-ui-muted text-[11px]">{hint}</p>}
      </div>
    </div>
  );
}

const selectClass = 'bg-ui-bg border-ui-border rounded border px-1.5 py-1';
const SECTIONS = ['General', 'Performance'] as const;
type Section = (typeof SECTIONS)[number];

/**
 * Preferences (FR-GEN-04, Ctrl+, / ⌘,). Changes apply and save immediately, so there is nothing to confirm;
 * "GPU off" takes effect at the next launch. Settings appear with the features that use them: autosave with
 * recovery, units with rulers and the scratch-space limit with disk history (M2).
 */
export function PreferencesDialog({ settings, totalMemoryBytes, onChange, onClose }: Props) {
  const [section, setSection] = useState<Section>('General');
  const { general, performance } = settings;
  const autoBudgetGB =
    memoryBudgetBytes(
      { ...settings, performance: { ...performance, memoryBudgetMB: null } },
      totalMemoryBytes,
    ) /
    1024 ** 3;
  return (
    <Modal
      title="Preferences"
      onCancel={onClose}
      width="w-[600px]"
      footer={
        <Button variant="primary" onClick={onClose}>
          Done
        </Button>
      }
    >
      <div className="flex gap-4">
        <div
          role="tablist"
          aria-orientation="vertical"
          aria-label="Preference sections"
          className="flex w-28 flex-col gap-0.5"
        >
          {SECTIONS.map((s) => (
            <button
              key={s}
              role="tab"
              aria-selected={section === s}
              onClick={() => setSection(s)}
              className={`rounded px-2 py-1 text-left ${section === s ? 'bg-ui-raised' : 'hover:bg-ui-raised/60'}`}
            >
              {s}
            </button>
          ))}
        </div>
        <div role="tabpanel" aria-label={section} className="min-h-64 flex-1">
          {section === 'General' && (
            <>
              <Row label="Theme">
                <select
                  aria-label="Theme"
                  value={general.theme}
                  onChange={(e) =>
                    onChange({ general: { theme: e.target.value as Settings['general']['theme'] } })
                  }
                  className={selectClass}
                >
                  <option value="system">Same as the system</option>
                  <option value="dark">Dark</option>
                  <option value="light">Light</option>
                </select>
              </Row>
              <Row label="Interface scale" hint="On top of your system's display scaling.">
                <select
                  aria-label="Interface scale"
                  value={general.interfaceScale}
                  onChange={(e) => onChange({ general: { interfaceScale: Number(e.target.value) } })}
                  className={selectClass}
                >
                  {[0.9, 1, 1.1, 1.25, 1.5].map((v) => (
                    <option key={v} value={v}>
                      {Math.round(v * 100)} %
                    </option>
                  ))}
                </select>
              </Row>
              <Row
                label="Canvas surround"
                hint="The neutral grey around the image never biases how you judge colour."
              >
                <select
                  aria-label="Canvas surround"
                  value={general.canvasColor ?? 'theme'}
                  onChange={(e) =>
                    onChange({ general: { canvasColor: e.target.value === 'theme' ? null : e.target.value } })
                  }
                  className={selectClass}
                >
                  <option value="theme">Follow the theme</option>
                  <option value="#1e1e1e">Black</option>
                  <option value="#3a3a3a">Dark grey</option>
                  <option value="#808080">Medium grey</option>
                  <option value="#c8c8ca">Light grey</option>
                </select>
              </Row>
              <Row label="Painting cursor">
                <select
                  aria-label="Painting cursor"
                  value={general.brushCursor}
                  onChange={(e) =>
                    onChange({
                      general: { brushCursor: e.target.value as Settings['general']['brushCursor'] },
                    })
                  }
                  className={selectClass}
                >
                  <option value="outline">Brush outline</option>
                  <option value="precise">Precise (crosshair)</option>
                </select>
              </Row>
            </>
          )}
          {section === 'Performance' && (
            <>
              <Row label="History steps" hint="20–1000. Older steps are dropped first; snapshots are kept.">
                <input
                  type="number"
                  aria-label="History steps"
                  min={20}
                  max={1000}
                  defaultValue={performance.historySteps}
                  onBlur={(e) => {
                    const v = Math.round(Number(e.target.value));
                    if (v >= 20 && v <= 1000) onChange({ performance: { historySteps: v } });
                    else e.target.value = String(performance.historySteps);
                  }}
                  className="bg-ui-bg border-ui-border w-24 rounded border px-1.5 py-1"
                />
              </Row>
              <Row
                label="Memory for history"
                hint={`Automatic uses ${autoBudgetGB.toFixed(1)} GB on this computer.`}
              >
                <select
                  aria-label="Memory for history"
                  value={performance.memoryBudgetMB ?? 'auto'}
                  onChange={(e) =>
                    onChange({
                      performance: {
                        memoryBudgetMB: e.target.value === 'auto' ? null : Number(e.target.value),
                      },
                    })
                  }
                  className={selectClass}
                >
                  <option value="auto">Automatic</option>
                  {[1024, 2048, 4096, 8192, 16384].map((mb) => (
                    <option key={mb} value={mb}>
                      {mb / 1024} GB
                    </option>
                  ))}
                </select>
              </Row>
              <Row
                label="Graphics acceleration"
                hint="Turn off if the canvas looks wrong or the app is unstable. Applies after a restart."
              >
                <select
                  aria-label="Graphics acceleration"
                  value={performance.gpu}
                  onChange={(e) =>
                    onChange({ performance: { gpu: e.target.value as Settings['performance']['gpu'] } })
                  }
                  className={selectClass}
                >
                  <option value="auto">On (recommended)</option>
                  <option value="off">Off (software)</option>
                </select>
              </Row>
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}
