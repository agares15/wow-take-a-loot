const crypto = require("crypto");

module.exports = async (req, res) => {
  try {
    const proto = req.headers["x-forwarded-proto"] || "https";
    const host = req.headers["x-forwarded-host"] || req.headers.host;
    const origin = `${proto}://${host}`;
    const url = new URL(req.url, origin);
    const path = url.pathname;

    // 1. Página principal
    if (path === "/" && req.method === "GET") {
      return sendHtml(res, 200, renderHomePage(origin));
    }

    // 2. Redirección a Patreon OAuth
    if (path === "/auth/login" && req.method === "GET") {
      const state = signOAuthState(process.env.TOKEN_SIGNING_SECRET);
      const authUrl = new URL("https://www.patreon.com/oauth2/authorize");
      authUrl.searchParams.set("response_type", "code");
      authUrl.searchParams.set("client_id", process.env.PATREON_CLIENT_ID);
      authUrl.searchParams.set("redirect_uri", `${origin}/auth/callback`);
      authUrl.searchParams.set("scope", "identity identity.memberships");
      authUrl.searchParams.set("state", state);

      res.writeHead(302, { Location: authUrl.toString() });
      return res.end();
    }

    // 3. Callback de Patreon OAuth
    if (path === "/auth/callback" && req.method === "GET") {
      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state");

      if (!code) {
        res.writeHead(302, { Location: `${origin}/` });
        return res.end();
      }

      if (!verifyOAuthState(state, process.env.TOKEN_SIGNING_SECRET)) {
        return sendHtml(res, 400, renderErrorPage("Invalid or expired OAuth state. Please try again."));
      }

      const tokenRes = await fetch("https://www.patreon.com/api/oauth2/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code,
          grant_type: "authorization_code",
          client_id: process.env.PATREON_CLIENT_ID,
          client_secret: process.env.PATREON_CLIENT_SECRET,
          redirect_uri: `${origin}/auth/callback`
        })
      });

      if (!tokenRes.ok) {
        return sendHtml(res, 401, renderErrorPage("Failed to authenticate with Patreon."));
      }

      const tokenData = await tokenRes.json();
      const check = await verifyUserMembershipFromOAuth(tokenData.access_token);

      if (!check.active || !check.memberId) {
        return sendHtml(
          res,
          403,
          renderErrorPage("You do not have an active eligible Patreon membership.")
        );
      }

      const signedToken = signMemberToken(check.memberId, process.env.TOKEN_SIGNING_SECRET);
      const manifestUrl = `${origin}/manifest/${signedToken}/module.json`;
      return sendHtml(res, 200, renderSuccessPage(manifestUrl));
    }

    // 4. Servir module.json dinámico a Foundry VTT
    const manifestMatch = path.match(/^\/manifest\/([^/]+)\/module\.json$/);
    if (manifestMatch && req.method === "GET") {
      const token = manifestMatch[1];
      const memberId = verifyMemberToken(token, process.env.TOKEN_SIGNING_SECRET);
      if (!memberId) return res.status(403).send("Invalid token");

      const stillActive = await isMemberStillActive(memberId);
      if (!stillActive) return res.status(403).send("Inactive Patreon subscription");

      const release = await getLatestGitHubRelease();
      const asset = release.assets?.find((a) => a.name === "module.json");
      if (!asset) return res.status(404).send("module.json not found in latest release");

      const assetRes = await fetchGitHubAsset(asset.url);
      if (!assetRes.ok) return res.status(502).send("Failed to fetch module.json");

      const manifestJson = await assetRes.json();
      manifestJson.manifest = `${origin}/manifest/${token}/module.json`;
      manifestJson.download = `${origin}/download/${token}/wow-take-a-loot.zip`;

      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.setHeader("Cache-Control", "no-store");
      return res.status(200).send(JSON.stringify(manifestJson, null, 2));
    }

    // 5. Servir wow-take-a-loot.zip desde GitHub Release privado
    const downloadMatch = path.match(/^\/download\/([^/]+)\/wow-take-a-loot\.zip$/);
    if (downloadMatch && req.method === "GET") {
      const token = downloadMatch[1];
      const memberId = verifyMemberToken(token, process.env.TOKEN_SIGNING_SECRET);
      if (!memberId) return res.status(403).send("Invalid token");

      const stillActive = await isMemberStillActive(memberId);
      if (!stillActive) return res.status(403).send("Inactive Patreon subscription");

      const release = await getLatestGitHubRelease();
      const asset =
        release.assets?.find((a) => a.name === "wow-take-a-loot.zip") ||
        release.assets?.find((a) => a.name.endsWith(".zip"));
      if (!asset) return res.status(404).send("Module zip not found in latest release");

      const assetRes = await fetchGitHubAsset(asset.url);
      if (!assetRes.ok) return res.status(502).send("Failed to fetch module zip");

      const buffer = Buffer.from(await assetRes.arrayBuffer());
      res.setHeader("Content-Type", "application/zip");
      res.setHeader("Content-Disposition", 'attachment; filename="wow-take-a-loot.zip"');
      res.setHeader("Cache-Control", "no-store");
      return res.status(200).send(buffer);
    }

    return res.status(404).send("Not Found");
  } catch (err) {
    console.error(err);
    return res.status(500).send("Internal Server Error");
  }
};

