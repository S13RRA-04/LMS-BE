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
});
