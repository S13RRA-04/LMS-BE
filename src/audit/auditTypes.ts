export type AuditAction =
  | "course.create"
  | "course.update"
  | "cohort.create"
  | "cohort.update"
  | "cohort.delete"
  | "department.create"
  | "department.update"
  | "enrollment.create"
  | "enrollment.update"
  | "portal_settings.update"
  | "access_request.create"
  | "access_request.approve"
  | "access_request.reject"
  | "user.create"
  | "user.bulk_create"
  | "user.update"
  | "user.delete";

export type AuditLog = {
  id: string;
  action: AuditAction;
  actorUserId: string;
  actorKeycloakSub?: string;
  targetType: string;
  targetId: string;
  requestId?: string;
  occurredAt: string;
  metadata?: Record<string, unknown>;
};
