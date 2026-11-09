/**
 * Menditect Bug Hunter — Frontend Playwright Module Self-Test Suite (`self-test-frontend.mjs`)
 *
 * Verifies:
 *  1. `testkit-catalog.json` signature integrity (`ACT_*` / `ASR_*` return `"VoidType"`, `Stop_MxFrontendTest` returns `TraceFile`).
 *  2. Topological entity dependency ordering (`orderEntityDependencyGraph`) and `TC_01_Seed` / `TC_03_Teardown`
 *     payload generation (`PAT-06`, `PAT-21` Persist, `PAT-93` reverse-dependency teardown).
 *  3. 4-Tier Data Strategy selection (`planFrontendDataStrategy`: Tier 1 Zero-Persistence Primitives,
 *     Tier 2 Read-Only Live DB Reuse via `probeDbFn`, Tier 3 Page-Scoped Shared Fixture Seeding).
 *  4. Declarative `FrontendRecipe` to `MTA_plugin.execute-testcase` compilation (`compileFrontendRecipeToPluginPayload`)
 *     across Law 1 (2-step widget chain + `TCEX_RQ_Svvr`), Law 2 (4-step repeating container chain),
 *     Law 3 (4-step `ComboBox` open-fill-close chain), `PAT-119` validation message locators,
 *     and mandatory `Always`/`_Continue` browser teardown (`Stop_MxFrontendTest` + `Teardown_Playwright`).
 *  5. 2-Mode Trace Strategy (`RollbackTcseAfterExecution: "Yes"` when `trace=false` vs `StartMxFrontendTestOptions`
 *     with `Trace: "true"` and `RollbackTcseAfterExecution: "No"` when `trace=true`).
 */

import assert from "node:assert/strict";
import { getTestKitCatalog, compileFrontendRecipeToPluginPayload } from "./recipe-compiler.mjs";
import {
  resolvePageTestDescriptor,
  extractTableCellWidgetsFromSource,
} from "./page-resolver.mjs";
import {
  orderEntityDependencyGraph,
  buildSeedAndTeardownPayloads,
  planFrontendDataStrategy,
} from "./data-provisioner.mjs";
import {
  synthesizeFrontendRecipesForManifest,
  unwrapMcpPluginResponse,
} from "./frontend-runner.mjs";

const CAR_RENTAL_MOCK_BUNDLE = {
  module: "CarRentalModule",
  has_frontend_testkit: true,
  entities: [
    {
      name: "Location",
      qualified_name: "CarRentalModule.Location",
      attributes: [
        { name: "Name", type: "String", is_required: true },
        { name: "City", type: "String", is_required: true },
      ],
      associations: [],
    },
    {
      name: "CarSize",
      qualified_name: "CarRentalModule.CarSize",
      attributes: [
        { name: "Name", type: "String", is_required: true },
        { name: "Size", type: "Enumeration", enum_values: ["Small", "Medium", "Large"] },
        { name: "PricePerDay", type: "Decimal", is_required: true },
      ],
      associations: [],
    },
    {
      name: "Car",
      qualified_name: "CarRentalModule.Car",
      attributes: [
        { name: "BrandAndType", type: "String", is_required: true },
        { name: "LicensePlate", type: "String", is_required: true },
      ],
      associations: [
        {
          name: "Car_CarSize",
          qualified_name: "CarRentalModule.Car_CarSize",
          parent_entity: "CarRentalModule.Car",
          child_entity: "CarRentalModule.CarSize",
          owner: "_Default",
          type: "Reference",
        },
        {
          name: "Car_Location",
          qualified_name: "CarRentalModule.Car_Location",
          parent_entity: "CarRentalModule.Car",
          child_entity: "CarRentalModule.Location",
          owner: "_Default",
          type: "Reference",
        },
      ],
    },
  ],
  pages: [
    {
      name: "Home",
      qualified_name: "CarRentalModule.Home",
      class_name: "Home",
      parameters: [],
      widgets: [
        {
          name: "actionButton1",
          type: "ActionButton",
          calls_microflow: "CarRentalModule.ACT_Booking_Create",
        },
      ],
    },
    {
      name: "Booking_Step1_PeriodAndLocation",
      qualified_name: "CarRentalModule.Booking_Step1_PeriodAndLocation",
      class_name: "Booking_Step1_PeriodAndLocation",
      parameters: [{ name: "Booking", entity: "CarRentalModule.Booking" }],
      calls_microflows: ["CarRentalModule.ACT_Booking_Step1_Confirm"],
      widgets: [
        {
          name: "DatePicker_PickUpDate",
          type: "DatePicker",
          attribute: "CarRentalModule.Booking.PickupDate",
          date_format: "dd-MM-yyyy",
        },
        {
          name: "DatePicker_ReturnDate",
          type: "DatePicker",
          attribute: "CarRentalModule.Booking.ReturnDate",
          date_format: "dd-MM-yyyy",
        },
        {
          name: "referenceSelector1",
          type: "ReferenceSelector",
          entity: "CarRentalModule.Location",
          attribute: "CarRentalModule.Location.Name",
        },
        {
          name: "ActionButton_Next",
          type: "ActionButton",
          calls_microflow: "CarRentalModule.ACT_Booking_Step1_Confirm",
        },
      ],
    },
  ],
};

