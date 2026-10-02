# Execution Plan: TC_SampleInvalidEmptyObject

<details>
<summary><b>Test Plan Details & Tracking (Click to expand)</b></summary>

```yaml
plan_id: "TC_SampleInvalidEmptyObject-v1"
category: "Backend"
```

</details>

## 1. Purpose & Scope
Boundary condition test for calculate free kilometers with unassigned association.

## 2. Component Under Test
CarRentalModule.SUB_car_calculate_freekilometers

## 3. Test Steps & Action Sequence

| # | Case | Step Action & Target | Input Handle | Output Handle | Parameters, Bindings & Initial Values | Embedded Assertions | Exec Settings | Pattern Tag |
| :-: | :--: | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **1** | Case 1 | `CreateObject` (`CarRental.CarSize`) | - | `carSizeHandle` | `Size = Medium` | - | `None` / `Stop` | `PAT-06` |
| **2** | Case 1 | `CreateObject` (`CarRental.Car`) | - | `carHandle` | `Fuel = Diesel, Car_CarSize = carSizeHandle` | - | `None` / `Stop` | `PAT-06` |
| **3** | Case 1 | `CallMicroflow` (`CarRental.SUB_car_calculate_freekilometers`) | `carHandle` | `resultHandle` | `Car = carHandle` | `Assert result == 120` | `None` / `Stop` | `PAT-14` |

## 4. Test Scenarios & Test Data

| # | Step Target | Scenario #1 (Valid) | Scenario #2 (Unassigned Object) |
| :---: | :--- | :--- | :--- |
| **0** | **Scenario Name** | Valid Rental | Unassigned Object |
| **0** | **Scenario Description** | Standard calculation | CarSize is unassigned |
| 1 | Step 1: `CarSize.Size` | `Medium` | `Medium` |
| 2 | Step 2: `Car.Fuel` | `Diesel` | `Diesel` |
| 3 | Step 3: Assert Return Value | `120` | `0` |

## 5. Quality & Compliance Checks
* [x] Verified
