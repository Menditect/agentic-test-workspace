# Execution Plan: TC_SampleModelBaselineValid

<details>
<summary><b>Test Plan Details & Tracking (Click to expand)</b></summary>

```yaml
plan_id: "TC_SampleModelBaselineValid-v1"
schema_version: "2.1.0"
category: "Backend"
test_intent: "regression"
spec_source:
  type: "model_baseline"
  summary: "Regression baseline derived from model inspection to verify order calculation logic"
risks_covered:
  - risk: "null boundary returns fallback"
    mitigating_scenario: "Scenario #2 (Empty Order Boundary)"
```

</details>

## 1. Purpose & Scope
> [!WARNING] Ground Truth Provenance Warning
> This execution plan was derived solely from inspecting the Mendix application model (`spec_source.type: model_baseline`) without external business specifications (user stories or acceptance criteria).
> **Risk of Tautological Testing:** The test assertions verify the *current implementation* as-built rather than independent business requirements. If existing code contains a defect, this test will codify and freeze the bug as expected behavior.

This test verifies the existing order processing microflow logic against the Mendix model baseline.

## 2. Component Under Test
Microflow `Sales.ACT_Process` verifying order calculation.

## 3. Test Steps & Action Sequence
The step-by-step sequence of object creation, actions, and assertions.

| # | Case | Step Action & Target | Input Handle | Output Handle | Parameters, Bindings & Initial Values | Embedded Assertions | Exec Settings | Pattern Tag |
| :-: | :--: | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **1** | Case 1 | `CreateObject` (`Sales.Order`) | - | `step1_Order` | `Sentinel = 'VALID', Amount = 100` | - | `None` / `Stop` | `PAT-06` |
| **2** | Case 1 | `RetrieveObject` (`Sales.Order`) | `step1_Order` | `orderHandle` | `RetrieveOption = "Teststep", Filter: Sentinel == 'VALID'` | `Assert Object Count == 1` | `None` / `Stop` | `PAT-07` |
| **3** | Case 1 | `CallMicroflow` (`Sales.ACT_Process`) | `orderHandle` | `resultHandle` | `Order = orderHandle` | `Assert result == true` | `None` / `Stop` | `PAT-14` |

## 4. Test Scenarios & Test Data
The business situations to verify, with inputs and expected outcomes for each scenario.

| # | Step Target | Scenario #1 (Regular) | Scenario #2 (Empty Order Boundary) |
| :---: | :--- | :--- | :--- |
| **0** | **Scenario Name** | Regular Customer | Empty Order Boundary |
| **0** | **Scenario Description** | Standard verification | Null order parameter boundary |
| 1 | Step 1: `Order.Amount` | `100` | `100` |
| 2 | Step 1: `Order.Sentinel` | `VALID` | `NONE` |
| 3 | Step 3: Assert Return Value | `true` | `false` |

## 5. Quality & Compliance Checks
Automated rules and best-practice checks validated before running or building.

<details>
<summary><b>View automated quality checks (Click to expand)</b></summary>

* [x] **Check 1:** Verified

</details>

## 6. Verification & Build Receipt
Audit confirmation verifying that the constructed test matches this plan with zero errors.
