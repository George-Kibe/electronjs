# Architecture Decision Records: ImageEditor

Format and process: see [`0000-template.md`](0000-template.md) and the root [CONTRIBUTING.md](../../../CONTRIBUTING.md#architecture-changes).

| # | Title | Status |
| --- | --- | --- |
| [0001](0001-record-architecture-decisions.md) | Record architecture decisions | Accepted |
| [0002](0002-app-stack-electron-react.md) | Rebuild as Electron + electron-vite + React + TypeScript | Accepted |
| [0003](0003-tiled-document-webgl2-engine.md) | Sparse immutable tiles + WebGL2 compositor, CPU as source of truth | Accepted (to be validated by the M0 spike) |
| [0004](0004-colour-management-srgb-8bit.md) | 8-bit sRGB working space, ICC conversion on import, gamma-space blending | Accepted |
| [0005](0005-non-destructive-model-and-history.md) | Adjustment layers + masks; command history over immutable tiles with OPFS spill | Accepted |
| [0006](0006-on-device-ai-models.md) | On-device AI with onnxruntime-web and permissively licensed models | Proposed (model choice at M4) |
| [0007](0007-native-project-format-iep.md) | Native project format `.iep` (zip + JSON manifest + sparse tiles) | Accepted |
| [0008](0008-codec-host-utility-process.md) | Decode/encode with sharp in an isolated utilityProcess; PSD and zip in workers | Accepted |
