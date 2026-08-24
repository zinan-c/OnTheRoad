import { ChangePasswordForm } from "./change-password-form";

export default function ChangePasswordPage() {
  return (
    <main>
      <nav className="siteHeader" aria-label="Main navigation">
        <a className="brand" href="/">On The Road</a>
      </nav>
      <section className="authPage">
        <p className="eyebrow">Account security</p>
        <h1>设置新密码</h1>
        <p className="lead">为了保护行程数据，请先替换初始化密码。</p>
        <ChangePasswordForm />
      </section>
    </main>
  );
}
