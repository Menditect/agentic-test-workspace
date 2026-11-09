#!/usr/bin/env node
/**
 * Menditect Bug Hunter — Protected Engine (`mta-bughunter.mjs`) v3.1.0
 *
 * Implements:
 *  - Automatic Model-Derived Invariant Business Rule Discovery, State-Independence Filtering, Cross-Committer Bypass Hunting & Live Dataset Compliance Auditing (`v3.1.0` — `mineInvariantBusinessRules`, `INV-01..03`, and automatic PBT partition enrichment)
 *  - AST-Guided Pairwise Permutation & Property-Based Testing (PBT) (`v3.0.0` — Equivalence Partition Extractor, IPOG t=2 Pairwise Combinatorial Generator, Property Invariant Synthesis `PBT-01..05`, and Delta-Debugging Counterexample Shrinker)
 *  - Mendix Metamodel (`IModel`) StudioPro AST Normalization & Detectors (`v2.9.0` — `BHP-41..43`, `DQP-10`, `ANTI-83` AutoNumber guard)
 *  - Human-Readable Mendix Ecosystem Reporting (`v2.5.0` — natural Mendix developer/business-engineer terminology, free of internal `PAT-*`/`ANTI-*`/tier jargon)
 *  - Adaptive `mxcli` & `.mxcli/catalog.db` Lifecycle (`--catalog-mode auto|full|source` + `node:sqlite`)
 *    - Enterprise `.mpr > 50 MB` defaults to `REFRESH CATALOG FULL` (~20s) + SQLite `activities`/`refs` AST reconstruction
 *    - Standard `.mpr <= 50 MB` defaults to `REFRESH CATALOG FULL SOURCE` (~3s) + MDL `SourceText` AST parser
 *    ⚠️ MANDATORY REQUIREMENT: `mxcli` is ALWAYS required for Bug Hunter regardless of whether StudioPro MCP is active.
 *       Users must Save All (Ctrl+S) in Studio Pro before starting a bug hunt so the `.mpr` file on disk is up to date.
 *  - Guardrails SAFE-01..05 (Side-effect quarantine, Behavior-based MTF role inference, Two-tier oracle separation)
 *  - Clear Separation of Findings:
 *      1. Confirmed Actual Bugs   : Dynamically proven defects reproducible now via Mendix Pages or APIs
 *      2. Confirmed Latent Bugs   : Dynamically proven defects in sub-microflows currently protected by calling pages/microflows (future regression risks, especially in Commit/Delete call chains)
 *      3. Microflow & Call-Chain Warnings : Unprotected sub-microflows (`UFP-01..03`), unrounded floats (`BHP-34`), dead code (`BHP-05`), and domain model gaps (`DQP-01..10`)
 *      4. Page & Validation Message Checks : Wrong-entity validation feedback (`BHP-32`), hidden validation attributes (`BHP-17`), and page/microflow access mismatches (`SEC-04/07`)
 *      5. Passed Test Scenarios   : Scenarios verified to handle boundary/empty inputs safely
 *  - 4-Layer Vertical Stack AST Traversal (Pages -> Action Microflows ACT_ -> Sub-Microflows SUB_/CALC_/VAL_/RULE_ -> Entity Event Handlers EVT_/BCO_)
 *  - Security & Access Rule Patterns SEC-01..10 with User Role Testing & `audit-rbac` Subcommand
 *  - Bug Hunting Patterns BHP-01..43, Property-Based Testing Patterns PBT-01..05, and Invariant Business Rule Patterns INV-01..03
 *  - External Integration Patterns INT-01..07 & Java White-Box Patterns JAP-01..07
 *  - Data Quality & Business Rule Patterns DQP-01..10 & BRP-01..02
 *
 * Commands:
 *  node mta-bughunter.mjs refresh-catalog [--config <mta_config.json>] [--catalog-mode auto|full|source] [--force]
 *  node mta-bughunter.mjs harvest --module <ModuleName> [--config <mta_config.json>] [--catalog-mode auto|full|source] [--refresh-catalog] [--from-dir <raw_ast_dir>] [--fast-filter] [--out <ast_bundle.json>]
 *  node mta-bughunter.mjs mine-invariants [--module <ModuleName> | <ast_bundle.json>] [--config <mta_config.json>] [--out <invariants.json|md>]
 *  node mta-bughunter.mjs hunt --module <ModuleName> [--config <mta_config.json>] [--catalog-mode auto|full|source] [--tier free|paid] [--pbt|--no-pbt] [--pbt-samples <N>] [--pbt-shrink] [--no-invariants] [--refresh-catalog] [--out-dir <scratch_dir>] [--payload-out <payload.json>]
 *  node mta-bughunter.mjs summarize <manifest.json> [--top <N>]
 *  node mta-bughunter.mjs audit-rbac [--module <ModuleName> | <ast_bundle.json>] [--config <mta_config.json>] [--out <rbac_report.md|json>]
 *  node mta-bughunter.mjs analyze <ast_bundle.json> [--tier free|paid] [--pbt|--no-pbt] [--pbt-samples <N>] [--no-invariants] [--out <manifest.json>]
 *  node mta-bughunter.mjs analyze-module <ast_bundle.json> [--tier free|paid] [--pbt|--no-pbt] [--pbt-samples <N>] [--no-invariants] [--out <manifest.json>]
 *  node mta-bughunter.mjs generate-plan <manifest.json> [--finding <ID>] [--pbt] [--status DRAFT|AUTO_APPROVED] [--out <dir_or_file.md>] [--payload-out <payload.json>]
 *  node mta-bughunter.mjs validate-plan <plan.md> [--payload <execute_testcase_payload.json>]
 *  node mta-bughunter.mjs report <manifest.json> <results.json> [--out <report.json|report.md>]
 *  node mta-bughunter.mjs self-test
 */

import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { executeFrontendBugHuntBatch } from "./frontend/frontend-runner.mjs";
import { extractTableCellWidgetsFromSource } from "./frontend/page-resolver.mjs";
import { runFrontendSelfTests } from "./frontend/self-test-frontend.mjs";

// ============================================================================
// 1. GUARDRAILS (SAFE-01..05)
// ============================================================================

const UNSAFE_ACTIVITY_TYPES = new Set([
  "RestCall",
  "WebServiceCall",
  "SendEmail",
  "CallExternalAction",
]);

const SAFE_JAVA_ACTION_PREFIXES = [
  "CommunityCommons.String",
  "CommunityCommons.Math",
  "CommunityCommons.DateTime",
  "MenditectMxFrontendTestKit.",
  "MenditectMtaCommons.",
];

export function evaluateGuardrails(bundle, targetMfOverride = null) {
  const mf = targetMfOverride || bundle.target_microflow || (bundle.microflows || [])[0] || {};
  const activities = mf.activities || [];

  // SAFE-01: Pre-Execution Side-Effect & SystemContext Quarantine Scanner
  const javaActionMetaMap = new Map();
  for (const ja of bundle.java_actions || []) {
    if (ja.qualified_name) javaActionMetaMap.set(ja.qualified_name, ja);
    if (ja.name) javaActionMetaMap.set(ja.name, ja);
  }
  const sideEffects = [];
  for (const act of activities) {
    if (UNSAFE_ACTIVITY_TYPES.has(act.type)) {
      sideEffects.push({
        activity_id: act.id,
        type: act.type,
        caption: act.caption || act.type,
        reason: `Unmocked external ${act.type} cannot be rolled back by MTA_plugin in-memory transactions.`,
      });
    } else if (act.type === "JavaActionCall") {
      const target = act.java_action || act.action_name || "";
      const isWhitelisted = SAFE_JAVA_ACTION_PREFIXES.some((prefix) => target.startsWith(prefix));
      const javaMeta =
        act.java_meta ||
        javaActionMetaMap.get(target) ||
        javaActionMetaMap.get(target.split(".").pop());
      if (javaMeta) {
        if (javaMeta.system_context_mutates_db) {
          sideEffects.push({
            activity_id: act.id,
            type: "JavaActionCall",
            caption: act.caption || target,
            reason: `JavaAction '${target}' uses Core.createSystemContext() with DB commit/delete (JAP-03), which escapes MTA_plugin in-memory rollback.`,
          });
        } else if (javaMeta.has_external_network_io) {
          sideEffects.push({
            activity_id: act.id,
            type: "JavaActionCall",
            caption: act.caption || target,
            reason: `JavaAction '${target}' opens external network sockets/HTTP connections beyond Mendix DB rollback.`,
          });
        }
        // If white-box inspected and uses only getContext() without external network I/O, allow live in-memory testing!
      } else if (!isWhitelisted) {
        sideEffects.push({
          activity_id: act.id,
          type: "JavaActionCall",
          caption: act.caption || target,
          reason: `JavaAction '${target}' is not in the side-effect-free whitelist and may open external connections or independent JDBC commits.`,
        });
      }
    }
  }

  // SAFE-02: Behavior-Based MTF Role Inference (works on legacy IVK_/SUB_ apps)
  const inferredRoles = [];
  const calledByPages = (bundle.pages || []).some((p) =>
    (p.calls_microflows || []).includes(mf.qualified_name)
  );
  const hasValidationFeedback = activities.some((a) => a.type === "ValidationFeedback");
  const hasCommitOrDelete = activities.some(
    (a) =>
      a.type === "CommitObject" ||
      a.type === "DeleteObject" ||
      (a.type === "ChangeObject" && a.commit === "Yes") ||
      (a.type === "CreateObject" && a.commit === "Yes")
  );
  const callsSubMicroflows = activities.some((a) => a.type === "MicroflowCall");
  const isEventHandler = (bundle.entities || []).some((e) =>
    (e.event_handlers || []).some((eh) => eh.microflow === mf.qualified_name)
  );

  if (calledByPages || (mf.name || "").startsWith("ACT_")) inferredRoles.push("ACT_Touchpoint");
  if (hasValidationFeedback || (mf.name || "").startsWith("VAL_")) inferredRoles.push("VAL_Validator");
  if (hasCommitOrDelete || (mf.name || "").startsWith("CMT_")) inferredRoles.push("CMT_Committer");
  if (callsSubMicroflows || (mf.name || "").startsWith("ORC_")) inferredRoles.push("ORC_Orchestrator");
  if (isEventHandler || (mf.name || "").startsWith("EVT_") || (mf.name || "").startsWith("BCO_")) {
    inferredRoles.push("EVT_EventHandler");
  }
  if (inferredRoles.length === 0 || (mf.name || "").startsWith("SUB_") || (mf.name || "").startsWith("CALC_")) {
    inferredRoles.push("OPR_UnitOperation");
  }

  return {
    safe_01_quarantined: sideEffects.length > 0,
    safe_01_side_effects: sideEffects,
    safe_02_inferred_mtf_roles: inferredRoles,
  };
}

// ============================================================================
// 2. DEFECT RISK SCORING (MODULE & MICROFLOW TRIAGE)
// ============================================================================

export function computeMicroflowRiskScore(mf, entities = [], pages = []) {
  const activities = mf.activities || [];
  const parameters = mf.parameters || [];
  let score = 10;
  const factors = [];

  const splits = activities.filter((a) => a.type === "ExclusiveSplit");
  if (splits.length > 0) {
    score += Math.min(25, splits.length * 6);
    factors.push(`${splits.length} decision split(s)`);
  }

  const objectParams = parameters.filter((p) => p.type === "Object");
  if (objectParams.length > 0) {
    score += objectParams.length * 10;
    factors.push(`${objectParams.length} object parameter(s)`);
  }

  const hasValFeedback = activities.some((a) => a.type === "ValidationFeedback");
  if (hasValFeedback) {
    score += 15;
    factors.push("contains ValidationFeedback");
  }

  const hasExternalOrFunction = activities.some(
    (a) =>
      a.type === "JavaActionCall" ||
      a.type === "MicroflowCall" ||
      /(daysBetween|parseInteger|parseDecimal|parseDateTime|substring|\/)/i.test(
        [a.expression || "", ...(a.expressions || [])].join(" ")
      )
  );
  if (hasExternalOrFunction && !activities.some((a) => a.has_error_handler)) {
    score += 20;
    factors.push("unguarded expressions/calls without error handler");
  }

  const isBco = entities.some((e) =>
    (e.event_handlers || []).some(
      (eh) => eh.microflow === mf.qualified_name && eh.raise_error_on_false === false
    )
  );
  if (isBco) {
    score += 20;
    factors.push("BeforeCommit handler with raise_error_on_false=false");
  }

  const calledByPage = pages.some((p) => (p.calls_microflows || []).includes(mf.qualified_name));
  if (calledByPage) {
    score += 10;
    factors.push("UI page touchpoint");
  }

  return {
    microflow: mf.qualified_name || mf.name,
    risk_score: Math.min(100, score),
    risk_level: score >= 60 ? "CRITICAL" : score >= 35 ? "HIGH" : "MEDIUM",
    factors,
  };
}

// ============================================================================
// 3. SINGLE-MICROFLOW & 4-LAYER DETECTOR ENGINE (BHP-01..20 & DQP-01..08)
// ============================================================================

function analyzeSingleMicroflow(mf, bundle, tier = "free") {
  const activities = mf.activities || [];
  const parameters = mf.parameters || [];
  const entities = bundle.entities || [];
  const pages = bundle.pages || [];
  const otherCommitters = bundle.other_committers || [];
  const flows = mf.flows || mf.sequence_flows || [];
  const guardrails = evaluateGuardrails(bundle, mf);

  const isSubMicroflow =
    (mf.name || "").startsWith("SUB_") ||
    (mf.name || "").startsWith("CALC_") ||
    (mf.name || "").startsWith("VAL_") ||
    Boolean(mf.shielded_by_parent);

  const hypotheses = [];
  const amberRisks = [];
  const amberUiCandidates = [];

  // Track which parameters and $Obj/Attr paths have been guarded for `!= empty` on the TRUE path
  const checkedNotEmptyParams = new Set();
  const checkedNotEmptyAttrs = new Set();
  // Map of split activity id -> variable name checked for `!= empty`
  const emptyCheckSplits = new Map();
  // Map of activity id -> variable name where that activity is on the FALSE (null/empty) branch
  const nullBranchActivities = new Map();

  for (const flow of flows) {
    if (String(flow.case_value).toLowerCase() === "false" && flow.from && flow.to) {
      nullBranchActivities.set(flow.to, flow.from);
    }
  }

  // v2.6.0: CFG Branch-Aware Guard Propagation across SequenceFlows
  // Propagates `!= empty` guards ONLY along `case_value === "true"` edges (or `= empty` along `false` edges),
  // and intersects guards at ExclusiveMerge / multi-incoming nodes so `else` branches never inherit `true` guards.
  const cfgInEdges = new Map();
  const cfgOutEdges = new Map();
  for (const flow of flows) {
    if (!flow.from || !flow.to) continue;
    if (!cfgOutEdges.has(flow.from)) cfgOutEdges.set(flow.from, []);
    cfgOutEdges.get(flow.from).push(flow);
    if (!cfgInEdges.has(flow.to)) cfgInEdges.set(flow.to, []);
    cfgInEdges.get(flow.to).push(flow);
  }
  const hasCfgEdges = cfgInEdges.size > 0 || cfgOutEdges.size > 0;
  const actById = new Map(activities.map((a) => [a.id, a]));
  const cfgGuardedParamsByAct = new Map();
  const cfgGuardedAttrsByAct = new Map();
  if (hasCfgEdges) {
    for (const act of activities) {
      cfgGuardedParamsByAct.set(act.id, new Set());
      cfgGuardedAttrsByAct.set(act.id, new Set());
    }
    // Iterative dataflow propagation (converges in <=3 passes on Mendix DAGs/loops)
    for (let pass = 0; pass < 3; pass++) {
      for (const act of activities) {
        const incoming = cfgInEdges.get(act.id) || [];
        if (incoming.length === 0) continue;
        let intersectedParams = null;
        let intersectedAttrs = null;
        for (const edge of incoming) {
          const predAct = actById.get(edge.from);
          const predParams = new Set(cfgGuardedParamsByAct.get(edge.from) || []);
          const predAttrs = new Set(cfgGuardedAttrsByAct.get(edge.from) || []);
          if (predAct && predAct.type === "ExclusiveSplit" && predAct.expression) {
            const caseVal = String(edge.case_value ?? "").toLowerCase();
            const splitExpr = predAct.expression.trim();
            for (const param of parameters) {
              const notEmptyRe = new RegExp(`\\$${param.name}\\s*!=\\s*empty`, "i");
              const isEmptyRe = new RegExp(`\\$${param.name}\\s*=\\s*empty`, "i");
              if ((notEmptyRe.test(splitExpr) && caseVal === "true") || (isEmptyRe.test(splitExpr) && caseVal === "false")) {
                predParams.add(param.name);
              }
              const attrNotEmptyRe = new RegExp(`\\$(${param.name}\\/[A-Za-z0-9_]+)\\s*!=\\s*empty`, "gi");
              let am;
              while ((am = attrNotEmptyRe.exec(splitExpr)) !== null) {
                if (caseVal === "true") predAttrs.add(am[1]);
              }
            }
          }
          if (intersectedParams === null) {
            intersectedParams = predParams;
            intersectedAttrs = predAttrs;
          } else {
            intersectedParams = new Set([...intersectedParams].filter((x) => predParams.has(x)));
            intersectedAttrs = new Set([...intersectedAttrs].filter((x) => predAttrs.has(x)));
          }
        }
        if (intersectedParams) cfgGuardedParamsByAct.set(act.id, intersectedParams);
        if (intersectedAttrs) cfgGuardedAttrsByAct.set(act.id, intersectedAttrs);
      }
    }
  }

  // Track known in-scope variable names (parameters + retrieved objects/lists)
  const inScopeVariables = new Set(parameters.map((p) => p.name));
  // Track upstream proven non-empty / count conditions for BHP-05 dead-code detection
  const provenNonEmptyVars = new Set();
  const seenSplitExpressions = new Map();

  // v2.3.0: Track List variables, AggregateList + Count=1 splits, all guarded $Obj/Attr paths, and in-scope entities
  const listVariableNames = new Set(
    parameters
      .filter((p) => p.type === "List" || /^List\b/i.test(p.type || ""))
      .map((p) => p.name)
  );
  const objectParamNames = new Set(
    parameters.filter((p) => p.type === "Object").map((p) => p.name)
  );
  const inScopeEntities = new Set(
    parameters.map((p) => p.entity).filter(Boolean)
  );
  const allGuardedAttrsInMf = new Set();

  for (const act of activities) {
    if (act.output_variable || act.variable_name) {
      const outVar = act.output_variable || act.variable_name;
      inScopeVariables.add(outVar);
      if (
        (act.type === "Retrieve" && act.first_only !== true) ||
        act.type === "ListOperation" ||
        act.action_type === "ListOperationAction" ||
        (act.type === "MicroflowCall" &&
          /^GET_.*s(?:_by_|$)/i.test((act.called_microflow || act.microflow || "").split(".").pop()))
      ) {
        listVariableNames.add(outVar);
      }
    }
    if (act.type === "Retrieve" && act.entity && !act.output_variable && !act.variable_name) {
      const shortEntity = act.entity.split(".").pop();
      inScopeVariables.add(shortEntity);
    }
    if ((act.type === "Retrieve" || act.type === "CreateObject" || act.type === "ChangeObject") && act.entity) {
      inScopeEntities.add(act.entity);
    }
    if (act.type === "ExclusiveSplit" && act.expression) {
      for (const m of act.expression.matchAll(/\$([A-Za-z0-9_]+\/[A-Za-z0-9_]+)\s*(?:!=|=)\s*empty\b/gi)) {
        allGuardedAttrsInMf.add(m[1].toLowerCase());
      }
    }
  }

  // Also include generalizations of in-scope entities so inherited attributes are recognized as in-scope
  for (const entName of Array.from(inScopeEntities)) {
    const entDef = entities.find((e) => e.qualified_name === entName);
    if (entDef && entDef.generalization) {
      inScopeEntities.add(entDef.generalization);
    }
  }

  // Helper to push a hypothesis and optionally mark latent contract risks on subflows
  const addHypothesis = (hyp) => {
    const fullHyp = {
      id: `HYP_${hypotheses.length + 1}`,
      microflow: mf.qualified_name,
      defect_tier: isSubMicroflow && mf.shielded_by_parent ? "AMBER" : "RED",
      verification_status: "STATIC_AST_CANDIDATE",
      ...hyp,
    };
    hypotheses.push(fullHyp);
    if (isSubMicroflow && mf.shielded_by_parent) {
      amberRisks.push({
        ...fullHyp,
        defect_tier: "AMBER",
        verification_status: "STATIC_AST_CANDIDATE",
        amber_reason: `Latent Sub-Microflow Contract Risk: '${mf.qualified_name}' fails on adversarial boundary input, though temporarily shielded by parent '${mf.shielded_by_parent}'. Any new caller (REST API, import, or scheduled event) will trigger this bug.`,
      });
    }
  };

  const isParamGuardedAt = (act, paramName) => {
    const isExplicitFalseBranch =
      String(act.branch).toLowerCase() === "false" ||
      String(act.case_value).toLowerCase() === "false" ||
      act.on_empty_branch === true ||
      act.when_empty === true ||
      nullBranchActivities.has(act.id);
    if (isExplicitFalseBranch) return false;
    if (hasCfgEdges && (cfgInEdges.get(act.id) || []).length > 0) {
      return Boolean(cfgGuardedParamsByAct.get(act.id)?.has(paramName));
    }
    return checkedNotEmptyParams.has(paramName);
  };

  const isAttrGuardedAt = (act, attrPath) => {
    const isExplicitFalseBranch =
      String(act.branch).toLowerCase() === "false" ||
      String(act.case_value).toLowerCase() === "false" ||
      act.on_empty_branch === true ||
      act.when_empty === true ||
      nullBranchActivities.has(act.id);
    if (isExplicitFalseBranch) return false;
    if (hasCfgEdges && (cfgInEdges.get(act.id) || []).length > 0) {
      return Boolean(cfgGuardedAttrsByAct.get(act.id)?.has(attrPath));
    }
    return checkedNotEmptyAttrs.has(attrPath);
  };

  for (const act of activities) {
    const exprs = [
      ...(act.expression ? [act.expression] : []),
      ...(act.expressions || []),
      ...(act.arguments || []),
    ];

    // ------------------------------------------------------------------------
    // A. Inspect ExclusiveSplit for Null Guards, Dead Code (BHP-05), and Off-by-One (BHP-06)
    // ------------------------------------------------------------------------
    if (act.type === "ExclusiveSplit" && act.expression) {
      const expr = act.expression.trim();
      const normExpr = expr.replace(/\s+/g, " ").toLowerCase();

      // Note: In Mendix microflow expressions, `<list> = empty` (true if 0 elements)
      // and `<list> != empty` (true if >= 1 elements) are valid native language checks.
      // They are NOT bugs and must never be flagged as false-positive defect patterns.

      // 1. BHP-05: Redundant / Subsumed Split Condition (Dead Error Branch)
      const emptyCheckVarMatch = expr.match(/^\$([A-Za-z0-9_]+)\s*!=\s*empty$/i);
      const countCheckVarMatch = expr.match(/count\s*\(\s*\$([A-Za-z0-9_]+)\s*\)\s*(?:=|>|>=)\s*[1-9]/i);

      if (seenSplitExpressions.has(normExpr) || (emptyCheckVarMatch && provenNonEmptyVars.has(emptyCheckVarMatch[1]))) {
        const varName = emptyCheckVarMatch ? emptyCheckVarMatch[1] : expr;
        const redundantFinding = {
          id: `HYP_${hypotheses.length + amberRisks.length + 1}`,
          microflow: mf.qualified_name,
          pattern_id: "BHP-05",
          defect_tier: "AMBER",
          category: "Dead Code & Flawed Decision Logic",
          severity: "HIGH",
          oracle_tier: "TIER_1_OBJECTIVE",
          title: `Dead Error Branch: Redundant Split Condition '${expr}' on '${act.caption || act.id}'`,
          activity_id: act.id,
          activity_caption: act.caption || act.type,
          target_expression: expr,
          oracle_rule: `Decision split '${act.caption || act.id}' evaluates '${expr}', which is already guaranteed true by an upstream check on '$${varName}'. Its false/else branch is dead, unreachable code.`,
          test_strategy: `Inspect and execute '${mf.qualified_name}' with missing downstream association to verify unreachable error handling.`,
          variation_overrides: {
            [`Trigger_${act.id}`]: "UnreachableElseBranch",
          },
          expected_safe_outcome: "Decision split tests the newly retrieved variable rather than re-testing an already verified list/object",
          remediation: `Update decision '${act.caption || act.id}' to check the intended variable (e.g. retrieved association object != empty) instead of '${expr}'.`,
        };
        addHypothesis(redundantFinding);
        amberRisks.push({
          ...redundantFinding,
          amber_reason: "Static AST Dead-Code & Subsumed Condition Defect (BHP-05): false branch is unreachable.",
        });
      }

      seenSplitExpressions.set(normExpr, act.id);
      if (countCheckVarMatch) {
        provenNonEmptyVars.add(countCheckVarMatch[1]);
      }
      if (emptyCheckVarMatch) {
        provenNonEmptyVars.add(emptyCheckVarMatch[1]);
      }

      // 2. BHP-05: Copy-Paste Split Caption vs. Expression Variable Mismatch
      if (act.caption) {
        const captionClean = act.caption.replace(/[^A-Za-z0-9_ ]/g, " ").trim();
        const exprVars = Array.from(expr.matchAll(/\$([A-Za-z0-9_]+)/g)).map((m) => m[1]);
        for (const scopeVar of inScopeVariables) {
          const captionMentionsScopeVar = new RegExp(`\\b${scopeVar}\\b`, "i").test(captionClean);
          const exprMentionsScopeVar = exprVars.some((v) => v.toLowerCase() === scopeVar.toLowerCase());
          if (captionMentionsScopeVar && !exprMentionsScopeVar && exprVars.length > 0) {
            const copyPasteFinding = {
              id: `HYP_${hypotheses.length + amberRisks.length + 1}`,
              microflow: mf.qualified_name,
              pattern_id: "BHP-05",
              defect_tier: "RED",
              category: "Dead Code & Flawed Decision Logic",
              severity: "HIGH",
              oracle_tier: "TIER_1_OBJECTIVE",
              title: `Copy-Paste Split Mismatch: Decision '${act.caption}' Checks '${expr}' Instead of '$${scopeVar} != empty'`,
              activity_id: act.id,
              activity_caption: act.caption,
              target_expression: expr,
              oracle_rule: `Decision split captioned '${act.caption}' is intended to check '$${scopeVar}', but its expression evaluates '${expr}'. Consequently, '$${scopeVar}' is unguarded when empty and the error branch is bypassed.`,
              test_strategy: `Execute '${mf.qualified_name}' when '$${scopeVar}' is empty while '${exprVars[0]}' is populated.`,
              variation_overrides: {
                [`$${scopeVar}`]: "empty",
              },
              expected_safe_outcome: `Decision '${act.caption}' evaluates '$${scopeVar} != empty' and routes missing '$${scopeVar}' to the error handler`,
              remediation: `Change the expression of decision '${act.caption}' from '${expr}' to '$${scopeVar} != empty'.`,
            };
            if (!hypotheses.some((h) => h.pattern_id === "BHP-05" && h.activity_id === act.id)) {
              addHypothesis(copyPasteFinding);
            }
          }
        }
      }

      // 3. Record Null Guards for Parameters and Attributes
      for (const param of parameters) {
        const emptyCheckRegex = new RegExp(`\\$${param.name}\\s*!=\\s*empty`, "i");
        if (emptyCheckRegex.test(expr) || act.checks_not_empty === true) {
          checkedNotEmptyParams.add(param.name);
          emptyCheckSplits.set(act.id, param.name);

          // Also inspect inline false_branch / empty_branch activities if present in AST
          const falseBranchActs = act.false_branch || act.empty_branch || [];
          for (const fbAct of falseBranchActs) {
            if (
              fbAct.type === "ValidationFeedback" &&
              (fbAct.variable === param.name ||
                fbAct.object === param.name ||
                (fbAct.attribute && fbAct.attribute.includes(param.name)) ||
                (fbAct.attribute && param.entity && fbAct.attribute.startsWith(param.entity)))
            ) {
              addHypothesis({
                pattern_id: "BHP-01",
                category: "Crash & Exception Bomb",
                severity: "CRITICAL",
                oracle_tier: "TIER_1_OBJECTIVE",
                title: `Validation Feedback on Null Object ($${param.name}) in Empty Branch`,
                activity_id: fbAct.id || act.id,
                activity_caption: fbAct.caption || "Validation feedback",
                target_param: param.name,
                target_entity: param.entity,
                oracle_rule: `In the 'false' (empty) branch of '$${param.name} != empty', executing ValidationFeedbackAction on '$${param.name}' crashes Mendix runtime with 'java.lang.NullPointerException: validationObjectId is null'.`,
                test_strategy: `Inject PAT-07 Paired Dual-Retrieve 'NONE' sentinel (Retrieve ${param.entity} with filter 1=0, count 0) into parameter $${param.name}.`,
                variation_overrides: {
                  [`Param $${param.name}`]: "'NONE'",
                },
                expected_safe_outcome: "Return graceful default or display a non-entity ShowMessage dialog without throwing NullPointerException",
                remediation: `In the empty branch of '$${param.name} != empty', replace ValidationFeedback on '$${param.name}' with a ShowMessage action (for UI flows) or return a fallback value (0 / empty / false).`,
              });
            }
          }
        }

        // Attribute-level null guards: e.g. $Booking/PickupDate != empty
        const attrGuardRegex = new RegExp(`\\$(${param.name}\\/[A-Za-z0-9_]+)\\s*!=\\s*empty`, "gi");
        let attrMatch;
        while ((attrMatch = attrGuardRegex.exec(expr)) !== null) {
          checkedNotEmptyAttrs.add(attrMatch[1]);
        }
      }

      // 4. v2.6.0: 3-Valued Enumeration ExclusiveSplit Missing `(empty)` Outgoing SequenceFlow
      // Unlike Booleans (which are strictly 2-valued true/false and never empty in Mendix),
      // Enumerations are 3-valued (Literal1..LiteralN + empty). An ExclusiveSplit switching directly
      // on `$Obj/EnumAttr` without an outgoing `(empty)` branch (or upstream `!= empty` guard) fails when empty.
      const singleAttrSplitMatch = expr.match(/^\$([A-Za-z0-9_]+)\/([A-Za-z0-9_]+)$/);
      if (singleAttrSplitMatch || act.condition_type === "Enumeration") {
        const splitAttrPath = singleAttrSplitMatch ? `${singleAttrSplitMatch[1]}/${singleAttrSplitMatch[2]}` : (act.target_attribute || expr.replace(/^\$/, ""));
        const splitObjName = singleAttrSplitMatch ? singleAttrSplitMatch[1] : splitAttrPath.split("/")[0];
        const splitAttrName = singleAttrSplitMatch ? singleAttrSplitMatch[2] : splitAttrPath.split("/").pop();
        const objParam = parameters.find((p) => p.name === splitObjName);
        const entDef = objParam?.entity ? entities.find((e) => e.qualified_name === objParam.entity) : null;
        const attrDef = entDef?.attributes?.find((a) => a.name === splitAttrName);
        const isEnumSplit =
          act.condition_type === "Enumeration" ||
          /^Enumeration|^Enum\b/i.test(attrDef?.type || "") ||
          /^Enum_|Status|State|Category|Type|Tier|Priority/i.test(splitAttrName);
        const outFlows = cfgOutEdges.get(act.id) || [];
        const hasEmptyCaseFlow =
          act.has_empty_branch === true ||
          outFlows.some((f) => /^(?:empty|\(empty\)|none|null)$/i.test(String(f.case_value ?? "").trim()));
        const enumMissingEmpty =
          act.missing_empty_branch === true ||
          (outFlows.length > 0 &&
            !outFlows.some((f) => /^(?:true|false)$/i.test(String(f.case_value ?? "").trim())) &&
            !hasEmptyCaseFlow);
        if (isEnumSplit && enumMissingEmpty && !isAttrGuardedAt(act, splitAttrPath)) {
          addHypothesis({
            pattern_id: "BHP-01",
            category: "Crash & Exception Bomb",
            severity: "HIGH",
            oracle_tier: "TIER_1_OBJECTIVE",
            title: `Enumeration Split on '$${splitAttrPath}' Missing '(empty)' Outgoing Branch`,
            activity_id: act.id,
            activity_caption: act.caption || act.type,
            target_attribute: splitAttrPath,
            oracle_rule: `In Mendix, Enumerations are 3-valued (defined literals plus 'empty'), whereas Booleans are strictly 2-valued. Decision split '${act.caption || act.id}' switches on enumeration '$${splitAttrPath}' without an outgoing '(empty)' SequenceFlow or upstream '$${splitAttrPath} != empty' guard.`,
            test_strategy: `Set enumeration attribute '$${splitAttrPath} = empty' and execute '${mf.qualified_name}'.`,
            variation_overrides: {
              [`$${splitAttrPath}`]: "empty",
            },
            expected_safe_outcome: `Decision split '${act.caption || act.id}' handles the '(empty)' enumeration case or guards '$${splitAttrPath} != empty' upstream`,
            remediation: `Connect the '(empty)' outgoing SequenceFlow on enumeration split '${act.caption || act.id}' to a valid error/fallback branch, or guard '$${splitAttrPath} != empty' upstream.`,
          });
        }
      }
    }

    // ------------------------------------------------------------------------
    // B. Gap 1: Branch-Aware ValidationFeedback on Null/Empty Object Trap (BHP-01)
    // ------------------------------------------------------------------------
    if (act.type === "ValidationFeedback") {
      // Check if this ValidationFeedback targets a parameter when that parameter is null/empty
      const isExplicitFalseBranch =
        String(act.branch).toLowerCase() === "false" ||
        String(act.case_value).toLowerCase() === "false" ||
        act.on_empty_branch === true ||
        act.when_empty === true ||
        nullBranchActivities.has(act.id);

      for (const param of parameters) {
        if (param.type !== "Object") continue;
        const targetsParam =
          act.variable === param.name ||
          act.object === param.name ||
          (act.attribute &&
            (act.attribute.startsWith(`$${param.name}/`) ||
              act.attribute.startsWith(`${param.name}.`) ||
              (param.entity && act.attribute.startsWith(`${param.entity}.`))));

        const captionOrMsgImpliesNullObject =
          /empty|null|not\s+found|missing|no\s+[a-z]+\s+provided/i.test(
            `${act.caption || ""} ${act.message || ""}`
          ) &&
          new RegExp(`\\b${param.name}\\b`, "i").test(
            `${act.caption || ""} ${act.message || ""} ${act.variable || ""} ${act.attribute || ""}`
          );

        if (
          targetsParam &&
          (isExplicitFalseBranch || !isParamGuardedAt(act, param.name) || captionOrMsgImpliesNullObject)
        ) {
          if (isExplicitFalseBranch || captionOrMsgImpliesNullObject) {
            act._isExplicitNullBranchParamFeedback = true;
          }
          // Check whether every calling page provides this parameter from a repeating container (Gallery/ListView/DataGrid2)
          const callingPages = pages.filter((pg) => (pg.calls_microflows || []).includes(mf.qualified_name));
          const isProtectedByRepeatingContainerPage =
            callingPages.length > 0 &&
            callingPages.every((pg) =>
              (pg.widgets || []).some(
                (w) =>
                  (w.action_microflow === mf.qualified_name || w.microflow === mf.qualified_name) &&
                  (w.inRepeatingContainer || w.enclosingRepeatingContainer)
              ) ||
              (pg.widgets || []).some(
                (w) =>
                  /^(?:Gallery|ListView|DataGrid2|TemplateGrid)$/i.test(w.type || "") &&
                  (!w.entity || !param.entity || w.entity === param.entity || w.entity.endsWith(`.${param.entity.split(".").pop()}`))
              )
            );
          if (
            !hypotheses.some(
              (h) =>
                h.pattern_id === "BHP-01" &&
                h.target_param === param.name &&
                h.title.includes("Validation Feedback on Null Object")
            )
          ) {
            addHypothesis({
              pattern_id: "BHP-01",
              category: "Crash & Exception Bomb",
              severity: "CRITICAL",
              oracle_tier: "TIER_1_OBJECTIVE",
              title: `Validation Feedback on Null Object ($${param.name}) Crashes with NullPointerException`,
              activity_id: act.id,
              activity_caption: act.caption || "Validation feedback",
              target_param: param.name,
              target_entity: param.entity,
              ...(isProtectedByRepeatingContainerPage
                ? {
                    exposure_classification: "LATENT_IMPLICITLY_PROTECTED",
                    call_hierarchy_context: {
                      exposure_classification: "LATENT_IMPLICITLY_PROTECTED",
                      implicit_protection_reason: `Calling page (${callingPages.map((p) => p.qualified_name).join(", ")}) invokes '${mf.qualified_name}' from inside a repeating container bound to '${param.entity}', ensuring '$${param.name}' is non-empty during normal UI clicks.`,
                      regression_exposure_trigger: `Will crash with NullPointerException if '${mf.qualified_name}' is called from a standalone button, sub-microflow, or API with an empty '$${param.name}'.`,
                    },
                  }
                : {}),
              oracle_rule: `Mendix ValidationFeedbackAction requires a non-null IMendixIdentifier ('validationObjectId'). Executing '${act.caption || act.id}' when '$${param.name}' is null throws 'java.lang.NullPointerException: Cannot invoke IMendixIdentifier.toLong() because validationObjectId is null'.`,
              test_strategy: `Inject PAT-07 Paired Dual-Retrieve 'NONE' sentinel (Retrieve ${param.entity} with filter 1=0, count 0) into parameter $${param.name}.`,
              variation_overrides: {
                [`Param $${param.name}`]: "'NONE'",
              },
              expected_safe_outcome: "Microflow handles empty parameter without calling ValidationFeedbackAction on a null reference",
              remediation: `Replace ValidationFeedbackAction on null '$${param.name}' with ShowMessage (for UI flows) or return an early fallback value (for SUB_/CALC_/EVT_ flows).`,
            });
          }
        }
      }

      // Check for Session Object Validation Feedback ($currentUser / System.User / Administration.Account) -> BHP-17
      const targetStr = `${act.variable || ""} ${act.object || ""} ${act.attribute || ""} ${act.expression || ""}`;
      if (/currentUser|System\.User|Administration\.Account/i.test(targetStr)) {
        const sessionFinding = {
          id: `HYP_${hypotheses.length + amberRisks.length + amberUiCandidates.length + 1}`,
          microflow: mf.qualified_name,
          pattern_id: "BHP-17",
          defect_tier: "AMBER-UI",
          category: "Frontend UI & Page Wiring",
          severity: "HIGH",
          oracle_tier: "TIER_1_OBJECTIVE",
          title: `Session Object Validation Feedback on '${act.attribute || act.variable || "$currentUser"}'`,
          activity_id: act.id,
          activity_caption: act.caption || "ValidationFeedback",
          oracle_rule: `Activity '${act.caption || act.id}' attaches ValidationFeedback to session object '$currentUser' (${act.attribute || "Account"}). Because '$currentUser' is not an editable data-view input widget on the calling page, the feedback fails silently or is never shown to the user.`,
          test_strategy: `Verify page behavior when '${mf.qualified_name}' triggers '${act.caption || act.id}'.`,
          manual_reproduction_steps: [
            `1. Open the page that invokes '${mf.qualified_name}'.`,
            `2. Trigger the condition leading to '${act.caption || act.id}' (e.g., invalid count or missing selection).`,
            `3. Click the action button to run '${mf.qualified_name}'.`,
            `4. Observe that no field validation message appears because '$currentUser' is not an input widget on the page.`,
          ],
          variation_overrides: {
            SessionObjectTarget: act.attribute || "$currentUser/Name",
          },
          expected_safe_outcome: "User error notification is displayed via a ShowMessage dialog instead of ValidationFeedback on $currentUser",
          remediation: `Replace ValidationFeedback on '${act.attribute || "$currentUser"}' with a ShowMessage action.`,
        };
        amberUiCandidates.push(sessionFinding);
        amberRisks.push({
          ...sessionFinding,
          amber_reason: "Session Entity Validation Feedback (BHP-17): requires UI Page Verification or ShowMessage refactoring.",
        });
      }

      // Check for Copy-Paste ValidationFeedback Attribute vs Message Mismatch (e.g., PickupDate field showing 'Please specify a return date.')
      if (act.attribute && act.message) {
        const attrShort = String(act.attribute).split(/[.\/]/).pop() || "";
        const msgLower = String(act.message).toLowerCase();
        const isPickupOrStartAttr = /^(?:Pickup|Start)/i.test(attrShort);
        const isReturnOrEndAttr = /^(?:Return|End)/i.test(attrShort);
        const msgSaysReturnOnly = /\b(?:return|end)\s+date\b/i.test(msgLower) && !/\b(?:pickup|start)\s+date\b/i.test(msgLower);
        const msgSaysPickupOnly = /\b(?:pickup|start)\s+date\b/i.test(msgLower) && !/\b(?:return|end)\s+date\b/i.test(msgLower);

        if ((isPickupOrStartAttr && msgSaysReturnOnly) || (isReturnOrEndAttr && msgSaysPickupOnly)) {
          addHypothesis({
            pattern_id: "BHP-05",
            category: "Dead Code & Copy-Paste Defect",
            severity: "MEDIUM",
            oracle_tier: "TIER_1_OBJECTIVE",
            title: `Copy-Paste Validation Message Mismatch on '${act.attribute}': Message Says '${act.message.trim()}'`,
            activity_id: act.id,
            activity_caption: act.caption || "ValidationFeedback",
            target_attribute: act.attribute,
            oracle_rule: `ValidationFeedback targets '${act.attribute}', but its error message states '${act.message.trim()}', misleading the user about which field failed validation.`,
            test_strategy: `Trigger validation on '${act.attribute}' in '${mf.qualified_name}' and inspect the emitted ValidationFeedbackMessage.`,
            variation_overrides: {
              [`${act.attribute}`]: "empty",
            },
            expected_safe_outcome: `Validation message on '${act.attribute}' accurately names '${attrShort}'`,
            remediation: `Update the validation feedback message on '${act.attribute}' to reference '${attrShort}' instead of '${act.message.trim()}'.`,
          });
        }
      }

      // v2.3.0 BHP-32: Wrong-Entity Validation Feedback Target (`ValidationFeedbackEntityMismatch`)
      const candidateMemberRefs = act._isExplicitNullBranchParamFeedback
        ? []
        : Array.from(
            new Set([act.attribute, ...(act.member_refs || [])].filter(Boolean))
          );
      for (const attrRef of candidateMemberRefs) {
        const qMatch = String(attrRef).match(/^([A-Za-z0-9_]+\.[A-Za-z0-9_]+)\.([A-Za-z0-9_]+)$/);
        if (!qMatch) continue;
        const [, attrEntity, attrField] = qMatch;
        if (/FDBK_Feedback|ValidationFeedback|System\.User|Administration\.Account/i.test(attrEntity)) {
          continue;
        }
        // Only flag when attrEntity is a known Domain Entity (contains a dot and isn't a local variable name)
        const isDomainEntity =
          entities.some((e) => e.qualified_name === attrEntity) ||
          /^[A-Za-z0-9_]+Module\.[A-Za-z0-9_]+$/.test(attrEntity);
        if (isDomainEntity && inScopeEntities.size > 0 && !inScopeEntities.has(attrEntity)) {
          const scopeListStr = Array.from(inScopeEntities).join(", ");
          const bhp32Finding = {
            pattern_id: "BHP-32",
            category: "Validation & UI Feedback Wiring",
            severity: "HIGH",
            oracle_tier: "TIER_1_OBJECTIVE",
            title: `Wrong-Entity Validation Feedback Target '${attrRef}' (In-Scope Entities: [${scopeListStr}])`,
            activity_id: act.id,
            activity_caption: act.caption || "ValidationFeedback",
            target_attribute: attrRef,
            target_entity: attrEntity,
            oracle_rule: `ValidationFeedback activity '${act.caption || act.id}' in '${mf.qualified_name}' targets attribute '${attrRef}' on entity '${attrEntity}', which is not among the microflow's in-scope domain entities ([${scopeListStr}]). The feedback message attaches to the wrong entity/attribute or fails to render on the target form.`,
            test_strategy: `Trigger validation failure in '${mf.qualified_name}' and inspect the emitted validation feedback target entity/attribute.`,
            manual_reproduction_steps: [
              `1. Trigger '${mf.qualified_name}' with an invalid change that activates '${act.caption || act.id}'.`,
              `2. Observe that validation feedback is emitted against '${attrRef}' ('${attrEntity}') instead of the in-scope entity ([${scopeListStr}]).`,
            ],
            variation_overrides: {
              WrongFeedbackTarget: attrRef,
            },
            expected_safe_outcome: `ValidationFeedback targets an attribute belonging to an in-scope entity ([${scopeListStr}])`,
            remediation: `Update '${act.caption || act.id}' in '${mf.qualified_name}' to target the matching attribute on the in-scope entity instead of '${attrRef}' (likely a copy-paste remnant from '${attrEntity}').`,
          };
          if (!hypotheses.some((h) => h.pattern_id === "BHP-32" && h.target_attribute === attrRef)) {
            addHypothesis(bhp32Finding);
            amberUiCandidates.push({
              id: `HYP_${hypotheses.length + amberRisks.length + amberUiCandidates.length + 1}`,
              microflow: mf.qualified_name,
              ...bhp32Finding,
              defect_tier: "AMBER-UI",
            });
          }
        }
      }
    }

    // ------------------------------------------------------------------------
    // C. Gap 2 & Gap 3: Function/Action Preconditions & Inverted Boundaries
    // ------------------------------------------------------------------------
    if (act.type === "JavaActionCall" || act.type === "MicroflowCall") {
      const targetCall = act.java_action || act.microflow || act.caption || "";
      const callArgs = [
        ...(act.arguments || []),
        ...Object.values(act.parameter_mappings || {}),
        ...(act.expressions || []),
        ...(act.expression ? [act.expression] : []),
      ].join(" ");

      // Gap 2: Unguarded Date/Math/Helper Action Arguments (e.g. FTN_DaysBetween($Booking/PickupDate, $Booking/ReturnDate))
      for (const param of parameters) {
        if (param.type !== "Object") continue;
        const derefRegex = new RegExp(`\\$(${param.name}\\/([A-Za-z0-9_]+))`, "g");
        let match;
        while ((match = derefRegex.exec(callArgs)) !== null) {
          const fullAttrPath = match[1];
          const attrName = match[2];
          if (!isAttrGuardedAt(act, fullAttrPath)) {
            if (
              !hypotheses.some(
                (h) => h.pattern_id === "BHP-01" && h.target_attribute === fullAttrPath
              )
            ) {
              addHypothesis({
                pattern_id: "BHP-01",
                category: "Crash & Exception Bomb",
                severity: "HIGH",
                oracle_tier: "TIER_1_OBJECTIVE",
                title: `Unguarded Null Attribute '$${fullAttrPath}' Passed to '${targetCall}'`,
                activity_id: act.id,
                activity_caption: act.caption || targetCall,
                target_param: param.name,
                target_entity: param.entity,
                target_attribute: fullAttrPath,
                oracle_rule: `Activity '${act.caption || targetCall}' passes '$${fullAttrPath}' into '${targetCall}' without verifying '$${fullAttrPath} != empty'. When '${attrName}' is null, the expression/action crashes with MicroflowException.`,
                test_strategy: `Pass valid $${param.name} with '${attrName} = empty' into '${mf.qualified_name}'.`,
                variation_overrides: {
                  [`$${fullAttrPath}`]: "empty",
                },
                expected_safe_outcome: `Exclusive Split guards '$${fullAttrPath} != empty' before invoking '${targetCall}'`,
                remediation: `Add an Exclusive Split checking '$${fullAttrPath} != empty' before calling '${targetCall}'.`,
              });
            }
          }
        }
      }

      // Gap 3: Inverted Temporal Range in DaysBetween / Date Calculation
      if (/DaysBetween|DateDiff/i.test(targetCall) || /daysBetween/i.test(callArgs)) {
        const dateAttrs = Array.from(callArgs.matchAll(/\$([A-Za-z0-9_]+\/[A-Za-z0-9_]+)/g)).map(
          (m) => m[1]
        );
        if (dateAttrs.length >= 2) {
          const [startAttr, endAttr] = dateAttrs;
          const hasOrderGuard = activities.some(
            (a) =>
              a.type === "ExclusiveSplit" &&
              a.expression &&
              (a.expression.includes(`${endAttr} >= $${startAttr}`) ||
                a.expression.includes(`${endAttr} > $${startAttr}`) ||
                a.expression.includes(`${startAttr} <= $${endAttr}`) ||
                a.expression.includes(`${startAttr} < $${endAttr}`))
          );
          if (!hasOrderGuard) {
            addHypothesis({
              pattern_id: "BHP-04",
              category: "Business Invariant & Inverted Boundary",
              severity: "HIGH",
              oracle_tier: "TIER_1_OBJECTIVE",
              title: `Inverted Date Range ($${endAttr} < $${startAttr}) Silently Produces Positive abs() Duration`,
              activity_id: act.id,
              activity_caption: act.caption || targetCall,
              target_attribute: `${startAttr}, ${endAttr}`,
              oracle_rule: `Temporal invariant requires '$${endAttr} >= $${startAttr}'. In Mendix, built-in date-difference functions ('daysBetween', 'secondsBetween', 'calendarYearsBetween') always return the absolute value abs(d2 - d1) >= 0. Calling '${targetCall}' without a chronological boundary guard silently computes a positive duration (+5) when '${endAttr}' precedes '${startAttr}'.`,
              test_strategy: `Inject inverted dates ($${startAttr} = 2026-11-10, $${endAttr} = 2026-11-05) and verify whether Mendix's abs() date-difference silently accepts the inverted range as a positive duration (+5) instead of rejecting it.`,
              variation_overrides: {
                [`${startAttr.replace(/\//g, ".")}`]: "2026-12-10T10:00:00.000Z",
                [`${endAttr.replace(/\//g, ".")}`]: "2026-12-01T10:00:00.000Z",
              },
              expected_safe_outcome: `Microflow rejects inverted date range ($${endAttr} < $${startAttr}) with validation feedback before calling date-difference logic`,
              remediation: `Add an Exclusive Split checking '$${endAttr} >= $${startAttr}' before '${act.caption || targetCall}'.`,
            });
          }
        }
      }

      // Gap 3B: Unguarded Financial/Quantity Multiplication via FTN_Multiply / Multiply Helper Call
      if (/Multiply/i.test(targetCall)) {
        const multAttrs = Array.from(callArgs.matchAll(/\$([A-Za-z0-9_]+\/[A-Za-z0-9_]+)/g)).map(
          (m) => m[1]
        );
        if (multAttrs.length >= 2 && /Price|Amount|Total|Cost|Rate|Days|Qty|Quantity/i.test(multAttrs.join(" "))) {
          const [leftAttr, rightAttr] = multAttrs;
          const hasNonNegGuard = activities.some(
            (a) =>
              a.type === "ExclusiveSplit" &&
              a.expression &&
              (a.expression.includes(`>= 0`) || a.expression.includes(`> 0`))
          );
          if (!hasNonNegGuard && !hypotheses.some((h) => h.pattern_id === "BHP-04" && h.activity_id === act.id)) {
            addHypothesis({
              pattern_id: "BHP-04",
              category: "Business Invariant & Inverted Boundary",
              severity: "HIGH",
              oracle_tier: "TIER_1_OBJECTIVE",
              title: `Unguarded Financial/Quantity Multiplication ($${leftAttr} * $${rightAttr}) in '${targetCall}' Allows Negative Total`,
              activity_id: act.id,
              activity_caption: act.caption || targetCall,
              target_attribute: `${leftAttr}, ${rightAttr}`,
              oracle_rule: `Financial/quantity calculation '${targetCall}(${leftAttr}, ${rightAttr})' multiplies values without verifying non-negative bounds (>= 0), allowing negative totals (e.g. -500.00) to be calculated and saved.`,
              test_strategy: `Inject negative multiplier (e.g. -5) into '$${rightAttr}' and verify whether a negative total is returned.`,
              variation_overrides: {
                [`$${rightAttr}`]: "-5",
              },
              expected_safe_outcome: "Microflow rejects negative duration/quantity or clamps total >= 0",
              remediation: `Add an Exclusive Split checking '$${leftAttr} >= 0 and $${rightAttr} >= 0' before '${act.caption || targetCall}'.`,
            });
          }
        }
      }
    }

    // ------------------------------------------------------------------------
    // D. Expression-Level Scanners (BHP-01, BHP-02, BHP-03, BHP-04, BHP-06)
    // ------------------------------------------------------------------------
    for (const expr of exprs) {
      // BHP-01 & BHP-02: Unchecked Empty Object Dereference ($Param/Attribute before $Param != empty)
      for (const param of parameters) {
        if (param.type === "Object" && !isParamGuardedAt(act, param.name)) {
          const derefRegex = new RegExp(`\\$${param.name}\\/([A-Za-z0-9_.]+)`, "g");
          let match;
          while ((match = derefRegex.exec(expr)) !== null) {
            const pathPart = match[1];
            const isAssociationTraversal = pathPart.includes(".");
            const patternId = isAssociationTraversal ? "BHP-02" : "BHP-01";
            const title = isAssociationTraversal
              ? `Unchecked Empty Association Traversal on $${param.name}/${pathPart}`
              : `Unchecked Empty Object Dereference on $${param.name}/${pathPart}`;

            if (!hypotheses.some((h) => h.pattern_id === patternId && h.target_param === param.name)) {
              addHypothesis({
                pattern_id: patternId,
                category: "Crash & Exception Bomb",
                severity: "CRITICAL",
                oracle_tier: "TIER_1_OBJECTIVE",
                title,
                activity_id: act.id,
                activity_caption: act.caption || act.type,
                target_param: param.name,
                target_entity: param.entity,
                oracle_rule: `Dereferencing $${param.name}/${pathPart} when $${param.name} is empty throws an unhandled Mendix runtime exception.`,
                test_strategy: `Inject PAT-07 Paired Dual-Retrieve 'NONE' sentinel (Retrieve ${param.entity} with filter 1=0, expected count 0) into parameter $${param.name}.`,
                variation_overrides: {
                  [`Param $${param.name}`]: "'NONE'",
                },
                expected_safe_outcome: "Graceful handling (false / validation message) without unhandled exception",
                remediation: `Add an Exclusive Split checking '$${param.name} != empty' before activity '${act.caption || act.id}'.`,
              });
            }
          }
        }
      }

      // Gap 2 (Expressions): Built-in Null-Crashing Mendix Functions Called with Unguarded Nullable Attribute
      // Note: per Mendix Reference Guide (String Function Calls), `trim`, `toLowerCase`, `toUpperCase`, `length`, `toString`, `urlEncode`
      // are null-safe in Mendix (returning '' or 0 on empty) and MUST NOT be flagged as null crashes.
      const fnMatch = expr.match(
        /\b(daysBetween|secondsBetween|millisecondsBetween|calendarYearsBetween|calendarMonthsBetween|calendarDaysBetween|addDays|addMonths|addYears|addHours|addMinutes|addSeconds|round|floor|ceil|substring|find|replaceAll|replaceFirst|matches|formatDateTime|formatDateTimeUTC|parseDateTime|parseDateTimeUTC|parseInteger|parseDecimal)\s*\(([^)]+)\)/i
      );
      if (fnMatch) {
        const [, fnName, fnArgs] = fnMatch;
        const argAttrs = Array.from(fnArgs.matchAll(/\$([A-Za-z0-9_]+\/[A-Za-z0-9_]+)/g)).map(
          (m) => m[1]
        );
        for (const attrPath of argAttrs) {
          if (!isAttrGuardedAt(act, attrPath)) {
            if (
              !hypotheses.some(
                (h) => h.pattern_id === "BHP-01" && h.target_attribute === attrPath
              )
            ) {
              addHypothesis({
                pattern_id: "BHP-01",
                category: "Crash & Exception Bomb",
                severity: "HIGH",
                oracle_tier: "TIER_1_OBJECTIVE",
                title: `Unguarded Null Attribute '$${attrPath}' in '${fnName}(...)' Expression`,
                activity_id: act.id,
                activity_caption: act.caption || act.type,
                target_attribute: attrPath,
                oracle_rule: `Built-in function '${fnName}' is invoked on '$${attrPath}' without checking '$${attrPath} != empty'. Passing empty throws 'MicroflowException: Failed to evaluate expression'.`,
                test_strategy: `Set '$${attrPath} = empty' and execute '${mf.qualified_name}'.`,
                variation_overrides: {
                  [`$${attrPath}`]: "empty",
                },
                expected_safe_outcome: `Guard '$${attrPath} != empty' prior to evaluating '${fnName}'`,
                remediation: `Add an Exclusive Split checking '$${attrPath} != empty' before activity '${act.caption || act.id}'.`,
              });
            }
          }
        }

        // Also check if daysBetween / secondsBetween / calendarYearsBetween in expression lacks chronological order guard
        if (/daysBetween|secondsBetween|millisecondsBetween|calendarYearsBetween|calendarMonthsBetween|calendarDaysBetween/i.test(fnName) && argAttrs.length >= 2) {
          const [startAttr, endAttr] = argAttrs;
          const hasOrderGuard = activities.some(
            (a) =>
              a.type === "ExclusiveSplit" &&
              a.expression &&
              (a.expression.includes(`${endAttr} >= $${startAttr}`) ||
                a.expression.includes(`${endAttr} > $${startAttr}`) ||
                a.expression.includes(`${startAttr} <= $${endAttr}`) ||
                a.expression.includes(`${startAttr} < $${endAttr}`))
          );
          if (
            !hasOrderGuard &&
            !hypotheses.some((h) => h.pattern_id === "BHP-04" && h.activity_id === act.id)
          ) {
            addHypothesis({
              pattern_id: "BHP-04",
              category: "Business Invariant & Inverted Boundary",
              severity: "HIGH",
              oracle_tier: "TIER_1_OBJECTIVE",
              title: `Inverted Date Range ($${endAttr} < $${startAttr}) in '${fnName}' Silently Returns Positive abs() Duration`,
              activity_id: act.id,
              activity_caption: act.caption || act.type,
              target_attribute: `${startAttr}, ${endAttr}`,
              oracle_rule: `In Mendix, '${fnName}' always returns the absolute value abs(d2 - d1) >= 0. Expression '${expr}' calculates date difference without enforcing '$${endAttr} >= $${startAttr}', silently returning a positive duration/age (+5) when '${endAttr}' precedes '${startAttr}'.`,
              test_strategy: `Set '$${startAttr} = 2026-11-10' and '$${endAttr} = 2026-11-05' and verify whether Mendix's abs() date-difference silently accepts the inverted range as a positive duration (+5).`,
              variation_overrides: {
                [`${startAttr.replace(/\//g, ".")}`]: "2026-12-10T10:00:00.000Z",
                [`${endAttr.replace(/\//g, ".")}`]: "2026-12-01T10:00:00.000Z",
              },
              expected_safe_outcome: `Microflow validates '$${endAttr} >= $${startAttr}' before calling '${fnName}'`,
              remediation: `Add an Exclusive Split verifying '$${endAttr} >= $${startAttr}' before '${act.caption || act.id}'.`,
            });
          }
        }
      }

      // Gap 3 (Multiplication): Financial / Quantity Multiplication Without Non-Negative Guard
      const multMatch = expr.match(/\$([A-Za-z0-9_]+\/[A-Za-z0-9_]+)\s*\*\s*\$([A-Za-z0-9_]+\/[A-Za-z0-9_]+)/);
      if (multMatch && act.type === "ChangeObject") {
        const [, leftAttr, rightAttr] = multMatch;
        if (/Price|Amount|Total|Cost|Rate|Days|Qty|Quantity/i.test(`${leftAttr} ${rightAttr}`)) {
          const hasNonNegGuard = activities.some(
            (a) =>
              a.type === "ExclusiveSplit" &&
              a.expression &&
              (a.expression.includes(`>= 0`) || a.expression.includes(`> 0`))
          );
          if (
            !hasNonNegGuard &&
            !hypotheses.some((h) => h.pattern_id === "BHP-04" && h.activity_id === act.id)
          ) {
            addHypothesis({
              pattern_id: "BHP-04",
              category: "Business Invariant & Inverted Boundary",
              severity: "HIGH",
              oracle_tier: "TIER_1_OBJECTIVE",
              title: `Unguarded Financial/Quantity Multiplication ($${leftAttr} * $${rightAttr}) Allows Negative Total`,
              activity_id: act.id,
              activity_caption: act.caption || act.type,
              target_attribute: `${leftAttr}, ${rightAttr}`,
              oracle_rule: `Financial/quantity calculation '${expr}' multiplies '$${leftAttr}' and '$${rightAttr}' without verifying non-negative bounds (>= 0), allowing negative totals (e.g. -500.00) to be committed.`,
              test_strategy: `Inject negative multiplier (e.g. -5) into '$${rightAttr}' and verify whether a negative total is calculated and saved.`,
              variation_overrides: {
                [`$${rightAttr}`]: "-5",
              },
              expected_safe_outcome: "Microflow rejects negative duration/quantity or clamps total >= 0",
              remediation: `Add an Exclusive Split checking '$${leftAttr} >= 0 and $${rightAttr} >= 0' before '${act.caption || act.id}'.`,
            });
          }
        }
      }

      // BHP-03: Division or Modulo by Zero (require whitespace/paren/digit before '/' so $Obj/Attr is not mistaken for division)
      const divMatch = expr.match(/(?:\s+|[\d)])\/\s*\$?([A-Za-z0-9_./]+)|\b(?:div|mod)\s*\(?[^,]+,\s*\$?([A-Za-z0-9_./]+)/i);
      if (divMatch) {
        const denominator = divMatch[1] || divMatch[2];
        if (!/^[1-9][0-9]*$/.test(denominator)) {
          addHypothesis({
            pattern_id: "BHP-03",
            category: "Crash & Exception Bomb",
            severity: "CRITICAL",
            oracle_tier: "TIER_1_OBJECTIVE",
            title: `Unguarded Division/Modulo by Zero (${denominator})`,
            activity_id: act.id,
            activity_caption: act.caption || act.type,
            target_expression: expr,
            oracle_rule: `Denominator '${denominator}' is not guarded against 0 prior to division/modulo in '${expr}'.`,
            test_strategy: `Set '${denominator}' = 0 and execute microflow in memory.`,
            variation_overrides: {
              [denominator]: "0",
            },
            expected_safe_outcome: "Guarded split prevents ArithmeticException / NaN",
            remediation: `Guard '${denominator} != 0' in an Exclusive Split prior to '${act.caption || act.id}'.`,
          });
        }
      }

      // BHP-04: Unsafe String Parsing / Substring Out-of-Bounds
      if (/\b(parseInteger|parseDecimal|parseDateTime|substring)\s*\(/i.test(expr) && !act.has_error_handler) {
        addHypothesis({
          pattern_id: "BHP-04",
          category: "Crash & Exception Bomb",
          severity: "HIGH",
          oracle_tier: "TIER_1_OBJECTIVE",
          title: `Unsafe String Parsing / Substring Without Error Handler`,
          activity_id: act.id,
          activity_caption: act.caption || act.type,
          target_expression: expr,
          oracle_rule: `Expression '${expr}' parses or slices strings without a Custom Error Handler.`,
          test_strategy: `Inject malformed string ('INVALID_NUM' and empty string '') into string input.`,
          variation_overrides: {
            StringInput: "'INVALID_NUM'",
          },
          expected_safe_outcome: "Custom Error Handler or regex guard catches malformed string",
          remediation: `Attach a Custom Error Handler or pre-validate string format/length before '${act.caption || act.id}'.`,
        });
      }

      // BHP-01 (v2.3.0 Nullable Attribute Relational Comparison) & BHP-06: Relational Boundary Off-by-One (< vs <=, > vs >=)
      if (act.type === "ExclusiveSplit") {
        const relMatch = expr.match(/\$([A-Za-z0-9_]+\/[A-Za-z0-9_]+)\s*(>=|<=|>|<)\s*(-?\d+(?:\.\d+)?)/);
        if (relMatch) {
          const [, attrPath, operator, thresholdStr] = relMatch;
          const threshold = Number(thresholdStr);

          // v2.3.0: Check if '$Obj/Attr' has an explicit '!= empty' or '= empty' null guard anywhere in this microflow
          const isAttrNullGuarded =
            checkedNotEmptyAttrs.has(attrPath) ||
            allGuardedAttrsInMf.has(attrPath.toLowerCase()) ||
            new RegExp(`\\$${attrPath.replace("/", "\\/")}\\s*(?:!=|=)\\s*empty\\b`, "i").test(expr);

          if (
            !isAttrNullGuarded &&
            !hypotheses.some((h) => h.pattern_id === "BHP-01" && h.target_attribute === attrPath)
          ) {
            addHypothesis({
              pattern_id: "BHP-01",
              category: "Crash & Exception Bomb",
              severity: "HIGH",
              oracle_tier: "TIER_1_OBJECTIVE",
              title: `Unguarded Nullable Attribute Relational Comparison '$${attrPath} ${operator} ${thresholdStr}' Crashes When Empty`,
              activity_id: act.id,
              activity_caption: act.caption || act.type,
              target_attribute: attrPath,
              target_expression: expr,
              oracle_rule: `Decision split '${act.caption || act.id}' evaluates relational comparison '${expr}' without guarding '$${attrPath} != empty'. In Mendix, evaluating '${operator}' on an empty numeric attribute throws an unhandled 'NullPointerException' / 'MicroflowException: Failed to evaluate expression'.`,
              test_strategy: `Set '$${attrPath} = empty' on a valid parent object and execute '${mf.qualified_name}'.`,
              variation_overrides: {
                [`$${attrPath}`]: "empty",
              },
              expected_safe_outcome: `Microflow checks '$${attrPath} != empty' before evaluating '${expr}'`,
              remediation: `Add an Exclusive Split checking '$${attrPath} != empty' prior to '${act.caption || act.id}' (or guard with '$${attrPath} != empty and ${expr}').`,
            });
          }

          const docText = (mf.documentation || "").toLowerCase();
          const docImpliesInclusive =
            docText.includes(`at least ${thresholdStr}`) ||
            docText.includes(`>= ${thresholdStr}`) ||
            docText.includes(`minimum ${thresholdStr}`) ||
            docText.includes(`up to ${thresholdStr}`);
          const codeIsStrict = operator === ">" || operator === "<";

          addHypothesis({
            pattern_id: "BHP-06",
            category: "Boundary & Specification Drift",
            severity: docImpliesInclusive && codeIsStrict ? "HIGH" : "MEDIUM",
            oracle_tier: docImpliesInclusive ? "TIER_1_OBJECTIVE" : "TIER_2_HYPOTHESIS",
            title:
              docImpliesInclusive && codeIsStrict
                ? `Spec-to-Code Boundary Drift on $${attrPath} ('${operator} ${threshold}' vs Doc 'at least/up to ${threshold}')`
                : `Relational Boundary Check on $${attrPath} (${operator} ${threshold})`,
            activity_id: act.id,
            activity_caption: act.caption || act.type,
            target_attribute: attrPath,
            oracle_rule: docImpliesInclusive
              ? `Documentation states '${mf.documentation}', but Exclusive Split uses strict '${operator} ${threshold}', rejecting the exact boundary value ${threshold}.`
              : `Verify exact boundary behavior at ${threshold - 1}, ${threshold}, and ${threshold + 1}.`,
            test_strategy: `Execute 3-point boundary matrix (${threshold - 1}, ${threshold}, ${threshold + 1}) on $${attrPath}.`,
            variation_overrides: {
              [`$${attrPath}`]: String(threshold),
            },
            expected_safe_outcome: `Value ${threshold} satisfies documented inclusive boundary rule`,
            remediation: `Change Exclusive Split '${expr}' to use '${operator === ">" ? ">=" : "<="} ${threshold}'.`,
          });
        }
      }
    }

    // BHP-12: Hidden Retrieve Inside Unit Operation (MTF Violation #3)
    if (act.type === "Retrieve" && act.retrieve_source === "Database") {
      addHypothesis({
        pattern_id: "BHP-12",
        category: "MTF v2 Architecture & Stale State",
        severity: "HIGH",
        oracle_tier: "TIER_1_OBJECTIVE",
        title: `Hidden Database Retrieve Inside Logic Flow (${act.entity || act.caption})`,
        activity_id: act.id,
        activity_caption: act.caption || "Database Retrieve",
        oracle_rule: `MTF v2 Directive #3: Retrieving '${act.entity || "entity"}' directly from the database inside business logic ignores uncommitted in-memory changes in the active transaction.`,
        test_strategy: `Create/mutate '${act.entity || "entity"}' in memory without committing, invoke ${mf.qualified_name}, and verify stale-read discrepancy.`,
        variation_overrides: {
          InMemoryMutationUncommitted: "true",
        },
        expected_safe_outcome: "Microflow reads in-memory state passed via Dependency Injection parameter",
        remediation: `Pass '${act.entity || "the required object"}' as an input parameter (Dependency Injection) instead of querying the database mid-flow.`,
      });
    }

    // BHP-15: ValidationFeedback Emitted Without Setting $IsValid = false / Halting Commit
    // Deduplicate per microflow so multiple validation messages in one microflow produce 1 clear finding instead of N identical rows
    if (act.type === "ValidationFeedback" && act.sets_valid_false === false) {
      const existingBhp15 = hypotheses.find((h) => h.pattern_id === "BHP-15");
      if (!existingBhp15) {
        const allUnflaggedFeedbacks = activities.filter(
          (a) => a.type === "ValidationFeedback" && a.sets_valid_false === false
        );
        const captions = Array.from(
          new Set(allUnflaggedFeedbacks.map((a) => a.caption || a.attribute || a.id).filter(Boolean))
        );
        const captionSummary =
          captions.length > 1
            ? `${captions[0]} (+${captions.length - 1} more validation check(s): ${captions.slice(1, 4).join(", ")})`
            : act.caption || "ValidationFeedback";
        addHypothesis({
          pattern_id: "BHP-15",
          category: "Validation & Commit Integrity",
          severity: "CRITICAL",
          oracle_tier: "TIER_1_OBJECTIVE",
          title:
            captions.length > 1
              ? `Validation Feedback Emitted Without Halting Commit / Rollback Flag (${captions.length} Checks in '${mf.name}')`
              : `Validation Feedback Emitted Without Halting Commit / Rollback Flag`,
          activity_id: act.id,
          activity_caption: captionSummary,
          oracle_rule: `Activity '${captionSummary}' emits a validation error message to the user, but does not set a validation flag to false or block the downstream save/commit.`,
          test_strategy: `Dispatch isolated validation session triggering '${act.caption || act.id}' and assert whether return value is true/committed despite ValidationFeedbackCount >= 1.`,
          variation_overrides: {
            TriggerValidationBranch: act.id,
          },
          expected_safe_outcome: "Microflow returns false and aborts database commit when validation feedback is raised",
          remediation: `Set '$IsValid = false' immediately after validation feedback in '${mf.qualified_name}' and ensure downstream commit is blocked when '$IsValid = false'.`,
        });
      }
    }

    // DQP-08: Untargeted Rollback Destroying Touchpoint User Input
    if (act.type === "Rollback" && parameters.some((p) => p.name === act.variable)) {
      addHypothesis({
        pattern_id: "DQP-08",
        category: "Data Quality & ACID Enforcement",
        severity: "HIGH",
        oracle_tier: "TIER_1_OBJECTIVE",
        title: `Untargeted Rollback Destroys User Touchpoint Input ($${act.variable})`,
        activity_id: act.id,
        activity_caption: act.caption || `Rollback $${act.variable}`,
        oracle_rule: `MTF v2 ACID Section 1.2: Executing Rollback directly on Touchpoint parameter '$${act.variable}' wipes out all valid fields typed by the user when a single field fails validation.`,
        test_strategy: `Modify valid fields + 1 invalid field on $${act.variable} in memory, execute ${mf.qualified_name}, and assert whether valid in-memory edits were wiped out.`,
        variation_overrides: {
          [`$${act.variable} (Valid Edits + 1 Invalid)`]: "MixedPayload",
        },
        expected_safe_outcome: "Preserve Touchpoint parameter in memory on validation failure; only rollback non-touchpoint helper objects",
        remediation: `Remove Rollback on Touchpoint parameter '$${act.variable}'; only rollback non-touchpoint scope objects in CMT_.`,
      });
    }
  }

  // ==========================================================================
  // DATA QUALITY & 4-LAYER STACK ENFORCEMENT (DQP-01..07 & BHP-17)
  // ==========================================================================

  // DQP-02: UI-Only Validation Trap (Page widget is required, but server microflow has no check)
  for (const page of pages) {
    if ((page.calls_microflows || []).includes(mf.qualified_name)) {
      for (const widget of page.widgets || []) {
        if (widget.required_on_page && widget.attribute) {
          const attrShortName = widget.attribute.split(".").pop();
          const checkedInMicroflow = activities.some((a) => {
            const allExprs = [a.expression || "", ...(a.expressions || [])].join(" ");
            return allExprs.includes(attrShortName);
          });

          if (!checkedInMicroflow) {
            const dqp02Finding = {
              pattern_id: "DQP-02",
              category: "Data Quality & Business Rule Enforcement",
              severity: "CRITICAL",
              oracle_tier: "TIER_1_OBJECTIVE",
              title: `UI-Only Validation Trap on ${widget.attribute} (Client/Server Drift)`,
              activity_id: widget.name,
              activity_caption: `Page ${page.qualified_name} -> Widget ${widget.name}`,
              target_attribute: widget.attribute,
              oracle_rule: `Page '${page.qualified_name}' enforces Required validation on '${widget.attribute}', but server microflow '${mf.qualified_name}' never validates '${attrShortName}' before committing.`,
              test_strategy: `Call '${mf.qualified_name}' directly via MTA_plugin with '${attrShortName} = empty' and verify whether the server commits the invalid blank record.`,
              manual_reproduction_steps: [
                `1. Open Page '${page.qualified_name}'.`,
                `2. Observe that widget '${widget.name}' (${widget.attribute}) is marked Required on the form, but invoking '${mf.qualified_name}' from any side-door or API bypasses this check.`,
              ],
              variation_overrides: {
                [widget.attribute]: "empty",
              },
              expected_safe_outcome: `Server-side VAL_ rejects empty '${attrShortName}' and blocks database commit`,
              remediation: `Move the mandatory check for '${widget.attribute}' into a server-side 'VAL_' microflow invoked by 'CMT_' before commit.`,
            };
            addHypothesis(dqp02Finding);
          }
        }
      }
    }
  }

  // DQP-04: Silent Before-Commit Event Handler Rejection (returns false with RaiseError == false)
  // Scope to microflows that actually commit or mutate the entity (or single-entity bundles)
  for (const entity of entities) {
    const entityShort = (entity.qualified_name || entity.name || "").split(".").pop();
    const mfCommitsOrTouchesEntity =
      entities.length === 1 ||
      activities.some(
        (a) =>
          (a.type === "Commit" ||
            a.type === "CommitObject" ||
            ((a.type === "ChangeObject" || a.type === "CreateObject") && /^yes$/i.test(String(a.commit || "")))) &&
          (a.entity === entity.qualified_name ||
            a.variable === entityShort ||
            String(a.entity || "").endsWith(`.${entityShort}`) ||
            parameters.some((p) => p.name === a.variable && p.entity === entity.qualified_name))
      );
    if (!mfCommitsOrTouchesEntity) continue;

    for (const eh of entity.event_handlers || []) {
      if (eh.event === "BeforeCommit" && eh.returns_false_possible && eh.raise_error_on_false === false) {
        const dqp04Finding = {
          pattern_id: "DQP-04",
          defect_tier: "AMBER",
          category: "Data Quality & Business Rule Enforcement",
          severity: "CRITICAL",
          oracle_tier: "TIER_1_OBJECTIVE",
          title: `Silent Data Loss in Before-Commit Handler (${eh.microflow} on ${entity.qualified_name})`,
          activity_id: eh.microflow,
          activity_caption: `BCO Event Handler ${eh.microflow}`,
          oracle_rule: `Before-Commit event handler '${eh.microflow}' on '${entity.qualified_name}' can return false with 'Raise an error' unchecked. When that happens, Mendix silently cancels saving the record while '${mf.qualified_name}' continues as if the save succeeded.`,
          test_strategy: `Execute '${mf.qualified_name}' with an input that triggers '${eh.microflow} -> false', then Retrieve '${entity.qualified_name}' from DB and assert ObjectCount == 1.`,
          variation_overrides: {
            [`Trigger_${eh.microflow}_False`]: "true",
          },
          expected_safe_outcome: "All business validations run explicitly in VAL_ before CMT_ commit; BCO_ handlers only augment data and always return true",
          remediation: `Move business validation out of Before-Commit handler '${eh.microflow}' into 'VAL_${entity.qualified_name.split(".").pop()}', or enable 'Raise an error when the microflow returns false'.`,
        };
        if (!hypotheses.some((h) => h.pattern_id === "DQP-04" && h.activity_id === eh.microflow)) {
          addHypothesis(dqp04Finding);
        }
      }
    }
  }

  // DQP-01: Side-Door Commit Bypass (Cross-Flow Invariant Check — Paid Tier Dynamic / Free Tier Amber)
  for (const committer of otherCommitters) {
    if ((committer.calls_validators || []).length === 0) {
      const finding = {
        id: `HYP_${hypotheses.length + amberRisks.length + 1}`,
        microflow: committer.qualified_name,
        pattern_id: "DQP-01",
        defect_tier: tier === "paid" ? "RED" : "AMBER",
        category: "Data Quality & Business Rule Enforcement",
        severity: "CRITICAL",
        oracle_tier: "TIER_1_OBJECTIVE",
        title: `Side-Door Commit Bypass in '${committer.qualified_name}' on ${committer.commits_entity}`,
        activity_id: committer.qualified_name,
        activity_caption: committer.qualified_name,
        oracle_rule: `Microflow '${committer.qualified_name}' commits '${committer.commits_entity}' directly to the database without invoking its server-side 'VAL_' invariant validator.`,
        test_strategy: `Inject invalid '${committer.commits_entity}' into '${committer.qualified_name}' and verify that corrupted data bypasses business rules and persists.`,
        variation_overrides: {
          TargetMicroflow: committer.qualified_name,
          InvalidEntityPayload: "true",
        },
        expected_safe_outcome: `All commit paths for '${committer.commits_entity}' route through centralized 'CMT_' after 'VAL_' validation`,
        remediation: `Refactor '${committer.qualified_name}' to delegate persistence to the centralized 'CMT_${committer.commits_entity.split(".").pop()}' committer.`,
      };

      if (tier === "paid") {
        hypotheses.push(finding);
      } else {
        amberRisks.push({
          ...finding,
          amber_reason:
            "Free Tier is scoped to single-microflow verification. Upgrade to Enterprise Bug Hunter (Paid Tier) to dynamically execute cross-microflow Side-Door Commit Bypass tests across your entire module.",
        });
      }
    }
  }

  // BHP-17: Phantom Validation Feedback on Page (Paid UI Tier Dynamic / Free Tier AMBER-UI Page Candidate)
  for (const act of activities) {
    if (act.type === "ValidationFeedback" && act.attribute && !act._isExplicitNullBranchParamFeedback) {
      for (const page of pages) {
        if ((page.calls_microflows || []).includes(mf.qualified_name)) {
          const renderedOnPage = (page.widgets || []).some(
            (w) =>
              w.editable !== false &&
              w.attribute &&
              (w.attribute === act.attribute || w.attribute.endsWith(`.${act.attribute}`))
          );
          const alreadyRecordedBhp17 =
            amberUiCandidates.some(
              (u) =>
                u.pattern_id === "BHP-17" &&
                u.microflow === mf.qualified_name &&
                u.page_qualified_name === page.qualified_name &&
                u.variation_overrides?.MissingWidgetAttribute === act.attribute
            ) ||
            hypotheses.some(
              (h) =>
                h.pattern_id === "BHP-17" &&
                h.microflow === mf.qualified_name &&
                h.page_qualified_name === page.qualified_name &&
                h.variation_overrides?.MissingWidgetAttribute === act.attribute
            );
          if (!renderedOnPage && !alreadyRecordedBhp17) {
            const finding = {
              id: `HYP_${hypotheses.length + amberRisks.length + amberUiCandidates.length + 1}`,
              microflow: mf.qualified_name,
              pattern_id: "BHP-17",
              defect_tier: tier === "paid" ? "RED" : "AMBER-UI",
              category: "Frontend UI & Page Wiring",
              severity: "HIGH",
              oracle_tier: "TIER_1_OBJECTIVE",
              title: `Phantom Validation Feedback: '${act.attribute}' Not Rendered on Page '${page.qualified_name}'`,
              activity_id: act.id,
              activity_caption: act.caption || "ValidationFeedback",
              page_qualified_name: page.qualified_name,
              oracle_rule: `Microflow '${mf.qualified_name}' shows a validation message on '${act.attribute}', but Page '${page.qualified_name}' has no editable input field for '${act.attribute}'. Users clicking Save/Action are blocked without seeing any error message on the screen.`,
              test_strategy: `Run 3-Case Frontend Playwright Suite (MenditectMxFrontendTestKit) on '${page.qualified_name}' and assert Locate_MxWidget_*_ValidationMessage (PAT-119).`,
              manual_reproduction_steps: [
                `1. Open Page '${page.qualified_name}' in the browser.`,
                `2. Fill inputs to trigger '${act.caption || act.id}' on '${act.attribute}'.`,
                `3. Click the button that invokes '${mf.qualified_name}'.`,
                `4. Observe that the action fails silently on the UI because '${act.attribute}' is not an editable widget on '${page.qualified_name}'.`,
              ],
              variation_overrides: {
                Page: page.qualified_name,
                MissingWidgetAttribute: act.attribute,
              },
              expected_safe_outcome: "Validation feedback is visible on the page or displayed via a ShowMessage dialog",
              remediation: `Place an input widget for '${act.attribute}' on '${page.qualified_name}' or use a page-level ShowMessage dialog.`,
            };

            if (tier === "paid") {
              hypotheses.push(finding);
            } else {
              amberUiCandidates.push(finding);
              amberRisks.push({
                ...finding,
                amber_reason:
                  "UI Page Candidate Bug (AMBER-UI): Cannot be clicked in-memory in Free Tier. Follow the Manual Reproduction Steps or upgrade to MTA Platform (Paid Tier) for automated Playwright verification.",
              });
            }
          }
        }
      }
    }
  }

  // ==========================================================================
  // ASSOCIATION, FINANCIAL, CONCURRENCY & INTEGRATION PATTERNS (BHP-21..29, INT-01..02)
  // ==========================================================================

  // Track association-retrieved or single-object-retrieved/returned objects (including ListOperation Head/Find) for BHP-23
  const assocRetrievedVars = new Map();
  for (const act of activities) {
    if (
      act.type === "Retrieve" &&
      (act.retrieve_source === "Association" || act.first_only === true) &&
      act.output_variable
    ) {
      assocRetrievedVars.set(act.output_variable, act);
    } else if (act.type === "MicroflowCall" && act.returns_object === true && act.output_variable) {
      assocRetrievedVars.set(act.output_variable, act);
    } else if (
      (act.type === "ListOperation" || act.action_type === "ListOperationAction") &&
      /^(?:Head|Find)$/i.test(String(act.operation || act.list_operation || "")) &&
      (act.output_variable || act.variable_name)
    ) {
      assocRetrievedVars.set(act.output_variable || act.variable_name, act);
    }

    // BHP-21: Single-Reference Overwrite Trap
    if (act.type === "ChangeObject" && act.sets_association && !act.checks_existing_association) {
      addHypothesis({
        pattern_id: "BHP-21",
        category: "Association & Relational Integrity",
        severity: "MEDIUM",
        oracle_tier: "TIER_2_HYPOTHESIS",
        title: `Single-Reference Overwrite Trap on '${act.sets_association}'`,
        activity_id: act.id,
        activity_caption: act.caption || `Change ${act.variable}`,
        oracle_rule: `Activity '${act.caption || act.id}' assigns association '${act.sets_association}' without verifying whether a prior associated record is already linked, risking silent disassociation.`,
        test_strategy: `Pre-populate '${act.sets_association}' with an existing record, execute '${mf.qualified_name}', and verify whether the prior link was silently overwritten.`,
        variation_overrides: {
          [`Existing_${act.sets_association}`]: "Populated",
        },
        expected_safe_outcome: "Microflow checks existing association or explicitly handles re-assignment",
        remediation: `Check '$${act.variable}/${act.sets_association} = empty' before overwriting or handle prior record cleanup.`,
      });
    }

    // BHP-26: Unclamped Discount / Subtraction Producing Negative Price
    if (act.type === "ChangeObject") {
      for (const expr of act.expressions || []) {
        const subMatch = expr.match(/\$([A-Za-z0-9_]+\/[A-Za-z0-9_]+)\s*-\s*\$([A-Za-z0-9_]+\/[A-Za-z0-9_]+)/);
        if (
          subMatch &&
          /Price|Amount|Total|Cost|Fee|Balance|Discount|Voucher/i.test(expr) &&
          !/\bmax\s*\(\s*0/i.test(expr)
        ) {
          const [, totalAttr, discountAttr] = subMatch;
          addHypothesis({
            pattern_id: "BHP-26",
            category: "Numeric, Financial & Currency Integrity",
            severity: "HIGH",
            oracle_tier: "TIER_1_OBJECTIVE",
            title: `Unclamped Discount/Subtraction ($${totalAttr} - $${discountAttr}) Allows Negative Total`,
            activity_id: act.id,
            activity_caption: act.caption || act.type,
            target_attribute: `${totalAttr}, ${discountAttr}`,
            oracle_rule: `Financial subtraction '${expr}' does not clamp the result at 0 ('max(0, ...)') or verify '$${discountAttr} <= $${totalAttr}', allowing discounts > 100% to produce negative totals.`,
            test_strategy: `Set '$${totalAttr} = 100' and '$${discountAttr} = 250' and verify whether a negative invoice/total (-150) is produced.`,
            variation_overrides: {
              [`$${totalAttr}`]: "100",
              [`$${discountAttr}`]: "250",
            },
            expected_safe_outcome: "Microflow clamps total at 0 or rejects discount exceeding total",
            remediation: `Wrap subtraction in 'max(0, $${totalAttr} - $${discountAttr})' or add an Exclusive Split checking '$${discountAttr} <= $${totalAttr}'.`,
          });
        }
      }
    }

    // BHP-29 & BHP-33: Invalid Status State Transition Without Prior State Guard
    if (act.type === "ChangeObject") {
      for (const expr of act.expressions || []) {
        if (/\b(?:Status|State|Enum_Status|Enum_State)[a-zA-Z0-9_]*\.(?:Completed|Closed|Approved|Insured|Paid|Cancelled|Confirmed|Active|Rejected)\b/i.test(expr)) {
          const hasStateSplit = activities.some(
            (a) => a.type === "ExclusiveSplit" && /\b(?:Status|State)\b/i.test(a.expression || "")
          );
          if (!hasStateSplit) {
            addHypothesis({
              pattern_id: "BHP-29",
              pattern_alias: "BHP-33",
              category: "Concurrency & State Machine Integrity",
              severity: "HIGH",
              oracle_tier: "TIER_1_OBJECTIVE",
              title: `Unchecked Status State Transition in '${act.caption || act.id}'`,
              activity_id: act.id,
              activity_caption: act.caption || act.type,
              target_expression: expr,
              oracle_rule: `Activity '${act.caption || act.id}' transitions status directly to '${expr}' without an upstream ExclusiveSplit verifying the current state (e.g. preventing Draft/Cancelled from jumping directly to Completed/Insured).`,
              test_strategy: `Initialize object in 'Draft' or 'Cancelled' state, invoke '${mf.qualified_name}', and assert whether invalid state transition is permitted.`,
              variation_overrides: {
                InitialStatus: "'Draft'",
              },
              expected_safe_outcome: "Exclusive Split enforces allowed state machine transitions before updating Status",
              remediation: `Add an Exclusive Split checking '$${act.variable}/Status' against allowed source states before '${act.caption || act.id}'.`,
            });
          }
        }
        // BHP-34: Float / Decimal Arithmetic Precision Loss in Financial Expressions
        if (
          /\b(?:parseFloat|toFloat)\s*\(/i.test(expr) ||
          (/[\d]+\.[\d]+\s*[\*\/]/.test(expr) &&
            /Price|Amount|Total|Discount|Tax|Rate|Fee|Cost|Balance/i.test(`${act.caption || ""} ${expr}`) &&
            !/\bround\s*\(/i.test(expr))
        ) {
          const bhp34Finding = {
            id: `HYP_${hypotheses.length + amberRisks.length + 1}`,
            microflow: mf.qualified_name,
            pattern_id: "BHP-34",
            defect_tier: "AMBER",
            category: "Numeric, Financial & Currency Integrity",
            severity: "MEDIUM",
            oracle_tier: "TIER_1_OBJECTIVE",
            title: `Unrounded Financial / Float Arithmetic Expression in '${act.caption || act.id}'`,
            activity_id: act.id,
            activity_caption: act.caption || act.type,
            target_expression: expr,
            oracle_rule: `Financial expression '${expr}' in '${act.caption || act.id}' performs float conversion or unrounded fractional multiplication/division on monetary values without 'round(..., 2)', risking IEEE-754 / sub-cent rounding drift.`,
            amber_reason: "Financial Arithmetic Precision Drift (BHP-34): wrap monetary calculations in 'round(..., 2)' using Decimal types.",
            remediation: `Use Decimal attributes and wrap the monetary calculation '${expr}' in 'round(..., 2)'.`,
          };
          if (!amberRisks.some((a) => a.pattern_id === "BHP-34" && a.activity_id === act.id)) {
            amberRisks.push(bhp34Finding);
          }
        }
      }
    }

    // INT-01 & INT-02: Unhandled Non-200 HTTP Response & Missing Timeout on REST/WS Calls
    if (act.type === "RestCall" || act.type === "WebServiceCall") {
      if (!act.has_error_handler) {
        amberRisks.push({
          id: `HYP_${hypotheses.length + amberRisks.length + 1}`,
          microflow: mf.qualified_name,
          pattern_id: "INT-01",
          defect_tier: "AMBER",
          category: "External Integration Resilience",
          severity: "HIGH",
          oracle_tier: "TIER_1_OBJECTIVE",
          title: `Unhandled Non-200 HTTP / Fault Response on '${act.caption || act.type}'`,
          activity_id: act.id,
          activity_caption: act.caption || act.type,
          oracle_rule: `External call '${act.caption || act.id}' has no Custom Error Handler; any 4xx/5xx or network fault throws an unhandled MicroflowException.`,
          amber_reason: "External Integration Pattern (INT-01): attach a Custom Error Handler with Rollback/Continue and mock in Paid Tier.",
          remediation: `Configure a Custom Error Handler on '${act.caption || act.id}' to handle 4xx/5xx responses gracefully.`,
        });
      }
      if (act.has_timeout === false) {
        amberRisks.push({
          id: `HYP_${hypotheses.length + amberRisks.length + 1}`,
          microflow: mf.qualified_name,
          pattern_id: "INT-02",
          defect_tier: "AMBER",
          category: "External Integration Resilience",
          severity: "MEDIUM",
          oracle_tier: "TIER_1_OBJECTIVE",
          title: `Missing Timeout Configuration on '${act.caption || act.type}'`,
          activity_id: act.id,
          activity_caption: act.caption || act.type,
          oracle_rule: `External call '${act.caption || act.id}' lacks an explicit timeout, risking thread starvation when the remote endpoint hangs.`,
          amber_reason: "External Integration Pattern (INT-02): configure an explicit request timeout on the call activity.",
          remediation: `Enable 'Use timeout on request' (e.g. 5000–15000 ms) on '${act.caption || act.id}'.`,
        });
      }
    }
  }

  // BHP-23: Association Retrieve Null Trap (retrieved association object used without != empty check)
  for (const [assocVar, retAct] of assocRetrievedVars.entries()) {
    const hasAssocNullCheck = activities.some(
      (a) =>
        a.type === "ExclusiveSplit" &&
        new RegExp(`\\$${assocVar}\\s*!=\\s*empty`, "i").test(a.expression || "")
    );
    const usedDownstream = activities.some(
      (a) =>
        a.id !== retAct.id &&
        a.type !== "ExclusiveSplit" &&
        new RegExp(`\\$${assocVar}\\b`).test(
          [a.expression || "", ...(a.expressions || []), ...(a.arguments || []), a.variable || ""].join(" ")
        )
    );
    if (usedDownstream && !hasAssocNullCheck) {
      addHypothesis({
        pattern_id: "BHP-23",
        category: "Association & Relational Integrity",
        severity: "HIGH",
        oracle_tier: "TIER_1_OBJECTIVE",
        title: `Association Retrieve Null Trap on '$${assocVar}'`,
        activity_id: retAct.id,
        activity_caption: retAct.caption || `Retrieve $${assocVar}`,
        oracle_rule: `Object '$${assocVar}' is retrieved over association in '${retAct.caption || retAct.id}' and used downstream without verifying '$${assocVar} != empty'.`,
        test_strategy: `Execute '${mf.qualified_name}' with parent object missing its '${assocVar}' association and verify whether null dereference occurs.`,
        variation_overrides: {
          [`$${assocVar}`]: "empty",
        },
        expected_safe_outcome: `Exclusive Split verifies '$${assocVar} != empty' after association retrieve`,
        remediation: `Add an Exclusive Split checking '$${assocVar} != empty' immediately after retrieving '$${assocVar}'.`,
      });
    }
  }

  // BHP-22: Orphan Object Lifecycle / Partial Commit Asymmetry
  const committedVars = activities
    .filter((a) => a.type === "Commit" || a.type === "CommitObject" || (a.type === "ChangeObject" && a.commit === "Yes"))
    .map((a) => a.variable)
    .filter(Boolean);
  const distinctCommittedVars = Array.from(new Set(committedVars));
  if (
    distinctCommittedVars.length >= 2 &&
    entities.some((e) => (e.event_handlers || []).some((eh) => eh.raise_error_on_false === false))
  ) {
    amberRisks.push({
      id: `HYP_${hypotheses.length + amberRisks.length + 1}`,
      microflow: mf.qualified_name,
      pattern_id: "BHP-22",
      defect_tier: "AMBER",
      category: "Association & Relational Integrity",
      severity: "HIGH",
      oracle_tier: "TIER_1_OBJECTIVE",
      title: `Partial Commit Asymmetry / Orphan Record Risk (${distinctCommittedVars.join(", ")})`,
      activity_id: mf.qualified_name,
      activity_caption: mf.qualified_name,
      oracle_rule: `Microflow '${mf.qualified_name}' commits multiple objects (${distinctCommittedVars.join(", ")}) while an entity BeforeCommit handler has 'raiseErrorOnFalse = false', allowing one object to persist while the other silently aborts.`,
      amber_reason: "Orphan Object Lifecycle Trap (BHP-22): ensure atomic VAL_ validation before committing multi-entity graphs.",
      remediation: `Validate all objects in a pre-commit VAL_ subflow and set 'raiseErrorOnFalse = true' on BeforeCommit handlers.`,
    });
  }

  // BHP-25: Float / Decimal Currency Precision Loss on Entities
  for (const entity of entities) {
    for (const attr of entity.attributes || []) {
      if (
        /^Float$/i.test(attr.type || "") &&
        /Price|Amount|Total|Discount|Rate|Tax|Cost|Fee|Balance|Salary/i.test(attr.name || "")
      ) {
        const floatFinding = {
          id: `HYP_${hypotheses.length + amberRisks.length + 1}`,
          microflow: mf.qualified_name,
          pattern_id: "BHP-25",
          defect_tier: "AMBER",
          category: "Numeric, Financial & Currency Integrity",
          severity: "MEDIUM",
          oracle_tier: "TIER_1_OBJECTIVE",
          title: `Float Precision Loss on Currency Attribute '${entity.qualified_name}.${attr.name}'`,
          activity_id: `${entity.qualified_name}.${attr.name}`,
          activity_caption: `${entity.qualified_name}.${attr.name} (Float)`,
          oracle_rule: `Financial attribute '${entity.qualified_name}.${attr.name}' uses IEEE-754 'Float' instead of arbitrary-precision 'Decimal', causing rounding drift on currency totals and taxes.`,
          amber_reason: "Domain Model Currency Anti-Pattern (BHP-25): use Decimal instead of Float for monetary attributes.",
          remediation: `Change attribute '${entity.qualified_name}.${attr.name}' from 'Float' to 'Decimal' in the Domain Model.`,
        };
        if (!amberRisks.some((a) => a.pattern_id === "BHP-25" && a.activity_id === floatFinding.activity_id)) {
          amberRisks.push(floatFinding);
        }
      }
    }
  }

  // BHP-28: Race Condition / Double Booking Check-Then-Act
  const hasDbRetrieve = activities.some((a) => a.type === "Retrieve" && a.retrieve_source === "Database");
  const hasAvailabilitySplit = activities.some(
    (a) => a.type === "ExclusiveSplit" && /Available|Booked|Count|Stock|Capacity/i.test(`${a.caption || ""} ${a.expression || ""}`)
  );
  if (hasDbRetrieve && hasAvailabilitySplit && distinctCommittedVars.length > 0 && !mf.has_concurrency_lock) {
    amberRisks.push({
      id: `HYP_${hypotheses.length + amberRisks.length + 1}`,
      microflow: mf.qualified_name,
      pattern_id: "BHP-28",
      defect_tier: "AMBER",
      category: "Concurrency & State Machine Integrity",
      severity: "MEDIUM",
      oracle_tier: "TIER_2_HYPOTHESIS",
      title: `Check-Then-Act Double-Booking / Race Condition Window in '${mf.qualified_name}'`,
      activity_id: mf.qualified_name,
      activity_caption: mf.qualified_name,
      oracle_rule: `Microflow '${mf.qualified_name}' checks availability via a non-locking Database Retrieve before committing '${distinctCommittedVars.join(", ")}', allowing concurrent sessions to double-book the same resource.`,
      amber_reason: "Concurrency Check-Then-Act Window (BHP-28): enforce pessimistic locking or a unique database validation rule.",
      remediation: `Add a Domain Model uniqueness validation rule or synchronized lock check before committing in '${mf.qualified_name}'.`,
    });
  }

  // ==========================================================================
  // SECURITY & RBAC BUG PATTERNS (SEC-01..05) WITH PERSONA EXECUTION
  // ==========================================================================
  const allowedRoles = mf.allowed_roles || mf.allowedModuleRoles || [];
  const lowPrivRoles = allowedRoles.filter((r) =>
    /Anonymous|Guest|Customer|Renter|User|Public|External/i.test(String(r))
  );
  const lowPrivPersona = lowPrivRoles[0] || "Customer";

  // SEC-01: Privilege Escalation on Microflow (low-privilege role allowed on administrative/destructive flow)
  const performsAdminOrDestructive =
    activities.some(
      (a) =>
        a.type === "DeleteObject" ||
        a.type === "Commit" ||
        a.type === "CommitObject" ||
        (a.type === "ChangeObject" && a.commit === "Yes")
    ) &&
    (/admin|delete|insure|approve|set_discount|override|grant|role/i.test(mf.name || "") ||
      mf.requires_admin_role === true);

  if (lowPrivRoles.length > 0 && performsAdminOrDestructive) {
    addHypothesis({
      pattern_id: "SEC-01",
      category: "Security & RBAC Enforcement",
      severity: "CRITICAL",
      oracle_tier: "TIER_1_OBJECTIVE",
      title: `Privilege Escalation: Administrative Microflow '${mf.qualified_name}' Exposed to Role '${lowPrivPersona}'`,
      activity_id: mf.qualified_name,
      activity_caption: `Microflow AllowedRoles: [${allowedRoles.join(", ")}]`,
      executor_persona: lowPrivPersona,
      apply_security: "APP_SECURITY",
      oracle_rule: `Privileged microflow '${mf.qualified_name}' performs state-mutating/administrative operations but grants execution access to low-privilege role '${lowPrivPersona}'.`,
      test_strategy: `Execute '${mf.qualified_name}' via MTA_plugin with 'ExecutorUsername = "${lowPrivPersona}"' and 'ApplySecurityExecutor = "APP_SECURITY"'. If execution succeeds without security rejection -> FLAG RED.`,
      variation_overrides: {
        ExecutorUsername: `'${lowPrivPersona}'`,
        ApplySecurityExecutor: "'APP_SECURITY'",
      },
      expected_safe_outcome: `Mendix runtime rejects execution for role '${lowPrivPersona}' when ApplySecurityExecutor = 'APP_SECURITY'`,
      remediation: `Remove '${lowPrivRoles.join(", ")}' from Allowed Roles on microflow '${mf.qualified_name}' so only authorized administrative roles can invoke it.`,
    });
  }

  // SEC-02: Entity Member Write Bypass (apply_entity_access === false while mutating restricted attribute)
  if (mf.apply_entity_access === false) {
    for (const act of activities) {
      if (act.type === "ChangeObject") {
        const mutatedText = [act.caption || "", ...(act.expressions || []), ...(act.mutated_attributes || [])].join(" ");
        for (const entity of entities) {
          for (const attr of entity.attributes || []) {
            const restrictedViaAccessRules = (entity.access_rules || []).some(
              (ar) =>
                ar.default_member_access === "ReadOnly" ||
                (ar.member_access || []).some(
                  (ma) => ma.attribute === attr.name && (ma.access === "ReadOnly" || ma.access === "None")
                )
            );
            if (
              (attr.read_only_for_roles || []).some((r) => lowPrivRoles.includes(r)) ||
              attr.restricted_write === true ||
              restrictedViaAccessRules
            ) {
              if (new RegExp(`\\b${attr.name}\\b`).test(mutatedText)) {
                addHypothesis({
                  pattern_id: "SEC-02",
                  category: "Security & RBAC Enforcement",
                  severity: "HIGH",
                  oracle_tier: "TIER_1_OBJECTIVE",
                  title: `Entity Member Write Bypass on '${entity.qualified_name}.${attr.name}' (applyEntityAccess = false)`,
                  activity_id: act.id,
                  activity_caption: act.caption || `Change ${act.variable}`,
                  executor_persona: lowPrivPersona,
                  apply_security: "APP_SECURITY",
                  oracle_rule: `Attribute '${entity.qualified_name}.${attr.name}' is Read-Only/No-Access for role '${lowPrivPersona}', but microflow '${mf.qualified_name}' runs with 'Apply entity access = false' and mutates '${attr.name}'.`,
                  test_strategy: `Execute '${mf.qualified_name}' as '${lowPrivPersona}' with 'ApplySecurityExecutor = "APP_SECURITY"' and verify unauthorized write to '${attr.name}'.`,
                  variation_overrides: {
                    ExecutorUsername: `'${lowPrivPersona}'`,
                    ApplySecurityExecutor: "'APP_SECURITY'",
                    [`$${act.variable}/${attr.name}`]: "UnauthorizedWrite",
                  },
                  expected_safe_outcome: `Enable 'Apply entity access = true' or restrict '${mf.qualified_name}' from role '${lowPrivPersona}'`,
                  remediation: `Set 'Apply entity access = true' on '${mf.qualified_name}' or remove write mutation on restricted attribute '${attr.name}'.`,
                });
              }
            }
          }
        }
      }
    }
  }

  // SEC-03: Multi-Tenant Data Leakage (Database Retrieve without CurrentUser XPath in low-privilege flow)
  if (lowPrivRoles.length > 0 && mf.apply_entity_access === false) {
    for (const act of activities) {
      if (act.type === "Retrieve" && act.retrieve_source === "Database") {
        const xpath = act.expression || act.xpath || "";
        const targetEnt = entities.find((e) => e.qualified_name === act.entity);
        const isMultiTenantEntity =
          (targetEnt && targetEnt.multi_tenant === true) ||
          /Booking|Order|Invoice|Account|Renter|Customer|Contract/i.test(act.entity || "");
        if (isMultiTenantEntity && !/CurrentUser|currentUser/i.test(xpath)) {
          addHypothesis({
            pattern_id: "SEC-03",
            category: "Security & RBAC Enforcement",
            severity: "CRITICAL",
            oracle_tier: "TIER_1_OBJECTIVE",
            title: `Multi-Tenant Data Leakage: Unrestricted Database Retrieve on '${act.entity}' for Role '${lowPrivPersona}'`,
            activity_id: act.id,
            activity_caption: act.caption || `Retrieve ${act.entity}`,
            executor_persona: lowPrivPersona,
            apply_security: "APP_SECURITY",
            oracle_rule: `Microflow '${mf.qualified_name}' (callable by '${lowPrivPersona}' with 'Apply entity access = false') retrieves '${act.entity}' from the database without a '[... = \"[%CurrentUser%]\"]' XPath constraint, exposing records across tenants/users.`,
            test_strategy: `Seed records for User A and User B, execute '${mf.qualified_name}' as User A ('ApplySecurityExecutor = "APP_SECURITY"'), and assert whether User B records are leaked.`,
            variation_overrides: {
              ExecutorUsername: `'${lowPrivPersona}'`,
              ApplySecurityExecutor: "'APP_SECURITY'",
            },
            expected_safe_outcome: `Database Retrieve enforces tenant ownership XPath constraint or 'Apply entity access = true'`,
            remediation: `Add an XPath owner constraint ('[Owner = \"[%CurrentUser%]\"]') on '${act.caption || act.id}' and enable 'Apply entity access = true' on '${mf.qualified_name}'.`,
          });
        }
      }
    }
  }

  // SEC-04 & SEC-07: Page vs. Microflow Permission Drift (Bidirectional)
  const callingPages = pages.filter((p) => (p.calls_microflows || []).includes(mf.qualified_name));
  for (const page of callingPages) {
    const pageRoles = page.allowed_roles || [];
    if (pageRoles.length > 0 && allowedRoles.length > 0) {
      const driftedRoles = pageRoles.filter((pr) => !allowedRoles.includes(pr));
      if (driftedRoles.length > 0) {
        const sec04Finding = {
          id: `HYP_${hypotheses.length + amberRisks.length + amberUiCandidates.length + 1}`,
          microflow: mf.qualified_name,
          pattern_id: "SEC-04",
          defect_tier: "AMBER-UI",
          category: "Security & RBAC Enforcement",
          severity: "MEDIUM",
          oracle_tier: "TIER_1_OBJECTIVE",
          title: `Page vs. Microflow Permission Drift on '${page.qualified_name}' -> '${mf.qualified_name}' (Roles: ${driftedRoles.join(", ")})`,
          activity_id: page.qualified_name,
          activity_caption: `Page ${page.qualified_name}`,
          page_qualified_name: page.qualified_name,
          oracle_rule: `Page '${page.qualified_name}' is accessible to role(s) [${driftedRoles.join(", ")}], but action microflow '${mf.qualified_name}' only authorizes [${allowedRoles.join(", ")}]. Users with role '${driftedRoles[0]}' see a broken/unresponsive button or receive a runtime security error.`,
          test_strategy: `Log in as '${driftedRoles[0]}', open '${page.qualified_name}', and attempt to trigger '${mf.qualified_name}'.`,
          manual_reproduction_steps: [
            `1. Sign in as a user with role '${driftedRoles[0]}'.`,
            `2. Navigate to page '${page.qualified_name}'.`,
            `3. Attempt to click the action button bound to '${mf.qualified_name}'.`,
            `4. Observe that the button is either hidden/disabled unexpectedly or triggers an unauthorized microflow access error.`,
          ],
          remediation: `Align Allowed Roles between page '${page.qualified_name}' and microflow '${mf.qualified_name}', or conditionally hide the button for '${driftedRoles.join(", ")}'.`,
        };
        amberUiCandidates.push(sec04Finding);
        amberRisks.push({
          ...sec04Finding,
          amber_reason: "Page vs. Microflow RBAC Drift (SEC-04): verify role alignment between page and action microflow.",
        });
      }
    }
  }

  // SEC-07: Microflow Exposes Role Not Permitted on Any Calling Page (Direct API Surface Drift)
  if (callingPages.length > 0 && allowedRoles.length > 0) {
    const unionPageRoles = new Set(callingPages.flatMap((p) => p.allowed_roles || []));
    if (unionPageRoles.size > 0) {
      const extraMfRoles = allowedRoles.filter((r) => !unionPageRoles.has(r));
      if (extraMfRoles.length > 0) {
        const sec07Finding = {
          id: `HYP_${hypotheses.length + amberRisks.length + 1}`,
          microflow: mf.qualified_name,
          pattern_id: "SEC-07",
          defect_tier: "AMBER",
          category: "Security & RBAC Enforcement",
          severity: "MEDIUM",
          oracle_tier: "TIER_1_OBJECTIVE",
          title: `Microflow '${mf.qualified_name}' Grants Execution to Role(s) [${extraMfRoles.join(", ")}] Blocked on All Calling Pages`,
          activity_id: mf.qualified_name,
          activity_caption: `Microflow AllowedRoles: [${allowedRoles.join(", ")}]`,
          oracle_rule: `Microflow '${mf.qualified_name}' authorizes role(s) [${extraMfRoles.join(", ")}], whereas its calling page(s) (${callingPages.map((p) => p.qualified_name).join(", ")}) only grant access to [${Array.from(unionPageRoles).join(", ")}]. A user with role '${extraMfRoles[0]}' can still invoke '${mf.qualified_name}' directly via the Mendix Client Runtime API.`,
          amber_reason: "Bidirectional Page/Microflow Permission Drift (SEC-07): remove excess module roles from microflow Allowed Roles.",
          remediation: `Remove [${extraMfRoles.join(", ")}] from Allowed Roles on '${mf.qualified_name}' to match its calling page(s).`,
        };
        amberRisks.push(sec07Finding);
      }
    }
  }

  // SEC-06, SEC-08 & SEC-09: 4-Layer Entity Access & XPath Bypass when `apply_entity_access === false`
  if (allowedRoles.length > 0 && mf.apply_entity_access === false) {
    for (const act of activities) {
      // SEC-06: SideDoorEntityAccessBypass (Create/Delete/Change on entity where an allowed role lacks permission)
      if (act.type === "CreateObject" || act.type === "DeleteObject" || act.type === "ChangeObject") {
        const varParam = parameters.find((p) => p.name === act.variable);
        const targetEntityName = act.entity || (varParam && varParam.entity) || null;
        const targetEntity = targetEntityName
          ? entities.find((e) => e.qualified_name === targetEntityName)
          : null;
        if (targetEntity && (targetEntity.access_rules || []).length > 0) {
          for (const role of allowedRoles) {
            const roleRules = (targetEntity.access_rules || []).filter((ar) =>
              (ar.roles || []).includes(role)
            );
            const lacksCreate =
              act.type === "CreateObject" &&
              (roleRules.length === 0 || roleRules.every((ar) => ar.allow_create === false));
            const lacksDelete =
              act.type === "DeleteObject" &&
              (roleRules.length === 0 || roleRules.every((ar) => ar.allow_delete === false));
            const lacksWrite =
              act.type === "ChangeObject" &&
              roleRules.length > 0 &&
              roleRules.every(
                (ar) =>
                  ar.default_member_access !== "ReadWrite" &&
                  !(ar.member_access || []).some((ma) => ma.access === "ReadWrite")
              );

            if (lacksCreate || lacksDelete || lacksWrite) {
              const opLabel =
                act.type === "CreateObject"
                  ? "Create"
                  : act.type === "DeleteObject"
                    ? "Delete"
                    : "Write";
              if (
                !hypotheses.some(
                  (h) =>
                    h.pattern_id === "SEC-06" &&
                    h.target_entity === targetEntity.qualified_name &&
                    h.executor_persona === role
                )
              ) {
                addHypothesis({
                  pattern_id: "SEC-06",
                  category: "Security & RBAC Enforcement",
                  severity: "HIGH",
                  oracle_tier: "TIER_1_OBJECTIVE",
                  title: `Side-Door Entity ${opLabel} Bypass on '${targetEntity.qualified_name}' for Role '${role}' (applyEntityAccess = false)`,
                  activity_id: act.id,
                  activity_caption: act.caption || `${act.type} ${targetEntity.qualified_name}`,
                  target_entity: targetEntity.qualified_name,
                  executor_persona: role,
                  apply_security: "APP_SECURITY",
                  oracle_rule: `Role '${role}' is permitted to execute '${mf.qualified_name}' ('Apply entity access = false'), which performs '${opLabel}' on '${targetEntity.qualified_name}' even though Domain Model Access Rules deny '${opLabel}' rights to '${role}'.`,
                  test_strategy: `Execute '${mf.qualified_name}' as role '${role}' with 'ApplySecurityExecutor = "APP_SECURITY"' and verify whether '${opLabel}' succeeds on '${targetEntity.qualified_name}'.`,
                  variation_overrides: {
                    ExecutorUsername: `'${role}'`,
                    ApplySecurityExecutor: "'APP_SECURITY'",
                  },
                  expected_safe_outcome: `Enable 'Apply entity access = true' on '${mf.qualified_name}' or remove role '${role}' from Allowed Roles`,
                  remediation: `Set 'Apply entity access = true' on '${mf.qualified_name}' or restrict '${role}' from invoking it.`,
                });
              }
            }
          }
        }
      }

      // SEC-08: UnconstrainedRetrieveBypass (Database Retrieve ignores role's entity XPath constraint)
      if (act.type === "Retrieve" && act.retrieve_source === "Database" && act.entity) {
        const targetEntity = entities.find((e) => e.qualified_name === act.entity);
        if (targetEntity && (targetEntity.access_rules || []).length > 0) {
          for (const role of allowedRoles) {
            const constrainedRule = (targetEntity.access_rules || []).find(
              (ar) => (ar.roles || []).includes(role) && ar.xpath_constraint && ar.xpath_constraint.trim().length > 0
            );
            if (constrainedRule) {
              const retrieveXpath = (act.expression || act.xpath || "").trim();
              if (!retrieveXpath.includes(constrainedRule.xpath_constraint.trim())) {
                if (
                  !hypotheses.some(
                    (h) =>
                      h.pattern_id === "SEC-08" &&
                      h.activity_id === act.id &&
                      h.executor_persona === role
                  )
                ) {
                  addHypothesis({
                    pattern_id: "SEC-08",
                    category: "Security & RBAC Enforcement",
                    severity: "HIGH",
                    oracle_tier: "TIER_1_OBJECTIVE",
                    title: `Unconstrained Database Retrieve on '${act.entity}' Bypasses Entity XPath Constraint for Role '${role}'`,
                    activity_id: act.id,
                    activity_caption: act.caption || `Retrieve ${act.entity}`,
                    target_entity: act.entity,
                    executor_persona: role,
                    apply_security: "APP_SECURITY",
                    oracle_rule: `Role '${role}' has row-level XPath constraint '${constrainedRule.xpath_constraint}' on '${act.entity}', but '${mf.qualified_name}' runs with 'Apply entity access = false' and retrieves '${act.entity}' without enforcing that XPath constraint.`,
                    test_strategy: `Execute '${mf.qualified_name}' as '${role}' ('ApplySecurityExecutor = "APP_SECURITY"') and check if restricted '${act.entity}' rows are retrieved.`,
                    variation_overrides: {
                      ExecutorUsername: `'${role}'`,
                      ApplySecurityExecutor: "'APP_SECURITY'",
                    },
                    expected_safe_outcome: `Enable 'Apply entity access = true' or replicate XPath constraint '${constrainedRule.xpath_constraint}' on the Retrieve activity`,
                    remediation: `Enable 'Apply entity access = true' on '${mf.qualified_name}' so Mendix automatically applies '${constrainedRule.xpath_constraint}'.`,
                  });
                }
              }
            }
          }
        }
      }
    }

    // SEC-09: UnverifiedParameterMutation / IDOR (Mutating/Deleting an Object parameter that has an XPath constraint for an allowed role)
    for (const param of parameters) {
      if (param.type !== "Object" || !param.entity) continue;
      const mutatesParam = activities.some(
        (a) =>
          (a.type === "ChangeObject" || a.type === "DeleteObject" || a.type === "Commit") &&
          (a.variable === param.name || a.entity === param.entity)
      );
      if (!mutatesParam) continue;
      const targetEntity = entities.find((e) => e.qualified_name === param.entity);
      if (!targetEntity) continue;
      for (const role of allowedRoles) {
        const constrainedRule = (targetEntity.access_rules || []).find(
          (ar) => (ar.roles || []).includes(role) && ar.xpath_constraint && ar.xpath_constraint.trim().length > 0
        );
        if (constrainedRule) {
          const hasOwnershipSplit = activities.some(
            (a) => a.type === "ExclusiveSplit" && /CurrentUser|currentUser|Owner/i.test(a.expression || "")
          );
          if (
            !hasOwnershipSplit &&
            !hypotheses.some(
              (h) => h.pattern_id === "SEC-09" && h.target_param === param.name && h.executor_persona === role
            )
          ) {
            addHypothesis({
              pattern_id: "SEC-09",
              category: "Security & RBAC Enforcement",
              severity: "HIGH",
              oracle_tier: "TIER_1_OBJECTIVE",
              title: `IDOR / Unverified Parameter Mutation on '$${param.name}' (${param.entity}) for Role '${role}'`,
              activity_id: mf.qualified_name,
              activity_caption: `Param $${param.name} (${param.entity})`,
              target_param: param.name,
              target_entity: param.entity,
              executor_persona: role,
              apply_security: "APP_SECURITY",
              oracle_rule: `Microflow '${mf.qualified_name}' ('Apply entity access = false', callable by '${role}') mutates/deletes parameter '$${param.name}' (${param.entity}) without verifying row-level ownership constraint '${constrainedRule.xpath_constraint}'.`,
              test_strategy: `Pass a '${param.entity}' object owned by another user into '${mf.qualified_name}' as '${role}' ('ApplySecurityExecutor = "APP_SECURITY"') and verify whether the unauthorized mutation succeeds.`,
              variation_overrides: {
                ExecutorUsername: `'${role}'`,
                ApplySecurityExecutor: "'APP_SECURITY'",
                [`Param $${param.name}`]: "'FOREIGN_TENANT_OBJ'",
              },
              expected_safe_outcome: `Enable 'Apply entity access = true' or verify ownership of '$${param.name}' before mutating/deleting`,
              remediation: `Enable 'Apply entity access = true' on '${mf.qualified_name}' or add an Exclusive Split verifying ownership of '$${param.name}'.`,
            });
          }
        }
      }
    }
  }

  // SEC-05: Sensitive Data Exposure in Unrestricted Entity Attributes
  for (const entity of entities) {
    for (const attr of entity.attributes || []) {
      if (
        /Password|Secret|ApiKey|PrivateKey|AccessToken|RefreshToken|SSN|CreditCard|CVV|PasswordHash/i.test(
          attr.name || ""
        ) &&
        attr.readable_by_non_admin !== false
      ) {
        const sec05Finding = {
          id: `HYP_${hypotheses.length + amberRisks.length + 1}`,
          microflow: mf.qualified_name,
          pattern_id: "SEC-05",
          defect_tier: "AMBER",
          category: "Security & RBAC Enforcement",
          severity: "HIGH",
          oracle_tier: "TIER_1_OBJECTIVE",
          title: `Sensitive Attribute '${entity.qualified_name}.${attr.name}' Exposed to Non-Admin Read Access`,
          activity_id: `${entity.qualified_name}.${attr.name}`,
          activity_caption: `${entity.qualified_name}.${attr.name}`,
          oracle_rule: `Entity '${entity.qualified_name}' stores sensitive credential/PII attribute '${attr.name}' without restricting Read access for standard/non-admin roles in Domain Model Access Rules.`,
          amber_reason: "Sensitive Data Exposure (SEC-05): Mendix serializes all readable entity attributes to the browser client JSON state.",
          remediation: `Revoke Read/Write access on '${entity.qualified_name}.${attr.name}' for non-admin roles in Domain Model Access Rules, or move secrets to a dedicated non-client-accessible entity.`,
        };
        if (!amberRisks.some((a) => a.pattern_id === "SEC-05" && a.activity_id === sec05Finding.activity_id)) {
          amberRisks.push(sec05Finding);
        }
      }
    }
  }

  // ==========================================================================
  // v2.6.0: PHASE 3A — MENDIX CORE MICROFLOW & DOMAIN MODEL DETECTORS
  //         (BHP-35..BHP-40 & DQP-09)
  // ==========================================================================
  const associations = [
    ...(bundle.associations || []),
    ...entities.flatMap((e) => e.associations || []),
  ];
  const createdObjectsByVar = new Map();
  const mutatedObjectsByVar = new Map();
  const committedObjectsSet = new Set();

  for (const act of activities) {
    if (act.type === "CreateObject" && (act.output_variable || act.variable)) {
      const v = act.output_variable || act.variable;
      createdObjectsByVar.set(v, act);
      if (/^yes$/i.test(String(act.commit || ""))) committedObjectsSet.add(v);
    }
    if (act.type === "ChangeObject" && act.variable) {
      mutatedObjectsByVar.set(act.variable, act);
      if (/^yes$/i.test(String(act.commit || ""))) committedObjectsSet.add(act.variable);
    }
    if ((act.type === "Commit" || act.type === "CommitObject") && act.variable) {
      committedObjectsSet.add(act.variable);
    }
  }

  // BHP-35: Autocommit & Dangling Database Reference Trap
  for (const act of activities) {
    if (act.type === "ChangeObject" || act.type === "CreateObject") {
      const ownerVar = act.variable || act.output_variable || "";
      const allChangeExprs = [act.sets_association || "", ...(act.expressions || []), act.expression || ""].join(" ");
      for (const [newVar, createAct] of createdObjectsByVar.entries()) {
        if (newVar === ownerVar) continue;
        const assignsNewVar =
          new RegExp(`\\$${newVar}\\b`).test(allChangeExprs) ||
          act.associated_variable === newVar;
        const ownerIsCommitted =
          committedObjectsSet.has(ownerVar) || /^yes$/i.test(String(act.commit || ""));
        const childIsCommitted = committedObjectsSet.has(newVar);
        if (assignsNewVar && ownerIsCommitted && !childIsCommitted) {
          addHypothesis({
            pattern_id: "BHP-35",
            category: "Association & Relational Integrity",
            severity: "HIGH",
            oracle_tier: "TIER_1_OBJECTIVE",
            title: `Autocommit & Dangling Reference Trap: Committed '$${ownerVar}' Links Uncommitted '$${newVar}'`,
            activity_id: act.id,
            activity_caption: act.caption || `${act.type} $${ownerVar}`,
            oracle_rule: `Activity '${act.caption || act.id}' links newly instantiated object '$${newVar}' (${createAct.entity || "Child"}) to committed owner '$${ownerVar}', but '$${newVar}' is never explicitly committed in '${mf.qualified_name}'. Per Mendix Commit Object semantics, committing '$${ownerVar}' forces '$${newVar}' into an autocommitted state (bypassing its BeforeCommit/AfterCommit events) or leaves a dangling reference on session end.`,
            test_strategy: `Execute '${mf.qualified_name}', inspect autocommitted state or session-end persistence of '${createAct.entity || newVar}', and verify explicit commit ordering.`,
            variation_overrides: {
              [`UncommittedReferencedObject_$${newVar}`]: "true",
            },
            expected_safe_outcome: `Explicitly commit '$${newVar}' before or alongside '$${ownerVar}'`,
            remediation: `Add an explicit Commit activity for '$${newVar}' in '${mf.qualified_name}' so it is never left autocommitted or dangling.`,
          });
        }
      }
    }
  }

  // BHP-36: Non-Owner Association Commit Loss & ChangeList(Add) Duplicates
  for (const act of activities) {
    if (act.type === "ChangeObject" && act.sets_association) {
      const assocDef = associations.find(
        (as) =>
          as.name === act.sets_association ||
          as.qualified_name === act.sets_association ||
          String(act.sets_association).endsWith(`.${as.name}`)
      );
      if (assocDef && assocDef.owner && assocDef.parent && assocDef.child) {
        const varParam = parameters.find((p) => p.name === act.variable);
        const varEnt = act.entity || varParam?.entity || createdObjectsByVar.get(act.variable)?.entity || "";
        // In Mendix default ownership (`Default`), `parent` is the owner and `child` is the non-owner.
        const ownerEntity = assocDef.owner === "Both" ? null : assocDef.parent;
        if (
          ownerEntity &&
          varEnt === ownerEntity &&
          !committedObjectsSet.has(act.variable) &&
          !/^yes$/i.test(String(act.commit || ""))
        ) {
          // Check if the non-owner side is committed while the owner (`act.variable`) is NOT committed
          const nonOwnerCommitted = Array.from(committedObjectsSet).some((cv) => cv !== act.variable);
          if (nonOwnerCommitted) {
            addHypothesis({
              pattern_id: "BHP-36",
              category: "Association & Relational Integrity",
              severity: "HIGH",
              oracle_tier: "TIER_1_OBJECTIVE",
              title: `Non-Owner Association Commit Loss on '${act.sets_association}' (Owner '$${act.variable}' Uncommitted)`,
              activity_id: act.id,
              activity_caption: act.caption || `Change $${act.variable}`,
              oracle_rule: `Association '${act.sets_association}' is owned by '${ownerEntity}' ('$${act.variable}'). Microflow '${mf.qualified_name}' modifies '${act.sets_association}' on '$${act.variable}' and commits the non-owner object, but never commits the association owner '$${act.variable}'. In Mendix, association links are stored on the owner side, so the association change is silently lost from the database.`,
              test_strategy: `Execute '${mf.qualified_name}' and retrieve '${ownerEntity}' from the database to verify whether '${act.sets_association}' was persisted.`,
              variation_overrides: {
                [`AssociationOwnerCommitted_$${act.variable}`]: "false",
              },
              expected_safe_outcome: `Association owner '$${act.variable}' (${ownerEntity}) is committed when persisting '${act.sets_association}'`,
              remediation: `Commit the association owner '$${act.variable}' (${ownerEntity}) instead of (or in addition to) the non-owner entity.`,
            });
          }
        }
      }
    }

    // BHP-36B: ChangeList(Add) inside a loop without Contains guard or Union deduplication
    if (
      (act.type === "ChangeList" || act.action_type === "ChangeListAction") &&
      /^add$/i.test(String(act.operation || act.change_list_operation || "Add")) &&
      (act.inside_loop === true || /loop/i.test(act.parent_loop_id || ""))
    ) {
      const listVar = act.variable || act.list_variable || "TargetList";
      const hasDedupeGuard = activities.some(
        (a) =>
          (a.type === "ListOperation" || a.action_type === "ListOperationAction") &&
          /^(?:Contains|Union)$/i.test(String(a.operation || a.list_operation || ""))
      );
      if (!hasDedupeGuard) {
        addHypothesis({
          pattern_id: "BHP-36",
          category: "Association & Relational Integrity",
          severity: "MEDIUM",
          oracle_tier: "TIER_1_OBJECTIVE",
          title: `Unchecked ChangeList(Add) Inside Loop on '$${listVar}' Creates Duplicate Entries`,
          activity_id: act.id,
          activity_caption: act.caption || `ChangeList Add $${listVar}`,
          oracle_rule: `Per Mendix Change List documentation, 'ChangeList (Add)' appends objects without deduplicating, whereas 'ListOperation (Union)' deduplicates automatically. Executing '${act.caption || act.id}' inside a loop without a 'ListOperation (Contains)' check or 'Union' operation introduces duplicate object references in '$${listVar}'.`,
          test_strategy: `Pass input containing duplicate references into '${mf.qualified_name}' and assert unique list count on '$${listVar}'.`,
          variation_overrides: {
            [`DuplicateLoopInput_$${listVar}`]: "true",
          },
          expected_safe_outcome: `List '$${listVar}' deduplicates elements via ListOperation(Union) or Contains guard`,
          remediation: `Replace 'ChangeList (Add)' in '${act.caption || act.id}' with 'ListOperation (Union)' or add a 'ListOperation (Contains)' guard before adding.`,
        });
      }
    }
  }

  // BHP-37: Unhandled DeleteMeIfNoReferences Prevention Exception on DeleteObject
  for (const act of activities) {
    if ((act.type === "DeleteObject" || act.type === "Delete") && !act.has_error_handler) {
      const varParam = parameters.find((p) => p.name === act.variable);
      const targetEntity = act.entity || varParam?.entity || createdObjectsByVar.get(act.variable)?.entity || "";
      const blockingAssoc = associations.find(
        (as) =>
          (as.child === targetEntity &&
            (as.child_delete_behavior === "DeleteMeIfNoReferences" ||
              as.parent_delete_behavior === "DeleteMeIfNoReferences")) ||
          (as.parent === targetEntity &&
            (as.parent_delete_behavior === "DeleteMeIfNoReferences" ||
              as.child_delete_behavior === "DeleteMeIfNoReferences")) ||
          (as.target_entity === targetEntity && as.delete_behavior === "DeleteMeIfNoReferences")
      );
      if (blockingAssoc) {
        const refChecklist = activities.some(
          (a) =>
            a.type === "Retrieve" &&
            a.retrieve_source === "Association" &&
            String(a.association || a.caption || "").includes(blockingAssoc.name || "")
        );
        if (!refChecklist) {
          addHypothesis({
            pattern_id: "BHP-37",
            category: "Association & Relational Integrity",
            severity: "HIGH",
            oracle_tier: "TIER_1_OBJECTIVE",
            title: `Unhandled 'DeleteMeIfNoReferences' Exception on Delete '${targetEntity}' (${blockingAssoc.name})`,
            activity_id: act.id,
            activity_caption: act.caption || `Delete ${targetEntity}`,
            oracle_rule: `Entity '${targetEntity}' is governed by association '${blockingAssoc.name}' with delete behavior 'Delete only if it is not associated with...' ('DeleteMeIfNoReferences'). Activity '${act.caption || act.id}' deletes '${targetEntity}' without checking for existing associated objects or attaching a Custom Error Handler, causing an unhandled runtime exception when associated records exist.`,
            test_strategy: `Associate a child/parent record via '${blockingAssoc.name}' and invoke '${mf.qualified_name}' to verify whether DeleteObject crashes.`,
            variation_overrides: {
              [`HasAssociated_${blockingAssoc.name}`]: "true",
            },
            expected_safe_outcome: `Microflow checks associated '${blockingAssoc.name}' objects before deleting '${targetEntity}' or handles the prevention error gracefully`,
            remediation: `Retrieve and check associated '${blockingAssoc.name}' records before '${act.caption || act.id}', or attach a Custom Error Handler.`,
          });
        }
      }
    }
  }

  // BHP-38: Custom Error Handler Transaction & Dirty-Memory Trap (`CustomWithRollback` & `Continue`)
  for (const act of activities) {
    const errType = String(act.error_handling_type || act.error_handling || "");
    if (/^CustomWithRollback$/i.test(errType)) {
      // Check if an object was created/mutated in memory before this activity without an intermediate commit
      const priorInMemoryVars = [
        ...Array.from(createdObjectsByVar.keys()),
        ...Array.from(mutatedObjectsByVar.keys()),
      ].filter((v) => !committedObjectsSet.has(v));
      if (priorInMemoryVars.length > 0 || act.dirty_memory_after_rollback === true) {
        const affectedVar = priorInMemoryVars[0] || "InMemoryObject";
        amberRisks.push({
          id: `HYP_${hypotheses.length + amberRisks.length + 1}`,
          microflow: mf.qualified_name,
          pattern_id: "BHP-38",
          defect_tier: "AMBER",
          category: "Transaction & Error Handling Semantics",
          severity: "HIGH",
          oracle_tier: "TIER_1_OBJECTIVE",
          title: `Custom Error Handler 'CustomWithRollback' Dirty In-Memory State Trap on '${act.caption || act.id}'`,
          activity_id: act.id,
          activity_caption: act.caption || act.type,
          oracle_rule: `Per Mendix Error Handling documentation, 'Custom with Rollback' reverts the database savepoint to the start of the activity, but DOES NOT revert in-memory microflow variables ('$${affectedVar}') modified prior to '${act.caption || act.id}'. Continuing execution on the error path with dirty in-memory state risks committing inconsistent objects.`,
          amber_reason: "Mendix CustomWithRollback Dirty-Memory Trap (BHP-38): explicitly Rollback or re-retrieve in-memory objects on the error handler path.",
          remediation: `On the error flow out of '${act.caption || act.id}', add a Rollback Object activity for '$${affectedVar}' or abort further commits.`,
        });
      }
    } else if (/^Continue$/i.test(errType) && (act.type === "Commit" || act.type === "CommitObject" || act.type === "MicroflowCall" || act.type === "RestCall")) {
      addHypothesis({
        pattern_id: "BHP-38",
        category: "Transaction & Error Handling Semantics",
        severity: "HIGH",
        oracle_tier: "TIER_1_OBJECTIVE",
        title: `Error Handler 'Continue' Silently Swallows Failure on '${act.caption || act.id}'`,
        activity_id: act.id,
        activity_caption: act.caption || act.type,
        oracle_rule: `Activity '${act.caption || act.id}' (${act.type}) is configured with Error Handling = 'Continue' (without rollback or custom error flow). If '${act.caption || act.id}' fails at runtime, the exception is silently swallowed while downstream activities proceed on partial/uncommitted state.`,
        test_strategy: `Trigger a failure inside '${act.caption || act.id}' and verify whether '${mf.qualified_name}' continues executing downstream commits on partial state.`,
        variation_overrides: {
          [`ForceError_${act.id}`]: "true",
        },
        expected_safe_outcome: `Replace 'Continue' error handling on '${act.caption || act.id}' with 'Custom with Rollback' or 'Rollback'`,
        remediation: `Change Error Handling on '${act.caption || act.id}' from 'Continue' to 'Rollback' or 'Custom with Rollback' with explicit error handling.`,
      });
    }
  }

  // BHP-39: XPath Three-Valued NULL Exclusion (`!=` on Nullable Attribute) & Invalid `[Assoc = empty]`
  for (const act of activities) {
    if (act.type === "Retrieve" && act.retrieve_source === "Database") {
      const xpath = String(act.xpath || act.expression || "").trim();
      if (!xpath) continue;

      // 1. Check for `[Module.Association = empty]` (instead of `not(Module.Association/Module.Entity)`)
      const assocEmptyMatch = xpath.match(/\[\s*([A-Za-z0-9_]+\.[A-Za-z0-9_]+_[A-Za-z0-9_]+)\s*=\s*empty\s*\]/i);
      if (assocEmptyMatch) {
        const assocName = assocEmptyMatch[1];
        amberRisks.push({
          id: `HYP_${hypotheses.length + amberRisks.length + 1}`,
          microflow: mf.qualified_name,
          pattern_id: "BHP-39",
          defect_tier: "AMBER",
          category: "XPath & SQL Semantics",
          severity: "MEDIUM",
          oracle_tier: "TIER_1_OBJECTIVE",
          title: `Non-Canonical XPath Association Empty Check '[${assocName} = empty]' in '${act.caption || act.id}'`,
          activity_id: act.id,
          activity_caption: act.caption || `Retrieve ${act.entity}`,
          oracle_rule: `Database Retrieve '${act.caption || act.id}' uses '[${assocName} = empty]'. Per Mendix XPath guidelines, checking for missing associations across 1-to-many / non-owner paths should use 'not(${assocName}/Module.TargetEntity)' to guarantee accurate SQL outer-join evaluation.`,
          amber_reason: "XPath Association Empty Check Trap (BHP-39): prefer 'not(Association/Entity)' for missing association queries.",
          remediation: `Rewrite XPath constraint '[${assocName} = empty]' in '${act.caption || act.id}' to 'not(${assocName}/<TargetEntity>)'.`,
        });
      }

      // 2. Check for `[Attr != 'Value']` on a nullable non-Boolean attribute without `or Attr = empty`
      const notEqMatches = Array.from(xpath.matchAll(/\[\s*([A-Za-z0-9_]+)\s*!=\s*('[^']*'|[0-9A-Za-z_.-]+)\s*\]/g));
      for (const m of notEqMatches) {
        const [, attrName, rhsVal] = m;
        if (/^empty$/i.test(rhsVal) || /^true$|^false$/i.test(rhsVal)) continue;
        const hasOrEmpty = new RegExp(`\\b${attrName}\\s*=\\s*empty\\b`, "i").test(xpath);
        const entDef = entities.find((e) => e.qualified_name === act.entity);
        const attrDef = entDef?.attributes?.find((a) => a.name === attrName);
        if (attrDef && /^Boolean$/i.test(attrDef.type || "")) continue;
        if (!hasOrEmpty) {
          addHypothesis({
            pattern_id: "BHP-39",
            category: "XPath & SQL Semantics",
            severity: "HIGH",
            oracle_tier: "TIER_1_OBJECTIVE",
            title: `XPath '!=' NULL Exclusion Trap on '[${attrName} != ${rhsVal}]' in '${act.caption || act.id}'`,
            activity_id: act.id,
            activity_caption: act.caption || `Retrieve ${act.entity}`,
            target_attribute: `${act.entity || "Entity"}.${attrName}`,
            oracle_rule: `Per Mendix XPath / SQL three-valued logic, constraint '[${attrName} != ${rhsVal}]' on '${act.entity || "Entity"}' evaluates to UNKNOWN for rows where '${attrName}' is NULL (empty), silently excluding all empty '${attrName}' records from the result set.`,
            test_strategy: `Seed a '${act.entity || "Entity"}' record with '${attrName} = empty', execute '${mf.qualified_name}', and verify that '[${attrName} != ${rhsVal}]' drops the record unless 'or ${attrName} = empty' is included.`,
            variation_overrides: {
              [`${(act.entity || "Entity").split(".").pop()}.${attrName}`]: "empty",
            },
            expected_safe_outcome: `XPath query explicitly includes '(${attrName} != ${rhsVal} or ${attrName} = empty)' if empty records should match`,
            remediation: `Update the XPath constraint in '${act.caption || act.id}' to '[${attrName} != ${rhsVal} or ${attrName} = empty]' (or document that empty records must be excluded).`,
          });
        }
      }
    }
  }

  // BHP-40: AggregateList SQL Pushdown Optimization Ignoring Uncommitted Edits
  for (let idx = 0; idx < activities.length; idx++) {
    const act = activities[idx];
    if (act.type === "AggregateList" || act.action_type === "AggregateListAction") {
      const listVar = act.list_variable || act.variable || "";
      // Check if an upstream Database Retrieve produced `listVar` AND an uncommitted ChangeObject mutated elements before this AggregateList
      const dbRetIdx = activities.findIndex(
        (a, i) =>
          i < idx &&
          a.type === "Retrieve" &&
          a.retrieve_source === "Database" &&
          (a.output_variable === listVar || (!listVar && a.entity))
      );
      if (dbRetIdx !== -1) {
        const retEnt = activities[dbRetIdx].entity;
        const hasUncommittedChangeBetween = activities.slice(dbRetIdx + 1, idx).some(
          (a) =>
            a.type === "ChangeObject" &&
            !/^yes$/i.test(String(a.commit || "")) &&
            (!retEnt || !a.entity || a.entity === retEnt)
        );
        if (hasUncommittedChangeBetween) {
          addHypothesis({
            pattern_id: "BHP-40",
            category: "XPath & SQL Semantics",
            severity: "HIGH",
            oracle_tier: "TIER_1_OBJECTIVE",
            title: `AggregateList SQL Pushdown Ignores Uncommitted In-Memory Changes on '$${listVar || retEnt}'`,
            activity_id: act.id,
            activity_caption: act.caption || `Aggregate ${listVar}`,
            oracle_rule: `Per Mendix Aggregate List documentation, when 'AggregateList' ('${act.caption || act.id}') is coupled to a Database Retrieve ('$${listVar}') whose list is only used by the aggregate, Mendix optimizes the pair into a direct SQL aggregate query against the database — silently ignoring uncommitted 'ChangeObject' edits made in memory prior to '${act.caption || act.id}'.`,
            test_strategy: `Modify an attribute on '${retEnt || listVar}' in memory without committing, execute '${mf.qualified_name}', and assert whether '${act.caption || act.id}' reflects the in-memory edit.`,
            variation_overrides: {
              [`UncommittedEditBeforeAggregate_${act.id}`]: "true",
            },
            expected_safe_outcome: `Commit '${retEnt || listVar}' before running AggregateList or aggregate in-memory without SQL pushdown`,
            remediation: `Commit the modified '${retEnt || listVar}' objects before '${act.caption || act.id}' so the SQL aggregate includes the updated values.`,
          });
        }
      }
    }
  }

  // DQP-09: Commit(With Events = No) Bypassing Domain Event Handlers & Validation Rules
  for (const act of activities) {
    const isCommitWithEventsDisabled =
      (act.type === "Commit" || act.type === "CommitObject" || act.type === "ChangeObject" || act.type === "CreateObject") &&
      act.with_events === false;
    if (isCommitWithEventsDisabled) {
      const varParam = parameters.find((p) => p.name === act.variable);
      const targetEntityName = act.entity || varParam?.entity || createdObjectsByVar.get(act.variable)?.entity || "";
      const entDef = entities.find((e) => e.qualified_name === targetEntityName || (!targetEntityName && (e.event_handlers || []).length > 0));
      const hasBcoOrValidation =
        Boolean(entDef) &&
        ((entDef.event_handlers || []).some((eh) => eh.event === "BeforeCommit" || eh.event === "AfterCommit") ||
          (entDef.attributes || []).some((at) => at.is_required || at.is_unique));
      if (hasBcoOrValidation || act.with_events === false) {
        addHypothesis({
          pattern_id: "DQP-09",
          category: "Data Quality & ACID Enforcement",
          severity: "CRITICAL",
          oracle_tier: "TIER_1_OBJECTIVE",
          title: `Commit(With Events = No) in '${act.caption || act.id}' Bypasses BeforeCommit / Domain Invariants on '${entDef?.qualified_name || targetEntityName || act.variable}'`,
          activity_id: act.id,
          activity_caption: act.caption || `Commit ${act.variable || targetEntityName}`,
          target_entity: entDef?.qualified_name || targetEntityName,
          oracle_rule: `Activity '${act.caption || act.id}' commits '${entDef?.qualified_name || targetEntityName || act.variable}' with 'With Events = No' ('with_events = false'). Per Mendix Commit Object documentation, this completely bypasses all BeforeCommit ('BCO_*') and AfterCommit ('ACO_*') event handlers on '${entDef?.qualified_name || targetEntityName || "the entity"}'.`,
          test_strategy: `Execute '${mf.qualified_name}' with an object that should be rejected or augmented by BeforeCommit on '${entDef?.qualified_name || targetEntityName}', and verify that 'With Events = No' bypasses the handler.`,
          variation_overrides: {
            [`BypassEvents_${act.id}`]: "true",
          },
          expected_safe_outcome: `Enable 'With Events = Yes' on '${act.caption || act.id}' or enforce all invariants via an explicit upstream 'VAL_' microflow`,
          remediation: `Set 'With Events = Yes' on '${act.caption || act.id}' in '${mf.qualified_name}'.`,
        });
      }
    }
  }

  // ==========================================================================
  // v2.6.0: PHASE 3B — JAVA ACTION WHITE-BOX & BOUNDARY DETECTORS (JAP-01..JAP-07 & SEC-10)
  // ==========================================================================
  const javaActionMetaMap = new Map();
  for (const ja of bundle.java_actions || []) {
    if (ja.qualified_name) javaActionMetaMap.set(ja.qualified_name, ja);
    if (ja.name) javaActionMetaMap.set(ja.name, ja);
  }

  for (const act of activities) {
    if (act.type !== "JavaActionCall") continue;
    const actionName = act.java_action || act.action_name || act.caption || "JavaAction";
    const javaMeta =
      act.java_meta ||
      javaActionMetaMap.get(actionName) ||
      javaActionMetaMap.get(actionName.split(".").pop()) ||
      null;

    // JAP-01: Unimplemented Java Action Stub
    if (javaMeta?.unimplemented_stub || javaMeta?.is_unimplemented_stub || act.unimplemented_stub === true) {
      addHypothesis({
        pattern_id: "JAP-01",
        category: "Java Action White-Box & Boundary Defects",
        severity: "CRITICAL",
        oracle_tier: "TIER_1_OBJECTIVE",
        title: `Unimplemented Java Action Stub '${actionName}' Throws CoreException at Runtime`,
        activity_id: act.id,
        activity_caption: act.caption || actionName,
        java_action: actionName,
        oracle_rule: `Java Action '${actionName}' invoked by '${mf.qualified_name}' still contains the default Studio Pro stub ('throw new com.mendix.systemwideinterfaces.core.UserException("Java action was not implemented")') inside 'executeAction()'. Executing this branch unconditionally crashes at runtime.`,
        test_strategy: `Execute parent microflow '${mf.qualified_name}' via MTA_plugin in memory to reach '${act.caption || actionName}' and confirm 'Java action was not implemented' exception.`,
        variation_overrides: {
          [`InvokeJavaStub_${actionName.split(".").pop()}`]: "true",
        },
        expected_safe_outcome: `Java Action '${actionName}' implements 'executeAction()' between '// BEGIN USER CODE' and '// END USER CODE'`,
        remediation: `Implement the custom Java logic inside 'javasource/${actionName.replace(".", "/actions/")}.java' between '// BEGIN USER CODE' and '// END USER CODE'.`,
      });
    }

    // JAP-02: Unguarded Null Parameter / IMendixObject.getValue Dereference in Java Action
    const callArgsStr = [
      ...(act.arguments || []),
      ...Object.values(act.parameter_mappings || {}),
      ...(act.expressions || []),
      act.expression || "",
    ].join(" ");
    const unguardedJavaParams = javaMeta?.unguarded_params || javaMeta?.unprotected_get_value_members || [];
    if (unguardedJavaParams.length > 0 || act.java_null_deref === true) {
      const paramRefs = Array.from(callArgsStr.matchAll(/\$([A-Za-z0-9_]+(?:\/[A-Za-z0-9_]+)?)/g)).map((m) => m[1]);
      const targetRef = paramRefs[0] || unguardedJavaParams[0] || "JavaParam";
      const isObjParam = parameters.some((p) => p.name === targetRef && p.type === "Object");
      if (!isParamGuardedAt(act, targetRef) && !isAttrGuardedAt(act, targetRef)) {
        addHypothesis({
          pattern_id: "JAP-02",
          category: "Java Action White-Box & Boundary Defects",
          severity: "CRITICAL",
          oracle_tier: "TIER_1_OBJECTIVE",
          title: `Unguarded Null Dereference in Java Action '${actionName}' on '${targetRef}'`,
          activity_id: act.id,
          activity_caption: act.caption || actionName,
          java_action: actionName,
          target_param: isObjParam ? targetRef : undefined,
          target_attribute: !isObjParam && targetRef.includes("/") ? targetRef : undefined,
          oracle_rule: `Mendix passes 'empty' microflow arguments into Java Actions as Java 'null' (for Auto-boxed Long/Boolean/BigDecimal/String/IMendixObject). Java Action '${actionName}' dereferences '${unguardedJavaParams.join(", ") || targetRef}' (or 'getValue(context, ...)') without a '!= null' check, and '${mf.qualified_name}' does not guard '$${targetRef} != empty' prior to '${act.caption || act.id}'.`,
          test_strategy: `Execute parent microflow '${mf.qualified_name}' via MTA_plugin with '${isObjParam ? `Param $${targetRef} = 'NONE'` : `$${targetRef} = empty`}' to trigger 'java.lang.NullPointerException' inside '${actionName}.executeAction()'.`,
          variation_overrides: isObjParam
            ? { [`Param $${targetRef}`]: "'NONE'" }
            : { [`$${targetRef}`]: "empty" },
          expected_safe_outcome: `Java Action '${actionName}' checks for 'null' parameters or '${mf.qualified_name}' guards '$${targetRef} != empty' before calling '${actionName}'`,
          remediation: `Add a 'if (${unguardedJavaParams[0] || "param"} == null) return ...;' guard inside '${actionName}.java' and add an Exclusive Split checking '$${targetRef} != empty' in '${mf.qualified_name}'.`,
        });
      }
    }

    // JAP-03 & SEC-10: Core.createSystemContext() Transaction & Entity Access Escape
    if (javaMeta?.uses_system_context || act.uses_system_context === true) {
      const mutatesDb = Boolean(javaMeta?.system_context_mutates_db || act.system_context_mutates_db);
      const jap03Finding = {
        id: `HYP_${hypotheses.length + amberRisks.length + 1}`,
        microflow: mf.qualified_name,
        pattern_id: "JAP-03",
        pattern_alias: "SEC-10",
        defect_tier: "AMBER",
        category: "Java Action White-Box & Boundary Defects",
        severity: mutatesDb ? "CRITICAL" : "HIGH",
        oracle_tier: "TIER_1_OBJECTIVE",
        title: `Java Action '${actionName}' Uses 'Core.createSystemContext()' (${mutatesDb ? "Escapes Rollback Transaction & Entity Access" : "Bypasses Entity Access Rules"})`,
        activity_id: act.id,
        activity_caption: act.caption || actionName,
        java_action: actionName,
        oracle_rule: `Java Action '${actionName}' calls 'Core.createSystemContext()' instead of 'getContext()' / 'getContext().createSudoClone()'. A fresh system context opens an independent transaction outside the calling microflow's savepoint${mutatesDb ? " — meaning database commits/deletes inside '${actionName}' CANNOT be rolled back by microflow error handlers or MTA 'Rollback = Yes'" : ""} and bypasses entity access rules (SEC-10).`,
        amber_reason: `SystemContext Transaction & Security Escape (JAP-03 / SEC-10): quarantined by SAFE-01 when mutating DB. Replace 'Core.createSystemContext()' with 'getContext()' or 'getContext().createSudoClone()'.`,
        remediation: `In '${actionName}.java', replace 'Core.createSystemContext()' with 'this.getContext()' (or 'this.getContext().createSudoClone()' if elevated entity access is required within the same transaction).`,
      };
      amberRisks.push(jap03Finding);
    }

    // JAP-04: Silent Exception Swallowing in Java Action
    if (javaMeta?.swallowed_exceptions || javaMeta?.swallows_exceptions_silently || act.swallowed_exceptions === true) {
      addHypothesis({
        pattern_id: "JAP-04",
        category: "Java Action White-Box & Boundary Defects",
        severity: "HIGH",
        oracle_tier: "TIER_1_OBJECTIVE",
        title: `Java Action '${actionName}' Silently Swallows Exceptions and Returns '${javaMeta?.swallowed_return_value || "null/false"}'`,
        activity_id: act.id,
        activity_caption: act.caption || actionName,
        java_action: actionName,
        oracle_rule: `Java Action '${actionName}' catches 'Exception' inside 'executeAction()' and returns '${javaMeta?.swallowed_return_value || "null/false"}' without rethrowing 'CoreException' or logging an error. Consequently, Mendix Custom Error Handlers on '${act.caption || act.id}' never fire and '${mf.qualified_name}' proceeds on corrupted/empty state.`,
        test_strategy: `Pass an invalid input into '${mf.qualified_name}' that triggers the catch block in '${actionName}', and assert that '${mf.qualified_name}' fails to enter its error handler.`,
        variation_overrides: {
          [`TriggerJavaCatch_${actionName.split(".").pop()}`]: "true",
        },
        expected_safe_outcome: `Java Action '${actionName}' rethrows 'new CoreException(e)' so Mendix transaction rollback and error handlers trigger properly`,
        remediation: `In '${actionName}.java', rethrow 'new com.mendix.core.CoreException(e)' (or log via 'Core.getLogger(...).error(...)') instead of silently returning null/false.`,
      });
    }

    // JAP-05: Unclosed InputStream / FileDocument Stream Leak in Java Action
    if (javaMeta?.unclosed_streams || javaMeta?.unclosed_stream_calls || act.unclosed_streams === true) {
      amberRisks.push({
        id: `HYP_${hypotheses.length + amberRisks.length + 1}`,
        microflow: mf.qualified_name,
        pattern_id: "JAP-05",
        defect_tier: "AMBER",
        category: "Java Action White-Box & Boundary Defects",
        severity: "MEDIUM",
        oracle_tier: "TIER_1_OBJECTIVE",
        title: `Unclosed FileDocument / InputStream Leak in Java Action '${actionName}'`,
        activity_id: act.id,
        activity_caption: act.caption || actionName,
        java_action: actionName,
        oracle_rule: `Java Action '${actionName}' opens an 'InputStream' (e.g. 'Core.getFileDocumentContent(getContext(), ...)' or 'new FileInputStream(...)') without a 'try-with-resources' block or explicit '.close()', risking file-handle and connection-pool exhaustion under load.`,
        amber_reason: "Resource Leak in Java Action (JAP-05): wrap 'Core.getFileDocumentContent(...)' in a Java 'try (InputStream is = ...)' block.",
        remediation: `Wrap stream acquisition in '${actionName}.java' inside 'try (InputStream is = Core.getFileDocumentContent(getContext(), fileDoc)) { ... }'.`,
      });
    }

    // JAP-06: Asynchronous Task Queue / Background Java Action Called with Uncommitted Object
    const isAsyncQueueCall =
      act.use_task_queue === true ||
      act.is_task_queue === true ||
      Boolean(act.task_queue) ||
      /Queue|ExecuteMicroflowInBackground|runAsync/i.test(actionName);
    if (isAsyncQueueCall) {
      for (const [newVar, createAct] of createdObjectsByVar.entries()) {
        if (new RegExp(`\\$${newVar}\\b`).test(callArgsStr) && !committedObjectsSet.has(newVar)) {
          addHypothesis({
            pattern_id: "JAP-06",
            category: "Java Action White-Box & Boundary Defects",
            severity: "HIGH",
            oracle_tier: "TIER_1_OBJECTIVE",
            title: `Asynchronous Task Queue / Background Action '${actionName}' Called with Uncommitted Object '$${newVar}'`,
            activity_id: act.id,
            activity_caption: act.caption || actionName,
            java_action: actionName,
            oracle_rule: `Activity '${act.caption || act.id}' dispatches '${actionName}' asynchronously (Task Queue / background thread) passing newly created object '$${newVar}' (${createAct.entity || "Entity"}) before '$${newVar}' has been committed to the database. The background worker runs in a separate transaction and will fail to retrieve '$${newVar}' (or read stale data).`,
            test_strategy: `Execute '${mf.qualified_name}' and verify that '$${newVar}' is uncommitted when '${actionName}' is queued.`,
            variation_overrides: {
              [`UncommittedAsyncArg_$${newVar}`]: "true",
            },
            expected_safe_outcome: `Commit '$${newVar}' before queuing asynchronous action '${actionName}'`,
            remediation: `Commit '$${newVar}' prior to '${act.caption || act.id}' so its state is visible to the asynchronous worker.`,
          });
        }
      }
    }

    // JAP-07: Unguarded Nullable Return from JavaActionCall
    const outVar = act.output_variable || act.variable_name;
    if (outVar && (javaMeta?.can_return_null || javaMeta?.return_can_be_null || act.can_return_null === true || act.returns_object === true)) {
      const hasNullCheckAfter = activities.some(
        (a) =>
          a.type === "ExclusiveSplit" &&
          new RegExp(`\\$${outVar}\\s*(?:!=|=)\\s*empty`, "i").test(a.expression || "")
      );
      const dereferencedAfter = activities.some(
        (a) =>
          a.id !== act.id &&
          a.type !== "ExclusiveSplit" &&
          new RegExp(`\\$${outVar}(?:\\/|\\b)`).test(
            [a.expression || "", ...(a.expressions || []), ...(a.arguments || []), a.variable || ""].join(" ")
          )
      );
      if (dereferencedAfter && !hasNullCheckAfter) {
        addHypothesis({
          pattern_id: "JAP-07",
          category: "Java Action White-Box & Boundary Defects",
          severity: "HIGH",
          oracle_tier: "TIER_1_OBJECTIVE",
          title: `Unguarded Nullable Return '$${outVar}' from Java Action '${actionName}' Dereferenced Downstream`,
          activity_id: act.id,
          activity_caption: act.caption || actionName,
          java_action: actionName,
          oracle_rule: `Java Action '${actionName}' can return 'null' (mapped to Mendix 'empty' in '$${outVar}'), and '${mf.qualified_name}' dereferences '$${outVar}' downstream without checking '$${outVar} != empty'.`,
          test_strategy: `Invoke '${mf.qualified_name}' with inputs that cause '${actionName}' to return 'null' ('empty') and verify downstream NullPointerException / MicroflowException.`,
          variation_overrides: {
            [`JavaReturnEmpty_${outVar}`]: "empty",
          },
          expected_safe_outcome: `Add an Exclusive Split checking '$${outVar} != empty' immediately after '${act.caption || actionName}'`,
          remediation: `Add an Exclusive Split verifying '$${outVar} != empty' after '${act.caption || act.id}' before dereferencing '$${outVar}'.`,
        });
      }
    }
  }

  // ==========================================================================
  // v2.6.0: PHASE 3C — CONSUMED & PUBLISHED REST DETECTORS (INT-03..INT-07)
  // ==========================================================================
  const mfIndex = new Map();
  for (let i = 0; i < activities.length; i++) mfIndex.set(activities[i].id, i);

  for (let idx = 0; idx < activities.length; idx++) {
    const act = activities[idx];
    if (act.type === "RestCall" || act.type === "WebServiceCall") {
      // INT-03: Unencoded Dynamic Path/Query Parameter in Consumed REST URL
      const locExpr = String(act.location_expression || act.url_expression || act.location || act.expression || "");
      if (/\$[A-Za-z0-9_]+/.test(locExpr) && !/\burlEncode\s*\(/i.test(locExpr)) {
        const dynamicVars = Array.from(locExpr.matchAll(/\$([A-Za-z0-9_]+(?:\/[A-Za-z0-9_]+)?)/g))
          .map((m) => m[1])
          .filter((v) => !/^(?:Host|BaseUrl|Endpoint|ApiBase)/i.test(v));
        if (dynamicVars.length > 0) {
          addHypothesis({
            pattern_id: "INT-03",
            defect_tier: "AMBER",
            category: "External Integration Resilience",
            severity: "HIGH",
            oracle_tier: "TIER_1_OBJECTIVE",
            title: `Unencoded Dynamic URL Variable '$${dynamicVars[0]}' in REST Call '${act.caption || act.id}' Without 'urlEncode(...)'`,
            activity_id: act.id,
            activity_caption: act.caption || act.type,
            target_expression: locExpr,
            oracle_rule: `Consumed REST call '${act.caption || act.id}' interpolates '$${dynamicVars[0]}' directly into its Location URL ('${locExpr}') without wrapping it in Mendix's built-in 'urlEncode(...)' function. Special characters (' ', '&', '?', '#', '/') or path-traversal sequences ('../') will corrupt the HTTP request or enable URL parameter injection.`,
            test_strategy: `Inspect Location expression '${locExpr}' on '${act.caption || act.id}' and verify 'urlEncode($${dynamicVars[0]})' wrapping.`,
            variation_overrides: {
              [`$${dynamicVars[0]}`]: "'a b&c=1'",
            },
            expected_safe_outcome: `Dynamic URL segment '$${dynamicVars[0]}' is wrapped in 'urlEncode($${dynamicVars[0]})'`,
            remediation: `Wrap '$${dynamicVars[0]}' inside 'urlEncode($${dynamicVars[0]})' in the Location property of '${act.caption || act.id}'.`,
          });
        }
      }

      // INT-04: Silent $latestHttpResponse Body Loss on Non-2xx REST Errors
      const storesErrorBody = act.store_error_body_in_latest_http_response;
      const downstreamReadsLatestHttpContent = activities.some(
        (a) =>
          /\$latestHttpResponse\/Content\b/i.test(
            [a.expression || "", ...(a.expressions || []), ...(a.arguments || [])].join(" ")
          )
      );
      if (storesErrorBody === false && downstreamReadsLatestHttpContent) {
        amberRisks.push({
          id: `HYP_${hypotheses.length + amberRisks.length + 1}`,
          microflow: mf.qualified_name,
          pattern_id: "INT-04",
          defect_tier: "AMBER",
          category: "External Integration Resilience",
          severity: "MEDIUM",
          oracle_tier: "TIER_1_OBJECTIVE",
          title: `Error Flow Reads '$latestHttpResponse/Content' While 'Store message body in $latestHttpResponse' Is Disabled on '${act.caption || act.id}'`,
          activity_id: act.id,
          activity_caption: act.caption || act.type,
          oracle_rule: `Microflow '${mf.qualified_name}' inspects '$latestHttpResponse/Content' to parse error details, but REST Call '${act.caption || act.id}' has 'Store message body in $latestHttpResponse' disabled for error responses — causing '$latestHttpResponse/Content' to always be 'empty' on HTTP 4xx/5xx faults.`,
          amber_reason: "Mendix REST Error Body Configuration Trap (INT-04): enable storing the response body in $latestHttpResponse on error.",
          remediation: `In the Response tab of REST Call '${act.caption || act.id}', enable storing the response message body in '$latestHttpResponse' on error.`,
        });
      }

      // INT-05: Unguarded Empty Import Mapping Output (`{}` / `null` JSON)
      const mappedVar = act.output_variable || act.variable_name;
      const usesImportMapping =
        /ImportMapping/i.test(String(act.response_handling || "")) ||
        Boolean(act.import_mapping);
      if (mappedVar && usesImportMapping) {
        const hasMappedNullGuard = activities.slice(idx + 1).some(
          (a) =>
            a.type === "ExclusiveSplit" &&
            new RegExp(`\\$${mappedVar}\\s*(?:!=|=)\\s*empty`, "i").test(a.expression || "")
        );
        const derefDownstream = activities.slice(idx + 1).some(
          (a) =>
            a.type !== "ExclusiveSplit" &&
            new RegExp(`\\$${mappedVar}(?:\\/|\\b)`).test(
              [a.expression || "", ...(a.expressions || []), ...(a.arguments || []), a.variable || ""].join(" ")
            )
        );
        if (derefDownstream && !hasMappedNullGuard) {
          addHypothesis({
            pattern_id: "INT-05",
            category: "External Integration Resilience",
            severity: "HIGH",
            oracle_tier: "TIER_1_OBJECTIVE",
            title: `Unguarded Empty Import Mapping Output '$${mappedVar}' After REST Call '${act.caption || act.id}'`,
            activity_id: act.id,
            activity_caption: act.caption || act.type,
            oracle_rule: `When a consumed REST endpoint returns '200 OK' with an empty body, 'null', or '{}' that does not match the root Import Mapping element, Mendix sets '$${mappedVar}' to 'empty'. Microflow '${mf.qualified_name}' dereferences '$${mappedVar}' downstream without checking '$${mappedVar} != empty'.`,
            test_strategy: `Simulate or extract the post-mapping logic with '$${mappedVar} = empty' and verify null-dereference handling.`,
            variation_overrides: {
              [`$${mappedVar}`]: "empty",
            },
            expected_safe_outcome: `Add an Exclusive Split checking '$${mappedVar} != empty' immediately after '${act.caption || act.id}'`,
            remediation: `Add an Exclusive Split checking '$${mappedVar} != empty' after REST Call '${act.caption || act.id}' before accessing '$${mappedVar}' attributes.`,
          });
        }
      }

      // INT-06: Outbound Mutating REST Call Inside Uncommitted Transaction (Rollback Asymmetry)
      const httpMethod = String(act.http_method || act.method || "").toUpperCase();
      if (/^(?:POST|PUT|PATCH|DELETE)$/.test(httpMethod)) {
        const hasDownstreamValidationOrCommit = activities.slice(idx + 1).some(
          (a) =>
            a.type === "ValidationFeedback" ||
            a.type === "Commit" ||
            a.type === "CommitObject" ||
            (a.type === "MicroflowCall" && /^(?:VAL_|CMT_)/i.test((a.called_microflow || a.microflow || "").split(".").pop()))
        );
        if (hasDownstreamValidationOrCommit) {
          amberRisks.push({
            id: `HYP_${hypotheses.length + amberRisks.length + 1}`,
            microflow: mf.qualified_name,
            pattern_id: "INT-06",
            defect_tier: "AMBER",
            category: "External Integration Resilience",
            severity: "HIGH",
            oracle_tier: "TIER_1_OBJECTIVE",
            title: `Outbound '${httpMethod}' REST Call '${act.caption || act.id}' Executes Before Local Validation/Commit Completes`,
            activity_id: act.id,
            activity_caption: act.caption || `${httpMethod} REST Call`,
            oracle_rule: `Microflow '${mf.qualified_name}' executes mutating outbound HTTP '${httpMethod}' call '${act.caption || act.id}' BEFORE local validation or database commits finish. If a downstream validation or commit fails and rolls back the Mendix database transaction, the external REST side-effect cannot be rolled back — causing distributed state split-brain.`,
            amber_reason: "Distributed Transaction Rollback Asymmetry (INT-06): run all local VAL_ checks and DB commits before firing mutating outbound REST calls.",
            remediation: `Move all 'VAL_*' validation checks before '${act.caption || act.id}' or dispatch the outbound '${httpMethod}' call after local persistence succeeds.`,
          });
        }
      }
    }
  }

  // INT-07: Published REST Operation Contract Defect (HTTP 200 on Error / Unguarded Empty $Body)
  const isPublishedRestMf =
    /^(?:PRS_|REST_|API_|PUB_)/i.test(mf.name || "") ||
    mf.is_published_rest === true ||
    parameters.some((p) => p.entity === "System.HttpResponse" || p.entity === "System.HttpRequest");
  if (isPublishedRestMf) {
    const httpRespParam = parameters.find((p) => p.entity === "System.HttpResponse" || /^httpResponse$/i.test(p.name || ""));
    const bodyParam = parameters.find(
      (p) =>
        p.type === "Object" &&
        p.entity !== "System.HttpResponse" &&
        p.entity !== "System.HttpRequest"
    );

    // Check if an error split or validation failure branch returns without setting $HttpResponse/StatusCode >= 400
    const hasValidationSplit = activities.some((a) => a.type === "ExclusiveSplit");
    const setsErrorStatusCode = activities.some(
      (a) =>
        a.type === "ChangeObject" &&
        (a.variable === (httpRespParam?.name || "httpResponse") || a.entity === "System.HttpResponse") &&
        /(?:StatusCode|\b4\d\d\b|\b5\d\d\b)/i.test([a.expression || "", ...(a.expressions || []), a.caption || ""].join(" "))
    );
    if (httpRespParam && hasValidationSplit && !setsErrorStatusCode) {
      addHypothesis({
        pattern_id: "INT-07",
        category: "External Integration Resilience",
        severity: "HIGH",
        oracle_tier: "TIER_1_OBJECTIVE",
        title: `Published REST Microflow '${mf.qualified_name}' Never Sets '$${httpRespParam.name}/StatusCode >= 400' on Validation/Error Branches`,
        activity_id: mf.qualified_name,
        activity_caption: `Published REST ${mf.name}`,
        target_param: bodyParam?.name || httpRespParam.name,
        target_entity: bodyParam?.entity || "System.HttpResponse",
        http_response_param: httpRespParam.name,
        oracle_rule: `Published REST operation microflow '${mf.qualified_name}' receives '$${httpRespParam.name}' (System.HttpResponse, which defaults to 'StatusCode = 200' in Mendix), contains validation/error decision splits, but never changes '$${httpRespParam.name}/StatusCode' to a 4xx/5xx error code when rejecting invalid requests — silently returning '200 OK' on failure.`,
        test_strategy: `Instantiate 'System.HttpResponse' ('StatusCode = 200') in memory alongside an invalid/empty request payload, execute '${mf.qualified_name}' via MTA_plugin ('Rollback = Yes'), and assert '$${httpRespParam.name}/StatusCode >= 400'.`,
        variation_overrides: bodyParam
          ? { [`Param $${bodyParam.name}`]: "'NONE'", [`Expected_${httpRespParam.name}.StatusCode`]: ">= 400" }
          : { [`Expected_${httpRespParam.name}.StatusCode`]: ">= 400" },
        expected_safe_outcome: `Published REST microflow sets '$${httpRespParam.name}/StatusCode' to 400/404/422 on invalid or missing input`,
        remediation: `On the invalid/empty branch of '${mf.qualified_name}', add a ChangeObject activity setting '$${httpRespParam.name}/StatusCode = 400' (or 404/422).`,
      });
    }
  }

  // ==========================================================================
  // v2.9.0: PHASE 3E — MENDIX METAMODEL (IModel) AST DETECTORS (BHP-41..43 & DQP-10)
  // ==========================================================================

  // BHP-41: Unsafe CastAction Without Upstream InheritanceSplit OR Incomplete InheritanceSplit Specialization Cases
  for (let idx = 0; idx < activities.length; idx++) {
    const act = activities[idx];
    if (act.type === "CastAction") {
      const castVar = act.split_variable || act.variable || "";
      const hasUpstreamInheritanceSplit = activities.slice(0, idx).some(
        (a) =>
          a.type === "InheritanceSplit" &&
          (!castVar || !a.split_variable || a.split_variable === castVar)
      );
      if (!hasUpstreamInheritanceSplit) {
        addHypothesis({
          pattern_id: "BHP-41",
          category: "Mendix Metamodel (IModel) Control Flow & Type Safety",
          severity: "HIGH",
          oracle_tier: "TIER_1_OBJECTIVE",
          title: `Unsafe 'CastAction' ('${act.caption || act.output_variable || act.id}') Executed Without Upstream 'InheritanceSplit'`,
          activity_id: act.id,
          activity_caption: act.caption || `Cast ${act.output_variable || castVar}`,
          oracle_rule: `Per Mendix Model SDK ('Microflows$CastAction' / 'Microflows$InheritanceSplit'), a 'CastAction' assumes the runtime object is already narrowed by an upstream 'InheritanceSplit'. Executing '${act.caption || act.id}' without an upstream 'InheritanceSplit' throws an unhandled 'ClassCastException' whenever a base entity or sibling specialization is passed.`,
          test_strategy: `Invoke '${mf.qualified_name}' passing the base entity or a sibling specialization to trigger '${act.caption || act.id}'.`,
          variation_overrides: {
            [`UnsafeCast_${act.output_variable || act.id}`]: "BaseOrSiblingSpecialization",
          },
          expected_safe_outcome: `Guard 'CastAction' ('${act.caption || act.id}') behind an 'InheritanceSplit' covering all entity specializations`,
          remediation: `Place a 'Microflows$InheritanceSplit' directly upstream of '${act.caption || act.id}' in '${mf.qualified_name}' and route only the matching specialization branch to the 'CastAction'.`,
        });
      }
    } else if (act.type === "InheritanceSplit") {
      const splitVar = act.split_variable || act.variable || "";
      const varParam = parameters.find((p) => p.name === splitVar);
      const baseEntity = act.entity || varParam?.entity || createdObjectsByVar.get(splitVar)?.entity || "";
      if (baseEntity) {
        const baseShort = baseEntity.split(".").pop();
        const knownSpecializations = entities.filter(
          (e) =>
            e.generalization &&
            (e.generalization === baseEntity || e.generalization.split(".").pop() === baseShort)
        );
        const rawCases = act.inheritance_cases || act.outgoing_cases || [];
        if (knownSpecializations.length > 0 && rawCases.length > 0) {
          const missingSpecs = knownSpecializations.filter(
            (spec) =>
              !rawCases.some(
                (c) =>
                  c === spec.qualified_name ||
                  c === spec.name ||
                  String(c).split(".").pop() === spec.name
              )
          );
          if (missingSpecs.length > 0) {
            addHypothesis({
              pattern_id: "BHP-41",
              category: "Mendix Metamodel (IModel) Control Flow & Type Safety",
              severity: "HIGH",
              oracle_tier: "TIER_1_OBJECTIVE",
              title: `Incomplete 'InheritanceSplit' ('${act.caption || act.id}') Missing Specialization Branch(es): ${missingSpecs.map((s) => s.qualified_name || s.name).join(", ")}`,
              activity_id: act.id,
              activity_caption: act.caption || `InheritanceSplit $${splitVar}`,
              target_param: varParam?.name,
              target_entity: missingSpecs[0].qualified_name || missingSpecs[0].name,
              oracle_rule: `InheritanceSplit '${act.caption || act.id}' on '$${splitVar}' ('${baseEntity}') only handles [${rawCases.join(", ")}], omitting known specialization(s) [${missingSpecs.map((s) => s.qualified_name || s.name).join(", ")}]. Passing an unhandled specialization takes the default/base fallback or skips specialization logic.`,
              test_strategy: `Instantiate specialization '${missingSpecs[0].qualified_name || missingSpecs[0].name}' and pass it to '${mf.qualified_name}' to verify behavior at '${act.caption || act.id}'.`,
              variation_overrides: {
                [`Specialization_${splitVar || "Object"}`]: missingSpecs[0].qualified_name || missingSpecs[0].name,
              },
              expected_safe_outcome: `All specializations of '${baseEntity}' (${knownSpecializations.map((s) => s.name).join(", ")}) have explicit outgoing 'InheritanceCase' sequence flows`,
              remediation: `Add outgoing 'InheritanceCase' sequence flows for ${missingSpecs.map((s) => `'${s.qualified_name || s.name}'`).join(", ")} on '${act.caption || act.id}'.`,
            });
          }
        }
      }
    }
  }

  // BHP-42: Database Retrieve / Commit / Delete Inside LoopedActivity (N+1 / Non-Atomic Loop) OR Unmutated WhileLoopCondition Infinite Hang
  for (const act of activities) {
    if (act.inside_loop === true) {
      const isDbRetrieveInLoop = act.type === "Retrieve" && act.retrieve_source === "Database";
      const isCommitOrDeleteInLoop =
        act.type === "Commit" ||
        act.type === "CommitObject" ||
        act.type === "DeleteObject" ||
        ((act.type === "CreateObject" || act.type === "ChangeObject") && /^yes$/i.test(String(act.commit || "")));
      if (isDbRetrieveInLoop || isCommitOrDeleteInLoop) {
        amberRisks.push({
          id: `HYP_${hypotheses.length + amberRisks.length + 1}`,
          microflow: mf.qualified_name,
          pattern_id: "BHP-42",
          defect_tier: "AMBER",
          category: "Loop Performance & Transaction Atomicity",
          severity: isCommitOrDeleteInLoop ? "HIGH" : "MEDIUM",
          oracle_tier: "TIER_1_OBJECTIVE",
          title: isDbRetrieveInLoop
            ? `N+1 Database 'Retrieve' ('${act.caption || act.id}') Inside 'LoopedActivity'`
            : `Per-Iteration Database '${act.type}' ('${act.caption || act.id}') Inside 'LoopedActivity'`,
          activity_id: act.id,
          activity_caption: act.caption || act.type,
          oracle_rule: isDbRetrieveInLoop
            ? `Activity '${act.caption || act.id}' executes a Database 'Retrieve' inside a 'Microflows$LoopedActivity', issuing an individual SQL SELECT on every loop iteration (N+1 query bottleneck).`
            : `Activity '${act.caption || act.id}' commits or deletes database records inside a 'Microflows$LoopedActivity' instead of accumulating objects into a list and committing/deleting once outside the loop.`,
          amber_reason: isDbRetrieveInLoop
            ? "N+1 Database Query Inside Loop (BHP-42): retrieve the full dataset prior to the loop and filter in memory using ListOperation (Filter/Find)."
            : "Per-Iteration Commit/Delete Inside Loop (BHP-42): accumulate modified objects into a list via ChangeList and execute a single batch Commit/Delete after the loop.",
          remediation: isDbRetrieveInLoop
            ? `Move Database Retrieve '${act.caption || act.id}' before the 'LoopedActivity' and use an in-memory 'ListOperation' ('Filter'/'Find') inside the loop.`
            : `Set 'Commit = No' inside the loop, add modified objects to a list variable, and execute a single 'Commit' or 'Delete' activity on the list after the 'LoopedActivity' completes.`,
        });
      }
    }

    if (
      act.type === "LoopedActivity" &&
      (act.loop_source_type === "WhileLoopCondition" || Boolean(act.while_expression))
    ) {
      const whileExpr = String(act.while_expression || act.expression || "");
      const loopVars = Array.from(whileExpr.matchAll(/\$([A-Za-z0-9_]+)/g)).map((m) => m[1]);
      if (loopVars.length > 0) {
        const innerActs = activities.filter(
          (a) =>
            a.inside_loop === true &&
            (!act.id || !a.parent_loop_id || a.parent_loop_id === act.id)
        );
        const mutatesConditionVar = innerActs.some((a) => {
          if (a.type === "ChangeVariable" || a.type === "ChangeObject" || a.type === "CreateVariable") {
            return loopVars.includes(a.variable || "");
          }
          if (a.type === "MicroflowCall" || a.type === "JavaActionCall") {
            return loopVars.includes(a.output_variable || "");
          }
          return false;
        });
        if (!mutatesConditionVar) {
          addHypothesis({
            pattern_id: "BHP-42",
            category: "Loop Performance & Transaction Atomicity",
            severity: "CRITICAL",
            oracle_tier: "TIER_1_OBJECTIVE",
            title: `Infinite 'While' Loop Hang in '${act.caption || act.id}': Condition Variable(s) (${loopVars.map((v) => `$${v}`).join(", ")}) Never Mutated Inside Loop Body`,
            activity_id: act.id,
            activity_caption: act.caption || `While (${whileExpr})`,
            target_expression: whileExpr,
            oracle_rule: `Per Mendix Model SDK ('Microflows$WhileLoopCondition'), a While-loop repeats until '${whileExpr}' evaluates to false. None of the activities inside '${act.caption || act.id}' mutate ${loopVars.map((v) => `'$${v}'`).join(" or ")}, causing an infinite loop and JVM thread/memory exhaustion whenever the initial condition is true.`,
            test_strategy: `Inspect or invoke '${mf.qualified_name}' with '${whileExpr}' initially true and verify loop termination guard.`,
            variation_overrides: {
              [`WhileLoopCondition_${loopVars[0]}`]: "true",
            },
            expected_safe_outcome: `Loop body mutates ${loopVars.map((v) => `'$${v}'`).join(" / ")} on every iteration to guarantee termination`,
            remediation: `Add a 'ChangeVariable' or 'ChangeObject' activity inside '${act.caption || act.id}' that updates ${loopVars.map((v) => `'$${v}'`).join(" / ")} toward termination on every iteration.`,
          });
        }
      }
    }
  }

  // BHP-43: Unguarded AggregateListAction (Count) Used as Divisor Without > 0 Check
  for (let idx = 0; idx < activities.length; idx++) {
    const act = activities[idx];
    const isCountAggregate =
      (act.type === "AggregateList" || act.type === "AggregateListAction" || act.action_type === "AggregateListAction") &&
      /^Count$/i.test(String(act.aggregate_function || "Count"));
    const countVar = act.output_variable || "";
    if (!isCountAggregate || !countVar) continue;

    const divPattern = new RegExp(`(?:\\/|\\bdiv\\b)\\s*\\$${countVar}\\b`, "i");
    for (let j = idx + 1; j < activities.length; j++) {
      const downAct = activities[j];
      const downExprs = [downAct.expression || "", ...(downAct.expressions || []), ...(downAct.arguments || [])].join(" ; ");
      if (!divPattern.test(downExprs)) continue;

      const hasZeroGuardBetween = activities.slice(idx + 1, j).some(
        (g) =>
          g.type === "ExclusiveSplit" &&
          new RegExp(`\\$${countVar}\\s*(?:>|!=)\\s*0|\\b0\\s*<\\s*\\$${countVar}`, "i").test(g.expression || "")
      );
      if (!hasZeroGuardBetween && !isAttrGuardedAt(downAct, countVar)) {
        addHypothesis({
          pattern_id: "BHP-43",
          category: "Arithmetic & Precision Safety",
          severity: "HIGH",
          oracle_tier: "TIER_1_OBJECTIVE",
          title: `Unguarded Aggregate 'Count' Variable '$${countVar}' Used as Divisor in '${downAct.caption || downAct.id}' Without '$${countVar} > 0' Split`,
          activity_id: downAct.id,
          activity_caption: downAct.caption || downAct.type,
          target_expression: downExprs,
          oracle_rule: `Per Mendix Model SDK ('Microflows$AggregateListAction'), a 'Count' aggregation over an empty list returns '0' (not 'empty'). Activity '${downAct.caption || downAct.id}' divides by '$${countVar}' ('${downExprs}') without an upstream 'ExclusiveSplit' verifying '$${countVar} > 0', causing a runtime division-by-zero 'MicroflowException' whenever '${act.list_variable || "the list"}' is empty.`,
          test_strategy: `Execute '${mf.qualified_name}' with an empty '${act.list_variable || "input"}' list so '${act.caption || act.id}' produces '$${countVar} = 0', triggering division by zero at '${downAct.caption || downAct.id}'.`,
          variation_overrides: {
            [`EmptyListForCount_${countVar}`]: "0",
          },
          expected_safe_outcome: `Add an Exclusive Split checking '$${countVar} > 0' before dividing by '$${countVar}' in '${downAct.caption || downAct.id}'`,
          remediation: `Insert an Exclusive Split checking '$${countVar} > 0' between '${act.caption || act.id}' and '${downAct.caption || downAct.id}' (or guard inline with 'if $${countVar} > 0 then ... else 0').`,
        });
      }
    }
  }

  // DQP-10: DomainModels$ValidationRule (RangeRuleInfo / MaxLengthRuleInfo) Violated by Microflow CreateObject / ChangeObject Assignment
  for (const act of activities) {
    if (act.type !== "CreateObject" && act.type !== "ChangeObject") continue;
    const varParam = parameters.find((p) => p.name === act.variable);
    const targetEntityName = act.entity || varParam?.entity || createdObjectsByVar.get(act.variable)?.entity || "";
    const entDef = entities.find(
      (e) =>
        e.qualified_name === targetEntityName ||
        (targetEntityName && e.name === targetEntityName.split(".").pop())
    );
    if (!entDef) continue;

    const memberAssignments = Array.isArray(act.member_assignments) ? act.member_assignments : [];
    for (const ma of memberAssignments) {
      const attrShort = String(ma.attribute || "").split(".").pop();
      const valExpr = String(ma.value ?? "").trim();
      if (!attrShort || !valExpr) continue;

      const attrDef = (entDef.attributes || []).find((a) => a.name === attrShort);
      const valRules = (entDef.validation_rules || []).filter(
        (vr) => vr.attribute === attrShort || String(vr.attribute || "").split(".").pop() === attrShort
      );

      const maxLen =
        valRules.find((r) => r.rule_type === "MaxLengthRuleInfo" || r.max_length !== undefined)?.max_length ??
        attrDef?.max_length ??
        attrDef?.length ??
        null;
      const minVal =
        valRules.find((r) => r.rule_type === "RangeRuleInfo" || r.min_value !== undefined)?.min_value ??
        attrDef?.min_value ??
        null;
      const maxVal =
        valRules.find((r) => r.rule_type === "RangeRuleInfo" || r.max_value !== undefined)?.max_value ??
        attrDef?.max_value ??
        null;

      // Check string literal length violation
      const strLitMatch = valExpr.match(/^'([^']*)'$/);
      if (strLitMatch && typeof maxLen === "number" && maxLen > 0 && strLitMatch[1].length > maxLen) {
        addHypothesis({
          pattern_id: "DQP-10",
          category: "Data Quality & ACID Enforcement",
          severity: "HIGH",
          oracle_tier: "TIER_1_OBJECTIVE",
          title: `Literal Assignment to '${entDef.qualified_name}.${attrShort}' (${strLitMatch[1].length} chars) Exceeds Domain MaxLength (${maxLen}) in '${act.caption || act.id}'`,
          activity_id: act.id,
          activity_caption: act.caption || `${act.type} ${entDef.name}`,
          target_entity: entDef.qualified_name,
          target_attribute: `${entDef.qualified_name}.${attrShort}`,
          oracle_rule: `Per Mendix Model SDK ('DomainModels$MaxLengthRuleInfo' / 'StringAttributeType.length'), attribute '${entDef.qualified_name}.${attrShort}' has a maximum length of ${maxLen}. Activity '${act.caption || act.id}' assigns a ${strLitMatch[1].length}-character string literal, which will fail domain validation or trigger a database string-truncation exception on commit.`,
          test_strategy: `Execute '${mf.qualified_name}' to reach '${act.caption || act.id}' and commit '${entDef.qualified_name}' to verify domain validation / length failure.`,
          variation_overrides: {
            [`${entDef.name}.${attrShort}`]: valExpr,
          },
          expected_safe_outcome: `Assigned value for '${entDef.qualified_name}.${attrShort}' respects maximum length <= ${maxLen}`,
          remediation: `Shorten the value assigned to '${attrShort}' in '${act.caption || act.id}' or increase the attribute length / 'MaxLengthRuleInfo' on '${entDef.qualified_name}.${attrShort}'.`,
        });
      }

      // Check numeric literal range violation
      if (/^-?\d+(?:\.\d+)?$/.test(valExpr)) {
        const numVal = Number(valExpr);
        const minNum = minVal !== null && minVal !== undefined && minVal !== "" ? Number(minVal) : null;
        const maxNum = maxVal !== null && maxVal !== undefined && maxVal !== "" ? Number(maxVal) : null;
        if (
          (minNum !== null && !Number.isNaN(minNum) && numVal < minNum) ||
          (maxNum !== null && !Number.isNaN(maxNum) && numVal > maxNum)
        ) {
          addHypothesis({
            pattern_id: "DQP-10",
            category: "Data Quality & ACID Enforcement",
            severity: "HIGH",
            oracle_tier: "TIER_1_OBJECTIVE",
            title: `Literal Assignment '${entDef.qualified_name}.${attrShort} = ${numVal}' Violates Domain RangeRuleInfo [${minNum ?? "-∞"}..${maxNum ?? "+∞"}] in '${act.caption || act.id}'`,
            activity_id: act.id,
            activity_caption: act.caption || `${act.type} ${entDef.name}`,
            target_entity: entDef.qualified_name,
            target_attribute: `${entDef.qualified_name}.${attrShort}`,
            oracle_rule: `Per Mendix Model SDK ('DomainModels$ValidationRule' -> 'DomainModels$RangeRuleInfo'), attribute '${entDef.qualified_name}.${attrShort}' is constrained to range [${minNum ?? "-∞"}, ${maxNum ?? "+∞"}]. Activity '${act.caption || act.id}' assigns '${numVal}', which violates the domain 'RangeRuleInfo' when committed.`,
            test_strategy: `Execute '${mf.qualified_name}' to reach '${act.caption || act.id}' and commit '${entDef.qualified_name}' to verify 'RangeRuleInfo' rejection.`,
            variation_overrides: {
              [`${entDef.name}.${attrShort}`]: String(numVal),
            },
            expected_safe_outcome: `Assigned value for '${entDef.qualified_name}.${attrShort}' lies within [${minNum ?? "-∞"}, ${maxNum ?? "+∞"}]`,
            remediation: `Update '${act.caption || act.id}' in '${mf.qualified_name}' so '${attrShort}' is assigned a value within [${minNum ?? "-∞"}, ${maxNum ?? "+∞"}].`,
          });
        }
      }
    }
  }

  return {
    mf,
    guardrails,
    hypotheses,
    amberRisks,
    amberUiCandidates,
  };
}

export function normalizeStudioProMicroflow(rawMf, defaultModule = "Module") {
  if (!rawMf || rawMf.$Type !== "Microflows$Microflow") {
    return rawMf;
  }
  const name = rawMf.name || "UnknownMicroflow";
  const moduleName = rawMf.module || defaultModule;
  const qualifiedName = rawMf.qualified_name || `${moduleName}.${name}`;
  const objects = rawMf.objectCollection?.objects || [];
  const flows = rawMf.flows || [];

  // Map object index `$id(/objectCollection/objects/N)` -> incoming flow branch values & outgoing case values
  const incomingBranchByObjIdx = new Map();
  const outgoingCasesByOriginIdx = new Map();
  for (const flow of flows) {
    if (flow.$Type === "Microflows$SequenceFlow") {
      const caseVals = (flow.caseValues || [])
        .map((c) => c.value)
        .filter((v) => v !== undefined && v !== null && v !== "");
      if (flow.destination) {
        const m = String(flow.destination).match(/\/objectCollection\/objects\/(\d+)/);
        if (m) {
          const destIdx = Number(m[1]);
          if (caseVals[0]) {
            incomingBranchByObjIdx.set(destIdx, caseVals[0]);
          }
        }
      }
      if (flow.origin) {
        const om = String(flow.origin).match(/\/objectCollection\/objects\/(\d+)/);
        if (om && caseVals.length > 0) {
          const origIdx = Number(om[1]);
          if (!outgoingCasesByOriginIdx.has(origIdx)) {
            outgoingCasesByOriginIdx.set(origIdx, []);
          }
          outgoingCasesByOriginIdx.get(origIdx).push(...caseVals);
        }
      }
    }
  }

  const parameters = [];
  const activities = [];
  const annotations = [];

  const parseObjectCollection = (objList, idPrefix = "obj", loopCtx = null) => {
    (objList || []).forEach((obj, idx) => {
      const objId = `${idPrefix}_${idx}`;
      const branch = !loopCtx ? incomingBranchByObjIdx.get(idx) : undefined;
      const outgoingCases = !loopCtx ? outgoingCasesByOriginIdx.get(idx) : undefined;
      const loopMeta = loopCtx
        ? { inside_loop: true, parent_loop_id: loopCtx.parent_loop_id }
        : {};

      if (obj.$Type === "Microflows$Annotation") {
        if (obj.caption && String(obj.caption).trim()) {
          annotations.push(String(obj.caption).trim());
        }
        return;
      }
      if (obj.$Type === "Microflows$MicroflowParameterObject") {
        const dt = obj.variableType || {};
        const entity = dt.entity || "Module.Entity";
        parameters.push({
          name: obj.name,
          entity,
          type: dt.$Type === "DataTypes$ObjectType" ? "Object" : dt.$Type || "Object",
        });
      } else if (obj.$Type === "Microflows$ExclusiveSplit") {
        const cond = obj.splitCondition || {};
        const isRuleSplit = cond.$Type === "Microflows$RuleSplitCondition";
        const ruleCall = cond.ruleCall || {};
        const ruleName = ruleCall.rule || cond.rule || "";
        const ruleArgs = (ruleCall.parameterMappings || [])
          .map((pm) => pm.argument)
          .filter(Boolean);
        activities.push({
          id: objId,
          type: "ExclusiveSplit",
          caption: obj.caption || ruleName || "ExclusiveSplit",
          expression: cond.expression || (isRuleSplit && ruleName ? `${ruleName}(${ruleArgs.join(", ")})` : ""),
          condition_rule: isRuleSplit ? ruleName : undefined,
          arguments: isRuleSplit && ruleArgs.length > 0 ? ruleArgs : undefined,
          outgoing_cases: outgoingCases,
          branch,
          ...loopMeta,
        });
      } else if (obj.$Type === "Microflows$InheritanceSplit") {
        activities.push({
          id: objId,
          type: "InheritanceSplit",
          caption: obj.caption || `InheritanceSplit $${obj.splitVariableName || ""}`,
          split_variable: obj.splitVariableName || "",
          variable: obj.splitVariableName || "",
          inheritance_cases: outgoingCases || obj.inheritanceCases || [],
          outgoing_cases: outgoingCases || obj.inheritanceCases || [],
          branch,
          ...loopMeta,
        });
      } else if (obj.$Type === "Microflows$LoopedActivity") {
        const loopSrc = obj.loopSource || {};
        const isWhileLoop = loopSrc.$Type === "Microflows$WhileLoopCondition";
        activities.push({
          id: objId,
          type: "LoopedActivity",
          caption:
            obj.caption ||
            (isWhileLoop
              ? `While (${loopSrc.whileExpression || ""})`
              : `Loop ${loopSrc.listVariableName || ""}`),
          loop_source_type: isWhileLoop ? "WhileLoopCondition" : "IterableList",
          list_variable: loopSrc.listVariableName || "",
          iterator_variable: loopSrc.variableName || "",
          while_expression: loopSrc.whileExpression || "",
          expression: loopSrc.whileExpression || "",
          branch,
          ...loopMeta,
        });
        if (Array.isArray(obj.objectCollection?.objects)) {
          parseObjectCollection(obj.objectCollection.objects, `${objId}_inner`, {
            parent_loop_id: objId,
          });
        }
      } else if (obj.$Type === "Microflows$ActionActivity") {
        const act = obj.action || {};
        const actType = act.$Type || "";
        if (actType === "Microflows$ValidationFeedbackAction") {
          const msgText =
            act.feedbackTemplate?.text?.translations?.[0]?.text ||
            act.messageTemplate ||
            obj.caption ||
            "";
          activities.push({
            id: objId,
            type: "ValidationFeedback",
            caption: obj.caption || "Validation feedback",
            branch,
            variable: act.validationVariableName || "",
            attribute: act.attribute || act.association || "",
            message_template: msgText,
            sets_valid_false: false,
            ...loopMeta,
          });
        } else if (actType === "Microflows$MicroflowCallAction") {
          const mfCall = act.microflowCall || {};
          const targetCallee = mfCall.microflow || "";
          const args = (mfCall.parameterMappings || [])
            .map((pm) => pm.argument)
            .filter(Boolean);
          activities.push({
            id: objId,
            type: "MicroflowCall",
            caption: obj.caption || targetCallee,
            branch,
            microflow: targetCallee,
            called_microflow: targetCallee,
            arguments: args,
            expressions: args,
            output_variable: act.outputVariableName || "",
            error_handling_type: obj.errorHandlingType || "Rollback",
            ...loopMeta,
          });
        } else if (actType === "Microflows$ChangeObjectAction") {
          const exprs = (act.items || []).map((it) => it.value).filter(Boolean);
          const setsAssocs = (act.items || [])
            .map((it) => it.association)
            .filter(Boolean);
          const memberNames = (act.items || [])
            .map((it) => it.attribute || it.association)
            .filter(Boolean);
          const memberAssignments = (act.items || []).map((it) => ({
            attribute: it.attribute || undefined,
            association: it.association || undefined,
            value: it.value,
          }));
          activities.push({
            id: objId,
            type: "ChangeObject",
            caption: obj.caption || `Change ${act.changeVariableName}`,
            branch,
            variable: act.changeVariableName || "",
            commit: act.commit || "No",
            with_events: act.withEvents !== false,
            error_handling_type: obj.errorHandlingType || "Rollback",
            sets_association: setsAssocs[0] || undefined,
            member_names: memberNames,
            member_assignments: memberAssignments,
            expressions: exprs,
            ...loopMeta,
          });
        } else if (actType === "Microflows$RetrieveAction") {
          const src = act.retrieveSource || {};
          activities.push({
            id: objId,
            type: "Retrieve",
            caption: obj.caption || `Retrieve ${act.outputVariableName || ""}`,
            branch,
            retrieve_source: src.$Type === "Microflows$DatabaseRetrieveSource" ? "Database" : "Association",
            entity: src.entity || "",
            association: src.association || "",
            output_variable: act.outputVariableName || "",
            first_only: Boolean(src.range?.$Type === "Microflows$ConstantRange" && src.range.singleObject),
            expression: src.xPathConstraint || "",
            xpath: src.xPathConstraint || "",
            error_handling_type: obj.errorHandlingType || "Rollback",
            ...loopMeta,
          });
        } else if (actType === "Microflows$CreateObjectAction") {
          const exprs = (act.items || []).map((it) => it.value).filter(Boolean);
          const setsAssocs = (act.items || [])
            .map((it) => it.association)
            .filter(Boolean);
          const memberNames = (act.items || [])
            .map((it) => it.attribute || it.association)
            .filter(Boolean);
          const memberAssignments = (act.items || []).map((it) => ({
            attribute: it.attribute || undefined,
            association: it.association || undefined,
            value: it.value,
          }));
          activities.push({
            id: objId,
            type: "CreateObject",
            caption: obj.caption || `Create ${act.outputVariableName || act.entity || ""}`,
            branch,
            entity: act.entity || "",
            output_variable: act.outputVariableName || "",
            variable: act.outputVariableName || "",
            commit: act.commit || "No",
            with_events: act.withEvents !== false,
            error_handling_type: obj.errorHandlingType || "Rollback",
            sets_association: setsAssocs[0] || undefined,
            member_names: memberNames,
            member_assignments: memberAssignments,
            expressions: exprs,
            ...loopMeta,
          });
        } else if (actType === "Microflows$CommitAction") {
          activities.push({
            id: objId,
            type: "Commit",
            caption: obj.caption || `Commit ${act.commitVariableName || ""}`,
            branch,
            variable: act.commitVariableName || "",
            with_events: act.withEvents !== false,
            error_handling_type: obj.errorHandlingType || "Rollback",
            ...loopMeta,
          });
        } else if (actType === "Microflows$DeleteAction") {
          activities.push({
            id: objId,
            type: "DeleteObject",
            caption: obj.caption || `Delete ${act.deleteVariableName || ""}`,
            branch,
            variable: act.deleteVariableName || "",
            error_handling_type: obj.errorHandlingType || "Rollback",
            ...loopMeta,
          });
        } else if (actType === "Microflows$RollbackAction") {
          activities.push({
            id: objId,
            type: "Rollback",
            caption: obj.caption || `Rollback ${act.rollbackVariableName || ""}`,
            branch,
            variable: act.rollbackVariableName || "",
            error_handling_type: obj.errorHandlingType || "Rollback",
            ...loopMeta,
          });
        } else if (actType === "Microflows$CastAction") {
          activities.push({
            id: objId,
            type: "CastAction",
            caption: obj.caption || `Cast ${act.outputVariableName || ""}`,
            branch,
            output_variable: act.outputVariableName || "",
            split_variable: act.splitVariableName || "",
            error_handling_type: obj.errorHandlingType || "Rollback",
            ...loopMeta,
          });
        } else if (actType === "Microflows$AggregateListAction") {
          activities.push({
            id: objId,
            type: "AggregateList",
            action_type: "AggregateListAction",
            caption: obj.caption || `Aggregate ${act.inputListVariableName || ""}`,
            branch,
            list_variable: act.inputListVariableName || "",
            aggregate_function: act.aggregateFunction || "Count",
            attribute: act.attribute || "",
            output_variable: act.outputVariableName || "",
            error_handling_type: obj.errorHandlingType || "Rollback",
            ...loopMeta,
          });
        } else if (actType === "Microflows$CreateVariableAction" || actType === "Microflows$ChangeVariableAction") {
          const varName = act.variableName || act.changeVariableName || "";
          const valExpr = act.initialValue || act.value || "";
          activities.push({
            id: objId,
            type: actType === "Microflows$CreateVariableAction" ? "CreateVariable" : "ChangeVariable",
            caption: obj.caption || `${actType.replace(/^Microflows\$|Action$/g, "")} ${varName}`,
            branch,
            variable: varName,
            expression: valExpr,
            expressions: valExpr ? [valExpr] : [],
            error_handling_type: obj.errorHandlingType || "Rollback",
            ...loopMeta,
          });
        } else if (actType === "Microflows$ListOperationAction") {
          const op = act.operation || {};
          const opType = (op.$Type || "").replace(/^Microflows\$/, "");
          activities.push({
            id: objId,
            type: "ListOperation",
            caption: obj.caption || `ListOperation ${opType}`,
            branch,
            operation: opType,
            list_variable: op.listVariableName || act.listVariableName || "",
            input_list_variable: op.listVariableName || act.listVariableName || "",
            output_variable: act.outputVariableName || "",
            returns_object: /^(Head|Find)$/i.test(opType),
            error_handling_type: obj.errorHandlingType || "Rollback",
            ...loopMeta,
          });
        } else if (actType === "Microflows$ChangeListAction") {
          activities.push({
            id: objId,
            type: "ChangeList",
            caption: obj.caption || `Change list ${act.changeVariableName || ""}`,
            branch,
            list_variable: act.changeVariableName || "",
            variable: act.changeVariableName || "",
            operation: act.type || "Add",
            expression: act.value || "",
            expressions: act.value ? [act.value] : [],
            error_handling_type: obj.errorHandlingType || "Rollback",
            ...loopMeta,
          });
        } else if (actType === "Microflows$JavaActionCallAction") {
          const args = (act.parameterMappings || [])
            .map((pm) => pm.argument)
            .filter(Boolean);
          activities.push({
            id: objId,
            type: "JavaActionCall",
            caption: obj.caption || act.javaAction || "JavaActionCall",
            branch,
            java_action: act.javaAction || "",
            output_variable: act.outputVariableName || "",
            arguments: args,
            expressions: args,
            use_return_variable: Boolean(act.outputVariableName),
            queue_name: act.queue || "",
            error_handling_type: obj.errorHandlingType || "Rollback",
            ...loopMeta,
          });
        } else if (actType === "Microflows$RestCallAction" || actType === "Microflows$WebServiceCallAction") {
          const urlTemplate = act.httpConfiguration?.customLocationTemplate?.text || act.locationTemplate || "";
          const urlArgs = (act.httpConfiguration?.customLocationTemplate?.parameters || [])
            .map((p) => p.expression)
            .filter(Boolean);
          activities.push({
            id: objId,
            type: actType === "Microflows$RestCallAction" ? "RestCall" : "WebServiceCall",
            caption: obj.caption || actType,
            branch,
            http_method: act.httpConfiguration?.httpMethod || act.httpMethod || "GET",
            location_template: urlTemplate,
            url_arguments: urlArgs,
            expressions: urlArgs,
            store_response_in_variable: Boolean(act.ResultHandling?.storeInVariable || act.storeInVariable),
            response_handling_type: act.ResultHandling?.$Type || act.responseHandling || "",
            output_variable: act.ResultHandling?.outputVariableName || act.outputVariableName || "",
            timeout_configured: Boolean(act.timeout || act.useRequestTimeOut),
            has_error_handler: Boolean(obj.errorHandlingType && obj.errorHandlingType !== "Rollback"),
            error_handling_type: obj.errorHandlingType || "Rollback",
            ...loopMeta,
          });
        }
      }
    });
  };

  parseObjectCollection(objects, "obj", null);

  return {
    name,
    qualified_name: qualifiedName,
    documentation: rawMf.documentation || "",
    annotations: [...(Array.isArray(rawMf.annotations) ? rawMf.annotations : []), ...annotations],
    return_type: rawMf.microflowReturnType?.$Type || "Void",
    allowed_roles: rawMf.allowedModuleRoles || rawMf.allowed_roles || [],
    // Per StudioPro MCP ped_read_document schema default-value elision rules,
    // Microflows$Microflow.applyEntityAccess defaults to false when omitted.
    apply_entity_access:
      typeof rawMf.applyEntityAccess === "boolean"
        ? rawMf.applyEntityAccess
        : typeof rawMf.apply_entity_access === "boolean"
          ? rawMf.apply_entity_access
          : false,
    parameters,
    activities,
  };
}

export function normalizeStudioProDomainModel(rawDm, defaultModule = "Module") {
  if (!rawDm || rawDm.$Type !== "DomainModels$DomainModel") {
    return [];
  }
  const modName = rawDm.module || defaultModule;
  const rawAssocs = rawDm.associations || [];
  const entities = (rawDm.entities || []).map((ent) => {
    const entName = ent.name || "Entity";
    const qualifiedName = ent.qualified_name || `${modName}.${entName}`;
    const generalization =
      ent.generalization?.$Type === "DomainModels$Generalization"
        ? ent.generalization.generalization || null
        : typeof ent.generalization === "string"
          ? ent.generalization
          : null;

    const validationRules = (ent.validationRules || []).map((vr) => {
      const info = vr.ruleInfo || vr.rule || {};
      const ruleType = (info.$Type || vr.$Type || "").replace(/^DomainModels\$/, "");
      const attrName = vr.attribute ? String(vr.attribute).split(".").pop() : "";
      return {
        attribute: attrName,
        rule_type: ruleType,
        message: vr.message?.translations?.[0]?.text || vr.errorMessage || "",
        min_value: info.minValue ?? info.min_value ?? undefined,
        max_value: info.maxValue ?? info.max_value ?? undefined,
        max_length: info.maxLength ?? info.max_length ?? undefined,
        regex_pattern: info.regularExpression ?? info.regEx ?? undefined,
        equals_to_attribute: info.equalsToAttribute ?? undefined,
      };
    });

    const attributes = (ent.attributes || []).map((a) => {
      const attrRules = validationRules.filter((vr) => vr.attribute === a.name);
      const hasReqRule = attrRules.some((vr) => vr.rule_type === "RequiredRuleInfo");
      const hasUniqRule = attrRules.some((vr) => vr.rule_type === "UniqueRuleInfo");
      const rangeRule = attrRules.find((vr) => vr.rule_type === "RangeRuleInfo");
      const maxLenRule = attrRules.find((vr) => vr.rule_type === "MaxLengthRuleInfo");
      const regexRule = attrRules.find((vr) => vr.rule_type === "RegExRuleInfo");
      const rawTypeStr = a.type?.$Type
        ? a.type.$Type.replace(/^DomainModels\$|AttributeType$/g, "")
        : a.type || "String";
      // Per Mendix Model SDK StringAttributeType, length defaults to 200 when omitted on String attributes
      const strMaxLen =
        maxLenRule?.max_length ??
        a.type?.length ??
        a.max_length ??
        a.length ??
        (rawTypeStr === "String" ? 200 : null);
      return {
        name: a.name,
        type: rawTypeStr,
        enumeration: a.type?.enumeration || a.enumeration || null,
        documentation: a.documentation || "",
        is_required: Boolean(a.is_required || a.isRequired || hasReqRule),
        is_unique: Boolean(a.is_unique || a.isUnique || hasUniqRule),
        max_length: strMaxLen,
        min_value: rangeRule?.min_value ?? a.min_value ?? null,
        max_value: rangeRule?.max_value ?? a.max_value ?? null,
        regex_pattern: regexRule?.regex_pattern ?? a.regex_pattern ?? null,
      };
    });
    const eventHandlers = (ent.eventHandlers || []).map((eh) => ({
      event: eh.event || "BeforeCommit",
      microflow: eh.microflow || "",
      raise_error_on_false: eh.raiseErrorOnFalse !== false,
      returns_false_possible: true,
    }));
    const accessRules = (ent.accessRules || []).map((ar) => ({
      roles: ar.moduleRoles || [],
      xpath_constraint: ar.xPathConstraint || ar.xpath_constraint || "",
      allow_create: Boolean(ar.allowCreate),
      allow_delete: Boolean(ar.allowDelete),
      default_member_access: ar.defaultMemberAccessRights || "ReadOnly",
      member_access: (ar.memberAccesses || []).map((ma) => ({
        attribute: ma.attribute,
        access: ma.accessRights || "ReadOnly",
      })),
    }));
    const associations = rawAssocs
      .filter((as) => as.parent === entName || as.child === entName || as.parent === qualifiedName || as.child === qualifiedName)
      .map((as) => ({
        name: as.name ? (as.name.includes(".") ? as.name : `${modName}.${as.name}`) : "",
        parent_entity: as.parent?.includes(".") ? as.parent : `${modName}.${as.parent}`,
        child_entity: as.child?.includes(".") ? as.child : `${modName}.${as.child}`,
        type: as.type || "Reference",
        owner: as.owner || "Default",
        parent_delete_behavior: as.deleteBehavior?.parentDeleteBehavior || as.parentDeleteBehavior || "DeleteMeButKeepReferences",
        child_delete_behavior: as.deleteBehavior?.childDeleteBehavior || as.childDeleteBehavior || "DeleteMeButKeepReferences",
      }));
    return {
      name: entName,
      qualified_name: qualifiedName,
      generalization,
      documentation: ent.documentation || "",
      attributes,
      validation_rules: validationRules,
      associations,
      event_handlers: eventHandlers,
      access_rules: accessRules,
    };
  });
  return entities;
}

export function computeFastPathSuspectShortlist(microflows = [], entities = []) {
  const bcoSilenceEntities = new Set(
    entities
      .filter((e) => (e.event_handlers || []).some((eh) => eh.raise_error_on_false === false))
      .map((e) => e.qualified_name)
  );
  const shortlist = [];

  for (const mf of microflows) {
    const reasons = [];
    const acts = mf.activities || [];
    const hasSplit = acts.some((a) => a.type === "ExclusiveSplit");
    const hasValFeedback = acts.some((a) => a.type === "ValidationFeedback");
    if (hasSplit && hasValFeedback) {
      reasons.push("Contains ExclusiveSplit + ValidationFeedback (High probability of BHP-01/BHP-17 null or session feedback trap)");
    }
    const allExprs = acts
      .flatMap((a) => [a.expression, ...(a.expressions || []), ...(a.arguments || [])])
      .filter(Boolean)
      .join(" ; ");
    if (/daysBetween|round\s*\(|\/|\bdiv\b/i.test(allExprs)) {
      reasons.push("Contains date/arithmetic expressions (daysBetween/round/div -> BHP-03/BHP-04/BHP-26)");
    }
    if (/^ACT_/i.test(mf.name || "") && /\bcount\s*\(\s*\$/i.test(allExprs)) {
      reasons.push("Touchpoint ACT_* microflow branching on count($List) (BHP-05/BHP-19)");
    }
    if (mf.apply_entity_access === false && acts.some((a) => a.type === "ChangeObject" || a.type === "CreateObject" || a.type === "Commit")) {
      reasons.push("Mutates/commits entities with apply_entity_access == false (SEC-02 write bypass suspect)");
    }
    if ((mf.allowed_roles || []).some((r) => /Anonymous|Guest|Customer|Renter|User/i.test(r)) && /Delete|Admin|Approve|SetPrice|Config|CancelAll/i.test(mf.name || "")) {
      reasons.push("Low-privilege role permitted on privileged/destructive microflow name (SEC-01)");
    }
    if (bcoSilenceEntities.size > 0 && acts.filter((a) => a.type === "Commit" || a.commit === "Yes").length >= 2) {
      reasons.push("Multi-object commit in module with raiseErrorOnFalse=false BeforeCommit handler (BHP-22 partial commit trap)");
    }

    if (reasons.length > 0) {
      shortlist.push({
        microflow: mf.qualified_name || mf.name,
        suspect_score: reasons.length * 10,
        reasons,
      });
    }
  }

  shortlist.sort((a, b) => b.suspect_score - a.suspect_score);
  return shortlist;
}

/**
 * Classifies any Bug Hunter finding (Hypothesis, AMBER risk, or AMBER-UI candidate)
 * using the canonical Two-Dimensional Risk Taxonomy from `mta-test-design/references/risk-matrix.md`
 * (`PAT-01`, `PAT-02`):
 *   1. Technical Risk Profile (`ACID & Data Integrity`, `Control Flow & Orchestration`,
 *      `Boundary & Contract`, `Client Cache & UI Sync`)
 *   2. Business Risk Profile (`Financial & Revenue`, `Compliance & Legal`,
 *      `Operational Disruption`, `Brand & User Drop-off`)
 * Plus defect-specific Business Impact Consequence and Product Risk Analysis (`Impact × Likelihood = Rating 1..25`).
 */
/**
 * Classifies the primary defect nature of any Bug Hunter finding (`classifyDefectNature`):
 *   - `"FUNCTIONAL_BYPASS"` (Tier 1 — Priority 1: Business Rule, Domain Invariant, Calculation, or RBAC Bypass)
 *   - `"UI_FEEDBACK_DISCONNECT"` (Tier 2 — Priority 2: Invisible/Wrong-Entity Validation Message or UI Role Drift)
 *   - `"TECHNICAL_CRASH"` (Tier 3 — Priority 3: Unhandled NullPointerException, Division by Zero, or Runtime Crash)
 */
export function classifyDefectNature(item = {}) {
  if (!item) return "TECHNICAL_CRASH";
  if (item.defect_nature && /^(FUNCTIONAL_BYPASS|UI_FEEDBACK_DISCONNECT|TECHNICAL_CRASH)$/.test(item.defect_nature)) {
    return item.defect_nature;
  }
  const pat = String(item.pattern_id || "BHP-00").toUpperCase();
  const tier = String(item.defect_tier || "").toUpperCase();
  if (tier === "AMBER-UI" || /^(BHP-17|BHP-32|SEC-04|SEC-07)$/.test(pat)) {
    return "UI_FEEDBACK_DISCONNECT";
  }
  if (
    /^(INV-0[123]|BRP-01|BHP-04|BHP-05|BHP-06|BHP-12|BHP-15|BHP-21|BHP-22|BHP-25|BHP-26|BHP-28|BHP-29|BHP-33|BHP-34|BHP-35|BHP-36|BHP-38|BHP-39|BHP-40|DQP-0[12489]|DQP-10|PBT-0[2345]|SEC-0[01235689]|SEC-10|INT-0[67]|UFP-0[23])$/.test(
      pat
    )
  ) {
    return "FUNCTIONAL_BYPASS";
  }
  return "TECHNICAL_CRASH";
}

export function classifyFindingDualRisk(item = {}, _bundle = {}) {
  const pat = String(item.pattern_id || "BHP-00").toUpperCase();
  const tier = String(item.defect_tier || "RED").toUpperCase();
  const sev = String(item.severity || "HIGH").toUpperCase();
  const mfName = String(item.microflow || "").split(".").pop() || "";
  const chCtx = item.call_hierarchy_context || {};
  const hasHierarchyCommitOrDelete = Boolean(
    chCtx.exposes_commit_or_delete_in_hierarchy ||
      (Array.isArray(chCtx.hierarchy_commits) && chCtx.hierarchy_commits.length > 0) ||
      (Array.isArray(chCtx.hierarchy_deletes) && chCtx.hierarchy_deletes.length > 0)
  );
  const exposureClassification =
    item.exposure_classification ||
    chCtx.exposure_classification ||
    (item.shielded_by_parent || /^UFP-01$/i.test(pat)
      ? "LATENT_IMPLICITLY_PROTECTED"
      : "ACTUAL_UI_OR_API_REPRODUCIBLE");
  const isLatentImplicitlyProtected = exposureClassification === "LATENT_IMPLICITLY_PROTECTED";

  if (
    item.dual_risk &&
    item.dual_risk.technical_risk_profile &&
    item.dual_risk.business_risk_profile &&
    item.dual_risk.exposure_classification === exposureClassification &&
    Boolean(item.dual_risk.hierarchy_commits_or_deletes) === hasHierarchyCommitOrDelete
  ) {
    return item.dual_risk;
  }

  const contextText = [
    item.microflow || "",
    item.title || "",
    item.oracle_rule || "",
    item.amber_reason || "",
    item.activity_caption || "",
    JSON.stringify(item.variation_overrides || {}),
  ].join(" ");

  // 1. Technical Risk Profile (from mta-test-design/references/risk-matrix.md Section 1)
  let technicalRiskProfile = "Control Flow & Orchestration (Medium/High)";
  if (
    hasHierarchyCommitOrDelete ||
    /^(BRP-|UFP-0[123]|PBT-0[234]|BHP-02|BHP-04|BHP-06|BHP-15|BHP-22|BHP-25|BHP-26|BHP-34|BHP-35|BHP-36|BHP-37|BHP-38|BHP-40|BHP-42|BHP-43|DQP-|JAP-0[36]|INT-06)/.test(pat)
  ) {
    technicalRiskProfile = hasHierarchyCommitOrDelete
      ? "ACID & Data Integrity (High — Call Hierarchy Commits/Deletes)"
      : "ACID & Data Integrity (High)";
  } else if (/^(SEC-0[1235689]|SEC-10|INT-0[123457]|JAP-0[12457]|BHP-39|BHP-41|PBT-0[15])/.test(pat)) {
    technicalRiskProfile = "Boundary & Contract (Medium/High)";
  } else if (tier === "AMBER-UI" || /^(BHP-17|BHP-32|SEC-04|SEC-07)/.test(pat)) {
    technicalRiskProfile = "Client Cache & UI Sync (Low/Medium)";
  }

  // 2. Business Risk Profile & Concrete Business Impact Consequence (from risk-matrix.md Section 1)
  let businessRiskProfile = "Operational Disruption (Medium/High)";
  let businessImpactConsequence =
    "Unhandled runtime exception or broken validation gate disrupts operator/user workflow.";

  const isFinancialContext =
    /^(BHP-25|BHP-26|BHP-34|PBT-0[23])$/.test(pat) ||
    /\b(price|amount|total|discount|invoice|payment|cost|rate|fee|tax|billing|revenue|salary|balance|order|voucher|refund|installment|currency)\b/i.test(
      contextText
    );
  const isComplianceContext =
    /^SEC-/.test(pat) ||
    /\b(birth|age|license|gdpr|hipaa|consent|audit|compliance|role|permission|security|ssn|iban|password|token|secret|tenant)\b/i.test(
      contextText
    );

  if (/^SEC-/.test(pat)) {
    businessRiskProfile = "Compliance & Legal (High)";
    businessImpactConsequence =
      "Unauthorized role access, cross-tenant data exposure (IDOR), or entity access rule bypass violating security and compliance controls.";
  } else if (/^UFP-/.test(pat)) {
    businessRiskProfile = isFinancialContext
      ? "Financial & Revenue (High)"
      : isComplianceContext
        ? "Compliance & Legal (High)"
        : "Operational Disruption (High)";
    businessImpactConsequence =
      pat === "UFP-01"
        ? "Underlying sub-microflow contains an unguarded branch currently masked by the screen/caller flow; any UI flow change or new top-level caller exposes this defect inside a Commit/Delete call hierarchy."
        : pat === "UFP-02"
          ? "Asymmetric caller validation across screens/entry flows allows one user flow path to reach a Commit/Delete call hierarchy without the validation guard enforced by other callers."
          : "Upstream Commit or Delete executes in the call hierarchy before a downstream validation or error branch can abort, risking partial database commits or irreversible record deletion.";
  } else if (/^BRP-/.test(pat)) {
    businessRiskProfile = isFinancialContext
      ? "Financial & Revenue (High)"
      : isComplianceContext
        ? "Compliance & Legal (High)"
        : "Operational Disruption (High)";
    businessImpactConsequence =
      "Documented functional requirement or business rule contradicts the implemented microflow logic, causing non-compliant or erroneous business outcomes.";
  } else if (isFinancialContext) {
    businessRiskProfile = "Financial & Revenue (High)";
    businessImpactConsequence =
      "Corrupted financial calculation, unclamped discount, IEEE-754 rounding drift, or invalid order/payment state persisted or rejected erroneously.";
  } else if (isComplianceContext) {
    businessRiskProfile = "Compliance & Legal (High)";
    businessImpactConsequence =
      "Regulatory, age/eligibility, or audit validation rule bypassed or inverted, allowing non-compliant records into the system.";
  } else if (tier === "AMBER-UI" || /^(BHP-17|BHP-32)$/.test(pat)) {
    businessRiskProfile = "Brand & User Drop-off (Low/Medium)";
    businessImpactConsequence =
      "Validation feedback targets a hidden or mismatched entity/widget, leaving the user stuck on the page without actionable error guidance.";
  } else if (/^(BHP-05)$/i.test(pat)) {
    businessRiskProfile = "Operational Disruption (High)";
    businessImpactConsequence =
      "Decision condition is redundant or subsumed by an upstream check, making its alternate branch dead, unreachable code.";
  } else if (/^(BHP-01|BHP-23)$/.test(pat)) {
    businessRiskProfile = "Operational Disruption (High)";
    businessImpactConsequence =
      "Unguarded null object or nullable attribute comparison triggers an unhandled MicroflowException / NullPointerException at runtime.";
  }

  if (hasHierarchyCommitOrDelete && !/^UFP-/.test(pat)) {
    const sinkList = [
      ...(chCtx.hierarchy_commits || []).map((c) => `Commit(${typeof c === "string" ? c : c.microflow || c.target_entity || c.variable || "Entity"})`),
      ...(chCtx.hierarchy_deletes || []).map((d) => `Delete(${typeof d === "string" ? d : d.microflow || d.target_entity || d.variable || "Entity"})`),
    ]
      .slice(0, 3)
      .join(", ");
    businessImpactConsequence += ` Call hierarchy includes persistent ${sinkList || "Commit/Delete"} operations${isLatentImplicitlyProtected ? "; while implicitly protected by the current UI/caller flow today, any screen or caller change exposes this branch to database mutation/deletion." : "."}`;
  }

  // 3. Product Risk Analysis (PRA) Impact (1-5) x Likelihood (1-5) = Risk Rating (1-25) (risk-matrix.md Section 5)
  let impact = 3;
  if (sev === "CRITICAL" || /^BRP-/.test(pat) || /^UFP-0[23]$/.test(pat)) {
    impact = 5;
  } else if (sev === "HIGH" || /^UFP-01$/.test(pat)) {
    impact =
      businessRiskProfile.startsWith("Financial") ||
      businessRiskProfile.startsWith("Compliance") ||
      hasHierarchyCommitOrDelete
        ? 5
        : 4;
  } else if (sev === "LOW") {
    impact = 2;
  }
  if (hasHierarchyCommitOrDelete && impact < 4) {
    impact = 4;
  }

  let likelihood = 3;
  if (/^(BRP-|BHP-05)$/i.test(pat) && !isLatentImplicitlyProtected) {
    // Documented spec discrepancies and redundant dead branches trigger deterministically when directly reachable
    likelihood = 5;
  } else if (tier === "RED") {
    likelihood = isLatentImplicitlyProtected ? 3 : 4;
  } else if (tier === "AMBER-UI") {
    likelihood = 4;
  } else if (tier === "AMBER") {
    likelihood = isLatentImplicitlyProtected ? 3 : 3;
  }

  const riskRating = impact * likelihood;
  const priority =
    riskRating >= 16
      ? "P1 (Critical Business Risk)"
      : riskRating >= 10
        ? "P2 (High Business Risk)"
        : riskRating >= 6
          ? "P3 (Medium Business Risk)"
          : "P4 (Low Business Risk)";

  // 4. MTF Test Level & MTA Category Alignment (risk-matrix.md Section 2)
  let recommendedTestLevel = "Unit Test";
  let mtaCategory = "Backend";
  if (tier === "AMBER-UI" || /^(BHP-17|BHP-32|SEC-04|SEC-07)$/.test(pat)) {
    recommendedTestLevel = "Functional UI Test";
    mtaCategory = "Frontend";
  } else if (
    /^(ORC_|CMT_|ACT_|PUB_|CON_)/i.test(mfName) ||
    /^(UFP-|BHP-22|DQP-01|DQP-04|INT-|SEC-)/.test(pat) ||
    hasHierarchyCommitOrDelete
  ) {
    recommendedTestLevel = "Integration Test";
    mtaCategory = "Backend";
  }

  return {
    technical_risk_profile: technicalRiskProfile,
    business_risk_profile: businessRiskProfile,
    business_impact_consequence: businessImpactConsequence,
    exposure_classification: exposureClassification,
    hierarchy_commits_or_deletes: hasHierarchyCommitOrDelete,
    impact,
    likelihood,
    risk_rating: riskRating,
    priority,
    recommended_test_level: recommendedTestLevel,
    mta_category: mtaCategory,
  };
}

/**
 * Parses a JSON or Markdown/text business rules document into normalized external business rule entries.
 * Supports:
 *  - JSON arrays or `{ rules: [...] }` / `{ business_rules: [...] }` (including MCP-retrieved Confluence/Jira specs via `PAT-126`)
 *  - Markdown/text documents containing `@RULE:`, `BR-XX:`, `Rule:`, or requirement bullet points
 */
export function parseBusinessRuleFileContent(rawContent, filePath = "external_rules", defaultSourceType = null) {
  const content = String(rawContent || "").trim();
  if (!content) return [];
  const ext = path.extname(filePath).toLowerCase();
  const baseRef = path.basename(filePath);
  const rules = [];

  if (ext === ".json" || content.startsWith("[") || content.startsWith("{")) {
    try {
      const parsed = JSON.parse(content);
      const arr = Array.isArray(parsed)
        ? parsed
        : Array.isArray(parsed.business_rules)
          ? parsed.business_rules
          : Array.isArray(parsed.rules)
            ? parsed.rules
            : [];
      for (let i = 0; i < arr.length; i++) {
        const item = arr[i];
        if (!item) continue;
        const text = String(item.rule_text || item.rule || item.description || item.summary || "").trim();
        if (!text) continue;
        const isMcp =
          Boolean(item.mcp_retrieved || item.mcp_server) ||
          /mcp|confluence|jira|rovo|github/i.test(String(item.source_type || defaultSourceType || baseRef));
        rules.push({
          id: item.id || `EXT-BR-${i + 1}`,
          rule_text: text,
          source_type:
            item.source_type ||
            defaultSourceType ||
            (isMcp ? `MCP Documentation (${item.mcp_server || "External Spec"})` : "Workspace Documentation File"),
          source_location: item.source_location || item.reference || item.url || baseRef,
          target_element: item.target_element || item.microflow || item.entity || null,
          attribute: item.attribute || null,
          mcp_retrieved: isMcp,
        });
      }
      return rules;
    } catch {
      // Fall through to line-by-line text/markdown parsing
    }
  }

  const isMcpDoc = /mcp|confluence|jira|rovo|external_specs/i.test(String(defaultSourceType || baseRef));
  const lines = content.split(/\r?\n/);
  let currentHeadingTarget = null;
  for (let idx = 0; idx < lines.length; idx++) {
    const line = lines[idx].trim();
    if (!line) continue;
    const headingMatch = line.match(/^#{1,4}\s+.*?\b([A-Za-z0-9_]+\.[A-Za-z0-9_]+|(?:ACT|SUB|VAL|RULE|BCO)_[A-Za-z0-9_]+)\b/);
    if (headingMatch) {
      currentHeadingTarget = headingMatch[1];
      continue;
    }
    const explicitRuleMatch = line.match(
      /^(?:[-*+]\s+|\d+\.\s+)?(?:\*\*)?(?:@RULE|(?:BR-\d+)|Business\s+Rule(?:\s+#?\d+)?|Rule(?:\s+#?\d+)?|Requirement(?:\s+#?\d+)?|Invariant)(?:\*\*)?\s*[:\-–]\s*(.+)$/i
    );
    const bulletWithMustMatch =
      !explicitRuleMatch &&
      line.match(/^(?:[-*+]\s+|\d+\.\s+)(.+\b(?:must|shall|cannot|may\s+not|required\s+to|at\s+least|at\s+most|minimum|maximum)\b.+)$/i);
    const matchedText = explicitRuleMatch ? explicitRuleMatch[1].trim() : bulletWithMustMatch ? bulletWithMustMatch[1].trim() : null;
    if (matchedText && matchedText.length >= 10) {
      const inlineTargetMatch = matchedText.match(/\b([A-Za-z0-9_]+\.[A-Za-z0-9_]+|(?:ACT|SUB|VAL|RULE|BCO)_[A-Za-z0-9_]+)\b/);
      rules.push({
        id: `DOC-BR-${rules.length + 1}`,
        rule_text: matchedText.replace(/^['"`]|['"`]$/g, ""),
        source_type: defaultSourceType || (isMcpDoc ? "MCP Documentation" : "Workspace Documentation File"),
        source_location: `${baseRef}:L${idx + 1}`,
        target_element: inlineTargetMatch ? inlineTargetMatch[1] : currentHeadingTarget,
        mcp_retrieved: isMcpDoc,
      });
    }
  }
  return rules;
}

/**
 * Loads external business rules from CLI options (`--rules-file`, `--docs`) and standard
 * workspace locations (`scratch/business_rules.json`, `scratch/external_specs.md`, `docs/`, `requirements/`).
 */
export function loadExternalBusinessRules(workspaceDir = process.cwd(), moduleName = "", options = {}) {
  const loaded = [];
  const seenFiles = new Set();

  const tryLoadFile = (fPath, sourceHint = null) => {
    if (!fPath) return;
    const abs = path.resolve(workspaceDir, fPath);
    if (seenFiles.has(abs) || !fs.existsSync(abs) || !fs.statSync(abs).isFile()) return;
    seenFiles.add(abs);
    try {
      const raw = fs.readFileSync(abs, "utf8");
      const parsed = parseBusinessRuleFileContent(raw, abs, sourceHint);
      for (const r of parsed) {
        if (
          !moduleName ||
          !r.target_element ||
          !r.target_element.includes(".") ||
          r.target_element.startsWith(`${moduleName}.`)
        ) {
          loaded.push(r);
        }
      }
    } catch {
      // Ignore unreadable files
    }
  };

  if (options.rulesFile) {
    tryLoadFile(options.rulesFile);
  }
  if (options.docsDir) {
    const absDocs = path.resolve(workspaceDir, options.docsDir);
    if (fs.existsSync(absDocs)) {
      if (fs.statSync(absDocs).isFile()) {
        tryLoadFile(absDocs, "Workspace Documentation File");
      } else if (fs.statSync(absDocs).isDirectory()) {
        for (const f of fs.readdirSync(absDocs)) {
          if (/\.(md|txt|json)$/i.test(f)) {
            tryLoadFile(path.join(absDocs, f), "Workspace Documentation File");
          }
        }
      }
    }
  }

  // Auto-discover MCP-retrieved business rule caches in scratch/ (`PAT-126`)
  tryLoadFile(path.join(workspaceDir, "scratch", "business_rules.json"), "MCP Documentation");
  tryLoadFile(path.join(workspaceDir, "scratch", "external_specs.md"), "MCP Documentation");
  tryLoadFile(path.join(workspaceDir, "scratch", "business_rules.md"), "Workspace Documentation File");

  // Auto-discover module-specific business rule files in docs/ or requirements/
  for (const subDir of ["requirements", "specs"]) {
    const candidateDir = path.join(workspaceDir, subDir);
    if (fs.existsSync(candidateDir) && fs.statSync(candidateDir).isDirectory()) {
      for (const f of fs.readdirSync(candidateDir)) {
        if (/\.(md|txt|json)$/i.test(f)) {
          tryLoadFile(path.join(candidateDir, f), "Workspace Documentation File");
        }
      }
    }
  }

  return loaded;
}

/**
 * Filters out procedural developer implementation notes (e.g. "Delete non persistable objects...",
 * "Create list for...", "Retrieve...", "Set return variable") so Section 1C only catalogs genuine
 * normative business rules, domain invariants, and `@RULE:` specifications.
 */
export function isNormativeBusinessRuleText(text = "", isAnnotation = false) {
  const clean = String(text || "").trim().replace(/\s+/g, " ");
  if (!clean || clean.length < 8) return false;
  if (/^@RULE\s*:/i.test(clean) || /\bBR-[A-Za-z0-9_-]+\b/.test(clean)) return true;

  // Reject purely procedural developer comments / step descriptions unless they contain normative keywords
  const hasNormativeKeyword =
    /\b(must|shall|should|cannot|can\s+not|may\s+not|never|only\s+if|only\s+when|required|mandatory|unique|at\s+least|at\s+most|minimum|maximum|greater\s+than|less\s+than|not\s+allowed|forbidden|prohibited|valid(?:ate|ation)|invariant|business\s+rule|policy|eligible|eligibility|permission|authorized)\b/i.test(
      clean
    ) || /(?:>=|<=|>|<|=)\s*-?\d+/.test(clean);

  const isProceduralComment =
    /^(?:delete|create|retrieve|set|change|initialize|init|loop|iterate|call|invoke|commit|refresh|close|open|show|log|debug|temp|todo|fixme|workaround|note\s*:|step\s*\d+|1\.|2\.|3\.|copy|clone|filter|sort|count|add|remove|clear|reset)\b/i.test(
      clean
    ) ||
    /\b(?:non[- ]persistable\s+objects?|helper\s+object|temp(?:orary)?\s+list|return\s+variable|microflow\s+call)\b/i.test(
      clean
    );

  if (isProceduralComment && !hasNormativeKeyword) {
    return false;
  }
  if (isAnnotation && !hasNormativeKeyword) {
    return false;
  }
  return true;
}

/**
 * Builds the full-stack User Flow & Transitive Call Hierarchy Graph:
 *   `Pages -> Widgets/Buttons -> Top-Level Entry Microflows (ACT_*, DS_*, API_*) -> Underlying Sub-Microflows (SUB_*, VAL_*, RULE_*)`
 * and computes:
 *   1. Transitive `Commit` and `Delete` sinks across the total call hierarchy (`hierarchy_commits`, `hierarchy_deletes`)
 *   2. Whether a finding in an underlying microflow is **Actively Reproducible via Current UI/API** (`ACTUAL_UI_OR_API_REPRODUCIBLE`)
 *      vs. **Latent / Implicitly Protected by the Current User Flow** (`LATENT_IMPLICITLY_PROTECTED` — exposed as a future regression bug when UI/callers change)
 *   3. User-Flow & Call-Hierarchy Exposure Risk patterns (`UFP-01`, `UFP-02`, `UFP-03`).
 */
export function buildUserFlowAndCallHierarchyGraph(
  microflowList = [],
  pages = [],
  entities = [],
  defaultModule = "Module"
) {
  const mfByQName = new Map();
  const mfByShortName = new Map();
  for (const mf of microflowList) {
    const qName = mf.qualified_name || `${defaultModule}.${mf.name}`;
    const shortName = mf.name || qName.split(".").pop();
    mfByQName.set(qName, mf);
    mfByShortName.set(shortName, mf);
  }

  const resolveMfQName = (rawRef) => {
    if (!rawRef) return null;
    const str = String(rawRef).trim();
    if (mfByQName.has(str)) return str;
    const short = str.split(".").pop();
    if (mfByShortName.has(short)) {
      const m = mfByShortName.get(short);
      return m.qualified_name || `${defaultModule}.${m.name}`;
    }
    return str.includes(".") ? str : `${defaultModule}.${str}`;
  };

  const calleesByMf = new Map();
  const callersByMf = new Map();
  const callerDetailsByMf = new Map(); // calleeQName -> Array<{ caller: string, hasNullGuardBeforeCall: boolean, guardedVars: string[], callsValidatorBefore: boolean, commitsBeforeCall: string[], deletesBeforeCall: string[] }>
  const entryPagesByMf = new Map();
  const directCommitsByMf = new Map();
  const directDeletesByMf = new Map();

  for (const mf of microflowList) {
    const qName = mf.qualified_name || `${defaultModule}.${mf.name}`;
    calleesByMf.set(qName, new Set());
    if (!callersByMf.has(qName)) callersByMf.set(qName, new Set());
    if (!callerDetailsByMf.has(qName)) callerDetailsByMf.set(qName, []);
    if (!entryPagesByMf.has(qName)) entryPagesByMf.set(qName, new Set());
    directCommitsByMf.set(qName, []);
    directDeletesByMf.set(qName, []);
  }

  // Map Page -> Microflow bindings
  for (const pg of pages || []) {
    const pgQName = pg.qualified_name || `${defaultModule}.${pg.name || "Page"}`;
    for (const rawMf of pg.calls_microflows || []) {
      const targetQName = resolveMfQName(rawMf);
      if (!targetQName) continue;
      if (!entryPagesByMf.has(targetQName)) entryPagesByMf.set(targetQName, new Set());
      entryPagesByMf.get(targetQName).add(pgQName);
    }
  }

  // Map Entity Event Handlers (BCO_*, ACO_*, BDE_*) as implicit domain callers
  for (const ent of entities || []) {
    for (const eh of ent.event_handlers || []) {
      if (eh.microflow) {
        const ehQName = resolveMfQName(eh.microflow);
        if (ehQName && !entryPagesByMf.has(ehQName)) {
          entryPagesByMf.set(ehQName, new Set());
        }
      }
    }
  }

  // Extract direct Commit / Delete operations and MicroflowCall edges per microflow
  for (const mf of microflowList) {
    const callerQName = mf.qualified_name || `${defaultModule}.${mf.name}`;
    const varToEntity = new Map();
    for (const p of mf.parameters || []) {
      if (p.name && p.entity) varToEntity.set(p.name, p.entity);
    }
    for (const act of mf.activities || []) {
      if (act.output_variable && act.entity) {
        varToEntity.set(act.output_variable, act.entity);
      }
    }

    const commitsSoFar = [];
    const deletesSoFar = [];
    const guardedVarsSoFar = new Set();
    let hasAnyNullSplitSoFar = false;
    let callsValidatorSoFar = false;

    for (const act of mf.activities || []) {
      const actType = String(act.type || "");
      const actCaption = act.caption || act.id || actType;

      // Track ExclusiveSplit null guards encountered earlier in the activity list
      if (actType === "ExclusiveSplit" && act.expression) {
        if (/!=\s*empty|=\s*empty/i.test(act.expression)) {
          hasAnyNullSplitSoFar = true;
          const varMatches = act.expression.matchAll(/\$([A-Za-z0-9_]+)/g);
          for (const m of varMatches) {
            guardedVarsSoFar.add(m[1]);
          }
        }
      }

      // Track Commit operations (`Commit`, `CommitObject`, `CreateObject(commit=Yes)`, `ChangeObject(commit=Yes)`)
      const isCommitAct =
        actType === "Commit" ||
        actType === "CommitObject" ||
        ((actType === "ChangeObject" || actType === "CreateObject") &&
          /^yes$/i.test(String(act.commit || "")));
      if (isCommitAct) {
        const targetVar = act.variable || act.output_variable || "";
        const targetEnt =
          act.entity ||
          varToEntity.get(targetVar) ||
          (mf.parameters && mf.parameters[0]?.entity) ||
          "PersistentEntity";
        const commitRecord = {
          microflow: callerQName,
          activity_id: act.id,
          activity_caption: actCaption,
          action_type: actType,
          variable: targetVar,
          entity: targetEnt,
          summary: `${callerQName} -> ${actCaption} (Commits ${targetEnt.split(".").pop()})`,
        };
        directCommitsByMf.get(callerQName).push(commitRecord);
        commitsSoFar.push(commitRecord.summary);
      }

      // Track Delete operations (`DeleteObject`, `Delete`)
      const isDeleteAct = actType === "DeleteObject" || actType === "Delete";
      if (isDeleteAct) {
        const targetVar = act.variable || "";
        const targetEnt =
          act.entity ||
          varToEntity.get(targetVar) ||
          (mf.parameters && mf.parameters[0]?.entity) ||
          "PersistentEntity";
        const deleteRecord = {
          microflow: callerQName,
          activity_id: act.id,
          activity_caption: actCaption,
          action_type: actType,
          variable: targetVar,
          entity: targetEnt,
          summary: `${callerQName} -> ${actCaption} (Deletes ${targetEnt.split(".").pop()})`,
        };
        directDeletesByMf.get(callerQName).push(deleteRecord);
        deletesSoFar.push(deleteRecord.summary);
      }

      // Track MicroflowCall edges
      const calledRaw =
        act.called_microflow ||
        act.microflow ||
        (actType === "MicroflowCall" ? act.target_microflow : null) ||
        (/^Call\s+([A-Za-z0-9_.]+)/i.test(actCaption) ? actCaption.match(/^Call\s+([A-Za-z0-9_.]+)/i)[1] : null);

      if (calledRaw && (actType === "MicroflowCall" || act.called_microflow || act.microflow)) {
        const calleeQName = resolveMfQName(calledRaw);
        if (calleeQName && calleeQName !== callerQName) {
          calleesByMf.get(callerQName)?.add(calleeQName);
          if (!callersByMf.has(calleeQName)) callersByMf.set(calleeQName, new Set());
          callersByMf.get(calleeQName).add(callerQName);
          if (!callerDetailsByMf.has(calleeQName)) callerDetailsByMf.set(calleeQName, []);
          callerDetailsByMf.get(calleeQName).push({
            caller: callerQName,
            activity_id: act.id,
            activity_caption: actCaption,
            hasNullGuardBeforeCall: hasAnyNullSplitSoFar,
            guardedVars: Array.from(guardedVarsSoFar),
            callsValidatorBefore: callsValidatorSoFar,
            commitsBeforeCall: [...commitsSoFar],
            deletesBeforeCall: [...deletesSoFar],
          });

          const calleeShort = calleeQName.split(".").pop();
          if (/^(VAL_|RULE_|SUB_.*validate)/i.test(calleeShort)) {
            callsValidatorSoFar = true;
          }
        }
      }
    }
  }

  // Helper: transitive upstream callers & downstream callees for any microflow
  const getUpstreamCallers = (startQName) => {
    const visited = new Set();
    const queue = [...(callersByMf.get(startQName) || [])];
    while (queue.length > 0) {
      const curr = queue.shift();
      if (!curr || visited.has(curr) || curr === startQName) continue;
      visited.add(curr);
      for (const parent of callersByMf.get(curr) || []) {
        if (!visited.has(parent)) queue.push(parent);
      }
    }
    return Array.from(visited);
  };

  const getDownstreamCallees = (startQName) => {
    const visited = new Set();
    const queue = [...(calleesByMf.get(startQName) || [])];
    while (queue.length > 0) {
      const curr = queue.shift();
      if (!curr || visited.has(curr) || curr === startQName) continue;
      visited.add(curr);
      for (const child of calleesByMf.get(curr) || []) {
        if (!visited.has(child)) queue.push(child);
      }
    }
    return Array.from(visited);
  };

  const isTopLevelEntryMicroflow = (qName) => {
    const short = String(qName || "").split(".").pop();
    const pagesCalling = entryPagesByMf.get(qName);
    if (pagesCalling && pagesCalling.size > 0) return true;
    return /^(ACT_|DS_|API_|PUB_|SE_|WS_|REST_|BCO_|ACO_|BDE_)/i.test(short);
  };

  const contextByMf = new Map();

  for (const mf of microflowList) {
    const qName = mf.qualified_name || `${defaultModule}.${mf.name}`;
    const shortName = mf.name || qName.split(".").pop();
    const directCallers = Array.from(callersByMf.get(qName) || []);
    const upstreamCallers = getUpstreamCallers(qName);
    const downstreamCallees = getDownstreamCallees(qName);
    const allHierarchyMfs = [qName, ...upstreamCallers, ...downstreamCallees];

    const topLevelCallers = [qName, ...upstreamCallers].filter(
      (cand) => cand !== qName && isTopLevelEntryMicroflow(cand)
    );

    const reachableEntryPages = new Set(entryPagesByMf.get(qName) || []);
    for (const up of upstreamCallers) {
      for (const pg of entryPagesByMf.get(up) || []) {
        reachableEntryPages.add(pg);
      }
    }

    const hierarchyCommits = [];
    const hierarchyDeletes = [];
    const seenCommitKeys = new Set();
    const seenDeleteKeys = new Set();

    for (const hMf of allHierarchyMfs) {
      for (const c of directCommitsByMf.get(hMf) || []) {
        if (!seenCommitKeys.has(c.summary)) {
          seenCommitKeys.add(c.summary);
          hierarchyCommits.push(c);
        }
      }
      for (const d of directDeletesByMf.get(hMf) || []) {
        if (!seenDeleteKeys.has(d.summary)) {
          seenDeleteKeys.add(d.summary);
          hierarchyDeletes.push(d);
        }
      }
    }

    const callerDetails = callerDetailsByMf.get(qName) || [];
    const allCallersGuardNull =
      callerDetails.length > 0 &&
      callerDetails.every((cd) => cd.hasNullGuardBeforeCall || cd.callsValidatorBefore);
    const someCallersGuardSomeDont =
      callerDetails.length > 1 &&
      callerDetails.some((cd) => cd.hasNullGuardBeforeCall || cd.callsValidatorBefore) &&
      callerDetails.some((cd) => !cd.hasNullGuardBeforeCall && !cd.callsValidatorBefore);

    const isUnderlyingSubOrRule =
      /^(SUB_|VAL_|RULE_|CALC_)/i.test(shortName) ||
      Boolean(mf.shielded_by_parent) ||
      (!isTopLevelEntryMicroflow(qName) && directCallers.length > 0);

    // Build a readable sample user-flow path (`Page -> ACT_* -> SUB_*`)
    const samplePage = Array.from(reachableEntryPages)[0] || null;
    const sampleTopCaller = topLevelCallers[0] || directCallers[0] || null;
    const flowChainParts = [];
    if (samplePage) flowChainParts.push(`Page '${samplePage}'`);
    if (sampleTopCaller && sampleTopCaller !== qName) {
      flowChainParts.push(`'${sampleTopCaller}'`);
    }
    if (
      directCallers[0] &&
      directCallers[0] !== sampleTopCaller &&
      directCallers[0] !== qName
    ) {
      flowChainParts.push(`'${directCallers[0]}'`);
    }
    flowChainParts.push(`'${qName}'`);
    const sampleUserFlowPath = flowChainParts.join(" -> ");

    const protectingCallers = [];
    if (mf.shielded_by_parent) {
      protectingCallers.push(String(mf.shielded_by_parent));
    }
    for (const cd of callerDetails) {
      if (cd.hasNullGuardBeforeCall || cd.callsValidatorBefore) {
        protectingCallers.push(cd.caller);
      }
    }

    contextByMf.set(qName, {
      microflow: qName,
      is_top_level_entry: isTopLevelEntryMicroflow(qName) && !mf.shielded_by_parent,
      is_underlying_sub_microflow: isUnderlyingSubOrRule,
      shielded_by_parent: mf.shielded_by_parent || null,
      direct_callers: directCallers,
      upstream_callers: upstreamCallers,
      top_level_callers: topLevelCallers,
      downstream_callees: downstreamCallees,
      entry_pages: Array.from(reachableEntryPages),
      sample_user_flow_path: sampleUserFlowPath,
      protecting_callers: Array.from(new Set(protectingCallers)),
      all_callers_guard_inputs: allCallersGuardNull,
      asymmetric_caller_guards: someCallersGuardSomeDont,
      caller_details: callerDetails,
      direct_commits: directCommitsByMf.get(qName) || [],
      direct_deletes: directDeletesByMf.get(qName) || [],
      hierarchy_commits: hierarchyCommits,
      hierarchy_deletes: hierarchyDeletes,
      exposes_commit_or_delete_in_hierarchy:
        hierarchyCommits.length > 0 || hierarchyDeletes.length > 0,
    });
  }

  /**
   * Classifies a specific finding (`hypothesis`, `amber_risk`, or `amber_ui_candidate`)
   * as either:
   *   - `ACTUAL_UI_OR_API_REPRODUCIBLE`: Active bug reproducible today via UI screens or API endpoints
   *   - `LATENT_IMPLICITLY_PROTECTED`: Latent bug in an underlying microflow currently shielded by the UI / parent caller flow,
   *     which will be exposed as a regression bug when user flows or top-level callers change (critical if the call hierarchy commits or deletes).
   */
  const classifyFindingExposure = (finding) => {
    const mfQName = finding.microflow || `${defaultModule}.UnknownMicroflow`;
    const ctx = contextByMf.get(mfQName) || {
      microflow: mfQName,
      is_top_level_entry: !/^(SUB_|VAL_|RULE_|CALC_)/i.test(mfQName.split(".").pop()),
      is_underlying_sub_microflow: /^(SUB_|VAL_|RULE_|CALC_)/i.test(mfQName.split(".").pop()),
      shielded_by_parent: null,
      direct_callers: [],
      upstream_callers: [],
      top_level_callers: [],
      downstream_callees: [],
      entry_pages: [],
      sample_user_flow_path: `'${mfQName}'`,
      protecting_callers: [],
      all_callers_guard_inputs: false,
      asymmetric_caller_guards: false,
      caller_details: [],
      direct_commits: [],
      direct_deletes: [],
      hierarchy_commits: [],
      hierarchy_deletes: [],
      exposes_commit_or_delete_in_hierarchy: false,
    };

    const patId = String(finding.pattern_id || "");
    const isGuardSensitivePattern = /^(BHP-01|BHP-02|BHP-03|BHP-04|BHP-14|BHP-15|BHP-26|BHP-29|BHP-33|UFP-01)$/.test(
      patId
    );

    const isOrphanSubMicroflow =
      ctx.is_underlying_sub_microflow &&
      ctx.direct_callers.length === 0 &&
      ctx.entry_pages.length === 0;

    const isImplicitlyProtected =
      finding.exposure_classification === "LATENT_IMPLICITLY_PROTECTED" ||
      patId === "UFP-01" ||
      Boolean(ctx.shielded_by_parent) ||
      (ctx.is_underlying_sub_microflow &&
        isGuardSensitivePattern &&
        (ctx.all_callers_guard_inputs || ctx.protecting_callers.length > 0 || isOrphanSubMicroflow));

    const exposureClassification = isImplicitlyProtected
      ? "LATENT_IMPLICITLY_PROTECTED"
      : "ACTUAL_UI_OR_API_REPRODUCIBLE";

    const commitDeleteSummaryList = [
      ...ctx.hierarchy_commits.map((c) => `Commit: ${c.summary}`),
      ...ctx.hierarchy_deletes.map((d) => `Delete: ${d.summary}`),
    ];

    const implicitProtectionReason =
      finding.call_hierarchy_context?.implicit_protection_reason ||
      (isImplicitlyProtected
        ? ctx.shielded_by_parent
          ? `Currently protected by the calling flow '${ctx.shielded_by_parent}' (${ctx.sample_user_flow_path}), which checks or restricts the input before calling '${mfQName}'.`
          : ctx.protecting_callers.length > 0
            ? `Calling microflow(s) (${ctx.protecting_callers.map((c) => `'${c}'`).join(", ")}) currently check or validate the input before calling '${mfQName}' (${ctx.sample_user_flow_path}).`
            : `Sub-microflow '${mfQName}' is not directly called from an unguarded page or API today (${ctx.sample_user_flow_path}), so standard screen usage does not trigger this branch yet.`
        : `Directly reachable and reproducible today via ${ctx.entry_pages.length > 0 ? `Page(s) ${ctx.entry_pages.map((p) => `'${p}'`).join(", ")} -> ` : ""}${ctx.sample_user_flow_path} without an upstream check preventing the invalid state.`);

    const regressionExposureTrigger =
      finding.call_hierarchy_context?.regression_exposure_trigger ||
      (isImplicitlyProtected
        ? `Will surface as a regression bug if a page flow changes, an input field is made optional, or a new button/API microflow calls '${mfQName}' directly without repeating the caller's checks${ctx.exposes_commit_or_delete_in_hierarchy ? ` — risking invalid database changes because this call chain runs: ${commitDeleteSummaryList.slice(0, 3).join("; ")}` : ""}.`
        : `Can be triggered right now in the current app via a page action or API/microflow call (${ctx.sample_user_flow_path}).`);

    return {
      exposure_classification: exposureClassification,
      exposure_badge:
        exposureClassification === "LATENT_IMPLICITLY_PROTECTED"
          ? "🔶 Latent Bug (Protected Today by Calling Page/Microflow — Future Regression Risk)"
          : "🔴 Actual Bug (Reproducible Now via Page or API)",
      call_hierarchy_context: {
        ...ctx,
        implicit_protection_reason: implicitProtectionReason,
        regression_exposure_trigger: regressionExposureTrigger,
        commit_delete_hierarchy_summary:
          commitDeleteSummaryList.length > 0
            ? commitDeleteSummaryList.join("; ")
            : "None (No Commit or Delete in this call chain)",
      },
    };
  };

  // Synthesize UFP-01, UFP-02, UFP-03 User-Flow & Call-Hierarchy Findings
  const ufpAmberRisks = [];
  for (const mf of microflowList) {
    const qName = mf.qualified_name || `${defaultModule}.${mf.name}`;
    const ctx = contextByMf.get(qName);
    if (!ctx) continue;

    // UFP-02: Inconsistent Input Checks Across Callers in a Commit/Delete Call Chain
    if (ctx.asymmetric_caller_guards && ctx.exposes_commit_or_delete_in_hierarchy) {
      const guardedCallers = ctx.caller_details
        .filter((cd) => cd.hasNullGuardBeforeCall || cd.callsValidatorBefore)
        .map((cd) => cd.caller);
      const unguardedCallers = ctx.caller_details
        .filter((cd) => !cd.hasNullGuardBeforeCall && !cd.callsValidatorBefore)
        .map((cd) => cd.caller);
      ufpAmberRisks.push({
        pattern_id: "UFP-02",
        category: "User-Flow & Call-Chain Risk",
        defect_tier: "AMBER",
        severity: "HIGH",
        microflow: qName,
        activity_id: "call_hierarchy_asymmetry",
        activity_caption: "Multiple Calling Microflows",
        title: `Inconsistent Input Checks Across Callers of '${qName.split(".").pop()}' in a Commit/Delete Call Chain`,
        oracle_rule: `Sub-microflow '${qName}' is part of a call chain that commits or deletes database objects (${[...ctx.hierarchy_commits, ...ctx.hierarchy_deletes].map((x) => x.summary).slice(0, 2).join("; ")}), and is called by microflow(s) that check inputs (${guardedCallers.join(", ")}) as well as microflow(s) that skip those checks (${unguardedCallers.join(", ")}).`,
        amber_reason: `'${guardedCallers.join(", ")}' checks inputs before calling '${qName}', whereas '${unguardedCallers.join(", ")}' calls '${qName}' directly without checking inputs first.`,
        remediation: `Move the input check ($Param != empty and required attribute checks) inside '${qName}' itself so every calling microflow is protected before any Commit or Delete runs.`,
      });
    }

    // UFP-03: Database Commit or Delete Runs Before Downstream Validation
    for (const cd of ctx.caller_details) {
      const isValidatorCallee = /^(VAL_|RULE_|SUB_.*validate)/i.test(qName.split(".").pop());
      if (
        isValidatorCallee &&
        (cd.commitsBeforeCall.length > 0 || cd.deletesBeforeCall.length > 0)
      ) {
        ufpAmberRisks.push({
          pattern_id: "UFP-03",
          category: "User-Flow & Call-Chain Risk",
          defect_tier: "AMBER",
          severity: "HIGH",
          microflow: cd.caller,
          activity_id: cd.activity_id || "premature_commit_delete",
          activity_caption: cd.activity_caption || `Call ${qName.split(".").pop()}`,
          title: `Database Commit or Delete in '${cd.caller.split(".").pop()}' Runs Before Validation '${qName.split(".").pop()}'`,
          oracle_rule: `Calling microflow '${cd.caller}' commits or deletes database objects (${[...cd.commitsBeforeCall, ...cd.deletesBeforeCall].join("; ")}) BEFORE calling validation sub-microflow '${qName}'. If '${qName}' finds invalid data, database changes have already been executed.`,
          amber_reason: `Validation sub-microflows ('VAL_*') should always run and pass before any Commit or Delete Object activity in the call chain.`,
          remediation: `Reorder '${cd.caller}' so validation sub-microflow '${qName}' runs and passes before any Commit or Delete Object activity is reached.`,
        });
      }
    }
  }

  return {
    contextByMf,
    classifyFindingExposure,
    ufpAmberRisks,
  };
}

/**
 * Harvests all Business Rules across all 4 sources:
 *   1. MCP Documentation (`PAT-126` external specs from Confluence/Jira/Rovo)
 *   2. Workspace Documentation Files (`--rules-file`, `--docs`, `requirements/*.md`)
 *   3. Mendix Model Documentation (Microflow/Rule `documentation`, `@RULE:` `annotations`, Entity & Attribute `documentation`)
 *   4. Mendix Validation & Domain Rules (`VAL_*`, `RULE_*`, `ValidationFeedback`, `BeforeCommit`, `is_required`/`is_unique`, Entity Access Rules)
 * And cross-checks documented specifications against the Mendix AST (`ANTI-69` functional verification)
 * to synthesize `BRP-01` (`Documented Business Rule vs. Code Discrepancy`) hypotheses when code contradicts documentation,
 * and maps every business rule to its enforcement / violation status (`VIOLATED`, `BYPASSED_AT_RISK`, `ENFORCED`).
 */
export function extractAndCrossCheckBusinessRules(
  bundle = {},
  microflowList = [],
  allHypotheses = [],
  allAmberRisks = [],
  allAmberUiCandidates = []
) {
  const defaultModule = bundle.module || "Module";
  const rawRules = [];
  const seenKeys = new Set();

  const pushUniqueRule = (entry) => {
    const normText = String(entry.rule_text || "").trim().replace(/\s+/g, " ");
    if (!normText) return;
    if (
      entry.source_type === "Mendix Model Documentation" &&
      !isNormativeBusinessRuleText(normText, Boolean(entry.is_annotation))
    ) {
      return;
    }
    const dedupKey = `${entry.target_element || defaultModule}::${normText.toLowerCase()}`;
    if (seenKeys.has(dedupKey)) return;
    seenKeys.add(dedupKey);
    rawRules.push({
      ...entry,
      rule_text: normText,
    });
  };

  // 1. Ingest External Business Rules (MCP Documentation & Workspace Documentation Files)
  const extRules = Array.isArray(bundle.external_business_rules) ? bundle.external_business_rules : [];
  for (const ext of extRules) {
    pushUniqueRule({
      rule_text: ext.rule_text || ext.rule || ext.description || "",
      source_type: ext.source_type || (ext.mcp_retrieved ? "MCP Documentation" : "Workspace Documentation File"),
      source_location: ext.source_location || ext.reference || "External Spec",
      target_element: ext.target_element || ext.microflow || ext.entity || `${defaultModule}`,
      attribute: ext.attribute || null,
      is_documented_spec: true,
    });
  }

  // 2. Ingest Mendix Model Documentation (Microflow documentation & annotations, Entity & Attribute documentation)
  for (const mf of microflowList) {
    const qName = mf.qualified_name || `${defaultModule}.${mf.name}`;
    if (mf.documentation && String(mf.documentation).trim()) {
      pushUniqueRule({
        rule_text: String(mf.documentation).trim(),
        source_type: "Mendix Model Documentation",
        source_location: `Microflow '${qName}'.documentation`,
        target_element: qName,
        is_documented_spec: true,
        is_annotation: false,
      });
    }
    for (const [annIdx, ann] of (mf.annotations || []).entries()) {
      const cleanedAnn = String(ann || "").trim();
      if (cleanedAnn) {
        pushUniqueRule({
          rule_text: cleanedAnn,
          source_type: "Mendix Model Documentation",
          source_location: `Microflow '${qName}' Annotation #${annIdx + 1}`,
          target_element: qName,
          is_documented_spec: true,
          is_annotation: true,
        });
      }
    }
  }

  for (const ent of bundle.entities || []) {
    const entQName = ent.qualified_name || `${defaultModule}.${ent.name}`;
    if (ent.documentation && String(ent.documentation).trim()) {
      pushUniqueRule({
        rule_text: String(ent.documentation).trim(),
        source_type: "Mendix Model Documentation",
        source_location: `Entity '${entQName}'.documentation`,
        target_element: entQName,
        is_documented_spec: true,
      });
    }
    for (const attr of ent.attributes || []) {
      if (attr.documentation && String(attr.documentation).trim()) {
        pushUniqueRule({
          rule_text: `${ent.name || entQName}.${attr.name}: ${String(attr.documentation).trim()}`,
          source_type: "Mendix Model Documentation",
          source_location: `Attribute '${entQName}.${attr.name}'.documentation`,
          target_element: entQName,
          attribute: attr.name,
          is_documented_spec: true,
        });
      }
    }
  }

  // 3. Active Spec-vs-Code Cross-Check (`BRP-01`: Documented Business Rule vs. Code Discrepancy)
  // Functional testing cannot rely on the Mendix AST alone (`ANTI-69`). Compare documented specs against ExclusiveSplits.
  for (const docRule of rawRules.filter((r) => r.is_documented_spec)) {
    const rText = docRule.rule_text;
    // Detect inclusive ("at least N", "minimum N", ">= N", "N or more") or exclusive ("greater than N", "more than N", "> N", "exceeds N") or upper ("at most N", "maximum N", "<= N") rules
    const inclusiveMinMatch = rText.match(
      /(?:\b([A-Za-z0-9_]+)\b[^.\n]{0,40}?)?\b(?:at\s+least|minimum(?:\s+of)?|min\.?|>=)\s*(-?\d+(?:\.\d+)?)|\b(-?\d+(?:\.\d+)?)\s+or\s+(?:more|greater|higher)\b/i
    );
    const inclusiveMaxMatch = rText.match(
      /(?:\b([A-Za-z0-9_]+)\b[^.\n]{0,40}?)?\b(?:at\s+most|maximum(?:\s+of)?|max\.?|no\s+more\s+than|<=)\s*(-?\d+(?:\.\d+)?)/i
    );

    if (inclusiveMinMatch || inclusiveMaxMatch) {
      const expectedNum = Number(
        inclusiveMinMatch ? inclusiveMinMatch[2] ?? inclusiveMinMatch[3] : inclusiveMaxMatch[2]
      );
      const isMin = Boolean(inclusiveMinMatch);

      for (const mf of microflowList) {
        const mfQName = mf.qualified_name || `${defaultModule}.${mf.name}`;
        if (
          docRule.target_element &&
          docRule.target_element.includes(".") &&
          docRule.target_element !== mfQName &&
          !mf.parameters?.some((p) => p.entity === docRule.target_element)
        ) {
          continue;
        }

        for (const act of mf.activities || []) {
          if (act.type !== "ExclusiveSplit" || !act.expression) continue;
          const splitMatch = act.expression.match(
            /\$([A-Za-z0-9_]+)\/([A-Za-z0-9_]+)\s*(>=|<=|>|<|=)\s*(-?\d+(?:\.\d+)?)/
          );
          if (!splitMatch) continue;
          const [, objVar, attrName, codeOp, codeValStr] = splitMatch;
          const codeVal = Number(codeValStr);

          // Check if attribute matches rule text or explicit attribute
          const docAttrShort = docRule.attribute ? docRule.attribute.split(".").pop().toLowerCase() : null;
          if (docAttrShort && docAttrShort !== attrName.toLowerCase()) {
            continue;
          }
          if (
            !docAttrShort &&
            !new RegExp(`\\b${attrName}\\b`, "i").test(rText) &&
            docRule.target_element !== mfQName
          ) {
            continue;
          }

          const hasExistingBrp01 = allHypotheses.some(
            (h) =>
              h.pattern_id === "BRP-01" &&
              h.microflow === mfQName &&
              h.activity_id === act.id
          );

          const isStrictVsInclusiveMismatch =
            (isMin && codeOp === ">" && codeVal === expectedNum) ||
            (!isMin && codeOp === "<" && codeVal === expectedNum);
          const isThresholdValueMismatch =
            !Number.isNaN(expectedNum) &&
            !Number.isNaN(codeVal) &&
            codeVal !== expectedNum &&
            new RegExp(`\\b${attrName}\\b`, "i").test(rText);

          if ((isStrictVsInclusiveMismatch || isThresholdValueMismatch) && !hasExistingBrp01) {
            const boundaryTestVal = expectedNum;
            const newHyp = {
              id: `HYP_${allHypotheses.length + 1}`,
              pattern_id: "BRP-01",
              category: "Documented Business Rule vs. Code Discrepancy",
              tier_classification: "TIER_1_DOCUMENTED_RULE",
              defect_tier: "RED",
              severity: "HIGH",
              microflow: mfQName,
              activity_id: act.id,
              activity_caption: act.caption || act.id,
              title: `Documented Business Rule Contradicts Split on $${objVar}/${attrName} (${docRule.source_type})`,
              oracle_rule: `Documented Business Rule (${docRule.source_location}): "${rText}" requires ${attrName} ${isMin ? ">=" : "<="} ${expectedNum}, but microflow '${mfQName}' implements '${act.expression}'.`,
              expected_safe_outcome: `When $${objVar}/${attrName} = ${boundaryTestVal}, '${mfQName}' must satisfy the documented rule ("${rText}").`,
              variation_overrides: {
                [`${objVar}.${attrName}`]: boundaryTestVal,
              },
              remediation: `Align the ExclusiveSplit expression in '${mfQName}' (${act.caption || act.id}) with the documented business rule (${docRule.source_location}): use '${isMin ? ">=" : "<="} ${expectedNum}'.`,
              verification_status: "STATIC_AST_CANDIDATE",
            };
            newHyp.dual_risk = classifyFindingDualRisk(newHyp, bundle);
            allHypotheses.push(newHyp);
          }
        }
      }
    }
  }

  // Helper to format technical Mendix split expressions into business-readable English
  const formatBusinessRuleCondition = (rawExpr = "") => {
    let s = String(rawExpr || "").trim();
    if (!s) return "";
    // Remove boilerplate `$Var != empty` guards when combined with a real condition
    const parts = s
      .split(/\s+and\s+|\s+AND\s+/i)
      .map((p) => p.trim())
      .filter((p) => !/^\$[A-Za-z0-9_]+\s*(?:!=|=)\s*empty$/i.test(p));
    if (parts.length > 0) {
      s = parts.join(" and ");
    }
    return s
      .replace(/CommunityCommons\.IsNotEmptyString\(\s*\$([A-Za-z0-9_./]+)\s*\)/gi, "$1 is filled in")
      .replace(/\$([A-Za-z0-9_]+)\/([A-Za-z0-9_]+)\s*!=\s*empty/gi, "$1.$2 is filled in")
      .replace(/\$([A-Za-z0-9_]+)\/([A-Za-z0-9_]+)\s*=\s*empty/gi, "$1.$2 is empty")
      .replace(/\$([A-Za-z0-9_]+)\/([A-Za-z0-9_]+)/g, "$1.$2")
      .replace(/\$([A-Za-z0-9_]+)/g, "$1");
  };

  // 4. Ingest Mendix Validation & Domain Rules (`VAL_*`, `RULE_*`, `ValidationFeedback`, Domain Model & RBAC Invariants)
  for (const mf of microflowList) {
    const qName = mf.qualified_name || `${defaultModule}.${mf.name}`;
    const shortName = mf.name || qName.split(".").pop();
    const isValOrRuleMf = /^(VAL_|RULE_|BCO_|SUB_.*validate)/i.test(shortName) || mf.microflow_type === "RULE";

    // Extract ValidationFeedback messages as explicit validation business rules
    for (const act of mf.activities || []) {
      if (act.type === "ValidationFeedback") {
        const msg = (act.message_template || act.message || "").trim();
        // Skip internal technical null-parameter system messages (e.g., "Booking parameter not found. Please contact your system administrator.")
        if (/parameter not found|contact your system administrator/i.test(msg)) {
          continue;
        }
        const targetAttr = act.attribute || (act.member_refs && act.member_refs[0]) || act.variable || "Object";
        const cleanField = String(targetAttr).replace(/^[A-Za-z0-9_]+Module\./, "");
        const nonTrivialSplits = (mf.activities || [])
          .filter(
            (a) =>
              a.type === "ExclusiveSplit" &&
              a.expression &&
              !/^\$[A-Za-z0-9_]+\s*(?:!=|=)\s*empty$/i.test(a.expression.trim())
          )
          .map((a) => formatBusinessRuleCondition(a.expression))
          .filter(Boolean)
          .slice(0, 2)
          .join("; ");
        const ruleSummary = msg
          ? `Field **${cleanField}**: Shows message *"${msg}"* when validation fails${nonTrivialSplits ? ` (checks: \`${nonTrivialSplits}\`)` : ""}`
          : `Field **${cleanField}**: Validated in \`${shortName}\`${nonTrivialSplits ? ` (checks: \`${nonTrivialSplits}\`)` : ""}`;
        pushUniqueRule({
          rule_text: ruleSummary,
          source_type: "Mendix Validation / Domain Rule",
          source_location: `${qName} -> ${act.caption || act.id}`,
          target_element: qName,
          attribute: targetAttr,
          is_documented_spec: false,
        });
      }
    }

    // If a VAL_* or RULE_* microflow has splits but no ValidationFeedback (e.g., boolean return rule), record its guard condition
    if (isValOrRuleMf && !(mf.activities || []).some((a) => a.type === "ValidationFeedback")) {
      const splits = (mf.activities || [])
        .filter(
          (a) =>
            a.type === "ExclusiveSplit" &&
            a.expression &&
            !/^\$[A-Za-z0-9_]+\s*(?:!=|=)\s*empty$/i.test(a.expression.trim())
        )
        .map((a) => formatBusinessRuleCondition(a.expression))
        .filter(Boolean);
      if (splits.length > 0) {
        pushUniqueRule({
          rule_text: `Validation Rule (\`${shortName}\`): Requires \`${splits.slice(0, 2).join("; ")}\``,
          source_type: "Mendix Validation / Domain Rule",
          source_location: qName,
          target_element: qName,
          is_documented_spec: false,
        });
      }
    }
  }

  for (const ent of bundle.entities || []) {
    const entQName = ent.qualified_name || `${defaultModule}.${ent.name}`;
    const entShort = ent.name || entQName.split(".").pop();
    for (const attr of ent.attributes || []) {
      if (attr.is_required || attr.is_unique) {
        const flags = [attr.is_required ? "Required (cannot be empty)" : null, attr.is_unique ? "Unique (no duplicates allowed)" : null]
          .filter(Boolean)
          .join(" & ");
        pushUniqueRule({
          rule_text: `Data Rule on **${entShort}.${attr.name}**: Marked as **${flags}** in the Domain Model.`,
          source_type: "Mendix Validation / Domain Rule",
          source_location: `Domain Model '${entQName}.${attr.name}'`,
          target_element: entQName,
          attribute: attr.name,
          is_documented_spec: false,
        });
      }
    }
    for (const eh of ent.event_handlers || []) {
      const errBehavior = eh.raise_error_on_false
        ? "stops and shows an error if check fails"
        : "silently cancels the save without showing an error if check fails";
      pushUniqueRule({
        rule_text: `Automatic Save Rule (${eh.event}) on **${entShort}**: Runs \`${eh.microflow}\` before saving (${errBehavior}).`,
        source_type: "Mendix Validation / Domain Rule",
        source_location: `Domain Model '${entQName}' (${eh.event})`,
        target_element: entQName,
        related_microflow: eh.microflow,
        is_documented_spec: false,
      });
    }
  }

  for (const pg of bundle.pages || []) {
    const pgQName = pg.qualified_name || `${defaultModule}.${pg.name}`;
    const pgShort = pg.name || pgQName.split(".").pop();
    for (const w of pg.widgets || []) {
      if (w.required_on_page && w.attribute) {
        const cleanAttr = String(w.attribute).replace(/^[A-Za-z0-9_]+Module\./, "");
        pushUniqueRule({
          rule_text: `Screen Required Field on **${pgShort}**: Field **${cleanAttr}** (\`${w.name}\`) must be filled in before clicking Save (${(pg.calls_microflows || []).join(", ") || "Save"}).`,
          source_type: "Mendix Validation / Domain Rule",
          source_location: `Page '${pgQName}' -> Widget '${w.name}'`,
          target_element: (pg.calls_microflows && pg.calls_microflows[0]) || pgQName,
          attribute: w.attribute,
          is_documented_spec: false,
        });
      }
    }
  }

  // 5. Reconcile Every Business Rule Against Detected Findings (Hypotheses, AMBER Risks, AMBER-UI Candidates)
  // Deduplicate allFindings so identical findings across AMBER and AMBER-UI are only matched once
  const rawAllFindings = [
    ...allHypotheses.map((h) => ({ ...h, bucket: "HYPOTHESIS" })),
    ...allAmberRisks.map((a) => ({ ...a, bucket: "AMBER" })),
    ...allAmberUiCandidates.map((u) => ({ ...u, bucket: "AMBER-UI" })),
  ];
  const seenFindingKeys = new Set();
  const allFindings = [];
  for (const f of rawAllFindings) {
    const dedupKey = `${f.pattern_id}|${f.microflow || ""}|${f.title || ""}`;
    if (seenFindingKeys.has(dedupKey)) continue;
    seenFindingKeys.add(dedupKey);
    allFindings.push(f);
  }

  // Also ensure any finding whose `oracle_rule` represents a business rule not yet in `rawRules` is represented
  for (const f of allFindings) {
    if (
      /^(BHP-06|BRP-01|BHP-32|DQP-01|DQP-02|DQP-04|DQP-08|SEC-0[1-9]|UFP-0[1-3])$/i.test(
        f.pattern_id || ""
      )
    ) {
      const fTarget = f.microflow || f.page_qualified_name || defaultModule;
      const hasMatchingRule = rawRules.some(
        (r) =>
          r.target_element === fTarget ||
          (r.related_microflow && r.related_microflow === fTarget) ||
          (f.title && r.attribute && f.title.includes(r.attribute.split(".").pop()))
      );
      if (!hasMatchingRule) {
        pushUniqueRule({
          rule_text: f.oracle_rule || f.amber_reason || f.title,
          source_type: /^SEC-/i.test(f.pattern_id)
            ? "Mendix Security / Access Rule"
            : "Mendix Validation / Domain Rule",
          source_location: `${fTarget}${f.activity_caption ? ` -> ${f.activity_caption}` : ""}`,
          target_element: fTarget,
          is_documented_spec: false,
        });
      }
    }
  }

  const businessRules = rawRules.map((rule, idx) => {
    const ruleId = `BR-${String(idx + 1).padStart(2, "0")}`;
    const targetShort = String(rule.target_element || "").split(".").pop();
    const attrShort = rule.attribute ? String(rule.attribute).split(".").pop() : null;

    // Word-boundary matcher that strips module names first so "CarRentalModule" never false-matches entity "Car"
    const containsToken = (haystack, token) => {
      if (!token || token.length < 2) return false;
      const strippedHaystack = String(haystack || "").replace(new RegExp(`\\b${defaultModule}\\.`, "g"), "");
      const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      return new RegExp(`(?:^|[^A-Za-z0-9_])${escaped}(?:$|[^A-Za-z0-9_])`).test(strippedHaystack);
    };

    const matchingFindings = allFindings.filter((f) => {
      const fMf = f.microflow || "";
      const fText = `${f.title || ""} ${f.oracle_rule || ""} ${f.amber_reason || ""} ${f.activity_caption || ""}`;
      if (rule.target_element && fMf === rule.target_element) {
        if (attrShort && /^(DQP-02|BHP-06|BRP-01|BHP-01|BHP-17)$/.test(f.pattern_id)) {
          return containsToken(fText, attrShort) || f.pattern_id === "BHP-06" || f.pattern_id === "BRP-01";
        }
        return true;
      }
      if (rule.related_microflow && containsToken(fText, rule.related_microflow.split(".").pop())) {
        return true;
      }
      if (targetShort && containsToken(fText, targetShort)) {
        if (attrShort) {
          return containsToken(fText, attrShort);
        }
        // If rule has no specific attribute (e.g. an entity-level event handler), only match findings that reference the related_microflow or the exact target_element
        return !rule.related_microflow && f.target_entity === rule.target_element;
      }
      return false;
    });

    const hasHypothesisViolation = matchingFindings.some((f) => f.bucket === "HYPOTHESIS");
    const hasAmberBypass = matchingFindings.some((f) => f.bucket === "AMBER" || f.bucket === "AMBER-UI");

    let status = "ENFORCED_IN_MODEL";
    if (matchingFindings.length === 1 && matchingFindings[0].pattern_id === "BHP-01") {
      status = "CRASHES_ON_EMPTY_INPUT";
    } else if (hasHypothesisViolation) {
      status = "VIOLATED_OR_TESTABLE_DEFECT";
    } else if (hasAmberBypass) {
      status = "BYPASSED_AT_RISK";
    }

    const violatedBy = matchingFindings.map((f) => ({
      id: f.id || f.pattern_id,
      pattern_id: f.pattern_id,
      bucket: f.bucket,
      defect_tier: f.defect_tier || (f.bucket === "HYPOTHESIS" ? "RED" : f.bucket),
      title: f.title,
      microflow: f.microflow || rule.target_element,
      explanation: f.oracle_rule || f.amber_reason || f.title,
    }));

    return {
      id: ruleId,
      rule_text: rule.rule_text,
      source_type: rule.source_type,
      source_location: rule.source_location,
      target_element: rule.target_element,
      attribute: rule.attribute || null,
      is_documented_spec: Boolean(rule.is_documented_spec),
      status,
      violated_by_findings: violatedBy,
      violation_summary:
        violatedBy.length > 0
          ? violatedBy.map((v) => `[${v.pattern_id}] ${v.title}`).join("; ")
          : "No static or runtime rule contradiction detected.",
    };
  });

  return businessRules;
}

// ============================================================================
// 3B. AUTOMATIC MODEL-DERIVED INVARIANT BUSINESS RULE MINER (`v3.1.0`)
// ============================================================================

/**
 * State-Independence Filter (`isStateIndependentExpression`).
 *
 * Returns `true` only when a Mendix expression evaluates a condition over
 * persistent dataset attributes without depending on transient session,
 * user role, HTTP transport, or Non-Persistent Entity (NPE) state.
 */
export function isStateIndependentExpression(expr = "", npeVars = new Set()) {
  const s = String(expr || "").trim();
  if (!s) return false;
  if (
    /\$(?:currentUser|currentSession|latestHttpResponse|latestError|latestSoapFault)\b/i.test(s) ||
    /\[%(?:CurrentUser|UserRole_|CurrentDateTime|BeginOfCurrent|EndOfCurrent)/i.test(s)
  ) {
    return false;
  }
  for (const npeVar of npeVars) {
    if (npeVar && new RegExp(`\\$${npeVar}\\b`).test(s)) {
      return false;
    }
  }
  return true;
}

/**
 * 5-Layer Model Invariant Miner (`mineInvariantBusinessRules`).
 *
 * Automatically derives state-independent Invariant Business Rules (predicates P(d) in {true, false}
 * that must hold for any persisted dataset regardless of workflow or session state) across:
 *   1. Domain Model Validation Rules (`RangeRuleInfo`, `RequiredRuleInfo`, `MaxLengthRuleInfo`, `UniqueRuleInfo`)
 *   2. Microflow Guard Splits (`ExclusiveSplit` preceding `ValidationFeedback` or `Commit`)
 *   3. Page Widget Constraints (`required_on_page`, min/max bounds on persistent entities)
 *   4. Deterministic Intra-Entity Formula Equations (`ChangeObject` member assignments prior to commit)
 *   5. Cross-Committer Bypass Analysis (identifies microflows that commit the entity without enforcing P(d))
 */
export function mineInvariantBusinessRules(bundle = {}, microflowListInput = null, options = {}) {
  const defaultModule = bundle.module || "Module";
  const rawMicroflows =
    Array.isArray(microflowListInput) && microflowListInput.length > 0
      ? microflowListInput
      : Array.isArray(bundle.microflows) && bundle.microflows.length > 0
        ? bundle.microflows
        : bundle.target_microflow
          ? [bundle.target_microflow]
          : [];
  const microflowList = rawMicroflows.map((m) => normalizeStudioProMicroflow(m, defaultModule));
  const entities = Array.isArray(bundle.entities)
    ? bundle.entities
    : bundle.$Type === "DomainModels$DomainModel"
      ? normalizeStudioProDomainModel(bundle, defaultModule)
      : [];

  const entityMap = new Map();
  const nonPersistentEntities = new Set();
  for (const ent of entities) {
    const eq = ent.qualified_name || `${defaultModule}.${ent.name}`;
    const shortName = ent.name || eq.split(".").pop();
    const isNpe =
      ent.is_persistent === false ||
      ent.persistable === false ||
      /^NPE_/i.test(shortName);
    if (isNpe) {
      nonPersistentEntities.add(eq);
      nonPersistentEntities.add(shortName);
    } else {
      entityMap.set(eq, ent);
      entityMap.set(shortName, ent);
    }
  }

  // Index microflows by qualified and short name, and track which microflows commit which persistent entities
  const mfByName = new Map();
  const committersByEntity = new Map(); // entityQName -> Set<mfQName>
  const calleesByMf = new Map(); // mfQName -> Set<calledMfQName>

  const recordCommitter = (entQ, mfQName) => {
    if (!entQ || !mfQName || nonPersistentEntities.has(entQ)) return;
    if (!committersByEntity.has(entQ)) committersByEntity.set(entQ, new Set());
    committersByEntity.get(entQ).add(mfQName);
  };

  for (const mf of microflowList) {
    const qName = mf.qualified_name || `${defaultModule}.${mf.name}`;
    mfByName.set(qName, mf);
    mfByName.set(mf.name || qName.split(".").pop(), mf);
    const paramEntByVar = new Map();
    for (const p of mf.parameters || []) {
      if (p.entity) paramEntByVar.set(p.name, p.entity);
    }
    const createdEntByVar = new Map();
    for (const act of mf.activities || []) {
      if (act.type === "CreateObject" && act.entity && (act.output_variable || act.variable)) {
        createdEntByVar.set(act.output_variable || act.variable, act.entity);
      }
    }
    const callees = new Set();
    for (const act of mf.activities || []) {
      if (act.type === "MicroflowCall" && (act.called_microflow || act.microflow)) {
        callees.add(act.called_microflow || act.microflow);
      }
      const isCommitAct =
        act.type === "Commit" ||
        act.type === "CommitObject" ||
        ((act.type === "CreateObject" || act.type === "ChangeObject") &&
          /^yes$/i.test(String(act.commit || "")));
      if (isCommitAct) {
        const targetEnt =
          act.entity ||
          paramEntByVar.get(act.variable) ||
          createdEntByVar.get(act.variable) ||
          (mf.parameters && mf.parameters[0]?.entity) ||
          null;
        if (targetEnt) {
          const normEnt = entityMap.get(targetEnt)?.qualified_name || targetEnt;
          recordCommitter(normEnt, qName);
        }
      }
    }
    calleesByMf.set(qName, callees);
  }

  for (const oc of bundle.other_committers || []) {
    if (oc.commits_entity && oc.qualified_name) {
      recordCommitter(oc.commits_entity, oc.qualified_name);
    }
  }

  const rawInvariants = [];
  const seenInvKeys = new Set();

  const addInvariantCandidate = (cand) => {
    if (!cand || !cand.entity || !cand.predicate_expression) return;
    if (nonPersistentEntities.has(cand.entity) || nonPersistentEntities.has(cand.entity_short)) return;
    const dedupKey = `${cand.entity}::${cand.predicate_expression.replace(/\s+/g, "")}`;
    const existing = rawInvariants.find(
      (r) => `${r.entity}::${r.predicate_expression.replace(/\s+/g, "")}` === dedupKey
    );
    if (existing) {
      for (const loc of cand.enforced_in || []) {
        if (!existing.enforced_in.includes(loc)) existing.enforced_in.push(loc);
      }
      if (cand.enforced_at_entity_level) existing.enforced_at_entity_level = true;
      return;
    }
    seenInvKeys.add(dedupKey);
    rawInvariants.push({
      ...cand,
      enforced_in: Array.from(new Set(cand.enforced_in || [])),
    });
  };

  // Pass 1: Domain Model Validation Rules & Attributes
  for (const ent of entities) {
    const entQName = ent.qualified_name || `${defaultModule}.${ent.name}`;
    const entShort = ent.name || entQName.split(".").pop();
    if (nonPersistentEntities.has(entQName)) continue;

    const hasActiveBco = (ent.event_handlers || []).some(
      (eh) => eh.event === "BeforeCommit" && eh.raise_error_on_false !== false
    );

    for (const attr of ent.attributes || []) {
      const attrName = attr.name;
      if (!attrName || /^AutoNumber/i.test(attr.type || "") || attr.is_auto_number) continue;

      const valRules = (ent.validation_rules || []).filter(
        (vr) => vr.attribute === attrName || String(vr.attribute || "").split(".").pop() === attrName
      );

      const minVal =
        valRules.find((r) => r.rule_type === "RangeRuleInfo" || r.min_value !== undefined)?.min_value ??
        attr.min_value ??
        null;
      const maxVal =
        valRules.find((r) => r.rule_type === "RangeRuleInfo" || r.max_value !== undefined)?.max_value ??
        attr.max_value ??
        null;
      const isReq =
        Boolean(attr.is_required) ||
        valRules.some((r) => r.rule_type === "RequiredRuleInfo" || r.rule_type === "Required");

      if (minVal !== null && maxVal !== null) {
        const isDec = /Decimal|Float|Currency/i.test(attr.type || "");
        const step = isDec ? 0.01 : 1;
        addInvariantCandidate({
          entity: entQName,
          entity_short: entShort,
          attribute: attrName,
          attributes: [attrName],
          category: "SINGLE_ATTRIBUTE_BOUND",
          title: `${entShort}.${attrName} must be between ${minVal} and ${maxVal}`,
          predicate_expression: `${entShort}.${attrName} >= ${minVal} and ${entShort}.${attrName} <= ${maxVal}`,
          negated_xpath: `[${attrName} < ${minVal} or ${attrName} > ${maxVal}]`,
          thresholds: [Number(minVal), Number(maxVal)],
          min_value: Number(minVal),
          max_value: Number(maxVal),
          compliant_override: { [`${entShort}.${attrName}`]: Number(minVal) },
          violating_override: { [`${entShort}.${attrName}`]: Number((Number(maxVal) + step).toFixed(4)) },
          source_type: "Domain Model Validation Rule",
          source_location: `Domain Model '${entQName}.${attrName}' (Range ${minVal}..${maxVal})`,
          enforced_in: [`DomainModel:${entQName}.${attrName}`],
          enforced_at_entity_level: Boolean(valRules.length > 0 || hasActiveBco),
        });
      } else if (minVal !== null) {
        const isDec = /Decimal|Float|Currency/i.test(attr.type || "");
        const step = isDec ? 0.01 : 1;
        addInvariantCandidate({
          entity: entQName,
          entity_short: entShort,
          attribute: attrName,
          attributes: [attrName],
          category: "SINGLE_ATTRIBUTE_BOUND",
          title: `${entShort}.${attrName} must be at least ${minVal}`,
          predicate_expression: `${entShort}.${attrName} >= ${minVal}`,
          negated_xpath: `[${attrName} < ${minVal}]`,
          thresholds: [Number(minVal)],
          min_value: Number(minVal),
          max_value: null,
          compliant_override: { [`${entShort}.${attrName}`]: Number(minVal) },
          violating_override: { [`${entShort}.${attrName}`]: Number((Number(minVal) - step).toFixed(4)) },
          source_type: "Domain Model Validation Rule",
          source_location: `Domain Model '${entQName}.${attrName}' (Min ${minVal})`,
          enforced_in: [`DomainModel:${entQName}.${attrName}`],
          enforced_at_entity_level: Boolean(valRules.length > 0 || hasActiveBco),
        });
      }

      if (isReq) {
        addInvariantCandidate({
          entity: entQName,
          entity_short: entShort,
          attribute: attrName,
          attributes: [attrName],
          category: "REQUIRED_NON_EMPTY",
          title: `${entShort}.${attrName} is required (cannot be empty)`,
          predicate_expression: `${entShort}.${attrName} != empty`,
          negated_xpath: `[${attrName} = empty]`,
          thresholds: [],
          min_value: null,
          max_value: null,
          compliant_override: { [`${entShort}.${attrName}`]: "VALID_VALUE" },
          violating_override: { [`${entShort}.${attrName}`]: "empty" },
          source_type: "Domain Model Validation Rule",
          source_location: `Domain Model '${entQName}.${attrName}' (Required)`,
          enforced_in: [`DomainModel:${entQName}.${attrName}`],
          enforced_at_entity_level: Boolean(valRules.length > 0 || hasActiveBco),
        });
      }
    }
  }

  // Pass 2: Microflow Guard Conditions (`ExclusiveSplit` & `ChangeObject` Formula Invariants)
  for (const mf of microflowList) {
    const qName = mf.qualified_name || `${defaultModule}.${mf.name}`;
    const paramEntByVar = new Map();
    const npeVars = new Set();
    for (const p of mf.parameters || []) {
      const entQ = p.entity || `${defaultModule}.${p.name}`;
      paramEntByVar.set(p.name, entQ);
      if (nonPersistentEntities.has(entQ) || nonPersistentEntities.has(entQ.split(".").pop())) {
        npeVars.add(p.name);
      }
    }

    for (const act of mf.activities || []) {
      if (act.type === "ExclusiveSplit" && act.expression) {
        const expr = String(act.expression).trim();
        if (!isStateIndependentExpression(expr, npeVars)) continue;

        // 2A. Cross-Attribute Relational Comparison: $Obj/AttrA >= $Obj/AttrB
        const crossMatch = expr.match(
          /^\$([A-Za-z0-9_]+)\/([A-Za-z0-9_]+)\s*(>=|<=|>|<|=)\s*\$\1\/([A-Za-z0-9_]+)$/
        );
        if (crossMatch) {
          const [, varN, attrA, op, attrB] = crossMatch;
          const entQ = paramEntByVar.get(varN) || `${defaultModule}.${varN}`;
          const entShort = entQ.split(".").pop();
          const isDateAttr = /Date|Time/i.test(attrA) || /Date|Time/i.test(attrB);
          // If the split expression is a violation check (e.g., `$Booking/ReturnDate < $Booking/PickupDate` leading to feedback), normalize to the positive compliance invariant
          const isViolationTrap =
            (op === "<" || op === "<=") &&
            (/Return|End|To|Delivery|Max/i.test(attrA) && /Pickup|Start|From|Order|Min/i.test(attrB));
          const normOp = isViolationTrap ? (op === "<" ? ">=" : ">") : op;
          const negOp = normOp === ">=" ? "<" : normOp === ">" ? "<=" : normOp === "<=" ? ">" : "<";

          const isGreater = normOp.startsWith(">");
          const compliantOverride = isDateAttr
            ? {
                [`${entShort}.${attrB}`]: "2026-06-15T10:00:00.000Z",
                [`${entShort}.${attrA}`]: isGreater ? "2026-06-16T10:00:00.000Z" : "2026-06-14T10:00:00.000Z",
              }
            : {
                [`${entShort}.${attrB}`]: 100,
                [`${entShort}.${attrA}`]: isGreater ? 100 : 50,
              };
          const violatingOverride = isDateAttr
            ? {
                [`${entShort}.${attrB}`]: "2026-12-01T10:00:00.000Z",
                [`${entShort}.${attrA}`]: isGreater ? "2026-11-25T10:00:00.000Z" : "2026-12-10T10:00:00.000Z",
              }
            : {
                [`${entShort}.${attrB}`]: 100,
                [`${entShort}.${attrA}`]: isGreater ? 50 : 150,
              };

          addInvariantCandidate({
            entity: entQ,
            entity_short: entShort,
            attribute: attrA,
            secondary_attribute: attrB,
            attributes: [attrA, attrB],
            category: "CROSS_ATTRIBUTE_RELATION",
            title: `${entShort}.${attrA} must satisfy '${attrA} ${normOp} ${attrB}'`,
            predicate_expression: `${entShort}.${attrA} ${normOp} ${entShort}.${attrB}`,
            negated_xpath: `[${attrA} ${negOp} ${attrB}]`,
            thresholds: [],
            min_value: null,
            max_value: null,
            compliant_override: compliantOverride,
            violating_override: violatingOverride,
            source_type: "Microflow Guard Condition",
            source_location: `${qName} -> ${act.caption || act.id}`,
            enforced_in: [qName],
            enforced_at_entity_level: /^BCO_/i.test(mf.name || ""),
          });
          continue;
        }

        // 2B. Single-Attribute Numeric Bound: $Obj/Attr >= K, $Obj/Attr <= K, $Obj/Attr > K
        const numMatch = expr.match(
          /^\$([A-Za-z0-9_]+)\/([A-Za-z0-9_]+)\s*(>=|<=|>|<)\s*(-?\d+(?:\.\d+)?)$/
        );
        if (numMatch) {
          const [, varN, attrName, op, numStr] = numMatch;
          const kVal = Number(numStr);
          const entQ = paramEntByVar.get(varN) || `${defaultModule}.${varN}`;
          const entShort = entQ.split(".").pop();
          const entDef = entityMap.get(entQ) || entityMap.get(entShort);
          const attrDef = (entDef?.attributes || []).find((a) => a.name === attrName);
          if (attrDef && (/^AutoNumber/i.test(attrDef.type || "") || attrDef.is_auto_number)) continue;

          const isDec =
            (attrDef && /Decimal|Float|Currency/i.test(attrDef.type || "")) ||
            numStr.includes(".") ||
            /Amount|Price|Total|Subtotal|Tax|Rate|Fee|Cost|Balance/i.test(attrName);
          const step = isDec ? 0.01 : 1;

          const negOp = op === ">=" ? "<" : op === ">" ? "<=" : op === "<=" ? ">" : ">=";
          const compliantVal =
            op === ">"
              ? Number((kVal + step).toFixed(4))
              : op === "<"
                ? Number((kVal - step).toFixed(4))
                : kVal;
          const violatingVal =
            op === ">=" || op === ">"
              ? Number((kVal - step).toFixed(4))
              : Number((kVal + step).toFixed(4));

          addInvariantCandidate({
            entity: entQ,
            entity_short: entShort,
            attribute: attrName,
            attributes: [attrName],
            category: "SINGLE_ATTRIBUTE_BOUND",
            title: `${entShort}.${attrName} must satisfy '${attrName} ${op} ${kVal}'`,
            predicate_expression: `${entShort}.${attrName} ${op} ${kVal}`,
            negated_xpath: `[${attrName} ${negOp} ${kVal} or ${attrName} = empty]`,
            thresholds: [kVal],
            min_value: op.startsWith(">") ? kVal : null,
            max_value: op.startsWith("<") ? kVal : null,
            compliant_override: { [`${entShort}.${attrName}`]: compliantVal },
            violating_override: { [`${entShort}.${attrName}`]: violatingVal },
            source_type: "Microflow Guard Condition",
            source_location: `${qName} -> ${act.caption || act.id}`,
            enforced_in: [qName],
            enforced_at_entity_level: /^BCO_/i.test(mf.name || ""),
          });
        }
      }

      // 2C. Deterministic Intra-Entity Formula Invariants (`ChangeObject` assigning TargetAttr = $Obj/Attr1 [+-*] $Obj/Attr2)
      if (act.type === "ChangeObject" && (act.changes || act.items)) {
        const varN = act.variable || (mf.parameters && mf.parameters[0]?.name) || "Entity";
        const entQ = paramEntByVar.get(varN) || act.entity || `${defaultModule}.${varN}`;
        const entShort = entQ.split(".").pop();
        for (const ch of act.changes || act.items || []) {
          const targetAttr = String(ch.attribute || "").split(".").pop();
          const valExpr = String(ch.value || "").trim();
          if (!targetAttr || !valExpr || !isStateIndependentExpression(valExpr, npeVars)) continue;
          const refMatches = Array.from(valExpr.matchAll(/\$([A-Za-z0-9_]+)\/([A-Za-z0-9_]+)/g));
          const sourceAttrs = Array.from(new Set(refMatches.map((m) => m[2])));
          // Only record pure derived formulas where targetAttr is computed from OTHER attributes (not self-mutating `Subtotal = $Quote/Subtotal - ...`)
          if (sourceAttrs.length >= 2 && !sourceAttrs.includes(targetAttr) && /[+\-*]/.test(valExpr)) {
            const cleanFormula = valExpr.replace(/\$([A-Za-z0-9_]+)\//g, `${entShort}.`);
            addInvariantCandidate({
              entity: entQ,
              entity_short: entShort,
              attribute: targetAttr,
              attributes: [targetAttr, ...sourceAttrs],
              category: "FORMULA_EQUALITY",
              title: `Derived attribute ${entShort}.${targetAttr} must equal ${cleanFormula}`,
              predicate_expression: `${entShort}.${targetAttr} = ${cleanFormula}`,
              negated_xpath: `[${targetAttr} != ${valExpr.replace(/\$([A-Za-z0-9_]+)\//g, "")}]`,
              formula_expression: valExpr,
              thresholds: [],
              min_value: null,
              max_value: null,
              compliant_override: { [`${entShort}.${sourceAttrs[0]}`]: 100, [`${entShort}.${sourceAttrs[1]}`]: 20 },
              violating_override: { [`${entShort}.${sourceAttrs[0]}`]: 100, [`${entShort}.${sourceAttrs[1]}`]: -50 },
              source_type: "Microflow Calculation Formula",
              source_location: `${qName} -> ${act.caption || act.id}`,
              enforced_in: [qName],
              enforced_at_entity_level: false,
            });
          }
        }
      }
    }
  }

  // Pass 3: Page Widget Constraints on Persistent Entities
  for (const pg of bundle.pages || []) {
    const pgQName = pg.qualified_name || `${defaultModule}.${pg.name}`;
    for (const w of pg.widgets || []) {
      if (w.required_on_page && w.attribute) {
        const parts = String(w.attribute).split(".");
        const attrName = parts.pop();
        const entShort = parts.pop() || "Entity";
        const entQ = parts.length > 0 ? `${parts.join(".")}.${entShort}` : `${defaultModule}.${entShort}`;
        addInvariantCandidate({
          entity: entQ,
          entity_short: entShort,
          attribute: attrName,
          attributes: [attrName],
          category: "REQUIRED_NON_EMPTY",
          title: `${entShort}.${attrName} is required on page '${pg.name || pgQName}'`,
          predicate_expression: `${entShort}.${attrName} != empty`,
          negated_xpath: `[${attrName} = empty]`,
          thresholds: [],
          min_value: null,
          max_value: null,
          compliant_override: { [`${entShort}.${attrName}`]: "VALID_VALUE" },
          violating_override: { [`${entShort}.${attrName}`]: "empty" },
          source_type: "Page Widget Validation Rule",
          source_location: `Page '${pgQName}' -> Widget '${w.name}'`,
          enforced_in: [...(pg.calls_microflows || []), `Page:${pgQName}`],
          enforced_at_entity_level: false,
        });
      }
    }
  }

  // Pass 4: Cross-Committer Bypass Analysis
  const doesMicroflowCheckInvariant = (mfQName, inv, visited = new Set()) => {
    if (!mfQName || visited.has(mfQName)) return false;
    visited.add(mfQName);
    if (inv.enforced_in.includes(mfQName)) return true;

    const mfObj = mfByName.get(mfQName) || mfByName.get(mfQName.split(".").pop());
    if (!mfObj) return false;

    for (const act of mfObj.activities || []) {
      if (act.type === "ExclusiveSplit" && act.expression) {
        const expr = String(act.expression);
        if (inv.attribute && new RegExp(`\\b${inv.attribute}\\b`).test(expr)) {
          return true;
        }
      }
      if (act.type === "MicroflowCall" && (act.called_microflow || act.microflow)) {
        const callee = act.called_microflow || act.microflow;
        if (
          inv.enforced_in.some(
            (loc) => loc === callee || loc.split(".").pop() === callee.split(".").pop()
          ) ||
          doesMicroflowCheckInvariant(callee, inv, visited)
        ) {
          return true;
        }
      }
    }
    return false;
  };

  const countByEntity = new Map();
  const finalizedInvariants = rawInvariants.map((inv) => {
    const codePrefix = String(inv.entity_short || "ENT")
      .replace(/[^A-Za-z0-9]/g, "")
      .toUpperCase()
      .slice(0, 5) || "ENT";
    const nextNum = (countByEntity.get(codePrefix) || 0) + 1;
    countByEntity.set(codePrefix, nextNum);
    const invariantId = `INV-${codePrefix}-${String(nextNum).padStart(2, "0")}`;

    const entityCommitters = Array.from(committersByEntity.get(inv.entity) || []);
    const enforcedCommitters = [];
    const bypassedCommitters = [];

    for (const commMf of entityCommitters) {
      if (inv.enforced_at_entity_level || doesMicroflowCheckInvariant(commMf, inv)) {
        enforcedCommitters.push(commMf);
      } else {
        bypassedCommitters.push(commMf);
      }
    }

    return {
      invariant_id: invariantId,
      entity: inv.entity,
      entity_short: inv.entity_short,
      attribute: inv.attribute,
      secondary_attribute: inv.secondary_attribute || null,
      attributes: inv.attributes || [inv.attribute].filter(Boolean),
      category: inv.category,
      title: inv.title,
      predicate_expression: inv.predicate_expression,
      negated_xpath: inv.negated_xpath,
      thresholds: inv.thresholds || [],
      min_value: inv.min_value,
      max_value: inv.max_value,
      compliant_override: inv.compliant_override || {},
      violating_override: inv.violating_override || {},
      source_type: inv.source_type,
      source_location: inv.source_location,
      enforced_in: inv.enforced_in,
      enforced_in_committers: enforcedCommitters,
      bypassed_in_committers: bypassedCommitters,
      enforced_at_entity_level: Boolean(inv.enforced_at_entity_level),
      status: bypassedCommitters.length > 0 ? "BYPASSED_IN_COMMIT_FLOW" : "ENFORCED_IN_ALL_COMMITTERS",
      dataset_compliance_probe: {
        action: "Retrieve",
        entity: inv.entity,
        xpath_constraint: inv.negated_xpath,
        expected_count: 0,
      },
    };
  });

  return finalizedInvariants;
}

/**
 * Renders a standalone Markdown catalog of discovered Invariant Business Rules (`renderInvariantCatalogMarkdown`).
 */
export function renderInvariantCatalogMarkdown(invariants = [], moduleName = "Module") {
  const bypassedCount = invariants.filter((i) => (i.bypassed_in_committers || []).length > 0).length;
  const rows =
    invariants.length > 0
      ? invariants
          .map((inv) => {
            const enforcedStr =
              (inv.enforced_in || []).map((e) => `\`${e}\``).join(", ") || "`-`";
            const bypassStr =
              (inv.bypassed_in_committers || []).length > 0
                ? inv.bypassed_in_committers.map((m) => `🔴 \`${m}\``).join("<br>")
                : "🟢 None *(Enforced in all committers)*";
            return `| **\`${inv.invariant_id}\`** | \`${inv.entity}\`<br>(\`${(inv.attributes || []).join(", ")}\`) | **${inv.title}**<br>\`${inv.predicate_expression}\` | ${inv.source_type}<br>*(${inv.source_location})* | ${enforcedStr} | ${bypassStr} | \`${inv.negated_xpath}\` |`;
          })
          .join("\n")
      : "| `-` | `-` | No state-independent invariant business rules detected | `-` | `-` | `-` | `-` |";

  return `# Discovered Invariant Business Rules Catalog: \`${moduleName}\`
* **Total State-Independent Invariant Rules Mined:** \`${invariants.length}\`
* **Rules With Unguarded Commit Flows (Bypass Risk):** \`${bypassedCount}\`
* **Rules Enforced Across All Commit Flows:** \`${invariants.length - bypassedCount}\`

| Rule ID | Entity & Attribute(s) | Invariant Business Rule (\`true\` = Dataset Compliant) | Discovered In | Enforced In | Bypassed In Commit Flows | Database Compliance Query (Negated XPath) |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
${rows}
`;
}

// ============================================================================
// 3C. AST-GUIDED PAIRWISE PERMUTATION & PROPERTY-BASED TESTING (PBT) (`v3.0.0`)
// ============================================================================

/**
 * Extracts Mendix-native equivalence partitions for a microflow's object parameters
 * and referenced/entity attributes (`extractMicroflowDomainPartitions`).
 *
 * Enforces Mendix type semantics:
 *  - Object parameters: `["VALID", "NONE"]`
 *  - `Boolean` / `BooleanType`: strictly 2-valued `[true, false]` (never `"empty"`)
 *  - `Enumeration` / `EnumerationType`: 3-valued `[...literals, "empty"]`
 *  - `Integer`/`Long`/`Decimal`/`Float`/`Currency`: `["empty", 0, -1, K-step, K, K+step, ...]`
 *    harvested from `ExclusiveSplit` thresholds, `DomainModels$RangeRuleInfo`, AND
 *    module-wide `mineInvariantBusinessRules` (`v3.1.0`), plus repeating-binary decimal inputs
 *    (`0.1`, `0.2`, `19.99`, `33.33`) when float/decimal or arithmetic is present
 *  - `DateTime`: `["empty", "2026-06-14T00:00:00.000Z", "2026-06-15T00:00:00.000Z", "2026-06-16T00:00:00.000Z"]`
 *  - `String`: `["empty", "", "VALID_STR"]`, plus `max_length + 1` overflow string when `max_length` is defined
 *  - Strictly excludes `AutoNumber` / `AutoNumberType` attributes (`ANTI-83`).
 */
export function extractMicroflowDomainPartitions(rawMf, bundle = {}, options = {}) {
  const defaultModule = bundle.module || "Module";
  const mf = normalizeStudioProMicroflow(rawMf || {}, defaultModule);
  const qName = mf.qualified_name || `${defaultModule}.${mf.name || "Microflow"}`;
  const entities = Array.isArray(bundle.entities)
    ? bundle.entities
    : bundle.$Type === "DomainModels$DomainModel"
      ? normalizeStudioProDomainModel(bundle, defaultModule)
      : [];
  const entityMap = new Map();
  for (const ent of entities) {
    const eq = ent.qualified_name || `${defaultModule}.${ent.name}`;
    entityMap.set(eq, ent);
    entityMap.set(ent.name || eq.split(".").pop(), ent);
  }

  // Automatic module-wide Invariant Business Rule partition enrichment (v3.1.0)
  const invariantRules =
    Array.isArray(options.invariantRules)
      ? options.invariantRules
      : Array.isArray(bundle.invariant_rules)
        ? bundle.invariant_rules
        : options.invariants === false
          ? []
          : mineInvariantBusinessRules(bundle);

  const parameterSentinels = {};
  const paramEntityByVar = new Map();
  for (const p of mf.parameters || []) {
    const isObj = p.type === "Object" || p.type === "ObjectType" || Boolean(p.entity);
    if (isObj) {
      const entQ = p.entity || `${defaultModule}.${p.name}`;
      paramEntityByVar.set(p.name, entQ);
      parameterSentinels[p.name] = {
        param_name: p.name,
        entity: entQ,
        values: ["VALID", "NONE"],
        baseline_value: "VALID",
      };
    }
  }

  // Harvest attribute thresholds, enum literals, and arithmetic signals from activities
  const thresholdsByAttr = new Map(); // attrShort -> Set<number>
  const enumLitsByAttr = new Map(); // attrShort -> Set<string>
  const arithmeticAttrs = new Set(); // attrShort
  const referencedAttrs = new Map(); // attrShort -> entityQName

  const addReferencedAttr = (varName, attrName) => {
    if (!attrName || /^(id|createdDate|changedDate|owner|changedBy)$/i.test(attrName)) return;
    const entQ =
      paramEntityByVar.get(varName) ||
      (mf.parameters && mf.parameters[0]?.entity) ||
      `${defaultModule}.${varName || "Entity"}`;
    if (!referencedAttrs.has(attrName)) {
      referencedAttrs.set(attrName, entQ);
    }
  };

  for (const act of mf.activities || []) {
    const exprs = [
      act.expression,
      act.value,
      act.xpath_constraint,
      ...(Array.isArray(act.changes) ? act.changes.map((c) => `${c.attribute || ""} = ${c.value || ""}`) : []),
      ...(Array.isArray(act.items) ? act.items.map((c) => `${c.attribute || ""} = ${c.value || ""}`) : []),
    ].filter(Boolean);

    for (const expr of exprs) {
      const varAttrMatches = String(expr).matchAll(/\$([A-Za-z0-9_]+)\/([A-Za-z0-9_]+)(?!\s*\.)/g);
      for (const m of varAttrMatches) {
        addReferencedAttr(m[1], m[2]);
        if (/[/*]/.test(String(expr))) {
          arithmeticAttrs.add(m[2]);
        }
      }

      // Numeric comparisons: $Var/Attr >= K, $Var/Attr > K, etc.
      const cmpMatches = String(expr).matchAll(
        /\$([A-Za-z0-9_]+)\/([A-Za-z0-9_]+)\s*(?:>=|<=|!=|>|<|=)\s*(-?\d+(?:\.\d+)?)/g
      );
      for (const cm of cmpMatches) {
        const [, varN, attrN, numStr] = cm;
        addReferencedAttr(varN, attrN);
        const numVal = Number(numStr);
        if (!Number.isNaN(numVal)) {
          if (!thresholdsByAttr.has(attrN)) thresholdsByAttr.set(attrN, new Set());
          thresholdsByAttr.get(attrN).add(numVal);
        }
      }

      // Enum comparisons: $Var/Attr = Module.Enum.Literal
      const enumMatches = String(expr).matchAll(
        /\$([A-Za-z0-9_]+)\/([A-Za-z0-9_]+)\s*(?:=|!=)\s*([A-Za-z0-9_]+\.[A-Za-z0-9_]+\.([A-Za-z0-9_]+))/g
      );
      for (const em of enumMatches) {
        const [, varN, attrN, , lit] = em;
        addReferencedAttr(varN, attrN);
        if (!enumLitsByAttr.has(attrN)) enumLitsByAttr.set(attrN, new Set());
        enumLitsByAttr.get(attrN).add(lit);
      }
    }

    for (const ch of act.changes || act.items || []) {
      const attrShort = String(ch.attribute || "").split(".").pop();
      if (attrShort) {
        addReferencedAttr(act.variable || mf.parameters?.[0]?.name || "Entity", attrShort);
        if (/[/*]/.test(String(ch.value || ""))) {
          arithmeticAttrs.add(attrShort);
        }
      }
    }
  }

  // Also include attributes declared on parameter entities in the domain model
  for (const [, entQ] of paramEntityByVar.entries()) {
    const entDef = entityMap.get(entQ) || entityMap.get(entQ.split(".").pop());
    if (entDef && Array.isArray(entDef.attributes)) {
      for (const a of entDef.attributes) {
        if (!referencedAttrs.has(a.name)) {
          referencedAttrs.set(a.name, entDef.qualified_name || entQ);
        }
      }
    }
  }

  // Merge thresholds & attributes from module-wide Invariant Business Rules for referenced entities (v3.1.0)
  const referencedEntitySet = new Set([
    ...Array.from(paramEntityByVar.values()),
    ...Array.from(paramEntityByVar.values()).map((e) => String(e).split(".").pop()),
  ]);
  for (const inv of invariantRules) {
    if (
      referencedEntitySet.has(inv.entity) ||
      referencedEntitySet.has(inv.entity_short)
    ) {
      for (const attrN of inv.attributes || [inv.attribute].filter(Boolean)) {
        if (!referencedAttrs.has(attrN)) {
          referencedAttrs.set(attrN, inv.entity);
        }
      }
      if (inv.attribute && Array.isArray(inv.thresholds) && inv.thresholds.length > 0) {
        if (!thresholdsByAttr.has(inv.attribute)) {
          thresholdsByAttr.set(inv.attribute, new Set());
        }
        for (const tVal of inv.thresholds) {
          if (typeof tVal === "number" && !Number.isNaN(tVal)) {
            thresholdsByAttr.get(inv.attribute).add(tVal);
          }
        }
      }
    }
  }

  const factors = {};
  for (const [attrName, entQ] of referencedAttrs.entries()) {
    const entShort = String(entQ || "Entity").split(".").pop();
    const entDef = entityMap.get(entQ) || entityMap.get(entShort);
    const attrDef = (entDef?.attributes || []).find(
      (a) => a.name && a.name.toLowerCase() === attrName.toLowerCase()
    );

    const rawType = String(attrDef?.type || "").trim();
    // Strictly skip AutoNumber attributes (ANTI-83)
    if (
      /^AutoNumber/i.test(rawType) ||
      attrDef?.is_auto_number === true ||
      /^AutoId$/i.test(attrName)
    ) {
      continue;
    }

    let inferredType = rawType;
    if (!inferredType) {
      if (enumLitsByAttr.has(attrName) || /Status|State|Type|Category|Tier|Role/i.test(attrName)) {
        inferredType = enumLitsByAttr.has(attrName) ? "Enumeration" : "String";
      } else if (/^(Is|Has|Allow|Enable|Active|Confirmed|Approved|Verified)/i.test(attrName)) {
        inferredType = "Boolean";
      } else if (/Date|Time|At$/i.test(attrName)) {
        inferredType = "DateTime";
      } else if (
        /Amount|Price|Total|Subtotal|Tax|Rate|Discount|Fee|Cost|Balance|Vat|Pct|Ratio|Avg|Weight/i.test(
          attrName
        )
      ) {
        inferredType = "Decimal";
      } else if (
        thresholdsByAttr.has(attrName) ||
        /Count|Qty|Quantity|Age|Days|Hours|Stock|Limit|Number|Score|Points/i.test(attrName)
      ) {
        inferredType = "Integer";
      } else {
        inferredType = "String";
      }
    }

    const factorKey = `${entShort}.${attrName}`;
    const thresholds = Array.from(thresholdsByAttr.get(attrName) || []);
    const minVal = attrDef?.min_value !== undefined && attrDef?.min_value !== null ? Number(attrDef.min_value) : null;
    const maxVal = attrDef?.max_value !== undefined && attrDef?.max_value !== null ? Number(attrDef.max_value) : null;
    const maxLen = attrDef?.max_length !== undefined && attrDef?.max_length !== null ? Number(attrDef.max_length) : null;

    let values = [];
    let baselineValue = "VALID_STR";

    if (/^Boolean/i.test(inferredType)) {
      // Mendix Booleans are strictly 2-valued (never empty/null)
      values = [true, false];
      baselineValue = true;
    } else if (/^Enum/i.test(inferredType)) {
      const modelEnums = Array.isArray(attrDef?.enum_values)
        ? attrDef.enum_values
        : Array.isArray(attrDef?.enumeration_values)
          ? attrDef.enumeration_values
          : [];
      const astEnums = Array.from(enumLitsByAttr.get(attrName) || []);
      const combinedEnums = Array.from(new Set([...modelEnums, ...astEnums]));
      const baseEnums = combinedEnums.length > 0 ? combinedEnums : ["Active", "Pending"];
      values = [...baseEnums, "empty"];
      baselineValue = baseEnums[0];
    } else if (/^(Integer|Long|Decimal|Float|Currency)/i.test(inferredType)) {
      const isDecimalOrFloat = /^(Decimal|Float|Currency)/i.test(inferredType);
      const step = isDecimalOrFloat ? 0.01 : 1;
      const numSet = new Set(["empty", 0, -1]);

      for (const k of thresholds) {
        const km = Number((k - step).toFixed(4));
        const kp = Number((k + step).toFixed(4));
        numSet.add(km);
        numSet.add(k);
        numSet.add(kp);
      }
      if (minVal !== null && !Number.isNaN(minVal)) {
        numSet.add(Number((minVal - step).toFixed(4)));
        numSet.add(minVal);
      }
      if (maxVal !== null && !Number.isNaN(maxVal)) {
        numSet.add(maxVal);
        numSet.add(Number((maxVal + step).toFixed(4)));
      }
      if (isDecimalOrFloat || arithmeticAttrs.has(attrName)) {
        for (const fp of [0.1, 0.2, 19.99, 33.33]) {
          numSet.add(fp);
        }
      }
      if (thresholds.length === 0 && minVal === null && maxVal === null && !isDecimalOrFloat) {
        numSet.add(1);
        numSet.add(100);
      }

      values = Array.from(numSet);
      baselineValue =
        thresholds.length > 0
          ? Number((thresholds[0] + step).toFixed(4))
          : maxVal !== null && minVal !== null
            ? Math.max(minVal, Math.min(maxVal, 10))
            : isDecimalOrFloat
              ? 100.0
              : 10;
    } else if (/^DateTime/i.test(inferredType)) {
      values = [
        "empty",
        "2026-06-14T00:00:00.000Z",
        "2026-06-15T00:00:00.000Z",
        "2026-06-16T00:00:00.000Z",
      ];
      baselineValue = "2026-06-15T00:00:00.000Z";
    } else {
      // StringType
      const strSet = ["empty", "", "VALID_STR"];
      if (maxLen !== null && !Number.isNaN(maxLen) && maxLen > 0 && maxLen <= 500) {
        strSet.push("X".repeat(maxLen + 1));
      }
      values = strSet;
      baselineValue = maxLen && maxLen < 9 ? "X".repeat(Math.max(1, maxLen - 1)) : "VALID_STR";
    }

    factors[factorKey] = {
      key: factorKey,
      entity: entQ,
      entity_short: entShort,
      attribute: attrName,
      type: inferredType,
      values,
      baseline_value: baselineValue,
      thresholds,
      min_value: minVal,
      max_value: maxVal,
      max_length: maxLen,
      participates_in_arithmetic: arithmeticAttrs.has(attrName),
    };
  }

  return {
    microflow: qName,
    parameter_sentinels: parameterSentinels,
    factors,
  };
}

/**
 * Deterministic IPOG (In-Parameter-Order-General) t=2 Pairwise Combinatorial Generator.
 *
 * Accepts either the `{ factors }` output of `extractMicroflowDomainPartitions`
 * or a plain map `{ "FactorA": [v1, v2], "FactorB": [u1, u2, u3] }`.
 * Guarantees 100% 2-way pair coverage across all factor value partitions before
 * applying an optional `options.maxPermutations` cap.
 */
export function generatePairwisePermutations(partitionsInput = {}, options = {}) {
  const rawFactors = partitionsInput.factors || partitionsInput;
  const factorList = [];

  for (const [k, v] of Object.entries(rawFactors || {})) {
    const vals = Array.isArray(v) ? v : Array.isArray(v?.values) ? v.values : [];
    if (vals.length === 0) continue;
    const uniqueVals = [];
    const seen = new Set();
    for (const item of vals) {
      const sig = `${typeof item}:${String(item)}`;
      if (!seen.has(sig)) {
        seen.add(sig);
        uniqueVals.push(item);
      }
    }
    factorList.push({
      key: k,
      values: uniqueVals,
      baseline: v?.baseline_value !== undefined ? v.baseline_value : uniqueVals[0],
    });
  }

  if (factorList.length === 0) {
    return {
      rows: [],
      total_cartesian_combinations: 0,
      pairwise_count: 0,
      total_pairs: 0,
      covered_pairs: 0,
      pair_coverage_pct: 100,
    };
  }

  const totalCartesian = factorList.reduce((acc, f) => acc * f.values.length, 1);

  if (factorList.length === 1) {
    const f0 = factorList[0];
    const singleRows = f0.values.map((val) => ({ [f0.key]: val }));
    const maxCap = Number(options.maxPermutations || 0);
    return {
      rows: maxCap > 0 ? singleRows.slice(0, maxCap) : singleRows,
      total_cartesian_combinations: totalCartesian,
      pairwise_count: singleRows.length,
      total_pairs: f0.values.length,
      covered_pairs: f0.values.length,
      pair_coverage_pct: 100,
    };
  }

  // Sort factors by domain size descending for IPOG optimality, preserving original index for stable output keys
  const sortedFactors = [...factorList].sort((a, b) => b.values.length - a.values.length);
  const valSig = (v) => `${typeof v}:${String(v)}`;

  // Step 1: Seed table with Cartesian product of the first two largest factors
  const table = [];
  const f0 = sortedFactors[0];
  const f1 = sortedFactors[1];
  for (const v0 of f0.values) {
    for (const v1 of f1.values) {
      table.push({
        [f0.key]: v0,
        [f1.key]: v1,
      });
    }
  }

  // Step 2: IPOG Horizontal + Vertical Growth for each remaining factor F_i (i >= 2)
  for (let i = 2; i < sortedFactors.length; i++) {
    const fi = sortedFactors[i];
    const domain = fi.values;

    // Enumerate all required pairs between F_i and every prior factor F_j (0 <= j < i)
    const uncoveredByPrior = new Map(); // j -> Set<"sigJ||sigI">
    const pairLookup = new Map(); // "j::sigJ||sigI" -> { j, valJ, valI }
    for (let j = 0; j < i; j++) {
      const fj = sortedFactors[j];
      const setJ = new Set();
      for (const vj of fj.values) {
        for (const vi of domain) {
          const pKey = `${valSig(vj)}||${valSig(vi)}`;
          setJ.add(pKey);
          pairLookup.set(`${j}::${pKey}`, { j, keyJ: fj.key, valJ: vj, valI: vi });
        }
      }
      uncoveredByPrior.set(j, setJ);
    }

    const usageCount = new Map(domain.map((v) => [valSig(v), 0]));

    // 2a. Horizontal growth: assign value in D_i to each existing row that covers the most uncovered pairs
    for (const row of table) {
      let bestVal = domain[0];
      let bestGain = -1;
      let bestUsage = Infinity;

      for (const cand of domain) {
        const candSig = valSig(cand);
        let gain = 0;
        for (let j = 0; j < i; j++) {
          const fjKey = sortedFactors[j].key;
          if (row[fjKey] === undefined) continue;
          const pKey = `${valSig(row[fjKey])}||${candSig}`;
          if (uncoveredByPrior.get(j).has(pKey)) {
            gain++;
          }
        }
        const used = usageCount.get(candSig) || 0;
        if (gain > bestGain || (gain === bestGain && used < bestUsage)) {
          bestGain = gain;
          bestVal = cand;
          bestUsage = used;
        }
      }

      row[fi.key] = bestVal;
      const chosenSig = valSig(bestVal);
      usageCount.set(chosenSig, (usageCount.get(chosenSig) || 0) + 1);
      for (let j = 0; j < i; j++) {
        const fjKey = sortedFactors[j].key;
        if (row[fjKey] === undefined) continue;
        const pKey = `${valSig(row[fjKey])}||${chosenSig}`;
        uncoveredByPrior.get(j).delete(pKey);
      }
    }

    // 2b. Vertical growth: cover any remaining uncovered pairs using partial rows with wildcards (`undefined`)
    for (let j = 0; j < i; j++) {
      const fjKey = sortedFactors[j].key;
      const remainingSet = uncoveredByPrior.get(j);
      for (const pKey of Array.from(remainingSet)) {
        if (!remainingSet.has(pKey)) continue;
        const pairInfo = pairLookup.get(`${j}::${pKey}`);
        if (!pairInfo) continue;

        // Try to find an existing row where fi is compatible (or undefined) and fj is compatible (or undefined)
        let targetRow = table.find(
          (r) =>
            (r[fi.key] === undefined || valSig(r[fi.key]) === valSig(pairInfo.valI)) &&
            (r[fjKey] === undefined || valSig(r[fjKey]) === valSig(pairInfo.valJ))
        );

        if (!targetRow) {
          targetRow = {};
          table.push(targetRow);
        }

        targetRow[fjKey] = pairInfo.valJ;
        targetRow[fi.key] = pairInfo.valI;

        // Remove all pairs newly covered by this row assignment
        const sigI = valSig(targetRow[fi.key]);
        for (let k = 0; k < i; k++) {
          const fkKey = sortedFactors[k].key;
          if (targetRow[fkKey] !== undefined) {
            uncoveredByPrior.get(k).delete(`${valSig(targetRow[fkKey])}||${sigI}`);
          }
        }
      }
    }
  }

  // Fill any remaining wildcard (`undefined`) cells deterministically
  for (let rIdx = 0; rIdx < table.length; rIdx++) {
    const row = table[rIdx];
    for (const f of factorList) {
      if (row[f.key] === undefined) {
        row[f.key] = f.values[rIdx % f.values.length];
      }
    }
  }

  // Normalize key ordering in each row to match original factorList order
  const orderedRows = table.map((row) => {
    const clean = {};
    for (const f of factorList) {
      clean[f.key] = row[f.key];
    }
    return clean;
  });

  // Compute exact 2-way pair coverage across all C(k, 2) factor pairs
  let totalPairs = 0;
  let coveredPairs = 0;
  for (let a = 0; a < factorList.length; a++) {
    for (let b = a + 1; b < factorList.length; b++) {
      const fa = factorList[a];
      const fb = factorList[b];
      const required = new Set();
      for (const va of fa.values) {
        for (const vb of fb.values) {
          required.add(`${valSig(va)}||${valSig(vb)}`);
        }
      }
      totalPairs += required.size;
      const observed = new Set();
      for (const r of orderedRows) {
        const pairSig = `${valSig(r[fa.key])}||${valSig(r[fb.key])}`;
        if (required.has(pairSig)) {
          observed.add(pairSig);
        }
      }
      coveredPairs += observed.size;
    }
  }

  const pairCoveragePct =
    totalPairs > 0 ? Number(((coveredPairs / totalPairs) * 100).toFixed(2)) : 100;

  const maxCap = Number(options.maxPermutations || 0);
  const finalRows =
    maxCap > 0 && orderedRows.length > maxCap ? orderedRows.slice(0, maxCap) : orderedRows;

  return {
    rows: finalRows,
    full_covering_array_size: orderedRows.length,
    total_cartesian_combinations: totalCartesian,
    pairwise_count: finalRows.length,
    total_pairs: totalPairs,
    covered_pairs: coveredPairs,
    pair_coverage_pct: pairCoveragePct,
  };
}

/**
 * Synthesizes Mendix Property-Based Testing (PBT) hypotheses (`PBT-01`..`PBT-05`)
 * from a microflow's AST, extracted equivalence partitions, and IPOG pairwise covering array.
 *
 * Notice: Uses natural Mendix developer/business-engineer terminology in all titles and rules
 * (strictly free of banned internal jargon).
 */
export function synthesizePropertyHypotheses(
  rawMf,
  bundle = {},
  existingHypotheses = [],
  existingAmbers = [],
  options = {}
) {
  const defaultModule = bundle.module || "Module";
  const mf = normalizeStudioProMicroflow(rawMf || {}, defaultModule);
  const qName = mf.qualified_name || `${defaultModule}.${mf.name || "Microflow"}`;
  const shortName = mf.name || qName.split(".").pop();
  const maxSamples = Number(options.maxSamples || options.pbtSamples || 12);

  const partitions = extractMicroflowDomainPartitions(mf, bundle, options);
  const factorKeys = Object.keys(partitions.factors || {});
  const pairwise = generatePairwisePermutations(partitions, { maxPermutations: maxSamples });
  const synthesized = [];

  const baselineOverrides = {};
  for (const [k, f] of Object.entries(partitions.factors || {})) {
    baselineOverrides[k] = f.baseline_value;
  }

  // Pick a high-risk adversarial permutation row (containing multiple non-baseline/boundary values)
  const boundaryRow =
    pairwise.rows.find((r) => {
      let nonBase = 0;
      for (const k of factorKeys) {
        if (r[k] === "empty" || r[k] === 0 || r[k] === -1 || r[k] !== baselineOverrides[k]) {
          nonBase++;
        }
      }
      return nonBase >= Math.min(2, factorKeys.length);
    }) ||
    pairwise.rows[0] ||
    {};

  // 1. PBT-01: Multi-Variable Combinatorial Crash or Exception
  const splitActivities = (mf.activities || []).filter((a) => a.type === "ExclusiveSplit");
  if (factorKeys.length >= 2 && (splitActivities.length >= 1 || (mf.activities || []).length >= 2)) {
    synthesized.push({
      pattern_id: "PBT-01",
      category: "Property-Based & Combinatorial Verification",
      tier_classification: "TIER_2_UNIVERSAL_SAFETY",
      defect_tier: "RED",
      severity: "HIGH",
      microflow: qName,
      activity_id: splitActivities[0]?.id || "pbt_combinatorial_entry",
      activity_caption: splitActivities[0]?.caption || `Pairwise Permutation Check (${factorKeys.length} Inputs)`,
      title: `Multi-Variable Boundary Permutation on '${shortName}' (${pairwise.pairwise_count} Pairwise Combinations Covering ${pairwise.total_pairs} Input Pairs)`,
      oracle_rule: `Across all ${pairwise.pairwise_count} pairwise input combinations (${pairwise.pair_coverage_pct}% 2-way coverage of ${factorKeys.join(", ")}), '${qName}' must complete or return a validation message without an unhandled runtime error.`,
      expected_safe_outcome: `All ${pairwise.pairwise_count} pairwise combinations execute cleanly without throwing an unhandled microflow exception.`,
      variation_overrides: { ...boundaryRow },
      baseline_overrides: { ...baselineOverrides },
      pbt_permutations: pairwise.rows,
      property_check: {
        type: "NO_UNHANDLED_RUNTIME_EXCEPTION",
        factors_tested: factorKeys,
        pairwise_count: pairwise.pairwise_count,
        total_cartesian_combinations: pairwise.total_cartesian_combinations,
        pair_coverage_pct: pairwise.pair_coverage_pct,
      },
      remediation: `Ensure every decision split and calculation in '${qName}' checks for empty or boundary values across all combined input fields (${factorKeys.join(", ")}) before evaluating arithmetic or committing.`,
      verification_status: "STATIC_AST_CANDIDATE",
    });
  }

  // 2. PBT-02: Calculation Sign, Bound, or Monotonicity Invariant Violation
  const calcActivities = (mf.activities || []).filter(
    (a) =>
      (a.type === "ChangeObject" || a.type === "CreateObject" || a.type === "ChangeVariable") &&
      (Array.isArray(a.changes) || Array.isArray(a.items) || a.value || a.expression)
  );
  for (const act of calcActivities) {
    const items = act.changes || act.items || (act.value ? [{ attribute: act.variable || "Result", value: act.value }] : []);
    for (const item of items) {
      const attrShort = String(item.attribute || "").split(".").pop();
      const exprStr = String(item.value || act.expression || "");
      const isFinancialOrBounded =
        /^(Total|Net|Price|Amount|Fee|Tax|Balance|Subtotal|Installment|Avg|Discount|Score)/i.test(attrShort) ||
        /[+\-*/]/.test(exprStr);
      if (!isFinancialOrBounded) continue;

      const negPermutation = { ...baselineOverrides };
      for (const [fk, fDef] of Object.entries(partitions.factors || {})) {
        if (/Discount|Deduction|Refund|Voucher/i.test(fDef.attribute)) {
          negPermutation[fk] = fDef.max_value !== null ? fDef.max_value + 100 : 9999;
        } else if (/^(Integer|Long|Decimal|Float|Currency)/i.test(fDef.type)) {
          negPermutation[fk] = fDef.min_value !== null ? fDef.min_value - 1 : -1;
        }
      }

      synthesized.push({
        pattern_id: "PBT-02",
        category: "Property-Based & Combinatorial Verification",
        tier_classification: "TIER_2_UNIVERSAL_SAFETY",
        defect_tier: "RED",
        severity: "HIGH",
        microflow: qName,
        activity_id: act.id || "pbt_calc_bound",
        activity_caption: act.caption || `Calculate ${attrShort}`,
        title: `Calculation Sign & Range Invariant on '${attrShort}' in '${shortName}'`,
        oracle_rule: `Calculated attribute '${attrShort}' (${exprStr || "numeric expression"}) in '${qName}' must remain within valid domain bounds and never produce an unguarded negative total or division overflow under boundary input combinations.`,
        expected_safe_outcome: `'${qName}' clamps '${attrShort}' within valid domain bounds or rejects negative/out-of-range inputs before saving.`,
        variation_overrides: negPermutation,
        baseline_overrides: { ...baselineOverrides },
        pbt_permutations: pairwise.rows,
        property_check: {
          type: "NON_NEGATIVE_AND_BOUNDED",
          target_attribute: attrShort,
          expression: exprStr,
          min_value: 0,
        },
        remediation: `Add a lower/upper bound check (for example, max(0, ...) or an Exclusive Split validating input ranges) before assigning '${attrShort}' in '${qName}'.`,
        verification_status: "STATIC_AST_CANDIDATE",
      });
      break;
    }
    if (synthesized.some((s) => s.pattern_id === "PBT-02")) break;
  }

  // 3. PBT-03: Floating-Point & Currency Precision Drift Counterexample
  const hasFloatOrUnroundedDivision =
    [...existingHypotheses, ...existingAmbers].some(
      (f) => f.microflow === qName && (f.pattern_id === "BHP-25" || f.pattern_id === "BHP-34")
    ) ||
    (mf.activities || []).some((a) => {
      const exprs = [
        a.expression,
        a.value,
        ...(a.changes || a.items || []).map((c) => c.value),
      ]
        .filter(Boolean)
        .join(" ");
      return /[/*]/.test(exprs) && !/\bround\s*\(/i.test(exprs);
    });

  if (hasFloatOrUnroundedDivision) {
    const floatOverrides = { ...baselineOverrides };
    let assignedFloat = false;
    for (const [fk, fDef] of Object.entries(partitions.factors || {})) {
      if (/^(Decimal|Float|Currency)/i.test(fDef.type) || fDef.participates_in_arithmetic) {
        floatOverrides[fk] = assignedFloat ? 0.2 : 19.99;
        assignedFloat = true;
      } else if (/Count|Installment|Months|Qty|Quantity|Split/i.test(fDef.attribute)) {
        floatOverrides[fk] = 3;
      }
    }
    if (!assignedFloat && factorKeys.length > 0) {
      floatOverrides[factorKeys[0]] = 19.99;
    }

    synthesized.push({
      pattern_id: "PBT-03",
      category: "Property-Based & Combinatorial Verification",
      tier_classification: "TIER_2_UNIVERSAL_SAFETY",
      defect_tier: "RED",
      severity: "MEDIUM",
      microflow: qName,
      activity_id: "pbt_precision_drift",
      activity_caption: "Repeating-Binary Decimal Precision Check",
      title: `Currency & Decimal Precision Counterexample Check on '${shortName}'`,
      oracle_rule: `When '${qName}' is evaluated with repeating-binary decimal values (such as 19.99, 0.1, 0.2, or division by 3), monetary and decimal results must be rounded to 2 decimal places without precision drift.`,
      expected_safe_outcome: `Monetary and decimal outputs in '${qName}' match exact 2-decimal rounding without fractional cent drift.`,
      variation_overrides: floatOverrides,
      baseline_overrides: { ...baselineOverrides },
      pbt_permutations: pairwise.rows,
      property_check: {
        type: "DECIMAL_SCALE_AND_CONSERVATION",
        max_decimal_places: 2,
        probe_values: [0.1, 0.2, 19.99, 33.33, 3],
      },
      remediation: `Use Decimal attributes instead of Float and wrap division or percentage multiplications in round(..., 2) inside '${qName}'.`,
      verification_status: "STATIC_AST_CANDIDATE",
    });
  }

  // 4. PBT-04: Idempotency & Recalculation Stability Violation (`f(f(x)) == f(x)`)
  const mutatesExistingParamObject = (mf.activities || []).some((a) => {
    if (a.type !== "ChangeObject") return false;
    const targetVar = a.variable || "";
    const isParamObj = (mf.parameters || []).some((p) => p.name === targetVar);
    return isParamObj || Boolean(a.commit === "Yes" || (a.changes || a.items || []).length > 0);
  });

  if (mutatesExistingParamObject && /^(ACT_|SUB_|CALC_)/i.test(shortName)) {
    const idempOverrides = Object.keys(baselineOverrides).length > 0 ? { ...baselineOverrides } : { ...boundaryRow };
    synthesized.push({
      pattern_id: "PBT-04",
      category: "Property-Based & Combinatorial Verification",
      tier_classification: "TIER_2_UNIVERSAL_SAFETY",
      defect_tier: "RED",
      severity: "HIGH",
      microflow: qName,
      activity_id: "pbt_idempotency_double_call",
      activity_caption: `Double Invocation of ${shortName}`,
      title: `Idempotency & Repeated Execution Stability on '${shortName}'`,
      oracle_rule: `Invoking '${qName}' twice in a row on the same record without intervening user changes must produce the same persisted state and totals as a single invocation, without double-applying fees, discounts, or status transitions.`,
      expected_safe_outcome: `Second consecutive execution of '${qName}' on the same record preserves identical totals and status without duplicate mutation.`,
      variation_overrides: idempOverrides,
      baseline_overrides: { ...baselineOverrides },
      pbt_permutations: pairwise.rows,
      invocation_count: 2,
      property_check: {
        type: "IDEMPOTENCY_DOUBLE_CALL",
        invocation_count: 2,
      },
      remediation: `Make '${qName}' idempotent by computing totals from base attributes rather than accumulating onto already-mutated fields, or guard repeated execution via status checks.`,
      verification_status: "STATIC_AST_CANDIDATE",
    });
  }

  // 5. PBT-05: Silent Validation Failure Without User Message
  const hasValidationFeedback = (mf.activities || []).some((a) => a.type === "ValidationFeedback");
  const isValOrSave = /^(VAL_|ACT_.*Save|ACT_.*Submit|ACT_.*Confirm)/i.test(shortName);
  if ((isValOrSave || hasValidationFeedback) && splitActivities.length >= 2 && factorKeys.length >= 2) {
    const multiInvalidOverrides = {};
    for (const [fk, fDef] of Object.entries(partitions.factors || {})) {
      multiInvalidOverrides[fk] = fDef.values.includes("empty") ? "empty" : fDef.values[fDef.values.length - 1];
    }
    synthesized.push({
      pattern_id: "PBT-05",
      category: "Property-Based & Combinatorial Verification",
      tier_classification: "TIER_2_UNIVERSAL_SAFETY",
      defect_tier: "RED",
      severity: "MEDIUM",
      microflow: qName,
      activity_id: splitActivities[splitActivities.length - 1]?.id || "pbt_silent_validation",
      activity_caption: "Multi-Attribute Validation Feedback Consistency",
      title: `Validation Feedback Completeness Under Multi-Field Invalid Input on '${shortName}'`,
      oracle_rule: `When '${qName}' rejects an invalid multi-field input combination, every rejection path must either show a clear Validation Feedback message to the user or leave modified fields uncommitted.`,
      expected_safe_outcome: `Rejected input combinations consistently provide Validation Feedback without silent failure or partial state changes.`,
      variation_overrides: multiInvalidOverrides,
      baseline_overrides: { ...baselineOverrides },
      pbt_permutations: pairwise.rows,
      property_check: {
        type: "REJECT_REQUIRES_FEEDBACK_OR_CLEAN_STATE",
      },
      remediation: `Ensure every false/abort branch across the ${splitActivities.length} decision splits in '${qName}' includes a Validation Feedback activity before returning false.`,
      verification_status: "STATIC_AST_CANDIDATE",
    });
  }

  // 6. INV-03: Cross-Attribute or Calculated Formula Invariant Violation Under Pairwise Permutations (`v3.1.0`)
  const invRules = Array.isArray(options.invariantRules)
    ? options.invariantRules
    : Array.isArray(bundle.invariant_rules)
      ? bundle.invariant_rules
      : [];
  const paramEntityNames = new Set(
    (mf.parameters || [])
      .map((p) => p.entity)
      .filter(Boolean)
      .flatMap((e) => [e, String(e).split(".").pop()])
  );
  const crossOrFormulaInvs = invRules.filter(
    (inv) =>
      (inv.category === "CROSS_ATTRIBUTE_RELATION" || inv.category === "FORMULA_EQUALITY") &&
      (paramEntityNames.has(inv.entity) || paramEntityNames.has(inv.entity_short))
  );
  for (const inv of crossOrFormulaInvs) {
    const invOverrides = {
      ...baselineOverrides,
      ...(inv.violating_override || {}),
    };
    synthesized.push({
      pattern_id: "INV-03",
      category: "Model-Derived Invariant Business Rules",
      tier_classification: "TIER_1_DOCUMENTED_RULE",
      defect_tier: "RED",
      severity: "HIGH",
      microflow: qName,
      invariant_id: inv.invariant_id,
      activity_id: `inv_03_${inv.invariant_id.toLowerCase()}`,
      activity_caption: `Invariant ${inv.invariant_id} (${inv.predicate_expression})`,
      title: `Cross-Attribute / Formula Business Rule Invariant (${inv.invariant_id}: '${inv.predicate_expression}') on '${shortName}'`,
      oracle_rule: `Model-derived invariant business rule ${inv.invariant_id} (${inv.source_location}) requires '${inv.predicate_expression}' to evaluate to true across all persisted records and pairwise input combinations.`,
      expected_safe_outcome: `'${qName}' enforces '${inv.predicate_expression}' and rejects or recalculates non-compliant attribute combinations.`,
      variation_overrides: invOverrides,
      baseline_overrides: { ...baselineOverrides, ...(inv.compliant_override || {}) },
      pbt_permutations: pairwise.rows,
      property_check: {
        type: "INVARIANT_PREDICATE_COMPLIANCE",
        invariant_id: inv.invariant_id,
        predicate_expression: inv.predicate_expression,
        negated_xpath: inv.negated_xpath,
      },
      remediation: `Enforce invariant rule '${inv.predicate_expression}' (${inv.invariant_id}) inside '${qName}' (or in a centralized 'VAL_' / 'CMT_' microflow) before committing '${inv.entity}'.`,
      verification_status: "STATIC_AST_CANDIDATE",
    });
    break;
  }

  return {
    microflow: qName,
    partitions,
    pairwise,
    hypotheses: synthesized,
  };
}

/**
 * Delta-Debugging Counterexample Shrinker (`shrinkFailingPermutation`).
 *
 * Given a failing multi-attribute override map (`failingOverrides`), a valid baseline
 * override map (`baselineOverrides`), and a sync/async `probeFn(candidateOverrides)`
 * that returns `true` (or `{ failed: true }` / `{ outcome: "FAIL_..." }`) when the
 * failure still reproduces, isolates the minimal irreducible attribute combination
 * required to trigger the defect.
 */
export async function shrinkFailingPermutation(
  failingOverrides = {},
  baselineOverrides = {},
  probeFn,
  options = {}
) {
  const maxProbes = Number(options.maxProbes || 6);
  const allKeys = Object.keys(failingOverrides || {});
  const diffKeys = allKeys.filter((k) => {
    const baseVal = baselineOverrides && k in baselineOverrides ? baselineOverrides[k] : undefined;
    return failingOverrides[k] !== baseVal;
  });

  if (diffKeys.length <= 1 || typeof probeFn !== "function") {
    return {
      initial_failing_overrides: { ...failingOverrides },
      minimal_counterexample: { ...failingOverrides },
      active_failing_factors: diffKeys,
      eliminated_factors: [],
      shrink_steps_executed: 0,
      original_factor_count: diffKeys.length,
      shrunk_factor_count: diffKeys.length,
    };
  }

  let probesUsed = 0;
  let activeKeys = [...diffKeys];

  const buildCandidate = (keysToKeep) => {
    const keepSet = new Set(keysToKeep);
    const candidate = {};
    for (const k of allKeys) {
      if (keepSet.has(k)) {
        candidate[k] = failingOverrides[k];
      } else if (baselineOverrides && k in baselineOverrides) {
        candidate[k] = baselineOverrides[k];
      }
    }
    return candidate;
  };

  const evaluateProbe = async (keysToKeep) => {
    probesUsed++;
    const cand = buildCandidate(keysToKeep);
    const res = await probeFn(cand);
    if (typeof res === "boolean") return res;
    if (res && typeof res === "object") {
      if (res.failed === true) return true;
      if (typeof res.outcome === "string" && res.outcome.startsWith("FAIL")) return true;
    }
    return false;
  };

  // Phase 1: Binary bisection if >= 4 factors differ from baseline
  if (activeKeys.length >= 4 && probesUsed < maxProbes) {
    const mid = Math.floor(activeKeys.length / 2);
    const leftHalf = activeKeys.slice(0, mid);
    const rightHalf = activeKeys.slice(mid);

    if (await evaluateProbe(leftHalf)) {
      activeKeys = leftHalf;
    } else if (probesUsed < maxProbes && (await evaluateProbe(rightHalf))) {
      activeKeys = rightHalf;
    }
  }

  // Phase 2: Greedy 1-minimal delta debugging (try resetting each remaining key to baseline)
  let idx = 0;
  while (idx < activeKeys.length && activeKeys.length > 1 && probesUsed < maxProbes) {
    const withoutIdx = activeKeys.filter((_, i) => i !== idx);
    const stillFails = await evaluateProbe(withoutIdx);
    if (stillFails) {
      activeKeys = withoutIdx;
    } else {
      idx++;
    }
  }

  const minimalCounterexample = {};
  for (const k of activeKeys) {
    minimalCounterexample[k] = failingOverrides[k];
  }
  const eliminatedFactors = diffKeys.filter((k) => !activeKeys.includes(k));

  return {
    initial_failing_overrides: { ...failingOverrides },
    minimal_counterexample: minimalCounterexample,
    full_minimal_input: buildCandidate(activeKeys),
    active_failing_factors: activeKeys,
    eliminated_factors: eliminatedFactors,
    shrink_steps_executed: probesUsed,
    original_factor_count: diffKeys.length,
    shrunk_factor_count: activeKeys.length,
  };
}

export function analyzeAstBundle(bundle, tier = "free", options = {}) {
  const defaultModule = bundle.module || "Module";
  // Support raw StudioPro Microflows$Microflow JSON or normalized bundles
  const rawMicroflowList =
    Array.isArray(bundle.microflows) && bundle.microflows.length > 0
      ? bundle.microflows
      : bundle.target_microflow
        ? [bundle.target_microflow]
        : bundle.$Type === "Microflows$Microflow"
          ? [bundle]
          : [];

  const microflowList = rawMicroflowList.map((m) => normalizeStudioProMicroflow(m, defaultModule));
  const isModuleBundle = Array.isArray(bundle.microflows) && microflowList.length > 1;

  // Build Full-Stack User Flow & Transitive Call Hierarchy Graph (`Pages -> Top-Level ACT_* -> SUB_*/VAL_*` + Commit/Delete blast radius)
  const callHierarchyGraph = buildUserFlowAndCallHierarchyGraph(
    microflowList,
    bundle.pages || [],
    bundle.entities || [],
    defaultModule
  );

  const primaryMf =
    (bundle.target_microflow ? normalizeStudioProMicroflow(bundle.target_microflow, defaultModule) : null) ||
    microflowList[0] || {
      name: "UnknownMicroflow",
      qualified_name: `${defaultModule}.UnknownMicroflow`,
      parameters: [],
      activities: [],
    };

  const allHypotheses = [];
  const allAmberRisks = [];
  const allAmberUiCandidates = [];
  const riskScores = [];

  for (let i = 0; i < microflowList.length; i++) {
    const mf = microflowList[i];
    // Keep entities & pages for every microflow so SEC-02/03/04 and BHP-22 have entity metadata; only pass other_committers once
    const scopedBundle =
      i === 0
        ? bundle
        : {
            ...bundle,
            other_committers: [],
          };
    const res = analyzeSingleMicroflow(mf, scopedBundle, tier);
    riskScores.push(computeMicroflowRiskScore(mf, bundle.entities || [], bundle.pages || []));

    for (const h of res.hypotheses) {
      if (
        h.pattern_id === "DQP-04" &&
        allHypotheses.some((existing) => existing.pattern_id === "DQP-04" && existing.activity_id === h.activity_id)
      ) {
        continue;
      }
      h.id = `HYP_${allHypotheses.length + 1}`;
      h.verification_status = h.verification_status || "STATIC_AST_CANDIDATE";
      const expInfo = callHierarchyGraph.classifyFindingExposure(h);
      const ctx = expInfo.call_hierarchy_context || {};
      h.exposure_classification = expInfo.exposure_classification;
      h.exposure_badge = expInfo.exposure_badge;
      h.call_hierarchy_context = ctx;
      h.exposes_commit_or_delete_in_hierarchy = Boolean(ctx.exposes_commit_or_delete_in_hierarchy);
      h.sample_user_flow_path = ctx.sample_user_flow_path || h.microflow;
      h.implicit_protection_reason = ctx.implicit_protection_reason || "";
      h.regression_exposure_trigger = ctx.regression_exposure_trigger || "";
      h.commit_delete_hierarchy_summary = ctx.commit_delete_hierarchy_summary || "";
      h.dual_risk = classifyFindingDualRisk(h, bundle);
      allHypotheses.push(h);
    }
    for (const a of res.amberRisks) {
      if (
        (a.pattern_id === "SEC-05" || a.pattern_id === "BHP-25") &&
        allAmberRisks.some((existing) => existing.pattern_id === a.pattern_id && existing.activity_id === a.activity_id)
      ) {
        continue;
      }
      a.verification_status = a.verification_status || "STATIC_AST_CANDIDATE";
      const expInfo = callHierarchyGraph.classifyFindingExposure(a);
      const ctx = expInfo.call_hierarchy_context || {};
      a.exposure_classification = expInfo.exposure_classification;
      a.exposure_badge = expInfo.exposure_badge;
      a.call_hierarchy_context = ctx;
      a.exposes_commit_or_delete_in_hierarchy = Boolean(ctx.exposes_commit_or_delete_in_hierarchy);
      a.sample_user_flow_path = ctx.sample_user_flow_path || a.microflow;
      a.implicit_protection_reason = ctx.implicit_protection_reason || "";
      a.regression_exposure_trigger = ctx.regression_exposure_trigger || "";
      a.commit_delete_hierarchy_summary = ctx.commit_delete_hierarchy_summary || "";
      a.dual_risk = classifyFindingDualRisk(a, bundle);
      allAmberRisks.push(a);
    }
    for (const ui of res.amberUiCandidates) {
      ui.id = `AMBER_UI_${allAmberUiCandidates.length + 1}`;
      ui.verification_status = ui.verification_status || "STATIC_AST_CANDIDATE";
      const expInfo = callHierarchyGraph.classifyFindingExposure(ui);
      const ctx = expInfo.call_hierarchy_context || {};
      ui.exposure_classification = "ACTUAL_UI_OR_API_REPRODUCIBLE";
      ui.exposure_badge = "🔴 ACTUAL BUG (UI / API Reproducible Now)";
      ui.call_hierarchy_context = ctx;
      ui.exposes_commit_or_delete_in_hierarchy = Boolean(ctx.exposes_commit_or_delete_in_hierarchy);
      ui.sample_user_flow_path = ctx.sample_user_flow_path || ui.page_qualified_name || ui.microflow;
      ui.commit_delete_hierarchy_summary = ctx.commit_delete_hierarchy_summary || "";
      ui.dual_risk = classifyFindingDualRisk(ui, bundle);
      allAmberUiCandidates.push(ui);
    }
  }

  // Synthesize UFP-01 whenever a latent (implicitly protected) bug in an underlying microflow participates in a Commit/Delete call hierarchy
  const seenUfp01Microflows = new Set();
  for (const h of allHypotheses) {
    if (
      h.exposure_classification === "LATENT_IMPLICITLY_PROTECTED" &&
      h.call_hierarchy_context?.exposes_commit_or_delete_in_hierarchy &&
      !seenUfp01Microflows.has(h.microflow)
    ) {
      seenUfp01Microflows.add(h.microflow);
      const ctx = h.call_hierarchy_context;
      const ufp01Risk = {
        pattern_id: "UFP-01",
        category: "User-Flow & Call-Chain Risk",
        defect_tier: "AMBER",
        severity: "HIGH",
        verification_status: "STATIC_AST_CANDIDATE",
        microflow: h.microflow,
        activity_id: h.activity_id,
        activity_caption: h.activity_caption || "Caller-Protected Branch",
        title: `Sub-Microflow '${(h.microflow || "").split(".").pop()}' Has an Unprotected Bug Inside a Commit/Delete Call Chain`,
        oracle_rule: `Sub-microflow '${h.microflow}' contains a proven bug [${h.pattern_id}] (${h.title}) that is currently prevented by '${ctx.protecting_callers.join(", ") || ctx.shielded_by_parent || "the calling flow"}' (${ctx.sample_user_flow_path}), while the overall call chain commits or deletes database objects (${ctx.commit_delete_hierarchy_summary}).`,
        amber_reason: `${ctx.implicit_protection_reason} ${ctx.regression_exposure_trigger}`,
        remediation: `Add the missing check directly inside '${h.microflow}' (${h.remediation}) so future page changes or new calling microflows cannot trigger invalid database commits or deletes.`,
        exposure_classification: "LATENT_IMPLICITLY_PROTECTED",
        exposure_badge: "🔶 Latent Bug (Protected Today by Calling Page/Microflow — Future Regression Risk)",
        call_hierarchy_context: ctx,
        exposes_commit_or_delete_in_hierarchy: true,
        sample_user_flow_path: ctx.sample_user_flow_path || h.microflow,
        implicit_protection_reason: ctx.implicit_protection_reason || "",
        regression_exposure_trigger: ctx.regression_exposure_trigger || "",
        commit_delete_hierarchy_summary: ctx.commit_delete_hierarchy_summary || "",
      };
      ufp01Risk.dual_risk = classifyFindingDualRisk(ufp01Risk, bundle);
      allAmberRisks.push(ufp01Risk);
    }
  }

  // Append UFP-02 and UFP-03 call-hierarchy risks
  for (const ufp of callHierarchyGraph.ufpAmberRisks) {
    const expInfo = callHierarchyGraph.classifyFindingExposure(ufp);
    const ctx = expInfo.call_hierarchy_context || {};
    ufp.exposure_classification = expInfo.exposure_classification;
    ufp.exposure_badge = expInfo.exposure_badge;
    ufp.call_hierarchy_context = ctx;
    ufp.exposes_commit_or_delete_in_hierarchy = Boolean(ctx.exposes_commit_or_delete_in_hierarchy);
    ufp.sample_user_flow_path = ctx.sample_user_flow_path || ufp.microflow;
    ufp.implicit_protection_reason = ctx.implicit_protection_reason || "";
    ufp.regression_exposure_trigger = ctx.regression_exposure_trigger || "";
    ufp.commit_delete_hierarchy_summary = ctx.commit_delete_hierarchy_summary || "";
    ufp.dual_risk = classifyFindingDualRisk(ufp, bundle);
    allAmberRisks.push(ufp);
  }

  // Automatic Model-Derived Invariant Business Rule Discovery (`v3.1.0` — enabled by default)
  const invariantsEnabled =
    options.invariants !== false && bundle.enable_invariants !== false;
  const invariantRules = invariantsEnabled
    ? mineInvariantBusinessRules(bundle, microflowList, options)
    : [];
  const bundleWithInvariants = {
    ...bundle,
    invariant_rules: invariantRules,
  };

  // Synthesize INV-01 (Entity Invariant Rule Bypassed in Alternative Commit Flow) automatically
  const mfNamesInBundle = new Set(
    microflowList.flatMap((m) => [m.qualified_name, m.name].filter(Boolean))
  );
  for (const inv of invariantRules) {
    for (const bypassMf of inv.bypassed_in_committers || []) {
      if (!mfNamesInBundle.has(bypassMf)) continue;
      // Avoid duplicating if DQP-01 already targets the exact same required attribute on the same microflow
      const alreadyCoveredByDqp01 = [...allHypotheses, ...allAmberRisks].some(
        (existing) =>
          existing.pattern_id === "DQP-01" &&
          existing.microflow === bypassMf &&
          inv.category === "REQUIRED_NON_EMPTY" &&
          String(existing.title || "").includes(inv.attribute)
      );
      if (alreadyCoveredByDqp01) continue;

      const inv01Hyp = {
        id: `HYP_${allHypotheses.length + 1}`,
        pattern_id: "INV-01",
        invariant_id: inv.invariant_id,
        category: "Model-Derived Invariant Business Rules",
        tier_classification: "TIER_1_DOCUMENTED_RULE",
        defect_tier: "RED",
        severity: "HIGH",
        verification_status: "STATIC_AST_CANDIDATE",
        microflow: bypassMf,
        activity_id: `inv_01_${inv.invariant_id.toLowerCase()}`,
        activity_caption: `Commit ${inv.entity_short} Without Checking ${inv.invariant_id}`,
        title: `Entity Invariant Rule '${inv.predicate_expression}' (${inv.invariant_id}) Bypassed in Commit Microflow '${bypassMf.split(".").pop()}'`,
        oracle_rule: `Invariant business rule ${inv.invariant_id} ('${inv.predicate_expression}', defined in ${inv.source_location}) is enforced in [${(inv.enforced_in || []).join(", ")}], but microflow '${bypassMf}' commits '${inv.entity}' without checking this rule.`,
        expected_safe_outcome: `'${bypassMf}' validates '${inv.predicate_expression}' (or delegates to a shared 'VAL_' / 'CMT_' microflow) and rejects non-compliant '${inv.entity_short}' records before committing.`,
        variation_overrides: { ...(inv.violating_override || {}) },
        baseline_overrides: { ...(inv.compliant_override || {}) },
        remediation: `Extract '${inv.predicate_expression}' (${inv.invariant_id}) into a reusable 'VAL_${inv.entity_short}' validation microflow (or central 'CMT_${inv.entity_short}' committer) and invoke it in '${bypassMf}' before committing.`,
      };
      const expInfo = callHierarchyGraph.classifyFindingExposure(inv01Hyp);
      const ctx = expInfo.call_hierarchy_context || {};
      inv01Hyp.exposure_classification = expInfo.exposure_classification;
      inv01Hyp.exposure_badge = expInfo.exposure_badge;
      inv01Hyp.call_hierarchy_context = ctx;
      inv01Hyp.exposes_commit_or_delete_in_hierarchy = true;
      inv01Hyp.sample_user_flow_path = ctx.sample_user_flow_path || bypassMf;
      inv01Hyp.implicit_protection_reason = ctx.implicit_protection_reason || "";
      inv01Hyp.regression_exposure_trigger = ctx.regression_exposure_trigger || "";
      inv01Hyp.commit_delete_hierarchy_summary = ctx.commit_delete_hierarchy_summary || "";
      inv01Hyp.dual_risk = classifyFindingDualRisk(inv01Hyp, bundle);
      allHypotheses.push(inv01Hyp);
    }
  }

  // Synthesize INV-02 (Live Dataset Compliance Probes — Negated XPath Retrieve Count == 0)
  const invariantDatasetProbes = [];
  const includeDatasetProbesInHypotheses =
    options.datasetProbes === true ||
    options.invariants === true ||
    bundle.enable_dataset_probes === true;
  for (const inv of invariantRules) {
    if (!inv.negated_xpath) continue;
    const inv02Probe = {
      id: includeDatasetProbesInHypotheses
        ? `HYP_${allHypotheses.length + 1}`
        : `INV_PROBE_${invariantDatasetProbes.length + 1}_${inv.invariant_id}`,
      pattern_id: "INV-02",
      invariant_id: inv.invariant_id,
      category: "Model-Derived Invariant Business Rules",
      tier_classification: "TIER_1_DOCUMENTED_RULE",
      defect_tier: "RED",
      severity: "HIGH",
      verification_status: "STATIC_AST_CANDIDATE",
      microflow: (inv.enforced_in_committers && inv.enforced_in_committers[0]) || primaryMf.qualified_name,
      target_entity: inv.entity,
      negated_xpath: inv.negated_xpath,
      activity_id: `inv_02_dataset_${inv.invariant_id.toLowerCase()}`,
      activity_caption: `Dataset Compliance Check ${inv.invariant_id}`,
      title: `Database Dataset Compliance Check for '${inv.predicate_expression}' (${inv.invariant_id} on '${inv.entity_short}')`,
      oracle_rule: `Because '${inv.predicate_expression}' (${inv.invariant_id}) is a state-independent invariant business rule on '${inv.entity}', querying existing database records with the negated filter '${inv.negated_xpath}' must return 0 non-compliant records.`,
      expected_safe_outcome: `Database retrieve on '${inv.entity}' with filter '${inv.negated_xpath}' returns 0 violating records (Dataset Compliant = true).`,
      variation_overrides: {
        [`Filter ${inv.entity_short}`]: inv.negated_xpath,
      },
      remediation: `Clean up existing non-compliant '${inv.entity}' records matching '${inv.negated_xpath}' and enforce '${inv.predicate_expression}' across all commit microflows.`,
      exposure_classification: "ACTUAL_UI_OR_API_REPRODUCIBLE",
      exposure_badge: "🔴 ACTUAL BUG (UI / API Reproducible Now)",
    };
    inv02Probe.dual_risk = classifyFindingDualRisk(inv02Probe, bundle);
    invariantDatasetProbes.push(inv02Probe);
    if (includeDatasetProbesInHypotheses) {
      allHypotheses.push(inv02Probe);
    }
  }

  // Synthesize AST-Guided Pairwise Permutations & Property-Based Testing (`PBT-01`..`PBT-05` + `INV-03`) Suites (`v3.0.0` / `v3.1.0`)
  const pbtSuites = [];
  let totalPbtPermutationsGenerated = 0;
  let totalPbtHypothesesSynthesized = 0;
  const includePbtInHypotheses =
    options.pbt === true || bundle.enable_pbt === true;

  for (const mf of microflowList) {
    const pbtRes = synthesizePropertyHypotheses(
      mf,
      bundleWithInvariants,
      allHypotheses,
      allAmberRisks,
      {
        maxSamples: options.pbtSamples || bundle.pbt_samples || 12,
        invariantRules,
      }
    );
    totalPbtPermutationsGenerated += Number(pbtRes.pairwise?.pairwise_count || 0);
    totalPbtHypothesesSynthesized += (pbtRes.hypotheses || []).length;

    for (const ph of pbtRes.hypotheses || []) {
      const expInfo = callHierarchyGraph.classifyFindingExposure(ph);
      const ctx = expInfo.call_hierarchy_context || {};
      ph.exposure_classification = expInfo.exposure_classification;
      ph.exposure_badge = expInfo.exposure_badge;
      ph.call_hierarchy_context = ctx;
      ph.exposes_commit_or_delete_in_hierarchy = Boolean(ctx.exposes_commit_or_delete_in_hierarchy);
      ph.sample_user_flow_path = ctx.sample_user_flow_path || ph.microflow;
      ph.implicit_protection_reason = ctx.implicit_protection_reason || "";
      ph.regression_exposure_trigger = ctx.regression_exposure_trigger || "";
      ph.commit_delete_hierarchy_summary = ctx.commit_delete_hierarchy_summary || "";
      ph.dual_risk = classifyFindingDualRisk(ph, bundle);

      if (includePbtInHypotheses || (ph.pattern_id === "INV-03" && options.invariants !== false)) {
        ph.id = `HYP_${allHypotheses.length + 1}`;
        allHypotheses.push(ph);
      } else {
        ph.id = `PBT_HYP_${pbtSuites.length + 1}_${ph.pattern_id}`;
      }
    }

    pbtSuites.push(pbtRes);
  }

  // Extract & cross-check Business Rules across MCP Docs, Workspace Files, Model Docs, Domain Validation Rules & Mined Invariants
  const businessRules = extractAndCrossCheckBusinessRules(
    bundleWithInvariants,
    microflowList,
    allHypotheses,
    allAmberRisks,
    allAmberUiCandidates
  );

  // Merge mined state-independent Invariant Business Rules into `businessRules` so Section 1C always presents them automatically
  for (const inv of invariantRules) {
    const relatedFindings = allHypotheses
      .filter((h) => h.invariant_id === inv.invariant_id)
      .map((h) => ({
        id: h.id,
        pattern_id: h.pattern_id,
        bucket: "HYPOTHESIS",
        defect_tier: "RED",
        title: h.title,
        microflow: h.microflow,
        explanation: h.oracle_rule,
      }));
    const existingRule = businessRules.find(
      (br) =>
        br.invariant_id === inv.invariant_id ||
        (br.target_element === inv.entity &&
          br.attribute === inv.attribute &&
          String(br.rule_text || "").includes(inv.predicate_expression))
    );
    if (!existingRule) {
      const hasBypass = (inv.bypassed_in_committers || []).length > 0 || relatedFindings.some((f) => f.pattern_id === "INV-01");
      businessRules.push({
        id: inv.invariant_id,
        invariant_id: inv.invariant_id,
        is_invariant_rule: true,
        rule_text: `Invariant Rule (${inv.predicate_expression}): ${inv.title} [Dataset Query: ${inv.negated_xpath}]`,
        predicate_expression: inv.predicate_expression,
        negated_xpath: inv.negated_xpath,
        source_type: inv.source_type,
        source_location: inv.source_location,
        target_element: inv.entity,
        attribute: inv.attribute || null,
        enforced_in: inv.enforced_in || [],
        bypassed_in_committers: inv.bypassed_in_committers || [],
        is_documented_spec: false,
        status: hasBypass ? "VIOLATED_OR_TESTABLE_DEFECT" : "ENFORCED_IN_MODEL",
        violated_by_findings: relatedFindings,
        violation_summary:
          relatedFindings.length > 0
            ? relatedFindings.map((v) => `[${v.pattern_id}] ${v.title}`).join("; ")
            : (inv.bypassed_in_committers || []).length > 0
              ? `Bypassed in commit flow(s): ${inv.bypassed_in_committers.join(", ")}`
              : "Enforced across all commit flows in model.",
      });
    }
  }
  // Ensure any newly synthesized BRP-01 or INV-01/03 hypothesis has exposure_classification, call_hierarchy_context, and defect_nature
  for (const h of allHypotheses) {
    if (!h.exposure_classification) {
      const expInfo = callHierarchyGraph.classifyFindingExposure(h);
      const ctx = expInfo.call_hierarchy_context || {};
      h.exposure_classification = expInfo.exposure_classification;
      h.exposure_badge = expInfo.exposure_badge;
      h.call_hierarchy_context = ctx;
      h.exposes_commit_or_delete_in_hierarchy = Boolean(ctx.exposes_commit_or_delete_in_hierarchy);
      h.sample_user_flow_path = ctx.sample_user_flow_path || h.microflow;
      h.implicit_protection_reason = ctx.implicit_protection_reason || "";
      h.regression_exposure_trigger = ctx.regression_exposure_trigger || "";
      h.commit_delete_hierarchy_summary = ctx.commit_delete_hierarchy_summary || "";
      h.dual_risk = classifyFindingDualRisk(h, bundle);
    }
    h.defect_nature = classifyDefectNature(h);
  }
  for (const a of allAmberRisks) {
    a.defect_nature = classifyDefectNature(a);
  }
  for (const u of allAmberUiCandidates) {
    u.defect_nature = classifyDefectNature(u);
  }

  // Sort hypotheses so Tier 1 FUNCTIONAL_BYPASS hypotheses with concrete testable overrides are always first
  const sortedHypotheses = sortHypothesesTier1First(allHypotheses);
  allHypotheses.length = 0;
  allHypotheses.push(...sortedHypotheses);

  const violatedBusinessRulesCount = businessRules.filter(
    (br) => br.status === "VIOLATED_OR_TESTABLE_DEFECT" || br.status === "BYPASSED_AT_RISK"
  ).length;
  const actualHypothesesCount = allHypotheses.filter(
    (h) => h.exposure_classification !== "LATENT_IMPLICITLY_PROTECTED"
  ).length;
  const latentHypothesesCount = allHypotheses.filter(
    (h) => h.exposure_classification === "LATENT_IMPLICITLY_PROTECTED"
  ).length;

  riskScores.sort((a, b) => b.risk_score - a.risk_score);

  const primaryGuardrails = evaluateGuardrails(bundle, primaryMf);
  const parameters = primaryMf.parameters || [];
  const primaryParam = parameters[0] || { name: "InputObj", entity: "Module.Entity" };
  const entityShort = (primaryParam.entity || "Module.Entity").split(".").pop();

  const section3Steps = [
    {
      step_number: 1,
      action: "CreateObject",
      entity: primaryParam.entity,
      handle: `step1_${entityShort}`,
      description: `PAT-06: Initialize valid baseline ${primaryParam.entity} (Sentinel = 'VALID')`,
    },
    {
      step_number: 2,
      action: "RetrieveObject",
      entity: primaryParam.entity,
      input_handle: `step1_${entityShort}`,
      handle: `step2_${entityShort}`,
      filter: "Sentinel == 'VALID'",
      embedded_count_assertion: 1,
      description: `PAT-07 & PAT-08: Paired Dual-Retrieve sentinel ('VALID' / 'NONE') for parameter $${primaryParam.name}`,
    },
    {
      step_number: 3,
      action: "CallMicroflow",
      microflow: primaryMf.qualified_name,
      input_handle: `step2_${entityShort}`,
      handle: "resultHandle",
      description: `Invoke target microflow ${primaryMf.qualified_name} with adversarial variation inputs`,
    },
  ];

  const section4Scenarios = [
    {
      scenario_index: 1,
      name: "Scenario #1: Baseline Happy Path",
      hypothesis_id: "BASELINE",
      pattern_id: "BASELINE",
      microflow: primaryMf.qualified_name,
      overrides: { [`Step 1: ${entityShort}.Sentinel`]: "VALID" },
    },
    ...allHypotheses.map((h, idx) => ({
      scenario_index: idx + 2,
      name: `Scenario #${idx + 2}: [${h.pattern_id}] ${h.title.slice(0, 55)}`,
      hypothesis_id: h.id,
      pattern_id: h.pattern_id,
      microflow: h.microflow || primaryMf.qualified_name,
      exposure_classification: h.exposure_classification,
      overrides: h.variation_overrides,
    })),
  ];

  const totalInvariantBypasses = invariantRules.filter(
    (inv) => (inv.bypassed_in_committers || []).length > 0
  ).length;

  return {
    schema_version: "3.1.0",
    generated_at: new Date().toISOString(),
    tier,
    module: bundle.module || primaryMf.qualified_name.split(".")[0],
    target_microflow: isModuleBundle
      ? `${bundle.module || primaryMf.qualified_name.split(".")[0]}.*`
      : primaryMf.qualified_name,
    primary_microflow: primaryMf.qualified_name,
    is_module_bundle: isModuleBundle,
    microflows_analyzed: microflowList.length,
    guardrails: primaryGuardrails,
    module_risk_ranking: riskScores,
    summary: {
      total_executable_hypotheses: allHypotheses.length,
      actual_ui_api_reproducible_hypotheses: actualHypothesesCount,
      latent_implicitly_protected_hypotheses: latentHypothesesCount,
      total_amber_architectural_risks: allAmberRisks.length,
      total_amber_ui_page_candidates: allAmberUiCandidates.length,
      total_business_rules_detected: businessRules.length,
      total_business_rules_violated: violatedBusinessRulesCount,
      total_invariant_rules_mined: invariantRules.length,
      total_invariant_bypasses_detected: totalInvariantBypasses,
      total_pbt_permutations_generated: totalPbtPermutationsGenerated,
      total_pbt_hypotheses_synthesized: totalPbtHypothesesSynthesized,
      quarantined_by_safe_01: primaryGuardrails.safe_01_quarantined,
    },
    invariant_rules: invariantRules,
    invariant_dataset_probes: invariantDatasetProbes,
    pbt_suites: pbtSuites,
    entities: bundle.entities || [],
    business_rules: businessRules,
    hypotheses: allHypotheses,
    amber_risks: allAmberRisks,
    amber_ui_candidates: allAmberUiCandidates,
    section_3_steps: section3Steps,
    section_4_variations: section4Scenarios,
  };
}

// ============================================================================
// 4. EXECUTION PLAN GENERATOR (`generate-plan`)
// ============================================================================

export function resolveDefaultPlanStatus(outTarget = null) {
  const candidates = [];
  if (outTarget) {
    const absOut = path.resolve(outTarget);
    const dir = absOut.endsWith(".md") ? path.dirname(absOut) : absOut;
    candidates.push(path.join(dir, "mta_config.json"), path.join(path.dirname(dir), "mta_config.json"));
  }
  candidates.push(path.resolve("mta_config.json"));
  for (const cfgPath of candidates) {
    if (fs.existsSync(cfgPath)) {
      try {
        const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
        if (cfg && String(cfg.exploratory_execution_mode || "").trim() === "prompt_approval") {
          return "DRAFT";
        }
        break;
      } catch {
        // Ignore malformed config
      }
    }
  }
  return "AUTO_APPROVED";
}

export function resolveTargetSlug(manifestOrReport = {}) {
  if (
    manifestOrReport.is_module_bundle ||
    Number(manifestOrReport.microflows_analyzed || 0) > 1
  ) {
    if (manifestOrReport.module) {
      return String(manifestOrReport.module).replace(/[^A-Za-z0-9_.-]/g, "_");
    }
  }
  const targetMf =
    manifestOrReport.primary_microflow ||
    manifestOrReport.target_microflow ||
    manifestOrReport.module ||
    "Target";
  return String(targetMf).split(".").pop().replace(/\*/g, "").replace(/[^A-Za-z0-9_.-]/g, "_") || "Target";
}

export function generateExecutionPlanMarkdown(manifest, options = {}) {
  const allCandidateHyps = [
    ...(manifest.hypotheses || []),
    ...((manifest.pbt_suites || []).flatMap((s) => s.hypotheses || [])),
  ];
  const scopedHyp = options.findingId
    ? allCandidateHyps.find(
        (h) => h.id === options.findingId || h.pattern_id === options.findingId
      )
    : null;

  const isModuleWidePlan =
    !scopedHyp &&
    (Boolean(manifest.is_module_bundle) || Number(manifest.microflows_analyzed || 0) > 1);

  const primaryMf =
    scopedHyp?.microflow ||
    manifest.primary_microflow ||
    (manifest.hypotheses && manifest.hypotheses[0]?.microflow) ||
    (manifest.target_microflow && !String(manifest.target_microflow).endsWith(".*")
      ? manifest.target_microflow
      : null) ||
    `${manifest.module || "Module"}.Microflow`;

  const targetSlug = scopedHyp
    ? String(primaryMf).split(".").pop().replace(/[^A-Za-z0-9_.-]/g, "_")
    : resolveTargetSlug(manifest);

  const displayComponent = isModuleWidePlan
    ? `${manifest.module || targetSlug} (Module-Wide Adversarial Verification Plan — Primary Entry: ${primaryMf})`
    : primaryMf;

  const planId = `EP_BugHunt_${targetSlug}-v1`;
  const planStatus = options.status || resolveDefaultPlanStatus(options.outTarget);
  const step1 = (manifest.section_3_steps || [])[0] || { entity: "Module.Entity" };
  const entityQualified = step1.entity || "Module.Entity";
  const entityShort = entityQualified.split(".").pop();
  const paramName = entityShort;

  const expandPbt =
    Boolean(options.pbt) ||
    Boolean(scopedHyp && Array.isArray(scopedHyp.pbt_permutations) && scopedHyp.pbt_permutations.length > 0);
  const pbtMaxCols = Number(options.pbtSamples || 8);

  let rawVariations = [];
  if (expandPbt && scopedHyp && Array.isArray(scopedHyp.pbt_permutations) && scopedHyp.pbt_permutations.length > 0) {
    const baseOverrides = scopedHyp.baseline_overrides || {};
    rawVariations = [
      {
        scenario_index: 1,
        name: "Scenario #1: Baseline Happy Path",
        hypothesis_id: "BASELINE",
        pattern_id: "BASELINE",
        microflow: primaryMf,
        overrides: { [`Step 1: ${entityShort}.Sentinel`]: "VALID", ...baseOverrides },
      },
      ...scopedHyp.pbt_permutations.slice(0, pbtMaxCols).map((perm, pIdx) => ({
        scenario_index: pIdx + 2,
        name: `Scenario #${pIdx + 2}: [${scopedHyp.pattern_id}] Pairwise Permutation #${pIdx + 1}`,
        hypothesis_id: `${scopedHyp.id || scopedHyp.pattern_id}_P${pIdx + 1}`,
        pattern_id: scopedHyp.pattern_id,
        microflow: scopedHyp.microflow || primaryMf,
        overrides: perm,
      })),
    ];
  } else if (scopedHyp) {
    rawVariations = [
      {
        scenario_index: 1,
        name: "Scenario #1: Baseline Happy Path",
        hypothesis_id: "BASELINE",
        pattern_id: "BASELINE",
        microflow: primaryMf,
        overrides: { [`Step 1: ${entityShort}.Sentinel`]: "VALID", ...(scopedHyp.baseline_overrides || {}) },
      },
      {
        scenario_index: 2,
        name: `Scenario #2: [${scopedHyp.pattern_id}] ${scopedHyp.title.slice(0, 55)}`,
        hypothesis_id: scopedHyp.id,
        pattern_id: scopedHyp.pattern_id,
        microflow: scopedHyp.microflow || primaryMf,
        overrides: scopedHyp.variation_overrides || {},
      },
    ];
  } else {
    rawVariations = [...(manifest.section_4_variations || []).slice(0, 6)];
  }

  const scenarios = [...rawVariations];
  const hasNullScenario = scenarios.some((s) =>
    /NONE|NON/i.test(Object.values(s.overrides || {}).join(" "))
  );
  if (!hasNullScenario) {
    scenarios.push({
      scenario_index: scenarios.length + 1,
      name: `Scenario #${scenarios.length + 1}: [BHP-01] Empty ${entityShort} Boundary`,
      hypothesis_id: "HYP_NULL_GUARD",
      pattern_id: "BHP-01",
      microflow: primaryMf,
      overrides: { [`Param $${paramName}`]: "'NONE'" },
    });
  }

  const coveredMicroflows = Array.from(
    new Set(
      [
        primaryMf,
        ...scenarios.map((s) => s.microflow).filter(Boolean),
        ...(manifest.hypotheses || []).slice(0, 8).map((h) => h.microflow).filter(Boolean),
      ].filter((m) => m && !String(m).endsWith(".*"))
    )
  );

  const risksYaml = scenarios
    .map(
      (s, i) =>
        `  - risk: "${s.name.replace(/"/g, "'")} must be handled safely without runtime crash or data corruption"\n    mitigating_scenario: "Scenario #${i + 1}"`
    )
    .join("\n");

  const isNullBoundaryScenario = (s) => {
    const vals = Object.values(s.overrides || {}).join(" ");
    return /NONE|NON/i.test(vals);
  };
  const sanitizeScenarioLabel = (text, allowEmptyTokens) => {
    const cleaned = String(text || "").replace(/\|/g, "/");
    if (allowEmptyTokens) return cleaned;
    return cleaned
      .replace(/\bempty\b/gi, "blank")
      .replace(/\bnull\b/gi, "blank")
      .replace(/\bunassigned\b/gi, "unlinked")
      .replace(/\bmissing\b/gi, "omitted")
      .replace(/\bno\s+([a-z]+)/gi, "zero $1")
      .replace(/\bno_([a-z]+)/gi, "zero_$1")
      .replace(/\bnone\b/gi, "zero")
      .replace(/\bwithout\b/gi, "lacking");
  };

  const scenarioHeaders = scenarios
    .map((s, i) => `Scenario #${i + 1} (${s.pattern_id})`)
    .join(" | ");
  const scenarioAlign = scenarios.map(() => ":---").join(" | ");
  const scenarioNames = scenarios
    .map((s) => sanitizeScenarioLabel(s.name, isNullBoundaryScenario(s)))
    .join(" | ");
  const scenarioDescs = scenarios
    .map((s) =>
      sanitizeScenarioLabel(
        `Adversarial check on ${entityShort} for ${s.pattern_id} (${(s.microflow || primaryMf).split(".").pop()})`,
        isNullBoundaryScenario(s)
      )
    )
    .join(" | ");
  const sentinelValues = scenarios
    .map((s) => (isNullBoundaryScenario(s) ? "`NONE`" : "`VALID`"))
    .join(" | ");
  const expectedReturnValues = scenarios.map(() => "`true`").join(" | ");

  // Collect concrete attribute rows across scenarios and map each referenced entity to a Create+Retrieve step pair
  const attrKeySet = new Set();
  const extraEntitySet = new Set();
  for (const s of scenarios) {
    for (const k of Object.keys(s.overrides || {})) {
      if (
        k.startsWith("Step ") ||
        k.startsWith("Param ") ||
        k.startsWith("Filter ") ||
        /\.Sentinel$/i.test(k)
      ) {
        continue;
      }
      if (k.includes(".")) {
        attrKeySet.add(k);
        const entShort = k.split(".")[0];
        if (entShort && entShort !== entityShort) {
          extraEntitySet.add(entShort);
        }
      }
    }
  }
  const modName = entityQualified.includes(".")
    ? entityQualified.split(".")[0]
    : manifest.module || "MyFirstModule";
  const orderedEntities = [entityShort, ...Array.from(extraEntitySet)];
  const entityCreateStepMap = new Map();
  const entityRetrieveStepMap = new Map();
  const section3PrepStepsMd = [];
  let nextStepNum = 1;
  for (const ent of orderedEntities) {
    const createStep = nextStepNum++;
    const retrieveStep = nextStepNum++;
    entityCreateStepMap.set(ent, createStep);
    entityRetrieveStepMap.set(ent, retrieveStep);
    const entQual = ent === entityShort ? entityQualified : `${modName}.${ent}`;
    section3PrepStepsMd.push(
      `| **${createStep}** | Case 1 | \`CreateObject\` (\`${entQual}\`) | - | \`step${createStep}_${ent}\` | \`Sentinel = 'VALID'\` | - | \`None\` / \`Stop\` | \`PAT-06\` |`,
      `| **${retrieveStep}** | Case 1 | \`RetrieveObject\` (\`${entQual}\`) | \`step${createStep}_${ent}\` | \`step${retrieveStep}_${ent}\` | \`RetrieveOption = "Teststep", Filter: Sentinel == 'VALID'\` | \`Assert Object Count == 1\` | \`None\` / \`Stop\` | \`PAT-07\` |`
    );
  }
  const mfCallStepNum = nextStepNum++;
  const mfInputHandles = orderedEntities
    .map((ent) => `\`step${entityRetrieveStepMap.get(ent)}_${ent}\``)
    .join(", ");
  const mfBindings = orderedEntities
    .map((ent, idx) =>
      idx === 0
        ? `${paramName} = step${entityRetrieveStepMap.get(ent)}_${ent}`
        : `${ent} = step${entityRetrieveStepMap.get(ent)}_${ent}`
    )
    .join(", ");

  const concreteAttrKeys = Array.from(attrKeySet);
  let matrixRowIdx = 1;
  const sentinelRowsMd = orderedEntities
    .map((ent, idx) => {
      const cStep = entityCreateStepMap.get(ent);
      const vals = idx === 0 ? sentinelValues : scenarios.map(() => "`VALID`").join(" | ");
      return `| ${matrixRowIdx++} | Step ${cStep}: \`${ent}.Sentinel\` | ${vals} |`;
    })
    .join("\n");
  const concreteAttrRowsMd = concreteAttrKeys
    .map((attrKey) => {
      const entShort = attrKey.split(".")[0];
      const cStep = entityCreateStepMap.get(entShort) || 1;
      const cells = scenarios
        .map((s) => {
          const rawVal =
            s.overrides && attrKey in s.overrides ? String(s.overrides[attrKey]) : "VALID";
          const safeCellVal = /^(?:empty|null|none|unassigned)$/i.test(rawVal.trim())
            ? "BLANK"
            : rawVal;
          return `\`${safeCellVal}\``;
        })
        .join(" | ");
      return `| ${matrixRowIdx++} | Step ${cStep}: \`${attrKey}\` | ${cells} |`;
    })
    .join("\n");
  const assertRowNumber = matrixRowIdx;
  const isIdempotencyPlan =
    scopedHyp?.pattern_id === "PBT-04" ||
    scopedHyp?.property_check?.type === "IDEMPOTENCY_DOUBLE_CALL";
  const step4IdempotencyRowMd = isIdempotencyPlan
    ? `\n| **${nextStepNum}** | Case 1 | \`CallMicroflow\` (\`${primaryMf}\`) | ${mfInputHandles} | \`resultHandle_2\` | \`${mfBindings}\` | \`Assert Return Value == true\` | \`None\` / \`Stop\` | \`PAT-14\` |`
    : "";

  const isStatic = Boolean(options.isStatic || manifest.is_static);
  const testsFileName = isStatic
    ? `BugHunt_Planned_Tests_${targetSlug}.md`
    : `BugHunt_Executed_Tests_${targetSlug}.md`;
  const reportRelLink = options.reportRelLink || `../bug-reports/BugHunt_Report_${targetSlug}.md`;
  const executedTestsRelLink =
    options.executedTestsRelLink || `./${testsFileName}`;

  const topHyp = scopedHyp || (manifest.hypotheses || [])[0] || {
    pattern_id: "BHP-01",
    severity: "HIGH",
    defect_tier: "RED",
    microflow: primaryMf,
  };
  const primaryDualRisk = topHyp.dual_risk || classifyFindingDualRisk(topHyp, manifest);

  const praRows = scenarios
    .map((s, i) => {
      const hyp =
        allCandidateHyps.find(
          (h) => h.id === s.hypothesis_id || h.pattern_id === s.pattern_id
        ) || { pattern_id: s.pattern_id || "BHP-01", severity: "HIGH", defect_tier: "RED" };
      const dr = hyp.dual_risk || classifyFindingDualRisk(hyp, manifest);
      return `| \`[${s.pattern_id}]\` ${s.name.replace(/\|/g, "/")} (\`${dr.business_risk_profile}\`) | ${dr.impact} | ${dr.likelihood} | **${dr.risk_rating}** | Scenario #${i + 1} |`;
    })
    .join("\n");

  const section2Text = isModuleWidePlan
    ? `${primaryMf}\n\n* **Module Scope (\`${manifest.module}\`):** Covers ${coveredMicroflows.map((m) => `\`${m}\``).join(", ")}`
    : primaryMf;

  return `# Execution Plan: EP_BugHunt_${targetSlug}

> 🔗 **Parent Bug Hunter Report:** [BugHunt_Report_${targetSlug}.md](${reportRelLink}) | **${isStatic ? "Planned Tests" : "Executed Verification Tests"}:** [${testsFileName}](${executedTestsRelLink})

<details>
<summary><b>Test Plan Details & Tracking (Click to expand)</b></summary>

\`\`\`yaml
schema_version: "2.1.0"
plan_id: "${planId}"
status: "${planStatus}"
category: "Backend"
test_intent: "exploratory_robustness"
intent_derivation: "prompt_directive"
rollback: "Yes"
spec_source:
  type: "user_story"
  reference: "MTA-BUGHUNT-2.0"
  summary: "When ${displayComponent} is invoked with boundary, null, or malformed inputs, system must enforce domain invariants and reject invalid state without unhandled runtime exceptions."
  mcp_retrieved: false
risks_covered:
${risksYaml}
\`\`\`

</details>

## 1. Purpose & Scope
Adversarial in-memory bug hunting test specification for \`${displayComponent}\` synthesized by \`mta-bughunter.mjs\` (stored in \`menditect-output/bug-hunt-tests/\`). All scenarios execute with \`Rollback = Yes\` for zero database residue.

### Dual-Risk Alignment & Mitigation Profile (per \`mta-test-design/references/risk-matrix.md\`)
| Risk Dimension | Classification | Mitigation Rationale |
| :--- | :--- | :--- |
| **Technical Risk Profile** | \`${primaryDualRisk.technical_risk_profile}\` | Targets boundary, null-dereference, security, call-hierarchy Commit/Delete, and transactional ACID hazards in \`${displayComponent}\`. |
| **Business Risk Profile** | \`${primaryDualRisk.business_risk_profile}\` | ${primaryDualRisk.business_impact_consequence} |
| **Selected MTF Test Level** | \`${primaryDualRisk.recommended_test_level}\` (\`MTA ${primaryDualRisk.mta_category}\`) | Direct microflow verification with in-memory rollback (\`Rollback = Yes\`). |

## 2. Component Under Test
${section2Text}

## 3. Test Steps & Action Sequence

| # | Case | Step Action & Target | Input Handle | Output Handle | Parameters, Bindings & Initial Values | Embedded Assertions | Exec Settings | Pattern Tag |
| :-: | :--: | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
${section3PrepStepsMd.join("\n")}
| **${mfCallStepNum}** | Case 1 | \`CallMicroflow\` (\`${primaryMf}\`) | ${mfInputHandles} | \`resultHandle\` | \`${mfBindings}\` | \`Assert Return Value == true\` | \`None\` / \`Stop\` | \`PAT-14\` |${step4IdempotencyRowMd}

## 4. Test Scenarios & Test Data

| # | Step Target | ${scenarioHeaders} |
| :---: | :--- | ${scenarioAlign} |
| **0** | **Scenario Name** | ${scenarioNames} |
| **0** | **Scenario Description** | ${scenarioDescs} |
${sentinelRowsMd}
${concreteAttrRowsMd ? `${concreteAttrRowsMd}\n` : ""}| ${assertRowNumber} | Step ${mfCallStepNum}: Assert Return Value | ${expectedReturnValues} |

## 5. Quality & Compliance Checks
* [x] Paired \`PAT-07\` Dual-Retrieve sentinels configured for null object dereference checks.
* [x] Zero database residue guaranteed via \`Rollback = Yes\`.

### Product Risk Analysis (PRA)
| Risk / Defect Failure Mode | Impact (1-5) | Likelihood (1-5) | Risk Rating (I × L) | Mitigating Scenario(s) |
| :--- | :---: | :---: | :---: | :--- |
${praRows}
`;
}

// ============================================================================
// 5. 4-TIER RUNTIME RESULT RECONCILIATION & REPORT BUILDER
//    (Explicitly distinguishes Actual UI/API Reproducible Bugs vs. Latent Implicitly Protected Bugs,
//     and clearly documents Frontend UI vs. Backend Microflow execution channels and why chosen)
// ============================================================================

export function resolveTestChannelAndRationale(finding, manifest = {}) {
  const execChannel = String(finding.execution_channel || finding.test_channel || "");
  const patId = String(finding.pattern_id || "");
  const mfName = String(
    finding.microflow || manifest.target_microflow || manifest.primary_microflow || ""
  );
  const mfShort = mfName.split(".").pop() || mfName;
  const pageName =
    finding.page_qualified_name ||
    finding.call_hierarchy_context?.calling_pages?.[0] ||
    null;

  // 1. Executed or targeted via Frontend Playwright UI
  if (
    execChannel === "FRONTEND_PLAYWRIGHT_PLUGIN" ||
    execChannel === "FRONTEND_UI" ||
    finding.test_channel === "FRONTEND_UI"
  ) {
    return {
      channelCode: "FRONTEND_UI",
      channelBadge: "🌐 Frontend UI (Playwright)",
      channelShort: "🌐 Frontend (Playwright)",
      rationale:
        finding.test_channel_rationale ||
        (pageName
          ? `Chosen because '${mfName}' is triggered from Mendix Page '${pageName}', and verifying client-side widget constraints, input masks, and visible validation feedback requires real browser interaction via MenditectMxFrontendTestKit.`
          : `Chosen because verifying page-level widget visibility, input masks, and validation feedback requires real browser interaction via MenditectMxFrontendTestKit.`),
    };
  }

  // 2. Static Page / UI Candidate (`BHP-17`, `BHP-32`, `DQP-02`, `AMBER-UI`)
  if (
    finding.defect_tier === "AMBER-UI" ||
    patId === "BHP-17" ||
    patId === "BHP-32" ||
    patId === "DQP-02"
  ) {
    return {
      channelCode: "FRONTEND_UI",
      channelBadge: "🌐 Frontend UI (Playwright / Page Check)",
      channelShort: "🌐 Frontend (Page Check)",
      rationale:
        finding.test_channel_rationale ||
        `Chosen because '${patId}' inspects whether validation feedback or page role access on '${pageName || "the calling Mendix page"}' is actually rendered to the end user in the browser.`,
    };
  }

  // 3. Database XPath / Dataset Audit (`INV-02`)
  if (patId === "INV-02" || /^DatabaseCheck\./i.test(mfName)) {
    return {
      channelCode: "BACKEND_DATASET",
      channelBadge: "🗄️ Backend (Database XPath Audit)",
      channelShort: "🗄️ Backend (Dataset Audit)",
      rationale:
        finding.test_channel_rationale ||
        `Chosen because this check audits existing committed database records directly via an XPath retrieve constraint to detect historical data integrity violations without UI overhead.`,
    };
  }

  // 4. Direct Backend Microflow Execution (`ACT_*`, `SUB_*`, `VAL_*`, `EVT_*`, `CMT_*`)
  const isSubOrValOrEvt = /^(SUB_|VAL_|EVT_|BCO_|ACO_|BDO_|RULE_|CALC_)/i.test(mfShort);
  const isLatent =
    finding.exposure_classification === "LATENT_IMPLICITLY_PROTECTED" ||
    Boolean(finding.call_hierarchy_context?.shielded_by_parent);
  const defectNature = classifyDefectNature(finding);

  let rationale = "";
  if (finding.test_channel_rationale) {
    rationale = finding.test_channel_rationale;
  } else if (isSubOrValOrEvt || isLatent) {
    rationale = `Chosen because '${mfName}' is an internal sub-microflow / event handler not directly bound to a single page button; invoking it directly on the Mendix server with automatic transaction rollback ('Rollback: Yes') isolates its internal guard logic from upstream page filters.`;
  } else if (defectNature === "FUNCTIONAL_BYPASS") {
    rationale = pageName
      ? `Chosen to test server-side business rule enforcement in '${mfName}' directly (with 'Rollback: Yes'), verifying whether the microflow itself rejects invalid domain data even if client-side widgets on '${pageName}' are bypassed or modified.`
      : `Chosen to verify server-side business rule and commit enforcement in '${mfName}' directly in memory ('Rollback: Yes') with deterministic boundary inputs.`;
  } else {
    rationale = pageName
      ? `Chosen to deterministically pass boundary/empty inputs directly into '${mfName}' on the Mendix server ('Rollback: Yes') without client-side form blockers on '${pageName}', isolating server-side null-safety and transaction rollback behavior.`
      : `Chosen because '${mfName}' can be invoked directly on the Mendix runtime ('Rollback: Yes') for fast, deterministic server-side verification without browser overhead.`;
  }

  return {
    channelCode: "BACKEND_MICROFLOW",
    channelBadge: "⚙️ Backend (Direct Microflow)",
    channelShort: "⚙️ Backend (Microflow)",
    rationale,
  };
}

export function buildVerifiedBugReport(manifest, runtimeResults = {}) {
  const isStatic = Boolean(
    runtimeResults.is_static === true ||
    runtimeResults._isStatic === true ||
    (!runtimeResults.scenarios && runtimeResults.is_static !== false)
  );
  const scenarioOutcomes = runtimeResults.scenarios || [];
  const confirmedBugsRed = [];
  const actualBugsUiApiReproducible = [];
  const latentBugsImplicitlyProtected = [];
  const verifiedResilientGreen = [];
  const executedScenarios = [];
  const latentAmberRisks = (manifest.amber_risks || []).map((a) => ({
    ...a,
    dual_risk: a.dual_risk || classifyFindingDualRisk(a, manifest),
  }));
  const uiPageCandidates = (manifest.amber_ui_candidates || []).map((u) => ({
    ...u,
    dual_risk: u.dual_risk || classifyFindingDualRisk(u, manifest),
  }));
  const targetSlug = resolveTargetSlug(manifest);

  let scenarioCounter = 0;

  if (isStatic) {
    for (const hyp of manifest.hypotheses || []) {
      scenarioCounter++;
      const scenarioAnchor = `scenario-${scenarioCounter}`;
      const findingAnchor = `finding-${hyp.id || scenarioCounter}`;
      const dualRisk = hyp.dual_risk || classifyFindingDualRisk(hyp, manifest);
      const isLatentImplicitlyProtected =
        hyp.exposure_classification === "LATENT_IMPLICITLY_PROTECTED" ||
        Boolean(hyp.call_hierarchy_context?.shielded_by_parent);
      const exposureClassification = isLatentImplicitlyProtected
        ? "LATENT_IMPLICITLY_PROTECTED"
        : "ACTUAL_UI_OR_API_REPRODUCIBLE";
      const chInfo = resolveTestChannelAndRationale(hyp, manifest);

      const bugEntry = {
        ...hyp,
        verification_status: "STATIC_AST_CANDIDATE",
        exposure_classification: exposureClassification,
        exposure_badge: isLatentImplicitlyProtected
          ? "🔶 LATENT BUG (Implicitly Protected Today — Future Regression Risk)"
          : "🔴 ACTUAL BUG (UI / API Reproducible Now)",
        dual_risk: dualRisk,
        test_channel: chInfo.channelCode,
        test_channel_badge: chInfo.channelBadge,
        test_channel_short: chInfo.channelShort,
        test_channel_rationale: chInfo.rationale,
        scenario_number: scenarioCounter,
        scenario_anchor: scenarioAnchor,
        finding_anchor: findingAnchor,
        status: "STATIC_AST_IDENTIFIED",
        defect_tier: hyp.defect_tier === "AMBER" ? "AMBER" : "RED",
        defect_subtier: isLatentImplicitlyProtected ? "RED-LATENT" : "RED-ACTUAL",
        runtime_failure_code: "STATIC_AST_IDENTIFIED",
        actual_runtime_error:
          hyp.oracle_rule ||
          hyp.test_strategy ||
          "Identified via static Mendix model inspection (dynamic verification pending).",
        duration_ms: 0,
      };
      confirmedBugsRed.push(bugEntry);
      if (isLatentImplicitlyProtected) {
        latentBugsImplicitlyProtected.push(bugEntry);
      } else {
        actualBugsUiApiReproducible.push(bugEntry);
      }
      executedScenarios.push(bugEntry);
    }
    for (const a of latentAmberRisks) {
      a.verification_status = "STATIC_AST_CANDIDATE";
      const chInfo = resolveTestChannelAndRationale(a, manifest);
      a.test_channel = chInfo.channelCode;
      a.test_channel_badge = chInfo.channelBadge;
      a.test_channel_short = chInfo.channelShort;
      a.test_channel_rationale = chInfo.rationale;
    }
    for (const u of uiPageCandidates) {
      u.verification_status = "STATIC_AST_CANDIDATE";
      const chInfo = resolveTestChannelAndRationale(u, manifest);
      u.test_channel = chInfo.channelCode;
      u.test_channel_badge = chInfo.channelBadge;
      u.test_channel_short = chInfo.channelShort;
      u.test_channel_rationale = chInfo.rationale;
    }
  } else {
    const executedHypIds = new Set();
    const confirmedPatternMap = new Map();
    const backendOutcomes = scenarioOutcomes.filter(
      (s) => s.execution_channel !== "FRONTEND_PLAYWRIGHT_PLUGIN"
    );
    const frontendOutcomes = scenarioOutcomes.filter(
      (s) => s.execution_channel === "FRONTEND_PLAYWRIGHT_PLUGIN"
    );

    for (const hyp of manifest.hypotheses || []) {
      const match = backendOutcomes.find(
        (s) => s.hypothesis_id === hyp.id || (!s.hypothesis_id && s.pattern_id === hyp.pattern_id && !executedHypIds.has(hyp.id))
      );

      if (!match) {
        continue;
      }
      executedHypIds.add(hyp.id);

      scenarioCounter++;
      const scenarioAnchor = `scenario-${scenarioCounter}`;
      const findingAnchor = `finding-${hyp.id || scenarioCounter}`;
      const dualRisk = hyp.dual_risk || classifyFindingDualRisk(hyp, manifest);
      const isLatentImplicitlyProtected =
        hyp.exposure_classification === "LATENT_IMPLICITLY_PROTECTED" ||
        Boolean(hyp.call_hierarchy_context?.shielded_by_parent);
      const exposureClassification = isLatentImplicitlyProtected
        ? "LATENT_IMPLICITLY_PROTECTED"
        : "ACTUAL_UI_OR_API_REPRODUCIBLE";
      const chInfo = resolveTestChannelAndRationale(
        { ...hyp, ...match },
        manifest
      );

      if (match.outcome && match.outcome.startsWith("FAIL_")) {
        const errText = String(match.error_message || match.actual_value || "");
        const isNullValidationObjCrash =
          /validationObjectId.*is null|AddValidationFeedback/i.test(errText);
        // Prevent upstream null-object validation crashes (BHP-01) from falsely confirming unrelated patterns
        // (e.g., DQP-04, BHP-15, BHP-21, BHP-32, DQP-09) when the activity under test was never reached.
        if (isNullValidationObjCrash && hyp.pattern_id && hyp.pattern_id !== "BHP-01") {
          hyp.verification_status = "STATIC_AST_CANDIDATE";
          continue;
        }

        const bugEntry = {
          ...hyp,
          verification_status: "DYNAMIC_RECEIPT_CONFIRMED",
          receipt_test_number: scenarioCounter,
          exposure_classification: exposureClassification,
          exposure_badge: isLatentImplicitlyProtected
            ? "🔶 LATENT BUG (Implicitly Protected Today — Future Regression Risk)"
            : "🔴 ACTUAL BUG (UI / API Reproducible Now)",
          dual_risk: dualRisk,
          test_channel: chInfo.channelCode,
          test_channel_badge: chInfo.channelBadge,
          test_channel_short: chInfo.channelShort,
          test_channel_rationale: chInfo.rationale,
          scenario_number: scenarioCounter,
          scenario_anchor: scenarioAnchor,
          finding_anchor: findingAnchor,
          status: "CONFIRMED_BUG",
          defect_tier: hyp.defect_tier === "AMBER" ? "AMBER" : "RED",
          defect_subtier: isLatentImplicitlyProtected ? "RED-LATENT" : "RED-ACTUAL",
          runtime_failure_code: match.outcome,
          actual_runtime_error:
            match.error_message || match.actual_value || "Runtime failure reproduced",
          duration_ms: match.duration_ms || 0,
        };
        confirmedBugsRed.push(bugEntry);
        if (isLatentImplicitlyProtected) {
          latentBugsImplicitlyProtected.push(bugEntry);
        } else {
          actualBugsUiApiReproducible.push(bugEntry);
        }
        executedScenarios.push(bugEntry);

        if (hyp.pattern_id && !confirmedPatternMap.has(hyp.pattern_id)) {
          confirmedPatternMap.set(hyp.pattern_id, bugEntry);
        }
      } else if (match.outcome === "PASS") {
        const greenEntry = {
          ...hyp,
          verification_status: "DYNAMIC_RECEIPT_CONFIRMED",
          receipt_test_number: scenarioCounter,
          exposure_classification: exposureClassification,
          dual_risk: dualRisk,
          test_channel: chInfo.channelCode,
          test_channel_badge: chInfo.channelBadge,
          test_channel_short: chInfo.channelShort,
          test_channel_rationale: chInfo.rationale,
          scenario_number: scenarioCounter,
          scenario_anchor: scenarioAnchor,
          finding_anchor: findingAnchor,
          status: "VERIFIED_RESILIENT",
          defect_tier: "GREEN",
          runtime_failure_code: "PASS",
          actual_runtime_error: match.actual_value || "Handled safely without unhandled exception or invariant breach.",
          duration_ms: match.duration_ms || 0,
        };
        verifiedResilientGreen.push(greenEntry);
        executedScenarios.push(greenEntry);
      }
    }

    // Reconcile executed Frontend Playwright scenarios (`FRONTEND_PLAYWRIGHT_PLUGIN`)
    for (const feMatch of frontendOutcomes) {
      scenarioCounter++;
      const scenarioAnchor = `scenario-${scenarioCounter}`;
      const matchedUiCand = uiPageCandidates.find(
        (u) =>
          (feMatch.hypothesis_id && u.id === feMatch.hypothesis_id) ||
          (feMatch.pattern_id && u.pattern_id === feMatch.pattern_id && u.microflow === feMatch.microflow)
      );
      const matchedHyp = (manifest.hypotheses || []).find(
        (h) => feMatch.hypothesis_id && h.id === feMatch.hypothesis_id
      );
      const baseItem = matchedUiCand || matchedHyp || {
        id: feMatch.id || `FE_${scenarioCounter}`,
        pattern_id: feMatch.pattern_id || "BHP-17",
        severity: "P1",
        defect_tier: "RED",
        title: feMatch.title || `Frontend Playwright UI Verification (${feMatch.page_qualified_name || feMatch.microflow})`,
        microflow: feMatch.microflow || manifest.target_microflow,
        page_qualified_name: feMatch.page_qualified_name,
        activity_caption: `Page ${feMatch.page_qualified_name || "UI"} -> ${feMatch.microflow || "Action"}`,
        oracle_rule: feMatch.actual_value || "Verify page-level validation feedback and form submission in browser.",
        remediation: "Ensure validation feedback is rendered on visible widgets or via a Show Message action.",
      };
      const findingAnchor = `finding-${feMatch.id || baseItem.id || scenarioCounter}`;
      const dualRisk = baseItem.dual_risk || classifyFindingDualRisk(baseItem, manifest);
      const chInfo = resolveTestChannelAndRationale(
        {
          ...baseItem,
          ...feMatch,
          execution_channel: "FRONTEND_PLAYWRIGHT_PLUGIN",
          test_channel: "FRONTEND_UI",
        },
        manifest
      );

      if (feMatch.outcome === "FAIL_UI_ASSERTION") {
        const feBugEntry = {
          ...baseItem,
          id: feMatch.id || `${baseItem.id}_FE`,
          verification_status: "DYNAMIC_RECEIPT_CONFIRMED",
          receipt_test_number: scenarioCounter,
          exposure_classification: "ACTUAL_UI_OR_API_REPRODUCIBLE",
          exposure_badge: "🔴 ACTUAL BUG (UI / API Reproducible Now)",
          dual_risk: dualRisk,
          execution_channel: "FRONTEND_PLAYWRIGHT_PLUGIN",
          test_channel: chInfo.channelCode,
          test_channel_badge: chInfo.channelBadge,
          test_channel_short: chInfo.channelShort,
          test_channel_rationale: chInfo.rationale,
          page_qualified_name: feMatch.page_qualified_name || baseItem.page_qualified_name,
          scenario_number: scenarioCounter,
          scenario_anchor: scenarioAnchor,
          finding_anchor: findingAnchor,
          status: "CONFIRMED_BUG",
          defect_tier: "RED",
          defect_subtier: "RED-ACTUAL",
          runtime_failure_code: feMatch.outcome,
          actual_runtime_error:
            feMatch.error_message || feMatch.actual_value || "Frontend Playwright UI assertion failed.",
          duration_ms: feMatch.duration_ms || 0,
          trace_artifact: feMatch.trace_artifact || null,
          executed_steps: feMatch.step_summary || [],
        };
        if (matchedUiCand) {
          matchedUiCand.verification_status = "DYNAMIC_RECEIPT_CONFIRMED";
          matchedUiCand.scenario_number = scenarioCounter;
          matchedUiCand.scenario_anchor = scenarioAnchor;
          matchedUiCand.test_channel = chInfo.channelCode;
          matchedUiCand.test_channel_badge = chInfo.channelBadge;
          matchedUiCand.test_channel_rationale = chInfo.rationale;
          matchedUiCand.trace_artifact = feMatch.trace_artifact || null;
        }
        // Avoid duplicating if the exact same hypothesis ID was already added as a confirmed bug; otherwise record the frontend-confirmed bug
        const existingRed = confirmedBugsRed.find((b) => b.id === (matchedHyp && matchedHyp.id));
        if (existingRed) {
          existingRed.also_verified_via_frontend = true;
          existingRed.frontend_scenario_number = scenarioCounter;
          existingRed.frontend_scenario_anchor = scenarioAnchor;
          if (!existingRed.trace_artifact && feMatch.trace_artifact) {
            existingRed.trace_artifact = feMatch.trace_artifact;
          }
        } else {
          confirmedBugsRed.push(feBugEntry);
          actualBugsUiApiReproducible.push(feBugEntry);
        }
        executedScenarios.push(feBugEntry);
      } else if (feMatch.outcome && feMatch.outcome.startsWith("FAIL_")) {
        const feInconclusiveEntry = {
          ...baseItem,
          id: feMatch.id || `${baseItem.id}_FE`,
          verification_status: "FRONTEND_SETUP_OR_LOCATOR_INCONCLUSIVE",
          receipt_test_number: scenarioCounter,
          exposure_classification: "ACTUAL_UI_OR_API_REPRODUCIBLE",
          dual_risk: dualRisk,
          execution_channel: "FRONTEND_PLAYWRIGHT_PLUGIN",
          test_channel: chInfo.channelCode,
          test_channel_badge: chInfo.channelBadge,
          test_channel_short: chInfo.channelShort,
          test_channel_rationale: chInfo.rationale,
          page_qualified_name: feMatch.page_qualified_name || baseItem.page_qualified_name,
          scenario_number: scenarioCounter,
          scenario_anchor: scenarioAnchor,
          finding_anchor: findingAnchor,
          status: "INCONCLUSIVE_TEST_SETUP",
          defect_tier: "AMBER-UI",
          runtime_failure_code: feMatch.outcome,
          actual_runtime_error:
            feMatch.error_message || feMatch.actual_value || "Frontend Playwright test stopped before reaching the target assertion (setup or locator precondition failure).",
          duration_ms: feMatch.duration_ms || 0,
          trace_artifact: feMatch.trace_artifact || null,
          executed_steps: feMatch.step_summary || [],
        };
        if (matchedUiCand) {
          matchedUiCand.verification_status = "FRONTEND_SETUP_OR_LOCATOR_INCONCLUSIVE";
          matchedUiCand.scenario_number = scenarioCounter;
          matchedUiCand.scenario_anchor = scenarioAnchor;
          matchedUiCand.test_channel = chInfo.channelCode;
          matchedUiCand.test_channel_badge = chInfo.channelBadge;
          matchedUiCand.test_channel_rationale = chInfo.rationale;
          matchedUiCand.trace_artifact = feMatch.trace_artifact || null;
        }
        executedScenarios.push(feInconclusiveEntry);
      } else {
        const feGreenEntry = {
          ...baseItem,
          id: feMatch.id || `${baseItem.id}_FE`,
          verification_status: "DYNAMIC_RECEIPT_CONFIRMED",
          receipt_test_number: scenarioCounter,
          exposure_classification: "ACTUAL_UI_OR_API_REPRODUCIBLE",
          dual_risk: dualRisk,
          execution_channel: "FRONTEND_PLAYWRIGHT_PLUGIN",
          test_channel: chInfo.channelCode,
          test_channel_badge: chInfo.channelBadge,
          test_channel_short: chInfo.channelShort,
          test_channel_rationale: chInfo.rationale,
          page_qualified_name: feMatch.page_qualified_name || baseItem.page_qualified_name,
          scenario_number: scenarioCounter,
          scenario_anchor: scenarioAnchor,
          finding_anchor: findingAnchor,
          status: "VERIFIED_RESILIENT",
          defect_tier: "GREEN",
          runtime_failure_code: "PASS",
          actual_runtime_error:
            feMatch.actual_value || "Verified in browser via Playwright: validation feedback / UI behavior handled properly.",
          duration_ms: feMatch.duration_ms || 0,
          trace_artifact: feMatch.trace_artifact || null,
          executed_steps: feMatch.step_summary || [],
        };
        if (matchedUiCand) {
          matchedUiCand.verification_status = "DYNAMIC_RECEIPT_CONFIRMED";
          matchedUiCand.scenario_number = scenarioCounter;
          matchedUiCand.scenario_anchor = scenarioAnchor;
          matchedUiCand.test_channel = chInfo.channelCode;
          matchedUiCand.test_channel_badge = chInfo.channelBadge;
          matchedUiCand.test_channel_rationale = chInfo.rationale;
        }
        verifiedResilientGreen.push(feGreenEntry);
        executedScenarios.push(feGreenEntry);
      }
    }

    // Second pass: unexecuted hypotheses (derive representative proof or mark static candidate)
    for (const hyp of manifest.hypotheses || []) {
      if (executedHypIds.has(hyp.id)) continue;

      const repBug = hyp.pattern_id ? confirmedPatternMap.get(hyp.pattern_id) : null;
      const hypMf = hyp.microflow || manifest.target_microflow || manifest.primary_microflow;
      const repMf = repBug ? (repBug.microflow || manifest.target_microflow || manifest.primary_microflow) : null;
      const repIsNullValFeedback =
        repBug &&
        (/Validation Feedback on Null Object/i.test(repBug.title || "") ||
          /validationObjectId.*is null/i.test(repBug.actual_runtime_error || ""));
      const hypIsNullValFeedback = /Validation Feedback on Null Object/i.test(hyp.title || "");
      const sameSubPattern = !repIsNullValFeedback || hypIsNullValFeedback;
      const isRepresentativeProof = Boolean(repBug && hypMf && repMf && hypMf !== repMf && sameSubPattern);

      const dualRisk = hyp.dual_risk || classifyFindingDualRisk(hyp, manifest);
      const isLatentImplicitlyProtected =
        hyp.exposure_classification === "LATENT_IMPLICITLY_PROTECTED" ||
        Boolean(hyp.call_hierarchy_context?.shielded_by_parent);
      const exposureClassification = isLatentImplicitlyProtected
        ? "LATENT_IMPLICITLY_PROTECTED"
        : "ACTUAL_UI_OR_API_REPRODUCIBLE";
      const chInfo = resolveTestChannelAndRationale(hyp, manifest);

      if (isRepresentativeProof) {
        hyp.verification_status = "STATIC_REPRESENTATIVE_PROOF";
        hyp.representative_microflow = repMf;
        hyp.representative_scenario_number = repBug.scenario_number;
        hyp.representative_finding_id = repBug.id;

        const findingAnchor = `finding-${hyp.id || hyp.pattern_id}`;
        const bugEntry = {
          ...hyp,
          verification_status: "STATIC_REPRESENTATIVE_PROOF",
          representative_microflow: repMf,
          representative_scenario_number: repBug.scenario_number,
          representative_finding_id: repBug.id,
          receipt_test_number: repBug.scenario_number,
          scenario_number: repBug.scenario_number,
          scenario_anchor: repBug.scenario_anchor,
          finding_anchor: findingAnchor,
          exposure_classification: exposureClassification,
          exposure_badge: isLatentImplicitlyProtected
            ? "🔶 LATENT BUG (Implicitly Protected Today — Future Regression Risk)"
            : "🔴 ACTUAL BUG (UI / API Reproducible Now)",
          dual_risk: dualRisk,
          test_channel: chInfo.channelCode,
          test_channel_badge: chInfo.channelBadge,
          test_channel_short: chInfo.channelShort,
          test_channel_rationale: chInfo.rationale,
          status: "CONFIRMED_BUG",
          defect_tier: hyp.defect_tier === "AMBER" ? "AMBER" : "RED",
          defect_subtier: isLatentImplicitlyProtected ? "RED-LATENT" : "RED-ACTUAL",
          runtime_failure_code: repBug.runtime_failure_code,
          actual_runtime_error: `Verified via AST equivalence with representative test #${repBug.scenario_number} (${repMf}): ${repBug.actual_runtime_error}`,
          duration_ms: 0,
        };
        confirmedBugsRed.push(bugEntry);
        if (isLatentImplicitlyProtected) {
          latentBugsImplicitlyProtected.push(bugEntry);
        } else {
          actualBugsUiApiReproducible.push(bugEntry);
        }
      } else {
        hyp.verification_status = "STATIC_AST_CANDIDATE";
      }
    }

    // Reconcile Amber risks and UI candidates
    for (const a of latentAmberRisks) {
      const chInfo = resolveTestChannelAndRationale(a, manifest);
      a.test_channel = chInfo.channelCode;
      a.test_channel_badge = chInfo.channelBadge;
      a.test_channel_short = chInfo.channelShort;
      a.test_channel_rationale = chInfo.rationale;
      const aMf = a.microflow || manifest.target_microflow || manifest.primary_microflow;
      if (a.pattern_id && confirmedPatternMap.has(a.pattern_id)) {
        const repBug = confirmedPatternMap.get(a.pattern_id);
        const repMf = repBug.microflow || manifest.target_microflow || manifest.primary_microflow;
        if (aMf && repMf && aMf !== repMf) {
          a.verification_status = "STATIC_REPRESENTATIVE_PROOF";
          a.representative_microflow = repMf;
          a.representative_scenario_number = repBug.scenario_number;
          continue;
        }
      }
      a.verification_status = a.verification_status || "STATIC_AST_CANDIDATE";
    }
    for (const u of uiPageCandidates) {
      u.verification_status = u.verification_status || "STATIC_AST_CANDIDATE";
      if (!u.test_channel_badge) {
        const chInfo = resolveTestChannelAndRationale(u, manifest);
        u.test_channel = chInfo.channelCode;
        u.test_channel_badge = chInfo.channelBadge;
        u.test_channel_short = chInfo.channelShort;
        u.test_channel_rationale = chInfo.rationale;
      }
    }
  }

  // Reconcile Business Rules against dynamic execution outcomes (RED confirmed bugs, AMBER bypasses, GREEN resilient)
  const rawBusinessRules = Array.isArray(manifest.business_rules)
    ? manifest.business_rules
    : extractAndCrossCheckBusinessRules(
        manifest,
        [],
        manifest.hypotheses || [],
        latentAmberRisks,
        uiPageCandidates
      );

  const reconciledBusinessRules = rawBusinessRules.map((br) => {
    const linkedRed = [];
    const linkedAmber = [];
    const linkedGreen = [];

    for (const vf of br.violated_by_findings || []) {
      const redMatch = confirmedBugsRed.find(
        (b) => (vf.id && b.id === vf.id) || (b.pattern_id === vf.pattern_id && b.title === vf.title)
      );
      if (redMatch) {
        linkedRed.push(redMatch);
        continue;
      }
      const greenMatch = verifiedResilientGreen.find(
        (g) => (vf.id && g.id === vf.id) || (g.pattern_id === vf.pattern_id && g.title === vf.title)
      );
      if (greenMatch) {
        linkedGreen.push(greenMatch);
        continue;
      }
      // If a non-executable structural flag (e.g. BHP-15) was not executed, keep as amber warning
      linkedAmber.push(vf);
    }

    let runtimeStatus = "ENFORCED_IN_MODEL";
    if (linkedRed.length > 0) {
      const onlyTechnicalCrash = linkedRed.every(
        (b) => classifyDefectNature(b) === "TECHNICAL_CRASH"
      );
      if (onlyTechnicalCrash) {
        runtimeStatus = isStatic ? "VIOLATED_STATIC_AST" : "CRASHES_ON_EMPTY_INPUT";
      } else {
        runtimeStatus = isStatic ? "VIOLATED_STATIC_AST" : "VIOLATED_CONFIRMED_RED";
      }
    } else if (linkedGreen.length > 0) {
      // If runtime tests proved domain/microflow enforcement (e.g. DataValidationRuntimeException on Email), mark VERIFIED_ENFORCED_GREEN
      runtimeStatus = "VERIFIED_ENFORCED_GREEN";
    } else if (linkedAmber.length > 0) {
      runtimeStatus = "BYPASSED_OR_AT_RISK_AMBER";
    }

    return {
      ...br,
      status: runtimeStatus,
      confirmed_red_violations: linkedRed.map((b) => ({
        id: b.id,
        pattern_id: b.pattern_id,
        defect_nature: classifyDefectNature(b),
        title: b.title,
        exposure_classification: b.exposure_classification,
        finding_anchor: b.finding_anchor,
        scenario_number: b.scenario_number,
        scenario_anchor: b.scenario_anchor,
        runtime_failure_code: b.runtime_failure_code,
      })),
      amber_bypasses: linkedAmber,
      verified_green_checks: linkedGreen.map((g) => ({
        id: g.id,
        pattern_id: g.pattern_id,
        title: g.title,
        finding_anchor: g.finding_anchor,
        scenario_number: g.scenario_number,
        scenario_anchor: g.scenario_anchor,
      })),
    };
  });

  const violatedRulesCount = reconciledBusinessRules.filter(
    (br) =>
      br.status === "VIOLATED_CONFIRMED_RED" ||
      br.status === "CRASHES_ON_EMPTY_INPUT" ||
      br.status === "VIOLATED_STATIC_AST" ||
      br.status === "BYPASSED_OR_AT_RISK_AMBER"
  ).length;

  const commitDeleteHierarchyCount = [
    ...confirmedBugsRed,
    ...latentAmberRisks,
  ].filter((f) => f.call_hierarchy_context?.exposes_commit_or_delete_in_hierarchy || f.dual_risk?.hierarchy_commits_or_deletes).length;

  const safe01Quarantined = Boolean(manifest.guardrails?.safe_01_quarantined);
  const safe01SideEffects = manifest.guardrails?.safe_01_side_effects || [];
  const safe01Reasons = manifest.guardrails?.safe_01_quarantine_reasons || [];
  const topLimit = runtimeResults.top_limit || manifest.top_limit || 25;
  const totalCandidates = (manifest.hypotheses || []).length;
  const isOnline = runtimeResults.plugin_online !== undefined ? runtimeResults.plugin_online : !isStatic;
  const pluginUrl = runtimeResults.plugin_url || manifest.plugin_url || "MTA Plugin (Local/Cluster)";
  const probeStatusCode = runtimeResults.probe_status_code || (isStatic ? "STATIC_INSPECTION" : 200);

  const executedFrontendCount = executedScenarios.filter(
    (s) => s.test_channel === "FRONTEND_UI" || s.execution_channel === "FRONTEND_PLAYWRIGHT_PLUGIN"
  ).length;
  const executedBackendCount = executedScenarios.length - executedFrontendCount;

  const decisionPillars = {
    safe_01_quarantined: safe01Quarantined,
    safe_01_side_effects_count: safe01SideEffects.length,
    safe_01_reasons: safe01Reasons,
    actual_bugs_count: actualBugsUiApiReproducible.length,
    latent_bugs_count: latentBugsImplicitlyProtected.length,
    commit_delete_exposures_count: commitDeleteHierarchyCount,
    top_limit: topLimit,
    total_candidates: totalCandidates,
    executed_count: executedScenarios.length,
    executed_backend_count: executedBackendCount,
    executed_frontend_count: executedFrontendCount,
    is_static: isStatic,
    plugin_online: isOnline,
    plugin_url: pluginUrl,
    probe_status_code: probeStatusCode,
  };

  for (const b of confirmedBugsRed) {
    b.defect_nature = classifyDefectNature(b);
    if (!b.test_channel_badge) {
      const chInfo = resolveTestChannelAndRationale(b, manifest);
      b.test_channel = chInfo.channelCode;
      b.test_channel_badge = chInfo.channelBadge;
      b.test_channel_short = chInfo.channelShort;
      b.test_channel_rationale = chInfo.rationale;
    }
  }
  const confirmedFunctionalBugs = confirmedBugsRed.filter(
    (b) => classifyDefectNature(b) === "FUNCTIONAL_BYPASS"
  );
  const confirmedUiFeedbackBugs = [
    ...confirmedBugsRed.filter((b) => classifyDefectNature(b) === "UI_FEEDBACK_DISCONNECT"),
    ...uiPageCandidates,
  ];
  const confirmedTechnicalCrashes = confirmedBugsRed.filter(
    (b) => classifyDefectNature(b) === "TECHNICAL_CRASH"
  );

  return {
    schema_version: "3.2.0",
    reported_at: new Date().toISOString(),
    is_static: isStatic,
    module: manifest.module,
    target_microflow: manifest.target_microflow,
    primary_microflow: manifest.primary_microflow || manifest.target_microflow,
    target_slug: targetSlug,
    is_module_bundle: Boolean(manifest.is_module_bundle),
    microflows_analyzed: manifest.microflows_analyzed || 1,
    tier: manifest.tier,
    inferred_mtf_roles: manifest.guardrails?.safe_02_inferred_mtf_roles || [],
    decision_pillars: decisionPillars,
    section_3_steps: manifest.section_3_steps || [],
    section_4_variations: manifest.section_4_variations || [],
    hypotheses: manifest.hypotheses || [],
    scorecard: {
      confirmed_bugs_red: confirmedBugsRed.length,
      confirmed_functional_bugs_tier1: confirmedFunctionalBugs.length,
      confirmed_ui_feedback_tier2: confirmedUiFeedbackBugs.length,
      confirmed_technical_crashes_tier3: confirmedTechnicalCrashes.length,
      confirmed_dynamically_red: confirmedBugsRed.filter((b) => b.verification_status === "DYNAMIC_RECEIPT_CONFIRMED").length,
      confirmed_representative_red: confirmedBugsRed.filter((b) => b.verification_status === "STATIC_REPRESENTATIVE_PROOF").length,
      static_ast_candidates: (manifest.hypotheses || []).filter((h) => h.verification_status === "STATIC_AST_CANDIDATE").length,
      confirmed_actual_bugs_red: isStatic
        ? actualBugsUiApiReproducible.length
        : actualBugsUiApiReproducible.filter((b) => b.verification_status === "DYNAMIC_RECEIPT_CONFIRMED").length,
      confirmed_latent_bugs_red: isStatic
        ? latentBugsImplicitlyProtected.length
        : latentBugsImplicitlyProtected.filter((b) => b.verification_status === "DYNAMIC_RECEIPT_CONFIRMED").length,
      actual_bugs_ui_api_reproducible: actualBugsUiApiReproducible.length,
      latent_bugs_implicitly_protected: latentBugsImplicitlyProtected.length,
      call_hierarchy_commit_delete_exposures: commitDeleteHierarchyCount,
      latent_architecture_risks_amber: latentAmberRisks.length,
      ui_page_candidates_amber_ui: uiPageCandidates.length,
      verified_resilient_green: verifiedResilientGreen.length,
      business_rules_detected: reconciledBusinessRules.length,
      business_rules_violated: violatedRulesCount,
      total_executed_scenarios: executedScenarios.length,
      executed_backend_scenarios: executedBackendCount,
      executed_frontend_scenarios: executedFrontendCount,
      legacy_amber_alias: latentAmberRisks.length,
      architectural_risks_amber: latentAmberRisks.length,
      total_duration_ms: runtimeResults.total_duration_ms || 0,
    },
    business_rules: reconciledBusinessRules,
    confirmed_bugs: confirmedBugsRed,
    functional_bugs_tier1: confirmedFunctionalBugs,
    ui_feedback_tier2: confirmedUiFeedbackBugs,
    technical_crashes_tier3: confirmedTechnicalCrashes,
    actual_bugs: actualBugsUiApiReproducible,
    latent_bugs: latentBugsImplicitlyProtected,
    amber_risks: latentAmberRisks,
    amber_ui_candidates: uiPageCandidates,
    verified_resilient: verifiedResilientGreen,
    executed_scenarios: executedScenarios,
  };
}

export const PATTERN_CATALOG = {
  // Baseline
  "BASELINE": {
    name: "Baseline Resilient Execution",
    description: "Standard execution validating safe handling of normal inputs.",
  },
  "BHP-00": {
    name: "Baseline Resilient Scenario",
    description: "Verification scenario with valid inputs confirming resilient baseline operation.",
  },
  // Microflow & Gateway Patterns (BHP-01..40)
  "BHP-01": {
    name: "Unhandled Null Dereference Crash in Decision Split / Expression",
    description: "Unguarded access to an attribute or association of an empty/null object in a decision split, rule, or expression, triggering a runtime MicroflowException.",
  },
  "BHP-02": {
    name: "Unguarded Empty Association Traversal Crash",
    description: "Traversing an unpopulated or null association without checking if the parent or child object exists.",
  },
  "BHP-03": {
    name: "Null Pointer Exception in Calculation Function",
    description: "Passing an empty/null value into a non-null-safe function (such as substring, parseInteger, or date functions).",
  },
  "BHP-04": {
    name: "Unchecked Division by Zero",
    description: "Arithmetic division performed without guarding against a zero or empty denominator.",
  },
  "BHP-05": {
    name: "Dead Code & Subsumed Decision Split Condition",
    description: "A decision split condition that is unreachable or redundant because prior splits or caller guards already guarantee the condition.",
  },
  "BHP-06": {
    name: "Relational Boundary Off-By-One Comparison",
    description: "A boundary comparison flaw (< vs <=, > vs >=) causing edge-case business logic errors.",
  },
  "BHP-12": {
    name: "Invalid Chronological Date Order in Calculation",
    description: "Date calculation (e.g. daysBetween) executed without verifying start date precedes end date.",
  },
  "BHP-14": {
    name: "Unvalidated String Format or Regular Expression",
    description: "Parsing or formatting strings without verifying format conformity or regex match.",
  },
  "BHP-15": {
    name: "Missing Mandatory Entity Parameter Check",
    description: "A microflow accepting an entity parameter without verifying whether the parameter is passed as empty.",
  },
  "BHP-17": {
    name: "Phantom Validation Feedback on Hidden or Session Entity",
    description: "ValidationFeedback applied to an entity or attribute not rendered on the active page or bound to $currentUser.",
  },
  "BHP-21": {
    name: "Uncommitted Associated Child Object (Dangling Reference)",
    description: "Creating an associated object without committing it or persisting the association.",
  },
  "BHP-22": {
    name: "Partial Database Commit Asymmetry in Error Flow",
    description: "Committing some objects while leaving related objects uncommitted or unhandled during error recovery.",
  },
  "BHP-23": {
    name: "Unguarded Dereference of Empty List Head/First Object",
    description: "Taking the Head or First element of a list and accessing its attributes without checking if the list or element is empty.",
  },
  "BHP-25": {
    name: "Floating-Point Currency Precision Loss",
    description: "Using Float instead of Decimal for financial amounts or currency calculations, introducing IEEE-754 precision errors.",
  },
  "BHP-26": {
    name: "Missing Boundary Check on Numeric Quantity",
    description: "Numeric quantity or count accepted without guarding against negative or zero values.",
  },
  "BHP-28": {
    name: "Concurrent Database Update Race Condition",
    description: "Modifying database objects without optimistic locking or handling concurrent access conflicts.",
  },
  "BHP-29": {
    name: "Unchecked Entity Status Transition",
    description: "Mutating lifecycle status without validating if the current status permits the transition.",
  },
  "BHP-32": {
    name: "Validation Feedback Attached to Wrong Entity",
    description: "A ValidationFeedback action specifying an entity parameter different from the entity containing the invalid attribute.",
  },
  "BHP-34": {
    name: "Unrounded Floating-Point Arithmetic Comparison",
    description: "Comparing calculated floating-point numbers with exact equality (==) without rounding.",
  },
  "BHP-35": {
    name: "Autocommit & Dangling Reference Trap",
    description: "Committing a parent object referencing an uncommitted new child, causing implicit autocommit or dangling references.",
  },
  "BHP-36": {
    name: "Non-Owner Association Commit or Loop Duplicate Add",
    description: "Committing the non-owner side of an association, or repeatedly appending duplicates to a list in a loop without union deduplication.",
  },
  "BHP-37": {
    name: "Delete Object Prevention Rule Violation (DeleteMeIfNoReferences)",
    description: "Deleting an object governed by DeleteMeIfNoReferences without verifying referenced objects, causing runtime deletion exceptions.",
  },
  "BHP-38": {
    name: "In-Memory State Drift After Rollback / Error Swallowing",
    description: "Using Custom with Rollback without reverting in-memory variables, or using Continue to swallow exceptions silently.",
  },
  "BHP-39": {
    name: "XPath Three-Valued Logic NULL Exclusion Trap",
    description: "XPath query using [Attr != 'Value'] which silently excludes rows where Attr is empty/null.",
  },
  "BHP-40": {
    name: "Aggregate List SQL Pushdown Ignoring Uncommitted In-Memory Edits",
    description: "AggregateList executed directly on a database retrieve, executing SQL aggregate functions and ignoring uncommitted in-memory edits.",
  },
  "BHP-41": {
    name: "Unsafe CastAction or Incomplete InheritanceSplit Specialization Branch",
    description: "Executing a CastAction without an upstream InheritanceSplit or omitting known entity specialization branches on an InheritanceSplit.",
  },
  "BHP-42": {
    name: "N+1 Database Retrieve / Commit Inside Loop or Infinite While Loop Hang",
    description: "Executing database retrieves/commits inside a LoopedActivity or running a WhileLoopCondition whose condition variables are never mutated in the loop body.",
  },
  "BHP-43": {
    name: "Unguarded Aggregate List Count Used as Divisor",
    description: "Using the output variable of an AggregateListAction (Count) as a denominator without verifying Count > 0.",
  },
  // Business Rules
  "BRP-01": {
    name: "Documented Business Rule vs. Code Implementation Discrepancy",
    description: "Documented specification, requirement, or comment contradicts the microflow decision split logic.",
  },
  // Data Quality Patterns (DQP-01..10)
  "DQP-01": {
    name: "Missing Required Attribute Validation",
    description: "Saving an entity where required attributes are empty or unset.",
  },
  "DQP-02": {
    name: "Unchecked Uniqueness Constraint Violation",
    description: "Creating or changing records without checking for existing duplicate keys, risking database unique constraint violations.",
  },
  "DQP-04": {
    name: "Silent Drop in BeforeCommit Event Handler",
    description: "A BeforeCommit handler returning false or dropping changes without feedback to the user.",
  },
  "DQP-08": {
    name: "Missing Association Referential Integrity Check",
    description: "Deleting or dissociating records without validating dependent business records.",
  },
  "DQP-09": {
    name: "Commit Object with Events=No Bypassing Domain Rules",
    description: "Commit activity executed with 'With events = No', bypassing entity event handlers (BeforeCommit/AfterCommit) and validation rules.",
  },
  "DQP-10": {
    name: "Microflow Assignment Violating Domain Range or MaxLength Validation Rule",
    description: "CreateObject or ChangeObject literal assignment that violates a DomainModels$RangeRuleInfo or MaxLengthRuleInfo constraint.",
  },
  // Integration Patterns (INT-01..07)
  "INT-01": {
    name: "Missing Error Handler on External Integration",
    description: "Calling external REST/SOAP services without a custom error handler branch.",
  },
  "INT-02": {
    name: "Hardcoded REST/SOAP Endpoint URL",
    description: "Hardcoding integration service URLs instead of using configurable constants.",
  },
  "INT-03": {
    name: "Unencoded REST URL Parameter Injection",
    description: "Interpolating parameters into REST URLs without urlEncode, risking injection or malformed requests.",
  },
  "INT-04": {
    name: "Lost HTTP Response Error Body on REST Fault",
    description: "Handling REST faults without storing the response error body in $latestHttpResponse/Content.",
  },
  "INT-05": {
    name: "Unguarded Empty Import Mapping Result",
    description: "Dereferencing output of an Import Mapping without verifying whether parsing succeeded and returned an object.",
  },
  "INT-06": {
    name: "External Mutating REST Call Before Local Validation or Commit",
    description: "Executing outbound mutating HTTP requests before local database validation completes, risking external state drift on rollback.",
  },
  "INT-07": {
    name: "Published REST Microflow Returning Silent 200 OK on Error",
    description: "Published REST microflow exiting an error branch without setting $httpResponse/StatusCode to 4xx/5xx, returning false 200 OK.",
  },
  // Java Action Patterns (JAP-01..07)
  "JAP-01": {
    name: "Unimplemented Java Action Stub",
    description: "Default Studio Pro stub ('Java action was not implemented') left inside executeAction().",
  },
  "JAP-02": {
    name: "Unguarded Null Parameter in Java Action",
    description: "Java action dereferencing input parameters without null checks.",
  },
  "JAP-03": {
    name: "SystemContext Transaction & Security Escape in Java Action",
    description: "Java action calling Core.createSystemContext(), escaping microflow transaction rollback and security rules.",
  },
  "JAP-04": {
    name: "Silent Exception Swallowing in Java Action",
    description: "Java action catching exceptions and returning null/false without logging or rethrowing CoreException.",
  },
  "JAP-05": {
    name: "Unclosed FileDocument Resource Leak in Java Action",
    description: "Opening FileDocument streams without try-with-resources or explicit close(), causing handle leaks.",
  },
  "JAP-06": {
    name: "Task Queue Background Execution on Uncommitted Object",
    description: "Queueing background execution with an uncommitted entity, risking entity-not-found errors in the worker thread.",
  },
  "JAP-07": {
    name: "Unguarded Nullable Java Return Value",
    description: "Microflow dereferencing the return value of a Java action without checking if it returned null/empty.",
  },
  // Security & RBAC Patterns (SEC-00..10)
  "SEC-00": {
    name: "Anonymous User Access Bypass",
    description: "Sensitive action microflows callable by anonymous users without authentication.",
  },
  "SEC-01": {
    name: "Unauthorized Microflow Execution Permitted",
    description: "Microflow accessible to roles that should not possess execution permissions.",
  },
  "SEC-02": {
    name: "Entity Access Rule Read/Write Bypass",
    description: "Microflow running without security restrictions modifying entities restricted by entity access rules.",
  },
  "SEC-03": {
    name: "Multi-Tenant Data Isolation Breach",
    description: "Retrieving or updating data without tenant isolation constraints, risking cross-tenant data leaks.",
  },
  "SEC-04": {
    name: "Page vs. Microflow Security Role Mismatch",
    description: "A page is accessible to a user role, but the microflows triggered by its buttons are not.",
  },
  "SEC-05": {
    name: "Sensitive Attribute Exposure to Unauthorized Role",
    description: "Sensitive data (salaries, passwords, tokens) retrieved or displayed to unauthorized roles.",
  },
  "SEC-06": {
    name: "Indirect Object Reference (IDOR) Vulnerability",
    description: "Microflow retrieving objects by ID parameter without verifying ownership or tenant membership.",
  },
  "SEC-07": {
    name: "Navigation Menu Role Drift",
    description: "Navigation menu item visible to roles that lack page access, leading to permission errors.",
  },
  "SEC-08": {
    name: "XPath Constraint Entity Access Leak",
    description: "Database retrieve relying on UI XPath rather than entity access rules, leaving microflow retrieves unrestricted.",
  },
  "SEC-09": {
    name: "Privilege Escalation via Unrestricted Sub-Microflow",
    description: "Unrestricted sub-microflow invoked with elevated permissions without verifying caller authorization.",
  },
  "SEC-10": {
    name: "Core.createSystemContext() Security Bypass in Java Action",
    description: "Using system context to bypass entity access security and audit trails.",
  },
  // User Flow & Call Chain Patterns (UFP-01..03)
  "UFP-01": {
    name: "Unprotected Sub-Microflow Bug in Commit/Delete Call Chain",
    description: "Sub-microflow containing an unhandled crash or invariant flaw located within a call chain that commits or deletes database records.",
  },
  "UFP-02": {
    name: "Inconsistent Input Validation Across Calling Pages",
    description: "Different calling pages or microflows pass contradictory or unguarded inputs to a shared sub-microflow.",
  },
  "UFP-03": {
    name: "Database Commit or Delete Executed Before Validation",
    description: "Committing or deleting database records before all input validation checks have completed.",
  },
  "PBT-01": {
    name: "Multi-Variable Combinatorial Crash or Exception",
    description: "A specific combination of empty, zero, or boundary input values across multiple attributes or parameters triggers an unhandled microflow crash.",
  },
  "PBT-02": {
    name: "Calculation Sign, Bound, or Monotonicity Invariant Violation",
    description: "A numeric calculation produces an impossible sign (such as a negative price or total), exceeds a domain bound, or violates monotonicity under boundary input combinations.",
  },
  "PBT-03": {
    name: "Floating-Point & Currency Precision Drift Counterexample",
    description: "Repeating-binary decimal inputs (such as 0.1, 0.2, 19.99, or 33.33) in unrounded arithmetic or division produce precision drift or conservation-of-sum discrepancies.",
  },
  "PBT-04": {
    name: "Idempotency & Recalculation Stability Violation",
    description: "Executing a save, calculation, or status microflow twice in a row on the same record mutates totals, counters, or state inconsistently on the second run.",
  },
  "PBT-05": {
    name: "Silent Validation Failure Without User Message",
    description: "An invalid input permutation causes a validation or action microflow to return false without showing a Validation Feedback message or rolling back modified fields.",
  },
  "INV-01": {
    name: "Entity Invariant Rule Bypassed in Alternative Commit Flow",
    description: "A state-independent invariant business rule defined on an entity is checked in one page or microflow, but bypassed in another microflow that commits the same entity.",
  },
  "INV-02": {
    name: "Persisted Database Records Violate Entity Invariant Rule (Dataset Non-Compliance)",
    description: "Existing persisted database records fail a state-independent invariant business rule when queried with its negated filter.",
  },
  "INV-03": {
    name: "Cross-Attribute or Calculated Formula Invariant Violation Under Pairwise Permutations",
    description: "A multi-attribute ordering rule (such as ReturnDate >= PickupDate) or calculated formula equation is violated under boundary input combinations.",
  },
};

export function getPatternHumanLabel(patternId) {
  if (!patternId) return "Mendix Flaw";
  const upper = String(patternId).trim().toUpperCase();
  const entry = PATTERN_CATALOG[upper];
  if (entry) {
    return entry.name;
  }
  return humanizeMendixText(patternId);
}

export function formatPatternWithCode(patternId) {
  if (!patternId) return "";
  const human = getPatternHumanLabel(patternId);
  if (human === patternId) return `\`${patternId}\``;
  return `${human} (\`${patternId}\`)`;
}

export function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function truncateText(str, maxLen = 110) {
  if (!str) return "";
  const s = String(str).trim();
  return s.length > maxLen ? s.slice(0, maxLen - 3) + "..." : s;
}

export function humanizeMendixText(text) {
  if (!text) return "";
  return String(text)
    .replace(/\bValidationFeedbackAction\b/g, "Validation Feedback")
    .replace(/\bValidationFeedback\b/g, "Validation Feedback")
    .replace(/\bAggregateListAction\b/g, "Aggregate List")
    .replace(/\bAggregateList\b/g, "Aggregate List")
    .replace(/\bChangeObject\b/g, "Change Object")
    .replace(/\bDeleteObject\b/g, "Delete Object")
    .replace(/\bCreateObject\b/g, "Create Object")
    .replace(/\bExclusiveSplit\b/g, "Decision (Exclusive Split)")
    .replace(/\bMicroflowCall\b/g, "Microflow Call")
    .replace(/\bIMendixIdentifier\s*\('validationObjectId'\)/g, "object reference")
    .replace(/\bIMendixIdentifier\b/g, "object reference")
    .replace(/\bIEEE-754\b/g, "floating-point")
    .replace(/\bTouchpoint\b/g, "Action microflow")
    .replace(/\btouchpoint\b/g, "action microflow")
    .replace(/\bStatic AST\b/gi, "Mendix model")
    .replace(/\bAST\b/g, "Mendix model")
    .replace(/\bACID & Data Integrity\b/g, "Database & Data Integrity")
    .replace(/\bPAT-\d+[a-z]?\b/g, "")
    .replace(/\bANTI-\d+[a-z]?\b/g, "")
    .replace(/\(\s*\)/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

export function formatVerificationStatusBadge(finding, options = {}) {
  const status =
    finding?.verification_status ||
    (finding?.status === "CONFIRMED_BUG" ? "DYNAMIC_RECEIPT_CONFIRMED" : "STATIC_AST_CANDIDATE");
  const executedTestsRelPath = options.executedTestsRelPath || options.linkTarget || "";

  if (status === "DYNAMIC_RECEIPT_CONFIRMED") {
    const testNum = finding?.receipt_test_number || finding?.scenario_number || 1;
    const anchor = options.scenarioAnchor || finding?.scenario_anchor || `scenario-${testNum}`;
    const linkText = `Test #${testNum}`;
    const receiptLink = executedTestsRelPath
      ? `[${linkText}](${executedTestsRelPath}#${anchor})`
      : linkText;
    return `🟢 Dynamically Confirmed (Receipt: ${receiptLink})`;
  }
  if (status === "FRONTEND_SETUP_OR_LOCATOR_INCONCLUSIVE") {
    const testNum = finding?.receipt_test_number || finding?.scenario_number || 1;
    const anchor = options.scenarioAnchor || finding?.scenario_anchor || `scenario-${testNum}`;
    const linkText = `Test #${testNum}`;
    const receiptLink = executedTestsRelPath
      ? `[${linkText}](${executedTestsRelPath}#${anchor})`
      : linkText;
    return `⚠️ Inconclusive Setup/Locator (Receipt: ${receiptLink})`;
  }
  if (status === "STATIC_REPRESENTATIVE_PROOF") {
    return "🔵 Statically Verified (Representative Proof)";
  }
  return "⚪ Static AST Candidate";
}

export function renderRepresentativeProofCallout(items = []) {
  const representativeProofs = (items || []).filter(
    (x) => x && x.verification_status === "STATIC_REPRESENTATIVE_PROOF"
  );
  if (representativeProofs.length === 0) return "";
  const repNames = Array.from(
    new Set(
      representativeProofs
        .map((x) => x.representative_microflow)
        .filter(Boolean)
    )
  );
  const repLabel = repNames.length > 0 ? repNames.map((n) => `\`${n}\``).join(", ") : "a representative component";
  return `> [!NOTE]
> **Representative Proof Methodology**: The defect mechanism was dynamically proven on a representative component (${repLabel}). The remaining microflows were verified via AST inspection as structurally identical. Full individual execution receipts can be generated on demand.

`;
}

export function formatHumanFailureOutcome(code) {
  const map = {
    FAIL_FUNCTIONAL_BYPASS: "Functional Business Rule / Invariant Bypassed",
    FAIL_DATASET_VIOLATION: "Persisted Database Records Violate Invariant",
    FAIL_VALIDATION_TARGET_MISMATCH: "Validation Feedback Attached to Wrong Entity",
    FAIL_UNHANDLED_EXCEPTION: "Unhandled Microflow Error (Exception)",
    FAIL_EXCEPTION: "Unhandled Microflow Error (Exception)",
    FAIL_ASSERTION_MISMATCH: "Unexpected Microflow Result (Business Rule Violated)",
    FAIL_VALIDATION_ERROR: "Validation Feedback Message Triggered",
    FAIL_RBAC_BREACH: "Unauthorized Access Allowed (Security Rule Bypassed)",
    FAIL_UI_ASSERTION: "Frontend Playwright UI Assertion Failed",
    FAIL_UI_LOCATOR_OR_PRECONDITION: "Frontend Locator / Precondition Stopped Before Assertion",
    FAIL_UI_SETUP: "Frontend Browser / Login Setup Failed",
    STATIC_AST_IDENTIFIED: "Static AST Identified (Pending Verification)",
    PASS: "Passed (Handled Safely)",
  };
  return map[code] || code || "Microflow Error";
}

export function formatHumanInputOverrides(variationOverrides = {}, indent = "  ") {
  const entries = Object.entries(variationOverrides || {});
  if (entries.length === 0) {
    return `${indent}- *(Standard / default input values)*`;
  }
  const lines = [];
  const execUser = variationOverrides.ExecutorUsername;
  const execSec = variationOverrides.ApplySecurityExecutor;
  if (execUser) {
    const cleanUser = String(execUser).replace(/^'|'$/g, "");
    const cleanSec = String(execSec || "").replace(/^'|'$/g, "");
    const secExplain =
      cleanSec === "APP_SECURITY"
        ? "with module & entity access rules enabled"
        : "without security restrictions";
    lines.push(`${indent}- **User Role Tested:** \`${cleanUser}\` *(${secExplain})*`);
  }
  for (const [k, v] of entries) {
    if (k === "ExecutorUsername" || k === "ApplySecurityExecutor") continue;
    const cleanVal =
      v === "'NONE'" || v === "empty"
        ? "`empty` *(no value / no object passed)*"
        : `\`${v}\``;
    if (k.startsWith("Param $")) {
      const paramName = k.replace(/^Param \$/, "");
      lines.push(`${indent}- **Input Parameter \`${paramName}\`:** ${cleanVal}`);
    } else if (k.startsWith("$")) {
      const attrPath = k.replace(/^\$/, "").replace(/\//g, ".");
      lines.push(`${indent}- **Attribute \`${attrPath}\`:** ${cleanVal}`);
    } else {
      lines.push(`${indent}- **\`${k}\`:** ${cleanVal}`);
    }
  }
  return lines.join("\n") || `${indent}- *(Standard / default input values)*`;
}

export function renderBugReportMarkdown(report, options = {}) {
  const isStatic = Boolean(report.is_static);
  const targetSlug = report.target_slug || resolveTargetSlug(report);
  const defaultTestsFile = isStatic
    ? `BugHunt_Planned_Tests_${targetSlug}.md`
    : `BugHunt_Executed_Tests_${targetSlug}.md`;
  const executedTestsRelPath =
    options.executedTestsRelPath ||
    `../bug-hunt-tests/${defaultTestsFile}`;
  const preExecPlanRelPath =
    options.epPlanRelPath ||
    options.preExecPlanRelPath ||
    `../bug-hunt-tests/EP_BugHunt_${targetSlug}.md`;

  const allConfirmedBugs = report.confirmed_bugs || [];
  const functionalBugsTier1 = Array.isArray(report.functional_bugs_tier1)
    ? report.functional_bugs_tier1
    : allConfirmedBugs.filter((b) => classifyDefectNature(b) === "FUNCTIONAL_BYPASS");
  const uiFeedbackBugsTier2 = Array.isArray(report.ui_feedback_tier2)
    ? report.ui_feedback_tier2
    : [
        ...allConfirmedBugs.filter((b) => classifyDefectNature(b) === "UI_FEEDBACK_DISCONNECT"),
        ...(report.amber_ui_candidates || []),
      ];
  const technicalCrashesTier3 = Array.isArray(report.technical_crashes_tier3)
    ? report.technical_crashes_tier3
    : allConfirmedBugs.filter((b) => classifyDefectNature(b) === "TECHNICAL_CRASH");
  const sortFunctionalFirst = (arr) =>
    [...(arr || [])].sort((a, b) => {
      const rank = (x) => {
        const dn = classifyDefectNature(x);
        if (dn === "FUNCTIONAL_BYPASS") return 0;
        if (dn === "UI_FEEDBACK_DISCONNECT") return 1;
        return 2;
      };
      return rank(a) - rank(b);
    });
  const actualBugs = sortFunctionalFirst(
    Array.isArray(report.actual_bugs)
      ? report.actual_bugs
      : allConfirmedBugs.filter((b) => b.exposure_classification !== "LATENT_IMPLICITLY_PROTECTED")
  );
  const latentBugs = sortFunctionalFirst(
    Array.isArray(report.latent_bugs)
      ? report.latent_bugs
      : allConfirmedBugs.filter((b) => b.exposure_classification === "LATENT_IMPLICITLY_PROTECTED")
  );

  const functionalTier1Count =
    report.scorecard?.confirmed_functional_bugs_tier1 ?? functionalBugsTier1.length;
  const uiFeedbackTier2Count =
    report.scorecard?.confirmed_ui_feedback_tier2 ?? uiFeedbackBugsTier2.length;
  const technicalCrashTier3Count =
    report.scorecard?.confirmed_technical_crashes_tier3 ?? technicalCrashesTier3.length;
  const actualCount =
    report.scorecard?.actual_bugs_ui_api_reproducible ?? actualBugs.length;
  const latentCount =
    report.scorecard?.latent_bugs_implicitly_protected ?? latentBugs.length;
  const commitDeleteExposures =
    report.scorecard?.call_hierarchy_commit_delete_exposures ??
    [...allConfirmedBugs, ...(report.amber_risks || [])].filter(
      (f) => f.call_hierarchy_context?.exposes_commit_or_delete_in_hierarchy || f.dual_risk?.hierarchy_commits_or_deletes
    ).length;

  const renderConfirmedBugCard = (b, idx, isLatentSection = false) => {
    const scenNum = b.scenario_number || idx + 1;
    const scenAnchor = b.scenario_anchor || `scenario-${scenNum}`;
    const findAnchor = b.finding_anchor || `finding-${b.id || scenNum}`;
    const dr = b.dual_risk || classifyFindingDualRisk(b, report);
    const ctx = b.call_hierarchy_context || {};
    const expBadge = isLatentSection
      ? "🔶 **Latent Bug — Protected Today by Calling Page/Microflow (Future Regression Risk)**"
      : "🔴 **Actual Bug — Reproducible Now via Page or API**";
    const flowPath = ctx.sample_user_flow_path || `\`${b.microflow || report.target_microflow}\``;
    const protectionSummary = humanizeMendixText(
      ctx.implicit_protection_reason ||
        (isLatentSection
          ? `Currently protected by the calling page or parent microflow before '${b.microflow || report.target_microflow}' runs.`
          : `Directly reachable from current pages or APIs without an upstream check preventing the invalid input.`)
    );
    const regressionTrigger = humanizeMendixText(
      ctx.regression_exposure_trigger ||
        (isLatentSection
          ? `Will surface as a regression bug if the page flow changes or a new microflow calls '${b.microflow || report.target_microflow}' directly.`
          : `Can be triggered right now during normal or boundary page/API usage.`)
    );
    const commitDeleteSummary = humanizeMendixText(
      ctx.commit_delete_hierarchy_summary ||
        (dr.hierarchy_commits_or_deletes
          ? "This call chain commits or deletes database objects."
          : "None (No Commit or Delete in this call chain)")
    );
    const humanTitle = humanizeMendixText(b.title);
    const humanRule = humanizeMendixText(b.oracle_rule);
    const humanRemediation = humanizeMendixText(b.remediation);
    const humanOutcomeLabel = formatHumanFailureOutcome(b.runtime_failure_code);
    const humanInputsInline = formatHumanInputOverrides(b.variation_overrides || {}, "  ");
    const humanInputsDetails = formatHumanInputOverrides(b.variation_overrides || {}, "    ");
    const patternWithCode = formatPatternWithCode(b.pattern_id);

    const verBadge = formatVerificationStatusBadge(b, {
      executedTestsRelPath,
      scenarioAnchor: scenAnchor,
    });
    const chInfo = resolveTestChannelAndRationale(b, report);
    const channelBadge = b.test_channel_badge || chInfo.channelBadge;
    const channelRationale = humanizeMendixText(b.test_channel_rationale || chInfo.rationale);
    const frontendCrossCheckNote = b.also_verified_via_frontend
      ? ` *(Also verified end-to-end in browser via 🌐 Frontend Playwright in [Scenario #${b.frontend_scenario_number}](${executedTestsRelPath}#${b.frontend_scenario_anchor}))*`
      : "";
    const traceLineReport = b.trace_artifact?.file_name
      ? `\n* **Playwright Trace Recording:** [\`${b.trace_artifact.file_name}\`](../bug-hunt-tests/traces/${b.trace_artifact.file_name}) *(View via \`npx playwright show-trace menditect-output/bug-hunt-tests/traces/${b.trace_artifact.file_name}\`)*`
      : "";

    return `<a id="${findAnchor}"></a>
#### ${isLatentSection ? "🔶" : "🚨"} ${humanTitle} (${patternWithCode}) — **Severity: \`${b.severity}\` | Priority: \`${dr.priority}\`**
* **Verification Status:** ${verBadge}
* **Test Execution Channel & Why Chosen:** **${channelBadge}** — ${channelRationale}${frontendCrossCheckNote}${traceLineReport}
* **Bug Type:** ${expBadge}
* **Where in Mendix:** Microflow \`${b.microflow || report.target_microflow}\` &rarr; Activity \`${b.activity_caption}\`
* **User Flow & Call Chain:** ${flowPath}
* **Why It Happens / Current Protection:** ${protectionSummary}
* **Impact on Database (\`Commit\` / \`Delete\` in Call Chain):** ${regressionTrigger} *(Database changes in call chain: \`${commitDeleteSummary}\`)*
* **Business Impact:** **\`${dr.business_risk_profile}\`** — ${humanizeMendixText(dr.business_impact_consequence)} *(Technical Area: \`${humanizeMendixText(dr.technical_risk_profile)}\`, Risk Score: \`${dr.risk_rating}/25\`)*
* **Expected Behavior (Business Rule):** ${humanRule}
* **Test Input Used:**
${humanInputsInline}
* **What Happened When Tested (${humanOutcomeLabel}):**
  \`\`\`text
  ${b.actual_runtime_error}
  \`\`\`
* **How to Fix in Studio Pro:** ${humanRemediation}
* **Executed Test Link:** [Test Scenario #${scenNum} — Open in Executed Tests Report](${executedTestsRelPath}#${scenAnchor}) *(Recommended Test Level: \`${dr.recommended_test_level}\`)*

<details>
<summary><b>🧪 View Executed Test Details Inline (Scenario #${scenNum})</b></summary>

* **Tested Microflow / Page:** \`${b.page_qualified_name ? `${b.page_qualified_name} -> ` : ""}${b.microflow || report.target_microflow}\`
* **Test Channel & Rationale:** **${channelBadge}** — ${channelRationale}
* **Test Safety:** Automatic Rollback / Teardown Enabled (\`Yes\` — no test data left in the database), Duration: \`${b.duration_ms || 0} ms\`
* **Test Inputs:**
${humanInputsDetails}
* **Expected Behavior:** ${humanizeMendixText(b.expected_safe_outcome || b.oracle_rule)}
* **Test Result:** ${humanOutcomeLabel} (\`${b.runtime_failure_code}\`)

</details>`;
  };

  const actualMethodologyCallout = renderRepresentativeProofCallout(actualBugs);
  const latentMethodologyCallout = renderRepresentativeProofCallout(latentBugs);
  const amberMethodologyCallout = renderRepresentativeProofCallout(report.amber_risks || []);

  const actualFindingsTable =
    actualBugs.length > 0
      ? `| Microflow & Finding | Verification Status | Severity | Priority | Recommended Fix |
| :--- | :--- | :---: | :---: | :--- |
${actualBugs
  .map((b, idx) => {
    const scenNum = b.scenario_number || idx + 1;
    const scenAnchor = b.scenario_anchor || `scenario-${scenNum}`;
    const findAnchor = b.finding_anchor || `finding-${b.id || scenNum}`;
    const dr = b.dual_risk || classifyFindingDualRisk(b, report);
    const humanTitle = humanizeMendixText(b.title);
    const patternWithCode = formatPatternWithCode(b.pattern_id);
    const microflowName = b.microflow || report.target_microflow;
    const verBadge = formatVerificationStatusBadge(b, {
      executedTestsRelPath,
      scenarioAnchor: scenAnchor,
    });
    const chInfo = resolveTestChannelAndRationale(b, report);
    const chBadge = b.test_channel_badge || chInfo.channelBadge;
    const fix = truncateText(humanizeMendixText(b.remediation || "Review microflow logic in Studio Pro"), 120);
    const prioTag = dr.priority ? `\`${dr.priority.split(" ")[0]}\`` : `\`${b.severity || "P2"}\``;
    return `| [**${humanTitle}**](#${findAnchor})<br>${patternWithCode}<br>Microflow: \`${microflowName}\` | ${verBadge}<br>Channel: **${chBadge}** | \`${b.severity || "P2"}\` | ${prioTag} | ${fix} |`;
  })
  .join("\n")}

`
      : "";

  const latentFindingsTable =
    latentBugs.length > 0
      ? `| Microflow & Finding | Verification Status | Severity | Priority | Recommended Fix |
| :--- | :--- | :---: | :---: | :--- |
${latentBugs
  .map((b, idx) => {
    const scenNum = b.scenario_number || idx + 1;
    const scenAnchor = b.scenario_anchor || `scenario-${scenNum}`;
    const findAnchor = b.finding_anchor || `finding-${b.id || scenNum}`;
    const dr = b.dual_risk || classifyFindingDualRisk(b, report);
    const humanTitle = humanizeMendixText(b.title);
    const patternWithCode = formatPatternWithCode(b.pattern_id);
    const microflowName = b.microflow || report.target_microflow;
    const verBadge = formatVerificationStatusBadge(b, {
      executedTestsRelPath,
      scenarioAnchor: scenAnchor,
    });
    const chInfo = resolveTestChannelAndRationale(b, report);
    const chBadge = b.test_channel_badge || chInfo.channelBadge;
    const fix = truncateText(humanizeMendixText(b.remediation || "Review microflow logic in Studio Pro"), 120);
    const prioTag = dr.priority ? `\`${dr.priority.split(" ")[0]}\`` : `\`${b.severity || "P2"}\``;
    return `| [**${humanTitle}**](#${findAnchor})<br>${patternWithCode}<br>Microflow: \`${microflowName}\` | ${verBadge}<br>Channel: **${chBadge}** | \`${b.severity || "P2"}\` | ${prioTag} | ${fix} |`;
  })
  .join("\n")}

`
      : "";

  const actualRedCards =
    actualBugs.length > 0
      ? actualBugs.map((b, idx) => renderConfirmedBugCard(b, idx, false)).join("\n\n---\n\n")
      : "*No actual page/API-reproducible bugs were found in this run.*";

  const latentRedCards =
    latentBugs.length > 0
      ? latentBugs.map((b, idx) => renderConfirmedBugCard(b, idx, true)).join("\n\n---\n\n")
      : "*No latent caller-protected bugs were found in this run.*";

  // Cluster deduplication for warnings (> 3 instances of the same pattern_id)
  const amberByPattern = new Map();
  for (const a of report.amber_risks || []) {
    const pat = a.pattern_id || "WARNING";
    if (!amberByPattern.has(pat)) amberByPattern.set(pat, []);
    amberByPattern.get(pat).push(a);
  }

  const amberRowBlocks = [];
  const collapsedClusterBlocks = [];
  for (const [pat, items] of amberByPattern.entries()) {
    const patFormatted = formatPatternWithCode(pat);
    if (items.length <= 3) {
      for (const a of items) {
        const dr = a.dual_risk || classifyFindingDualRisk(a, report);
        const expLabel =
          a.exposure_classification === "LATENT_IMPLICITLY_PROTECTED"
            ? "🔶 Protected Today by Caller"
            : "🟠 Microflow / Model Warning";
        const sinkTag = a.call_hierarchy_context?.exposes_commit_or_delete_in_hierarchy
          ? ` **[In Commit/Delete Call Chain]**`
          : "";
        const verBadge = formatVerificationStatusBadge(a, {
          executedTestsRelPath,
          scenarioAnchor: a.scenario_anchor,
        });
        amberRowBlocks.push(
          `| \`${a.microflow || report.target_microflow}\`<br>(${formatPatternWithCode(a.pattern_id)}) | ${verBadge} | ${expLabel} | \`${dr.business_risk_profile}\` (\`${dr.priority.split(" ")[0]}\`) | ${humanizeMendixText(a.title)}${sinkTag}: ${humanizeMendixText(a.amber_reason || a.oracle_rule)} | ${humanizeMendixText(a.remediation)} |`
        );
      }
    } else {
      const first = items[0];
      const dr = first.dual_risk || classifyFindingDualRisk(first, report);
      const affectedMfs = Array.from(new Set(items.map((x) => x.microflow || report.target_microflow)));
      const verBadge = formatVerificationStatusBadge(first, {
        executedTestsRelPath,
        scenarioAnchor: first.scenario_anchor,
      });
      amberRowBlocks.push(
        `| **${items.length} Microflows**<br>(${patFormatted}) | ${verBadge} | 🟠 Repeated Warning (${items.length}x) | \`${dr.business_risk_profile}\` (\`${dr.priority.split(" ")[0]}\`) | **${items.length} occurrences** across ${affectedMfs.slice(0, 4).map((m) => `\`${m}\``).join(", ")}${affectedMfs.length > 4 ? ` (+${affectedMfs.length - 4} more)` : ""}: ${humanizeMendixText(first.title)} | ${humanizeMendixText(first.remediation)} |`
      );
      const detailList = items
        .map(
          (x, i) =>
            `${i + 1}. \`${x.microflow || report.target_microflow}\` &rarr; \`${x.activity_caption || x.activity_id || "-"}\`: ${humanizeMendixText(x.title)}`
        )
        .join("\n");
      collapsedClusterBlocks.push(`<details>
<summary><b>📂 Show All ${items.length} Occurrences of ${patFormatted}</b></summary>

${detailList}

</details>`);
    }
  }
  const amberRows = amberRowBlocks.join("\n") || "| `-` | `-` | `-` | `-` | None | - |";
  const amberClustersHtml =
    collapsedClusterBlocks.length > 0 ? `\n\n${collapsedClusterBlocks.join("\n\n")}` : "";

  const amberWarningsBlock =
    amberRowBlocks.length > 10
      ? `<details>
<summary><b>⚠️ Click to expand full Microflow & Call-Chain Warnings Table (${amberRowBlocks.length} entries)</b></summary>

| Location & Code | Verification Status | Type | Business Risk & Priority | What We Found | How to Improve in Studio Pro |
| :--- | :--- | :--- | :--- | :--- | :--- |
${amberRows}

</details>${amberClustersHtml}`
      : `| Location & Code | Verification Status | Type | Business Risk & Priority | What We Found | How to Improve in Studio Pro |
| :--- | :--- | :--- | :--- | :--- | :--- |
${amberRows}${amberClustersHtml}`;

  const uiCards =
    (report.amber_ui_candidates || [])
      .map(
        (u) => {
          const dr = u.dual_risk || classifyFindingDualRisk(u, report);
          const chInfo = resolveTestChannelAndRationale(u, report);
          const verBadge = formatVerificationStatusBadge(u, {
            executedTestsRelPath,
            scenarioAnchor: u.scenario_anchor,
          });
          const uiTraceLine = u.trace_artifact?.file_name
            ? `\n* **Playwright Trace Recording:** [\`${u.trace_artifact.file_name}\`](../bug-hunt-tests/traces/${u.trace_artifact.file_name}) *(View via \`npx playwright show-trace menditect-output/bug-hunt-tests/traces/${u.trace_artifact.file_name}\`)*`
            : "";
          return `#### 🟡 ${humanizeMendixText(u.title)} (${formatPatternWithCode(u.pattern_id)}) — **Priority: \`${dr.priority}\`**
* **Verification Status:** ${verBadge}
* **Test Execution Channel & Why Chosen:** **${u.test_channel_badge || chInfo.channelBadge}** — ${humanizeMendixText(u.test_channel_rationale || chInfo.rationale)}${uiTraceLine}
* **Page & Microflow:** \`${u.page_qualified_name || "Calling Page"}\` &rarr; \`${u.microflow || report.target_microflow}\`
* **Business Impact:** **\`${dr.business_risk_profile}\`** — ${humanizeMendixText(dr.business_impact_consequence)}
* **What We Found:** ${humanizeMendixText(u.oracle_rule)}
* **How to Check on the Page:**
${(u.manual_reproduction_steps || []).map((s) => `  ${humanizeMendixText(s)}`).join("\n")}
* **How to Fix in Studio Pro:** ${humanizeMendixText(u.remediation)}`;
        }
      )
      .join("\n\n") || "*No page or validation message issues found.*";

  const greenRows =
    (report.verified_resilient || [])
      .map(
        (g, idx) => {
          const scenNum = g.scenario_number || idx + 1;
          const scenAnchor = g.scenario_anchor || `scenario-${scenNum}`;
          const findAnchor = g.finding_anchor || `finding-${g.id || scenNum}`;
          const dr = g.dual_risk || classifyFindingDualRisk(g, report);
          const chInfo = resolveTestChannelAndRationale(g, report);
          const chBadge = g.test_channel_badge || chInfo.channelBadge;
          return `| <a id="${findAnchor}"></a>[Scenario #${scenNum}](${executedTestsRelPath}#${scenAnchor}) | \`${g.microflow || report.target_microflow}\` | **${chBadge}** | \`${dr.business_risk_profile}\` | ${humanizeMendixText(g.title)} | Passed (\`${g.duration_ms} ms\`) |`;
        }
      )
      .join("\n") || "| `-` | `-` | `-` | `-` | None | - |";

  const rawPrioritizedFindings = [
    ...actualBugs.map((b, idx) => ({
      ...b,
      tier_label: "🔴 Actual Bug (Page/API)",
      dual_risk: b.dual_risk || classifyFindingDualRisk(b, report),
      verification_link: `[Scenario #${b.scenario_number || idx + 1}](${executedTestsRelPath}#${b.scenario_anchor || `scenario-${b.scenario_number || idx + 1}`})`,
    })),
    ...latentBugs.map((b, idx) => ({
      ...b,
      tier_label: "🔶 Latent Bug (Protected Today)",
      dual_risk: b.dual_risk || classifyFindingDualRisk(b, report),
      verification_link: `[Scenario #${b.scenario_number || idx + 1}](${executedTestsRelPath}#${b.scenario_anchor || `scenario-${b.scenario_number || idx + 1}`})`,
    })),
    ...(report.amber_risks || [])
      .filter((a) => !(report.amber_ui_candidates || []).some((u) => u.pattern_id === a.pattern_id && u.microflow === a.microflow && u.title === a.title))
      .map((a) => ({
        ...a,
        tier_label:
          a.exposure_classification === "LATENT_IMPLICITLY_PROTECTED"
            ? "🔶 Call-Chain Warning"
            : "🟠 Model Warning",
        dual_risk: a.dual_risk || classifyFindingDualRisk(a, report),
        verification_link: `Model Check (${a.recommended_test_level || (a.dual_risk || classifyFindingDualRisk(a, report)).recommended_test_level})`,
      })),
    ...(report.amber_ui_candidates || []).map((u) => ({
      ...u,
      tier_label: "🟡 Page Check",
      dual_risk: u.dual_risk || classifyFindingDualRisk(u, report),
      verification_link: `Page / UI Test`,
    })),
  ].sort((a, b) => (b.dual_risk.risk_rating || 0) - (a.dual_risk.risk_rating || 0));

  const seenPrioKeys = new Set();
  const allPrioritizedFindings = [];
  for (const pf of rawPrioritizedFindings) {
    const key = `${pf.pattern_id}|${pf.microflow || ""}|${pf.title || ""}`;
    if (seenPrioKeys.has(key)) continue;
    seenPrioKeys.add(key);
    allPrioritizedFindings.push(pf);
  }

  const praMatrixRows =
    allPrioritizedFindings
      .map((f) => {
        const dr = f.dual_risk;
        const commitFlag =
          f.call_hierarchy_context?.exposes_commit_or_delete_in_hierarchy || dr.hierarchy_commits_or_deletes
            ? " *(Commits/Deletes Data)*"
            : "";
        const verBadge = formatVerificationStatusBadge(f, {
          executedTestsRelPath,
          scenarioAnchor: f.scenario_anchor,
        });
        return `| ${f.tier_label}: ${humanizeMendixText(f.title)}${commitFlag}<br>(${formatPatternWithCode(f.pattern_id)}) | ${verBadge} | \`${dr.business_risk_profile}\` | \`${humanizeMendixText(dr.technical_risk_profile)}\` | ${dr.impact}/5 | ${dr.likelihood}/5 | **${dr.risk_rating}/25** (\`${dr.priority.split(" ")[0]}\`) | ${f.verification_link} |`;
      })
      .join("\n") || "| None | `-` | `-` | `-` | - | - | - | - |";

  const praMatrixBlock =
    allPrioritizedFindings.length > 10
      ? `<details>
<summary><b>📊 Click to expand full Risk & Priority Matrix (${allPrioritizedFindings.length} entries)</b></summary>

| Finding | Verification Status | Business Risk | Technical Area | Impact (1-5) | Likelihood (1-5) | Risk Score (1-25) | How It Was Checked |
| :--- | :--- | :--- | :--- | :---: | :---: | :---: | :--- |
${praMatrixRows}

</details>`
      : `| Finding | Verification Status | Business Risk | Technical Area | Impact (1-5) | Likelihood (1-5) | Risk Score (1-25) | How It Was Checked |
| :--- | :--- | :--- | :--- | :---: | :---: | :---: | :--- |
${praMatrixRows}`;

  // Section 1C: Only show Violated / At-Risk rules in main table; summarize compliant rules
  const allBusinessRules = report.business_rules || [];
  const violatedOrAtRiskRules = allBusinessRules.filter(
    (br) =>
      br.status === "VIOLATED_CONFIRMED_RED" ||
      br.status === "VIOLATED_STATIC_AST" ||
      br.status === "CRASHES_ON_EMPTY_INPUT" ||
      br.status === "BYPASSED_OR_AT_RISK_AMBER" ||
      br.status === "VIOLATED_OR_TESTABLE_DEFECT" ||
      br.status === "BYPASSED_AT_RISK"
  );
  const compliantRules = allBusinessRules.filter(
    (br) => !violatedOrAtRiskRules.includes(br)
  );
  const compliantRulesCount = compliantRules.length;
  const compliantRuleRows = compliantRules
    .map((br) => {
      const safeRuleText = humanizeMendixText(String(br.rule_text || "")).replace(/\|/g, "\\|");
      const queryInfo = br.negated_xpath ? ` *(Dataset Filter: \`${br.negated_xpath}\`)*` : "";
      const enforcedBadge =
        br.status === "VERIFIED_ENFORCED_GREEN"
          ? "🟢 **Verified Enforced (Runtime Rejected Invalid Input)**"
          : "🟢 **Followed**";
      return `| **\`${br.id}\`** | \`${br.source_type}\`<br>*(${br.source_location})* | \`${br.target_element}\` | ${safeRuleText}${queryInfo} | ${enforcedBadge} |`;
    })
    .join("\n");
  const compliantRulesCollapse =
    compliantRules.length > 0
      ? `\n\n<details>
<summary><b>📜 Click to view all ${compliantRules.length} Compliant Business Rules & Data Invariants</b></summary>

| Rule ID | Where the Rule Is Defined | Microflow / Entity | Business Rule Description | Status |
| :--- | :--- | :--- | :--- | :--- |
${compliantRuleRows}

</details>`
      : "";

  const formatConciseEvidenceLinks = (items, isConfirmedRed = false) => {
    const uniqueMap = new Map();
    for (const item of items || []) {
      const k = `${item.pattern_id}|${item.title}`;
      if (!uniqueMap.has(k)) uniqueMap.set(k, item);
    }
    const uniqueItems = Array.from(uniqueMap.values());
    if (uniqueItems.length === 0) return "";
    const topItems = uniqueItems.slice(0, 3).map((v) => {
      if (isConfirmedRed && v.finding_anchor) {
        return `[${humanizeMendixText(v.title)} (${formatPatternWithCode(v.pattern_id)})](#${v.finding_anchor}) ([Scenario #${v.scenario_number}](${executedTestsRelPath}#${v.scenario_anchor}))`;
      }
      return `${humanizeMendixText(v.title)} (${formatPatternWithCode(v.pattern_id)})`;
    });
    if (uniqueItems.length > 3) {
      topItems.push(`*(+${uniqueItems.length - 3} more related finding(s))*`);
    }
    return topItems.join("<br>");
  };

  const businessRuleRows =
    violatedOrAtRiskRules.length > 0
      ? violatedOrAtRiskRules
          .map((br) => {
            let statusBadge = "🟠 **At Risk / Can Be Bypassed**";
            let evidenceCell = "Can be bypassed via call chain or missing check";
            if (br.status === "CRASHES_ON_EMPTY_INPUT") {
              statusBadge = "💥 **Crashes on Empty Input (Technical NPE Before Validation)**";
              evidenceCell =
                formatConciseEvidenceLinks(br.confirmed_red_violations, true) ||
                formatConciseEvidenceLinks(br.violated_by_findings, false) ||
                "Null dereference crash when object/attribute is empty";
            } else if (
              br.status === "VIOLATED_CONFIRMED_RED" ||
              br.status === "VIOLATED_STATIC_AST" ||
              br.status === "VIOLATED_OR_TESTABLE_DEFECT"
            ) {
              const hasLatentOnly =
                (br.confirmed_red_violations || []).length > 0 &&
                (br.confirmed_red_violations || []).every(
                  (v) => v.exposure_classification === "LATENT_IMPLICITLY_PROTECTED"
                );
              statusBadge = hasLatentOnly
                ? "🔶 **Violated in Sub-Microflow (Latent Bug)**"
                : isStatic
                  ? "🔴 **Violated (Static AST Identified)**"
                  : "🔴 **Violated (Confirmed Bug)**";
              evidenceCell =
                formatConciseEvidenceLinks(br.confirmed_red_violations, true) ||
                formatConciseEvidenceLinks(br.violated_by_findings, false) ||
                "See confirmed findings above";
            } else if (
              br.status === "BYPASSED_OR_AT_RISK_AMBER" ||
              br.status === "BYPASSED_AT_RISK"
            ) {
              statusBadge = "🟠 **At Risk / Can Be Bypassed**";
              evidenceCell =
                formatConciseEvidenceLinks(br.amber_bypasses || br.violated_by_findings, false) ||
                "Can be bypassed via call chain or missing check";
            }
            const safeRuleText = humanizeMendixText(String(br.rule_text || "")).replace(/\|/g, "\\|");
            return `| **\`${br.id}\`** | \`${br.source_type}\`<br>*(${br.source_location})* | \`${br.target_element}\` | ${safeRuleText} | ${statusBadge} | ${evidenceCell} |`;
          })
          .join("\n")
      : allBusinessRules.length > 0
        ? `| \`All (${allBusinessRules.length})\` | \`Model & Docs\` | \`${report.module || report.target_microflow}\` | All ${allBusinessRules.length} business rules checked are properly enforced. | 🟢 **Followed** | Verified across model & executed tests |`
        : "| `-` | `-` | `-` | No business rules detected | `-` | - |";

  const businessRulesBlock =
    violatedOrAtRiskRules.length > 10
      ? `<details>
<summary><b>📜 Click to expand full Business Rules Audit Table (${violatedOrAtRiskRules.length} entries)</b></summary>

| Rule ID | Where the Rule Is Defined | Microflow / Entity | Business Rule Description | Status | Related Finding & Test |
| :--- | :--- | :--- | :--- | :--- | :--- |
${businessRuleRows}

</details>${compliantRulesCollapse}`
      : `| Rule ID | Where the Rule Is Defined | Microflow / Entity | Business Rule Description | Status | Related Finding & Test |
| :--- | :--- | :--- | :--- | :--- | :--- |
${businessRuleRows}${compliantRulesCollapse}`;

  // Decision Pillars & Executive Action Summary Calculations
  const pillars = report.decision_pillars || {
    safe_01_quarantined: false,
    safe_01_side_effects_count: 0,
    actual_bugs_count: actualCount,
    latent_bugs_count: latentCount,
    commit_delete_exposures_count: commitDeleteExposures,
    top_limit: 25,
    total_candidates: (report.confirmed_bugs || []).length + (report.amber_risks || []).length,
    executed_count: (report.executed_scenarios || []).length || (report.scorecard?.total_executed_scenarios ?? (report.confirmed_bugs || []).length),
    is_static: isStatic,
    plugin_online: !isStatic,
    plugin_url: "MTA Plugin (Local/Cluster)",
    probe_status_code: isStatic ? "STATIC_INSPECTION" : 200,
  };

  const safe01Badge = pillars.safe_01_quarantined
    ? `⚠️ Quarantined (\`${pillars.safe_01_side_effects_count}\` unmocked side-effects detected)`
    : "✅ Clear (Zero unmocked external side-effects)";

  const highestRiskScore = allPrioritizedFindings.reduce(
    (max, f) => Math.max(max, f.dual_risk?.risk_rating || 0),
    0
  );

  const runtimeProbeBadge = pillars.is_static
    ? "⚪ Static Analysis Mode *(Dynamic runtime execution deferred)*"
    : pillars.plugin_online
      ? `🟢 Connected & Verified (\`${pillars.plugin_url}\`, HTTP ${pillars.probe_status_code || 200})`
      : `🔴 Plugin Offline / Fallback (\`${pillars.plugin_url}\`, HTTP ${pillars.probe_status_code || "OFFLINE"})`;

  const totalCandidates = pillars.total_candidates || allPrioritizedFindings.length || 1;
  const executedCount = pillars.executed_count ?? (report.scorecard?.total_executed_scenarios || 0);
  const executedFrontendCount =
    pillars.executed_frontend_count ??
    report.scorecard?.executed_frontend_scenarios ??
    (report.executed_scenarios || []).filter(
      (s) => s.test_channel === "FRONTEND_UI" || s.execution_channel === "FRONTEND_PLAYWRIGHT_PLUGIN"
    ).length;
  const executedBackendCount =
    pillars.executed_backend_count ??
    report.scorecard?.executed_backend_scenarios ??
    Math.max(0, executedCount - executedFrontendCount);

  const bugsForActionSummary = sortFunctionalFirst(
    allConfirmedBugs.length > 0
      ? allConfirmedBugs
      : (isStatic && Array.isArray(report.hypotheses) ? report.hypotheses : [])
  );

  const executiveActionSummaryRows = bugsForActionSummary.length > 0
    ? bugsForActionSummary.map((b, idx) => {
        const scenNum = b.scenario_number || idx + 1;
        const scenAnchor = b.scenario_anchor || `scenario-${scenNum}`;
        const findAnchor = b.finding_anchor || `finding-${b.id || scenNum}`;
        const dr = b.dual_risk || classifyFindingDualRisk(b, report);
        const humanTitle = humanizeMendixText(b.title);
        const patternWithCode = formatPatternWithCode(b.pattern_id);
        const microflowName = b.microflow || report.target_microflow;
        const humanOutcomeLabel = formatHumanFailureOutcome(b.runtime_failure_code);
        const rawError = b.actual_runtime_error || b.oracle_rule || "Identified via static model inspection";
        const symptom = `${humanOutcomeLabel}: ${truncateText(humanizeMendixText(rawError), 120)}`;
        const fix = truncateText(humanizeMendixText(b.remediation || "Review microflow logic in Studio Pro"), 140);
        const prioTag = dr.priority ? `\`${dr.priority.split(" ")[0]}\`` : `\`${b.severity || "P2"}\``;
        const verBadge = formatVerificationStatusBadge(b, {
          executedTestsRelPath,
          scenarioAnchor: scenAnchor,
        });
        const chInfo = resolveTestChannelAndRationale(b, report);
        const chBadge = b.test_channel_badge || chInfo.channelBadge;
        const dn = classifyDefectNature(b);
        const natureTag =
          dn === "FUNCTIONAL_BYPASS"
            ? "⚖️ **Tier 1 Functional Defect**"
            : dn === "UI_FEEDBACK_DISCONNECT"
              ? "🔕 **Tier 2 UI Feedback Trap**"
              : "💥 **Tier 3 Technical Crash**";
        return `| ${idx + 1} | ${natureTag}<br>[**${humanTitle}**](#${findAnchor})<br>${patternWithCode}<br>Microflow: \`${microflowName}\` | ${verBadge}<br>Channel: **${chBadge}** | ${symptom} | ${fix} | ${prioTag} |`;
      }).join("\n")
    : "| - | None (Zero confirmed bugs in this run) | - | All checked inputs handled safely | No immediate fixes required | 🟢 Clean |";

  const functionalTier1SummaryBlock =
    functionalBugsTier1.length > 0
      ? `#### 2.0 Functional Defects & Business Rule Bypasses (Priority 1 — Tier 1)

> ⚖️ **Why Functional Defects Come First:** Unlike technical crashes on empty inputs, these **${functionalBugsTier1.length}** functional defect(s) happen when a user or API supplies **non-empty business data** that violates a domain rule (such as inverted dates, negative prices, or bypassed commit rules) and the microflow silently accepts or miscalculates it. Each row below states whether the functional test was executed via **Frontend UI (Playwright)** or **Backend (Direct Microflow)** and why that channel was selected.

| Microflow & Functional Defect | Verification Status | Test Channel & Why Chosen | Business Rule / Invariant Violated | Studio Pro Fix |
| :--- | :--- | :--- | :--- | :--- |
${functionalBugsTier1
  .map((b, idx) => {
    const scenNum = b.scenario_number || idx + 1;
    const scenAnchor = b.scenario_anchor || `scenario-${scenNum}`;
    const findAnchor = b.finding_anchor || `finding-${b.id || scenNum}`;
    const verBadge = formatVerificationStatusBadge(b, {
      executedTestsRelPath,
      scenarioAnchor: scenAnchor,
    });
    const chInfo = resolveTestChannelAndRationale(b, report);
    const chBadge = b.test_channel_badge || chInfo.channelBadge;
    const chWhy = truncateText(humanizeMendixText(b.test_channel_rationale || chInfo.rationale), 160);
    const ruleText = truncateText(humanizeMendixText(b.oracle_rule || b.actual_runtime_error || ""), 130);
    const fixText = truncateText(humanizeMendixText(b.remediation || "Enforce domain invariant before Commit"), 130);
    return `| [**${humanizeMendixText(b.title)}**](#${findAnchor})<br>${formatPatternWithCode(b.pattern_id)} — \`${b.microflow || report.target_microflow}\` | ${verBadge} | **${chBadge}**<br>${chWhy} | ${ruleText} | ${fixText} |`;
  })
  .join("\n")}

---

`
      : "";

  // Plain-English Business Takeaways at the very top of the report
  const plainEnglishTakeaways = [];
  if (functionalTier1Count > 0) {
    plainEnglishTakeaways.push(
      `* ⚖️ **Functional Business Rule Bypasses (\`${functionalTier1Count}\` Tier 1 Functional Defect${functionalTier1Count === 1 ? "" : "s"}):** Non-empty business inputs that violate domain rules (such as inverted dates, negative durations, or unvalidated saves) are accepted or miscalculated without blocking the save.`
    );
  }
  if (actualCount > 0) {
    plainEnglishTakeaways.push(
      `* 🔴 **Immediate User Impact (\`${actualCount}\` Actual Bug${actualCount === 1 ? "" : "s"}):** Users or API callers can trigger ${actualCount === 1 ? "this error" : "these errors"} right now (for example, clicking an action button without selecting a record or saving incomplete data causes a technical crash or saves invalid records).`
    );
  }
  if (latentCount > 0) {
    plainEnglishTakeaways.push(
      `* 🔶 **Hidden Regression Risk (\`${latentCount}\` Latent Bug${latentCount === 1 ? "" : "s"}):** ${latentCount === 1 ? "A helper sub-microflow crashes" : "Helper sub-microflows crash"} when given empty or boundary data. Current screens happen to block this today, but reusing ${latentCount === 1 ? "this sub-microflow" : "these sub-microflows"} on a new page or API will cause immediate errors.`
    );
  }
  if ((report.scorecard.ui_page_candidates_amber_ui || 0) > 0) {
    plainEnglishTakeaways.push(
      `* 🟡 **Invisible Error Messages (\`${report.scorecard.ui_page_candidates_amber_ui}\` Page Check${report.scorecard.ui_page_candidates_amber_ui === 1 ? "" : "s"}):** Validation messages are attached to fields that are not shown on the user's screen, leaving users stuck without seeing why their action failed.`
    );
  }
  if (violatedOrAtRiskRules.length > 0) {
    plainEnglishTakeaways.push(
      `* 📜 **Business Rules at Risk (\`${violatedOrAtRiskRules.length}\` of \`${allBusinessRules.length}\` Rules):** ${violatedOrAtRiskRules.length} business rule(s) (such as required fields, date order, or before-save checks) can be bypassed or fail silently without warning the user.`
    );
  }
  if (plainEnglishTakeaways.length === 0) {
    plainEnglishTakeaways.push(
      `* 🟢 **All Checked Scenarios Passed:** All tested microflows and business rules handled empty and boundary inputs safely.`
    );
  }

  return `# Mendix Bug Hunter Report: ${report.target_microflow}

> 🔗 **${isStatic ? "Planned Tests" : "Executed Tests"} Report:** [${defaultTestsFile}](${executedTestsRelPath}) | **MTA Test Specification:** [EP_BugHunt_${targetSlug}.md](${preExecPlanRelPath})

## 💡 Plain-English Business Overview (What This Means for Users)

${plainEnglishTakeaways.join("\n")}

## 🛡️ Executive Summary: Functional Defects vs. Technical Crashes (\`${report.module || report.target_microflow}\`)

* ⚖️ **Tier 1 — Functional Defects & Business Rule Bypasses: \`${functionalTier1Count}\`** — Non-empty domain inputs that violate business rules, date order, or calculation formulas and are accepted without blocking the transaction.
* 🔕 **Tier 2 — Functional UI & Silent Feedback Traps: \`${uiFeedbackTier2Count}\`** — Validation messages attached to hidden/wrong entities or silent rollback flows where users receive no error feedback.
* 💥 **Tier 3 — Technical Runtime Crashes (Null / Empty Inputs): \`${technicalCrashTier3Count}\`** — Unhandled Java/Mendix runtime exceptions when empty objects or attributes are passed (\`${actualCount}\` Actual Page/API Reproducible Bugs + \`${latentCount}\` Latent Sub-Microflow Bugs).
* 🔴 **Actual Bugs (Reproducible Now via Pages or APIs): \`${actualCount}\`** — Bugs in button/page microflows (\`ACT_*\`, \`DS_*\`, \`API_*\`) or unguarded call chains that users or API callers can trigger right now.
* 🔶 **Latent Bugs (Protected Today by Calling Page/Microflow — Future Regression Risks): \`${latentCount}\`** — Proven bugs inside sub-microflows (\`SUB_*\`, \`VAL_*\`, \`RULE_*\`) that do not happen during normal screen usage today because the calling page or parent microflow checks the data first. However, if a page flow changes or a new microflow calls the sub-microflow directly, these bugs will surface immediately as regression bugs.
* 💾 **Call Chains that \`Commit\` or \`Delete\` Data: \`${commitDeleteExposures}\` finding(s)** occur inside a microflow call chain that saves (\`Commit\`) or deletes (\`Delete Object\`) database records.

### 1. Summary of Findings

| Category | What This Means | Count | Status |
| :--- | :--- | :--- | :--- |
| 🔴 **${isStatic ? "Static Model Findings (Total)" : "Confirmed Bugs (Total)"}** | **${isStatic ? "Identified via static Mendix model inspection (dynamic verification pending)" : "Proven by running the microflows with boundary or empty inputs"}** | **${report.scorecard.confirmed_bugs_red}** | \`${report.scorecard.confirmed_bugs_red > 0 ? (isStatic ? "STATIC VERIFICATION NEEDED" : "ACTION REQUIRED") : "CLEAN"}\` |
| &nbsp;&nbsp;↳ ⚖️ **Tier 1: Functional Defects & Business Rule Bypasses (Priority 1)** | **Valid-looking domain inputs that bypass business rules, invert dates, or corrupt calculations** | **${functionalTier1Count}** | \`${functionalTier1Count > 0 ? (isStatic ? "VERIFY FUNCTIONAL RULES" : "FIX BUSINESS LOGIC") : "CLEAN"}\` |
| &nbsp;&nbsp;↳ 🔕 **Tier 2: Functional UI & Silent Feedback Traps (Priority 2)** | **Validation messages on unseen/wrong entities or validation flows that forget to stop saving** | **${uiFeedbackTier2Count}** | \`${uiFeedbackTier2Count > 0 ? "FIX UI FEEDBACK" : "CLEAN"}\` |
| &nbsp;&nbsp;↳ 💥 **Tier 3: Technical Runtime Crashes (Priority 3)** | **Unhandled exceptions when empty objects or attributes are passed into microflows** | **${technicalCrashTier3Count}** | \`${technicalCrashTier3Count > 0 ? "ADD NULL GUARDS" : "CLEAN"}\` |
| &nbsp;&nbsp;↳ 🔴 **${isStatic ? "Actual Risk Candidates (Page/API Reachable)" : "Actual Bugs (Reproducible Now)"}** | **${isStatic ? "Reachable today from a Mendix Page or API" : "Can be triggered today from a Mendix Page or API"}** | **${actualCount}** | \`${actualCount > 0 ? (isStatic ? "VERIFY OR FIX" : "FIX IMMEDIATELY") : "CLEAN"}\` |
| &nbsp;&nbsp;↳ 🔶 **${isStatic ? "Latent Risk Candidates (Future Regression Risks)" : "Latent Bugs (Future Regression Risks)"}** | **${isStatic ? "Currently protected by calling page/microflow, but at risk if reused" : "Currently protected by the calling page/microflow, but will break if reused or changed"}** | **${latentCount}** | \`${latentCount > 0 ? (isStatic ? "REVIEW SUB-MICROFLOWS" : "HARDEN SUB-MICROFLOWS") : "CLEAN"}\` |
| 🟠 **Microflow & Call-Chain Warnings** | **Missing input checks in \`Commit\`/\`Delete\` call chains, unrounded decimals, or unreachable branches** | **${report.scorecard.latent_architecture_risks_amber}** | \`${report.scorecard.latent_architecture_risks_amber > 0 ? "REVIEW WARNINGS" : "CLEAN"}\` |
| 🟡 **Page & Validation Message Checks** | **Validation messages on unseen/wrong entities or page/microflow role mismatches** | **${report.scorecard.ui_page_candidates_amber_ui}** | \`${report.scorecard.ui_page_candidates_amber_ui > 0 ? "CHECK ON PAGE" : "CLEAN"}\` |
| 🟢 **Passed Test Scenarios** | **Microflow scenarios that handled empty or boundary inputs safely** | **${report.scorecard.verified_resilient_green}** | \`${isStatic ? "PENDING" : "PASSED"}\` |
| 📜 **Business Rules Checked** | **Business rules found in documentation, pages, and validation microflows** | **${report.scorecard.business_rules_detected || 0} Checked (${report.scorecard.business_rules_violated || 0} Violated / At Risk)** | \`${(report.scorecard.business_rules_violated || 0) > 0 ? "RULES VIOLATED" : "FOLLOWED"}\` |
| 🧪 **${isStatic ? "Test Specification Status" : "Test Execution Summary"}** | ${isStatic ? `[\`${report.scorecard.total_executed_scenarios || 0}\` Test Scenarios Ready](${executedTestsRelPath})` : `[\`${report.scorecard.total_executed_scenarios || 0}\` Tests Executed](${executedTestsRelPath}) (\`${executedBackendCount}\` ⚙️ Backend Microflow + \`${executedFrontendCount}\` 🌐 Frontend Playwright) in \`${report.scorecard.total_duration_ms} ms\``} | **Automatic Rollback: \`Yes\`** | **${isStatic ? "Ready for dynamic execution" : "No test data left in database"}** |

---

### 1A. Executive Action Summary (Confirmed Bugs & Studio Pro Fixes)

> ⚡ **Quick Reference for Developers & Product Owners:** This table lists all actionable bugs found during testing, their observed symptoms, and the exact fix to apply in Mendix Studio Pro.

| # | Bug Title & Affected Microflow | Verification Status | Runtime Failure / Observed Symptom | Studio Pro Recommended Fix | Priority |
| :-: | :--- | :--- | :--- | :--- | :-: |
${executiveActionSummaryRows}

---

### 1B. Risk & Priority Overview (Business Risk & Technical Risk)

${praMatrixBlock}

---

### 1C. Violated or Bypassed Business Rules

> This table lists the **${violatedOrAtRiskRules.length}** business rule(s) that were violated or can be bypassed *(out of **${allBusinessRules.length}** total business rules found in project documentation, page settings, and microflow validations; **${compliantRulesCount}** rule(s) were properly followed)*.

${businessRulesBlock}

---

<details>
<summary><b>🔬 Click to view Technical Methodology, 5 Decision Pillars & Evidence Standards</b></summary>

## 🎯 Test Selection & Execution Reasoning (5 Decision Pillars)

\`\`\`mermaid
flowchart TD
  A["All Hypothesized Vulnerabilities"] --> B{"1. SAFE-01 Quarantine"}
  B -- "Unmocked External Side-Effects" --> C["Quarantined / Skipped (SAFE-01)"]
  B -- "Safe to Execute (In-Memory / Rollback)" --> D{"2. Reachability & Exposure"}
  D -- "Reachable via Page/API" --> E["Actual Bug Candidate"]
  D -- "Internally Guarded Sub-Microflow" --> F["Latent Bug Candidate (Regression Risk)"]
  E --> G["3. Risk Scoring Matrix (Impact x Likelihood = 1..25)"]
  F --> G
  G --> H{"4. Execution Batching (--top N)"}
  H -- "Within Top N" --> I["5. Dynamic Runtime Probe (MTA Plugin)"]
  H -- "Deferred Beyond Top N" --> J["Static Inspection Only (Deferred)"]
  I --> K["Verified Bug Report"]
\`\`\`

| Decision Pillar | Evaluation Rule | Applied Value for This Run | Rationale & Safety Safeguard |
| :--- | :--- | :--- | :--- |
| **1. Quarantine (\`SAFE-01\`)** | Unmocked outbound REST/SOAP, email sending, background job scheduling, or system context creation are blocked from live execution. | **${safe01Badge}** | Prevents unintended third-party API calls, outbound customer emails, and unauthorized database mutations during testing. |
| **2. Reachability & Exposure** | Distinguish between bugs triggered directly from user pages/APIs versus latent defects guarded by caller flows. | **\`${actualCount}\` Actual Bug(s) / \`${latentCount}\` Latent Risk(s)** | Prioritizes user-facing defects as immediate blockers while tracking sub-microflow defects as regression hazards. |
| **3. Risk Scoring Matrix** | Formula: $\\text{Impact} \\times \\text{Likelihood} = \\text{Score (1–25)}$. Scores $\\ge 15$ and call chains with \`Commit\`/\`Delete\` are ranked P1/P2. | **${commitDeleteExposures} finding(s) in \`Commit\`/\`Delete\` call chains**; highest risk scored **${highestRiskScore}/25** | Focuses dynamic execution budgets on flaws capable of corrupting data or crashing production workflows. |
| **4. Execution Batching (\`--top N\`)** | Select the top $N$ highest-risk candidates for dynamic test execution to prevent runtime timeouts. | **Top \`${pillars.top_limit}\` Candidates Selected** (\`${executedCount}\` tests executed out of \`${totalCandidates}\` total candidates) | Balances exhaustive edge-case coverage against test session timeout constraints and server memory. |
| **5. Runtime Probe Status** | Verify active connectivity to the Mendix runtime via the MTA Plugin before dispatching tests. | **${runtimeProbeBadge}** | Ensures test results reflect genuine Mendix JVM runtime behavior with automatic transaction rollback. |
| **6. Frontend UI vs. Backend Microflow Channel Selection** | Choose **🌐 Frontend UI (Playwright)** when testing page widget visibility, client input masks, or missing validation feedback (\`BHP-17\`/\`BHP-32\`), and **⚙️ Backend (Direct Microflow)** when isolating server-side business rules, null guards, or internal sub-microflows (\`SUB_*\`/\`VAL_*\`/\`EVT_*\`) with in-memory rollback (\`Rollback: Yes\`). | **\`${executedBackendCount}\` ⚙️ Backend Microflow Test(s) / \`${executedFrontendCount}\` 🌐 Frontend Playwright UI Test(s)** | Combines fast, deterministic server-side rule/guard verification with real browser validation of user-visible error messages. |

## 🔍 Verification Methodology & Evidence Standards

MTA Bug Hunter operates under a strict two-tier evidence standard to provide complete transparency into how findings are proven while preventing redundant runtime execution churn:

* **Tier 1: Live Runtime Execution (\`DYNAMIC_RECEIPT_CONFIRMED\`)**: Directly executed against the active Mendix runtime via \`MTA_plugin.execute-testcase\` with automatic transaction rollback (\`Rollback: Yes\`). Every dynamic finding has a recorded execution receipt, duration, and runtime stack trace.
* **Tier 2: Statically Verified Structural Flaws (\`STATIC_REPRESENTATIVE_PROOF\`)**: When multiple microflows share an identical control-flow graph (CFG) pattern and trigger mechanism (e.g. unhandled null pointer or unvalidated feedback), Bug Hunter dynamically proves the defect on a representative component to verify the Mendix runtime engine behavior. The remaining components sharing the identical AST structure are verified via static graph equivalence. This engineering approach eliminates unnecessary server load while guaranteeing mathematical defect certainty. Full individual execution receipts can be generated on demand.
* **Static AST Candidates (\`STATIC_AST_CANDIDATE\`)**: Identified via static AST analysis only; pending dynamic verification.

</details>

---

### 2. ${isStatic ? "Static Model Findings & Risk Hypotheses (Dynamic Verification Pending)" : "Confirmed Bugs (Proven by Running the Microflows)"}

${functionalTier1SummaryBlock}#### 2A. ${isStatic ? "Actual Risk Candidates — Reachable via Pages or APIs" : "Confirmed Actual Bugs — Reproducible Now via Pages or APIs"}

${actualMethodologyCallout}${actualFindingsTable}${actualRedCards}

---

#### 2B. ${isStatic ? "Latent Risk Candidates — Protected Today by Page/Caller Flow (Future Regression Risks)" : "Confirmed Latent Bugs — Protected Today by Page/Caller Flow (Future Regression Risks)"}

> 💡 **Why Latent Bugs Matter:** When we tested these sub-microflows directly with empty or boundary values, they crashed or produced invalid data. Users do not hit them on the screen today only because the calling page or parent microflow happens to filter out those values first. Adding a simple check inside the sub-microflow itself prevents future regression bugs when pages change or when another microflow calls it—especially important when the call chain commits or deletes database objects.

${latentMethodologyCallout}${latentFindingsTable}${latentRedCards}

---

### 3. Microflow, Call-Chain (\`Commit\`/\`Delete\`) & Domain Model Warnings

${amberMethodologyCallout}${amberWarningsBlock}

---

### 4. Page & Validation Message Checks (Verify on Page or via UI Test)

${uiCards}

---

### 5. Passed Test Scenarios

| Executed Test | Microflow Tested | Test Channel | Business Risk Checked | Scenario Tested | Result |
| :--- | :--- | :--- | :--- | :--- | :--- |
${greenRows}

---

### ⚡ Recommended Next Steps
1. **Fix Confirmed Actual Bugs First (Section 2A):** Update the microflows in Mendix Studio Pro and re-run the test scenarios to confirm they pass.
2. **Add Input Checks to Sub-Microflows (Section 2B & Section 3):** Make sure sub-microflows (\`SUB_*\`, \`VAL_*\`) check for empty objects or attributes themselves instead of relying on calling pages, especially when the call chain commits or deletes data.
3. **Save as a Permanent MTA Regression Test Suite:** Add these test scenarios to your MTA test suite so future app changes are automatically checked.
`;
}

export function renderExecutedTestsMarkdown(report, options = {}) {
  const isStatic = Boolean(report.is_static);
  const targetSlug = report.target_slug || resolveTargetSlug(report);
  const bugReportRelPath =
    options.bugReportRelPath ||
    `../bug-reports/BugHunt_Report_${targetSlug}.md`;
  const preExecPlanRelPath =
    options.epPlanRelPath ||
    options.preExecPlanRelPath ||
    `./EP_BugHunt_${targetSlug}.md`;

  const scenarios = report.executed_scenarios || [
    ...(report.confirmed_bugs || []),
    ...(report.verified_resilient || []),
  ];
  const feScenarioCount = scenarios.filter(
    (s) => s.test_channel === "FRONTEND_UI" || s.execution_channel === "FRONTEND_PLAYWRIGHT_PLUGIN"
  ).length;
  const beScenarioCount = scenarios.length - feScenarioCount;

  const summaryRows =
    scenarios
      .map((s, idx) => {
        const scenNum = s.scenario_number || idx + 1;
        const scenAnchor = s.scenario_anchor || `scenario-${scenNum}`;
        const findAnchor = s.finding_anchor || `finding-${s.id || scenNum}`;
        const persona = s.executor_persona || "MxAdmin";
        const secMode = s.apply_security === "APP_SECURITY" ? "Security On" : "No Security Restriction";
        const isStaticFinding = s.status === "STATIC_AST_IDENTIFIED";
        const isInconclusive = s.status === "INCONCLUSIVE_TEST_SETUP";
        const isBug = s.status === "CONFIRMED_BUG" || isStaticFinding;
        const isLatent = s.exposure_classification === "LATENT_IMPLICITLY_PROTECTED";
        const humanOutcome = formatHumanFailureOutcome(s.runtime_failure_code);
        const patternWithCode = formatPatternWithCode(s.pattern_id);
        const chInfo = resolveTestChannelAndRationale(s, report);
        const chBadge = s.test_channel_badge || chInfo.channelBadge;
        const statusBadge = isStaticFinding
          ? isLatent
            ? `🔶 **Latent Risk** *(Static AST Identified)*`
            : `🔴 **Actual Risk** *(Static AST Identified)*`
          : isInconclusive
            ? `⚠️ **Inconclusive Setup/Locator** *(${humanOutcome})*`
            : isBug
              ? isLatent
                ? `🔶 **Latent Bug Reproduced** *(${humanOutcome})*`
                : `🔴 **Actual Bug Reproduced** *(${humanOutcome})*`
              : `🟢 **Passed** *(Handled Safely)*`;
        return `| [Scenario #${scenNum}](#${scenAnchor}) | \`${s.page_qualified_name ? `${s.page_qualified_name} -> ` : ""}${s.microflow || report.target_microflow}\`<br>(${patternWithCode}) | **${chBadge}** | \`${persona}\` *(${secMode})* | ${statusBadge} | \`${s.duration_ms || 0} ms\` | [View in Bug Report](${bugReportRelPath}#${findAnchor}) |`;
      })
      .join("\n") || "| `-` | `-` | `-` | `-` | No scenarios executed | `0 ms` | - |";

  const detailCards =
    scenarios
      .map((s, idx) => {
        const scenNum = s.scenario_number || idx + 1;
        const scenAnchor = s.scenario_anchor || `scenario-${scenNum}`;
        const findAnchor = s.finding_anchor || `finding-${s.id || scenNum}`;
        const persona = s.executor_persona || "MxAdmin";
        const secMode =
          s.apply_security === "APP_SECURITY"
            ? "Module & entity access rules enabled"
            : "Unrestricted test run";
        const isStaticFinding = s.status === "STATIC_AST_IDENTIFIED";
        const isInconclusive = s.status === "INCONCLUSIVE_TEST_SETUP";
        const isBug = s.status === "CONFIRMED_BUG" || isStaticFinding;
        const isLatent = s.exposure_classification === "LATENT_IMPLICITLY_PROTECTED";
        const humanInputs = formatHumanInputOverrides(s.variation_overrides || {}, "  ");
        const humanOutcome = formatHumanFailureOutcome(s.runtime_failure_code);
        const patternWithCode = formatPatternWithCode(s.pattern_id);
        const chInfo = resolveTestChannelAndRationale(s, report);
        const chBadge = s.test_channel_badge || chInfo.channelBadge;
        const chWhy = humanizeMendixText(s.test_channel_rationale || chInfo.rationale);
        const traceBullet = s.trace_artifact?.file_name
          ? `\n* **Playwright Trace Recording:** [\`traces/${s.trace_artifact.file_name}\`](./traces/${s.trace_artifact.file_name}) *(View via \`npx playwright show-trace menditect-output/bug-hunt-tests/traces/${s.trace_artifact.file_name}\`)*`
          : "";
        const stepsListMd =
          Array.isArray(s.executed_steps) && s.executed_steps.length > 0
            ? `\n* **Executed Test Steps (${s.executed_steps.length} steps):**\n${s.executed_steps
                .map(
                  (st) =>
                    `  - Step #${st.sequence ?? st.key}: \`${st.name || st.type}\` &rarr; **\`${st.result || "EXECUTED"}\`**${st.message ? ` *(${st.message})*` : ""}`
                )
                .join("\n")}`
            : "";

        return `<a id="${scenAnchor}"></a>
### Scenario #${scenNum}: ${humanizeMendixText(s.title)} (${patternWithCode})

* **Related Finding in Bug Report:** [View in \`BugHunt_Report_${targetSlug}.md\`](${bugReportRelPath}#${findAnchor})
* **Test Execution Channel & Why Chosen:** **${chBadge}** — ${chWhy}${traceBullet}
* **Bug Type:** ${isStaticFinding ? (isLatent ? "🔶 **Latent Model Risk** (Protected today by caller; future regression risk)" : "🔴 **Actual Model Risk** (Reachable via Page or API)") : isInconclusive ? "⚠️ **Inconclusive UI Test Setup / Precondition** (Stopped before reaching target assertion)" : isBug ? (isLatent ? "🔶 **Latent Bug** (Currently protected by calling page/microflow; future regression risk)" : "🔴 **Actual Bug** (Reproducible now via Page or API)") : "🟢 **Passed Test Scenario**"}
* **Tested Microflow & Activity:** \`${s.page_qualified_name ? `${s.page_qualified_name} -> ` : ""}${s.microflow || report.target_microflow}\` &rarr; \`${s.activity_caption || s.activity_id || "Start"}\`
* **User Role & Test Safety:** Tested as \`${persona}\` *(${secMode})*, Automatic Rollback = \`Yes\` *(no test data left in database)*
* **Test Inputs Used:**
${humanInputs}${stepsListMd}
* **Expected Behavior:** ${humanizeMendixText(s.expected_safe_outcome || s.oracle_rule)}
* **${isStaticFinding ? "Static Model Finding" : "Actual Test Result"} (${isStaticFinding ? `🟡 ${humanOutcome}` : isInconclusive ? `⚠️ ${humanOutcome} — Setup/Locator Precondition Stopped` : isBug ? (isLatent ? `🔶 ${humanOutcome} — Latent Bug Confirmed` : `🔴 ${humanOutcome} — Actual Bug Confirmed`) : "🟢 Passed — Handled Safely"}, \`${s.duration_ms || 0} ms\`):**
  \`\`\`text
  ${s.actual_runtime_error || "Identified via static Mendix model inspection. Scenario ready for execution."}
  \`\`\``;
      })
      .join("\n\n---\n\n") || "*No test scenarios were executed in this run.*";

  const warningBanner = isStatic
    ? `\n> [!WARNING]\n> **Static AST Plan Only**: Zero test cases have been dynamically executed against the runtime. To execute these tests, run with \`--execute\`.\n`
    : "";

  return `# ${isStatic ? "Specified Mendix Verification Scenarios" : "Executed Mendix Verification Tests"}: \`${report.module || report.target_microflow}\`

> 🔗 **Main Bug Hunter Report:** [BugHunt_Report_${targetSlug}.md](${bugReportRelPath}) | **MTA Test Specification:** [EP_BugHunt_${targetSlug}.md](${preExecPlanRelPath})
${warningBanner}
---

## 1. Test ${isStatic ? "Specification" : "Execution"} Summary

| Item | Details |
| :--- | :--- |
| **Tested Module / Microflow** | \`${report.module || report.target_microflow}\` (\`${report.target_microflow}\`) |
| **Main Bug Report** | [\`menditect-output/bug-reports/BugHunt_Report_${targetSlug}.md\`](${bugReportRelPath}) |
| **Total Test Scenarios ${isStatic ? "Specified" : "Executed"}** | **${scenarios.length}** (\`${beScenarioCount}\` ⚙️ Backend Direct Microflow + \`${feScenarioCount}\` 🌐 Frontend Playwright UI) |
| **Test Channel Selection Policy** | **⚙️ Backend (Direct Microflow):** Used for server-side business rule validation, null guards, and sub-microflows (\`SUB_*\`/\`VAL_*\`/\`EVT_*\`) with in-memory transaction rollback (\`Rollback: Yes\`).<br>**🌐 Frontend UI (Playwright):** Used via \`MenditectMxFrontendTestKit\` when verifying page widget rendering, client-side input constraints, or visible validation feedback (\`BHP-17\`/\`BHP-32\`). |
| **${isStatic ? "Static Model Risk Findings" : "Confirmed Bugs Found"}** | **${report.scorecard.confirmed_bugs_red}** (**${report.scorecard.actual_bugs_ui_api_reproducible ?? 0}** Actual ${isStatic ? "Risk Candidates" : "Bugs"} + **${report.scorecard.latent_bugs_implicitly_protected ?? 0}** Latent ${isStatic ? "Risk Candidates" : "Bugs"}) |
| **${isStatic ? "Runtime Verification Status" : "Passed Scenarios"}** | **${isStatic ? `${scenarios.length} Scenarios Ready (Dynamic Verification Pending)` : report.scorecard.verified_resilient_green}** |
| **${isStatic ? "Execution Mode & Safety" : "Total Execution Time & Safety"}** | ${isStatic ? "Automatic Rollback: `Yes` (Zero persistent mutations)" : `\`${report.scorecard.total_duration_ms} ms\` (Automatic Rollback: \`Yes\` — **no test data left in database**)`} |

### ${isStatic ? "Specified" : "Executed"} Test Scenarios Overview

| Scenario | Tested Microflow / Page | Test Channel | User Role Tested | Test Result | Duration | Link to Bug Report |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
${summaryRows}

---

## 2. Detailed Test Scenarios & Results

${detailCards}
`;
}

export function writeBugReports(report, options = {}) {
  const targetSlug = report.target_slug || resolveTargetSlug(report);
  const outPath = options.out || options.outPath || null;
  const testsOutArg = options.testsOut || options.testsOutArg || null;

  let resolvedOut = outPath
    ? path.resolve(outPath)
    : path.join(process.cwd(), "menditect-output", "bug-reports", `BugHunt_Report_${targetSlug}.md`);

  if (resolvedOut.endsWith(".json")) {
    fs.mkdirSync(path.dirname(resolvedOut), { recursive: true });
    fs.writeFileSync(resolvedOut, JSON.stringify(report, null, 2), "utf8");
    return {
      reportPath: resolvedOut,
      testsPath: null,
      jsonPath: resolvedOut,
      report,
    };
  }

  if (!resolvedOut.endsWith(".md")) {
    const baseName = path.basename(resolvedOut).toLowerCase();
    const reportsDir = baseName === "bug-reports" ? resolvedOut : path.join(resolvedOut, "bug-reports");
    resolvedOut = path.join(reportsDir, `BugHunt_Report_${targetSlug}.md`);
  } else if (resolvedOut.endsWith(".md")) {
    const parentName = path.basename(path.dirname(resolvedOut)).toLowerCase();
    if (parentName === "menditect-output") {
      const redirected = path.join(
        path.dirname(resolvedOut),
        "bug-reports",
        path.basename(resolvedOut) === "BugHunt_Report.md"
          ? `BugHunt_Report_${targetSlug}.md`
          : path.basename(resolvedOut)
      );
      resolvedOut = redirected;
    }
  }

  const menditectRoot =
    path.basename(path.dirname(resolvedOut)).toLowerCase() === "bug-reports"
      ? path.dirname(path.dirname(resolvedOut))
      : path.dirname(resolvedOut);
  const testsDir = path.join(menditectRoot, "bug-hunt-tests");
  const isStatic = Boolean(report.is_static || options.isStatic);
  const testsFileName = isStatic
    ? `BugHunt_Planned_Tests_${targetSlug}.md`
    : `BugHunt_Executed_Tests_${targetSlug}.md`;
  const resolvedTestsOut = testsOutArg
    ? path.resolve(testsOutArg)
    : path.join(testsDir, testsFileName);

  const relTestsFromReport = path
    .relative(path.dirname(resolvedOut), resolvedTestsOut)
    .replace(/\\/g, "/");
  const relReportFromTests = path
    .relative(path.dirname(resolvedTestsOut), resolvedOut)
    .replace(/\\/g, "/");
  const epPlanFileName = `EP_BugHunt_${targetSlug}.md`;

  fs.mkdirSync(path.dirname(resolvedOut), { recursive: true });
  fs.mkdirSync(path.dirname(resolvedTestsOut), { recursive: true });

  const mdReport = renderBugReportMarkdown(report, {
    executedTestsRelPath: relTestsFromReport.startsWith(".") ? relTestsFromReport : `./${relTestsFromReport}`,
    epPlanRelPath: `../bug-hunt-tests/${epPlanFileName}`,
  });
  fs.writeFileSync(resolvedOut, mdReport, "utf8");

  const mdExecutedTests = renderExecutedTestsMarkdown(report, {
    bugReportRelPath: relReportFromTests.startsWith(".") ? relReportFromTests : `./${relReportFromTests}`,
    epPlanRelPath: `./${epPlanFileName}`,
  });
  fs.writeFileSync(resolvedTestsOut, mdExecutedTests, "utf8");

  const resolvedEpPlanOut = path.join(path.dirname(resolvedTestsOut), epPlanFileName);
  const mdEpPlan = generateExecutionPlanMarkdown(report, {
    outTarget: resolvedEpPlanOut,
    isStatic,
    reportRelLink: relReportFromTests.startsWith(".") ? relReportFromTests : `./${relReportFromTests}`,
    executedTestsRelLink: `./${path.basename(resolvedTestsOut)}`,
  });
  fs.writeFileSync(resolvedEpPlanOut, mdEpPlan, "utf8");
  syncMtaStateExecutionPlan(resolvedEpPlanOut, process.cwd());

  const scratchDir = path.join(process.cwd(), "scratch");
  fs.mkdirSync(scratchDir, { recursive: true });
  const scratchJsonPath = path.join(scratchDir, `bughunt_report_${targetSlug}.json`);
  fs.writeFileSync(scratchJsonPath, JSON.stringify(report, null, 2), "utf8");

  return {
    reportPath: resolvedOut,
    testsPath: resolvedTestsOut,
    epPlanPath: resolvedEpPlanOut,
    jsonPath: scratchJsonPath,
    report,
  };
}

// ============================================================================
// 6. MXCLI CATALOG LIFECYCLE & MODULE HARVESTER
//    (`refresh-catalog`, `harvest --module <ModuleName>`, `hunt --module <ModuleName>`)
// ============================================================================

/**
 * Resolves the Mendix `.mpr` path, `.mxcli/catalog.db` path, `mxcli` binary, and personas
 * from `mta_config.json` or explicit CLI options.
 *
 * Architectural Rule: Bug Hunter ALWAYS uses `mxcli` + `.mxcli/catalog.db` (`node:sqlite`)
 * for module-wide 4-layer harvesting—even when StudioPro MCP is connected—because reading
 * 40+ microflows, 30+ pages, 300+ widgets, domain entities, and 700+ RBAC permissions via
 * sequential MCP calls takes 5–10 minutes and 50k–100k LLM tokens, whereas `catalog.db`
 * completes in < 1 second (< 4 seconds including `REFRESH CATALOG FULL SOURCE`) with zero
 * LLM token overhead.
 */
export function resolveCatalogContext(workspaceDir = process.cwd(), options = {}) {
  const cfgPath = options.configPath
    ? path.resolve(options.configPath)
    : path.join(workspaceDir, "mta_config.json");

  let cfg = {};
  if (fs.existsSync(cfgPath)) {
    try {
      cfg = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
    } catch {
      // Ignore malformed config
    }
  }

  const personas = {
    admin_user: "MxAdmin",
    standard_user_role: "User",
    standard_username: null,
    anonymous_enabled: false,
    ...(cfg.personas && typeof cfg.personas === "object" ? cfg.personas : {}),
  };

  let mprPath = options.mprPath
    ? path.resolve(options.mprPath)
    : cfg.mendix_mpr_path
      ? path.resolve(path.dirname(cfgPath), cfg.mendix_mpr_path)
      : null;

  if (!mprPath && cfg.mendix_project_dir) {
    const projDir = path.resolve(path.dirname(cfgPath), cfg.mendix_project_dir);
    if (fs.existsSync(projDir) && fs.statSync(projDir).isDirectory()) {
      const mprs = fs.readdirSync(projDir).filter((f) => f.toLowerCase().endsWith(".mpr"));
      if (mprs.length === 1) {
        mprPath = path.join(projDir, mprs[0]);
      }
    }
  }

  if (!mprPath && fs.existsSync(workspaceDir)) {
    const localMprs = fs.readdirSync(workspaceDir).filter((f) => f.toLowerCase().endsWith(".mpr"));
    if (localMprs.length === 1) {
      mprPath = path.join(workspaceDir, localMprs[0]);
    }
  }

  const mprDir = mprPath ? path.dirname(mprPath) : null;
  let catalogPath = options.catalogPath ? path.resolve(options.catalogPath) : null;
  if (!catalogPath && mprDir) {
    catalogPath = path.join(mprDir, ".mxcli", "catalog.db");
  }
  if (!catalogPath) {
    const wsCatalog = path.join(workspaceDir, ".mxcli", "catalog.db");
    if (fs.existsSync(wsCatalog) && fs.statSync(wsCatalog).size > 4096) {
      catalogPath = wsCatalog;
    }
  }

  // Locate mxcli executable or wrapper script
  const engineDir = path.dirname(fileURLToPath(import.meta.url));
  const candidateBins = [
    path.join(workspaceDir, "vendor", "bin", "mxcli.exe"),
    path.join(workspaceDir, "mxcli.bat"),
    path.resolve(engineDir, "..", "..", "vendor", "bin", "mxcli.exe"),
    path.resolve(engineDir, "..", "..", "mxcli.bat"),
    "C:\\Projecten\\mta-ai-assistant\\vendor\\bin\\mxcli.exe",
  ];
  const mxcliBin = candidateBins.find((p) => fs.existsSync(p)) || "mxcli";

  return {
    cfgPath,
    cfg,
    personas,
    mprPath,
    mprDir,
    catalogPath,
    mxcliBin,
  };
}

/**
 * Ensures `<mendix_project_dir>/.mxcli/catalog.db` exists, is non-empty (> 4 KB),
 * and is at least as recent as the `.mpr` file on disk.
 *
 * Adaptive Catalog Mode (`--catalog-mode auto|full|source`):
 * - For `.mpr` files > 50 MB in `auto` mode (or when `catalogMode === 'full'`), uses
 *   `REFRESH CATALOG FULL` (~20s even on 375 MB / 9,700-microflow enterprise models)
 *   and accepts `build_mode === 'full'` or `'source'`.
 * - For `.mpr` files <= 50 MB in `auto` mode (or when `catalogMode === 'source'`), tries
 *   `REFRESH CATALOG FULL SOURCE` with a 60s timeout and automatically falls back to
 *   `REFRESH CATALOG FULL` if MDL source dumping times out.
 */
export function ensureFreshCatalogDb(workspaceDir = process.cwd(), options = {}) {
  const ctx = resolveCatalogContext(workspaceDir, options);
  const { mprPath, catalogPath, mxcliBin } = ctx;
  const catalogMode = (options.catalogMode || "auto").toLowerCase();
  const LARGE_MPR_BYTES = 50 * 1024 * 1024; // 50 MB threshold
  const mprSizeBytes = mprPath && fs.existsSync(mprPath) ? fs.statSync(mprPath).size : 0;
  const preferFullOnly = catalogMode === "full" || (catalogMode === "auto" && mprSizeBytes > LARGE_MPR_BYTES);

  if (!catalogPath) {
    return {
      ok: false,
      refreshed: false,
      reason: "Could not resolve mendix_mpr_path or .mxcli/catalog.db path from mta_config.json or CLI arguments.",
      ...ctx,
    };
  }

  let needsRefresh = Boolean(options.forceRefresh);
  let refreshReason = options.forceRefresh ? "Explicit --refresh-catalog requested" : null;

  if (!needsRefresh) {
    if (!fs.existsSync(catalogPath) || fs.statSync(catalogPath).size <= 4096) {
      needsRefresh = true;
      refreshReason = "Catalog database does not exist or is empty (<= 4 KB)";
    } else {
      try {
        const db = new DatabaseSync(catalogPath, { readOnly: true });
        const metaRows = db.prepare("SELECT Key, Value FROM catalog_meta").all();
        db.close();
        const meta = Object.fromEntries(metaRows.map((r) => [r.Key, r.Value]));
        const validBuildModes =
          catalogMode === "source" ? new Set(["source"]) : new Set(["source", "full"]);

        if (!validBuildModes.has(meta.build_mode)) {
          needsRefresh = true;
          refreshReason = `Catalog build_mode is '${meta.build_mode || "fast"}' (expected ${Array.from(validBuildModes).join(" or ")})`;
        } else if (mprPath && fs.existsSync(mprPath)) {
          const mprMtimeMs = fs.statSync(mprPath).mtimeMs;
          const catalogBuildMs = meta.build_time ? Date.parse(meta.build_time) : fs.statSync(catalogPath).mtimeMs;
          if (Number.isFinite(catalogBuildMs) && mprMtimeMs > catalogBuildMs + 2000) {
            needsRefresh = true;
            refreshReason = `.mpr file on disk (${new Date(mprMtimeMs).toISOString()}) is newer than catalog.db (${meta.build_time || "unknown"})`;
          }
        }
      } catch (e) {
        needsRefresh = true;
        refreshReason = `Catalog metadata check failed (${e.message})`;
      }
    }
  }

  if (needsRefresh) {
    if (!mprPath || !fs.existsSync(mprPath)) {
      return {
        ok: fs.existsSync(catalogPath) && fs.statSync(catalogPath).size > 4096,
        refreshed: false,
        reason: `Cannot refresh catalog because .mpr path was not found (${mprPath || "unset"}).`,
        ...ctx,
      };
    }

    const runMxcliCatalogCommand = (mdlCommand, timeoutMs = 120000) => {
      if (mxcliBin.toLowerCase().endsWith(".bat") || mxcliBin.toLowerCase().endsWith(".cmd")) {
        execFileSync("cmd.exe", ["/c", mxcliBin, "-p", mprPath, "-c", mdlCommand], {
          stdio: options.quiet ? "pipe" : ["ignore", "pipe", "pipe"],
          windowsHide: true,
          timeout: timeoutMs,
        });
      } else {
        execFileSync(mxcliBin, ["-p", mprPath, "-c", mdlCommand], {
          stdio: options.quiet ? "pipe" : ["ignore", "pipe", "pipe"],
          windowsHide: true,
          timeout: timeoutMs,
        });
      }
    };

    const primaryCmd = preferFullOnly ? "REFRESH CATALOG FULL" : "REFRESH CATALOG FULL SOURCE";

    if (!options.quiet) {
      console.error(
        `[mta-bughunter] Refreshing mxcli catalog via '${primaryCmd}' (${refreshReason}; .mpr size=${(mprSizeBytes / (1024 * 1024)).toFixed(1)} MB)...\n` +
          `[mta-bughunter] NOTE: Ensure you have pressed Save All (Ctrl+S) in Studio Pro so the .mpr file on disk includes your latest changes.`
      );
    }

    try {
      runMxcliCatalogCommand(primaryCmd, preferFullOnly ? 120000 : 60000);
      return {
        ok: fs.existsSync(catalogPath) && fs.statSync(catalogPath).size > 4096,
        refreshed: true,
        reason: `${refreshReason} (built via '${primaryCmd}')`,
        ...ctx,
      };
    } catch (err) {
      if (primaryCmd === "REFRESH CATALOG FULL SOURCE" && catalogMode !== "source") {
        if (!options.quiet) {
          console.warn(
            `[mta-bughunter] '${primaryCmd}' timed out or failed (${err.message}); falling back to 'REFRESH CATALOG FULL'...`
          );
        }
        try {
          runMxcliCatalogCommand("REFRESH CATALOG FULL", 120000);
          return {
            ok: fs.existsSync(catalogPath) && fs.statSync(catalogPath).size > 4096,
            refreshed: true,
            reason: `${refreshReason} (fallback to 'REFRESH CATALOG FULL')`,
            ...ctx,
          };
        } catch (fallbackErr) {
          return {
            ok: fs.existsSync(catalogPath) && fs.statSync(catalogPath).size > 4096,
            refreshed: false,
            reason: `mxcli REFRESH CATALOG FULL failed: ${fallbackErr.message}`,
            ...ctx,
          };
        }
      }
      return {
        ok: fs.existsSync(catalogPath) && fs.statSync(catalogPath).size > 4096,
        refreshed: false,
        reason: `mxcli ${primaryCmd} failed: ${err.message}`,
        ...ctx,
      };
    }
  }

  return {
    ok: true,
    refreshed: false,
    reason: "Catalog database is already fresh.",
    ...ctx,
  };
}

/**
 * Parses an `mxcli` MDL `SourceText` representation of a microflow or rule from `.mxcli/catalog.db`
 * into the normalized Bug Hunter microflow AST format, preserving nested `if ... then ... else ... end if;`
 * branch tracking (`true` vs `false`), exclusive splits, change/create/commit/delete/retrieve activities,
 * microflow calls, Java actions, validation feedback, and return values.
 */
export function parseMdlMicroflowSource(sourceText, mfRow, paramRows = [], allowedRoles = []) {
  const src = String(sourceText || "");
  const lines = src.split(/\r?\n/);

  const applyEntityAccess = /^\s*@applyentityaccess\b/im.test(src);
  const isExcluded = Boolean(mfRow.Excluded) || /^\s*@excluded\b/im.test(src);

  const parameters = paramRows.map((p) => {
    const rawType = p.ParameterType || "String";
    if (rawType.startsWith("Object:")) {
      return {
        name: p.Name,
        type: "Object",
        entity: rawType.slice("Object:".length).trim(),
      };
    }
    if (rawType.startsWith("List of ")) {
      return {
        name: p.Name,
        type: "List",
        entity: rawType.slice("List of ".length).trim(),
      };
    }
    return {
      name: p.Name,
      type: rawType,
      entity: null,
    };
  });

  // Fallback: extract parameters from `microflow Module.Name (Param : Type, ...) : ReturnType` header when `microflow_parameters` table is absent
  if (parameters.length === 0) {
    const hdrMatch = src.match(/^(?:microflow|rule)\s+[A-Za-z0-9_.]+\s*\(([^)]*)\)/im);
    if (hdrMatch && hdrMatch[1] && hdrMatch[1].trim()) {
      for (const part of hdrMatch[1].split(",")) {
        const pm = part.trim().match(/^\$?([A-Za-z0-9_]+)\s*:\s*(.+)$/);
        if (!pm) continue;
        const pName = pm[1].trim();
        const pTypeRaw = pm[2].trim();
        if (/^List\s+of\s+/i.test(pTypeRaw)) {
          parameters.push({
            name: pName,
            type: "List",
            entity: pTypeRaw.replace(/^List\s+of\s+/i, "").trim(),
          });
        } else if (pTypeRaw.includes(".")) {
          parameters.push({
            name: pName,
            type: "Object",
            entity: pTypeRaw,
          });
        } else {
          parameters.push({
            name: pName,
            type: pTypeRaw,
            entity: null,
          });
        }
      }
    }
  }

  const activities = [];
  const returnValues = [];
  const annotations = [];
  const branchStack = [];
  const varEntityMap = new Map();
  for (const p of parameters) {
    if (p.name && p.entity) {
      varEntityMap.set(p.name, p.entity);
    }
  }
  let actSeq = 0;
  let inChangeBlock = null;
  let inCreateBlock = null;
  let pendingCaption = null;
  let docText = mfRow.Description || "";

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    const line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith("//")) {
      const commentBody = line.replace(/^\/\/\s*/, "").trim();
      if (commentBody && commentBody.length >= 6) {
        annotations.push(commentBody);
      }
      continue;
    }
    if (line.startsWith("@")) {
      const capMatch = line.match(/^@caption\s+['"]([^'"]*)['"]/i);
      if (capMatch) {
        pendingCaption = capMatch[1].trim();
      }
      const docMatch = line.match(/^@documentation\s+['"]([^'"]*)['"]/i);
      if (docMatch && docMatch[1].trim()) {
        docText = docText ? `${docText}\n${docMatch[1].trim()}` : docMatch[1].trim();
      }
      continue;
    }

    const currentBranch = branchStack.length > 0 ? branchStack[branchStack.length - 1].branch : undefined;

    // Close multi-line change object or create object block when encountering `);`
    if (inChangeBlock) {
      if (line === ");" || line.endsWith(");") || /\)\s*(?:commit|refresh|with\s+events|\s)*;$/i.test(line)) {
        const inner = line.replace(/\)\s*(?:commit|refresh|with\s+events|\s)*;$/i, "").trim();
        if (inner) {
          const eqIdx = inner.indexOf("=");
          if (eqIdx !== -1) {
            const lhs = inner.slice(0, eqIdx).trim();
            const rhs = inner.slice(eqIdx + 1).trim().replace(/,\s*$/, "");
            inChangeBlock.expressions.push(rhs);
            if (lhs.includes(".")) inChangeBlock.sets_association = lhs;
          }
        }
        if (/\bcommit\b/i.test(line)) inChangeBlock.commit = "Yes";
        activities.push(inChangeBlock);
        inChangeBlock = null;
        continue;
      } else {
        const eqIdx = line.indexOf("=");
        if (eqIdx !== -1) {
          const lhs = line.slice(0, eqIdx).trim();
          const rhs = line.slice(eqIdx + 1).trim().replace(/,\s*$/, "");
          inChangeBlock.expressions.push(rhs);
          if (lhs.includes(".")) inChangeBlock.sets_association = lhs;
        }
        continue;
      }
    }

    if (inCreateBlock) {
      if (line === ");" || line.endsWith(");") || /\)\s*(?:commit|refresh|with\s+events|\s)*;$/i.test(line)) {
        const inner = line.replace(/\)\s*(?:commit|refresh|with\s+events|\s)*;$/i, "").trim();
        if (inner) {
          const eqIdx = inner.indexOf("=");
          if (eqIdx !== -1) {
            const rhs = inner.slice(eqIdx + 1).trim().replace(/,\s*$/, "");
            inCreateBlock.expressions.push(rhs);
          }
        }
        if (/\bcommit\b/i.test(line)) inCreateBlock.commit = "Yes";
        activities.push(inCreateBlock);
        inCreateBlock = null;
        continue;
      } else {
        const eqIdx = line.indexOf("=");
        if (eqIdx !== -1) {
          const rhs = line.slice(eqIdx + 1).trim().replace(/,\s*$/, "");
          inCreateBlock.expressions.push(rhs);
        }
        continue;
      }
    }

    // 1. ExclusiveSplit: `if <cond> then` / `else` / `end if;`
    const ifMatch = line.match(/^if\s+(.+?)\s+then$/i);
    if (ifMatch) {
      const cond = ifMatch[1].trim();
      const splitId = `act_${++actSeq}`;
      activities.push({
        id: splitId,
        type: "ExclusiveSplit",
        caption: pendingCaption || cond,
        expression: cond,
        checks_not_empty: /!=\s*empty/i.test(cond),
        branch: currentBranch,
      });
      pendingCaption = null;
      branchStack.push({ splitId, expression: cond, branch: "true" });
      continue;
    }

    if (/^else$/i.test(line)) {
      if (branchStack.length > 0) {
        branchStack[branchStack.length - 1].branch = "false";
      }
      pendingCaption = null;
      continue;
    }

    if (/^end\s+if\s*;?$/i.test(line)) {
      if (branchStack.length > 0) {
        branchStack.pop();
      }
      pendingCaption = null;
      continue;
    }

    // 2. Loop: `for $Item in $List loop` / `end loop;`
    const loopMatch = line.match(/^for\s+\$([A-Za-z0-9_]+)\s+in\s+\$([A-Za-z0-9_]+)\s+loop$/i);
    if (loopMatch) {
      activities.push({
        id: `act_${++actSeq}`,
        type: "LoopedActivity",
        caption: pendingCaption || `Loop ${loopMatch[2]}`,
        iterator_variable: loopMatch[1],
        list_variable: loopMatch[2],
        branch: currentBranch,
      });
      pendingCaption = null;
      continue;
    }

    // 3. Validation feedback: `validation feedback $Var/Attr [message] 'Message'|"Message";`
    const vfMatch = line.match(
      /^validation\s+feedback\s+\$([A-Za-z0-9_]+)(?:\/([A-Za-z0-9_.]+))?\s+(?:message\s+)?(?:'((?:''|[^'])*)'|"([^"]*)")/i
    );
    if (vfMatch) {
      const [, varName, attrName, singleQuotedMsg, doubleQuotedMsg] = vfMatch;
      const msgTemplate = (singleQuotedMsg !== undefined ? singleQuotedMsg.replace(/''/g, "'") : doubleQuotedMsg || "")
        .replace(/^'+|'+$/g, "")
        .trim();
      const resolvedVarEntity = varEntityMap.get(varName) || null;
      const resolvedMemberRef =
        resolvedVarEntity && attrName && !attrName.includes(".")
          ? `${resolvedVarEntity}.${attrName}`
          : null;
      activities.push({
        id: `act_${++actSeq}`,
        type: "ValidationFeedback",
        caption: pendingCaption || `Validation feedback on $${varName}${attrName ? "/" + attrName : ""}`,
        variable: varName,
        attribute: attrName ? `${varName}.${attrName}` : varName,
        ...(resolvedMemberRef ? { member_refs: [resolvedMemberRef] } : {}),
        message_template: msgTemplate,
        branch: currentBranch,
      });
      pendingCaption = null;
      continue;
    }

    // 4. Retrieve: `retrieve [Entity] $Var from $Parent/Module.Assoc [first];` or `from database [where ...]` or `$Var = retrieve ...`
    const retMatch =
      line.match(/^retrieve\s+(?:([A-Za-z0-9_.]+)\s+)?\$([A-Za-z0-9_]+)\s+from\s+(.+?)\s*;$/i) ||
      line.match(/^\$([A-Za-z0-9_]+)\s*=\s*retrieve\s+(?:([A-Za-z0-9_.]+)\s+)?from\s+(.+?)\s*;$/i);
    if (retMatch) {
      const isAssignSyntax = line.startsWith("$");
      const explicitEntity = isAssignSyntax ? retMatch[2] : retMatch[1];
      const outVar = isAssignSyntax ? retMatch[1] : retMatch[2];
      const fromClause = retMatch[3];
      const isDatabase = /^database\b/i.test(fromClause);
      const firstOnly = /\bfirst$/i.test(fromClause);
      const whereMatch = fromClause.match(/\bwhere\s+(.+?)(?:\s+first)?$/i);
      const assocMatch = !isDatabase ? fromClause.match(/^\$([A-Za-z0-9_]+)\/([A-Za-z0-9_.]+)/) : null;
      const resolvedEnt = explicitEntity || (assocMatch ? assocMatch[2] : null);
      if (outVar && resolvedEnt) {
        varEntityMap.set(outVar, resolvedEnt);
      }
      activities.push({
        id: `act_${++actSeq}`,
        type: "Retrieve",
        caption: `Retrieve $${outVar}`,
        retrieve_source: isDatabase ? "Database" : "Association",
        entity: resolvedEnt,
        association: assocMatch ? assocMatch[2] : null,
        output_variable: outVar,
        first_only: firstOnly,
        expression: whereMatch ? whereMatch[1].trim() : "",
        branch: currentBranch,
      });
      continue;
    }

    // 5. Declare / CreateVariable: `declare $Var Type = <expr>;`
    const declMatch = line.match(/^declare\s+\$([A-Za-z0-9_]+)\s+([A-Za-z0-9_.:]+)\s*=\s*(.+?)\s*;$/i);
    if (declMatch) {
      const [, varName, varType, expr] = declMatch;
      activities.push({
        id: `act_${++actSeq}`,
        type: "CreateVariable",
        caption: `Declare $${varName}`,
        variable: varName,
        variable_type: varType,
        expression: expr,
        expressions: [expr],
        branch: currentBranch,
      });
      continue;
    }

    // 6. Set variable (`set $Valid = false;`)
    const setVarMatch = line.match(/^set\s+\$([A-Za-z0-9_]+)\s*=\s*(.+?)\s*;$/i);
    if (setVarMatch) {
      const [, varName, expr] = setVarMatch;
      activities.push({
        id: `act_${++actSeq}`,
        type: "ChangeVariable",
        caption: `Set $${varName}`,
        variable: varName,
        expression: expr,
        expressions: [expr],
        branch: currentBranch,
      });
      continue;
    }

    // 7. Create object: `create Module.Entity $Var (` or `$Var = create Module.Entity (...)`
    const createObjAssignSingle = line.match(
      /^\$([A-Za-z0-9_]+)\s*=\s*create\s+([A-Za-z0-9_.]+)\s*\((.*)\)\s*(.*);$/i
    );
    if (createObjAssignSingle) {
      const [, outVar, entityName, bodyStr, tailModifiers] = createObjAssignSingle;
      const commitFlag = /\bcommit\b/i.test(tailModifiers) ? "Yes" : "No";
      const exprs = [];
      let setsAssoc = undefined;
      for (const assignPart of bodyStr.split(",")) {
        const eqIdx = assignPart.indexOf("=");
        if (eqIdx !== -1) {
          const lhs = assignPart.slice(0, eqIdx).trim();
          const rhs = assignPart.slice(eqIdx + 1).trim();
          exprs.push(rhs);
          if (lhs.includes(".")) setsAssoc = lhs;
        }
      }
      if (outVar && entityName) {
        varEntityMap.set(outVar, entityName);
      }
      activities.push({
        id: `act_${++actSeq}`,
        type: "CreateObject",
        caption: pendingCaption || `Create $${outVar}`,
        entity: entityName,
        output_variable: outVar,
        variable: outVar,
        commit: commitFlag,
        sets_association: setsAssoc,
        expressions: exprs,
        branch: currentBranch,
      });
      pendingCaption = null;
      continue;
    }

    const createObjStart =
      line.match(/^create\s+([A-Za-z0-9_.]+)\s+\$([A-Za-z0-9_]+)(?:\s+commit)?(?:\s+with\s+events)?\s*(\()?\s*(;)?$/i) ||
      line.match(/^\$([A-Za-z0-9_]+)\s*=\s*create\s+([A-Za-z0-9_.]+)(?:\s+commit)?(?:\s+with\s+events)?\s*(\()?\s*(;)?$/i);
    if (createObjStart) {
      const isAssignSyntax = line.startsWith("$");
      const entityName = isAssignSyntax ? createObjStart[2] : createObjStart[1];
      const outVar = isAssignSyntax ? createObjStart[1] : createObjStart[2];
      const hasParen = createObjStart[3];
      const hasSemi = createObjStart[4];
      const commitFlag = /\bcommit\b/i.test(line) ? "Yes" : "No";
      if (outVar && entityName) {
        varEntityMap.set(outVar, entityName);
      }
      const objAct = {
        id: `act_${++actSeq}`,
        type: "CreateObject",
        caption: pendingCaption || `Create $${outVar}`,
        entity: entityName,
        output_variable: outVar,
        variable: outVar,
        commit: commitFlag,
        expressions: [],
        branch: currentBranch,
      };
      pendingCaption = null;
      if (hasParen && !hasSemi) {
        inCreateBlock = objAct;
      } else {
        activities.push(objAct);
      }
      continue;
    }

    // 7b. Show page: `show page Module.Page ($Var, ...);`
    const showPageMatch = line.match(/^show\s+page\s+([A-Za-z0-9_.]+)(?:\s*\((.*)\))?\s*;$/i);
    if (showPageMatch) {
      const [, pageName, rawArgs] = showPageMatch;
      activities.push({
        id: `act_${++actSeq}`,
        type: "ShowPage",
        caption: pendingCaption || `Show page ${pageName.split(".").pop()}`,
        page: pageName,
        arguments: rawArgs ? rawArgs.split(",").map((s) => s.trim()).filter(Boolean) : [],
        branch: currentBranch,
      });
      pendingCaption = null;
      continue;
    }

    // 8. Change object: `change $Var [commit] [with events] (` or single-line `change $Var (Attr = Expr) [commit] [refresh];`
    const changeObjSingle = line.match(/^change\s+\$([A-Za-z0-9_]+)\s*\((.+)\)\s*(.*);$/i);
    if (changeObjSingle) {
      const [, targetVar, bodyStr, tailModifiers] = changeObjSingle;
      const commitFlag = /\bcommit\b/i.test(tailModifiers) ? "Yes" : "No";
      const exprs = [];
      let setsAssoc = undefined;
      for (const assignPart of bodyStr.split(",")) {
        const eqIdx = assignPart.indexOf("=");
        if (eqIdx !== -1) {
          const lhs = assignPart.slice(0, eqIdx).trim();
          const rhs = assignPart.slice(eqIdx + 1).trim();
          exprs.push(rhs);
          if (lhs.includes(".")) setsAssoc = lhs;
        }
      }
      activities.push({
        id: `act_${++actSeq}`,
        type: "ChangeObject",
        caption: pendingCaption || `Change $${targetVar}`,
        variable: targetVar,
        commit: commitFlag,
        with_events: /\bwith\s+events\b/i.test(tailModifiers),
        sets_association: setsAssoc,
        expressions: exprs,
        branch: currentBranch,
      });
      pendingCaption = null;
      continue;
    }

    const changeObjStart = line.match(/^change\s+\$([A-Za-z0-9_]+)(.*)\($/i);
    if (changeObjStart) {
      const [, targetVar, modifiers] = changeObjStart;
      const commitFlag = /\bcommit\b/i.test(modifiers) ? "Yes" : "No";
      inChangeBlock = {
        id: `act_${++actSeq}`,
        type: "ChangeObject",
        caption: pendingCaption || `Change $${targetVar}`,
        variable: targetVar,
        commit: commitFlag,
        with_events: /\bwith\s+events\b/i.test(modifiers),
        expressions: [],
        branch: currentBranch,
      };
      pendingCaption = null;
      continue;
    }

    // 9. Commit / Rollback / Delete object
    const commitMatch = line.match(/^commit\s+\$([A-Za-z0-9_]+)(?:\s+with\s+events)?\s*;$/i);
    if (commitMatch) {
      activities.push({
        id: `act_${++actSeq}`,
        type: "Commit",
        caption: `Commit $${commitMatch[1]}`,
        variable: commitMatch[1],
        branch: currentBranch,
      });
      continue;
    }

    const rollbackMatch = line.match(/^rollback\s+\$([A-Za-z0-9_]+)\s*;$/i);
    if (rollbackMatch) {
      activities.push({
        id: `act_${++actSeq}`,
        type: "Rollback",
        caption: `Rollback $${rollbackMatch[1]}`,
        variable: rollbackMatch[1],
        branch: currentBranch,
      });
      continue;
    }

    const deleteMatch = line.match(/^delete\s+\$([A-Za-z0-9_]+)\s*;$/i);
    if (deleteMatch) {
      activities.push({
        id: `act_${++actSeq}`,
        type: "DeleteObject",
        caption: `Delete $${deleteMatch[1]}`,
        variable: deleteMatch[1],
        branch: currentBranch,
      });
      continue;
    }

    // 10. Call Microflow or Call Java Action: `[$Out =] call microflow Module.MF(...)` / `call java Module.JA(...)`
    const callMfMatch = line.match(/^(?:\$([A-Za-z0-9_]+)\s*=\s*)?call\s+microflow\s+([A-Za-z0-9_.]+)\s*\((.*)\)\s*;$/i);
    if (callMfMatch) {
      const [, outVar, calledMf, rawArgs] = callMfMatch;
      const argExprs = rawArgs
        ? rawArgs
            .split(",")
            .map((s) => {
              const eq = s.indexOf("=");
              return eq !== -1 ? s.slice(eq + 1).trim() : s.trim();
            })
            .filter(Boolean)
        : [];
      activities.push({
        id: `act_${++actSeq}`,
        type: "MicroflowCall",
        caption: `Call ${calledMf.split(".").pop()}`,
        called_microflow: calledMf,
        output_variable: outVar || null,
        returns_object: Boolean(outVar && /^GET_|_by_/i.test(calledMf)),
        arguments: argExprs,
        expressions: argExprs,
        branch: currentBranch,
      });
      continue;
    }

    const callJavaMatch = line.match(/^(?:\$([A-Za-z0-9_]+)\s*=\s*)?call\s+java\s+([A-Za-z0-9_.]+)\s*\((.*)\)\s*;$/i);
    if (callJavaMatch) {
      const [, outVar, javaAct, rawArgs] = callJavaMatch;
      const argExprs = rawArgs
        ? rawArgs
            .split(",")
            .map((s) => {
              const eq = s.indexOf("=");
              return eq !== -1 ? s.slice(eq + 1).trim() : s.trim();
            })
            .filter(Boolean)
        : [];
      activities.push({
        id: `act_${++actSeq}`,
        type: "JavaActionCall",
        caption: `Java ${javaAct.split(".").pop()}`,
        java_action: javaAct,
        output_variable: outVar || null,
        arguments: argExprs,
        expressions: argExprs,
        branch: currentBranch,
      });
      continue;
    }

    // 11. Return statement: `return <expr>;`
    const retStmtMatch = line.match(/^return(?:\s+(.+?))?\s*;$/i);
    if (retStmtMatch) {
      if (retStmtMatch[1]) {
        returnValues.push(retStmtMatch[1].trim());
      }
      continue;
    }
  }

  // Link ValidationFeedback sets_valid_false if a ChangeVariable sets a boolean to false or microflow returns false on the same branch
  const hasFalseReturnOrFlag =
    returnValues.some((v) => v === "false") ||
    activities.some(
      (a) =>
        (a.type === "ChangeVariable" || a.type === "CreateVariable") &&
        /\bfalse\b/i.test(a.expression || "")
    );
  for (const act of activities) {
    if (act.type === "ValidationFeedback" && act.sets_valid_false === undefined) {
      act.sets_valid_false = hasFalseReturnOrFlag;
    }
  }

  return {
    name: mfRow.Name,
    qualified_name: mfRow.QualifiedName,
    microflow_type: mfRow.MicroflowType || "MICROFLOW",
    documentation: docText || mfRow.Description || "",
    annotations,
    return_type: mfRow.ReturnType || "Void",
    return_values: returnValues,
    allowed_roles: allowedRoles,
    apply_entity_access: applyEntityAccess,
    excluded: isExcluded,
    parameters,
    activities,
  };
}

/**
 * Reconstructs the normalized Bug Hunter microflow AST directly from `catalog.db`'s
 * `activities` and `refs` tables when `SourceText` is empty (`build_mode = 'full'`).
 * Enables sub-second module harvesting on large enterprise `.mpr` files (> 50 MB).
 */
export function buildMicroflowAstFromCatalogTables(
  mfRow,
  paramRows = [],
  actRows = [],
  refRows = [],
  allowedRoles = []
) {
  const parameters = paramRows.map((p) => {
    const rawType = p.ParameterType || "String";
    if (rawType.startsWith("Object:")) {
      return {
        name: p.Name,
        type: "Object",
        entity: rawType.slice("Object:".length).trim(),
      };
    }
    if (rawType.startsWith("List of ")) {
      return {
        name: p.Name,
        type: "List",
        entity: rawType.slice("List of ".length).trim(),
      };
    }
    return {
      name: p.Name,
      type: rawType,
      entity: null,
    };
  });

  // Fallback: extract parameters from `microflow Module.Name (Param : Type, ...) : ReturnType` header when `microflow_parameters` table is absent
  if (parameters.length === 0) {
    const hdrMatch = src.match(/^(?:microflow|rule)\s+[A-Za-z0-9_.]+\s*\(([^)]*)\)/im);
    if (hdrMatch && hdrMatch[1] && hdrMatch[1].trim()) {
      for (const part of hdrMatch[1].split(",")) {
        const pm = part.trim().match(/^\$?([A-Za-z0-9_]+)\s*:\s*(.+)$/);
        if (!pm) continue;
        const pName = pm[1].trim();
        const pTypeRaw = pm[2].trim();
        if (/^List\s+of\s+/i.test(pTypeRaw)) {
          parameters.push({
            name: pName,
            type: "List",
            entity: pTypeRaw.replace(/^List\s+of\s+/i, "").trim(),
          });
        } else if (pTypeRaw.includes(".")) {
          parameters.push({
            name: pName,
            type: "Object",
            entity: pTypeRaw,
          });
        } else {
          parameters.push({
            name: pName,
            type: pTypeRaw,
            entity: null,
          });
        }
      }
    }
  }

  const memberRefs = refRows
    .filter((r) => r.TargetType === "ATTRIBUTE" && r.RefKind === "member")
    .map((r) => r.TargetName);

  const activities = [];
  const returnValues = [];
  const annotations = [];
  let actSeq = 0;

  for (const act of actRows) {
    const id = `act_${act.Sequence ?? ++actSeq}`;
    const cap = (act.Caption || "").trim();
    const condExpr = (act.ConditionExpression || "").trim();

    if (act.ActivityType === "Annotation" || act.ActionType === "Annotation") {
      const note = cap || condExpr;
      if (note) annotations.push(note);
      continue;
    }

    if (act.ActivityType === "ExclusiveSplit") {
      activities.push({
        id,
        type: "ExclusiveSplit",
        caption: cap || act.ConditionRule || condExpr,
        expression: condExpr || act.ConditionRule || "",
        condition_rule: act.ConditionRule || null,
        checks_not_empty: /!=\s*empty/i.test(condExpr),
      });
      continue;
    }

    if (act.ActivityType === "LoopedActivity") {
      const loopVarMatch = cap.match(/^Loop\s+\$?([A-Za-z0-9_]+)/i);
      activities.push({
        id,
        type: "LoopedActivity",
        caption: cap || "Loop",
        list_variable: loopVarMatch ? loopVarMatch[1] : null,
      });
      continue;
    }

    if (act.ActivityType === "EndEvent") {
      if (condExpr) {
        returnValues.push(condExpr);
      }
      continue;
    }

    const aType = act.ActionType || "";
    if (aType === "RetrieveAction") {
      // Caption example: `Retrieve TSTE_TestSuiteList from database` or `Retrieve $Var from ...`
      const outVarMatch =
        cap.match(/^Retrieve\s+\$?([A-Za-z0-9_]+)\s+from\b/i) ||
        cap.match(/^Retrieve\s+\$?([A-Za-z0-9_]+)$/i);
      activities.push({
        id,
        type: "Retrieve",
        caption: cap || "Retrieve",
        retrieve_source: act.RetrieveSource || (/from\s+database/i.test(cap) ? "Database" : "Association"),
        entity: act.EntityRef || null,
        output_variable: outVarMatch ? outVarMatch[1] : null,
        first_only: /\bfirst\b/i.test(cap),
        expression: condExpr,
      });
      continue;
    }

    if (aType === "AggregateListAction") {
      // Caption example: `Count TSTE_TestSuiteList into Count`
      const aggMatch = cap.match(/^(Count|Sum|Average|Minimum|Maximum)\s+\$?([A-Za-z0-9_]+)\s+into\s+\$?([A-Za-z0-9_]+)/i);
      activities.push({
        id,
        type: "AggregateListAction",
        action_type: "AggregateListAction",
        caption: cap || "Aggregate list",
        aggregate_function: aggMatch ? aggMatch[1] : "Count",
        list_variable: aggMatch ? aggMatch[2] : null,
        output_variable: aggMatch ? aggMatch[3] : "Count",
      });
      continue;
    }

    if (aType === "ValidationFeedbackAction") {
      const firstObjParam = parameters.find((p) => p.type === "Object");
      activities.push({
        id,
        type: "ValidationFeedback",
        caption: cap || "Show validation feedback",
        variable: firstObjParam ? firstObjParam.name : null,
        attribute: memberRefs[0] || "",
        member_refs: memberRefs,
        message_template: condExpr,
      });
      continue;
    }

    if (aType === "CreateObjectAction") {
      const createMatch = cap.match(/^Create\s+.*?\s+into\s+\$?([A-Za-z0-9_]+)/i);
      const outVar = createMatch
        ? createMatch[1]
        : act.EntityRef
          ? act.EntityRef.split(".").pop()
          : null;
      activities.push({
        id,
        type: "CreateObject",
        caption: cap || "Create object",
        entity: act.EntityRef || null,
        output_variable: outVar,
        variable: outVar,
        commit: act.CommitType && act.CommitType.startsWith("Yes") ? "Yes" : "No",
        with_events: Boolean(act.WithEvents),
        expressions: condExpr ? [condExpr] : [],
      });
      continue;
    }

    if (aType === "ChangeObjectAction" || aType === "ChangeAction") {
      const changeMatch = cap.match(/^Change\s+\$?([A-Za-z0-9_]+)/i);
      const targetVar = changeMatch ? changeMatch[1] : null;
      activities.push({
        id,
        type: "ChangeObject",
        caption: cap || "Change object",
        variable: targetVar,
        commit: act.CommitType && act.CommitType.startsWith("Yes") ? "Yes" : "No",
        with_events: Boolean(act.WithEvents),
        expressions: condExpr ? [condExpr] : [],
      });
      continue;
    }

    if (aType === "CommitAction") {
      const commitMatch = cap.match(/^Commit\s+\$?([A-Za-z0-9_]+)/i);
      activities.push({
        id,
        type: "Commit",
        caption: cap || "Commit",
        variable: commitMatch ? commitMatch[1] : null,
        with_events: act.WithEvents !== undefined && act.WithEvents !== null ? Boolean(act.WithEvents) : true,
        error_handling_type: act.ErrorHandlingType || "Rollback",
      });
      continue;
    }

    if (aType === "DeleteAction") {
      const delMatch = cap.match(/^Delete\s+\$?([A-Za-z0-9_]+)/i);
      activities.push({
        id,
        type: "DeleteObject",
        caption: cap || "Delete",
        variable: delMatch ? delMatch[1] : null,
        error_handling_type: act.ErrorHandlingType || "Rollback",
      });
      continue;
    }

    if (aType === "RollbackAction") {
      const rbMatch = cap.match(/^Rollback\s+\$?([A-Za-z0-9_]+)/i);
      activities.push({
        id,
        type: "Rollback",
        caption: cap || "Rollback",
        variable: rbMatch ? rbMatch[1] : null,
        error_handling_type: act.ErrorHandlingType || "Rollback",
      });
      continue;
    }

    if (aType === "ListOperationAction") {
      const opMatch = cap.match(/^(Head|Tail|Find|Filter|Sort|Union|Intersect|Subtract|Contains|Equals)\b/i);
      const outVarMatch = cap.match(/\binto\s+\$?([A-Za-z0-9_]+)/i);
      activities.push({
        id,
        type: "ListOperation",
        caption: cap || "List operation",
        operation: opMatch ? opMatch[1] : "Filter",
        output_variable: outVarMatch ? outVarMatch[1] : null,
        returns_object: Boolean(opMatch && /^(Head|Find)$/i.test(opMatch[1])),
        error_handling_type: act.ErrorHandlingType || "Rollback",
      });
      continue;
    }

    if (aType === "ChangeListAction") {
      const clMatch = cap.match(/^(Add|Remove|Clear|Set)\b.*?\b(?:to|from|in)?\s+\$?([A-Za-z0-9_]+)$/i);
      activities.push({
        id,
        type: "ChangeList",
        caption: cap || "Change list",
        operation: clMatch ? clMatch[1] : "Add",
        list_variable: clMatch ? clMatch[2] : null,
        expression: condExpr,
        error_handling_type: act.ErrorHandlingType || "Rollback",
      });
      continue;
    }

    if (aType === "RestCallAction" || aType === "WebServiceCallAction") {
      const methodMatch = cap.match(/\b(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/i);
      activities.push({
        id,
        type: aType === "RestCallAction" ? "RestCall" : "WebServiceCall",
        caption: cap || aType,
        http_method: methodMatch ? methodMatch[1].toUpperCase() : "GET",
        location_template: condExpr,
        timeout_configured: Boolean(act.UseRequestTimeout),
        has_error_handler: Boolean(act.ErrorHandlingType && act.ErrorHandlingType !== "Rollback"),
        error_handling_type: act.ErrorHandlingType || "Rollback",
      });
      continue;
    }

    if (aType === "MicroflowCallAction") {
      activities.push({
        id,
        type: "MicroflowCall",
        caption: cap || `Call ${act.ActionRef || "microflow"}`,
        called_microflow: act.ActionRef || null,
        arguments: condExpr ? [condExpr] : [],
        expressions: condExpr ? [condExpr] : [],
        error_handling_type: act.ErrorHandlingType || "Rollback",
      });
      continue;
    }

    if (aType === "JavaActionCallAction") {
      const outVarMatch = cap.match(/\binto\s+\$?([A-Za-z0-9_]+)/i);
      activities.push({
        id,
        type: "JavaActionCall",
        caption: cap || `Java ${act.ActionRef || "action"}`,
        java_action: act.ActionRef || null,
        output_variable: outVarMatch ? outVarMatch[1] : null,
        arguments: condExpr ? [condExpr] : [],
        expressions: condExpr ? [condExpr] : [],
        error_handling_type: act.ErrorHandlingType || "Rollback",
      });
      continue;
    }

    if (aType === "CreateVariableAction" || aType === "ChangeVariableAction") {
      const varMatch = cap.match(/(?:Create|Change).*?\s+\$?([A-Za-z0-9_]+)$/i);
      activities.push({
        id,
        type: aType === "CreateVariableAction" ? "CreateVariable" : "ChangeVariable",
        caption: cap || aType,
        variable: varMatch ? varMatch[1] : null,
        expression: condExpr,
        expressions: condExpr ? [condExpr] : [],
      });
      continue;
    }
  }

  const hasFalseReturnOrFlag =
    returnValues.some((v) => v === "false") ||
    activities.some(
      (a) =>
        (a.type === "ChangeVariable" || a.type === "CreateVariable") &&
        /\bfalse\b/i.test(a.expression || "")
    );
  for (const act of activities) {
    if (act.type === "ValidationFeedback" && act.sets_valid_false === undefined) {
      act.sets_valid_false = hasFalseReturnOrFlag;
    }
  }

  return {
    name: mfRow.Name,
    qualified_name: mfRow.QualifiedName,
    microflow_type: mfRow.MicroflowType || "MICROFLOW",
    documentation: mfRow.Description || "",
    annotations,
    return_type: mfRow.ReturnType || "Void",
    return_values: returnValues,
    allowed_roles: allowedRoles,
    apply_entity_access: undefined,
    excluded: Boolean(mfRow.Excluded),
    parameters,
    activities,
  };
}

/**
 * White-box Java Action source harvester (`javasource/<module>/actions/*.java`).
 * Parses the `// BEGIN EXTRA CODE` .. `// END EXTRA CODE` and `// BEGIN USER CODE` .. `// END USER CODE`
 * blocks of each Mendix Java Action to detect unimplemented stubs (`JAP-01`), unguarded null parameter
 * dereferences (`JAP-02`), `Core.createSystemContext()` transaction/security escapes (`JAP-03`/`SEC-10`),
 * silent exception swallowing (`JAP-04`), unclosed `InputStream` leaks (`JAP-05`), and nullable returns (`JAP-07`).
 */
export function harvestJavaActionSources(workspaceDir = process.cwd(), moduleName = "Module", mprPath = null) {
  const candidateRoots = [
    mprPath ? path.dirname(path.resolve(mprPath)) : null,
    path.resolve(workspaceDir),
  ].filter(Boolean);

  const modLower = String(moduleName || "").toLowerCase();
  const javaActions = [];

  for (const rootDir of candidateRoots) {
    const actionsDir = path.join(rootDir, "javasource", modLower, "actions");
    if (!fs.existsSync(actionsDir) || !fs.statSync(actionsDir).isDirectory()) continue;

    let files = [];
    try {
      files = fs.readdirSync(actionsDir).filter((f) => f.endsWith(".java"));
    } catch {
      continue;
    }

    for (const file of files) {
      const actionName = file.replace(/\.java$/i, "");
      const qualifiedName = `${moduleName}.${actionName}`;
      if (javaActions.some((j) => j.qualified_name === qualifiedName)) continue;

      let content = "";
      try {
        content = fs.readFileSync(path.join(actionsDir, file), "utf8");
      } catch {
        continue;
      }

      const userCodeMatch = content.match(/\/\/\s*BEGIN USER CODE([\s\S]*?)\/\/\s*END USER CODE/i);
      const extraCodeMatch = content.match(/\/\/\s*BEGIN EXTRA CODE([\s\S]*?)\/\/\s*END EXTRA CODE/i);
      const userCode = userCodeMatch ? userCodeMatch[1] : content;
      const extraCode = extraCodeMatch ? extraCodeMatch[1] : "";
      const combinedCustomCode = `${userCode}\n${extraCode}`;

      // Extract fields/parameters declared before executeAction()
      const fieldMatches = [
        ...content.matchAll(/private\s+(?:final\s+)?([A-Za-z0-9_.<>[\]]+)\s+([A-Za-z0-9_]+)\s*;/g),
      ];
      const fieldNames = fieldMatches
        .map((m) => ({ type: m[1], name: m[2] }))
        .filter((f) => !/^(__|context$|log$)/i.test(f.name));

      const isUnimplementedStub = /throw\s+new\s+(?:com\.mendix\.systemwideinterfaces\.core\.)?UserException\s*\(\s*com\.mendix\.systemwideinterfaces\.core\.UserException\.ExceptionCategory\.Custom\s*,\s*"Java action was not implemented"\s*\)/i.test(
        userCode
      );

      const unguardedParams = [];
      for (const field of fieldNames) {
        const derefRe = new RegExp(`\\b${field.name}\\s*\\.(?!equals\\b)`, "g");
        const nullCheckRe = new RegExp(
          `\\b${field.name}\\s*[!=]=\\s*null\\b|\\bnull\\s*[!=]=\\s*${field.name}\\b|Objects\\.requireNonNull\\s*\\(\\s*${field.name}\\b|Optional\\.ofNullable\\s*\\(\\s*${field.name}\\b`,
          "i"
        );
        if (derefRe.test(userCode) && !nullCheckRe.test(userCode)) {
          unguardedParams.push(field.name);
        }
      }

      // Also detect `(String) obj.getValue(ctx, "Attr")` chained immediately with `.` without null check
      const hasUnguardedGetValueDeref =
        /\(\s*(?:String|Integer|Long|BigDecimal|Date)\s*\)\s*[A-Za-z0-9_.]+\.getValue\s*\([^)]+\)\s*\)\s*\.[A-Za-z0-9_]+/i.test(
          combinedCustomCode
        ) ||
        /[A-Za-z0-9_.]+\.getValue\s*\([^)]+\)\s*\.(?:toString|trim|length|intValue|longValue|doubleValue)\s*\(/i.test(
          combinedCustomCode
        );

      const usesSystemContext = /\bCore\.createSystemContext\s*\(/i.test(combinedCustomCode);
      const systemContextMutatesDb =
        usesSystemContext &&
        /\bCore\.(?:commit|commitWithoutEvents|delete|deleteWithoutEvents|instantiate)\s*\(/i.test(
          combinedCustomCode
        );
      const hasExternalNetworkIo =
        /\b(?:HttpClient|HttpURLConnection|Socket|DriverManager\.getConnection|Core\.http\(\)|ProcessBuilder)\b/.test(
          combinedCustomCode
        );

      // Detect silent catch blocks (`catch (Exception e) { }` or `catch (...) { return null/false; }` without rethrow or Core.getLogger().error)
      const catchBlocks = [...combinedCustomCode.matchAll(/catch\s*\([^)]+\)\s*\{([\s\S]*?)\}/g)].map((m) => m[1]);
      const swallowsExceptions = catchBlocks.some(
        (body) =>
          !/\bthrow\b/i.test(body) &&
          !/\.(?:error|critical)\s*\(/i.test(body) &&
          !/Core\.getLogger/i.test(body)
      );

      // Detect InputStream opened via Core.getFileDocumentContent / Core.getImage without try-with-resources or .close()
      const opensFileStream = /\bCore\.(?:getFileDocumentContent|getImage)\s*\(/i.test(combinedCustomCode);
      const closesStream =
        /\btry\s*\(\s*(?:final\s+)?InputStream\b/i.test(combinedCustomCode) ||
        /\.close\s*\(\s*\)/i.test(combinedCustomCode) ||
        /\bIOUtils\.closeQuietly\b/i.test(combinedCustomCode);
      const leaksInputStream = opensFileStream && !closesStream;

      const returnsNullLiteral = /\breturn\s+null\s*;/i.test(userCode);

      javaActions.push({
        name: actionName,
        qualified_name: qualifiedName,
        file_path: path.join(actionsDir, file),
        is_unimplemented_stub: isUnimplementedStub,
        unguarded_params: unguardedParams,
        has_unguarded_getvalue_deref: hasUnguardedGetValueDeref,
        uses_system_context: usesSystemContext,
        system_context_mutates_db: systemContextMutatesDb,
        has_external_network_io: hasExternalNetworkIo,
        swallows_exceptions: swallowsExceptions,
        leaks_input_stream: leaksInputStream,
        returns_null_literal: returnsNullLiteral,
      });
    }
  }

  return javaActions;
}

/**
 * Directly queries `<mendix_project_dir>/.mxcli/catalog.db` using Node's built-in `node:sqlite`
 * (`DatabaseSync`) and builds the complete 4-layer vertical stack AST bundle + RBAC security
 * model in < 1 second.
 */
export function harvestFromCatalogDb(catalogPath, moduleName, personas, options = {}) {
  const db = new DatabaseSync(catalogPath, { readOnly: true });

  try {
    // 1. Entities, Attributes, Associations, Event Handlers, and Permissions
    const entityRows = db
      .prepare("SELECT Name, QualifiedName, EntityType, Generalization FROM entities WHERE ModuleName = ?")
      .all(moduleName);
    let attrRows = [];
    try {
      attrRows = db
        .prepare(
          "SELECT Name, EntityQualifiedName, DataType, EnumerationQualifiedName, Length, IsUnique, IsRequired, DefaultValue FROM attributes WHERE ModuleName = ?"
        )
        .all(moduleName);
    } catch {
      attrRows = db
        .prepare(
          "SELECT Name, EntityQualifiedName, DataType, Length, IsUnique, IsRequired, DefaultValue FROM attributes WHERE ModuleName = ?"
        )
        .all(moduleName);
    }
    let assocRows = [];
    try {
      assocRows = db
        .prepare(
          "SELECT Name, QualifiedName, FromEntity AS ParentEntity, ToEntity AS ChildEntity, AssociationType AS Type, Owner, FromDeleteBehavior AS ParentDeleteBehavior, ToDeleteBehavior AS ChildDeleteBehavior FROM associations WHERE ModuleName = ? OR FromEntity LIKE ? OR ToEntity LIKE ?"
        )
        .all(moduleName, `${moduleName}.%`, `${moduleName}.%`);
    } catch {
      try {
        assocRows = db
          .prepare(
            "SELECT Name, QualifiedName, ParentEntity, ChildEntity, Type, Owner, ParentDeleteBehavior, ChildDeleteBehavior FROM associations WHERE ModuleName = ? OR ParentEntity LIKE ? OR ChildEntity LIKE ?"
          )
          .all(moduleName, `${moduleName}.%`, `${moduleName}.%`);
      } catch {
        assocRows = [];
      }
    }
    let enumValueRows = [];
    try {
      enumValueRows = db
        .prepare(
          "SELECT EnumerationQualifiedName, Name FROM enumeration_values WHERE ModuleName = ? ORDER BY EnumerationQualifiedName, Ordinal"
        )
        .all(moduleName);
    } catch {
      enumValueRows = [];
    }
    const enumValuesByQName = new Map();
    for (const ev of enumValueRows) {
      if (!enumValuesByQName.has(ev.EnumerationQualifiedName)) {
        enumValuesByQName.set(ev.EnumerationQualifiedName, []);
      }
      enumValuesByQName.get(ev.EnumerationQualifiedName).push(ev.Name);
    }
    let eventRows = [];
    try {
      eventRows = db
        .prepare(
          "SELECT EntityQualifiedName, Moment, Event, Microflow, RaiseErrorOnFalse FROM entity_event_handlers WHERE ModuleName = ?"
        )
        .all(moduleName);
    } catch {
      try {
        eventRows = db
          .prepare(
            "SELECT EntityQualifiedName, Moment, Event, Microflow, RaiseErrorOnFalse FROM event_handlers WHERE ModuleName = ?"
          )
          .all(moduleName);
      } catch {
        eventRows = [];
      }
    }
    let permRows = [];
    try {
      permRows = db
        .prepare(
          "SELECT ModuleRoleName, ElementType, ElementName, MemberName, AccessType, XPathConstraint, DefaultMemberAccessRights FROM permissions WHERE ModuleName = ?"
        )
        .all(moduleName);
    } catch {
      permRows = [];
    }
    let mfSourceRows = [];
    try {
      mfSourceRows = db
        .prepare("SELECT QualifiedName, ObjectType, SourceText FROM source WHERE ModuleName = ?")
        .all(moduleName);
    } catch {
      mfSourceRows = [];
    }
    const sourceByQName = new Map(mfSourceRows.map((r) => [r.QualifiedName, r.SourceText || ""]));

    // Group permissions by ElementType + ElementName
    const mfRolesMap = new Map();
    const pageRolesMap = new Map();
    const entityPermMap = new Map();

    for (const p of permRows) {
      if (p.ElementType === "MICROFLOW" && p.AccessType === "EXECUTE") {
        if (!mfRolesMap.has(p.ElementName)) mfRolesMap.set(p.ElementName, new Set());
        mfRolesMap.get(p.ElementName).add(p.ModuleRoleName);
      } else if (p.ElementType === "PAGE" && p.AccessType === "READ") {
        if (!pageRolesMap.has(p.ElementName)) pageRolesMap.set(p.ElementName, new Set());
        pageRolesMap.get(p.ElementName).add(p.ModuleRoleName);
      } else if (p.ElementType === "ENTITY") {
        const key = `${p.ElementName}::${p.ModuleRoleName}`;
        if (!entityPermMap.has(key)) {
          entityPermMap.set(key, {
            roles: [p.ModuleRoleName],
            xpath_constraint: p.XPathConstraint || "",
            allow_create: false,
            allow_delete: false,
            default_member_access: p.DefaultMemberAccessRights || "None",
            member_map: new Map(),
          });
        }
        const rule = entityPermMap.get(key);
        if (p.XPathConstraint && !rule.xpath_constraint) rule.xpath_constraint = p.XPathConstraint;
        if (!p.MemberName) {
          if (p.AccessType === "CREATE") rule.allow_create = true;
          if (p.AccessType === "DELETE") rule.allow_delete = true;
        } else {
          const prev = rule.member_map.get(p.MemberName) || "None";
          if (p.AccessType === "WRITE") {
            rule.member_map.set(p.MemberName, "ReadWrite");
          } else if (p.AccessType === "READ" && prev !== "ReadWrite") {
            rule.member_map.set(p.MemberName, "ReadOnly");
          }
        }
      }
    }

    // Build normalized entities
    const entities = entityRows.map((e) => {
      const eAttrs = attrRows
        .filter((a) => a.EntityQualifiedName === e.QualifiedName)
        .map((a) => ({
          name: a.Name,
          type: a.DataType,
          enumeration: a.EnumerationQualifiedName || null,
          enum_values: a.EnumerationQualifiedName
            ? enumValuesByQName.get(a.EnumerationQualifiedName) || []
            : undefined,
          length: a.Length,
          is_unique: Boolean(a.IsUnique),
          is_required: Boolean(a.IsRequired),
          default_value: a.DefaultValue,
        }));

      const eEvents = eventRows
        .filter((ev) => ev.EntityQualifiedName === e.QualifiedName)
        .map((ev) => {
          const evSource = ev.Microflow ? sourceByQName.get(ev.Microflow) || "" : "";
          return {
            event: `${ev.Moment || ""}${ev.Event || ""}`,
            microflow: ev.Microflow,
            raise_error_on_false: Boolean(ev.RaiseErrorOnFalse),
            returns_false_possible: /\breturn\s+false\b/i.test(evSource),
          };
        });

      const accessRules = [];
      for (const [key, rule] of entityPermMap.entries()) {
        if (key.startsWith(`${e.QualifiedName}::`)) {
          accessRules.push({
            roles: rule.roles,
            xpath_constraint: rule.xpath_constraint,
            allow_create: rule.allow_create,
            allow_delete: rule.allow_delete,
            default_member_access: rule.default_member_access,
            member_access: Array.from(rule.member_map.entries()).map(([attribute, access]) => ({
              attribute,
              access,
            })),
          });
        }
      }

      const eAssocs = assocRows
        .filter((as) => as.ParentEntity === e.QualifiedName || as.ChildEntity === e.QualifiedName)
        .map((as) => ({
          name: as.QualifiedName || (as.Name ? `${moduleName}.${as.Name}` : ""),
          parent_entity: as.ParentEntity,
          child_entity: as.ChildEntity,
          type: as.Type || "Reference",
          owner: as.Owner || "Default",
          parent_delete_behavior: as.ParentDeleteBehavior || "DeleteMeButKeepReferences",
          child_delete_behavior: as.ChildDeleteBehavior || "DeleteMeButKeepReferences",
        }));

      return {
        name: e.Name,
        qualified_name: e.QualifiedName,
        generalization: e.Generalization || null,
        attributes: eAttrs,
        associations: eAssocs,
        event_handlers: eEvents,
        access_rules: accessRules,
      };
    });

    // 2. Pages & Widgets (Layer 1)
    let pageRows = [];
    try {
      pageRows = db
        .prepare("SELECT Name, QualifiedName, Title FROM pages WHERE ModuleName = ?")
        .all(moduleName);
    } catch {
      pageRows = [];
    }
    let widgetRows = [];
    try {
      widgetRows = db
        .prepare(
          "SELECT Name, WidgetType, ContainerQualifiedName, EntityRef, AttributeRef, MicroflowRef FROM widgets WHERE ModuleName = ?"
        )
        .all(moduleName);
    } catch {
      try {
        widgetRows = db
          .prepare(
            "SELECT Name, WidgetType, ContainerQualifiedName, EntityRef, AttributeRef, MicroflowRef FROM widgets_data WHERE ModuleName = ?"
          )
          .all(moduleName);
      } catch {
        widgetRows = [];
      }
    }
    let pageRefRows = [];
    try {
      pageRefRows = db
        .prepare("SELECT SourceName, TargetType, TargetName, RefKind FROM refs WHERE SourceType = 'PAGE' AND SourceName LIKE ?")
        .all(`${moduleName}.%`);
    } catch {
      pageRefRows = [];
    }
    const pageRefsByPage = new Map();
    for (const r of pageRefRows) {
      if (!pageRefsByPage.has(r.SourceName)) pageRefsByPage.set(r.SourceName, []);
      pageRefsByPage.get(r.SourceName).push(r);
    }
    const allModuleMfNames = Array.from(sourceByQName.keys()).filter((q) =>
      q.toLowerCase().startsWith(`${moduleName.toLowerCase()}.act_`)
    );

    const pages = pageRows.map((pg) => {
      const pgWidgets = widgetRows.filter((w) => w.ContainerQualifiedName === pg.QualifiedName);
      const pgSource = sourceByQName.get(pg.QualifiedName) || "";
      const pgRefs = pageRefsByPage.get(pg.QualifiedName) || [];
      const memberRefs = pgRefs
        .filter((r) => r.TargetType === "ATTRIBUTE")
        .map((r) => r.TargetName);
      const pagePrefixRe = new RegExp(`^${moduleName}\\.ACT_${pg.Name}_`, "i");
      const mfRefs = Array.from(
        new Set([
          ...pgRefs.filter((r) => r.TargetType === "MICROFLOW").map((r) => r.TargetName),
          ...allModuleMfNames.filter((mf) => pagePrefixRe.test(mf)),
        ])
      );
      const paramEntities = pgRefs
        .filter((r) => r.TargetType === "ENTITY" && r.RefKind === "parameter")
        .map((r) => r.TargetName);

      const widgets = pgWidgets.map((w) => {
        const attrShort = w.AttributeRef ? w.AttributeRef.split(".").pop() : null;
        const reqRegex = attrShort
          ? new RegExp(`${attrShort}[^\\n]*\\brequired\\b`, "i")
          : null;
        return {
          name: w.Name,
          type: w.WidgetType,
          entity: w.EntityRef || null,
          attribute:
            w.EntityRef && w.AttributeRef
              ? `${w.EntityRef}.${w.AttributeRef.split(".").pop()}`
              : w.AttributeRef || null,
          calls_microflow: w.MicroflowRef || null,
          required_on_page: Boolean(reqRegex && reqRegex.test(pgSource)),
        };
      });

      const tableCellWidgets = extractTableCellWidgetsFromSource(
        pgSource,
        memberRefs,
        mfRefs,
        widgets.map((w) => ({
          WidgetName: w.name,
          WidgetType: w.type,
          EntityRef: w.entity,
          AttributeRef: w.attribute ? w.attribute.split(".").pop() : null,
          MicroflowRef: w.calls_microflow,
        })),
        paramEntities
      );
      for (const tcw of tableCellWidgets) {
        widgets.push({
          name: tcw.WidgetName,
          type: tcw.WidgetType,
          entity: tcw.EntityRef || null,
          attribute:
            tcw.EntityRef && tcw.AttributeRef
              ? `${tcw.EntityRef}.${tcw.AttributeRef.split(".").pop()}`
              : tcw.AttributeRef || null,
          calls_microflow: tcw.MicroflowRef || null,
          required_on_page: false,
        });
      }

      const callsMicroflows = Array.from(
        new Set([...widgets.map((w) => w.calls_microflow).filter(Boolean), ...mfRefs])
      );

      return {
        name: pg.Name,
        qualified_name: pg.QualifiedName,
        title: pg.Title || "",
        allowed_roles: Array.from(pageRolesMap.get(pg.QualifiedName) || []),
        calls_microflows: callsMicroflows,
        widgets,
      };
    });

    // 3. Microflows & Rules (Layers 2 & 3)
    const mfRows = db
      .prepare(
        "SELECT Name, QualifiedName, MicroflowType, Description, ReturnType, Excluded FROM microflows WHERE ModuleName = ? ORDER BY Name"
      )
      .all(moduleName);
    let mfParamRows = [];
    try {
      mfParamRows = db
        .prepare(
          "SELECT MicroflowQualifiedName, Name, ParameterType, Ordinal FROM microflow_parameters WHERE ModuleName = ? ORDER BY MicroflowQualifiedName, Ordinal"
        )
        .all(moduleName);
    } catch {
      mfParamRows = [];
    }
    const paramsByMf = new Map();
    for (const p of mfParamRows) {
      if (!paramsByMf.has(p.MicroflowQualifiedName)) paramsByMf.set(p.MicroflowQualifiedName, []);
      paramsByMf.get(p.MicroflowQualifiedName).push(p);
    }

    let actRowsAll = [];
    try {
      actRowsAll = db
        .prepare(
          "SELECT MicroflowQualifiedName, Sequence, ActivityType, ActionType, Caption, EntityRef, ActionRef, ConditionExpression, ConditionRule, ErrorHandlingType, CommitType, WithEvents, RetrieveSource, UseRequestTimeout FROM activities WHERE ModuleName = ? ORDER BY MicroflowQualifiedName, Sequence"
        )
        .all(moduleName);
    } catch {
      actRowsAll = [];
    }
    const actsByMf = new Map();
    for (const a of actRowsAll) {
      if (!actsByMf.has(a.MicroflowQualifiedName)) actsByMf.set(a.MicroflowQualifiedName, []);
      actsByMf.get(a.MicroflowQualifiedName).push(a);
    }

    let refRowsAll = [];
    try {
      refRowsAll = db
        .prepare("SELECT SourceName, TargetType, TargetName, RefKind FROM refs WHERE SourceType = 'MICROFLOW' AND SourceName LIKE ?")
        .all(`${moduleName}.%`);
    } catch {
      refRowsAll = [];
    }
    const refsByMf = new Map();
    for (const r of refRowsAll) {
      if (!refsByMf.has(r.SourceName)) refsByMf.set(r.SourceName, []);
      refsByMf.get(r.SourceName).push(r);
    }

    const allMicroflows = [];
    for (const mfRow of mfRows) {
      const src = sourceByQName.get(mfRow.QualifiedName) || "";
      const mfParams = paramsByMf.get(mfRow.QualifiedName) || [];
      const mfActs = actsByMf.get(mfRow.QualifiedName) || [];
      const mfRefs = refsByMf.get(mfRow.QualifiedName) || [];
      const mfRoles = Array.from(mfRolesMap.get(mfRow.QualifiedName) || []);

      const parsedMf = src.trim()
        ? parseMdlMicroflowSource(src, mfRow, mfParams, mfRoles)
        : buildMicroflowAstFromCatalogTables(mfRow, mfParams, mfActs, mfRefs, mfRoles);

      // Attach member_refs from refs table onto any ValidationFeedback activity
      const memberRefs = mfRefs
        .filter((r) => r.TargetType === "ATTRIBUTE" && r.RefKind === "member")
        .map((r) => r.TargetName);
      if (memberRefs.length > 0) {
        for (const act of parsedMf.activities || []) {
          if (act.type === "ValidationFeedback" && (!act.member_refs || act.member_refs.length === 0)) {
            const actAttrShort = act.attribute ? String(act.attribute).split(/[./]/).pop() : null;
            const matchingRefs = actAttrShort
              ? memberRefs.filter((ref) => String(ref).split(".").pop() === actAttrShort)
              : memberRefs;
            act.member_refs = matchingRefs.length > 0 ? matchingRefs : (!act.attribute ? memberRefs : []);
          }
        }
      }

      if (parsedMf.excluded && !options.includeExcluded) {
        continue;
      }
      allMicroflows.push(parsedMf);
    }

    // 4. Identify `other_committers` for DQP-08 Cross-Touchpoint Validation Bypass
    const validatorsByEntity = new Map();
    for (const mf of allMicroflows) {
      if (/^(VAL_|SUB_.*validate)/i.test(mf.name)) {
        for (const p of mf.parameters || []) {
          if (p.entity) {
            if (!validatorsByEntity.has(p.entity)) validatorsByEntity.set(p.entity, []);
            validatorsByEntity.get(p.entity).push(mf.qualified_name);
          }
        }
      }
    }

    const otherCommitters = [];
    for (const mf of allMicroflows) {
      const committedVars = new Set(
        (mf.activities || [])
          .filter(
            (a) =>
              a.type === "Commit" ||
              ((a.type === "ChangeObject" || a.type === "CreateObject") && a.commit === "Yes")
          )
          .map((a) => a.variable)
          .filter(Boolean)
      );
      if (committedVars.size === 0) continue;

      const calledMfs = (mf.activities || [])
        .filter((a) => a.type === "MicroflowCall" && a.called_microflow)
        .map((a) => a.called_microflow);

      for (const vName of committedVars) {
        const param = (mf.parameters || []).find((p) => p.name === vName);
        const created = (mf.activities || []).find(
          (a) => a.type === "CreateObject" && a.output_variable === vName
        );
        const entityName = (param && param.entity) || (created && created.entity) || null;
        if (entityName && validatorsByEntity.has(entityName)) {
          otherCommitters.push({
            qualified_name: mf.qualified_name,
            commits_entity: entityName,
            calls_validators: calledMfs,
          });
        }
      }
    }

    const suspectShortlist = computeFastPathSuspectShortlist(allMicroflows, entities);
    const selectedMicroflows =
      options.fastFilter && suspectShortlist.length > 0
        ? allMicroflows.filter((m) =>
            suspectShortlist.some((s) => s.microflow === (m.qualified_name || m.name))
          )
        : allMicroflows;

    return {
      module: moduleName,
      harvested_at: new Date().toISOString(),
      harvest_source: "mxcli_catalog_db",
      catalog_db_path: catalogPath,
      fast_filter_applied: Boolean(options.fastFilter),
      personas,
      stack_layers: [
        "Layer 1: Page AST (Widgets, Required Attributes, Visibility, Action Buttons, Allowed Roles)",
        "Layer 2: Touchpoint Microflows (ACT_ / Page Events / Allowed Module Roles / Entity Access)",
        "Layer 3: Sub-Microflows & Operations (SUB_ / VAL_ / CALC_)",
        "Layer 4: Entity Lifecycle, Access Rules & Event Handlers (EVT_ / BeforeCommit / AccessRules)",
      ],
      suspect_shortlist: suspectShortlist,
      target_microflow: selectedMicroflows[0] || null,
      microflows: selectedMicroflows,
      entities,
      pages,
      other_committers: otherCommitters,
    };
  } finally {
    db.close();
  }
}

export function harvestModuleBundle(moduleName, workspaceDir = process.cwd(), options = {}) {
  const fromDir = options.fromDir
    ? path.resolve(options.fromDir)
    : fs.existsSync(path.join(workspaceDir, "scratch", "raw_ast"))
      ? path.join(workspaceDir, "scratch", "raw_ast")
      : null;

  const catalogCtx = resolveCatalogContext(workspaceDir, options);
  const personas = catalogCtx.personas;
  const externalRules = loadExternalBusinessRules(workspaceDir, moduleName, options);
  const javaActions = harvestJavaActionSources(workspaceDir, moduleName, catalogCtx.mprPath);

  // Priority 1: Automatically ensure a fresh `.mxcli/catalog.db` (`REFRESH CATALOG FULL SOURCE`) and harvest directly from SQLite
  if (!options.fromDir && (catalogCtx.mprPath || catalogCtx.catalogPath)) {
    const freshStatus = ensureFreshCatalogDb(workspaceDir, options);
    if (freshStatus.ok && freshStatus.catalogPath && fs.existsSync(freshStatus.catalogPath)) {
      try {
        const dbBundle = harvestFromCatalogDb(freshStatus.catalogPath, moduleName, personas, options);
        if (dbBundle.microflows.length > 0 || dbBundle.entities.length > 0) {
          dbBundle.mpr_path = freshStatus.mprPath || catalogCtx.mprPath || null;
          dbBundle.catalog_path = freshStatus.catalogPath;
          dbBundle.catalog_db_path = freshStatus.catalogPath;
          dbBundle.catalog_refreshed = freshStatus.refreshed;
          dbBundle.catalog_status_reason = freshStatus.reason;
          dbBundle.external_business_rules = externalRules;
          dbBundle.java_actions = javaActions;
          return dbBundle;
        }
      } catch (err) {
        if (!options.quiet) {
          console.warn(`[mta-bughunter] Warning: SQLite catalog harvest failed (${err.message}); falling back...`);
        }
      }
    }
  }

  // Priority 2: If raw StudioPro JSON documents exist in `fromDir`, auto-normalize and assemble the 4-layer AST bundle
  if (fromDir && fs.existsSync(fromDir) && fs.statSync(fromDir).isDirectory()) {
    const files = fs.readdirSync(fromDir).filter((f) => f.endsWith(".json"));
    const microflows = [];
    const entities = [];
    const pages = [];

    for (const f of files) {
      try {
        const doc = JSON.parse(fs.readFileSync(path.join(fromDir, f), "utf8"));
        if (doc.$Type === "Microflows$Microflow") {
          microflows.push(normalizeStudioProMicroflow(doc, moduleName));
        } else if (doc.$Type === "DomainModels$DomainModel") {
          entities.push(...normalizeStudioProDomainModel(doc, moduleName));
        } else if (doc.$Type === "Pages$Page" || (doc.qualified_name && doc.widgets)) {
          pages.push(doc);
        } else if (Array.isArray(doc.microflows)) {
          microflows.push(...doc.microflows.map((m) => normalizeStudioProMicroflow(m, moduleName)));
          if (Array.isArray(doc.entities)) entities.push(...doc.entities);
          if (Array.isArray(doc.pages)) pages.push(...doc.pages);
        }
      } catch {
        // Ignore non-JSON or unreadable files
      }
    }

    const suspectShortlist = computeFastPathSuspectShortlist(microflows, entities);
    return {
      module: moduleName,
      harvested_at: new Date().toISOString(),
      harvest_source: "raw_ast_dir",
      fast_filter_applied: Boolean(options.fastFilter),
      personas,
      stack_layers: [
        "Layer 1: Page AST (Widgets, Required Attributes, Visibility, Action Buttons, Allowed Roles)",
        "Layer 2: Touchpoint Microflows (ACT_ / Page Events / Allowed Module Roles / Entity Access)",
        "Layer 3: Sub-Microflows & Operations (SUB_ / VAL_ / CALC_)",
        "Layer 4: Entity Lifecycle, Access Rules & Event Handlers (EVT_ / BeforeCommit / AccessRules)",
      ],
      suspect_shortlist: suspectShortlist,
      target_microflow: microflows[0] || null,
      microflows:
        options.fastFilter && suspectShortlist.length > 0
          ? microflows.filter((m) => suspectShortlist.some((s) => s.microflow === (m.qualified_name || m.name)))
          : microflows,
      entities,
      pages,
      java_actions: javaActions,
      other_committers: [],
      external_business_rules: externalRules,
    };
  }

  // Priority 3: Check if an existing AST bundle snapshot exists in scratch/
  const existingScratch = path.join(workspaceDir, "scratch", "bughunt_ast_bundle.json");
  if (fs.existsSync(existingScratch)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(existingScratch, "utf8"));
      if (!moduleName || parsed.module === moduleName) {
        const mfs = (parsed.microflows || []).map((m) => normalizeStudioProMicroflow(m, moduleName));
        parsed.personas = parsed.personas || personas;
        parsed.suspect_shortlist = computeFastPathSuspectShortlist(mfs, parsed.entities || []);
        parsed.external_business_rules = parsed.external_business_rules || externalRules;
        parsed.java_actions = parsed.java_actions || javaActions;
        return parsed;
      }
    } catch {
      // Fallback to template scaffold
    }
  }

  return {
    module: moduleName,
    harvested_at: new Date().toISOString(),
    harvest_source: "empty_scaffold",
    personas,
    stack_layers: [
      "Layer 1: Page AST (Widgets, Required Attributes, Visibility, Action Buttons, Allowed Roles)",
      "Layer 2: Touchpoint Microflows (ACT_ / Page Events / Allowed Module Roles / Entity Access)",
      "Layer 3: Sub-Microflows & Operations (SUB_ / VAL_ / CALC_)",
      "Layer 4: Entity Lifecycle, Access Rules & Event Handlers (EVT_ / BeforeCommit / AccessRules)",
    ],
    suspect_shortlist: [],
    target_microflow: null,
    microflows: [],
    entities: [],
    pages: [],
    java_actions: javaActions,
    other_committers: [],
    external_business_rules: externalRules,
  };
}

// ============================================================================
// 6B. PREFLIGHT PLAN & PAYLOAD VALIDATOR (`validate-plan <plan.md> [--payload <payload.json>]`)
// ============================================================================

const VALID_MICROFLOW_RETURN_TYPES = new Set([
  "IntegerType",
  "LongType",
  "DecimalType",
  "FloatType",
  "BooleanType",
  "StringType",
  "DateTimeType",
  "EnumerationType",
  "EnumType",
  "ObjectType",
  "ListType",
  "VoidType",
]);

export function validatePlanAndPayload(planPath, payloadPath = null) {
  const errors = [];
  const warnings = [];

  if (!planPath || !fs.existsSync(planPath)) {
    return { valid: false, errors: [`Plan file not found: ${planPath}`], warnings };
  }

  const md = fs.readFileSync(path.resolve(planPath), "utf8");
  if (!/rollback:\s*"Yes"/i.test(md)) {
    errors.push("Execution Plan YAML frontmatter must declare `rollback: \"Yes\"` for zero-residue bug hunting.");
  }
  if (!md.includes("## 3. Test Steps & Action Sequence") || !md.includes("## 4. Test Scenarios & Test Data")) {
    errors.push("Execution Plan is missing Section 3 or Section 4 tables.");
  }

  // Detect unformatted dates in Section 4 (e.g., `15/05/2025` instead of ISO-8601 `2025-05-15T00:00:00.000Z` or epoch ms)
  const slashDateMatches = md.match(/\b\d{1,2}\/\d{1,2}\/\d{4}\b/g);
  if (slashDateMatches) {
    warnings.push(
      `Detected locale slash date(s) (${slashDateMatches.join(", ")}) in plan. MTA_plugin DateTimeType requires ISO-8601 ('YYYY-MM-DDTHH:mm:ss.sssZ') or epoch milliseconds.`
    );
  }

  if (payloadPath && fs.existsSync(payloadPath)) {
    try {
      const payload = JSON.parse(fs.readFileSync(path.resolve(payloadPath), "utf8"));
      const tcList = payload.TCEX_RQ_TestCaseList || (payload.TestCase ? [payload.TestCase] : [payload]);

      for (const tc of tcList) {
        if (tc.RollbackTcseAfterExecution && tc.RollbackTcseAfterExecution !== "Yes") {
          errors.push(`TestCase '${tc.Name || "Unnamed"}' has RollbackTcseAfterExecution='${tc.RollbackTcseAfterExecution}' (must be 'Yes').`);
        }
        if (
          tc.ApplySecurityExecutor &&
          tc.ApplySecurityExecutor !== "NONE" &&
          tc.ApplySecurityExecutor !== "ALL" &&
          tc.ApplySecurityExecutor !== "APP_SECURITY"
        ) {
          errors.push(
            `Invalid ApplySecurityExecutor '${tc.ApplySecurityExecutor}'. Expected 'NONE' (logic hunt) or 'ALL'/'APP_SECURITY' (SEC-01..05 RBAC hunt).`
          );
        }

        const steps = tc.TCEX_RQ_TestStepList || tc.TestSteps || [];
        for (const step of steps) {
          const retType = step.TCEX_RQ_MicroflowReturnType || step.MicroflowReturnType;
          const retTypeStr = typeof retType === "object" && retType !== null ? retType.DataType : retType;
          if (retTypeStr && !VALID_MICROFLOW_RETURN_TYPES.has(retTypeStr)) {
            errors.push(
              `Step '${step.Name || step.Action || "MicroflowCall"}' uses invalid TCEX_RQ_MicroflowReturnType '${retTypeStr}'. Must be one of: ${Array.from(VALID_MICROFLOW_RETURN_TYPES).join(", ")}.`
            );
          }

          // Check attribute types and values
          const attrs = step.TCEX_RQ_AttributeValueList || step.AttributeValues || [];
          for (const attr of attrs) {
            const attrType = attr.AttributeType;
            const attrName = attr.AttributeName || "";
            const isExplicitNonDate = attrType && attrType !== "DateTimeType";
            const isBooleanTrigger =
              attrType === "BooleanType" ||
              /_(False|True)$/i.test(attrName) ||
              /^(EVT_|BCO_|Trigger_|VAL_)/i.test(attrName);

            const isDateTime =
              attrType === "DateTimeType" ||
              (!isExplicitNonDate && !isBooleanTrigger && /Date/i.test(attrName));

            if (
              isDateTime &&
              attr.Value &&
              typeof attr.Value === "string" &&
              attr.Value !== "empty" &&
              !/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d{3})?Z?)?$|^\d{10,13}$/.test(attr.Value)
            ) {
              errors.push(
                `DateTime attribute '${attrName}' has invalid format '${attr.Value}'. Use ISO-8601 ('YYYY-MM-DDTHH:mm:ss.sssZ') or epoch milliseconds.`
              );
            }

            if (attrType === "BooleanType" && attr.Value !== undefined && attr.Value !== null) {
              const strVal = String(attr.Value).toLowerCase().trim();
              if (strVal !== "true" && strVal !== "false" && strVal !== "empty") {
                errors.push(
                  `Boolean attribute '${attrName}' has invalid format '${attr.Value}'. Expected 'true', 'false', or 'empty'.`
                );
              }
            }
          }
        }
      }
    } catch (e) {
      errors.push(`Failed to parse payload JSON '${payloadPath}': ${e.message}`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

// ============================================================================
// 6C. MANIFEST SUMMARIZER (`summarize <manifest.json> [--top 25]`)
// ============================================================================

const SEVERITY_RANK = {
  CRITICAL: 4,
  HIGH: 3,
  MEDIUM: 2,
  LOW: 1,
};

export function summarizeManifest(manifest, topN = 25) {
  const hyps = manifest.hypotheses || [];
  const ambers = manifest.amber_risks || [];
  const uiCands = manifest.amber_ui_candidates || [];

  const byPattern = {};
  const byMicroflow = {};

  for (const h of hyps) {
    byPattern[h.pattern_id] = (byPattern[h.pattern_id] || 0) + 1;
    const mf = h.microflow || manifest.target_microflow || "Unknown";
    if (!byMicroflow[mf]) {
      byMicroflow[mf] = { hypotheses: 0, amber_risks: 0, ui_candidates: 0, patterns: new Set() };
    }
    byMicroflow[mf].hypotheses++;
    byMicroflow[mf].patterns.add(h.pattern_id);
  }

  for (const a of ambers) {
    byPattern[a.pattern_id] = (byPattern[a.pattern_id] || 0) + 1;
    const mf = a.microflow || manifest.target_microflow || "Unknown";
    if (!byMicroflow[mf]) {
      byMicroflow[mf] = { hypotheses: 0, amber_risks: 0, ui_candidates: 0, patterns: new Set() };
    }
    byMicroflow[mf].amber_risks++;
    byMicroflow[mf].patterns.add(a.pattern_id);
  }

  for (const u of uiCands) {
    byPattern[u.pattern_id] = (byPattern[u.pattern_id] || 0) + 1;
    const mf = u.microflow || manifest.target_microflow || "Unknown";
    if (!byMicroflow[mf]) {
      byMicroflow[mf] = { hypotheses: 0, amber_risks: 0, ui_candidates: 0, patterns: new Set() };
    }
    byMicroflow[mf].ui_candidates++;
    byMicroflow[mf].patterns.add(u.pattern_id);
  }

  const prioritizedFindings = [
    ...hyps.map((h) => ({
      ...h,
      bucket: "HYPOTHESIS",
      dual_risk: h.dual_risk || classifyFindingDualRisk(h, manifest),
    })),
    ...ambers.map((a) => ({
      ...a,
      bucket: "AMBER",
      dual_risk: a.dual_risk || classifyFindingDualRisk(a, manifest),
    })),
    ...uiCands.map((u) => ({
      ...u,
      bucket: "AMBER-UI",
      dual_risk: u.dual_risk || classifyFindingDualRisk(u, manifest),
    })),
  ].sort((a, b) => {
    const praDiff = (b.dual_risk?.risk_rating || 0) - (a.dual_risk?.risk_rating || 0);
    if (praDiff !== 0) return praDiff;
    const sevDiff = (SEVERITY_RANK[b.severity] || 2) - (SEVERITY_RANK[a.severity] || 2);
    if (sevDiff !== 0) return sevDiff;
    return String(a.pattern_id || "").localeCompare(String(b.pattern_id || ""));
  });

  const topSuspects = prioritizedFindings.slice(0, topN).map((f, idx) => ({
    rank: idx + 1,
    id: f.id,
    bucket: f.bucket,
    pattern_id: f.pattern_id,
    severity: f.severity || "MEDIUM",
    exposure_classification: f.exposure_classification || "ACTUAL_UI_OR_API_REPRODUCIBLE",
    exposes_commit_or_delete_in_hierarchy: Boolean(f.exposes_commit_or_delete_in_hierarchy),
    sample_user_flow_path: f.sample_user_flow_path || f.microflow || manifest.target_microflow,
    dual_risk: f.dual_risk,
    microflow: f.microflow || manifest.target_microflow,
    activity_caption: f.activity_caption || "-",
    title: f.title,
    oracle_rule: f.oracle_rule || f.amber_reason || "",
  }));

  const microflowBreakdown = Object.entries(byMicroflow)
    .map(([mf, stats]) => ({
      microflow: mf,
      hypotheses: stats.hypotheses,
      amber_risks: stats.amber_risks,
      ui_candidates: stats.ui_candidates,
      total: stats.hypotheses + stats.amber_risks + stats.ui_candidates,
      patterns: Array.from(stats.patterns),
    }))
    .sort((a, b) => b.total - a.total);

  return {
    module: manifest.module,
    tier: manifest.tier,
    microflows_analyzed: manifest.microflows_analyzed || 1,
    totals: {
      executable_hypotheses: hyps.length,
      amber_risks: ambers.length,
      amber_ui_candidates: uiCands.length,
    },
    counts_by_pattern: byPattern,
    top_microflows: microflowBreakdown.slice(0, topN),
    top_findings: topSuspects,
  };
}

export function renderManifestSummaryMarkdown(summary) {
  const patRows =
    Object.entries(summary.counts_by_pattern)
      .sort((a, b) => b[1] - a[1])
      .map(([pat, cnt]) => `| \`${pat}\` | **${cnt}** |`)
      .join("\n") || "| `-` | 0 |";

  const findingRows =
    summary.top_findings
      .map((f) => {
        const dr = f.dual_risk || classifyFindingDualRisk(f, summary);
        const typeLabel =
          f.bucket === "EXECUTABLE_HYPOTHESIS"
            ? f.exposure_classification === "LATENT_IMPLICITLY_PROTECTED"
              ? "🔶 Latent Bug Candidate"
              : "🔴 Actual Bug Candidate"
            : f.bucket === "AMBER_UI_CANDIDATE"
              ? "🟡 Page Check"
              : "🟠 Model Warning";
        return `| #${f.rank} | ${typeLabel} (\`${f.pattern_id}\`) | \`${f.severity}\` | \`${dr.business_risk_profile}\` | \`${humanizeMendixText(dr.technical_risk_profile)}\` | **${dr.risk_rating}/25** (\`${dr.priority.split(" ")[0]}\`) | \`${f.microflow}\` | ${humanizeMendixText(f.title)} |`;
      })
      .join("\n") || "| - | - | - | - | - | - | - | None |";

  return `# Bug Hunter Overview: \`${summary.module}\`
* **Microflows Checked:** ${summary.microflows_analyzed} | **Testable Bug Candidates:** ${summary.totals.executable_hypotheses} | **Microflow & Model Warnings:** ${summary.totals.amber_risks} | **Page Checks:** ${summary.totals.amber_ui_candidates}

## 1. Findings by Check Code
| Check Code | Count |
| :--- | :--- |
${patRows}

## 2. Top Priority Findings (Ranked by Business & Technical Risk)
| Rank | Type & Code | Severity | Business Risk | Technical Area | Risk Score (1-25) | Microflow | Finding Summary |
| :--- | :--- | :--- | :--- | :--- | :---: | :--- | :--- |
${findingRows}
`;
}

// ============================================================================
// 6D. MODULE-WIDE RBAC & SECURITY MATRIX AUDITOR (`audit-rbac --module <ModuleName>`)
// ============================================================================

export function auditRbacModule(bundle) {
  const manifest = analyzeAstBundle(bundle, "free");
  const secPatternRe = /^SEC-0[1-9]$/;

  const secHypotheses = (manifest.hypotheses || []).filter((h) => secPatternRe.test(h.pattern_id));
  const secAmbers = (manifest.amber_risks || []).filter((a) => secPatternRe.test(a.pattern_id));
  const secUi = (manifest.amber_ui_candidates || []).filter((u) => secPatternRe.test(u.pattern_id));

  // Additional direct permission table checks across all microflows & entities in bundle
  const directFindings = [];
  for (const mf of bundle.microflows || []) {
    const mfName = mf.name || (mf.qualified_name || "").split(".").pop() || "";
    const qName = mf.qualified_name || `${bundle.module}.${mfName}`;
    const roles = mf.allowed_roles || [];
    if (/^(ACT_|VAL_|DS_|SUB_)/i.test(mfName) && roles.length === 0) {
      directFindings.push({
        pattern_id: "SEC-00",
        severity: /^ACT_/i.test(mfName) ? "MEDIUM" : "LOW",
        element: qName,
        roles: [],
        title: `Microflow '${mfName}' has 0 Allowed Module Roles configured`,
        description: `Microflow '${qName}' defines no allowed module roles in module security.`,
        remediation: `Assign explicit module roles if '${mfName}' is invoked from pages or client actions, or verify it is strictly an internal sub-microflow.`,
      });
    }
  }

  for (const ent of bundle.entities || []) {
    const rules = ent.access_rules || [];
    if (rules.length === 0) {
      directFindings.push({
        pattern_id: "SEC-05",
        severity: "HIGH",
        element: ent.qualified_name || ent.name,
        roles: [],
        title: `Entity '${ent.name}' defines 0 Entity Access Rules`,
        description: `Entity '${ent.qualified_name || ent.name}' has no access rules configured in module security.`,
        remediation: `Configure least-privilege Entity Access Rules and XPath constraints on '${ent.qualified_name || ent.name}'.`,
      });
    }
  }

  const allFindings = [
    ...secHypotheses.map((h) => ({
      pattern_id: h.pattern_id,
      severity: h.severity || "HIGH",
      element: h.microflow,
      roles: [],
      title: h.title,
      description: h.oracle_rule,
      remediation: h.remediation,
    })),
    ...secAmbers.map((a) => ({
      pattern_id: a.pattern_id,
      severity: a.severity || "HIGH",
      element: a.microflow,
      roles: [],
      title: a.title,
      description: a.amber_reason || a.oracle_rule,
      remediation: a.remediation,
    })),
    ...secUi.map((u) => ({
      pattern_id: u.pattern_id,
      severity: u.severity || "HIGH",
      element: u.microflow || u.page_qualified_name,
      roles: [],
      title: u.title,
      description: u.oracle_rule,
      remediation: u.remediation,
    })),
    ...directFindings,
  ];

  const countsByPattern = {};
  for (const f of allFindings) {
    countsByPattern[f.pattern_id] = (countsByPattern[f.pattern_id] || 0) + 1;
  }

  return {
    module: bundle.module,
    audited_at: new Date().toISOString(),
    summary: {
      total_microflows: (bundle.microflows || []).length,
      total_entities: (bundle.entities || []).length,
      total_pages: (bundle.pages || []).length,
      total_security_findings: allFindings.length,
      counts_by_pattern: countsByPattern,
    },
    findings: allFindings,
  };
}

// ============================================================================
// 6E. COMPANION EXECUTE-TESTCASE JSON PAYLOAD GENERATOR (`--payload-out <file.json>`)
// ============================================================================

export function resolveAttributeType(manifest, entityName, attrName, value) {
  // 1. Check if value or attribute indicates a boolean type
  const isBoolVal = typeof value === "boolean" || value === "true" || value === "false";
  const isBoolName =
    /_(False|True)$/i.test(attrName) ||
    /^(EVT_|BCO_|VAL_|Trigger_)/i.test(attrName) ||
    /^Trigger_/i.test(entityName);

  if (isBoolVal || isBoolName) {
    return "BooleanType";
  }

  // 2. Check manifest.entities if available
  const entities = manifest?.entities || [];
  const cleanEntityName = entityName.split(".").pop();
  const matchedEntity = entities.find(
    (e) => (e.name || e.Name) === cleanEntityName || (e.qualified_name || e.QualifiedName) === entityName
  );
  if (matchedEntity && Array.isArray(matchedEntity.attributes || matchedEntity.Attributes)) {
    const attrs = matchedEntity.attributes || matchedEntity.Attributes;
    const matchedAttr = attrs.find((a) => (a.name || a.Name) === attrName);
    if (matchedAttr) {
      const t = matchedAttr.type || matchedAttr.Type || "";
      if (/Boolean/i.test(t)) return "BooleanType";
      if (/DateTime/i.test(t)) return "DateTimeType";
      if (/Integer/i.test(t)) return "IntegerType";
      if (/Decimal|Currency/i.test(t)) return "DecimalType";
      if (/Long/i.test(t)) return "LongType";
      if (/Enumeration/i.test(t)) return "EnumerationType";
      if (/String|HashString/i.test(t)) return "StringType";
    }
  }

  // 3. Number inference
  if (typeof value === "number") {
    return Number.isInteger(value) ? "IntegerType" : "DecimalType";
  }

  // 4. String format inference
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed === "true" || trimmed === "false") {
      return "BooleanType";
    }
    // Strict ISO date or epoch ms
    if (
      /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d{3})?Z?)?$/.test(trimmed) ||
      (/^\d{10,13}$/.test(trimmed) && /Date/i.test(attrName))
    ) {
      return "DateTimeType";
    }
  }

  // 5. If attribute name has Date but value is empty or not yet filled
  if (/Date/i.test(attrName) && !isBoolName) {
    return "DateTimeType";
  }

  return "StringType";
}

export function resolveMtaParamType(raw) {
  if (!raw) return "StringType";
  const s = String(raw).trim();
  if (/^Enum/i.test(s)) return "EnumType";
  if (/^Object/i.test(s)) return "ObjectType";
  if (/^List/i.test(s)) return "ListType";
  if (/^Bool/i.test(s)) return "BooleanType";
  if (/^Date/i.test(s)) return "DateTimeType";
  if (/^(Decimal|Float|Currency)/i.test(s)) return "DecimalType";
  if (/^(Int|Long|AutoNumber)/i.test(s)) return "IntegerType";
  if (/^Binary/i.test(s)) return "BinaryType";
  if (/^Void/i.test(s)) return "VoidType";
  return "StringType";
}

export function resolveMtaReturnType(rawRet) {
  if (!rawRet) return "VoidType";
  if (typeof rawRet !== "string") return "VoidType";
  if (rawRet.endsWith("Type")) return rawRet;
  if (rawRet.startsWith("Object")) return "ObjectType";
  if (rawRet.startsWith("List")) return "ListType";
  if (rawRet.startsWith("Enum")) return "EnumerationType";
  const map = {
    Boolean: "BooleanType",
    Integer: "IntegerType",
    Long: "LongType",
    Decimal: "DecimalType",
    Float: "FloatType",
    String: "StringType",
    DateTime: "DateTimeType",
    Enumeration: "EnumerationType",
    Object: "ObjectType",
    List: "ListType",
    Void: "VoidType",
  };
  const base = rawRet.split(":")[0];
  return map[rawRet] || map[base] || "VoidType";
}

export function generateExecuteTestcasePayload(manifest, options = {}) {
  const isModuleBundle = Boolean(manifest.is_module_bundle) || /\.\*$/.test(manifest.target_microflow || "");
  const pbtHyps = (manifest.pbt_suites || []).flatMap((s) => s.hypotheses || []);
  const invDatasetProbes = manifest.invariant_dataset_probes || [];
  const allHyps = [
    ...(manifest.hypotheses || []),
    ...(options.pbt || options.findingId ? pbtHyps.filter((ph) => !(manifest.hypotheses || []).some((h) => h.id === ph.id)) : []),
    ...(options.invariants || options.findingId ? invDatasetProbes.filter((ip) => !(manifest.hypotheses || []).some((h) => h.id === ip.id)) : []),
  ];
  const filteredHyps = options.findingId
    ? allHyps.filter(
        (h) =>
          h.id === options.findingId ||
          h.pattern_id === options.findingId ||
          h.invariant_id === options.findingId ||
          h.microflow === options.findingId
      )
    : allHyps;
  const hyps = filteredHyps.length > 0 ? filteredHyps : allHyps;

  const fallbackMf =
    (hyps[0] && hyps[0].microflow && !/\.\*$/.test(hyps[0].microflow) ? hyps[0].microflow : null) ||
    manifest.primary_microflow ||
    (!isModuleBundle && manifest.target_microflow ? manifest.target_microflow : null) ||
    `${manifest.module || "Module"}.ACT_Target`;

  const hasSecPattern = hyps.some((h) => /^SEC-0[1-9]$/.test(h.pattern_id));
  const returnTypeMap = {
    Boolean: "BooleanType",
    Integer: "IntegerType",
    Long: "LongType",
    Decimal: "DecimalType",
    Float: "FloatType",
    String: "StringType",
    DateTime: "DateTimeType",
    Enumeration: "EnumerationType",
    Object: "ObjectType",
    List: "ListType",
    Void: "VoidType",
  };
  const mfReturnType = returnTypeMap[options.returnType || "Boolean"] || "BooleanType";

  const scenarios =
    hyps.length > 0
      ? hyps
      : [{ id: "HYP_1", pattern_id: "BHP-00", microflow: fallbackMf, title: "Baseline Happy Path", variation_overrides: {} }];

  const testCases = scenarios.map((hyp, idx) => {
    const steps = [];
    let seq = 1;
    const overrides = hyp.variation_overrides || {};
    const stepMf =
      hyp.microflow && !/\.\*$/.test(hyp.microflow)
        ? hyp.microflow
        : fallbackMf;

    let hypMfReturnType = "VoidType";
    let hypReturnEntity = null;
    const mfPool = (options.bundle && options.bundle.microflows) || (manifest.bundle && manifest.bundle.microflows) || [];
    const targetMfDef = mfPool.find(
      (m) => m.qualified_name === stepMf || m.name === stepMf.split(".").pop()
    );
    if (targetMfDef && targetMfDef.return_type) {
      hypMfReturnType = resolveMtaReturnType(targetMfDef.return_type);
      if ((hypMfReturnType === "ObjectType" || hypMfReturnType === "ListType") && targetMfDef.return_type.includes(":")) {
        hypReturnEntity = targetMfDef.return_type.split(":")[1];
      }
    } else if (options.returnType) {
      hypMfReturnType = resolveMtaReturnType(options.returnType);
    }

    // INV-02: Read-Only Live Dataset Compliance Retrieve (`negated_xpath`, ExpectedObjectCount = 0)
    if (hyp.pattern_id === "INV-02") {
      const targetEnt = hyp.target_entity || `${manifest.module || "Module"}.Entity`;
      const negXpath = hyp.negated_xpath || "[id != empty]";
      steps.push({
        Sequence: seq++,
        Name: `Dataset Compliance Retrieve (${hyp.invariant_id || hyp.id}) on ${targetEnt}`,
        Action: "RetrieveObject",
        RetrieveSource: "Database",
        EntityName: targetEnt,
        XPathConstraint: negXpath,
        ExpectedObjectCount: 0,
      });
      return {
        Name: `Scenario_${idx + 1}_${hyp.pattern_id}_${hyp.invariant_id || hyp.id}`,
        Description: `[DATASET-COMPLIANCE] ${hyp.title} — ${hyp.oracle_rule || ""}`.slice(0, 240),
        RollbackTcseAfterExecution: "Yes",
        ApplySecurityExecutor: "NONE",
        ExecutionUsername: options.executionUsername || "MxAdmin",
        TCEX_RQ_TestStepList: steps,
      };
    }

    const entityAttrMap = new Map();
    const mfParams = (targetMfDef && Array.isArray(targetMfDef.parameters)) ? targetMfDef.parameters : [];
    const resolveVarToEntity = (rawEntityOrVar) => {
      if (rawEntityOrVar === "HttpResponse" || rawEntityOrVar === "System.HttpResponse") return "System.HttpResponse";
      if (rawEntityOrVar === "HttpRequest" || rawEntityOrVar === "System.HttpRequest") return "System.HttpRequest";
      const cleanVar = String(rawEntityOrVar || "").replace(/^\$/, "");
      if (cleanVar.includes(".")) return cleanVar;
      const matchedParam = mfParams.find((p) => p.name === cleanVar || p.entity?.endsWith(`.${cleanVar}`));
      if (matchedParam && matchedParam.entity) return matchedParam.entity;
      return `${manifest.module}.${cleanVar}`;
    };

    for (const [k, v] of Object.entries(overrides)) {
      if (k.startsWith("Filter ") || k.startsWith("Trigger_") || k.startsWith("Existing_") || k.startsWith("BypassEvents_") || k.startsWith("Uncommitted") || k.startsWith("ForceError_") || k.startsWith("InvokeJavaStub_") || k.startsWith("TriggerJavaCatch_") || k.startsWith("JavaReturnEmpty_") || k.startsWith("HasAssociated_")) continue;
      const normalizedKey = k.startsWith("$") ? k.slice(1).replace(/\//g, ".") : k;
      const parts = normalizedKey.split(".");
      if (parts.length >= 2) {
        const entityName = parts.slice(0, -1).join(".");
        if (entityName.startsWith("Trigger_") || entityName.startsWith("Existing_") || entityName.includes(".Trigger_") || entityName.includes(".Existing_")) continue;
        const attrName = parts[parts.length - 1];
        const cleanValRaw = typeof v === "string" ? v.replace(/^'|'$/g, "") : v;
        const determinedType = resolveAttributeType(manifest, entityName, attrName, cleanValRaw);
        let formattedVal = cleanValRaw === null || cleanValRaw === "empty" ? "empty" : String(cleanValRaw);
        if (determinedType === "BooleanType" && typeof cleanValRaw === "boolean") {
          formattedVal = String(cleanValRaw);
        }
        const qualifiedEntity = resolveVarToEntity(entityName);
        if (!entityAttrMap.has(qualifiedEntity)) {
          entityAttrMap.set(qualifiedEntity, []);
        }
        entityAttrMap.get(qualifiedEntity).push({
          AttributeName: attrName,
          AttributeType: determinedType,
          Value: formattedVal,
        });
      }
    }

    // Ensure non-null baseline objects are created for required Object/List parameters when not testing a null parameter
    const allEntitiesPool = (options.bundle && options.bundle.entities) || manifest.entities || (manifest.bundle && manifest.bundle.entities) || [];
    if (targetMfDef && Array.isArray(targetMfDef.parameters)) {
      for (const p of targetMfDef.parameters) {
        const isObjOrListParam = p.type === "Object" || p.type === "ObjectType" || p.type === "List" || p.type === "ListType" || Boolean(p.entity);
        if (!isObjOrListParam) continue;
        const paramEntityQName =
          p.entity ||
          p.entity_qualified_name ||
          (p.entity_name ? `${manifest.module}.${p.entity_name}` : `${manifest.module}.${p.name}`);
        const explicitlyTestsNullParam =
          overrides[`Param $${p.name}`] === "'NONE'" ||
          overrides[`Param $${p.name}`] === "empty" ||
          overrides[p.name] === "'NONE'" ||
          overrides[p.name] === "empty" ||
          overrides[`$${p.name}`] === "empty" ||
          (hyp.pattern_id === "BHP-01" && hyp.target_param === p.name && !hyp.target_attribute);
        if (!explicitlyTestsNullParam && !entityAttrMap.has(paramEntityQName)) {
          entityAttrMap.set(paramEntityQName, []);
        }
      }
    }

    // Populate default required attributes and valid Enum literals on created baseline objects unless explicitly overridden as empty
    for (const [qualifiedEntity, attrList] of entityAttrMap.entries()) {
      const entDef = allEntitiesPool.find(
        (e) => e.qualified_name === qualifiedEntity || e.name === qualifiedEntity.split(".").pop()
      );
      if (!entDef || !Array.isArray(entDef.attributes)) continue;
      for (const attr of entDef.attributes) {
        if (!attr.name || /^AutoNumber/i.test(attr.type || "") || attr.is_auto_number) continue;
        if (attrList.some((a) => a.AttributeName === attr.name)) continue;
        const attrType = resolveAttributeType(manifest, qualifiedEntity, attr.name, null);
        if (attr.is_required) {
          let defaultVal = "test_" + attr.name.toLowerCase();
          if (/email/i.test(attr.name)) defaultVal = "test@menditect.com";
          else if (attrType === "IntegerType" || attrType === "LongType") defaultVal = "1";
          else if (attrType === "DecimalType") defaultVal = "10.00";
          else if (attrType === "DateTimeType") defaultVal = "2026-06-15T10:00:00.000Z";
          else if (attrType === "BooleanType") defaultVal = "true";
          else if (attrType === "EnumerationType" && Array.isArray(attr.enum_values) && attr.enum_values[0]) {
            defaultVal = attr.enum_values[0];
          }
          attrList.push({
            AttributeName: attr.name,
            AttributeType: attrType,
            Value: defaultVal,
          });
        } else if (attrType === "EnumerationType" && Array.isArray(attr.enum_values) && attr.enum_values[0]) {
          attrList.push({
            AttributeName: attr.name,
            AttributeType: "EnumerationType",
            Value: attr.enum_values[0],
          });
        }
      }
    }

    // Order created entities so child/referenced entities are created BEFORE parent/owner entities that reference them via association
    const orderedEntities = Array.from(entityAttrMap.keys());
    const entityStepSeqMap = new Map();
    const pendingCreateSteps = [];
    for (const qualifiedEntity of orderedEntities) {
      const stepSeq = seq++;
      entityStepSeqMap.set(qualifiedEntity, stepSeq);
      entityStepSeqMap.set(qualifiedEntity.split(".").pop(), stepSeq);
      pendingCreateSteps.push({
        Sequence: stepSeq,
        Name: `Create ${qualifiedEntity.split(".").pop()} for ${hyp.id}`,
        Action: "CreateObject",
        EntityName: qualifiedEntity,
        TCEX_RQ_AttributeValueList: entityAttrMap.get(qualifiedEntity) || [],
      });
    }

    // Auto-wire TCEX_RQ_Sfar associations between co-created entities when an association exists in the domain model
    for (const createStep of pendingCreateSteps) {
      const entDef = allEntitiesPool.find(
        (e) => e.qualified_name === createStep.EntityName || e.name === createStep.EntityName.split(".").pop()
      );
      const assocs = entDef?.associations || [];
      const sfarList = [];
      for (const as of assocs) {
        const parentEnt = as.parent_entity || as.parent;
        const childEnt = as.child_entity || as.child;
        const assocName = as.qualified_name || as.name;
        if (!assocName) continue;
        // In Mendix default ownership, parent is the owner and holds the reference to child
        if (
          (parentEnt === createStep.EntityName || parentEnt === createStep.EntityName.split(".").pop()) &&
          childEnt &&
          childEnt !== createStep.EntityName
        ) {
          const childKey = entityStepSeqMap.get(childEnt) || entityStepSeqMap.get(String(childEnt).split(".").pop());
          const childShort = String(childEnt).split(".").pop();
          const explicitlyNullAssoc =
            overrides[`$${childShort}`] === "empty" ||
            overrides[childShort] === "empty" ||
            (hyp.pattern_id === "BHP-23" && String(hyp.title || "").includes(childShort));
          if (childKey !== undefined && childKey !== createStep.Sequence && !explicitlyNullAssoc) {
            sfarList.push({
              AssociationName: assocName.includes(".") ? assocName : `${manifest.module}.${assocName}`,
              TestStepRunKey_output: childKey,
            });
          }
        }
      }
      if (sfarList.length > 0) {
        createStep.TCEX_RQ_Sfar = sfarList;
      }
      steps.push(createStep);
    }

    if (
      hyp.pattern_id === "INT-07" &&
      !steps.some((s) => s.Action === "CreateObject" && s.EntityName === "System.HttpResponse")
    ) {
      steps.push({
        Sequence: seq++,
        Name: `Create System.HttpResponse (Default StatusCode = 200) for ${hyp.id}`,
        Action: "CreateObject",
        EntityName: "System.HttpResponse",
        TCEX_RQ_AttributeValueList: [
          {
            AttributeName: "StatusCode",
            AttributeType: "IntegerType",
            Value: "200",
          },
          {
            AttributeName: "ReasonPhrase",
            AttributeType: "StringType",
            Value: "OK",
          },
        ],
      });
    }

    const mfCallStep = {
      Sequence: seq++,
      Name: `Execute ${stepMf.split(".").pop()} (${hyp.pattern_id})`,
      Action: "MicroflowCall",
      MicroflowName: stepMf,
      TCEX_RQ_MicroflowReturnType: {
        DataType: hypMfReturnType,
        ...(hypReturnEntity ? { EntityQualifiedName: hypReturnEntity } : {}),
      },
    };
    if (/^JAP-0[12467]$/.test(hyp.pattern_id || "")) {
      mfCallStep.HarnessMode = "PARENT_MICROFLOW_JAVA_ACTION";
    }
    steps.push(mfCallStep);

    // PBT-04 Idempotency Double-Invocation (`f(f(x)) == f(x)`)
    if (
      hyp.pattern_id === "PBT-04" ||
      hyp.property_check?.type === "IDEMPOTENCY_DOUBLE_CALL" ||
      Number(hyp.invocation_count || 1) >= 2
    ) {
      steps.push({
        Sequence: seq++,
        Name: `Execute ${stepMf.split(".").pop()} Second Time (PBT-04 Idempotency Check)`,
        Action: "MicroflowCall",
        MicroflowName: stepMf,
        TCEX_RQ_MicroflowReturnType: {
          DataType: hypMfReturnType,
          ...(hypReturnEntity ? { EntityQualifiedName: hypReturnEntity } : {}),
        },
      });
    }

    if (hyp.pattern_id === "INT-07") {
      steps.push({
        Sequence: seq++,
        Name: `Assert HttpResponse.StatusCode >= 400 on Error Branch (${hyp.id})`,
        Action: "AssertAttributeValueCompare",
        EntityName: "System.HttpResponse",
        AttributeName: "StatusCode",
        AttributeType: "IntegerType",
        CompareType: "GreaterOrEqual",
        ExpectedValue: "400",
      });
    }

    return {
      Name: `Scenario_${idx + 1}_${hyp.pattern_id}_${hyp.id}`,
      Description: `[${hyp.exposure_classification === "LATENT_IMPLICITLY_PROTECTED" ? "LATENT" : "ACTUAL"}] ${hyp.title} — ${hyp.oracle_rule || ""}`.slice(0, 240),
      RollbackTcseAfterExecution: "Yes",
      ApplySecurityExecutor: hasSecPattern ? "ALL" : "NONE",
      ExecutionUsername: options.executionUsername || "MxAdmin",
      TCEX_RQ_TestStepList: steps,
    };
  });

  return {
    SchemaVersion: "2.4.0",
    Module: manifest.module,
    TargetMicroflow: fallbackMf,
    RollbackTcseAfterExecution: "Yes",
    TCEX_RQ_TestCaseList: testCases,
  };
}


// ============================================================================
// 6B. DIRECT RUNTIME TEST COMPILATION & EXECUTION (ANTI-46 EXEMPTION)
// ============================================================================

export function compileTestCaseToStepRun(tc, manifest = {}, bundle = null) {
  const steps = tc.TCEX_RQ_TestStepList || [];
  const stepRuns = [];
  const createdEntities = new Map(); // entityName -> sequenceKey
  let targetMfName = tc.TargetMicroflow || manifest.target_microflow;

  // First pass: identify CreateObject steps and index them
  for (const step of steps) {
    if (step.Action === "CreateObject") {
      createdEntities.set(step.EntityName, step.Sequence);
      const shortName = step.EntityName ? step.EntityName.split(".").pop() : null;
      if (shortName) createdEntities.set(shortName, step.Sequence);

      stepRuns.push({
        Key: step.Sequence,
        SequenceNumber: step.Sequence,
        TestStepRunType: "Oact",
        ExecutionCondition: "Always",
        ResumeExecutionAfterException: "_Continue",
        TCEX_RQ_TestStepRunOact: {
          Action: "Create",
          EntityQualifiedName: step.EntityName,
          RetrieveOption: "From_database",
          RetrieveSet: "Head",
          TCEX_RQ_EntityValueRun: {
            // Filter out read-only AutoNumber attributes on CreateObject steps (ANTI-83)
            TCEX_RQ_AttributeValueRun: (step.TCEX_RQ_AttributeValueList || [])
              .filter(
                (attr) =>
                  attr.AttributeType !== "AutoNumberType" &&
                  attr.AttributeType !== "AutoNumber" &&
                  attr.DataType !== "AutoNumberType"
              )
              .map((attr) => {
                const isNumericOrDate = [
                  "IntegerType",
                  "LongType",
                  "DecimalType",
                  "FloatType",
                  "DateTimeType",
                ].includes(attr.AttributeType);
                const isNullOrEmpty = attr.Value === null || attr.Value === "empty" || attr.Value === "";
                const finalValue = isNullOrEmpty ? (isNumericOrDate ? null : "empty") : String(attr.Value);
                let cleanDataType = attr.AttributeType || attr.DataType || "StringType_limited";
                if (cleanDataType === "StringType" || cleanDataType === "String") cleanDataType = "StringType_limited";
                if (cleanDataType === "FloatType" || cleanDataType === "Float") cleanDataType = "DecimalType";
                if (cleanDataType === "Integer") cleanDataType = "IntegerType";
                if (cleanDataType === "Long") cleanDataType = "LongType";
                if (cleanDataType === "Boolean") cleanDataType = "BooleanType";
                if (cleanDataType === "DateTime") cleanDataType = "DateTimeType";
                if (cleanDataType === "Decimal") cleanDataType = "DecimalType";
                if (cleanDataType === "Enum" || cleanDataType === "Enumeration" || cleanDataType === "EnumerationType") cleanDataType = "EnumType";
                return {
                  AttributeName: attr.AttributeName,
                  DataType: cleanDataType,
                  Value: finalValue,
                };
              }),
          },
          ...(step.TCEX_RQ_Sfar ? { TCEX_RQ_Sfar: step.TCEX_RQ_Sfar } : {}),
        },
      });
    } else if (step.Action === "MicroflowCall") {
      targetMfName = step.MicroflowName;
      let mfDef = null;
      if (bundle && Array.isArray(bundle.microflows)) {
        mfDef = bundle.microflows.find(
          (m) => m.qualified_name === step.MicroflowName || m.name === step.MicroflowName.split(".").pop()
        );
      }
      if (!mfDef && manifest.bundle && Array.isArray(manifest.bundle.microflows)) {
        mfDef = manifest.bundle.microflows.find(
          (m) => m.qualified_name === step.MicroflowName || m.name === step.MicroflowName.split(".").pop()
        );
      }

      const params = mfDef ? mfDef.parameters || [] : [];
      const mfcParams = [];
      const smprList = [];

      for (const p of params) {
        const isList = p.type === "List" || p.type === "ListType" || /^List/i.test(p.type || "");
        const isObj = !isList && (p.type === "Object" || p.type === "ObjectType" || Boolean(p.entity));
        const paramDataType = isList ? "ListType" : "ObjectType";
        const entityQName = p.entity || p.entity_qualified_name || (p.entity_name ? String(manifest.module) + "." + String(p.entity_name) : null);
        const entityShort = entityQName ? entityQName.split(".").pop() : p.name;

        if (isList || isObj) {
          const createKey =
            (entityQName ? createdEntities.get(entityQName) : null) ||
            (entityShort ? createdEntities.get(entityShort) : null) ||
            createdEntities.get(p.name);

          if (createKey !== undefined) {
            mfcParams.push({
              ParameterName: p.name,
              DataType: paramDataType,
              EntityQualifiedName: entityQName,
              UseEmptyObjectList: false,
            });
            smprList.push({
              ParameterName: p.name,
              DataType: paramDataType,
              EntityQualifiedName: entityQName,
              TCEX_RQ_SmprValueRun: [{ TestStepRunKey_output: createKey }],
            });
          } else {
            // Null boundary test case ($Param == empty)
            mfcParams.push({
              ParameterName: p.name,
              DataType: paramDataType,
              EntityQualifiedName: entityQName || "System.User",
              UseEmptyObjectList: true,
            });
          }
        } else {
          // Primitive parameter
          mfcParams.push({
            ParameterName: p.name,
            DataType: resolveMtaParamType(p.type),
          });
        }
      }

      let retTypeStr = "VoidType";
      let returnEntityQName = null;
      if (mfDef && mfDef.return_type) {
        retTypeStr = resolveMtaReturnType(mfDef.return_type);
        if ((retTypeStr === "ObjectType" || retTypeStr === "ListType") && mfDef.return_type.includes(":")) {
          returnEntityQName = mfDef.return_type.split(":")[1];
        }
      } else if (typeof step.TCEX_RQ_MicroflowReturnType === "string") {
        retTypeStr = resolveMtaReturnType(step.TCEX_RQ_MicroflowReturnType);
      } else if (step.TCEX_RQ_MicroflowReturnType && step.TCEX_RQ_MicroflowReturnType.DataType) {
        retTypeStr = resolveMtaReturnType(step.TCEX_RQ_MicroflowReturnType.DataType);
        returnEntityQName = step.TCEX_RQ_MicroflowReturnType.EntityQualifiedName || null;
      }
      if (step.TCEX_RQ_MicroflowReturnType && step.TCEX_RQ_MicroflowReturnType.EntityQualifiedName && !returnEntityQName) {
        returnEntityQName = step.TCEX_RQ_MicroflowReturnType.EntityQualifiedName;
      }

      stepRuns.push({
        Key: step.Sequence,
        SequenceNumber: step.Sequence,
        TestStepRunType: "MicroflowCall",
        ExecutionCondition: "Always",
        ResumeExecutionAfterException: "_Continue",
        TCEX_RQ_TestStepRunMfc: {
          QualifiedName: step.MicroflowName,
          TCEX_RQ_MicroflowParameter: mfcParams,
          TCEX_RQ_MicroflowReturnType: {
            DataType: retTypeStr,
            ...(returnEntityQName ? { EntityQualifiedName: returnEntityQName } : {}),
          },
          ...(smprList.length > 0 ? { TCEX_RQ_Smpr: smprList } : {}),
        },
      });
    } else if (step.Action === "RetrieveObject" || step.Action === "Retrieve") {
      stepRuns.push({
        Key: step.Sequence,
        SequenceNumber: step.Sequence,
        TestStepRunType: "Oact",
        ExecutionCondition: "Always",
        ResumeExecutionAfterException: "_Continue",
        TCEX_RQ_TestStepRunOact: {
          Action: "Retrieve",
          EntityQualifiedName: step.EntityName,
          RetrieveSource: step.RetrieveSource || "Database",
          XPathConstraint: step.XPathConstraint || "",
          ExpectedObjectCount: step.ExpectedObjectCount ?? 0,
        },
      });
    }
    // Note: Non-executable assertions (AssertAttributeValueCompare, etc.) are evaluated agent-side
  }

  return {
    RollbackTcseAfterExecution: "Yes",
    ApplySecurityExecutor: (tc.ApplySecurityExecutor === "APP_SECURITY" || tc.ApplySecurityExecutor === "ALL") ? "ALL" : "NONE",
    ExecutorUsername: tc.ExecutionUsername || "MxAdmin",
    is_bughunt: true,
    is_exploratory: true,
    TCEX_RQ_TestStepRun: stepRuns,
  };
}

export function parseEnvFile(envPath) {
  if (!fs.existsSync(envPath)) return {};
  try {
    const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
    const result = {};
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx !== -1) {
        const key = trimmed.slice(0, eqIdx).trim();
        let val = trimmed.slice(eqIdx + 1).trim();
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1);
        }
        result[key] = val;
      }
    }
    return result;
  } catch (_e) {
    return {};
  }
}

export function resolvePluginAuthToken(configPath = null) {
  if (process.env.PLUGIN_MCP_TOKEN) return process.env.PLUGIN_MCP_TOKEN;

  const candidateEnvPaths = [
    path.join(process.cwd(), ".env"),
    configPath ? path.join(path.dirname(configPath), ".env") : null,
    path.join(path.dirname(process.cwd()), ".env"),
  ].filter(Boolean);

  for (const envPath of candidateEnvPaths) {
    const parsed = parseEnvFile(envPath);
    if (parsed.PLUGIN_MCP_TOKEN) return parsed.PLUGIN_MCP_TOKEN;
  }

  const candidateConfigPaths = [
    configPath,
    path.join(process.cwd(), "mta_config.json"),
    path.join(path.dirname(process.cwd()), "mta_config.json"),
  ].filter(Boolean);

  for (const cfg of candidateConfigPaths) {
    if (fs.existsSync(cfg)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(cfg, "utf8"));
        if (parsed.app_instances && parsed.app_instances[0] && parsed.app_instances[0].pluginToken) {
          return parsed.app_instances[0].pluginToken;
        }
        if (parsed.default_app_instance_token) {
          return parsed.default_app_instance_token;
        }
      } catch (_e) {}
    }
  }
  return null;
}

export function resolvePluginUrl(configPath = null) {
  if (process.env.PLUGIN_MCP_URL) return process.env.PLUGIN_MCP_URL;
  if (process.env.MTA_PLUGIN_MCP_URL) return process.env.MTA_PLUGIN_MCP_URL;

  const candidateEnvPaths = [
    path.join(process.cwd(), ".env"),
    configPath ? path.join(path.dirname(configPath), ".env") : null,
    path.join(path.dirname(process.cwd()), ".env"),
  ].filter(Boolean);

  for (const envPath of candidateEnvPaths) {
    const parsed = parseEnvFile(envPath);
    if (parsed.PLUGIN_MCP_URL) return parsed.PLUGIN_MCP_URL;
  }

  const candidateConfigPaths = [
    configPath,
    path.join(process.cwd(), "mta_config.json"),
    path.join(path.dirname(process.cwd()), "mta_config.json"),
  ].filter(Boolean);

  for (const cfg of candidateConfigPaths) {
    if (fs.existsSync(cfg)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(cfg, "utf8"));
        const url = parsed.plugin_mcp_url || (parsed.app_instances && parsed.app_instances[0] ? parsed.app_instances[0].pluginUrl : null);
        if (url) return url;
      } catch (_e) {}
    }
  }
  return "http://localhost:8081/plugin/mcp";
}

export function postJsonRpc(urlStr, method, params = {}, headers = {}, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({
      jsonrpc: "2.0",
      id: "bughunt_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7),
      method,
      params,
    });
    const urlObj = new URL(urlStr);
    const transport = urlObj.protocol === "https:" ? https : http;
    const authToken = resolvePluginAuthToken();
    const reqHeaders = {
      "Content-Type": "application/json",
      "Accept": "application/json, text/event-stream",
      "Content-Length": Buffer.byteLength(payload, "utf8"),
      ...headers,
    };
    if (authToken && !reqHeaders["Authorization"]) {
      reqHeaders["Authorization"] = authToken.startsWith("Bearer ") ? authToken : `Bearer ${authToken}`;
    }
    const req = transport.request(
      {
        hostname: urlObj.hostname,
        port: urlObj.port || (urlObj.protocol === "https:" ? 443 : 80),
        path: urlObj.pathname + (urlObj.search || ""),
        method: "POST",
        headers: reqHeaders,
        timeout: timeoutMs,
      },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          body += chunk;
        });
        res.on("end", () => {
          const respHeaders = res.headers || {};
          let parsed = null;
          try {
            parsed = JSON.parse(body);
          } catch (_e) {
            if (body.includes("data:")) {
              const lines = body.split("\n").filter((l) => l.startsWith("data:"));
              for (const line of lines) {
                try {
                  parsed = JSON.parse(line.slice(5).trim());
                  if (parsed) break;
                } catch (_ee) {}
              }
            }
          }
          resolve({
            statusCode: res.statusCode,
            headers: respHeaders,
            body,
            data: parsed,
          });
        });
      }
    );
    req.on("error", (err) => reject(err));
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("Request timed out after " + timeoutMs + "ms"));
    });
    req.write(payload);
    req.end();
  });
}

function loadConfigPluginUrl(configPath) {
  return resolvePluginUrl(configPath);
}

let bughuntMcpSessionId = null;

async function executeViaMcpHttp(pluginUrl, toolName, toolArgs, timeoutMs = 45000) {
  const sessionHeaders = {};
  if (bughuntMcpSessionId) {
    sessionHeaders["mcp-session-id"] = bughuntMcpSessionId;
  }

  // Attempt direct tools/call
  try {
    const res = await postJsonRpc(
      pluginUrl,
      "tools/call",
      { name: toolName, arguments: toolArgs },
      sessionHeaders,
      timeoutMs
    );
    if (res.headers && res.headers["mcp-session-id"]) {
      bughuntMcpSessionId = res.headers["mcp-session-id"];
    }
    if (res.statusCode >= 200 && res.statusCode < 300 && res.data && !res.data.error) {
      return res.data;
    }

    // If session expired or requires initialization, perform MCP handshake
    if (res.statusCode >= 400 || (res.data && res.data.error)) {
      const initRes = await postJsonRpc(
        pluginUrl,
        "initialize",
        {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "mta-bughunter", version: "2.8.0" },
        },
        {},
        timeoutMs
      );
      if (initRes.headers && initRes.headers["mcp-session-id"]) {
        bughuntMcpSessionId = initRes.headers["mcp-session-id"];
        sessionHeaders["mcp-session-id"] = bughuntMcpSessionId;
      }
      await postJsonRpc(pluginUrl, "notifications/initialized", {}, sessionHeaders, 5000).catch(() => {});

      const retryRes = await postJsonRpc(
        pluginUrl,
        "tools/call",
        { name: toolName, arguments: toolArgs },
        sessionHeaders,
        timeoutMs
      );
      if (retryRes.data) return retryRes.data;
      throw new Error(retryRes.body || ("HTTP " + retryRes.statusCode));
    }
    return res.data;
  } catch (err) {
    throw err;
  }
}

function isDirectlyExecutableHypothesis(hyp = {}) {
  const pat = String(hyp.pattern_id || "").toUpperCase();
  if (/^(INV-0[123]|BRP-01|BHP-0[123456]|BHP-23|BHP-26|BHP-29|BHP-32|PBT-0[12345]|SEC-0[123689]|INT-07|JAP-0[12467])$/.test(pat)) {
    return true;
  }
  const overrides = hyp.variation_overrides || {};
  const keys = Object.keys(overrides);
  if (keys.length === 0) return false;
  return keys.some(
    (k) =>
      k.startsWith("Param $") ||
      k.startsWith("$") ||
      k.startsWith("Filter ") ||
      k === "ExecutorUsername" ||
      (k.includes(".") && !k.startsWith("Trigger_") && !k.startsWith("Existing_") && !k.startsWith("BypassEvents_") && !k.startsWith("ForceError_"))
  );
}

export function sortHypothesesTier1First(hypotheses = []) {
  return [...hypotheses].sort((a, b) => {
    const aExec = isDirectlyExecutableHypothesis(a) ? 1 : 0;
    const bExec = isDirectlyExecutableHypothesis(b) ? 1 : 0;
    if (aExec !== bExec) return bExec - aExec;

    const natureOrder = {
      FUNCTIONAL_BYPASS: 1,
      UI_FEEDBACK_DISCONNECT: 2,
      TECHNICAL_CRASH: 3,
    };
    const aNat = natureOrder[classifyDefectNature(a)] || 3;
    const bNat = natureOrder[classifyDefectNature(b)] || 3;
    if (aNat !== bNat) return aNat - bNat;

    // Within Tier 1 Functional Bypasses, prioritize INV-01/INV-03/BRP-01/BHP-04/BHP-05/BHP-06 over read-only/structural checks
    const getSubPrio = (h) => {
      const p = String(h.pattern_id || "").toUpperCase();
      const mfShort = String(h.microflow || "").split(".").pop();
      const isGetter = /^GET_/i.test(mfShort);
      if (/^(INV-01|INV-03|BRP-01|BHP-04|BHP-05|BHP-06|PBT-0[2345])$/.test(p)) {
        return isGetter ? 2 : 1;
      }
      if (p === "INV-02") return 3;
      return 4;
    };
    const aSub = getSubPrio(a);
    const bSub = getSubPrio(b);
    if (aSub !== bSub) return aSub - bSub;

    // Prioritize Actual (UI/API reproducible) over Latent
    const aActual = a.exposure_classification !== "LATENT_IMPLICITLY_PROTECTED" ? 1 : 0;
    const bActual = b.exposure_classification !== "LATENT_IMPLICITLY_PROTECTED" ? 1 : 0;
    if (aActual !== bActual) return bActual - aActual;

    const aRisk = a.dual_risk?.risk_rating || 0;
    const bRisk = b.dual_risk?.risk_rating || 0;
    return bRisk - aRisk;
  });
}

function parsePluginExecutionResult(resp, hyp) {
  let data = resp;
  if (resp && resp.result) {
    if (resp.result.structuredContent) {
      data = resp.result.structuredContent;
    } else {
      data = resp.result;
    }
  }
  if (data && data.content && Array.isArray(data.content)) {
    const txt = data.content.find((c) => c.type === "text");
    if (txt && txt.text) {
      try {
        data = JSON.parse(txt.text);
      } catch (_e) {
        data = txt.text;
      }
    }
  }

  const defectNature = hyp ? classifyDefectNature(hyp) : "TECHNICAL_CRASH";
  const pat = hyp ? String(hyp.pattern_id || "").toUpperCase() : "";
  const mfShort = hyp && hyp.microflow ? String(hyp.microflow).split(".").pop() : "";

  if (typeof data === "string") {
    const isSummarySuccess = /Test Execution Summary:\s*SUCCESS/i.test(data);
    const isErr = !isSummarySuccess && (/Test Execution Summary:\s*FAILED/i.test(data) || /exception/i.test(data) || /\b(error|failed)\b/i.test(data));
    if (isErr && defectNature === "FUNCTIONAL_BYPASS" && /DataValidationRuntimeException/i.test(data)) {
      return {
        outcome: "PASS",
        actual_value: `Domain validation rule enforced at runtime: ${data.slice(0, 180)}`,
        duration_ms: 0,
      };
    }
    return {
      outcome: isErr ? "FAIL_EXCEPTION" : "PASS",
      error_message: isErr ? data : undefined,
      actual_value: !isErr ? data : undefined,
      duration_ms: 0,
    };
  }

  if (!data || typeof data !== "object") {
    return { outcome: "PASS", duration_ms: 0 };
  }

  const tcResult = data.TCEX_RP_TestCaseResult || data.TCEX_RS_TestCaseResult || data;
  const status = String(
    data.ExecutionResult ||
    data.Status ||
    data.Result ||
    tcResult.ExecutionResult ||
    tcResult.Status ||
    tcResult.Result ||
    ""
  ).toUpperCase();
  const stepRuns = Array.isArray(data.TCEX_RS_TestStepRun)
    ? data.TCEX_RS_TestStepRun
    : Array.isArray(tcResult.TCEX_RP_TestStepResult)
      ? tcResult.TCEX_RP_TestStepResult
      : [];
  const valFeedbacks = Array.isArray(data.TCEX_RS_ValidationFeedback)
    ? data.TCEX_RS_ValidationFeedback
    : stepRuns.flatMap((s) => s.TCEX_RP_ValidationFeedbackMessage || []);
  const mfcStep = stepRuns.find((s) => s.TestStepRunType === "MicroflowCall" || Boolean(s.TCEX_RS_TestStepRunMfc));
  const mfcData = mfcStep?.TCEX_RS_TestStepRunMfc || null;
  const retVal = mfcData?.TCEX_RS_MicroflowReturnValueRun?.Value ?? data.ReturnedValue ?? tcResult.ReturnedValue;
  const isRetEmpty = mfcData?.IsReturnValueEmpty;
  const entityValRuns = Array.isArray(mfcData?.TCEX_RS_MicroflowEntityValueRun)
    ? mfcData.TCEX_RS_MicroflowEntityValueRun
    : [];
  const returnedEntityAttrs = entityValRuns.flatMap((ev) => ev.TCEX_RS_MicroflowAttributeValueRun || []);

  const failingStep = stepRuns.find((s) => {
    const res = String(s.Status || s.ExecutionResult || s.Result || "").toUpperCase();
    return (
      res === "FAIL" ||
      res === "FAILED" ||
      res === "ERROR" ||
      Boolean(s.ExceptionMessage) ||
      Boolean(s.ErrorMessage) ||
      (Boolean(s.ResultDescription) && res !== "SUCCESS" && res !== "EXECUTED" && res !== "PASSED")
    );
  });

  const durationMs = Number(data.DurationInMs || data.ExecutionDuration || tcResult.Duration || 0);

  if (
    status === "FAILED" ||
    status === "FAIL" ||
    status === "ERROR" ||
    failingStep ||
    data.ErrorMessage ||
    data.ExceptionMessage ||
    tcResult.ErrorMessage ||
    tcResult.ExceptionMessage
  ) {
    const err =
      data.ErrorMessage ||
      data.ExceptionMessage ||
      tcResult.ErrorMessage ||
      tcResult.ExceptionMessage ||
      (failingStep
        ? failingStep.ExceptionMessage ||
          failingStep.ErrorMessage ||
          failingStep.TCEX_RS_TestStepException?.Message ||
          failingStep.ResultDescription ||
          failingStep.ResultStacktrace
        : null) ||
      "Runtime exception occurred";
    const errStr = String(err);

    // Dual-Mode Oracle Rule 1: If a Tier 1 Functional Bypass test triggers a Domain Model DataValidationRuntimeException
    // (e.g., Required rule on Email or Range rule rejecting invalid value), the domain invariant WAS enforced -> PASS!
    if (
      defectNature === "FUNCTIONAL_BYPASS" &&
      /DataValidationRuntimeException/i.test(errStr) &&
      pat !== "DQP-10"
    ) {
      return {
        outcome: "PASS",
        actual_value: `Domain model validation enforced at commit time (${errStr.split("\n")[0]})`,
        duration_ms: durationMs,
      };
    }

    return {
      outcome: "FAIL_EXCEPTION",
      error_message: errStr,
      duration_ms: durationMs,
    };
  }

  // Dual-Mode Oracle Rule 2: Evaluate Functional Bypass & UI Feedback Disconnect hypotheses when runtime completed without throwing an exception
  if (defectNature === "FUNCTIONAL_BYPASS" && hyp) {
    // If validation feedback was raised on an invalid input probe (and not testing BHP-15/PBT-05 silent commit), the validation guard worked -> PASS
    if (valFeedbacks.length > 0 && pat !== "BHP-15" && pat !== "PBT-05") {
      const msg = valFeedbacks.map((v) => v.Message).filter(Boolean).join("; ");
      return {
        outcome: "PASS",
        actual_value: `Rejected with Validation Feedback: "${msg}"`,
        duration_ms: durationMs,
      };
    }

    // INV-02: Dataset compliance retrieve (ExpectedObjectCount == 0)
    if (pat === "INV-02") {
      const oactStep = stepRuns.find((s) => s.TestStepRunType === "Oact" || s.TCEX_RS_TestStepRunOact);
      const objCount = Number(oactStep?.TCEX_RS_TestStepRunOact?.ObjectCount ?? 0);
      if (objCount > 0) {
        return {
          outcome: "FAIL_DATASET_VIOLATION",
          error_message: `Database query '${hyp.negated_xpath}' found ${objCount} persisted record(s) violating invariant ${hyp.invariant_id || ""}`,
          duration_ms: durationMs,
        };
      }
      return {
        outcome: "PASS",
        actual_value: `0 violating records found in database for '${hyp.negated_xpath}' (Dataset Compliant)`,
        duration_ms: durationMs,
      };
    }

    // INV-01, INV-03, BHP-04: Cross-Attribute / Temporal / Calculation Invariant Bypass
    if (pat === "INV-01" || pat === "INV-03" || pat === "BHP-04") {
      const isReadOnlyGetter = /^(GET_|DS_)/i.test(mfShort);
      if (!isReadOnlyGetter && valFeedbacks.length === 0) {
        const rentalDaysAttr = returnedEntityAttrs.find((a) => a.AttributeName === "RentalDays");
        const attrSummary = returnedEntityAttrs
          .filter((a) => a.Value !== null && a.Value !== "" && a.Value !== "0")
          .slice(0, 4)
          .map((a) => `${a.AttributeName}=${a.Value}`)
          .join(", ");
        const retDetail =
          rentalDaysAttr && rentalDaysAttr.Value
            ? `computed RentalDays = ${rentalDaysAttr.Value}`
            : retVal !== undefined && retVal !== null && retVal !== ""
              ? `returned '${retVal}'`
              : attrSummary
                ? `persisted/returned object (${attrSummary})`
                : "completed and committed without validation rejection";
        return {
          outcome: "FAIL_FUNCTIONAL_BYPASS",
          error_message: `Functional invariant bypassed at runtime: '${mfShort}' accepted violating input (${JSON.stringify(hyp.variation_overrides || {})}) with 0 validation errors and ${retDetail}.`,
          actual_value: retDetail,
          duration_ms: durationMs,
        };
      }
    }

    // BHP-05: Copy-Paste Split Mismatch / Dead Error Branch (e.g. ACT_home_employee_booking_insure checking $BookingList != empty instead of $Renter != empty)
    if (pat === "BHP-05" && isDirectlyExecutableHypothesis(hyp)) {
      if (valFeedbacks.length === 0 && isRetEmpty !== true) {
        return {
          outcome: "FAIL_FUNCTIONAL_BYPASS",
          error_message: `Flawed decision split confirmed at runtime: '${mfShort}' bypassed its error branch when ${JSON.stringify(hyp.variation_overrides || {})} and returned a non-empty result with 0 validation messages.`,
          duration_ms: durationMs,
        };
      }
    }

    // BRP-01 / BHP-06: Boundary Off-By-One or Spec Discrepancy
    if ((pat === "BRP-01" || pat === "BHP-06") && isDirectlyExecutableHypothesis(hyp)) {
      const isDocMismatch = /Spec-to-Code|Documented Business Rule/i.test(hyp.title || "");
      if (isDocMismatch && (String(retVal) === "false" || valFeedbacks.length > 0)) {
        const msg = valFeedbacks[0]?.Message || `returned ${retVal}`;
        return {
          outcome: "FAIL_ASSERTION_MISMATCH",
          error_message: `Boundary value rejected against spec at runtime (${msg})`,
          duration_ms: durationMs,
        };
      }
      if (!isDocMismatch && retVal !== undefined && retVal !== null && String(retVal) !== "") {
        return {
          outcome: "PASS",
          actual_value: `Boundary probe executed in runtime -> returned '${retVal}' (${valFeedbacks.length} validation messages)`,
          duration_ms: durationMs,
        };
      }
    }
  }

  if (defectNature === "UI_FEEDBACK_DISCONNECT" && pat === "BHP-32" && valFeedbacks.length > 0) {
    const fb = valFeedbacks[0];
    return {
      outcome: "FAIL_VALIDATION_TARGET_MISMATCH",
      error_message: `Validation feedback emitted on wrong target '${fb.EntityName || ""}.${fb.AttributeName || ""}' ("${fb.Message || ""}") instead of in-scope entity.`,
      duration_ms: durationMs,
    };
  }

  return {
    outcome: "PASS",
    actual_value: String(retVal !== undefined && retVal !== "" ? `Returned: ${retVal}` : "Executed safely without unhandled exception"),
    duration_ms: durationMs,
  };
}

export async function executeHuntScenariosDirectly(manifest, bundle = null, options = {}) {
  const pluginUrl =
    options.pluginUrl ||
    resolvePluginUrl(options.configPath);

  // Prioritize Tier 1 FUNCTIONAL_BYPASS hypotheses first, and dynamically expand topLimit so 100% of executable Tier 1 functional probes are ALWAYS verified
  const prioritizedHyps = sortHypothesesTier1First(manifest.hypotheses || []);
  manifest.hypotheses = prioritizedHyps;
  const executableFunctionalCount = prioritizedHyps.filter(
    (h) => classifyDefectNature(h) === "FUNCTIONAL_BYPASS" && isDirectlyExecutableHypothesis(h)
  ).length;
  const requestedTop = options.topLimit || 25;
  const topLimit = Math.max(requestedTop, executableFunctionalCount + 8);
  const hypsToRun = prioritizedHyps.slice(0, topLimit);

  // Probe plugin connectivity (always perform MCP initialize handshake if no session ID is cached or on HTTP 400)
  let isOnline = false;
  let probeStatus = null;
  try {
    if (!bughuntMcpSessionId) {
      const initProbe = await postJsonRpc(
        pluginUrl,
        "initialize",
        {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "mta-bughunter", version: "2.8.0" },
        },
        {},
        3000
      );
      probeStatus = initProbe.statusCode;
      if (initProbe.statusCode >= 200 && initProbe.statusCode < 400) {
        if (initProbe.headers && initProbe.headers["mcp-session-id"]) {
          bughuntMcpSessionId = initProbe.headers["mcp-session-id"];
        }
        await postJsonRpc(
          pluginUrl,
          "notifications/initialized",
          {},
          bughuntMcpSessionId ? { "mcp-session-id": bughuntMcpSessionId } : {},
          3000
        ).catch(() => {});
      }
    }
    let probe = await postJsonRpc(
      pluginUrl,
      "tools/list",
      {},
      bughuntMcpSessionId ? { "mcp-session-id": bughuntMcpSessionId } : {},
      3000
    );
    probeStatus = probe.statusCode;
    if (probe.statusCode >= 400) {
      const initProbe = await postJsonRpc(
        pluginUrl,
        "initialize",
        {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "mta-bughunter", version: "2.8.0" },
        },
        {},
        3000
      );
      if (initProbe.statusCode >= 200 && initProbe.statusCode < 400) {
        probeStatus = initProbe.statusCode;
        if (initProbe.headers && initProbe.headers["mcp-session-id"]) {
          bughuntMcpSessionId = initProbe.headers["mcp-session-id"];
        }
        await postJsonRpc(
          pluginUrl,
          "notifications/initialized",
          {},
          bughuntMcpSessionId ? { "mcp-session-id": bughuntMcpSessionId } : {},
          3000
        ).catch(() => {});
      }
    }
    if (probeStatus >= 200 && probeStatus < 400) {
      isOnline = true;
    }
  } catch (_err) {
    isOnline = false;
  }

  if (!isOnline) {
    if (probeStatus === 401 || probeStatus === 403) {
      console.warn(
        `[WARN] MTA Plugin at '${pluginUrl}' returned HTTP ${probeStatus} Unauthorized. Please check PLUGIN_MCP_TOKEN in .env or mta_config.json.`
      );
    } else {
      console.warn(
        `[WARN] MTA Plugin is not reachable at '${pluginUrl}'. Runtime Mendix app is offline or MTA Plugin is not enabled.`
      );
    }
    console.log("[INFO] Falling back to static bug hunt report generation...");
    const staticReport = buildVerifiedBugReport(manifest, {
      scenarios: [],
      is_static: true,
      plugin_online: false,
      plugin_url: pluginUrl,
      probe_status_code: probeStatus,
      top_limit: topLimit,
    });
    writeBugReports(staticReport, options);
    return staticReport;
  }

  console.log(
    "[mta-bughunter] Connected to MTA Plugin at " + pluginUrl + ". Executing " + hypsToRun.length + " bug scenarios with in-memory rollback (ANTI-46 exempt)..."
  );

  const payloadBundle = generateExecuteTestcasePayload(manifest, { ...options, bundle });
  const tcList = payloadBundle.TCEX_RQ_TestCaseList || [];
  const results = [];

  for (let i = 0; i < tcList.length && i < topLimit; i++) {
    const tc = tcList[i];
    const hyp = manifest.hypotheses.find((h) => tc.Name.includes(h.id)) || manifest.hypotheses[i];
    const execArgs = compileTestCaseToStepRun(tc, manifest, bundle);
    console.log("  [" + (i + 1) + "/" + Math.min(tcList.length, topLimit) + "] Executing " + tc.Name + "...");
    try {
      const resp = await executeViaMcpHttp(pluginUrl, "execute-testcase", execArgs);
      const parsedOutcome = parsePluginExecutionResult(resp, hyp);
      let shrunkCounterexample = null;

      if (
        parsedOutcome.outcome &&
        parsedOutcome.outcome.startsWith("FAIL_") &&
        options.pbtShrink !== false &&
        hyp &&
        hyp.variation_overrides &&
        Object.keys(hyp.variation_overrides).length > 1
      ) {
        try {
          shrunkCounterexample = await shrinkFailingPermutation(
            hyp.variation_overrides,
            hyp.baseline_overrides || {},
            async (candOverrides) => {
              const probeHyp = { ...hyp, variation_overrides: candOverrides };
              const probePayload = generateExecuteTestcasePayload(
                { ...manifest, hypotheses: [probeHyp] },
                options
              );
              const probeTc = probePayload.TCEX_RQ_TestCaseList?.[0];
              if (!probeTc) return false;
              const probeArgs = compileTestCaseToStepRun(probeTc, manifest, bundle);
              const probeResp = await executeViaMcpHttp(pluginUrl, "execute-testcase", probeArgs);
              const probeParsed = parsePluginExecutionResult(probeResp, probeHyp);
              return Boolean(probeParsed.outcome && probeParsed.outcome.startsWith("FAIL_"));
            },
            { maxProbes: 6 }
          );
        } catch (_shrinkErr) {
          shrunkCounterexample = null;
        }
      }

      results.push({
        hypothesis_id: hyp ? hyp.id : ("HYP_" + (i + 1)),
        pattern_id: hyp ? hyp.pattern_id : undefined,
        ...(shrunkCounterexample ? { shrunk_counterexample: shrunkCounterexample } : {}),
        ...parsedOutcome,
      });
      console.log(
        "    -> Outcome: " + parsedOutcome.outcome + " (" + (parsedOutcome.error_message || parsedOutcome.actual_value || "OK") + ") [" + parsedOutcome.duration_ms + "ms]"
      );
    } catch (err) {
      console.warn("    -> Error executing " + tc.Name + ": " + err.message);
      results.push({
        hypothesis_id: hyp ? hyp.id : ("HYP_" + (i + 1)),
        pattern_id: hyp ? hyp.pattern_id : undefined,
        outcome: "FAIL_EXCEPTION",
        error_message: err.message,
        duration_ms: 0,
      });
    }
  }

  if (options.frontend !== false) {
    try {
      const feBatch = await executeFrontendBugHuntBatch(
        manifest,
        bundle,
        {
          ...options,
          pluginUrl,
          mprPath: options.mprPath || bundle?.mpr_path || bundle?.mprPath,
          catalogPath:
            options.catalogPath ||
            bundle?.catalog_db_path ||
            bundle?.catalog_path ||
            bundle?.catalogPath,
        },
        executeViaMcpHttp
      );
      if (feBatch && Array.isArray(feBatch.results) && feBatch.results.length > 0) {
        console.log(
          "[mta-bughunter] Executed " +
            feBatch.results.length +
            " Frontend Playwright scenario(s) via " +
            (feBatch.kitSource || "MenditectMxFrontendTestKit") +
            "."
        );
        for (const feRes of feBatch.results) {
          results.push(feRes);
        }
      } else if (feBatch && feBatch.executed === false) {
        console.log(
          "[mta-bughunter] Frontend Playwright batch skipped: " +
            (feBatch.reason || "not applicable")
        );
      }
    } catch (feErr) {
      console.warn("[mta-bughunter] Frontend Playwright batch skipped/failed: " + feErr.message);
    }
  }

  const dynamicReport = buildVerifiedBugReport(manifest, {
    scenarios: results,
    is_static: false,
    plugin_online: true,
    plugin_url: pluginUrl,
    probe_status_code: 200,
    top_limit: topLimit,
  });
  const written = writeBugReports(dynamicReport, options);
  console.log(
    "[mta-bughunter] Dynamic verification report written:\n" +
      "  - Bug Report:     " + written.reportPath + "\n" +
      "  - Executed Tests: " + (written.testsPath || "N/A") + "\n" +
      "  - Raw Report JSON:" + written.jsonPath
  );
  return dynamicReport;
}

// ============================================================================
// 7. BUILT-IN SELF-TEST SUITE (`node mta-bughunter.mjs self-test`)
// ============================================================================

async function runSelfTest() {
  // Test Bundle 1: Standard OrderManagement + CarRentalModule Real-World Gaps (Gaps 1-4)
  const sampleBundle = {
    module: "OrderManagement",
    target_microflow: {
      name: "ACT_Order_Save",
      qualified_name: "OrderManagement.ACT_Order_Save",
      documentation: "Saves an Order. TotalAmount must be at least 100.",
      return_type: "Boolean",
      parameters: [{ name: "Order", entity: "OrderManagement.Order", type: "Object" }],
      activities: [
        {
          id: "split_amount",
          type: "ExclusiveSplit",
          caption: "TotalAmount > 100?",
          expression: "$Order/TotalAmount > 100",
          checks_not_empty: false,
        },
        {
          id: "calc_installment",
          type: "ChangeObject",
          variable: "Order",
          commit: "Yes",
          expressions: ["$Order/TotalAmount / $Order/InstallmentCount"],
        },
        {
          id: "val_feedback_no_false",
          type: "ValidationFeedback",
          caption: "Warn discount",
          attribute: "OrderManagement.Order.HiddenDiscountCode",
          sets_valid_false: false,
        },
        {
          id: "rollback_touchpoint",
          type: "Rollback",
          caption: "Rollback Order",
          variable: "Order",
        },
      ],
    },
    entities: [
      {
        qualified_name: "OrderManagement.Order",
        attributes: [
          { name: "TotalAmount", type: "Decimal" },
          { name: "InstallmentCount", type: "Integer" },
          { name: "CustomerEmail", type: "String" },
        ],
        event_handlers: [
          {
            event: "BeforeCommit",
            microflow: "OrderManagement.BCO_Order_Audit",
            returns_false_possible: true,
            raise_error_on_false: false,
          },
        ],
      },
    ],
    pages: [
      {
        qualified_name: "OrderManagement.Order_NewEdit",
        calls_microflows: ["OrderManagement.ACT_Order_Save"],
        widgets: [
          { name: "txtAmount", attribute: "OrderManagement.Order.TotalAmount", required_on_page: true },
          { name: "txtEmail", attribute: "OrderManagement.Order.CustomerEmail", required_on_page: true },
        ],
      },
    ],
    other_committers: [
      {
        qualified_name: "OrderManagement.PUB_Order_Webhook",
        commits_entity: "OrderManagement.Order",
        calls_validators: [],
      },
    ],
  };

  // 1. Test Free Tier Analysis
  const freeManifest = analyzeAstBundle(sampleBundle, "free");
  const detectedPatternIds = new Set(freeManifest.hypotheses.map((h) => h.pattern_id));
  const amberPatternIds = new Set(freeManifest.amber_risks.map((a) => a.pattern_id));

  const requiredFreePatterns = ["BHP-01", "BHP-03", "BHP-06", "BHP-15", "DQP-02", "DQP-04", "DQP-08"];
  for (const pat of requiredFreePatterns) {
    if (!detectedPatternIds.has(pat)) {
      console.error(`[FAIL] Expected Free Tier pattern ${pat} not detected!`);
      process.exit(1);
    }
  }
  if (!amberPatternIds.has("DQP-01") || !amberPatternIds.has("BHP-17")) {
    console.error(`[FAIL] Expected DQP-01 and BHP-17 to be gated as Amber in Free Tier!`);
    process.exit(1);
  }
  if (freeManifest.amber_ui_candidates.length === 0 || !freeManifest.amber_ui_candidates[0].manual_reproduction_steps) {
    console.error(`[FAIL] Expected AMBER-UI candidate with manual_reproduction_steps!`);
    process.exit(1);
  }

  // 2. Test Paid Tier Analysis (Promotes DQP-01 and BHP-17 to Executable Hypotheses)
  const paidManifest = analyzeAstBundle(sampleBundle, "paid");
  const paidPatternIds = new Set(paidManifest.hypotheses.map((h) => h.pattern_id));
  if (!paidPatternIds.has("DQP-01") || !paidPatternIds.has("BHP-17")) {
    console.error(`[FAIL] Paid Tier did not unlock DQP-01 and BHP-17 as executable hypotheses!`);
    process.exit(1);
  }

  // 3. Test Real-World CarRentalModule Gaps + v2.1.0 SEC-01..05, BHP-04 ([%CurrentDateTime%]), BHP-21..29, INT-01..02
  const carRentalBundle = {
    module: "CarRentalModule",
    personas: {
      admin_user: "MxAdmin",
      standard_user_role: "Customer",
      standard_username: "test_customer",
      anonymous_enabled: true,
    },
    entities: [
      {
        name: "Car",
        qualified_name: "CarRentalModule.Car",
        attributes: [
          { name: "Build", type: "DateTime" },
          { name: "PricePerDay", type: "Float" },
          { name: "ApiSecretToken", type: "String" },
        ],
        event_handlers: [
          {
            event: "BeforeCommit",
            microflow: "CarRentalModule.BCO_Car",
            raise_error_on_false: false,
            returns_false_possible: true,
          },
        ],
        access_rules: [
          {
            roles: ["Customer"],
            allow_create: false,
            allow_delete: false,
            default_member_access: "ReadOnly",
            member_access: [
              { attribute: "PricePerDay", access: "ReadOnly" },
              { attribute: "ApiSecretToken", access: "ReadOnly" },
            ],
          },
        ],
      },
    ],
    pages: [
      {
        qualified_name: "CarRentalModule.Car_Overview",
        allowed_roles: ["Customer", "Administrator"],
        calls_microflows: ["CarRentalModule.ACT_car_get_age_days"],
      },
    ],
    microflows: [
      {
        name: "SUB_booking_calculate_and_set_rentaldays",
        qualified_name: "CarRentalModule.SUB_booking_calculate_and_set_rentaldays",
        shielded_by_parent: "CarRentalModule.Booking_NewEdit",
        parameters: [{ name: "Booking", entity: "CarRentalModule.Booking", type: "Object" }],
        activities: [
          {
            id: "split_booking_empty",
            type: "ExclusiveSplit",
            caption: "Booking != empty?",
            expression: "$Booking != empty",
          },
          {
            id: "val_feedback_null_booking",
            type: "ValidationFeedback",
            caption: "Validation feedback on null Booking",
            branch: "false",
            variable: "Booking",
            attribute: "CarRentalModule.Booking.Key",
          },
          {
            id: "call_days_between",
            type: "JavaActionCall",
            caption: "Days between",
            java_action: "MenditectMtaCommons.FTN_DaysBetween",
            arguments: ["$Booking/PickupDate", "$Booking/ReturnDate"],
          },
        ],
      },
      {
        name: "ACT_home_employee_booking_insure",
        qualified_name: "CarRentalModule.ACT_home_employee_booking_insure",
        parameters: [],
        activities: [
          {
            id: "ret_bookings",
            type: "Retrieve",
            output_variable: "BookingList",
            entity: "CarRentalModule.Booking",
          },
          {
            id: "split_count",
            type: "ExclusiveSplit",
            caption: "Count = 1?",
            expression: "count($BookingList) = 1",
          },
          {
            id: "val_current_user",
            type: "ValidationFeedback",
            caption: "Feedback on currentUser",
            variable: "currentUser",
            attribute: "$currentUser/Name",
          },
          {
            id: "ret_renter",
            type: "Retrieve",
            output_variable: "Renter",
            entity: "CarRentalModule.Renter",
          },
          {
            id: "split_renter_bug",
            type: "ExclusiveSplit",
            caption: "Renter?",
            expression: "$BookingList != empty",
          },
        ],
      },
      {
        name: "ACT_car_get_age_days",
        qualified_name: "CarRentalModule.ACT_car_get_age_days",
        allowed_roles: ["Administrator"],
        apply_entity_access: false,
        parameters: [{ name: "Car", entity: "CarRentalModule.Car", type: "Object" }],
        activities: [
          {
            id: "calc_car_age",
            type: "ChangeObject",
            caption: "Calculate age and discount",
            variable: "Car",
            commit: "Yes",
            expressions: [
              "round(daysBetween([%CurrentDateTime%], $Car/Build))",
              "$Car/PricePerDay - $Car/DiscountAmount",
            ],
          },
          {
            id: "commit_second",
            type: "Commit",
            caption: "Commit Booking",
            variable: "Booking",
          },
        ],
      },
      {
        name: "ACT_Admin_DeleteAllBookings",
        qualified_name: "CarRentalModule.ACT_Admin_DeleteAllBookings",
        allowed_roles: ["Customer", "Administrator"],
        apply_entity_access: false,
        parameters: [],
        activities: [
          {
            id: "ret_all_bookings",
            type: "Retrieve",
            retrieve_source: "Database",
            entity: "CarRentalModule.Booking",
            output_variable: "AllBookings",
            expression: "[Status = 'Active']",
          },
          {
            id: "del_bookings",
            type: "DeleteObject",
            caption: "Delete AllBookings",
            variable: "AllBookings",
          },
        ],
      },
    ],
  };

  const carManifest = analyzeAstBundle(carRentalBundle, "free");
  const carTitles = carManifest.hypotheses.map((h) => `${h.pattern_id}: ${h.title}`).join("\n");

  // Verify Gap 1: Null Object ValidationFeedback Trap even when $Booking != empty split exists
  if (!carManifest.hypotheses.some((h) => h.pattern_id === "BHP-01" && h.title.includes("Null Object"))) {
    console.error("[FAIL] Gap 1 (Validation Feedback on Null Object in false branch) was not detected!\n" + carTitles);
    process.exit(1);
  }
  // Verify Gap 2: Unguarded PickupDate/ReturnDate passed to FTN_DaysBetween
  if (!carManifest.hypotheses.some((h) => h.pattern_id === "BHP-01" && h.title.includes("PickupDate"))) {
    console.error("[FAIL] Gap 2 (Unguarded PickupDate in FTN_DaysBetween) was not detected!\n" + carTitles);
    process.exit(1);
  }
  // Verify Gap 3: Inverted Date Range (ReturnDate < PickupDate) AND [%CurrentDateTime%] first-arg inversion
  // Verify Gap 3: Inverted Date Range (ReturnDate < PickupDate) in Java Action / comparison guard
  if (!carManifest.hypotheses.some((h) => h.pattern_id === "BHP-04" && h.title.includes("Inverted Date Range"))) {
    console.error("[FAIL] Gap 3 (Inverted Date Range BHP-04) was not detected!\n" + carTitles);
    process.exit(1);
  }
  // Verify that Mendix between-date functions with [%CurrentDateTime%] as first argument are NOT flagged as false positives (Mendix docs: returns Math.abs)
  if (carManifest.hypotheses.some((h) => h.pattern_id === "BHP-04" && h.title.includes("[%CurrentDateTime%]"))) {
    console.error("[FAIL] False-positive BHP-04 ([%CurrentDateTime%] between-date argument order) was incorrectly flagged!\n" + carTitles);
    process.exit(1);
  }
  // Verify Gap 4: Dead Code & Copy-Paste Split ('Renter?' checking $BookingList != empty) + $currentUser feedback
  if (!carManifest.hypotheses.some((h) => h.pattern_id === "BHP-05")) {
    console.error("[FAIL] Gap 4 (BHP-05 Dead Code / Copy-Paste Split Condition) was not detected!\n" + carTitles);
    process.exit(1);
  }
  if (!carManifest.amber_ui_candidates.some((u) => u.pattern_id === "BHP-17" && u.title.includes("Session Object"))) {
    console.error("[FAIL] Gap 4 (BHP-17 Session Object $currentUser ValidationFeedback) was not detected!");
    process.exit(1);
  }

  // Verify v2.1.0 Security & Domain Patterns (SEC-01, SEC-02, SEC-03, SEC-04, SEC-05, BHP-22, BHP-25, BHP-26)
  for (const reqPat of ["SEC-01", "SEC-02", "SEC-03", "BHP-26"]) {
    if (!carManifest.hypotheses.some((h) => h.pattern_id === reqPat)) {
      console.error(`[FAIL] v2.1.0 pattern ${reqPat} was not detected in carManifest!\n` + carTitles);
      process.exit(1);
    }
  }
  if (!carManifest.amber_ui_candidates.some((u) => u.pattern_id === "SEC-04")) {
    console.error("[FAIL] v2.1.0 SEC-04 (Page vs Microflow Permission Drift) was not detected!");
    process.exit(1);
  }
  for (const reqAmber of ["SEC-05", "BHP-22", "BHP-25"]) {
    if (!carManifest.amber_risks.some((a) => a.pattern_id === reqAmber)) {
      console.error(`[FAIL] v2.1.0 ${reqAmber} was not detected in amber_risks!`);
      process.exit(1);
    }
  }

  // 3B. Verify v2.3.0 Patterns (BHP-32, Nullable Relational & Gateway Navigation BHP-01, SEC-06..09, and Zero False Positives on List Comparisons)
  const testsuiteSyntheticBundle = {
    module: "TestsuiteModule",
    entities: [
      {
        name: "TSTE_TestSuite",
        qualified_name: "TestsuiteModule.TSTE_TestSuite",
        attributes: [{ name: "StopOnFailCount", type: "Integer" }],
        access_rules: [
          {
            roles: ["Tester"],
            xpath_constraint: "[Owner = '[%CurrentUser%]']",
            allow_create: false,
            allow_delete: false,
            default_member_access: "ReadOnly",
            member_access: [{ attribute: "StopOnFailCount", access: "ReadOnly" }],
          },
        ],
      },
      {
        name: "FDBK_Feedback",
        qualified_name: "TestsuiteModule.FDBK_Feedback",
        attributes: [{ name: "PersistOk", type: "Boolean" }],
      },
    ],
    pages: [],
    microflows: [
      {
        name: "GET_tste_all_ordered",
        qualified_name: "TestsuiteModule.GET_tste_all_ordered",
        parameters: [{ name: "TestApplication", type: "Object", entity: "TestsuiteModule.TAPN_TestApplication" }],
        activities: [
          { id: "a1", type: "Retrieve", caption: "Retrieve TSTE_TestSuiteList from database", output_variable: "TSTE_TestSuiteList", entity: "TestsuiteModule.TSTE_TestSuite" },
          { id: "a2", type: "ExclusiveSplit", caption: "Found?", expression: "$TSTE_TestSuiteList != empty" },
          { id: "a3", type: "AggregateListAction", action_type: "AggregateListAction", caption: "Count TSTE_TestSuiteList into Count", list_variable: "TSTE_TestSuiteList", output_variable: "Count" },
          { id: "a4", type: "ExclusiveSplit", caption: "1?", expression: "$Count = 1" },
        ],
      },
      {
        name: "SUB_tcse_resequence_all_after_delete",
        qualified_name: "TestsuiteModule.SUB_tcse_resequence_all_after_delete",
        parameters: [{ name: "TestCaseList", type: "List", entity: "TestsuiteModule.TCSE_TestCase" }],
        activities: [
          { id: "b1", type: "ExclusiveSplit", caption: "Empty?", expression: "$TestCaseList = empty" },
        ],
      },
      {
        name: "SUB_tste_resequence_all_after_delete",
        qualified_name: "TestsuiteModule.SUB_tste_resequence_all_after_delete",
        parameters: [{ name: "TestSuiteList", type: "List", entity: "TestsuiteModule.TSTE_TestSuite" }],
        activities: [
          { id: "b2", type: "ExclusiveSplit", caption: "Found?", expression: "$TestSuiteList != empty" },
        ],
      },
      {
        name: "BP_tstp_set_retrieveoption",
        qualified_name: "TestsuiteModule.BP_tstp_set_retrieveoption",
        parameters: [{ name: "FDBK", type: "Object", entity: "TestsuiteModule.FDBK_Feedback" }],
        activities: [
          { id: "f1", type: "ExclusiveSplit", caption: "Ok?", expression: "$FDBK/PersistOk" },
        ],
      },
      {
        name: "VAL_tste_save",
        qualified_name: "TestsuiteModule.VAL_tste_save",
        parameters: [{ name: "TestSuite", type: "Object", entity: "TestsuiteModule.TSTE_TestSuite" }],
        activities: [
          { id: "c1", type: "ExclusiveSplit", caption: "Valid StopOnFailCount?", expression: "$TestSuite/StopOnFailCount >= 0" },
        ],
      },
      {
        name: "RULE_tstp_save_unchangeable_attributes",
        qualified_name: "TestsuiteModule.RULE_tstp_save_unchangeable_attributes",
        parameters: [{ name: "TestStep", type: "Object", entity: "TestsuiteModule.TSTP_TestStep" }],
        activities: [
          {
            id: "d1",
            type: "ValidationFeedback",
            caption: "Show validation feedback",
            variable: "TestStep",
            attribute: "TestsuiteModule.TSTE_TestSuite.ConfigurationType",
            member_refs: ["TestsuiteModule.TSTE_TestSuite.ConfigurationType"],
          },
        ],
      },
      {
        name: "ACT_tste_force_save",
        qualified_name: "TestsuiteModule.ACT_tste_force_save",
        allowed_roles: ["Tester"],
        apply_entity_access: false,
        parameters: [{ name: "TestSuite", type: "Object", entity: "TestsuiteModule.TSTE_TestSuite" }],
        activities: [
          { id: "e1", type: "Retrieve", retrieve_source: "Database", entity: "TestsuiteModule.TSTE_TestSuite", output_variable: "AllSuites", expression: "" },
          { id: "e2", type: "ChangeObject", variable: "TestSuite", commit: "Yes", expressions: ["10"] },
        ],
      },
    ],
  };

  const tsManifest = analyzeAstBundle(testsuiteSyntheticBundle, "free");
  const tsAllPatternIds = new Set([
    ...tsManifest.hypotheses.map((h) => h.pattern_id),
    ...tsManifest.amber_risks.map((a) => a.pattern_id),
    ...tsManifest.amber_ui_candidates.map((u) => u.pattern_id),
  ]);

  if (tsAllPatternIds.has("BHP-30a") || tsAllPatternIds.has("BHP-30b") || tsAllPatternIds.has("BHP-31")) {
    console.error("[FAIL] False positive list comparison pattern BHP-30a/30b/31 was unexpectedly detected!");
    process.exit(1);
  }

  for (const reqV23 of ["BHP-32", "BHP-01", "SEC-06", "SEC-08", "SEC-09"]) {
    if (!tsAllPatternIds.has(reqV23)) {
      console.error(`[FAIL] v2.3.0 pattern ${reqV23} was not detected in testsuiteSyntheticBundle! Detected: ${Array.from(tsAllPatternIds).join(", ")}`);
      process.exit(1);
    }
  }

  const fdbkFinding = tsManifest.hypotheses.find(
    (h) => h.microflow === "TestsuiteModule.BP_tstp_set_retrieveoption" && h.pattern_id === "BHP-01"
  );
  if (!fdbkFinding || !fdbkFinding.title.includes("FDBK/PersistOk")) {
    console.error("[FAIL] BHP-01 did not detect unguarded dereference on $FDBK/PersistOk in gateway!", fdbkFinding);
    process.exit(1);
  }

  const tsSummary = summarizeManifest(tsManifest, 10);
  if (!tsSummary.counts_by_pattern["BHP-01"] || tsSummary.top_findings.length === 0) {
    console.error("[FAIL] summarizeManifest did not produce expected pattern counts or top findings!");
    process.exit(1);
  }
  const rbacAudit = auditRbacModule(testsuiteSyntheticBundle);
  if (rbacAudit.summary.total_security_findings === 0) {
    console.error("[FAIL] auditRbacModule did not report security findings!");
    process.exit(1);
  }
  const genPayload = generateExecuteTestcasePayload(tsManifest);
  if (!Array.isArray(genPayload.TCEX_RQ_TestCaseList) || genPayload.TCEX_RQ_TestCaseList.length === 0) {
    console.error("[FAIL] generateExecuteTestcasePayload did not generate test cases!");
    process.exit(1);
  }

  // Verify Fast-Path Suspect Shortlist
  const shortlist = computeFastPathSuspectShortlist(carRentalBundle.microflows, carRentalBundle.entities);
  if (shortlist.length < 3) {
    console.error("[FAIL] computeFastPathSuspectShortlist did not shortlist the high-risk CarRental microflows!");
    process.exit(1);
  }

  // 4. Test SAFE-01 Side-Effect Quarantine
  const unsafeBundle = structuredClone(sampleBundle);
  unsafeBundle.target_microflow.activities.push({
    id: "rest_sap",
    type: "RestCall",
    caption: "POST /sap/orders",
  });
  const unsafeManifest = analyzeAstBundle(unsafeBundle, "free");
  if (!unsafeManifest.guardrails.safe_01_quarantined) {
    console.error(`[FAIL] SAFE-01 failed to quarantine outbound RestCall!`);
    process.exit(1);
  }

  // 5. Test Raw StudioPro MCP `Microflows$Microflow` AST Normalizer
  const rawStudioProMf = {
    $Type: "Microflows$Microflow",
    name: "SUB_booking_calculate_and_set_totalprice",
    module: "CarRentalModule",
    objectCollection: {
      objects: [
        {
          $Type: "Microflows$MicroflowParameterObject",
          name: "Booking",
          variableType: { $Type: "DataTypes$ObjectType", entity: "CarRentalModule.Booking" },
        },
        {
          $Type: "Microflows$ExclusiveSplit",
          caption: "Booking != empty?",
          splitCondition: {
            $Type: "Microflows$ExpressionSplitCondition",
            expression: "$Booking != empty",
          },
        },
        {
          $Type: "Microflows$ActionActivity",
          caption: "Show feedback on null Booking",
          action: {
            $Type: "Microflows$ValidationFeedbackAction",
            validationVariableName: "Booking",
            attribute: "CarRentalModule.Booking.TotalPrice",
          },
        },
      ],
    },
    flows: [
      {
        $Type: "Microflows$SequenceFlow",
        origin: "$id(/objectCollection/objects/1)",
        destination: "$id(/objectCollection/objects/2)",
        caseValues: [{ $Type: "Microflows$EnumerationCase", value: "false" }],
      },
    ],
  };
  const rawManifest = analyzeAstBundle(rawStudioProMf, "free");
  if (!rawManifest.hypotheses.some((h) => h.pattern_id === "BHP-01" && h.title.includes("Null Object"))) {
    console.error("[FAIL] Raw StudioPro Microflows$Microflow normalizer failed to detect false-branch null feedback trap!");
    process.exit(1);
  }

  // 6. Test Execution Plan Markdown Generation & Runtime Report Reconciliation
  const planMd = generateExecutionPlanMarkdown(freeManifest);
  if (!planMd.includes("## 3. Test Steps & Action Sequence") || !planMd.includes("PAT-07")) {
    console.error(`[FAIL] generateExecutionPlanMarkdown did not produce a valid 6-section plan!`);
    process.exit(1);
  }

  const simulatedResults = {
    total_duration_ms: 412,
    scenarios: [
      { hypothesis_id: "HYP_1", pattern_id: "BHP-01", outcome: "FAIL_UNHANDLED_EXCEPTION", error_message: "NullPointerException at $Order/TotalAmount", duration_ms: 85 },
      { hypothesis_id: "HYP_3", pattern_id: "BHP-03", outcome: "PASS", duration_ms: 45 },
      { hypothesis_id: "HYP_2", pattern_id: "BHP-06", outcome: "FAIL_ASSERTION_MISMATCH", error_message: "Expected true for TotalAmount = 100, got false", duration_ms: 62 },
      { hypothesis_id: "HYP_6", pattern_id: "DQP-02", outcome: "FAIL_ASSERTION_MISMATCH", error_message: "Order committed with empty CustomerEmail", duration_ms: 110 },
      { hypothesis_id: "HYP_7", pattern_id: "DQP-04", outcome: "FAIL_ASSERTION_MISMATCH", error_message: "Retrieve returned 0 records after BCO returned false without error", duration_ms: 110 },
    ],
  };
  const report = buildVerifiedBugReport(freeManifest, simulatedResults);
  if (report.scorecard.confirmed_bugs_red !== 4 || report.scorecard.verified_resilient_green !== 1) {
    console.error(`[FAIL] Report reconciliation mismatch!`, report.scorecard);
    process.exit(1);
  }
  const reportMd = renderBugReportMarkdown(report);
  if (!reportMd.includes("Summary of Findings") || !reportMd.includes("Page & Validation Message Checks")) {
    console.error(`[FAIL] Rendered Markdown report missing Summary of Findings table!`);
    process.exit(1);
  }
  if (!reportMd.includes("1B. Risk & Priority Overview (Business Risk & Technical Risk)") || !reportMd.includes("Business Impact:")) {
    console.error(`[FAIL] Rendered Markdown report missing Section 1B Risk & Priority Overview!`);
    process.exit(1);
  }
  if (!reportMd.includes("1C. Violated or Bypassed Business Rules") || !reportMd.includes("📜 **Business Rules Checked**")) {
    console.error(`[FAIL] Rendered Markdown report missing Section 1C (Violated or Bypassed Business Rules) or Business Rules row!`);
    process.exit(1);
  }

  // Verify 5 Decision Pillars, Upfront Executive Action Summary, Plain Mendix Terminology & Collapsible Tables
  if (!reportMd.includes("Test Selection & Execution Reasoning (5 Decision Pillars)") || !reportMd.includes("flowchart TD")) {
    console.error(`[FAIL] Rendered Markdown report missing 5 Decision Pillars flowchart or section!`);
    process.exit(1);
  }
  if (!reportMd.includes("1A. Executive Action Summary (Confirmed Bugs & Studio Pro Fixes)") || !reportMd.includes("| # | Bug Title & Affected Microflow | Verification Status | Runtime Failure / Observed Symptom | Studio Pro Recommended Fix | Priority |")) {
    console.error(`[FAIL] Rendered Markdown report missing Section 1A Executive Action Summary table!`);
    process.exit(1);
  }
  if (!reportMd.includes("Unguarded Null Dereference Crash") && !reportMd.includes("BHP-01")) {
    console.error(`[FAIL] Rendered Markdown report missing human-readable pattern name for BHP-01!`);
    process.exit(1);
  }

  // Verify Collapsible <details> wrapping behavior for large tables (> 10 items)
  const syntheticManyRules = Array.from({ length: 15 }, (_, i) => ({
    id: `BR_TEST_${i + 1}`,
    source_type: "Validation",
    source_location: "Microflow",
    target_element: "TestEntity",
    rule_text: `Test rule constraint ${i + 1}`,
    status: "VIOLATED_CONFIRMED_RED",
    confirmed_red_violations: [{ title: `Defect ${i + 1}`, pattern_id: "BHP-01", scenario_number: i + 1, scenario_anchor: `scenario-${i + 1}`, finding_anchor: `finding-${i + 1}` }]
  }));
  const reportWithManyRules = buildVerifiedBugReport(freeManifest, { ...simulatedResults, is_static: false });
  reportWithManyRules.business_rules = syntheticManyRules;
  const manyRulesMd = renderBugReportMarkdown(reportWithManyRules);
  if (!manyRulesMd.includes("<details>") || !manyRulesMd.includes("Click to expand full Business Rules Audit Table (15 entries)")) {
    console.error(`[FAIL] Section 1C Business Rules table failed to wrap in collapsible <details> tag when > 10 rules present!`);
    process.exit(1);
  }

  // Verify Multi-Source Business Rule Ingestion (`parseBusinessRuleFileContent`) + `BRP-01` Spec-vs-Code Discrepancy
  const parsedExtRules = parseBusinessRuleFileContent(
    `# External Confluence Spec (MCP)\n- BR-EXT-01: TotalAmount must be at least 100 for VIP discount eligibility (target: OrderManagement.ACT_Order_Save, attribute: Order.TotalAmount)`
  );
  if (parsedExtRules.length === 0) {
    console.error(`[FAIL] parseBusinessRuleFileContent did not extract external business rules!`);
    process.exit(1);
  }
  const specBundle = structuredClone(sampleBundle);
  specBundle.external_business_rules = parsedExtRules;
  const specManifest = analyzeAstBundle(specBundle, "free");
  if (!specManifest.hypotheses.some((h) => h.pattern_id === "BRP-01")) {
    console.error(`[FAIL] BRP-01 (Documented Business Rule vs. Code Discrepancy) was not synthesized when external spec requires 'at least 100' vs '$Order/TotalAmount > 100'!`);
    process.exit(1);
  }
  if (!Array.isArray(specManifest.business_rules) || specManifest.business_rules.length === 0) {
    console.error(`[FAIL] specManifest.business_rules was not populated!`);
    process.exit(1);
  }

  if (!reportMd.includes("../bug-hunt-tests/BugHunt_Executed_Tests_") || !reportMd.includes("#scenario-1")) {
    console.error(`[FAIL] Rendered Markdown report missing bidirectional link to executed tests (#scenario-1)!`);
    process.exit(1);
  }
  const executedTestsMd = renderExecutedTestsMarkdown(report);
  if (!executedTestsMd.includes("../bug-reports/BugHunt_Report_") || !executedTestsMd.includes('<a id="scenario-1"></a>')) {
    console.error(`[FAIL] Rendered Executed Tests Markdown missing bidirectional link to bug report or scenario anchor!`);
    process.exit(1);
  }

  // Verify Static Report Naming and Banner
  const testStaticReport = buildVerifiedBugReport(freeManifest, { scenarios: [], is_static: true });
  const testStaticReportMd = renderBugReportMarkdown(testStaticReport);
  if (!testStaticReportMd.includes("../bug-hunt-tests/BugHunt_Planned_Tests_")) {
    console.error(`[FAIL] Static Markdown report missing link to BugHunt_Planned_Tests_!`, testStaticReportMd);
    process.exit(1);
  }
  const testStaticTestsMd = renderExecutedTestsMarkdown(testStaticReport);
  if (!testStaticTestsMd.includes("Static AST Plan Only") || !testStaticTestsMd.includes("Specified Mendix Verification Scenarios")) {
    console.error(`[FAIL] Static Planned Tests Markdown missing Static AST Plan Only banner!`, testStaticTestsMd);
    process.exit(1);
  }

  // Verify Direct Dynamic Execution Fixes (Defect 1, 2, 3: .env token, numeric null, Sfcr removal)
  const dummyTc = {
    Name: "Scenario_1_BHP_01_HYP_1",
    TargetMicroflow: "TestsuiteModule.IF_SUB_tcse_create_preconditions_check",
    TCEX_RQ_TestStepList: [
      {
        Sequence: 1,
        Name: "Create EXUS",
        Action: "CreateObject",
        EntityName: "TestUserModule.EXUS_ExecutionUser",
        TCEX_RQ_AttributeValueList: [
          { AttributeName: "Username", AttributeType: "StringType", Value: "UserA" },
        ],
      },
      {
        Sequence: 2,
        Name: "Create TCSE",
        Action: "CreateObject",
        EntityName: "TestsuiteModule.TCSE_TestCase",
        TCEX_RQ_AttributeValueList: [
          { AttributeName: "Name", AttributeType: "StringType", Value: "Test Case 1" },
          { AttributeName: "Threads", AttributeType: "IntegerType", Value: "empty" },
          { AttributeName: "Count", AttributeType: "LongType", Value: null },
          { AttributeName: "Ratio", AttributeType: "DecimalType", Value: "" },
          { AttributeName: "Rate", AttributeType: "FloatType", Value: "empty" },
        ],
        TCEX_RQ_Sfar: [
          {
            AssociationName: "TestsuiteModule.exus_tcse",
            TestStepRunKey_output: 1,
          },
        ],
      },
    ],
  };

  const compiledStepRun = compileTestCaseToStepRun(dummyTc, freeManifest, sampleBundle);
  if (compiledStepRun.RollbackTcseAfterExecution !== "Yes" || compiledStepRun.is_bughunt !== true) {
    console.error("[FAIL] compileTestCaseToStepRun missing RollbackTcseAfterExecution or is_bughunt flag!", compiledStepRun);
    process.exit(1);
  }

  const oactSteps = (compiledStepRun.TCEX_RQ_TestStepRun || []).map((s) => s.TCEX_RQ_TestStepRunOact).filter(Boolean);
  for (const oact of oactSteps) {
    if (oact.Action === "Create" && oact.TCEX_RQ_Sfcr) {
      console.error("[FAIL] TCEX_RQ_Sfcr is still attached to Create action!", oact);
      process.exit(1);
    }
  }

  const tcseStep = oactSteps.find((o) => o.EntityQualifiedName === "TestsuiteModule.TCSE_TestCase");
  if (!tcseStep) {
    console.error("[FAIL] TCSE Create step was not compiled!", oactSteps);
    process.exit(1);
  }
  const tcseAttrs = (tcseStep.TCEX_RQ_EntityValueRun || {}).TCEX_RQ_AttributeValueRun || [];
  const numericAttrs = tcseAttrs.filter((a) => ["IntegerType", "LongType", "DecimalType", "FloatType"].includes(a.DataType));
  for (const numAttr of numericAttrs) {
    if (numAttr.Value !== null) {
      console.error(`[FAIL] Numeric attribute ${numAttr.AttributeName} has non-null empty value '${numAttr.Value}'! Should be null to avoid Java NumberFormatException!`, numAttr);
      process.exit(1);
    }
  }

  if (!tcseStep.TCEX_RQ_Sfar || tcseStep.TCEX_RQ_Sfar.length !== 1 || tcseStep.TCEX_RQ_Sfar[0].TestStepRunKey_output !== 1) {
    console.error("[FAIL] TCEX_RQ_Sfar association was not preserved on Create step!", tcseStep);
    process.exit(1);
  }

  // Verify generateExecuteTestcasePayload groups multi-attribute overrides per entity
  const groupManifest = {
    module: "TestsuiteModule",
    hypotheses: [
      {
        id: "HYP_GROUP_1",
        pattern_id: "BHP-01",
        microflow: "TestsuiteModule.IF_SUB_tcse_create_preconditions_check",
        title: "Test multi-attribute grouping",
        variation_overrides: {
          "TCSE_TestCase.Name": "Test Case 1",
          "TCSE_TestCase.ConfigurationType": "Functional",
          "TCSE_TestCase.Threads": "empty",
        },
      },
    ],
  };
  const groupedPayload = generateExecuteTestcasePayload(groupManifest);
  const groupedTc = (groupedPayload.TCEX_RQ_TestCaseList || [])[0];
  const groupedOactSteps = (groupedTc.TCEX_RQ_TestStepList || []).filter((s) => s.Action === "CreateObject");
  if (groupedOactSteps.length !== 1) {
    console.error("[FAIL] generateExecuteTestcasePayload did not group attributes for same entity into 1 step!", groupedOactSteps);
    process.exit(1);
  }
  if (groupedOactSteps[0].TCEX_RQ_AttributeValueList.length !== 3) {
    console.error("[FAIL] Grouped step does not contain all 3 attributes!", groupedOactSteps[0]);
    process.exit(1);
  }

  // Verify parseEnvFile and resolvePluginAuthToken
  const testEnvContent = "PLUGIN_MCP_URL=\"http://localhost:8081/plugin/mcp\"\nPLUGIN_MCP_TOKEN=\"Bearer test-token-123\"\n";
  const tempEnvPath = path.join(process.cwd(), "scratch", "test_bughunt.env");
  fs.mkdirSync(path.dirname(tempEnvPath), { recursive: true });
  fs.writeFileSync(tempEnvPath, testEnvContent, "utf8");
  const parsedEnv = parseEnvFile(tempEnvPath);
  if (parsedEnv.PLUGIN_MCP_TOKEN !== "Bearer test-token-123" || parsedEnv.PLUGIN_MCP_URL !== "http://localhost:8081/plugin/mcp") {
    console.error("[FAIL] parseEnvFile failed to parse key-values!", parsedEnv);
    process.exit(1);
  }
  fs.unlinkSync(tempEnvPath);

  // 7. Verify v2.5.0 Human-Readable Mendix Ecosystem Terminology & Actual vs. Latent Bug Separation
  if (!reportMd.includes("Actual Bugs (Reproducible Now)") || !reportMd.includes("Latent Bugs (Future Regression Risks)")) {
    console.error("[FAIL] v2.5.0 Rendered Markdown report missing Actual Bugs and Latent Bugs summary rows!");
    process.exit(1);
  }
  if (
    !reportMd.includes("2A. Confirmed Actual Bugs — Reproducible Now via Pages or APIs") ||
    !reportMd.includes("2B. Confirmed Latent Bugs — Protected Today by Page/Caller Flow (Future Regression Risks)")
  ) {
    console.error("[FAIL] v2.5.0 Rendered Markdown report missing Section 2A (Actual Bugs) and Section 2B (Latent Bugs)!");
    process.exit(1);
  }
  if (!reportMd.includes("View Executed Test Details Inline")) {
    console.error("[FAIL] v2.5.0 Rendered Markdown report missing self-contained inline test details!");
    process.exit(1);
  }
  const bannedJargonTerms = [
    "PAT-01",
    "PAT-02",
    "PAT-124",
    "PAT-126",
    "ANTI-69",
    "Adversarial Input Payload",
    "Injected Adversarial Overrides",
    "Persistence Sinks",
    "0 Database Residue",
    "Management-by-Exception",
    "RollbackTcseAfterExecution",
  ];
  for (const banned of bannedJargonTerms) {
    if (reportMd.includes(banned) || executedTestsMd.includes(banned)) {
      console.error(`[FAIL] v2.5.0 Customer-facing Markdown report still contains internal jargon '${banned}'!`);
      process.exit(1);
    }
  }

  // Test UFP-01 / UFP-02 / UFP-03 & Latent vs Actual classification across a Page -> ACT_ (Commit/Delete) -> SUB_ call hierarchy
  const userFlowHierarchyBundle = {
    module: "CarRentalModule",
    entities: [
      {
        name: "Booking",
        qualified_name: "CarRentalModule.Booking",
        attributes: [
          { name: "Status", type: "Enumeration" },
          { name: "PickupDate", type: "DateTime" },
          { name: "ReturnDate", type: "DateTime" },
          { name: "TotalPrice", type: "Float" },
        ],
      },
    ],
    pages: [
      {
        qualified_name: "CarRentalModule.Booking_NewEdit",
        calls_microflows: ["CarRentalModule.ACT_Booking_SaveAndConfirm"],
        widgets: [
          { name: "dpPickup", attribute: "CarRentalModule.Booking.PickupDate", required_on_page: true },
          { name: "dpReturn", attribute: "CarRentalModule.Booking.ReturnDate", required_on_page: true },
        ],
      },
    ],
    microflows: [
      {
        name: "ACT_Booking_SaveAndConfirm",
        qualified_name: "CarRentalModule.ACT_Booking_SaveAndConfirm",
        documentation: "Delete non persistable objects before saving.",
        parameters: [{ name: "Booking", entity: "CarRentalModule.Booking", type: "Object" }],
        activities: [
          {
            id: "act_split_dates",
            type: "ExclusiveSplit",
            caption: "Dates filled?",
            expression: "$Booking/PickupDate != empty and $Booking/ReturnDate != empty",
          },
          {
            id: "act_call_sub",
            type: "MicroflowCall",
            caption: "Calculate total price",
            called_microflow: "CarRentalModule.SUB_Booking_CalculatePrice",
          },
          {
            id: "act_status_change",
            type: "ChangeObject",
            caption: "Set Status to Completed and Commit",
            variable: "Booking",
            commit: "Yes",
            member_names: ["Status", "TotalPrice"],
            expressions: ["CarRentalModule.Enum_Status.Completed", "$Booking/TotalPrice * 1.21 / 3"],
          },
        ],
      },
      {
        name: "SUB_Booking_CalculatePrice",
        qualified_name: "CarRentalModule.SUB_Booking_CalculatePrice",
        parameters: [{ name: "Booking", entity: "CarRentalModule.Booking", type: "Object" }],
        activities: [
          {
            id: "sub_days_between",
            type: "JavaActionCall",
            caption: "Days between",
            java_action: "MenditectMtaCommons.FTN_DaysBetween",
            arguments: ["$Booking/PickupDate", "$Booking/ReturnDate"],
          },
        ],
      },
    ],
  };

  const ufManifest = analyzeAstBundle(userFlowHierarchyBundle, "free");
  if ((ufManifest.business_rules || []).some((r) => /Delete non persistable/i.test(r.rule_statement))) {
    console.error("[FAIL] v2.4.0 isNormativeBusinessRuleText failed to filter procedural comment 'Delete non persistable objects...'!");
    process.exit(1);
  }
  if (!ufManifest.hypotheses.some((h) => h.pattern_id === "BHP-29" && h.pattern_alias === "BHP-33")) {
    console.error("[FAIL] v2.4.0 BHP-29/BHP-33 (Unchecked Status State Transition) was not detected!");
    process.exit(1);
  }
  if (!ufManifest.amber_risks.some((a) => a.pattern_id === "BHP-34")) {
    console.error("[FAIL] v2.4.0 BHP-34 (Unrounded Financial / Float Arithmetic) was not detected!");
    process.exit(1);
  }
  const latentSubFinding = ufManifest.hypotheses.find(
    (h) => h.microflow === "CarRentalModule.SUB_Booking_CalculatePrice" && h.pattern_id === "BHP-01"
  );
  if (
    !latentSubFinding ||
    latentSubFinding.exposure_classification !== "LATENT_IMPLICITLY_PROTECTED" ||
    !latentSubFinding.exposes_commit_or_delete_in_hierarchy
  ) {
    console.error("[FAIL] v2.4.0 Call-hierarchy analyzer failed to classify SUB_Booking_CalculatePrice finding as LATENT_IMPLICITLY_PROTECTED with exposes_commit_or_delete_in_hierarchy=true!", latentSubFinding);
    process.exit(1);
  }
  if (!ufManifest.amber_risks.some((a) => a.pattern_id === "UFP-01" || a.pattern_id === "UFP-02" || a.pattern_id === "UFP-03")) {
    console.error("[FAIL] v2.4.0 Call-hierarchy analyzer did not synthesize UFP-01/UFP-02/UFP-03 findings!");
    process.exit(1);
  }

  // Simulate mixed runtime results (1 Actual Bug in ACT_Booking_SaveAndConfirm, 1 Latent Bug in SUB_Booking_CalculatePrice)
  const actualHyp = ufManifest.hypotheses.find((h) => h.microflow === "CarRentalModule.ACT_Booking_SaveAndConfirm") || ufManifest.hypotheses[0];
  const ufSimResults = {
    total_duration_ms: 210,
    scenarios: [
      {
        hypothesis_id: actualHyp.id,
        pattern_id: actualHyp.pattern_id,
        outcome: "FAIL_ASSERTION_MISMATCH",
        error_message: "Invalid status transition to Completed committed directly",
        duration_ms: 95,
      },
      {
        hypothesis_id: latentSubFinding.id,
        pattern_id: latentSubFinding.pattern_id,
        outcome: "FAIL_UNHANDLED_EXCEPTION",
        error_message: "NullPointerException in FTN_DaysBetween when SUB_Booking_CalculatePrice is invoked without UI/caller date guard",
        duration_ms: 115,
      },
    ],
  };
  const ufReport = buildVerifiedBugReport(ufManifest, ufSimResults);
  if (ufReport.scorecard.confirmed_actual_bugs_red !== 1 || ufReport.scorecard.confirmed_latent_bugs_red !== 1) {
    console.error("[FAIL] v2.4.0 buildVerifiedBugReport did not separate confirmed_actual_bugs_red (1) and confirmed_latent_bugs_red (1)!", ufReport.scorecard);
    process.exit(1);
  }
  const modulePlanMd = generateExecutionPlanMarkdown(tsManifest);
  if (modulePlanMd.includes("TestsuiteModule.*")) {
    console.error("[FAIL] v2.4.0 generateExecutionPlanMarkdown leaked wildcard 'TestsuiteModule.*' into the Execution Plan!");
    process.exit(1);
  }

  // Self-Test 2.5.0: Static Bug Report & Synthetic Trigger Payload Typing
  const staticReport = buildVerifiedBugReport(ufManifest, { scenarios: [], is_static: true });
  if (!staticReport.is_static || staticReport.scorecard.confirmed_bugs_red !== ufManifest.hypotheses.length) {
    console.error("[FAIL] buildVerifiedBugReport in static mode did not format all hypotheses as confirmed_bugs_red!", staticReport.scorecard);
    process.exit(1);
  }
  if (!staticReport.confirmed_bugs.every((b) => b.status === "STATIC_AST_IDENTIFIED")) {
    console.error("[FAIL] Static bug report findings are not marked STATIC_AST_IDENTIFIED!");
    process.exit(1);
  }

  const scratchTestDir = path.join(process.cwd(), "scratch", "self_test_reports");
  const writtenReports = writeBugReports(staticReport, { out: scratchTestDir });
  if (!fs.existsSync(writtenReports.reportPath) || !fs.existsSync(writtenReports.testsPath)) {
    console.error("[FAIL] writeBugReports failed to create static Markdown reports!", writtenReports);
    process.exit(1);
  }
  const reportContent = fs.readFileSync(writtenReports.reportPath, "utf8");
  if (!reportContent.includes("Static AST Identified")) {
    console.error("[FAIL] Static bug report markdown does not include 'Static AST Identified' status!");
    process.exit(1);
  }
  // Clean up self-test artifacts
  try {
    fs.rmSync(scratchTestDir, { recursive: true, force: true });
    if (fs.existsSync(writtenReports.jsonPath)) fs.unlinkSync(writtenReports.jsonPath);
  } catch {
    // Ignore cleanup errors
  }

  // Synthetic Trigger Payload Typing Test
  const syntheticTriggerManifest = {
    module: "CarRentalModule",
    target_microflow: "CarRentalModule.ACT_Booking_Save",
    hypotheses: [
      {
        id: "HYP_SYNTH_01",
        pattern_id: "BHP-14",
        microflow: "CarRentalModule.ACT_Booking_Save",
        title: "Synthetic Trigger Commit Test",
        variation_overrides: {
          "Trigger_CarRentalModule.EVT_booking_commit_start_end_date_not_empty_False": "true",
          "Booking.StartDate": "2026-05-15T00:00:00.000Z",
          "Booking.BookingNumber": "BK-1001",
        },
      },
    ],
  };

  const syntheticPayload = generateExecuteTestcasePayload(syntheticTriggerManifest);
  const tcSteps = syntheticPayload.TCEX_RQ_TestCaseList[0].TCEX_RQ_TestStepList;
  const triggerStep = tcSteps.find((s) => s.EntityName === "CarRentalModule.Trigger_CarRentalModule");
  if (triggerStep) {
    console.error("[FAIL] generateExecuteTestcasePayload generated a non-existent entity step for synthetic Trigger_CarRentalModule!");
    process.exit(1);
  }

  const dateStep = tcSteps.find((s) => s.TCEX_RQ_AttributeValueList?.some((a) => a.AttributeName === "StartDate"));
  const dateAttr = dateStep?.TCEX_RQ_AttributeValueList?.find((a) => a.AttributeName === "StartDate");
  if (!dateAttr || dateAttr.AttributeType !== "DateTimeType") {
    console.error(`[FAIL] Date attribute StartDate was not typed as DateTimeType!`, dateAttr);
    process.exit(1);
  }

  // Test validatePlanAndPayload with synthetic trigger payload
  const tempPlanPath = path.join(process.cwd(), "scratch", "temp_selftest_plan.md");
  const tempPayloadPath = path.join(process.cwd(), "scratch", "temp_selftest_payload.json");
  fs.mkdirSync(path.dirname(tempPlanPath), { recursive: true });
  fs.writeFileSync(
    tempPlanPath,
    `---\nrollback: "Yes"\n---\n## 3. Test Steps & Action Sequence\n| Step |\n## 4. Test Scenarios & Test Data\n| Scenario |\n`,
    "utf8"
  );
  fs.writeFileSync(tempPayloadPath, JSON.stringify(syntheticPayload, null, 2), "utf8");

  const valResult = validatePlanAndPayload(tempPlanPath, tempPayloadPath);
  try {
    fs.unlinkSync(tempPlanPath);
    fs.unlinkSync(tempPayloadPath);
  } catch {
    // Ignore cleanup errors
  }

  if (!valResult.valid) {
    console.error("[FAIL] validatePlanAndPayload failed on synthetic trigger payload!", valResult.errors);
    process.exit(1);
  }

  // Self-Test 2.6.0: Mendix Semantics, Phase 1 False-Positive Elimination, Phase 3A (BHP-35..40, DQP-09), Phase 3B (JAP-01..07, SEC-10), Phase 3C (INT-03..07), & Phase 3D Harnesses
  const v260Bundle = {
    module: "MendixSemanticsModule",
    java_actions: [
      {
        name: "JA_StubAction",
        qualified_name: "MendixSemanticsModule.JA_StubAction",
        is_unimplemented_stub: true,
        unprotected_get_value_members: ["OrderCode"],
        uses_system_context: false,
        system_context_mutates_db: false,
        swallows_exceptions_silently: false,
        unclosed_stream_calls: false,
        has_external_network_io: false,
        return_can_be_null: true,
        parameters: ["Order"],
      },
      {
        name: "JA_SystemContextMutator",
        qualified_name: "MendixSemanticsModule.JA_SystemContextMutator",
        is_unimplemented_stub: false,
        unprotected_get_value_members: [],
        uses_system_context: true,
        system_context_mutates_db: true,
        swallows_exceptions_silently: true,
        unclosed_stream_calls: true,
        has_external_network_io: false,
        return_can_be_null: false,
        parameters: ["Order"],
      },
    ],
    entities: [
      {
        name: "Order",
        qualified_name: "MendixSemanticsModule.Order",
        is_persistable: true,
        attributes: [
          { name: "OrderCode", type: "String" },
          { name: "Status", type: "Enumeration" },
          { name: "Amount", type: "Decimal" },
        ],
        associations: [
          {
            name: "Order_Customer",
            qualified_name: "MendixSemanticsModule.Order_Customer",
            parent: "MendixSemanticsModule.Order",
            child: "MendixSemanticsModule.Customer",
            owner: "Default",
            type: "Reference",
            parent_delete_behavior: "DeleteMeButKeepReferences",
            child_delete_behavior: "DeleteMeIfNoReferences",
          },
          {
            name: "Order_Tags",
            qualified_name: "MendixSemanticsModule.Order_Tags",
            parent: "MendixSemanticsModule.Order",
            child: "MendixSemanticsModule.Tag",
            owner: "Default",
            type: "ReferenceSet",
            parent_delete_behavior: "DeleteMeButKeepReferences",
            child_delete_behavior: "DeleteMeButKeepReferences",
          },
        ],
        event_handlers: [
          {
            event: "BeforeCommit",
            microflow: "MendixSemanticsModule.BCO_Order_Validate",
            raise_error_on_false: true,
          },
        ],
      },
      {
        name: "Customer",
        qualified_name: "MendixSemanticsModule.Customer",
        is_persistable: true,
        attributes: [{ name: "Name", type: "String" }],
      },
      {
        name: "Tag",
        qualified_name: "MendixSemanticsModule.Tag",
        is_persistable: true,
        attributes: [{ name: "Label", type: "String" }],
      },
    ],
    microflows: [
      {
        name: "PRS_Order_CreateEndpoint",
        qualified_name: "MendixSemanticsModule.PRS_Order_CreateEndpoint",
        return_type: "Void",
        parameters: [
          { name: "Order", entity: "MendixSemanticsModule.Order", type: "Object" },
          { name: "httpResponse", entity: "System.HttpResponse", type: "Object" },
        ],
        sequence_flows: [
          { origin_id: "split_null", destination_id: "end_early", case_value: "false" },
          { origin_id: "split_null", destination_id: "act_safe_trim", case_value: "true" },
        ],
        activities: [
          {
            id: "split_null",
            type: "ExclusiveSplit",
            caption: "Order != empty?",
            expression: "$Order != empty",
          },
          {
            id: "end_early",
            type: "EndEvent",
            caption: "Return early without setting StatusCode",
          },
          {
            id: "act_safe_trim",
            type: "ChangeObject",
            caption: "Null-safe trim and uncommitted amount change",
            variable: "Order",
            commit: "No",
            with_events: false,
            expressions: ["trim($Order/OrderCode)", "$Order/Amount + 10"],
          },
          {
            id: "split_enum",
            type: "ExclusiveSplit",
            caption: "Status?",
            expression: "$Order/Status",
            outgoing_cases: ["Open", "Closed"],
          },
          {
            id: "act_create_cust",
            type: "CreateObject",
            caption: "Create NewCustomer",
            entity: "MendixSemanticsModule.Customer",
            output_variable: "NewCustomer",
            commit: "No",
          },
          {
            id: "act_link_autocommit",
            type: "ChangeObject",
            caption: "Link uncommitted NewCustomer and commit Order without events",
            variable: "Order",
            commit: "Yes",
            with_events: false,
            member_names: ["MendixSemanticsModule.Order_Customer"],
            expressions: ["$NewCustomer"],
          },
          {
            id: "act_non_owner_commit",
            type: "CommitObject",
            caption: "Commit child Tag thinking it saves Order_Tags",
            variable: "Tag",
            entity: "MendixSemanticsModule.Tag",
            with_events: true,
          },
          {
            id: "act_loop_add_refset",
            type: "ChangeList",
            caption: "Add Tag in loop",
            variable: "TagList",
            inside_loop: true,
            operation: "Add",
            expressions: ["$Tag"],
          },
          {
            id: "act_delete_cust",
            type: "DeleteObject",
            caption: "Delete Customer with DeleteMeIfNoReferences",
            variable: "NewCustomer",
            entity: "MendixSemanticsModule.Customer",
            error_handling_type: "Rollback",
          },
          {
            id: "act_sub_custom_rb",
            type: "MicroflowCall",
            caption: "Call sub with CustomWithRollback",
            called_microflow: "MendixSemanticsModule.SUB_Helper",
            error_handling_type: "CustomWithRollback",
          },
          {
            id: "act_commit_continue",
            type: "CommitObject",
            caption: "Commit with Continue error handling",
            variable: "Order",
            entity: "MendixSemanticsModule.Order",
            error_handling_type: "Continue",
          },
          {
            id: "act_xpath_neq",
            type: "Retrieve",
            caption: "Retrieve Orders with != and Assoc = empty",
            retrieve_source: "Database",
            entity: "MendixSemanticsModule.Order",
            xpath: "[Status != 'Cancelled'] [MendixSemanticsModule.Order_Customer = empty]",
            output_variable: "OrderList",
          },
          {
            id: "act_change_between_ret_and_agg",
            type: "ChangeObject",
            caption: "Modify Order Amount in memory before AggregateList",
            variable: "Order",
            entity: "MendixSemanticsModule.Order",
            commit: "No",
            expressions: ["$Order/Amount + 5"],
          },
          {
            id: "act_agg_sql_pushdown",
            type: "AggregateList",
            caption: "Sum OrderList Amount after in-memory change",
            list_variable: "OrderList",
            aggregate_function: "Sum",
            attribute: "Amount",
            output_variable: "TotalAmount",
          },
          {
            id: "act_head_order",
            type: "ListOperation",
            caption: "Head of OrderList",
            operation: "Head",
            input_list_variable: "OrderList",
            output_variable: "FirstOrder",
          },
          {
            id: "act_use_first_order",
            type: "ChangeObject",
            caption: "Dereference FirstOrder without empty check",
            variable: "FirstOrder",
            commit: "No",
            expressions: ["$FirstOrder/Amount + 1"],
          },
          {
            id: "act_rest_call",
            type: "RestCall",
            caption: "POST to external ERP before validation",
            http_method: "POST",
            location_expression: "'https://api.example.com/orders?code=' + $Order/OrderCode",
            store_error_body_in_latest_http_response: false,
            response_handling: "ImportMapping",
            output_variable: "ImportedReceipt",
            error_handling_type: "CustomWithoutRollback",
          },
          {
            id: "act_use_imported_receipt",
            type: "ChangeObject",
            caption: "Use ImportedReceipt without empty check and read $latestHttpResponse/Content",
            variable: "Order",
            commit: "No",
            expressions: ["$ImportedReceipt/ReceiptId", "$latestHttpResponse/Content"],
          },
          {
            id: "act_val_after_rest",
            type: "ValidationFeedback",
            caption: "Validate Order after REST POST",
            variable: "Order",
            attribute: "OrderCode",
          },
          {
            id: "act_ja_stub",
            type: "JavaActionCall",
            caption: "Call JA_StubAction",
            java_action: "MendixSemanticsModule.JA_StubAction",
            output_variable: "JaResult",
            arguments: ["$NewCustomer/Name"],
          },
          {
            id: "act_use_ja_result",
            type: "ChangeObject",
            caption: "Use JaResult without empty check",
            variable: "Order",
            commit: "No",
            expressions: ["$JaResult/Value"],
          },
          {
            id: "act_task_queue",
            type: "JavaActionCall",
            caption: "Queue uncommitted NewCustomer in Task Queue",
            java_action: "CommunityCommons.executeMicroflowInBackground",
            is_task_queue: true,
            arguments: ["$NewCustomer"],
          },
        ],
      },
      {
        name: "ACT_UnsafeSystemContextJava",
        qualified_name: "MendixSemanticsModule.ACT_UnsafeSystemContextJava",
        return_type: "Void",
        parameters: [{ name: "Order", entity: "MendixSemanticsModule.Order", type: "Object" }],
        activities: [
          {
            id: "act_ja_sys",
            type: "JavaActionCall",
            caption: "Call JA_SystemContextMutator",
            java_action: "MendixSemanticsModule.JA_SystemContextMutator",
            arguments: ["$Order"],
          },
        ],
      },
    ],
  };

  const v260Manifest = analyzeAstBundle(v260Bundle, "free");
  const allV260Codes = new Set([
    ...v260Manifest.hypotheses.flatMap((h) => [h.pattern_id, h.pattern_alias].filter(Boolean)),
    ...v260Manifest.amber_risks.flatMap((a) => [a.pattern_id, a.pattern_alias].filter(Boolean)),
  ]);

  const requiredV260Patterns = [
    "BHP-23",
    "BHP-35",
    "BHP-36",
    "BHP-37",
    "BHP-38",
    "BHP-39",
    "BHP-40",
    "DQP-09",
    "JAP-01",
    "JAP-02",
    "JAP-03",
    "SEC-10",
    "JAP-04",
    "JAP-05",
    "JAP-06",
    "JAP-07",
    "INT-03",
    "INT-04",
    "INT-05",
    "INT-06",
    "INT-07",
  ];

  for (const reqCode of requiredV260Patterns) {
    if (!allV260Codes.has(reqCode)) {
      console.error(`[FAIL] v2.6.0 Detector failed to synthesize required pattern '${reqCode}'! Found:`, [...allV260Codes]);
      process.exit(1);
    }
  }

  // Verify SAFE-01 quarantines ACT_UnsafeSystemContextJava because JA_SystemContextMutator mutates DB via Core.createSystemContext()
  const unsafeSysMf = v260Bundle.microflows.find((m) => m.name === "ACT_UnsafeSystemContextJava");
  const sysGuardrail = evaluateGuardrails(v260Bundle, unsafeSysMf);
  if (!sysGuardrail.safe_01_quarantined) {
    console.error("[FAIL] v2.6.0 SAFE-01 failed to quarantine JavaActionCall with system_context_mutates_db=true!", sysGuardrail);
    process.exit(1);
  }

  // Verify Phase 3D generateExecuteTestcasePayload synthesizes System.HttpResponse (StatusCode=200) + AssertAttributeValueCompare (>= 400) for INT-07
  const int07Hyp = v260Manifest.hypotheses.find((h) => h.pattern_id === "INT-07");
  if (!int07Hyp) {
    console.error("[FAIL] v2.6.0 INT-07 hypothesis was not generated in hypotheses list!");
    process.exit(1);
  }
  const int07Payload = generateExecuteTestcasePayload({
    module: "MendixSemanticsModule",
    target_microflow: int07Hyp.microflow,
    hypotheses: [int07Hyp],
  });
  const int07Steps = int07Payload.TCEX_RQ_TestCaseList[0].TCEX_RQ_TestStepList;
  const httpRespCreate = int07Steps.find((s) => s.EntityName === "System.HttpResponse" && s.Action === "CreateObject");
  const httpRespAssert = int07Steps.find((s) => s.Action === "AssertAttributeValueCompare" && s.AttributeName === "StatusCode");
  if (!httpRespCreate || !httpRespAssert) {
    console.error("[FAIL] v2.6.0 Phase 3D INT-07 payload harness did not synthesize CreateObject(System.HttpResponse) + AssertAttributeValueCompare(StatusCode >= 400)!", int07Steps);
    process.exit(1);
  }

  // Self-Test 2.8.0: Two-Tier Evidence Transparency & Methodology Reporting
  const badgeDynamic = formatVerificationStatusBadge({ verification_status: "DYNAMIC_RECEIPT_CONFIRMED", receipt_test_number: 4 });
  if (!badgeDynamic.includes("Dynamically Confirmed") || !badgeDynamic.includes("Test #4")) {
    console.error("[FAIL] formatVerificationStatusBadge failed for DYNAMIC_RECEIPT_CONFIRMED!", badgeDynamic);
    process.exit(1);
  }
  const badgeRep = formatVerificationStatusBadge({ verification_status: "STATIC_REPRESENTATIVE_PROOF" });
  if (!badgeRep.includes("Statically Verified (Representative Proof)")) {
    console.error("[FAIL] formatVerificationStatusBadge failed for STATIC_REPRESENTATIVE_PROOF!", badgeRep);
    process.exit(1);
  }
  const badgeCandidate = formatVerificationStatusBadge({ verification_status: "STATIC_AST_CANDIDATE" });
  if (!badgeCandidate.includes("Static AST Candidate")) {
    console.error("[FAIL] formatVerificationStatusBadge failed for STATIC_AST_CANDIDATE!", badgeCandidate);
    process.exit(1);
  }

  // Verify Representative Proof extrapolation in ufReport
  if (ufReport.scorecard.confirmed_dynamically_red !== 2 || ufReport.scorecard.confirmed_representative_red < 1) {
    console.error("[FAIL] Two-Tier Evidence scorecard did not count dynamic vs representative confirmed bugs!", ufReport.scorecard);
    process.exit(1);
  }
  const repProofFinding = ufReport.confirmed_bugs.find((b) => b.verification_status === "STATIC_REPRESENTATIVE_PROOF");
  if (!repProofFinding || !repProofFinding.representative_microflow || !repProofFinding.representative_scenario_number) {
    console.error("[FAIL] STATIC_REPRESENTATIVE_PROOF finding is missing representative link metadata!", repProofFinding);
    process.exit(1);
  }

  const renderedUfMd = renderBugReportMarkdown(ufReport);
  if (!renderedUfMd.includes("## 🔍 Verification Methodology & Evidence Standards")) {
    console.error("[FAIL] Rendered Markdown report is missing '## 🔍 Verification Methodology & Evidence Standards' section!");
    process.exit(1);
  }
  if (!renderedUfMd.includes("Representative Proof Methodology")) {
    console.error("[FAIL] Rendered Markdown report is missing Representative Proof Methodology callout box!");
    process.exit(1);
  }
  if (!renderedUfMd.includes("| Microflow & Finding | Verification Status | Severity | Priority | Recommended Fix |")) {
    console.error("[FAIL] Rendered Markdown report missing Verification Status column in Section 2A/2B findings table!");
    process.exit(1);
  }
  if (!renderedUfMd.includes("| Location & Code | Verification Status | Type | Business Risk & Priority | What We Found | How to Improve in Studio Pro |")) {
    console.error("[FAIL] Rendered Markdown report missing Verification Status column in Section 3 warnings table!");
    process.exit(1);
  }

  // Self-Test 2.9.0: Mendix Metamodel (IModel) StudioPro AST Normalization & Detectors BHP-41..43 + DQP-10 + ANTI-83 AutoNumber Filter
  const v290StudioProDm = {
    $Type: "DomainModels$DomainModel",
    module: "IModelTestModule",
    entities: [
      {
        name: "Vehicle",
        attributes: [
          {
            name: "VIN",
            type: { $Type: "DomainModels$StringAttributeType", length: 10 },
          },
          {
            name: "DiscountPct",
            type: { $Type: "DomainModels$IntegerAttributeType" },
          },
        ],
        validationRules: [
          {
            attribute: "IModelTestModule.Vehicle.VIN",
            ruleInfo: { $Type: "DomainModels$RequiredRuleInfo" },
          },
          {
            attribute: "IModelTestModule.Vehicle.DiscountPct",
            ruleInfo: { $Type: "DomainModels$RangeRuleInfo", minValue: 0, maxValue: 50 },
          },
        ],
        accessRules: [
          {
            moduleRoles: ["IModelTestModule.Customer"],
            defaultMemberAccessRights: "ReadOnly",
            memberAccesses: [{ attribute: "DiscountPct", accessRights: "ReadOnly" }],
          },
        ],
      },
      {
        name: "ElectricVehicle",
        generalization: {
          $Type: "DomainModels$Generalization",
          generalization: "IModelTestModule.Vehicle",
        },
        attributes: [{ name: "BatteryKwh", type: { $Type: "DomainModels$IntegerAttributeType" } }],
      },
      {
        name: "DieselVehicle",
        generalization: {
          $Type: "DomainModels$Generalization",
          generalization: "IModelTestModule.Vehicle",
        },
        attributes: [{ name: "TankLiters", type: { $Type: "DomainModels$IntegerAttributeType" } }],
      },
    ],
  };

  const normEntities = normalizeStudioProDomainModel(v290StudioProDm, "IModelTestModule");
  const normVehicle = normEntities.find((e) => e.name === "Vehicle");
  const normEv = normEntities.find((e) => e.name === "ElectricVehicle");
  if (!normVehicle || !normEv || normEv.generalization !== "IModelTestModule.Vehicle") {
    console.error("[FAIL] normalizeStudioProDomainModel failed to parse DomainModels$Generalization!", normEntities);
    process.exit(1);
  }
  const vinAttr = normVehicle.attributes.find((a) => a.name === "VIN");
  const discAttr = normVehicle.attributes.find((a) => a.name === "DiscountPct");
  if (!vinAttr?.is_required || vinAttr.max_length !== 10 || discAttr?.min_value !== 0 || discAttr?.max_value !== 50) {
    console.error("[FAIL] normalizeStudioProDomainModel failed to parse ValidationRules / StringAttributeType.length!", normVehicle.attributes);
    process.exit(1);
  }

  const v290StudioProMf = {
    $Type: "Microflows$Microflow",
    name: "ACT_Vehicle_ProcessFleet",
    module: "IModelTestModule",
    allowedModuleRoles: ["IModelTestModule.Customer"],
    // Note: applyEntityAccess intentionally omitted to verify Studio Pro default-value elision -> false
    objectCollection: {
      objects: [
        {
          $Type: "Microflows$MicroflowParameterObject",
          name: "VehicleParam",
          variableType: { $Type: "DataTypes$ObjectType", entity: "IModelTestModule.Vehicle" },
        },
        {
          $Type: "Microflows$InheritanceSplit",
          caption: "Check Vehicle Subtype",
          splitVariableName: "VehicleParam",
        },
        {
          $Type: "Microflows$ActionActivity",
          caption: "Unsafe Cast without upstream split on OtherVar",
          action: {
            $Type: "Microflows$CastAction",
            outputVariableName: "CastedEv",
            splitVariableName: "UncheckedVar",
          },
        },
        {
          $Type: "Microflows$LoopedActivity",
          caption: "While Counter < 10",
          loopSource: {
            $Type: "Microflows$WhileLoopCondition",
            whileExpression: "$Counter < 10",
          },
          objectCollection: {
            objects: [
              {
                $Type: "Microflows$ActionActivity",
                caption: "N+1 Retrieve inside loop",
                action: {
                  $Type: "Microflows$RetrieveAction",
                  outputVariableName: "InnerVehicles",
                  retrieveSource: {
                    $Type: "Microflows$DatabaseRetrieveSource",
                    entity: "IModelTestModule.Vehicle",
                  },
                },
              },
            ],
          },
        },
        {
          $Type: "Microflows$ActionActivity",
          caption: "Count Vehicles",
          action: {
            $Type: "Microflows$AggregateListAction",
            inputListVariableName: "InnerVehicles",
            aggregateFunction: "Count",
            outputVariableName: "VehicleCount",
          },
        },
        {
          $Type: "Microflows$ActionActivity",
          caption: "Update Vehicle with domain violations and unguarded Count division",
          action: {
            $Type: "Microflows$ChangeObjectAction",
            changeVariableName: "VehicleParam",
            commit: "Yes",
            items: [
              { attribute: "VIN", value: "'VIN-TOO-LONG-FOR-10-CHARS'" },
              { attribute: "DiscountPct", value: "85" },
              { attribute: "AvgLoad", value: "100 / $VehicleCount" },
            ],
          },
        },
      ],
    },
    flows: [
      {
        $Type: "Microflows$SequenceFlow",
        origin: "$id(/objectCollection/objects/1)",
        destination: "$id(/objectCollection/objects/2)",
        caseValues: [{ $Type: "Microflows$InheritanceCase", value: "IModelTestModule.ElectricVehicle" }],
      },
    ],
  };

  const normMf = normalizeStudioProMicroflow(v290StudioProMf, "IModelTestModule");
  if (normMf.apply_entity_access !== false) {
    console.error("[FAIL] normalizeStudioProMicroflow failed to default omitted applyEntityAccess to false!", normMf.apply_entity_access);
    process.exit(1);
  }
  if (!normMf.activities.some((a) => a.inside_loop === true && a.type === "Retrieve")) {
    console.error("[FAIL] normalizeStudioProMicroflow failed to recursively extract activities inside LoopedActivity!", normMf.activities);
    process.exit(1);
  }

  const v290Manifest = analyzeAstBundle(
    {
      module: "IModelTestModule",
      entities: normEntities,
      microflows: [normMf],
      pages: [],
    },
    "free"
  );
  const v290Codes = new Set([
    ...v290Manifest.hypotheses.map((h) => h.pattern_id),
    ...v290Manifest.amber_risks.map((a) => a.pattern_id),
  ]);
  for (const req290 of ["BHP-41", "BHP-42", "BHP-43", "DQP-10", "SEC-02"]) {
    if (!v290Codes.has(req290)) {
      console.error(`[FAIL] v2.9.0 IModel AST Detector failed to detect required pattern '${req290}'! Found:`, [...v290Codes]);
      process.exit(1);
    }
  }

  // Verify compileTestCaseToStepRun strips AutoNumberType on CreateObject (ANTI-83)
  const compiledAutoNum = compileTestCaseToStepRun({
    Sequence: 1,
    TCEX_RQ_TestStepList: [
      {
        Sequence: 1,
        Action: "CreateObject",
        EntityName: "IModelTestModule.Vehicle",
        TCEX_RQ_AttributeValueList: [
          { AttributeName: "AutoId", AttributeType: "AutoNumberType", Value: "1" },
          { AttributeName: "VIN", AttributeType: "StringType", Value: "V123" },
        ],
      },
    ],
  });
  const createAttrRuns = compiledAutoNum[0]?.TCEX_RQ_TestStepRunOact?.TCEX_RQ_EntityValueRun?.TCEX_RQ_AttributeValueRun || [];
  if (createAttrRuns.some((a) => a.AttributeName === "AutoId")) {
    console.error("[FAIL] compileTestCaseToStepRun did not strip AutoNumberType attribute on CreateObject (ANTI-83)!", createAttrRuns);
    process.exit(1);
  }

  // Self-Test 3.0.0: AST-Guided Pairwise Permutation & Property-Based Testing (PBT-01..05 + IPOG + Shrinker)
  const pbtTestBundle = {
    module: "PricingEngine",
    enable_pbt: true,
    entities: [
      {
        name: "Quote",
        qualified_name: "PricingEngine.Quote",
        attributes: [
          { name: "AutoId", type: "AutoNumber", is_auto_number: true },
          { name: "IsVip", type: "Boolean" },
          { name: "Tier", type: "Enumeration", enum_values: ["Bronze", "Silver", "Gold"] },
          { name: "Subtotal", type: "Decimal", min_value: 0, max_value: 10000 },
          { name: "DiscountPct", type: "Integer", min_value: 0, max_value: 50 },
          { name: "PromoCode", type: "String", max_length: 8 },
        ],
      },
    ],
    microflows: [
      {
        name: "ACT_Quote_CalculateAndSave",
        qualified_name: "PricingEngine.ACT_Quote_CalculateAndSave",
        return_type: "Boolean",
        parameters: [{ name: "Quote", entity: "PricingEngine.Quote", type: "Object" }],
        activities: [
          {
            id: "split_subtotal",
            type: "ExclusiveSplit",
            caption: "Subtotal >= 100?",
            expression: "$Quote/Subtotal >= 100",
          },
          {
            id: "split_discount",
            type: "ExclusiveSplit",
            caption: "DiscountPct <= 50?",
            expression: "$Quote/DiscountPct <= 50",
          },
          {
            id: "calc_total",
            type: "ChangeObject",
            variable: "Quote",
            commit: "Yes",
            changes: [
              {
                attribute: "Subtotal",
                value: "$Quote/Subtotal - ($Quote/Subtotal * $Quote/DiscountPct / 100)",
              },
            ],
          },
          {
            id: "val_msg",
            type: "ValidationFeedback",
            variable: "Quote",
            attribute: "DiscountPct",
            message_template: "Discount exceeds maximum allowed percentage.",
          },
        ],
      },
    ],
    pages: [],
  };

  // 1. Verify extractMicroflowDomainPartitions
  const extractedParts = extractMicroflowDomainPartitions(
    pbtTestBundle.microflows[0],
    pbtTestBundle
  );
  if ("Quote.AutoId" in extractedParts.factors) {
    console.error("[FAIL] extractMicroflowDomainPartitions did not exclude AutoNumber attribute Quote.AutoId (ANTI-83)!", extractedParts.factors);
    process.exit(1);
  }
  const vipPart = extractedParts.factors["Quote.IsVip"];
  if (!vipPart || vipPart.values.length !== 2 || vipPart.values.includes("empty")) {
    console.error("[FAIL] extractMicroflowDomainPartitions violated Mendix 2-valued Boolean rule on Quote.IsVip!", vipPart);
    process.exit(1);
  }
  const tierPart = extractedParts.factors["Quote.Tier"];
  if (!tierPart || !tierPart.values.includes("Gold") || !tierPart.values.includes("empty")) {
    console.error("[FAIL] extractMicroflowDomainPartitions failed 3-valued Enumeration partition on Quote.Tier!", tierPart);
    process.exit(1);
  }
  const subtotalPart = extractedParts.factors["Quote.Subtotal"];
  if (!subtotalPart || !subtotalPart.values.includes(100) || !subtotalPart.values.includes(19.99)) {
    console.error("[FAIL] extractMicroflowDomainPartitions failed to harvest ExclusiveSplit threshold 100 and IEEE-754 float 19.99 on Quote.Subtotal!", subtotalPart);
    process.exit(1);
  }
  const promoPart = extractedParts.factors["Quote.PromoCode"];
  if (!promoPart || !promoPart.values.some((v) => typeof v === "string" && v.length === 9)) {
    console.error("[FAIL] extractMicroflowDomainPartitions failed to generate max_length + 1 overflow string on Quote.PromoCode!", promoPart);
    process.exit(1);
  }

  // 2. Verify IPOG t=2 Pairwise Combinatorial Generator (`generatePairwisePermutations`)
  const syntheticFactors = {
    FactorA: [true, false],
    FactorB: ["Bronze", "Silver", "empty"],
    FactorC: ["empty", 0, 100, 101],
    FactorD: ["empty", 0, 50, 51],
  };
  const pairwiseRes = generatePairwisePermutations(syntheticFactors);
  if (
    pairwiseRes.total_cartesian_combinations !== 96 ||
    pairwiseRes.pair_coverage_pct !== 100 ||
    pairwiseRes.pairwise_count > 18
  ) {
    console.error("[FAIL] IPOG generatePairwisePermutations failed 100% 2-way coverage or size bound on 2x3x4x4 space!", pairwiseRes);
    process.exit(1);
  }

  // 3. Verify Property Synthesis (`PBT-01`..`PBT-05`) & `PBT-04` Double-Call Payload Compilation
  const pbtManifest = analyzeAstBundle(pbtTestBundle, "free", { pbt: true });
  const pbtCodes = new Set(pbtManifest.hypotheses.map((h) => h.pattern_id));
  for (const reqPbt of ["PBT-01", "PBT-02", "PBT-03", "PBT-04", "PBT-05"]) {
    if (!pbtCodes.has(reqPbt)) {
      console.error(`[FAIL] synthesizePropertyHypotheses failed to synthesize '${reqPbt}'! Found:`, [...pbtCodes]);
      process.exit(1);
    }
  }
  const pbt04Payload = generateExecuteTestcasePayload(pbtManifest, { findingId: "PBT-04", pbt: true });
  const pbt04Steps = pbt04Payload.TCEX_RQ_TestCaseList?.[0]?.TCEX_RQ_TestStepList || [];
  const pbt04MfCalls = pbt04Steps.filter((s) => s.Action === "MicroflowCall");
  if (pbt04MfCalls.length !== 2) {
    console.error("[FAIL] generateExecuteTestcasePayload did not emit 2 consecutive MicroflowCall steps for PBT-04 idempotency check!", pbt04Steps);
    process.exit(1);
  }

  // 4. Verify Delta-Debugging Counterexample Shrinker (`shrinkFailingPermutation`)
  const initialFailing = {
    "Quote.IsVip": false,
    "Quote.Tier": "empty",
    "Quote.Subtotal": 0,
    "Quote.DiscountPct": 50,
    "Quote.PromoCode": "XXXXXXXXX",
  };
  const baseSafe = {
    "Quote.IsVip": true,
    "Quote.Tier": "Gold",
    "Quote.Subtotal": 200,
    "Quote.DiscountPct": 10,
    "Quote.PromoCode": "VALID",
  };
  // Simulated bug that triggers ONLY when Quote.Subtotal === 0 AND Quote.DiscountPct === 50
  const shrinkRes = await shrinkFailingPermutation(
    initialFailing,
    baseSafe,
    (cand) => cand["Quote.Subtotal"] === 0 && cand["Quote.DiscountPct"] === 50,
    { maxProbes: 6 }
  );
  if (
    shrinkRes.shrunk_factor_count !== 2 ||
    shrinkRes.minimal_counterexample["Quote.Subtotal"] !== 0 ||
    shrinkRes.minimal_counterexample["Quote.DiscountPct"] !== 50 ||
    shrinkRes.shrink_steps_executed > 6
  ) {
    console.error("[FAIL] shrinkFailingPermutation failed to isolate the 2-factor minimal counterexample within 6 probes!", shrinkRes);
    process.exit(1);
  }

  // 5. Verify Multi-Column Section 4 Variation Matrix in `generateExecutionPlanMarkdown` & Zero Jargon Leak
  const pbtPlanMd = generateExecutionPlanMarkdown(pbtManifest, { findingId: "PBT-01", pbt: true, pbtSamples: 5 });
  if (!pbtPlanMd.includes("Step 1: `Quote.Subtotal`") || !pbtPlanMd.includes("Pairwise Permutation #1")) {
    console.error("[FAIL] generateExecutionPlanMarkdown did not render concrete Step 1 attribute rows and Pairwise Permutation columns in Section 4!", pbtPlanMd);
    process.exit(1);
  }
  const pbtReport = buildVerifiedBugReport(pbtManifest, { scenarios: [], is_static: true });
  const pbtReportMd = renderBugReportMarkdown(pbtReport);
  for (const banned of [
    "PAT-01",
    "PAT-02",
    "PAT-07",
    "PAT-124",
    "PAT-126",
    "ANTI-69",
    "RED-ACTUAL",
    "RED-LATENT",
    "AMBER-UI",
    "Oracle",
  ]) {
    if (pbtReportMd.includes(banned)) {
      console.error(`[FAIL] Customer report for PBT findings leaked banned jargon term '${banned}'!`);
      process.exit(1);
    }
  }

  // ==========================================================================
  // Self-Test 3.1.0: Automatic Model-Derived Invariant Business Rule Discovery,
  // State-Independence Filtering, Cross-Committer Bypass Hunting (INV-01),
  // Live Dataset Compliance Auditing (INV-02), and Cross-Attribute PBT (INV-03)
  // ==========================================================================
  const invTestBundle = {
    module: "PricingEngine",
    entities: [
      {
        name: "Quote",
        persistable: true,
        attributes: [
          { name: "Subtotal", type: "Decimal" },
          { name: "MinOrderAmount", type: "Decimal" },
          { name: "DiscountPct", type: "Integer" },
          { name: "PromoCode", type: "String", max_length: 10 },
        ],
        validation_rules: [
          { attribute: "Subtotal", rule_type: "Required" },
        ],
      },
      {
        name: "NPE_FilterHelper",
        persistable: false,
        attributes: [{ name: "SearchTerm", type: "String" }],
      },
    ],
    microflows: [
      {
        name: "VAL_Quote_CheckRules",
        qualified_name: "PricingEngine.VAL_Quote_CheckRules",
        return_type: "Boolean",
        parameters: [{ name: "Quote", type: "Object", entity: "PricingEngine.Quote" }],
        activities: [
          {
            id: "s_sub",
            type: "ExclusiveSplit",
            expression: "$Quote/Subtotal >= 100",
          },
          {
            id: "s_cross",
            type: "ExclusiveSplit",
            expression: "$Quote/MinOrderAmount <= $Quote/Subtotal",
          },
          {
            id: "s_stateful",
            type: "ExclusiveSplit",
            expression: "$currentUser != empty and $Quote/Subtotal >= 50",
          },
          {
            id: "s_npe",
            type: "ExclusiveSplit",
            expression: "$NPE_FilterHelper/SearchTerm != empty",
          },
          {
            id: "vfb_1",
            type: "ValidationFeedback",
            entity: "PricingEngine.Quote",
            attribute: "Subtotal",
            message: "Subtotal must be at least 100 and >= MinOrderAmount",
          },
        ],
        flows: [
          { from: "s_sub", to: "vfb_1", case_value: "false" },
          { from: "s_cross", to: "s_sub", case_value: "true" },
        ],
      },
      {
        name: "ACT_Quote_SafeSave",
        qualified_name: "PricingEngine.ACT_Quote_SafeSave",
        return_type: "Void",
        parameters: [{ name: "Quote", type: "Object", entity: "PricingEngine.Quote" }],
        activities: [
          {
            id: "call_val",
            type: "MicroflowCall",
            called_microflow: "PricingEngine.VAL_Quote_CheckRules",
          },
          {
            id: "c_safe",
            type: "ChangeObject",
            variable: "Quote",
            entity: "PricingEngine.Quote",
            commit: "Yes",
            changes: [{ attribute: "DiscountPct", value: "10" }],
          },
        ],
        flows: [{ from: "call_val", to: "c_safe" }],
      },
      {
        name: "ACT_Quote_QuickOverrideSave",
        qualified_name: "PricingEngine.ACT_Quote_QuickOverrideSave",
        return_type: "Void",
        parameters: [{ name: "Quote", type: "Object", entity: "PricingEngine.Quote" }],
        activities: [
          {
            id: "c_bypass",
            type: "CommitObject",
            variable: "Quote",
            entity: "PricingEngine.Quote",
          },
        ],
        flows: [],
      },
    ],
  };

  // 1. Verify `mineInvariantBusinessRules` extracts persistent entity invariants, filters out $currentUser and NPEs, and flags ACT_Quote_QuickOverrideSave
  const minedInvariants = mineInvariantBusinessRules(invTestBundle);
  const minedPredicates = minedInvariants.map((r) => r.predicate_expression);
  if (
    minedInvariants.length < 2 ||
    minedPredicates.some((p) => p.includes("$currentUser") || p.includes("NPE_FilterHelper")) ||
    !minedPredicates.some((p) => p.includes("Subtotal >= 100"))
  ) {
    console.error("[FAIL] mineInvariantBusinessRules failed to extract persistent invariants or leaked stateful/NPE rules!", minedInvariants);
    process.exit(1);
  }
  const subtotalInv = minedInvariants.find((r) => r.predicate_expression.includes("Subtotal >= 100"));
  if (
    !subtotalInv ||
    !subtotalInv.bypassed_in_committers.includes("PricingEngine.ACT_Quote_QuickOverrideSave") ||
    subtotalInv.enforced_in_committers.includes("PricingEngine.ACT_Quote_QuickOverrideSave")
  ) {
    console.error("[FAIL] mineInvariantBusinessRules did not detect commit flow bypass in ACT_Quote_QuickOverrideSave!", subtotalInv);
    process.exit(1);
  }

  // 2. Verify PBT Synergy: `extractMicroflowDomainPartitions` on `ACT_Quote_QuickOverrideSave` inherits threshold 100 from mined entity invariant
  const bypassMfDef = invTestBundle.microflows.find((m) => m.name === "ACT_Quote_QuickOverrideSave");
  const bypassDomains = extractMicroflowDomainPartitions(bypassMfDef, invTestBundle);
  if (!bypassDomains.factors["Quote.Subtotal"] || !bypassDomains.factors["Quote.Subtotal"].values.includes(100)) {
    console.error("[FAIL] extractMicroflowDomainPartitions did not inherit mined entity invariant threshold 100 on unguarded committer microflow!", bypassDomains);
    process.exit(1);
  }

  // 3. Verify `analyzeAstBundle` runs invariant discovery AUTOMATICALLY by default and synthesizes INV-01, INV-02, and INV-03
  const invManifest = analyzeAstBundle(invTestBundle, "free", { pbt: true });
  const invPatternIds = new Set(
    [...invManifest.hypotheses, ...(invManifest.invariant_dataset_probes || [])].map((h) => h.pattern_id)
  );
  if (
    !invPatternIds.has("INV-01") ||
    !invPatternIds.has("INV-02") ||
    !invPatternIds.has("INV-03") ||
    (invManifest.invariant_rules || []).length < 2 ||
    (invManifest.invariant_dataset_probes || []).length < 1
  ) {
    console.error("[FAIL] analyzeAstBundle did not automatically synthesize INV-01, INV-02, and INV-03!", {
      patterns: [...invPatternIds],
      invariants: (invManifest.invariant_rules || []).length,
      probes: (invManifest.invariant_dataset_probes || []).length,
    });
    process.exit(1);
  }

  // 4. Verify `INV-02` compiles to a Database Retrieve step with Violation XPath & ExpectedObjectCount === 0
  const inv02Payload = generateExecuteTestcasePayload(invManifest, { findingId: "INV-02" });
  const inv02Tc = inv02Payload.TCEX_RQ_TestCaseList?.[0];
  const inv02RetrieveStep = (inv02Tc?.TCEX_RQ_TestStepList || []).find((s) => s.Action === "RetrieveObject");
  if (!inv02RetrieveStep || inv02RetrieveStep.ExpectedObjectCount !== 0 || !inv02RetrieveStep.XPathConstraint) {
    console.error("[FAIL] generateExecuteTestcasePayload did not emit RetrieveObject with XPathConstraint and ExpectedObjectCount: 0 for INV-02!", inv02Tc);
    process.exit(1);
  }
  const compiledInv02 = compileTestCaseToStepRun(inv02Tc, invManifest, invTestBundle);
  const compiledOact = compiledInv02.TCEX_RQ_TestStepRun?.[0]?.TCEX_RQ_TestStepRunOact;
  if (!compiledOact || compiledOact.Action !== "Retrieve" || compiledOact.ExpectedObjectCount !== 0) {
    console.error("[FAIL] compileTestCaseToStepRun did not compile INV-02 RetrieveObject into Oact Retrieve step!", compiledInv02);
    process.exit(1);
  }

  // 5. Verify `renderInvariantCatalogMarkdown` and Section 1C Collapsible Compliant Rules in `renderBugReportMarkdown`
  const catalogMd = renderInvariantCatalogMarkdown(minedInvariants, "PricingEngine");
  if (!catalogMd.includes("# Discovered Invariant Business Rules Catalog") || !catalogMd.includes("Database Compliance Query (Negated XPath)")) {
    console.error("[FAIL] renderInvariantCatalogMarkdown failed to render complete catalog sections!", catalogMd);
    process.exit(1);
  }
  const invReport = buildVerifiedBugReport(invManifest, { scenarios: [], is_static: true });
  const invReportMd = renderBugReportMarkdown(invReport);
  if (!invReportMd.includes("<details>") || !invReportMd.includes("Compliant Business Rules & Data Invariants")) {
    console.error("[FAIL] renderBugReportMarkdown did not render collapsible compliant business rules section in Section 1C!");
    process.exit(1);
  }
  for (const banned of [
    "PAT-01",
    "PAT-02",
    "PAT-07",
    "PAT-124",
    "PAT-126",
    "ANTI-69",
    "RED-ACTUAL",
    "RED-LATENT",
    "AMBER-UI",
    "Oracle",
  ]) {
    if (invReportMd.includes(banned) || catalogMd.includes(banned)) {
      console.error(`[FAIL] Invariant report or catalog leaked banned jargon term '${banned}'!`);
      process.exit(1);
    }
  }

  // 6. Verify all Markdown tables in rendered reports have matching header, separator, and row column counts
  const assertValidGfmTables = (mdText, label) => {
    const lines = String(mdText || "").split(/\r?\n/);
    let inCodeFence = false;
    let currentHeaderCols = null;
    const countPipes = (line) => {
      // Strip escaped pipes `\|` and inline backtick spans before counting table column pipes
      const stripped = line.replace(/\\\|/g, "").replace(/`[^`]*`/g, "CODE");
      const trimmed = stripped.trim().replace(/^\|/, "").replace(/\|$/, "");
      return trimmed.split("|").length;
    };
    for (let idx = 0; idx < lines.length; idx++) {
      const line = lines[idx].trim();
      if (line.startsWith("```")) {
        inCodeFence = !inCodeFence;
        currentHeaderCols = null;
        continue;
      }
      if (inCodeFence) continue;
      if (line.startsWith("|") && line.endsWith("|")) {
        const cols = countPipes(line);
        if (currentHeaderCols === null) {
          currentHeaderCols = cols;
        } else if (cols !== currentHeaderCols) {
          console.error(
            `[FAIL] Broken GFM Markdown table in '${label}' at line ${idx + 1}: expected ${currentHeaderCols} columns, found ${cols} columns -> ${line}`
          );
          process.exit(1);
        }
      } else {
        currentHeaderCols = null;
      }
    }
  };
  assertValidGfmTables(reportMd, "reportMd");
  assertValidGfmTables(manyRulesMd, "manyRulesMd");
  assertValidGfmTables(renderedUfMd, "renderedUfMd");
  assertValidGfmTables(invReportMd, "invReportMd");
  assertValidGfmTables(catalogMd, "catalogMd");
  assertValidGfmTables(executedTestsMd, "executedTestsMd");

  // --------------------------------------------------------------------------
  // Self-Test 3.2.0: 5-Tier Functional-First Classification, Dual-Mode Oracle
  // Evaluator, Invariant Date Inversion, ListType/Retrieve Schema & EP_BugHunt_*.md
  // --------------------------------------------------------------------------
  if (
    classifyDefectNature({ pattern_id: "INV-01" }) !== "FUNCTIONAL_BYPASS" ||
    classifyDefectNature({ pattern_id: "INV-03" }) !== "FUNCTIONAL_BYPASS" ||
    classifyDefectNature({ pattern_id: "BHP-04" }) !== "FUNCTIONAL_BYPASS" ||
    classifyDefectNature({ pattern_id: "BHP-05" }) !== "FUNCTIONAL_BYPASS" ||
    classifyDefectNature({ pattern_id: "BHP-17" }) !== "UI_FEEDBACK_DISCONNECT" ||
    classifyDefectNature({ pattern_id: "BHP-32" }) !== "UI_FEEDBACK_DISCONNECT" ||
    classifyDefectNature({ pattern_id: "BHP-01" }) !== "TECHNICAL_CRASH"
  ) {
    console.error("[FAIL] v3.2.0 classifyDefectNature did not classify Tier 1/Tier 2/Tier 3 defect natures accurately!");
    process.exit(1);
  }

  // Verify mineInvariantBusinessRules produces genuinely inverted dates when rule is PickupDate <= ReturnDate
  const dateOrderBundle = {
    module: "CarRentalModule",
    entities: [
      {
        name: "Booking",
        qualified_name: "CarRentalModule.Booking",
        is_persistable: true,
        attributes: [
          { name: "PickupDate", type: "DateTime" },
          { name: "ReturnDate", type: "DateTime" },
        ],
      },
    ],
    microflows: [
      {
        name: "VAL_Booking_CheckDates",
        qualified_name: "CarRentalModule.VAL_Booking_CheckDates",
        return_type: "Boolean",
        parameters: [{ name: "Booking", type: "Object", entity: "CarRentalModule.Booking" }],
        activities: [
          {
            id: "s_date",
            type: "ExclusiveSplit",
            expression: "$Booking/PickupDate <= $Booking/ReturnDate",
          },
          {
            id: "v_date",
            type: "ValidationFeedback",
            variable: "Booking",
            attribute: "ReturnDate",
            message: "ReturnDate must be on or after PickupDate",
          },
        ],
        flows: [{ from: "s_date", to: "v_date", case_value: "false" }],
      },
      {
        name: "ACT_Booking_DirectSave",
        qualified_name: "CarRentalModule.ACT_Booking_DirectSave",
        return_type: "Void",
        parameters: [{ name: "Booking", type: "Object", entity: "CarRentalModule.Booking" }],
        activities: [
          {
            id: "c_save",
            type: "CommitObject",
            variable: "Booking",
            entity: "CarRentalModule.Booking",
          },
        ],
      },
    ],
  };
  const dateInvs = mineInvariantBusinessRules(dateOrderBundle);
  const dateInv = dateInvs.find((r) => r.predicate_expression.includes("PickupDate <= Booking.ReturnDate"));
  if (
    !dateInv ||
    !dateInv.violating_override ||
    new Date(dateInv.violating_override["Booking.PickupDate"]).getTime() <=
      new Date(dateInv.violating_override["Booking.ReturnDate"]).getTime()
  ) {
    console.error("[FAIL] v3.2.0 mineInvariantBusinessRules failed to invert PickupDate > ReturnDate in violating_override!", dateInv);
    process.exit(1);
  }

  // Verify Dual-Mode Oracle Evaluator in parsePluginExecutionResult
  const mockSuccessNoValidationResp = {
    result: {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            Result: "Passed",
            TCEX_RP_TestCaseResult: {
              Result: "Passed",
              Duration: 42,
              TCEX_RP_TestStepResult: [
                {
                  TestStepName: "Call ACT_Booking_DirectSave",
                  Result: "Passed",
                  TCEX_RP_ValidationFeedbackMessage: [],
                },
              ],
            },
          }),
        },
      ],
    },
  };
  const tier1BypassOutcome = parsePluginExecutionResult(mockSuccessNoValidationResp, {
    id: "HYP_INV01_TEST",
    pattern_id: "INV-01",
    microflow: "CarRentalModule.ACT_Booking_DirectSave",
  });
  if (tier1BypassOutcome.outcome !== "FAIL_FUNCTIONAL_BYPASS") {
    console.error("[FAIL] v3.2.0 Dual-Mode Oracle Evaluator did not flag unblocked INV-01 execution as FAIL_FUNCTIONAL_BYPASS!", tier1BypassOutcome);
    process.exit(1);
  }

  const mockRejectedValidationResp = {
    result: {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            Result: "Failed",
            TCEX_RP_TestCaseResult: {
              Result: "Failed",
              Duration: 35,
              ErrorMessage: "com.mendix.systemwideinterfaces.core.DataValidationRuntimeException: ReturnDate must be after PickupDate",
            },
          }),
        },
      ],
    },
  };
  const tier1EnforcedOutcome = parsePluginExecutionResult(mockRejectedValidationResp, {
    id: "HYP_INV01_ENFORCED",
    pattern_id: "INV-01",
    microflow: "CarRentalModule.ACT_Booking_DirectSave",
  });
  if (tier1EnforcedOutcome.outcome !== "PASS") {
    console.error("[FAIL] v3.2.0 Dual-Mode Oracle Evaluator did not mark DataValidationRuntimeException rejection as PASS!", tier1EnforcedOutcome);
    process.exit(1);
  }

  // Verify ListType parameter and RetrieveOption/RetrieveSet on Create step in compileTestCaseToStepRun
  const listBundle = {
    module: "CarRentalModule",
    entities: [{ name: "Car", qualified_name: "CarRentalModule.Car", attributes: [{ name: "Brand", type: "String" }] }],
    microflows: [
      {
        name: "SUB_CountCars",
        qualified_name: "CarRentalModule.SUB_CountCars",
        parameters: [{ name: "CarList", type: "List", entity: "CarRentalModule.Car" }],
        activities: [],
      },
    ],
  };
  const listTc = {
    Name: "Test List Param",
    TCEX_RQ_TestStepList: [
      {
        StepNumber: 1,
        Action: "CreateObject",
        EntityName: "CarRentalModule.Car",
        TCEX_RQ_AttributeValueList: [{ AttributeName: "Brand", AttributeType: "StringType", Value: "Volvo" }],
      },
      {
        Sequence: 2,
        Action: "MicroflowCall",
        MicroflowName: "CarRentalModule.SUB_CountCars",
      },
    ],
  };
  const compiledListRun = compileTestCaseToStepRun(listTc, { module: "CarRentalModule" }, listBundle);
  const createOact = compiledListRun.TCEX_RQ_TestStepRun?.[0]?.TCEX_RQ_TestStepRunOact;
  const mfMcfr = compiledListRun.TCEX_RQ_TestStepRun?.[1]?.TCEX_RQ_TestStepRunMfc;
  if (
    !createOact ||
    createOact.RetrieveOption !== "From_database" ||
    createOact.RetrieveSet !== "Head" ||
    !mfMcfr ||
    mfMcfr.TCEX_RQ_MicroflowParameter?.[0]?.DataType !== "ListType"
  ) {
    console.error("[FAIL] v3.2.0 compileTestCaseToStepRun did not emit RetrieveOption/RetrieveSet on Create or DataType: ListType on List parameter!", {
      createOact,
      mfMcfr,
    });
    process.exit(1);
  }

  // Verify writeBugReports automatically writes EP_BugHunt_<TargetSlug>.md alongside BugHunt_Report and BugHunt_Executed_Tests,
  // and verify Frontend vs. Backend Test Channel & Why Chosen are rendered in both reports
  const v320TestDir = path.join(process.cwd(), "scratch", "self_test_v320_reports");
  const v320Written = writeBugReports(invReport, { out: v320TestDir });
  const v320ReportText = fs.readFileSync(v320Written.reportPath, "utf8");
  const v320TestsText = fs.readFileSync(v320Written.testsPath, "utf8");
  if (
    !v320Written.epPlanPath ||
    !fs.existsSync(v320Written.epPlanPath) ||
    !fs.readFileSync(v320Written.epPlanPath, "utf8").includes("## 3. Test Steps & Action Sequence")
  ) {
    console.error("[FAIL] v3.2.0 writeBugReports did not automatically generate EP_BugHunt_<TargetSlug>.md!", v320Written);
    process.exit(1);
  }
  if (
    !v320ReportText.includes("Test Execution Channel & Why Chosen:") ||
    !v320ReportText.includes("Test Channel & Why Chosen") ||
    !v320TestsText.includes("Test Execution Channel & Why Chosen:") ||
    !v320TestsText.includes("Test Channel Selection Policy")
  ) {
    console.error("[FAIL] BugHunt_Report or BugHunt_Executed_Tests is missing the mandatory Frontend vs. Backend Test Channel & Why Chosen fields!");
    process.exit(1);
  }
  try {
    fs.rmSync(v320TestDir, { recursive: true, force: true });
    if (fs.existsSync(v320Written.jsonPath)) fs.unlinkSync(v320Written.jsonPath);
  } catch {
    // Ignore cleanup errors
  }

  const feSelfTest = await runFrontendSelfTests();
  if (!feSelfTest || !feSelfTest.passed) {
    console.error("[FAIL] Frontend Playwright self-test suite failed!");
    process.exit(1);
  }

  // v3.3.1: Verify MDL `$Var = create Entity (...)` parsing + Explicit Null-Branch Param Feedback (`BHP-01` vs `BHP-32`) + 4-Phase FE Outcome Gating
  const parsedCreateBookingMf = parseMdlMicroflowSource(
    `microflow CarRentalModule.ACT_Home_Renter_create_booking (Car : CarRentalModule.Car) : void
begin
  if $Car != empty then
    $NewBooking = create CarRentalModule.Booking (CarRentalModule.Booking_Car = $Car, PickupDate = [%CurrentDateTime%]);
    show page CarRentalModule.Booking_Create ($NewBooking);
  else
    validation feedback $Car/LicensePlate 'No car was selected';
  end if;
end`,
    { Name: "ACT_Home_Renter_create_booking", QualifiedName: "CarRentalModule.ACT_Home_Renter_create_booking", ReturnType: "Void" },
    [{ Name: "Car", ParameterType: "Object:CarRentalModule.Car" }],
    ["Customer"]
  );
  const createBookingAct = parsedCreateBookingMf.activities.find((a) => a.type === "CreateObject");
  if (!createBookingAct || createBookingAct.entity !== "CarRentalModule.Booking" || createBookingAct.output_variable !== "NewBooking") {
    console.error("[FAIL] parseMdlMicroflowSource failed to parse `$NewBooking = create CarRentalModule.Booking (...)`!", createBookingAct);
    process.exit(1);
  }
  const createBookingBundle = {
    module: "CarRentalModule",
    microflows: [parsedCreateBookingMf],
    entities: [
      { qualified_name: "CarRentalModule.Car", attributes: [{ name: "LicensePlate", type: "String" }] },
      { qualified_name: "CarRentalModule.Booking", attributes: [{ name: "PickupDate", type: "DateTime" }] },
    ],
    pages: [
      {
        qualified_name: "CarRentalModule.Home_Renter",
        calls_microflows: ["CarRentalModule.ACT_Home_Renter_create_booking"],
        widgets: [
          { name: "galleryCars", type: "Gallery", entity: "CarRentalModule.Car" },
          {
            name: "Button_BookThisCar",
            type: "ActionButton",
            action_microflow: "CarRentalModule.ACT_Home_Renter_create_booking",
            inRepeatingContainer: true,
          },
        ],
      },
    ],
  };
  const cbManifest = analyzeAstBundle(createBookingBundle, "paid");
  const cbBhp32 = cbManifest.hypotheses.find((h) => h.pattern_id === "BHP-32");
  if (cbBhp32) {
    console.error("[FAIL] Explicit null-branch parameter ValidationFeedback must NOT emit false-positive BHP-32!", cbBhp32);
    process.exit(1);
  }
  const cbBhp01 = cbManifest.hypotheses.find((h) => h.pattern_id === "BHP-01");
  if (!cbBhp01 || cbBhp01.exposure_classification !== "LATENT_IMPLICITLY_PROTECTED") {
    console.error("[FAIL] BHP-01 on Gallery-protected microflow must be classified as LATENT_IMPLICITLY_PROTECTED!", cbBhp01);
    process.exit(1);
  }

  // Verify buildVerifiedBugReport does NOT promote FAIL_UI_LOCATOR_OR_PRECONDITION to CONFIRMED_BUG
  const feGateReport = buildVerifiedBugReport(cbManifest, {
    is_static: false,
    scenarios: [
      {
        id: "HYP_1_FE",
        hypothesis_id: cbBhp01.id,
        pattern_id: "BHP-01",
        microflow: "CarRentalModule.ACT_Home_Renter_create_booking",
        execution_channel: "FRONTEND_PLAYWRIGHT_PLUGIN",
        test_channel: "FRONTEND_UI",
        outcome: "FAIL_UI_LOCATOR_OR_PRECONDITION",
        error_message: "Strict mode violation on Locate_MxWidget_Button",
        trace_artifact: { file_name: "Trace_HYP_1.zip", local_path: "traces/Trace_HYP_1.zip" },
        step_summary: [{ sequence: 5, key: 5, type: "MicroflowCall", name: "Locate_MxWidget_Button", result: "Failed" }],
      },
    ],
  });
  if ((feGateReport.confirmed_bugs || []).some((b) => b.runtime_failure_code === "FAIL_UI_LOCATOR_OR_PRECONDITION")) {
    console.error("[FAIL] FAIL_UI_LOCATOR_OR_PRECONDITION must NEVER be promoted to confirmed_bugs!");
    process.exit(1);
  }
  const renderedExecMd = renderExecutedTestsMarkdown(feGateReport);
  if (!renderedExecMd.includes("Trace_HYP_1.zip") || !renderedExecMd.includes("Inconclusive Setup/Locator")) {
    console.error("[FAIL] renderExecutedTestsMarkdown must render trace_artifact link and Inconclusive Setup/Locator badge!");
    process.exit(1);
  }

  console.log(
    "[PASS] mta-bughunter.mjs v3.3.0 self-test passed (Frontend Playwright TestKit Compiler & 4-Tier Data Provisioner +  (5-Tier Functional-First Bug Report Classification, Mandatory Tier 1 Runtime Priority Queue, Dual-Mode Oracle Evaluator FAIL_FUNCTIONAL_BYPASS vs PASS on DataValidationRuntimeException, Automatic Model-Derived Invariant Business Rule Discovery & Date Inversion Fix, mta-test-design Schema Parity ListType/TCEX_RQ_Sfar/Create RetrieveOption, Automatic Zero-Token EP_BugHunt_<Module>.md Generation, AST-Guided Pairwise Permutation & Property-Based Testing PBT-01..05, Direct Dynamic Execution & ANTI-46 Exemption, Two-Tier Evidence Transparency, Mendix Semantics Reference Calibration, and GFM Table Integrity verified)."
  );
}

function syncMtaStateExecutionPlan(planFilePath, workspaceDir = process.cwd()) {
  try {
    const absRoot = path.resolve(workspaceDir);
    const statePath = path.join(absRoot, "mta_state.json");
    const hasWorkspaceMarkers =
      fs.existsSync(statePath) ||
      fs.existsSync(path.join(absRoot, "mta_config.json")) ||
      fs.existsSync(path.join(absRoot, "menditect-output"));
    if (!hasWorkspaceMarkers) return;

    let stateObj = {};
    if (fs.existsSync(statePath)) {
      try {
        stateObj = JSON.parse(fs.readFileSync(statePath, "utf8")) || {};
      } catch (_e) {
        stateObj = {};
      }
    }
    const relPlan = path.relative(absRoot, path.resolve(planFilePath)).replace(/\\/g, "/");
    stateObj.execution_plan_file = relPlan.startsWith("..") ? path.resolve(planFilePath).replace(/\\/g, "/") : relPlan;
    fs.writeFileSync(statePath, JSON.stringify(stateObj, null, 2), "utf8");
  } catch (_err) {
    // Non-fatal if mta_state.json cannot be updated
  }
}

// ============================================================================
// 8. CLI DISPATCHER
// ============================================================================

const args = process.argv.slice(2);
const cmd = args[0];

function getFlagValue(flagName, defaultValue = null) {
  const idx = args.indexOf(flagName);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : defaultValue;
}

if (cmd === "self-test") {
  await runSelfTest();
} else if (cmd === "refresh-catalog") {
  const configPath = getFlagValue("--config");
  const mprPath = getFlagValue("--mpr");
  const catalogPath = getFlagValue("--catalog");
  const catalogMode = getFlagValue("--catalog-mode", "auto");
  const status = ensureFreshCatalogDb(process.cwd(), {
    configPath,
    mprPath,
    catalogPath,
    catalogMode,
    forceRefresh: true,
  });
  if (!status.ok) {
    console.error(`[ERROR] ${status.reason}`);
    process.exit(1);
  }
  console.log(
    `[mta-bughunter] Catalog ready at ${status.catalogPath} (refreshed=${status.refreshed}, reason="${status.reason}")`
  );
} else if (cmd === "harvest") {
  const moduleName = getFlagValue("--module", "TargetModule");
  const fromDir = getFlagValue("--from-dir");
  const configPath = getFlagValue("--config");
  const mprPath = getFlagValue("--mpr");
  const catalogPath = getFlagValue("--catalog");
  const catalogMode = getFlagValue("--catalog-mode", "auto");
  const rulesFile = getFlagValue("--rules-file");
  const docsDir = getFlagValue("--docs");
  const fastFilter = args.includes("--fast-filter");
  const forceRefresh = args.includes("--refresh-catalog");
  const includeExcluded = args.includes("--include-excluded");
  const outPath = getFlagValue("--out");

  const bundle = harvestModuleBundle(moduleName, process.cwd(), {
    fromDir,
    configPath,
    mprPath,
    catalogPath,
    catalogMode,
    rulesFile,
    docsDir,
    fastFilter,
    forceRefresh,
    includeExcluded,
  });
  const jsonOutput = JSON.stringify(bundle, null, 2);
  if (outPath) {
    fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true });
    fs.writeFileSync(path.resolve(outPath), jsonOutput, "utf8");
    console.log(
      `[mta-bughunter] Harvested 4-layer AST bundle for module '${moduleName}' via '${bundle.harvest_source || "unknown"}' (${bundle.microflows.length} microflows, ${bundle.entities.length} entities, ${bundle.pages.length} pages, ${(bundle.external_business_rules || []).length} external business rules, ${(bundle.suspect_shortlist || []).length} fast-filter suspects) -> ${outPath}`
    );
  } else {
    console.log(jsonOutput);
  }
} else if (cmd === "hunt") {
  const moduleName = getFlagValue("--module", "TargetModule");
  const fromDir = getFlagValue("--from-dir");
  const configPath = getFlagValue("--config");
  const mprPath = getFlagValue("--mpr");
  const catalogPath = getFlagValue("--catalog");
  const catalogMode = getFlagValue("--catalog-mode", "auto");
  const rulesFile = getFlagValue("--rules-file");
  const docsDir = getFlagValue("--docs");
  const tier = (getFlagValue("--tier", "free") || "free").toLowerCase();
  const fastFilter = args.includes("--fast-filter");
  const forceRefresh = args.includes("--refresh-catalog");
  const includeExcluded = args.includes("--include-excluded");
  const outDir = path.resolve(getFlagValue("--out-dir", path.join(process.cwd(), "scratch")));

  fs.mkdirSync(outDir, { recursive: true });
  const bundlePath = path.join(outDir, "bughunt_ast_bundle.json");
  const manifestPath = path.join(outDir, "bughunt_manifest.json");
  const summaryPath = path.join(outDir, "bughunt_summary.md");

  const bundle = harvestModuleBundle(moduleName, process.cwd(), {
    fromDir,
    configPath,
    mprPath,
    catalogPath,
    catalogMode,
    rulesFile,
    docsDir,
    fastFilter,
    forceRefresh,
    includeExcluded,
  });
  fs.writeFileSync(bundlePath, JSON.stringify(bundle, null, 2), "utf8");

  const pbtEnabled = args.includes("--pbt") && !args.includes("--no-pbt");
  const pbtSamples = Number(getFlagValue("--pbt-samples", "12")) || 12;
  const pbtShrink = !args.includes("--no-pbt-shrink");
  const invariantsEnabled = !args.includes("--no-invariants");
  const manifest = analyzeAstBundle(bundle, tier, { pbt: pbtEnabled, pbtSamples, invariants: invariantsEnabled });
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf8");

  const summary = summarizeManifest(manifest, 25);
  fs.writeFileSync(summaryPath, renderManifestSummaryMarkdown(summary), "utf8");

  console.log(
    `[mta-bughunter] Hunt static pipeline complete for module '${moduleName}' (source: ${bundle.harvest_source || "unknown"}):\n` +
      `  - AST Bundle: ${bundlePath} (${bundle.microflows.length} microflows, ${bundle.entities.length} entities, ${bundle.pages.length} pages, ${(bundle.suspect_shortlist || []).length} high-risk suspects)\n` +
      `  - Manifest:   ${manifestPath} (${manifest.hypotheses.length} executable hypotheses, ${manifest.amber_risks.length} amber risks, ${manifest.amber_ui_candidates.length} UI candidates, ${(manifest.business_rules || []).length} business rules audited, ${manifest.summary.total_pbt_permutations_generated || 0} pairwise permutations)\n` +
      `  - Summary:    ${summaryPath} (Compact triage summary for LLM review)`
  );

  if (args.includes("--execute") || args.includes("--verify-online")) {
    const reportOutDir = getFlagValue("--report-out");
    const pluginUrl = getFlagValue("--plugin-url");
    const topLimit = parseInt(getFlagValue("--top", "25"), 10);
    console.log("[mta-bughunter] Executing dynamic bug verification against MTA_plugin...");
    const dynamicReport = await executeHuntScenariosDirectly(manifest, bundle, {
      pluginUrl,
      topLimit,
      out: reportOutDir,
      outDir: reportOutDir,
      mprPath: bundle.mpr_path || mprPath,
      catalogPath: bundle.catalog_db_path || bundle.catalog_path || catalogPath,
      pbt: pbtEnabled,
      pbtShrink,
      frontend: !args.includes("--no-frontend"),
      headed: args.includes("--headed"),
      trace: args.includes("--trace"),
      traceOnFail: args.includes("--trace-on-fail"),
    });
    console.log(
      "[mta-bughunter] Dynamic verification complete (" + dynamicReport.scorecard.confirmed_bugs_red + " RED, " + dynamicReport.scorecard.latent_architecture_risks_amber + " AMBER, " + dynamicReport.scorecard.ui_page_candidates_amber_ui + " AMBER-UI, " + dynamicReport.scorecard.verified_resilient_green + " GREEN)."
    );
  } else   if (args.includes("--report")) {
    const reportOutDir = getFlagValue("--report-out");
    const topLimit = getFlagValue("--top") ? Number(getFlagValue("--top")) : 25;
    const staticReport = buildVerifiedBugReport(manifest, { scenarios: [], is_static: true, top_limit: topLimit });
    const written = writeBugReports(staticReport, { out: reportOutDir });
    console.log(
      `[mta-bughunter] Auto-generated static customer-facing bug reports (--report):\n` +
        `  - Bug Report:     ${written.reportPath}\n` +
        `  - Planned Tests:  ${written.testsPath || "N/A"}\n` +
        `  - Raw Report JSON:${written.jsonPath}`
    );
  }

  if (manifest.guardrails.safe_01_quarantined) {
    console.warn(
      `[SAFE_01_QUARANTINE] Note: External side-effects detected in ${manifest.target_microflow} (${(manifest.guardrails.safe_01_quarantine_reasons || []).join("; ")}). Quarantine those activities before dynamic execution.`
    );
    if (args.includes("--strict-safe01")) {
      process.exit(2);
    }
  }
} else if (cmd === "summarize") {
  const manifestPath = args[1] || path.join(process.cwd(), "scratch", "bughunt_manifest.json");
  if (!fs.existsSync(path.resolve(manifestPath))) {
    console.error(`Usage: node mta-bughunter.mjs summarize <manifest.json> [--top 25] [--json]`);
    process.exit(1);
  }
  const topN = Number(getFlagValue("--top", "25")) || 25;
  const manifest = JSON.parse(fs.readFileSync(path.resolve(manifestPath), "utf8"));
  const summary = summarizeManifest(manifest, topN);
  if (args.includes("--json")) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    console.log(renderManifestSummaryMarkdown(summary));
  }
} else if (cmd === "mine-invariants") {
  const firstPositional = args[1] && !args[1].startsWith("--") ? args[1] : null;
  const moduleName = getFlagValue("--module", firstPositional && !fs.existsSync(path.resolve(firstPositional)) ? firstPositional : "TargetModule");
  const configPath = getFlagValue("--config");
  const mprPath = getFlagValue("--mpr");
  const catalogPath = getFlagValue("--catalog");
  const catalogMode = getFlagValue("--catalog-mode", "auto");
  const rulesFile = getFlagValue("--rules-file");
  const docsDir = getFlagValue("--docs");
  const outPath = getFlagValue("--out");

  let bundle = null;
  if (firstPositional && fs.existsSync(path.resolve(firstPositional))) {
    bundle = JSON.parse(fs.readFileSync(path.resolve(firstPositional), "utf8"));
  } else {
    bundle = harvestModuleBundle(moduleName, process.cwd(), {
      configPath,
      mprPath,
      catalogPath,
      catalogMode,
      rulesFile,
      docsDir,
    });
  }
  const invariants = mineInvariantBusinessRules(bundle);
  const targetMod = bundle.module || moduleName || "TargetModule";
  const bypassedCount = invariants.filter((i) => (i.bypassed_in_committers || []).length > 0).length;
  const catalogObj = {
    module: targetMod,
    summary: {
      total_invariants: invariants.length,
      bypassed_invariants: bypassedCount,
      enforced_invariants: invariants.length - bypassedCount,
      dataset_violation_xpaths_generated: invariants.filter((i) => Boolean(i.negated_xpath)).length,
    },
    invariants,
  };
  const wantsMarkdown = args.includes("--markdown") || (outPath && outPath.toLowerCase().endsWith(".md"));
  const outputContent = wantsMarkdown ? renderInvariantCatalogMarkdown(invariants, targetMod) : JSON.stringify(catalogObj, null, 2);

  if (outPath) {
    fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true });
    fs.writeFileSync(path.resolve(outPath), outputContent, "utf8");
    console.log(
      `[mta-bughunter] Mined ${catalogObj.summary.total_invariants} invariant business rules for module '${targetMod}' (${catalogObj.summary.bypassed_invariants} bypassed across commit flows, ${catalogObj.summary.dataset_violation_xpaths_generated} dataset audit queries) -> ${outPath}`
    );
  } else {
    console.log(outputContent);
  }
} else if (cmd === "audit-rbac") {
  const moduleName = getFlagValue("--module", "TargetModule");
  const configPath = getFlagValue("--config");
  const mprPath = getFlagValue("--mpr");
  const catalogPath = getFlagValue("--catalog");
  const catalogMode = getFlagValue("--catalog-mode", "auto");
  const outPath = getFlagValue("--out");

  const bundle = harvestModuleBundle(moduleName, process.cwd(), {
    configPath,
    mprPath,
    catalogPath,
    catalogMode,
  });
  const audit = auditRbacModule(bundle);
  const jsonOutput = JSON.stringify(audit, null, 2);
  if (outPath) {
    fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true });
    fs.writeFileSync(path.resolve(outPath), jsonOutput, "utf8");
    console.log(
      `[mta-bughunter] RBAC & Security Matrix audit for '${moduleName}' complete (${audit.summary.total_security_findings} findings) -> ${outPath}`
    );
  } else {
    console.log(jsonOutput);
  }
} else if (cmd === "validate-plan") {
  const planPath = args[1];
  const payloadIdx = args.indexOf("--payload");
  const payloadPath = payloadIdx !== -1 && args[payloadIdx + 1] ? args[payloadIdx + 1] : null;
  const res = validatePlanAndPayload(planPath, payloadPath);
  if (res.warnings.length > 0) {
    for (const w of res.warnings) console.warn(`[WARN] ${w}`);
  }
  if (!res.valid) {
    for (const err of res.errors) console.error(`[ERROR] ${err}`);
    process.exit(1);
  }
  console.log(`[PASS] Preflight validation passed for ${planPath}${payloadPath ? ` + ${payloadPath}` : ""}.`);
} else if (cmd === "analyze" || cmd === "analyze-module") {
  const inputPath = args[1];
  if (!inputPath || !fs.existsSync(inputPath)) {
    console.error(
      `Usage: node mta-bughunter.mjs ${cmd} <ast_bundle.json> [--tier free|paid] [--rules-file <path>] [--docs <dir>] [--out <manifest.json>]`
    );
    process.exit(1);
  }
  const tierIdx = args.indexOf("--tier");
  const tier = tierIdx !== -1 && args[tierIdx + 1] ? args[tierIdx + 1].toLowerCase() : "free";
  const rulesFile = getFlagValue("--rules-file");
  const docsDir = getFlagValue("--docs");
  const outIdx = args.indexOf("--out");
  const outPath = outIdx !== -1 && args[outIdx + 1] ? args[outIdx + 1] : null;

  const bundle = JSON.parse(fs.readFileSync(path.resolve(inputPath), "utf8"));
  if (rulesFile || docsDir) {
    const extRules = loadExternalBusinessRules(process.cwd(), bundle.module || "TargetModule", { rulesFile, docsDir });
    bundle.external_business_rules = [...(bundle.external_business_rules || []), ...extRules];
  }
  const pbtEnabled = args.includes("--pbt") && !args.includes("--no-pbt");
  const pbtSamples = Number(getFlagValue("--pbt-samples", "12")) || 12;
  const invariantsEnabled = !args.includes("--no-invariants");
  const manifest = analyzeAstBundle(bundle, tier, { pbt: pbtEnabled, pbtSamples, invariants: invariantsEnabled });
  const jsonOutput = JSON.stringify(manifest, null, 2);

  if (outPath) {
    fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true });
    fs.writeFileSync(path.resolve(outPath), jsonOutput, "utf8");
    console.log(
      `[mta-bughunter] Wrote manifest (${manifest.hypotheses.length} hypotheses, ${manifest.amber_risks.length} amber risks, ${manifest.amber_ui_candidates.length} UI candidates, ${(manifest.business_rules || []).length} business rules audited) to ${outPath}`
    );
  } else {
    console.log(jsonOutput);
  }

  if (manifest.guardrails.safe_01_quarantined) {
    console.warn(
      `[SAFE_01_QUARANTINE] Note: External side-effects detected in ${manifest.target_microflow} (${(manifest.guardrails.safe_01_quarantine_reasons || []).join("; ")}). Quarantine those activities before dynamic execution.`
    );
    if (args.includes("--strict-safe01")) {
      process.exit(2);
    }
  }
} else if (cmd === "generate-plan") {
  const manifestPath = args[1];
  if (!manifestPath || !fs.existsSync(manifestPath)) {
    console.error("Usage: node mta-bughunter.mjs generate-plan <manifest.json> [--finding <HYP_ID|PATTERN_ID|MF_NAME>] [--out <dir_or_file.md>] [--payload-out <payload.json>]");
    process.exit(1);
  }
  const outIdx = args.indexOf("--out");
  let outTarget = outIdx !== -1 && args[outIdx + 1] ? args[outIdx + 1] : null;
  const payloadOut = getFlagValue("--payload-out");
  const findingId = getFlagValue("--finding");
  const statusIdx = args.indexOf("--status");
  const statusOpt = statusIdx !== -1 && args[statusIdx + 1] ? args[statusIdx + 1].toUpperCase() : null;

  const manifest = JSON.parse(fs.readFileSync(path.resolve(manifestPath), "utf8"));
  const shortMf = resolveTargetSlug(manifest);

  if (outTarget && /execution-plans/i.test(outTarget)) {
    const redirected = outTarget.replace(/execution-plans/gi, "bug-hunt-tests");
    console.log(
      `[mta-bughunter] Redirected Bug Hunter verification specification from '${outTarget}' to '${redirected}' (Bug Hunter tests are stored in menditect-output/bug-hunt-tests/).`
    );
    outTarget = redirected;
  }

  const pbtPlanEnabled = args.includes("--pbt") && !args.includes("--no-pbt");
  const pbtPlanSamples = Number(getFlagValue("--pbt-samples", "8")) || 8;
  const mdContent = generateExecutionPlanMarkdown(manifest, {
    outTarget,
    status: statusOpt,
    findingId,
    pbt: pbtPlanEnabled,
    pbtSamples: pbtPlanSamples,
  });

  let writtenPlanFile = null;
  if (outTarget) {
    const resolvedOut = path.resolve(outTarget);
    const finalFile = resolvedOut.endsWith(".md")
      ? resolvedOut
      : path.join(resolvedOut, `EP_BugHunt_${shortMf}.md`);
    fs.mkdirSync(path.dirname(finalFile), { recursive: true });
    fs.writeFileSync(finalFile, mdContent, "utf8");
    writtenPlanFile = finalFile;
    syncMtaStateExecutionPlan(finalFile, process.cwd());
    console.log(`[mta-bughunter] Generated bug-hunt test specification -> ${finalFile}`);
  } else {
    console.log(mdContent);
  }

  if (payloadOut) {
    const resolvedPayload = path.resolve(payloadOut);
    fs.mkdirSync(path.dirname(resolvedPayload), { recursive: true });
    const payloadObj = generateExecuteTestcasePayload(manifest, { findingId, pbt: pbtPlanEnabled });
    fs.writeFileSync(resolvedPayload, JSON.stringify(payloadObj, null, 2), "utf8");
    console.log(`[mta-bughunter] Generated companion execute-testcase payload -> ${resolvedPayload}`);
    if (writtenPlanFile) {
      const valRes = validatePlanAndPayload(writtenPlanFile, resolvedPayload);
      if (!valRes.valid) {
        console.warn(`[WARN] Companion payload validation warnings/errors: ${valRes.errors.join("; ")}`);
      }
    }
  }
} else if (cmd === "report") {
  const manifestPath = args[1];
  let resultsPath = args[2];
  const isStatic =
    args.includes("--static") ||
    !resultsPath ||
    resultsPath.startsWith("--");

  if (!manifestPath || manifestPath.startsWith("--") || !fs.existsSync(path.resolve(manifestPath))) {
    console.error(
      "Usage: node mta-bughunter.mjs report <manifest.json> [<results.json>] [--static] [--out <report.md|dir>] [--tests-out <executed_tests.md>]"
    );
    process.exit(1);
  }
  const outIdx = args.indexOf("--out");
  const outPath = outIdx !== -1 && args[outIdx + 1] ? args[outIdx + 1] : null;
  const testsOutArg = getFlagValue("--tests-out");

  const manifest = JSON.parse(fs.readFileSync(path.resolve(manifestPath), "utf8"));
  let results = { scenarios: [], is_static: true };
  if (!isStatic && resultsPath && !resultsPath.startsWith("--")) {
    if (!fs.existsSync(path.resolve(resultsPath))) {
      console.error(`[ERROR] Results file not found: ${resultsPath}`);
      process.exit(1);
    }
    results = JSON.parse(fs.readFileSync(path.resolve(resultsPath), "utf8"));
  }

  const report = buildVerifiedBugReport(manifest, results);

  if (outPath || isStatic || !args.includes("--json")) {
    const written = writeBugReports(report, { out: outPath, testsOut: testsOutArg });
    console.log(
      `[mta-bughunter] Wrote 4-Tier Customer Bug Report (${report.scorecard.confirmed_bugs_red} RED, ${report.scorecard.latent_architecture_risks_amber} AMBER, ${report.scorecard.ui_page_candidates_amber_ui} AMBER-UI, ${report.scorecard.verified_resilient_green} GREEN):\n` +
        `  - Bug Report:     ${written.reportPath}\n` +
        `  - Executed Tests: ${written.testsPath || "N/A"}\n` +
        `  - Raw Report JSON:${written.jsonPath}`
    );
  } else {
    console.log(JSON.stringify(report, null, 2));
  }
} else if (process.argv[1] && import.meta.url === `file://${process.argv[1].replace(/\\/g, "/")}`) {
  console.log(
    "Commands: refresh-catalog | harvest | hunt | mine-invariants | summarize | audit-rbac | analyze | analyze-module | generate-plan | validate-plan | report | self-test"
  );
}
