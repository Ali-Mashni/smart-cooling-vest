from __future__ import annotations

from typing import List

from .models import CurrentTelemetry, DerivedFeatures, HistoryPoint


def _safe_delta_per_min(first_ts: int, first_val: float, last_ts: int, last_val: float) -> float:
    dt_ms = max(1, last_ts - first_ts)
    dt_min = dt_ms / 60000.0
    return (last_val - first_val) / dt_min


def _trend(values: List[tuple[int, float]]) -> float:
    if len(values) < 2:
        return 0.0
    first_ts, first_val = values[0]
    last_ts, last_val = values[-1]
    return _safe_delta_per_min(first_ts, first_val, last_ts, last_val)


def extract_features(current: CurrentTelemetry, history: List[HistoryPoint], min_records_for_trend: int) -> DerivedFeatures:
    skin_series: List[tuple[int, float]] = []
    hr_series: List[tuple[int, float]] = []

    for point in sorted(history, key=lambda x: x.ts):
        if point.skin_temp is not None:
            skin_series.append((point.ts, float(point.skin_temp)))
        if point.heart_rate_bpm is not None:
            hr_series.append((point.ts, float(point.heart_rate_bpm)))

    skin_trend = _trend(skin_series) if len(skin_series) >= min_records_for_trend else 0.0
    hr_trend = _trend(hr_series) if len(hr_series) >= min_records_for_trend else 0.0

    return DerivedFeatures(
        skin_temp=current.skin_temp,
        ambient_temp=current.ambient_temp,
        battery_pct=current.battery_pct,
        heart_rate_bpm=current.heart_rate_bpm,
        spo2_pct=current.spo2_pct,
        current_pump_speed_pct=current.pump_speed_pct,
        skin_temp_trend_per_min=skin_trend,
        heart_rate_trend_per_min=hr_trend,
        sample_count=len(history),
    )
