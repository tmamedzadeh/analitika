/** Short read-only deployment/worker status. Secrets remain in memory; URLs lose query strings. */
import { spawnSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
const phase = process.argv[2] ?? "before";
if (!/^[a-z-]+$/.test(phase)) throw new Error("Invalid receipt phase.");
const safeUrl = (value: unknown) => {
  if (typeof value !== "string") return undefined;
  try {
    const url = new URL(value);
    return url.origin + url.pathname;
  } catch {
    return undefined;
  }
};
async function get(url: string, token: string) {
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    signal: AbortSignal.timeout(15_000),
  });
  return { status: response.status, body: await response.json() };
}
const receipt: Record<string, unknown> = { checkedAt: new Date().toISOString(), phase };
try {
  const credential = spawnSync(
    "git",
    ["-c", "credential.interactive=never", "credential", "fill"],
    {
      input: "protocol=https\nhost=github.com\n\n",
      encoding: "utf8",
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GCM_INTERACTIVE: "Never" },
    },
  );
  const token = credential.stdout
    ?.split(/\r?\n/)
    .find((line) => line.startsWith("password="))
    ?.slice(9);
  if (token) {
    const base = "https://api.github.com/repos/tmamedzadeh/analitika/";
    const branch = await get(base + "branches/main", token);
    const sha = branch.body.commit?.sha;
    const combined = await get(base + `commits/${sha}/status`, token);
    const deployments = await get(base + "deployments?per_page=5", token);
    const deploymentResults = [];
    if (Array.isArray(deployments.body))
      for (const deployment of deployments.body) {
        const statuses = await get(
          base + `deployments/${deployment.id}/statuses?per_page=1`,
          token,
        );
        const latest = statuses.body[0];
        deploymentResults.push({
          id: deployment.id,
          sha: deployment.sha,
          environment: deployment.environment,
          createdAt: deployment.created_at,
          state: latest?.state,
          description: latest?.description,
          environmentUrl: safeUrl(latest?.environment_url),
          logUrl: safeUrl(latest?.log_url),
        });
      }
    receipt["github"] = {
      status: branch.status,
      sha,
      protected: branch.body.protected,
      state: combined.body.state,
      statuses: combined.body.statuses?.map((item: Record<string, unknown>) => ({
        context: item["context"],
        state: item["state"],
        description: item["description"],
        targetUrl: safeUrl(item["target_url"]),
      })),
      deploymentsStatus: deployments.status,
      deployments: deploymentResults,
    };
  }
  const key = process.env["INNGEST_SIGNING_KEY"];
  if (key) {
    const app = await get("https://api.inngest.com/v2/apps/analitika", key);
    const functions = await get("https://api.inngest.com/v2/apps/analitika/functions", key);
    const runs = await get("https://api.inngest.com/v2/runs?limit=20", key);
    const data = app.body.data;
    const activeRunsFrom = data?.createdAt ?? "2020-01-01T00:00:00.000Z";
    const active = await get(
      "https://api.inngest.com/v2/runs?appId=analitika&status=RUNNING&status=QUEUED&status=PAUSED&limit=100&from=" +
        encodeURIComponent(activeRunsFrom),
      key,
    );
    // Inngest omits optional data/hasMore fields for an empty successful page.
    const activePageValid =
      active.status === 200 &&
      active.body.page &&
      !active.body.errors &&
      (active.body.data === undefined || Array.isArray(active.body.data));
    receipt["inngest"] = {
      status: app.status,
      id: data?.id,
      functionCount: data?.functionCount,
      latestSync: data?.latestSync
        ? {
            status: data.latestSync.status,
            syncedAt: data.latestSync.syncedAt,
            url: safeUrl(data.latestSync.url),
          }
        : undefined,
      functionsStatus: functions.status,
      functions: functions.body.data?.map((item: Record<string, unknown>) => ({
        id: item["id"],
        name: item["name"],
      })),
      runsStatus: runs.status,
      activeRunsStatus: active.status,
      activeRunsFrom,
      activeRunsCount: activePageValid ? (active.body.data?.length ?? 0) : undefined,
      activeRunsHasMore: activePageValid ? active.body.page.hasMore === true : undefined,
      activeRuns: (activePageValid ? (active.body.data ?? []) : undefined)?.map(
        (item: Record<string, unknown>) => ({
          id: item["id"],
          status: item["status"],
          startedAt: item["startedAt"],
        }),
      ),
      runs: runs.body.data?.map((item: Record<string, unknown>) => ({
        id: item["id"],
        status: item["status"],
        startedAt: item["startedAt"],
        endedAt: item["endedAt"],
        function:
          item["function"] && typeof item["function"] === "object" && "id" in item["function"]
            ? item["function"].id
            : undefined,
      })),
    };
  }
  await writeFile(
    `docs/release/ZIRVE_FINAL_UX_RUNTIME_${phase.toUpperCase()}.json`,
    JSON.stringify(receipt, null, 2) + "\n",
  );
  console.log(JSON.stringify(receipt, null, 2));
} catch (error) {
  console.error(
    JSON.stringify({
      status: "unavailable",
      type: error instanceof Error ? error.name : "unknown",
    }),
  );
  process.exitCode = 1;
}
