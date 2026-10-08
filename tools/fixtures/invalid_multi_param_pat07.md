# Execution Plan: TC_SampleInvalidMultiParamPAT07

<details>
<summary><b>Test Plan Details & Tracking (Click to expand)</b></summary>

```yaml
plan_id: "TC_SampleInvalidMultiParamPAT07-v1"
category: "Backend"
```

</details>

## 1. Purpose & Scope
Multi-parameter boundary condition test where one parameter has a PAT-07 sentinel retrieve, but another tested parameter lacks it.

## 2. Component Under Test
CarRentalModule.SUB_CalculateRentalFee

## 3. Test Steps & Action Sequence

| # | Case | Step Action & Target | Input Handle | Output Handle | Parameters, Bindings & Initial Values | Embedded Assertions | Exec Settings | Pattern Tag |
| :-: | :--: | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **1** | Case 1 | `CreateObject` (`CarRental.CarSize`) | - | `step1_CarSize` | `Sentinel = 'VALID'` | - | `None` / `Stop` | `PAT-06` |
| **2** | Case 1 | `RetrieveObject` (`CarRental.CarSize`) | `step1_CarSize` | `step2_CarSize` | `RetrieveOption = "Teststep", Filter: Sentinel == 'VALID'` | `Assert Object Count == 1` | `None` / `Stop` | `PAT-07` |
| **3** | Case 1 | `CreateObject` (`CarRental.Car`) | `step2_CarSize` | `step3_Car` | `Fuel = Diesel, Car_CarSize = step2_CarSize` | - | `None` / `Stop` | `PAT-06` |
| **4** | Case 1 | `CallMicroflow` (`CarRental.SUB_CalculateRentalFee`) | `step3_Car` | `resultHandle` | `Car = step3_Car, CarSize = step2_CarSize` | `Assert result == 120` | `None` / `Stop` | `PAT-14` |

## 4. Test Scenarios & Test Data

| # | Step Target | Scenario #1 (Valid) | Scenario #2 (Car Empty Boundary) |
| :---: | :--- | :--- | :--- |
| **0** | **Scenario Name** | Valid Rental | Car Empty Boundary |
| **0** | **Scenario Description** | Standard calculation | Car parameter is empty |
| 1 | Step 1: `CarSize.Sentinel` | `VALID` | `VALID` |
| 2 | Step 3: `Car.Fuel` | `Diesel` | `NONE` |
| 3 | Step 4: Assert Return Value | `120` | `0` |

## 5. Quality & Compliance Checks
* [x] Verified
