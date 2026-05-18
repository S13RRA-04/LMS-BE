import { importJWK, jwtVerify, type JWK, type JWTPayload } from "jose";
import { z, ZodError } from "zod";
import { KeycloakAuthService } from "./auth/keycloakAuthService.js";
import { hasAnyRole, type CurrentUser, type LmsRole } from "./auth/currentUser.js";
import { loadConfig, type AppConfig } from "./config/config.js";
import { getMongoDb } from "./db/mongo.js";
import { AppError, isAppError } from "./errors/AppError.js";
import { KeycloakAdminClient } from "./integrations/keycloak/keycloakAdminClient.js";
import { MongoAuditLogRepository } from "./audit/mongoAuditLogRepository.js";
import { MongoLmsRepository } from "./lms/repositories/mongoLmsRepository.js";
import { AdminExperienceService } from "./lms/services/adminExperienceService.js";
import { LearnerExperienceService } from "./lms/services/learnerExperienceService.js";
import {
  accessRequestApproveSchema,
  accessRequestCreateSchema,
  accessRequestRejectSchema,
  accessRequestStatusSchema,
  adminUserBulkCreateSchema,
  adminUserCreateSchema,
  adminUserPasswordResetSchema,
  adminUserUpdateSchema,
  cohortCreateSchema,
  cohortUpdateSchema,
  courseCreateSchema,
  courseUpdateSchema,
  deepLinkLaunchSchema,
  departmentCreateSchema,
  departmentUpdateSchema,
  enrollmentCreateSchema,
  enrollmentUpdateSchema,
  portalUpdateSchema
} from "./lms/validators/lmsSchemas.js";
import { LaunchContextRepository } from "./lti/repositories/launchContextRepository.js";
import { MongoLineItemRepository } from "./lti/repositories/mongoLineItemRepository.js";
import { ToolRegistrationRepository } from "./lti/repositories/toolRegistrationRepository.js";
import { AgsService } from "./lti/services/agsService.js";
import { DeepLinkingService } from "./lti/services/deepLinkingService.js";
import { LtiLaunchService } from "./lti/services/ltiLaunchService.js";
import { LtiTokenService } from "./lti/services/ltiTokenService.js";
import { PlatformKeyService } from "./lti/services/platformKeyService.js";
import { ToolAssertionService } from "./lti/services/toolAssertionService.js";
import {
  authorizationQuerySchema,
  deepLinkReturnBodySchema,
  lineItemBodySchema,
  scoreBodySchema,
  tokenBodySchema
} from "./lti/validators/ltiSchemas.js";
import { AccessRequestService } from "./users/accessRequestService.js";
import { AdminUserService } from "./users/adminUserService.js";
import { KeycloakUserSyncService } from "./users/keycloakUserSyncService.js";
import { MongoAccessRequestRepository } from "./users/mongoAccessRequestRepository.js";
import { MongoUserRepository } from "./users/mongoUserRepository.js";
import { createAccessRequestNotifier } from "./notifications/accessRequestNotifier.js";

type WorkerEnv = Record<string, string | undefined>;

type RequestContext = {
  request: Request;
  config: AppConfig;
  requestId: string;
  url: URL;
};

type RouteResult =
  | Response
  | {
      status?: number;
      body?: unknown;
      headers?: HeadersInit;
    };

const roles = new Set<LmsRole>(["learner", "instructor", "admin"]);

const keycloakEventSchema = z
  .object({
    operationType: z.string().optional(),
    resourceType: z.string().optional(),
    resourcePath: z.string().optional(),
    userId: z.string().optional(),
    keycloakSub: z.string().optional()
  })
  .passthrough();

export default {
  async fetch(request: Request, env: WorkerEnv): Promise<Response> {
    const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
    let config: AppConfig | undefined;

    try {
      config = loadConfig(env as NodeJS.ProcessEnv);
      const context: RequestContext = {
        request,
        config,
        requestId,
        url: new URL(request.url)
      };

      if (request.method === "OPTIONS") {
        return withCors(new Response(null, { status: 204 }), config, request);
      }

      const result = await route(context);
      return withCors(toResponse(result), config, request);
    } catch (error) {
      logError(error, requestId, request);
      return withCors(errorResponse(error, requestId), config ?? corsOnlyConfig(env), request);
    }
  }
} satisfies ExportedHandler<WorkerEnv>;

