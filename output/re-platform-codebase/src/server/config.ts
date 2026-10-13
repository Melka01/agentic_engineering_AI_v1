/**
 * Environment configuration, validated with zod at start-up (fail fast).
 */
import path from 'node:path';
import { z } from 'zod';

const emptyToUndefined = (value: unknown) => (typeof value === 'string' && value.trim() === '' ? undefined : value);
const optional = <T extends z.ZodType>(schema: T) => z.preprocess(emptyToUndefined, schema.optional());
const withDefault = <T extends z.ZodType>(schema: T, fallback: z.input<T>) =>
  z.preprocess(emptyToUndefined, schema.default(fallback as never));

const EnvSchema = z.object({
  PORT: withDefault(z.coerce.number().int().min(1).max(65_535), 3000),
  HOST: withDefault(z.string(), '0.0.0.0'),
  LOG_LEVEL: withDefault(z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']), 'info'),
  RE_AI_MODE: optional(z.enum(['anthropic', 'offline'])),
  ANTHROPIC_API_KEY: optional(z.string()),
  ANTHROPIC_AUTH_TOKEN: optional(z.string()),
  RE_PRIMARY_MODEL: withDefault(z.string(), 'claude-opus-5-5'),
  /** Set to "none" to disable the secondary provider. */
  RE_FALLBACK_MODEL: withDefault(z.string(), 'claude-sonnet-5-5'),
  RE_SERVER_FALLBACKS: withDefault(z.enum(['default', 'off']), 'default'),
  RE_AGENT_TIMEOUT_MS: withDefault(z.coerce.number().int().positive(), 120_000),
  RE_AGENT_MAX_RETRIES: withDefault(z.coerce.number().int().min(0).max(6), 2),
  RE_AGENT_REPAIR_ROUNDS: withDefault(z.coerce.number().int().min(0).max(3), 1),
  RE_DESIGN_REPAIR_ROUNDS: withDefault(z.coerce.number().int().min(0).max(3), 1),
  RE_CIRCUIT_FAILURE_THRESHOLD: withDefault(z.coerce.number().int().min(1).max(20), 3),
  RE_CIRCUIT_COOLDOWN_MS: withDefault(z.coerce.number().int().min(1_000), 30_000),
  RE_WEB_DIST: optional(z.string()),
});

export interface AppConfig {
  readonly port: number;
  readonly host: string;
  readonly logLevel: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent';
  readonly aiMode: 'anthropic' | 'offline';
  readonly primaryModel: string;
  readonly fallbackModel: string | null;
  readonly serverFallbacks: 'default' | 'off';
  readonly agentTimeoutMs: number;
  readonly agentMaxRetries: number;
  readonly agentRepairRounds: number;
  readonly designRepairRounds: number;
  readonly circuitFailureThreshold: number;
  readonly circuitCooldownMs: number;
  readonly webDist: string | null;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const e = EnvSchema.parse(env);
  const hasCredentials = e.ANTHROPIC_API_KEY !== undefined || e.ANTHROPIC_AUTH_TOKEN !== undefined;
  const fallback = e.RE_FALLBACK_MODEL.trim();
  return {
    port: e.PORT,
    host: e.HOST,
    logLevel: e.LOG_LEVEL,
    aiMode: e.RE_AI_MODE ?? (hasCredentials ? 'anthropic' : 'offline'),
    primaryModel: e.RE_PRIMARY_MODEL,
    fallbackModel: fallback === 'none' || fallback === e.RE_PRIMARY_MODEL ? null : fallback,
    serverFallbacks: e.RE_SERVER_FALLBACKS,
    agentTimeoutMs: e.RE_AGENT_TIMEOUT_MS,
    agentMaxRetries: e.RE_AGENT_MAX_RETRIES,
    agentRepairRounds: e.RE_AGENT_REPAIR_ROUNDS,
    designRepairRounds: e.RE_DESIGN_REPAIR_ROUNDS,
    circuitFailureThreshold: e.RE_CIRCUIT_FAILURE_THRESHOLD,
    circuitCooldownMs: e.RE_CIRCUIT_COOLDOWN_MS,
    webDist: e.RE_WEB_DIST === undefined ? null : path.resolve(e.RE_WEB_DIST),
  };
}
