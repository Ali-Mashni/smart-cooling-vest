#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <Wire.h>
#include "DFRobot_BloodOxygen_S.h"
#include <SparkFun_u-blox_GNSS_v3.h>
#include <time.h>
#include <math.h>

static const char* WIFI_SSID        = "Ali";
static const char* WIFI_PASSWORD    = "987654321";

static const char* FIREBASE_API_KEY = "AIzaSyBCREH9BiFQTyKwyCvhgdtOoE_WbgJTV4Q";

static const char* FIREBASE_DB_URL = "https://smart-cooling-vest-default-rtdb.asia-southeast1.firebasedatabase.app";

static const char* DEVICE_EMAIL = "device-vest-001@test.com";

static const char* DEVICE_PASSWORD = "password";

static const char* VEST_ID = "vest001";

static const int SDA1_PIN = 21;

static const int SCL1_PIN = 19;

static const int SDA2_PIN = 4;

static const int SCL2_PIN = 5;

static const uint32_t CURRENT_MS = 4000;

static const uint32_t HISTORY_MS = 15000;

static const uint32_t GPS_PUSH_MS = 60000;

static const uint32_t CMD_POLL_MS = 250;

static const uint32_t WIFI_RETRY_MS = 5000;

static const uint32_t AUTH_RETRY_MS = 5000;

static const uint32_t TEMP_READ_MS = 500;

static const uint32_t PPG_READ_MS = 1000;

static const uint32_t GNSS_POLL_MS = 300;

static const uint32_t PPG_RETRY_MS = 10000;

static const uint32_t GNSS_RETRY_MS = 10000;

static const uint32_t SENSOR_LOG_MS = 5000;

static const uint16_t HTTP_CONNECT_TIMEOUT_MS = 1500;

static const uint16_t HTTP_TIMEOUT_MS = 2500;

static const bool ALLOW_FAKE_TIME_FOR_TEST = true;

static const uint64_t FAKE_EPOCH_BASE_MS = 1771700000000ULL;

TwoWire I2CBus1 = TwoWire(0);

TwoWire I2CBus2 = TwoWire(1);

static const uint8_t MUX_ADDR = 0x70;

static const uint8_t TMP117_ADDR = 0x48;

static const uint8_t MAX30102_ADDR = 0x57;

static const uint8_t CH_INLET = 0;

static const uint8_t CH_OUTLET = 1;

static const uint8_t CH_GNSS = 2;

static const uint8_t CH_BODY = 0;

static const uint8_t CH_PPG = 2;

SFE_UBLOX_GNSS gnss;

DFRobot_BloodOxygen_S_I2C ppgSensor(&I2CBus2, MAX30102_ADDR);

struct GpsState {

 bool fix = false;

 double lat = 0.0;

 double lng = 0.0;

 float accuracyM = 0.0f;

 uint64_t gpsTs = 0;

};

struct TelemetryState {

 float skinTemp = 0.0f;

 int batteryPct = 0;

 int heartRateBpm = 0;

 float spo2Pct = 0.0f;

 String mode = "Normal";

 int pumpPct = 50;

 GpsState gps;

};

struct PendingAck {

 bool pending = false;

 String cmdId;

 String status;

 String message;

};

TelemetryState vestState;

PendingAck pendingAck;

String g_idToken;

String g_refreshToken;

String g_localId;

uint32_t g_authExpiresAtMs = 0;

bool g_commandCursorPrimed = false;

String g_lastProcessedCmdId = "";

uint32_t g_nextCurrentAt = 0;

uint32_t g_nextHistoryAt = 0;

uint32_t g_nextGpsPushAt = 0;

uint32_t g_nextCmdPollAt = 0;

uint32_t g_lastWifiAttemptMs = 0;

uint32_t g_lastAuthAttemptMs = 0;

int g_lastAppliedPumpPct = -999;

static const int PUMP_PIN = 42;                  // ESP32-S3 only
static const uint32_t PUMP_PWM_FREQ_HZ = 20000;  // 20 kHz
static const uint8_t PUMP_PWM_RES_BITS = 8;      // 0..255 duty

bool g_pumpReady = false;

bool g_printedWifiConnected = false;

bool g_printedTimeReady = false;

bool g_printedFakeTimeWarning = false;

struct SensorState {

 float inlet_C = NAN;

 float outlet_C = NAN;

 float body_C = NAN;

 bool inlet_ok = false;

 bool outlet_ok = false;

 bool body_ok = false;

 float hr_bpm = NAN;

 float spo2_pct = NAN;

 float ppgTemp_C = NAN;

 bool ppg_ok = false;

 double lat_deg = NAN;

 double lon_deg = NAN;

 bool gnss_ok = false;

 bool fix = false;

 uint64_t gpsTsMs = 0;

 uint64_t lastTempGoodMs = 0;

 uint64_t lastPpgGoodMs = 0;

