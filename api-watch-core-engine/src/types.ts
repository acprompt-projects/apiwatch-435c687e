export interface HealthCheckRule {
  expectedStatus?: number;
  bodyRegex?: string;
  latencyThresholdMs?: number;
}

export interface EndpointConfig {
  id: string;
  name: string;
  url: string;
  method?: "GET" | "POST" | "PUT" | "DELETE" | "HEAD" | "PATCH";
  headers?: Record<string, string>;
  body?: string;
  pollingIntervalMs: number;
  healthCheck?: HealthCheckRule;
  tags?: string[];
}

export interface PingResult {
  endpointId: string;
  timestamp: number;
  statusCode: number | null;
  responseTimeMs: number;
  isUp: boolean;
  error: string | null;
  violations: string[];
}

export interface EndpointMetrics {
  endpointId: string;
  totalChecks: number;
  successfulChecks: number;
  uptimePercent: number;
  avgResponseTimeMs: number;
  p99ResponseTimeMs: number;
  lastCheck: PingResult | null;
  recentResults: PingResult[];
}

export type PingListener = (result: PingResult) => void;

export interface MonitorEngineOptions {
  maxHistoryPerEndpoint?: number;
  fetchTimeoutMs?: number;
}