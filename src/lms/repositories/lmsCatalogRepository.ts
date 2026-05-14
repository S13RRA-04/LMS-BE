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
}
