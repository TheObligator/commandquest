// Where ConvexAuthProvider keeps the session in localStorage (@convex-dev/auth react/client.js:
// `${key}_${namespace}`, the namespace being the Convex URL with only letters and digits kept).
// tests/emailSignIn.test.ts checks the installed library still uses these names.

export function authStorageKeys(convexUrl: string) {
  const ns = convexUrl.replace(/[^a-zA-Z0-9]/g, "");
  return { jwt: `__convexAuthJWT_${ns}`, refreshToken: `__convexAuthRefreshToken_${ns}` };
}
