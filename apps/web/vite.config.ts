import { defineConfig, loadEnv } from 'vite';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, fileURLToPath(new URL('../api', import.meta.url)), 'WEB_');
  const origin = new URL(process.env.DND_WEB_ORIGIN || env.WEB_ORIGIN || 'http://localhost:5242');
  const port = Number(process.env.DND_WEB_PORT || env.WEB_PORT || origin.port || 5242);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('WEB_PORT 必须是有效端口');
  return {
    plugins: [react(), tailwindcss()],
    server: {
      host: '0.0.0.0',
      port,
      strictPort: true,
      allowedHosts: [origin.hostname],
      proxy: {
        '/api': 'http://localhost:3001',
        '/uploads': 'http://localhost:3001',
        '/socket.io': { target: 'http://localhost:3001', ws: true },
      },
    },
  };
});
