import { describe, expect, test, vi } from "vitest";

import { fetchExternalMedia } from "@on-the-road/storage";

describe("TC-E09-02 SSRF, DNS rebinding and redirect contract", () => {
  test("blocks private addresses before issuing a request", async () => {
    const request = vi.fn();
    await expect(fetchExternalMedia("https://images.example.test/a.png", {
      fetch: request,
      lookup: async () => [{ address: "127.0.0.1", family: 4 }],
    })).rejects.toMatchObject({ code: "MEDIA_URL_PRIVATE_ADDRESS" });
    expect(request).not.toHaveBeenCalled();
  });

  test("rejects a DNS answer that changes during validation", async () => {
    const request = vi.fn();
    const lookup = vi.fn()
      .mockResolvedValueOnce([{ address: "93.184.216.34", family: 4 }])
      .mockResolvedValueOnce([{ address: "93.184.216.34", family: 4 }])
      .mockResolvedValueOnce([{ address: "169.254.169.254", family: 4 }]);
    await expect(fetchExternalMedia("https://images.example.test/a.png", {
      fetch: request,
      lookup,
    })).rejects.toMatchObject({ code: "MEDIA_URL_DNS_REBINDING" });
    expect(request).not.toHaveBeenCalled();
  });

  test("revalidates redirect destinations instead of following blindly", async () => {
    const request = vi.fn(async () => new Response(null, {
      status: 302,
      headers: { location: "https://metadata.example.test/latest.png" },
    }));
    const lookup = vi.fn()
      .mockResolvedValueOnce([{ address: "93.184.216.34", family: 4 }])
      .mockResolvedValueOnce([{ address: "93.184.216.34", family: 4 }])
      .mockResolvedValueOnce([{ address: "93.184.216.34", family: 4 }])
      .mockResolvedValue([{ address: "169.254.169.254", family: 4 }]);
    await expect(fetchExternalMedia("https://images.example.test/a.png", {
      fetch: request,
      lookup,
    })).rejects.toMatchObject({ code: "MEDIA_URL_PRIVATE_ADDRESS" });
    expect(request).toHaveBeenCalledTimes(1);
  });
});
