import { z } from "zod";

export const authorizationQuerySchema = z.object({
  client_id: z.string().min(1),
  redirect_uri: z.string().url(),
  response_type: z.string(),
  response_mode: z.string(),
  scope: z.string(),
  nonce: z.string().min(12),
  state: z.string().optional(),
  login_hint: z.string().min(1),
  lti_message_hint: z.string().min(1),
  prompt: z.string().optional()
});

export const tokenBodySchema = z.object({
  grant_type: z.string(),
  client_assertion_type: z.string(),
  client_assertion: z.string().min(1),
  scope: z.string().optional()
});

export const lineItemBodySchema = z.object({
  label: z.string().min(1).max(255),
  scoreMaximum: z.number().positive(),
  resourceId: z.string().max(255).optional(),
  tag: z.string().max(255).optional()
});

export const scoreBodySchema = z.object({
  userId: z.string().min(1),
  scoreGiven: z.number().nonnegative(),
  scoreMaximum: z.number().positive(),
  activityProgress: z.string().min(1),
  gradingProgress: z.string().min(1),
  timestamp: z.string().datetime(),
  comment: z.string().max(2000).optional()
});

export const deepLinkReturnBodySchema = z.object({
  JWT: z.string().min(1).optional(),
  id_token: z.string().min(1).optional()
}).refine((body) => body.JWT || body.id_token, {
  message: "Deep Linking return must include JWT or id_token"
});