// ---------------- Helpers ----------------

function getRequiredTiers() {
  return (process.env.PATREON_REQUIRED_TIER_IDS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function matchesMembership(memberObj) {
  if (!memberObj) return false;
  if (memberObj.attributes?.patron_status !== "active_patron") return false;

  const campaignId = process.env.PATREON_CAMPAIGN_ID;
  if (campaignId && memberObj.relationships?.campaign?.data?.id !== campaignId) {
    return false;
  }

  const requiredTiers = getRequiredTiers();
  if (requiredTiers.length > 0) {
    const tiers = memberObj.relationships?.currently_entitled_tiers?.data || [];
    return tiers.some((t) => requiredTiers.includes(t.id));
  }
  return true;
}

async function verifyUserMembershipFromOAuth(accessToken) {
  const apiUrl =
    "https://www.patreon.com/api/oauth2/v2/identity" +
    "?include=memberships,memberships.currently_entitled_tiers,memberships.campaign" +
    "&fields[member]=patron_status,currently_entitled_amount_cents";

  const res = await fetch(apiUrl, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  if (!res.ok) return { active: false, memberId: null };

  const json = await res.json();
  const included = json?.included || [];
  const memberships = included.filter((item) => item.type === "member");
  const validMember = memberships.find((m) => matchesMembership(m));

  return {
    active: Boolean(validMember),
    memberId: validMember?.id || null
  };
}

async function isMemberStillActive(memberId) {
  const apiUrl =
    `https://www.patreon.com/api/oauth2/v2/members/${encodeURIComponent(memberId)}` +
    "?include=currently_entitled_tiers,campaign" +
    "&fields[member]=patron_status,currently_entitled_amount_cents";

  const res = await fetch(apiUrl, {
    headers: { Authorization: `Bearer ${process.env.PATREON_CREATOR_ACCESS_TOKEN}` }
  });
  if (!res.ok) return false;

  const json = await res.json();
  return matchesMembership(json?.data);
}

function signOAuthState(secret) {
  const payload = `${crypto.randomUUID()}.${Date.now()}`;
  const sig = crypto.createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

function verifyOAuthState(state, secret) {
  const parts = String(state || "").split(".");
  if (parts.length !== 3) return false;
  const [nonce, tsStr, sig] = parts;
  const payload = `${nonce}.${tsStr}`;
  const expected = crypto.createHmac("sha256", secret).update(payload).digest("base64url");
  if (sig.length !== expected.length) return false;
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return false;
  const ageMs = Date.now() - Number(tsStr);
  return Number.isFinite(ageMs) && ageMs >= 0 && ageMs <= 10 * 60 * 1000;
}

function signMemberToken(memberId, secret) {
  const payload = Buffer.from(memberId, "utf8").toString("base64url");
  const sig = crypto.createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

function verifyMemberToken(token, secret) {
  const parts = String(token || "").split(".");
  if (parts.length !== 2) return null;
  const [payload, sig] = parts;
  const expected = crypto.createHmac("sha256", secret).update(payload).digest("base64url");
  if (sig.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  return Buffer.from(payload, "base64url").toString("utf8");
}

async function getLatestGitHubRelease() {
  const res = await fetch(
    `https://api.github.com/repos/${process.env.GITHUB_OWNER}/${process.env.GITHUB_REPO}/releases/latest`,
    {
      headers: {
        Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "wow-take-a-loot-vercel"
      }
    }
  );
  if (!res.ok) throw new Error(`GitHub API error: ${res.status}`);
  return res.json();
}

async function fetchGitHubAsset(assetApiUrl) {
  const res = await fetch(assetApiUrl, {
    headers: {
      Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
      Accept: "application/octet-stream",
      "User-Agent": "wow-take-a-loot-vercel"
    },
    redirect: "manual"
  });
  if (res.status >= 300 && res.status < 400) {
    const location = res.headers.get("Location");
    if (location) return fetch(location);
  }
  return res;
}

function getCookie(req, name) {
  const cookie = req.headers.cookie || "";
  const match = cookie.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return match ? match[1] : null;
}

function sendHtml(res, status, html) {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  return res.status(status).send(html);
}

function renderHomePage(origin) {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>Wow's Take a Loot - Patreon Access</title>
<style>
  body { font-family: system-ui, sans-serif; background: #0f172a; color: #f1f5f9; display: grid; place-items: center; min-height: 100vh; margin: 0; }
  .card { background: #1e293b; border: 1px solid #334155; border-radius: 12px; padding: 32px; max-width: 460px; text-align: center; }
  a.btn { display: inline-block; margin-top: 18px; background: #f96854; color: #fff; text-decoration: none; font-weight: 700; padding: 12px 24px; border-radius: 8px; }
</style></head>
<body>
  <div class="card">
    <h2>Wow's Take a Loot</h2>
    <p>Sign in with your Patreon account to get your personal Foundry VTT manifest URL.</p>
    <a class="btn" href="${origin}/auth/login">Connect with Patreon</a>
  </div>
</body></html>`;
}

function renderSuccessPage(manifestUrl) {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>Your Foundry Manifest URL</title>
<style>
  body { font-family: system-ui, sans-serif; background: #0f172a; color: #f1f5f9; display: grid; place-items: center; min-height: 100vh; margin: 0; }
  .card { background: #1e293b; border: 1px solid #334155; border-radius: 12px; padding: 32px; max-width: 580px; }
  input { width: 100%; padding: 10px; border-radius: 6px; border: 1px solid #475569; background: #0f172a; color: #38bdf8; font-family: monospace; box-sizing: border-box; }
  button { margin-top: 12px; background: #10b981; color: #fff; border: none; padding: 10px 18px; border-radius: 6px; font-weight: 700; cursor: pointer; }
</style></head>
<body>
  <div class="card">
    <h2>Membership Verified!</h2>
    <p>Paste this URL in Foundry VTT → <strong>Install Module → Manifest URL</strong> (do not share this personal link):</p>
    <input id="url" readonly value="${manifestUrl}" />
    <button onclick="navigator.clipboard.writeText(document.getElementById('url').value); this.textContent='Copied!';">Copy URL</button>
  </div>
</body></html>`;
}

function renderErrorPage(message) {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>Access Denied</title>
<style>
  body { font-family: system-ui, sans-serif; background: #0f172a; color: #f1f5f9; display: grid; place-items: center; min-height: 100vh; margin: 0; }
  .card { background: #1e293b; border: 1px solid #7f1d1d; border-radius: 12px; padding: 32px; max-width: 460px; text-align: center; }
</style></head>
<body>
  <div class="card"><h2>Access Denied</h2><p>${message}</p></div>
</body></html>`;
}
