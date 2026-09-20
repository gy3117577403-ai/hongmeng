import { runPaperSmoke } from './smoke-quality-date-archive.mjs';
await runPaperSmoke('FIRST', process.env.QUALITY_FIRST_QA_OUTPUT || '.docker/first209-api-runtime.json');