async function route(context: RequestContext): Promise<RouteResult> {
  const { request, url } = context;
  const path = normalizePath(url.pathname);

  if (path === "/health" && request.method === "GET") {
    return { body: { ok: true, runtime: "cloudflare-workers" } };
  }

  if (!path.startsWith("/api/v1/")) {
    throw new AppError(404, "NOT_FOUND", "Route was not found");
  }

  const apiPath = path.slice("/api/v1".length);

  if (apiPath.startsWith("/lti/")) {
    return routeLti(context, apiPath);
  }

  if (apiPath.startsWith("/lms/")) {
    return routeLms(context, apiPath);
  }

  if (apiPath.startsWith("/keycloak/")) {
    return routeKeycloak(context, apiPath);
  }

  throw new AppError(404, "NOT_FOUND", "Route was not found");
}

async function routeLti(context: RequestContext, path: string): Promise<RouteResult> {
  const { request, config, url } = context;
  const toolRepo = new ToolRegistrationRepository(config.registeredTools);
  const contextRepo = new LaunchContextRepository();
  const keyService = new PlatformKeyService(config);
  const assertionService = new ToolAssertionService();
  const launchService = new LtiLaunchService(config, toolRepo, contextRepo, keyService);
  const tokenService = new LtiTokenService(config, toolRepo, assertionService, keyService);

  if (path === "/lti/jwks" && request.method === "GET") {
    return { body: await keyService.jwks() };
  }

  if (path === "/lti/authorize" && request.method === "GET") {
    return html(await launchService.createLaunchForm(authorizationQuerySchema.parse(queryObject(url))));
  }

  if (path === "/lti/token" && request.method === "POST") {
    return { body: await tokenService.createAccessToken(tokenBodySchema.parse(await formBody(request))) };
  }

  if (path === "/lti/deep-linking/return" && request.method === "POST") {
    const body = deepLinkReturnBodySchema.parse(await formBody(request));
    const lineItems = new MongoLineItemRepository(await getMongoDb(config), config);
    return {
      body: await new DeepLinkingService(config, toolRepo, assertionService, lineItems).acceptDeepLinkResponse(
        body.JWT ?? body.id_token ?? ""
      )
    };
  }

  if (path === "/lti/ags/lineitems" && request.method === "GET") {
    const scopes = await requireLtiAccessToken(context);
    const agsService = new AgsService(new MongoLineItemRepository(await getMongoDb(config), config));
    return { body: await agsService.listLineItems(scopes) };
  }

  if (path === "/lti/ags/lineitems" && request.method === "POST") {
    const scopes = await requireLtiAccessToken(context);
    const agsService = new AgsService(new MongoLineItemRepository(await getMongoDb(config), config));
    return { status: 201, body: await agsService.createLineItem(scopes, lineItemBodySchema.parse(await jsonBody(request))) };
  }

  const scoreMatch = path.match(/^\/lti\/ags\/lineitems\/([^/]+)\/scores$/);
  if (scoreMatch && request.method === "POST") {
    const scopes = await requireLtiAccessToken(context);
    const db = await getMongoDb(config);
    const agsService = new AgsService(new MongoLineItemRepository(db, config), new MongoLmsRepository(db, config));
    return {
      status: 201,
      body: await agsService.submitScore(scopes, decodeURIComponent(scoreMatch[1]), scoreBodySchema.parse(await jsonBody(request)))
    };
  }

  throw new AppError(404, "NOT_FOUND", "Route was not found");
}

