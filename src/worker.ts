import { KeycloakAuthService } from "./auth/keycloakAuthService.js";
import { loadConfig, type AppConfig } from "./config/config.js";
import { AppError, isAppError } from "./errors/AppError.js";
import type { Course, Department, Enrollment, LearnerDashboard, PortalSettings } from "./lms/lmsTypes.js";
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

      await requireCurrentUser(request, config);

      if (url.pathname === "/api/v1/lms/learner/dashboard" && request.method === "GET") {
        return withCors(json(learnerDashboard()), workerEnv, request);
      }

      if (url.pathname === "/api/v1/lms/learner/catalog" && request.method === "GET") {
        return withCors(json(courses), workerEnv, request);
      }

      if (url.pathname === "/api/v1/lms/learner/transcript" && request.method === "GET") {
        return withCors(json([transcriptItem()]), workerEnv, request);
      }

      if (url.pathname === "/api/v1/lms/admin/overview" && request.method === "GET") {
        return withCors(json({ publishedCourses: 1, draftCourses: 0, activeEnrollments: 1, completedEnrollments: 0 }), workerEnv, request);
      }

      if (url.pathname === "/api/v1/lms/admin/courses" && request.method === "GET") {
        return withCors(json(courses), workerEnv, request);
      }

      if (url.pathname === "/api/v1/lms/admin/departments" && request.method === "GET") {
        return withCors(json(departments), workerEnv, request);
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

async function requireCurrentUser(request: Request, config: AppConfig) {
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) {
    throw new AppError(401, "AUTH_REQUIRED", "Authentication is required");
  }

  await new KeycloakAuthService(config).verifyAccessToken(authorization.slice("Bearer ".length));
}

function json(body: unknown, init?: ResponseInit) {
  return Response.json(body, init);
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
  headers.set("access-control-allow-methods", "GET,POST,PATCH,OPTIONS");
  headers.set("access-control-allow-headers", "authorization,content-type,x-request-id");

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}
