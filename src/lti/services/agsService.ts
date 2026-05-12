import { AppError } from "../../errors/AppError.js";
import { LTI_SCOPES } from "../ltiConstants.js";
import type { LineItem, Score } from "../ltiTypes.js";
import type { LineItemRepository } from "../repositories/lineItemRepository.js";

export class AgsService {
  constructor(private readonly lineItems: LineItemRepository) {}

  listLineItems(scopes: string[]) {
    requireAnyScope(scopes, [LTI_SCOPES.lineItem, LTI_SCOPES.lineItemReadonly]);
    return this.lineItems.list();
  }

  createLineItem(scopes: string[], input: Pick<LineItem, "label" | "scoreMaximum" | "resourceId" | "tag">) {
    requireAnyScope(scopes, [LTI_SCOPES.lineItem]);
    return this.lineItems.create(input);
  }

  submitScore(scopes: string[], lineItemId: string, input: Score) {
    requireAnyScope(scopes, [LTI_SCOPES.score]);
    return this.lineItems.addScore(lineItemId, input);
  }
}

function requireAnyScope(actual: string[], required: string[]) {
  if (!required.some((scope) => actual.includes(scope))) {
    throw new AppError(403, "INSUFFICIENT_SCOPE", "Access token does not include a required AGS scope");
  }
}