async function routeLms(context: RequestContext, path: string): Promise<RouteResult> {
  const { request, config, requestId } = context;

  if (path === "/lms/access-requests" && request.method === "POST") {
    const { accessRequests } = await services(config);
    return { status: 202, body: await accessRequests.submit(requestId, accessRequestCreateSchema.parse(await jsonBody(request))) };
  }

  const currentUser = await requireCurrentUser(context);

  if (path === "/lms/learner/dashboard" && request.method === "GET") {
    requireRole(currentUser, ["learner", "instructor", "admin"]);
    const { learnerExperience } = await services(config);
    const dashboard = await learnerExperience.getDashboard(currentUser);
    const lineItems = new MongoLineItemRepository(await getMongoDb(config), config);
    const deepLinks = await lineItems.listDeepLinkedContent();
    const enrollmentByCourse = new Map(dashboard.transcript.map((item) => [item.course.id, item.enrollment]));
    return {
      body: {
        ...dashboard,
        deepLinks: deepLinks.filter((item) => {
          if (!item.courseId) return false;
          const enrollment = enrollmentByCourse.get(item.courseId);
          if (!enrollment || enrollment.status === "expired" || enrollment.status === "failed") return false;
          return !item.cohortId || item.cohortId === enrollment.cohortId;
        })
      }
    };
  }

  if (path === "/lms/learner/catalog" && request.method === "GET") {
    requireRole(currentUser, ["learner", "instructor", "admin"]);
    const { learnerExperience } = await services(config);
    return { body: await learnerExperience.getCatalog() };
  }

  if (path === "/lms/learner/transcript" && request.method === "GET") {
    requireRole(currentUser, ["learner", "instructor", "admin"]);
    const { learnerExperience } = await services(config);
    return { body: await learnerExperience.getTranscript(currentUser) };
  }

  const launchMatch = path.match(/^\/lms\/courses\/([^/]+)\/launch$/);
  if (launchMatch && request.method === "POST") {
    requireRole(currentUser, ["learner", "instructor", "admin"]);
    const { repository, launchService } = await services(config);
    const course = await repository.requireCourse(decodeURIComponent(launchMatch[1]));
    const enrollment = await repository.getEnrollmentForUserCourse(currentUser.id, course.id);
    const enrollmentBlocksLaunch = !enrollment || enrollment.status === "expired" || enrollment.status === "failed";

    if (currentUser.role !== "admin" && enrollmentBlocksLaunch) {
      throw new AppError(403, "COURSE_ENROLLMENT_REQUIRED", "User is not enrolled in this course");
    }

    return html(await launchService.createCourseLaunchForm({ course, enrollment: enrollmentBlocksLaunch ? undefined : enrollment, user: currentUser }));
  }

  const deepLinkedLaunchMatch = path.match(/^\/lms\/deep-links\/([^/]+)\/launch$/);
  if (deepLinkedLaunchMatch && request.method === "POST") {
    requireRole(currentUser, ["learner", "instructor", "admin"]);
    const { repository, launchService } = await services(config);
    const lineItems = new MongoLineItemRepository(await getMongoDb(config), config);
    const content = await lineItems.requireDeepLinkedContent(decodeURIComponent(deepLinkedLaunchMatch[1]));
    if (!content.courseId) {
      throw new AppError(400, "DEEP_LINK_COURSE_REQUIRED", "Deep linked content is not assigned to an LMS course");
    }
    const course = await repository.requireCourse(content.courseId);
    const enrollment = await repository.getEnrollmentForUserCourse(currentUser.id, course.id);
    const enrollmentBlocksLaunch = !enrollment || enrollment.status === "expired" || enrollment.status === "failed";
    if (currentUser.role !== "admin" && enrollmentBlocksLaunch) {
      throw new AppError(403, "COURSE_ENROLLMENT_REQUIRED", "User is not enrolled in this course");
    }
    if (currentUser.role !== "admin" && content.cohortId && content.cohortId !== enrollment?.cohortId) {
      throw new AppError(403, "COHORT_DEEP_LINK_FORBIDDEN", "Deep linked content is not assigned to this learner cohort");
    }
    return html(await launchService.createDeepLinkedContentLaunchForm({
      course,
      content,
      enrollment: enrollmentBlocksLaunch ? undefined : enrollment,
      user: currentUser
    }));
  }

  if (path === "/lms/admin/overview" && request.method === "GET") {
    requireRole(currentUser, ["admin"]);
    const { adminExperience } = await services(config);
    return { body: await adminExperience.getOverview() };
  }

  if (path === "/lms/admin/courses" && request.method === "GET") {
    requireRole(currentUser, ["admin"]);
    const { adminExperience } = await services(config);
    return { body: await adminExperience.listCourses() };
  }

  if (path === "/lms/admin/courses" && request.method === "POST") {
    requireRole(currentUser, ["admin"]);
    const { adminExperience } = await services(config);
    return { status: 201, body: await adminExperience.createCourse(currentUser, requestId, courseCreateSchema.parse(await jsonBody(request))) };
  }

  const courseMatch = path.match(/^\/lms\/admin\/courses\/([^/]+)$/);
  if (courseMatch && request.method === "PATCH") {
    requireRole(currentUser, ["admin"]);
    const { adminExperience } = await services(config);
    return {
      body: await adminExperience.updateCourse(
        currentUser,
        requestId,
        decodeURIComponent(courseMatch[1]),
        courseUpdateSchema.parse(await jsonBody(request))
      )
    };
  }

  const deepLinkMatch = path.match(/^\/lms\/admin\/courses\/([^/]+)\/deep-link$/);
  if (deepLinkMatch && request.method === "POST") {
    requireRole(currentUser, ["admin"]);
    const { repository, launchService } = await services(config);
    const body = deepLinkLaunchSchema.parse(await jsonBody(request));
    return html(
      await launchService.createDeepLinkingLaunchForm({
        course: await repository.requireCourse(decodeURIComponent(deepLinkMatch[1])),
        user: currentUser,
        cohortId: body.cohortId
      })
    );
  }

  const agsContextRefreshMatch = path.match(/^\/lms\/admin\/courses\/([^/]+)\/ags-context-refresh$/);
  if (agsContextRefreshMatch && request.method === "POST") {
    requireRole(currentUser, ["admin"]);
    const { repository, launchService } = await services(config);
    const body = deepLinkLaunchSchema.parse(await jsonBody(request));
    const course = await repository.requireCourse(decodeURIComponent(agsContextRefreshMatch[1]));
    if (body.cohortId) {
      await repository.requireActiveCohortForCourse(body.cohortId, course.id);
    }
    return html(
      await launchService.createAgsContextRefreshLaunchForm({
        course,
        user: currentUser,
        cohortId: body.cohortId
      })
    );
  }

  if (path === "/lms/admin/departments" && request.method === "GET") {
    requireRole(currentUser, ["admin"]);
    const { adminExperience } = await services(config);
    return { body: await adminExperience.listDepartments() };
  }

  if (path === "/lms/admin/departments" && request.method === "POST") {
    requireRole(currentUser, ["admin"]);
    const { adminExperience } = await services(config);
    return { status: 201, body: await adminExperience.createDepartment(currentUser, requestId, departmentCreateSchema.parse(await jsonBody(request))) };
  }

  const departmentMatch = path.match(/^\/lms\/admin\/departments\/([^/]+)$/);
  if (departmentMatch && request.method === "PATCH") {
    requireRole(currentUser, ["admin"]);
    const { adminExperience } = await services(config);
    return {
      body: await adminExperience.updateDepartment(
        currentUser,
        requestId,
        decodeURIComponent(departmentMatch[1]),
        departmentUpdateSchema.parse(await jsonBody(request))
      )
    };
  }

  if (path === "/lms/admin/cohorts" && request.method === "GET") {
    requireRole(currentUser, ["admin"]);
    const { adminExperience } = await services(config);
    return { body: await adminExperience.listCohorts() };
  }

  if (path === "/lms/admin/cohorts" && request.method === "POST") {
    requireRole(currentUser, ["admin"]);
    const { adminExperience } = await services(config);
    return { status: 201, body: await adminExperience.createCohort(currentUser, requestId, cohortCreateSchema.parse(await jsonBody(request))) };
  }

  const cohortMatch = path.match(/^\/lms\/admin\/cohorts\/([^/]+)$/);
  if (cohortMatch && request.method === "PATCH") {
    requireRole(currentUser, ["admin"]);
    const { adminExperience } = await services(config);
    return {
      body: await adminExperience.updateCohort(
        currentUser,
        requestId,
        decodeURIComponent(cohortMatch[1]),
        cohortUpdateSchema.parse(await jsonBody(request))
      )
    };
  }

  if (cohortMatch && request.method === "DELETE") {
    requireRole(currentUser, ["admin"]);
    const { adminExperience } = await services(config);
    await adminExperience.deleteCohort(currentUser, requestId, decodeURIComponent(cohortMatch[1]));
    return new Response(null, { status: 204 });
  }

  if (path === "/lms/admin/enrollments" && request.method === "GET") {
    requireRole(currentUser, ["admin"]);
    const { adminExperience } = await services(config);
    return { body: await adminExperience.listEnrollments() };
  }

  if (path === "/lms/admin/enrollments" && request.method === "POST") {
    requireRole(currentUser, ["admin"]);
    const { adminExperience } = await services(config);
    return { status: 201, body: await adminExperience.createEnrollment(currentUser, requestId, enrollmentCreateSchema.parse(await jsonBody(request))) };
  }

  const enrollmentMatch = path.match(/^\/lms\/admin\/enrollments\/([^/]+)$/);
  if (enrollmentMatch && request.method === "PATCH") {
    requireRole(currentUser, ["admin"]);
    const { adminExperience } = await services(config);
    return {
      body: await adminExperience.updateEnrollment(
        currentUser,
        requestId,
        decodeURIComponent(enrollmentMatch[1]),
        enrollmentUpdateSchema.parse(await jsonBody(request))
      )
    };
  }

  if (path === "/lms/admin/deep-links" && request.method === "GET") {
    requireRole(currentUser, ["admin"]);
    const lineItems = new MongoLineItemRepository(await getMongoDb(config), config);
    return { body: { contentItems: await lineItems.listDeepLinkedContent(), lineItems: await lineItems.list() } };
  }

  if (path === "/lms/admin/ags/grades" && request.method === "GET") {
    requireRole(currentUser, ["admin"]);
    const lineItems = new MongoLineItemRepository(await getMongoDb(config), config);
    return {
      body: await new AgsService(lineItems).listAdminGradebook({
        courseId: context.url.searchParams.get("courseId") ?? undefined,
        cohortId: context.url.searchParams.get("cohortId") ?? undefined
      })
    };
  }

  if (path === "/lms/admin/users" && request.method === "GET") {
    requireRole(currentUser, ["admin"]);
    const { adminUsers } = await services(config);
    return { body: await adminUsers.listUsers() };
  }

  if (path === "/lms/admin/users" && request.method === "POST") {
    requireRole(currentUser, ["admin"]);
    const { adminUsers } = await services(config);
    return { status: 201, body: await adminUsers.createUser(currentUser, requestId, adminUserCreateSchema.parse(await jsonBody(request))) };
  }

  if (path === "/lms/admin/users/bulk" && request.method === "POST") {
    requireRole(currentUser, ["admin"]);
    const { adminUsers } = await services(config);
    const body = adminUserBulkCreateSchema.parse(await jsonBody(request));
    const result = await adminUsers.createUsers(currentUser, requestId, body.users);
    return { status: result.failed.length ? 207 : 201, body: result };
  }

  if (path === "/lms/admin/access-requests" && request.method === "GET") {
    requireRole(currentUser, ["admin"]);
    const { accessRequests } = await services(config);
    const status = context.url.searchParams.get("status");
    return { body: await accessRequests.list(status ? accessRequestStatusSchema.parse(status) : undefined) };
  }

  const accessRequestMatch = path.match(/^\/lms\/admin\/access-requests\/([^/]+)\/(approve|reject)$/);
  if (accessRequestMatch && request.method === "POST") {
    requireRole(currentUser, ["admin"]);
    const { accessRequests } = await services(config);
    const id = decodeURIComponent(accessRequestMatch[1]);
    if (accessRequestMatch[2] === "approve") {
      return {
        status: 201,
        body: await accessRequests.approve(currentUser, requestId, id, accessRequestApproveSchema.parse(await jsonBody(request)))
      };
    }

    return {
      body: await accessRequests.reject(currentUser, requestId, id, accessRequestRejectSchema.parse(await jsonBody(request)))
    };
  }

  const userMatch = path.match(/^\/lms\/admin\/users\/([^/]+)$/);
  const userPasswordResetMatch = path.match(/^\/lms\/admin\/users\/([^/]+)\/reset-password$/);
  if (userPasswordResetMatch && request.method === "POST") {
    requireRole(currentUser, ["admin"]);
    const { adminUsers } = await services(config);
    return {
      body: await adminUsers.resetPassword(
        currentUser,
        requestId,
        decodeURIComponent(userPasswordResetMatch[1]),
        adminUserPasswordResetSchema.parse(await jsonBody(request))
      )
    };
  }

  if (userMatch && request.method === "PATCH") {
    requireRole(currentUser, ["admin"]);
    const { adminUsers } = await services(config);
    return {
      body: await adminUsers.updateUser(
        currentUser,
        requestId,
        decodeURIComponent(userMatch[1]),
        adminUserUpdateSchema.parse(await jsonBody(request))
      )
    };
  }

  if (userMatch && request.method === "DELETE") {
    requireRole(currentUser, ["admin"]);
    const { adminUsers } = await services(config);
    await adminUsers.deleteUser(currentUser, requestId, decodeURIComponent(userMatch[1]));
    return new Response(null, { status: 204 });
  }

  if (path === "/lms/admin/portal-settings" && request.method === "PATCH") {
    requireRole(currentUser, ["admin"]);
    const { adminExperience } = await services(config);
    return { body: await adminExperience.updatePortal(currentUser, requestId, portalUpdateSchema.parse(await jsonBody(request))) };
  }

  throw new AppError(404, "NOT_FOUND", "Route was not found");
}

