import type { Collection, Db, OptionalUnlessRequiredId } from "mongodb";
import { AppError } from "../../errors/AppError.js";
import type { Cohort, Course, Department, Enrollment, PortalSettings } from "../lmsTypes.js";
import type {
  CreateCohortInput,
  CreateCourseInput,
  CreateDepartmentInput,
  CreateEnrollmentInput,
  LmsRepository,
  UpdateCohortInput,
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

  async listCohorts(): Promise<Cohort[]> {
    return (await this.cohorts().find().sort({ name: 1 }).toArray()).map(stripId);
  }

  async createCohort(input: CreateCohortInput): Promise<Cohort> {
    await this.requireCourses(input.courseIds);
    const timestamp = new Date().toISOString();
    const cohort: Cohort = { ...input, courseIds: uniqueValues(input.courseIds), createdAt: timestamp, updatedAt: timestamp };
    await this.insertUnique(this.cohorts(), cohort, "COHORT_EXISTS", "Cohort already exists");
    return cohort;
  }

  async updateCohort(id: string, input: UpdateCohortInput): Promise<Cohort> {
    if (input.courseIds) {
      await this.requireCourses(input.courseIds);
    }
    return this.updateRequired(
      this.cohorts(),
      id,
      { ...input, ...(input.courseIds ? { courseIds: uniqueValues(input.courseIds) } : {}), updatedAt: new Date().toISOString() },
      "COHORT_NOT_FOUND",
      "Cohort was not found"
    );
  }

  async deleteCohort(id: string): Promise<void> {
    const referenced = await this.enrollments().findOne({ cohortId: id });
    if (referenced) {
      throw new AppError(409, "COHORT_IN_USE", "Cohort is assigned to one or more enrollments");
    }
    const result = await this.cohorts().deleteOne({ id });
    if (!result.deletedCount) {
      throw new AppError(404, "COHORT_NOT_FOUND", "Cohort was not found");
    }
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
    if (input.cohortId) {
      await this.requireCohortForCourse(input.cohortId, input.courseId);
    }
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
    if (input.cohortId) {
      const existing = await this.enrollments().findOne({ id });
      if (!existing) {
        throw new AppError(404, "ENROLLMENT_NOT_FOUND", "Enrollment was not found");
      }
      await this.requireCohortForCourse(input.cohortId, existing.courseId);
    }
    return this.updateRequired(this.enrollments(), id, input, "ENROLLMENT_NOT_FOUND", "Enrollment was not found");
  }

  async requireCourse(courseId: string): Promise<Course> {
    const course = await this.courses().findOne({ id: courseId });
    if (!course) {
      throw new AppError(404, "COURSE_NOT_FOUND", "Course was not found");
    }
    return stripId(course);
  }

  async requireActiveCohortForCourse(cohortId: string, courseId: string): Promise<Cohort> {
    return stripId(await this.requireCohortForCourse(cohortId, courseId));
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

  private cohorts() {
    return this.db.collection<Stored<Cohort>>(this.names.cohorts);
  }

  private enrollments() {
    return this.db.collection<Stored<Enrollment>>(this.names.enrollments);
  }

  private async requireCourses(courseIds: string[]) {
    const uniqueCourseIds = uniqueValues(courseIds);
    const count = await this.courses().countDocuments({ id: { $in: uniqueCourseIds } });
    if (count !== uniqueCourseIds.length) {
      throw new AppError(400, "COHORT_COURSE_NOT_FOUND", "Cohort references a course that was not found");
    }
  }

  private async requireCohortForCourse(cohortId: string, courseId: string) {
    const cohort = await this.cohorts().findOne({ id: cohortId, courseIds: courseId, status: "active" });
    if (!cohort) {
      throw new AppError(400, "COHORT_NOT_AVAILABLE", "Cohort is not active for this course");
    }
    return cohort;
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

function uniqueValues(values: string[]) {
  return Array.from(new Set(values));
}
