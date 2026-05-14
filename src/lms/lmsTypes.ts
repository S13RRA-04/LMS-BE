export type CourseType = "online" | "instructor_led" | "curriculum" | "bundle" | "lti_tool";
export type CourseStatus = "draft" | "published" | "archived";
export type EnrollmentStatus = "not_started" | "in_progress" | "completed" | "failed" | "expired";

export type Department = {
  id: string;
  name: string;
  parentDepartmentId?: string;
  brandColor?: string;
};

export type CohortStatus = "active" | "archived";

export type Cohort = {
  id: string;
  name: string;
  description?: string;
  courseIds: string[];
  status: CohortStatus;
  createdAt: string;
  updatedAt: string;
};

export type PortalSettings = {
  id: string;
  name: string;
  supportEmail: string;
  defaultDepartmentId: string;
  learnerFeatures: {
    catalog: boolean;
    transcript: boolean;
    resources: boolean;
    leaderboard: boolean;
  };
};

export type Course = {
  id: string;
  slug: string;
  title: string;
  description: string;
  type: CourseType;
  status: CourseStatus;
  category: string;
  departmentIds: string[];
  allowSelfEnrollment: boolean;
  estimatedMinutes?: number;
  ltiToolClientId?: string;
  createdAt: string;
  updatedAt: string;
};

export type Enrollment = {
  id: string;
  userId: string;
  courseId: string;
  cohortId?: string;
  status: EnrollmentStatus;
  progressPercent: number;
  scorePercent?: number;
  enrolledAt: string;
  completedAt?: string;
};

export type TranscriptItem = {
  course: Course;
  enrollment: Enrollment;
};

export type LearnerDashboard = {
  portal: PortalSettings;
  assigned: TranscriptItem[];
  recommended: Course[];
  transcript: TranscriptItem[];
};

export type AdminOverview = {
  publishedCourses: number;
  draftCourses: number;
  activeEnrollments: number;
  completedEnrollments: number;
};
