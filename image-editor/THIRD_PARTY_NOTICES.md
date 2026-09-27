# Third-Party Notices — ImageEditor

ImageEditor's own source code is MIT-licensed. Planned third-party components and their licenses are
listed below. Before release, this list is regenerated from the lockfile (`pnpm licenses:generate`) and
shown in About → Licenses.

| Component | Purpose | License | Notes |
| --- | --- | --- | --- |
| Electron / Chromium / Node.js | Runtime | MIT / BSD-3-Clause + others | `LICENSES.chromium.html` shipped by Electron |
| [sharp](https://sharp.pixelplumbing.com/) | Decode/encode, ICC conversion, batch | Apache-2.0 | Prebuilt binaries bundle **libvips (LGPL-3.0-or-later)** and its dependencies, dynamically linked. LGPL obligations: notice + ability to replace the library (it ships as a separate shared library in `node_modules/@img/sharp-libvips-*`). |
| [ag-psd](https://github.com/Agamnentzar/ag-psd) | PSD read/write | MIT | |
| [fflate](https://github.com/101arrowz/fflate) | `.iep` zip container | MIT | |
| [onnxruntime-web](https://onnxruntime.ai/) | On-device AI inference | MIT | |
| AI model (background removal / subject) | Segmentation | Must be MIT/Apache-2.0/BSD | See [ADR-0006](docs/adr/0006-on-device-ai-models.md). Non-commercial models (e.g. RMBG-1.4, CC BY-NC) are **excluded**. |
| React, Zustand, Radix UI, Tailwind CSS, Lucide | UI | MIT / ISC | |
| [utif2](https://github.com/photopea/UTIF.js) | TIFF fallback decode (if needed) | MIT | Only if sharp's TIFF path proves insufficient |
