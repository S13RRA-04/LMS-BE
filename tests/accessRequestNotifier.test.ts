import { afterEach, describe, expect, it, vi } from "vitest";
import { ResendAccessRequestNotifier } from "../src/notifications/accessRequestNotifier.js";
import type { AppConfig } from "../src/config/config.js";

const config = {
  resendApiKey: "test-resend-key",
  emailFrom: "no-reply@cetu.online",
  accessRequestAdminEmail: "admin@cetu.online"
} as AppConfig;

const accessRequest = {
  id: "request-1",
  name: "Pending Learner",
  email: "pending@example.test",
  emailNormalized: "pending@example.test",
  status: "pending" as const,
  requestedAt: "2026-05-14T00:00:00.000Z",
  updatedAt: "2026-05-14T00:00:00.000Z"
};

describe("Resend access request notifier", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends submitted access request notifications to the configured admin mailbox", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await new ResendAccessRequestNotifier(config).accessRequestSubmitted({ accessRequest });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.resend.com/emails",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authorization: "Bearer test-resend-key" }),
        body: expect.stringContaining("admin@cetu.online")
      })
    );
  });
});
