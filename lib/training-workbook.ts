import ExcelJS from 'exceljs';

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
  theoryScore: number | null;
  practicalScore: number | null;
  score: number | null;
  result: string;
  reviewStatus: string;
  certificationId: string | null;
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
  INVITED: '未签到',
  PRESENT: '正常签到',
  LATE: '迟到',
  ABSENT: '缺席',
  LEAVE: '请假',
  PARTIAL: '部分出勤',
  NOT_INITIALIZED: '记录未初始化',
};

const resultText: Record<string, string> = { PENDING: '待考核', PASSED: '合格', FAILED: '不合格' };
const reviewText: Record<string, string> = { NOT_REQUIRED: '无需审核', PENDING: '待审核', APPROVED: '已审核', RETURNED: '已退回' };

export async function createTrainingWorkbook(input: {
  startDate: string;
  endDate: string;
  generatedAt: string;
  rows: readonly TrainingWorkbookRow[];
  sessionRows?: readonly TrainingSessionWorkbookRow[];
  feedbackRows?: readonly TrainingFeedbackWorkbookRow[];
  feedbackSummaries?: readonly TrainingFeedbackSummaryRow[];
}) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = '杭连电子协同平台';
  workbook.created = new Date();
  const sheet = workbook.addWorksheet('培训台账', { views: [{ state: 'frozen', ySplit: 5, xSplit: 2 }] });
  sheet.properties.defaultRowHeight = 22;
  sheet.mergeCells('A1:R1');
  const title = sheet.getCell('A1');
  title.value = '员工培训发展记录表';
  title.font = { name: '微软雅黑', size: 20, bold: true, color: { argb: 'FF14532D' } };
  title.alignment = { horizontal: 'center', vertical: 'middle' };
  sheet.getRow(1).height = 36;

  sheet.mergeCells('A2:D2');
  sheet.getCell('A2').value = `统计周期：${input.startDate} 至 ${input.endDate}`;
  sheet.mergeCells('E2:H2');
  sheet.getCell('E2').value = `记录数：${input.rows.length}`;
  sheet.mergeCells('I2:M2');
  sheet.getCell('I2').value = `参训员工：${new Set(input.rows.map(row => row.employeeNo)).size} 人`;
  sheet.mergeCells('N2:R2');
  sheet.getCell('N2').value = `导出时间：${input.generatedAt}`;
  for (const cell of ['A2', 'E2', 'I2', 'N2']) {
    sheet.getCell(cell).font = { name: '微软雅黑', size: 10, bold: true, color: { argb: 'FF334155' } };
    sheet.getCell(cell).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
    sheet.getCell(cell).alignment = { vertical: 'middle' };
  }
  sheet.getRow(2).height = 26;
  sheet.mergeCells('A3:R3');
  sheet.getCell('A3').value = '说明：每名参训员工一行；成绩、审核和技能证书均来自正式培训台账，空白表示该计划未要求或尚未录入。';
  sheet.getCell('A3').font = { name: '微软雅黑', size: 9, italic: true, color: { argb: 'FF64748B' } };
  sheet.getCell('A3').alignment = { vertical: 'middle' };

  const headers = ['序号', '计划编号', '培训计划', '课程', '开始时间', '结束时间', '部门', '班组', '岗位', '工号', '员工姓名', '签到状态', '实际学时', '理论成绩', '实操成绩', '综合成绩', '结果 / 审核', '技能证书'];
  sheet.getRow(5).values = headers;
  sheet.getRow(5).height = 30;
  sheet.getRow(5).eachCell(cell => {
    cell.font = { name: '微软雅黑', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF166534' } };
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    cell.border = { bottom: { style: 'thin', color: { argb: 'FF14532D' } } };
  });

  input.rows.forEach((item, index) => {
    const row = sheet.addRow([
      index + 1,
      item.planCode,
      item.planTitle,
      item.courseName,
      item.startAt,
      item.endAt,
      item.department || '',
      item.team || '',
      item.position || '',
      item.employeeNo,
      item.employeeName,
      attendanceText[item.attendanceStatus] || item.attendanceStatus,
      item.actualMinutes === null ? '' : item.actualMinutes / 60,
      item.theoryScore ?? '',
      item.practicalScore ?? '',
      item.score ?? '',
      `${resultText[item.result] || item.result} / ${reviewText[item.reviewStatus] || item.reviewStatus}`,
      item.certificationId ? '已同步' : '',
    ]);
    row.height = 26;
    row.eachCell((cell, column) => {
      cell.font = { name: '微软雅黑', size: 9.5, color: { argb: 'FF0F172A' } };
      cell.alignment = { vertical: 'middle', horizontal: [1, 10, 11, 12, 13, 14, 15, 16, 18].includes(column) ? 'center' : 'left', wrapText: true };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: index % 2 ? 'FFF8FAFC' : 'FFFFFFFF' } };
      cell.border = { bottom: { style: 'hair', color: { argb: 'FFE2E8F0' } } };
    });
    row.getCell(5).numFmt = 'yyyy-mm-dd hh:mm';
    row.getCell(6).numFmt = 'yyyy-mm-dd hh:mm';
    row.getCell(13).numFmt = '0.0"h"';
    const resultCell = row.getCell(17);
    if (item.result === 'FAILED' || item.reviewStatus === 'RETURNED') {
      resultCell.font = { name: '微软雅黑', size: 9.5, bold: true, color: { argb: 'FFDC2626' } };
      resultCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEE2E2' } };
    } else if (item.result === 'PASSED' && item.reviewStatus === 'APPROVED') {
      resultCell.font = { name: '微软雅黑', size: 9.5, bold: true, color: { argb: 'FF15803D' } };
      resultCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDCFCE7' } };
    }
  });

  const widths = [7, 19, 25, 20, 18, 18, 14, 14, 16, 12, 13, 13, 11, 11, 11, 11, 20, 12];
  widths.forEach((width, index) => { sheet.getColumn(index + 1).width = width; });
  sheet.autoFilter = { from: 'A5', to: `R${Math.max(5, input.rows.length + 5)}` };
  sheet.pageSetup = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9, margins: { left: 0.25, right: 0.25, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 } };
  sheet.headerFooter.oddFooter = '&L杭连电子协同平台&C第 &P / &N 页&R培训发展台账';

  const detailHeader = (target: ExcelJS.Worksheet, headers: string[]) => {
    target.getRow(1).values = headers;
    target.getRow(1).height = 30;
    target.getRow(1).eachCell(cell => {
      cell.font = { name: '微软雅黑', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFC2410C' } };
      cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    });
    target.autoFilter = { from: 'A1', to: `${target.getColumn(headers.length).letter}1` };
  };
  const detailBody = (target: ExcelJS.Worksheet) => {
    target.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return;
      row.height = 25;
      row.eachCell(cell => {
        cell.font = { name: '微软雅黑', size: 9.5, color: { argb: 'FF0F172A' } };
        cell.alignment = { vertical: 'middle', wrapText: true };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: rowNumber % 2 ? 'FFFFFFFF' : 'FFFFF8F3' } };
        cell.border = { bottom: { style: 'hair', color: { argb: 'FFE2E8F0' } } };
      });
    });
    target.pageSetup = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 };
    target.headerFooter.oddFooter = '&L杭连电子协同平台&C第 &P / &N 页&R培训发展明细';
  };

  const attendanceSheet = workbook.addWorksheet('课次签到明细', { views: [{ state: 'frozen', ySplit: 1, xSplit: 4 }] });
  detailHeader(attendanceSheet, ['序号', '计划编号', '培训计划', '课次', '课次名称', '课次开始', '课次结束', '地点', '部门', '班组', '工号', '员工姓名', '出勤状态', '签到时间', '签退时间', '来源', '人工修正原因']);
  (input.sessionRows || []).forEach((item, index) => attendanceSheet.addRow([
    index + 1,
    item.planCode,
    item.planTitle,
    item.sessionSequence,
    item.sessionName,
    item.sessionStartAt,
    item.sessionEndAt,
    item.location || '',
    item.department || '',
    item.team || '',
    item.employeeNo,
    item.employeeName,
    attendanceText[item.attendanceStatus] || item.attendanceStatus,
    item.checkInAt || '',
    item.checkOutAt || '',
    ({ SYSTEM_INVITE: '系统邀请', SYSTEM_FINALIZE: '课次结束自动结转', QR_SELF: '个人账号扫码', ADMIN_MANUAL: '负责人手工修正', LEGACY_MIGRATION: '历史数据迁移' } as Record<string, string>)[item.source || ''] || item.source || '',
    item.correctionReason || '',
  ]));
  [6, 7, 14, 15].forEach(column => { attendanceSheet.getColumn(column).numFmt = 'yyyy-mm-dd hh:mm'; });
  [7, 18, 25, 8, 22, 18, 18, 18, 14, 14, 12, 13, 14, 18, 18, 18, 30].forEach((width, index) => { attendanceSheet.getColumn(index + 1).width = width; });
  detailBody(attendanceSheet);

  const feedbackSheet = workbook.addWorksheet('课后反馈明细', { views: [{ state: 'frozen', ySplit: 1, xSplit: 4 }] });
  detailHeader(feedbackSheet, ['序号', '计划编号', '培训计划', '课次', '课次名称', '部门', '班组', '工号', '员工姓名', '整体', '内容', '讲师', '实用性', '改进标签', '改进建议', '需要跟进', '首次提交', '最后更新']);
  (input.feedbackRows || []).forEach((item, index) => feedbackSheet.addRow([
    index + 1,
    item.planCode,
    item.planTitle,
    item.sessionSequence,
    item.sessionName,
    item.department || '',
    item.team || '',
    item.employeeNo,
    item.employeeName,
    item.overallRating,
    item.contentRating,
    item.trainerRating,
    item.practicalValueRating,
    item.issueTags.join('、'),
    item.comment || '',
    item.followUpRequested ? '是' : '否',
    item.submittedAt,
    item.updatedAt,
  ]));
  [17, 18].forEach(column => { feedbackSheet.getColumn(column).numFmt = 'yyyy-mm-dd hh:mm'; });
  [7, 18, 25, 8, 22, 14, 14, 12, 13, 9, 9, 9, 9, 26, 38, 12, 18, 18].forEach((width, index) => { feedbackSheet.getColumn(index + 1).width = width; });
  detailBody(feedbackSheet);

  const summarySheet = workbook.addWorksheet('反馈汇总', { views: [{ state: 'frozen', ySplit: 1, xSplit: 3 }] });
  detailHeader(summarySheet, ['序号', '计划编号', '培训计划', '课次', '课次名称', '应到', '已到', '应反馈（已到）', '反馈数', '反馈率', '整体均分', '内容均分', '讲师均分', '实用性均分', '待跟进']);
  (input.feedbackSummaries || []).forEach((item, index) => summarySheet.addRow([
    index + 1,
    item.planCode,
    item.planTitle,
    item.sessionSequence,
    item.sessionName,
    item.participantCount,
    item.attendedCount,
    item.eligibleFeedbackCount,
    item.feedbackCount,
    item.feedbackRate / 100,
    item.averageOverallRating ?? '',
    item.averageContentRating ?? '',
    item.averageTrainerRating ?? '',
    item.averagePracticalValueRating ?? '',
    item.followUpCount,
  ]));
  summarySheet.getColumn(10).numFmt = '0.0%';
  [7, 18, 26, 8, 22, 10, 10, 15, 10, 12, 12, 12, 12, 14, 11].forEach((width, index) => { summarySheet.getColumn(index + 1).width = width; });
  detailBody(summarySheet);

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
