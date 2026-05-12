import { KeycloakAuthService } from "./auth/keycloakAuthService.js";
import { hasAnyRole, type CurrentUser, type LmsRole } from "./auth/currentUser.js";
import { loadConfig, type AppConfig } from "./config/config.js";
import { AppError, isAppError } from "./errors/AppError.js";
import type { Course, Department, Enrollment, LearnerDashboard, PortalSettings } from "./lms/lmsTypes.js";
import { LaunchContextRepository } from "./lti/repositories/launchContextRepository.js";
import { ToolRegistrationRepository } from "./lti/repositories/toolRegistrationRepository.js";
import { LtiLaunchService } from "./lti/services/ltiLaunchService.js";
import { PlatformKeyService } from "./lti/services/platformKeyService.js";

const now = "2026-05-12T00:00:00.000Z";

const portal: PortalSettings = {
  id: "cetu",
  name: "CETU LMS",
  supportEmail: "support@example.test",
  defaultDepartmentId: "cyber-training",
  learnerFeatures: {
    catalog: true,
    transcript: true,
    resources: true,
    leaderboard: false
  }
};

const departments: Department[] = [
  {
    id: "cyber-training",
    name: "Cyber Education and Training Unit",
    brandColor: "#164e63"
  }
];

const courses: Course[] = [
  {
    id: "pact",
    slug: "pact",
    title: "PACT",
    description: "Practical cyber training course and tool launch.",
    type: "lti_tool",
    status: "published",
    category: "Cyber Operations",
    departmentIds: ["cyber-training"],
    allowSelfEnrollment: true,
    estimatedMinutes: 120,
    ltiToolClientId: "pact-tool",
    createdAt: now,
    updatedAt: now
  }
];

const enrollment: Enrollment = {
  id: "enrollment-pact-demo",
  userId: "demo-learner",
  courseId: "pact",
  cohortId: "cohort-pact-demo",
  status: "in_progress",
  progressPercent: 35,
  enrolledAt: now
};

export default {
  async fetch(request, workerEnv) {
    const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return withCors(new Response(null, { status: 204 }), workerEnv, request);
    }

    try {
      if (url.pathname === "/health") {
        return withCors(json({ ok: true, runtime: "cloudflare-workers" }), workerEnv, request);
      }

      const config = loadConfig(workerEnv as Record<string, string>);

      if (url.pathname === "/api/v1/lti/jwks" && request.method === "GET") {
        return withCors(json(await new PlatformKeyService(config).jwks()), workerEnv, request);
      }

      const currentUser = await requireCurrentUser(request, config);

      if (url.pathname === "/api/v1/lms/learner/dashboard" && request.method === "GET") {
        requireRole(currentUser, "learner", "instructor", "admin");
        return withCors(json(learnerDashboard()), workerEnv, request);
      }

      if (url.pathname === "/api/v1/lms/learner/catalog" && request.method === "GET") {
        requireRole(currentUser, "learner", "instructor", "admin");
        return withCors(json(courses), workerEnv, request);
      }

      if (url.pathname === "/api/v1/lms/learner/transcript" && request.method === "GET") {
        requireRole(currentUser, "learner", "instructor", "admin");
        return withCors(json([transcriptItem()]), workerEnv, request);
      }

      if (url.pathname === "/api/v1/lms/admin/overview" && request.method === "GET") {
        requireRole(currentUser, "admin");
        return withCors(json({ publishedCourses: 1, draftCourses: 0, activeEnrollments: 1, completedEnrollments: 0 }), workerEnv, request);
      }

      if (url.pathname === "/api/v1/lms/admin/courses" && request.method === "GET") {
        requireRole(currentUser, "admin");
        return withCors(json(courses), workerEnv, request);
      }

      if (url.pathname === "/api/v1/lms/admin/departments" && request.method === "GET") {
        requireRole(currentUser, "admin");
        return withCors(json(departments), workerEnv, request);
      }

      if (url.pathname === "/api/v1/lms/admin/enrollments" && request.method === "GET") {
        requireRole(currentUser, "admin");
        return withCors(json([enrollment]), workerEnv, request);
      }

      if (url.pathname === "/api/v1/lms/admin/deep-links" && request.method === "GET") {
        requireRole(currentUser, "admin");
        return withCors(json({ contentItems: [], lineItems: [] }), workerEnv, request);
      }

      if (url.pathname === "/api/v1/lms/admin/users" && request.method === "GET") {
        requireRole(currentUser, "admin");
        return withCors(json([adminUser(currentUser)]), workerEnv, request);
      }

      if (url.pathname === "/api/v1/lms/admin/users" && request.method === "POST") {
        requireRole(currentUser, "admin");
        return withCors(errorResponse(501, "KEYCLOAK_ADMIN_NOT_AVAILABLE", "User creation is not available in the Worker staging API", requestId), workerEnv, request);
      }

      const adminUserMutation = url.pathname.match(/^\/api\/v1\/lms\/admin\/users\/[^/]+$/);
      if (adminUserMutation && (request.method === "PATCH" || request.method === "DELETE")) {
        requireRole(currentUser, "admin");
        return withCors(errorResponse(501, "KEYCLOAK_ADMIN_NOT_AVAILABLE", "User changes are not available in the Worker staging API", requestId), workerEnv, request);
      }

      const deepLinkMatch = url.pathname.match(/^\/api\/v1\/lms\/admin\/courses\/([^/]+)\/deep-link$/);
      if (deepLinkMatch && request.method === "POST") {
        requireRole(currentUser, "admin");
        const course = requireCourse(decodeURIComponent(deepLinkMatch[1]));
        const body = await safeJsonBody(request);
        const html = await createWorkerDeepLinkingResponse(config, course, currentUser, stringField(body, "cohortId"));
        return withCors(htmlResponse(html), workerEnv, request);
      }

      return withCors(errorResponse(404, "NOT_FOUND", "Route not found", requestId), workerEnv, request);
    } catch (error) {
      if (isAppError(error)) {
        return withCors(errorResponse(error.statusCode, error.code, error.message, requestId), workerEnv, request);
      }

      console.error("Worker request failed", error);
      return withCors(errorResponse(500, "INTERNAL_ERROR", "Internal server error", requestId), workerEnv, request);
    }
  }
} satisfies ExportedHandler;

