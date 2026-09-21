import { Types } from "mongoose";

/**
 * Read the id of a Mongoose ref that may or may not be populated.
 *
 * Repositories differ on which refs they populate, so `ref.toString()` is unsafe:
 * a populated document stringifies to its inspect output rather than its id. That
 * is what silently broke the chat block check (every send ended in a CastError).
 */
export function getId(value: unknown): string {
  if (!value) return "";
  if (value instanceof Types.ObjectId) return value.toString();
  if (typeof value === "object" && value !== null && "_id" in value) {
    return String((value as { _id: unknown })._id);
  }
  return String(value);
}

/** True when both refs point at the same document, populated or not. */
export function sameId(a: unknown, b: unknown): boolean {
  const left = getId(a);
  return left !== "" && left === getId(b);
}
