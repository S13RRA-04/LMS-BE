import { MongoClient, type Db, type MongoClientOptions } from "mongodb";
import type { AppConfig } from "../config/config.js";

let client: MongoClient | undefined;

export type MongoCollections = {
  portalSettings: string;
  departments: string;
  courses: string;
  enrollments: string;
  users: string;
  auditLogs: string;
};

export function collectionNames(config: AppConfig): MongoCollections {
  const prefix = config.mongoCollectionPrefix;
  return {
    portalSettings: `${prefix}portal_settings`,
    departments: `${prefix}departments`,
    courses: `${prefix}courses`,
    enrollments: `${prefix}enrollments`,
    users: `${prefix}users`,
    auditLogs: `${prefix}audit_logs`
  };
}

export async function getMongoDb(config: AppConfig): Promise<Db> {
  if (!client) {
    const options: MongoClientOptions = config.mongoTlsCertKeyFile
      ? { tlsCertificateKeyFile: config.mongoTlsCertKeyFile }
      : {};
    client = new MongoClient(config.mongoUri, options);
    await client.connect();
  }

  return client.db(config.mongoDbName);
}

export async function closeMongoClient() {
  await client?.close();
  client = undefined;
}

export async function ensureMongoCollections(config: AppConfig) {
  const db = await getMongoDb(config);
  const existing = new Set((await db.listCollections().toArray()).map((collection) => collection.name));
  const names = collectionNames(config);

  for (const name of Object.values(names)) {
    if (!existing.has(name)) {
      await db.createCollection(name);
    }
  }

  await db.collection(names.portalSettings).createIndex({ id: 1 }, { unique: true });
  await db.collection(names.departments).createIndex({ id: 1 }, { unique: true });
  await db.collection(names.departments).createIndex({ parentDepartmentId: 1 });
  await db.collection(names.courses).createIndex({ id: 1 }, { unique: true });
  await db.collection(names.courses).createIndex({ slug: 1 }, { unique: true });
  await db.collection(names.courses).createIndex({ status: 1, category: 1 });
  await db.collection(names.enrollments).createIndex({ id: 1 }, { unique: true });
  await db.collection(names.enrollments).createIndex({ userId: 1, courseId: 1 }, { unique: true });
  await db.collection(names.enrollments).createIndex({ courseId: 1, status: 1 });
  await db.collection(names.enrollments).createIndex({ courseId: 1, cohortId: 1 });
  await db.collection(names.users).createIndex({ id: 1 }, { unique: true });
  await db.collection(names.users).createIndex({ keycloakSub: 1 }, { unique: true });
  await db.collection(names.users).createIndex({ email: 1 });
  await db.collection(names.auditLogs).createIndex({ id: 1 }, { unique: true });
  await db.collection(names.auditLogs).createIndex({ actorUserId: 1, occurredAt: -1 });
  await db.collection(names.auditLogs).createIndex({ action: 1, occurredAt: -1 });
}
