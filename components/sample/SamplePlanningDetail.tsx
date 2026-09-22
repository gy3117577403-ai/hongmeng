'use client';
import type { ReactNode } from 'react';
import { SampleDialog } from './SampleBranchControls';
export function SamplePlanningDetail({planning,open,onClose,children}:{planning:boolean;open:boolean;onClose:()=>void;children:ReactNode}) {
 if(!planning)return <>{children}</>;
 if(!open)return null;
 return <SampleDialog wide title="样品任务" onClose={onClose}>{children}</SampleDialog>;
}
