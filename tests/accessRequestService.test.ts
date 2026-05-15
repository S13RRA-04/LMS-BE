import { describe, expect, it, vi } from "vitest";
import { AccessRequestService } from "../src/users/accessRequestService.js";
import type { AdminUserService } from "../src/users/adminUserService.js";
import type { MongoAccessRequestRepository } from "../src/users/mongoAccessRequestRepository.js";

const actor = { id: "admin-user", role: "admin" as const, roles: ["admin" as const], permissions: [] };
const pendingRequest = {
  id: "request-1",
  name: "Pending Learner",
  email: "pending@example.test",
  emailNormalized: "pending@example.test",
  status: "pending" as const,
  requestedAt: "2026-05-14T00:00:00.000Z",
  updatedAt: "2026-05-14T00:00:00.000Z"
};

describe("LMS access requests", () => {
  it("stores public access requests without provisioning a user", async () => {
    const requests = { create: vi.fn().mockResolvedValue(pendingRequest) };
    const adminUsers = { createUser: vi.fn() };
    const auditLogs = { record: vi.fn().mockResolvedValue(undefined) };
    const service = new AccessRequestService(
      requests as unknown as MongoAccessRequestRepository,
      adminUsers as unknown as AdminUserService,
      auditLogs as never
    );

    const result = await service.submit("request-public", { name: "Pending Learner", email: "Pending@Example.Test" });

    expect(requests.create).toHaveBeenCalledWith({ name: "Pending Learner", email: "Pending@Example.Test" });
    expect(adminUsers.createUser).not.toHaveBeenCalled();
    expect(auditLogs.record).toHaveBeenCalledWith(expect.objectContaining({ action: "access_request.create" }));
    expect(result).toEqual(pendingRequest);
  });

  it("approves pending requests by creating a normal managed LMS user", async () => {
    const approvedRequest = { ...pendingRequest, status: "approved" as const, approvedUserId: "user-1" };
    const requests = {
      getById: vi.fn().mockResolvedValue(pendingRequest),
      approve: vi.fn().mockResolvedValue(approvedRequest)
    };
    const adminUsers = {
      createUser: vi.fn().mockResolvedValue({
        id: "user-1",
        email: "pending@example.test",
        role: "learner"
      })
    };
    const auditLogs = { record: vi.fn().mockResolvedValue(undefined) };
    const service = new AccessRequestService(
      requests as unknown as MongoAccessRequestRepository,
      adminUsers as unknown as AdminUserService,
      auditLogs as never
    );

    const result = await service.approve(actor, "request-admin", "request-1", { role: "learner", temporaryPassword: "Temporary123!" });

    expect(adminUsers.createUser).toHaveBeenCalledWith(actor, "request-admin", {
      username: "pending",
      email: "pending@example.test",
      name: "Pending Learner",
      role: "learner",
      departmentId: undefined,
      enabled: true,
      temporaryPassword: "Temporary123!"
    });
    expect(requests.approve).toHaveBeenCalledWith("request-1", { actorUserId: "admin-user", approvedUserId: "user-1" });
    expect(auditLogs.record).toHaveBeenCalledWith(expect.objectContaining({ action: "access_request.approve" }));
    expect(result).toEqual({ accessRequest: approvedRequest, user: expect.objectContaining({ id: "user-1" }) });
  });
});
