import type { QualityRecord } from './quality-data';
import type { FirstActivity } from './quality-first-types';

export type PaperArchiveType = 'FIRST' | 'PATROL';
export type PaperArchiveRecord = QualityRecord & { activity: FirstActivity };
export type PaperArchiveList = {
  items: PaperArchiveRecord[]; total: number; page: number;
  counts: { all: number; submitted: number; draft: number };
  uploaders: Array<{ id: string; name: string }>;
};
export const paperName = (type: PaperArchiveType) => type === 'FIRST' ? '首检报表' : '巡检报表';
