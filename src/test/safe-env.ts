const sensitiveEnvironmentName =
  /^(?:DATABASE_URL.*|ANALYTICS_EVAL_DATABASE_URL|[A-Z0-9_]+_(?:API_KEY|ACCESS_KEY|ACCESS_TOKEN|CLIENT_SECRET|CREDENTIALS|KEY|PASSWORD|PRIVATE_KEY|SECRET|SIGNING_KEY|TOKEN|EVENT_KEY)|AWS_.*|GCP_.*|GOOGLE_.*|S3_.*|INNGEST_.*|SUPABASE_.*)$/i;

export function isolateTestEnvironment(env: NodeJS.ProcessEnv = process.env): void {
  for (const name of Object.keys(env)) {
    if (sensitiveEnvironmentName.test(name)) delete env[name];
  }
  env["NODE_ENV"] = "test";
}
