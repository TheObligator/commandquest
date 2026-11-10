# Deploying: CI, Convex and commandquest.app

`.github/workflows/web.yml` runs on every push to `web` and `live`:

1. **changes** checks which files the push touched, so jobs that can't be affected are skipped.
2. **frontend** (always, about a minute): `npm test`, a type-check of `web/convex/`, and `npm run build`
   (`build:staging` on `web`), which type-checks the client. It checks out only `web/`.
3. **server** (only when something outside `web/` and `docs/` changed):
   `mvn -f forge-web-server/reactor.xml package` on JDK 17 with a Maven cache.
4. **deploy** (only when `web/` or the workflow changed, and nothing failed):
   1. Convex functions and schema, pushed before the site so the new site never calls a missing function.
   2. The exact bundle the frontend job built and tested, deployed as a static-assets Cloudflare
      Worker (`web/wrangler.jsonc`).
   3. A smoke test that fetches the site and checks it serves the build for the right Convex deployment.

| Branch | Convex | Cloudflare Worker | Address |
|---|---|---|---|
| `web` | staging, `robust-barracuda-45` (`convex deploy`) | `commandquest-staging` (`wrangler deploy --env staging`) | `staging.commandquest.app` |
| `live` | production, `impressive-manatee-540` (`convex deploy`) | `commandquest` (`wrangler deploy`) | `commandquest.app` |

Workers, not Pages: Cloudflare points new projects at Workers static assets. The custom domains are
declared in `web/wrangler.jsonc`, and the first deploy creates both Workers and their DNS records,
so there's nothing to create in the Cloudflare dashboard first. `npx wrangler@<version> deploy --dry-run`
in `web/` (after a build) checks the config without deploying.

A newer push cancels an older run's tests, but a deploy that has started always finishes.
`Actions → Web → Run workflow` redeploys a branch by hand.

## One-time setup

### Cloudflare (DNS for commandquest.app is already there)

1. **My Profile → API Tokens → Create Token → Create Custom Token** with:
   - Account → **Workers Scripts: Edit** (create and deploy the Workers and their files)
   - Account → **Account Settings: Read**
   - Zone → **Zone: Read** and **DNS: Edit** (attach the custom domains)
   - Account resources: only your account. Zone resources: only `commandquest.app`. No IP filter
     (GitHub's runners change IPs).

   No "Workers Routes" permission is needed for custom domains (the first deploy attached
   `staging.commandquest.app` without it).
2. Note the **Account ID** (shown on the account's home page and in the Workers & Pages overview).

The first CI deploy creates the Workers, `commandquest.app` and `staging.commandquest.app`. If either
name already has a DNS record, delete that record first, or the custom domain can't attach.

### Convex

Dashboard → each deployment → Settings → **Deploy keys**:

- production (`impressive-manatee-540`): a production deploy key
- staging (`robust-barracuda-45`): a development deploy key

Point sign-in at the real addresses:

```sh
npx convex env set SITE_URL https://commandquest.app --deployment impressive-manatee-540
npx convex env set SITE_URL https://staging.commandquest.app --deployment robust-barracuda-45
```

Add both addresses as authorized redirect URIs in the Google and Discord OAuth apps.

### GitHub (Settings → Secrets and variables → Actions, and Settings → Environments)

| Where | Name | Value |
|---|---|---|
| Repository secret | `CLOUDFLARE_API_TOKEN` | the token from step 1 |
| Repository secret | `CLOUDFLARE_ACCOUNT_ID` | from the Cloudflare dashboard sidebar |
| Environment `staging`, secret | `CONVEX_DEPLOY_KEY` | staging dev deploy key |
| Environment `staging`, variable | `SITE_URL` | `https://staging.commandquest.app` |
| Environment `production`, secret | `CONVEX_DEPLOY_KEY` | production deploy key |
| Environment `production`, variable | `SITE_URL` | `https://commandquest.app` |

Optionally, on the `production` environment restrict deployment branches to `live` and add a
required reviewer, so nothing reaches the public site without a click.

## Not covered yet

The Java game server isn't hosted anywhere, so CI tests it but doesn't deploy it. The site works
without it (accounts and decks live in Convex), and live games need it hosted once that's ready.
