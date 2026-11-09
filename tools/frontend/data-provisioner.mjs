/**
 * Menditect Bug Hunter — 4-Tier Frontend Data Provisioner (`data-provisioner.mjs`)
 *
 * Implements the 4-Tier Data Strategy for Frontend Playwright tests executed via `MTA_plugin`:
 *  - Tier 1 (Primitives Only): Zero DB setup when testing primitive inputs & validation rejections.
 *  - Tier 2 (Read-Only Live DB Reuse): Probes DB via `Retrieve (From_database, Head)`; reuses existing
 *    records via `Retrieve` + `TCEX_RQ_Svvr` scalar piping inside `TC_02_Frontend_Action`.
 *  - Tier 3 (Page-Scoped Shared Fixture Seeding): Generates `TC_01_Seed` (`Rollback: "No"` + `Persist`)
 *    in topological parent->child order and `TC_03_Teardown` (`Rollback: "No"` + reverse-dependency `Delete` + `Persist`).
 *  - Tier 4 (Browser-Commit Residue Cleanup): Tags UI string inputs with `BH_FE_<runId>_` and cleans up
 *    any rows committed by the browser session during `TC_03_Teardown`.
 */

function resolveMtaAttrDataType(rawType = "") {
  const s = String(rawType || "").trim();
  if (/AutoNumber/i.test(s)) return "AutoNumberType";
  if (/Boolean/i.test(s)) return "BooleanType";
  if (/DateTime|Date/i.test(s)) return "DateTimeType";
  if (/Decimal|Float|Currency/i.test(s)) return "DecimalType";
  if (/Long/i.test(s)) return "LongType";
  if (/Int/i.test(s)) return "IntegerType";
  if (/Enum/i.test(s)) return "EnumType";
  return "StringType_limited";
}

function findStringDisplayAttribute(entDef) {
  const attrs = entDef?.attributes || [];
  const preferred = attrs.find(
    (a) =>
      /String/i.test(a.type || "") &&
      /^(Name|PageName|City|BrandAndType|Title|Code|Description|Label|Email|Fullname)$/i.test(a.name || "")
  );
  if (preferred) return preferred.name;
  const anyStr = attrs.find((a) => /String/i.test(a.type || "") && !/AutoNumber/i.test(a.type || ""));
  return anyStr ? anyStr.name : null;
}

/**
 * Topologically orders required entities so referenced parent/lookup entities (`CarSize`, `Location`)
 * are created BEFORE dependent entities (`Car`, `Booking`) that hold the reference (`PAT-93`),
 * and reversed (`Child -> Parent -> Root`) for `TC_03_Teardown`.
 */
export function orderEntityDependencyGraph(targetEntities, allEntities = []) {
  const entityMap = new Map();
  for (const e of allEntities) {
    if (e.qualified_name) entityMap.set(e.qualified_name, e);
    if (e.name) entityMap.set(e.name, e);
  }

  const visited = new Set();
  const creationOrder = [];

  function visit(entName) {
    const entDef = entityMap.get(entName);
    const qName = entDef?.qualified_name || entName;
    if (!qName || visited.has(qName)) return;
    visited.add(qName);

    const assocs = entDef?.associations || [];
    for (const as of assocs) {
      const parentEnt = as.parent_entity || as.parent;
      const childEnt = as.child_entity || as.child;
      // In Mendix default ownership, parent holds the reference to child (lookup target), so child must exist first
      if ((parentEnt === qName || parentEnt === entDef?.name) && childEnt && childEnt !== qName) {
        visit(childEnt);
      }
    }
    creationOrder.push(qName);
  }

  for (const reqEnt of targetEntities) {
    visit(reqEnt);
  }

  return {
    creationOrder,
    teardownOrder: [...creationOrder].reverse(),
  };
}

/**
 * Builds the `TC_01_Seed` and `TC_03_Teardown` `MTA_plugin.execute-testcase` JSON payloads
 * for a set of entities tagged with `runTag` (`BH_FE_<runId>_`).
 */
