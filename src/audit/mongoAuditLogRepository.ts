import crypto from "node:crypto";
import type { Collection, Db, OptionalUnlessRequiredId } from "mongodb";
import type { AppConfig } from "../config/config.js";
import { collectionNames } from "../db/mongo.js";
import type { AuditAction, AuditLog } from "./auditTypes.js";
import type { CurrentUser } from "../auth/currentUser.js";

type Stored<T> = T & { _id?: unknown };

export class MongoAuditLogRepository {
  private readonly collectionName;

  constructor(private readonly db: Db, config: AppConfig) {
    this.collectionName = collectionNames(config).auditLogs;
  }

  async record(input: {
    action: AuditAction;
    actor: CurrentUser;
    targetType: string;
    targetId: string;
    requestId?: string;
    metadata?: Record<string, unknown>;
  }): Promise<AuditLog> {
    const log: AuditLog = {
      id: crypto.randomUUID(),
      action: input.action,
      actorUserId: input.actor.id,
      actorKeycloakSub: input.actor.keycloakSub,
      targetType: input.targetType,
      targetId: input.targetId,
      requestId: input.requestId,
      occurredAt: new Date().toISOString(),
      metadata: input.metadata
    };
    await this.auditLogs().insertOne(log as OptionalUnlessRequiredId<Stored<AuditLog>>);
    return log;
  }

  private auditLogs(): Collection<Stored<AuditLog>> {
    return this.db.collection<Stored<AuditLog>>(this.collectionName);
  }
}
