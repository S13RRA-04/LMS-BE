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

const now = new Date("2026-05-12T00:00:00.000Z").toISOString();

export class LmsCatalogRepository implements LmsRepository {
  private portal: PortalSettings = {
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

  private readonly departments: Department[] = [
    { id: "cyber-training", name: "Cyber Education and Training Unit", brandColor: "#164e63" }
  ];

  private readonly courses: Course[] = [
    {
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
    }
  ];

  private readonly cohorts: Cohort[] = [
    {
      id: "cohort-pact-demo",
      name: "PACT Demo Cohort",
      description: "Default PACT learner group.",
      courseIds: ["pact"],
      status: "active",
      createdAt: now,
      updatedAt: now
    }
  ];

  private readonly enrollments: Enrollment[] = [
    {
      id: "enrollment-pact-demo",
      userId: "demo-learner",
      courseId: "pact",
      cohortId: "cohort-pact-demo",
      status: "in_progress",
      progressPercent: 35,
      enrolledAt: now
    }
  ];

  async getPortal() {
    return this.portal;
  }

  async updatePortal(input: UpdatePortalSettingsInput) {
    this.portal = { ...this.portal, ...input, learnerFeatures: { ...this.portal.learnerFeatures, ...input.learnerFeatures } };
    return this.portal;
  }

  async listDepartments() {
    return this.departments;
  }

  async createDepartment(input: CreateDepartmentInput) {
    if (this.departments.some((department) => department.id === input.id)) {
      throw new AppError(409, "DEPARTMENT_EXISTS", "Department already exists");
    }
    this.departments.push(input);
    return input;
  }

  async updateDepartment(id: string, input: UpdateDepartmentInput) {
    const index = this.departments.findIndex((department) => department.id === id);
    if (index === -1) {
      throw new AppError(404, "DEPARTMENT_NOT_FOUND", "Department was not found");
    }
    this.departments[index] = { ...this.departments[index], ...input };
    return this.departments[index];
  }

  async listCohorts() {
    return this.cohorts;
  }

  async createCohort(input: CreateCohortInput) {
    this.requireCourses(input.courseIds);
    if (this.cohorts.some((cohort) => cohort.id === input.id)) {
      throw new AppError(409, "COHORT_EXISTS", "Cohort already exists");
    }
    const timestamp = new Date().toISOString();
    const cohort = { ...input, courseIds: uniqueValues(input.courseIds), createdAt: timestamp, updatedAt: timestamp };
    this.cohorts.push(cohort);
    return cohort;
  }

  async updateCohort(id: string, input: UpdateCohortInput) {
    const index = this.cohorts.findIndex((cohort) => cohort.id === id);
    if (index === -1) {
      throw new AppError(404, "COHORT_NOT_FOUND", "Cohort was not found");
    }
    if (input.courseIds) {
      this.requireCourses(input.courseIds);
    }
    this.cohorts[index] = {
      ...this.cohorts[index],
      ...input,
      ...(input.courseIds ? { courseIds: uniqueValues(input.courseIds) } : {}),
      updatedAt: new Date().toISOString()
    };
    return this.cohorts[index];
  }

  async deleteCohort(id: string) {
    if (this.enrollments.some((enrollment) => enrollment.cohortId === id)) {
      throw new AppError(409, "COHORT_IN_USE", "Cohort is assigned to one or more enrollments");
    }
    const index = this.cohorts.findIndex((cohort) => cohort.id === id);
    if (index === -1) {
      throw new AppError(404, "COHORT_NOT_FOUND", "Cohort was not found");
    }
    this.cohorts.splice(index, 1);
  }

  async listPublishedCourses() {
    return this.courses.filter((course) => course.status === "published");
  }

  async listCoursesForAdmin() {
    return this.courses;
  }

  async createCourse(input: CreateCourseInput) {
    if (this.courses.some((course) => course.id === input.id || course.slug === input.slug)) {
      throw new AppError(409, "COURSE_EXISTS", "Course already exists");
    }
    const timestamp = new Date().toISOString();
    const course = { ...input, createdAt: timestamp, updatedAt: timestamp };
    this.courses.push(course);
    return course;
  }

  async updateCourse(id: string, input: UpdateCourseInput) {
    const index = this.courses.findIndex((course) => course.id === id);
    if (index === -1) {
      throw new AppError(404, "COURSE_NOT_FOUND", "Course was not found");
    }
    this.courses[index] = { ...this.courses[index], ...input, updatedAt: new Date().toISOString() };
    return this.courses[index];
  }

  async listEnrollments() {
    return this.enrollments;
  }

  async listEnrollmentsForUser(userId: string) {
    return this.enrollments.filter((enrollment) => enrollment.userId === userId);
  }

  async getEnrollmentForUserCourse(userId: string, courseId: string) {
    return this.enrollments.find((enrollment) => enrollment.userId === userId && enrollment.courseId === courseId);
  }

  async createEnrollment(input: CreateEnrollmentInput) {
    await this.requireCourse(input.courseId);
    if (input.cohortId) {
      this.requireCohortForCourse(input.cohortId, input.courseId);
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
    if (this.enrollments.some((existing) => existing.userId === enrollment.userId && existing.courseId === enrollment.courseId)) {
      throw new AppError(409, "ENROLLMENT_EXISTS", "Enrollment already exists for this user and course");
    }
    this.enrollments.push(enrollment);
    return enrollment;
  }

  async updateEnrollment(id: string, input: UpdateEnrollmentInput) {
    const index = this.enrollments.findIndex((enrollment) => enrollment.id === id);
    if (index === -1) {
      throw new AppError(404, "ENROLLMENT_NOT_FOUND", "Enrollment was not found");
    }
    if (input.cohortId) {
      this.requireCohortForCourse(input.cohortId, this.enrollments[index].courseId);
    }
    this.enrollments[index] = { ...this.enrollments[index], ...input };
    return this.enrollments[index];
  }

  async requireCourse(courseId: string) {
    const course = this.courses.find((candidate) => candidate.id === courseId);
    if (!course) {
      throw new AppError(404, "COURSE_NOT_FOUND", "Course was not found");
    }
    return course;
  }

  private requireCourses(courseIds: string[]) {
    const missingCourse = uniqueValues(courseIds).find((courseId) => !this.courses.some((course) => course.id === courseId));
    if (missingCourse) {
      throw new AppError(400, "COHORT_COURSE_NOT_FOUND", "Cohort references a course that was not found");
    }
  }

  private requireCohortForCourse(cohortId: string, courseId: string) {
    if (!this.cohorts.some((cohort) => cohort.id === cohortId && cohort.status === "active" && cohort.courseIds.includes(courseId))) {
      throw new AppError(400, "COHORT_NOT_AVAILABLE", "Cohort is not active for this course");
    }
  }
}

function uniqueValues(values: string[]) {
  return Array.from(new Set(values));
}
