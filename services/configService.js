import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const CONFIG_DIR = path.join(ROOT, "public", "configs");

export function normalizeCountries(value) {
  if (!value || typeof value !== "string") {
    throw new Error("Missing countries. Example: ?countries=us,ca");
  }

  const countries = [
    ...new Set(
      value
        .split(",")
        .map(country => country.trim().toLowerCase())
        .filter(Boolean),
    ),
  ];

  for (const country of countries) {
    if (!/^[a-z]{2}$/.test(country)) {
      throw new Error(`Invalid country code: ${country}`);
    }
  }

  if (countries.length === 0) {
    throw new Error("No valid countries provided");
  }

  return countries.sort();
}

function safeFilePart(value) {
  return value.toLowerCase().replace(/[^a-z0-9_-]/g, "-");
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function createRoutingConfig(countries, outboundTag) {
  return {
    routing: {
      domainStrategy: "IPIfNonMatch",
      rules: [
        {
          type: "field",
          outboundTag,
          ip: countries.map(country => `ext:${country}.dat:${country}`),
        },
      ],
    },
  };
}

function getConfigFileName(countries, outboundTag) {
  const countriesPart = countries.join("-");
  const outboundPart = safeFilePart(outboundTag);

  return `routing-${countriesPart}-${outboundPart}.json`;
}

export async function ensureConfig(countries, outboundTag = "Proxy-2") {
  await fs.mkdir(CONFIG_DIR, { recursive: true });

  const fileName = getConfigFileName(countries, outboundTag);
  const filePath = path.join(CONFIG_DIR, fileName);

  const configAlreadyExists = await fileExists(filePath);

  if (!configAlreadyExists) {
    const config = createRoutingConfig(countries, outboundTag);
    await fs.writeFile(filePath, JSON.stringify(config, null, 2));
  }

  const config = JSON.parse(await fs.readFile(filePath, "utf8"));

  return {
    countries,
    outboundTag,
    fileName,
    filePath,
    config,
    configGenerated: !configAlreadyExists,
    geoipGenerated: false,
    missingGeoipCountries: [],
  };
}