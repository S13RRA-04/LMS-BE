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
import {
  courseCreateSchema,
  courseUpdateSchema,
  departmentCreateSchema,
  departmentUpdateSchema,
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
  const auditLogs = new MongoAuditLogRepository(db, config);
  return {
    learnerExperience: new LearnerExperienceService(repository),
    adminExperience: new AdminExperienceService(repository, auditLogs)
  };
}

function requireUser(req: Express.Request) {
  if (!req.currentUser) {
    throw new AppError(401, "AUTH_REQUIRED", "Authentication is required");
  }
  return req.currentUser;
}
