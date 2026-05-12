import type { LmsRole } from "../auth/currentUser.js";

export type InternalUser = {
  id: string;
  keycloakSub: string;
  email?: string;
  name?: string;
  roles: LmsRole[];
  permissions: string[];
  departmentId?: string;
  createdAt: string;
  updatedAt: string;
  lastLoginAt: string;
};

export type UpsertInternalUserInput = {
  keycloakSub: string;
  email?: string;
  name?: string;
  roles: LmsRole[];
  permissions: string[];
  departmentId?: string;
};
