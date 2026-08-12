'use client';

import type { ReactNode } from 'react';

type WorkbenchCockpitCommandProps = {
  navigationTargetId: string;
  icon: ReactNode;
  title: string;
  subtitle: string;
  context?: ReactNode;
  search?: ReactNode;
  actions?: ReactNode;
  className?: string;
};

export function WorkbenchCockpitCommand({
  navigationTargetId,
  icon,
  title,
  subtitle,
  context,
  search,
  actions,
  className = '',
}: WorkbenchCockpitCommandProps) {
  return (
    <section className={`hm-cockpit-command ${className}`.trim()} aria-label={`${title}命令栏`}>
      <span className="hm-cockpit-navigation-trigger" id={navigationTargetId} aria-label="平台导航入口" />
      <div className="hm-cockpit-title">
        <span className="hm-cockpit-title-icon" aria-hidden="true">{icon}</span>
        <div><h1>{title}</h1><small>{subtitle}</small></div>
      </div>
      {context && <div className="hm-cockpit-context" aria-label="当前工作状态">{context}</div>}
      {search && <div className="hm-cockpit-search">{search}</div>}
      {actions && <div className="hm-cockpit-actions" aria-label="页面操作">{actions}</div>}
    </section>
  );
}
