import type { CurrentUser } from "../auth/currentUser.js";
import type { MongoAuditLogRepository } from "../audit/mongoAuditLogRepository.js";
import { AppError } from "../errors/AppError.js";
import type { AdminExperienceService } from "../lms/services/adminExperienceService.js";
import type { AccessRequestNotifier } from "../notifications/accessRequestNotifier.js";
import type { AdminUserService } from "./adminUserService.js";
import type { MongoAccessRequestRepository } from "./mongoAccessRequestRepository.js";
import type {
  AccessRequestStatus,
  ApproveAccessRequestInput,
  PublicAccessRequestInput,
  RejectAccessRequestInput
} from "./userTypes.js";

const publicActor: CurrentUser = {
  id: "public",
  role: "learner",
  roles: ["learner"],
  permissions: []
};

export class AccessRequestService {
  constructor(
    private readonly requests: MongoAccessRequestRepository,
    private readonly adminUsers: AdminUserService,
    private readonly adminExperience?: AdminExperienceService,
    private readonly notifier?: AccessRequestNotifier,
    private readonly auditLogs?: MongoAuditLogRepository
  ) {}

  async submit(requestId: string | undefined, input: PublicAccessRequestInput) {
    const accessRequest = await this.requests.create(input);
    await this.auditLogs?.record({
      action: "access_request.create",
      actor: publicActor,
      targetType: "access_request",
      targetId: accessRequest.id,
      requestId,
      metadata: { email: accessRequest.emailNormalized }
    });
    await this.notify("submitted", requestId, accessRequest.id, () => this.notifier?.accessRequestSubmitted({ accessRequest }));
    return accessRequest;
  }

  async list(status?: AccessRequestStatus) {
    return this.requests.list(status);
  }

  async approve(actor: CurrentUser, requestId: string | undefined, id: string, input: ApproveAccessRequestInput) {
    const accessRequest = await this.requests.getById(id);
    if (!accessRequest || accessRequest.status !== "pending") {
      throw new AppError(accessRequest ? 409 : 404, accessRequest ? "ACCESS_REQUEST_NOT_PENDING" : "ACCESS_REQUEST_NOT_FOUND", accessRequest ? "Access request is not pending" : "Access request was not found");
    }

    if (input.courseId && this.adminExperience) {
      await this.adminExperience.validateEnrollmentTarget(input.courseId, input.cohortId);
    }

    const user = await this.adminUsers.createUser(actor, requestId, {
      username: input.username?.trim() || usernameFromEmail(accessRequest.email),
      email: accessRequest.email,
      name: accessRequest.name,
      role: input.role,
      departmentId: input.departmentId,
      enabled: true,
      temporaryPassword: input.temporaryPassword
    });

    let enrollment: Awaited<ReturnType<AdminExperienceService["createEnrollment"]>> | undefined;
    try {
      enrollment = input.courseId && this.adminExperience
        ? await this.adminExperience.createEnrollment(actor, requestId, {
            userId: user.id,
            courseId: input.courseId,
            cohortId: input.cohortId,
            status: "not_started",
            progressPercent: 0
          })
        : undefined;
    } catch (error) {
      await this.rollbackCreatedUser(actor, requestId, user.id, error);
      throw error;
    }

    let approved: typeof accessRequest;
    try {
      approved = await this.requests.approve(id, { actorUserId: actor.id, approvedUserId: user.id });
    } catch (error) {
      if (enrollment) {
        await this.rollbackCreatedEnrollment(actor, requestId, enrollment.id, error);
      }
      await this.rollbackCreatedUser(actor, requestId, user.id, error);
      throw error;
    }
    await this.auditLogs?.record({
      action: "access_request.approve",
      actor,
      targetType: "access_request",
      targetId: approved.id,
      requestId,
      metadata: { approvedUserId: user.id, role: user.role, enrollmentId: enrollment?.id }
    });
    await this.notify("approved", requestId, approved.id, () => this.notifier?.accessRequestApproved({ accessRequest: approved, user, enrollment }));
    return { accessRequest: approved, user, enrollment };
  }

  async reject(actor: CurrentUser, requestId: string | undefined, id: string, input: RejectAccessRequestInput) {
    const rejected = await this.requests.reject(id, { actorUserId: actor.id, reason: input.reason });
    await this.auditLogs?.record({
      action: "access_request.reject",
      actor,
      targetType: "access_request",
      targetId: rejected.id,
      requestId,
      metadata: { reason: input.reason }
    });
    await this.notify("rejected", requestId, rejected.id, () => this.notifier?.accessRequestRejected({ accessRequest: rejected }));
    return rejected;
  }

  private async rollbackCreatedEnrollment(actor: CurrentUser, requestId: string | undefined, enrollmentId: string, originalError: unknown) {
    try {
      await this.adminExperience?.deleteEnrollment(actor, requestId, enrollmentId);
    } catch (rollbackError) {
      logAccessRequestSideEffectFailure("enrollment_rollback", requestId, enrollmentId, rollbackError, originalError);
    }
  }

  private async rollbackCreatedUser(actor: CurrentUser, requestId: string | undefined, userId: string, originalError: unknown) {
    try {
      await this.adminUsers.deleteUser(actor, requestId, userId);
    } catch (rollbackError) {
      logAccessRequestSideEffectFailure("user_rollback", requestId, userId, rollbackError, originalError);
    }
  }

  private async notify(kind: "submitted" | "approved" | "rejected", requestId: string | undefined, accessRequestId: string, action: () => Promise<void> | undefined) {
    try {
      await action();
    } catch (error) {
      logAccessRequestSideEffectFailure(`email_${kind}`, requestId, accessRequestId, error);
    }
  }
}

function usernameFromEmail(email: string) {
  const username = email
    .trim()
    .toLowerCase()
    .replace(/@.*$/, "")
    .replace(/[^a-z0-9._-]/g, ".")
    .replace(/\.+/g, ".")
    .replace(/^\.+|\.+$/g, "");
  return username.length >= 3 ? username : `user-${username || crypto.randomUUID()}`;
}

function logAccessRequestSideEffectFailure(
  sideEffect: string,
  requestId: string | undefined,
  targetId: string,
  error: unknown,
  originalError?: unknown
) {
  console.warn(JSON.stringify({
    event: "access_request_side_effect_failed",
    sideEffect,
    requestId,
    targetId,
    error: error instanceof Error ? error.message : "Unknown side effect failure",
    originalError: originalError instanceof Error ? originalError.message : undefined
  }));
}
