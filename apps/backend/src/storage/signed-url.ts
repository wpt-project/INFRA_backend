/**
 * Minimal Supabase Storage signed-URL helper (used by ENC-4.5 icon endpoint).
 * Calls the Supabase REST API directly; no heavyweight SDK needed.
 *
 * Env is read lazily at call time (not module load) so that scripts which
 * populate process.env after imports (e.g. the VERIFY harnesses) work.
 */

function supabaseConfig(): { url: string; serviceRoleKey: string } | null {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    console.error("SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not set — cannot create signed URL");
    return null;
  }
  return { url: supabaseUrl, serviceRoleKey };
}

/**
 * Produce a short-lived signed download URL for a private storage object.
 * Returns null if the env vars are missing or the call fails (caller maps to
 * a 500/404 as appropriate).
 */
export async function createSignedUrl(
  bucket: string,
  path: string,
  expiresInSec = 3600,
): Promise<string | null> {
  const config = supabaseConfig();
  if (!config) return null;

  const url = `${config.url}/storage/v1/object/sign/${encodeURIComponent(bucket)}/${path}`;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.serviceRoleKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ expiresIn: expiresInSec }),
    });
    if (!res.ok) {
      console.error("createSignedUrl: storage returned", res.status, (await res.text()).slice(0, 200));
      return null;
    }
    const data = (await res.json()) as { signedUrl?: string; signedURL?: string };
    const signedUrl = data.signedUrl ?? data.signedURL;
    if (!signedUrl) {
      console.error("createSignedUrl: no signedUrl in response:", JSON.stringify(data).slice(0, 200));
      return null;
    }
    return signedUrl;
  } catch (err) {
    console.error("createSignedUrl failed:", err);
    return null;
  }
}
