import { spawnSync } from "node:child_process";

const scriptPath = process.argv[2];

process.send?.({ type: "ready" });
process.once("message", (message) => {
  if (message !== "start") {
    process.exitCode = 2;
    return;
  }
  const result = spawnSync(
    process.execPath,
    [scriptPath, "migrate"],
    {
      cwd: process.cwd(),
      env: process.env,
    },
  );
  process.send?.({
    signal: result.signal,
    status: result.status,
    type: "result",
  });
});
