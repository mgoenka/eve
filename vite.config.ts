import path from 'path';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { mgKit } from './ui-kit/vite-plugin-mg.mjs';

// Preload the two latin fonts the planner's first screen paints with (kit
// DM Sans + Eve's Cormorant Garamond). The kit's own preload would add Syne,
// which only the pricing and city pages use.
function preloadFonts(): Plugin {
  const wanted = [/dm-sans-latin-wght-(?!italic)/, /cormorant-garamond-latin-wght-(normal|italic)/];
  return {
    name: 'eve-preload-fonts',
    enforce: 'post',
    transformIndexHtml(_html, ctx) {
      if (!ctx.bundle) return [];
      return Object.keys(ctx.bundle)
        .filter((f) => f.endsWith('.woff2') && wanted.some((r) => r.test(f)))
        .map((f) => ({
          tag: 'link',
          attrs: { rel: 'preload', href: `/${f}`, as: 'font', type: 'font/woff2', crossorigin: '' },
          injectTo: 'head' as const,
        }));
    },
  };
}

export default defineConfig({
  server: {
    port: 3000,
    host: '0.0.0.0',
    proxy: {
      '/api': {
        target: 'http://localhost:8080',
        changeOrigin: true,
      },
    },
  },
  plugins: [
    react(),
    tailwindcss(),
    // The synced vite-plugin-mg.d.mts doesn't declare `seo` yet (the .mjs reads it), hence the cast.
    mgKit({ preloadFonts: false, seo: { type: 'WebApplication', category: 'LifestyleApplication', play: 'com.mohitgoenka.eve' } } as Parameters<typeof mgKit>[0]),
    preloadFonts(),
  ],
  build: {
    rolldownOptions: {
      output: {
        manualChunks(id: string) {
          if (/node_modules\/(react|react-dom|scheduler)\//.test(id)) return 'vendor';
          if (id.includes('node_modules/lucide-react/')) return 'icons';
          return undefined;
        },
      },
    },
    chunkSizeWarningLimit: 600,
  },
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, '.'),
    },
  },
});
