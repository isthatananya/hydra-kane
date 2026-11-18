/**
 * FR10: MCP server exposing Hydra to coding agents over stdio.
 *   hydra_verify  — run Kane on the configured (or given) flows against the app; returns verdict + evidence
 *   hydra_ledger  — recent runs and detection metrics
 * Register with: claude mcp add hydra -- npx hydra mcp
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { stateDir, type HydraConfig } from "./config.js";
import { aggregate, listRuns } from "./ledger.js";
import { setQuiet } from "./util/log.js";
import { formatReport, verify } from "./verify.js";

export async function startMcp(cfg: HydraConfig, version: string): Promise<void> {
  setQuiet(true); // stdout belongs to the MCP protocol
  const server = new McpServer({ name: "hydra", version });

  server.registerTool(
    "hydra_verify",
    {
      title: "Verify the app with Kane CLI",
      description:
        "Runs Kane CLI in a real headless browser against the running app and returns pass/fail with Kane's evidence " +
        "(summary, failing step, ShareLink, local video path). Call this before claiming a web change is done; " +
        "if it fails, fix the root cause and call it again. Never edit the spec files to make it pass.",
      inputSchema: {
        url: z.string().url().optional().describe("App URL (defaults to the configured app URL)"),
        specs: z.array(z.string()).optional().describe("Spec files to run (defaults to verify.specs in hydra.config.json)"),
      },
    },
    async ({ url, specs }) => {
      try {
        const report = await verify(cfg, { url, specs });
        return {
          content: [{ type: "text" as const, text: `${formatReport(report)}\n\n${JSON.stringify(report, null, 2)}` }],
          isError: report.outcome === "error",
        };
      } catch (err) {
        return { content: [{ type: "text" as const, text: `hydra_verify failed: ${(err as Error).message}` }], isError: true };
      }
    },
  );

  server.registerTool(
    "hydra_ledger",
    {
      title: "Hydra ledger",
      description: "Recent Hydra loop runs (bug injected, Kane verdict, heal rounds, deploy status) and aggregate detection metrics.",
      inputSchema: { limit: z.number().int().min(1).max(100).optional() },
    },
    async ({ limit }) => {
      const runs = listRuns(stateDir(cfg));
      const recent = runs.slice(0, limit ?? 10).map((r) => ({
        runId: r.runId,
        seed: r.seed,
        builder: r.builder,
        bug: r.bug?.id ?? null,
        verdict: r.referee?.verdict ?? null,
        status: r.status,
        rounds: r.rounds.length,
        reason: r.statusReason,
      }));
      return { content: [{ type: "text" as const, text: JSON.stringify({ stats: aggregate(runs), recent }, null, 2) }] };
    },
  );

  await server.connect(new StdioServerTransport());
}
