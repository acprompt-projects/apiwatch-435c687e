const express = require("express");
const cors = require("cors");
const db = require("./db");

const app = express();
app.use(cors());
app.use(express.json());

// --- CRUD: Endpoints ---
app.post("/api/endpoints", (req, res) => {
  const { name, url } = req.body;
  if (!name || !url) return res.status(400).json({ error: "name and url are required" });
  const ep = db.createEndpoint(req.body);
  res.status(201).json(ep);
});

app.get("/api/endpoints", (_req, res) => {
  res.json(db.listEndpoints());
});

app.get("/api/endpoints/:id", (req, res) => {
  const ep = db.getEndpoint(+req.params.id);
  if (!ep) return res.status(404).json({ error: "Endpoint not found" });
  res.json(ep);
});

app.put("/api/endpoints/:id", (req, res) => {
  const ep = db.updateEndpoint(+req.params.id, req.body);
  if (!ep) return res.status(404).json({ error: "Endpoint not found" });
  res.json(ep);
});

app.delete("/api/endpoints/:id", (req, res) => {
  if (!db.deleteEndpoint(+req.params.id)) return res.status(404).json({ error: "Endpoint not found" });
  res.status(204).end();
});

// --- Checks: Record & Query ---
app.post("/api/endpoints/:id/checks", (req, res) => {
  const ep = db.getEndpoint(+req.params.id);
  if (!ep) return res.status(404).json({ error: "Endpoint not found" });
  const { status_code, response_time_ms, is_up, error_message } = req.body;
  if (is_up === undefined) return res.status(400).json({ error: "is_up is required" });
  const id = db.insertCheck({
    endpoint_id: +req.params.id,
    status_code,
    response_time_ms,
    is_up,
    error_message,
  });
  res.status(201).json({ id });
});

app.get("/api/endpoints/:id/checks", (req, res) => {
  const ep = db.getEndpoint(+req.params.id);
  if (!ep) return res.status(404).json({ error: "Endpoint not found" });
  res.json(db.getChecks(+req.params.id, {
    limit: req.query.limit ? +req.query.limit : undefined,
    offset: req.query.offset ? +req.query.offset : undefined,
  }));
});

// --- Metrics ---
app.get("/api/endpoints/:id/metrics", (req, res) => {
  const ep = db.getEndpoint(+req.params.id);
  if (!ep) return res.status(404).json({ error: "Endpoint not found" });
  const minutes = req.query.minutes ? +req.query.minutes : 60;
  res.json(db.getMetrics(+req.params.id, minutes));
});

// --- Alerts ---
app.post("/api/endpoints/:id/alerts", (req, res) => {
  const ep = db.getEndpoint(+req.params.id);
  if (!ep) return res.status(404).json({ error: "Endpoint not found" });
  const { alert_type, message } = req.body;
  if (!alert_type || !message) return res.status(400).json({ error: "alert_type and message are required" });
  const id = db.insertAlert({ endpoint_id: +req.params.id, alert_type, message });
  res.status(201).json({ id });
});

app.get("/api/alerts", (req, res) => {
  res.json(db.listAlerts({
    endpoint_id: req.query.endpoint_id ? +req.query.endpoint_id : undefined,
    unresolved_only: req.query.unresolved_only === "true",
    limit: req.query.limit ? +req.query.limit : undefined,
    offset: req.query.offset ? +req.query.offset : undefined,
  }));
});

app.patch("/api/alerts/:id/resolve", (req, res) => {
  if (!db.resolveAlert(+req.params.id)) return res.status(404).json({ error: "Alert not found" });
  res.json({ resolved: true });
});

// --- Maintenance ---
app.delete("/api/checks/prune", (req, res) => {
  const days = req.query.days ? +req.query.days : 30;
  const count = db.pruneChecks(days);
  res.json({ pruned: count });
});

// --- Health ---
app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

const PORT = process.env.PORT || 3100;
app.listen(PORT, () => {
  console.log(`apiwatch API server listening on port ${PORT}`);
});

module.exports = app;