export async function runFrontendSelfTests() {
  // 1. Verify TestKit Catalog Signatures
  const catalog = getTestKitCatalog();
  assert.equal(
    catalog.lifecycle.Stop_MxFrontendTest.returnType.entity,
    "MenditectPlaywrightConnector.TraceFile",
    "Stop_MxFrontendTest must return MenditectPlaywrightConnector.TraceFile"
  );
  for (const [wName, wSpec] of Object.entries(catalog.widgets)) {
    for (const [actKey, actSpec] of Object.entries(wSpec.actions || {})) {
      assert.equal(
        actSpec.returnType,
        "VoidType",
        `Widget ${wName}.${actKey} (${actSpec.qualifiedName}) must have returnType VoidType`
      );
    }
  }

  // 2. Verify Topological Entity Ordering (`PAT-93`) and Seed/Teardown Payloads (`PAT-21`)
  const { creationOrder, teardownOrder } = orderEntityDependencyGraph(
    ["CarRentalModule.Car"],
    CAR_RENTAL_MOCK_BUNDLE.entities
  );
  const idxCarSizeCreate = creationOrder.indexOf("CarRentalModule.CarSize");
  const idxLocationCreate = creationOrder.indexOf("CarRentalModule.Location");
  const idxCarCreate = creationOrder.indexOf("CarRentalModule.Car");
  assert.ok(
    idxCarSizeCreate !== -1 && idxCarSizeCreate < idxCarCreate,
    "CarSize must be created before Car in TC_01_Seed"
  );
  assert.ok(
    idxLocationCreate !== -1 && idxLocationCreate < idxCarCreate,
    "Location must be created before Car in TC_01_Seed"
  );
  assert.ok(
    teardownOrder.indexOf("CarRentalModule.Car") < teardownOrder.indexOf("CarRentalModule.CarSize"),
    "Car must be deleted before CarSize in TC_03_Teardown (PAT-93)"
  );

  const { seedPayload, teardownPayload } = buildSeedAndTeardownPayloads(
    ["CarRentalModule.Car"],
    CAR_RENTAL_MOCK_BUNDLE,
    "BH_FE_TEST"
  );
  assert.equal(seedPayload.RollbackTcseAfterExecution, "No", "TC_01_Seed must have Rollback=No");
  const lastSeedStep = seedPayload.TCEX_RQ_TestStepRun[seedPayload.TCEX_RQ_TestStepRun.length - 1];
  assert.equal(lastSeedStep.TCEX_RQ_TestStepRunOact.Action, "Persist", "TC_01_Seed must end with Persist");

  const carSeedStep = seedPayload.TCEX_RQ_TestStepRun.find(
    (s) => s.TCEX_RQ_TestStepRunOact?.EntityQualifiedName === "CarRentalModule.Car"
  );
  assert.equal(
    carSeedStep.TCEX_RQ_TestStepRunOact.TCEX_RQ_Sfar.length,
    2,
    "Car Create step must bind Car_CarSize and Car_Location via TCEX_RQ_Sfar"
  );

  const lastTdStep = teardownPayload.TCEX_RQ_TestStepRun[teardownPayload.TCEX_RQ_TestStepRun.length - 1];
  assert.equal(lastTdStep.TCEX_RQ_TestStepRunOact.Action, "Persist", "TC_03_Teardown must end with Persist");

  // 3. Verify 4-Tier Data Strategy (`planFrontendDataStrategy`)
  const pageDesc = resolvePageTestDescriptor("CarRentalModule.Booking_Step1_PeriodAndLocation", {
    bundle: CAR_RENTAL_MOCK_BUNDLE,
  });
  assert.equal(
    pageDesc.entryStrategy.mode,
    "PARENT_PAGE_BUTTON",
    "Popup page with parameters should resolve PARENT_PAGE_BUTTON entry strategy via Home"
  );

  const tier1Plan = await planFrontendDataStrategy(
    pageDesc,
    { steps: [{ widget: "DatePicker_PickUpDate", action: "fillDate", value: "2026-07-10T00:00:00.000Z" }] },
    CAR_RENTAL_MOCK_BUNDLE
  );
  assert.equal(tier1Plan.tier, 1, "Primitives-only recipe must select Tier 1");
  assert.equal(tier1Plan.requiresSeedCall, false);

  const tier2Plan = await planFrontendDataStrategy(
    pageDesc,
    {
      steps: [
        {
          widget: "referenceSelector1",
          widgetType: "ReferenceSelector",
          action: "selectByLabel",
          fromDbAttr: "CarRentalModule.Location.Name",
        },
      ],
    },
    CAR_RENTAL_MOCK_BUNDLE,
    async () => true // mock live DB probe returning true
  );
  assert.equal(tier2Plan.tier, 2, "Existing DB data must select Tier 2 (Read-Only Live DB Reuse)");
  assert.equal(tier2Plan.requiresSeedCall, false);
  assert.equal(tier2Plan.dbRetrievesForCase2.length, 1);

  const tier3Plan = await planFrontendDataStrategy(
    pageDesc,
    {
      steps: [
        {
          widget: "referenceSelector1",
          widgetType: "ReferenceSelector",
          action: "selectByLabel",
          fromDbAttr: "CarRentalModule.Location.Name",
        },
      ],
    },
    CAR_RENTAL_MOCK_BUNDLE,
    async () => false // mock live DB probe returning false
  );
  assert.equal(tier3Plan.tier, 3, "Missing DB data must select Tier 3 (Shared Fixture Seeding)");
  assert.equal(tier3Plan.requiresSeedCall, true);
  assert.equal(tier3Plan.requiresTeardownCall, true);

  // 4. Verify Recipe Compiler (`compileFrontendRecipeToPluginPayload`) across Laws 1, 2, 3, PAT-119, and Trace Mode
  const complexRecipe = {
    entryPage: "CarRentalModule.Booking_Step1_PeriodAndLocation",
    pageClassName: "Booking_Step1_PeriodAndLocation",
    auth: { mode: "anonymous" },
    steps: [
      {
        widget: "DatePicker_PickUpDate",
        widgetType: "DatePicker",
        action: "fillDate",
        value: "2026-07-10T00:00:00.000Z",
        format: "dd-MM-yyyy",
      },
      {
        widget: "referenceSelector1",
        widgetType: "ReferenceSelector",
        action: "selectByLabel",
        fromDbAttr: "CarRentalModule.Location.Name",
      },
      {
        widget: "comboFilter1",
        widgetType: "ComboBox",
        value: "SUV",
      },
      {
        repeatingContainer: {
          type: "Gallery",
          name: "galleryCars",
          filterText: "Toyota",
        },
        widget: "btnSelectCar",
        widgetType: "Button",
        action: "click",
      },
      {
        widget: "ActionButton_Next",
        widgetType: "Button",
        action: "click",
      },
    ],
    assertions: [
      {
        widget: "DatePicker_ReturnDate",
        widgetType: "DatePicker",
        check: "validationVisible",
        expected: true,
      },
    ],
  };

  const fastPayload = compileFrontendRecipeToPluginPayload(complexRecipe, pageDesc, tier2Plan, {
    trace: false,
  });
  assert.equal(
    fastPayload.RollbackTcseAfterExecution,
    "Yes",
    "Default fast scan mode (trace=false) must set RollbackTcseAfterExecution=Yes"
  );

  const steps = fastPayload.TCEX_RQ_TestStepRun;
  assert.equal(steps[0].TCEX_RQ_TestStepRunOact?.Action, "Retrieve", "Step 1 must be DB Retrieve for Svvr piping");

  const refSelStep = steps.find(
    (s) =>
      s.TCEX_RQ_TestStepRunMfc?.QualifiedName ===
      "MenditectMxFrontendTestKit.ACT_SelectOption_ReferenceSelector_Select_By_Label"
  );
  assert.ok(refSelStep, "Must emit ACT_Select_Option_ReferenceSelector_By_Label");
  assert.equal(
    refSelStep.TCEX_RQ_TestStepRunMfc.TCEX_RQ_Svvr?.[0]?.TestStepRunKey_output,
    steps[0].Key,
    "ReferenceSelector label must be dynamically piped via TCEX_RQ_Svvr from Step 1 Retrieve"
  );

  const comboTriggers = steps.filter(
    (s) => s.TCEX_RQ_TestStepRunMfc?.QualifiedName === "MenditectMxFrontendTestKit.ACT_Click_ComboBox_Trigger"
  );
  assert.equal(comboTriggers.length, 2, "Law 3 ComboBox must emit 2 ACT_Trigger_ComboBox_Dropdown steps (open + close)");

  const galleryFilter = steps.find(
    (s) => s.TCEX_RQ_TestStepRunMfc?.QualifiedName === "MenditectMxFrontendTestKit.ELO_Filter_Gallery_Items_by_Text"
  );
  assert.ok(galleryFilter, "Law 2 Gallery must emit ELO_Filter_Gallery_Items_by_Text");

  const valLoc = steps.find(
    (s) =>
      s.TCEX_RQ_TestStepRunMfc?.QualifiedName ===
      "MenditectMxFrontendTestKit.Locate_MxWidget_DatePicker_ValidationMessage"
  );
  assert.ok(valLoc, "PAT-119 must emit Locate_MxWidget_DatePicker_ValidationMessage before visibility check");

  const lastTwo = steps.slice(-2);
  assert.equal(
    lastTwo[0].TCEX_RQ_TestStepRunMfc.QualifiedName,
    "MenditectMxFrontendTestKit.Stop_MxFrontendTest"
  );
  assert.equal(lastTwo[0].ExecutionCondition, "Always");
  assert.equal(lastTwo[1].TCEX_RQ_TestStepRunMfc.QualifiedName, "MenditectPlaywrightConnector.Teardown_Playwright");
  assert.equal(lastTwo[1].ExecutionCondition, "Always");

  // 5. Verify Mode 2 Trace Replay (`trace: true`)
  const tracePayload = compileFrontendRecipeToPluginPayload(complexRecipe, pageDesc, tier2Plan, {
    trace: true,
  });
  assert.equal(
    tracePayload.RollbackTcseAfterExecution,
    "No",
    "Trace mode (trace=true) must set RollbackTcseAfterExecution=No so TraceFile is flushed"
  );
  const traceOptStep = tracePayload.TCEX_RQ_TestStepRun.find(
    (s) =>
      s.TCEX_RQ_TestStepRunOact?.EntityQualifiedName ===
      "MenditectMxFrontendTestKit.StartMxFrontendTestOptions"
  );
  assert.ok(traceOptStep, "Trace mode must create StartMxFrontendTestOptions with Trace=true");

  // 6. Verify Manifest Recipe Synthesis
  const synthRecipes = synthesizeFrontendRecipesForManifest(
    {
      hypotheses: [
        {
          id: "HYP_UI_001",
          pattern_id: "BHP-32",
          title: "ReturnDate before PickupDate validation feedback",
          microflow: "CarRentalModule.ACT_Booking_Step1_Confirm",
          target_attribute: "CarRentalModule.Booking.ReturnDate",
          exposure_classification: "ACTUAL_UI_OR_API_REPRODUCIBLE",
          variation_overrides: {
            PickupDate: "2026-07-10T00:00:00.000Z",
            ReturnDate: "2026-07-05T00:00:00.000Z",
          },
        },
      ],
    },
    CAR_RENTAL_MOCK_BUNDLE
  );
  assert.equal(synthRecipes.length, 1, "Must synthesize 1 FrontendRecipe from page-bound hypothesis");
  assert.equal(synthRecipes[0].entryPage, "CarRentalModule.Booking_Step1_PeriodAndLocation");
  assert.equal(synthRecipes[0].testChannel, "FRONTEND_UI");
  assert.ok(synthRecipes[0].channelRationale && synthRecipes[0].channelRationale.length > 10);

  // 7. Verify MCP JSON-RPC Envelope Unwrapper (`unwrapMcpPluginResponse`)
  const wrappedResp = {
    jsonrpc: "2.0",
    id: 1,
    result: {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            Result: "Passed",
            TCEX_RP_TestCaseResult: {
              Result: "Passed",
              TCEX_RP_TestStepResult: [{ ObjectCount: 3 }],
            },
          }),
        },
      ],
    },
  };
  const unwrapped = unwrapMcpPluginResponse(wrappedResp);
  assert.equal(unwrapped.overallResult, "Passed", "unwrapMcpPluginResponse must unwrap result.content[0].text JSON");
  assert.equal(unwrapped.passed, true, "unwrapMcpPluginResponse must mark Passed as passed=true");
  assert.equal(
    unwrapped.stepResults[0].ObjectCount,
    3,
    "unwrapMcpPluginResponse must preserve inner ObjectCount"
  );

  // 8. Verify Legacy Table-Cell Widget Recovery (`extractTableCellWidgetsFromSource`)
  const samplePageSource = `page CarRentalModule.Booking_Create {
    Params: (Booking: CarRentalModule.Booking, Renter: CarRentalModule.Renter)
    DataView dataViewBooking ($Booking: CarRentalModule.Booking) {
      -- cell(0,1): Dropdown_SelectLocation
      -- cell(1,1): DatePicker_PickupDate
      -- cell(1,3): DatePicker_ReturnDate
      -- cell(0,1): Text_FullName
      -- cell(1,1): DatePicker_Birthdate
      -- cell(2,1): Text_Email
    }
  }`;
  const recoveredCellWidgets = extractTableCellWidgetsFromSource(
    samplePageSource,
    [
      "CarRentalModule.Location.PageName",
      "CarRentalModule.Booking.PickupDate",
      "CarRentalModule.Booking.ReturnDate",
      "CarRentalModule.Renter.Fullname",
      "CarRentalModule.Renter.Birthdate",
      "CarRentalModule.Renter.Email",
    ],
    [],
    [],
    ["CarRentalModule.Booking", "CarRentalModule.Renter"]
  );
  assert.equal(
    recoveredCellWidgets.length,
    6,
    "extractTableCellWidgetsFromSource must recover all 6 table-cell widgets"
  );
  assert.equal(
    recoveredCellWidgets.find((w) => w.WidgetName === "DatePicker_PickupDate")?.AttributeRef,
    "PickupDate"
  );

  // 9. Verify Gallery Parent-Page Entry Strategy (`ELO_Nth_Gallery_Item`)
  const galleryParentDesc = {
    ...pageDesc,
    entryStrategy: {
      mode: "PARENT_PAGE_BUTTON",
      parentPage: "CarRentalModule.Home_Renter",
      parentPageClass: "Home_Renter",
      triggerButton: "Button_BookThisCar",
      repeatingContainer: {
        type: "Gallery",
        name: "galleryCars",
        entity: "CarRentalModule.Car",
        useNthItem: 0,
      },
    },
  };
  const galleryEntryPayload = compileFrontendRecipeToPluginPayload(
    {
      entryPage: "CarRentalModule.Booking_Step1_PeriodAndLocation",
      pageClassName: "Booking_Step1_PeriodAndLocation",
      auth: { mode: "anonymous" },
      steps: [],
      assertions: [],
    },
    galleryParentDesc,
    tier1Plan,
    { trace: false }
  );
  const nthGalleryStep = galleryEntryPayload.TCEX_RQ_TestStepRun.find(
    (s) =>
      s.TCEX_RQ_TestStepRunMfc?.QualifiedName ===
      "MenditectMxFrontendTestKit.ELO_Nth_Gallery_Item"
  );
  assert.ok(
    nthGalleryStep,
    "PARENT_PAGE_BUTTON inside a Gallery must emit ELO_Nth_Gallery_Item before clicking the opener button"
  );

  // 10. Verify every TCEX_RQ_MicroflowParameter has explicit boolean UseEmptyObjectList (Jackson @NonNull invariant)
  for (const step of fastPayload.TCEX_RQ_TestStepRun) {
    for (const p of step.TCEX_RQ_TestStepRunMfc?.TCEX_RQ_MicroflowParameter || []) {
      assert.equal(
        typeof p.UseEmptyObjectList,
        "boolean",
        `Step #${step.SequenceNumber} parameter ${p.ParameterName} must have boolean UseEmptyObjectList`
      );
    }
  }

  // 11. Verify Law 2 Repeating Container fromDbAttr (`TCEX_RQ_Svvr`) and Assertion Scoping under itemLocKey
  const gallerySvvrPayload = compileFrontendRecipeToPluginPayload(
    {
      entryPage: "CarRentalModule.Home_Renter",
      pageClassName: "Home_Renter",
      auth: { mode: "anonymous" },
      steps: [
        {
          repeatingContainer: {
            type: "Gallery",
            name: "galleryCars",
            entity: "CarRentalModule.Car",
            fromDbAttr: "CarRentalModule.Car.LicensePlate",
          },
          widget: "Button_BookThisCar",
          widgetType: "Button",
          action: "click",
        },
      ],
      assertions: [
        {
          repeatingContainer: {
            type: "Gallery",
            name: "galleryCars",
            entity: "CarRentalModule.Car",
            fromDbAttr: "CarRentalModule.Car.LicensePlate",
          },
          widget: "Text_LicensePlate",
          widgetType: "TextBox",
          check: "validationVisible",
          expected: true,
        },
      ],
    },
    pageDesc,
    {
      dbRetrievesForCase2: [{ entity: "CarRentalModule.Car", displayAttribute: "LicensePlate", filterPrefix: null }],
    },
    { trace: false }
  );
  const galFilterSvvrStep = gallerySvvrPayload.TCEX_RQ_TestStepRun.find(
    (s) => s.TCEX_RQ_TestStepRunMfc?.QualifiedName === "MenditectMxFrontendTestKit.ELO_Filter_Gallery_Items_by_Text"
  );
  assert.ok(galFilterSvvrStep, "Law 2 fromDbAttr must emit ELO_Filter_Gallery_Items_by_Text");
  assert.equal(
    galFilterSvvrStep.TCEX_RQ_TestStepRunMfc?.TCEX_RQ_Svvr?.[0]?.TCEX_RQ_SvvrOutputAttribute?.Name,
    "LicensePlate",
    "Law 2 fromDbAttr must wire TCEX_RQ_Svvr output attribute LicensePlate into ELO_Filter_Gallery_Items_by_Text"
  );
  const asrTextBoxLocStep = gallerySvvrPayload.TCEX_RQ_TestStepRun.find(
    (s) => s.TCEX_RQ_TestStepRunMfc?.QualifiedName === "MenditectMxFrontendTestKit.Locate_MxWidget_TextBox"
  );
  assert.equal(
    asrTextBoxLocStep?.TCEX_RQ_TestStepRunMfc?.TCEX_RQ_Smpr?.[0]?.TCEX_RQ_SmprValueRun?.[0]?.TestStepRunKey_output,
    galFilterSvvrStep.Key,
    "Assertion widget inside a repeating container must bind ParentWidget to the filtered itemLocKey (not activePageLocKey)"
  );

  // 12. Verify unwrapMcpPluginResponse parses Markdown step failure summary from MTA_plugin
  const mdPluginResp = {
    result: {
      content: [
        {
          type: "text",
          text: `### Test Execution Summary: FAILED\n\n* **Step #1** (\`MicroflowCall\` - Key: \`1\`)\n  - **Result:** \`Success\`\n* **Step #5** (\`MicroflowCall\` - Key: \`5\`)\n  - **Result:** \`Failed\`\n  - **Description:** Strict mode violation: locator resolved to 8 elements`,
        },
      ],
    },
  };
  const unwrappedMd = unwrapMcpPluginResponse(mdPluginResp);
  assert.equal(unwrappedMd.passed, false);
  assert.equal(unwrappedMd.failedStep?.Key, 5, "unwrapMcpPluginResponse must extract failed step Key=5 from Markdown");
  assert.ok(
    unwrappedMd.errorMessage?.includes("Strict mode violation"),
    "unwrapMcpPluginResponse must extract failed step Description from Markdown"
  );

  return { passed: true, assertionsChecked: 33 };
}
