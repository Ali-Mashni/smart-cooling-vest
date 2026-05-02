from __future__ import annotations

import json
from pathlib import Path

from auto_controller.app.decision_engine import decide_auto_output
from auto_controller.app.models import DerivedFeatures, Preferences


def _cfg() -> dict:
    p = Path(__file__).resolve().parents[1] / "config" / "auto_rules.json"
    return json.loads(p.read_text(encoding="utf-8"))


def test_hot_conditions_push_boost() -> None:
    cfg = _cfg()
    features = DerivedFeatures(
        skin_temp=37.2,
        ambient_temp=39.0,
        battery_pct=82,
        heart_rate_bpm=122,
        spo2_pct=97,
        current_pump_speed_pct=40,
        skin_temp_trend_per_min=0.2,
        heart_rate_trend_per_min=3.5,
        sample_count=8,
    )
    pref = Preferences(comfort_bias=0.8, battery_bias=0.2)

    result = decide_auto_output(features, pref, cfg)

    assert result.pump_speed_pct is not None
    assert result.pump_speed_pct >= 65
    assert result.backup_mode == "BOOST"


def test_low_battery_caps_speed() -> None:
    cfg = _cfg()
    features = DerivedFeatures(
        skin_temp=35.4,
        ambient_temp=34.5,
        battery_pct=10,
        heart_rate_bpm=95,
        spo2_pct=98,
        current_pump_speed_pct=65,
        skin_temp_trend_per_min=0.02,
        heart_rate_trend_per_min=0.3,
        sample_count=8,
    )
    pref = Preferences(comfort_bias=0.5, battery_bias=0.5)

    result = decide_auto_output(features, pref, cfg)

    max_cap = int(cfg["limits"]["maxPumpWhenBatteryCritical"])
    assert result.pump_speed_pct is not None
    assert result.pump_speed_pct <= max_cap
