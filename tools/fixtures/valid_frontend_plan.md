# Execution Plan: TC_ValidFrontend

<details>
<summary><b>Test Plan Details & Tracking (Click to expand)</b></summary>

```yaml
plan_id: "TC_ValidFrontend-v1"
category: "Frontend"
```

</details>

## 1. Purpose & Scope
Frontend test verifying order submission via browser UI.

## 2. Component Under Test
MenditectMxFrontendTestKit driving Order_NewEdit page.

## 3. Test Steps & Action Sequence

| # | Case | Step Action & Target | Input Handle | Output Handle | Parameters, Bindings & Initial Values | Embedded Assertions | Exec Settings | Pattern Tag |
| :-: | :--: | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **1** | Case 1 | `CreateObject` (`Sales.Order`) | - | `orderHandle` | `Amount = 100` | - | `Always` / `_Continue` | `PAT-17` |
| **2** | Case 2 | `CallMicroflow` (`MenditectMxFrontendTestKit.ACT_Click_Button`) | - | - | `WidgetName = 'btnSubmit'` | - | `None` / `Stop` | `PAT-64` |
| **3** | Case 3 | `ObjectAction` (`DeleteObjects`) | `orderHandle` | - | - | - | `Always` / `_Continue` | `PAT-18` |

## 4. Test Scenarios & Test Data

| # | Step Target | Scenario #1 | Scenario #2 |
| :---: | :--- | :--- | :--- |
| **0** | **Scenario Name** | Standard Order | Bulk Order |
| **0** | **Scenario Description** | Click submit button standard | Click submit button bulk |
| 1 | Step 1: `Order.Amount` | `100` | `200` |
| 2 | Step 2: `WidgetName` | `'btnSubmit'` | `'btnSubmit'` |

## 5. Quality & Compliance Checks

- [x] Verified Frontend Isolation