 uint64_t lastGnssGoodMs = 0;

};

SensorState sensorState;

bool g_sensorsStarted = false;

bool g_gnssStarted = false;

bool g_ppgStarted = false;

uint32_t g_lastTempReadMs = 0;

uint32_t g_lastPpgReadMs = 0;

uint32_t g_lastGnssPollMs = 0;

uint32_t g_lastPpgRetryMs = 0;

uint32_t g_lastGnssRetryMs = 0;

uint32_t g_lastSensorLogMs = 0;


bool due(uint32_t now, uint32_t at);

uint64_t epochMs();

void startWifiConnect();

void wifiTick(uint32_t now);

void authTick(uint32_t now);

void cloudSchedulerTick(uint32_t now);

void scheduleInitialTasks();

bool pumpInit();
uint32_t pumpPctToDuty(int pct);
void pumpSetPercent(int pct);
void pumpStop();

bool firebaseSignIn();

bool firebaseRefresh();

void invalidateAuth();

bool httpGet(const String& url, String& response, int& code);

bool httpPost(const String& url, const String& body, const char* contentType, String& response, int& code);

bool httpPut(const String& url, const String& body, const char* contentType, String& response, int& code);

bool httpPatch(const String& url, const String& body, const char* contentType, String& response, int& code);

String dbUrl(const String& path, const String& extraQuery = "");

String authSignInUrl();

String authRefreshUrl();

bool writeCurrent();

bool appendHistory();

bool pollCommands();

bool sendPendingAckNow();

bool patchCurrentQuick();

void handleCommand(const String& cmdId, JsonObject cmdObj);

bool applyMode(const String& newMode, String& err);

bool applyAutoPumpCommand(JsonVariantConst valueVariant, String& err);

void queueAck(const String& cmdId, const String& status, const String& message);

void controlTick();

bool selectMuxChannel(TwoWire &bus, uint8_t channel);

bool readTMP117C(TwoWire &bus, float &tempC);

void initSensors();

bool tryInitGnss();

bool tryInitPpg();

void sensorServiceTick(uint32_t now);

void serviceTemperatures(uint32_t now);

void servicePPG(uint32_t now);

void serviceGNSS(uint32_t now);

void snapshotTelemetryFromSensors();

void snapshotGpsFromSensors();

bool due(uint32_t now, uint32_t at) {

 return (int32_t)(now - at) >= 0;

}

uint64_t epochMs() {

 time_t s = time(nullptr);

 if (s >= 100000) {

 if (!g_printedTimeReady) {

 Serial.printf("[TIME] NTP ready, epoch=%llu\n", (unsigned long long)((uint64_t)s * 1000ULL));

 g_printedTimeReady = true;

 }

 return (uint64_t)s * 1000ULL;

 }

 if (ALLOW_FAKE_TIME_FOR_TEST) {

 if (!g_printedFakeTimeWarning) {

 Serial.println("[TIME] NTP not ready, using temporary fake epoch for cloud test");

 g_printedFakeTimeWarning = true;

 }

 return FAKE_EPOCH_BASE_MS + millis();

 }

 return 0;

}

bool selectMuxChannel(TwoWire &bus, uint8_t channel) {

 if (channel > 3) return false;

 bus.beginTransmission(MUX_ADDR);

 bus.write(1 << channel);

 return (bus.endTransmission() == 0);

}

bool readTMP117C(TwoWire &bus, float &tempC) {

 bus.beginTransmission(TMP117_ADDR);

 bus.write(0x00);

 if (bus.endTransmission(false) != 0) return false;

 uint8_t bytesRead = bus.requestFrom((int)TMP117_ADDR, 2);

 if (bytesRead != 2) return false;

 int16_t raw = ((int16_t)bus.read() << 8) | bus.read();

 tempC = raw * 0.0078125f;

 return true;

}

void initSensors() {

 I2CBus1.begin(SDA1_PIN, SCL1_PIN);

 I2CBus2.begin(SDA2_PIN, SCL2_PIN);

 I2CBus1.setClock(100000);

 I2CBus2.setClock(100000);

 g_sensorsStarted = true;

 Serial.println("[SENS] I2C buses started");

}

bool tryInitGnss() {

 if (!selectMuxChannel(I2CBus1, CH_GNSS)) {

 Serial.println("[GNSS] mux select failed");

 return false;

 }

 bool ok = gnss.begin(I2CBus1);

 if (!ok) {

 Serial.println("[GNSS] begin failed");

 return false;

 }

 g_gnssStarted = true;

 Serial.println("[GNSS] ready");

 return true;

}

bool tryInitPpg() {

 if (!selectMuxChannel(I2CBus2, CH_PPG)) {

 Serial.println("[PPG] mux select failed");

 return false;

 }

 bool ok = ppgSensor.begin();

 if (!ok) {

 Serial.println("[PPG] begin failed");

 return false;

 }

 ppgSensor.sensorStartCollect();

 g_ppgStarted = true;

 Serial.println("[PPG] ready");

 return true;

}

