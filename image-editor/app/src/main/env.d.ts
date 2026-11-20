/** Build-time values electron-vite injects into the main bundle (from MAIN_VITE_* environment variables). */
interface ImportMetaEnv {
  /** Sentry-compatible DSN for opt-in crash reports (FR-GEN-07, ADR-0009); unset in local builds. */
  readonly MAIN_VITE_CRASH_REPORT_DSN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
