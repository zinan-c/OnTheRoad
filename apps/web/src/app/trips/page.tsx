import { TripList } from "./trip-list";
import { AuthGate } from "../../features/identity/auth-gate";

export default function TripsPage() {
  return (
    <main>
      <nav className="siteHeader" aria-label="Main navigation">
        <a className="brand" href="/">On The Road</a>
        <a className="newTrip" href="/trips/new">New trip</a>
      </nav>
      <AuthGate><TripList /></AuthGate>
    </main>
  );
}
