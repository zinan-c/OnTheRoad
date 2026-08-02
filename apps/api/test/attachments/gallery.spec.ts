import { describe, expect, test } from "vitest";

import {
  AttachmentGalleryError,
  AttachmentGalleryService,
  InMemoryAttachmentGalleryRepository,
} from "../../src/modules/attachments/gallery.mjs";

const source = [
  { id: "a", ownerId: "owner", itemId: "item", status: "ready", sortOrder: 0, version: 1, caption: "", isCover: true },
  { id: "b", ownerId: "owner", itemId: "item", status: "processing", sortOrder: 1, version: 1, caption: "", isCover: false },
];

describe("D03 gallery contract", () => {
  test("lists visible attachments and updates caption/cover with CAS", () => {
    const service = new AttachmentGalleryService(new InMemoryAttachmentGalleryRepository(source));
    expect(service.list("owner", "item").map(({ id }) => id)).toEqual(["a", "b"]);
    expect(service.update("owner", "a", 1, { caption: "Arrival", isCover: false })).toMatchObject({ caption: "Arrival", isCover: false, version: 2 });
    expect(() => service.update("owner", "a", 1, { caption: "stale" })).toThrowError(AttachmentGalleryError);
  });

  test("rejects incomplete order and protects referenced deletion", () => {
    const service = new AttachmentGalleryService(new InMemoryAttachmentGalleryRepository([
      ...source,
      { id: "c", ownerId: "owner", itemId: "item", status: "ready", sortOrder: 2, version: 1, referenced: true },
    ]));
    expect(() => service.reorder("owner", "item", 1, ["a"])).toThrowError(AttachmentGalleryError);
    expect(() => service.remove("owner", "c")).toThrowError(AttachmentGalleryError);
  });
});
