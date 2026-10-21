import { parentPort, workerData } from 'node:worker_threads';
import { parseKnowledgeWorkbook } from '../lib/knowledge-sheet-parser';
try { parentPort!.postMessage({ sheets: parseKnowledgeWorkbook(workerData) }); }
catch (error) { parentPort!.postMessage({ error: error instanceof Error ? error.message : '表格解析失败' }); }
