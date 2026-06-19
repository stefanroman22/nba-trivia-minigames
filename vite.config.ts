import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(),
            tailwindcss()
  ],
  server: {
    // The Django backend + its virtualenv live inside this repo; don't let the
    // dev server watch them (thousands of files → constant reloads).
    watch: {
      ignored: ['**/backend/**', '**/multiplayer_server/node_modules/**'],
    },
    proxy: {
      '/api': {
        target: 'http://localhost:8000',  // Point to your Django server
        changeOrigin: true,
        secure: false,
      },
    },
  },
})
