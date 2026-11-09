/**
 * Menditect Bug Hunter — Declarative Frontend Recipe Compiler (`recipe-compiler.mjs`)
 *
 * Pure compiler that translates a compact `FrontendRecipe` IR into a 100% schema-valid
 * `MTA_plugin.execute-testcase` JSON payload (`TCEX_RQ_TestStepRun`), enforcing:
 *  - Exact `MenditectMxFrontendTestKit` & `MenditectPlaywrightConnector` signatures from `testkit-catalog.json`
 *  - Law 1 (2-step standard widget chain), Law 2 (4-step repeating container chain), Law 3 (4-step ComboBox chain)
 *  - `TCEX_RQ_Smpr` object handle piping and `TCEX_RQ_Svvr` dynamic scalar attribute piping
 *  - `UseEmptyObjectList: true` on all unbound `Options` object parameters
 *  - Mandatory `Always` / `_Continue` browser teardown (`Stop_MxFrontendTest` + `Teardown_Playwright`)
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeWidgetType } from "./page-resolver.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CATALOG_PATH = path.join(__dirname, "testkit-catalog.json");
const TESTKIT_CATALOG = JSON.parse(fs.readFileSync(CATALOG_PATH, "utf8"));

export function getTestKitCatalog() {
  return TESTKIT_CATALOG;
}

function makeMfcStep({
  key,
  qualifiedName,
  parameters = [],
  smpr = [],
  svvr = [],
  returnType = { dataType: "VoidType", entity: null },
  executionCondition = "None",
  resumeOnException = "Stop",
}) {
  return {
    Key: key,
    SequenceNumber: key,
    TestStepRunType: "MicroflowCall",
    ExecutionCondition: executionCondition,
    ResumeExecutionAfterException: resumeOnException,
    ExecutionDelayInMs: 0,
    TCEX_RQ_TestStepRunMfc: {
      QualifiedName: qualifiedName,
      TCEX_RQ_MicroflowParameter: parameters.map((p) => ({
        UseEmptyObjectList: false,
        ...p,
      })),
      TCEX_RQ_MicroflowReturnType: {
        DataType: returnType.dataType || "VoidType",
        ...(returnType.entity ? { EntityQualifiedName: returnType.entity } : {}),
      },
      ...(smpr.length > 0 ? { TCEX_RQ_Smpr: smpr } : {}),
      ...(svvr.length > 0 ? { TCEX_RQ_Svvr: svvr } : {}),
    },
  };
}

/**
 * Compiles a `FrontendRecipe` + `PageTestDescriptor` + `DataProvisionPlan` into a complete
 * `MTA_plugin.execute-testcase` payload (`TC_02_Frontend_Action`).
 */
