// Email sign-in saves the session where ConvexAuthProvider reads it (src/app/authStorage.ts).
// If an @convex-dev/auth upgrade renames those keys, sign-in links would sign nobody in: fail here.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { authStorageKeys } from "../src/app/authStorage.ts";

test("keys are the library's names, namespaced by the Convex URL's letters and digits", () => {
  assert.deepEqual(authStorageKeys("https://robust-barracuda-45.convex.cloud"), {
    jwt: "__convexAuthJWT_httpsrobustbarracuda45convexcloud",
    refreshToken: "__convexAuthRefreshToken_httpsrobustbarracuda45convexcloud",
  });
});

test("the installed @convex-dev/auth still stores the session under those names", () => {
  const require = createRequire(import.meta.url);
  const react = require.resolve("@convex-dev/auth/react");
  const src = readFileSync(react.replace(/index\.js$/, "client.js"), "utf8");
  assert.match(src, /JWT_STORAGE_KEY = "__convexAuthJWT"/);
  assert.match(src, /REFRESH_TOKEN_STORAGE_KEY = "__convexAuthRefreshToken"/);
  assert.ok(src.includes("`${key}_${escapedNamespace}`"), "key format");
  assert.ok(src.includes('namespace.replace(/[^a-zA-Z0-9]/g, "")'), "namespace escaping");
  const index = readFileSync(react, "utf8");
  assert.match(index, /storageNamespace: storageNamespace \?\? client\.address/);
});
