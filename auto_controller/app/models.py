from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional


@dataclass
class Preferences:
    comfort_bias: float = 0.6
    battery_bias: float = 0.4


@dataclass
class CurrentTelemetry:
    skin_temp: Optional[float]
    ambient_temp: Optional[float]
    battery_pct: Optional[float]
    heart_rate_bpm: Optional[float]
    spo2_pct: Optional[float]
    pump_speed_pct: Optional[float]
    mode: Optional[str]
    ts: Optional[int]
    last_seen_ts: Optional[int]


@dataclass
class HistoryPoint:
    ts: int
    guard_uid: Optional[str]
    skin_temp: Optional[float]
    ambient_temp: Optional[float]
    battery_pct: Optional[float]
    heart_rate_bpm: Optional[float]
    spo2_pct: Optional[float]
    pump_speed_pct: Optional[float]
    mode: Optional[str]


@dataclass
class DerivedFeatures:
    skin_temp: Optional[float]
    ambient_temp: Optional[float]
    battery_pct: Optional[float]
    heart_rate_bpm: Optional[float]
    spo2_pct: Optional[float]
    current_pump_speed_pct: Optional[float]
    skin_temp_trend_per_min: float
    heart_rate_trend_per_min: float
    sample_count: int


@dataclass
class DecisionResult:
    pump_speed_pct: Optional[int]
    backup_mode: str
    reasons: List[str] = field(default_factory=list)
    debug: Dict[str, Any] = field(default_factory=dict)


@dataclass
class PublishResult:
    should_publish: bool
    reason: str
    command_id: Optional[str] = None
