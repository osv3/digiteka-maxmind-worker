import "dotenv/config";

function requiredEnv(name) {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Missing ${name} environment variable`);
  }

  return value;
}

async function cloudflareApi(path, options = {}) {
  const token = requiredEnv("CLOUDFLARE_API_TOKEN");

  const res = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(options.headers || {}),
    },
  });

  const json = await res.json();

  if (!res.ok || !json.success) {
    throw new Error(
      `Cloudflare API failed: ${JSON.stringify(json.errors || json, null, 2)}`,
    );
  }

  return json.result;
}

async function main() {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID || requiredEnv("R2_ACCOUNT_ID");
  const bucket = requiredEnv("R2_BUCKET");
  const zoneId = requiredEnv("CLOUDFLARE_ZONE_ID");
  const domain = requiredEnv("R2_CUSTOM_DOMAIN");

  const result = await cloudflareApi(
    `/accounts/${accountId}/r2/buckets/${encodeURIComponent(bucket)}/domains/custom`,
    {
      method: "POST",
      body: JSON.stringify({
        domain,
        enabled: true,
        zoneId,
        minTLS: process.env.R2_CUSTOM_DOMAIN_MIN_TLS || "1.2",
      }),
    },
  );

  console.log("R2 custom domain attached:");
  console.log(JSON.stringify(result, null, 2));
}

main().catch(error => {
  console.error(error.message);
  process.exit(1);
});