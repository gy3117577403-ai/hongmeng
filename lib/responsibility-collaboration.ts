export type ResponsibilityDepartmentId =
  | 'management'
  | 'production'
  | 'quality'
  | 'planning-process'
  | 'technology-commerce'
  | 'warehouse'
  | 'procurement'
  | 'people-operations'
  | 'sales';

export type ResponsibilityPersonStatus = 'active' | 'unconfigured';
export type ResponsibilityRuleState = 'healthy' | 'attention' | 'overdue' | 'conflict' | 'unassigned';
export type ResponsibilityWarningKind = 'missing-owner' | 'responsibility-conflict' | 'overdue';
export type WorkRelation = 'owned' | 'review' | 'assist' | 'informed';
export type WorkPriority = 'urgent' | 'high' | 'normal';
export type WorkState = 'pending' | 'processing' | 'waiting' | 'done';
export type WorkDateScope = 'today' | 'tomorrow' | 'week';

export type ResponsibilityDepartment = {
  id: ResponsibilityDepartmentId;
  label: string;
  shortLabel: string;
  order: number;
};

export type ResponsibilityPermissionPreview = {
  module: string;
  scope: string;
  mode: '查看' | '维护' | '审核';
};

export type ResponsibilityPerson = {
  id: string;
  name: string;
  role: string;
  departmentId: ResponsibilityDepartmentId;
  initials: string;
  status: ResponsibilityPersonStatus;
  summary: string;
  coreResponsibilities: string[];
  managedModules: string[];
  collaboratorIds: string[];
  reviewerIds: string[];
  escalationIds: string[];
  checklist: string[];
  flowNames: string[];
  permissions: ResponsibilityPermissionPreview[];
};

export type ResponsibilityFlowStep = {
  label: string;
  personIds: string[];
  state: 'done' | 'current' | 'next';
};

export type ResponsibilityMatrixItem = {
  id: string;
  matter: string;
  description: string;
  module: string;
  departmentId: ResponsibilityDepartmentId;
  roleKeyword: string;
  ownerIds: string[];
  collaboratorIds: string[];
  reviewerIds: string[];
  informedIds: string[];
  dueLabel: string;
  state: ResponsibilityRuleState;
  warning?: ResponsibilityWarningKind;
  warningText?: string;
  ownerPlaceholder?: string;
  triggerCondition: string;
  escalationRule: string;
  changeLog: Array<{
    at: string;
    actorId: string;
    action: string;
  }>;
  route: string;
  flow: ResponsibilityFlowStep[];
};

export type ResponsibilityWorkItem = {
  id: string;
  title: string;
  source: string;
  module: string;
  relation: WorkRelation;
  priority: WorkPriority;
  dueLabel: string;
  dateScope: WorkDateScope;
  state: WorkState;
  stateLabel: string;
  ownerId: string;
  participantIds: string[];
  nextPersonId: string;
  route: string;
  progress: number;
};

export type ResponsibilityCollaborationSnapshot = {
  contractVersion: 'responsibility-collaboration.v1';
  source: 'prototype';
  departments: ResponsibilityDepartment[];
  people: ResponsibilityPerson[];
  matrix: ResponsibilityMatrixItem[];
  workItems: ResponsibilityWorkItem[];
  permissionPreviewOnly: true;
};

export type ResponsibilityCollaborationContext = {
  accountId?: string;
  employeeId?: string;
  date?: string;
};

export interface ResponsibilityCollaborationDataSource {
  loadSnapshot(context?: ResponsibilityCollaborationContext): Promise<ResponsibilityCollaborationSnapshot>;
}

export const responsibilityDepartments: ResponsibilityDepartment[] = [
  { id: 'management', label: '经营管理', shortLabel: '管理', order: 1 },
  { id: 'production', label: '生产车间', shortLabel: '生产', order: 2 },
  { id: 'quality', label: '质量管理', shortLabel: '质量', order: 3 },
  { id: 'planning-process', label: '计划与工艺', shortLabel: '计划工艺', order: 4 },
  { id: 'technology-commerce', label: '技术与商务', shortLabel: '技术商务', order: 5 },
  { id: 'warehouse', label: '仓库', shortLabel: '仓库', order: 6 },
  { id: 'procurement', label: '采购', shortLabel: '采购', order: 7 },
  { id: 'people-operations', label: '人事 / 组织支持', shortLabel: '人事', order: 8 },
  { id: 'sales', label: '销售协同', shortLabel: '销售', order: 9 },
];

