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
} from "../repositories/lmsRepository.js";
import type { AdminOverview } from "../lmsTypes.js";
import type { MongoAuditLogRepository } from "../../audit/mongoAuditLogRepository.js";
import type { CurrentUser } from "../../auth/currentUser.js";

export class AdminExperienceService {
  constructor(
    private readonly catalog: LmsRepository,
    private readonly auditLogs?: MongoAuditLogRepository
  ) {}

  async getOverview(): Promise<AdminOverview> {
    const courses = await this.catalog.listCoursesForAdmin();
    const enrollments = await this.catalog.listEnrollments();

    return {
      publishedCourses: courses.filter((course) => course.status === "published").length,
      draftCourses: courses.filter((course) => course.status === "draft").length,
      activeEnrollments: enrollments.filter((enrollment) => enrollment.status === "in_progress").length,
      completedEnrollments: enrollments.filter((enrollment) => enrollment.status === "completed").length
    };
  }

  async listCourses() {
    return this.catalog.listCoursesForAdmin();
  }

  async listEnrollments() {
    return this.catalog.listEnrollments();
  }

  async createCourse(actor: CurrentUser, requestId: string | undefined, input: CreateCourseInput) {
    const course = await this.catalog.createCourse(input);
    await this.auditLogs?.record({
      action: "course.create",
      actor,
      targetType: "course",
      targetId: course.id,
      requestId,
      metadata: { status: course.status }
    });
    return course;
  }

  async updateCourse(actor: CurrentUser, requestId: string | undefined, id: string, input: UpdateCourseInput) {
    const course = await this.catalog.updateCourse(id, input);
    await this.auditLogs?.record({
      action: "course.update",
      actor,
      targetType: "course",
      targetId: course.id,
      requestId,
      metadata: { changedFields: Object.keys(input) }
    });
    return course;
  }

  async listDepartments() {
    return this.catalog.listDepartments();
  }

  async listCohorts() {
    return this.catalog.listCohorts();
  }

  async createCohort(actor: CurrentUser, requestId: string | undefined, input: CreateCohortInput) {
    const cohort = await this.catalog.createCohort(input);
    await this.auditLogs?.record({
      action: "cohort.create",
      actor,
      targetType: "cohort",
      targetId: cohort.id,
      requestId,
      metadata: { courseIds: cohort.courseIds, status: cohort.status }
    });
    return cohort;
  }

  async updateCohort(actor: CurrentUser, requestId: string | undefined, id: string, input: UpdateCohortInput) {
    const cohort = await this.catalog.updateCohort(id, input);
    await this.auditLogs?.record({
      action: "cohort.update",
      actor,
      targetType: "cohort",
      targetId: cohort.id,
      requestId,
      metadata: { changedFields: Object.keys(input) }
    });
    return cohort;
  }

  async deleteCohort(actor: CurrentUser, requestId: string | undefined, id: string) {
    await this.catalog.deleteCohort(id);
    await this.auditLogs?.record({
      action: "cohort.delete",
      actor,
      targetType: "cohort",
      targetId: id,
      requestId
    });
  }

  async createDepartment(actor: CurrentUser, requestId: string | undefined, input: CreateDepartmentInput) {
    const department = await this.catalog.createDepartment(input);
    await this.auditLogs?.record({
      action: "department.create",
      actor,
      targetType: "department",
      targetId: department.id,
      requestId
    });
    return department;
  }

  async updateDepartment(actor: CurrentUser, requestId: string | undefined, id: string, input: UpdateDepartmentInput) {
    const department = await this.catalog.updateDepartment(id, input);
    await this.auditLogs?.record({
      action: "department.update",
      actor,
      targetType: "department",
      targetId: department.id,
      requestId,
      metadata: { changedFields: Object.keys(input) }
    });
    return department;
  }

  async createEnrollment(actor: CurrentUser, requestId: string | undefined, input: CreateEnrollmentInput) {
    const enrollment = await this.catalog.createEnrollment(input);
    await this.auditLogs?.record({
      action: "enrollment.create",
      actor,
      targetType: "enrollment",
      targetId: enrollment.id,
      requestId,
      metadata: { userId: enrollment.userId, courseId: enrollment.courseId }
    });
    return enrollment;
  }

  async updateEnrollment(actor: CurrentUser, requestId: string | undefined, id: string, input: UpdateEnrollmentInput) {
    const enrollment = await this.catalog.updateEnrollment(id, input);
    await this.auditLogs?.record({
      action: "enrollment.update",
      actor,
      targetType: "enrollment",
      targetId: enrollment.id,
      requestId,
      metadata: { changedFields: Object.keys(input) }
    });
    return enrollment;
  }

  async updatePortal(actor: CurrentUser, requestId: string | undefined, input: UpdatePortalSettingsInput) {
    const portal = await this.catalog.updatePortal(input);
    await this.auditLogs?.record({
      action: "portal_settings.update",
      actor,
      targetType: "portal_settings",
      targetId: portal.id,
      requestId,
      metadata: { changedFields: Object.keys(input) }
    });
    return portal;
  }
}
