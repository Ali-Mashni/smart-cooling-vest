export type VestMode = 'Off' | 'Eco' | 'Normal' | 'Boost' | 'Auto';

export interface GpsData {
  lat: number;
  lng: number;
  accuracyM?: number;
  fix?: boolean;
  gpsTs?: number;
}

export interface VestTelemetry {
  ts?: number;
  lastSeenTs?: number;
  mode?: VestMode;
  pumpPct?: number;

  skinTemp?: number;
  batteryPct?: number;
  heartRateBpm?: number;
  spo2Pct?: number;

  inletTemp?: number;
  outletTemp?: number;
  bodyTemp?: number;
  pcmTemp?: number;
  ppgTemp?: number;
  ambientTemp?: number;
  humidity?: number;

  batteryVoltage?: number;
  batteryCurrentMa?: number;
  batteryPowerMw?: number;

  flowRateLMin?: number;
  flowTotalL?: number;

  gps?: GpsData;

  sensorOk?: {
    inlet?: boolean;
    outlet?: boolean;
    body?: boolean;
    pcm?: boolean;
    ppg?: boolean;
    gnss?: boolean;
    dht?: boolean;
    ina260?: boolean;
    flow?: boolean;
  };

  sensorAgeMs?: {
    temp?: number;
    ppg?: number;
    gnss?: number;
    dht?: number;
    ina260?: number;
    flow?: number;
  };

  uptimeMs?: number;
}

export interface VestHistoryPoint {
  ts: number;
  skinTemp: number;
  bodyTemp?: number;
  batteryPct: number;
  heartRateBpm?: number;
  spo2Pct?: number;
  pumpPct?: number;
  inletTemp?: number;
  outletTemp?: number;
  flowRateLMin?: number;
  ambientTemp?: number;
  humidity?: number;
  mode: VestMode;
}

export interface Vest {
  id: string;
  current: VestTelemetry;
  history?: Record<string, VestHistoryPoint>;
  // acks and commands are child nodes in Firebase
}

export interface VestWithId extends Vest {
  vestId: string;
}

export interface UserProfile {
  displayName: string;
  email: string;
}