void serviceTemperatures(uint32_t now) {

 if (now - g_lastTempReadMs < TEMP_READ_MS) return;

 g_lastTempReadMs = now;

 float temp = NAN;

 if (selectMuxChannel(I2CBus1, CH_INLET) && readTMP117C(I2CBus1, temp)) {

 sensorState.inlet_C = temp;

 sensorState.inlet_ok = true;

 sensorState.lastTempGoodMs = now;

 }

 else {

 sensorState.inlet_ok = false;

 }

 if (selectMuxChannel(I2CBus1, CH_OUTLET) && readTMP117C(I2CBus1, temp)) {

 sensorState.outlet_C = temp;

 sensorState.outlet_ok = true;

 sensorState.lastTempGoodMs = now;

 }

 else {

 sensorState.outlet_ok = false;

 }

 if (selectMuxChannel(I2CBus2, CH_BODY) && readTMP117C(I2CBus2, temp)) {

 sensorState.body_C = temp;

 sensorState.body_ok = true;

 sensorState.lastTempGoodMs = now;

 }

 else {

 sensorState.body_ok = false;

 }

}

void servicePPG(uint32_t now) {

 if (!g_ppgStarted) {

 if (now - g_lastPpgRetryMs >= PPG_RETRY_MS) {

 g_lastPpgRetryMs = now;

 Serial.println("[PPG] retry init...");

 tryInitPpg();

 }

 sensorState.ppg_ok = false;

 return;

 }

 if (now - g_lastPpgReadMs < PPG_READ_MS) return;

 g_lastPpgReadMs = now;

 if (!selectMuxChannel(I2CBus2, CH_PPG)) {

 sensorState.ppg_ok = false;

 return;

 }

 ppgSensor.getHeartbeatSPO2();

 float spo2 = ppgSensor._sHeartbeatSPO2.SPO2;

 float hr = ppgSensor._sHeartbeatSPO2.Heartbeat;

 float tC = ppgSensor.getTemperature_C();

 bool valid = true;

 if (isnan(spo2) || isnan(hr)) valid = false;

 if (spo2 < 50 || spo2 > 100) valid = false;

 if (hr < 20 || hr > 240) valid = false;

 if (valid) {

 sensorState.spo2_pct = spo2;

 sensorState.hr_bpm = hr;

 sensorState.ppgTemp_C = tC;

 sensorState.ppg_ok = true;

 sensorState.lastPpgGoodMs = now;

 }

 else {
  sensorState.ppg_ok = false;
  sensorState.hr_bpm = NAN;
  sensorState.spo2_pct = NAN;
  sensorState.ppgTemp_C = NAN;
 }

}

void serviceGNSS(uint32_t now) {

 if (!g_gnssStarted) {

 if (now - g_lastGnssRetryMs >= GNSS_RETRY_MS) {

 g_lastGnssRetryMs = now;

 Serial.println("[GNSS] retry init...");

 tryInitGnss();

 }

 return;

 }

 if (now - g_lastGnssPollMs < GNSS_POLL_MS) return;

 g_lastGnssPollMs = now;

 if (!selectMuxChannel(I2CBus1, CH_GNSS)) {

 sensorState.gnss_ok = false;

 return;

 }

 gnss.checkUblox();

 double lat = gnss.getLatitude() / 10000000.0;

 double lon = gnss.getLongitude() / 10000000.0;

 uint8_t fixType = gnss.getFixType();

 bool validFix = (fixType >= 2) && !(lat == 0.0 && lon == 0.0);

 if (validFix) {

 sensorState.lat_deg = lat;

 sensorState.lon_deg = lon;

 sensorState.fix = true;

 sensorState.gnss_ok = true;

 sensorState.gpsTsMs = epochMs();

 sensorState.lastGnssGoodMs = now;

 }

 else {

 sensorState.fix = false;

 sensorState.gnss_ok = false;

 }

}

void sensorServiceTick(uint32_t now) {

 if (!g_sensorsStarted) return;

 serviceTemperatures(now);

 servicePPG(now);

 serviceGNSS(now);

 if (now - g_lastSensorLogMs >= SENSOR_LOG_MS) {

 g_lastSensorLogMs = now;

 Serial.printf( "[SENS] inlet_ok=%d outlet_ok=%d body_ok=%d ppg_ok=%d gnss_ok=%d body=%.2f hr=%.1f spo2=%.1f lat=%.6f lon=%.6f\n", sensorState.inlet_ok ? 1 : 0, sensorState.outlet_ok ? 1 : 0, sensorState.body_ok ? 1 : 0, sensorState.ppg_ok ? 1 : 0, sensorState.gnss_ok ? 1 : 0, sensorState.body_C, sensorState.hr_bpm, sensorState.spo2_pct, sensorState.lat_deg, sensorState.lon_deg );

 }

}

