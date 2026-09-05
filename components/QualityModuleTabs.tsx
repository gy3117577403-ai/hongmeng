'use client';

import { FileArchive, LayoutDashboard, ShieldAlert } from 'lucide-react';
import Link from 'next/link';
import styles from './QualityModuleTabs.module.css';

type QualityModuleTabsProps = {
  active: 'overview' | 'internal-risks' | 'eight-d';
  riskCount?: number;
  eightDCount?: number;
  canViewData?: boolean;
};

export function QualityModuleTabs({ active, riskCount, eightDCount, canViewData = false }: QualityModuleTabsProps) {
  const items = [
    { key: 'overview' as const, href: '/workspace/quality', label: '质量总览', icon: LayoutDashboard, count: undefined },
    { key: 'internal-risks' as const, href: '/workspace/quality/internal-risks', label: '内部重大异常', icon: ShieldAlert, count: riskCount },
    { key: 'eight-d' as const, href: '/workspace/quality/8d', label: '8D PDF档案', icon: FileArchive, count: eightDCount },
  ];
  return <nav className={styles.tabs} aria-label="质量管理模块">
    {canViewData && <Link href="/workspace/quality/data"><FileArchive size={14}/>质量数据</Link>}
    {items.map(item => {
      const Icon = item.icon;
      return <Link className={active === item.key ? styles.active : ''} href={item.href} key={item.key} aria-current={active === item.key ? 'page' : undefined}>
        <Icon size={14} />{item.label}{typeof item.count === 'number' && <span>{item.count}</span>}
      </Link>;
    })}
  </nav>;
}
