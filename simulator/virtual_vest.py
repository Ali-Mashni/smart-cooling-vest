#!/usr/bin/env python3
from __future__ import annotations

import math
import os
import random
import sys
import time
from dataclasses import dataclass
from typing import Any, Dict, Optional, Set

import requests
from requests.exceptions import RequestException
from dotenv import load_dotenv

load_dotenv(".env")

# =========================
# CONFIG
# =========================
FIREBASE_API_KEY = os.getenv("FIREBASE_API_KEY", "PASTE_API_KEY_HERE")
FIREBASE_DB_URL = os.getenv("FIREBASE_DB_URL", "https://PASTE_DB.firebaseio.com")

DEVICE_EMAIL = os.getenv("DEVICE_EMAIL", "device-vest-002@test.com")
DEVICE_PASSWORD = os.getenv("DEVICE_PASSWORD", "PASTE_DEVICE_PASSWORD_HERE")
VEST_ID = os.getenv("VEST_ID", "vest002")

# Matches the real vest target behavior.
CURRENT_MIN_S, CURRENT_MAX_S = 5, 5       # /current update interval
HIST_MIN_S, HIST_MAX_S = 10, 20           # /history append interval
GPS_MIN_S, GPS_MAX_S = 30, 80             # GNSS update interval
CMD_POLL_S = 0.35                         # fast command ACK polling

# Offline simulation. Set OFFLINE_EVERY_S=0 to disable.
OFFLINE_EVERY_S = float(os.getenv("OFFLINE_EVERY_S", "0"))
OFFLINE_DURATION_S = float(os.getenv("OFFLINE_DURATION_S", "25"))
DROP_ACKS_WHEN_OFFLINE = os.getenv("DROP_ACKS_WHEN_OFFLINE", "false").lower() == "true"

# Sensor failure simulation probabilities per /current update.
# Defaults are 0 so demo data stays clean unless you intentionally test failures.
TEMP_SENSOR_FAIL_PROB = float(os.getenv("TEMP_SENSOR_FAIL_PROB", "0"))
PPG_SENSOR_FAIL_PROB = float(os.getenv("PPG_SENSOR_FAIL_PROB", "0"))
PPG_CONTACT_DROP_PROB = float(os.getenv("PPG_CONTACT_DROP_PROB", "0"))
DHT_SENSOR_FAIL_PROB = float(os.getenv("DHT_SENSOR_FAIL_PROB", "0"))
INA260_SENSOR_FAIL_PROB = float(os.getenv("INA260_SENSOR_FAIL_PROB", "0"))
FLOW_SENSOR_FAIL_PROB = float(os.getenv("FLOW_SENSOR_FAIL_PROB", "0"))
GNSS_SENSOR_FAIL_PROB = float(os.getenv("GNSS_SENSOR_FAIL_PROB", "0"))
GPS_FIX_DROP_PROB = float(os.getenv("GPS_FIX_DROP_PROB", "0.02"))

# GPS start, Dhahran/Aramco-ish.
GPS_START_LAT = float(os.getenv("GPS_START_LAT", "26.31"))
GPS_START_LNG = float(os.getenv("GPS_START_LNG", "50.14"))
GPS_STEP_M = float(os.getenv("GPS_STEP_M", "1.5"))

# Mode command behavior.
ACK_REJECT_PROB = float(os.getenv("ACK_REJECT_PROB", "0"))

# Optional environment transitions make charts more useful.
SIMULATE_ENV_TRANSITIONS = os.getenv("SIMULATE_ENV_TRANSITIONS", "true").lower() == "true"

VALID_MODES = {"Off", "Eco", "Normal", "Boost", "Auto"}
MODE_PUMP_DEFAULTS = {
    "Off": 0,
    "Eco": 30,
    "Normal": 50,
    "Boost": 80,
}


def now_ms() -> int:
    return int(time.time() * 1000)


def clamp(x: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, x))


def jitter(x: float, amount: float) -> float:
    return x + random.uniform(-amount, amount)


