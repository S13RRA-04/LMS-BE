import { AppError } from "../../errors/AppError.js";
import type { LineItem, Score, ScoreRecord } from "../ltiTypes.js";

export class LineItemRepository {
  private readonly lineItems = new Map<string, LineItem>();
  private readonly scoresByLineItem = new Map<string, ScoreRecord[]>();

  list(): LineItem[] {
    return [...this.lineItems.values()];
  }

  create(input: Pick<LineItem, "label" | "scoreMaximum" | "resourceId" | "tag">): LineItem {
    const now = new Date().toISOString();
    const item: LineItem = {
      id: crypto.randomUUID(),
      label: input.label,
      scoreMaximum: input.scoreMaximum,
      resourceId: input.resourceId,
      tag: input.tag,
      createdAt: now,
      updatedAt: now
    };
    this.lineItems.set(item.id, item);
    return item;
  }

  requireById(id: string): LineItem {
    const item = this.lineItems.get(id);
    if (!item) {
      throw new AppError(404, "LINE_ITEM_NOT_FOUND", "Line item was not found");
    }
    return item;
  }

  addScore(lineItemId: string, score: Score): Score {
    this.requireById(lineItemId);
    const existing = this.scoresByLineItem.get(lineItemId) ?? [];
    existing.push({ id: crypto.randomUUID(), lineItemId, ...score });
    this.scoresByLineItem.set(lineItemId, existing);
    return score;
  }

  listScores(): ScoreRecord[] {
    return [...this.scoresByLineItem.values()].flat();
  }
}
