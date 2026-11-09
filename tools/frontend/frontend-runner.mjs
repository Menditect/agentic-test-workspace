/**
 * Menditect Bug Hunter — Stateless `MTA_plugin` Frontend Runner & Trace Manager (`frontend-runner.mjs`)
 *
 * Orchestrates:
 *  - Automatic synthesis of `FrontendRecipe` IRs from UI-relevant hypotheses (`BHP-17`, `BHP-32`,
 *    `DQP-02`, and page-reachable `Tier 1` functional bypasses)
 *  - 4-Tier Data Strategy execution (`TC_01_Seed` -> `TC_02_Frontend_Action` -> `TC_03_Teardown` in `try/finally`)
 *  - Smart Trace File Management (`Trace = false` fast scan default; `--trace-on-fail` / `--trace` replay
 *    with local `.zip` trace extraction and `TraceFile` database cleanup)
 */

import fs from "node:fs";
import path from "node:path";
import { detectFrontendTestKit, resolvePageTestDescriptor } from "./page-resolver.mjs";
import { planFrontendDataStrategy } from "./data-provisioner.mjs";
import { compileFrontendRecipeToPluginPayload } from "./recipe-compiler.mjs";

/**
 * Unwraps a JSON-RPC MCP `tools/call` response envelope (`result.structuredContent` or
 * `result.content[0].text`) into a normalized execution result object.
 */
