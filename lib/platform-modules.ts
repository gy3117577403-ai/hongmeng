export type PlatformModuleLink = {
  label: string;
  description: string;
  href: string;
};

export type PlatformModuleDefinition = {
  slug: string;
  kicker: string;
  title: string;
  description: string;
  capabilityTitle: string;
  capabilities: string[];
  links: PlatformModuleLink[];
};

const modules: PlatformModuleDefinition[] = [
  {
    slug: 'reviews', kicker: '协同评审', title: '评审中心',
    description: '为图纸、工艺和生产方案提供统一评审入口。当前保留完整模块框架，后续接入评审任务、意见和结论。',
    capabilityTitle: '规划能力', capabilities: ['发起技术评审', '汇总评审意见', '记录评审结论'],
    links: [
      { label: '查看图纸资料', description: '进入现有图纸资料库', href: '/drawing-library' },
      { label: '查看组装说明书', description: '进入现有工艺说明书', href: '/connector-assembly-manuals' },
    ],
  },
  {
    slug: 'issues', kicker: '协同中心', title: '问题管理',
    description: '统一承接生产、计划和技术问题，支持创建、分派、处理、验证、附件和关闭闭环。',
    capabilityTitle: '已接入能力', capabilities: ['新建与异常转入', '分派与处理跟踪', '验证与关闭闭环'],
    links: [
      { label: '查看生产异常', description: '使用现有生产异常数据', href: '/production?view=exceptions' },
      { label: '返回协同首页', description: '查看当前真实待办事项', href: '/home' },
    ],
  },
  {
    slug: 'changes', kicker: '协同中心', title: '变更管理',
    description: '集中管理图纸、工艺、计划、物料和资料变更，覆盖影响评估、实施、验证、附件与审计闭环。',
    capabilityTitle: '已接入能力', capabilities: ['变更申请与影响评估', '实施与验证流转', '附件、记录与软删除'],
    links: [
      { label: '进入图纸资料库', description: '查看当前版本图纸', href: '/drawing-library' },
      { label: '进入计划中心', description: '查看订单排程与计划变更', href: '/weekly-plan-center' },
    ],
  },
  {
    slug: 'workflows', kicker: '协同中心', title: '流程中心',
    description: '统一查看问题闭环、变更闭环和生产工单状态流转，并回到来源业务继续处理。',
    capabilityTitle: '已接入能力', capabilities: ['真实流程实例汇总', '节点进度与逾期筛选', '来源业务回溯'],
    links: [
      { label: '查看生产执行', description: '使用现有工单状态流转', href: '/production' },
      { label: '查看操作日志', description: '进入现有操作记录', href: '/dashboard?openLogs=1' },
    ],
  },
  {
    slug: 'knowledge', kicker: '技术知识', title: '知识库',
    description: '统一检索图纸、参数、组装说明书、工艺与已验证经验，并沉淀可复用的现场知识。',
    capabilityTitle: '已接入资料', capabilities: ['跨模块统一检索', 'PDF 与图片预览', '经验知识与附件沉淀'],
    links: [
      { label: '图纸资料库', description: '长期图纸和工艺资料', href: '/drawing-library' },
      { label: '连接器参数', description: '连接器工艺参数查询', href: '/connector-parameters' },
      { label: '组装说明书', description: '版本、目录和文件预览', href: '/connector-assembly-manuals' },
    ],
  },
  {
    slug: 'reports', kicker: '数据分析', title: '报表中心',
    description: '统一汇总计划、技术和生产指标。当前首页展示真实概览，后续按确认口径增加专题报表。',
    capabilityTitle: '规划能力', capabilities: ['计划执行报表', '生产进度报表', '资料完整率报表'],
    links: [
      { label: '查看首页概览', description: '浏览当前真实指标', href: '/home' },
      { label: '查看生产执行', description: '浏览工单数量和阶段', href: '/production' },
    ],
  },
  {
    slug: 'organization', kicker: '基础管理', title: '组织架构',
    description: '预留公司、部门和人员结构入口。当前系统仍采用账号登录和共享数据模式。',
    capabilityTitle: '规划能力', capabilities: ['部门结构', '人员目录', '协作关系'],
    links: [{ label: '系统设置', description: '查看当前系统配置入口', href: '/dashboard?openSettings=1' }],
  },
  {
    slug: 'permissions', kicker: '基础管理', title: '权限管理',
    description: '保留未来权限能力入口。当前版本不启用角色权限，所有已登录账号继续共享同一套业务数据。',
    capabilityTitle: '当前原则', capabilities: ['登录后共享数据', '不区分业务角色', '不改变现有访问方式'],
    links: [{ label: '系统设置', description: '管理当前账号和系统设置', href: '/dashboard?openSettings=1' }],
  },
  {
    slug: 'initiated', kicker: '我的工作', title: '我发起的',
    description: '用于汇总当前账号发起的协同事项。账号归属模型尚未接入，当前不展示模拟记录。',
    capabilityTitle: '规划能力', capabilities: ['发起记录', '处理进度', '结果归档'],
    links: [{ label: '查看共享待办', description: '进入现有生产待处理事项', href: '/production?view=exceptions' }],
  },
  {
    slug: 'involved', kicker: '我的工作', title: '我参与的',
    description: '用于汇总当前账号参与的协同事项。当前保留入口，后续随人员协作模型一并接入。',
    capabilityTitle: '规划能力', capabilities: ['参与事项', '协作记录', '处理状态'],
    links: [{ label: '查看生产执行', description: '进入共享生产工作台', href: '/production' }],
  },
  {
    slug: 'copied', kicker: '我的工作', title: '抄送我的',
    description: '用于查看抄送给当前账号的事项。当前没有抄送数据模型，因此不显示虚假消息。',
    capabilityTitle: '规划能力', capabilities: ['抄送通知', '事项摘要', '已读状态'],
    links: [{ label: '返回首页', description: '查看当前业务概览', href: '/home' }],
  },
  {
    slug: 'following', kicker: '我的工作', title: '我关注的',
    description: '用于收藏和持续关注工单、图纸及问题。当前保留入口，后续接入关注关系。',
    capabilityTitle: '规划能力', capabilities: ['关注工单', '关注资料', '动态提醒'],
    links: [{ label: '全局搜索', description: '返回首页搜索现有资料', href: '/home' }],
  },
  {
    slug: 'messages', kicker: '消息协同', title: '消息中心',
    description: '预留部门通知和协同消息入口。当前系统没有消息数据模型，不展示模拟消息。',
    capabilityTitle: '规划能力', capabilities: ['部门通知', '业务提醒', '已读管理'],
    links: [{ label: '查看待办事项', description: '进入当前真实异常列表', href: '/production?view=exceptions' }],
  },
  {
    slug: 'help', kicker: '平台支持', title: '使用帮助',
    description: '统一说明杭连协同平台的模块入口。现有详细设置和诊断能力仍保留在系统设置中。',
    capabilityTitle: '现有入口', capabilities: ['首页全局搜索', '业务模块导航', '系统诊断与设置'],
    links: [
      { label: '系统设置', description: '安装、诊断和账号设置', href: '/dashboard?openSettings=1' },
      { label: '图纸资料库', description: '上传、预览和下载生产资料', href: '/drawing-library' },
    ],
  },
  {
    slug: 'more', kicker: '全部应用', title: '更多功能',
    description: '汇总杭连协同平台的业务模块与规划入口。已有模块保持真实可用，规划模块逐步补齐。',
    capabilityTitle: '平台模块', capabilities: ['计划中心', '技术资料', '生产执行'],
    links: [
      { label: '计划中心', description: '订单排程、下周预备与本周下达', href: '/weekly-plan-center' },
      { label: '生产执行中心', description: '阶段、数量和异常闭环', href: '/production' },
      { label: '知识库', description: '图纸、参数和说明书', href: '/workspace/knowledge' },
    ],
  },
];

export function getPlatformModule(slug: string): PlatformModuleDefinition | null {
  return modules.find(item => item.slug === slug) || null;
}
