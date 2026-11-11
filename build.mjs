// Bundles the Stremio core worker and the front-end into web/dist (committed, so the TV box needs no Node).
import { build } from 'esbuild';
const common = { bundle: true, platform: 'browser', target: 'es2020', loader: { '.wasm': 'file' }, assetNames: '[name]', logLevel: 'warning', minify: !process.argv.includes('--dev') };
await build({ ...common, entryPoints: ['node_modules/@stremio/stremio-core-web/worker.js'], outfile: 'web/dist/core-worker.js', format: 'iife' });
const entries = { 'app': 'src/app.js' };
for (const [name, src] of Object.entries(entries)) {
  await build({ ...common, entryPoints: [src], outfile: `web/dist/${name}.js`, format: 'iife' });
}
console.log('built');