void snapshotTelemetryFromSensors() {

 vestState.skinTemp = sensorState.body_ok ? sensorState.body_C : (isnan(sensorState.body_C) ? 0.0f : sensorState.body_C);

 vestState.batteryPct = 0;

 if (sensorState.ppg_ok && !isnan(sensorState.hr_bpm) && !isnan(sensorState.spo2_pct)) {

 vestState.heartRateBpm = (int)roundf(sensorState.hr_bpm);

 vestState.spo2Pct = sensorState.spo2_pct;

 }

 else {

 vestState.heartRateBpm = 0;

 vestState.spo2Pct = 0.0f;

 }

}

void snapshotGpsFromSensors() {
  if (sensorState.gnss_ok && sensorState.fix) {
    vestState.gps.fix = true;
    vestState.gps.lat = sensorState.lat_deg;
    vestState.gps.lng = sensorState.lon_deg;
    vestState.gps.accuracyM = 0.0f;
    vestState.gps.gpsTs = sensorState.gpsTsMs;
  } else {
    vestState.gps.fix = false;
    vestState.gps.lat = 0.0;
    vestState.gps.lng = 0.0;
    vestState.gps.accuracyM = 0.0f;
    vestState.gps.gpsTs = sensorState.gpsTsMs;
  }
}

void controlTick() {
  int desiredPct = constrain(vestState.pumpPct, 0, 100);

  if (desiredPct != g_lastAppliedPumpPct) {
    pumpSetPercent(desiredPct);
    g_lastAppliedPumpPct = desiredPct;

    Serial.printf("[CTRL] applied pumpPct=%d mode=%s\n",
                  desiredPct,
                  vestState.mode.c_str());
  }
}

void startWifiConnect() {

 Serial.printf("[WIFI] begin ssid=%s\n", WIFI_SSID);

 WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

}

void wifiTick(uint32_t now) {

 if (WiFi.status() == WL_CONNECTED) {

 if (!g_printedWifiConnected) {

 g_printedWifiConnected = true;

 Serial.printf("[WIFI] connected ip=%s\n", WiFi.localIP().toString().c_str());

 }

 return;

 }

 g_printedWifiConnected = false;

 if (now - g_lastWifiAttemptMs < WIFI_RETRY_MS) return;

 g_lastWifiAttemptMs = now;

 Serial.println("[WIFI] reconnect");

 WiFi.disconnect(false, false);

 WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

}

String authSignInUrl() {

 return String("https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=") + FIREBASE_API_KEY;

}

String authRefreshUrl() {

 return String("https://securetoken.googleapis.com/v1/token?key=") + FIREBASE_API_KEY;

}

void invalidateAuth() {

 g_idToken = "";

 g_authExpiresAtMs = 0;

}
uint32_t pumpPctToDuty(int pct) {
  pct = constrain(pct, 0, 100);
  return map(pct, 0, 100, 0, 255);
}

bool pumpInit() {
  pinMode(PUMP_PIN, OUTPUT);

  g_pumpReady = ledcAttach(PUMP_PIN, PUMP_PWM_FREQ_HZ, PUMP_PWM_RES_BITS);
  if (!g_pumpReady) {
    Serial.println("[PUMP] ledcAttach failed");
    return false;
  }

  bool ok = ledcWrite(PUMP_PIN, 0);
  if (!ok) {
    Serial.println("[PUMP] initial ledcWrite failed");
    return false;
  }

  Serial.println("[PUMP] init OK");
  return true;
}

void pumpSetPercent(int pct) {
  pct = constrain(pct, 0, 100);
  if (!g_pumpReady) return;

  uint32_t duty = pumpPctToDuty(pct);
  bool ok = ledcWrite(PUMP_PIN, duty);
  if (!ok) {
    Serial.printf("[PUMP] ledcWrite failed for pct=%d duty=%lu\n", pct, (unsigned long)duty);
  }
}

void pumpStop() {
  pumpSetPercent(0);
}

void authTick(uint32_t now) {

 if (WiFi.status() != WL_CONNECTED) return;

 bool needLogin = g_idToken.isEmpty();

 bool expiringSoon = (!g_idToken.isEmpty() && (int32_t)(g_authExpiresAtMs - now) < 120000);

 if (!needLogin && !expiringSoon) return;

 if (now - g_lastAuthAttemptMs < AUTH_RETRY_MS) return;

 g_lastAuthAttemptMs = now;

 bool ok = false;

 if (needLogin) {

 Serial.println("[AUTH] sign-in attempt");

 ok = firebaseSignIn();

 }

 else {

 Serial.println("[AUTH] refresh attempt");

 ok = firebaseRefresh();

 }

 if (!ok && !g_refreshToken.isEmpty()) {

 Serial.println("[AUTH] refresh/login fallback");

 ok = firebaseSignIn();

 }

 Serial.println(ok ? "[AUTH] ready" : "[AUTH] failed");

}

