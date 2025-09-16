import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import fs from 'fs';

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
  ],
  server: {
    host: 'localhost',
    port: 5173,
    https: {
      key: fs.readFileSync('C:/Users/stefa/certs/key.pem'),  // private key
      cert: fs.readFileSync('C:/Users/stefa/certs/cert.pem'), // certificate
    },
    proxy: {
      '/api': {
        target: 'https://127.0.0.1:8000', // Django backend running over HTTPS
        changeOrigin: true,
        secure: false, // allow self-signed cert
      },
    },
  },
});
