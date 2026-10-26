# Execution Plan: TC_InvalidFrontendPAT32NoPiping

<details>
<summary><b>Test Plan Details & Tracking (Click to expand)</b></summary>

```yaml
plan_id: "TC_InvalidFrontendPAT32NoPiping-v1"
category: "Frontend"
```

</details>

## 1. Purpose & Scope
Frontend test verifying list filter interaction using hardcoded static literals without scalar piping.

## 2. Component Under Test
MenditectMxFrontendTestKit driving Car_Overview page.

## 3. Test Steps & Action Sequence

| # | Case | Step Action & Target | Input Handle | Output Handle | Parameters, Bindings & Initial Values | Embedded Assertions | Exec Settings | Pattern Tag |
| :-: | :--: | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **1** | Case 1 | `CreateObject` (`CarRentalModule.Car`) | - | `carHandle` | `LicensePlate = 'TEST_001'` | - | `Always` / `_Continue` | `PAT-17` |
| **2** | Case 2 | `CallMicroflow` (`MenditectMxFrontendTestKit.ELO_Filter_ListView_by_Text`) | - | - | `FilterText = 'TEST_001'` | - | `None` / `Stop` | `PAT-64` |
| **3** | Case 3 | `ObjectAction` (`DeleteObjects`) | `carHandle` | - | - | - | `Always` / `_Continue` | `PAT-18` |

## 4. Test Scenarios & Test Data

| # | Step Target | Scenario #1 |
| :---: | :--- | :--- |
| **0** | **Scenario Name** | Filter Test |
| **0** | **Scenario Description** | Filter without scalar piping |
| 1 | Step 1: `Car.LicensePlate` | `'TEST_001'` |
| 2 | Step 2: `FilterText` | `'TEST_001'` |

## 5. Quality & Compliance Checks

- [x] Verified Frontend Isolation
