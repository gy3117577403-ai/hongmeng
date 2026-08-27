'use client';
/* eslint-disable @next/next/no-img-element */
import { useState } from 'react';
import { ShieldAlert } from 'lucide-react';
import { EmployeeWarningLightbox } from '@/components/EmployeeWarningLightbox';
import type { loadEmployeeQualityWarning } from '@/lib/quality-warning-employee';
type View = NonNullable<Awaited<ReturnType<typeof loadEmployeeQualityWarning>>>['view'];
export default function EmployeeQualityWarning({ warning }: { warning: View }) {
  const [active, setActive] = useState<number | null>(null);
  const photos = warning.attachments.filter(item => item.mimeType.startsWith('image/'));
  const choose = (index: number) => { setActive((index + photos.length) % photos.length); };
  const fields = [['问题是什么', warning.defectPhenomenon || warning.warningSummary], ['已确认的原因', warning.rootCause || warning.occurrenceCause], ['具体解决方案', warning.correctiveAction], ['临时遏制', warning.containmentAction], ['防止再发', warning.preventiveAction], ['处理结论', warning.finalConclusion], ['本批必须注意', warning.requiredAction], ['检查方法', warning.inspectionMethod], ['检查频次', warning.inspectionFrequency], ['合格判定', warning.acceptanceCriteria], ['停止作业 / 升级条件', warning.stopConditions]].filter(([, value]) => value);
  return <main className="employee-warning"><header><ShieldAlert /><div><small>员工只读 · 已发布归档</small><h1>{warning.title}</h1><p>{warning.reportNo} · <b>R{warning.revisionNumber}</b></p></div></header>
    {warning.currentRevisionNumber > warning.revisionNumber && <section className="employee-revision-notice"><strong>这张纸对应旧版 R{warning.revisionNumber}，当前已有 R{warning.currentRevisionNumber}</strong><p>以下保留原版内容，不会悄悄替换工单指令。请向质量人员确认本批适用版本。</p></section>}
    <section className="employee-order"><b>{warning.products.join('、')}</b>{warning.workOrderCode && <p>本批工单：{warning.workOrderCode}</p>}{warning.applicableProcess && <p>适用工序：{warning.applicableProcess}</p>}<small>归档日期 {new Date(warning.archivedAt).toLocaleDateString('zh-CN')}</small></section>
    <nav className="employee-anchor"><a href="#employee-solution">问题与方案</a><a href="#employee-photos">完整图片 ({photos.length})</a></nav>
    <div id="employee-solution">{fields.map(([title, text]) => <section key={title} className={title === '具体解决方案' || title === '本批必须注意' ? 'emphasis' : ''}><h2>{title}</h2><p>{text}</p></section>)}</div>
    <section id="employee-photos"><h2>完整图片与附件</h2><p>点击照片全屏查看，可缩放、旋转和左右切换。</p><div className="employee-photo-grid">{photos.map((photo, index) => <button key={photo.id} onClick={() => choose(index)}><img src={photo.contentUrl} alt={photo.caption || photo.displayName} /><span>{index + 1}. {photo.caption || photo.displayName}</span></button>)}</div>{warning.attachments.filter(item => !item.mimeType.startsWith('image/')).map(file => <a className="employee-document" key={file.id} href={file.contentUrl} target="_blank" rel="noreferrer">查看附件 · {file.displayName}</a>)}</section>
    <footer>只读作业指引，不提供后台编辑权限。扫码查看不代表员工已实名确认或签字。</footer>
    {active !== null && photos[active] && <EmployeeWarningLightbox photos={photos} active={active} choose={choose} close={() => setActive(null)} />}
  </main>;
}
