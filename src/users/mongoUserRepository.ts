import crypto from "node:crypto";
import type { Collection, Db, OptionalUnlessRequiredId } from "mongodb";
import type { AppConfig } from "../config/config.js";
import { collectionNames } from "../db/mongo.js";
import type { InternalUser, UpsertInternalUserInput } from "./userTypes.js";

type Stored<T> = T & { _id?: unknown };

export class MongoUserRepository {
  private readonly collectionName;

  constructor(private readonly db: Db, config: AppConfig) {
    this.collectionName = collectionNames(config).users;
  }

  async upsertFromKeycloak(input: UpsertInternalUserInput): Promise<InternalUser> {
    const now = new Date().toISOString();
    const existing = await this.users().findOne({ keycloakSub: input.keycloakSub });
    const user: InternalUser = {
      id: existing?.id ?? crypto.randomUUID(),
      keycloakSub: input.keycloakSub,
      email: input.email,
      name: input.name,
      role: input.role,
      roles: [input.role],
      permissions: input.permissions,
      departmentId: input.departmentId,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      lastLoginAt: now
    };

    await this.users().replaceOne({ keycloakSub: input.keycloakSub }, user, { upsert: true });
    return user;
  }

  private users(): Collection<Stored<InternalUser>> {
    return this.db.collection<Stored<InternalUser>>(this.collectionName);
  }
}
