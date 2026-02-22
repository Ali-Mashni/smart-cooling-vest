export type VestMode = 'Off' | 'Eco' | 'Normal' | 'Boost';

export interface GpsData {
  lat: number;
  lng: number;
  accuracyM?: number;
  fix?: boolean;
}

export interface VestTelemetry {
  skinTemp: number;
  batteryPct: number;
  mode: VestMode;
  lastSeenTs: number;
  gps: GpsData;
  heartRateBpm?: number;
  spo2Pct?: number;
}

export interface VestHistoryPoint {
  ts: number;
  skinTemp: number;
  batteryPct: number;
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
