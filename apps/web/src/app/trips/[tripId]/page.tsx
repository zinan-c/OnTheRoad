import { TripDetail } from "./trip-detail";
import { AuthGate } from "../../../features/identity/auth-gate";

export default async function TripPage({
  params,
}: {
  readonly params: Promise<{ tripId: string }>;
}) {
  const { tripId } = await params;
  return (
    <main className="tripPageMain">
      <nav className="siteHeader" aria-label="Main navigation">
        <a className="brand" href="/">On The Road</a>
        <div className="actions siteHeaderActions">
          <a className="secondary" href="/trips">Trips</a>
          <a className="newTrip" href="/trips/new">New trip</a>
        </div>
      </nav>
      <AuthGate><TripDetail tripId={tripId} /></AuthGate>
    </main>
  );
}
