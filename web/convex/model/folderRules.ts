// Deck folder rules shared by the Convex functions (convex/folders.ts). Pure, so `node --test` can run it.

export const MAX_FOLDER_NAME = 50;
export const MAX_FOLDERS_PER_USER = 100;

export class FolderError extends Error {}

/** A folder name tidied (trimmed, inner whitespace collapsed). Throws FolderError with a user-facing message. */
export function cleanFolderName(name: string, taken: string[] = []): string {
  const clean = String(name ?? "").trim().replace(/\s+/g, " ");
  if (!clean || clean.length > MAX_FOLDER_NAME) throw new FolderError(`Folder names are 1-${MAX_FOLDER_NAME} characters.`);
  if (taken.some((t) => t.toLowerCase() === clean.toLowerCase())) throw new FolderError(`You already have a folder called "${clean}".`);
  return clean;
}
