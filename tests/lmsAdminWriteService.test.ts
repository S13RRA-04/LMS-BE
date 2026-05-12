import { describe, expect, it } from "vitest";
import { LmsCatalogRepository } from "../src/lms/repositories/lmsCatalogRepository.js";
import { AdminExperienceService } from "../src/lms/services/adminExperienceService.js";
import { courseCreateSchema, enrollmentUpdateSchema } from "../src/lms/validators/lmsSchemas.js";

describe("LMS admin write behavior", () => {
  const actor = { id: "admin-user", role: "admin" as const, roles: ["admin" as const], permissions: [] };

  it("creates courses through the admin service", async () => {
    const service = new AdminExperienceService(new LmsCatalogRepository());

    const course = await service.createCourse(
      actor,
      "test-request",
      courseCreateSchema.parse({
        id: "incident-response",
        slug: "incident-response",
        title: "Incident Response",
        type: "online",
        status: "draft",
        category: "Cyber Operations",
        departmentIds: ["cyber-training"],
        allowSelfEnrollment: false
      })
    );

    expect(course.createdAt).toEqual(expect.any(String));
    await expect(service.listCourses()).resolves.toHaveLength(2);
  });

  it("rejects enrollment updates that attempt to mass-assign user or course identity", () => {
    expect(() =>
      enrollmentUpdateSchema.parse({
        userId: "attacker",
        courseId: "pact",
        progressPercent: 50
      })
    ).toThrow();
  });

  it("allows admins to assign a cohort during course enrollment", async () => {
    const service = new AdminExperienceService(new LmsCatalogRepository());

    const enrollment = await service.createEnrollment(actor, "test-request", {
      userId: "learner-2",
      courseId: "pact",
      cohortId: "cohort-alpha",
      status: "not_started",
      progressPercent: 0
    });

    expect(enrollment).toMatchObject({
      userId: "learner-2",
      courseId: "pact",
      cohortId: "cohort-alpha"
    });
  });
});
