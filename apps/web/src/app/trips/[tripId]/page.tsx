import { TripDetail } from "./trip-detail";

export default async function TripPage({
  params,
}: {
  readonly params: Promise<{ tripId: string }>;
}) {
  const { tripId } = await params;
  return (
    <main>
      <nav aria-label="主导航">
        <a className="brand" href="/">On The Road</a>
        <a className="newTrip" href="/trips/new">新建旅行</a>
      </nav>
      <TripDetail tripId={tripId} />
    </main>
  );
}
