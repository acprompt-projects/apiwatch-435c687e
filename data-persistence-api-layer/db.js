const Database = require("better-sqlite3");
const path = require("path");

const DB_PATH = process.env.DB_PATH || path.join(__dirname, "apiwatch.db");

let _db;
function getDb() {
  if (!_db) {
    _db = new Database(DB_PATH);
    _db.pragma("journal_mode = WAL");
    _db.pragma("foreign_keys = ON");
    migrate(_db);
  }
  return _db;
}

function migrate(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS endpoints (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      url TEXT NOT NULL,
      method TEXT NOT NULL DEFAULT 'GET',
      headers TEXT DEFAULT '{}',
      body TEXT DEFAULT NULL,
      interval_sec INTEGER NOT NULL DEFAULT 60,
      timeout_ms INTEGER NOT NULL DEFAULT 5000,
      expected_status INTEGER DEFAULT 200,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS checks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      endpoint_id INTEGER NOT NULL,
      status_code INTEGER,
      response_time_ms INTEGER,
      is_up INTEGER NOT NULL,
      error_message TEXT,
      checked_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (endpoint_id) REFERENCES endpoints(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS alerts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      endpoint_id INTEGER NOT NULL,
      alert_type TEXT NOT NULL,
      message TEXT NOT NULL,
      is_resolved INTEGER NOT NULL DEFAULT 0,
      triggered_at TEXT NOT NULL DEFAULT (datetime('now')),
      resolved_at TEXT DEFAULT NULL,
      FOREIGN KEY (endpoint_id) REFERENCES endpoints(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_checks_endpoint_id ON checks(endpoint_id);
    CREATE INDEX IF NOT EXISTS idx_checks_checked_at ON checks(checked_at);
    CREATE INDEX IF NOT EXISTS idx_alerts_endpoint_id ON alerts(endpoint_id);
    CREATE INDEX IF NOT EXISTS idx_alerts_resolved ON alerts(is_resolved);
  `);
}

// --- Endpoint helpers ---
function createEndpoint(data) {
  const stmt = getDb().prepare(`
    INSERT INTO endpoints (name, url, method, headers, body, interval_sec, timeout_ms, expected_status, enabled)
    VALUES (@name, @url, @method, @headers, @body, @interval_sec, @timeout_ms, @expected_status, @enabled)
  `);
  const info = stmt.run({
    name: data.name,
    url: data.url,
    method: data.method || "GET",
    headers: JSON.stringify(data.headers || {}),
    body: data.body ? JSON.stringify(data.body) : null,
    interval_sec: data.interval_sec || 60,
    timeout_ms: data.timeout_ms || 5000,
    expected_status: data.expected_status || 200,
    enabled: data.enabled !== undefined ? (data.enabled ? 1 : 0) : 1,
  });
  return getEndpoint(info.lastInsertRowid);
}

function getEndpoint(id) {
  const row = getDb().prepare("SELECT * FROM endpoints WHERE id = ?").get(id);
  if (row) row.headers = JSON.parse(row.headers);
  if (row && row.body) row.body = JSON.parse(row.body);
  return row || null;
}

function listEndpoints() {
  return getDb().prepare("SELECT * FROM endpoints ORDER BY created_at DESC").all().map(r => {
    r.headers = JSON.parse(r.headers);
    if (r.body) r.body = JSON.parse(r.body);
    return r;
  });
}

function updateEndpoint(id, data) {
  const existing = getEndpoint(id);
  if (!existing) return null;
  const merged = { ...existing, ...data };
  getDb().prepare(`
    UPDATE endpoints SET name=@name, url=@url, method=@method, headers=@headers,
      body=@body, interval_sec=@interval_sec, timeout_ms=@timeout_ms,
      expected_status=@expected_status, enabled=@enabled, updated_at=datetime('now')
    WHERE id=@id
  `).run({
    id,
    name: merged.name,
    url: merged.url,
    method: merged.method,
    headers: JSON.stringify(merged.headers || {}),
    body: merged.body ? JSON.stringify(merged.body) : null,
    interval_sec: merged.interval_sec,
    timeout_ms: merged.timeout_ms,
    expected_status: merged.expected_status,
    enabled: merged.enabled ? 1 : 0,
  });
  return getEndpoint(id);
}

function deleteEndpoint(id) {
  return getDb().prepare("DELETE FROM endpoints WHERE id = ?").run(id).changes > 0;
}

// --- Check helpers ---
function insertCheck(data) {
  const stmt = getDb().prepare(`
    INSERT INTO checks (endpoint_id, status_code, response_time_ms, is_up, error_message)
    VALUES (@endpoint_id, @status_code, @response_time_ms, @is_up, @error_message)
  `);
  const info = stmt.run({
    endpoint_id: data.endpoint_id,
    status_code: data.status_code ?? null,
    response_time_ms: data.response_time_ms ?? null,
    is_up: data.is_up ? 1 : 0,
    error_message: data.error_message || null,
  });
  return info.lastInsertRowid;
}

function getChecks(endpointId, opts = {}) {
  const limit = Math.min(opts.limit || 100, 1000);
  const offset = opts.offset || 0;
  return getDb().prepare(
    "SELECT * FROM checks WHERE endpoint_id = ? ORDER BY checked_at DESC LIMIT ? OFFSET ?"
  ).all(endpointId, limit, offset);
}

function getMetrics(endpointId, minutes = 60) {
  const rows = getDb().prepare(`
    SELECT
      COUNT(*) AS total,
      SUM(is_up) AS up_count,
      AVG(response_time_ms) AS avg_response_ms,
      MAX(response_time_ms) AS max_response_ms,
      MIN(CASE WHEN is_up = 1 THEN response_time_ms END) AS min_response_ms,
      SUM(CASE WHEN is_up = 0 THEN 1 ELSE 0 END) AS down_count
    FROM checks
    WHERE endpoint_id = ? AND checked_at >= datetime('now', ? || ' minutes')
  `).all(endpointId, -Math.abs(minutes));
  const r = rows[0] || {};
  return {
    total: r.total || 0,
    up_count: r.up_count || 0,
    down_count: r.down_count || 0,
    uptime_pct: r.total ? +(r.up_count / r.total * 100).toFixed(2) : 0,
    avg_response_ms: r.avg_response_ms ? +r.avg_response_ms.toFixed(1) : null,
    max_response_ms: r.max_response_ms || null,
    min_response_ms: r.min_response_ms || null,
  };
}

function pruneChecks(olderThanDays = 30) {
  return getDb().prepare(
    "DELETE FROM checks WHERE checked_at < datetime('now', ? || ' days')"
  ).run(-Math.abs(olderThanDays)).changes;
}

// --- Alert helpers ---
function insertAlert(data) {
  const stmt = getDb().prepare(`
    INSERT INTO alerts (endpoint_id, alert_type, message)
    VALUES (@endpoint_id, @alert_type, @message)
  `);
  const info = stmt.run({
    endpoint_id: data.endpoint_id,
    alert_type: data.alert_type,
    message: data.message,
  });
  return info.lastInsertRowid;
}

function resolveAlert(id) {
  return getDb().prepare(
    "UPDATE alerts SET is_resolved = 1, resolved_at = datetime('now') WHERE id = ?"
  ).run(id).changes > 0;
}

function listAlerts(opts = {}) {
  const limit = Math.min(opts.limit || 100, 1000);
  const offset = opts.offset || 0;
  let sql = "SELECT a.*, e.name AS endpoint_name FROM alerts a JOIN endpoints e ON a.endpoint_id = e.id";
  const params = [];
  if (opts.endpoint_id) { sql += " WHERE a.endpoint_id = ?"; params.push(opts.endpoint_id); }
  if (opts.unresolved_only) {
    sql += params.length ? " AND" : " WHERE";
    sql += " a.is_resolved = 0";
  }
  sql += " ORDER BY a.triggered_at DESC LIMIT ? OFFSET ?";
  params.push(limit, offset);
  return getDb().prepare(sql).all(...params);
}

module.exports = {
  getDb, createEndpoint, getEndpoint, listEndpoints,
  updateEndpoint, deleteEndpoint, insertCheck, getChecks,
  getMetrics, pruneChecks, insertAlert, resolveAlert, listAlerts,
};