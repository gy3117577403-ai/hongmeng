import { ArrowRight, KeyRound, QrCode } from 'lucide-react';
import './field-terminal.css';

export default function FieldTerminalPage() {
  return (
    <main className="field-terminal-page">
      <header className="field-terminal-header">
        <span className="field-terminal-brand">杭</span>
        <div>
          <small>生产现场</small>
          <strong>扫码报工</strong>
        </div>
        <em><KeyRound />员工编号与密码登录</em>
      </header>

      <section className="field-terminal-hero">
        <div>
          <span><QrCode /></span>
          <small>共享终端功能已停用</small>
          <h1>请先使用员工账号登录，再扫描原工单二维码报工</h1>
          <p>员工编号仍是登录账号，原有工单二维码无需重印。登录后扫码，系统会按当前员工账号记录报工身份。</p>
        </div>
        <ol>
          <li><b>1</b><span><strong>使用员工编号和密码登录</strong><small>临时密码由管理员维护</small></span></li>
          <li><b>2</b><span><strong>扫描原流转单二维码</strong><small>直接进入对应工单</small></span></li>
          <li><b>3</b><span><strong>核对工序并提交报工</strong><small>记录关联当前登录员工</small></span></li>
        </ol>
      </section>

      <section className="field-terminal-grid">
        <article className="field-terminal-card">
          <header><span><KeyRound /></span><div><small>员工入口</small><strong>前往账号登录</strong></div></header>
          <p>共享终端注册和 PIN 验证已停止使用。请勿继续通过旧的终端绑定页面配置设备。</p>
          <a className="field-terminal-primary-link" href="/login"><KeyRound />使用员工编号和密码登录 <ArrowRight /></a>
        </article>

        <article className="field-terminal-card ticket">
          <header><span><QrCode /></span><div><small>工单二维码</small><strong>原二维码继续有效</strong></div></header>
          <div className="field-terminal-scan"><QrCode /><strong>登录后使用相机扫码</strong><small>若扫码时尚未登录，系统会先跳转登录，成功后自动返回该工单。</small></div>
        </article>
      </section>
    </main>
  );
}
