# Practice 3 — API Orchestration & Service Composition

## Project Overview

This project demonstrates API orchestration using a central orchestrator service that coordinates several microservices.

The orchestrator handles the checkout process and calls multiple services in sequence.

Services involved:

- Payment service
- Inventory service
- Shipping service
- Notification service

The orchestrator also implements:

- Saga pattern for distributed transactions
- Compensation logic
- Idempotency handling
- Execution trace logging

---

## Architecture

The system follows the **Orchestration Pattern**.

A central **Orchestrator** controls the workflow and calls the services in the following order:

1. Payment authorization
2. Inventory reservation
3. Shipping creation
4. Notification sending

If any step fails, compensation logic is triggered to revert previous actions.

Example:

- If inventory reservation fails → payment refund
- If shipping times out → release inventory and refund payment

---

## Services

The project contains mock microservices:

| Service | Port | Purpose |
|------|------|------|
| Payment | 4001 | Authorize and refund payments |
| Inventory | 4002 | Reserve or release stock |
| Shipping | 4003 | Create shipment |
| Notification | 4004 | Send order confirmation |

The **Orchestrator** runs on:
http://localhost:3000

---

## Running the Project

Install dependencies:
npm install

Start mock services:


node mocks/payment.js
node mocks/inventory.js
node mocks/shipping.js
node mocks/notification.js


Start the orchestrator:


node orchestrator/server.js


Health check:


curl http://localhost:3000/health


---

## Running Tests

Run the orchestration tests:


cd test
npx jest orchestration.public.test.js --runInBand --forceExit


---

## Features Implemented

- API orchestration workflow
- Saga-based compensation
- Idempotency key support
- Timeout handling
- Execution trace recording
- Persistent saga and idempotency storage

---

## Author

Practice implementation for Enterprise Application Integration course.