import { cleanupE2ePaths } from "./runtime";

export default function globalTeardown() {
  const dataDir = process.env.PLAYWRIGHT_E2E_DATA_DIR;
  const distDir = process.env.PLAYWRIGHT_E2E_DIST_DIR;

  if (dataDir && distDir) {
    cleanupE2ePaths(process.cwd(), dataDir, distDir);
  }
}
