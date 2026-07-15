'use client';

import { ArrowLeft, ArrowUpRight, CheckCircle2, Clock3, Layers3 } from 'lucide-react';
import { AppWorkbenchHeader } from '@/components/layout/AppWorkbenchHeader';
import type { PlatformModuleDefinition } from '@/lib/platform-modules';
import type { CurrentUserDTO } from '@/types';

export default function PlannedModulePage({ module, user }: { module: PlatformModuleDefinition; user: CurrentUserDTO }) {
  async function logout(): Promise<void> {
    await fetch('/api/auth/logout', { method: 'POST' });
    location.href = '/login';
  }

  return (
    <main className="hm-workbench-root hm-platform-placeholder">
      <AppWorkbenchHeader
        user={user}
        activeHref={`/workspace/${module.slug}`}
        subtitle="计划 · 技术 · 生产高效闭环"
        menuItems={[
          { label: '系统设置', href: '/dashboard?openSettings=1' },
          { label: '退出登录', onSelect: logout },
        ]}
      />
      <div className="hm-platform-placeholder-body">
        <a className="hm-platform-back" href="/home"><ArrowLeft size={16} />返回协同首页</a>
        <section className="hm-platform-placeholder-hero">
          <div className="hm-platform-placeholder-mark"><Layers3 size={28} /></div>
          <div><span>{module.kicker}</span><h1>{module.title}</h1><p>{module.description}</p></div>
          <em><Clock3 size={14} />模块建设中</em>
        </section>
        <div className="hm-platform-placeholder-grid">
          <section className="hm-platform-placeholder-panel">
            <header><CheckCircle2 size={18} /><div><h2>{module.capabilityTitle}</h2><p>入口与页面框架已经完成</p></div></header>
            <ul>{module.capabilities.map(item => <li key={item}><span />{item}<small>待接入</small></li>)}</ul>
          </section>
          <section className="hm-platform-placeholder-panel">
            <header><ArrowUpRight size={18} /><div><h2>可用关联入口</h2><p>继续使用现有成熟业务模块</p></div></header>
            <div className="hm-platform-link-list">
              {module.links.map(link => <a href={link.href} key={`${link.href}:${link.label}`}><div><strong>{link.label}</strong><span>{link.description}</span></div><ArrowUpRight size={16} /></a>)}
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
