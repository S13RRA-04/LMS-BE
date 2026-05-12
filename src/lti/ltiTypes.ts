import type { JWK } from "jose";

export type Jwks = {
  keys: JWK[];
};

export type RegisteredTool = {
  clientId: string;
  name: string;
  deploymentIds: string[];
  redirectUris: string[];
  deepLinkRedirectUris: string[];
  targetLinkUri: string;
  publicJwks?: Jwks;
  scopes: string[];
};

export type LtiLaunchContext = {
  id: string;
  deploymentId: string;
  resourceLinkId: string;
  contextId: string;
  contextTitle: string;
  userId: string;
  userEmail?: string;
  userName?: string;
  roles: string[];
  messageType: "LtiResourceLinkRequest" | "LtiDeepLinkingRequest";
};

export type LineItem = {
  id: string;
  label: string;
  scoreMaximum: number;
  resourceId?: string;
  tag?: string;
  createdAt: string;
  updatedAt: string;
};

export type DeepLinkedContent = {
  id: string;
  toolClientId: string;
  type: string;
  title: string;
  url?: string;
  text?: string;
  resourceId?: string;
  tag?: string;
  courseId?: string;
  cohortId?: string;
  lineItemId?: string;
  createdAt: string;
  updatedAt: string;
};

export type Score = {
  userId: string;
  scoreGiven: number;
  scoreMaximum: number;
  activityProgress: string;
  gradingProgress: string;
  timestamp: string;
  comment?: string;
};

export type ScoreRecord = Score & {
  id: string;
  lineItemId: string;
};

export type AgsGradeRecord = ScoreRecord & {
  lineItemLabel: string;
  lineItemScoreMaximum: number;
  resourceId?: string;
  tag?: string;
  courseId?: string;
  cohortId?: string;
  contentTitle?: string;
};

export type DeepLinkContentItem = {
  type: string;
  title: string;
  url?: string;
  text?: string;
  lineItem?: {
    label?: string;
    scoreMaximum?: number;
    resourceId?: string;
    tag?: string;
  };
};
