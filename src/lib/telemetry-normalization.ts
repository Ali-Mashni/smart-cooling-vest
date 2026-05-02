export type MetricSource = 'live' | 'lastValid' | 'missing';
export type MetricStatusTone = 'ok' | 'warn' | 'danger' | 'muted' | 'info';
export type MetricCategory = 'criticalLive' | 'slowLastKnown' | 'engineeringDerived' | 'control';

export interface NormalizedMetric<T> {
  rawValue?: T;
  displayValue?: T;
  formattedValue: string;
  isValid: boolean;
  isStale: boolean;
  isOffline: boolean;
  sensorOk?: boolean;
  ageMs?: number;
  source: MetricSource;
  statusLabel: string;
  statusTone: MetricStatusTone;
}

export interface NormalizeMetricOptions<T> {
  category?: MetricCategory;
  unit?: string;
  decimals?: number;
  format?: (value: T) => string;
  validate?: (value: T) => boolean;
  sensorOk?: boolean;
  ageMs?: number;
  staleAfterMs?: number;
  isOffline?: boolean;
  lastValidValue?: T;
  allowZero?: boolean;
  labels?: Partial<MetricStatusLabels>;
}

export interface MetricStatusLabels {
  live: string;
  stale: string;
  offline: string;
  missing: string;
  invalid: string;
  sensorFailed: string;
  zero: string;
  lastKnown: string;
  lastReceived: string;
  unavailable: string;
}

const isNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const defaultValidate = <T>(value: T) => {
  if (typeof value === 'number') {
    return isNumber(value);
  }
  return value !== undefined && value !== null;
};

const defaultLabels: MetricStatusLabels = {
  live: 'Live',
  stale: 'Stale',
  offline: 'Offline',
  missing: 'Missing',
  invalid: 'Invalid',
  sensorFailed: 'Sensor failed',
  zero: 'No live reading',
  lastKnown: 'Last known',
  lastReceived: 'Last received',
  unavailable: 'Unavailable',
};

const isZeroValue = (value: unknown) => typeof value === 'number' && value === 0;

const formatValue = <T>(
  value: T | undefined,
  options: Pick<NormalizeMetricOptions<T>, 'format' | 'decimals' | 'unit'>
) => {
  if (value === undefined || value === null) {
    return '—';
  }

  let formatted = '';
  if (options.format) {
    formatted = options.format(value);
  } else if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      formatted = '—';
    } else if (typeof options.decimals === 'number') {
      formatted = value.toFixed(options.decimals);
    } else {
      formatted = String(value);
    }
  } else {
    formatted = String(value);
  }

  if (options.unit) {
    return `${formatted} ${options.unit}`;
  }

  return formatted;
};

