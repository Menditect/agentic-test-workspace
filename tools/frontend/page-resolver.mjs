/**
 * Menditect Bug Hunter — Frontend Page & Navigation Model Resolver (`page-resolver.mjs`)
 *
 * Extracts `PageTestDescriptor` objects from `.mxcli/catalog.db` + normalized AST bundles,
 * detects whether `MenditectMxFrontendTestKit` and `MenditectPlaywrightConnector` are
 * installed in the target Mendix project, and resolves DatePicker custom date formats (`PAT-94`).
 */

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";

const WIDGET_TYPE_NORMALIZATION = {
  ActionButton: "Button",
  DropDownButton: "Button",
  LinkButton: "Button",
  Button: "Button",
  TextBox: "TextBox",
  TextArea: "TextArea",
  DatePicker: "DatePicker",
  DropDown: "DropDown",
  ReferenceSelector: "ReferenceSelector",
  ComboBox: "ComboBox",
  CheckBox: "CheckBox",
  RadioButtons: "RadioButtons",
  DynamicText: "DynamicText",
  Text: "DynamicText",
  Gallery: "Gallery",
  ListView: "ListView",
  DataGrid2: "DataGrid2",
};

export function normalizeWidgetType(rawType = "", widgetName = "") {
  const clean = String(rawType || "").replace(/^Forms\$|^Pages\$|^CustomWidgets\$/i, "").trim();
  if (WIDGET_TYPE_NORMALIZATION[clean]) return WIDGET_TYPE_NORMALIZATION[clean];
  if (/DatePicker/i.test(clean) || /^DatePicker_/i.test(widgetName)) return "DatePicker";
  if (/ReferenceSelector/i.test(clean) || /^referenceSelector/i.test(widgetName)) return "ReferenceSelector";
  if (/ComboBox/i.test(clean)) return "ComboBox";
  if (/DropDown/i.test(clean) || /^Dropdown_/i.test(widgetName)) return "DropDown";
  if (/CheckBox/i.test(clean)) return "CheckBox";
  if (/TextArea/i.test(clean)) return "TextArea";
  if (/TextBox|Input/i.test(clean) || /^Text_|^textBox/i.test(widgetName)) return "TextBox";
  if (/Button/i.test(clean) || /^ActionButton_|^Button_/i.test(widgetName)) return "Button";
  if (/Gallery/i.test(clean) || /^gallery/i.test(widgetName)) return "Gallery";
  if (/ListView/i.test(clean) || /^listView/i.test(widgetName)) return "ListView";
  if (/DataGrid2/i.test(clean)) return "DataGrid2";
  if (/DynamicText|Text/i.test(clean)) return "DynamicText";
  return clean || "TextBox";
}

function findMprInDir(dirPath) {
  if (!dirPath || !fs.existsSync(dirPath)) return null;
  try {
    const mprFile = fs.readdirSync(dirPath).find((f) => f.toLowerCase().endsWith(".mpr"));
    return mprFile ? path.join(dirPath, mprFile) : null;
  } catch {
    return null;
  }
}

/**
 * Parses `source.SourceText` of a Mendix page to identify repeating containers (`Gallery`, `ListView`, `DataGrid2`)
 * and any widgets nested inside them (including `-- cell(r,c): <WidgetName>` entries at deeper indentation).
 */
