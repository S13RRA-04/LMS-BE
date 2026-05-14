import { z } from "zod";

const courseTypeSchema = z.enum(["online", "instructor_led", "curriculum", "bundle", "lti_tool"]);
const courseStatusSchema = z.enum(["draft", "published", "archived"]);
const cohortStatusSchema = z.enum(["active", "archived"]);
const enrollmentStatusSchema = z.enum(["not_started", "in_progress", "completed", "failed", "expired"]);
const lmsRoleSchema = z.enum(["learner", "instructor", "admin"]);

export const courseCreateSchema = z.object({
  id: z.string().min(1).max(120),
  slug: z.string().min(1).max(160).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  title: z.string().min(1).max(255),
  description: z.string().max(4000).default(""),
  type: courseTypeSchema,
  status: courseStatusSchema.default("draft"),
  category: z.string().min(1).max(255),
  departmentIds: z.array(z.string().min(1)).min(1),
  allowSelfEnrollment: z.boolean().default(false),
  estimatedMinutes: z.number().int().positive().optional(),
  ltiToolClientId: z.string().min(1).optional()
}).strict();

export const courseUpdateSchema = courseCreateSchema
  .omit({ id: true })
  .partial()
  .refine((value) => Object.keys(value).length > 0, { message: "At least one course field is required" });

export const departmentCreateSchema = z.object({
  id: z.string().min(1).max(120),
  name: z.string().min(1).max(255),
  parentDepartmentId: z.string().min(1).max(120).optional(),
  brandColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional()
}).strict();

export const departmentUpdateSchema = departmentCreateSchema
  .omit({ id: true })
  .partial()
  .refine((value) => Object.keys(value).length > 0, { message: "At least one department field is required" });

export const cohortCreateSchema = z.object({
  id: z.string().min(1).max(120).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  name: z.string().min(1).max(255),
  description: z.string().max(1000).optional(),
  courseIds: z.array(z.string().min(1).max(120)).min(1),
  status: cohortStatusSchema.default("active")
}).strict();

export const cohortUpdateSchema = cohortCreateSchema
  .omit({ id: true })
  .partial()
  .refine((value) => Object.keys(value).length > 0, { message: "At least one cohort field is required" });

export const enrollmentCreateSchema = z.object({
  id: z.string().min(1).max(120).optional(),
  userId: z.string().min(1).max(255),
  courseId: z.string().min(1).max(120),
  cohortId: z.string().min(1).max(120).optional(),
  status: enrollmentStatusSchema.default("not_started"),
  progressPercent: z.number().min(0).max(100).default(0),
  scorePercent: z.number().min(0).max(100).optional(),
  enrolledAt: z.string().datetime().optional(),
  completedAt: z.string().datetime().optional()
}).strict();

export const enrollmentUpdateSchema = enrollmentCreateSchema
  .omit({ id: true, userId: true, courseId: true, enrolledAt: true })
  .partial()
  .refine((value) => Object.keys(value).length > 0, { message: "At least one enrollment field is required" });

export const portalUpdateSchema = z
  .object({
    name: z.string().min(1).max(255).optional(),
    supportEmail: z.string().email().optional(),
    defaultDepartmentId: z.string().min(1).max(120).optional(),
    learnerFeatures: z
      .object({
        catalog: z.boolean().optional(),
        transcript: z.boolean().optional(),
        resources: z.boolean().optional(),
        leaderboard: z.boolean().optional()
      })
      .optional()
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, { message: "At least one portal field is required" });

export const adminUserCreateSchema = z.object({
  username: z.string().min(3).max(120).regex(/^[a-zA-Z0-9._@-]+$/),
  email: z.string().email().max(255),
  name: z.string().min(1).max(255).optional(),
  role: lmsRoleSchema,
  departmentId: z.string().min(1).max(120).optional(),
  enabled: z.boolean().default(true),
  temporaryPassword: z.string().min(12).max(256).optional()
}).strict();

export const adminUserBulkCreateSchema = z.object({
  users: z.array(adminUserCreateSchema).min(1).max(100)
}).strict();

export const adminUserUpdateSchema = adminUserCreateSchema
  .partial()
  .refine((value) => Object.keys(value).length > 0, { message: "At least one user field is required" });

export const deepLinkLaunchSchema = z.object({
  cohortId: z.string().min(1).max(120).optional()
}).strict();
