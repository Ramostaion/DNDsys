// Default: development API. Use the same production origin when testing a running BAT.
export const apiBase = process.env.DND_E2E_API_URL || 'http://localhost:3001';
export const api = apiBase + '/api';