export const responsibilityPeople: ResponsibilityPerson[] = [
  {
    id: 'wei-lin', name: '韦林', role: '总经理', departmentId: 'management', initials: '韦', status: 'active',
    summary: '负责跨部门资源协调、重大风险决策与经营目标确认。',
    coreResponsibilities: ['确认跨部门优先级与资源投入', '审批重大质量、交付与采购风险', '处理无法在部门内闭环的升级事项'],
    managedModules: ['职责配置', '流程中心', '报表中心', '问题管理'],
    collaboratorIds: ['lin-bo', 'deng-bin', 'zhang-hao', 'wang-hong-li', 'wang-wei-hong', 'pan-dan-dan', 'li-qin'],
    reviewerIds: [], escalationIds: [],
    checklist: ['确认本周关键交付', '审阅重大质量升级', '协调跨部门资源冲突'],
    flowNames: ['重大质量决策', '交付风险升级', '跨部门资源协调'],
    permissions: [
      { module: '全局协同', scope: '查看全部职责规则与风险', mode: '查看' },
      { module: '重大事项', scope: '质量、交付、采购升级节点', mode: '审核' },
      { module: '经营分析', scope: '跨部门汇总指标', mode: '查看' },
    ],
  },
  {
    id: 'lin-bo', name: '林波', role: '生产车间主管', departmentId: 'production', initials: '林', status: 'active',
    summary: '统筹生产现场、前后端班组、交付节奏及跨部门异常闭环。',
    coreResponsibilities: ['统筹车间日计划与人员设备安排', '协调前端压接和后端装配衔接', '推动现场异常按时升级和闭环'],
    managedModules: ['生产执行', '流程中心', '问题管理', '报表中心'],
    collaboratorIds: ['fang-rong-xia', 'zhao-rong', 'gao-yuan', 'deng-bin', 'zhang-hao'],
    reviewerIds: ['deng-bin'], escalationIds: ['wei-lin'],
    checklist: ['确认当日生产节拍', '检查工序阻塞与交接', '复核交付风险和加急事项'],
    flowNames: ['计划下达至生产', '现场异常闭环', '返修与复验'],
    permissions: [
      { module: '生产执行', scope: '车间全部工序与班组', mode: '维护' },
      { module: '问题管理', scope: '生产来源问题', mode: '维护' },
      { module: '报表中心', scope: '生产与工时汇总', mode: '查看' },
    ],
  },
  {
    id: 'fang-rong-xia', name: '方荣霞', role: '后端装配组长', departmentId: 'production', initials: '方', status: 'active',
    summary: '负责后端装配任务承接、人员协调、工序交接与完成反馈。',
    coreResponsibilities: ['安排后端装配作业', '确认前序良品交接数量', '反馈装配异常和产能风险'],
    managedModules: ['生产执行', '问题管理', '产品工序与工时'],
    collaboratorIds: ['lin-bo', 'zhao-rong', 'gao-yuan', 'wang-zhu-mei'],
    reviewerIds: ['lin-bo', 'deng-bin'], escalationIds: ['lin-bo'],
    checklist: ['核对待装配批次', '确认工位与人员', '提交完成数量和异常'],
    flowNames: ['后端装配流转', '装配质量复验'],
    permissions: [
      { module: '生产执行', scope: '后端装配相关工序', mode: '维护' },
      { module: '产品工序与工时', scope: '后端班组数据', mode: '查看' },
    ],
  },
  {
    id: 'zhao-rong', name: '赵容', role: '前端压接组长', departmentId: 'production', initials: '赵', status: 'active',
    summary: '负责前端裁线压接排布、首件确认协同和良品向后端交接。',
    coreResponsibilities: ['安排前端裁线压接作业', '确认首件与过程参数', '向后端交接良品和异常说明'],
    managedModules: ['生产执行', '问题管理', '产品工序与工时'],
    collaboratorIds: ['lin-bo', 'fang-rong-xia', 'gao-yuan', 'li-hong-sheng'],
    reviewerIds: ['lin-bo', 'deng-bin'], escalationIds: ['lin-bo'],
    checklist: ['确认设备和模具', '核对工艺参数', '记录良品与不良品数量'],
    flowNames: ['前端压接流转', '首件确认'],
    permissions: [
      { module: '生产执行', scope: '前端压接相关工序', mode: '维护' },
      { module: '产品工序与工时', scope: '前端班组数据', mode: '查看' },
    ],
  },
  {
    id: 'deng-bin', name: '邓彬', role: '质量主管 / 质量决策', departmentId: 'quality', initials: '邓', status: 'active',
    summary: '统筹质量规则与重大质量决策，并参与总经理层面的质量判断。',
    coreResponsibilities: ['制定质量审核与放行原则', '组织重大质量问题分析', '向总经理层提交质量决策建议'],
    managedModules: ['问题管理', '变更管理', '流程中心', '报表中心'],
    collaboratorIds: ['wang-zhu-mei', 'li-hong-sheng', 'lin-bo', 'hu-jun-rui', 'wei-lin'],
    reviewerIds: ['wei-lin'], escalationIds: ['wei-lin'],
    checklist: ['审阅待验证问题', '确认重大不良处置', '跟踪质量风险复发情况'],
    flowNames: ['质量问题闭环', '返修复验', '重大质量决策'],
    permissions: [
      { module: '问题管理', scope: '全部质量问题与验证节点', mode: '审核' },
      { module: '变更管理', scope: '质量影响评估', mode: '审核' },
      { module: '报表中心', scope: '质量趋势与闭环指标', mode: '查看' },
    ],
  },
  {
    id: 'wang-zhu-mei', name: '王著美', role: '质量组核心成员', departmentId: 'quality', initials: '王', status: 'active',
    summary: '承担过程质量核查、问题验证和关键批次质量协同。',
    coreResponsibilities: ['执行过程质量核查', '验证问题整改结果', '支持关键批次质量判定'],
    managedModules: ['问题管理', '生产执行', '流程中心'],
    collaboratorIds: ['deng-bin', 'li-hong-sheng', 'lin-bo', 'fang-rong-xia'],
    reviewerIds: ['deng-bin'], escalationIds: ['deng-bin'],
    checklist: ['处理待验证问题', '复核重点批次', '记录验证结论'],
    flowNames: ['过程质量验证', '异常关闭验证'],
    permissions: [
      { module: '问题管理', scope: '分派到质量组的验证事项', mode: '维护' },
      { module: '生产执行', scope: '质量节点和异常信息', mode: '查看' },
    ],
  },
  {
    id: 'li-hong-sheng', name: '李鸿胜', role: '质量组成员', departmentId: 'quality', initials: '李', status: 'active',
    summary: '负责现场巡检、检验记录和异常证据补充。',
    coreResponsibilities: ['执行现场巡检与抽检', '维护检验记录', '收集质量异常证据'],
    managedModules: ['问题管理', '生产执行'],
    collaboratorIds: ['deng-bin', 'wang-zhu-mei', 'zhao-rong', 'hu-jun-rui'],
    reviewerIds: ['wang-zhu-mei', 'deng-bin'], escalationIds: ['deng-bin'],
    checklist: ['完成巡检任务', '补充异常照片与数据', '提交复验结果'],
    flowNames: ['现场巡检', '返修复验'],
    permissions: [
      { module: '问题管理', scope: '本人参与的检验事项', mode: '维护' },
      { module: '生产执行', scope: '检验相关工序', mode: '查看' },
    ],
  },
  {
    id: 'zhang-hao', name: '张豪', role: '计划 / 样品与工艺数据', departmentId: 'planning-process', initials: '张', status: 'active',
    summary: '负责编排周计划，并维护样品数据和部分工艺基础信息。',
    coreResponsibilities: ['编制与调整周排单', '协调仓库和车间准备状态', '维护样品数据与工艺基础资料'],
    managedModules: ['计划中心', '产品工序与工时', '流程中心', '图纸资料库'],
    collaboratorIds: ['lin-bo', 'gao-yuan', 'guo-wei-gui', 'ni-jin-dan', 'wang-hong-li', 'li-qin'],
    reviewerIds: ['lin-bo'], escalationIds: ['wei-lin'],
    checklist: ['核对本周排单', '检查图纸与配料准备', '补全样品工艺数据'],
    flowNames: ['周计划下达', '样品数据维护', '生产准备校验'],
    permissions: [
      { module: '计划中心', scope: '周计划与排单批次', mode: '维护' },
      { module: '产品工序与工时', scope: '样品和工艺基础数据', mode: '维护' },
      { module: '流程中心', scope: '计划来源流程', mode: '查看' },
    ],
  },
  {
    id: 'gao-yuan', name: '高源', role: '现场工艺', departmentId: 'planning-process', initials: '高', status: 'active',
    summary: '负责现场工艺确认、参数支持和生产可制造性协同。',
    coreResponsibilities: ['确认现场工艺路线与参数', '处理工艺执行偏差', '支持首件和样品试制'],
    managedModules: ['产品工序与工时', '生产执行', '变更管理'],
    collaboratorIds: ['zhang-hao', 'guo-wei-gui', 'lin-bo', 'zhao-rong', 'fang-rong-xia'],
    reviewerIds: ['deng-bin'], escalationIds: ['lin-bo'],
    checklist: ['确认待生产工艺', '处理现场工艺提问', '记录参数调整依据'],
    flowNames: ['工艺确认', '现场工艺变更', '样品试制'],
    permissions: [
      { module: '产品工序与工时', scope: '工艺路线与标准工时', mode: '维护' },
      { module: '变更管理', scope: '工艺影响评估', mode: '维护' },
    ],
  },
  {
    id: 'guo-wei-gui', name: '郭维贵', role: '技术图纸', departmentId: 'technology-commerce', initials: '郭', status: 'active',
    summary: '负责技术图纸接收、版本维护、发布和变更影响协同。',
    coreResponsibilities: ['维护图纸版本与完整性', '发布生产所需技术资料', '协同处理图纸变更'],
    managedModules: ['图纸资料库', '变更管理', '流程中心'],
    collaboratorIds: ['wang-hong-li', 'zhang-hao', 'gao-yuan', 'deng-bin'],
    reviewerIds: ['deng-bin'], escalationIds: ['wei-lin'],
    checklist: ['检查待发布图纸', '确认版本一致性', '通知受影响人员'],
    flowNames: ['图纸发布', '图纸变更评估'],
    permissions: [
      { module: '图纸资料库', scope: '技术图纸及其版本', mode: '维护' },
      { module: '变更管理', scope: '图纸变更事项', mode: '维护' },
    ],
  },
  {
    id: 'wang-hong-li', name: '王红丽', role: '客户技术 / 报价 / BOM', departmentId: 'technology-commerce', initials: '王', status: 'active',
    summary: '承接客户技术问题，并协调报价、BOM和需求澄清。',
    coreResponsibilities: ['对接客户技术问题', '维护报价输入与BOM信息', '推动需求澄清并传递到计划技术'],
    managedModules: ['问题管理', '图纸资料库', '变更管理'],
    collaboratorIds: ['guo-wei-gui', 'zhang-hao', 'gao-yuan', 'li-qin', 'sales-open'],
    reviewerIds: ['wei-lin'], escalationIds: ['wei-lin'],
    checklist: ['回复客户技术问题', '检查报价与BOM输入', '确认需求变更影响'],
    flowNames: ['客户技术问题', 'BOM确认', '报价输入'],
    permissions: [
      { module: '问题管理', scope: '客户技术来源问题', mode: '维护' },
      { module: '图纸资料库', scope: '客户输入资料', mode: '查看' },
      { module: '变更管理', scope: '客户需求变更', mode: '维护' },
    ],
  },
  {
    id: 'ni-jin-dan', name: '倪金丹', role: '仓库核心人员', departmentId: 'warehouse', initials: '倪', status: 'active',
    summary: '负责配料任务承接、库存异常确认和缺料反馈发起。',
    coreResponsibilities: ['执行周计划配料', '确认库存及替代料状态', '发起并跟踪缺料反馈'],
    managedModules: ['仓库管理', '缺料跟进', '计划中心'],
    collaboratorIds: ['liu-fei', 'zhang-hao', 'wang-wei-hong', 'jia-gai-zhen'],
    reviewerIds: ['zhang-hao'], escalationIds: ['lin-bo'],
    checklist: ['核对待配料任务', '处理仓库异常', '更新缺料预计到料信息'],
    flowNames: ['仓库配料', '缺料反馈与跟进'],
    permissions: [
      { module: '仓库管理', scope: '全部配料任务与异常', mode: '维护' },
      { module: '缺料跟进', scope: '仓库发起的缺料事项', mode: '维护' },
    ],
  },
  {
    id: 'liu-fei', name: '刘菲', role: '仓库协同人员', departmentId: 'warehouse', initials: '刘', status: 'active',
    summary: '协助配料、复核物料信息并补充仓库处理记录。',
    coreResponsibilities: ['协助配料与复核', '补充库存异常信息', '记录物料交接状态'],
    managedModules: ['仓库管理', '缺料跟进'],
    collaboratorIds: ['ni-jin-dan', 'zhang-hao', 'jia-gai-zhen'],
    reviewerIds: ['ni-jin-dan'], escalationIds: ['ni-jin-dan'],
    checklist: ['复核物料编码数量', '更新配料记录', '反馈异常证据'],
    flowNames: ['配料复核', '仓库异常协同'],
    permissions: [
      { module: '仓库管理', scope: '分派到本人的配料任务', mode: '维护' },
      { module: '缺料跟进', scope: '本人参与的缺料事项', mode: '查看' },
    ],
  },
  {
    id: 'hu-jun-rui', name: '胡军瑞', role: '返修', departmentId: 'production', initials: '胡', status: 'active',
    summary: '负责返修分支工单承接、处理记录和复验交接。',
    coreResponsibilities: ['承接返修任务', '记录返修数量与原因', '向质量提交复验'],
    managedModules: ['生产执行', '问题管理', '流程中心'],
    collaboratorIds: ['deng-bin', 'wang-zhu-mei', 'li-hong-sheng', 'lin-bo'],
    reviewerIds: ['deng-bin'], escalationIds: ['lin-bo'],
    checklist: ['确认返修范围', '记录返修过程', '提交质量复验'],
    flowNames: ['返修分支工单', '返修复验'],
    permissions: [
      { module: '生产执行', scope: '返修分支与相关工序', mode: '维护' },
      { module: '问题管理', scope: '关联返修问题', mode: '查看' },
    ],
  },
  {
    id: 'wang-wei-hong', name: '王伟红', role: '采购', departmentId: 'procurement', initials: '王', status: 'active',
    summary: '负责缺料事项的外部跟进、到料承诺和采购风险反馈。',
    coreResponsibilities: ['承接仓库缺料反馈', '跟进物料到达时间', '反馈供应与交付风险'],
    managedModules: ['缺料跟进', '仓库管理', '计划中心'],
    collaboratorIds: ['jia-gai-zhen', 'ni-jin-dan', 'liu-fei', 'zhang-hao'],
    reviewerIds: ['zhang-hao'], escalationIds: ['wei-lin'],
    checklist: ['处理高优缺料', '更新预计到料', '升级供应风险'],
    flowNames: ['缺料跟进', '到料确认'],
    permissions: [
      { module: '缺料跟进', scope: '采购承接的缺料事项', mode: '维护' },
      { module: '仓库管理', scope: '缺料关联库存状态', mode: '查看' },
    ],
  },
  {
    id: 'jia-gai-zhen', name: '贾改真', role: '采购协同人员', departmentId: 'procurement', initials: '贾', status: 'active',
    summary: '协助采购跟进、记录供应反馈并与仓库核对到料。',
    coreResponsibilities: ['协助供应进度跟进', '维护跟进记录', '协调仓库到料核对'],
    managedModules: ['缺料跟进', '仓库管理'],
    collaboratorIds: ['wang-wei-hong', 'ni-jin-dan', 'liu-fei'],
    reviewerIds: ['wang-wei-hong'], escalationIds: ['wang-wei-hong'],
    checklist: ['更新供应反馈', '提醒临期到料', '核对仓库签收'],
    flowNames: ['采购协同跟进', '到料核对'],
    permissions: [
      { module: '缺料跟进', scope: '本人协同的跟进事项', mode: '维护' },
      { module: '仓库管理', scope: '到料状态', mode: '查看' },
    ],
  },
  {
    id: 'pan-dan-dan', name: '潘丹丹', role: '人事', departmentId: 'people-operations', initials: '潘', status: 'active',
    summary: '负责人事资料、组织信息和考勤异常协同，支持各部门完成入转调离与人员信息维护。',
    coreResponsibilities: ['维护员工档案与组织岗位信息', '协同处理入转调离和人员手续', '汇总考勤异常并推动部门确认'],
    managedModules: ['人事管理', '考勤与异常', '职责配置'],
    collaboratorIds: ['wei-lin', 'lin-bo', 'fang-rong-xia', 'zhao-rong'],
    reviewerIds: ['wei-lin'], escalationIds: ['wei-lin'],
    checklist: ['核对人员档案变更', '跟进考勤异常确认', '更新组织岗位名册'],
    flowNames: ['员工档案维护', '考勤异常确认', '组织岗位变更'],
    permissions: [
      { module: '人事管理', scope: '员工基础资料与组织岗位信息', mode: '维护' },
      { module: '考勤与异常', scope: '考勤异常记录与部门确认', mode: '维护' },
      { module: '职责配置', scope: '人员和岗位配置预览', mode: '查看' },
    ],
  },
  {
    id: 'li-qin', name: '李琴', role: '销售助理', departmentId: 'sales', initials: '李', status: 'active',
    summary: '负责销售资料和沟通记录协同；正式销售决策、客户承诺及重大交期变更仍由待配置销售主责或管理者确认。',
    coreResponsibilities: ['维护客户资料和客户沟通记录', '录入订单信息并整理报价资料', '同步交期信息并完成计划技术交接'],
    managedModules: ['计划中心', '问题管理', '图纸资料库', '职责配置'],
    collaboratorIds: ['sales-open', 'wang-hong-li', 'zhang-hao', 'wei-lin'],
    reviewerIds: ['sales-open', 'wei-lin'], escalationIds: ['wei-lin'],
    checklist: ['补全客户与订单资料', '整理报价依据和附件', '同步交期变化与沟通记录'],
    flowNames: ['客户资料维护', '订单信息录入', '报价资料整理', '交期信息同步'],
    permissions: [
      { module: '客户资料', scope: '客户基础资料与沟通记录', mode: '维护' },
      { module: '计划中心', scope: '订单输入和交期信息协同', mode: '维护' },
      { module: '报价资料', scope: '报价依据与附件整理，不含最终审核', mode: '维护' },
    ],
  },
  {
    id: 'sales-open', name: '销售岗位待配置', role: '销售（待配置）', departmentId: 'sales', initials: '销', status: 'unconfigured',
    summary: '预留销售订单需求输入、客户交期确认和商务信息传递入口。',
    coreResponsibilities: ['录入订单需求与客户交期', '传递商务约束与优先级', '协同客户信息闭环'],
    managedModules: ['计划中心', '问题管理'],
    collaboratorIds: ['li-qin', 'wang-hong-li', 'zhang-hao', 'wei-lin'],
    reviewerIds: ['wei-lin'], escalationIds: ['wei-lin'],
    checklist: ['绑定真实人员账号', '确认销售职责边界', '配置订单需求入口'],
    flowNames: ['销售需求输入（待接入）'],
    permissions: [
      { module: '销售入口', scope: '待绑定真实账号后确认', mode: '查看' },
    ],
  },
];

