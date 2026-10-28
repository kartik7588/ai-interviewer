
// Bun's browser dev server does not always define import.meta.env. Keep the
// production build override, while making local development safe by default.
const buildEnv = (import.meta as unknown as { env?: Record<string, string | undefined> }).env;
export const BACKEND_URL = buildEnv?.BACKEND_URL || "http://localhost:3001";