bool firebaseSignIn() {

 DynamicJsonDocument req(256);

 req["email"] = DEVICE_EMAIL;

 req["password"] = DEVICE_PASSWORD;

 req["returnSecureToken"] = true;

 String body;

 serializeJson(req, body);

 String resp;

 int code = 0;

 if (!httpPost(authSignInUrl(), body, "application/json", resp, code)) return false;

 if (code != 200) {

 Serial.printf("[AUTH] signIn code=%d body=%s\n", code, resp.c_str());

 return false;

 }

 DynamicJsonDocument doc(1024);

 if (deserializeJson(doc, resp)) {

 Serial.println("[AUTH] signIn JSON parse failed");

 return false;

 }

 g_idToken = String(doc["idToken"] | "");

 g_refreshToken = String(doc["refreshToken"] | "");

 g_localId = String(doc["localId"] | "");

 uint32_t expiresInSec = String(doc["expiresIn"] | "3600").toInt();

 g_authExpiresAtMs = millis() + (expiresInSec * 1000UL);

 return !g_idToken.isEmpty();

}

bool firebaseRefresh() {

 if (g_refreshToken.isEmpty()) return false;

 String form = "grant_type=refresh_token&refresh_token=" + g_refreshToken;

 String resp;

 int code = 0;

 if (!httpPost(authRefreshUrl(), form, "application/x-www-form-urlencoded", resp, code)) return false;

 if (code != 200) {

 Serial.printf("[AUTH] refresh code=%d body=%s\n", code, resp.c_str());

 return false;

 }

 DynamicJsonDocument doc(1024);

 if (deserializeJson(doc, resp)) {

 Serial.println("[AUTH] refresh JSON parse failed");

 return false;

 }

 g_idToken = String(doc["id_token"] | "");

 g_refreshToken = String(doc["refresh_token"] | "");

 uint32_t expiresInSec = String(doc["expires_in"] | "3600").toInt();

 g_authExpiresAtMs = millis() + (expiresInSec * 1000UL);

 return !g_idToken.isEmpty();

}

bool httpGet(const String& url, String& response, int& code) {

 WiFiClientSecure client;

 client.setInsecure();

 HTTPClient http;

 http.setConnectTimeout(HTTP_CONNECT_TIMEOUT_MS);

 http.setTimeout(HTTP_TIMEOUT_MS);

 if (!http.begin(client, url)) return false;

 code = http.GET();

 response = (code > 0) ? http.getString() : "";

 http.end();

 return code > 0;

}

bool httpPost(const String& url, const String& body, const char* contentType, String& response, int& code) {

 WiFiClientSecure client;

 client.setInsecure();

 HTTPClient http;

 http.setConnectTimeout(HTTP_CONNECT_TIMEOUT_MS);

 http.setTimeout(HTTP_TIMEOUT_MS);

 if (!http.begin(client, url)) return false;

 http.addHeader("Content-Type", contentType);

 code = http.POST(body);

 response = (code > 0) ? http.getString() : "";

 http.end();

 return code > 0;

}

bool httpPut(const String& url, const String& body, const char* contentType, String& response, int& code) {

 WiFiClientSecure client;

 client.setInsecure();

 HTTPClient http;

 http.setConnectTimeout(HTTP_CONNECT_TIMEOUT_MS);

 http.setTimeout(HTTP_TIMEOUT_MS);

 if (!http.begin(client, url)) return false;

 http.addHeader("Content-Type", contentType);

 code = http.PUT(body);

 response = (code > 0) ? http.getString() : "";

 http.end();

 return code > 0;

}

bool httpPatch(const String& url, const String& body, const char* contentType, String& response, int& code) {

 WiFiClientSecure client;

 client.setInsecure();

 HTTPClient http;

 http.setConnectTimeout(HTTP_CONNECT_TIMEOUT_MS);

 http.setTimeout(HTTP_TIMEOUT_MS);

 if (!http.begin(client, url)) return false;

 http.addHeader("Content-Type", contentType);

 code = http.sendRequest("PATCH", (uint8_t*)body.c_str(), body.length());

 response = (code > 0) ? http.getString() : "";

 http.end();

 return code > 0;

}

String dbUrl(const String& path, const String& extraQuery) {

 String url = String(FIREBASE_DB_URL);

 if (!url.endsWith("/")) url += "/";

 url += path + ".json?auth=" + g_idToken;

 if (extraQuery.length() > 0) url += "&" + extraQuery;

 return url;

}

