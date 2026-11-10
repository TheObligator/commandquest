// Convex functions can read deployment environment variables through process.env. Declared here
// so we don't need @types/node just for this.
declare const process: { env: Record<string, string | undefined> };
