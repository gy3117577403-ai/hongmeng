export interface ConnectorParameter {
  id: string;
  rowNo?: number | null;
  model?: string | null;
  outerPeelMm?: string | null;
  innerPeelMm?: string | null;
  insertionLengthMm?: string | null;
  remark?: string | null;
  isHighlighted: boolean;
  createdAt?: string;
  updatedAt?: string;
}
