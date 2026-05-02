from __future__ import annotations

from typing import Any, Dict, List

from .models import DecisionResult, DerivedFeatures, Preferences


def _clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def _norm_between(value: float | None, start: float, end: float) -> float:
    if value is None:
        return 0.0
    if end <= start:
        return 0.0
    return _clamp((value - start) / (end - start), 0.0, 1.0)


def _mode_for_speed(speed_pct: int, mapping: List[Dict[str, Any]]) -> str:
    for row in mapping:
        low = int(row.get("min", 0))
        high = int(row.get("max", 100))
        mode = str(row.get("mode", "NORMAL")).upper()
        if low <= speed_pct <= high:
            return mode
    return "NORMAL"


def _normalize_preferences(pref: Preferences) -> Preferences:
    comfort = _clamp(pref.comfort_bias, 0.0, 1.0)
    battery = _clamp(pref.battery_bias, 0.0, 1.0)
    total = comfort + battery
    if total <= 0.0:
        return Preferences(comfort_bias=0.6, battery_bias=0.4)
    return Preferences(comfort_bias=comfort / total, battery_bias=battery / total)


def decide_auto_output(features: DerivedFeatures, pref: Preferences, cfg: Dict[str, Any]) -> DecisionResult:
    thresholds = cfg["thresholds"]
    weights = cfg["weights"]
    limits = cfg["limits"]
    trend_cfg = cfg["trend"]
    hysteresis = cfg["hysteresis"]
    mapping = cfg["speedToBackupMode"]

    pref = _normalize_preferences(pref)
    reasons: List[str] = []

    skin_score = _norm_between(
        features.skin_temp,
        float(thresholds["skinTempC"]["elevated"]),
        float(thresholds["skinTempC"]["high"]),
    )
    ambient_score = _norm_between(
        features.ambient_temp,
        float(thresholds["ambientTempC"]["warm"]),
        float(thresholds["ambientTempC"]["hot"]),
    )
    hr_score = _norm_between(
        features.heart_rate_bpm,
        float(thresholds["heartRateBpm"]["elevated"]),
        float(thresholds["heartRateBpm"]["high"]),
    )

    temp_trend_score = _norm_between(
        features.skin_temp_trend_per_min,
        0.0,
        float(trend_cfg["tempRisePerMinHigh"]),
    )
    hr_trend_score = _norm_between(
        features.heart_rate_trend_per_min,
        0.0,
        float(trend_cfg["hrRisePerMinHigh"]),
    )

    spo2_low = float(thresholds["spo2Pct"]["low"])
    spo2_critical = float(thresholds["spo2Pct"]["critical"])
    spo2_score = 0.0
    if features.spo2_pct is not None and features.spo2_pct < spo2_low:
        spo2_score = _norm_between(spo2_low - features.spo2_pct, 0.0, max(0.1, spo2_low - spo2_critical))
        reasons.append("spo2_below_low_threshold")

    comfort_component = (
        float(weights["skinTemp"]) * skin_score
        + float(weights["ambientTemp"]) * ambient_score
        + float(weights["heartRate"]) * hr_score
        + float(weights["tempTrend"]) * temp_trend_score
        + float(weights["hrTrend"]) * hr_trend_score
        + float(weights["spo2Safety"]) * spo2_score
    )

    comfort_score = comfort_component * float(weights["comfortScore"])

    battery_penalty = 0.0
    battery = features.battery_pct
    if battery is not None:
        low = float(thresholds["batteryPct"]["low"])
        critical = float(thresholds["batteryPct"]["critical"])
        if battery <= low:
            battery_penalty = _norm_between(low - battery, 0.0, max(0.1, low - critical)) * float(weights["batteryPenalty"])
            reasons.append("battery_low_or_critical")

    base = float(weights["basePumpPct"])
    raw_speed = base + (pref.comfort_bias * comfort_score) - (pref.battery_bias * battery_penalty)

    min_pump = float(limits["minPumpPct"])
    max_pump = float(limits["maxPumpPct"])

    if battery is not None:
        if battery <= float(thresholds["batteryPct"]["critical"]):
            max_pump = min(max_pump, float(limits["maxPumpWhenBatteryCritical"]))
            reasons.append("battery_critical_cap_applied")
        elif battery <= float(thresholds["batteryPct"]["low"]):
            max_pump = min(max_pump, float(limits["maxPumpWhenBatteryLow"]))
            reasons.append("battery_low_cap_applied")

    if features.skin_temp is not None and features.skin_temp >= float(thresholds["skinTempC"]["danger"]):
        raw_speed = max(raw_speed, max_pump * 0.9)
        reasons.append("skin_temp_danger_floor_applied")

    speed = int(round(_clamp(raw_speed, min_pump, max_pump)))

    if bool(hysteresis.get("enabled", True)) and features.current_pump_speed_pct is not None:
        min_change = float(hysteresis.get("minChangePct", 0))
        if abs(speed - features.current_pump_speed_pct) < min_change:
            speed = int(round(features.current_pump_speed_pct))
            reasons.append("hysteresis_kept_current_speed")

    backup_mode = _mode_for_speed(speed, mapping)

    if skin_score > 0.65:
        reasons.append("skin_temp_elevated")
    if ambient_score > 0.65:
        reasons.append("ambient_temp_hot")
    if hr_score > 0.65:
        reasons.append("heart_rate_elevated")
    if temp_trend_score > 0.65:
        reasons.append("skin_temp_rising_fast")
    if hr_trend_score > 0.65:
        reasons.append("heart_rate_rising_fast")

    debug = {
        "scores": {
            "skin": round(skin_score, 4),
            "ambient": round(ambient_score, 4),
            "heartRate": round(hr_score, 4),
            "tempTrend": round(temp_trend_score, 4),
            "hrTrend": round(hr_trend_score, 4),
            "spo2Safety": round(spo2_score, 4),
            "comfort": round(comfort_score, 4),
            "batteryPenalty": round(battery_penalty, 4),
        },
        "bias": {
            "comfortBias": round(pref.comfort_bias, 4),
            "batteryBias": round(pref.battery_bias, 4),
        },
        "rawSpeed": round(raw_speed, 4),
        "clampedSpeed": speed,
        "backupMode": backup_mode,
    }

    return DecisionResult(pump_speed_pct=speed, backup_mode=backup_mode, reasons=reasons, debug=debug)
