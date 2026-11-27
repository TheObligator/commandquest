// Deleting an account (convex/account.ts, Settings → Delete account): the word typed to confirm.

export const DELETE_WORD = "delete";

/** Whether what was typed confirms the deletion: the word, ignoring case and spaces around it. */
export function confirmsDeletion(typed: string): boolean {
  return typed.trim().toLowerCase() === DELETE_WORD;
}
