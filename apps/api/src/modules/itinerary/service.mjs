// @ts-nocheck
import {
  assertItineraryId,
  assertItineraryOwner,
  assertItineraryVersion,
  normalizeItineraryCreate,
  normalizeItineraryPatch,
} from "../../../../../packages/domain/src/itinerary/index.mjs";

function encryptValue(cipher, value, context, prefix) {
  const encrypted = cipher.encrypt(value, context);
  return {
    [`${prefix}Ciphertext`]: encrypted.ciphertext,
    [`${prefix}KeyVersion`]: encrypted.keyVersion,
  };
}

export class ItineraryService {
  constructor(repository, cipher) {
    if (!repository || typeof repository !== "object") {
      throw new TypeError("repository is required");
    }
    if (!cipher) throw new TypeError("cipher is required");
    this.repository = repository;
    this.cipher = cipher;
  }

  normalizeCreate(input) {
    return normalizeItineraryCreate(input);
  }

  async create(ownerId, tripId, input) {
    const owner = assertItineraryOwner(ownerId);
    const trip = assertItineraryId(tripId, "tripId");
    const normalized = normalizeItineraryCreate(input);
    const stored = await this.repository.create(
      owner,
      trip,
      this.#encryptInput(normalized),
    );
    return this.#decryptRecord(stored);
  }

  async get(ownerId, tripId, itemId, options = {}) {
    const stored = await this.repository.get(
      assertItineraryOwner(ownerId),
      assertItineraryId(tripId, "tripId"),
      assertItineraryId(itemId),
      options,
    );
    return this.#decryptRecord(stored);
  }

  async listDay(ownerId, tripId, tripDayId) {
    const stored = await this.repository.listDay(
      assertItineraryOwner(ownerId),
      assertItineraryId(tripId, "tripId"),
      assertItineraryId(tripDayId, "tripDayId"),
    );
    return stored.map((item) => this.#decryptRecord(item));
  }

  async update(ownerId, tripId, itemId, patch, { expectedVersion }) {
    const owner = assertItineraryOwner(ownerId);
    const trip = assertItineraryId(tripId, "tripId");
    const item = assertItineraryId(itemId);
    const version = assertItineraryVersion(expectedVersion);
    const current = await this.get(owner, trip, item);
    const normalizedPatch = normalizeItineraryPatch(patch);
    const merged = normalizeItineraryCreate({
      ...current,
      ...normalizedPatch,
      tripDayId: current.tripDayId,
    });
    const stored = await this.repository.update(
      owner,
      trip,
      item,
      version,
      this.#encryptInput(merged),
    );
    return this.#decryptRecord(stored);
  }

  async delete(ownerId, tripId, itemId, { expectedVersion }) {
    const stored = await this.repository.delete(
      assertItineraryOwner(ownerId),
      assertItineraryId(tripId, "tripId"),
      assertItineraryId(itemId),
      assertItineraryVersion(expectedVersion),
    );
    return this.#decryptRecord(stored);
  }

  async copy(ownerId, tripId, itemId, targetTripDayId) {
    const stored = await this.repository.copy(
      assertItineraryOwner(ownerId),
      assertItineraryId(tripId, "tripId"),
      assertItineraryId(itemId),
      assertItineraryId(targetTripDayId, "targetTripDayId"),
    );
    return this.#decryptRecord(stored);
  }

  #encryptInput(input) {
    const accommodation = input.accommodation
      ? {
          ...input.accommodation,
          ...encryptValue(
            this.cipher,
            input.accommodation.bookingInfo,
            "itinerary:accommodation:booking",
            "bookingInfo",
          ),
          ...encryptValue(
            this.cipher,
            input.accommodation.contactInfo,
            "itinerary:accommodation:contact",
            "contactInfo",
          ),
        }
      : null;
    if (accommodation) {
      delete accommodation.bookingInfo;
      delete accommodation.contactInfo;
    }
    const encrypted = {
      ...input,
      ...encryptValue(
        this.cipher,
        input.bookingInfo,
        "itinerary:item:booking",
        "bookingInfo",
      ),
      ...encryptValue(
        this.cipher,
        input.contactInfo,
        "itinerary:item:contact",
        "contactInfo",
      ),
      accommodation,
    };
    delete encrypted.bookingInfo;
    delete encrypted.contactInfo;
    return encrypted;
  }

  #decryptRecord(stored) {
    const {
      bookingInfoCiphertext,
      bookingInfoKeyVersion,
      contactInfoCiphertext,
      contactInfoKeyVersion,
      ...record
    } = stored;
    const accommodation = record.accommodation
      ? this.#decryptAccommodation(record.accommodation)
      : null;
    return {
      ...record,
      bookingInfo: this.cipher.decrypt(
        bookingInfoCiphertext,
        bookingInfoKeyVersion,
        "itinerary:item:booking",
      ),
      contactInfo: this.cipher.decrypt(
        contactInfoCiphertext,
        contactInfoKeyVersion,
        "itinerary:item:contact",
      ),
      accommodation,
    };
  }

  #decryptAccommodation(stored) {
    const {
      bookingInfoCiphertext,
      bookingInfoKeyVersion,
      contactInfoCiphertext,
      contactInfoKeyVersion,
      ...accommodation
    } = stored;
    return {
      ...accommodation,
      bookingInfo: this.cipher.decrypt(
        bookingInfoCiphertext,
        bookingInfoKeyVersion,
        "itinerary:accommodation:booking",
      ),
      contactInfo: this.cipher.decrypt(
        contactInfoCiphertext,
        contactInfoKeyVersion,
        "itinerary:accommodation:contact",
      ),
    };
  }
}