bool applyMode(const String& newMode, String& err) {

 String m = newMode;

 m.trim();

 m.toLowerCase();

 if (m == "off") {

 vestState.mode = "Off";

 vestState.pumpPct = 0;

 return true;

 }

if (m == "eco" || m == "low") {
  vestState.mode = "Eco";
  vestState.pumpPct = 30;
  return true;
}

 if (m == "normal") {

 vestState.mode = "Normal";

 vestState.pumpPct = 50;

 return true;

 }
if (m == "boost" || m == "high") {
  vestState.mode = "Boost";
  vestState.pumpPct = 80;
  return true;
}

 if (m == "auto") {

 vestState.mode = "Auto";

 return true;

 }

 err = "invalid mode";

 return false;

}

bool applyAutoPumpCommand(JsonVariantConst valueVariant, String& err) {

 if (vestState.mode != "Auto") {

 err = "not in Auto mode";

 return false;

 }

 int pct = -1;

 if (valueVariant.is<int>()) {

 pct = valueVariant.as<int>();

 }

 else if (valueVariant.is<const char*>()) {

 pct = String(valueVariant.as<const char*>()).toInt();

 }

 else if (valueVariant.is<float>()) {

 pct = (int)roundf(valueVariant.as<float>());

 }

 else {

 err = "invalid pump value";

 return false;

 }

 if (pct < 0 || pct > 100) {

 err = "pump value out of range";

 return false;

 }

 vestState.pumpPct = pct;

 return true;

}

void queueAck(const String& cmdId, const String& status, const String& message) {

 pendingAck.pending = true;

 pendingAck.cmdId = cmdId;

 pendingAck.status = status;

 pendingAck.message = message;

}

void handleCommand(const String& cmdId, JsonObject cmdObj) {
  String cmd = String(cmdObj["cmd"] | "");
  String valueAsString = String(cmdObj["value"] | "");

  Serial.printf("[CMD] id=%s cmd=%s value=%s\n", cmdId.c_str(), cmd.c_str(), valueAsString.c_str());

  if (cmd == "set_mode") {
    String err;
    bool ok = applyMode(valueAsString, err);

    if (ok) {
      controlTick();  // apply immediately for < 5 s requirement

      queueAck(cmdId, "applied", "");
      sendPendingAckNow();   // send ACK immediately

      patchCurrentQuick();   // then patch current
    } else {
      queueAck(cmdId, "rejected", err);
      sendPendingAckNow();
    }
    return;
  }

  if (cmd == "set_auto_pump") {
    String err;
    bool ok = applyAutoPumpCommand(cmdObj["value"], err);

    if (ok) {
      controlTick();
      queueAck(cmdId, "applied", "");
      sendPendingAckNow();
      patchCurrentQuick();
    } else {
      queueAck(cmdId, "rejected", err);
      sendPendingAckNow();
    }
    return;
  }

  queueAck(cmdId, "rejected", "unknown command");
  sendPendingAckNow();
}


bool writeCurrent() {

 uint64_t nowTs = epochMs();

 if (nowTs == 0) {

 Serial.println("[RTDB] current skipped: no timestamp");

 return false;

 }

 DynamicJsonDocument doc(1664);

 doc["skinTemp"] = vestState.skinTemp;

 doc["batteryPct"] = vestState.batteryPct;

 doc["heartRateBpm"] = vestState.heartRateBpm;

 doc["spo2Pct"] = vestState.spo2Pct;

 doc["mode"] = vestState.mode;

 doc["pumpPct"] = vestState.pumpPct;

 doc["lastSeenTs"] = nowTs;

 doc["ts"] = nowTs;

 JsonObject gps = doc.createNestedObject("gps");

 gps["lat"] = vestState.gps.lat;

 gps["lng"] = vestState.gps.lng;

 gps["fix"] = vestState.gps.fix;

 gps["accuracyM"] = vestState.gps.accuracyM;

 gps["gpsTs"] = vestState.gps.gpsTs;

 JsonObject sensorOk = doc.createNestedObject("sensorOk");
doc["inletTemp"] = sensorState.inlet_ok ? sensorState.inlet_C : 0.0f;
doc["outletTemp"] = sensorState.outlet_ok ? sensorState.outlet_C : 0.0f;
doc["bodyTemp"] = sensorState.body_ok ? sensorState.body_C : 0.0f;
doc["ppgTemp"] = sensorState.ppg_ok ? sensorState.ppgTemp_C : 0.0f;

 sensorOk["inlet"] = sensorState.inlet_ok;

 sensorOk["outlet"] = sensorState.outlet_ok;

 sensorOk["body"] = sensorState.body_ok;

 sensorOk["ppg"] = sensorState.ppg_ok;

 sensorOk["gnss"] = sensorState.gnss_ok;

 String body;

 serializeJson(doc, body);

 Serial.println("[RTDB] writing current...");

 String resp;

 int code = 0;

 bool ok = httpPut( dbUrl(String("vests/") + VEST_ID + "/current", "print=silent"), body, "application/json", resp, code );

 if (code == 401) invalidateAuth();

 if (!ok || !(code == 200 || code == 204)) {

 Serial.printf("[RTDB] current FAIL code=%d body=%s\n", code, resp.c_str());

 return false;

 }

 Serial.printf("[RTDB] current OK mode=%s temp=%.2f hr=%d spo2=%.1f gpsFix=%d ts=%llu\n", vestState.mode.c_str(), vestState.skinTemp, vestState.heartRateBpm, vestState.spo2Pct, vestState.gps.fix ? 1 : 0, (unsigned long long)nowTs );

 return true;

}

