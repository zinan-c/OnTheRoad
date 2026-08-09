import { TripList } from "./trip-list";

export default function TripsPage() {
  return (
    <main>
      <nav aria-label="主导航">
        <a className="brand" href="/">On The Road</a>
        <a className="newTrip" href="/trips/new">新建旅行</a>
      </nav>
      <TripList />
    </main>
  );
}
