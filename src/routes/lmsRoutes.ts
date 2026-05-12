import { Router } from "express";
import { AppError } from "../errors/AppError.js";
import { currentUser } from "../middleware/currentUser.js";
import { requireRole } from "../middleware/requireRole.js";
import { LearnerExperienceService } from "../lms/services/learnerExperienceService.js";
import { AdminExperienceService } from "../lms/services/adminExperienceService.js";
import type { AppConfig } from "../config/config.js";
import { getMongoDb } from "../db/mongo.js";
import { MongoLmsRepository } from "../lms/repositories/mongoLmsRepository.js";
import { MongoAuditLogRepository } from "../audit/mongoAuditLogRepository.js";
import { KeycloakAdminClient } from "../integrations/keycloak/keycloakAdminClient.js";
import { LaunchContextRepository } from "../lti/repositories/launchContextRepository.js";
import { ToolRegistrationRepository } from "../lti/repositories/toolRegistrationRepository.js";
import { LtiLaunchService } from "../lti/services/ltiLaunchService.js";
import { PlatformKeyService } from "../lti/services/platformKeyService.js";
import { MongoLineItemRepository } from "../lti/repositories/mongoLineItemRepository.js";
import { AdminUserService } from "../users/adminUserService.js";
import { MongoUserRepository } from "../users/mongoUserRepository.js";
import {
  adminUserCreateSchema,
  adminUserUpdateSchema,
  courseCreateSchema,
  courseUpdateSchema,
  departmentCreateSchema,
  departmentUpdateSchema,
  deepLinkLaunchSchema,
  enrollmentCreateSchema,
  enrollmentUpdateSchema,
  portalUpdateSchema
} from "../lms/validators/lmsSchemas.js";