export function extractRepeatingContainerNestingFromSource(sourceText = "") {
  const widgetContainerMap = new Map();
  const repeatingContainers = [];
  if (!sourceText) return { widgetContainerMap, repeatingContainers };

  const lines = String(sourceText).split(/\r?\n/);
  const containerStack = [];

  for (const rawLine of lines) {
    if (!rawLine.trim()) continue;
    const indent = (rawLine.match(/^\s*/) || [""])[0].length;
    const trimmed = rawLine.trim();

    while (containerStack.length > 0 && indent <= containerStack[containerStack.length - 1].indent) {
      containerStack.pop();
    }

    // Check if this line starts a repeating container (e.g., `listView listView1 : Entity` or `customWidget gallery1`)
    const listViewMatch = trimmed.match(/^(?:listView|dataGrid2|templateGrid|gallery)\s+([A-Za-z0-9_]+)(?:\s*:\s*([A-Za-z0-9_.]+))?/i);
    const customGalleryMatch =
      !listViewMatch &&
      trimmed.match(/^customWidget\s+([A-Za-z0-9_]+)(?:\s*:\s*([A-Za-z0-9_.]+))?/i) &&
      /^gallery/i.test(trimmed.split(/\s+/)[1] || "");
    if (listViewMatch || customGalleryMatch) {
      const m = listViewMatch || customGalleryMatch;
      const cName = m[1];
      const cEntity = m[2] || null;
      const cType = /^gallery/i.test(cName) || /^gallery/i.test(trimmed)
        ? "Gallery"
        : /^dataGrid2/i.test(trimmed)
          ? "DataGrid2"
          : "ListView";
      const rcObj = { type: cType, name: cName, entity: cEntity, indent };
      repeatingContainers.push(rcObj);
      containerStack.push(rcObj);
      continue;
    }

    if (containerStack.length > 0) {
      const activeContainer = containerStack[containerStack.length - 1];
      const cellMatch = trimmed.match(/^--\s*cell\(\d+\s*,\s*\d+\)\s*:\s*([A-Za-z0-9_]+)/i);
      if (cellMatch && cellMatch[1]) {
        widgetContainerMap.set(cellMatch[1].trim(), {
          type: activeContainer.type,
          name: activeContainer.name,
          entity: activeContainer.entity,
        });
        continue;
      }
      const widgetLineMatch = trimmed.match(
        /^(?:textBox|datePicker|dropDown|referenceSelector|checkBox|radioButtons|textArea|actionButton|button|linkButton|customWidget|dynamicText)\s+([A-Za-z0-9_]+)/i
      );
      if (widgetLineMatch && widgetLineMatch[1]) {
        widgetContainerMap.set(widgetLineMatch[1].trim(), {
          type: activeContainer.type,
          name: activeContainer.name,
          entity: activeContainer.entity,
        });
      }
    }
  }

  return { widgetContainerMap, repeatingContainers };
}

/**
 * Recovers widgets inside legacy `Forms$Table` cells that `mxcli` emits as
 * `-- cell(r,c): <WidgetName>` comments in `source.SourceText`, cross-referencing
 * page-level `refs` (`RefKind = 'member'` and `TargetType = 'MICROFLOW'`).
 */
