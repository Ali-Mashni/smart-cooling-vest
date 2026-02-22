#!/usr/bin/env python3
from __future__ import annotations
import random, time, math
from dataclasses import dataclass
from typing import Any, Dict, Optional, Set, Tuple
import os
import sys
import requests
from requests.exceptions import RequestException
from dotenv import load_dotenv
load_dotenv(".env")
# =========================
# CONFIG (edit here)
# =========================
FIREBASE_API_KEY = os.getenv("FIREBASE_API_KEY", "PASTE_API_KEY_HERE")
FIREBASE_DB_URL  = os.getenv("FIREBASE_DB_URL",  "https://PASTE_DB.firebaseio.com")

DEVICE_EMAIL     = os.getenv("DEVICE_EMAIL", "device-vest-002@test.com")
DEVICE_PASSWORD  = os.getenv("DEVICE_PASSWORD", "PASTE_DEVICE_PASSWORD_HERE")

VEST_ID          = os.getenv("VEST_ID", "vest002")

# Timing to match your spec
CURRENT_MIN_S, CURRENT_MAX_S = 5, 6      # device sends latest
HIST_MIN_S, HIST_MAX_S       = 10, 20    # cloud stores snapshots
GPS_MIN_S, GPS_MAX_S         = 30, 80    # gps update interval
CMD_POLL_S                   = 0.4       # fast ack

# Offline simulation (set OFFLINE_EVERY_S=0 to disable)
OFFLINE_EVERY_S              = 0
OFFLINE_DURATION_S           = 25
DROP_ACKS_WHEN_OFFLINE       = False

# GPS start (Dhahran-ish)
GPS_START_LAT, GPS_START_LNG = 26.31, 50.14
GPS_STEP_M                   = 1.5
GPS_FIX_DROP_PROB            = 0.02

ACK_REJECT_PROB              = 0.05
# =========================

def now_ms() -> int:
    return int(time.time() * 1000)

def clamp(x: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, x))

def jitter(x: float, amt: float) -> float:
    return x + random.uniform(-amt, amt)

