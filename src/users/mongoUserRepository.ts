import type { Collection, Db, OptionalUnlessRequiredId } from "mongodb";
import type { AppConfig } from "../config/config.js";
import { collectionNames } from "../db/mongo.js";
import type { AdminUser, InternalUser, UpsertInternalUserInput } from "./userTypes.js";

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
      username: input.username ?? existing?.username,
      email: input.email,
      name: input.name,
      role: input.role,
      roles: [input.role],
      permissions: input.permissions,
      departmentId: input.departmentId,
      enabled: input.enabled ?? existing?.enabled ?? true,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      lastLoginAt: input.lastLoginAt ?? existing?.lastLoginAt
    };

    await this.users().replaceOne({ keycloakSub: input.keycloakSub }, user, { upsert: true });
    return user;
  }

  async listActive(): Promise<AdminUser[]> {
    return (await this.users().find({ deletedAt: { $exists: false } }).sort({ email: 1, username: 1 }).toArray()).map(toAdminUser);
  }

  async getById(id: string): Promise<AdminUser | undefined> {
    const user = await this.users().findOne({ id, deletedAt: { $exists: false } });
    return user ? toAdminUser(user) : undefined;
  }

  async markDeleted(id: string): Promise<void> {
    const now = new Date().toISOString();
    await this.users().updateOne({ id }, { $set: { enabled: false, updatedAt: now, deletedAt: now } });
  }

  async markDeletedByKeycloakSub(keycloakSub: string): Promise<AdminUser | undefined> {
    const existing = await this.users().findOne({ keycloakSub, deletedAt: { $exists: false } });
    if (!existing) {
      return undefined;
    }

    const now = new Date().toISOString();
    await this.users().updateOne({ keycloakSub }, { $set: { enabled: false, updatedAt: now, deletedAt: now } });
    return { ...toAdminUser(existing), enabled: false, updatedAt: now };
  }

  private users(): Collection<Stored<InternalUser>> {
    return this.db.collection<Stored<InternalUser>>(this.collectionName);
  }
}

function toAdminUser(user: Stored<InternalUser>): AdminUser {
  return {
    id: user.id,
    keycloakSub: user.keycloakSub,
    username: user.username,
    email: user.email,
    name: user.name,
    role: user.role,
    roles: user.roles,
    permissions: user.permissions,
    departmentId: user.departmentId,
    enabled: user.enabled,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
    lastLoginAt: user.lastLoginAt
  };
}
