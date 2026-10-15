// The former web smoke command now runs the v3 multiplayer scenario from the
// API package directory, where its database environment is configured.
import {fileURLToPath} from 'node:url';
process.chdir(fileURLToPath(new URL('../../api/',import.meta.url)));
await import('../../api/scripts/v3-smoke.mjs');