export const normalizeMetric = <T>(
  rawValue: T | undefined,
  options: NormalizeMetricOptions<T> = {}
): NormalizedMetric<T> => {
  const validate = options.validate ?? defaultValidate;
  const hasRawValue = rawValue !== undefined && rawValue !== null;
  const isOffline = options.isOffline ?? false;
  const category = options.category ?? 'control';
  const isStale =
    typeof options.ageMs === 'number' && typeof options.staleAfterMs === 'number'
      ? options.ageMs > options.staleAfterMs
      : false;
  const sensorOk = options.sensorOk;
  const labels: MetricStatusLabels = { ...defaultLabels, ...options.labels };
  const allowZero = options.allowZero ?? category === 'control';
  const isZero = hasRawValue && isZeroValue(rawValue);
  const isValidValue =
    hasRawValue &&
    validate(rawValue as T) &&
    (allowZero || !isZero) &&
    sensorOk !== false;

  let source: MetricSource = 'missing';
  let displayValue: T | undefined;
  let statusLabel = labels.missing;
  let statusTone: MetricStatusTone = 'muted';
  let isValid = false;

  if (category === 'criticalLive') {
    if (isOffline) {
      statusLabel = labels.offline;
      statusTone = 'danger';
    } else if (sensorOk === false) {
      statusLabel = labels.sensorFailed;
      statusTone = 'danger';
    } else if (isStale) {
      statusLabel = labels.stale;
      statusTone = 'warn';
    } else if (isZero && !allowZero) {
      statusLabel = labels.zero;
      statusTone = 'warn';
    } else if (isValidValue) {
      source = 'live';
      displayValue = rawValue as T;
      isValid = true;
      statusLabel = labels.live;
      statusTone = 'ok';
    } else if (hasRawValue) {
      statusLabel = labels.invalid;
      statusTone = 'danger';
    }
  } else if (category === 'engineeringDerived') {
    if (isOffline) {
      statusLabel = labels.unavailable;
      statusTone = 'muted';
    } else if (sensorOk === false) {
      statusLabel = labels.sensorFailed;
      statusTone = 'danger';
    } else if (isStale) {
      statusLabel = labels.stale;
      statusTone = 'warn';
    } else if (isZero && !allowZero) {
      statusLabel = labels.zero;
      statusTone = 'warn';
    } else if (isValidValue) {
      source = 'live';
      displayValue = rawValue as T;
      isValid = true;
      statusLabel = labels.live;
      statusTone = 'ok';
    } else if (hasRawValue) {
      statusLabel = labels.invalid;
      statusTone = 'danger';
    } else {
      statusLabel = labels.unavailable;
      statusTone = 'muted';
    }
  } else if (category === 'slowLastKnown') {
    if (!isOffline && isValidValue && !isStale) {
      source = 'live';
      displayValue = rawValue as T;
      isValid = true;
      statusLabel = labels.live;
      statusTone = 'ok';
    } else if (options.lastValidValue !== undefined && options.lastValidValue !== null) {
      source = 'lastValid';
      displayValue = options.lastValidValue;
      isValid = true;
      statusLabel = labels.lastKnown;
      statusTone = 'info';
    } else if (isOffline && isValidValue) {
      source = 'lastValid';
      displayValue = rawValue as T;
      isValid = true;
      statusLabel = labels.lastKnown;
      statusTone = 'info';
    } else if (sensorOk === false) {
      statusLabel = labels.sensorFailed;
      statusTone = 'danger';
    } else if (isStale) {
      statusLabel = labels.stale;
      statusTone = 'warn';
    } else if (isZero && !allowZero) {
      statusLabel = labels.zero;
      statusTone = 'warn';
    } else if (hasRawValue) {
      statusLabel = labels.invalid;
      statusTone = 'danger';
    }
  } else {
    if (isValidValue) {
      displayValue = rawValue as T;
      isValid = true;
      if (isOffline) {
        source = 'lastValid';
        statusLabel = labels.lastReceived;
        statusTone = 'info';
      } else if (isStale) {
        source = 'live';
        statusLabel = labels.stale;
        statusTone = 'warn';
      } else {
        source = 'live';
        statusLabel = labels.live;
        statusTone = 'ok';
      }
    } else if (options.lastValidValue !== undefined && options.lastValidValue !== null) {
      source = 'lastValid';
      displayValue = options.lastValidValue;
      isValid = true;
      statusLabel = labels.lastReceived;
      statusTone = 'info';
    } else if (sensorOk === false) {
      statusLabel = labels.sensorFailed;
      statusTone = 'danger';
    } else if (isZero && !allowZero) {
      statusLabel = labels.zero;
      statusTone = 'warn';
    } else if (hasRawValue) {
      statusLabel = labels.invalid;
      statusTone = 'danger';
    }
  }

  return {
    rawValue,
    displayValue,
    formattedValue: formatValue(displayValue, options),
    isValid,
    isStale,
    isOffline,
    sensorOk,
    ageMs: options.ageMs,
    source,
    statusLabel,
    statusTone,
  };
};

export interface SanitizeChartOptions {
  allowZero?: boolean;
  min?: number;
  max?: number;
  validate?: (value: number) => boolean;
}

export const sanitizeChartValue = (
  value: number | null | undefined,
  options: SanitizeChartOptions = {}
) => {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return null;
  }

  if (!options.allowZero && value === 0) {
    return null;
  }

  if (typeof options.min === 'number' && value < options.min) {
    return null;
  }

  if (typeof options.max === 'number' && value > options.max) {
    return null;
  }

  if (options.validate && !options.validate(value)) {
    return null;
  }

  return value;
};
