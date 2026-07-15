import type { ReactNode } from 'react';

type WorkbenchPageHeaderProps = {
  kicker: string;
  title: string;
  description: string;
  titleId: string;
  actions?: ReactNode;
  className?: string;
  actionsClassName?: string;
};

export function WorkbenchPageHeader({ kicker, title, description, titleId, actions, className = '', actionsClassName = '' }: WorkbenchPageHeaderProps) {
  return (
    <section className={`hm-workbench-page-header ${className}`.trim()} aria-labelledby={titleId}>
      <div className="hm-workbench-page-heading">
        <span className="hm-workbench-page-kicker">{kicker}</span>
        <div className="hm-workbench-page-copy"><h1 id={titleId}>{title}</h1><p>{description}</p></div>
      </div>
      {actions && <div className={`hm-workbench-page-actions ${actionsClassName}`.trim()} aria-label="页面操作">{actions}</div>}
    </section>
  );
}
