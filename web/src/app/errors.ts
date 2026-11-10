import { ConvexError } from "convex/values";

/** A user-facing message for an error from a Convex call or anything else. */
export function errorMessage(e: unknown): string {
  if (e instanceof ConvexError) return typeof e.data === "string" ? e.data : "Something went wrong.";
  if (e instanceof Error) return e.message;
  return String(e);
}