async function routeKeycloak(context: RequestContext, path: string): Promise<RouteResult> {
  const { request, config } = context;

  if (path === "/keycloak/events" && request.method === "POST") {
    await requireWebhookSecret(config, request.headers.get("x-keycloak-webhook-secret"));
    const event = keycloakEventSchema.parse(await jsonBody(request));
    const service = await keycloakServices(config);
    const result = await service.syncFromEvent(event);
    return { status: 202, body: { ok: true, action: result.action, keycloakSub: result.keycloakSub } };
  }

  throw new AppError(404, "NOT_FOUND", "Route was not found");
}

async function services(config: AppConfig) {
  const db = await getMongoDb(config);
  const repository = new MongoLmsRepository(db, config);
  const users = new MongoUserRepository(db, config);
  const accessRequestRepository = new MongoAccessRequestRepository(db, config);
  const auditLogs = new MongoAuditLogRepository(db, config);
  const adminUsers = new AdminUserService(new KeycloakAdminClient(config), users, auditLogs);
  const adminExperience = new AdminExperienceService(repository, auditLogs);

  return {
    repository,
    learnerExperience: new LearnerExperienceService(repository),
    adminExperience,
    adminUsers,
    accessRequests: new AccessRequestService(accessRequestRepository, adminUsers, adminExperience, createAccessRequestNotifier(config), auditLogs),
    launchService: new LtiLaunchService(
      config,
      new ToolRegistrationRepository(config.registeredTools),
      new LaunchContextRepository(),
      new PlatformKeyService(config)
    )
  };
}

