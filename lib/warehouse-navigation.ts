export type WarehouseWorkbenchNavigation = {
  taskId: string;
  scope: 'current' | 'open' | 'preparation' | 'history';
  week: string;
  status: 'all' | 'active' | 'pending' | 'exception' | 'waiting' | 'unassigned' | 'completed';
  source: 'ALL' | 'PURCHASED' | 'CUSTOMER' | 'UNKNOWN';
  overdue: boolean;
  query: string;
  page: number;
};

export function warehouseWorkbenchStateFromSearch(search: string): WarehouseWorkbenchNavigation {
  const params = new URLSearchParams(search);
  const taskId = params.get('taskId')?.trim() || '';
  const rawScope = params.get('scope');
  const rawStatus = params.get('status');
  const rawSource = params.get('source');
  const rawPage = Number(params.get('page'));
  return {
    taskId,
    scope: rawScope === 'current' || rawScope === 'preparation' || rawScope === 'history' ? rawScope : 'open',
    week: params.get('weekStart') || '',
    // A direct task link must show its detail even if it is not in the pending queue.
    status: rawStatus === 'all' || rawStatus === 'active' || rawStatus === 'pending' || rawStatus === 'exception' || rawStatus === 'waiting' || rawStatus === 'unassigned' || rawStatus === 'completed'
      ? rawStatus
      : taskId ? 'all' : 'active',
    source: rawSource === 'PURCHASED' || rawSource === 'CUSTOMER' || rawSource === 'UNKNOWN' ? rawSource : 'ALL',
    overdue: params.get('expected') === 'overdue',
    query: params.get('keyword') || '',
    page: Number.isInteger(rawPage) && rawPage > 0 ? rawPage : 1,
  };
}

export function warehouseWorkbenchPath(state: WarehouseWorkbenchNavigation): string {
  const params = new URLSearchParams();
  if (state.taskId) params.set('taskId', state.taskId);
  if (state.scope !== 'open') params.set('scope', state.scope);
  if (state.week && ['history', 'preparation'].includes(state.scope)) params.set('weekStart', state.week);
  // Keep the status explicit when a task id is present so a refresh restores the same queue.
  if (state.status !== 'active' || state.taskId) params.set('status', state.status);
  if (state.source !== 'ALL') params.set('source', state.source);
  if (state.overdue) params.set('expected', 'overdue');
  if (state.query) params.set('keyword', state.query);
  if (state.page > 1) params.set('page', String(state.page));
  const query = params.toString();
  return `/workspace/warehouse${query ? `?${query}` : ''}`;
}
