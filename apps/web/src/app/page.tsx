import { CapabilityStatus } from "./capability-status";

const features = [
  ["按天规划", "把景点、餐饮、住宿和交通放进同一条清晰时间线。"],
  ["地图联动", "确认地点后，按行程顺序查看每天的 Marker 与移动轨迹。"],
  ["完整带走", "导入 Excel，整理费用与图片，并导出适合分享的攻略。"],
] as const;

export default function HomePage() {
  return (
    <main>
      <nav aria-label="主导航">
        <a className="brand" href="/">On The Road</a>
        <a className="newTrip" href="/trips/new">新建旅行</a>
      </nav>
      <section className="hero">
        <p className="eyebrow">把一路的期待，变成每天都能出发的计划</p>
        <h1>下一段旅程，从一张真正好用的攻略开始。</h1>
        <p className="lead">
          多目的地、多天行程、地图路线、图片与费用，集中在一个可以持续编辑的旅行空间。
        </p>
        <div className="actions">
          <a className="primary" href="/trips/new">创建我的旅行</a>
          <a className="secondary" href="/trips">查看旅行</a>
        </div>
        <CapabilityStatus />
      </section>
      <section className="featureGrid" aria-label="核心能力">
        {features.map(([title, description]) => (
          <article key={title}>
            <h2>{title}</h2>
            <p>{description}</p>
          </article>
        ))}
      </section>
    </main>
  );
}
