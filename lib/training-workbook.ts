import ExcelJS from 'exceljs';
import { trainingExcelDate } from '@/lib/training-time';

export type TrainingWorkbookRow = {
  planCode: string;
  planTitle: string;
  courseName: string;
  startAt: Date;
  endAt: Date;
  employeeNo: string;
  employeeName: string;
  department: string | null;
  team: string | null;
  position: string | null;
  attendanceStatus: string;
  actualMinutes: number | null;
  assessmentMode?: string;
  theoryScore: number | null;
  practicalScore: number | null;
  score: number | null;
  result: string;
  reviewStatus: string;
  certificationId: string | null;
  planStatus?: string;
  trainerName?: string;
  note?: string | null;
};

export type TrainingSessionWorkbookRow = {
  planCode: string;
  planTitle: string;
  sessionSequence: number;
  sessionName: string;
  sessionStartAt: Date;
  sessionEndAt: Date;
  location: string | null;
  employeeNo: string;
  employeeName: string;
  department: string | null;
  team: string | null;
  attendanceStatus: string;
  checkInAt: Date | null;
  checkOutAt: Date | null;
  source: string | null;
  correctionReason: string | null;
};

export type TrainingFeedbackWorkbookRow = {
  planCode: string;
  planTitle: string;
  sessionSequence: number;
  sessionName: string;
  employeeNo: string;
  employeeName: string;
  department: string | null;
  team: string | null;
  overallRating: number;
  contentRating: number;
  trainerRating: number;
  practicalValueRating: number;
  issueTags: string[];
  comment: string | null;
  followUpRequested: boolean;
  submittedAt: Date;
  updatedAt: Date;
};

export type TrainingFeedbackSummaryRow = {
  planCode: string;
  planTitle: string;
  sessionSequence: number;
  sessionName: string;
  participantCount: number;
  attendedCount: number;
  eligibleFeedbackCount: number;
  feedbackCount: number;
  feedbackRate: number;
  averageOverallRating: number | null;
  averageContentRating: number | null;
  averageTrainerRating: number | null;
  averagePracticalValueRating: number | null;
  followUpCount: number;
};


const attendanceText: Record<string, string> = {
  INVITED: '未签到', PRESENT: '正常签到', LATE: '迟到', ABSENT: '缺席',
  LEAVE: '请假', PARTIAL: '部分出勤', NOT_INITIALIZED: '未初始化',
};
const reviewText: Record<string, string> = { NOT_REQUIRED: '无需审核', PENDING: '待审核', APPROVED: '已审核', RETURNED: '已退回' };

export function trainingWorkbookOutcome(item: TrainingWorkbookRow): string {
  if (item.planStatus !== 'COMPLETED') return item.planStatus === 'CANCELLED' ? '已取消' : '未完成';
  if (!['PRESENT', 'LATE'].includes(item.attendanceStatus)) return '未完成';
  if (item.assessmentMode === 'NONE') return item.reviewStatus === 'NOT_REQUIRED' ? '完成（无需考核）' : '待确认';
  if (item.reviewStatus !== 'APPROVED') return item.reviewStatus === 'RETURNED' ? '已退回' : '待审核';
  return item.result === 'PASSED' ? '合格' : item.result === 'FAILED' ? '不合格' : '待考核';
}

export async function createTrainingWorkbook(input: {
  startDate: string; endDate: string; generatedAt: string; rows: readonly TrainingWorkbookRow[];
  // Kept for source compatibility; the standard ledger never adds extra sheets.
  sessionRows?: readonly TrainingSessionWorkbookRow[];
  feedbackRows?: readonly TrainingFeedbackWorkbookRow[];
  feedbackSummaries?: readonly TrainingFeedbackSummaryRow[];
}) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = '杭连电子协同平台';
  workbook.created = new Date();
  workbook.subject = '北京时间；按培训计划开始日期筛选；一名员工参加一次培训一行';
  const sheet = workbook.addWorksheet('培训台账', { views: [{ state: 'frozen', ySplit: 1, xSplit: 3 }] });
  const headers = ['序号', '计划编号', '培训名称', '计划开始（北京时间）', '计划结束（北京时间）', '讲师', '部门', '工号', '员工姓名', '实际学时（小时）', '签到状态', '考核成绩', '培训结果', '审核状态', '备注'];
  sheet.addRow(headers);
  sheet.getRow(1).height = 30;
  sheet.getRow(1).eachCell(cell => {
    cell.font = { name: '微软雅黑', size: 11, bold: true, color: { argb: 'FF1E293B' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFEDD5' } };
    cell.alignment = { vertical: 'middle', wrapText: true };
    cell.border = { bottom: { style: 'thin', color: { argb: 'FFCBD5E1' } } };
  });
  input.rows.forEach((item, index) => {
    const row = sheet.addRow([
      index + 1, item.planCode, item.planTitle,
      trainingExcelDate(item.startAt), trainingExcelDate(item.endAt), item.trainerName || '',
      item.department || '', item.employeeNo, item.employeeName,
      item.actualMinutes === null ? null : item.actualMinutes / 60,
      attendanceText[item.attendanceStatus] || item.attendanceStatus,
      item.assessmentMode === 'NONE' ? '无需考核' : item.score,
      trainingWorkbookOutcome(item), reviewText[item.reviewStatus] || item.reviewStatus, item.note || '',
    ]);
    row.height = Math.min(90, Math.max(24, Math.ceil(Math.max(item.planTitle.length / 18, (item.note || '').length / 30)) * 18));
    row.eachCell({ includeEmpty: true }, cell => {
      cell.font = { name: '微软雅黑', size: 11, color: { argb: 'FF1E293B' } };
      cell.alignment = { vertical: 'middle', wrapText: true };
      cell.border = { bottom: { style: 'hair', color: { argb: 'FFE2E8F0' } } };
    });
  });
  [7, 29, 30, 24, 24, 12, 16, 15, 14, 16, 13, 13, 20, 13, 34].forEach((width, index) => { sheet.getColumn(index + 1).width = width; });
  [4, 5].forEach(column => { sheet.getColumn(column).numFmt = 'yyyy-mm-dd hh:mm'; });
  sheet.getColumn(8).numFmt = '@';
  sheet.getColumn(10).numFmt = '0.00';
  sheet.autoFilter = { from: 'A1', to: 'O' + Math.max(1, input.rows.length + 1) };
  sheet.pageSetup = { orientation: 'landscape', paperSize: 9, printTitlesRow: '1:1', fitToPage: true, fitToWidth: 1, fitToHeight: 0 };
  sheet.headerFooter.oddHeader = '&L培训台账&C' + input.startDate + ' 至 ' + input.endDate + '&R北京时间';
  sheet.headerFooter.oddFooter = '&L导出：' + input.generatedAt + '&C第 &P / &N 页';
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