async function keycloakServices(config: AppConfig) {
  return new KeycloakUserSyncService(new KeycloakAdminClient(config), new MongoUserRepository(await getMongoDb(config), config));
}

async function requireCurrentUser(context: RequestContext): Promise<CurrentUser> {
  const bearer = extractBearer(context.request.headers.get("authorization"));
  if (bearer) {
    const verified = await new KeycloakAuthService(context.config).verifyAccessToken(bearer);
    const userRepository = new MongoUserRepository(await getMongoDb(context.config), context.config);
    const existingUser = await userRepository.getByKeycloakSub(verified.keycloakSub ?? verified.id);
    if (!existingUser) {
      throw new AppError(403, "USER_NOT_APPROVED", "User access has not been approved");
    }

    const internalUser = await userRepository.upsertFromKeycloak({
      keycloakSub: verified.keycloakSub ?? verified.id,
      email: verified.email,
      name: verified.name,
      role: verified.role,
      roles: verified.roles,
      permissions: verified.permissions,
      departmentId: verified.departmentId,
      enabled: true,
      lastLoginAt: new Date().toISOString()
    });

    return {
      id: internalUser.id,
      keycloakSub: internalUser.keycloakSub,
      email: internalUser.email,
      name: internalUser.name,
      role: internalUser.role,
      roles: internalUser.roles,
      permissions: internalUser.permissions,
      departmentId: internalUser.departmentId
    };
  }

  if (context.config.env === "production") {
    throw new AppError(401, "AUTH_REQUIRED", "Authentication is required");
  }

  const userId = context.request.headers.get("x-dev-user-id");
  if (!userId) {
    throw new AppError(401, "AUTH_REQUIRED", "Authentication is required");
  }

  const requestedRoles = parseRoles(context.request.headers.get("x-dev-user-roles"));
  const role = primaryRole(requestedRoles);
  return {
    id: userId,
    keycloakSub: undefined,
    email: context.request.headers.get("x-dev-user-email") ?? undefined,
    name: context.request.headers.get("x-dev-user-name") ?? undefined,
    departmentId: context.request.headers.get("x-dev-department-id") ?? undefined,
    role,
    roles: [role],
    permissions: requestedRoles
  };
}

