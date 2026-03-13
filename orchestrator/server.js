const express = require("express")
const axios = require("axios")
const fs = require("fs")
const crypto = require("crypto")

const app = express()
app.use(express.json())

const PORT = process.env.ORCHESTRATOR_PORT || 3000

const PAYMENT_URL = process.env.PAYMENT_URL
const INVENTORY_URL = process.env.INVENTORY_URL
const SHIPPING_URL = process.env.SHIPPING_URL
const NOTIFICATION_URL = process.env.NOTIFICATION_URL

const REQUEST_TIMEOUT_MS = 3000

const IDEMPOTENCY_FILE = "/data/idempotency-store.json"
const SAGA_FILE = "/data/saga-store.json"

function readJson(path) {
  try {
    return JSON.parse(fs.readFileSync(path))
  } catch {
    return {}
  }
}

function writeJson(path, data) {
  fs.writeFileSync(path, JSON.stringify(data, null, 2))
}

let idempotencyStore = readJson(IDEMPOTENCY_FILE)
let sagaStore = readJson(SAGA_FILE)

function hashPayload(payload) {
  return crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex")
}

function now() {
  return new Date().toISOString()
}

function addTrace(trace, step, status, start, end) {
  trace.push({
    step,
    status,
    startedAt: start,
    finishedAt: end,
    durationMs: new Date(end) - new Date(start)
  })
}

async function call(url, payload) {
  return axios.post(url, payload, { timeout: REQUEST_TIMEOUT_MS })
}

app.get("/health", (req, res) => {
  res.json({ status: "ok" })
})

app.post("/checkout", async (req, res) => {

  const key = req.header("Idempotency-Key")

  if (!key) {
    return res.status(400).json({ error: "Idempotency-Key required" })
  }

  const payload = req.body
  const payloadHash = hashPayload(payload)

  const existing = idempotencyStore[key]

  if (existing) {

    if (existing.payloadHash !== payloadHash) {
      return res.status(409).json({ code: "idempotency_payload_mismatch" })
    }

    if (existing.status === "completed") {
      return res.status(existing.httpStatus).json(existing.response)
    }

    return res.status(409).json({ code: "idempotency_conflict" })
  }

  idempotencyStore[key] = {
    status: "in-progress",
    payloadHash
  }

  writeJson(IDEMPOTENCY_FILE, idempotencyStore)

  const orderId = payload.orderId || "ord-" + Date.now()
  const trace = []

  sagaStore[orderId] = { state: "started" }
  writeJson(SAGA_FILE, sagaStore)

  try {

    let s = now()
    await call(`${PAYMENT_URL}/authorize`, payload)
    let e = now()
    addTrace(trace, "payment", "success", s, e)

  } catch {

    const response = { orderId, status: "failed", trace }

    idempotencyStore[key] = {
      status: "completed",
      payloadHash,
      httpStatus: 422,
      response
    }

    writeJson(IDEMPOTENCY_FILE, idempotencyStore)

    return res.status(422).json(response)
  }

  try {

    let s = now()
    await call(`${INVENTORY_URL}/reserve`, payload)
    let e = now()
    addTrace(trace, "inventory", "success", s, e)

  } catch {

    try {

      let s = now()
      await call(`${PAYMENT_URL}/refund`, payload)
      let e = now()
      addTrace(trace, "refund", "success", s, e)

    } catch {

      return res.status(422).json({ code: "compensation_failed" })
    }

    const response = { orderId, status: "failed", trace }

    idempotencyStore[key] = {
      status: "completed",
      payloadHash,
      httpStatus: 422,
      response
    }

    writeJson(IDEMPOTENCY_FILE, idempotencyStore)

    return res.status(422).json(response)
  }

  try {

    let s = now()
    await call(`${SHIPPING_URL}/create`, payload)
    let e = now()
    addTrace(trace, "shipping", "success", s, e)

  } catch (err) {

    if (err.code === "ECONNABORTED") {
      return res.status(504).json({ code: "timeout" })
    }

    try {

      await call(`${INVENTORY_URL}/release`, payload)
      await call(`${PAYMENT_URL}/refund`, payload)

    } catch {
      return res.status(422).json({ code: "compensation_failed" })
    }

    const response = { orderId, status: "failed", trace }

    idempotencyStore[key] = {
      status: "completed",
      payloadHash,
      httpStatus: 422,
      response
    }

    writeJson(IDEMPOTENCY_FILE, idempotencyStore)

    return res.status(422).json(response)
  }

  try {

    let s = now()
    await call(`${NOTIFICATION_URL}/send`, payload)
    let e = now()
    addTrace(trace, "notification", "success", s, e)

  } catch {

    try {

      await call(`${INVENTORY_URL}/release`, payload)
      await call(`${PAYMENT_URL}/refund`, payload)

    } catch {
      return res.status(422).json({ code: "compensation_failed" })
    }

    const response = { orderId, status: "failed", trace }

    idempotencyStore[key] = {
      status: "completed",
      payloadHash,
      httpStatus: 422,
      response
    }

    writeJson(IDEMPOTENCY_FILE, idempotencyStore)

    return res.status(422).json(response)
  }

  const response = {
    orderId,
    status: "completed",
    trace
  }

  idempotencyStore[key] = {
    status: "completed",
    payloadHash,
    httpStatus: 200,
    response
  }

  writeJson(IDEMPOTENCY_FILE, idempotencyStore)

  return res.status(200).json(response)

})

app.listen(PORT, () => {
  console.log("Orchestrator running on port", PORT)
})