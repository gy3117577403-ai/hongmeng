import { runPaperSmoke } from './smoke-quality-date-archive.mjs';
await runPaperSmoke('PATROL', process.env.QUALITY_PAPER_QA_OUTPUT || '.docker/patrol209-api-runtime.json');
