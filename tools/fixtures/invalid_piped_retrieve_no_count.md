# Execution Plan: TC_SampleInvalidAnti03

<details>
<summary><b>Test Plan Details & Tracking (Click to expand)</b></summary>

```yaml
plan_id: "TC_SampleInvalidAnti03-v1"
category: "Backend"
```

</details>

## 1. Purpose & Scope
Test demonstrating unasserted retrieve output piping anti-pattern (ANTI-03).

## 2. Component Under Test
Sales.ACT_ProcessOrder

## 3. Test Steps & Action Sequence

| # | Case | Step Action & Target | Input Handle | Output Handle | Parameters, Bindings & Initial Values | Embedded Assertions | Exec Settings | Pattern Tag |
| :-: | :--: | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **1** | Case 1 | `RetrieveObject` (`Sales.Order`) | - | `orderHandle` | `Filter: Status = 'Active'` | - | `None` / `Stop` | `PAT-31` |
| **2** | Case 1 | `CallMicroflow` (`Sales.ACT_ProcessOrder`) | `orderHandle` | `resultHandle` | `Order = orderHandle` | `Assert result == true` | `None` / `Stop` | `PAT-14` |

## 4. Test Scenarios & Test Data

| # | Step Target | Scenario #1 | Scenario #2 |
| :---: | :--- | :--- | :--- |
| **0** | **Scenario Name** | Scen 1 | Scen 2 |
| **0** | **Scenario Description** | Desc 1 | Desc 2 |
| 1 | Step 1: Order.Status | 'Active' | 'Pending' |
| 2 | Step 2: Assert Return Value | true | false |

## 5. Quality & Compliance Checks
* [ ] Pending
