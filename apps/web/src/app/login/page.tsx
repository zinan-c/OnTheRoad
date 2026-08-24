import { LoginForm } from "./login-form";

export default function LoginPage() {
  return (
    <main>
      <nav className="siteHeader" aria-label="Main navigation">
        <a className="brand" href="/">On The Road</a>
      </nav>
      <section className="authPage">
        <p className="eyebrow">Private workspace</p>
        <h1>登录 On The Road</h1>
        <p className="lead">使用管理员账号继续管理你的旅行计划。</p>
        <LoginForm />
      </section>
    </main>
  );
}
