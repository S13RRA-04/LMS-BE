import type { Collection, Db, OptionalUnlessRequiredId } from "mongodb";
import type { AppConfig } from "../config/config.js";
import { collectionNames } from "../db/mongo.js";
import { AppError } from "../errors/AppError.js";
import type { AccessRequest, AccessRequestStatus, PublicAccessRequestInput } from "./userTypes.js";

type Stored<T> = T & { _id?: unknown };

export class MongoAccessRequestRepository {
  private readonly collectionName;

  constructor(private readonly db: Db, config: AppConfig) {
    this.collectionName = collectionNames(config).accessRequests;
  }

  async create(input: PublicAccessRequestInput): Promise<AccessRequest> {
    const emailNormalized = normalizeEmail(input.email);
    const existingPending = await this.accessRequests().findOne({ emailNormalized, status: "pending" });
    if (existingPending) {
      throw new AppError(409, "ACCESS_REQUEST_PENDING", "An access request for this email is already pending");
    }

    const now = new Date().toISOString();
    const request: AccessRequest = {
      id: crypto.randomUUID(),
      name: input.name.trim(),
      email: input.email.trim(),
      emailNormalized,
      status: "pending",
      requestedAt: now,
      updatedAt: now
    };

    await this.accessRequests().insertOne(request as OptionalUnlessRequiredId<Stored<AccessRequest>>);
    return toAccessRequest(request);
  }

  async list(status?: AccessRequestStatus): Promise<AccessRequest[]> {
    const filter = status ? { status } : {};
    return (await this.accessRequests().find(filter).sort({ requestedAt: -1 }).toArray()).map(toAccessRequest);
  }

  async getById(id: string): Promise<AccessRequest | undefined> {
    const request = await this.accessRequests().findOne({ id });
    return request ? toAccessRequest(request) : undefined;
  }

  async approve(id: string, input: { actorUserId: string; approvedUserId: string; decisionReason?: string }): Promise<AccessRequest> {
    const now = new Date().toISOString();
    const updated = await this.accessRequests().findOneAndUpdate(
      { id, status: "pending" },
      {
        $set: {
          status: "approved",
          updatedAt: now,
          approvedAt: now,
          approvedByUserId: input.actorUserId,
          approvedUserId: input.approvedUserId,
          decisionReason: input.decisionReason
        }
      },
      { returnDocument: "after" }
    );

    if (!updated) {
      throw new AppError(409, "ACCESS_REQUEST_NOT_PENDING", "Access request is not pending");
    }

    return toAccessRequest(updated);
  }

  async reject(id: string, input: { actorUserId: string; reason?: string }): Promise<AccessRequest> {
    const now = new Date().toISOString();
    const updated = await this.accessRequests().findOneAndUpdate(
      { id, status: "pending" },
      {
        $set: {
          status: "rejected",
          updatedAt: now,
          rejectedAt: now,
          rejectedByUserId: input.actorUserId,
          decisionReason: input.reason
        }
      },
      { returnDocument: "after" }
    );

    if (!updated) {
      throw new AppError(409, "ACCESS_REQUEST_NOT_PENDING", "Access request is not pending");
    }

    return toAccessRequest(updated);
  }

  private accessRequests(): Collection<Stored<AccessRequest>> {
    return this.db.collection<Stored<AccessRequest>>(this.collectionName);
  }
}

export function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function toAccessRequest(request: Stored<AccessRequest>): AccessRequest {
  return {
    id: request.id,
    name: request.name,
    email: request.email,
    emailNormalized: request.emailNormalized,
    status: request.status,
    requestedAt: request.requestedAt,
    updatedAt: request.updatedAt,
    approvedAt: request.approvedAt,
    approvedByUserId: request.approvedByUserId,
    approvedUserId: request.approvedUserId,
    rejectedAt: request.rejectedAt,
    rejectedByUserId: request.rejectedByUserId,
    decisionReason: request.decisionReason
  };
}
