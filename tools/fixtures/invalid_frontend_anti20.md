# Execution Plan: TC_InvalidFrontendAnti20

<details>
<summary><b>Test Plan Details & Tracking (Click to expand)</b></summary>

```yaml
plan_id: "TC_InvalidFrontendAnti20-v1"
category: "Frontend"
```

</details>

## 1. Purpose & Scope
Frontend test incorrectly substituting UI actions with backend domain microflows.

## 2. Component Under Test
SalesModule.ACT_Click_Submit_Button backend microflow.

## 3. Test Steps & Action Sequence

| # | Case | Step Action & Target | Input Handle | Output Handle | Parameters, Bindings & Initial Values | Embedded Assertions | Exec Settings | Pattern Tag |
| :-: | :--: | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **1** | Case 1 | `CreateObject` (`Sales.Order`) | - | `orderHandle` | `Amount = 100` | - | `Always` / `_Continue` | `PAT-17` |
| **2** | Case 2 | `CallMicroflow` (`MenditectMxFrontendTestKit.ACT_LaunchBrowser`) | - | - | - | - | `None` / `Stop` | `PAT-64` |
| **3** | Case 2 | `CallMicroflow` (`SalesModule.ACT_Click_Submit_Button`) | - | - | - | - | `None` / `Stop` | `ANTI-20` |
| **4** | Case 3 | `ObjectAction` (`DeleteObjects`) | `orderHandle` | - | - | - | `Always` / `_Continue` | `PAT-18` |

## 4. Test Scenarios & Test Data

| # | Step Target | Scenario #1 | Scenario #2 |
| :---: | :--- | :--- | :--- |
| **0** | **Scenario Name** | Standard Order | Bulk Order |
| **0** | **Scenario Description** | Click submit button standard | Click submit button bulk |
| 1 | Step 1: `Order.Amount` | `100` | `200` |
| 2 | Step 2: Target | - | - |
| 3 | Step 3: Target | - | - |
| 4 | Step 4: Target | - | - |

## 5. Quality & Compliance Checks

- [ ] ANTI-20 Violation expected
