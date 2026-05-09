// Minimal Cloudflare Worker entrypoint for Trask Q&A /ask endpoint
export default {
  async fetch(request: Request, env: any, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/api/trask/ask" && request.method === "POST") {
      // Forward the request to the ResearchWizard backend
      const apiKey = env.TRASK_WEB_API_KEY;
      const allowAnon = env.TRASK_WEB_ALLOW_ANONYMOUS === "1" || env.TRASK_WEB_ALLOW_ANONYMOUS === "true";
      if (apiKey) {
        const auth = request.headers.get("authorization") || request.headers.get("x-trask-api-key");
        if (!auth || (auth !== `Bearer ${apiKey}` && auth !== apiKey)) {
          return new Response(JSON.stringify({ error: "Invalid or missing API key." }), { status: 401, headers: { "Content-Type": "application/json" } });
        }
      } else if (!allowAnon) {
        return new Response(JSON.stringify({ error: "Set TRASK_WEB_API_KEY or TRASK_WEB_ALLOW_ANONYMOUS=1 for public access." }), { status: 401, headers: { "Content-Type": "application/json" } });
      }
      // Forward to ResearchWizard backend
      const backendUrl = env.TRASK_RESEARCHWIZARD_BASE_URL + "/api/trask/ask";
      const backendReq = new Request(backendUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": env.TRASK_RESEARCHWIZARD_API_KEY ? `Bearer ${env.TRASK_RESEARCHWIZARD_API_KEY}` : undefined,
        },
        body: await request.text(),
      });
      const resp = await fetch(backendReq);
      return new Response(resp.body, resp);
    }
    return new Response("Not found", { status: 404 });
  },
};
