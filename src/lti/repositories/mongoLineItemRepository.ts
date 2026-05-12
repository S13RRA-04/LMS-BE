import crypto from "node:crypto";
import type { Collection, Db, OptionalUnlessRequiredId } from "mongodb";
import type { AppConfig } from "../../config/config.js";
import { collectionNames } from "../../db/mongo.js";
import { AppError } from "../../errors/AppError.js";
import type { DeepLinkContentItem, DeepLinkedContent, LineItem, Score, ScoreRecord } from "../ltiTypes.js";

type Stored<T> = T & { _id?: unknown };

export class MongoLineItemRepository {
  private readonly names;

  constructor(private readonly db: Db, config: AppConfig) {
    this.names = collectionNames(config);
  }

  async list(): Promise<LineItem[]> {
    return (await this.lineItems().find().sort({ createdAt: -1 }).toArray()).map(stripId);
  }

  async listDeepLinkedContent(): Promise<DeepLinkedContent[]> {
    return (await this.contentItems().find().sort({ createdAt: -1 }).toArray()).map(stripId);
  }

  async create(input: Pick<LineItem, "label" | "scoreMaximum" | "resourceId" | "tag">): Promise<LineItem> {
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
    await this.lineItems().insertOne(item as OptionalUnlessRequiredId<Stored<LineItem>>);
    return item;
  }

  async upsertFromDeepLink(item: DeepLinkContentItem): Promise<LineItem | undefined> {
    if (!item.lineItem) {
      return undefined;
    }

    const now = new Date().toISOString();
    const resourceId = item.lineItem.resourceId ?? item.url ?? item.title;
    const tag = item.lineItem.tag ?? item.type;
    const existing = await this.lineItems().findOne({ resourceId, tag });
    const lineItem: LineItem = {
      id: existing?.id ?? crypto.randomUUID(),
      label: item.lineItem.label ?? item.title,
      scoreMaximum: item.lineItem.scoreMaximum ?? 100,
      resourceId,
      tag,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now
    };

    await this.lineItems().updateOne({ resourceId, tag }, { $set: lineItem }, { upsert: true });
    return lineItem;
  }

  async requireById(id: string): Promise<LineItem> {
    const item = await this.lineItems().findOne({ id });
    if (!item) {
      throw new AppError(404, "LINE_ITEM_NOT_FOUND", "Line item was not found");
    }
    return stripId(item);
  }

  async addScore(lineItemId: string, score: Score): Promise<Score> {
    await this.requireById(lineItemId);
    await this.scores().insertOne({ id: crypto.randomUUID(), lineItemId, ...score } as OptionalUnlessRequiredId<Stored<Score & { id: string; lineItemId: string }>>);
    return score;
  }

  async listScores(): Promise<ScoreRecord[]> {
    return (await this.scores().find().sort({ timestamp: -1 }).toArray()).map(stripId);
  }

  async saveDeepLinkedContent(input: {
    toolClientId: string;
    item: DeepLinkContentItem;
    lineItem?: LineItem;
    courseId?: string;
    cohortId?: string;
  }): Promise<DeepLinkedContent> {
    const now = new Date().toISOString();
    const resourceId = input.item.lineItem?.resourceId ?? input.item.url ?? input.item.title;
    const existing = await this.contentItems().findOne({ toolClientId: input.toolClientId, resourceId });
    const content: DeepLinkedContent = {
      id: existing?.id ?? crypto.randomUUID(),
      toolClientId: input.toolClientId,
      type: input.item.type,
      title: input.item.title,
      url: input.item.url,
      text: input.item.text,
      resourceId,
      tag: input.item.lineItem?.tag,
      courseId: input.courseId,
      cohortId: input.cohortId,
      lineItemId: input.lineItem?.id,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now
    };

    await this.contentItems().updateOne({ toolClientId: input.toolClientId, resourceId }, { $set: content }, { upsert: true });
    return content;
  }

  private lineItems() {
    return this.db.collection<Stored<LineItem>>(this.names.ltiLineItems);
  }

  private scores() {
    return this.db.collection<Stored<ScoreRecord>>(this.names.ltiScores);
  }

  private contentItems() {
    return this.db.collection<Stored<DeepLinkedContent>>(this.names.ltiContentItems);
  }
}

function stripId<T>(document: Stored<T>): T {
  const { _id: _ignored, ...rest } = document;
  return rest as T;
}