export function unwrapMcpPluginResponse(resp) {
  let data = resp;
  if (resp && resp.result) {
    data = resp.result.structuredContent || resp.result;
  }
  if (data && Array.isArray(data.content)) {
    const txtItem = data.content.find((c) => c && c.type === "text" && typeof c.text === "string");
    if (txtItem) {
      try {
        data = JSON.parse(txtItem.text);
      } catch {
        const rawText = txtItem.text;
        const isSuccess = /Test Execution Summary:\s*SUCCESS/i.test(rawText);
        const isFail = !isSuccess && (/Test Execution Summary:\s*FAILED/i.test(rawText) || /\b(error|exception|failed)\b/i.test(rawText));

        // Parse step-level Markdown output emitted by MTA_plugin (`* **Step #N** (\`MicroflowCall\` - Key: \`K\`)` ... `- **Result:** \`Failed\``)
        const stepResults = [];
        const stepBlocks = rawText.split(/(?=\*\s+\*\*Step\s+#\d+\*\*)/i);
        for (const blk of stepBlocks) {
          const hdr = blk.match(/\*\s+\*\*Step\s+#(\d+)\*\*\s*\(`([^`]+)`\s*-\s*Key:\s*`?(\d+)`?\)/i);
          if (!hdr) continue;
          const seqNum = Number(hdr[1]);
          const stepType = hdr[2];
          const stepKey = Number(hdr[3]);
          const resMatch = blk.match(/-\s+\*\*Result:\*\*\s*`([^`]+)`/i);
          const descMatch = blk.match(/-\s+\*\*Description:\*\*\s*([^\r\n]+)/i);
          const stepStatus = resMatch ? resMatch[1].trim() : "Executed";
          const stepDesc = descMatch ? descMatch[1].trim() : null;
          stepResults.push({
            SequenceNumber: seqNum,
            Key: stepKey,
            TestStepRunType: stepType,
            Result: stepStatus,
            Status: stepStatus,
            ResultDescription: stepDesc,
            ErrorMessage: /fail|error|exception/i.test(stepStatus) ? stepDesc || rawText.slice(0, 400) : null,
          });
        }
        const failedStep =
          stepResults.find((s) => /fail|error|exception/i.test(String(s.Result || ""))) || null;
        return {
          raw: data,
          overallResult: isFail ? "Failed" : "Passed",
          passed: !isFail,
          durationMs: 0,
          stepResults,
          failedStep,
          errorMessage: isFail ? failedStep?.ResultDescription || rawText.slice(0, 400) : null,
        };
      }
    }
  }

  if (!data || typeof data !== "object") {
    return {
      raw: data,
      overallResult: "ERROR",
      passed: false,
      durationMs: 0,
      stepResults: [],
      failedStep: null,
      errorMessage: "Empty or non-object response from MTA_plugin",
    };
  }

  const tcResult = data.TCEX_RP_TestCaseResult || data.TCEX_RS_TestCaseResult || data;
  const overallResult = String(
    data.OverallResult ||
      data.ExecutionResult ||
      data.Status ||
      data.Result ||
      tcResult.OverallResult ||
      tcResult.ExecutionResult ||
      tcResult.Status ||
      tcResult.Result ||
      "ERROR"
  );
  const stepResults = Array.isArray(data.TCEX_RS_TestStepRun)
    ? data.TCEX_RS_TestStepRun
    : Array.isArray(tcResult.TCEX_RP_TestStepResult)
      ? tcResult.TCEX_RP_TestStepResult
      : [];

  const failedStep = stepResults.find((s) => {
    const r = String(s?.Status || s?.ExecutionResult || s?.Result || "").toUpperCase();
    return (
      r === "FAIL" ||
      r === "FAILED" ||
      r === "ERROR" ||
      Boolean(s?.ExceptionMessage) ||
      Boolean(s?.ErrorMessage) ||
      (Boolean(s?.ResultDescription) && r !== "SUCCESS" && r !== "EXECUTED" && r !== "PASSED")
    );
  });

  const normOverall = overallResult.toUpperCase();
  const passed =
    (normOverall === "PASSED" || normOverall === "EXECUTED" || normOverall === "SUCCESS" || normOverall === "PASS") &&
    !failedStep;

  const durationMs = Number(data.DurationInMs || data.ExecutionDuration || tcResult.Duration || 0);
  const errorMessage = !passed
    ? failedStep?.ExceptionMessage ||
      failedStep?.ErrorMessage ||
      failedStep?.TCEX_RS_TestStepException?.Message ||
      failedStep?.ResultDescription ||
      data.ResultDescription ||
      data.ErrorMessage ||
      data.ExceptionMessage ||
      tcResult.ErrorMessage ||
      tcResult.ExceptionMessage ||
      `Step failed with status ${overallResult}`
    : null;

  return {
    raw: data,
    overallResult,
    passed,
    durationMs,
    stepResults,
    failedStep,
    errorMessage: errorMessage ? String(errorMessage) : null,
  };
}

/**
 * Synthesizes declarative `FrontendRecipe` objects for hypotheses linked to a Mendix Page
 * in the harvested AST bundle.
 */
export function synthesizeFrontendRecipesForManifest(manifest, bundle = {}, options = {}) {
  const pages = bundle?.pages || manifest?.bundle?.pages || [];
  if (pages.length === 0) return [];

  const effectiveCatalog = options.catalogPath || bundle?.catalog_db_path || bundle?.catalog_path || null;
  const effectiveMpr = options.mprPath || bundle?.mpr_path || null;

  const allHyps = [
    ...(manifest?.amber_ui_candidates || []),
    ...(manifest?.hypotheses || []),
  ];

  // Prioritize UI feedback hypotheses (`BHP-17`, `BHP-32`, `DQP-02`) and page-called microflow hypotheses
  const uiHyps = allHyps.filter((h) => {
    if (/^(BHP-17|BHP-32|DQP-02)$/.test(h.pattern_id || "")) return true;
    if (h.defect_tier === "AMBER-UI") return true;
    const callingPage = pages.find((p) => (p.calls_microflows || []).includes(h.microflow));
    return Boolean(callingPage && h.exposure_classification === "ACTUAL_UI_OR_API_REPRODUCIBLE");
  });

  // Sort so Step 1 / entry-level page actions and UI feedback checks run first
  uiHyps.sort((a, b) => {
    const aIsUi = /^(BHP-17|BHP-32|DQP-02)$/.test(a.pattern_id || "") || a.defect_tier === "AMBER-UI" ? 1 : 0;
    const bIsUi = /^(BHP-17|BHP-32|DQP-02)$/.test(b.pattern_id || "") || b.defect_tier === "AMBER-UI" ? 1 : 0;
    if (aIsUi !== bIsUi) return bIsUi - aIsUi;
    const aStep1 = /next_2_bookingdetails|create_booking/i.test(a.microflow || "") ? 1 : 0;
    const bStep1 = /next_2_bookingdetails|create_booking/i.test(b.microflow || "") ? 1 : 0;
    return bStep1 - aStep1;
  });

  const recipes = [];
  const seenMfPattern = new Set();
  const maxFrontend = Number(options.maxFrontendScenarios ?? 5);

  for (const hyp of uiHyps) {
    if (recipes.length >= maxFrontend) break;
    const dedupKey = `${hyp.microflow}::${hyp.pattern_id}::${hyp.target_attribute || ""}`;
    if (seenMfPattern.has(dedupKey)) continue;

    const targetPage =
      pages.find((p) => p.qualified_name === hyp.page || p.name === hyp.page) ||
      pages.find((p) => (p.calls_microflows || []).includes(hyp.microflow));
    if (!targetPage) continue;

    const pageDesc = resolvePageTestDescriptor(targetPage.qualified_name, {
      catalogPath: effectiveCatalog,
      mprPath: effectiveMpr,
      bundle,
    });

    // Locate the ActionButton that calls `hyp.microflow` (or first submit/next button on the page)
    let triggerBtn = Array.from(pageDesc.widgets.values()).find(
      (w) => w.widgetType === "Button" && w.callsMicroflow === hyp.microflow
    );
    if (!triggerBtn) {
      triggerBtn = Array.from(pageDesc.widgets.values()).find(
        (w) => w.widgetType === "Button" && /save|confirm|submit|next|book/i.test(w.name)
      );
    }
    if (!triggerBtn) continue;

    const steps = [];
    const assertions = [];
    const overrides = hyp.variation_overrides || {};

    // Check if target triggerBtn is on Step 2 or Step 3 of a multi-step wizard page (e.g. Booking_Create)
    const step1NextBtn = Array.from(pageDesc.widgets.values()).find(
      (w) => w.widgetType === "Button" && /Next_Step1/i.test(w.name) && w.name !== triggerBtn.name
    );
    const step2NextBtn = Array.from(pageDesc.widgets.values()).find(
      (w) => w.widgetType === "Button" && /Next_Step2/i.test(w.name) && w.name !== triggerBtn.name
    );
    const isWizardStep3Target = Boolean(step1NextBtn && step2NextBtn && /Confirm|previous_2/i.test(triggerBtn.name));
    const isWizardStep2Target = Boolean(step1NextBtn && !isWizardStep3Target && /Next_Step2|previous_1/i.test(triggerBtn.name));

    if ((isWizardStep2Target || isWizardStep3Target) && step1NextBtn) {
      const pickupW = Array.from(pageDesc.widgets.values()).find(
        (w) => w.widgetType === "DatePicker" && /PickupDate/i.test(w.attribute || w.name)
      );
      const returnW = Array.from(pageDesc.widgets.values()).find(
        (w) => w.widgetType === "DatePicker" && /ReturnDate/i.test(w.attribute || w.name)
      );
      if (pickupW) {
        steps.push({
          widget: pickupW.name,
          widgetType: "DatePicker",
          action: "fillDate",
          value: "2026-12-01T10:00:00.000Z",
          format: pickupW.dateFormat || "dd-MM-yyyy",
        });
      }
      if (returnW) {
        steps.push({
          widget: returnW.name,
          widgetType: "DatePicker",
          action: "fillDate",
          value: "2026-12-05T10:00:00.000Z",
          format: returnW.dateFormat || "dd-MM-yyyy",
        });
      }
      steps.push({
        widget: step1NextBtn.name,
        widgetType: "Button",
        action: "click",
      });
      if (isWizardStep3Target && step2NextBtn) {
        steps.push({
          widget: step2NextBtn.name,
          widgetType: "Button",
          action: "click",
        });
      }
    }

    // Helper to build a Law 2 repeatingContainer descriptor when a widget belongs to a Gallery/ListView/DataGrid2
    const buildRepeatingContainerSpec = (wMeta) => {
      const rc = wMeta?.enclosingRepeatingContainer || null;
      if (!rc) return undefined;
      const rcEntity = rc.entity || wMeta?.entity || null;
      const entDef = rcEntity ? (bundle?.entities || []).find((e) => e.qualified_name === rcEntity) : null;
      const stringAttr =
        entDef?.attributes?.find((a) => /^(?:LicensePlate|Name|Code|Title|Number|Email|Description)$/i.test(a.name)) ||
        entDef?.attributes?.find((a) => /^String/i.test(a.type || ""));
      return {
        type: rc.type || "Gallery",
        name: rc.name,
        entity: rcEntity,
        ...(rcEntity && stringAttr
          ? { fromDbAttr: `${rcEntity}.${stringAttr.name}` }
          : { useNthItem: 0 }),
      };
    };

    // Map widget inputs on the page matching the hypothesis overrides (only for widgets active in the target step)
    for (const [wName, wMeta] of pageDesc.widgets.entries()) {
      if (wMeta.widgetType === "Button" || wMeta.widgetType === "DynamicText") continue;
      if (wMeta.widgetType === "Gallery" || wMeta.widgetType === "ListView" || wMeta.widgetType === "DataGrid2") continue;
      // Avoid interacting with Step 1 DatePickers again if we already advanced to Wizard Step 3
      if (isWizardStep3Target && /PickupDate|ReturnDate|SelectLocation/i.test(`${wName} ${wMeta.attribute || ""}`)) {
        continue;
      }
      // Avoid interacting with Step 3 Renter fields when testing Step 1
      if (!isWizardStep3Target && step1NextBtn && triggerBtn.name === step1NextBtn.name && /Renter/i.test(wMeta.entity || "")) {
        continue;
      }

      const attrShort = wMeta.attribute || "";
      const entityShort = wMeta.entity ? wMeta.entity.split(".").pop() : "";
      const overrideVal =
        overrides[wMeta.fullAttribute] ??
        overrides[`${entityShort}.${attrShort}`] ??
        overrides[`$${attrShort}`] ??
        overrides[attrShort];
      const wRcSpec = buildRepeatingContainerSpec(wMeta);

      if (wMeta.widgetType === "ReferenceSelector" && wMeta.entity && (overrideVal !== undefined || wMeta.requiredOnPage)) {
        const refAttr = wMeta.fullAttribute || `${wMeta.entity}.${wMeta.attribute || "Name"}`;
        steps.push({
          widget: wName,
          widgetType: "ReferenceSelector",
          action: "selectByLabel",
          fromDbAttr: refAttr,
          ...(wRcSpec ? { repeatingContainer: wRcSpec } : {}),
        });
      } else if (wMeta.widgetType === "DatePicker" && overrideVal !== undefined && overrideVal !== "empty") {
        steps.push({
          widget: wName,
          widgetType: "DatePicker",
          action: "fillDate",
          value: String(overrideVal).includes("T") ? String(overrideVal) : "2026-07-10T00:00:00.000Z",
          format: wMeta.dateFormat || "dd-MM-yyyy",
          ...(wRcSpec ? { repeatingContainer: wRcSpec } : {}),
        });
      } else if (wMeta.widgetType === "TextBox" && overrideVal !== undefined && overrideVal !== "empty") {
        const rawStr = String(overrideVal).replace(/^'|'$/g, "");
        const cleanVal =
          rawStr === "VALID_STR"
            ? /email/i.test(attrShort)
              ? "bughunt.fe@menditect.test"
              : "BugHunt Test User"
            : rawStr;
        steps.push({
          widget: wName,
          widgetType: "TextBox",
          action: "fill",
          value: cleanVal,
          ...(wRcSpec ? { repeatingContainer: wRcSpec } : {}),
        });
      }
    }

    const triggerRcSpec = buildRepeatingContainerSpec(triggerBtn);
    steps.push({
      widget: triggerBtn.name,
      widgetType: "Button",
      action: "click",
      ...(triggerRcSpec ? { repeatingContainer: triggerRcSpec } : {}),
    });

    // Post-submit assertion (`PAT-119`): check validation feedback visibility on the target widget
    const targetAttrShort = hyp.target_attribute
      ? String(hyp.target_attribute).split(/[.\/]/).pop()
      : /ReturnDate/i.test(JSON.stringify(overrides))
        ? "ReturnDate"
        : /Birthdate/i.test(JSON.stringify(overrides))
          ? "Birthdate"
          : /Email/i.test(JSON.stringify(overrides))
            ? "Email"
            : null;
    const targetInputWidget =
      (targetAttrShort &&
        Array.from(pageDesc.widgets.values()).find((w) => w.attribute === targetAttrShort)) ||
      Array.from(pageDesc.widgets.values()).find((w) =>
        ["TextBox", "DatePicker", "ReferenceSelector", "DropDown"].includes(w.widgetType)
      );

    if (targetInputWidget) {
      const asrRcSpec = buildRepeatingContainerSpec(targetInputWidget) || triggerRcSpec;
      assertions.push({
        widget: targetInputWidget.name,
        widgetType: targetInputWidget.widgetType,
        check: "validationVisible",
        expected: true,
        ...(asrRcSpec ? { repeatingContainer: asrRcSpec } : {}),
      });
    }

    const isUiDisconnect = /^(BHP-17|BHP-32|DQP-02)$/.test(hyp.pattern_id || "") || hyp.defect_tier === "AMBER-UI";
    const channelRationale = isUiDisconnect
      ? `Executed via Frontend UI (Playwright) on page '${pageDesc.qualifiedName}' (button '${triggerBtn.name}') because '${hyp.pattern_id}' tests whether validation feedback on '${hyp.target_attribute || targetInputWidget?.fullAttribute || "form widget"}' is actually rendered and visible to the user in the browser DOM—which backend microflow execution cannot verify.`
      : `Executed via Frontend UI (Playwright) on page '${pageDesc.qualifiedName}' (button '${triggerBtn.name}' -> '${hyp.microflow}') to verify end-to-end form input binding, page visibility rules, and browser-level validation feedback alongside backend microflow verification.`;

    seenMfPattern.add(dedupKey);
    recipes.push({
      hypothesisId: hyp.id,
      patternId: hyp.pattern_id,
      title: hyp.title,
      microflow: hyp.microflow,
      entryPage: pageDesc.qualifiedName,
      pageClassName: pageDesc.pageClassName,
      entryStrategy: pageDesc.entryStrategy,
      auth: { mode: "anonymous" },
      dataStrategy: "AUTO",
      steps,
      assertions,
      testChannel: "FRONTEND_UI",
      channelRationale,
    });
  }

  return recipes;
}

/**
 * Copies the latest generated Playwright trace `.zip` from `<projectDir>/deployment/data/files`
 * into `<outDir>/traces/Trace_<hypothesisId>.zip` when `--trace` or `--trace-on-fail` is enabled.
 */
function extractLocalTraceArtifact(projectDir, hypothesisId, outDir) {
  if (!projectDir) return null;
  const filesRoot = path.join(projectDir, "deployment", "data", "files");
  if (!fs.existsSync(filesRoot)) return null;

  let newestFile = null;
  let newestMtime = 0;

  function scanDir(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        scanDir(full);
      } else if (entry.isFile()) {
        const stat = fs.statSync(full);
        if (stat.mtimeMs > newestMtime && stat.size > 1024) {
          newestMtime = stat.mtimeMs;
          newestFile = full;
        }
      }
    }
  }

  try {
    scanDir(filesRoot);
    if (!newestFile) return null;
    const baseOut = outDir || "menditect-output/bug-reports";
    const siblingTestsDir = path.join(path.dirname(path.resolve(baseOut)), "bug-hunt-tests", "traces");
    const tracesDir = fs.existsSync(path.dirname(siblingTestsDir))
      ? siblingTestsDir
      : path.join(baseOut, "traces");
    fs.mkdirSync(tracesDir, { recursive: true });
    const fileName = `Trace_${hypothesisId}.zip`;
    const destPath = path.join(tracesDir, fileName);
    const stat = fs.statSync(newestFile);
    fs.copyFileSync(newestFile, destPath);
    return {
      file_name: fileName,
      local_path: destPath,
      size_bytes: stat.size,
      view_command: `npx playwright show-trace "${destPath}"`,
    };
  } catch {
    return null;
  }
}

/**
 * Executes a batch of synthesized `FrontendRecipe` tests via `MTA_plugin.execute-testcase`
 * using the 4-Tier Data Strategy and `try ... finally` teardown guarantee.
 */
export async function executeFrontendBugHuntBatch(
  manifest,
  bundle,
  options = {},
  executeViaMcpHttp = null
) {
  if (options.frontend === false) {
    return { executed: false, reason: "Disabled via --no-frontend", results: [] };
  }

  const kitStatus = detectFrontendTestKit(options.mprPath, options.catalogPath, bundle);
  if (!kitStatus.available) {
    return {
      executed: false,
      reason: "MenditectMxFrontendTestKit not detected in Mendix project",
      results: [],
    };
  }

  const recipes = synthesizeFrontendRecipesForManifest(manifest, bundle, options);
  if (recipes.length === 0 || typeof executeViaMcpHttp !== "function") {
    return {
      executed: false,
      reason: recipes.length === 0 ? "No page-bound UI hypotheses required frontend verification" : "No MCP executor",
      results: [],
    };
  }

  const pluginUrl = options.pluginUrl;
  let derivedAppUrl = options.appUrl || bundle?.app_url || null;
  if (!derivedAppUrl && kitStatus.projectDir) {
    const deployCfgPath = path.join(kitStatus.projectDir, "deployment", "model", "config.json");
    if (fs.existsSync(deployCfgPath)) {
      try {
        const deployCfg = JSON.parse(fs.readFileSync(deployCfgPath, "utf8"));
        const rootUrl =
          deployCfg?.Configuration?.ApplicationRootUrl ||
          deployCfg?.ApplicationRootUrl ||
          null;
        if (rootUrl && /^https?:\/\//i.test(String(rootUrl).trim())) {
          derivedAppUrl = String(rootUrl).trim().replace(/\/+$/, "");
        }
      } catch {
        // Ignore malformed deployment config.json
      }
    }
  }
  if (!derivedAppUrl && pluginUrl) {
    try {
      derivedAppUrl = new URL(pluginUrl).origin;
    } catch {
      derivedAppUrl = "http://localhost:8080";
    }
  }
  const effectiveOptions = {
    ...options,
    appUrl: derivedAppUrl || "http://localhost:8080",
  };
  const results = [];

  // Live DB probe helper for Tier 2 (`Retrieve From_database, Head`)
  const probeDbFn = async (entityQName) => {
    const probePayload = {
      ApplySecurityExecutor: "NONE",
      ExecutorUsername: "MxAdmin",
      RollbackTcseAfterExecution: "Yes",
      is_bughunt: true,
      TCEX_RQ_TestStepRun: [
        {
          Key: 1,
          SequenceNumber: 1,
          TestStepRunType: "Oact",
          ExecutionCondition: "Always",
          ResumeExecutionAfterException: "Stop",
          ExecutionDelayInMs: 0,
          TCEX_RQ_TestStepRunOact: {
            Action: "Retrieve",
            EntityQualifiedName: entityQName,
            RetrieveOption: "From_database",
            RetrieveSet: "Head",
          },
        },
      ],
    };
    const resp = await executeViaMcpHttp(pluginUrl, "execute-testcase", probePayload);
    const unwrapped = unwrapMcpPluginResponse(resp);
    if (!unwrapped.passed) return false;
    const step0 = unwrapped.stepResults?.[0];
    const oact = step0?.TCEX_RS_TestStepRunOact || step0;
    if (oact?.IsReturnValueEmpty === true || Number(oact?.ObjectCount ?? 1) === 0) {
      return false;
    }
    return true;
  };

  for (let i = 0; i < recipes.length; i++) {
    const recipe = recipes[i];
    const pageDesc = resolvePageTestDescriptor(recipe.entryPage, {
      catalogPath: effectiveOptions.catalogPath || bundle?.catalog_db_path || bundle?.catalog_path,
      mprPath: effectiveOptions.mprPath || bundle?.mpr_path,
      bundle,
    });
    const dataPlan = await planFrontendDataStrategy(pageDesc, recipe, bundle, probeDbFn);
    const tc02Payload = compileFrontendRecipeToPluginPayload(recipe, pageDesc, dataPlan, effectiveOptions);

    if (!effectiveOptions.quiet) {
      console.log(
        `  [FE ${i + 1}/${recipes.length}] Executing Playwright UI scenario ${recipe.hypothesisId} (${recipe.patternId}) on ${recipe.entryPage} [${dataPlan.tierName}]...`
      );
    }

    let traceArtifactPath = null;
    try {
      // Call 1: TC_01_Seed (only when Tier 3 seeding is required)
      if (dataPlan.requiresSeedCall && dataPlan.seedPayload) {
        await executeViaMcpHttp(pluginUrl, "execute-testcase", dataPlan.seedPayload, 60000);
      }

      // Call 2: TC_02_Frontend_Action (Self-contained Playwright lifecycle)
      const resp = await executeViaMcpHttp(pluginUrl, "execute-testcase", tc02Payload, 90000);
      const unwrapped = unwrapMcpPluginResponse(resp);
      const passed = unwrapped.passed;

      // Build human-readable step summary and 4-phase outcome classification:
      //  - Phase A: `FAIL_UI_SETUP` (DB Retrieve or `Start_Frontend_Test*` / `Start_MxFrontend_Test*`)
      //  - Phase B: `FAIL_UI_LOCATOR_OR_PRECONDITION` (`Locate_Mx*`, `ELO_Filter_*`, `Fill_*`, `Click_*`, etc. before `ASR_*`)
      //  - Phase C: `FAIL_UI_ASSERTION` (post-submit `Locate_MxWidget_*_ValidationMessage` or `ASR_*`)
      const reqSteps = tc02Payload.TCEX_RQ_TestStepRun || [];
      const stepSummary = reqSteps.map((rs) => {
        const matchedRes = (unwrapped.stepResults || []).find(
          (sr) => (sr.Key ?? sr.SequenceNumber) === (rs.Key ?? rs.SequenceNumber)
        );
        const qName =
          rs.TCEX_RQ_TestStepRunMfc?.QualifiedName ||
          (rs.TCEX_RQ_TestStepRunOact
            ? `${rs.TCEX_RQ_TestStepRunOact.Action} ${rs.TCEX_RQ_TestStepRunOact.EntityQualifiedName}`
            : rs.TestStepRunType);
        return {
          sequence: rs.SequenceNumber ?? rs.Key,
          key: rs.Key,
          type: rs.TestStepRunType,
          name: qName,
          result: matchedRes?.Result || matchedRes?.Status || (passed ? "Success" : "NotExecuted"),
          message: matchedRes?.ResultDescription || matchedRes?.ErrorMessage || null,
        };
      });

      let outcome = passed ? "PASS" : "FAIL_UI_LOCATOR_OR_PRECONDITION";
      if (!passed) {
        const firstAsrIdx = reqSteps.findIndex((rs) => {
          const mf = rs.TCEX_RQ_TestStepRunMfc?.QualifiedName || "";
          return /\.ASR_|_ValidationMessage$/i.test(mf);
        });
        const failedKey = unwrapped.failedStep?.Key ?? unwrapped.failedStep?.SequenceNumber ?? null;
        const failedIdx =
          failedKey !== null
            ? reqSteps.findIndex((s) => s.Key === failedKey || s.SequenceNumber === failedKey)
            : -1;
        const reqStep = failedIdx >= 0 ? reqSteps[failedIdx] : null;
        const failedMf = reqStep?.TCEX_RQ_TestStepRunMfc?.QualifiedName || "";

        if (
          reqStep?.TestStepRunType === "Oact" ||
          /Start_Frontend_Test|Start_MxFrontend_Test/i.test(failedMf)
        ) {
          outcome = "FAIL_UI_SETUP";
        } else if (
          /\.ASR_|_ValidationMessage$/i.test(failedMf) ||
          (firstAsrIdx >= 0 && failedIdx >= firstAsrIdx)
        ) {
          outcome = "FAIL_UI_ASSERTION";
        } else {
          outcome = "FAIL_UI_LOCATOR_OR_PRECONDITION";
        }
      }

      // Optional Mode 2 Trace Replay (`--trace-on-fail` or `--trace`)
      if ((!passed && effectiveOptions.traceOnFail) || effectiveOptions.trace) {
        const tracePayload = compileFrontendRecipeToPluginPayload(recipe, pageDesc, dataPlan, {
          ...effectiveOptions,
          trace: true,
        });
        await executeViaMcpHttp(pluginUrl, "execute-testcase", tracePayload, 90000);
        traceArtifactPath = extractLocalTraceArtifact(
          kitStatus.projectDir,
          recipe.hypothesisId,
          effectiveOptions.outDir
        );
      }

      const actualMsg = passed
        ? `Playwright UI test passed on '${recipe.entryPage}' (${dataPlan.tierName}) — expected validation feedback / UI behavior verified in browser.`
        : unwrapped.errorMessage || `UI step failed on '${recipe.entryPage}' (${outcome})`;

      if (!effectiveOptions.quiet) {
        console.log(`    -> FE Outcome: ${outcome} (${actualMsg.slice(0, 140)}) [${unwrapped.durationMs}ms]`);
      }

      results.push({
        id: `${recipe.hypothesisId}_FE`,
        hypothesis_id: recipe.hypothesisId,
        pattern_id: recipe.patternId,
        microflow: recipe.microflow,
        title: recipe.title,
        execution_channel: "FRONTEND_PLAYWRIGHT_PLUGIN",
        test_channel: "FRONTEND_UI",
        test_channel_badge: "🌐 Frontend UI (Playwright)",
        test_channel_rationale: recipe.channelRationale,
        data_tier: dataPlan.tierName,
        entry_page: recipe.entryPage,
        page_qualified_name: recipe.entryPage,
        outcome,
        actual_value: passed ? actualMsg : null,
        error_message: !passed ? actualMsg : null,
        duration_ms: unwrapped.durationMs,
        trace_artifact: traceArtifactPath,
        step_summary: stepSummary,
      });
    } catch (err) {
      if (!effectiveOptions.quiet) {
        console.warn(`    -> FE Error on ${recipe.hypothesisId}: ${err.message}`);
      }
      results.push({
        id: `${recipe.hypothesisId}_FE`,
        hypothesis_id: recipe.hypothesisId,
        pattern_id: recipe.patternId,
        microflow: recipe.microflow,
        title: recipe.title,
        execution_channel: "FRONTEND_PLAYWRIGHT_PLUGIN",
        test_channel: "FRONTEND_UI",
        test_channel_badge: "🌐 Frontend UI (Playwright)",
        test_channel_rationale: recipe.channelRationale,
        data_tier: dataPlan.tierName,
        entry_page: recipe.entryPage,
        outcome: "FAIL_EXCEPTION",
        error_message: err.message,
        duration_ms: 0,
      });
    } finally {
      // Call 3: TC_03_Teardown (Guaranteed cleanup of seeded or trace records)
      if (dataPlan.requiresTeardownCall && dataPlan.teardownPayload) {
        await executeViaMcpHttp(pluginUrl, "execute-testcase", dataPlan.teardownPayload, 60000).catch(() => {});
      }
    }
  }

  return {
    executed: true,
    kitSource: kitStatus.source,
    results,
  };
}
