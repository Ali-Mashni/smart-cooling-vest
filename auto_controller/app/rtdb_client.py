from __future__ import annotations

import time
from dataclasses import dataclass
from typing import Any, Dict, List, Optional

import requests

from .models import CurrentTelemetry, HistoryPoint, Preferences


@dataclass
class AuthSession:
    id_token: str
    refresh_token: str
    expires_at: float


class FirebaseAuthRestClient:
    def __init__(self, api_key: str, email: str, password: str, timeout_s: float = 10.0):
        self.api_key = api_key
        self.email = email
        self.password = password
        self.timeout_s = timeout_s
        self.session: Optional[AuthSession] = None

    def get_id_token(self) -> str:
        if self.session is None:
            self._sign_in()
        elif time.time() >= self.session.expires_at:
            self._refresh_token()

        if self.session is None:
            raise RuntimeError("Firebase auth session not initialized")
        return self.session.id_token

    def _sign_in(self) -> None:
        url = f"https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key={self.api_key}"
        payload = {
            "email": self.email,
            "password": self.password,
            "returnSecureToken": True,
        }
        response = requests.post(url, json=payload, timeout=self.timeout_s)
        if response.status_code != 200:
            raise RuntimeError(f"Firebase sign-in failed ({response.status_code}): {response.text}")

        data = response.json()
        expires_in = int(data.get("expiresIn", "3600"))
        self.session = AuthSession(
            id_token=str(data["idToken"]),
            refresh_token=str(data["refreshToken"]),
            expires_at=time.time() + max(30, expires_in - 60),
        )

    def _refresh_token(self) -> None:
        if self.session is None:
            self._sign_in()
            return

        url = f"https://securetoken.googleapis.com/v1/token?key={self.api_key}"
        form_data = {
            "grant_type": "refresh_token",
            "refresh_token": self.session.refresh_token,
        }
        response = requests.post(url, data=form_data, timeout=self.timeout_s)
        if response.status_code != 200:
            self._sign_in()
            return

        data = response.json()
        expires_in = int(data.get("expires_in", "3600"))
        self.session = AuthSession(
            id_token=str(data["id_token"]),
            refresh_token=str(data.get("refresh_token", self.session.refresh_token)),
            expires_at=time.time() + max(30, expires_in - 60),
        )


class FirebaseRtdbRestClient:
    def __init__(
        self,
        db_url: str,
        auth_token: Optional[str] = None,
        auth_client: Optional[FirebaseAuthRestClient] = None,
        timeout_s: float = 10.0,
    ):
        self.db_url = db_url.rstrip("/")
        self.auth_token = auth_token.strip() if auth_token else None
        self.auth_client = auth_client
        self.timeout_s = timeout_s

    def _get_auth_token(self) -> Optional[str]:
        if self.auth_client is not None:
            return self.auth_client.get_id_token()
        return self.auth_token

    def _url(self, path: str) -> str:
        p = path.strip("/")
        url = f"{self.db_url}/{p}.json"
        token = self._get_auth_token()
        if token:
            url = f"{url}?auth={token}"
        return url

    def get(self, path: str) -> Any:
        response = requests.get(self._url(path), timeout=self.timeout_s)
        if response.status_code != 200:
            raise RuntimeError(f"GET {path} failed ({response.status_code}): {response.text}")
        return response.json()

    def post(self, path: str, value: Any) -> str:
        response = requests.post(self._url(path), json=value, timeout=self.timeout_s)
        if response.status_code != 200:
            raise RuntimeError(f"POST {path} failed ({response.status_code}): {response.text}")
        return str(response.json().get("name", ""))

    def put(self, path: str, value: Any) -> Any:
        response = requests.put(self._url(path), json=value, timeout=self.timeout_s)
        if response.status_code != 200:
            raise RuntimeError(f"PUT {path} failed ({response.status_code}): {response.text}")
        return response.json()

    def patch(self, path: str, value: Dict[str, Any]) -> Any:
        response = requests.patch(self._url(path), json=value, timeout=self.timeout_s)
        if response.status_code != 200:
            raise RuntimeError(f"PATCH {path} failed ({response.status_code}): {response.text}")
        return response.json()

    def list_vest_ids(self) -> List[str]:
        vests = self.get("vests")
        if not isinstance(vests, dict):
            return []
        return sorted(str(vest_id) for vest_id in vests.keys())

    def get_state(self, vest_id: str) -> Dict[str, Any]:
        state = self.get(f"vests/{vest_id}/state")
        return state if isinstance(state, dict) else {}

    def get_current(self, vest_id: str) -> CurrentTelemetry:
        obj = self.get(f"vests/{vest_id}/current")
        if not isinstance(obj, dict):
            obj = {}
        return CurrentTelemetry(
            skin_temp=_to_float(obj.get("skinTemp")),
            ambient_temp=_to_float(obj.get("ambientTemp")),
            battery_pct=_to_float(obj.get("batteryPct")),
            heart_rate_bpm=_to_float(obj.get("heartRateBpm")),
            spo2_pct=_to_float(obj.get("spo2Pct")),
            pump_speed_pct=_to_float(obj.get("pumpSpeedPct")),
            mode=_to_str(obj.get("mode")),
            ts=_to_int(obj.get("ts")),
            last_seen_ts=_to_int(obj.get("lastSeenTs")),
        )

    def get_recent_history(self, vest_id: str, limit: int) -> List[HistoryPoint]:
        raw = self.get(f"vests/{vest_id}/history")
        if not isinstance(raw, dict):
            return []

        rows: List[HistoryPoint] = []
        for item in raw.values():
            if not isinstance(item, dict):
                continue
            ts = _to_int(item.get("ts"))
            if ts is None:
                continue
            rows.append(
                HistoryPoint(
                    ts=ts,
                    guard_uid=_to_str(item.get("guardUid")),
                    skin_temp=_to_float(item.get("skinTemp")),
                    ambient_temp=_to_float(item.get("ambientTemp")),
                    battery_pct=_to_float(item.get("batteryPct")),
                    heart_rate_bpm=_to_float(item.get("heartRateBpm")),
                    spo2_pct=_to_float(item.get("spo2Pct")),
                    pump_speed_pct=_to_float(item.get("pumpSpeedPct")),
                    mode=_to_str(item.get("mode")),
                )
            )

        rows.sort(key=lambda x: x.ts)
        return rows[-max(0, limit):]

    def get_preferences(self, guard_uid: str, defaults: Dict[str, Any]) -> Preferences:
        obj = self.get(f"users/{guard_uid}/preferences")
        if not isinstance(obj, dict):
            obj = {}
        comfort_default = _to_float(defaults.get("comfortBias")) or 0.6
        battery_default = _to_float(defaults.get("batteryBias")) or 0.4
        return Preferences(
            comfort_bias=_to_float(obj.get("comfortBias")) or comfort_default,
            battery_bias=_to_float(obj.get("batteryBias")) or battery_default,
        )

    def push_command(self, vest_id: str, command: Dict[str, Any]) -> str:
        return self.post(f"vests/{vest_id}/commands", command)


def _to_float(value: Any) -> Optional[float]:
    try:
        if value is None:
            return None
        return float(value)
    except (ValueError, TypeError):
        return None


def _to_int(value: Any) -> Optional[int]:
    try:
        if value is None:
            return None
        return int(value)
    except (ValueError, TypeError):
        return None


def _to_str(value: Any) -> Optional[str]:
    if value is None:
        return None
    return str(value)