export const responsibilityMatrix: ResponsibilityMatrixItem[] = [
  {
    id: 'weekly-plan-release', matter: '周计划编排与下达', description: '形成独立周排单，联动图纸、仓库、工艺和生产准备。',
    module: '计划中心', departmentId: 'planning-process', roleKeyword: '计划',
    ownerIds: ['zhang-hao'], collaboratorIds: ['lin-bo', 'ni-jin-dan', 'gao-yuan'], reviewerIds: ['wei-lin'], informedIds: ['fang-rong-xia', 'zhao-rong'],
    dueLabel: '每周五 16:00', state: 'healthy',
    triggerCondition: '新生产周建立或现有周排单发生数量、交期调整。',
    escalationRule: '准备校验逾期 2 小时提醒林波，跨工作日仍未下达则升级韦林。',
    changeLog: [{ at: '07/27 09:20', actorId: 'zhang-hao', action: '确认周计划按独立生产周维护' }],
    route: '/weekly-plan-center',
    flow: [
      { label: '编排计划', personIds: ['zhang-hao'], state: 'done' },
      { label: '准备校验', personIds: ['ni-jin-dan', 'gao-yuan'], state: 'current' },
      { label: '车间下达', personIds: ['lin-bo'], state: 'next' },
    ],
  },
  {
    id: 'drawing-release', matter: '图纸发布与版本确认', description: '保证生产使用图纸版本一致，并通知受影响岗位。',
    module: '图纸资料库', departmentId: 'technology-commerce', roleKeyword: '技术图纸',
    ownerIds: ['guo-wei-gui'], collaboratorIds: ['wang-hong-li', 'gao-yuan'], reviewerIds: ['deng-bin'], informedIds: ['zhang-hao', 'lin-bo'],
    dueLabel: '生产前 1 天', state: 'attention',
    triggerCondition: '订单进入生产准备，或客户图纸、技术版本发生更新。',
    escalationRule: '生产前 4 小时仍未确认版本，通知张豪和林波；存在质量影响时升级邓彬。',
    changeLog: [{ at: '07/27 10:05', actorId: 'guo-wei-gui', action: '补充图纸版本影响确认节点' }],
    route: '/drawing-library',
    flow: [
      { label: '资料校对', personIds: ['guo-wei-gui'], state: 'done' },
      { label: '影响确认', personIds: ['gao-yuan', 'deng-bin'], state: 'current' },
      { label: '发布知会', personIds: ['zhang-hao', 'lin-bo'], state: 'next' },
    ],
  },
  {
    id: 'customer-bom', matter: '客户技术问题、报价与 BOM', description: '澄清客户技术输入，形成可供计划和技术使用的完整信息。',
    module: '问题管理', departmentId: 'technology-commerce', roleKeyword: '客户技术',
    ownerIds: ['wang-hong-li'], collaboratorIds: ['guo-wei-gui', 'zhang-hao'], reviewerIds: ['wei-lin'], informedIds: ['sales-open'],
    dueLabel: '2 个工作日', state: 'healthy',
    triggerCondition: '收到客户技术问题、报价输入或 BOM 资料变更。',
    escalationRule: '技术澄清超过 2 个工作日升级韦林；正式报价结论必须由销售主责或管理者确认。',
    changeLog: [{ at: '07/27 11:10', actorId: 'wang-hong-li', action: '明确技术澄清与销售决策边界' }],
    route: '/workspace/issues',
    flow: [
      { label: '需求澄清', personIds: ['wang-hong-li'], state: 'current' },
      { label: '技术确认', personIds: ['guo-wei-gui', 'zhang-hao'], state: 'next' },
      { label: '商务知会', personIds: ['sales-open'], state: 'next' },
    ],
  },
  {
    id: 'sales-demand-intake', matter: '销售订单需求输入', description: '录入客户交期、商务约束和订单优先级，并完成技术计划交接。',
    module: '计划中心', departmentId: 'sales', roleKeyword: '销售',
    ownerIds: [], collaboratorIds: ['li-qin', 'wang-hong-li', 'zhang-hao'], reviewerIds: ['wei-lin'], informedIds: ['lin-bo'],
    dueLabel: '订单确认当日', state: 'unassigned', warning: 'missing-owner',
    warningText: '销售主责待配置。李琴仅承担客户资料、订单信息和报价资料协同，不能替代最终主责或最终审核。',
    ownerPlaceholder: '销售主责待配置',
    triggerCondition: '客户订单信息进入系统，或客户承诺、优先级、重大交期发生变化。',
    escalationRule: '未配置销售主责时由韦林临时指定最终负责人；李琴仅整理资料并同步，不形成销售决策。',
    changeLog: [{ at: '07/28 08:30', actorId: 'wei-lin', action: '新增销售助理协同边界，保留销售主责待配置' }],
    route: '/workspace/employees?view=responsibilities&person=sales-open&matter=sales-demand-intake',
    flow: [
      { label: '资料录入', personIds: ['li-qin'], state: 'current' },
      { label: '销售确认', personIds: ['sales-open'], state: 'next' },
      { label: '技术澄清', personIds: ['wang-hong-li'], state: 'next' },
      { label: '计划承接', personIds: ['zhang-hao'], state: 'next' },
    ],
  },
  {
    id: 'frontend-production', matter: '前端裁线压接执行', description: '按工艺完成前端工序，并将良品与异常信息交接后端。',
    module: '生产执行', departmentId: 'production', roleKeyword: '前端压接',
    ownerIds: ['zhao-rong'], collaboratorIds: ['gao-yuan', 'lin-bo'], reviewerIds: ['li-hong-sheng'], informedIds: ['fang-rong-xia', 'zhang-hao'],
    dueLabel: '按日计划', state: 'healthy',
    triggerCondition: '生产计划下达并完成设备、工艺和物料准备。',
    escalationRule: '工序阻塞 30 分钟提醒林波，质量异常立即交由李鸿胜确认。',
    changeLog: [{ at: '07/26 16:40', actorId: 'zhao-rong', action: '确认前端良品与异常分开交接' }],
    route: '/production',
    flow: [
      { label: '任务承接', personIds: ['zhao-rong'], state: 'done' },
      { label: '工艺执行', personIds: ['zhao-rong', 'gao-yuan'], state: 'current' },
      { label: '质量交接', personIds: ['li-hong-sheng', 'fang-rong-xia'], state: 'next' },
    ],
  },
  {
    id: 'backend-assembly', matter: '后端装配与完成交接', description: '承接前端良品，完成装配并提交质量复核与完成反馈。',
    module: '生产执行', departmentId: 'production', roleKeyword: '后端装配',
    ownerIds: ['fang-rong-xia'], collaboratorIds: ['lin-bo', 'gao-yuan'], reviewerIds: ['wang-zhu-mei'], informedIds: ['zhang-hao'],
    dueLabel: '按日计划', state: 'healthy',
    triggerCondition: '前端良品完成数量确认并进入后端待接收状态。',
    escalationRule: '待接收超过 1 小时提醒方荣霞和林波，质量复核逾期升级邓彬。',
    changeLog: [{ at: '07/26 17:15', actorId: 'fang-rong-xia', action: '补充后端完成后的质量复核要求' }],
    route: '/production',
    flow: [
      { label: '良品接收', personIds: ['fang-rong-xia'], state: 'done' },
      { label: '装配执行', personIds: ['fang-rong-xia'], state: 'current' },
      { label: '质量复核', personIds: ['wang-zhu-mei'], state: 'next' },
    ],
  },
  {
    id: 'quality-close-loop', matter: '质量异常研判与闭环', description: '完成原因分析、措施验证和重大质量风险决策。',
    module: '问题管理', departmentId: 'quality', roleKeyword: '质量主管',
    ownerIds: ['deng-bin'], collaboratorIds: ['wang-zhu-mei', 'li-hong-sheng', 'lin-bo'], reviewerIds: ['wei-lin'], informedIds: ['gao-yuan', 'zhang-hao'],
    dueLabel: '24 小时响应', state: 'overdue', warning: 'overdue', warningText: 'Q-0727-03 验证节点已超时 3 小时，需要质量主管处理。',
    triggerCondition: '发现生产、来料或客户质量异常并完成问题登记。',
    escalationRule: '验证节点逾期即时通知邓彬，重大质量与客户风险同步升级韦林。',
    changeLog: [{ at: '07/27 14:20', actorId: 'deng-bin', action: '调整重大质量问题升级要求' }],
    route: '/workspace/issues',
    flow: [
      { label: '问题受理', personIds: ['wang-zhu-mei'], state: 'done' },
      { label: '原因研判', personIds: ['deng-bin', 'lin-bo'], state: 'current' },
      { label: '措施验证', personIds: ['li-hong-sheng'], state: 'next' },
    ],
  },
  {
    id: 'warehouse-picking', matter: '周计划配料与仓库异常', description: '根据周计划准备物料，反馈缺料、错料和质量异常。',
    module: '仓库管理', departmentId: 'warehouse', roleKeyword: '仓库核心',
    ownerIds: ['ni-jin-dan'], collaboratorIds: ['liu-fei', 'zhang-hao'], reviewerIds: ['lin-bo'], informedIds: ['wang-wei-hong'],
    dueLabel: '开工前 1 天', state: 'healthy',
    triggerCondition: '周计划批次下达到仓库并进入生产准备。',
    escalationRule: '缺料、错料或质量异常确认后 30 分钟内反馈，影响开工时升级林波。',
    changeLog: [{ at: '07/27 13:45', actorId: 'ni-jin-dan', action: '统一配料异常反馈时限' }],
    route: '/workspace/warehouse',
    flow: [
      { label: '任务下达', personIds: ['zhang-hao'], state: 'done' },
      { label: '仓库配料', personIds: ['ni-jin-dan', 'liu-fei'], state: 'current' },
      { label: '异常反馈', personIds: ['wang-wei-hong'], state: 'next' },
    ],
  },
  {
    id: 'shortage-follow-up', matter: '缺料反馈与到料跟进', description: '承接仓库缺料，持续更新预计到料和交付影响。',
    module: '缺料跟进', departmentId: 'procurement', roleKeyword: '采购',
    ownerIds: ['wang-wei-hong'], collaboratorIds: ['jia-gai-zhen', 'ni-jin-dan'], reviewerIds: ['zhang-hao'], informedIds: ['lin-bo', 'wei-lin'],
    dueLabel: '4 小时首响', state: 'attention',
    triggerCondition: '仓库确认缺料并提交物料、数量、影响批次和需求日期。',
    escalationRule: '4 小时无采购反馈提醒王伟红，影响本周交付时同步韦林。',
    changeLog: [{ at: '07/27 15:00', actorId: 'wang-wei-hong', action: '明确采购首响与交付风险升级路径' }],
    route: '/workspace/procurement',
    flow: [
      { label: '缺料确认', personIds: ['ni-jin-dan'], state: 'done' },
      { label: '供应跟进', personIds: ['wang-wei-hong', 'jia-gai-zhen'], state: 'current' },
      { label: '到料核对', personIds: ['ni-jin-dan'], state: 'next' },
    ],
  },
  {
    id: 'urgent-substitute', matter: '紧急替代料评估', description: '评估替代料技术、质量和交付影响后形成决策。',
    module: '变更管理', departmentId: 'procurement', roleKeyword: '采购协同',
    ownerIds: ['wang-wei-hong', 'jia-gai-zhen'], collaboratorIds: ['gao-yuan', 'ni-jin-dan'], reviewerIds: ['deng-bin', 'wei-lin'], informedIds: ['zhang-hao'],
    dueLabel: '当日闭环', state: 'conflict', warning: 'responsibility-conflict', warningText: '当前存在两名主责，需明确王伟红负责决策还是贾改真负责执行。',
    triggerCondition: '原物料无法按期到达且现场提出替代料方案。',
    escalationRule: '技术或质量无法在当日形成结论时升级韦林，未经审核不得投入生产。',
    changeLog: [{ at: '07/27 15:35', actorId: 'deng-bin', action: '要求替代料必须经过质量审核' }],
    route: '/workspace/changes',
    flow: [
      { label: '替代提议', personIds: ['wang-wei-hong', 'jia-gai-zhen'], state: 'current' },
      { label: '技术质量评估', personIds: ['gao-yuan', 'deng-bin'], state: 'next' },
      { label: '决策确认', personIds: ['wei-lin'], state: 'next' },
    ],
  },
  {
    id: 'rework-close-loop', matter: '返修分支与质量复验', description: '不良品进入返修分支，返修完成后由质量复验并回流。',
    module: '流程中心', departmentId: 'production', roleKeyword: '返修',
    ownerIds: ['hu-jun-rui'], collaboratorIds: ['li-hong-sheng', 'lin-bo'], reviewerIds: ['deng-bin'], informedIds: ['wang-zhu-mei'],
    dueLabel: '48 小时', state: 'healthy',
    triggerCondition: '工序完成时产生不良品并建立返修分支工单。',
    escalationRule: '返修超过 48 小时提醒胡军瑞和林波，重复不良升级邓彬。',
    changeLog: [{ at: '07/27 16:10', actorId: 'hu-jun-rui', action: '补充返修完成后的质量复验交接' }],
    route: '/workspace/workflows',
    flow: [
      { label: '返修承接', personIds: ['hu-jun-rui'], state: 'current' },
      { label: '质量复验', personIds: ['li-hong-sheng', 'deng-bin'], state: 'next' },
      { label: '回流确认', personIds: ['lin-bo'], state: 'next' },
    ],
  },
  {
    id: 'sample-process-data', matter: '样品与工艺数据维护', description: '维护样品工艺路线、参数与标准工时，为后续生产复用。',
    module: '产品工序与工时', departmentId: 'planning-process', roleKeyword: '样品工艺',
    ownerIds: ['zhang-hao'], collaboratorIds: ['gao-yuan', 'guo-wei-gui'], reviewerIds: ['deng-bin'], informedIds: ['lin-bo', 'wang-hong-li'],
    dueLabel: '样品完成后 1 天', state: 'healthy',
    triggerCondition: '样品完成或现场验证产生新的工艺路线、参数和标准工时。',
    escalationRule: '样品数据超过 1 天未维护提醒张豪，影响批量计划时升级林波。',
    changeLog: [{ at: '07/27 16:45', actorId: 'zhang-hao', action: '增加样品完成后的数据维护时限' }],
    route: '/workspace/product-times',
    flow: [
      { label: '样品数据', personIds: ['zhang-hao'], state: 'current' },
      { label: '工艺校核', personIds: ['gao-yuan'], state: 'next' },
      { label: '质量确认', personIds: ['deng-bin'], state: 'next' },
    ],
  },
  {
    id: 'people-record-support', matter: '人员档案与组织信息维护', description: '维护员工档案、岗位归属和入转调离记录，并完成部门确认。',
    module: '人事管理', departmentId: 'people-operations', roleKeyword: '人事组织支持',
    ownerIds: ['pan-dan-dan'], collaboratorIds: ['lin-bo', 'fang-rong-xia', 'zhao-rong'], reviewerIds: ['wei-lin'], informedIds: ['deng-bin'],
    dueLabel: '变更当日', state: 'healthy',
    triggerCondition: '员工入职、转岗、调动、离职，或组织岗位信息发生变化。',
    escalationRule: '资料超过 1 个工作日未确认提醒潘丹丹，影响排班或工资时升级韦林。',
    changeLog: [{ at: '07/28 08:40', actorId: 'pan-dan-dan', action: '建立人事与部门负责人协同规则' }],
    route: '/workspace/employees',
    flow: [
      { label: '资料维护', personIds: ['pan-dan-dan'], state: 'current' },
      { label: '部门确认', personIds: ['lin-bo'], state: 'next' },
      { label: '组织知会', personIds: ['wei-lin'], state: 'next' },
    ],
  },
  {
    id: 'sales-support-records', matter: '客户资料与销售协同维护', description: '由销售助理维护客户资料、订单输入、报价附件和沟通记录；不形成正式销售决策。',
    module: '职责配置', departmentId: 'sales', roleKeyword: '销售助理资料协同',
    ownerIds: ['li-qin'], collaboratorIds: ['wang-hong-li', 'zhang-hao'], reviewerIds: ['sales-open'], informedIds: ['wei-lin'],
    dueLabel: '信息产生当日', state: 'attention',
    triggerCondition: '新增客户资料、收到订单输入、报价附件或客户沟通记录需要归档同步。',
    escalationRule: '涉及客户报价、客户承诺或重大交期变更时停止在资料协同节点，并交由销售主责或韦林临时指定负责人确认。',
    changeLog: [{ at: '07/28 08:45', actorId: 'wei-lin', action: '新增李琴销售助理职责并限制最终销售决策权限' }],
    route: '/workspace/employees?view=directory&person=li-qin&detail=collaboration',
    flow: [
      { label: '资料整理', personIds: ['li-qin'], state: 'current' },
      { label: '技术计划协同', personIds: ['wang-hong-li', 'zhang-hao'], state: 'next' },
      { label: '销售决策确认', personIds: ['sales-open'], state: 'next' },
    ],
  },
];

