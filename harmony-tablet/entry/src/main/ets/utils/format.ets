export function displayName(primary?: string | null, fallback?: string | null): string {
  const name = primary && primary.trim().length > 0 ? primary : fallback;
  return name && name.trim().length > 0 ? name : '-';
}

export function fileSizeText(size?: number): string {
  const value = size || 0;
  if (value > 1024 * 1024) {
    return `${(value / 1024 / 1024).toFixed(1)} MB`;
  }
  if (value > 1024) {
    return `${(value / 1024).toFixed(1)} KB`;
  }
  return `${value} B`;
}

export function stageLabel(stage?: string): string {
  if (stage === 'frontend') return '在前端';
  if (stage === 'backend') return '在后端';
  if (stage === 'completed') return '已完成';
  return '未发图';
}

export function priorityLabel(priority?: string): string {
  if (priority === 'urgent') return '紧急';
  if (priority === 'high') return '高';
  return '一般';
}
