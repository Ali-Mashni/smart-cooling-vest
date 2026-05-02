from __future__ import annotations

import time
from dataclasses import dataclass
from typing import Dict

from .models import DecisionResult, PublishResult
from .rtdb_client import FirebaseRtdbRestClient


@dataclass
class LastPublishState:
    ts_ms: int
    speed: int


class CommandPublisher:
    def __init__(self, client: FirebaseRtdbRestClient, min_interval_ms: int, min_speed_change_pct: int):
        self.client = client
        self.min_interval_ms = min_interval_ms
        self.min_speed_change_pct = min_speed_change_pct
        self._last_by_vest: Dict[str, LastPublishState] = {}

    def maybe_publish_auto_pump(self, vest_id: str, decision: DecisionResult) -> PublishResult:
        if decision.pump_speed_pct is None:
            return PublishResult(False, "no_speed_computed")

        now_ms = int(time.time() * 1000)
        prev = self._last_by_vest.get(vest_id)
        if prev is not None:
            within_interval = (now_ms - prev.ts_ms) < self.min_interval_ms
            tiny_change = abs(prev.speed - decision.pump_speed_pct) < self.min_speed_change_pct
            if within_interval and tiny_change:
                return PublishResult(False, "rate_limited_small_change")

        cmd_id = self.client.push_command(
            vest_id=vest_id,
            command={
                "cmd": "set_auto_pump",
                "value": {
                    "pumpSpeedPct": decision.pump_speed_pct,
                    "backupMode": decision.backup_mode,
                },
                "ts": now_ms,
            },
        )

        self._last_by_vest[vest_id] = LastPublishState(ts_ms=now_ms, speed=decision.pump_speed_pct)
        return PublishResult(True, "published", command_id=cmd_id)
