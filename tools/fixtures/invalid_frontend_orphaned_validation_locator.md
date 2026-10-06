# Execution Plan: TC_InvalidOrphanedValidationLocator

<details>
<summary><b>Test Plan Details & Tracking (Click to expand)</b></summary>

```yaml
plan_id: "TC_InvalidOrphanedValidationLocator-v1"
category: "Frontend"
```

</details>

## 1. Purpose & Scope
Frontend test with orphaned validation message locator (missing ASR_Is_Hidden/Visible assertion).

## 2. Component Under Test
MenditectMxFrontendTestKit driving Customer_NewEdit page.

## 3. Test Steps & Action Sequence

| # | Case | Step Action & Target | Input Handle | Output Handle | Parameters, Bindings & Initial Values | Embedded Assertions | Exec Settings | Pattern Tag |
| :-: | :--: | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **1** | Case 1 | `CreateObject` (`Sales.Customer`) | - | `custHandle` | `Email = 'test@example.com'` | - | `Always` / `_Continue` | `PAT-17` |
| **2** | Case 2 | `CallMicroflow` (`MenditectMxFrontendTestKit.Locate_MxWidget_TextBox`) | - | `txtEmailHandle` | `WidgetName = 'txtEmail'` | - | `None` / `Stop` | `PAT-64` |
| **3** | Case 2 | `CallMicroflow` (`MenditectMxFrontendTestKit.ACT_Fill_TextBox_Input`) | `txtEmailHandle` | - | `TextBoxLocator = txtEmailHandle`, `Value = 'john@example.com'` | - | `None` / `Stop` | `PAT-64` |
| **4** | Case 2 | `CallMicroflow` (`MenditectMxFrontendTestKit.Locate_MxWidget_TextBox_ValidationMessage`) | `txtEmailHandle` | `valMsgHandle` | `TextBoxLocator = txtEmailHandle`, Description: Locates validation message on Email textbox after onChange microflow Sales.OCh_Customer_Email | - | `None` / `Stop` | `PAT-119` |
| **5** | Case 3 | `ObjectAction` (`DeleteObjects`) | `custHandle` | - | - | - | `Always` / `_Continue` | `PAT-18` |

## 4. Test Scenarios & Test Data

| # | Step Target | Scenario #1 | Scenario #2 |
| :---: | :--- | :--- | :--- |
| **0** | **Scenario Name** | Valid Email Submission | Updated Email Submission |
| **0** | **Scenario Description** | Submits valid email | Submits alternate email |
| 1 | Step 1: `Customer.Email` | `'test@example.com'` | `'test2@example.com'` |
| 3 | Step 3: `Value` | `'john@example.com'` | `'jane@example.com'` |

## 5. Quality & Compliance Checks

- [ ] Orphaned locator expected