def rand_between(a: float, b: float) -> float:
    return random.uniform(a, b)


def approach(current: float, target: float, rate: float, dt_s: float) -> float:
    """Exponential-ish smoothing toward a target."""
    alpha = 1.0 - math.exp(-max(0.0, rate) * max(0.0, dt_s))
    return current + (target - current) * clamp(alpha, 0.0, 1.0)


def normalize_mode(value: Any) -> Optional[str]:
    raw = str(value).strip().lower()
    aliases = {
        "off": "Off",
        "eco": "Eco",
        "normal": "Normal",
        "norm": "Normal",
        "boost": "Boost",
        "auto": "Auto",
        "automatic": "Auto",
    }
    return aliases.get(raw)


def is_bad_env(value: str) -> bool:
    return not value or value.startswith("PASTE_") or value == "https://PASTE_DB.firebaseio.com"


@dataclass
class AuthSession:
    id_token: str
    refresh_token: str
    expires_at: float


class FirebaseAuthRest:
    def __init__(self, api_key: str, timeout_s: float = 10.0):
        self.api_key = api_key
        self.timeout_s = timeout_s

    def sign_in_with_password(self, email: str, password: str) -> AuthSession:
        url = f"https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key={self.api_key}"
        payload = {"email": email, "password": password, "returnSecureToken": True}
        r = requests.post(url, json=payload, timeout=self.timeout_s)
        if r.status_code != 200:
            raise RuntimeError(f"Auth failed ({r.status_code}): {r.text}")
        data = r.json()
        expires_in = int(data.get("expiresIn", "3600"))
        return AuthSession(
            id_token=data["idToken"],
            refresh_token=data["refreshToken"],
            expires_at=time.time() + max(30, expires_in - 30),
        )

    def refresh_id_token(self, refresh_token: str) -> AuthSession:
        url = f"https://securetoken.googleapis.com/v1/token?key={self.api_key}"
        payload = {"grant_type": "refresh_token", "refresh_token": refresh_token}
        headers = {"Content-Type": "application/x-www-form-urlencoded"}
        r = requests.post(url, data=payload, headers=headers, timeout=self.timeout_s)
        if r.status_code != 200:
            raise RuntimeError(f"Refresh failed ({r.status_code}): {r.text}")
        data = r.json()
        expires_in = int(data.get("expires_in", "3600"))
        return AuthSession(
            id_token=data["id_token"],
            refresh_token=data["refresh_token"],
            expires_at=time.time() + max(30, expires_in - 30),
        )


class TokenProvider:
    def __init__(self, auth: FirebaseAuthRest, email: str, password: str):
        self.auth = auth
        self.email = email
        self.password = password
        self.session: Optional[AuthSession] = None

    def _ensure(self) -> None:
        if self.session is None:
            self.session = self.auth.sign_in_with_password(self.email, self.password)
            return
        if time.time() >= self.session.expires_at:
            self.session = self.auth.refresh_id_token(self.session.refresh_token)

    def get(self) -> str:
        self._ensure()
        assert self.session is not None
        return self.session.id_token


class FirebaseRtdbRest:
    def __init__(self, db_url: str, token_provider: TokenProvider, timeout_s: float = 10.0):
        self.db_url = db_url.rstrip("/")
        self.tp = token_provider
        self.timeout_s = timeout_s

    def _url(self, path: str) -> str:
        p = path.strip("/")
        return f"{self.db_url}/{p}.json?auth={self.tp.get()}"

    def get(self, path: str) -> Any:
        r = requests.get(self._url(path), timeout=self.timeout_s)
        if r.status_code != 200:
            raise RuntimeError(f"GET {path} failed ({r.status_code}): {r.text}")
        return r.json()

    def put(self, path: str, value: Any) -> None:
        r = requests.put(self._url(path), json=value, timeout=self.timeout_s)
        if r.status_code not in (200, 204):
            raise RuntimeError(f"PUT {path} failed ({r.status_code}): {r.text}")

    def patch(self, path: str, value: Dict[str, Any]) -> None:
        r = requests.patch(self._url(path), json=value, timeout=self.timeout_s)
        if r.status_code not in (200, 204):
            raise RuntimeError(f"PATCH {path} failed ({r.status_code}): {r.text}")

    def post(self, path: str, value: Any) -> str:
        r = requests.post(self._url(path), json=value, timeout=self.timeout_s)
        if r.status_code != 200:
            raise RuntimeError(f"POST {path} failed ({r.status_code}): {r.text}")
        return r.json().get("name", "")


