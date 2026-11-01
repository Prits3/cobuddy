import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { agentApi } from './server/api.ts';
import { Hub } from './server/hub.ts';

// The agent bridge only exists while CoBuddy runs on your own machine.
function agentBridge(): Plugin {
  const hub = new Hub();
  const attach = (server: { middlewares: { use: (handler: ReturnType<typeof agentApi>) => unknown }; httpServer: { on: (event: 'close', listener: () => void) => unknown } | null }) => {
    server.middlewares.use(agentApi(hub));
    server.httpServer?.on('close', () => hub.shutdown());
  };
  return {
    name: 'cobuddy-agent-bridge',
    configureServer: attach,
    configurePreviewServer: attach,
  };
}

export default defineConfig({
  plugins: [react(), agentBridge()],
  server: { host: '127.0.0.1' },
  preview: { host: '127.0.0.1' },
});
