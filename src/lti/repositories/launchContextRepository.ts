import { AppError } from "../../errors/AppError.js";
import type { LtiLaunchContext } from "../ltiTypes.js";

export class LaunchContextRepository {
  private readonly contexts = new Map<string, LtiLaunchContext>();

  constructor() {
    this.contexts.set("pact-default", {
      id: "pact-default",
      deploymentId: "pact-course-deployment",
      resourceLinkId: "pact-resource-link",
      contextId: "pact-course",
      contextTitle: "PACT",
      userId: "demo-instructor",
      userEmail: "instructor@example.test",
      userName: "Demo Instructor",
      roles: ["http://purl.imsglobal.org/vocab/lis/v2/membership#Instructor"],
      messageType: "LtiResourceLinkRequest"
    });
  }

  requireByHint(messageHint: string): LtiLaunchContext {
    const context = this.contexts.get(messageHint);
    if (!context) {
      throw new AppError(404, "LAUNCH_CONTEXT_NOT_FOUND", "LTI launch context was not found");
    }
    return context;
  }
}