@dataclass
class GpsState:
    lat: float
    lng: float
    fix: bool
    accuracy_m: float
    gps_ts: int


class VirtualVest:
    def __init__(self, rtdb: FirebaseRtdbRest, vest_id: str):
        self.rtdb = rtdb
        self.vest_id = vest_id

        self.started_mono_s = time.time()
        self.last_physics_s = self.started_mono_s

        self.mode = "Eco"
        self.pump_pct = MODE_PUMP_DEFAULTS[self.mode]

        # Human/environment telemetry state.
        self.ambient_temp = 38.0
        self.ambient_target = 39.0
        self.next_env_target_at = time.time() + rand_between(70, 150)
        self.humidity = 36.0

        self.body_temp = 37.0
        self.skin_temp = 35.4
        self.ppg_temp = 35.8
        self.heart_rate_bpm = 82.0
        self.spo2_pct = 98.0

        # Cooling loop telemetry state.
        self.pcm_temp = 18.0
        self.inlet_temp = 22.0
        self.outlet_temp = 23.0
        self.flow_rate_l_min = 0.0
        self.flow_total_l = 0.0

        # Battery/power telemetry state.
        self.battery_pct = 90.0
        self.battery_voltage = 12.2
        self.battery_current_ma = 0.0
        self.battery_power_mw = 0.0

        self.gps = GpsState(GPS_START_LAT, GPS_START_LNG, True, 6.0, now_ms())

        # Individual sensor health flags exposed to UI.
        self.sensor_ok: Dict[str, bool] = {
            "inlet": True,
            "outlet": True,
            "body": True,
            "pcm": True,
            "ppg": True,
            "gnss": True,
            "dht": True,
            "ina260": True,
            "flow": True,
        }

        # Last successful update timestamps for sensorAgeMs groups.
        t = now_ms()
        self.last_success_ms: Dict[str, int] = {
            "temp": t,
            "ppg": t,
            "gnss": t,
            "dht": t,
            "ina260": t,
            "flow": t,
        }

        self.seen_cmds: Set[str] = set()

        now = time.time()
        self.next_current_at = now
        self.next_history_at = now
        self.next_gps_at = now
        self.next_offline_at = now + (OFFLINE_EVERY_S if OFFLINE_EVERY_S > 0 else 10**18)
        self.offline_until = 0.0

    def log(self, msg: str) -> None:
        print(f"[{time.strftime('%H:%M:%S')}] {msg}", flush=True)

    def is_offline(self) -> bool:
        return time.time() < self.offline_until

    def maybe_offline(self) -> None:
        if OFFLINE_EVERY_S <= 0:
            return
        now = time.time()
        if now >= self.next_offline_at:
            self.offline_until = now + max(1.0, OFFLINE_DURATION_S)
            self.next_offline_at = now + OFFLINE_EVERY_S
            self.log(f"OFFLINE start for {OFFLINE_DURATION_S:.0f}s")

    def schedule_next(self, kind: str) -> None:
        now = time.time()
        if kind == "current":
            self.next_current_at = now + rand_between(CURRENT_MIN_S, CURRENT_MAX_S)
        elif kind == "history":
            self.next_history_at = now + rand_between(HIST_MIN_S, HIST_MAX_S)
        elif kind == "gps":
            self.next_gps_at = now + rand_between(GPS_MIN_S, GPS_MAX_S)

    def sample_sensor_health(self) -> None:
        self.sensor_ok["inlet"] = random.random() >= TEMP_SENSOR_FAIL_PROB
        self.sensor_ok["outlet"] = random.random() >= TEMP_SENSOR_FAIL_PROB
        self.sensor_ok["body"] = random.random() >= TEMP_SENSOR_FAIL_PROB
        self.sensor_ok["pcm"] = random.random() >= TEMP_SENSOR_FAIL_PROB

        # PPG can fail because the sensor is unavailable or because finger contact is lost.
        ppg_sensor_ok = random.random() >= PPG_SENSOR_FAIL_PROB
        ppg_contact_ok = random.random() >= PPG_CONTACT_DROP_PROB
        self.sensor_ok["ppg"] = ppg_sensor_ok and ppg_contact_ok

        self.sensor_ok["dht"] = random.random() >= DHT_SENSOR_FAIL_PROB
        self.sensor_ok["ina260"] = random.random() >= INA260_SENSOR_FAIL_PROB
        self.sensor_ok["flow"] = random.random() >= FLOW_SENSOR_FAIL_PROB
        self.sensor_ok["gnss"] = random.random() >= GNSS_SENSOR_FAIL_PROB

    def maybe_change_environment_target(self) -> None:
        if not SIMULATE_ENV_TRANSITIONS:
            return
        now = time.time()
        if now < self.next_env_target_at:
            return

        # Mostly hot outdoor Saudi-like environment, sometimes AC room.
        if random.random() < 0.35:
            self.ambient_target = random.uniform(23.0, 28.0)   # indoor AC break
        else:
            self.ambient_target = random.uniform(35.0, 43.0)   # outdoor heat
        self.next_env_target_at = now + rand_between(90, 210)
        self.log(f"Environment target changed -> {self.ambient_target:.1f} C")

    def update_gps(self) -> None:
        g = self.gps
        t = now_ms()

        if not self.sensor_ok.get("gnss", True):
            g.fix = False
            g.accuracy_m = 0.0
            return

        if random.random() < GPS_FIX_DROP_PROB:
            # Receiver exists, but no current fix. Keep last known lat/lng.
            g.fix = False
            g.accuracy_m = clamp(jitter(90.0, 45.0), 25.0, 200.0)
            return

        g.fix = True
        g.accuracy_m = clamp(jitter(6.0, 3.0), 2.0, 25.0)

        if GPS_STEP_M > 0:
            d_m = random.uniform(-GPS_STEP_M, GPS_STEP_M)
            bearing = random.uniform(0, 2 * math.pi)
            dx = d_m * math.cos(bearing)
            dy = d_m * math.sin(bearing)
            dlat = dy / 111_111.0
            dlng = dx / (111_111.0 * max(0.1, math.cos(math.radians(g.lat))))
            g.lat += dlat
            g.lng += dlng

        g.gps_ts = t
        self.last_success_ms["gnss"] = t

    def update_sensors(self) -> None:
        now_s = time.time()
        dt_s = clamp(now_s - self.last_physics_s, 0.05, 30.0)
        self.last_physics_s = now_s
        t = now_ms()

        self.sample_sensor_health()
        self.maybe_change_environment_target()

        # Environment model.
        self.ambient_temp = approach(self.ambient_temp, self.ambient_target, 0.018, dt_s)
        self.ambient_temp = clamp(jitter(self.ambient_temp, 0.06), 20.0, 46.0)
        humidity_target = clamp(55.0 - (self.ambient_temp - 25.0) * 1.1, 20.0, 60.0)
        self.humidity = clamp(approach(self.humidity, humidity_target, 0.02, dt_s) + random.uniform(-0.2, 0.2), 18.0, 65.0)

        pump_factor = self.pump_pct / 100.0
        heat_load = max(0.0, self.ambient_temp - 30.0)
        cooling_strength = pump_factor * 1.15

        # Human temperature model. Cautious simulation only, not medical truth.
        skin_target = 35.2 + heat_load * 0.045 - cooling_strength * 0.75
        body_target = 37.0 + heat_load * 0.012 - cooling_strength * 0.12
        if self.mode == "Off":
            skin_target += 0.25
            body_target += 0.04

        self.skin_temp = clamp(approach(self.skin_temp, skin_target, 0.045, dt_s) + random.uniform(-0.04, 0.04), 30.0, 41.0)
        self.body_temp = clamp(approach(self.body_temp, body_target, 0.020, dt_s) + random.uniform(-0.015, 0.015), 35.5, 39.5)
        self.ppg_temp = clamp(approach(self.ppg_temp, (self.skin_temp + self.body_temp) / 2.0, 0.050, dt_s) + random.uniform(-0.03, 0.03), 30.0, 40.0)

        # Cooling loop model.
        if self.pump_pct <= 0:
            self.flow_rate_l_min = 0.0
            loop_target = approach((self.inlet_temp + self.outlet_temp) / 2.0, self.ambient_temp, 0.006, dt_s)
            self.inlet_temp = clamp(approach(self.inlet_temp, loop_target, 0.035, dt_s), 15.0, 45.0)
            self.outlet_temp = clamp(approach(self.outlet_temp, loop_target, 0.035, dt_s), 15.0, 45.0)
            self.pcm_temp = clamp(approach(self.pcm_temp, self.ambient_temp, 0.0025, dt_s), 15.0, 45.0)
        else:
            flow_nominal = 0.12 + 1.25 * pump_factor
            self.flow_rate_l_min = clamp(jitter(flow_nominal, 0.04), 0.05, 1.8)
            self.flow_total_l += self.flow_rate_l_min * (dt_s / 60.0)

            # PCM warms as it absorbs heat; hotter environment and higher pump warm it faster.
            pcm_warm_rate = 0.0018 + 0.0040 * pump_factor + 0.0005 * heat_load
            self.pcm_temp = clamp(self.pcm_temp + pcm_warm_rate * dt_s + random.uniform(-0.01, 0.01), 16.0, 42.0)

            inlet_target = clamp(self.pcm_temp + 1.2 + pump_factor * 0.8, 17.0, 33.0)
            self.inlet_temp = clamp(approach(self.inlet_temp, inlet_target, 0.09, dt_s) + random.uniform(-0.03, 0.03), 16.0, 42.0)

            heat_pickup = clamp((self.skin_temp - self.inlet_temp) * 0.10 * (0.4 + pump_factor), 0.25, 3.2)
            outlet_target = self.inlet_temp + heat_pickup
            self.outlet_temp = clamp(approach(self.outlet_temp, outlet_target, 0.12, dt_s) + random.uniform(-0.04, 0.04), 16.0, 43.0)

        # Battery/power model.
        self.battery_current_ma = clamp(120.0 + 24.0 * self.pump_pct + random.uniform(-35, 35), 60.0, 2800.0)
        drain_pct_per_hour = 0.55 + 5.7 * pump_factor
        self.battery_pct = clamp(self.battery_pct - drain_pct_per_hour * (dt_s / 3600.0), 0.0, 100.0)
        self.battery_voltage = clamp(10.8 + 1.8 * (self.battery_pct / 100.0) - 0.00018 * self.battery_current_ma, 10.4, 12.7)
        self.battery_power_mw = self.battery_voltage * self.battery_current_ma

        # Vitals model.
        heat_stress = max(0.0, self.ambient_temp - 30.0) * 1.2 + max(0.0, self.skin_temp - 35.5) * 12.0
        cooling_relief = pump_factor * 7.0
        hr_target = 72.0 + heat_stress - cooling_relief
        if self.mode == "Boost":
            hr_target += 3.0
        self.heart_rate_bpm = clamp(approach(self.heart_rate_bpm, hr_target, 0.055, dt_s) + random.uniform(-1.5, 1.5), 55.0, 145.0)
        self.spo2_pct = clamp(approach(self.spo2_pct, 98.0 - max(0.0, heat_stress - 12.0) * 0.025, 0.05, dt_s) + random.uniform(-0.15, 0.15), 94.0, 100.0)

        # Update sensor ages only when the sensor group is actually OK.
        if any(self.sensor_ok[k] for k in ("inlet", "outlet", "body", "pcm")):
            self.last_success_ms["temp"] = t
        if self.sensor_ok["ppg"]:
            self.last_success_ms["ppg"] = t
        if self.sensor_ok["dht"]:
            self.last_success_ms["dht"] = t
        if self.sensor_ok["ina260"]:
            self.last_success_ms["ina260"] = t
        if self.sensor_ok["flow"]:
            self.last_success_ms["flow"] = t

    def sensor_age_ms(self) -> Dict[str, int]:
        t = now_ms()
        return {k: max(0, t - v) for k, v in self.last_success_ms.items()}

    def rounded_current_values(self) -> Dict[str, Any]:
        """Return values exactly as firmware-like UI expects: failed sensors write 0."""
        temp_ok = self.sensor_ok
        ppg_ok = self.sensor_ok["ppg"]
        dht_ok = self.sensor_ok["dht"]
        ina_ok = self.sensor_ok["ina260"]
        flow_ok = self.sensor_ok["flow"]

        return {
            "skinTemp": round(self.skin_temp, 2) if temp_ok["body"] else 0,
            "bodyTemp": round(self.body_temp, 2) if temp_ok["body"] else 0,
            "inletTemp": round(self.inlet_temp, 2) if temp_ok["inlet"] else 0,
            "outletTemp": round(self.outlet_temp, 2) if temp_ok["outlet"] else 0,
            "pcmTemp": round(self.pcm_temp, 2) if temp_ok["pcm"] else 0,
            "ppgTemp": round(self.ppg_temp, 2) if ppg_ok else 0,
            "heartRateBpm": int(round(self.heart_rate_bpm)) if ppg_ok else 0,
            "spo2Pct": round(self.spo2_pct, 1) if ppg_ok else 0,
            "ambientTemp": round(self.ambient_temp, 2) if dht_ok else 0,
            "humidity": round(self.humidity, 1) if dht_ok else 0,
            "batteryPct": round(self.battery_pct, 2) if ina_ok else 0,
            "batteryVoltage": round(self.battery_voltage, 2) if ina_ok else 0,
            "batteryCurrentMa": round(self.battery_current_ma, 1) if ina_ok else 0,
            "batteryPowerMw": round(self.battery_power_mw, 1) if ina_ok else 0,
            "flowRateLMin": round(self.flow_rate_l_min, 3) if flow_ok else 0,
            "flowTotalL": round(self.flow_total_l, 3) if flow_ok else 0,
        }

    def current_payload(self) -> Dict[str, Any]:
        ts = now_ms()
        values = self.rounded_current_values()
        return {
            "ts": ts,
            "lastSeenTs": ts,
            "mode": self.mode,
            "pumpPct": int(round(self.pump_pct)),
            **values,
            "gps": {
                "lat": round(self.gps.lat, 7) if self.sensor_ok["gnss"] else 0,
                "lng": round(self.gps.lng, 7) if self.sensor_ok["gnss"] else 0,
                "fix": bool(self.gps.fix and self.sensor_ok["gnss"]),
                "accuracyM": round(self.gps.accuracy_m, 1) if self.sensor_ok["gnss"] and self.gps.fix else 0,
                "gpsTs": self.gps.gps_ts,
            },
            "sensorOk": dict(self.sensor_ok),
            "sensorAgeMs": self.sensor_age_ms(),
            "uptimeMs": int((time.time() - self.started_mono_s) * 1000),
        }

    def history_payload(self) -> Dict[str, Any]:
        ts = now_ms()
        values = self.rounded_current_values()
        return {
            "ts": ts,
            "mode": self.mode,
            "pumpPct": int(round(self.pump_pct)),
            **values,
            "gpsFix": bool(self.gps.fix and self.sensor_ok["gnss"]),
            "gpsLat": round(self.gps.lat, 7) if self.sensor_ok["gnss"] else 0,
            "gpsLng": round(self.gps.lng, 7) if self.sensor_ok["gnss"] else 0,
            "gpsTs": self.gps.gps_ts,
            "sensorOk": dict(self.sensor_ok),
            "ppgOk": bool(self.sensor_ok["ppg"]),  # compatibility with older UI/dev tools
        }

    def write_meta_and_initial_current(self) -> None:
        try:
            self.rtdb.patch(f"vests/{self.vest_id}/meta", {"label": self.vest_id, "simulated": True})
        except Exception as e:
            self.log(f"WARN: could not write meta: {e}")

        self.update_sensors()
        try:
            self.rtdb.put(f"vests/{self.vest_id}/current", self.current_payload())
            self.log("Initial current payload written")
        except Exception as e:
            self.log(f"WARN: could not write initial current: {e}")

    def init_seen_commands(self) -> None:
        cmds = self.rtdb.get(f"vests/{self.vest_id}/commands")
        if isinstance(cmds, dict):
            self.seen_cmds |= set(cmds.keys())
        self.log(f"Seen commands initialized: {len(self.seen_cmds)}")

    def poll_commands(self) -> None:
        cmds = self.rtdb.get(f"vests/{self.vest_id}/commands")
        if not isinstance(cmds, dict):
            return
        for cmd_id, cmd_obj in cmds.items():
            if cmd_id in self.seen_cmds:
                continue
            self.seen_cmds.add(cmd_id)
            if not isinstance(cmd_obj, dict):
                cmd_obj = {}
            self.handle_command(cmd_id, cmd_obj)

    def ack(self, cmd_id: str, status: str, message: Optional[str] = None) -> None:
        payload: Dict[str, Any] = {"status": status, "ts": now_ms()}
        if message:
            payload["message"] = message
        self.rtdb.put(f"vests/{self.vest_id}/acks/{cmd_id}", payload)

    def patch_current_fast(self, extra: Dict[str, Any]) -> None:
        ts = now_ms()
        self.rtdb.patch(f"vests/{self.vest_id}/current", {"ts": ts, "lastSeenTs": ts, **extra})

    def handle_command(self, cmd_id: str, cmd: Dict[str, Any]) -> None:
        if self.is_offline() and DROP_ACKS_WHEN_OFFLINE:
            self.log(f"OFFLINE ignoring cmd {cmd_id}")
            return

        cmd_name = str(cmd.get("cmd", "")).strip()
        value = cmd.get("value")
        time.sleep(random.uniform(0.04, 0.09))

        if random.random() < ACK_REJECT_PROB:
            self.ack(cmd_id, "rejected", "simulated reject")
            self.log(f"ACK rejected {cmd_name} value={value}")
            return

        if cmd_name == "set_mode":
            new_mode = normalize_mode(value)
            if new_mode not in VALID_MODES:
                self.ack(cmd_id, "rejected", f"invalid mode {value}")
                self.log(f"ACK rejected invalid set_mode value={value}")
                return

            self.mode = new_mode
            if self.mode != "Auto":
                self.pump_pct = MODE_PUMP_DEFAULTS[self.mode]

            self.patch_current_fast({"mode": self.mode, "pumpPct": int(round(self.pump_pct))})
            self.ack(cmd_id, "applied")
            self.log(f"ACK applied set_mode -> {self.mode} pump={self.pump_pct:.0f}%")
            return

        if cmd_name == "set_auto_pump":
            try:
                pump_value = int(round(float(value)))
            except (TypeError, ValueError):
                self.ack(cmd_id, "rejected", f"invalid pump value {value}")
                self.log(f"ACK rejected invalid set_auto_pump value={value}")
                return

            if self.mode != "Auto":
                self.ack(cmd_id, "rejected", "set_auto_pump allowed only in Auto mode")
                self.log("ACK rejected set_auto_pump because mode is not Auto")
                return

            if pump_value < 0 or pump_value > 100:
                self.ack(cmd_id, "rejected", "pump value must be 0..100")
                self.log(f"ACK rejected set_auto_pump out of range value={value}")
                return

            self.pump_pct = pump_value
            self.patch_current_fast({"mode": self.mode, "pumpPct": int(round(self.pump_pct))})
            self.ack(cmd_id, "applied")
            self.log(f"ACK applied set_auto_pump -> {self.pump_pct:.0f}%")
            return

        self.ack(cmd_id, "rejected", f"unknown cmd {cmd_name}")
        self.log(f"ACK rejected unknown cmd={cmd_name}")

    def loop(self) -> None:
        self.log(f"VirtualVest realistic simulator starting vestId={self.vest_id}")
        self.write_meta_and_initial_current()
        self.init_seen_commands()
        self.schedule_next("current")
        self.schedule_next("history")
        self.schedule_next("gps")

        next_cmd_poll = time.time()
        while True:
            self.maybe_offline()
            now_s = time.time()

            if now_s >= self.next_gps_at and not self.is_offline():
                self.update_gps()
                self.schedule_next("gps")
                self.log(f"GPS update fix={self.gps.fix} acc={self.gps.accuracy_m:.1f}m")

            if now_s >= self.next_current_at:
                self.schedule_next("current")
                if self.is_offline():
                    self.log("OFFLINE: current paused")
                else:
                    self.update_sensors()
                    payload = self.current_payload()
                    try:
                        self.rtdb.put(f"vests/{self.vest_id}/current", payload)
                    except RequestException as e:
                        self.log(f"NET error writing current: {e}")
                    loop_delta = self.outlet_temp - self.inlet_temp
                    self.log(
                        f"current mode={self.mode} pump={self.pump_pct:.0f}% "
                        f"skin={payload['skinTemp']} body={payload['bodyTemp']} "
                        f"loopΔ={loop_delta:.2f}C batt={payload['batteryPct']} "
                        f"flow={payload['flowRateLMin']} gpsFix={payload['gps']['fix']}"
                    )

            if now_s >= self.next_history_at:
                self.schedule_next("history")
                if self.is_offline():
                    self.log("OFFLINE: history paused")
                else:
                    try:
                        key = self.rtdb.post(f"vests/{self.vest_id}/history", self.history_payload())
                        self.log(f"history appended key={key}")
                    except RequestException as e:
                        self.log(f"NET error writing history: {e}")

            if now_s >= next_cmd_poll:
                next_cmd_poll = now_s + CMD_POLL_S
                if self.is_offline() and DROP_ACKS_WHEN_OFFLINE:
                    pass
                else:
                    try:
                        self.poll_commands()
                    except RequestException as e:
                        self.log(f"NET error polling commands: {e}")
                    except Exception as e:
                        self.log(f"ERROR poll_commands: {e}")

            time.sleep(0.05)


def main() -> int:
    missing = []
    if is_bad_env(FIREBASE_API_KEY):
        missing.append("FIREBASE_API_KEY")
    if is_bad_env(FIREBASE_DB_URL):
        missing.append("FIREBASE_DB_URL")
    if is_bad_env(DEVICE_EMAIL):
        missing.append("DEVICE_EMAIL")
    if is_bad_env(DEVICE_PASSWORD):
        missing.append("DEVICE_PASSWORD")

    if missing:
        print(f"Missing or placeholder env vars: {', '.join(missing)}", file=sys.stderr)
        return 2

    auth = FirebaseAuthRest(FIREBASE_API_KEY)
    tp = TokenProvider(auth, DEVICE_EMAIL, DEVICE_PASSWORD)
    rtdb = FirebaseRtdbRest(FIREBASE_DB_URL, tp)

    try:
        VirtualVest(rtdb, VEST_ID).loop()
    except KeyboardInterrupt:
        print("\nStopped by user (Ctrl+C).")
        return 0


if __name__ == "__main__":
    raise SystemExit(main())
