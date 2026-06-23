import "dotenv/config";
import express from "express";
import fs from "node:fs/promises";
import path from "node:path";
import configRoutes from "./routes/configRoutes.js";
import { startGeoipScheduler } from "./jobs/geoipScheduler.js";
import { runGeoipUpdate } from "./services/geoipUpdateRunner.js";

const app = express();
const PORT = process.env.PORT || 3000;

const stateDir = path.join(process.cwd(), "tmp", "geoip-state");
const currentManifestPath = path.join(stateDir, "current-manifest.json");
const configDir = path.join(process.cwd(), "public", "configs");

app.use(express.json());

function getR2BaseUrl() {
  const baseUrl = process.env.R2_PUBLIC_BASE_URL?.replace(/\/$/, "");

  if (!baseUrl) {
    throw new Error("Missing R2_PUBLIC_BASE_URL");
  }

  return baseUrl;
}

async function readJson(filePath, fallback = null) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

async function fetchR2Manifest() {  
  const manifestUrl = `${getR2BaseUrl()}/manifest.json`;

  const res = await fetch(manifestUrl, {
    headers: {
      "Cache-Control": "no-cache",
    },
  });

  if (!res.ok) {
    throw new Error(`Failed to read R2 manifest: ${res.status} ${res.statusText}`);
  }

  return res.json();
}

async function getGeoipManifest() {
  const localManifest = await readJson(currentManifestPath);

  if (localManifest) {
    return localManifest;
  }

  const r2Manifest = await fetchR2Manifest();

  await fs.mkdir(stateDir, { recursive: true });
  await fs.writeFile(currentManifestPath, JSON.stringify(r2Manifest, null, 2));

  return r2Manifest;
}

app.get("/health", (req, res) => {
  res.json({ ok: true });
});

app.get("/api/geoip/countries", async (req, res) => {
  try {
    const manifest = await getGeoipManifest();

    res.json({
      generatedAt: manifest.generatedAt,
      lastUpdatedAt: manifest.lastUpdatedAt,
      manifestUrl: manifest.client?.manifestUrl || `${getR2BaseUrl()}/manifest.json`,
      countries: Object.keys(manifest.countries || {}),
      files: manifest.countries || {},
    });
  } catch (error) {
    res.status(500).json({
      error: error.message,
    });
  }
});

app.get("/api/geoip/status", async (req, res) => {
  try {
    const statusPath = path.join(stateDir, "update-status.json");
    const status = JSON.parse(await fs.readFile(statusPath, "utf8"));

    res.json(status);
  } catch (error) {
    res.status(404).json({
      error: "GeoIP update status not found yet. Run update first.",
    });
  }
});



app.post("/api/geoip/update", async (req, res) => {
  try {
    const manifest = await runGeoipUpdate({ triggeredBy: "manual-api" });

    res.json({
      ok: true,
      buildId: manifest.buildId,
      lastUpdatedAt: manifest.lastUpdatedAt,
      manifestUrl: manifest.client?.manifestUrl || `${getR2BaseUrl()}/manifest.json`,
      storage: manifest.storage,
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error.message,
    });
  }
});
app.get("/api/geoip/download-url/:sha256", async (req, res) => {
  try {
    const sha256 = req.params.sha256.toLowerCase();

    if (!/^[a-f0-9]{64}$/.test(sha256)) {
      return res.status(400).json({
        error: "Invalid sha256",
      });
    }

    const manifest = await getGeoipManifest();

    for (const [country, item] of Object.entries(manifest.countries || {})) {
      if (item.sha256?.toLowerCase() === sha256) {
        return res.json({
          apiDownloadUrl: item.apiDownloadUrl || `/api/geoip/${country}/download`,
        });
      }
    }

    return res.status(404).json({
      error: "No GeoIP file found for this sha256",
    });
  } catch (error) {
    res.status(500).json({
      error: error.message,
    });
  }
});
app.get("/api/geoip/:country", async (req, res) => {
  try {
    const country = req.params.country.toLowerCase();

    if (!/^[a-z]{2}$/.test(country)) {
      return res.status(400).json({ error: "Invalid country code" });
    }

    const manifest = await getGeoipManifest();
    const item = manifest.countries?.[country];

    if (!item) {
      return res.status(404).json({ error: `No GeoIP file for ${country}` });
    }

    const apiDownloadUrl = item.apiDownloadUrl || `/api/geoip/${country}/download`;
    const directR2Url = item.url || `${getR2BaseUrl()}/${item.file}`;

    res.json({
      country,
      file: item.file,
      bytes: item.bytes,
      sha256: item.sha256,
      url: directR2Url,
      directR2Url,
      apiDownloadUrl,
    });
  } catch (error) {
    res.status(500).json({
      error: error.message,
    });
  }
});

app.get("/api/geoip/:country/download", async (req, res) => {
  try {
    const country = req.params.country.toLowerCase();
    if (!/^[a-z]{2}$/.test(country)) {
      return res.status(400).json({ error: "Invalid country code" });
    }
    const manifest = await getGeoipManifest();
    const item = manifest.countries?.[country];
    if (!item) {
      return res.status(404).json({ error: `No GeoIP file for ${country}` });
    }
    const downloadUrl = item.url || `${getR2BaseUrl()}/${item.file}`;
    return res.redirect(302, downloadUrl);
  } catch (error) {
    res.status(500).json({
      error: error.message,
    });
  }
});

app.use(
  "/configs",
  express.static(configDir, {
    setHeaders(res) {
      res.setHeader("Cache-Control", "public, max-age=86400");
    },
  }),
);

app.use("/api/config", configRoutes);

startGeoipScheduler();

app.listen(PORT, () => {
  console.log(`GeoIP API server running on http://localhost:${PORT}`);
});