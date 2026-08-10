import { TripList } from "./trip-list";

export default function TripsPage() {
  return (
    <main>
      <nav aria-label="Main navigation">
        <a className="brand" href="/">On The Road</a>
        <a className="newTrip" href="/trips/new">New trip</a>
      </nav>
      <TripList />
    </main>
  );
}
