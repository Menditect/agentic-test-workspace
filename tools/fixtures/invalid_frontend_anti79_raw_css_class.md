# Execution Plan: TC_InvalidFrontendAnti79RawCss

<details>
<summary><b>Test Plan Details & Tracking (Click to expand)</b></summary>

```yaml
plan_id: "TC_InvalidFrontendAnti79RawCss-v1"
category: "Frontend"
```

</details>

## 1. Purpose & Scope
Frontend test incorrectly specifying raw CSS/DOM classes for PageClassName.

## 2. Component Under Test
MenditectMxFrontendTestKit driving Order_NewEdit page.

## 3. Test Steps & Action Sequence

| # | Case | Step Action & Target | Input Handle | Output Handle | Parameters, Bindings & Initial Values | Embedded Assertions | Exec Settings | Pattern Tag |
| :-: | :--: | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **1** | Case 1 | `CreateObject` (`Sales.Order`) | - | `orderHandle` | `Amount = 100` | - | `Always` / `_Continue` | `PAT-17` |
| **2** | Case 2 | `GenerateMicroflowCallTestStepLocatePage` (`Sales.Order_NewEdit`) | - | `pageHandle` | `PageQualifiedName = 'Sales.Order_NewEdit'`, `PageClassName = 'page-content mx-name-Order_NewEdit'` | - | `None` / `Stop` | `ANTI-79` |
| **3** | Case 2 | `GenerateMicroflowCallTestStepLocateWidget` (`btnSubmit`) | `pageHandle` | `btnHandle` | `WidgetName = 'btnSubmit'` | - | `None` / `Stop` | `PAT-64` |
| **4** | Case 3 | `ObjectAction` (`DeleteObjects`) | `orderHandle` | - | - | - | `Always` / `_Continue` | `PAT-18` |

## 4. Test Scenarios & Test Data

### Input Widget Inventory
| # | Widget Name | Widget Type | Date Format / Constraint (PAT-94) | Testkit Locator & Action Microflow |
| :-: | :--- | :--- | :--- | :--- |
| 1 | `btnSubmit` | `Button` | - | `Locate_MxWidget_Button` ➔ `ACT_Click_Button` |

| # | Step Target | Scenario #1 | Scenario #2 |
| :---: | :--- | :--- | :--- |
| **0** | **Scenario Name** | Standard Order | Bulk Order |
| **0** | **Scenario Description** | Click submit button standard | Click submit button bulk |
| 1 | Step 1: `Order.Amount` | `100` | `200` |
| 3 | Step 3: `WidgetName` | `'btnSubmit'` | `'btnSubmit'` |

## 5. Quality & Compliance Checks

- [ ] ANTI-79 raw CSS class in PageClassName violation expected