export function extractTableCellWidgetsFromSource(
  sourceText = "",
  memberRefs = [],
  microflowRefs = [],
  existingWidgets = [],
  pageParamEntities = []
) {
  if (!sourceText || !/--\s*cell\(/i.test(sourceText)) return [];
  const existingNames = new Set((existingWidgets || []).map((w) => w.name || w.WidgetName));
  const usedMicroflows = new Set((existingWidgets || []).map((w) => w.calls_microflow || w.MicroflowRef).filter(Boolean));
  const usedAttributes = new Set((existingWidgets || []).map((w) => w.attribute || w.AttributeRef).filter(Boolean));
  const recovered = [];
  const { widgetContainerMap } = extractRepeatingContainerNestingFromSource(sourceText);

  const cellMatches = sourceText.matchAll(/--\s*cell\(\d+\s*,\s*\d+\)\s*:\s*([A-Za-z0-9_]+)/g);
  const cellNames = [];
  for (const m of cellMatches) {
    const wName = m[1]?.trim();
    if (wName && !existingNames.has(wName) && !cellNames.includes(wName)) {
      cellNames.push(wName);
    }
  }

  const paramEntitySet = new Set((pageParamEntities || []).filter(Boolean));

  for (const wName of cellNames) {
    if (/^(text\d+|label\d+|image\d+|staticImage\d+|table\d+|container\d+|layoutGrid\d+)$/i.test(wName)) {
      continue;
    }

    let type = "TextBox";
    let entity = null;
    let attribute = null;
    let callsMicroflow = null;

    if (/^DatePicker_/i.test(wName)) {
      type = "DatePicker";
      const suffix = wName.replace(/^DatePicker_/i, "").toLowerCase();
      const matchedAttr = memberRefs.find((r) => r.split(".").pop().toLowerCase() === suffix);
      if (matchedAttr) {
        attribute = matchedAttr;
        entity = matchedAttr.split(".").slice(0, 2).join(".");
        usedAttributes.add(matchedAttr);
      }
    } else if (/^Dropdown_|^referenceSelector/i.test(wName)) {
      // Check if there is a member attribute from a referenced lookup entity (not one of the page parameters)
      const suffix = wName.replace(/^(Dropdown_Select|Dropdown_|referenceSelector)/i, "").toLowerCase();
      const matchedLookupAttr =
        memberRefs.find((r) => {
          const ent = r.split(".").slice(0, 2).join(".");
          return suffix && ent.toLowerCase().endsWith(suffix);
        }) ||
        memberRefs.find((r) => {
          const ent = r.split(".").slice(0, 2).join(".");
          return !paramEntitySet.has(ent) && !usedAttributes.has(r);
        });
      if (matchedLookupAttr) {
        type = "ReferenceSelector";
        attribute = matchedLookupAttr;
        entity = matchedLookupAttr.split(".").slice(0, 2).join(".");
        usedAttributes.add(matchedLookupAttr);
      } else {
        type = /^referenceSelector/i.test(wName) ? "ReferenceSelector" : "DropDown";
      }
    } else if (/^Text_|^textBox/i.test(wName)) {
      type = "TextBox";
      const suffix = wName.replace(/^(Text_|textBox)/i, "").toLowerCase();
      const matchedAttr =
        memberRefs.find((r) => r.split(".").pop().toLowerCase() === suffix) ||
        memberRefs.find((r) => !usedAttributes.has(r) && r.split(".").pop().toLowerCase().includes(suffix));
      if (matchedAttr) {
        attribute = matchedAttr;
        entity = matchedAttr.split(".").slice(0, 2).join(".");
        usedAttributes.add(matchedAttr);
      }
    } else if (/^Button_|^ActionButton_/i.test(wName)) {
      type = "Button";
      const unboundMfs = microflowRefs.filter((mf) => !usedMicroflows.has(mf) && /\.ACT_/i.test(mf));
      if (unboundMfs.length === 1) {
        callsMicroflow = unboundMfs[0];
        usedMicroflows.add(callsMicroflow);
      } else if (unboundMfs.length > 1) {
        const suffix = wName.replace(/^(Button_|ActionButton_)/i, "").toLowerCase();
        const matchMf =
          unboundMfs.find((mf) => mf.toLowerCase().includes(suffix)) ||
          unboundMfs.find((mf) => !/single_step/i.test(mf)) ||
          unboundMfs[0];
        callsMicroflow = matchMf;
        usedMicroflows.add(callsMicroflow);
      }
    } else {
      continue;
    }

    const enclosingRc = widgetContainerMap.get(wName) || null;
    recovered.push({
      name: wName,
      type,
      entity,
      attribute,
      calls_microflow: callsMicroflow,
      required_on_page: false,
      recovered_from_table_cell: true,
      inRepeatingContainer: Boolean(enclosingRc),
      enclosingRepeatingContainer: enclosingRc,
      WidgetName: wName,
      WidgetType: type,
      EntityRef: entity,
      AttributeRef: attribute ? attribute.split(".").pop() : null,
      MicroflowRef: callsMicroflow,
    });
  }

  return recovered;
}

/**
 * Checks whether `MenditectMxFrontendTestKit` and `MenditectPlaywrightConnector` are present
 * in the target Mendix project (either as `.mxmodule` packages in `modules/`, Java proxies in
 * `modules/javasource/` or `javasource/`, or regular modules in `.mxcli/catalog.db`).
 */
export function detectFrontendTestKit(mprPath = null, catalogPath = null, bundle = null) {
  if (bundle && bundle.has_frontend_testkit === true) {
    return { available: true, source: "bundle_flag" };
  }

  const effectiveCatalog = catalogPath || bundle?.catalog_db_path || bundle?.catalog_path || null;
  const effectiveMpr = mprPath || bundle?.mpr_path || null;

  const projectDir = effectiveMpr
    ? path.dirname(effectiveMpr)
    : effectiveCatalog
      ? path.dirname(path.dirname(effectiveCatalog))
      : null;

  if (projectDir && fs.existsSync(projectDir)) {
    const candidateFiles = [
      path.join(projectDir, "modules", "MenditectMxFrontendTestKit.mxmodule"),
      path.join(projectDir, "modules", "javasource", "menditectmxfrontendtestkit", "proxies", "microflows", "Microflows.java"),
      path.join(projectDir, "javasource", "menditectmxfrontendtestkit", "proxies", "microflows", "Microflows.java"),
    ];
    for (const file of candidateFiles) {
      if (fs.existsSync(file)) {
        return { available: true, source: file, projectDir };
      }
    }
  }

  if (effectiveCatalog && fs.existsSync(effectiveCatalog)) {
    try {
      const db = new DatabaseSync(effectiveCatalog, { readOnly: true });
      const row = db
        .prepare("SELECT Name FROM modules_data WHERE Name IN ('MenditectMxFrontendTestKit', 'MenditectMxUITestKit') LIMIT 1")
        .get();
      db.close();
      if (row) {
        return { available: true, source: `catalog.db:${row.Name}`, projectDir };
      }
    } catch {
      // ignore read errors on catalog.db
    }
  }

  return { available: false, source: null, projectDir };
}

const PAGE_BSON_METADATA_CACHE = new Map();

/**
 * Single cached `mxcli bson dump` pass per target page (`PAT-94`).
 * Extracts DatePicker custom date formats, exact CustomWidget types, and repeating container hierarchies.
 */
export function inspectPageBsonMetadata(mprPath, pageQName, mxcliBin = null) {
  const cacheKey = `${mprPath || ""}::${pageQName || ""}`;
  if (PAGE_BSON_METADATA_CACHE.has(cacheKey)) {
    return PAGE_BSON_METADATA_CACHE.get(cacheKey);
  }

  const result = {
    dateFormats: new Map(),
    widgetTypes: new Map(),
    enclosingContainers: new Map(),
  };
  if (!mprPath || !fs.existsSync(mprPath) || !pageQName) {
    PAGE_BSON_METADATA_CACHE.set(cacheKey, result);
    return result;
  }

  const candidateBins = [
    mxcliBin,
    path.resolve(process.cwd(), "vendor", "bin", "mxcli.exe"),
    path.resolve(process.cwd(), "bin", "mxcli.exe"),
  ].filter((b) => b && fs.existsSync(b));

  if (candidateBins.length === 0) {
    PAGE_BSON_METADATA_CACHE.set(cacheKey, result);
    return result;
  }

  try {
    const out = execFileSync(
      candidateBins[0],
      ["bson", "dump", "-p", mprPath, "--type", "page", "--object", pageQName, "--format", "json"],
      { encoding: "utf8", timeout: 8000, stdio: ["ignore", "pipe", "ignore"] }
    );
    const matches = out.matchAll(/"name"\s*:\s*"([^"]+)"[\s\S]{0,600}?"customDateFormat"\s*:\s*"([^"]*)"/gi);
    for (const m of matches) {
      if (m[1] && m[2]) {
        result.dateFormats.set(m[1], m[2]);
      }
    }
    try {
      const parsed = JSON.parse(out);
      const walkBsonNode = (node, activeContainer = null) => {
        if (!node || typeof node !== "object") return;
        if (Array.isArray(node)) {
          for (const item of node) walkBsonNode(item, activeContainer);
          return;
        }
        const rawType = String(node.$Type || node.type || "");
        const nodeName = typeof node.name === "string" ? node.name : typeof node.Name === "string" ? node.Name : null;
        let nextContainer = activeContainer;
        if (nodeName) {
          const normT = normalizeWidgetType(rawType, nodeName);
          if (rawType) {
            result.widgetTypes.set(nodeName, normT);
          }
          if (normT === "Gallery" || normT === "ListView" || normT === "DataGrid2") {
            nextContainer = {
              type: normT,
              name: nodeName,
              entity: node.entity || node.EntityRef || activeContainer?.entity || null,
            };
          } else if (activeContainer) {
            result.enclosingContainers.set(nodeName, activeContainer);
          }
        }
        for (const val of Object.values(node)) {
          if (val && typeof val === "object") {
            walkBsonNode(val, nextContainer);
          }
        }
      };
      walkBsonNode(parsed, null);
    } catch {
      // Regex fallback already extracted dateFormats if JSON structure varies
    }
  } catch {
    // Fallback to default Mendix DatePicker format if bson dump is unavailable
  }

  PAGE_BSON_METADATA_CACHE.set(cacheKey, result);
  return result;
}

/**
 * Extracts DatePicker custom date formats via `mxcli bson dump` (`PAT-94`) when available,
 * falling back to `"dd-MM-yyyy"` if `mxcli` is not reachable.
 */
export function resolveDatePickerFormats(mprPath, pageQName, mxcliBin = null) {
  return inspectPageBsonMetadata(mprPath, pageQName, mxcliBin).dateFormats;
}

/**
 * Builds a complete `PageTestDescriptor` for a target Mendix page using `.mxcli/catalog.db`
 * and/or the harvested `bundle.pages` array.
 */
export function resolvePageTestDescriptor( pageQName, { catalogPath = null, mprPath = null, bundle = null } = {} ) {
  const cleanQName = String(pageQName || "").trim();
  const [moduleName, simpleName] = cleanQName.includes(".")
    ? cleanQName.split(".")
    : [bundle?.module || "Module", cleanQName];

  const effectiveCatalog = catalogPath || bundle?.catalog_db_path || bundle?.catalog_path || null;
  const effectiveMpr =
    mprPath ||
    bundle?.mpr_path ||
    (effectiveCatalog ? findMprInDir(path.dirname(path.dirname(effectiveCatalog))) : null);

  const bundlePage = (bundle?.pages || []).find(
    (p) => p.qualified_name === cleanQName || p.name === simpleName
  );

  let pageClassName = bundlePage?.class_name || bundlePage?.page_class || simpleName;
  let allowedRoles = bundlePage?.allowed_roles || [];
  let pageParameters = [...(bundlePage?.parameters || [])];
  const rawWidgets = [...(bundlePage?.widgets || [])];
  let entryStrategy = { mode: "DIRECT_PAGE", parentPage: null, triggerButton: null, menuCaption: null };
  let openerMicroflows = [];

  if (effectiveCatalog && fs.existsSync(effectiveCatalog)) {
    try {
      const db = new DatabaseSync(effectiveCatalog, { readOnly: true });

      const srcRow = db
        .prepare("SELECT SourceText FROM source WHERE QualifiedName = ? LIMIT 1")
        .get(cleanQName);
      const srcText = srcRow?.SourceText || "";
      if (srcText) {
        const classMatch = srcText.match(/\bClass\s*:\s*'([^']+)'/i);
        if (classMatch && classMatch[1]) {
          pageClassName = classMatch[1].trim();
        }
        const paramsBlock = srcText.match(/\bParams\s*:\s*[({]([^)}]+)[)}]/i);
        if (paramsBlock && paramsBlock[1]) {
          pageParameters = paramsBlock[1]
            .split(",")
            .map((s) => s.trim())
            .map((entry) => {
              const pm = entry.match(/^\$?([A-Za-z0-9_]+)\s*:\s*([A-Za-z0-9_.]+)$/);
              return pm ? { name: pm[1], entity: pm[2] } : null;
            })
            .filter(Boolean);
        }
      }

      // Fallback to refs table for page parameters, member attributes, and microflow calls
      const pageRefs = db
        .prepare("SELECT TargetType, TargetName, RefKind FROM refs WHERE SourceName = ?")
        .all(cleanQName);

      if (pageParameters.length === 0) {
        const paramRefs = pageRefs.filter((r) => r.RefKind === "parameter" && r.TargetType === "ENTITY");
        for (const pr of paramRefs) {
          pageParameters.push({
            name: pr.TargetName.split(".").pop(),
            entity: pr.TargetName,
          });
        }
      }

      if (rawWidgets.length === 0) {
        let dbWidgets = [];
        try {
          dbWidgets = db
            .prepare(
              "SELECT Name, WidgetType, EntityRef, AttributeRef, MicroflowRef FROM widgets WHERE ContainerQualifiedName = ?"
            )
            .all(cleanQName);
        } catch {
          dbWidgets = db
            .prepare(
              "SELECT Name, WidgetType, EntityRef, AttributeRef, MicroflowRef FROM widgets_data WHERE ContainerQualifiedName = ?"
            )
            .all(cleanQName);
        }
        for (const w of dbWidgets) {
          rawWidgets.push({
            name: w.Name,
            type: w.WidgetType,
            entity: w.EntityRef || null,
            attribute: w.AttributeRef || null,
            calls_microflow: w.MicroflowRef || null,
          });
        }
      }

      // Recover any widgets nested inside legacy `Forms$Table` cells (`-- cell(r,c): <WidgetName>`)
      if (srcText.includes("-- cell(")) {
        const memberRefs = pageRefs
          .filter((r) => r.TargetType === "ATTRIBUTE" && r.RefKind === "member")
          .map((r) => r.TargetName);
        const mfRefs = pageRefs
          .filter((r) => r.TargetType === "MICROFLOW")
          .map((r) => r.TargetName);
        const recovered = extractTableCellWidgetsFromSource(
          srcText,
          memberRefs,
          mfRefs,
          rawWidgets,
          pageParameters.map((p) => p.entity)
        );
        for (const rw of recovered) {
          if (!rawWidgets.some((w) => w.name === rw.name)) {
            rawWidgets.push(rw);
          }
        }
      }

      // Identify microflows that open this page (`RefKind = 'show_page'`)
      openerMicroflows = db
        .prepare("SELECT SourceName FROM refs WHERE TargetName = ? AND RefKind = 'show_page'")
        .all(cleanQName)
        .map((r) => r.SourceName);

      // Check if page is a role Home Page
      try {
        let homeRow = null;
        try {
          homeRow = db
            .prepare("SELECT UserRole AS RoleName, Page AS TargetName FROM navigation_role_homes WHERE Page = ? LIMIT 1")
            .get(cleanQName);
        } catch {
          homeRow = db
            .prepare("SELECT RoleName, TargetName FROM navigation_role_homes WHERE TargetName = ? LIMIT 1")
            .get(cleanQName);
        }
        if (homeRow) {
          entryStrategy = { mode: "HOME_PAGE", role: homeRow.RoleName };
        }
      } catch {
        // table optional
      }

      // If this page requires parameters, check if a parent page in the module opens it via an opener microflow
      if (entryStrategy.mode === "DIRECT_PAGE" && pageParameters.length > 0 && openerMicroflows.length > 0) {
        const parentPageRefs = db
          .prepare(
            `SELECT SourceName, TargetName FROM refs WHERE SourceType = 'PAGE' AND TargetType = 'MICROFLOW' AND TargetName IN (${openerMicroflows.map(() => "?").join(",")})`
          )
          .all(...openerMicroflows);

        if (parentPageRefs.length > 0) {
          const parentPageQName = parentPageRefs[0].SourceName;
          const openerMf = parentPageRefs[0].TargetName;
          const parentSrcRow = db
            .prepare("SELECT SourceText FROM source WHERE QualifiedName = ? LIMIT 1")
            .get(parentPageQName);
          const parentSrcText = parentSrcRow?.SourceText || "";
          const parentClassMatch = parentSrcText.match(/\bClass\s*:\s*'([^']+)'/i);
          const parentPageClass = parentClassMatch?.[1]?.trim() || parentPageQName.split(".").pop();

          let parentWidgets = [];
          try {
            parentWidgets = db
              .prepare("SELECT Name, WidgetType, EntityRef, AttributeRef, MicroflowRef FROM widgets WHERE ContainerQualifiedName = ?")
              .all(parentPageQName)
              .map((w) => ({
                name: w.Name,
                type: w.WidgetType,
                entity: w.EntityRef || null,
                attribute: w.AttributeRef || null,
                calls_microflow: w.MicroflowRef || null,
              }));
          } catch {
            // ignore
          }
          if (parentSrcText.includes("-- cell(")) {
            const pRefs = db
              .prepare("SELECT TargetType, TargetName, RefKind FROM refs WHERE SourceName = ?")
              .all(parentPageQName);
            const recParent = extractTableCellWidgetsFromSource(
              parentSrcText,
              pRefs.filter((r) => r.TargetType === "ATTRIBUTE").map((r) => r.TargetName),
              pRefs.filter((r) => r.TargetType === "MICROFLOW").map((r) => r.TargetName),
              parentWidgets,
              []
            );
            parentWidgets.push(...recParent);
          }

          const triggerBtn =
            parentWidgets.find((w) => w.calls_microflow === openerMf) ||
            parentWidgets.find(
              (w) =>
                normalizeWidgetType(w.type, w.name) === "Button" &&
                /create|new|add|book/i.test(`${w.name} ${w.calls_microflow || ""}`)
            );
          const repeatingWidget = parentWidgets.find((w) => {
            const wt = normalizeWidgetType(w.type, w.name);
            return (wt === "Gallery" || wt === "ListView") && w.entity;
          });

          if (triggerBtn) {
            entryStrategy = {
              mode: "PARENT_PAGE_BUTTON",
              parentPage: parentPageQName,
              parentPageClass,
              triggerButton: triggerBtn.name,
              openerMicroflow: openerMf,
              ...(repeatingWidget
                ? {
                    repeatingContainer: {
                      type: normalizeWidgetType(repeatingWidget.type, repeatingWidget.name),
                      name: repeatingWidget.name,
                      entity: repeatingWidget.entity,
                      useNthItem: 0,
                    },
                  }
                : {}),
            };
          }
        }
      }

      db.close();
    } catch {
      // fallback to bundlePage metadata
    }
  }

  // Fallback check if another page in the bundle opens this page or shares an entry microflow
  if (entryStrategy.mode === "DIRECT_PAGE" && pageParameters.length > 0 && Array.isArray(bundle?.pages)) {
    const parentHome = bundle.pages.find(
      (p) =>
        p.qualified_name !== cleanQName &&
        (/^Home/i.test(p.name || "") || (p.parameters || []).length === 0)
    );
    if (parentHome) {
      const createBtn = (parentHome.widgets || []).find(
        (w) => normalizeWidgetType(w.type, w.name) === "Button" && /create|new|add|book/i.test(`${w.name} ${w.calls_microflow || ""}`)
      );
      const repeatingWidget = (parentHome.widgets || []).find((w) => {
        const wt = normalizeWidgetType(w.type, w.name);
        return (wt === "Gallery" || wt === "ListView") && w.entity;
      });
      if (createBtn) {
        entryStrategy = {
          mode: "PARENT_PAGE_BUTTON",
          parentPage: parentHome.qualified_name,
          parentPageClass: parentHome.class_name || parentHome.name,
          triggerButton: createBtn.name,
          ...(repeatingWidget
            ? {
                repeatingContainer: {
                  type: normalizeWidgetType(repeatingWidget.type, repeatingWidget.name),
                  name: repeatingWidget.name,
                  entity: repeatingWidget.entity,
                  useNthItem: 0,
                },
              }
            : {}),
        };
      }
    }
  }

  const hasDatePickerOrCustomContainer = rawWidgets.some((w) => {
    const wt = normalizeWidgetType(w.type, w.name);
    return wt === "DatePicker" || wt === "Gallery" || wt === "ListView" || wt === "DataGrid2";
  });
  const bsonMeta = hasDatePickerOrCustomContainer
    ? inspectPageBsonMetadata(effectiveMpr, cleanQName)
    : { dateFormats: new Map(), widgetTypes: new Map(), enclosingContainers: new Map() };
  const dateFormats = bsonMeta.dateFormats;

  // Identify repeating containers on this page (Gallery, ListView, DataGrid2)
  const pageRepeatingContainers = rawWidgets
    .map((rw) => {
      const wt = bsonMeta.widgetTypes.get(rw.name) || normalizeWidgetType(rw.type, rw.name);
      if (wt === "Gallery" || wt === "ListView" || wt === "DataGrid2") {
        const ent =
          rw.entity ||
          (rw.attribute && rw.attribute.includes(".") ? rw.attribute.split(".").slice(0, 2).join(".") : null);
        return { type: wt, name: rw.name, entity: ent };
      }
      return null;
    })
    .filter(Boolean);

  // Map microflow parameter entities from bundle if available so buttons calling a microflow
  // that takes a repeating container's entity are automatically linked to that container
  const mfParamEntityMap = new Map();
  for (const mf of bundle?.microflows || []) {
    const objParam = (mf.parameters || []).find((p) => p.type === "Object" && p.entity);
    if (objParam && mf.qualified_name) {
      mfParamEntityMap.set(mf.qualified_name, objParam.entity);
    }
  }

  const widgets = new Map();
  const requiredEntitiesSet = new Set(pageParameters.map((p) => p.entity).filter(Boolean));
  if (entryStrategy.repeatingContainer?.entity) {
    requiredEntitiesSet.add(entryStrategy.repeatingContainer.entity);
  }

  for (const rw of rawWidgets) {
    if (!rw.name) continue;
    const normType = bsonMeta.widgetTypes.get(rw.name) || normalizeWidgetType(rw.type, rw.name);
    const attrFull = rw.attribute || null;
    const entityFromAttr =
      rw.entity ||
      (attrFull && attrFull.includes(".") ? attrFull.split(".").slice(0, 2).join(".") : null);
    if (
      entityFromAttr &&
      (normType === "ReferenceSelector" || normType === "ComboBox" || normType === "Gallery" || normType === "ListView")
    ) {
      requiredEntitiesSet.add(entityFromAttr);
    }

    let enclosingRc =
      rw.enclosingRepeatingContainer ||
      bsonMeta.enclosingContainers.get(rw.name) ||
      null;
    if (!enclosingRc && normType !== "Gallery" && normType !== "ListView" && normType !== "DataGrid2" && pageRepeatingContainers.length > 0) {
      const calledMfEntity = rw.calls_microflow ? mfParamEntityMap.get(rw.calls_microflow) : null;
      const targetEntity = entityFromAttr || calledMfEntity;
      if (targetEntity) {
        const matchedRc = pageRepeatingContainers.find(
          (rc) =>
            rc.entity &&
            (rc.entity === targetEntity || rc.entity.split(".").pop() === targetEntity.split(".").pop())
        );
        if (matchedRc) {
          enclosingRc = { type: matchedRc.type, name: matchedRc.name, entity: matchedRc.entity };
        }
      } else if (pageParameters.length === 0 && pageRepeatingContainers.length === 1 && normType === "Button" && rw.calls_microflow) {
        enclosingRc = {
          type: pageRepeatingContainers[0].type,
          name: pageRepeatingContainers[0].name,
          entity: pageRepeatingContainers[0].entity,
        };
      }
    }

    widgets.set(rw.name, {
      name: rw.name,
      rawType: rw.type || normType,
      widgetType: normType,
      entity: entityFromAttr,
      attribute: attrFull ? attrFull.split(".").pop() : null,
      fullAttribute: attrFull,
      callsMicroflow: rw.calls_microflow || null,
      requiredOnPage: Boolean(rw.required_on_page),
      inRepeatingContainer: Boolean(enclosingRc),
      enclosingRepeatingContainer: enclosingRc,
      dateFormat: normType === "DatePicker" ? dateFormats.get(rw.name) || rw.date_format || "dd-MM-yyyy" : null,
    });
  }

  return {
    qualifiedName: cleanQName,
    name: simpleName,
    moduleName,
    pageClassName: pageClassName || simpleName,
    allowedRoles,
    parameters: pageParameters,
    entryStrategy,
    repeatingContainers: pageRepeatingContainers,
    widgets,
    requiredEntities: Array.from(requiredEntitiesSet),
  };
}
