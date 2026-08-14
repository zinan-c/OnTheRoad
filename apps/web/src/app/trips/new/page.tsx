import { TripCreateForm } from "../../../features/trips/trip-create-form";

export default function NewTripPage() {
  return (
    <main>
      <nav className="siteHeader" aria-label="Main navigation">
        <a className="brand" href="/">On The Road</a>
        <a className="newTrip" href="/trips">My trips</a>
      </nav>
      <section className="formPage">
        <p className="eyebrow">New journey</p>
        <h1>Create a new journey</h1>
        <p className="lead">Choose the dates and destinations, and an editable plan will be prepared for every day.</p>
        <TripCreateForm />
      </section>
    </main>
  );
}
