import json
import logging
import urllib.request
import urllib.error
from dataclasses import dataclass
from typing import Optional

logger = logging.getLogger(__name__)


@dataclass
class WebhookConfig:
    url: str
    webhook_type: str = "generic"  # "slack", "discord", "generic"
    headers: Optional[dict] = None


class WebhookNotifier:
    def __init__(self, configs: Optional[list[WebhookConfig]] = None):
        self._configs: list[WebhookConfig] = configs or []
        self._load_env_configs()

    def _load_env_configs(self):
        try:
            from dotenv import dotenv_values
            vals = dotenv_values()
        except Exception:
            import os
            vals = dict(os.environ)

        for key, wtype in [("SLACK_WEBHOOK_URL", "slack"),
                           ("DISCORD_WEBHOOK_URL", "discord")]:
            url = vals.get(key, "").strip()
            if url and not any(c.url == url for c in self._configs):
                self._configs.append(WebhookConfig(url=url, webhook_type=wtype))

    def add_config(self, config: WebhookConfig):
        self._configs.append(config)

    def _build_payload(self, config: WebhookConfig, event) -> bytes:
        severity_colors = {
            "critical": "#FF0000", "warning": "#FFA500", "info": "#0080FF",
        }
        color = severity_colors.get(event.severity, "#CCCCCC")

        if config.webhook_type == "slack":
            payload = {
                "attachments": [{
                    "color": color,
                    "title": f"[{event.severity.upper()}] API Alert",
                    "text": event.message,
                    "fields": [
                        {"title": "Endpoint", "value": event.endpoint_id, "short": True},
                        {"title": "Type", "value": event.alert_type, "short": True},
                    ],
                    "ts": int(event.fired_at),
                }]
            }
        elif config.webhook_type == "discord":
            payload = {
                "embeds": [{
                    "title": f"[{event.severity.upper()}] API Alert",
                    "description": event.message,
                    "color": int(color.lstrip("#"), 16),
                    "fields": [
                        {"name": "Endpoint", "value": event.endpoint_id, "inline": True},
                        {"name": "Type", "value": event.alert_type, "inline": True},
                    ],
                    "timestamp": _iso(event.fired_at),
                }]
            }
        else:
            payload = {
                "severity": event.severity,
                "alert_type": event.alert_type,
                "endpoint_id": event.endpoint_id,
                "message": event.message,
                "metadata": json.loads(event.metadata),
                "fired_at": event.fired_at,
            }

        return json.dumps(payload).encode("utf-8")

    def _send(self, config: WebhookConfig, payload: bytes):
        headers = {"Content-Type": "application/json"}
        if config.headers:
            headers.update(config.headers)

        req = urllib.request.Request(config.url, data=payload, headers=headers, method="POST")
        try:
            with urllib.request.urlopen(req, timeout=10) as resp:
                logger.info("Webhook %s responded %s", config.webhook_type, resp.status)
        except urllib.error.HTTPError as e:
            logger.error("Webhook %s HTTP error %s", config.webhook_type, e.code)
            raise
        except urllib.error.URLError as e:
            logger.error("Webhook %s URL error %s", config.webhook_type, e.reason)
            raise

    def send_alert(self, event):
        if not self._configs:
            logger.warning("No webhook configs registered; skipping notification")
            return

        for config in self._configs:
            try:
                payload = self._build_payload(config, event)
                self._send(config, payload)
            except Exception as exc:
                logger.error("Failed to send %s webhook: %s", config.webhook_type, exc)


def _iso(ts: float) -> str:
    from datetime import datetime, timezone
    return datetime.fromtimestamp(ts, tz=timezone.utc).isoformat()