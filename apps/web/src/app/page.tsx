import { CapabilityStatus } from "./capability-status";

const features = [
  ["Plan by day", "Keep attractions, dining, accommodation, and transport in one clear timeline."],
  ["Map in sync", "Select a day to focus the map on that day's confirmed places and routes."],
  ["Stay on budget", "Track expenses and exchange rates alongside the itinerary."],
] as const;

export default function HomePage() {
  return (
    <main>
      <nav className="siteHeader" aria-label="Main navigation">
        <a className="brand" href="/">On The Road</a>
        <a className="newTrip" href="/trips/new">New trip</a>
      </nav>
      <section className="hero">
        <p className="eyebrow">Turn travel ideas into a plan you can follow every day</p>
        <h1>Your next journey starts with a plan that actually works.</h1>
        <p className="lead">
          Plan multiple destinations and days, keep routes aligned with the itinerary, and track expenses in one editable workspace.
        </p>
        <div className="actions">
          <a className="primary" href="/trips/new" data-testid="create-trip-link">Create a trip</a>
          <a className="secondary" href="/trips">View trips</a>
        </div>
        <CapabilityStatus />
      </section>
      <section className="featureGrid" aria-label="Core features">
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
