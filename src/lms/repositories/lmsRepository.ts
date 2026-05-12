import type { Course, Department, Enrollment, PortalSettings } from "../lmsTypes.js";

export type CreateCourseInput = Omit<Course, "createdAt" | "updatedAt">;
export type UpdateCourseInput = Partial<Omit<Course, "id" | "createdAt" | "updatedAt">>;
export type CreateDepartmentInput = Department;
export type UpdateDepartmentInput = Partial<Omit<Department, "id">>;
export type CreateEnrollmentInput = Omit<Enrollment, "id" | "enrolledAt"> & { id?: string; enrolledAt?: string };
export type UpdateEnrollmentInput = Partial<Omit<Enrollment, "id" | "userId" | "courseId" | "enrolledAt">>;
export type UpdatePortalSettingsInput = Partial<Omit<PortalSettings, "id" | "learnerFeatures">> & {
  learnerFeatures?: Partial<PortalSettings["learnerFeatures"]>;
};

export interface LmsRepository {
  getPortal(): Promise<PortalSettings>;
  updatePortal(input: UpdatePortalSettingsInput): Promise<PortalSettings>;
  listDepartments(): Promise<Department[]>;
  createDepartment(input: CreateDepartmentInput): Promise<Department>;
  updateDepartment(id: string, input: UpdateDepartmentInput): Promise<Department>;
  listPublishedCourses(): Promise<Course[]>;
  listCoursesForAdmin(): Promise<Course[]>;
  createCourse(input: CreateCourseInput): Promise<Course>;
  updateCourse(id: string, input: UpdateCourseInput): Promise<Course>;
  listEnrollments(): Promise<Enrollment[]>;
  listEnrollmentsForUser(userId: string): Promise<Enrollment[]>;
  getEnrollmentForUserCourse(userId: string, courseId: string): Promise<Enrollment | undefined>;
  createEnrollment(input: CreateEnrollmentInput): Promise<Enrollment>;
  updateEnrollment(id: string, input: UpdateEnrollmentInput): Promise<Enrollment>;
  requireCourse(courseId: string): Promise<Course>;
}