async function requireLtiAccessToken(context: RequestContext) {
  const bearer = extractBearer(context.request.headers.get("authorization"));
  if (!bearer) {
    throw new AppError(401, "MISSING_BEARER_TOKEN", "Missing bearer access token");
  }

  const jwks = await new PlatformKeyService(context.config).jwks();
  const publicKey = await importJWK(jwks.keys[0] as JWK, "RS256");
  const { payload } = await jwtVerify(bearer, publicKey, {
    issuer: context.config.ltiIssuer,
    audience: context.config.ltiIssuer
  });

  requireString(payload.client_id, "client_id");
  return parseScopes(payload);
}

function requireRole(user: CurrentUser, requiredRoles: LmsRole[]) {
  if (!hasAnyRole(user, requiredRoles)) {
    throw new AppError(403, "FORBIDDEN", "User does not have permission to access this resource");
  }
}

async function requireWebhookSecret(config: AppConfig, suppliedSecret: string | null) {
  if (!config.keycloakWebhookSecret) {
    throw new AppError(503, "KEYCLOAK_WEBHOOK_NOT_CONFIGURED", "Keycloak user sync webhook is not configured");
  }

  if (!suppliedSecret || !(await timingSafeEqual(config.keycloakWebhookSecret, suppliedSecret))) {
    throw new AppError(401, "KEYCLOAK_WEBHOOK_UNAUTHORIZED", "Keycloak webhook authentication failed");
  }
}

