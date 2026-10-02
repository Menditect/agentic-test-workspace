# Execution Plan: TC_InvalidDateMacro

<details>
<summary><b>Test Plan Details & Tracking (Click to expand)</b></summary>

```yaml
plan_id: "TC_InvalidDateMacro-v1"
category: "Backend"
```

</details>

## 1. Purpose & Scope
Test verifying unparsed date macro detection.

## 2. Component Under Test
Order processing with unparsed macro.

## 3. Test Steps & Action Sequence

| # | Case | Step Action & Target | Input Handle | Output Handle | Parameters, Bindings & Initial Values | Embedded Assertions | Exec Settings | Pattern Tag |
| :-: | :--: | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **1** | Case 1 | `CreateObject` (`Sales.Order`) | - | `orderHandle` | `OrderDate = '[%CurrentDateTime%]'` | - | `None` / `Stop` | `PAT-06` |
| **2** | Case 1 | `CallMicroflow` (`Sales.ACT_Process`) | `orderHandle` | `resultHandle` | `Order = orderHandle` | `Assert result == true` | `None` / `Stop` | `PAT-14` |

## 4. Test Scenarios & Test Data

| # | Step Target | Scenario #1 | Scenario #2 |
| :---: | :--- | :--- | :--- |
| **0** | **Scenario Name** | Regular Customer | VIP Customer |
| **0** | **Scenario Description** | Standard verification | VIP discount verification |
| 1 | Step 1: `Order.OrderDate` | `'[%CurrentDateTime%]'` | `'[%CurrentDateTime%]'` |
| 2 | Step 2: Assert Return Value | `true` | `true` |

## 5. Quality & Compliance Checks

- [x] Quality check 1
