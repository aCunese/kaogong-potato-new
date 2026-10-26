import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import fs from 'fs';

function deduplicateAssetsPlugin() {
  return {
    name: 'deduplicate-assets-plugin',
    closeBundle() {
      const distAssets = path.resolve(__dirname, 'dist/assets');
      if (fs.existsSync(distAssets)) {
        const unhashed = path.join(distAssets, 'potato-poses.png');
        const files = fs.readdirSync(distAssets);
        const hasHashed = files.some(f => f.startsWith('potato-poses-') && f.endsWith('.png'));
        if (hasHashed && fs.existsSync(unhashed)) {
          fs.unlinkSync(unhashed);
          console.log('[Build] Removed duplicate unhashed potato-poses.png from dist/assets');
        }
      }
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [react(), deduplicateAssetsPlugin()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5174,
    host: true,
    proxy: {
      '/api': 'http://127.0.0.1:3000',
      '/version.json': 'http://127.0.0.1:3000',
    },
  },
  preview: {
    port: 4174,
    host: true,
  },
});

