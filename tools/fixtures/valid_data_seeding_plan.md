# Execution Plan: TC_Seed_CarRental_Fleet

<details>
<summary><b>Test Plan Details & Tracking (Click to expand)</b></summary>

```yaml
plan_id: "TC_Seed_CarRental_Fleet-v1"
category: "Backend"
test_intent: "data_seeding"
schema_version: "2.1.0"
```

</details>

## 1. Purpose & Scope
Seeds master fleet data (Locations, CarSizes, and Cars) directly into the database without requiring dummy sentinel retrieves or phantom null boundary tests.

## 2. Component Under Test
Domain entity provisioning for `CarRental.Location`, `CarRental.CarSize`, and `CarRental.Car`.

## 3. Test Steps & Action Sequence

| # | Case | Step Action & Target | Input Handle | Output Handle | Parameters, Bindings & Initial Values | Embedded Assertions | Exec Settings | Pattern Tag |
| :-: | :--: | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **1** | Case 1 | `CreateObject` (`CarRental.Location`) | - | `locHandle` | `City = 'Amsterdam', AirportCode = 'AMS'` | - | `None` / `Stop` | `PAT-06` |
| **2** | Case 1 | `CreateObject` (`CarRental.CarSize`) | - | `sizeHandle` | `CategoryName = 'Compact', DailyRate = 45.00` | - | `None` / `Stop` | `PAT-06` |
| **3** | Case 1 | `CreateObject` (`CarRental.Car`) | - | `carHandle` | `Car_Location = locHandle, Car_CarSize = sizeHandle, LicensePlate = 'AA-123-B', Model = 'VW Golf'` | - | `None` / `Stop` | `PAT-06` |
| **4** | Case 1 | `PersistObjects` (`CarRental.Car`) | `carHandle` | - | `Action = "Persist"` | - | `None` / `Stop` | `PAT-92` |

## 4. Test Scenarios & Test Data

| # | Step Target | Scenario #1 (Schiphol Compact) | Scenario #2 (Rotterdam SUV) |
| :---: | :--- | :--- | :--- |
| **0** | **Scenario Name** | Schiphol Compact Fleet | Rotterdam SUV Fleet |
| **0** | **Scenario Description** | Provisions compact car at Amsterdam airport | Provisions SUV at Rotterdam central |
| 1 | Step 1: `Location.City` | `'Amsterdam'` | `'Rotterdam'` |
| 2 | Step 2: `CarSize.CategoryName` | `'Compact'` | `'SUV'` |
| 3 | Step 3: `Car.LicensePlate` | `'AA-123-B'` | `'BB-456-C'` |
| 4 | Step 3: `Car.Model` | `'VW Golf'` | `'Volvo XC60'` |

## 5. Quality & Compliance Checks
*Automated rules and best-practice checks validated before running or building.*

<details>
<summary><b>View automated quality checks (Click to expand)</b></summary>

* [x] **Check 1:** Verified
* [x] **Check 2:** Verified

</details>

## 6. Verification & Build Receipt
*Audit confirmation verifying that the constructed test matches this plan with zero errors.*
