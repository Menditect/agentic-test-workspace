#!/usr/bin/env node
/**
 * Menditect MTA IDE Hook Gatekeeper (v1.0.0)
 * Enforces physical PreToolUse and SessionStart governance across Antigravity,
 * Claude Code, and Cursor hooks by delegating to evaluateHookPayload() in mta-lint.mjs.
 */
import fs from "node:fs";
import { evaluateHookPayload, isMxcliDiscoveryCommand, probeStudioProMcpOnline } from "./mta-lint.mjs";

async function main() {
  let rawInput = "";
  try {
    rawInput = fs.readFileSync(0, "utf8");
  } catch {
    rawInput = "";
  }

  let payload = {};
  if (rawInput && rawInput.trim()) {
    try {
      payload = JSON.parse(rawInput);
    } catch {
      payload = {};
    }
  }

  const workspaceDir =
    (Array.isArray(payload.workspace_roots) && payload.workspace_roots[0]) ||
    (Array.isArray(payload.workspacePaths) && payload.workspacePaths[0]) ||
    payload.cwd ||
    process.cwd();

  let studioProOnline = false;
  if (isMxcliDiscoveryCommand(payload)) {
    studioProOnline = await probeStudioProMcpOnline(workspaceDir);
  }

  const decision = evaluateHookPayload(payload, { cwd: process.cwd(), studioProOnline });
  process.stdout.write(JSON.stringify(decision) + "\n");
}

main();
