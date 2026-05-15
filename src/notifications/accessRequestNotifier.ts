import type { Enrollment } from "../lms/lmsTypes.js";
import type { AccessRequest, AdminUser } from "../users/userTypes.js";
import type { AppConfig } from "../config/config.js";
import { AppError } from "../errors/AppError.js";

export type AccessRequestNotifier = {
  accessRequestSubmitted(input: { accessRequest: AccessRequest }): Promise<void>;
  accessRequestApproved(input: { accessRequest: AccessRequest; user: AdminUser; enrollment?: Enrollment }): Promise<void>;
  accessRequestRejected(input: { accessRequest: AccessRequest }): Promise<void>;
};

export class NoopAccessRequestNotifier implements AccessRequestNotifier {
  async accessRequestSubmitted(): Promise<void> {}
  async accessRequestApproved(): Promise<void> {}
  async accessRequestRejected(): Promise<void> {}
}

export class ResendAccessRequestNotifier implements AccessRequestNotifier {
  constructor(private readonly config: AppConfig) {}

  async accessRequestSubmitted(input: { accessRequest: AccessRequest }): Promise<void> {
    await this.send({
      to: this.requireAdminEmail(),
      subject: `CETU LMS access request: ${input.accessRequest.name}`,
      text: [
        "A new CETU LMS access request is pending admin review.",
        "",
        `Name: ${input.accessRequest.name}`,
        `Email: ${input.accessRequest.email}`,
        `Requested: ${input.accessRequest.requestedAt}`
      ].join("\n")
    });
  }

  async accessRequestApproved(input: { accessRequest: AccessRequest; user: AdminUser; enrollment?: Enrollment }): Promise<void> {
    await this.send({
      to: input.accessRequest.email,
      subject: "Your CETU LMS access request was approved",
      text: [
        `Hello ${input.accessRequest.name},`,
        "",
        "Your CETU LMS access request was approved.",
        `Username: ${input.user.username ?? input.user.email ?? input.accessRequest.email}`,
        input.enrollment ? `Initial course enrollment: ${input.enrollment.courseId}` : undefined,
        "",
        "Use the CETU LMS sign-in page to continue."
      ].filter(Boolean).join("\n")
    });
  }

  async accessRequestRejected(input: { accessRequest: AccessRequest }): Promise<void> {
    await this.send({
      to: input.accessRequest.email,
      subject: "Your CETU LMS access request was not approved",
      text: [
        `Hello ${input.accessRequest.name},`,
        "",
        "Your CETU LMS access request was not approved.",
        input.accessRequest.decisionReason ? `Reason: ${input.accessRequest.decisionReason}` : undefined
      ].filter(Boolean).join("\n")
    });
  }

  private async send(input: { to: string; subject: string; text: string }) {
    if (!this.config.resendApiKey || !this.config.emailFrom) {
      throw new AppError(503, "EMAIL_PROVIDER_NOT_CONFIGURED", "Email provider is not configured");
    }

    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.config.resendApiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json"
      },
      body: JSON.stringify({
        from: this.config.emailFrom,
        to: [input.to],
        subject: input.subject,
        text: input.text
      })
    });

    if (!response.ok) {
      throw new AppError(502, "EMAIL_PROVIDER_REQUEST_FAILED", "Email provider request failed");
    }
  }

  private requireAdminEmail() {
    if (!this.config.accessRequestAdminEmail) {
      throw new AppError(503, "EMAIL_PROVIDER_NOT_CONFIGURED", "Access request admin email is not configured");
    }
    return this.config.accessRequestAdminEmail;
  }
}

export function createAccessRequestNotifier(config: AppConfig): AccessRequestNotifier {
  if (config.emailProvider === "resend") {
    return new ResendAccessRequestNotifier(config);
  }
  return new NoopAccessRequestNotifier();
}
