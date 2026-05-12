import crypto from "node:crypto";
import type { Collection, Db, OptionalUnlessRequiredId } from "mongodb";
import { AppError } from "../../errors/AppError.js";
import type { Course, Department, Enrollment, PortalSettings } from "../lmsTypes.js";
import type {
  CreateCourseInput,
  CreateDepartmentInput,
  CreateEnrollmentInput,
  LmsRepository,
  UpdateCourseInput,
  UpdateDepartmentInput,
  UpdateEnrollmentInput,
  UpdatePortalSettingsInput
} from "./lmsRepository.js";
import type { AppConfig } from "../../config/config.js";
import { collectionNames } from "../../db/mongo.js";

type Stored<T> = T & {
  _id?: unknown;
};

const defaultPortal: PortalSettings = {
  id: "cetu",
  name: "CETU LMS",
  supportEmail: "support@example.test",
  defaultDepartmentId: "cyber-training",
  learnerFeatures: {
    catalog: true,
    transcript: true,
    resources: true,
    leaderboard: false
  }
};

export class MongoLmsRepository implements LmsRepository {
  private readonly names;

  constructor(private readonly db: Db, config: AppConfig) {
    this.names = collectionNames(config);
  }

  async getPortal(): Promise<PortalSettings> {
    const existing = await this.portalSettings().findOne({ id: "cetu" });
    if (existing) {
      return stripId(existing);
    }

    await this.portalSettings().insertOne(defaultPortal as OptionalUnlessRequiredId<Stored<PortalSettings>>);
    return defaultPortal;
  }

  async updatePortal(input: UpdatePortalSettingsInput): Promise<PortalSettings> {
    const current = await this.getPortal();
    const updated: PortalSettings = {
      ...current,
      ...input,
      learnerFeatures: { ...current.learnerFeatures, ...input.learnerFeatures }
    };
    await this.portalSettings().replaceOne({ id: current.id }, updated, { upsert: true });
    return updated;
  }

  async listDepartments(): Promise<Department[]> {
    return (await this.departments().find().sort({ name: 1 }).toArray()).map(stripId);
  }

  async createDepartment(input: CreateDepartmentInput): Promise<Department> {
    await this.insertUnique(this.departments(), input, "DEPARTMENT_EXISTS", "Department already exists");
    return input;
  }

  async updateDepartment(id: string, input: UpdateDepartmentInput): Promise<Department> {
    return this.updateRequired(this.departments(), id, input, "DEPARTMENT_NOT_FOUND", "Department was not found");
  }

  async listPublishedCourses(): Promise<Course[]> {
    return (await this.courses().find({ status: "published" }).sort({ title: 1 }).toArray()).map(stripId);
  }

  async listCoursesForAdmin(): Promise<Course[]> {
    return (await this.courses().find().sort({ title: 1 }).toArray()).map(stripId);
  }

  async createCourse(input: CreateCourseInput): Promise<Course> {
    const timestamp = new Date().toISOString();
    const course: Course = { ...input, createdAt: timestamp, updatedAt: timestamp };
    await this.insertUnique(this.courses(), course, "COURSE_EXISTS", "Course already exists");
    return course;
  }

  async updateCourse(id: string, input: UpdateCourseInput): Promise<Course> {
    return this.updateRequired(
      this.courses(),
      id,
      { ...input, updatedAt: new Date().toISOString() },
      "COURSE_NOT_FOUND",
      "Course was not found"
    );
  }

  async listEnrollments(): Promise<Enrollment[]> {
    return (await this.enrollments().find().sort({ enrolledAt: -1 }).toArray()).map(stripId);
  }

  async listEnrollmentsForUser(userId: string): Promise<Enrollment[]> {
    return (await this.enrollments().find({ userId }).sort({ enrolledAt: -1 }).toArray()).map(stripId);
  }

  async getEnrollmentForUserCourse(userId: string, courseId: string): Promise<Enrollment | undefined> {
    const enrollment = await this.enrollments().findOne({ userId, courseId });
    return enrollment ? stripId(enrollment) : undefined;
  }

  async createEnrollment(input: CreateEnrollmentInput): Promise<Enrollment> {
    await this.requireCourse(input.courseId);
    const enrollment: Enrollment = {
      id: input.id ?? crypto.randomUUID(),
      userId: input.userId,
      courseId: input.courseId,
      cohortId: input.cohortId,
      status: input.status,
      progressPercent: input.progressPercent,
      scorePercent: input.scorePercent,
      enrolledAt: input.enrolledAt ?? new Date().toISOString(),
      completedAt: input.completedAt
    };
    await this.insertUnique(this.enrollments(), enrollment, "ENROLLMENT_EXISTS", "Enrollment already exists");
    return enrollment;
  }

  async updateEnrollment(id: string, input: UpdateEnrollmentInput): Promise<Enrollment> {
    return this.updateRequired(this.enrollments(), id, input, "ENROLLMENT_NOT_FOUND", "Enrollment was not found");
  }

  async requireCourse(courseId: string): Promise<Course> {
    const course = await this.courses().findOne({ id: courseId });
    if (!course) {
      throw new AppError(404, "COURSE_NOT_FOUND", "Course was not found");
    }
    return stripId(course);
  }

  private portalSettings() {
    return this.db.collection<Stored<PortalSettings>>(this.names.portalSettings);
  }

  private departments() {
    return this.db.collection<Stored<Department>>(this.names.departments);
  }

  private courses() {
    return this.db.collection<Stored<Course>>(this.names.courses);
  }

  private enrollments() {
    return this.db.collection<Stored<Enrollment>>(this.names.enrollments);
  }

  private async insertUnique<T>(
    collection: Collection<Stored<T>>,
    document: T,
    code: string,
    message: string
  ) {
    try {
      await collection.insertOne(document as OptionalUnlessRequiredId<Stored<T>>);
    } catch (error) {
      if (isDuplicateKey(error)) {
        throw new AppError(409, code, message);
      }
      throw error;
    }
  }

  private async updateRequired<T>(
    collection: Collection<Stored<T>>,
    id: string,
    input: Record<string, unknown>,
    code: string,
    message: string
  ): Promise<T> {
    try {
      const result = await collection.findOneAndUpdate(
        { id } as never,
        { $set: input } as never,
        { returnDocument: "after" }
      );
      if (!result) {
        throw new AppError(404, code, message);
      }
      return stripId(result as Stored<T>);
    } catch (error) {
      if (isDuplicateKey(error)) {
        throw new AppError(409, "DUPLICATE_VALUE", "Updated value conflicts with an existing record");
      }
      throw error;
    }
  }
}

function stripId<T>(document: Stored<T>): T {
  const { _id: _ignored, ...rest } = document;
  return rest as T;
}

function isDuplicateKey(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && error.code === 11000;
}
