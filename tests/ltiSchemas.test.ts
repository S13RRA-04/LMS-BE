import { describe, expect, it } from "vitest";
import { lineItemBodySchema, scoreBodySchema } from "../src/lti/validators/ltiSchemas.js";

describe("LTI validation schemas", () => {
  it("accepts a valid AGS line item", () => {
    expect(lineItemBodySchema.parse({ label: "PACT Score", scoreMaximum: 100 })).toEqual({
      label: "PACT Score",
      scoreMaximum: 100
    });
  });

  it("rejects invalid AGS scores", () => {
    expect(() =>
      scoreBodySchema.parse({
        userId: "learner-1",
        scoreGiven: -1,
        scoreMaximum: 100,
        activityProgress: "Completed",
        gradingProgress: "FullyGraded",
        timestamp: "2026-05-12T12:00:00.000Z"
      })
    ).toThrow();
  });
});
