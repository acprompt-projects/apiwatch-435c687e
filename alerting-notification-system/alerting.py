import sqlite3
import time
import json
import logging
from enum import Enum
from dataclasses import dataclass, field, asdict
from typing import Optional

from notifier import WebhookNotifier

logger = logging.getLogger(__name__)


class AlertType(str, Enum):
    CONSECUTIVE_FAILURES = "consecutive_failures"
    LATENCY_SPIKE = "latency_spike"
    STATUS_CHANGE = "status_change"


class AlertSeverity(str, Enum):
    WARNING = "warning"
    CRITICAL = "critical"
    INFO = "info"


@dataclass
class AlertRule:
    endpoint_id: str
    alert_type: AlertType
    threshold: int = 3  # for consecutive_failures: count; for latency_spike: ms
    enabled: bool = True
    cooldown_seconds: int = 300
    severity: AlertSeverity = AlertSeverity.CRITICAL


@dataclass
class HealthCheckResult:
    endpoint_id: str
    status_code: Optional[int] = None
    latency_ms: Optional[float] = None
    is_healthy: bool = True
    timestamp: float = field(default_factory=time.time)


@dataclass
class AlertEvent:
    id: Optional[int] = None
    endpoint_id: str = ""
    alert_type: str = ""
    severity: str = ""
    message: str = ""
    metadata: str = "{}"
    fired_at: float = field(default_factory=time.time)
    acknowledged: bool = False


