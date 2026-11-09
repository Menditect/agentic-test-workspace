# Menditect Bug Hunter Engine — Modular Architecture Map

This file provides a fast navigation index for AI agents and developers so individual subsystems can be read in a single tool call ($\le 350$ lines per module) without scanning the entire CLI orchestrator.

---

## 1. Directory & Module Boundaries

| File Path | Max Size | Primary Responsibility & Key Exports |
| :--- | :---: | :--- |
| [`mta-bughunter.mjs`](./mta-bughunter.mjs) | CLI Entrypoint | Top-level CLI commands (`hunt`, `harvest`, `analyze`, `mine-invariants`, `audit-rbac`, `generate-plan`, `report`, `self-test`), 4-layer backend AST detectors (`BHP-*`, `DQP-*`, `SEC-*`, `INV-*`, `PBT-*`), and report generation. |
| [`frontend/testkit-catalog.json`](./frontend/testkit-catalog.json) | ~250 lines | **Pure Declarative Catalog:** Exact parameter names, `DataType`s, `Options` entity types, and return types for `MenditectMxFrontendTestKit` and `MenditectPlaywrightConnector` (verified against `Microflows.java` and `api.json`). |
| [`frontend/page-resolver.mjs`](./frontend/page-resolver.mjs) | ~280 lines | **Page & Navigation Model Extractor:** Exports `detectFrontendTestKit(mprPath, catalogPath)` and `resolvePageTestDescriptor(catalogPath, mprPath, pageQName, bundle)` to resolve page `Class`, entry navigation path, widget inventory, and DatePicker `CustomDateFormat` (`PAT-94`). |
| [`frontend/data-provisioner.mjs`](./frontend/data-provisioner.mjs) | ~300 lines | **4-Tier Data Strategy:** Exports `planFrontendDataStrategy(pageDescriptor, recipe, bundle, probeDbFn)` and `buildSeedAndTeardownPayloads(dataPlan, bundle, runTag)` implementing Tier 1 (Primitives), Tier 2 (Live DB `Retrieve` Reuse), Tier 3 (Page-Scoped Shared Seed + Reverse-Dependency Teardown), and Tier 4 (Browser-Commit Residue Cleanup). |
| [`frontend/recipe-compiler.mjs`](./frontend/recipe-compiler.mjs) | ~320 lines | **Pure Frontend Recipe Compiler:** Exports `compileFrontendRecipeToPluginPayload(recipe, pageDescriptor, dataPlan, options)` translating a compact declarative `FrontendRecipe` IR into a schema-valid `TCEX_RQ_TestStepRun` JSON payload (Law 1 2-step, Law 2 4-step repeating container, Law 3 4-step ComboBox, `TCEX_RQ_Smpr` handles, `TCEX_RQ_Svvr` scalar piping, and `Always` browser teardown). |
| [`frontend/frontend-runner.mjs`](./frontend/frontend-runner.mjs) | ~250 lines | **Stateless `MTA_plugin` Runner & Trace Manager:** Exports `synthesizeFrontendRecipesForManifest(manifest, bundle)` and `executeFrontendBugHuntBatch(manifest, bundle, options, executeViaMcpHttp)` orchestrating `TC_01_Seed` $\rightarrow$ `TC_02_Frontend_Action` $\rightarrow$ `TC_03_Teardown` (`try ... finally`) and optional `--trace-on-fail` artifact extraction. |
| [`frontend/self-test-frontend.mjs`](./frontend/self-test-frontend.mjs) | ~220 lines | **Automated Contract & Schema Tests:** Exports `runFrontendSelfTests()` verifying compiled `TCEX_RQ_TestStepRun` payloads, `testkit-catalog.json` parity, Law 1–3 step chains, and teardown safety invariants. |

---

## 2. Core Data Contracts Between Modules

1. **`PageTestDescriptor`** (produced by `page-resolver.mjs`, consumed by `data-provisioner.mjs` & `recipe-compiler.mjs`):
   `{ qualifiedName, name, moduleName, pageClassName, allowedRoles, entryStrategy, widgets: Map<widgetName, WidgetMeta>, requiredEntities: string[] }`
2. **`FrontendRecipe`** (produced by `frontend-runner.mjs`, consumed by `data-provisioner.mjs` & `recipe-compiler.mjs`):
   `{ hypothesisId, patternId, title, entryPage, auth: { mode, username, password }, dataStrategy, steps: RecipeStep[], assertions: RecipeAssertion[] }`
3. **`DataProvisionPlan`** (produced by `data-provisioner.mjs`, consumed by `recipe-compiler.mjs` & `frontend-runner.mjs`):
   `{ tier: 1|2|3|4, runTag, requiresSeedCall: boolean, requiresTeardownCall: boolean, dbRetrievesForCase2: EntityRetrieveSpec[], seedPayload: object|null, teardownPayload: object|null }`
