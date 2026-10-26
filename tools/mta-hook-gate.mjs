#!/usr/bin/env node
/**
 * Menditect MTA IDE Hook Gatekeeper (v1.0.0)
 * Enforces physical PreToolUse and SessionStart governance across Antigravity,
 * Claude Code, and Cursor hooks by delegating to evaluateHookPayload() in mta-lint.mjs.
 */
import fs from "node:fs";
import { evaluateHookPayload } from "./mta-lint.mjs";

function main() {
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

  const decision = evaluateHookPayload(payload, { cwd: process.cwd() });
  process.stdout.write(JSON.stringify(decision) + "\n");
}

main();
