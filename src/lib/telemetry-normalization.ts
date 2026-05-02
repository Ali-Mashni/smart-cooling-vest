export type MetricSource = 'live' | 'lastValid' | 'missing';
export type MetricStatusTone = 'ok' | 'warn' | 'danger' | 'muted' | 'info';

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
  unit?: string;
  decimals?: number;
  format?: (value: T) => string;
  validate?: (value: T) => boolean;
  sensorOk?: boolean;
  ageMs?: number;
  staleAfterMs?: number;
  isOffline?: boolean;
  lastValidValue?: T;
}

const isNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const defaultValidate = <T>(value: T) => {
  if (typeof value === 'number') {
    return isNumber(value);
  }
  return value !== undefined && value !== null;
};

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
  const isStale =
    typeof options.ageMs === 'number' && typeof options.staleAfterMs === 'number'
      ? options.ageMs > options.staleAfterMs
      : false;
  const sensorOk = options.sensorOk;

  const isLiveValid = hasRawValue && validate(rawValue as T) && sensorOk !== false;

  let source: MetricSource = 'missing';
  let displayValue: T | undefined;
  let statusLabel = 'Missing';
  let statusTone: MetricStatusTone = 'muted';
  let isValid = false;

  if (isLiveValid) {
    source = 'live';
    displayValue = rawValue as T;
    isValid = true;

    if (isOffline) {
      statusLabel = 'Offline';
      statusTone = 'danger';
    } else if (isStale) {
      statusLabel = 'Stale';
      statusTone = 'warn';
    } else {
      statusLabel = 'Live';
      statusTone = 'ok';
    }
  } else if (options.lastValidValue !== undefined && options.lastValidValue !== null) {
    source = 'lastValid';
    displayValue = options.lastValidValue;
    isValid = true;
    statusLabel = 'Last valid';
    statusTone = 'info';
  } else if (sensorOk === false) {
    statusLabel = 'Sensor failed';
    statusTone = 'danger';
  } else if (hasRawValue) {
    statusLabel = 'Invalid';
    statusTone = 'danger';
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
