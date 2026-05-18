import { describe, expect, it } from "vitest";
import { AgsService } from "../src/lti/services/agsService.js";
import { LineItemRepository } from "../src/lti/repositories/lineItemRepository.js";
import { LTI_SCOPES } from "../src/lti/ltiConstants.js";

describe("AgsService", () => {
  it("requires write scope to create line items", async () => {
    const service = new AgsService(new LineItemRepository());

    await expect(service.createLineItem([LTI_SCOPES.lineItemReadonly], { label: "PACT", scoreMaximum: 100 })).rejects.toThrow(
      "Access token does not include a required AGS scope"
    );
  });

  it("creates and lists line items with the right scopes", async () => {
    const service = new AgsService(new LineItemRepository());
    const created = await service.createLineItem([LTI_SCOPES.lineItem], { label: "PACT", scoreMaximum: 100 });

    expect(created.id).toEqual(expect.any(String));
    await expect(service.listLineItems([LTI_SCOPES.lineItemReadonly])).resolves.toHaveLength(1);
  });

  it("builds an admin gradebook from AGS line items and scores", async () => {
    const repository = new LineItemRepository();
    const service = new AgsService(repository);
    const lineItem = await service.createLineItem([LTI_SCOPES.lineItem], { label: "PACT Challenge", scoreMaximum: 100, resourceId: "pact", tag: "challenge" });
    await service.submitScore([LTI_SCOPES.score], lineItem.id, {
      userId: "learner-1",
      scoreGiven: 91,
      scoreMaximum: 100,
      activityProgress: "Completed",
      gradingProgress: "FullyGraded",
      timestamp: "2026-05-12T00:00:00.000Z"
    });

    await expect(service.listAdminGradebook()).resolves.toMatchObject({
      lineItems: [expect.objectContaining({ id: lineItem.id })],
      grades: [expect.objectContaining({ lineItemId: lineItem.id, lineItemLabel: "PACT Challenge", scoreGiven: 91 })]
    });
  });

  it("filters the admin gradebook by synced course and cohort context", async () => {
    const service = new AgsService({
      list: () => [
        {
          id: "line-item-alpha",
          label: "Alpha Challenge",
          scoreMaximum: 100,
          createdAt: "2026-05-12T00:00:00.000Z",
          updatedAt: "2026-05-12T00:00:00.000Z"
        },
        {
          id: "line-item-beta",
          label: "Beta Challenge",
          scoreMaximum: 100,
          createdAt: "2026-05-12T00:00:00.000Z",
          updatedAt: "2026-05-12T00:00:00.000Z"
        }
      ],
      listDeepLinkedContent: () => [
        {
          id: "content-alpha",
          toolClientId: "pact-tool",
          type: "ltiResourceLink",
          title: "Alpha Challenge",
          courseId: "pact",
          cohortId: "cohort-alpha",
          lineItemId: "line-item-alpha",
          createdAt: "2026-05-12T00:00:00.000Z",
          updatedAt: "2026-05-12T00:00:00.000Z"
        },
        {
          id: "content-beta",
          toolClientId: "pact-tool",
          type: "ltiResourceLink",
          title: "Beta Challenge",
          courseId: "pact",
          cohortId: "cohort-beta",
          lineItemId: "line-item-beta",
          createdAt: "2026-05-12T00:00:00.000Z",
          updatedAt: "2026-05-12T00:00:00.000Z"
        }
      ],
      listScores: () => [
        {
          id: "score-alpha",
          lineItemId: "line-item-alpha",
          userId: "learner-alpha",
          scoreGiven: 91,
          scoreMaximum: 100,
          activityProgress: "Completed",
          gradingProgress: "FullyGraded",
          timestamp: "2026-05-12T00:00:00.000Z"
        },
        {
          id: "score-beta",
          lineItemId: "line-item-beta",
          userId: "learner-beta",
          scoreGiven: 78,
          scoreMaximum: 100,
          activityProgress: "Completed",
          gradingProgress: "FullyGraded",
          timestamp: "2026-05-12T00:00:00.000Z"
        }
      ],
      create: () => {
        throw new Error("not used");
      },
      addScore: () => {
        throw new Error("not used");
      }
    });

    const gradebook = await service.listAdminGradebook({ courseId: "pact", cohortId: "cohort-alpha" });

    expect(gradebook.grades).toEqual([
      expect.objectContaining({
        id: "score-alpha",
        courseId: "pact",
        cohortId: "cohort-alpha",
        contentTitle: "Alpha Challenge"
      })
    ]);
  });

  it("updates LMS enrollment progress when an AGS score maps to course content", async () => {
    const lineItem = {
      id: "line-item-course",
      label: "Course Grade",
      scoreMaximum: 100,
      createdAt: "2026-05-12T00:00:00.000Z",
      updatedAt: "2026-05-12T00:00:00.000Z"
    };
    const enrollmentUpdates: unknown[] = [];
    const service = new AgsService(
      {
        list: () => [lineItem],
        listDeepLinkedContent: () => [
          {
            id: "content-course",
            toolClientId: "pact-tool",
            type: "ltiResourceLink",
            title: "Course Grade",
            courseId: "pact",
            cohortId: "cohort-alpha",
            lineItemId: lineItem.id,
            createdAt: "2026-05-12T00:00:00.000Z",
            updatedAt: "2026-05-12T00:00:00.000Z"
          }
        ],
        listScores: () => [],
        create: () => lineItem,
        addScore: (_lineItemId, score) => score
      },
      {
        getEnrollmentForUserCourse: async () => ({
          id: "enrollment-1",
          userId: "learner-1",
          courseId: "pact",
          cohortId: "cohort-alpha",
          status: "in_progress",
          progressPercent: 25,
          enrolledAt: "2026-05-12T00:00:00.000Z"
        }),
        updateEnrollment: async (_id, input) => {
          enrollmentUpdates.push(input);
          return {
            id: "enrollment-1",
            userId: "learner-1",
            courseId: "pact",
            status: "completed",
            progressPercent: 100,
            enrolledAt: "2026-05-12T00:00:00.000Z",
            ...input
          };
        }
      }
    );

    await service.submitScore([LTI_SCOPES.score], lineItem.id, {
      userId: "learner-1",
      scoreGiven: 87,
      scoreMaximum: 100,
      activityProgress: "Completed",
      gradingProgress: "FullyGraded",
      timestamp: "2026-05-18T20:00:00.000Z"
    });

    expect(enrollmentUpdates).toEqual([
      {
        progressPercent: 100,
        scorePercent: 87,
        status: "completed",
        completedAt: "2026-05-18T20:00:00.000Z"
      }
    ]);
  });
});
