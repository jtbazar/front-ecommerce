import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function base64Url(input: Uint8Array | string): string {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : input;
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function pemToArrayBuffer(pem: string): ArrayBuffer {
  const body = pem.replace(/-----BEGIN PRIVATE KEY-----/g, "")
    .replace(/-----END PRIVATE KEY-----/g, "")
    .replace(/\s/g, "");
  const binary = atob(body);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

async function getGoogleAccessToken(serviceAccount: Record<string, string>) {
  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = base64Url(JSON.stringify({
    iss: serviceAccount.client_email,
    scope: "https://www.googleapis.com/auth/firebase.messaging",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  }));
  const unsigned = header + "." + claims;
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToArrayBuffer(serviceAccount.private_key.replace(/\\n/g, "\n")),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = new Uint8Array(await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(unsigned),
  ));
  const assertion = unsigned + "." + base64Url(signature);
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error_description || result.error || "Google OAuth failed");
  return result.access_token as string;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const firebaseRaw = Deno.env.get("FIREBASE_SERVICE_ACCOUNT_JSON");

    const authHeader = req.headers.get("Authorization") || "";
    const bearer = authHeader.replace(/^Bearer\s+/i, "");

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const body = await req.json();
    let action = body.action as string;
    if (!bearer && action !== "webhook") return json({ error: "Missing bearer token" }, 401);
    let trustedWebhook = false;

    if (action === "webhook") {
      const signature = req.headers.get("x-jtbazar-signature") || "";
      const { data: verified, error: verifyError } = await supabase.rpc("verify_push_webhook", {
        p_payload: body,
        p_signature: signature,
      });
      if (verifyError || verified !== true) return json({ error: "Invalid notification webhook signature" }, 401);
      trustedWebhook = true;
      action = "send";
    }

    if (action === "register" || action === "unregister") {
      const { data: authData, error: authError } = await supabase.auth.getUser(bearer);
      if (authError || !authData.user) return json({ error: "Invalid user session" }, 401);
      const userId = authData.user.id;

      if (action === "register") {
        const token = String(body.token || "").trim();
        const platform = String(body.platform || "");
        if (!token || token.length > 4096 || !["web", "android"].includes(platform)) {
          return json({ error: "Valid token and platform (web or android) are required" }, 400);
        }
        const { error } = await supabase.from("user_push_tokens").upsert({
          user_id: userId,
          token,
          platform,
          device_label: body.device_label ? String(body.device_label).slice(0, 120) : null,
          updated_at: new Date().toISOString(),
        }, { onConflict: "token" });
        if (error) throw error;
        return json({ success: true, message: "Push token registered" });
      }

      const token = String(body.token || "").trim();
      if (!token) return json({ error: "Token is required" }, 400);
      const { error } = await supabase.from("user_push_tokens")
        .delete().eq("user_id", userId).eq("token", token);
      if (error) throw error;
      return json({ success: true, message: "Push token removed" });
    }

    if (action === "send" || action === "test") {
      let targetUserId = "";
      if (action === "send") {
        if (!trustedWebhook && (!serviceRoleKey || bearer !== serviceRoleKey)) {
          return json({ error: "Only trusted server-side callers can send push notifications" }, 403);
        }
        targetUserId = String(body.user_id || "");
      } else {
        const { data: authData, error: authError } = await supabase.auth.getUser(bearer);
        if (authError || !authData.user) return json({ error: "Invalid user session" }, 401);
        targetUserId = authData.user.id;
      }
      const title = (action === "test" ? "JTBazar test notification" : String(body.title || "")).slice(0, 120);
      const messageBody = (action === "test" ? "Push notifications are connected to this account." : String(body.body || "")).slice(0, 500);
      if (!targetUserId || !title) return json({ error: "user_id and title are required" }, 400);

      const { data: devices, error: tokenError } = await supabase
        .from("user_push_tokens").select("token, platform").eq("user_id", targetUserId);
      if (tokenError) throw tokenError;
      if (!devices?.length) return json({ success: true, sent: 0, message: "No registered devices" });

      if (!firebaseRaw) return json({ error: "Missing FIREBASE_SERVICE_ACCOUNT_JSON secret" }, 500);
      const serviceAccount = JSON.parse(firebaseRaw);
      if (serviceAccount.project_id !== "jtbazar-9fc3d") {
        return json({ error: "Firebase service account belongs to a different project" }, 400);
      }
      const googleToken = await getGoogleAccessToken(serviceAccount);
      const results = await Promise.all(devices.map(async (device: {token:string; platform:string}) => {
        const payload: Record<string, unknown> = {
          message: {
            token: device.token,
            notification: { title, body: messageBody },
            data: Object.fromEntries(Object.entries(body.data || {}).map(([k, v]) => [k, String(v)])),
          },
        };
        if (device.platform === "web") {
          (payload.message as Record<string, unknown>).webpush = {
            notification: { title, body: messageBody, icon: "/favicon.ico" },
            fcmOptions: body.link ? { link: String(body.link) } : undefined,
          };
        } else {
          (payload.message as Record<string, unknown>).android = { priority: "high" };
        }
        const response = await fetch(
          `https://fcm.googleapis.com/v1/projects/${serviceAccount.project_id}/messages:send`,
          {
            method: "POST",
            headers: {
              "Authorization": `Bearer ${googleToken}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(payload),
          },
        );
        return { platform: device.platform, ok: response.ok, status: response.status };
      }));
      return json({ success: results.every((r) => r.ok), sent: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length, results });
    }

    return json({ error: "Unsupported action. Use register, unregister, or send." }, 400);
  } catch (error) {
    console.error("firebase-push-notifications error:", error);
    return json({ error: error instanceof Error ? error.message : "Unexpected server error" }, 500);
  }
});