import { MongoClient, type Db } from "mongodb";
import type { AppConfig } from "../config/config.js";

const clients = new Map<string, Promise<MongoClient>>();

export type MongoCollections = {
  portalSettings: string;
  departments: string;
  courses: string;
  cohorts: string;
  enrollments: string;
  users: string;
  auditLogs: string;
  ltiContentItems: string;
  ltiLineItems: string;
  ltiScores: string;
};

export function collectionNames(config: AppConfig): MongoCollections {
  const prefix = config.mongoCollectionPrefix;
  return {
    portalSettings: `${prefix}portal_settings`,
    departments: `${prefix}departments`,
    courses: `${prefix}courses`,
    cohorts: `${prefix}cohorts`,
    enrollments: `${prefix}enrollments`,
    users: `${prefix}users`,
    auditLogs: `${prefix}audit_logs`,
    ltiContentItems: `${prefix}lti_content_items`,
    ltiLineItems: `${prefix}lti_line_items`,
    ltiScores: `${prefix}lti_scores`
  };
}

export async function getMongoDb(config: AppConfig): Promise<Db> {
  if (config.env === "production") {
    const client = await connectMongoClient(config);
    return client.db(config.mongoDbName);
  }

  const key = mongoClientKey(config);
  let clientPromise = clients.get(key);

  if (!clientPromise) {
    clientPromise = connectMongoClient(config);
    clients.set(key, clientPromise);
  }

  const client = await clientPromise;
  return client.db(config.mongoDbName);
}

export async function closeMongoClient() {
  const clientPromises = [...clients.values()];
  clients.clear();
  await Promise.all(clientPromises.map(async (clientPromise) => (await clientPromise).close()));
}

async function connectMongoClient(config: AppConfig) {
  const client = new MongoClient(config.mongoUri);
  await client.connect();
  return client;
}

function mongoClientKey(config: AppConfig) {
  return config.mongoUri;
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
  await db.collection(names.cohorts).createIndex({ id: 1 }, { unique: true });
  await db.collection(names.cohorts).createIndex({ courseIds: 1, status: 1 });
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
  await db.collection(names.ltiContentItems).createIndex({ id: 1 }, { unique: true });
  await db.collection(names.ltiContentItems).createIndex(
    { toolClientId: 1, resourceId: 1, cohortId: 1 },
    { unique: true, sparse: true, name: "lti_content_resource_scope_unique" }
  );
  await db.collection(names.ltiContentItems).createIndex({ courseId: 1, cohortId: 1 });
  await db.collection(names.ltiLineItems).createIndex({ id: 1 }, { unique: true });
  await db.collection(names.ltiLineItems).createIndex({ resourceId: 1, tag: 1 });
  await db.collection(names.ltiLineItems).createIndex(
    { resourceId: 1, tag: 1, cohortId: 1 },
    { unique: true, sparse: true, name: "lti_line_item_resource_scope_unique" }
  );
  await db.collection(names.ltiScores).createIndex({ lineItemId: 1, userId: 1 });
}