class AlertManager:
    def __init__(self, db_path: str = "alerts.db"):
        self.db_path = db_path
        self._notifier = WebhookNotifier()
        self._failure_counts: dict[str, int] = {}
        self._last_status: dict[str, int] = {}
        self._last_alert_time: dict[str, float] = {}
        self._last_baseline_latency: dict[str, float] = {}
        self._init_db()

    def _init_db(self):
        with sqlite3.connect(self.db_path) as conn:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS alert_events (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    endpoint_id TEXT NOT NULL,
                    alert_type TEXT NOT NULL,
                    severity TEXT NOT NULL,
                    message TEXT NOT NULL,
                    metadata TEXT DEFAULT '{}',
                    fired_at REAL NOT NULL,
                    acknowledged INTEGER DEFAULT 0
                )
            """)
            conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_alerts_endpoint ON alert_events(endpoint_id)"
            )
            conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_alerts_fired ON alert_events(fired_at)"
            )

    def store_rules(self, rules: list[AlertRule]):
        with sqlite3.connect(self.db_path) as conn:
            conn.execute("DROP TABLE IF EXISTS alert_rules")
            conn.execute("""
                CREATE TABLE alert_rules (
                    endpoint_id TEXT NOT NULL,
                    alert_type TEXT NOT NULL,
                    threshold REAL NOT NULL,
                    enabled INTEGER DEFAULT 1,
                    cooldown_seconds INTEGER DEFAULT 300,
                    severity TEXT DEFAULT 'critical'
                )
            """)
            for r in rules:
                conn.execute(
                    "INSERT INTO alert_rules VALUES (?,?,?,?,?,?)",
                    (r.endpoint_id, r.alert_type.value, r.threshold,
                     int(r.enabled), r.cooldown_seconds, r.severity.value),
                )

    def load_rules(self, endpoint_id: Optional[str] = None) -> list[AlertRule]:
        with sqlite3.connect(self.db_path) as conn:
            if endpoint_id:
                rows = conn.execute(
                    "SELECT endpoint_id,alert_type,threshold,enabled,cooldown_seconds,severity "
                    "FROM alert_rules WHERE endpoint_id=? AND enabled=1",
                    (endpoint_id,),
                ).fetchall()
            else:
                rows = conn.execute(
                    "SELECT endpoint_id,alert_type,threshold,enabled,cooldown_seconds,severity "
                    "FROM alert_rules WHERE enabled=1"
                ).fetchall()
        rules = []
        for r in rows:
            rules.append(AlertRule(
                endpoint_id=r[0], alert_type=AlertType(r[1]),
                threshold=r[2], enabled=bool(r[3]),
                cooldown_seconds=r[4], severity=AlertSeverity(r[5]),
            ))
        return rules

    def get_alert_history(self, endpoint_id: Optional[str] = None,
                          limit: int = 100) -> list[dict]:
        with sqlite3.connect(self.db_path) as conn:
            if endpoint_id:
                rows = conn.execute(
                    "SELECT id,endpoint_id,alert_type,severity,message,metadata,fired_at,acknowledged "
                    "FROM alert_events WHERE endpoint_id=? ORDER BY fired_at DESC LIMIT ?",
                    (endpoint_id, limit),
                ).fetchall()
            else:
                rows = conn.execute(
                    "SELECT id,endpoint_id,alert_type,severity,message,metadata,fired_at,acknowledged "
                    "FROM alert_events ORDER BY fired_at DESC LIMIT ?",
                    (limit,),
                ).fetchall()
        results = []
        for r in rows:
            results.append({
                "id": r[0], "endpoint_id": r[1], "alert_type": r[2],
                "severity": r[3], "message": r[4], "metadata": json.loads(r[5]),
                "fired_at": r[6], "acknowledged": bool(r[7]),
            })
        return results

    def _fire_alert(self, rule: AlertRule, message: str, metadata: dict):
        key = f"{rule.endpoint_id}:{rule.alert_type.value}"
        now = time.time()
        last = self._last_alert_time.get(key, 0)
        if now - last < rule.cooldown_seconds:
            logger.debug("Alert %s suppressed by cooldown", key)
            return

        event = AlertEvent(
            endpoint_id=rule.endpoint_id,
            alert_type=rule.alert_type.value,
            severity=rule.severity.value,
            message=message,
            metadata=json.dumps(metadata),
            fired_at=now,
        )
        with sqlite3.connect(self.db_path) as conn:
            cur = conn.execute(
                "INSERT INTO alert_events (endpoint_id,alert_type,severity,message,metadata,fired_at,acknowledged) "
                "VALUES (?,?,?,?,?,?,0)",
                (event.endpoint_id, event.alert_type, event.severity,
                 event.message, event.metadata, event.fired_at),
            )
            event.id = cur.lastrowid

        self._last_alert_time[key] = now
        logger.warning("Alert fired: [%s] %s", rule.severity.value, message)

        try:
            self._notifier.send_alert(event)
        except Exception as exc:
            logger.error("Notification dispatch failed: %s", exc)

    def evaluate(self, result: HealthCheckResult):
        rules = self.load_rules(result.endpoint_id)
        eid = result.endpoint_id

        for rule in rules:
            if rule.alert_type == AlertType.CONSECUTIVE_FAILURES:
                if not result.is_healthy:
                    self._failure_counts[eid] = self._failure_counts.get(eid, 0) + 1
                else:
                    self._failure_counts[eid] = 0

                if self._failure_counts.get(eid, 0) >= rule.threshold:
                    self._fire_alert(
                        rule,
                        f"{eid} has {self._failure_counts[eid]} consecutive failures",
                        {"failure_count": self._failure_counts[eid]},
                    )

            elif rule.alert_type == AlertType.LATENCY_SPIKE:
                if result.latency_ms is not None:
                    baseline = self._last_baseline_latency.get(eid)
                    if baseline is not None and result.latency_ms > rule.threshold:
                        self._fire_alert(
                            rule,
                            f"{eid} latency spike: {result.latency_ms:.0f}ms (threshold {rule.threshold:.0f}ms)",
                            {"latency_ms": result.latency_ms, "threshold": rule.threshold},
                        )
                    if result.is_healthy:
                        self._last_baseline_latency[eid] = result.latency_ms

            elif rule.alert_type == AlertType.STATUS_CHANGE:
                prev = self._last_status.get(eid)
                curr = result.status_code
                if prev is not None and curr is not None and prev != curr:
                    self._fire_alert(
                        rule,
                        f"{eid} status changed: {prev} -> {curr}",
                        {"previous_status": prev, "current_status": curr},
                    )
                if curr is not None:
                    self._last_status[eid] = curr

    def acknowledge_alert(self, alert_id: int) -> bool:
        with sqlite3.connect(self.db_path) as conn:
            cur = conn.execute(
                "UPDATE alert_events SET acknowledged=1 WHERE id=?", (alert_id,)
            )
            return cur.rowcount > 0