export function buildSeedAndTeardownPayloads(entitiesToSeed, bundle = {}, runTag = "BH_FE_001", extraCleanupEntities = []) {
  const allEntities = bundle.entities || [];
  const { creationOrder, teardownOrder } = orderEntityDependencyGraph(entitiesToSeed, allEntities);

  const seedStepRuns = [];
  const entityToSeedStepKey = new Map();
  let seq = 1;

  for (const qEntity of creationOrder) {
    const entDef = allEntities.find(
      (e) => e.qualified_name === qEntity || e.name === qEntity.split(".").pop()
    );
    const attrRuns = [];
    for (const attr of entDef?.attributes || []) {
      const dt = resolveMtaAttrDataType(attr.type);
      if (dt === "AutoNumberType" || attr.is_auto_number) continue;
      if (dt === "StringType_limited") {
        const val = /email/i.test(attr.name)
          ? `${runTag.toLowerCase()}@menditect.test`
          : `${runTag}_${attr.name}`;
        attrRuns.push({ AttributeName: attr.name, DataType: dt, Value: val });
      } else if (attr.is_required || dt === "EnumType" || dt === "IntegerType" || dt === "DecimalType" || dt === "DateTimeType") {
        let val = "1";
        if (dt === "DecimalType") val = "25.00";
        else if (dt === "BooleanType") val = "true";
        else if (dt === "DateTimeType") val = "2024-07-01T10:00:00.000Z";
        else if (dt === "EnumType") {
          val = (Array.isArray(attr.enum_values) && attr.enum_values[0]) || attr.default_value || "Small";
        }
        attrRuns.push({ AttributeName: attr.name, DataType: dt, Value: String(val) });
      }
    }

    const sfarRuns = [];
    for (const as of entDef?.associations || []) {
      const parentEnt = as.parent_entity || as.parent;
      const childEnt = as.child_entity || as.child;
      const assocName = as.qualified_name || as.name;
      if ((parentEnt === qEntity || parentEnt === entDef?.name) && childEnt && assocName) {
        const targetKey = entityToSeedStepKey.get(childEnt) || entityToSeedStepKey.get(String(childEnt).split(".").pop());
        if (targetKey) {
          sfarRuns.push({
            AssociationName: assocName.includes(".") ? assocName : `${bundle.module || qEntity.split(".")[0]}.${assocName}`,
            AssociationOwner: as.owner === "Both" ? "Both" : "_Default",
            AssociationType: as.type === "ReferenceSet" ? "ReferenceSet" : "Reference",
            EntityParentQualifiedName: qEntity,
            EntityChildQualifiedName: childEnt.includes(".") ? childEnt : `${bundle.module || qEntity.split(".")[0]}.${childEnt}`,
            Operation: "set",
            TestStepRunKey_output: targetKey,
          });
        }
      }
    }

    const stepKey = seq++;
    entityToSeedStepKey.set(qEntity, stepKey);
    entityToSeedStepKey.set(qEntity.split(".").pop(), stepKey);

    seedStepRuns.push({
      Key: stepKey,
      SequenceNumber: stepKey,
      TestStepRunType: "Oact",
      ExecutionCondition: "Always",
      ResumeExecutionAfterException: "Stop",
      ExecutionDelayInMs: 0,
      TCEX_RQ_TestStepRunOact: {
        Action: "Create",
        EntityQualifiedName: qEntity,
        RetrieveOption: "From_database",
        RetrieveSet: "Head",
        TCEX_RQ_EntityValueRun: {
          TCEX_RQ_AttributeValueRun: attrRuns,
        },
        ...(sfarRuns.length > 0 ? { TCEX_RQ_Sfar: sfarRuns } : {}),
      },
    });
  }

  // Mandatory standalone Persist step at the end of TC_01_Seed (`PAT-21`)
  if (seedStepRuns.length > 0) {
    const persistKey = seq++;
    seedStepRuns.push({
      Key: persistKey,
      SequenceNumber: persistKey,
      TestStepRunType: "Oact",
      ExecutionCondition: "Always",
      ResumeExecutionAfterException: "Stop",
      ExecutionDelayInMs: 0,
      TCEX_RQ_TestStepRunOact: {
        Action: "Persist",
      },
    });
  }

  // Build TC_03_Teardown in reverse dependency order (`Leaf/Child -> Parent -> Root`, `PAT-93`)
  const allTeardownEntities = [
    ...extraCleanupEntities.filter((e) => !teardownOrder.includes(e)),
    ...teardownOrder,
  ];
  const teardownStepRuns = [];
  let tdSeq = 1;

  for (const qEntity of allTeardownEntities) {
    const entDef = allEntities.find(
      (e) => e.qualified_name === qEntity || e.name === qEntity.split(".").pop()
    );
    const filterAttr = findStringDisplayAttribute(entDef);
    const retrieveKey = tdSeq++;
    const deleteKey = tdSeq++;

    teardownStepRuns.push({
      Key: retrieveKey,
      SequenceNumber: retrieveKey,
      TestStepRunType: "Oact",
      ExecutionCondition: "Always",
      ResumeExecutionAfterException: "_Continue",
      ExecutionDelayInMs: 0,
      TCEX_RQ_TestStepRunOact: {
        Action: "Retrieve",
        EntityQualifiedName: qEntity,
        RetrieveOption: "From_database",
        RetrieveSet: "All",
        ...(filterAttr
          ? {
              TCEX_RQ_EntityValueRun: {
                TCEX_RQ_AttributeValueRun: [
                  {
                    AttributeName: filterAttr,
                    DataType: "StringType_limited",
                    FilterCompareType: "Contains",
                    Value: runTag,
                  },
                ],
              },
            }
          : {}),
      },
    });

    teardownStepRuns.push({
      Key: deleteKey,
      SequenceNumber: deleteKey,
      TestStepRunType: "Oact",
      ExecutionCondition: "Always",
      ResumeExecutionAfterException: "_Continue",
      ExecutionDelayInMs: 0,
      TCEX_RQ_TestStepRunOact: {
        Action: "Delete",
        EntityQualifiedName: qEntity,
        TCEX_RQ_Sfdr: { TestStepRunKey_output: retrieveKey },
      },
    });
  }

  if (teardownStepRuns.length > 0) {
    const tdPersistKey = tdSeq++;
    teardownStepRuns.push({
      Key: tdPersistKey,
      SequenceNumber: tdPersistKey,
      TestStepRunType: "Oact",
      ExecutionCondition: "Always",
      ResumeExecutionAfterException: "_Continue",
      ExecutionDelayInMs: 0,
      TCEX_RQ_TestStepRunOact: {
        Action: "Persist",
      },
    });
  }

  return {
    seedPayload:
      seedStepRuns.length > 0
        ? {
            ApplySecurityExecutor: "NONE",
            ExecutorUsername: "MxAdmin",
            RollbackTcseAfterExecution: "No",
            is_bughunt: true,
            TCEX_RQ_TestStepRun: seedStepRuns,
          }
        : null,
    teardownPayload:
      teardownStepRuns.length > 0
        ? {
            ApplySecurityExecutor: "NONE",
            ExecutorUsername: "MxAdmin",
            RollbackTcseAfterExecution: "No",
            is_bughunt: true,
            TCEX_RQ_TestStepRun: teardownStepRuns,
          }
        : null,
  };
}

