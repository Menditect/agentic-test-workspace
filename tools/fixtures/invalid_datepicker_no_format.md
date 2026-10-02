# Execution Plan: TC_InvalidDatePickerNoFormat

<details>
<summary><b>Test Plan Details & Tracking (Click to expand)</b></summary>

```yaml
plan_id: "TC_InvalidDatePickerNoFormat-v1"
category: "Frontend"
```

</details>

## 1. Purpose & Scope
Frontend test verifying datepicker input without extracting custom date format.

## 2. Component Under Test
MenditectMxFrontendTestKit driving Order_NewEdit page with DatePicker.

## 3. Test Steps & Action Sequence

| # | Case | Step Action & Target | Input Handle | Output Handle | Parameters, Bindings & Initial Values | Embedded Assertions | Exec Settings | Pattern Tag |
| :-: | :--: | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **1** | Case 1 | `CreateObject` (`Sales.Order`) | - | `orderHandle` | `Amount = 100` | - | `Always` / `_Continue` | `PAT-17` |
| **2** | Case 2 | `CallMicroflow` (`MenditectMxFrontendTestKit.ACT_Fill_DatePicker_Input`) | - | - | `Value = '05/15/2026'` | - | `None` / `Stop` | `PAT-64` |
| **3** | Case 3 | `ObjectAction` (`DeleteObjects`) | `orderHandle` | - | - | - | `Always` / `_Continue` | `PAT-18` |

## 4. Test Scenarios & Test Data

### Input Widget Inventory
| # | Widget Name | Widget Type | Date Format / Constraint (PAT-94) | Testkit Locator & Action Microflow |
| :-: | :--- | :--- | :--- | :--- |
| 1 | `datePicker_OrderDate` | `DatePicker` | Default | `Locate_MxWidget_DatePicker` ➔ `ACT_Fill_DatePicker_Input` |

| # | Step Target | Scenario #1 | Scenario #2 |
| :---: | :--- | :--- | :--- |
| **0** | **Scenario Name** | Standard Order | Bulk Order |
| **0** | **Scenario Description** | Fill datepicker standard | Fill datepicker bulk |
| 1 | Step 1: `Order.Amount` | `100` | `200` |
| 2 | Step 2: `Value` | `'05/15/2026'` | `'05/16/2026'` |

## 5. Quality & Compliance Checks

- [x] Verified Frontend Isolation
