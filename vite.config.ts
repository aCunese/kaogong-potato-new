import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import fs from 'fs';

function swPrecachePlugin() {
  return {
    name: 'sw-precache-plugin',
    closeBundle() {
      const distDir = path.resolve(__dirname, 'dist');
      const distAssets = path.resolve(distDir, 'assets');

      // 1. Deduplicate unhashed asset if hashed version exists
      if (fs.existsSync(distAssets)) {
        const unhashed = path.join(distAssets, 'potato-poses.png');
        const files = fs.readdirSync(distAssets);
        const hasHashed = files.some(f => f.startsWith('potato-poses-') && f.endsWith('.png'));
        if (hasHashed && fs.existsSync(unhashed)) {
          fs.unlinkSync(unhashed);
          console.log('[Build] Removed duplicate unhashed potato-poses.png from dist/assets');
        }
      }

      // 2. Scan all precacheable assets in dist
      const precacheSet = new Set<string>();
      precacheSet.add('/');
      precacheSet.add('/index.html');
      precacheSet.add('/manifest.json');
      precacheSet.add('/version.json');

      if (fs.existsSync(distAssets)) {
        const assetFiles = fs.readdirSync(distAssets);
        for (const file of assetFiles) {
          if (!file.endsWith('.map')) {
            precacheSet.add(`/assets/${file}`);
          }
        }
      }

      const precacheList = Array.from(precacheSet).sort();

      // 3. Write precache manifest
      const manifestPath = path.join(distDir, 'precache-manifest.json');
      fs.writeFileSync(
        manifestPath,
        JSON.stringify(
          {
            version: '1.0.1',
            build: '20261026.02',
            generatedAt: new Date().toISOString(),
            assetsCount: precacheList.length,
            resources: precacheList,
          },
          null,
          2
        ),
        'utf-8'
      );

      // 4. Update dist/sw.js with full precache resource list
      const distSwPath = path.join(distDir, 'sw.js');
      if (fs.existsSync(distSwPath)) {
        let swContent = fs.readFileSync(distSwPath, 'utf-8');
        const listJson = JSON.stringify(precacheList, null, 2);
        swContent = swContent.replace(
          /const PRECACHE_RESOURCES = \[[^\]]*\];/s,
          `const PRECACHE_RESOURCES = ${listJson};`
        );
        fs.writeFileSync(distSwPath, swContent, 'utf-8');
        console.log(`[Build] Injected ${precacheList.length} assets into dist/sw.js and dist/precache-manifest.json`);
      }
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [react(), swPrecachePlugin()],
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

