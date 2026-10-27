import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/vite';
export default defineConfig({
  root: 'apps/web',
  plugins: [react(), tailwind()],
  server: { host: '127.0.0.1', port: 5173, proxy: { '/api': 'http://127.0.0.1:3001' } },
  build: {
    outDir: '../../dist/web',
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
          data: ['@tanstack/react-query', '@tanstack/react-table'],
          validation: ['zod', 'react-hook-form', '@hookform/resolvers/zod'],
        },
      },
    },
  },
});
