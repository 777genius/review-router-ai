import {defineConfig} from 'vite';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../..');
const deps = path.resolve(here, '../node_modules');
export default defineConfig({
  root: here,
  publicDir: path.join(root, "apps/web/public"),
  plugins: [tailwindcss()],
  resolve: {
    alias: [
      {find: '@reviewrouter/ui', replacement: path.join(root, 'packages/ui/src/index.ts')},
      {find: 'next/navigation', replacement: path.join(here, 'router.ts')},
      ...['@base-ui/react','react-dom','react','lucide-react','clsx','tailwind-merge','tailwind-variants'].map(name => ({find: name, replacement: path.join(deps, name)})),
    ],
    dedupe: ['react','react-dom'],
  },
  server: {host: '127.0.0.1', port: 4777, strictPort: true, fs: {allow: [root]}},
});
