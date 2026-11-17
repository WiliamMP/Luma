// Short-lived TURN credentials from Cloudflare Realtime TURN, so the Cloudflare token never ships in the app.
// Secrets: supabase secrets set CF_TURN_KEY_ID=... CF_TURN_API_TOKEN=...
// Deploy:  supabase functions deploy turn

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });

  // the anon key is public, so a valid JWT is not enough: only logged-in users get credentials
  const user = await fetch(`${Deno.env.get("SUPABASE_URL")}/auth/v1/user`, {
    headers: { Authorization: req.headers.get("Authorization") ?? "", apikey: Deno.env.get("SUPABASE_ANON_KEY")! },
  });
  if (!user.ok) return new Response("Unauthorized", { status: 401, headers: cors });

  const res = await fetch(
    `https://rtc.live.cloudflare.com/v1/turn/keys/${Deno.env.get("CF_TURN_KEY_ID")}/credentials/generate-ice-servers`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${Deno.env.get("CF_TURN_API_TOKEN")}`, "Content-Type": "application/json" },
      body: JSON.stringify({ ttl: 86400 }),
    },
  );
  if (!res.ok) return new Response(await res.text(), { status: 502, headers: cors });

  // Cloudflare also lists port 53 URLs, which browsers block: drop them
  const { iceServers } = (await res.json()) as { iceServers: { urls: string[] }[] };
  for (const s of iceServers) s.urls = s.urls.filter((u) => !/:53(\?|$)/.test(u));
  return Response.json({ iceServers }, { headers: cors });
});