bool appendHistory() {

 uint64_t nowTs = epochMs();

 if (nowTs == 0) {

 Serial.println("[RTDB] history skipped: no timestamp");

 return false;

 }

 DynamicJsonDocument doc(1152);

 doc["ts"] = nowTs;

 doc["skinTemp"] = vestState.skinTemp;

 doc["batteryPct"] = vestState.batteryPct;

 doc["heartRateBpm"] = vestState.heartRateBpm;

 doc["spo2Pct"] = vestState.spo2Pct;

 doc["mode"] = vestState.mode;

 doc["pumpPct"] = vestState.pumpPct;

 doc["inletTemp"] = sensorState.inlet_ok ? sensorState.inlet_C : 0.0f;

 doc["outletTemp"] = sensorState.outlet_ok ? sensorState.outlet_C : 0.0f;

 doc["bodyTemp"] = sensorState.body_ok ? sensorState.body_C : 0.0f;

 doc["ppgTemp"] = sensorState.ppg_ok ? sensorState.ppgTemp_C : 0.0f;

 doc["gpsFix"] = vestState.gps.fix;

 doc["ppgOk"] = sensorState.ppg_ok;

 String body;

 serializeJson(doc, body);

 Serial.println("[RTDB] appending history...");

 String resp;

 int code = 0;

 bool ok = httpPost( dbUrl(String("vests/") + VEST_ID + "/history", "print=silent"), body, "application/json", resp, code );

 if (code == 401) invalidateAuth();

 if (!ok || !(code == 200 || code == 204)) {

 Serial.printf("[RTDB] history FAIL code=%d body=%s\n", code, resp.c_str());

 return false;

 }

 Serial.printf("[RTDB] history OK ts=%llu\n", (unsigned long long)nowTs);

 return true;

}

bool patchCurrentQuick() {

 uint64_t nowTs = epochMs();

 if (nowTs == 0) {

 Serial.println("[RTDB] current-patch skipped: no timestamp");

 return false;

 }

 DynamicJsonDocument doc(256);

 doc["mode"] = vestState.mode;

 doc["pumpPct"] = vestState.pumpPct;

 doc["lastSeenTs"] = nowTs;

 doc["ts"] = nowTs;

 String body;

 serializeJson(doc, body);

 Serial.println("[RTDB] patching current...");

 String resp;

 int code = 0;

 bool ok = httpPatch( dbUrl(String("vests/") + VEST_ID + "/current", "print=silent"), body, "application/json", resp, code );

 if (code == 401) invalidateAuth();

 if (!ok || !(code == 200 || code == 204)) {

 Serial.printf("[RTDB] current-patch FAIL code=%d body=%s\n", code, resp.c_str());

 return false;

 }

 Serial.printf("[RTDB] current-patch OK mode=%s\n", vestState.mode.c_str());

 return true;

}

bool pollCommands() {

 String resp;

 int code = 0;

 bool ok = httpGet( dbUrl(String("vests/") + VEST_ID + "/commands", "timeout=2s"), resp, code );

 if (code == 401) invalidateAuth();

 if (!ok || code != 200) {

 Serial.printf("[RTDB] commands FAIL code=%d body=%s\n", code, resp.c_str());

 return false;

 }

 if (resp == "null" || resp.length() == 0) {

 if (!g_commandCursorPrimed) {

 g_commandCursorPrimed = true;

 Serial.println("[CMD] primed with empty command list");

 }

 return false;

 }

 DynamicJsonDocument doc(4096);

 if (deserializeJson(doc, resp)) {

 Serial.println("[RTDB] commands parse failed");

 return false;

 }

 JsonObject root = doc.as<JsonObject>();

 String latestKey = "";

 String nextKey = "";

 for (JsonPair kv : root) {

 String key = String(kv.key().c_str());

 if (latestKey.isEmpty() || key > latestKey) {

 latestKey = key;

 }

 if (!g_lastProcessedCmdId.isEmpty() && key > g_lastProcessedCmdId) {

 if (nextKey.isEmpty() || key < nextKey) {

 nextKey = key;

 }

 }

 }

 if (latestKey.isEmpty()) {

 return false;

 }

 if (!g_commandCursorPrimed) {

 g_lastProcessedCmdId = latestKey;

 g_commandCursorPrimed = true;

 Serial.printf("[CMD] primed at existing cmdId=%s\n", latestKey.c_str());

 return false;

 }

 if (nextKey.isEmpty()) {

 return false;

 }

 JsonObject cmdObj = root[nextKey].as<JsonObject>();

 Serial.printf("[CMD] processing new cmdId=%s\n", nextKey.c_str());

 handleCommand(nextKey, cmdObj);

 g_lastProcessedCmdId = nextKey;

 return true;

}

