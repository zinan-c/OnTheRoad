import { TripCreateForm } from "../../../features/trips/trip-create-form";

export default function NewTripPage() {
  return (
    <main>
      <nav aria-label="主导航">
        <a className="brand" href="/">On The Road</a>
        <a className="newTrip" href="/trips">我的旅行</a>
      </nav>
      <section className="formPage">
        <p className="eyebrow">New journey</p>
        <h1>创建一段新旅程</h1>
        <p className="lead">先确定日期和目的地，系统会为每一天准备好可编辑的计划。</p>
        <TripCreateForm />
      </section>
    </main>
  );
}
