# Execution Plan: TC_SampleValidNullAssertCompactLedger

<details>
<summary><b>Test Plan Details & Tracking (Click to expand)</b></summary>

```yaml
plan_id: "TC_SampleValidNullAssertCompactLedger-v1"
category: "Backend"
```

</details>

## 1. Purpose & Scope
Validates that backend unit tests can use compact 8-column step ledgers (omitting the Case column) and assert empty return values without triggering false positive ANTI-48 violations on 'Assert'.

## 2. Component Under Test
CarRentalModule.SUB_CalculateRentalFee

## 3. Test Steps & Action Sequence

| # | Step Action & Target | In | Out | Parameters & Bindings | Embedded Assertions | Exec | Pattern Tag |
| :-: | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **1** | `CreateObject` (`CarRental.CarSize`) | - | `step1_CarSize` | `Sentinel = 'VALID'` | - | `None` / `Stop` | `PAT-06` |
| **2** | `RetrieveObject` (`CarRental.CarSize`) | `step1_CarSize` | `step2_CarSize` | `RetrieveOption = "Teststep", Filter: Sentinel == 'VALID'` | `Assert Object Count == 1` | `None` / `Stop` | `PAT-07` |
| **3** | `CreateObject` (`CarRental.Car`) | - | `step3_Car` | `Sentinel = 'VALID', Car_CarSize = step2_CarSize` | - | `None` / `Stop` | `PAT-06` |
| **4** | `RetrieveObject` (`CarRental.Car`) | `step3_Car` | `step4_Car` | `RetrieveOption = "Teststep", Filter: Sentinel == 'VALID'` | `Assert Object Count == 1` | `None` / `Stop` | `PAT-07` |
| **5** | `CallMicroflow` (`CarRental.SUB_CalculateRentalFee`) | `step4_Car` | `resultHandle` | `Car = step4_Car` | `Assert Return Value == 120` | `None` / `Stop` | `PAT-14` |

## 4. Test Scenarios & Test Data

| # | Step Target | Scenario #1 (Valid) | Scenario #2 (Unassigned CarSize) | Scenario #3 (Null Car) |
| :---: | :--- | :--- | :--- | :--- |
| **0** | **Scenario Name** | Valid Rental | Unassigned CarSize | Null Car |
| **0** | **Scenario Description** | Standard calculation | CarSize association is unassigned | Car object is null |
| 1 | Step 1: `CarSize.Sentinel` | `VALID` | `NONE` | `NONE` |
| 2 | Step 3: `Car.Sentinel` | `VALID` | `VALID` | `NONE` |
| 3 | Step 5: Assert Return Value | `120` | `100` | `empty` |

## 5. Quality & Compliance Checks
* [x] Verified
