import type { CurrentUser } from "../auth/currentUser.js";
import type { MongoAuditLogRepository } from "../audit/mongoAuditLogRepository.js";
import { AppError } from "../errors/AppError.js";
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

    const user = await this.adminUsers.createUser(actor, requestId, {
      username: input.username?.trim() || usernameFromEmail(accessRequest.email),
      email: accessRequest.email,
      name: accessRequest.name,
      role: input.role,
      departmentId: input.departmentId,
      enabled: true,
      temporaryPassword: input.temporaryPassword
    });

    const approved = await this.requests.approve(id, { actorUserId: actor.id, approvedUserId: user.id });
    await this.auditLogs?.record({
      action: "access_request.approve",
      actor,
      targetType: "access_request",
      targetId: approved.id,
      requestId,
      metadata: { approvedUserId: user.id, role: user.role }
    });
    return { accessRequest: approved, user };
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
    return rejected;
  }
}

function usernameFromEmail(email: string) {
  return email.trim().toLowerCase().replace(/@.*$/, "").replace(/[^a-z0-9._-]/g, ".").replace(/\.+/g, ".").replace(/^\.+|\.+$/g, "") || `user-${crypto.randomUUID()}`;
}
