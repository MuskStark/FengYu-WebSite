// Serves the FengYu docs (dedicated infinia-docs Cloudflare Pages project,
// custom domain docs.infinia.fyi) as the in-site path
// https://www.infinia.fyi/docs/ — the free-plan way to mount a sub-path from
// another origin on the zone that already fronts www.infinia.fyi.
//
// The docs are BUILT with vitepress --base=/docs/, so every internal link
// carries the /docs prefix and paths forward verbatim — no rewriting. Two
// edge cases are handled explicitly:
//   1. /docs (no trailing slash): VitePress's root redirect is the RELATIVE
//      "en/", which would resolve against /docs as /en — pin the canonical
//      /docs/ form first.
//   2. Any redirect the Pages origin emits carries its own hostname in the
//      Location header; rewrite it back so the browser never leaves www.
export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/docs") {
      return Response.redirect(`${url.origin}/docs/`, 301);
    }
    url.hostname = "docs.infinia.fyi";
    const response = await fetch(new Request(url, request));
    const location = response.headers.get("location");
    if (location && location.includes("://docs.infinia.fyi")) {
      const rewritten = new Response(response.body, response);
      rewritten.headers.set(
        "location",
        location.replaceAll("://docs.infinia.fyi", "://www.infinia.fyi"),
      );
      return rewritten;
    }
    return response;
  },
};
