
// Browser bundles do not provide Node's `process.env`. Bun exposes build-time
// variables through `import.meta.env` instead.
export const BACKEND_URL = import.meta.env.BACKEND_URL || "http://localhost:3001";
