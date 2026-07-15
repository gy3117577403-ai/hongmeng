export type HomeTone = 'orange' | 'blue' | 'green' | 'yellow' | 'red' | 'slate';

export type HomePriority = 'urgent' | 'high' | 'normal';

export type HomeKpi = {
  id: string;
  label: string;
  value: number | null;
  description: string;
  route: string;
  tone: HomeTone;
  icon: string;
};

export type HomeActionItem = {
  id: string;
  workOrderId: string;
  sourceModule: '生产执行';
  type: string;
  title: string;
  subtitle: string;
  customerName: string;
  specification: string;
  priority: HomePriority;
  status: string;
  occurredAt: string;
  dateLabel: string;
  targetRoute: string;
};

export type HomeTimelineItem = {
  id: string;
  type: string;
  title: string;
  source: string;
  status: string;
  dateLabel: string;
  targetRoute: string;
};

export type HomeDistributionItem = {
  id: string;
  label: string;
  value: number;
  tone: HomeTone;
};

export type HomePlanChart = {
  total: number;
  completed: number;
  inProgress: number;
  notStarted: number;
  overdue: number;
  executionRate: number | null;
};

export type HomeCollaborationNode = {
  id: string;
  label: string;
  value: number;
  description: string;
  route: string;
  tone: HomeTone;
};

export type HomeDashboardData = {
  generatedAt: string;
  dateLabel: string;
  greeting: string;
  periodLabel: string;
  weekStartDate: string | null;
  weekEndDate: string | null;
  error: string | null;
  kpis: HomeKpi[];
  actionItems: HomeActionItem[];
  todayNodes: HomeTimelineItem[];
  issues: HomeActionItem[];
  planChart: HomePlanChart;
  stageDistribution: HomeDistributionItem[];
  technicalDistribution: HomeDistributionItem[];
  collaboration: HomeCollaborationNode[];
};
