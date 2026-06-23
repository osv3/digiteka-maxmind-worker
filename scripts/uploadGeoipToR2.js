import "dotenv/config";
import { uploadGeoipFilesToR2 } from "../services/r2UploadService.js";

uploadGeoipFilesToR2().catch(error => {
  console.error("R2 upload failed:", error.message);
  process.exit(1);
});