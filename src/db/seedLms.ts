import "dotenv/config";
import { loadConfig } from "../config/config.js";
import { closeMongoClient, collectionNames, ensureMongoCollections, getMongoDb } from "./mongo.js";
import type { Course, Department, Enrollment } from "../lms/lmsTypes.js";

const config = loadConfig(process.env);
const now = new Date("2026-05-12T00:00:00.000Z").toISOString();

const department: Department = {
  id: "cyber-training",
  name: "Cyber Education and Training Unit",
  brandColor: "#164e63"
};

const course: Course = {
  id: "pact",
  slug: "pact",
  title: "PACT",
  description: "Practical cyber training course and tool launch.",
  type: "lti_tool",
  status: "published",
  category: "Cyber Operations",
  departmentIds: ["cyber-training"],
  allowSelfEnrollment: true,
  estimatedMinutes: 120,
  ltiToolClientId: "pact-tool",
  createdAt: now,
  updatedAt: now
};

const enrollment: Enrollment = {
  id: "enrollment-pact-demo",
  userId: "demo-learner",
  courseId: "pact",
  status: "in_progress",
  progressPercent: 35,
  enrolledAt: now
};

const adminEnrollment: Enrollment = {
  ...enrollment,
  id: "enrollment-pact-admin-demo",
  userId: "demo-admin"
};

try {
  await ensureMongoCollections(config);
  const db = await getMongoDb(config);
  const names = collectionNames(config);

  await db.collection(names.departments).replaceOne({ id: department.id }, department, { upsert: true });
  await db.collection(names.courses).replaceOne({ id: course.id }, course, { upsert: true });
  await db.collection(names.enrollments).replaceOne({ id: enrollment.id }, enrollment, { upsert: true });
  await db.collection(names.enrollments).replaceOne({ id: adminEnrollment.id }, adminEnrollment, { upsert: true });

  if (process.env.DEMO_LEARNER_KEYCLOAK_SUB) {
    await db.collection(names.users).replaceOne(
      { keycloakSub: process.env.DEMO_LEARNER_KEYCLOAK_SUB },
      {
        id: "demo-learner",
        keycloakSub: process.env.DEMO_LEARNER_KEYCLOAK_SUB,
        email: "learner@example.test",
        name: "CETU Learner",
        roles: ["learner"],
        permissions: ["lms_learner"],
        departmentId: "cyber-training",
        createdAt: now,
        updatedAt: now,
        lastLoginAt: now
      },
      { upsert: true }
    );
  }

  if (process.env.DEMO_ADMIN_KEYCLOAK_SUB) {
    await db.collection(names.users).replaceOne(
      { keycloakSub: process.env.DEMO_ADMIN_KEYCLOAK_SUB },
      {
        id: "demo-admin",
        keycloakSub: process.env.DEMO_ADMIN_KEYCLOAK_SUB,
        email: "admin@example.test",
        name: "CETU Admin",
        roles: ["learner", "admin"],
        permissions: ["lms_learner", "lms_admin"],
        departmentId: "cyber-training",
        createdAt: now,
        updatedAt: now,
        lastLoginAt: now
      },
      { upsert: true }
    );
  }

  console.log("Seeded LMS development data");
} finally {
  await closeMongoClient();
}
