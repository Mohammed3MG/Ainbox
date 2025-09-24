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
      // Proxy API requests to backend server running on port 3000
      '/emails': 'http://localhost:3000',
      '/gmail': 'http://localhost:3000',
      '/api': 'http://localhost:3000',
      '/auth': 'http://localhost:3000',
      '/sync': 'http://localhost:3000',
      '/webhooks': 'http://localhost:3000',
      '/ai': 'http://localhost:3000',
      '/compose': 'http://localhost:3000',
      '/reply': 'http://localhost:3000',
      '/outlook': 'http://localhost:3000',
      '/yahoo': 'http://localhost:3000',
      '/me': 'http://localhost:3000',
      '/google': 'http://localhost:3000'
    }
  }
});