async function jsonBody(request: Request) {
  if (request.headers.get("content-length") === "0") {
    return {};
  }
  return request.json();
}

async function formBody(request: Request) {
  const text = await request.text();
  return Object.fromEntries(new URLSearchParams(text));
}

function queryObject(url: URL) {
  return Object.fromEntries(url.searchParams);
}

function html(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: { "content-type": "text/html; charset=utf-8" }
  });
}

function toResponse(result: RouteResult): Response {
  if (result instanceof Response) {
    return result;
  }

  return Response.json(result.body ?? null, {
    status: result.status ?? 200,
    headers: result.headers
  });
}

function errorResponse(error: unknown, requestId: string): Response {
  if (error instanceof ZodError) {
    return Response.json(
      { error: { code: "VALIDATION_FAILED", message: "Invalid request", requestId } },
      { status: 400 }
    );
  }

  if (isAppError(error)) {
    return Response.json(
      { error: { code: error.code, message: error.message, requestId } },
      { status: error.statusCode }
    );
  }

  return Response.json(
    { error: { code: "INTERNAL_ERROR", message: "Internal server error", requestId } },
    { status: 500 }
  );
}

function withCors(response: Response, config: AppConfig, request: Request) {
  const headers = new Headers(response.headers);
  const origin = request.headers.get("origin");

  if (origin && (config.corsOrigins.length === 0 || config.corsOrigins.includes(origin))) {
    headers.set("access-control-allow-origin", origin);
    headers.set("access-control-allow-credentials", "true");
  }

  headers.set("vary", "Origin");
  headers.set("access-control-allow-methods", "GET,POST,PATCH,DELETE,OPTIONS");
  headers.set("access-control-allow-headers", "authorization,content-type,x-keycloak-webhook-secret,x-request-id");

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

function corsOnlyConfig(env: WorkerEnv): AppConfig {
  return {
    env: "production",
    port: 0,
    appBaseUrl: "",
    ltiIssuer: "",
    mongoUri: "",
    mongoDbName: "",
    mongoCollectionPrefix: "",
    keycloakIssuer: "",
    keycloakAudience: "",
    keycloakJwksUri: "",
    keycloakAdminRealm: "",
    keycloakAdminTokenRealm: "",
    emailProvider: "noop",
    ltiPlatformKid: "",
    ltiPlatformPrivateKeyPem: "",
    registeredTools: [],
    corsOrigins: parseCorsOrigins(env.CORS_ORIGINS)
  };
}

function parseCorsOrigins(value: string | undefined) {
  return (value ?? "").split(",").map((origin) => origin.trim()).filter(Boolean);
}

function extractBearer(header: string | null) {
  if (!header?.startsWith("Bearer ")) {
    return undefined;
  }
  return header.slice("Bearer ".length);
}

function parseRoles(value: string | null) {
  if (!value) {
    return [];
  }

  return value
    .split(",")
    .map((role) => role.trim())
    .filter((role): role is LmsRole => roles.has(role as LmsRole));
}

function primaryRole(requestedRoles: LmsRole[]): LmsRole {
  if (requestedRoles.includes("admin")) return "admin";
  if (requestedRoles.includes("instructor")) return "instructor";
  return "learner";
}

function parseScopes(payload: JWTPayload) {
  return typeof payload.scope === "string" ? payload.scope.split(" ").filter(Boolean) : [];
}

function requireString(value: unknown, field: string) {
  if (typeof value !== "string") {
    throw new AppError(401, "INVALID_ACCESS_TOKEN", `Access token is missing ${field}`);
  }
  return value;
}

async function timingSafeEqual(expected: string, actual: string) {
  const encoder = new TextEncoder();
  const expectedBytes = encoder.encode(expected);
  const actualBytes = encoder.encode(actual);
  const expectedDigest = new Uint8Array(await crypto.subtle.digest("SHA-256", expectedBytes));
  const actualDigest = new Uint8Array(await crypto.subtle.digest("SHA-256", actualBytes));

  let diff = expectedBytes.length ^ actualBytes.length;
  for (let index = 0; index < expectedDigest.length; index += 1) {
    diff |= expectedDigest[index] ^ actualDigest[index];
  }
  return diff === 0;
}

function normalizePath(pathname: string) {
  return pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
}

function logError(error: unknown, requestId: string, request: Request) {
  if (error instanceof ZodError || isAppError(error)) {
    return;
  }

  try {
    console.error(
      JSON.stringify({
        level: "error",
        msg: "Unhandled Worker request error",
        requestId,
        method: request.method,
        url: new URL(request.url).pathname,
        error: serializeUnknownError(error)
      })
    );
  } catch {
    console.error(
      JSON.stringify({
        level: "error",
        msg: "Unhandled Worker request error",
        requestId,
        method: request.method,
        url: new URL(request.url).pathname,
        error: { type: typeof error }
      })
    );
  }
}

function serializeUnknownError(error: unknown) {
  if (error instanceof Error) {
    return { name: error.name, message: error.message, stack: error.stack };
  }

  if (typeof error === "object" && error !== null) {
    return { type: Object.prototype.toString.call(error) };
  }

  return error;
}
