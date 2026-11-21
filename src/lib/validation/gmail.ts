import { z } from "zod";

const gmailMessageId = z.string()
  .min(1)
  .max(256)
  .regex(/^[A-Za-z0-9_-]+$/, "Invalid Gmail message id");

export const gmailScanRequestSchema = z.object({}).strict();

export const googleRefreshTokenResponseSchema = z.object({
  access_token: z.string().min(20).max(8192),
  expires_in: z.number().int().positive().max(86_400).optional(),
  token_type: z.string().max(32).optional(),
}).strip();

export const gmailMessageListSchema = z.object({
  messages: z.array(z.object({
    id: gmailMessageId,
  }).strip()).max(30).optional(),
}).strip();

export const gmailMessageSchema = z.object({
  id: gmailMessageId,
  snippet: z.string().max(5_000).optional(),
  payload: z.object({
    headers: z.array(z.object({
      name: z.string().trim().min(1).max(100),
      value: z.string().max(2_000),
    }).strip()).max(50).optional(),
  }).strip().optional(),
}).strip();

export const googleOAuthCodeResponseSchema = z.object({
  access_token: z.string().min(20).max(8192),
  refresh_token: z.string().min(20).max(8192),
  expires_in: z.number().int().positive().max(86_400).optional(),
  scope: z.string().max(2048).optional(),
  token_type: z.string().max(32).optional(),
}).strip();
