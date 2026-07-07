const isGithubActions = process.env.GITHUB_ACTIONS === "true";

export const logger = {
  info(message: string, meta?: unknown): void {
    console.log(`[info] ${message}`, meta ?? "");
  },
  warn(message: string, meta?: unknown): void {
    if (isGithubActions) {
      console.log(`::warning::${message}`);
    } else {
      console.warn(`[warn] ${message}`, meta ?? "");
    }
  },
  error(message: string, meta?: unknown): void {
    if (isGithubActions) {
      console.log(`::error::${message}`);
    } else {
      console.error(`[error] ${message}`, meta ?? "");
    }
  },
};
