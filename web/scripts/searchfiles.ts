// What search engines get from each build (vite.config.ts): the public site is indexed, everything
// else (staging, local builds) asks not to be.
//
// The site uses a hash router (#/decks, #/privacy…), and search engines ignore everything after
// the #, so the home page is the only page they can list. The sitemap says just that.

export const SITE = "https://commandquest.app";

export interface SearchFiles {
  /** Written to the build as robots.txt */
  robots: string;
  /** Written as sitemap.xml (public site only) */
  sitemap?: string;
  /** Added to index.html's <head> */
  head: string;
}

/** `mode` is Vite's: "production" for the public site (`npm run build`), "staging", or "development". */
export function searchFiles(mode: string): SearchFiles {
  if (mode !== "production") {
    // Crawling stays allowed so search engines can read the noindex: a page they're barred from
    // can still be listed, without its content, if something links to it.
    return { robots: "User-agent: *\nAllow: /\n", head: '<meta name="robots" content="noindex, nofollow" />' };
  }
  return {
    robots: `User-agent: *\nAllow: /\n\nSitemap: ${SITE}/sitemap.xml\n`,
    sitemap:
      '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
      `  <url><loc>${SITE}/</loc></url>\n` +
      "</urlset>\n",
    head: `<link rel="canonical" href="${SITE}/" />`,
  };
}
