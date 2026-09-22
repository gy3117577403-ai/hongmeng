'use client';
import type { ReactNode } from 'react';
import { SampleDialog } from './SampleBranchControls';
export function SamplePlanningDetail({planning,open,onClose,children,title='样品试制',navigation}:{planning:boolean;open:boolean;onClose:()=>void;children:ReactNode;title?:string;navigation?:ReactNode}) {
 if(!planning)return <>{children}</>;
 if(!open)return null;
 return <SampleDialog wide title={title} onClose={onClose} headerActions={navigation}>{children}</SampleDialog>;
}