def rand_between(a: float, b: float) -> float:
    return random.uniform(a, b)

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
        return self.session.id_token  # type: ignore

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

        self.mode = "ECO"
        self.skin_temp = 35.0
        self.battery = 90.0
        self.heart_rate_bpm = 72.0
        self.spo2_pct = 98.0
        self.gps = GpsState(GPS_START_LAT, GPS_START_LNG, True, 6.0, now_ms())

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

    def update_gps(self) -> None:
        g = self.gps
        if random.random() < GPS_FIX_DROP_PROB:
            g.fix = False
            g.accuracy_m = clamp(jitter(80.0, 40.0), 20.0, 200.0)
        else:
            g.fix = True
            g.accuracy_m = clamp(jitter(6.0, 3.0), 2.0, 25.0)

        if g.fix and GPS_STEP_M > 0:
            d_m = random.uniform(-GPS_STEP_M, GPS_STEP_M)
            bearing = random.uniform(0, 2 * math.pi)
            dx = d_m * math.cos(bearing)
            dy = d_m * math.sin(bearing)
            dlat = dy / 111_111.0
            dlng = dx / (111_111.0 * max(0.1, math.cos(math.radians(g.lat))))
            g.lat += dlat
            g.lng += dlng

        g.gps_ts = now_ms()

    def update_sensors(self) -> None:
        # Skin temp model (simple but mode-dependent)
        base_temp = 35.0
        if self.mode == "COOL":
            base_temp -= 0.8
        elif self.mode == "HEAT":
            base_temp += 0.8
        self.skin_temp = clamp(jitter(base_temp, 0.25), 32.0, 40.0)

        # Battery drain
        drain = 0.02 if self.mode != "COOL" else 0.03
        self.battery = clamp(self.battery - drain, 0.0, 100.0)

        # Heart rate (bpm) — depends on mode + small randomness
        # You can tune these to match your story (BOOST = higher exertion)
        if self.mode == "ECO":
            hr_base = 72.0
        elif self.mode == "NORMAL":
            hr_base = 85.0
        elif self.mode == "BOOST":
            hr_base = 105.0
        elif self.mode == "OFF":
            hr_base = 70.0
        else:
            hr_base = 80.0

        # Add natural variation, keep in realistic range
        self.heart_rate_bpm = clamp(jitter(hr_base, 3.5), 50.0, 160.0)

        # SpO2 (%) — usually stable; slight drop under BOOST / poor fix events not tied here
        if self.mode == "BOOST":
            spo2_base = 96.5
        else:
            spo2_base = 98.0

        self.spo2_pct = clamp(jitter(spo2_base, 0.4), 90.0, 100.0)

    def current_payload(self) -> Dict[str, Any]:
        ts = now_ms()
        return {
            "skinTemp": round(self.skin_temp, 2),
            "batteryPct": round(self.battery, 2),
            "heartRateBpm": int(round(self.heart_rate_bpm)),
            "spo2Pct": round(self.spo2_pct, 1),
            "mode": self.mode,
            "lastSeenTs": ts,
            "ts": ts,
            "gps": {
                "lat": self.gps.lat,
                "lng": self.gps.lng,
                "fix": self.gps.fix,
                "accuracyM": round(self.gps.accuracy_m, 1),
                "gpsTs": self.gps.gps_ts,
            },
        }

    def history_payload(self) -> Dict[str, Any]:
        ts = now_ms()
        return {
            "ts": ts,
            "skinTemp": round(self.skin_temp, 2),
            "batteryPct": round(self.battery, 2),
            "heartRateBpm": int(round(self.heart_rate_bpm)),
            "spo2Pct": round(self.spo2_pct, 1),
            "mode": self.mode
        }

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

    def handle_command(self, cmd_id: str, cmd: Dict[str, Any]) -> None:
        if self.is_offline() and DROP_ACKS_WHEN_OFFLINE:
            self.log(f"OFFLINE ignoring cmd {cmd_id}")
            return

        cmd_name = str(cmd.get("cmd", "")).strip()
        value = cmd.get("value")
        time.sleep(random.uniform(0.05, 0.10))

        if cmd_name == "set_mode":
            if random.random() < ACK_REJECT_PROB:
                self.rtdb.put(f"vests/{self.vest_id}/acks/{cmd_id}", {"status": "rejected", "ts": now_ms(), "message": "sim reject"})
                self.log(f"ACK rejected set_mode value={value}")
                return

            self.mode = str(value).upper()
            ts = now_ms()
            self.rtdb.patch(f"vests/{self.vest_id}/current", {"mode": self.mode, "ts": ts, "lastSeenTs": ts})
            self.rtdb.put(f"vests/{self.vest_id}/acks/{cmd_id}", {"status": "applied", "ts": now_ms()})
            self.log(f"ACK applied set_mode -> {self.mode}")
        else:
            self.rtdb.put(f"vests/{self.vest_id}/acks/{cmd_id}", {"status": "rejected", "ts": now_ms(), "message": f"unknown cmd {cmd_name}"})
            self.log(f"ACK rejected unknown cmd={cmd_name}")

    def loop(self) -> None:
        self.log(f"VirtualVest starting vestId={self.vest_id}")
        self.init_seen_commands()
        self.schedule_next("current")
        self.schedule_next("history")
        self.schedule_next("gps")

        next_cmd_poll = time.time()
        while True:
            self.maybe_offline()
            now = time.time()

            if now >= self.next_gps_at and not self.is_offline():
                self.update_gps()
                self.schedule_next("gps")
                self.log("GPS updated")

            if now >= self.next_current_at:
                self.schedule_next("current")
                if self.is_offline():
                    self.log("OFFLINE: current paused")
                else:
                    self.update_sensors()
                    try:
                        self.rtdb.put(f"vests/{self.vest_id}/current", self.current_payload())
                    except RequestException as e:
                        self.log(f"NET error writing current: {e}")
                    self.log(f"Wrote current mode={self.mode} temp={self.skin_temp:.2f} batt={self.battery:.1f}")

            if now >= self.next_history_at:
                self.schedule_next("history")
                if self.is_offline():
                    self.log("OFFLINE: history paused")
                else:
                    key = self.rtdb.post(f"vests/{self.vest_id}/history", self.history_payload())
                    self.log(f"Appended history key={key}")

            if now >= next_cmd_poll:
                next_cmd_poll = now + CMD_POLL_S
                try:
                    self.poll_commands()
                except RequestException as e:
                    self.log(f"NET error polling commands: {e}")
                except Exception as e:
                    self.log(f"ERROR poll_commands: {e}")

            time.sleep(0.05)

def main() -> int:
    if not FIREBASE_API_KEY or not FIREBASE_DB_URL or not DEVICE_EMAIL or not DEVICE_PASSWORD:
        print("Missing env vars...", file=sys.stderr)
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