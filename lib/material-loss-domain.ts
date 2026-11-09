export const lossStatuses = { DRAFT: '草稿', PENDING: '待审批', RETURNED: '已退回', APPROVED: '已通过', WITHDRAWN: '已撤回' } as const;
export const lossCategories = ['工艺调试', '生产操作', '搬运仓储', '盘点差异', '其他'] as const;
export const replenishmentStatuses: Record<string, string> = { PENDING: '待补料', IN_PROGRESS: '补料中', COMPLETED: '补料已完成' };
export class MaterialLossError extends Error {
  constructor(message: string, public statusCode = 400) { super(message); }
}
export function lossText(value: unknown, max: number, label: string) {
  if (value != null && typeof value !== 'string') throw new MaterialLossError(`${label}格式不正确`);
  const text = String(value || '').trim();
  if (text.length > max) throw new MaterialLossError(`${label}最多 ${max} 字`);
  return text;
}
export function lossQuantity(value: unknown, optional = false, allowZero = false): string | null {
  if (value == null || value === '') {
    if (optional) return null;
    throw new MaterialLossError('请填写数量');
  }
  if (!['string', 'number'].includes(typeof value) || !/^\d+(?:\.\d{1,6})?$/.test(String(value))) throw new MaterialLossError('数量须为正数，最多 6 位小数，且小于一万亿');
  const [whole, fraction = ''] = String(value).split('.'), integer = whole.replace(/^0+(?=\d)/, ''), decimal = fraction.replace(/0+$/, '');
  if (integer.length > 12 || !allowZero && integer === '0' && !decimal) throw new MaterialLossError('数量须为正数，最多 6 位小数，且小于一万亿');
  // Keep all six decimal places exact, including values beyond JS float precision.
  return integer + (decimal ? '.' + decimal : '');
}
export function lossDay(value: unknown, label: string): Date | null {
  if (value == null || value === '') return null;
  const day = String(value), date = new Date(`${day}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== day) throw new MaterialLossError(`${label}日期不正确`);
  return date;
}
export function lossFields(input: Record<string, unknown>, submit = false) {
  const data = {
    materialName: lossText(input.materialName, 120, '物料名称'), materialModel: lossText(input.materialModel, 160, '规格型号'),
    unit: lossText(input.unit, 12, '单位'), supplySource: lossText(input.supplySource, 20, '物料来源') || 'PURCHASED',
    quantity: lossQuantity(input.quantity, !submit), occurredOn: lossDay(input.occurredOn, '损耗'),
    category: lossText(input.category, 30, '原因分类') || '其他', reason: lossText(input.reason, 2000, '损耗原因'),
    affectsKitting: input.affectsKitting === true, needReplenishment: input.needReplenishment === true,
    replenishmentQuantity: input.needReplenishment === true ? lossQuantity(input.replenishmentQuantity, !submit) : null,
    expectedOn: input.needReplenishment === true ? lossDay(input.expectedOn, '补料期望') : null,
    correctionReason: lossText(input.correctionReason, 600, '更正原因'),
  };
  if (!['PURCHASED', 'CUSTOMER'].includes(data.supplySource)) throw new MaterialLossError('请选择采购物料或客供物料');
  if (!(lossCategories as readonly string[]).includes(data.category)) throw new MaterialLossError('原因分类不正确');
  if (data.occurredOn && data.occurredOn.toISOString().slice(0, 10) > new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date())) throw new MaterialLossError('损耗日期不能晚于今天');
  if (submit && (!data.materialName || !data.materialModel || !data.unit || !data.occurredOn || !data.reason)) throw new MaterialLossError('请填写物料名称、规格型号、单位、损耗日期和具体原因');
  return data;
}
export function lossCsvCell(value: unknown) {
  const text = String(value ?? '');
  return '"' + (/^[\s]*[=+@\-\t\r]/.test(text) ? "'" : '') + text.replace(/"/g, '""') + '"';
}
