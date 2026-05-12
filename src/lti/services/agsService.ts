import { AppError } from "../../errors/AppError.js";
import { LTI_SCOPES } from "../ltiConstants.js";
import type { AgsGradeRecord, DeepLinkedContent, LineItem, Score, ScoreRecord } from "../ltiTypes.js";

type LineItemStore = {
  list(): Promise<LineItem[]> | LineItem[];
  listDeepLinkedContent?(): Promise<DeepLinkedContent[]> | DeepLinkedContent[];
  listScores?(): Promise<ScoreRecord[]> | ScoreRecord[];
  create(input: Pick<LineItem, "label" | "scoreMaximum" | "resourceId" | "tag">): Promise<LineItem> | LineItem;
  addScore(lineItemId: string, score: Score): Promise<Score> | Score;
};

export class AgsService {
  constructor(private readonly lineItems: LineItemStore) {}

  async listLineItems(scopes: string[]) {
    requireAnyScope(scopes, [LTI_SCOPES.lineItem, LTI_SCOPES.lineItemReadonly]);
    return this.lineItems.list();
  }

  async createLineItem(scopes: string[], input: Pick<LineItem, "label" | "scoreMaximum" | "resourceId" | "tag">) {
    requireAnyScope(scopes, [LTI_SCOPES.lineItem]);
    return this.lineItems.create(input);
  }

  async submitScore(scopes: string[], lineItemId: string, input: Score) {
    requireAnyScope(scopes, [LTI_SCOPES.score]);
    return this.lineItems.addScore(lineItemId, input);
  }

  async listAdminGradebook(): Promise<{ lineItems: LineItem[]; grades: AgsGradeRecord[] }> {
    const lineItems = await this.lineItems.list();
    const scores = this.lineItems.listScores ? await this.lineItems.listScores() : [];
    const deepLinks = this.lineItems.listDeepLinkedContent ? await this.lineItems.listDeepLinkedContent() : [];
    const lineItemById = new Map(lineItems.map((item) => [item.id, item]));
    const contentByLineItemId = new Map(deepLinks.filter((item) => item.lineItemId).map((item) => [item.lineItemId as string, item]));

    return {
      lineItems,
      grades: scores.map((score) => {
        const lineItem = lineItemById.get(score.lineItemId);
        const content = contentByLineItemId.get(score.lineItemId);
        return {
          ...score,
          lineItemLabel: lineItem?.label ?? "Unknown line item",
          lineItemScoreMaximum: lineItem?.scoreMaximum ?? score.scoreMaximum,
          resourceId: lineItem?.resourceId,
          tag: lineItem?.tag,
          courseId: content?.courseId,
          cohortId: content?.cohortId,
          contentTitle: content?.title
        };
      })
    };
  }
}

function requireAnyScope(actual: string[], required: string[]) {
  if (!required.some((scope) => actual.includes(scope))) {
    throw new AppError(403, "INSUFFICIENT_SCOPE", "Access token does not include a required AGS scope");
  }
}
