# Execution Plan: TC_SampleInvalidBackendNoSentinelEmpty

<details>
<summary><b>Test Plan Details & Tracking (Click to expand)</b></summary>

```yaml
plan_id: "TC_SampleInvalidBackendNoSentinelEmpty-v1"
category: "Backend"
```

</details>

## 1. Purpose & Scope
Negative test verifying that backend unit tests taking object parameters cannot bind directly to CreateObject and must provision PAT-07 sentinel retrieves and empty scenarios.

## 2. Component Under Test
Sales.ACT_Process

## 3. Test Steps & Action Sequence

| # | Case | Step Action & Target | Input Handle | Output Handle | Parameters, Bindings & Initial Values | Embedded Assertions | Exec Settings | Pattern Tag |
| :-: | :--: | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **1** | Case 1 | `CreateObject` (`Sales.Order`) | - | `orderHandle` | `Amount = 100` | - | `None` / `Stop` | `PAT-06` |
| **2** | Case 1 | `CallMicroflow` (`Sales.ACT_Process`) | `orderHandle` | `resultHandle` | `Order = orderHandle` | `Assert result == true` | `None` / `Stop` | `PAT-14` |

## 4. Test Scenarios & Test Data

| # | Step Target | Scenario #1 (Regular) | Scenario #2 (VIP) |
| :---: | :--- | :--- | :--- |
| **0** | **Scenario Name** | Regular Customer | VIP Customer |
| **0** | **Scenario Description** | Standard verification | VIP discount verification |
| 1 | Step 1: `Order.Amount` | `100` | `200` |
| 2 | Step 2: Assert Return Value | `true` | `true` |

## 5. Quality & Compliance Checks
* [x] Verified
