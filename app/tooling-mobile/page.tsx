import { requireMobileSession } from '@/lib/page-access';
import { hasCapability } from '@/lib/department-access';
import ToolingOperations from '@/components/tooling/ToolingOperations';
import '../workspace/terminal-tooling/tooling-operations.css';
import '../workspace/terminal-tooling/tooling-molds.css';
import '../workspace/terminal-tooling/terminal-blade-editor.css';
export const dynamic = 'force-dynamic';
export const metadata = {title:'手机端子调模 · 杭连',description:'查刀片位置，记录调模与协助工时'};
export default async function ToolingMobile({searchParams}:{searchParams:Record<string,string|undefined>}){
  const box=Number(searchParams.box),next='/tooling-mobile'+(box>=1&&box<=100?'?box='+box:'');
  const user=await requireMobileSession(next);
  if(!hasCapability(user.access,'TERMINAL_TOOLING','READ')) return <main className="tl-access"><div className="tl-logo">杭</div><h1>手机端子调模</h1><p>{user.displayName}，当前账号尚未开通此模块。</p><p>请联系人事，在业务模块授权中开通“技术与资料”。查询用只读权限，扫码计时需要协同权限。</p><a className="tl-button tl-primary" href={next}>权限开通后重新进入</a><a href={'/login?next='+encodeURIComponent(next)}>切换登录账号</a></main>;
  return <ToolingOperations user={user} mobile initialBox={box>=1&&box<=100?box:undefined}/>;
}
