import { describe, expect, it, vi } from "vitest";
import { AccessRequestService } from "../src/users/accessRequestService.js";
import type { AdminUserService } from "../src/users/adminUserService.js";
import type { MongoAccessRequestRepository } from "../src/users/mongoAccessRequestRepository.js";
import type { AdminExperienceService } from "../src/lms/services/adminExperienceService.js";

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
    const notifier = { accessRequestSubmitted: vi.fn().mockResolvedValue(undefined) };
    const auditLogs = { record: vi.fn().mockResolvedValue(undefined) };
    const service = new AccessRequestService(
      requests as unknown as MongoAccessRequestRepository,
      adminUsers as unknown as AdminUserService,
      undefined,
      notifier as never,
      auditLogs as never
    );

    const result = await service.submit("request-public", { name: "Pending Learner", email: "Pending@Example.Test" });

    expect(requests.create).toHaveBeenCalledWith({ name: "Pending Learner", email: "Pending@Example.Test" });
    expect(adminUsers.createUser).not.toHaveBeenCalled();
    expect(notifier.accessRequestSubmitted).toHaveBeenCalledWith({ accessRequest: pendingRequest });
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
    const adminExperience = {
      validateEnrollmentTarget: vi.fn().mockResolvedValue(undefined),
      createEnrollment: vi.fn().mockResolvedValue({
        id: "enrollment-1",
        userId: "user-1",
        courseId: "pact",
        cohortId: "cohort-alpha",
        status: "not_started",
        progressPercent: 0,
        enrolledAt: "2026-05-14T00:00:00.000Z"
      })
    };
    const notifier = { accessRequestApproved: vi.fn().mockResolvedValue(undefined) };
    const auditLogs = { record: vi.fn().mockResolvedValue(undefined) };
    const service = new AccessRequestService(
      requests as unknown as MongoAccessRequestRepository,
      adminUsers as unknown as AdminUserService,
      adminExperience as unknown as AdminExperienceService,
      notifier as never,
      auditLogs as never
    );

    const result = await service.approve(actor, "request-admin", "request-1", {
      role: "learner",
      temporaryPassword: "Temporary123!",
      courseId: "pact",
      cohortId: "cohort-alpha"
    });

    expect(adminExperience.validateEnrollmentTarget).toHaveBeenCalledWith("pact", "cohort-alpha");
    expect(adminUsers.createUser).toHaveBeenCalledWith(actor, "request-admin", {
      username: "pending",
      email: "pending@example.test",
      name: "Pending Learner",
      role: "learner",
      departmentId: undefined,
      enabled: true,
      temporaryPassword: "Temporary123!"
    });
    expect(adminExperience.createEnrollment).toHaveBeenCalledWith(actor, "request-admin", {
      userId: "user-1",
      courseId: "pact",
      cohortId: "cohort-alpha",
      status: "not_started",
      progressPercent: 0
    });
    expect(requests.approve).toHaveBeenCalledWith("request-1", { actorUserId: "admin-user", approvedUserId: "user-1" });
    expect(notifier.accessRequestApproved).toHaveBeenCalledWith({
      accessRequest: approvedRequest,
      user: expect.objectContaining({ id: "user-1" }),
      enrollment: expect.objectContaining({ id: "enrollment-1" })
    });
    expect(auditLogs.record).toHaveBeenCalledWith(expect.objectContaining({ action: "access_request.approve" }));
    expect(result).toEqual({ accessRequest: approvedRequest, user: expect.objectContaining({ id: "user-1" }), enrollment: expect.objectContaining({ id: "enrollment-1" }) });
  });

  it("derives a schema-safe username from short email local parts", async () => {
    const shortEmailRequest = { ...pendingRequest, email: "ab@example.test", emailNormalized: "ab@example.test" };
    const requests = {
      getById: vi.fn().mockResolvedValue(shortEmailRequest),
      approve: vi.fn().mockResolvedValue({ ...shortEmailRequest, status: "approved" as const, approvedUserId: "user-1" })
    };
    const adminUsers = {
      createUser: vi.fn().mockResolvedValue({ id: "user-1", email: "ab@example.test", role: "learner" })
    };
    const service = new AccessRequestService(
      requests as unknown as MongoAccessRequestRepository,
      adminUsers as unknown as AdminUserService
    );

    await service.approve(actor, "request-admin", "request-1", { role: "learner" });

    expect(adminUsers.createUser).toHaveBeenCalledWith(actor, "request-admin", expect.objectContaining({
      username: "user-ab",
      email: "ab@example.test"
    }));
  });

  it("rejects pending requests and calls the rejection notification hook", async () => {
    const rejectedRequest = { ...pendingRequest, status: "rejected" as const, decisionReason: "Not eligible" };
    const requests = { reject: vi.fn().mockResolvedValue(rejectedRequest) };
    const adminUsers = { createUser: vi.fn() };
    const notifier = { accessRequestRejected: vi.fn().mockResolvedValue(undefined) };
    const auditLogs = { record: vi.fn().mockResolvedValue(undefined) };
    const service = new AccessRequestService(
      requests as unknown as MongoAccessRequestRepository,
      adminUsers as unknown as AdminUserService,
      undefined,
      notifier as never,
      auditLogs as never
    );

    const result = await service.reject(actor, "request-admin", "request-1", { reason: "Not eligible" });

    expect(adminUsers.createUser).not.toHaveBeenCalled();
    expect(requests.reject).toHaveBeenCalledWith("request-1", { actorUserId: "admin-user", reason: "Not eligible" });
    expect(notifier.accessRequestRejected).toHaveBeenCalledWith({ accessRequest: rejectedRequest });
    expect(auditLogs.record).toHaveBeenCalledWith(expect.objectContaining({ action: "access_request.reject" }));
    expect(result).toEqual(rejectedRequest);
  });

  it("rolls back a created user when approve-and-enroll fails", async () => {
    const requests = { getById: vi.fn().mockResolvedValue(pendingRequest), approve: vi.fn() };
    const adminUsers = {
      createUser: vi.fn().mockResolvedValue({ id: "user-1", email: "pending@example.test", role: "learner" }),
      deleteUser: vi.fn().mockResolvedValue(undefined)
    };
    const enrollmentError = new Error("Enrollment already exists");
    const adminExperience = {
      validateEnrollmentTarget: vi.fn().mockResolvedValue(undefined),
      createEnrollment: vi.fn().mockRejectedValue(enrollmentError)
    };
    const service = new AccessRequestService(
      requests as unknown as MongoAccessRequestRepository,
      adminUsers as unknown as AdminUserService,
      adminExperience as unknown as AdminExperienceService
    );

    await expect(service.approve(actor, "request-admin", "request-1", { role: "learner", courseId: "pact" })).rejects.toThrow("Enrollment already exists");

    expect(requests.approve).not.toHaveBeenCalled();
    expect(adminUsers.deleteUser).toHaveBeenCalledWith(actor, "request-admin", "user-1");
  });
});
