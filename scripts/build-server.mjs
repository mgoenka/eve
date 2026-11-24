// Precompiles the TypeScript server into one ESM file (dist-server/server.mjs) so the
// container runs plain `node` instead of loading tsx and transpiling on every cold start.
// npm packages stay external (resolved from node_modules at runtime, as before).
//
// The bundle lives one directory below the sources, so each source file's
// `import.meta.url` (used to locate dist/ and other files) is rewritten to the original
// file's location: path lookups behave exactly as they did when tsx ran the sources.
import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outdir = path.join(root, 'dist-server');

const keepSourceLocation = {
  name: 'keep-source-location',
  setup(b) {
    b.onLoad({ filter: /\.[cm]?[jt]sx?$/ }, async (args) => {
      if (args.path.includes(`${path.sep}node_modules${path.sep}`)) return undefined;
      const src = await readFile(args.path, 'utf8');
      if (/import\.meta\.(dirname|filename)/.test(src)) {
        throw new Error(`${path.relative(root, args.path)}: use import.meta.url (import.meta.dirname/filename are not rewritten for the bundle)`);
      }
      if (!src.includes('import.meta.url')) return undefined;
      const rel = path.relative(outdir, args.path).split(path.sep).join('/');
      const ext = path.extname(args.path).slice(1).replace(/^[cm]/, '');
      return {
        contents: src.replaceAll('import.meta.url', `new URL(${JSON.stringify(rel)}, import.meta.url).href`),
        loader: ext,
      };
    });
  },
};

await build({
  entryPoints: [path.join(root, 'server.ts')],
  outfile: path.join(outdir, 'server.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  packages: 'external',
  tsconfig: path.join(root, 'tsconfig.json'),
  keepNames: true,
  logLevel: 'warning',
  plugins: [keepSourceLocation],
});
console.log('server bundled -> dist-server/server.mjs');
