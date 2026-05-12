import type { CurrentUser } from "../../auth/currentUser.js";
import type { LmsRepository } from "../repositories/lmsRepository.js";
import type { LearnerDashboard, TranscriptItem } from "../lmsTypes.js";

export class LearnerExperienceService {
  constructor(private readonly catalog: LmsRepository) {}

  async getDashboard(user: CurrentUser): Promise<LearnerDashboard> {
    const transcript = await this.getTranscript(user);
    const assigned = transcript.filter((item) => item.enrollment.status !== "completed");
    const enrolledCourseIds = new Set(transcript.map((item) => item.course.id));

    return {
      portal: await this.catalog.getPortal(),
      assigned,
      recommended: (await this.catalog.listPublishedCourses()).filter((course) => !enrolledCourseIds.has(course.id)),
      transcript
    };
  }

  async getCatalog() {
    return this.catalog.listPublishedCourses();
  }

  async getTranscript(user: CurrentUser): Promise<TranscriptItem[]> {
    const enrollments = await this.catalog.listEnrollmentsForUser(user.id);
    return Promise.all(enrollments.map(async (enrollment) => ({
      enrollment,
      course: await this.catalog.requireCourse(enrollment.courseId)
    })));
  }
}
