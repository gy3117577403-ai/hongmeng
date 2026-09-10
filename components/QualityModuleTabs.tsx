'use client';

import { FileArchive, LayoutDashboard, ShieldAlert } from 'lucide-react';
import Link from 'next/link';
import styles from './QualityModuleTabs.module.css';

type QualityModuleTabsProps = {
  active: 'overview' | 'internal-risks' | 'eight-d' | 'quick';
  riskCount?: number;
  eightDCount?: number;
  canViewData?: boolean;
  canViewQuick?: boolean;
};

export function QualityModuleTabs({ active, riskCount, eightDCount, canViewData = false, canViewQuick = true }: QualityModuleTabsProps) {
  const items = [
    { key: 'overview' as const, href: '/workspace/quality', label: '质量总览', icon: LayoutDashboard, count: undefined },
    { key: 'internal-risks' as const, href: '/workspace/quality/internal-risks', label: '内部重大异常', icon: ShieldAlert, count: riskCount },
    { key: 'eight-d' as const, href: '/workspace/quality/8d', label: '8D PDF档案', icon: FileArchive, count: eightDCount },
    { key: 'quick' as const, href: '/workspace/quality/quick', label: '异常快处', icon: ShieldAlert, count: undefined },
  ];
  return <nav className={styles.tabs} aria-label="质量管理模块">
    {canViewData && <Link href="/workspace/quality/data"><FileArchive size={14}/>质量数据</Link>}
    {items.filter(item=>item.key!=='quick'||canViewQuick).map(item => {
      const Icon = item.icon;
      return <Link className={active === item.key ? styles.active : ''} href={item.href} key={item.key} aria-current={active === item.key ? 'page' : undefined}>
        <Icon size={14} />{item.label}{typeof item.count === 'number' && <span>{item.count}</span>}
      </Link>;
    })}
  </nav>;
}
