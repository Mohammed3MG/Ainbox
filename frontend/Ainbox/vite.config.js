import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { fileURLToPath } from "url";
import tailwindcss from "@tailwindcss/vite";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    proxy: {
      // Proxy API requests to backend server
      '/emails': 'http://localhost:3002',
      '/gmail': 'http://localhost:3002',
      '/api': 'http://localhost:3002',
      '/auth': 'http://localhost:3002',
      '/sync': 'http://localhost:3002',
      '/webhooks': 'http://localhost:3002',
      '/ai': 'http://localhost:3002',
      '/compose': 'http://localhost:3002',
      '/reply': 'http://localhost:3002'
    }
  }
});