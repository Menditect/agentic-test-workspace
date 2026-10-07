# Execution Plan: TC_DiscountFeatureCircular

<details>
<summary><b>Test Plan Details & Tracking (Click to expand)</b></summary>

```yaml
schema_version: "2.1.0"
plan_id: "TC_DiscountFeatureCircular-v1"
category: "Backend"
test_intent: "exploratory_feature"
intent_derivation: "prompt_directive"
spec_source:
  type: "prompt_inline"
  reference: "User Prompt"
  summary: "Calculates the customer discount as implemented in the current code."
  mcp_retrieved: false
risks_covered:
  - risk: "Zero total boundary condition must not throw divide by zero"
    mitigating_scenario: "Scenario #1"
```

</details>

## 1. Purpose & Scope
*What this test verifies, why it matters, and how test data is isolated.*

## 2. Component Under Test
*The Mendix microflow being verified.*

## 3. Test Steps & Action Sequence
*The step-by-step sequence of object creation, actions, and assertions.*

<details>
<summary><b>View detailed step specifications (Click to expand)</b></summary>

| # | Case | Step Action & Target | Input Handle | Output Handle | Parameters, Bindings & Initial Values | Embedded Assertions | Exec Settings | Pattern Tag |
| :-: | :--: | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **1** | Case 1 | `CreateObject` (`Sales.Order`) | - | `orderHandle` | `Total = 100` | - | `None` / `Stop` | `PAT-06` |
| **2** | Case 1 | `CallMicroflow` (`Sales.CALC_Discount`) | `orderHandle` | `resultHandle` | `Order = orderHandle` | `Assert Return Value == expectedVal` | `None` / `Stop` | `PAT-14` |

</details>

## 4. Test Scenarios & Test Data
*The business situations to verify, with inputs and expected outcomes for each scenario.*

| # | Step Target | Scenario #1 (Zero Boundary) |
| :---: | :--- | :--- |
| **0** | **Scenario Name** | Zero Boundary |
| **0** | **Scenario Description** | Zero total input |
| 1 | Step 1: `Order.Total` | `0` |
| 2 | Step 2: Assert Return Value | `0` |

## 5. Quality & Compliance Checks
*Compliance checks pass.*
