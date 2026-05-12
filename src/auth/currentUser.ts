export type LmsRole = "learner" | "instructor" | "admin";

export type CurrentUser = {
  id: string;
  keycloakSub?: string;
  email?: string;
  name?: string;
  roles: LmsRole[];
  permissions: string[];
  departmentId?: string;
};

export function hasAnyRole(user: CurrentUser, roles: LmsRole[]) {
  return roles.some((role) => user.roles.includes(role));
}
