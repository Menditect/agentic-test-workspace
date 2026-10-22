# Execution Plan: TC_SampleValidPipedRetrieveToAssoc

<details>
<summary><b>Test Plan Details & Tracking (Click to expand)</b></summary>

```yaml
plan_id: "TC_SampleValidPipedRetrieveToAssoc-v1"
category: "Backend"
```

</details>

## 1. Purpose & Scope
Regression test verifying that CreateObject with an association parameter referencing a Retrieve step handle (e.g. step2_CarSizeRetrieve) does not trigger false-positive ANTI-03 violations.

## 2. Component Under Test
CarRental.SUB_CalculateRentalFee

## 3. Test Steps & Action Sequence

| # | Case | Step Action & Target | Input Handle | Output Handle | Parameters, Bindings & Initial Values | Embedded Assertions | Exec Settings | Pattern Tag |
| :-: | :--: | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **1** | Case 1 | `CreateObject` (`CarRental.CarSize`) | - | `step1_CarSizeCreate` | `Sentinel = 'VALID'` | - | `None` / `Stop` | `PAT-06` |
| **2** | Case 1 | `RetrieveObject` (`CarRental.CarSize`) | `step1_CarSizeCreate` | `step2_CarSizeRetrieve` | `RetrieveOption = "Teststep", Filter: Sentinel == 'VALID'` | `Assert Object Count == 1` | `None` / `Stop` | `PAT-07` |
| **3** | Case 1 | `CreateObject` (`CarRental.Car`) | - | `step3_CarCreate` | `Car_CarSize = step2_CarSizeRetrieve, Sentinel = 'VALID'` | - | `None` / `Stop` | `PAT-06` |
| **4** | Case 1 | `RetrieveObject` (`CarRental.Car`) | `step3_CarCreate` | `step4_CarRetrieve` | `RetrieveOption = "Teststep", Filter: Sentinel == 'VALID'` | `Assert Object Count == 1` | `None` / `Stop` | `PAT-07` |
| **5** | Case 1 | `CallMicroflow` (`CarRental.SUB_CalculateRentalFee`) | `step4_CarRetrieve` | `resultHandle` | `Car = step4_CarRetrieve` | `Assert result == 120` | `None` / `Stop` | `PAT-14` |

## 4. Test Scenarios & Test Data

| # | Step Target | Scenario #1 (Valid) | Scenario #2 (Car Empty Boundary) |
| :---: | :--- | :--- | :--- |
| **0** | **Scenario Name** | Valid Rental | Car Empty Boundary |
| **0** | **Scenario Description** | Standard calculation | Car parameter is empty |
| 1 | Step 1: `CarSize.Sentinel` | `VALID` | `VALID` |
| 2 | Step 3: `Car.Sentinel` | `VALID` | `NONE` |
| 3 | Step 5: Assert Return Value | `120` | `0` |

## 5. Quality & Compliance Checks
* [x] Verified
