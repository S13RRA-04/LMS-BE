import { AppError } from "../../errors/AppError.js";
import type { Enrollment } from "../../lms/lmsTypes.js";
import { LTI_SCOPES } from "../ltiConstants.js";
import type { AgsGradeRecord, DeepLinkedContent, LineItem, Score, ScoreRecord } from "../ltiTypes.js";

type LineItemStore = {
  list(): Promise<LineItem[]> | LineItem[];
  listDeepLinkedContent?(): Promise<DeepLinkedContent[]> | DeepLinkedContent[];
  listScores?(): Promise<ScoreRecord[]> | ScoreRecord[];
  create(input: Pick<LineItem, "label" | "scoreMaximum" | "resourceId" | "tag">): Promise<LineItem> | LineItem;
  addScore(lineItemId: string, score: Score): Promise<Score> | Score;
};

type EnrollmentStore = {
  getEnrollmentForUserCourse(userId: string, courseId: string): Promise<Enrollment | undefined>;
  updateEnrollment(id: string, input: Partial<Omit<Enrollment, "id" | "userId" | "courseId" | "enrolledAt">>): Promise<Enrollment>;
};

export class AgsService {
  constructor(
    private readonly lineItems: LineItemStore,
    private readonly enrollments?: EnrollmentStore
  ) {}

  async listLineItems(scopes: string[]) {
    requireAnyScope(scopes, [LTI_SCOPES.lineItem, LTI_SCOPES.lineItemReadonly]);
    return this.lineItems.list();
  }

  async createLineItem(scopes: string[], input: Pick<LineItem, "label" | "scoreMaximum" | "resourceId" | "tag">) {
    requireAnyScope(scopes, [LTI_SCOPES.lineItem]);
    return this.lineItems.create(input);
  }

  async submitScore(scopes: string[], lineItemId: string, input: Score) {
    requireAnyScope(scopes, [LTI_SCOPES.score]);
    const score = await this.lineItems.addScore(lineItemId, input);
    await this.syncEnrollmentFromScore(lineItemId, input);
    return score;
  }

  async listAdminGradebook(filters: { courseId?: string; cohortId?: string } = {}): Promise<{ lineItems: LineItem[]; grades: AgsGradeRecord[] }> {
    const lineItems = await this.lineItems.list();
    const scores = this.lineItems.listScores ? await this.lineItems.listScores() : [];
    const deepLinks = this.lineItems.listDeepLinkedContent ? await this.lineItems.listDeepLinkedContent() : [];
    const lineItemById = new Map(lineItems.map((item) => [item.id, item]));
    const contentByLineItemId = new Map(deepLinks.filter((item) => item.lineItemId).map((item) => [item.lineItemId as string, item]));

    const grades = scores.map((score) => {
      const lineItem = lineItemById.get(score.lineItemId);
      const content = contentByLineItemId.get(score.lineItemId);
      return {
        ...score,
        lineItemLabel: lineItem?.label ?? "Unknown line item",
        lineItemScoreMaximum: lineItem?.scoreMaximum ?? score.scoreMaximum,
        resourceId: lineItem?.resourceId,
        tag: lineItem?.tag,
        courseId: content?.courseId,
        cohortId: content?.cohortId,
        contentTitle: content?.title
      };
    });

    return {
      lineItems,
      grades: grades.filter((grade) => {
        if (filters.courseId && grade.courseId !== filters.courseId) {
          return false;
        }
        if (filters.cohortId && grade.cohortId !== filters.cohortId) {
          return false;
        }
        return true;
      })
    };
  }

  private async syncEnrollmentFromScore(lineItemId: string, score: Score) {
    if (!this.enrollments || !this.lineItems.listDeepLinkedContent) {
      return;
    }

    const deepLinks = await this.lineItems.listDeepLinkedContent();
    const content = deepLinks.find((item) => item.lineItemId === lineItemId);
    if (!content?.courseId) {
      return;
    }

    const enrollment = await this.enrollments.getEnrollmentForUserCourse(score.userId, content.courseId);
    if (!enrollment) {
      return;
    }

    const completed = score.activityProgress === "Completed";
    const scorePercent = score.scoreMaximum > 0 ? Math.round((score.scoreGiven / score.scoreMaximum) * 100) : undefined;
    await this.enrollments.updateEnrollment(enrollment.id, {
      progressPercent: completed ? 100 : enrollment.progressPercent,
      ...(scorePercent === undefined ? {} : { scorePercent }),
      status: completed ? "completed" : enrollment.status === "not_started" ? "in_progress" : enrollment.status,
      ...(completed ? { completedAt: score.timestamp } : {})
    });
  }
}

function requireAnyScope(actual: string[], required: string[]) {
  if (!required.some((scope) => actual.includes(scope))) {
    throw new AppError(403, "INSUFFICIENT_SCOPE", "Access token does not include a required AGS scope");
  }
}
