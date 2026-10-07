'use client';
import { FileText, RefreshCw } from 'lucide-react';
import { DrawingAssociationCell } from './ImportDrawingAssociation';
import type { ImportDrawingArchive } from '@/lib/import-drawing-association';
import type { PoolDrawingMatch } from '@/lib/order-pool-drawings';

export function PoolDrawingAssociation({ customerName, specification, drawing, busy, error, locked, disabled, onRetry, onPick, onOpenChange }: {
  customerName: string; specification: string; drawing?: PoolDrawingMatch | null; busy?: boolean; error?: string;
  locked?: boolean; disabled?: boolean; onRetry?: () => void; onPick: (item: ImportDrawingArchive) => void; onOpenChange: (open: boolean) => void;
}) {
  if (busy) return <div className="op-drawing-message" role="status"><RefreshCw size={17}/>正在匹配图纸资料…</div>;
  if (error) return <div className="op-drawing-message op-red" role="alert">{error}<button type="button" onClick={onRetry}>重试</button></div>;
  if (!drawing) return <div className="op-drawing-message"><FileText size={18}/>填写客户、规格后自动匹配</div>;
  if (drawing.matchStatus === 'BLOCKED') return <div className="op-drawing-blocked" role="alert"><strong>{drawing.message}</strong>{drawing.candidates.map(item => <small key={item.id}>档案 {item.libraryKey || item.id} · {item.specification}</small>)}{onRetry && <button type="button" onClick={onRetry}><RefreshCw size={14}/>重新匹配</button>}</div>;
  const archive = drawing.candidates.find(item => item.id === drawing.matchedItemId);
  return <div className="op-drawing-choice">
    <DrawingAssociationCell context="pool" pendingCount={drawing.candidates.length} customerName={customerName} specification={specification} archive={archive}
      pending={drawing.matchStatus === 'CONFIRM'} locked={locked} disabled={disabled} onPick={onPick} onOpenChange={onOpenChange}/>
  </div>;
}
