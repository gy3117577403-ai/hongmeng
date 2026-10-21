import { build } from 'esbuild';
await build({ entryPoints: ['scripts/knowledge-sheet-worker.ts'], bundle: true, platform: 'node', target: 'node20', outfile: 'ops/knowledge-sheet-worker.cjs' });
