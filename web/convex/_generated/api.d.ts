/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as auth from "../auth.js";
import type * as decks from "../decks.js";
import type * as http from "../http.js";
import type * as importDeck from "../importDeck.js";
import type * as model_deckRules from "../model/deckRules.js";
import type * as model_importers from "../model/importers.js";
import type * as settings from "../settings.js";
import type * as signinHandoff from "../signinHandoff.js";
import type * as stops from "../stops.js";
import type * as users from "../users.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  auth: typeof auth;
  decks: typeof decks;
  http: typeof http;
  importDeck: typeof importDeck;
  "model/deckRules": typeof model_deckRules;
  "model/importers": typeof model_importers;
  settings: typeof settings;
  signinHandoff: typeof signinHandoff;
  stops: typeof stops;
  users: typeof users;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
