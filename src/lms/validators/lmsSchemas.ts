import { z } from "zod";

const courseTypeSchema = z.enum(["online", "instructor_led", "curriculum", "bundle", "lti_tool"]);
const courseStatusSchema = z.enum(["draft", "published", "archived"]);
const enrollmentStatusSchema = z.enum(["not_started", "in_progress", "completed", "failed", "expired"]);

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

export const enrollmentCreateSchema = z.object({
  id: z.string().min(1).max(120).optional(),
  userId: z.string().min(1).max(255),
  courseId: z.string().min(1).max(120),
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
