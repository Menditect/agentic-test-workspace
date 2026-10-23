# Execution Plan: TC_DiscountFeatureValid

<details>
<summary><b>Test Plan Details & Tracking (Click to expand)</b></summary>

```yaml
schema_version: "2.1.0"
plan_id: "TC_DiscountFeatureValid-v1"
category: "Backend"
test_intent: "exploratory_feature"
intent_derivation: "prompt_directive"
spec_source:
  type: "user_story"
  reference: "SP-1042"
  summary: "When customer is VIP and total exceeds 100, system must apply a 15 percent discount and return updated amount."
  mcp_retrieved: false
risks_covered:
  - risk: "Zero total boundary condition must not throw divide by zero"
    mitigating_scenario: "Scenario #1"
  - risk: "Exceeds maximum discount threshold prevents negative total"
    mitigating_scenario: "Scenario #2"
  - risk: "Empty order parameter must safely return 0 without exception"
    mitigating_scenario: "Scenario #3"
```

</details>

## 1. Purpose & Scope
*What this test verifies, why it matters, and how test data is isolated.*

## 2. Component Under Test
*The Mendix microflow being verified.*

## 3. Test Steps & Action Sequence
*The step-by-step sequence of object creation, actions, and assertions.*


| # | Case | Step Action & Target | Input Handle | Output Handle | Parameters, Bindings & Initial Values | Embedded Assertions | Exec Settings | Pattern Tag |
| :-: | :--: | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **1** | Case 1 | `CreateObject` (`Sales.Order`) | - | `step1_Order` | `Sentinel = 'VALID', Total = 100` | - | `None` / `Stop` | `PAT-06` |
| **2** | Case 1 | `RetrieveObject` (`Sales.Order`) | `step1_Order` | `orderHandle` | `RetrieveOption = "Teststep", Filter: Sentinel == 'VALID'` | `Assert Object Count == 1` | `None` / `Stop` | `PAT-07` |
| **3** | Case 1 | `CallMicroflow` (`Sales.CALC_Discount`) | `orderHandle` | `resultHandle` | `Order = orderHandle` | `Assert Return Value == expectedVal` | `None` / `Stop` | `PAT-14` |


## 4. Test Scenarios & Test Data
*The business situations to verify, with inputs and expected outcomes for each scenario.*

| # | Step Target | Scenario #1 (Zero Boundary) | Scenario #2 (VIP Threshold) | Scenario #3 (Empty Order Boundary) |
| :---: | :--- | :--- | :--- | :--- |
| **0** | **Scenario Name** | Zero Boundary | VIP Threshold | Empty Order Boundary |
| **0** | **Scenario Description** | Zero total input | High value VIP order | Null order parameter boundary |
| 1 | Step 1: `Order.Total` | `0` | `200` | `0` |
| 2 | Step 1: `Order.Sentinel` | `VALID` | `VALID` | `NONE` |
| 3 | Step 3: Assert Return Value | `0` | `170` | `0` |

## 5. Quality & Compliance Checks
*Compliance checks pass.*