export function createLmsRouter(config: AppConfig) {
  const router = Router();

  router.use(currentUser(config));

  router.get("/learner/dashboard", requireRole("learner", "instructor", "admin"), async (req, res, next) => {
    try {
      const { learnerExperience } = await services(config);
      res.status(200).json(await learnerExperience.getDashboard(requireUser(req)));
    } catch (error) {
      next(error);
    }
  });

  router.get("/learner/catalog", requireRole("learner", "instructor", "admin"), async (_req, res, next) => {
    try {
      const { learnerExperience } = await services(config);
      res.status(200).json(await learnerExperience.getCatalog());
    } catch (error) {
      next(error);
    }
  });

  router.get("/learner/transcript", requireRole("learner", "instructor", "admin"), async (req, res, next) => {
    try {
      const { learnerExperience } = await services(config);
      res.status(200).json(await learnerExperience.getTranscript(requireUser(req)));
    } catch (error) {
      next(error);
    }
  });

  router.post("/courses/:courseId/launch", requireRole("learner", "instructor", "admin"), async (req, res, next) => {
    try {
      const { repository, launchService } = await services(config);
      const user = requireUser(req);
      const course = await repository.requireCourse(req.params.courseId);
      const enrollment = await repository.getEnrollmentForUserCourse(user.id, course.id);

      if (!enrollment || enrollment.status === "expired" || enrollment.status === "failed") {
        throw new AppError(403, "COURSE_ENROLLMENT_REQUIRED", "User is not enrolled in this course");
      }

      const html = await launchService.createCourseLaunchForm({ course, enrollment, user });
      res.setHeader("content-type", "text/html; charset=utf-8");
      res.status(200).send(html);
    } catch (error) {
      next(error);
    }
  });

  router.get("/admin/overview", requireRole("admin"), async (_req, res, next) => {
    try {
      const { adminExperience } = await services(config);
      res.status(200).json(await adminExperience.getOverview());
    } catch (error) {
      next(error);
    }
  });

  router.get("/admin/courses", requireRole("admin"), async (_req, res, next) => {
    try {
      const { adminExperience } = await services(config);
      res.status(200).json(await adminExperience.listCourses());
    } catch (error) {
      next(error);
    }
  });

  router.get("/admin/enrollments", requireRole("admin"), async (_req, res, next) => {
    try {
      const { adminExperience } = await services(config);
      res.status(200).json(await adminExperience.listEnrollments());
    } catch (error) {
      next(error);
    }
  });

  router.get("/admin/deep-links", requireRole("admin"), async (_req, res, next) => {
    try {
      const db = await getMongoDb(config);
      const lineItems = new MongoLineItemRepository(db, config);
      res.status(200).json({
        contentItems: await lineItems.listDeepLinkedContent(),
        lineItems: await lineItems.list()
      });
    } catch (error) {
      next(error);
    }
  });

  router.get("/admin/users", requireRole("admin"), async (_req, res, next) => {
    try {
      const { adminUsers } = await services(config);
      res.status(200).json(await adminUsers.listUsers());
    } catch (error) {
      next(error);
    }
  });

  router.post("/admin/courses", requireRole("admin"), async (req, res, next) => {
    try {
      const { adminExperience } = await services(config);
      res.status(201).json(await adminExperience.createCourse(requireUser(req), req.requestId, courseCreateSchema.parse(req.body)));
    } catch (error) {
      next(error);
    }
  });

  router.patch("/admin/courses/:courseId", requireRole("admin"), async (req, res, next) => {
    try {
      const { adminExperience } = await services(config);
      res
        .status(200)
        .json(await adminExperience.updateCourse(requireUser(req), req.requestId, req.params.courseId, courseUpdateSchema.parse(req.body)));
    } catch (error) {
      next(error);
    }
  });

  router.post("/admin/courses/:courseId/deep-link", requireRole("admin"), async (req, res, next) => {
    try {
      const { repository, launchService } = await services(config);
      const body = deepLinkLaunchSchema.parse(req.body);
      const html = await launchService.createDeepLinkingLaunchForm({
        course: await repository.requireCourse(req.params.courseId),
        user: requireUser(req),
        cohortId: body.cohortId
      });
      res.setHeader("content-type", "text/html; charset=utf-8");
      res.status(200).send(html);
    } catch (error) {
      next(error);
    }
  });

  router.get("/admin/departments", requireRole("admin"), async (_req, res, next) => {
    try {
      const { adminExperience } = await services(config);
      res.status(200).json(await adminExperience.listDepartments());
    } catch (error) {
      next(error);
    }
  });

  router.post("/admin/departments", requireRole("admin"), async (req, res, next) => {
    try {
      const { adminExperience } = await services(config);
      res
        .status(201)
        .json(await adminExperience.createDepartment(requireUser(req), req.requestId, departmentCreateSchema.parse(req.body)));
    } catch (error) {
      next(error);
    }
  });

  router.patch("/admin/departments/:departmentId", requireRole("admin"), async (req, res, next) => {
    try {
      const { adminExperience } = await services(config);
      res
        .status(200)
        .json(
          await adminExperience.updateDepartment(
            requireUser(req),
            req.requestId,
            req.params.departmentId,
            departmentUpdateSchema.parse(req.body)
          )
        );
    } catch (error) {
      next(error);
    }
  });

  router.post("/admin/enrollments", requireRole("admin"), async (req, res, next) => {
    try {
      const { adminExperience } = await services(config);
      res
        .status(201)
        .json(await adminExperience.createEnrollment(requireUser(req), req.requestId, enrollmentCreateSchema.parse(req.body)));
    } catch (error) {
      next(error);
    }
  });

  router.patch("/admin/enrollments/:enrollmentId", requireRole("admin"), async (req, res, next) => {
    try {
      const { adminExperience } = await services(config);
      res
        .status(200)
        .json(
          await adminExperience.updateEnrollment(
            requireUser(req),
            req.requestId,
            req.params.enrollmentId,
            enrollmentUpdateSchema.parse(req.body)
          )
        );
    } catch (error) {
      next(error);
    }
  });

  router.post("/admin/users", requireRole("admin"), async (req, res, next) => {
    try {
      const { adminUsers } = await services(config);
      res.status(201).json(await adminUsers.createUser(requireUser(req), req.requestId, adminUserCreateSchema.parse(req.body)));
    } catch (error) {
      next(error);
    }
  });

  router.patch("/admin/users/:userId", requireRole("admin"), async (req, res, next) => {
    try {
      const { adminUsers } = await services(config);
      res
        .status(200)
        .json(await adminUsers.updateUser(requireUser(req), req.requestId, req.params.userId, adminUserUpdateSchema.parse(req.body)));
    } catch (error) {
      next(error);
    }
  });

  router.delete("/admin/users/:userId", requireRole("admin"), async (req, res, next) => {
    try {
      const { adminUsers } = await services(config);
      await adminUsers.deleteUser(requireUser(req), req.requestId, req.params.userId);
      res.status(204).send();
    } catch (error) {
      next(error);
    }
  });

  router.patch("/admin/portal-settings", requireRole("admin"), async (req, res, next) => {
    try {
      const { adminExperience } = await services(config);
      res.status(200).json(await adminExperience.updatePortal(requireUser(req), req.requestId, portalUpdateSchema.parse(req.body)));
    } catch (error) {
      next(error);
    }
  });

  return router;
}

async function services(config: AppConfig) {
  const db = await getMongoDb(config);
  const repository = new MongoLmsRepository(db, config);
  const users = new MongoUserRepository(db, config);
  const auditLogs = new MongoAuditLogRepository(db, config);
  return {
    repository,
    learnerExperience: new LearnerExperienceService(repository),
    adminExperience: new AdminExperienceService(repository, auditLogs),
    adminUsers: new AdminUserService(new KeycloakAdminClient(config), users, auditLogs),
    launchService: new LtiLaunchService(
      config,
      new ToolRegistrationRepository(config.registeredTools),
      new LaunchContextRepository(),
      new PlatformKeyService(config)
    )
  };
}

function requireUser(req: Express.Request) {
  if (!req.currentUser) {
    throw new AppError(401, "AUTH_REQUIRED", "Authentication is required");
  }
  return req.currentUser;
}
