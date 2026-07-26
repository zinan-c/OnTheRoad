const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export function validateMinimalFiveDay(fixture) {
  const errors = [];
  if (fixture?.fixtureVersion !== "minimal-five-day@1") errors.push("unexpected fixture version");
  if (fixture?.schemaVersion !== 1) errors.push("unexpected schema version");
  if (!fixture?.trip || fixture.trip.days?.length !== 5) errors.push("trip must contain five days");

  const ids = new Set();
  for (const location of fixture?.locations ?? []) {
    if (ids.has(location.id)) errors.push(`duplicate location: ${location.id}`);
    ids.add(location.id);
    if (location.crs !== "WGS84") errors.push(`non-WGS84 location: ${location.id}`);
    if (!Number.isFinite(location.longitude) || location.longitude < -180 || location.longitude > 180) {
      errors.push(`invalid longitude: ${location.id}`);
    }
    if (!Number.isFinite(location.latitude) || location.latitude < -90 || location.latitude > 90) {
      errors.push(`invalid latitude: ${location.id}`);
    }
  }

  const dayIds = new Set();
  let previousDate;
  for (const [index, day] of (fixture?.trip?.days ?? []).entries()) {
    dayIds.add(day.id);
    if (day.dayNumber !== index + 1) errors.push(`invalid day number: ${day.id}`);
    if (!ISO_DATE.test(day.date)) errors.push(`invalid date: ${day.id}`);
    const currentDate = Date.parse(`${day.date}T00:00:00Z`);
    if (previousDate !== undefined && currentDate - previousDate !== 86_400_000) {
      errors.push(`non-consecutive date: ${day.id}`);
    }
    previousDate = currentDate;
    for (const item of day.items ?? []) {
      if (!ids.has(item.locationId)) errors.push(`unknown item location: ${item.id}`);
      if (!TIME.test(item.startTime) || !TIME.test(item.endTime) || item.startTime >= item.endTime) {
        errors.push(`invalid item time: ${item.id}`);
      }
    }
  }

  for (const route of fixture?.routes ?? []) {
    if (!dayIds.has(route.dayId)) errors.push(`unknown route day: ${route.id}`);
    if (!ids.has(route.fromLocationId) || !ids.has(route.toLocationId)) {
      errors.push(`unknown route endpoint: ${route.id}`);
    }
  }
  return errors;
}