/**
 * Determines the optimal data tier (Tier 1..4) for a `FrontendRecipe` on a `PageTestDescriptor`.
 */
export async function planFrontendDataStrategy(pageDescriptor, recipe, bundle = {}, probeDbFn = null) {
  const runTag = recipe.runTag || `BH_FE_${Date.now().toString(36).slice(-5).toUpperCase()}`;
  const referencedEntities = new Set();
  const requestedDisplayAttrs = new Map();

  for (const step of recipe.steps || []) {
    if (step.fromDbAttr) {
      const parts = step.fromDbAttr.split(".");
      if (parts.length >= 3) {
        const entQName = `${parts[0]}.${parts[1]}`;
        referencedEntities.add(entQName);
        requestedDisplayAttrs.set(entQName, parts[parts.length - 1]);
      }
    }
    if (step.repeatingContainer?.fromDbAttr) {
      const parts = String(step.repeatingContainer.fromDbAttr).split(".");
      if (parts.length >= 3) {
        const entQName = `${parts[0]}.${parts[1]}`;
        referencedEntities.add(entQName);
        requestedDisplayAttrs.set(entQName, parts[parts.length - 1]);
      }
    } else if (step.repeatingContainer?.entity) {
      referencedEntities.add(step.repeatingContainer.entity);
    }
  }
  const repEnt =
    recipe.entryStrategy?.repeatingContainer?.entity ||
    pageDescriptor?.entryStrategy?.repeatingContainer?.entity;
  if (repEnt) {
    referencedEntities.add(repEnt);
  }
  if (recipe.dataStrategy === "SEED_REQUIRED") {
    for (const reqEnt of pageDescriptor?.requiredEntities || []) {
      referencedEntities.add(reqEnt);
    }
  }

  const expectsCommitInBrowser = Boolean(recipe.expectsBrowserCommit);
  const cleanupEntities = recipe.browserCommittedEntities || [];

  // Tier 1: Primitives only, no referenced DB entities needed
  if (referencedEntities.size === 0 && !expectsCommitInBrowser) {
    return {
      tier: 1,
      tierName: "TIER_1_ZERO_PERSISTENCE_PRIMITIVES",
      runTag,
      requiresSeedCall: false,
      requiresTeardownCall: false,
      dbRetrievesForCase2: [],
      seedPayload: null,
      teardownPayload: null,
    };
  }

  // Tier 2 Probe: Check if required lookup/reference entities already exist in the live DB
  const allEntities = bundle.entities || [];
  const dbRetrievesForCase2 = [];
  const missingInDb = [];

  for (const qEntity of referencedEntities) {
    const entDef = allEntities.find(
      (e) => e.qualified_name === qEntity || e.name === qEntity.split(".").pop()
    );
    const displayAttr =
      requestedDisplayAttrs.get(qEntity) ||
      findStringDisplayAttribute(entDef) ||
      "Name";
    let existsInDb = false;

    if (typeof probeDbFn === "function" && recipe.dataStrategy !== "SEED_REQUIRED") {
      try {
        existsInDb = await probeDbFn(qEntity);
      } catch {
        existsInDb = false;
      }
    } else if (recipe.dataStrategy === "REUSE_EXISTING") {
      existsInDb = true;
    }

    if (existsInDb) {
      dbRetrievesForCase2.push({
        entity: qEntity,
        displayAttribute: displayAttr,
        filterPrefix: null,
      });
    } else {
      missingInDb.push(qEntity);
      dbRetrievesForCase2.push({
        entity: qEntity,
        displayAttribute: displayAttr,
        filterPrefix: runTag,
      });
    }
  }

  if (missingInDb.length === 0) {
    const { teardownPayload } = expectsCommitInBrowser
      ? buildSeedAndTeardownPayloads([], bundle, runTag, cleanupEntities)
      : { teardownPayload: null };
    return {
      tier: expectsCommitInBrowser ? 4 : 2,
      tierName: expectsCommitInBrowser ? "TIER_4_REUSE_WITH_COMMIT_CLEANUP" : "TIER_2_LIVE_DB_REUSE",
      runTag,
      requiresSeedCall: false,
      requiresTeardownCall: Boolean(teardownPayload),
      dbRetrievesForCase2,
      seedPayload: null,
      teardownPayload,
    };
  }

  // Tier 3: Seed missing entities in topological order and tear down in reverse order
  const { seedPayload, teardownPayload } = buildSeedAndTeardownPayloads(
    missingInDb,
    bundle,
    runTag,
    cleanupEntities
  );

  return {
    tier: 3,
    tierName: "TIER_3_SHARED_FIXTURE_SEED_AND_TEARDOWN",
    runTag,
    requiresSeedCall: Boolean(seedPayload),
    requiresTeardownCall: Boolean(teardownPayload),
    dbRetrievesForCase2,
    seedPayload,
    teardownPayload,
  };
}
