// Confirming an account deletion (convex/model/account.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import { confirmsDeletion, DELETE_WORD } from "../convex/model/account.ts";

test("only the word delete confirms, ignoring case and surrounding spaces", () => {
  assert.equal(DELETE_WORD, "delete");
  for (const ok of ["delete", "DELETE", " Delete "]) assert.equal(confirmsDeletion(ok), true, ok);
  for (const no of ["", "del", "delete!", "deleted", "yes", "de lete"]) assert.equal(confirmsDeletion(no), false, no);
});