export const responsibilityWorkItems: ResponsibilityWorkItem[] = [
  { id: 'work-01', title: '确认本周急单的车间资源安排', source: '计划中心', module: '计划中心', relation: 'owned', priority: 'urgent', dueLabel: '今天 10:30', dateScope: 'today', state: 'processing', stateLabel: '协调中', ownerId: 'lin-bo', participantIds: ['zhang-hao', 'fang-rong-xia', 'zhao-rong'], nextPersonId: 'zhang-hao', route: '/weekly-plan-center', progress: 64 },
  { id: 'work-02', title: '审核前端压接异常处置方案', source: '问题管理', module: '问题管理', relation: 'review', priority: 'high', dueLabel: '今天 14:00', dateScope: 'today', state: 'pending', stateLabel: '待审核', ownerId: 'lin-bo', participantIds: ['zhao-rong', 'deng-bin'], nextPersonId: 'deng-bin', route: '/workspace/issues', progress: 48 },
  { id: 'work-03', title: '配合确认后端装配节拍调整', source: '生产执行', module: '生产执行', relation: 'assist', priority: 'normal', dueLabel: '今天 16:30', dateScope: 'today', state: 'processing', stateLabel: '处理中', ownerId: 'lin-bo', participantIds: ['fang-rong-xia', 'gao-yuan'], nextPersonId: 'fang-rong-xia', route: '/production', progress: 72 },
  { id: 'work-04', title: '重大质量问题进入验证阶段', source: '流程中心', module: '流程中心', relation: 'informed', priority: 'high', dueLabel: '明天 09:00', dateScope: 'tomorrow', state: 'waiting', stateLabel: '待验证', ownerId: 'lin-bo', participantIds: ['deng-bin', 'wang-zhu-mei'], nextPersonId: 'wang-zhu-mei', route: '/workspace/workflows', progress: 80 },
  { id: 'work-05', title: '后端装配批次完成并提交质量复核', source: '生产执行', module: '生产执行', relation: 'owned', priority: 'high', dueLabel: '今天 17:00', dateScope: 'today', state: 'processing', stateLabel: '生产中', ownerId: 'fang-rong-xia', participantIds: ['lin-bo', 'wang-zhu-mei'], nextPersonId: 'wang-zhu-mei', route: '/production', progress: 58 },
  { id: 'work-06', title: '前端首件参数确认', source: '产品工序与工时', module: '产品工序与工时', relation: 'owned', priority: 'high', dueLabel: '今天 11:00', dateScope: 'today', state: 'processing', stateLabel: '确认中', ownerId: 'zhao-rong', participantIds: ['gao-yuan', 'li-hong-sheng'], nextPersonId: 'li-hong-sheng', route: '/workspace/product-times', progress: 76 },
  { id: 'work-07', title: 'Q-0727-03 原因分析与决策建议', source: '问题管理', module: '问题管理', relation: 'owned', priority: 'urgent', dueLabel: '已超时 3 小时', dateScope: 'today', state: 'processing', stateLabel: '需升级', ownerId: 'deng-bin', participantIds: ['wang-zhu-mei', 'lin-bo', 'wei-lin'], nextPersonId: 'wei-lin', route: '/workspace/issues', progress: 42 },
  { id: 'work-08', title: '验证压接异常整改结果', source: '问题管理', module: '问题管理', relation: 'owned', priority: 'high', dueLabel: '今天 15:00', dateScope: 'today', state: 'pending', stateLabel: '待验证', ownerId: 'wang-zhu-mei', participantIds: ['li-hong-sheng', 'zhao-rong'], nextPersonId: 'deng-bin', route: '/workspace/issues', progress: 66 },
  { id: 'work-09', title: '完成现场巡检记录补充', source: '生产执行', module: '生产执行', relation: 'owned', priority: 'normal', dueLabel: '今天 16:00', dateScope: 'today', state: 'processing', stateLabel: '巡检中', ownerId: 'li-hong-sheng', participantIds: ['wang-zhu-mei', 'zhao-rong'], nextPersonId: 'wang-zhu-mei', route: '/production', progress: 54 },
  { id: 'work-10', title: '完成下周计划准备校验', source: '计划中心', module: '计划中心', relation: 'owned', priority: 'high', dueLabel: '明天 12:00', dateScope: 'tomorrow', state: 'processing', stateLabel: '准备中', ownerId: 'zhang-hao', participantIds: ['ni-jin-dan', 'gao-yuan', 'lin-bo'], nextPersonId: 'lin-bo', route: '/weekly-plan-center', progress: 61 },
  { id: 'work-11', title: '确认新产品现场工艺路线', source: '产品工序与工时', module: '产品工序与工时', relation: 'owned', priority: 'high', dueLabel: '今天 13:30', dateScope: 'today', state: 'pending', stateLabel: '待确认', ownerId: 'gao-yuan', participantIds: ['zhang-hao', 'guo-wei-gui'], nextPersonId: 'deng-bin', route: '/workspace/product-times', progress: 35 },
  { id: 'work-12', title: '发布 D011601-8175 图纸新版本', source: '图纸资料库', module: '图纸资料库', relation: 'owned', priority: 'urgent', dueLabel: '今天 11:30', dateScope: 'today', state: 'processing', stateLabel: '影响确认', ownerId: 'guo-wei-gui', participantIds: ['wang-hong-li', 'gao-yuan', 'deng-bin'], nextPersonId: 'zhang-hao', route: '/drawing-library', progress: 70 },
  { id: 'work-13', title: '回复客户关于 BOM 替代料问题', source: '问题管理', module: '问题管理', relation: 'owned', priority: 'high', dueLabel: '今天 15:30', dateScope: 'today', state: 'processing', stateLabel: '技术澄清', ownerId: 'wang-hong-li', participantIds: ['guo-wei-gui', 'sales-open'], nextPersonId: 'sales-open', route: '/workspace/issues', progress: 57 },
  { id: 'work-14', title: '完成本周待配料任务复核', source: '仓库管理', module: '仓库管理', relation: 'owned', priority: 'high', dueLabel: '今天 12:00', dateScope: 'today', state: 'processing', stateLabel: '配料中', ownerId: 'ni-jin-dan', participantIds: ['liu-fei', 'zhang-hao'], nextPersonId: 'lin-bo', route: '/workspace/warehouse', progress: 78 },
  { id: 'work-15', title: '补充三项仓库异常证据', source: '仓库管理', module: '仓库管理', relation: 'owned', priority: 'normal', dueLabel: '今天 14:30', dateScope: 'today', state: 'processing', stateLabel: '复核中', ownerId: 'liu-fei', participantIds: ['ni-jin-dan', 'jia-gai-zhen'], nextPersonId: 'ni-jin-dan', route: '/workspace/warehouse', progress: 49 },
  { id: 'work-16', title: '完成返修批次并提交复验', source: '流程中心', module: '流程中心', relation: 'owned', priority: 'high', dueLabel: '今天 17:30', dateScope: 'today', state: 'processing', stateLabel: '返修中', ownerId: 'hu-jun-rui', participantIds: ['li-hong-sheng', 'deng-bin'], nextPersonId: 'li-hong-sheng', route: '/workspace/workflows', progress: 68 },
  { id: 'work-17', title: '更新高优缺料预计到料时间', source: '缺料跟进', module: '缺料跟进', relation: 'owned', priority: 'urgent', dueLabel: '今天 10:00', dateScope: 'today', state: 'processing', stateLabel: '供应跟进', ownerId: 'wang-wei-hong', participantIds: ['jia-gai-zhen', 'ni-jin-dan'], nextPersonId: 'ni-jin-dan', route: '/workspace/procurement', progress: 52 },
  { id: 'work-18', title: '核对供应反馈与仓库签收', source: '缺料跟进', module: '缺料跟进', relation: 'owned', priority: 'normal', dueLabel: '明天 09:30', dateScope: 'tomorrow', state: 'waiting', stateLabel: '待到料', ownerId: 'jia-gai-zhen', participantIds: ['wang-wei-hong', 'liu-fei'], nextPersonId: 'liu-fei', route: '/workspace/procurement', progress: 44 },
  { id: 'work-19', title: '审阅重大质量处置和交付影响', source: '问题管理', module: '问题管理', relation: 'review', priority: 'urgent', dueLabel: '今天 16:00', dateScope: 'today', state: 'pending', stateLabel: '待决策', ownerId: 'wei-lin', participantIds: ['deng-bin', 'lin-bo'], nextPersonId: 'deng-bin', route: '/workspace/issues', progress: 73 },
  { id: 'work-20', title: '绑定销售主责并确认订单需求入口', source: '职责配置', module: '职责配置', relation: 'owned', priority: 'high', dueLabel: '本周内', dateScope: 'week', state: 'waiting', stateLabel: '主责待配置', ownerId: 'sales-open', participantIds: ['li-qin', 'wang-hong-li', 'wei-lin'], nextPersonId: 'wei-lin', route: '/workspace/employees?view=responsibilities&person=sales-open&matter=sales-demand-intake', progress: 12 },
  { id: 'work-21', title: '核对新员工档案与组织岗位信息', source: '人事管理', module: '人事管理', relation: 'owned', priority: 'high', dueLabel: '今天 11:30', dateScope: 'today', state: 'processing', stateLabel: '部门确认中', ownerId: 'pan-dan-dan', participantIds: ['lin-bo', 'fang-rong-xia'], nextPersonId: 'wei-lin', route: '/workspace/employees?view=directory', progress: 68 },
  { id: 'work-22', title: '汇总本周考勤异常并提醒部门确认', source: '考勤与异常', module: '考勤与异常', relation: 'owned', priority: 'normal', dueLabel: '今天 16:00', dateScope: 'today', state: 'pending', stateLabel: '待部门确认', ownerId: 'pan-dan-dan', participantIds: ['lin-bo', 'zhao-rong'], nextPersonId: 'lin-bo', route: '/workspace/attendance', progress: 36 },
  { id: 'work-23', title: '整理客户报价资料与沟通记录', source: '职责配置', module: '职责配置', relation: 'owned', priority: 'high', dueLabel: '今天 14:30', dateScope: 'today', state: 'processing', stateLabel: '资料整理中', ownerId: 'li-qin', participantIds: ['wang-hong-li', 'zhang-hao'], nextPersonId: 'sales-open', route: '/workspace/employees?view=directory&person=li-qin&detail=collaboration', progress: 62 },
  { id: 'work-24', title: '同步订单交期信息，等待销售主责确认', source: '计划中心', module: '计划中心', relation: 'assist', priority: 'urgent', dueLabel: '今天 10:45', dateScope: 'today', state: 'waiting', stateLabel: '主责待配置', ownerId: 'sales-open', participantIds: ['li-qin', 'zhang-hao'], nextPersonId: 'wei-lin', route: '/workspace/employees?view=responsibilities&matter=sales-demand-intake', progress: 44 },
];

export const responsibilityCollaborationPrototype: ResponsibilityCollaborationSnapshot = {
  contractVersion: 'responsibility-collaboration.v1',
  source: 'prototype',
  departments: responsibilityDepartments,
  people: responsibilityPeople,
  matrix: responsibilityMatrix,
  workItems: responsibilityWorkItems,
  permissionPreviewOnly: true,
};

/**
 * Frontend prototype adapter. Replace this implementation with an API-backed
 * source later without changing the page component contract.
 */
export const responsibilityCollaborationDataSource: ResponsibilityCollaborationDataSource = {
  async loadSnapshot() {
    return responsibilityCollaborationPrototype;
  },
};
