import { describe, expect, it } from "vitest";
import { LmsCatalogRepository } from "../src/lms/repositories/lmsCatalogRepository.js";
import { LearnerExperienceService } from "../src/lms/services/learnerExperienceService.js";
import { AdminExperienceService } from "../src/lms/services/adminExperienceService.js";

describe("LMS Absorb-style experience services", () => {
  it("builds a learner dashboard with catalog, assigned work, and transcript", async () => {
    const service = new LearnerExperienceService(new LmsCatalogRepository());

    const dashboard = await service.getDashboard({ id: "demo-learner", role: "learner", roles: ["learner"], permissions: [] });

    expect(dashboard.portal.name).toBe("CETU LMS");
    expect(dashboard.assigned).toHaveLength(1);
    expect(dashboard.transcript[0]?.course.slug).toBe("pact");
  });

  it("builds admin reporting overview from courses and enrollments", async () => {
    const service = new AdminExperienceService(new LmsCatalogRepository());

    await expect(service.getOverview()).resolves.toEqual({
      publishedCourses: 1,
      draftCourses: 0,
      activeEnrollments: 1,
      completedEnrollments: 0
    });
  });
});
