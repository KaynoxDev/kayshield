/**
 * Known secret formats.
 *
 * These patterns are one signal among several - see `SecretDetector.ts` for the
 * name heuristics and entropy analysis that cover unknown formats. Adding a
 * provider here is a one-line change and requires no code elsewhere.
 *
 * Pure module: no `vscode` import, no network, no filesystem.
 */

export interface SecretPattern {
  readonly id: string;
  readonly name: string;
  readonly regex: RegExp;
  /** Which part of the variable the pattern applies to. */
  readonly target: 'value' | 'key';
  /** Score contributed when the pattern matches (0-100). */
  readonly score: number;
}

/**
 * Ordered list of built-in detectors. All regexes are non-global so they are
 * safe to reuse across calls (no `lastIndex` state).
 */
export const SECRET_PATTERNS: readonly SecretPattern[] = [
  {
    id: 'private-key',
    name: 'Private key block',
    regex: /-----BEGIN(?: [A-Z]+)* PRIVATE KEY-----/,
    target: 'value',
    score: 100,
  },
  {
    id: 'github-token',
    name: 'GitHub token',
    regex: /\bgh[pousr]_[A-Za-z0-9]{36,255}\b/,
    target: 'value',
    score: 100,
  },
  {
    id: 'github-fine-grained',
    name: 'GitHub fine-grained token',
    regex: /\bgithub_pat_[A-Za-z0-9]{22}_[A-Za-z0-9]{59}\b/,
    target: 'value',
    score: 100,
  },
  {
    id: 'gitlab-token',
    name: 'GitLab token',
    regex: /\b(?:glpat|gldt|glrt|glsoat|glptt)-[A-Za-z0-9_-]{20,}/,
    target: 'value',
    score: 100,
  },
  {
    id: 'aws-access-key-id',
    name: 'AWS access key ID',
    regex: /\b(?:AKIA|ASIA|ABIA|ACCA|AGPA|AIDA|AROA|ANPA|ANVA|APKA)[A-Z0-9]{16}\b/,
    target: 'value',
    score: 100,
  },
  {
    id: 'jwt',
    name: 'JSON Web Token',
    regex: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}/,
    target: 'value',
    score: 100,
  },
  {
    id: 'stripe-key',
    name: 'Stripe API key',
    regex: /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}\b/,
    target: 'value',
    score: 100,
  },
  {
    id: 'openai-key',
    name: 'OpenAI-style API key',
    regex: /\bsk-(?:proj-|svcacct-|admin-)?[A-Za-z0-9_-]{20,}\b/,
    target: 'value',
    score: 100,
  },
  {
    id: 'anthropic-key',
    name: 'Anthropic API key',
    regex: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/,
    target: 'value',
    score: 100,
  },
  {
    id: 'discord-token',
    name: 'Discord bot token',
    regex: /\b[MNO][A-Za-z\d_-]{23,27}\.[A-Za-z\d_-]{6}\.[A-Za-z\d_-]{27,}\b/,
    target: 'value',
    score: 100,
  },
  {
    id: 'discord-webhook',
    name: 'Discord webhook URL',
    regex: /https:\/\/(?:canary\.|ptb\.)?discord(?:app)?\.com\/api\/webhooks\/\d+\//,
    target: 'value',
    score: 100,
  },
  {
    id: 'slack-token',
    name: 'Slack token',
    regex: /\bxox[baprse]-[A-Za-z0-9-]{10,}/,
    target: 'value',
    score: 100,
  },
  {
    id: 'slack-webhook',
    name: 'Slack webhook URL',
    regex: /https:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9/_+-]{20,}/,
    target: 'value',
    score: 100,
  },
  {
    id: 'google-api-key',
    name: 'Google API key',
    regex: /\bAIza[0-9A-Za-z_-]{35}\b/,
    target: 'value',
    score: 100,
  },
  {
    id: 'sendgrid-key',
    name: 'SendGrid API key',
    regex: /\bSG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\b/,
    target: 'value',
    score: 100,
  },
  {
    id: 'npm-token',
    name: 'npm access token',
    regex: /\bnpm_[A-Za-z0-9]{36}\b/,
    target: 'value',
    score: 100,
  },
  {
    id: 'twilio-key',
    name: 'Twilio key',
    regex: /\b(?:SK|AC)[0-9a-fA-F]{32}\b/,
    target: 'value',
    score: 95,
  },
  {
    id: 'square-token',
    name: 'Square access token',
    regex: /\b(?:sq0atp|sq0csp|EAAA)[A-Za-z0-9_-]{20,}\b/,
    target: 'value',
    score: 100,
  },
  {
    id: 'oauth-client-secret',
    name: 'Google OAuth client secret',
    regex: /\bGOCSPX-[A-Za-z0-9_-]{20,}\b/,
    target: 'value',
    score: 100,
  },
  {
    id: 'basic-auth-url',
    name: 'URL containing credentials',
    regex: /\b[a-z][a-z0-9+.-]*:\/\/[^\s/:@]+:[^\s/@]+@/i,
    target: 'value',
    score: 95,
  },
  {
    id: 'pem-certificate',
    name: 'PEM encoded material',
    regex: /-----BEGIN [A-Z ]*(?:CERTIFICATE|KEY|PARAMETERS)-----/,
    target: 'value',
    score: 90,
  },
  {
    id: 'bearer-header',
    name: 'Hardcoded bearer credential',
    regex: /\bBearer\s+[A-Za-z0-9._~+/-]{20,}=*/,
    target: 'value',
    score: 90,
  },
];

/** Returns the first built-in pattern matching the given value, if any. */
export function findValuePattern(value: string): SecretPattern | undefined {
  return SECRET_PATTERNS.find((pattern) => pattern.target === 'value' && pattern.regex.test(value));
}