bool sendPendingAckNow() {

 if (!pendingAck.pending) return true;

 uint64_t nowTs = epochMs();

 if (nowTs == 0) {

 Serial.println("[RTDB] ack skipped: no timestamp");

 return false;

 }

 DynamicJsonDocument doc(256);

 doc["status"] = pendingAck.status;

 doc["ts"] = nowTs;

 if (pendingAck.message.length() > 0) doc["message"] = pendingAck.message;

 String body;

 serializeJson(doc, body);

 Serial.println("[RTDB] writing ack...");

 String resp;

 int code = 0;

 bool ok = httpPut( dbUrl(String("vests/") + VEST_ID + "/acks/" + pendingAck.cmdId, "print=silent"), body, "application/json", resp, code );

 if (code == 401) invalidateAuth();

 if (!ok || !(code == 200 || code == 204)) {

 Serial.printf("[RTDB] ack FAIL code=%d body=%s\n", code, resp.c_str());

 return false;

 }

 Serial.printf("[RTDB] ack OK cmdId=%s status=%s\n", pendingAck.cmdId.c_str(), pendingAck.status.c_str() );

 pendingAck.pending = false;

 pendingAck.cmdId = "";

 pendingAck.status = "";

 pendingAck.message = "";

 return true;

}

void scheduleInitialTasks() {

 uint32_t now = millis();

 g_nextCurrentAt = now + 1000;

 g_nextHistoryAt = now + 5000;

 g_nextGpsPushAt = now + 1000;

 g_nextCmdPollAt = now + 1000;

}

void cloudSchedulerTick(uint32_t now) {

 if (WiFi.status() != WL_CONNECTED) return;

 if (g_idToken.isEmpty()) return;

 if (pendingAck.pending) {

 sendPendingAckNow();

 return;

 }

 if (due(now, g_nextCmdPollAt)) {

 bool handled = pollCommands();

 g_nextCmdPollAt = now + CMD_POLL_MS;

 if (handled || pendingAck.pending) {

 return;

 }

 }

 if (due(now, g_nextGpsPushAt)) {

 snapshotGpsFromSensors();

 g_nextGpsPushAt = now + GPS_PUSH_MS;

 }

 if (due(now, g_nextCurrentAt)) {

 snapshotTelemetryFromSensors();

 snapshotGpsFromSensors();

 bool ok = writeCurrent();

 g_nextCurrentAt = ok ? (now + CURRENT_MS) : (now + 1000);

 return;

 }

 if (due(now, g_nextHistoryAt)) {

 snapshotTelemetryFromSensors();

 snapshotGpsFromSensors();

 bool ok = appendHistory();

 g_nextHistoryAt = ok ? (now + HISTORY_MS) : (now + 3000);

 return;

 }

}

void setup() {

 Serial.begin(115200);

 delay(500);

 Serial.println("[BOOT] cloud + temp + ppg + gnss build starting");
 if (!pumpInit()) {

 Serial.println("[BOOT] pump init failed");

 }
 initSensors();

 if (!tryInitPpg()) {

 Serial.println("[BOOT] PPG not ready at boot; will retry in loop");

 }

 if (!tryInitGnss()) {

 Serial.println("[BOOT] GNSS not ready at boot; will retry in loop");

 }

 snapshotTelemetryFromSensors();

 snapshotGpsFromSensors();

 WiFi.mode(WIFI_STA);

 startWifiConnect();

 configTime(0, 0, "pool.ntp.org", "time.nist.gov");

 scheduleInitialTasks();

 Serial.println("[BOOT] setup done");

}

void loop() {

 const uint32_t now = millis();

 sensorServiceTick(now);

 controlTick();

 wifiTick(now);

 authTick(now);

 static bool forcedWriteDone = false;

 if (!forcedWriteDone && WiFi.status() == WL_CONNECTED && !g_idToken.isEmpty()) {

 forcedWriteDone = true;

 Serial.println("[DBG] forcing one current write now");

 snapshotTelemetryFromSensors();

 snapshotGpsFromSensors();

 bool ok = writeCurrent();

 Serial.printf("[DBG] writeCurrent returned %d\n", ok ? 1 : 0);

 }

 static uint32_t lastBeat = 0;

 if (millis() - lastBeat > 3000) {

 lastBeat = millis();

 Serial.printf("[HB] alive wifi=%d authed=%d ppg=%d gnss=%d ms=%lu\n", WiFi.status() == WL_CONNECTED, !g_idToken.isEmpty(), sensorState.ppg_ok ? 1 : 0, sensorState.gnss_ok ? 1 : 0, millis());

 }

 cloudSchedulerTick(now);

}