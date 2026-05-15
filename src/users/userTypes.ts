import type { LmsRole } from "../auth/currentUser.js";

export type InternalUser = {
  id: string;
  keycloakSub: string;
  username?: string;
  email?: string;
  name?: string;
  role: LmsRole;
  roles: LmsRole[];
  permissions: string[];
  departmentId?: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
  lastLoginAt?: string;
  deletedAt?: string;
};

export type UpsertInternalUserInput = {
  keycloakSub: string;
  username?: string;
  email?: string;
  name?: string;
  role: LmsRole;
  roles: LmsRole[];
  permissions: string[];
  departmentId?: string;
  enabled?: boolean;
  lastLoginAt?: string;
};

export type AdminUser = {
  id: string;
  keycloakSub: string;
  username?: string;
  email?: string;
  name?: string;
  role: LmsRole;
  roles: LmsRole[];
  permissions: string[];
  departmentId?: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
  lastLoginAt?: string;
};

export type CreateAdminUserInput = {
  username: string;
  email: string;
  name?: string;
  role: LmsRole;
  departmentId?: string;
  enabled?: boolean;
  temporaryPassword?: string;
};

export type UpdateAdminUserInput = {
  username?: string;
  email?: string;
  name?: string;
  role?: LmsRole;
  departmentId?: string;
  enabled?: boolean;
  temporaryPassword?: string;
};

export type AccessRequestStatus = "pending" | "approved" | "rejected";

export type AccessRequest = {
  id: string;
  name: string;
  email: string;
  emailNormalized: string;
  status: AccessRequestStatus;
  requestedAt: string;
  updatedAt: string;
  approvedAt?: string;
  approvedByUserId?: string;
  approvedUserId?: string;
  rejectedAt?: string;
  rejectedByUserId?: string;
  decisionReason?: string;
};

export type PublicAccessRequestInput = {
  name: string;
  email: string;
};

export type ApproveAccessRequestInput = {
  username?: string;
  role: LmsRole;
  departmentId?: string;
  temporaryPassword?: string;
};

export type RejectAccessRequestInput = {
  reason?: string;
};
