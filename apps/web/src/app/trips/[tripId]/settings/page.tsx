import { TripSettingsScreen } from "./trip-settings-screen";
import { AuthGate } from "../../../../features/identity/auth-gate";

export default async function TripSettingsPage({
  params,
}: {
  readonly params: Promise<{ tripId: string }>;
}) {
  const { tripId } = await params;
  return (
    <main>
      <nav className="siteHeader" aria-label="Main navigation">
        <a className="brand" href="/">On The Road</a>
        <div className="actions siteHeaderActions">
          <a className="secondary" href={`/trips/${tripId}`}>Back to itinerary</a>
          <a className="secondary" href="/trips">Trips</a>
        </div>
      </nav>
      <AuthGate><TripSettingsScreen tripId={tripId} /></AuthGate>
    </main>
  );
}