function learnerDashboard(): LearnerDashboard {
  return {
    portal,
    assigned: [transcriptItem()],
    recommended: courses,
    transcript: [transcriptItem()]
  };
}

function transcriptItem() {
  return {
    course: courses[0],
    enrollment
  };
}

function adminUser(user: CurrentUser) {
  const updatedAt = new Date().toISOString();
  return {
    id: user.id,
    keycloakSub: user.keycloakSub ?? user.id,
    username: user.name ?? user.email ?? user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    roles: user.roles,
    permissions: user.permissions,
    departmentId: user.departmentId,
    enabled: true,
    createdAt: updatedAt,
    updatedAt,
    lastLoginAt: updatedAt
  };
}

function requireCourse(courseId: string) {
  const course = courses.find((item) => item.id === courseId);
  if (!course) {
    throw new AppError(404, "COURSE_NOT_FOUND", "Course was not found");
  }
  return course;
}

async function createWorkerDeepLinkingResponse(config: AppConfig, course: Course, user: CurrentUser, cohortId?: string) {
  if (!course.ltiToolClientId || !config.registeredTools.some((tool) => tool.clientId === course.ltiToolClientId)) {
    return renderInformationalHtml(
      "PACT Deep Linking is not configured",
      "The Worker staging API has the Deep Linking route, but LTI_TOOLS_JSON does not include the PACT tool registration."
    );
  }

  return new LtiLaunchService(
    config,
    new ToolRegistrationRepository(config.registeredTools),
    new LaunchContextRepository(),
    new PlatformKeyService(config)
  ).createDeepLinkingLaunchForm({ course, user, cohortId });
}

async function safeJsonBody(request: Request) {
  try {
    return (await request.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function stringField(value: Record<string, unknown>, field: string) {
  return typeof value[field] === "string" ? value[field] : undefined;
}

async function requireCurrentUser(request: Request, config: AppConfig) {
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) {
    throw new AppError(401, "AUTH_REQUIRED", "Authentication is required");
  }

  return new KeycloakAuthService(config).verifyAccessToken(authorization.slice("Bearer ".length));
}

function requireRole(user: CurrentUser, ...roles: LmsRole[]) {
  if (!hasAnyRole(user, roles)) {
    throw new AppError(403, "FORBIDDEN", "User does not have permission to access this resource");
  }
}

function json(body: unknown, init?: ResponseInit) {
  return Response.json(body, init);
}

function htmlResponse(html: string, init?: ResponseInit) {
  return new Response(html, {
    ...init,
    headers: { "content-type": "text/html; charset=utf-8", ...(init?.headers ?? {}) }
  });
}

function renderInformationalHtml(title: string, message: string) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title></head><body><main style="font-family: system-ui, sans-serif; max-width: 720px; margin: 48px auto; line-height: 1.5;"><h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p></main></body></html>`;
}

function errorResponse(status: number, code: string, message: string, requestId: string) {
  return json({ error: { code, message, requestId } }, { status });
}

function withCors(response: Response, workerEnv: unknown, request: Request) {
  const headers = new Headers(response.headers);
  const origin = request.headers.get("origin");
  const allowedOrigins = String((workerEnv as Record<string, string>).CORS_ORIGINS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  if (origin && allowedOrigins.includes(origin)) {
    headers.set("access-control-allow-origin", origin);
    headers.set("access-control-allow-credentials", "true");
  }

  headers.set("vary", "Origin");
  headers.set("access-control-allow-methods", "GET,POST,PATCH,DELETE,OPTIONS");
  headers.set("access-control-allow-headers", "authorization,content-type,x-request-id");

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
