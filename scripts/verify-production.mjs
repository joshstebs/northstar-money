const required = [
  'DATABASE_URL',
  'APP_URL',
  'APP_AUTH_SECRET',
  'APP_AUTH_PASSWORD_HASH',
  'APP_ENCRYPTION_KEY',
  'CRON_SECRET'
];

const providerGroups = {
  plaid: ['PLAID_CLIENT_ID', 'PLAID_SECRET'],
  flinks: ['FLINKS_INSTANCE', 'FLINKS_CUSTOMER_ID', 'FLINKS_AUTH_KEY', 'FLINKS_API_SECRET', 'FLINKS_BASE_URL']
};

const missing = required.filter((name) => !process.env[name]?.trim());
const warnings = [];

if (process.env.APP_AUTH_SECRET && process.env.APP_AUTH_SECRET.length < 32) {
  warnings.push('APP_AUTH_SECRET should be at least 32 characters of high-entropy random data.');
}

if (process.env.CRON_SECRET && process.env.CRON_SECRET.length < 32) {
  warnings.push('CRON_SECRET should be at least 32 characters of high-entropy random data.');
}

if (process.env.APP_ENCRYPTION_KEY) {
  try {
    const key = Buffer.from(process.env.APP_ENCRYPTION_KEY, 'base64');
    if (key.length !== 32) warnings.push('APP_ENCRYPTION_KEY must decode to exactly 32 bytes.');
  } catch {
    warnings.push('APP_ENCRYPTION_KEY is not valid base64.');
  }
}

if (process.env.APP_URL) {
  try {
    const url = new URL(process.env.APP_URL);
    if (process.env.NODE_ENV === 'production' && url.protocol !== 'https:') {
      warnings.push('APP_URL should use HTTPS in production.');
    }
  } catch {
    warnings.push('APP_URL is not a valid absolute URL.');
  }
}

const providerStatus = Object.fromEntries(
  Object.entries(providerGroups).map(([provider, names]) => {
    const configured = names.every((name) => Boolean(process.env[name]?.trim()));
    return [provider, configured];
  })
);

if (!providerStatus.plaid && !providerStatus.flinks) {
  warnings.push('Neither Plaid nor Flinks is fully configured. At least one provider is required for live banking data.');
}

console.log(JSON.stringify({
  ok: missing.length === 0 && warnings.length === 0,
  missing,
  warnings,
  providers: providerStatus,
  optionalAI: Boolean(process.env.OPENAI_API_KEY?.trim())
}, null, 2));

if (missing.length > 0 || warnings.length > 0) process.exit(1);