export function compileFrontendRecipeToPluginPayload(
  recipe,
  pageDescriptor,
  dataPlan = null,
  options = {}
) {
  const stepRuns = [];
  let seq = 1;
  const retrievedEntityKeys = new Map(); // entityQName -> stepKey
  const widgetLocatorKeys = new Map(); // widgetName -> { key, widgetType, returnEntity }
  const repeatingItemLocatorKeys = new Map(); // containerName -> itemLocKey
  let lastActiveRepeatingItemLocKey = null;

  const headless = options.headed === true ? "false" : "true";
  const enableTrace = Boolean(options.trace || recipe.enableTrace);

  // 1. Pre-browser DB Retrieve steps (`From_database`, `Head`) for `TCEX_RQ_Svvr` scalar piping
  for (const retSpec of dataPlan?.dbRetrievesForCase2 || []) {
    const retKey = seq++;
    retrievedEntityKeys.set(retSpec.entity, retKey);
    retrievedEntityKeys.set(retSpec.entity.split(".").pop(), retKey);

    stepRuns.push({
      Key: retKey,
      SequenceNumber: retKey,
      TestStepRunType: "Oact",
      ExecutionCondition: "Always",
      ResumeExecutionAfterException: "Stop",
      ExecutionDelayInMs: 0,
      TCEX_RQ_TestStepRunOact: {
        Action: "Retrieve",
        EntityQualifiedName: retSpec.entity,
        RetrieveOption: "From_database",
        RetrieveSet: "Head",
        ...(retSpec.filterPrefix
          ? {
              TCEX_RQ_EntityValueRun: {
                TCEX_RQ_AttributeValueRun: [
                  {
                    AttributeName: retSpec.displayAttribute || "Name",
                    DataType: "StringType_limited",
                    FilterCompareType: "Contains",
                    Value: retSpec.filterPrefix,
                  },
                ],
              },
            }
          : {}),
      },
    });
  }

  // 2. Start_Frontend_Test_Locally -> returns `Browser`
  const startLocalSpec = TESTKIT_CATALOG.lifecycle.Start_Frontend_Test_Locally;
  const browserStepKey = seq++;
  stepRuns.push(
    makeMfcStep({
      key: browserStepKey,
      qualifiedName: startLocalSpec.qualifiedName,
      executionCondition: "Always",
      resumeOnException: "Stop",
      parameters: [
        {
          ParameterName: "BrowserType",
          DataType: "EnumType",
          TCEX_RQ_MicroflowParameterValueRun: [{ Value: options.browserType || "Chromium" }],
        },
        {
          ParameterName: "Headless",
          DataType: "BooleanType",
          TCEX_RQ_MicroflowParameterValueRun: [{ Value: headless }],
        },
        {
          ParameterName: "Options",
          DataType: "ObjectType",
          EntityQualifiedName: "MenditectPlaywrightConnector.LocalStartOptions",
          UseEmptyObjectList: true,
        },
      ],
      returnType: startLocalSpec.returnType,
    })
  );

  // 3. Optional `StartMxFrontendTestOptions` when `enableTrace == true`
  let startOptionsStepKey = null;
  if (enableTrace) {
    startOptionsStepKey = seq++;
    stepRuns.push({
      Key: startOptionsStepKey,
      SequenceNumber: startOptionsStepKey,
      TestStepRunType: "Oact",
      ExecutionCondition: "Always",
      ResumeExecutionAfterException: "Stop",
      ExecutionDelayInMs: 0,
      TCEX_RQ_TestStepRunOact: {
        Action: "Create",
        EntityQualifiedName: "MenditectMxFrontendTestKit.StartMxFrontendTestOptions",
        RetrieveOption: "From_database",
        RetrieveSet: "Head",
        TCEX_RQ_EntityValueRun: {
          TCEX_RQ_AttributeValueRun: [
            { AttributeName: "Trace", DataType: "BooleanType", Value: "true" },
          ],
        },
      },
    });
  }

  // 4. Start_MxFrontend_Test_Without_Login or Start_MxFrontend_Test_With_Login -> returns `Page`
  const authMode = recipe.auth?.mode || "anonymous";
  const pageStepKey = seq++;
  const appUrl = recipe.appUrl || options.appUrl || "http://localhost:8080";

  if (authMode === "login" && recipe.auth?.username) {
    const loginSpec = TESTKIT_CATALOG.lifecycle.Start_MxFrontend_Test_With_Login;
    const smpr = [
      {
        ParameterName: "Browser",
        DataType: "ObjectType",
        EntityQualifiedName: "MenditectPlaywrightConnector.Browser",
        TCEX_RQ_SmprValueRun: [{ TestStepRunKey_output: browserStepKey }],
      },
    ];
    if (startOptionsStepKey) {
      smpr.push({
        ParameterName: "Options",
        DataType: "ObjectType",
        EntityQualifiedName: "MenditectMxFrontendTestKit.StartMxFrontendTestOptions",
        TCEX_RQ_SmprValueRun: [{ TestStepRunKey_output: startOptionsStepKey }],
      });
    }
    stepRuns.push(
      makeMfcStep({
        key: pageStepKey,
        qualifiedName: loginSpec.qualifiedName,
        executionCondition: "Always",
        resumeOnException: "Stop",
        parameters: [
          {
            ParameterName: "Browser",
            DataType: "ObjectType",
            EntityQualifiedName: "MenditectPlaywrightConnector.Browser",
            UseEmptyObjectList: false,
          },
          {
            ParameterName: "Login_URL",
            DataType: "StringType",
            TCEX_RQ_MicroflowParameterValueRun: [{ Value: appUrl }],
          },
          {
            ParameterName: "Username",
            DataType: "StringType",
            TCEX_RQ_MicroflowParameterValueRun: [{ Value: String(recipe.auth.username) }],
          },
          {
            ParameterName: "Password",
            DataType: "StringType",
            TCEX_RQ_MicroflowParameterValueRun: [{ Value: String(recipe.auth.password ?? "") }],
          },
          {
            ParameterName: "Options",
            DataType: "ObjectType",
            EntityQualifiedName: "MenditectMxFrontendTestKit.StartMxFrontendTestOptions",
            UseEmptyObjectList: !startOptionsStepKey,
          },
        ],
        smpr,
        returnType: loginSpec.returnType,
      })
    );
  } else {
    const anonSpec = TESTKIT_CATALOG.lifecycle.Start_MxFrontend_Test_Without_Login;
    const smpr = [
      {
        ParameterName: "Browser",
        DataType: "ObjectType",
        EntityQualifiedName: "MenditectPlaywrightConnector.Browser",
        TCEX_RQ_SmprValueRun: [{ TestStepRunKey_output: browserStepKey }],
      },
    ];
    if (startOptionsStepKey) {
      smpr.push({
        ParameterName: "Options",
        DataType: "ObjectType",
        EntityQualifiedName: "MenditectMxFrontendTestKit.StartMxFrontendTestOptions",
        TCEX_RQ_SmprValueRun: [{ TestStepRunKey_output: startOptionsStepKey }],
      });
    }
    stepRuns.push(
      makeMfcStep({
        key: pageStepKey,
        qualifiedName: anonSpec.qualifiedName,
        executionCondition: "Always",
        resumeOnException: "Stop",
        parameters: [
          {
            ParameterName: "Browser",
            DataType: "ObjectType",
            EntityQualifiedName: "MenditectPlaywrightConnector.Browser",
            UseEmptyObjectList: false,
          },
          {
            ParameterName: "Mendix_URL",
            DataType: "StringType",
            TCEX_RQ_MicroflowParameterValueRun: [{ Value: appUrl }],
          },
          {
            ParameterName: "Options",
            DataType: "ObjectType",
            EntityQualifiedName: "MenditectMxFrontendTestKit.StartMxFrontendTestOptions",
            UseEmptyObjectList: !startOptionsStepKey,
          },
        ],
        smpr,
        returnType: anonSpec.returnType,
      })
    );
  }

  // 5. Optional Parent Page Entry Navigation (when target page is a popup opened via a Home Page button)
  const entryStrategy = recipe.entryStrategy || pageDescriptor?.entryStrategy || { mode: "DIRECT_PAGE" };
  if (entryStrategy.mode === "PARENT_PAGE_BUTTON" && entryStrategy.parentPageClass && entryStrategy.triggerButton) {
    const parentPageLocKey = seq++;
    stepRuns.push(
      makeMfcStep({
        key: parentPageLocKey,
        qualifiedName: TESTKIT_CATALOG.pageLocator.Locate_MxPage.qualifiedName,
        parameters: [
          {
            ParameterName: "PageClassName",
            DataType: "StringType",
            TCEX_RQ_MicroflowParameterValueRun: [{ Value: entryStrategy.parentPageClass }],
          },
          {
            ParameterName: "Page",
            DataType: "ObjectType",
            EntityQualifiedName: "MenditectPlaywrightConnector.Page",
            UseEmptyObjectList: false,
          },
          {
            ParameterName: "Options",
            DataType: "ObjectType",
            EntityQualifiedName: "MenditectMxFrontendTestKit.LocateMxPageOptions",
            UseEmptyObjectList: true,
          },
        ],
        smpr: [
          {
            ParameterName: "Page",
            DataType: "ObjectType",
            EntityQualifiedName: "MenditectPlaywrightConnector.Page",
            TCEX_RQ_SmprValueRun: [{ TestStepRunKey_output: pageStepKey }],
          },
        ],
        returnType: TESTKIT_CATALOG.pageLocator.Locate_MxPage.returnType,
      })
    );

    let triggerParentKey = parentPageLocKey;

    if (entryStrategy.repeatingContainer?.name) {
      const rcType = normalizeWidgetType(
        entryStrategy.repeatingContainer.type || "Gallery",
        entryStrategy.repeatingContainer.name
      );
      const rcCat = TESTKIT_CATALOG.repeatingContainers[rcType] || TESTKIT_CATALOG.repeatingContainers.Gallery;

      const parentContLocKey = seq++;
      stepRuns.push(
        makeMfcStep({
          key: parentContLocKey,
          qualifiedName: rcCat.locator.qualifiedName,
          parameters: [
            {
              ParameterName: "WidgetName",
              DataType: "StringType",
              TCEX_RQ_MicroflowParameterValueRun: [{ Value: entryStrategy.repeatingContainer.name }],
            },
            {
              ParameterName: "ParentWidget",
              DataType: "ObjectType",
              EntityQualifiedName: "MenditectMxFrontendTestKit.MxParentWidgetLocator",
              UseEmptyObjectList: false,
            },
            {
              ParameterName: "Options",
              DataType: "ObjectType",
              EntityQualifiedName: rcCat.locator.optionsEntity,
              UseEmptyObjectList: true,
            },
          ],
          smpr: [
            {
              ParameterName: "ParentWidget",
              DataType: "ObjectType",
              EntityQualifiedName: "MenditectMxFrontendTestKit.MxParentWidgetLocator",
              TCEX_RQ_SmprValueRun: [{ TestStepRunKey_output: parentPageLocKey }],
            },
          ],
          returnType: { dataType: "ObjectType", entity: rcCat.locator.returnEntity },
        })
      );

      const parentItemLocKey = seq++;
      if (!entryStrategy.repeatingContainer.filterText && rcCat.nthItem) {
        const nthSpec = rcCat.nthItem;
        stepRuns.push(
          makeMfcStep({
            key: parentItemLocKey,
            qualifiedName: nthSpec.qualifiedName,
            parameters: [
              {
                ParameterName: nthSpec.containerParam,
                DataType: "ObjectType",
                EntityQualifiedName: rcCat.locator.returnEntity,
                UseEmptyObjectList: false,
              },
              {
                ParameterName: nthSpec.indexParam,
                DataType: "IntegerType",
                TCEX_RQ_MicroflowParameterValueRun: [
                  { Value: String(entryStrategy.repeatingContainer.useNthItem ?? 0) },
                ],
              },
              ...nthSpec.optionsParams.map((op) => ({
                ParameterName: op.name,
                DataType: "ObjectType",
                EntityQualifiedName: op.entity,
                UseEmptyObjectList: true,
              })),
            ],
            smpr: [
              {
                ParameterName: nthSpec.containerParam,
                DataType: "ObjectType",
                EntityQualifiedName: rcCat.locator.returnEntity,
                TCEX_RQ_SmprValueRun: [{ TestStepRunKey_output: parentContLocKey }],
              },
            ],
            returnType: { dataType: "ObjectType", entity: nthSpec.returnEntity },
          })
        );
      } else {
        const filterSpec = rcCat.filterByText;
        stepRuns.push(
          makeMfcStep({
            key: parentItemLocKey,
            qualifiedName: filterSpec.qualifiedName,
            parameters: [
              {
                ParameterName: filterSpec.containerParam,
                DataType: "ObjectType",
                EntityQualifiedName: rcCat.locator.returnEntity,
                UseEmptyObjectList: false,
              },
              {
                ParameterName: filterSpec.textParam,
                DataType: "StringType",
                TCEX_RQ_MicroflowParameterValueRun: [
                  { Value: String(entryStrategy.repeatingContainer.filterText || "") },
                ],
              },
              ...filterSpec.optionsParams.map((op) => ({
                ParameterName: op.name,
                DataType: "ObjectType",
                EntityQualifiedName: op.entity,
                UseEmptyObjectList: true,
              })),
            ],
            smpr: [
              {
                ParameterName: filterSpec.containerParam,
                DataType: "ObjectType",
                EntityQualifiedName: rcCat.locator.returnEntity,
                TCEX_RQ_SmprValueRun: [{ TestStepRunKey_output: parentContLocKey }],
              },
            ],
            returnType: { dataType: "ObjectType", entity: filterSpec.returnEntity },
          })
        );
      }
      triggerParentKey = parentItemLocKey;
    }

    const openBtnLocKey = seq++;
    const btnCat = TESTKIT_CATALOG.widgets.Button;
    stepRuns.push(
      makeMfcStep({
        key: openBtnLocKey,
        qualifiedName: btnCat.locator.qualifiedName,
        parameters: [
          {
            ParameterName: "WidgetName",
            DataType: "StringType",
            TCEX_RQ_MicroflowParameterValueRun: [{ Value: entryStrategy.triggerButton }],
          },
          {
            ParameterName: "ParentWidget",
            DataType: "ObjectType",
            EntityQualifiedName: "MenditectMxFrontendTestKit.MxParentWidgetLocator",
            UseEmptyObjectList: false,
          },
          {
            ParameterName: "Options",
            DataType: "ObjectType",
            EntityQualifiedName: btnCat.locator.optionsEntity,
            UseEmptyObjectList: true,
          },
        ],
        smpr: [
          {
            ParameterName: "ParentWidget",
            DataType: "ObjectType",
            EntityQualifiedName: "MenditectMxFrontendTestKit.MxParentWidgetLocator",
            TCEX_RQ_SmprValueRun: [{ TestStepRunKey_output: triggerParentKey }],
          },
        ],
        returnType: { dataType: "ObjectType", entity: btnCat.locator.returnEntity },
      })
    );

    const openClickKey = seq++;
    stepRuns.push(
      makeMfcStep({
        key: openClickKey,
        qualifiedName: btnCat.actions.click.qualifiedName,
        parameters: [
          {
            ParameterName: "MxButtonLocator",
            DataType: "ObjectType",
            EntityQualifiedName: btnCat.locator.returnEntity,
            UseEmptyObjectList: false,
          },
          {
            ParameterName: "Options",
            DataType: "ObjectType",
            EntityQualifiedName: "MenditectMxFrontendTestKit.ButtonClickOptions",
            UseEmptyObjectList: true,
          },
        ],
        smpr: [
          {
            ParameterName: "MxButtonLocator",
            DataType: "ObjectType",
            EntityQualifiedName: btnCat.locator.returnEntity,
            TCEX_RQ_SmprValueRun: [{ TestStepRunKey_output: openBtnLocKey }],
          },
        ],
        returnType: { dataType: "VoidType", entity: null },
      })
    );
  }

  // 6. Locate target Mendix page -> returns `MxPageLocator`
  const pageClassName =
    recipe.pageClassName ||
    pageDescriptor?.pageClassName ||
    (recipe.entryPage ? recipe.entryPage.split(".").pop() : "Home");
  const activePageLocKey = seq++;
  stepRuns.push(
    makeMfcStep({
      key: activePageLocKey,
      qualifiedName: TESTKIT_CATALOG.pageLocator.Locate_MxPage.qualifiedName,
      parameters: [
        {
          ParameterName: "PageClassName",
          DataType: "StringType",
          TCEX_RQ_MicroflowParameterValueRun: [{ Value: pageClassName }],
        },
        {
          ParameterName: "Page",
          DataType: "ObjectType",
          EntityQualifiedName: "MenditectPlaywrightConnector.Page",
          UseEmptyObjectList: false,
        },
        {
          ParameterName: "Options",
          DataType: "ObjectType",
          EntityQualifiedName: "MenditectMxFrontendTestKit.LocateMxPageOptions",
          UseEmptyObjectList: true,
        },
      ],
      smpr: [
        {
          ParameterName: "Page",
          DataType: "ObjectType",
          EntityQualifiedName: "MenditectPlaywrightConnector.Page",
          TCEX_RQ_SmprValueRun: [{ TestStepRunKey_output: pageStepKey }],
        },
      ],
      returnType: TESTKIT_CATALOG.pageLocator.Locate_MxPage.returnType,
    })
  );

  // Helper to emit a Law 1 Widget Locator step (or reuse if already located)
  function emitWidgetLocator(widgetName, rawWidgetType, parentKey = activePageLocKey) {
    const wMeta = pageDescriptor?.widgets?.get(widgetName);
    const wType = normalizeWidgetType(rawWidgetType || wMeta?.widgetType, widgetName);
    const wCat = TESTKIT_CATALOG.widgets[wType] || TESTKIT_CATALOG.widgets.TextBox;
    const locKey = seq++;

    stepRuns.push(
      makeMfcStep({
        key: locKey,
        qualifiedName: wCat.locator.qualifiedName,
        parameters: [
          {
            ParameterName: "WidgetName",
            DataType: "StringType",
            TCEX_RQ_MicroflowParameterValueRun: [{ Value: widgetName }],
          },
          {
            ParameterName: "ParentWidget",
            DataType: "ObjectType",
            EntityQualifiedName: "MenditectMxFrontendTestKit.MxParentWidgetLocator",
            UseEmptyObjectList: false,
          },
          {
            ParameterName: "Options",
            DataType: "ObjectType",
            EntityQualifiedName: wCat.locator.optionsEntity,
            UseEmptyObjectList: true,
          },
        ],
        smpr: [
          {
            ParameterName: "ParentWidget",
            DataType: "ObjectType",
            EntityQualifiedName: "MenditectMxFrontendTestKit.MxParentWidgetLocator",
            TCEX_RQ_SmprValueRun: [{ TestStepRunKey_output: parentKey }],
          },
        ],
        returnType: { dataType: "ObjectType", entity: wCat.locator.returnEntity },
      })
    );

    const info = { key: locKey, widgetType: wType, returnEntity: wCat.locator.returnEntity, wMeta };
    widgetLocatorKeys.set(widgetName, info);
    return info;
  }

  // Helper to emit (or reuse) a Law 2 Repeating Container + ELO Filter/NthItem step pair (`PAT-52`)
  function emitRepeatingItemLocator(rcSpec, parentKey = activePageLocKey) {
    const rcType = normalizeWidgetType(rcSpec.type || "Gallery", rcSpec.name);
    const rcCat = TESTKIT_CATALOG.repeatingContainers[rcType] || TESTKIT_CATALOG.repeatingContainers.Gallery;
    const cacheId = `${parentKey}::${rcSpec.name}::${rcSpec.fromDbAttr || ""}::${rcSpec.filterText || ""}::${rcSpec.useNthItem ?? ""}`;
    if (repeatingItemLocatorKeys.has(cacheId)) {
      const existing = repeatingItemLocatorKeys.get(cacheId);
      lastActiveRepeatingItemLocKey = existing.itemLocKey;
      return existing;
    }

    // Step 2a: Locate Parent Container
    const contLocKey = seq++;
    stepRuns.push(
      makeMfcStep({
        key: contLocKey,
        qualifiedName: rcCat.locator.qualifiedName,
        parameters: [
          {
            ParameterName: "WidgetName",
            DataType: "StringType",
            TCEX_RQ_MicroflowParameterValueRun: [{ Value: rcSpec.name }],
          },
          {
            ParameterName: "ParentWidget",
            DataType: "ObjectType",
            EntityQualifiedName: "MenditectMxFrontendTestKit.MxParentWidgetLocator",
            UseEmptyObjectList: false,
          },
          {
            ParameterName: "Options",
            DataType: "ObjectType",
            EntityQualifiedName: rcCat.locator.optionsEntity,
            UseEmptyObjectList: true,
          },
        ],
        smpr: [
          {
            ParameterName: "ParentWidget",
            DataType: "ObjectType",
            EntityQualifiedName: "MenditectMxFrontendTestKit.MxParentWidgetLocator",
            TCEX_RQ_SmprValueRun: [{ TestStepRunKey_output: parentKey }],
          },
        ],
        returnType: { dataType: "ObjectType", entity: rcCat.locator.returnEntity },
      })
    );

    // Step 2b: Apply ELO Filter (either `fromDbAttr` via `TCEX_RQ_Svvr`, static `filterText`, or `nthItem`)
    const itemLocKey = seq++;
    const hasFilterText = Boolean(rcSpec.filterText && String(rcSpec.filterText).trim() !== "");
    const hasFromDbAttr = Boolean(rcSpec.fromDbAttr);

    if (!hasFilterText && !hasFromDbAttr && rcCat.nthItem) {
      const nthSpec = rcCat.nthItem;
      stepRuns.push(
        makeMfcStep({
          key: itemLocKey,
          qualifiedName: nthSpec.qualifiedName,
          parameters: [
            {
              ParameterName: nthSpec.containerParam,
              DataType: "ObjectType",
              EntityQualifiedName: rcCat.locator.returnEntity,
              UseEmptyObjectList: false,
            },
            {
              ParameterName: nthSpec.indexParam,
              DataType: "IntegerType",
              TCEX_RQ_MicroflowParameterValueRun: [
                { Value: String(rcSpec.useNthItem ?? 0) },
              ],
            },
            ...nthSpec.optionsParams.map((op) => ({
              ParameterName: op.name,
              DataType: "ObjectType",
              EntityQualifiedName: op.entity,
              UseEmptyObjectList: true,
            })),
          ],
          smpr: [
            {
              ParameterName: nthSpec.containerParam,
              DataType: "ObjectType",
              EntityQualifiedName: rcCat.locator.returnEntity,
              TCEX_RQ_SmprValueRun: [{ TestStepRunKey_output: contLocKey }],
            },
          ],
          returnType: { dataType: "ObjectType", entity: nthSpec.returnEntity },
        })
      );
      const res = { contLocKey, itemLocKey, rcCat, returnEntity: nthSpec.returnEntity };
      repeatingItemLocatorKeys.set(cacheId, res);
      repeatingItemLocatorKeys.set(rcSpec.name, res);
      lastActiveRepeatingItemLocKey = itemLocKey;
      return res;
    }

    const filterSpec = rcCat.filterByText;
    const svvr = [];
    if (hasFromDbAttr) {
      const parts = String(rcSpec.fromDbAttr).split(".");
      const entQName = parts.length >= 3 ? `${parts[0]}.${parts[1]}` : parts[0];
      const attrName = parts[parts.length - 1];
      const retKey = retrievedEntityKeys.get(entQName) || retrievedEntityKeys.get(entQName.split(".").pop());
      if (retKey) {
        svvr.push({
          InputElementType: "MPVR",
          OutputElementType: "Attribute",
          TestStepRunCategory_output: "Oact",
          TestStepRunKey_output: retKey,
          TCEX_RQ_SvvrInputMicroflowParameterValueRun: {
            DataType: "StringType",
            Name: filterSpec.textParam,
          },
          TCEX_RQ_SvvrOutputAttribute: {
            DataType: "StringType_limited",
            Name: attrName,
          },
        });
      }
    }

    const filterParams = [
      {
        ParameterName: filterSpec.containerParam,
        DataType: "ObjectType",
        EntityQualifiedName: rcCat.locator.returnEntity,
        UseEmptyObjectList: false,
      },
      {
        ParameterName: filterSpec.textParam,
        DataType: "StringType",
        TCEX_RQ_MicroflowParameterValueRun: [{ Value: String(rcSpec.filterText || "") }],
      },
      ...filterSpec.optionsParams.map((op) => ({
        ParameterName: op.name,
        DataType: "ObjectType",
        EntityQualifiedName: op.entity,
        UseEmptyObjectList: true,
      })),
    ];
    stepRuns.push(
      makeMfcStep({
        key: itemLocKey,
        qualifiedName: filterSpec.qualifiedName,
        parameters: filterParams,
        smpr: [
          {
            ParameterName: filterSpec.containerParam,
            DataType: "ObjectType",
            EntityQualifiedName: rcCat.locator.returnEntity,
            TCEX_RQ_SmprValueRun: [{ TestStepRunKey_output: contLocKey }],
          },
        ],
        svvr,
        returnType: { dataType: "ObjectType", entity: filterSpec.returnEntity },
      })
    );

    const res = { contLocKey, itemLocKey, rcCat, returnEntity: filterSpec.returnEntity };
    repeatingItemLocatorKeys.set(cacheId, res);
    repeatingItemLocatorKeys.set(rcSpec.name, res);
    lastActiveRepeatingItemLocKey = itemLocKey;
    return res;
  }

  // 7. Compile Recipe Steps (Law 1, Law 2 Repeating Containers, Law 3 ComboBox)
  for (const step of recipe.steps || []) {
    const wMetaForStep = step.widget ? pageDescriptor?.widgets?.get(step.widget) : null;
    const effectiveRc = step.repeatingContainer || wMetaForStep?.enclosingRepeatingContainer || null;

    // Law 2: Repeating Container (4-step chain: Locate Container -> ELO Filter -> Locate Child -> Action)
    if (effectiveRc) {
      const { itemLocKey, rcCat, returnEntity: itemReturnEntity } = emitRepeatingItemLocator(
        effectiveRc,
        activePageLocKey
      );

      // Step 2c & 2d: Either click the item directly or locate nested child widget & act
      if (!step.widget) {
        const clickItemKey = seq++;
        stepRuns.push(
          makeMfcStep({
            key: clickItemKey,
            qualifiedName: rcCat.clickItem.qualifiedName,
            parameters: [
              {
                ParameterName: rcCat.clickItem.locatorParam,
                DataType: "ObjectType",
                EntityQualifiedName: itemReturnEntity,
                UseEmptyObjectList: false,
              },
              ...rcCat.clickItem.optionsParams.map((op) => ({
                ParameterName: op.name,
                DataType: "ObjectType",
                EntityQualifiedName: op.entity,
                UseEmptyObjectList: true,
              })),
            ],
            smpr: [
              {
                ParameterName: rcCat.clickItem.locatorParam,
                DataType: "ObjectType",
                EntityQualifiedName: itemReturnEntity,
                TCEX_RQ_SmprValueRun: [{ TestStepRunKey_output: itemLocKey }],
              },
            ],
            returnType: { dataType: "VoidType", entity: null },
          })
        );
        continue;
      }

      const nestedLoc = emitWidgetLocator(step.widget, step.widgetType, itemLocKey);
      const nestedCat = TESTKIT_CATALOG.widgets[nestedLoc.widgetType] || TESTKIT_CATALOG.widgets.Button;
      const defaultAct =
        nestedLoc.widgetType === "Button"
          ? "click"
          : nestedLoc.widgetType === "ReferenceSelector" || nestedLoc.widgetType === "DropDown"
            ? "selectOption"
            : nestedLoc.widgetType === "CheckBox"
              ? "check"
              : "fill";
      const actSpec = nestedCat.actions[step.action || defaultAct] || Object.values(nestedCat.actions)[0];
      const actKey = seq++;
      const svvr = [];
      const valueParams = (actSpec.valueParams || []).map((vp) => {
        if (step.fromDbAttr) {
          const parts = step.fromDbAttr.split(".");
          const entQName = parts.length >= 3 ? `${parts[0]}.${parts[1]}` : parts[0];
          const attrName = parts[parts.length - 1];
          const retKey = retrievedEntityKeys.get(entQName) || retrievedEntityKeys.get(entQName.split(".").pop());
          if (retKey) {
            svvr.push({
              InputElementType: "MPVR",
              OutputElementType: "Attribute",
              TestStepRunCategory_output: "Oact",
              TestStepRunKey_output: retKey,
              TCEX_RQ_SvvrInputMicroflowParameterValueRun: {
                DataType: vp.dataType,
                Name: vp.name,
              },
              TCEX_RQ_SvvrOutputAttribute: {
                DataType: "StringType_limited",
                Name: attrName,
              },
            });
          }
        }
        return {
          ParameterName: vp.name,
          DataType: vp.dataType,
          TCEX_RQ_MicroflowParameterValueRun: [{ Value: String(step.value ?? "") }],
        };
      });
      stepRuns.push(
        makeMfcStep({
          key: actKey,
          qualifiedName: actSpec.qualifiedName,
          parameters: [
            {
              ParameterName: actSpec.locatorParam,
              DataType: "ObjectType",
              EntityQualifiedName: nestedLoc.returnEntity,
              UseEmptyObjectList: false,
            },
            ...valueParams,
            ...(actSpec.optionsParams || []).map((op) => ({
              ParameterName: op.name,
              DataType: "ObjectType",
              EntityQualifiedName: op.entity,
              UseEmptyObjectList: true,
            })),
          ],
          smpr: [
            {
              ParameterName: actSpec.locatorParam,
              DataType: "ObjectType",
              EntityQualifiedName: nestedLoc.returnEntity,
              TCEX_RQ_SmprValueRun: [{ TestStepRunKey_output: nestedLoc.key }],
            },
          ],
          svvr,
          returnType: { dataType: actSpec.returnType || "VoidType", entity: null },
        })
      );
      continue;
    }

    const locInfo = emitWidgetLocator(step.widget, step.widgetType, activePageLocKey);
    const wCat = TESTKIT_CATALOG.widgets[locInfo.widgetType] || TESTKIT_CATALOG.widgets.TextBox;

    // Law 3: ComboBox 4-Step Open-Fill-Close Sequence (`Locate -> Trigger -> Fill -> Trigger`)
    if (locInfo.widgetType === "ComboBox") {
      const trigSpec = wCat.actions.trigger;
      const fillSpec = wCat.actions.fill;
      const openKey = seq++;
      const fillKey = seq++;
      const closeKey = seq++;

      const makeTriggerStep = (k) =>
        makeMfcStep({
          key: k,
          qualifiedName: trigSpec.qualifiedName,
          parameters: [
            {
              ParameterName: trigSpec.locatorParam,
              DataType: "ObjectType",
              EntityQualifiedName: locInfo.returnEntity,
              UseEmptyObjectList: false,
            },
            ...trigSpec.optionsParams.map((op) => ({
              ParameterName: op.name,
              DataType: "ObjectType",
              EntityQualifiedName: op.entity,
              UseEmptyObjectList: true,
            })),
          ],
          smpr: [
            {
              ParameterName: trigSpec.locatorParam,
              DataType: "ObjectType",
              EntityQualifiedName: locInfo.returnEntity,
              TCEX_RQ_SmprValueRun: [{ TestStepRunKey_output: locInfo.key }],
            },
          ],
          returnType: { dataType: "VoidType", entity: null },
        });

      stepRuns.push(makeTriggerStep(openKey));
      stepRuns.push(
        makeMfcStep({
          key: fillKey,
          qualifiedName: fillSpec.qualifiedName,
          parameters: [
            {
              ParameterName: fillSpec.locatorParam,
              DataType: "ObjectType",
              EntityQualifiedName: locInfo.returnEntity,
              UseEmptyObjectList: false,
            },
            {
              ParameterName: "Value",
              DataType: "StringType",
              TCEX_RQ_MicroflowParameterValueRun: [{ Value: String(step.value ?? "") }],
            },
          ],
          smpr: [
            {
              ParameterName: fillSpec.locatorParam,
              DataType: "ObjectType",
              EntityQualifiedName: locInfo.returnEntity,
              TCEX_RQ_SmprValueRun: [{ TestStepRunKey_output: locInfo.key }],
            },
          ],
          returnType: { dataType: "VoidType", entity: null },
        })
      );
      stepRuns.push(makeTriggerStep(closeKey));
      continue;
    }

    // Law 1: Standard 2-Step Widget Chain (`Locate_MxWidget_* -> ACT_*`)
    const actionKey = step.action || Object.keys(wCat.actions || {})[0] || "fill";
    const actSpec = wCat.actions?.[actionKey] || Object.values(wCat.actions || {})[0];
    if (!actSpec) continue;

    const actStepKey = seq++;
    const svvr = [];
    const valueParams = (actSpec.valueParams || []).map((vp) => {
      if (vp.name === "Format") {
        const fmt = step.format || locInfo.wMeta?.dateFormat || vp.defaultValue || "dd-MM-yyyy";
        return {
          ParameterName: vp.name,
          DataType: vp.dataType,
          TCEX_RQ_MicroflowParameterValueRun: [{ Value: fmt }],
        };
      }
      if (vp.name === "UTC") {
        return {
          ParameterName: vp.name,
          DataType: vp.dataType,
          TCEX_RQ_MicroflowParameterValueRun: [{ Value: String(step.utc ?? vp.defaultValue ?? "false") }],
        };
      }
      // Check if value is dynamically piped via `TCEX_RQ_Svvr` from an earlier Retrieve step (`PAT-32`)
      if (step.fromDbAttr) {
        const parts = step.fromDbAttr.split(".");
        const entQName = parts.length >= 3 ? `${parts[0]}.${parts[1]}` : parts[0];
        const attrName = parts[parts.length - 1];
        const retKey = retrievedEntityKeys.get(entQName) || retrievedEntityKeys.get(entQName.split(".").pop());
        if (retKey) {
          svvr.push({
            InputElementType: "MPVR",
            OutputElementType: "Attribute",
            TestStepRunCategory_output: "Oact",
            TestStepRunKey_output: retKey,
            TCEX_RQ_SvvrInputMicroflowParameterValueRun: {
              DataType: vp.dataType,
              Name: vp.name,
            },
            TCEX_RQ_SvvrOutputAttribute: {
              DataType: "StringType_limited",
              Name: attrName,
            },
          });
        }
      }
      return {
        ParameterName: vp.name,
        DataType: vp.dataType,
        TCEX_RQ_MicroflowParameterValueRun: [{ Value: String(step.value ?? "") }],
      };
    });

    stepRuns.push(
      makeMfcStep({
        key: actStepKey,
        qualifiedName: actSpec.qualifiedName,
        parameters: [
          {
            ParameterName: actSpec.locatorParam,
            DataType: "ObjectType",
            EntityQualifiedName: locInfo.returnEntity,
            UseEmptyObjectList: false,
          },
          ...valueParams,
          ...(actSpec.optionsParams || []).map((op) => ({
            ParameterName: op.name,
            DataType: "ObjectType",
            EntityQualifiedName: op.entity,
            UseEmptyObjectList: true,
          })),
        ],
        smpr: [
          {
            ParameterName: actSpec.locatorParam,
            DataType: "ObjectType",
            EntityQualifiedName: locInfo.returnEntity,
            TCEX_RQ_SmprValueRun: [{ TestStepRunKey_output: locInfo.key }],
          },
        ],
        svvr,
        returnType: { dataType: actSpec.returnType || "VoidType", entity: null },
      })
    );
  }

  // 8. Compile Assertions (`PAT-119` Post-Submit Validation Feedback & Widget State Checks)
  for (const asr of recipe.assertions || []) {
    const asrWidgetMeta = pageDescriptor?.widgets?.get(asr.widget);
    const asrRc = asr.repeatingContainer || asrWidgetMeta?.enclosingRepeatingContainer || null;
    let parentKeyForAsr = activePageLocKey;
    if (asrRc) {
      const existingRc = repeatingItemLocatorKeys.get(asrRc.name);
      if (existingRc) {
        parentKeyForAsr = existingRc.itemLocKey;
      } else {
        const emittedRc = emitRepeatingItemLocator(asrRc, activePageLocKey);
        parentKeyForAsr = emittedRc.itemLocKey;
      }
    } else if (lastActiveRepeatingItemLocKey && asrWidgetMeta?.inRepeatingContainer) {
      parentKeyForAsr = lastActiveRepeatingItemLocKey;
    }
    const locInfo =
      widgetLocatorKeys.get(asr.widget) ||
      emitWidgetLocator(asr.widget, asr.widgetType, parentKeyForAsr);
    const wCat = TESTKIT_CATALOG.widgets[locInfo.widgetType] || TESTKIT_CATALOG.widgets.TextBox;

    if (asr.check === "validationVisible" || asr.check === "validationHidden" || asr.check === "validationHasText") {
      const valLocSpec = wCat.validationLocator || TESTKIT_CATALOG.widgets.TextBox.validationLocator;
      const valLocKey = seq++;
      stepRuns.push(
        makeMfcStep({
          key: valLocKey,
          qualifiedName: valLocSpec.qualifiedName,
          parameters: [
            {
              ParameterName: valLocSpec.locatorParam,
              DataType: "ObjectType",
              EntityQualifiedName: locInfo.returnEntity,
              UseEmptyObjectList: false,
            },
          ],
          smpr: [
            {
              ParameterName: valLocSpec.locatorParam,
              DataType: "ObjectType",
              EntityQualifiedName: locInfo.returnEntity,
              TCEX_RQ_SmprValueRun: [{ TestStepRunKey_output: locInfo.key }],
            },
          ],
          returnType: { dataType: "ObjectType", entity: valLocSpec.returnEntity },
        })
      );

      if (asr.check === "validationHasText" && asr.expectedText) {
        const hasTextSpec = TESTKIT_CATALOG.genericAssertions.ASR_Contains_Text_ValidationMessage;
        const asrKey = seq++;
        stepRuns.push(
          makeMfcStep({
            key: asrKey,
            qualifiedName: hasTextSpec.qualifiedName,
            parameters: [
              {
                ParameterName: hasTextSpec.locatorParam,
                DataType: "ObjectType",
                EntityQualifiedName: hasTextSpec.locatorEntity,
                UseEmptyObjectList: false,
              },
              {
                ParameterName: "Expected",
                DataType: "StringType",
                TCEX_RQ_MicroflowParameterValueRun: [{ Value: String(asr.expectedText) }],
              },
              ...hasTextSpec.optionsParams.map((op) => ({
                ParameterName: op.name,
                DataType: "ObjectType",
                EntityQualifiedName: op.entity,
                UseEmptyObjectList: true,
              })),
            ],
            smpr: [
              {
                ParameterName: hasTextSpec.locatorParam,
                DataType: "ObjectType",
                EntityQualifiedName: hasTextSpec.locatorEntity,
                TCEX_RQ_SmprValueRun: [{ TestStepRunKey_output: valLocKey }],
              },
            ],
            returnType: { dataType: "VoidType", entity: null },
          })
        );
      } else {
        const isVis = asr.check === "validationVisible" && asr.expected !== false;
        const visSpec = isVis
          ? TESTKIT_CATALOG.genericAssertions.ASR_Is_Visible_MxLocator
          : TESTKIT_CATALOG.genericAssertions.ASR_Is_Hidden_MxLocator;
        const asrKey = seq++;
        stepRuns.push(
          makeMfcStep({
            key: asrKey,
            qualifiedName: visSpec.qualifiedName,
            parameters: [
              {
                ParameterName: visSpec.locatorParam,
                DataType: "ObjectType",
                EntityQualifiedName: visSpec.locatorEntity,
                UseEmptyObjectList: false,
              },
              ...visSpec.optionsParams.map((op) => ({
                ParameterName: op.name,
                DataType: "ObjectType",
                EntityQualifiedName: op.entity,
                UseEmptyObjectList: true,
              })),
            ],
            smpr: [
              {
                ParameterName: visSpec.locatorParam,
                DataType: "ObjectType",
                EntityQualifiedName: visSpec.locatorEntity,
                TCEX_RQ_SmprValueRun: [{ TestStepRunKey_output: valLocKey }],
              },
            ],
            returnType: { dataType: "VoidType", entity: null },
          })
        );
      }
    } else if (asr.check === "isVisible" || asr.check === "isHidden") {
      const visSpec =
        asr.check === "isVisible"
          ? TESTKIT_CATALOG.genericAssertions.ASR_Is_Visible_MxLocator
          : TESTKIT_CATALOG.genericAssertions.ASR_Is_Hidden_MxLocator;
      const asrKey = seq++;
      stepRuns.push(
        makeMfcStep({
          key: asrKey,
          qualifiedName: visSpec.qualifiedName,
          parameters: [
            {
              ParameterName: visSpec.locatorParam,
              DataType: "ObjectType",
              EntityQualifiedName: visSpec.locatorEntity,
              UseEmptyObjectList: false,
            },
            ...visSpec.optionsParams.map((op) => ({
              ParameterName: op.name,
              DataType: "ObjectType",
              EntityQualifiedName: op.entity,
              UseEmptyObjectList: true,
            })),
          ],
          smpr: [
            {
              ParameterName: visSpec.locatorParam,
              DataType: "ObjectType",
              EntityQualifiedName: visSpec.locatorEntity,
              TCEX_RQ_SmprValueRun: [{ TestStepRunKey_output: locInfo.key }],
            },
          ],
          returnType: { dataType: "VoidType", entity: null },
        })
      );
    }
  }

  // 9. Mandatory Browser Teardown (`Stop_MxFrontendTest` + `Teardown_Playwright` with `Always` / `_Continue`)
  const stopSpec = TESTKIT_CATALOG.lifecycle.Stop_MxFrontendTest;
  const stopKey = seq++;
  stepRuns.push(
    makeMfcStep({
      key: stopKey,
      qualifiedName: stopSpec.qualifiedName,
      executionCondition: "Always",
      resumeOnException: "_Continue",
      parameters: [
        {
          ParameterName: "Page",
          DataType: "ObjectType",
          EntityQualifiedName: "MenditectPlaywrightConnector.Page",
          UseEmptyObjectList: false,
        },
      ],
      smpr: [
        {
          ParameterName: "Page",
          DataType: "ObjectType",
          EntityQualifiedName: "MenditectPlaywrightConnector.Page",
          TCEX_RQ_SmprValueRun: [{ TestStepRunKey_output: pageStepKey }],
        },
      ],
      returnType: stopSpec.returnType,
    })
  );

  const tdSpec = TESTKIT_CATALOG.lifecycle.Teardown_Playwright;
  const tdKey = seq++;
  stepRuns.push(
    makeMfcStep({
      key: tdKey,
      qualifiedName: tdSpec.qualifiedName,
      executionCondition: "Always",
      resumeOnException: "_Continue",
      parameters: [],
      returnType: tdSpec.returnType,
    })
  );

  return {
    ApplySecurityExecutor: "NONE",
    ExecutorUsername: options.executionUsername || "MxAdmin",
    RollbackTcseAfterExecution: enableTrace ? "No" : "Yes",
    is_bughunt: true,
    is_exploratory: true,
    TCEX_RQ_TestStepRun: stepRuns,
  };
}
