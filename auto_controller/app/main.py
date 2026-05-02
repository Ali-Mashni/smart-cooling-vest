from __future__ import annotations

import json
import logging
import os
import time
from pathlib import Path
from typing import Any, Dict

from dotenv import load_dotenv

from .command_publisher import CommandPublisher
from .decision_engine import decide_auto_output
from .feature_extractor import extract_features
from .rtdb_client import FirebaseAuthRestClient, FirebaseRtdbRestClient


def _load_config(config_path: str) -> Dict[str, Any]:
    with open(config_path, "r", encoding="utf-8") as f:
        return json.load(f)


def _is_online(last_seen_ts: int | None, threshold_ms: int) -> bool:
    if last_seen_ts is None:
        return False
    now_ms = int(time.time() * 1000)
    return (now_ms - last_seen_ts) < threshold_ms


def _build_client_from_env() -> FirebaseRtdbRestClient:
    api_key = os.getenv("FIREBASE_API_KEY", "").strip()
    db_url = os.getenv("FIREBASE_DB_URL", "").strip()
    worker_email = os.getenv("WORKER_EMAIL", "").strip()
    worker_password = os.getenv("WORKER_PASSWORD", "").strip()

    missing = [name for name, value in [("FIREBASE_API_KEY", api_key), ("FIREBASE_DB_URL", db_url)] if not value]
    if missing:
        raise RuntimeError(f"Missing required env vars: {', '.join(missing)}")

    if bool(worker_email) ^ bool(worker_password):
        raise RuntimeError("WORKER_EMAIL and WORKER_PASSWORD must both be provided together")

    if worker_email and worker_password:
        auth_client = FirebaseAuthRestClient(api_key=api_key, email=worker_email, password=worker_password)
        return FirebaseRtdbRestClient(db_url=db_url, auth_client=auth_client)

    return FirebaseRtdbRestClient(db_url=db_url)


def run_loop() -> None:
    env_path = Path(__file__).resolve().parents[1] / ".env"
    load_dotenv(env_path)

    log_level = os.getenv("LOG_LEVEL", "INFO").upper()
    logging.basicConfig(
        level=getattr(logging, log_level, logging.INFO),
        format="%(asctime)s %(levelname)s %(message)s",
    )
    logger = logging.getLogger("auto_controller")

    default_config_path = Path(__file__).resolve().parents[1] / "config" / "auto_rules.json"
    config_path = Path(os.getenv("AUTO_RULES_PATH", str(default_config_path)))
    cfg = _load_config(config_path)

    client = _build_client_from_env()
    publisher = CommandPublisher(
        client=client,
        min_interval_ms=int(cfg["publishing"]["minIntervalMs"]),
        min_speed_change_pct=int(cfg["publishing"]["minSpeedChangePct"]),
    )

    interval_s = float(cfg["polling"]["intervalSeconds"])
    history_limit = int(cfg["polling"]["historyLimit"])
    online_threshold_ms = int(cfg["polling"]["onlineThresholdMs"])
    min_records = int(cfg["trend"]["windowMinRecords"])

    logger.info("AUTO worker started with polling interval %.1fs", interval_s)

    while True:
        loop_start = time.time()

        try:
            vest_ids = client.list_vest_ids()
        except Exception as exc:
            logger.exception("Failed listing vests: %s", exc)
            vest_ids = []

        for vest_id in vest_ids:
            try:
                state = client.get_state(vest_id)
                control_mode = str(state.get("controlMode", "")).upper()
                guard_uid = str(state.get("guardUid", "")).strip()

                if control_mode != "AUTO":
                    logger.debug("vest=%s skip because controlMode=%s", vest_id, control_mode or "missing")
                    continue
                if not guard_uid:
                    logger.warning("vest=%s in AUTO but state.guardUid missing", vest_id)
                    continue

                current = client.get_current(vest_id)
                if not _is_online(current.last_seen_ts, online_threshold_ms):
                    logger.info("vest=%s skipped because vest appears offline", vest_id)
                    continue

                history = client.get_recent_history(vest_id, history_limit)
                prefs = client.get_preferences(guard_uid, cfg["defaults"])
                features = extract_features(current, history, min_records)
                decision = decide_auto_output(features, prefs, cfg)
                publish = publisher.maybe_publish_auto_pump(vest_id, decision)

                if publish.should_publish:
                    logger.info(
                        "vest=%s cmd=%s speed=%s backup=%s reasons=%s",
                        vest_id,
                        publish.command_id,
                        decision.pump_speed_pct,
                        decision.backup_mode,
                        ",".join(decision.reasons) or "none",
                    )
                else:
                    logger.debug(
                        "vest=%s no publish reason=%s speed=%s backup=%s",
                        vest_id,
                        publish.reason,
                        decision.pump_speed_pct,
                        decision.backup_mode,
                    )
            except Exception as exc:
                logger.exception("vest=%s processing error: %s", vest_id, exc)

        elapsed = time.time() - loop_start
        sleep_s = max(0.0, interval_s - elapsed)
        time.sleep(sleep_s)


def main() -> int:
    try:
        run_loop()
        return 0
    except KeyboardInterrupt:
        return 0


if __name__ == "__main__":
    raise SystemExit(main())
