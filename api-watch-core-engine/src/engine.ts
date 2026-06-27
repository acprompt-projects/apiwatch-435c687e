import {
  EndpointConfig,
  PingResult,
  PingListener,
  EndpointMetrics,
  MonitorEngineOptions,
} from "./types";

const DEFAULT_MAX_HISTORY = 1000;
const DEFAULT_FETCH_TIMEOUT = 15_000;

export class MonitorEngine {
  private endpoints: Map<string, EndpointConfig> = new Map();
  private timers: Map<string, ReturnType<typeof setInterval>> = new Map();
  private history: Map<string, PingResult[]> = new Map();
  private listeners: Set<PingListener> = new Set();
  private readonly maxHistory: number;
  private readonly fetchTimeoutMs: number;
  private fetchFn: typeof globalThis.fetch;

  constructor(options?: MonitorEngineOptions, fetchFn?: typeof globalThis.fetch) {
    this.maxHistory = options?.maxHistoryPerEndpoint ?? DEFAULT_MAX_HISTORY;
    this.fetchTimeoutMs = options?.fetchTimeoutMs ?? DEFAULT_FETCH_TIMEOUT;
    this.fetchFn = fetchFn ?? globalThis.fetch.bind(globalThis);
  }

  addEndpoint(config: EndpointConfig): void {
    if (this.endpoints.has(config.id)) this.removeEndpoint(config.id);
    this.endpoints.set(config.id, config);
    this.history.set(config.id, []);
    this.startPolling(config);
  }

  removeEndpoint(id: string): void {
    this.stopPolling(id);
    this.endpoints.delete(id);
    this.history.delete(id);
  }

  getEndpoint(id: string): EndpointConfig | undefined {
    return this.endpoints.get(id);
  }

  getAllEndpoints(): EndpointConfig[] {
    return [...this.endpoints.values()];
  }

  onResult(listener: PingListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getHistory(endpointId: string, limit?: number): PingResult[] {
    const results = this.history.get(endpointId) ?? [];
    return limit ? results.slice(-limit) : [...results];
  }

  getMetrics(endpointId: string): EndpointMetrics | null {
    const results = this.history.get(endpointId) ?? [];
    if (results.length === 0) {
      return {
        endpointId,
        totalChecks: 0,
        successfulChecks: 0,
        uptimePercent: 0,
        avgResponseTimeMs: 0,
        p99ResponseTimeMs: 0,
        lastCheck: null,
        recentResults: [],
      };
    }
    const successful = results.filter((r) => r.isUp);
    const responseTimes = results.map((r) => r.responseTimeMs).sort((a, b) => a - b);
    const p99Index = Math.ceil(responseTimes.length * 0.99) - 1;
    return {
      endpointId,
      totalChecks: results.length,
      successfulChecks: successful.length,
      uptimePercent: (successful.length / results.length) * 100,
      avgResponseTimeMs:
        responseTimes.reduce((s, t) => s + t, 0) / responseTimes.length,
      p99ResponseTimeMs: responseTimes[Math.max(0, p99Index)],
      lastCheck: results[results.length - 1],
      recentResults: results.slice(-20),
    };
  }

  async pingNow(endpointId: string): Promise<PingResult | null> {
    const config = this.endpoints.get(endpointId);
    if (!config) return null;
    const result = await this.executePing(config);
    this.recordResult(endpointId, result);
    return result;
  }

  shutdown(): void {
    for (const id of this.timers.keys()) this.stopPolling(id);
  }

  private startPolling(config: EndpointConfig): void {
    this.stopPolling(config.id);
    const timer = setInterval(() => {
      this.executePing(config).then((result) =>
        this.recordResult(config.id, result)
      );
    }, config.pollingIntervalMs);
    this.timers.set(config.id, timer);
    this.executePing(config).then((result) =>
      this.recordResult(config.id, result)
    );
  }

  private stopPolling(id: string): void {
    const timer = this.timers.get(id);
    if (timer) {
      clearInterval(timer);
      this.timers.delete(id);
    }
  }

  private async executePing(config: EndpointConfig): Promise<PingResult> {
    const start = performance.now();
    const violations: string[] = [];
    let statusCode: number | null = null;
    let body = "";
    let errorMsg: string | null = null;

    try {
      const controller = new AbortController();
      const timeout = setTimeout(
        () => controller.abort(),
        this.fetchTimeoutMs
      );
      const response = await this.fetchFn(config.url, {
        method: config.method ?? "GET",
        headers: config.headers ?? {},
        body: config.body ?? undefined,
        signal: controller.signal,
      });
      clearTimeout(timeout);
      statusCode = response.status;
      try {
        body = await response.text();
      } catch {
        /* empty body is acceptable */
      }
    } catch (err: any) {
      errorMsg = err.name === "AbortError" ? "Timeout" : (err.message ?? "Unknown error");
    }

    const responseTimeMs = performance.now() - start;
    const rule = config.healthCheck;

    if (rule) {
      if (rule.expectedStatus !== undefined && statusCode !== rule.expectedStatus) {
        violations.push(
          `Status ${statusCode} !== expected ${rule.expectedStatus}`
        );
      }
      if (rule.bodyRegex) {
        const re = new RegExp(rule.bodyRegex);
        if (!re.test(body)) {
          violations.push(`Body did not match regex /${rule.bodyRegex}/`);
        }
      }
      if (rule.latencyThresholdMs !== undefined && responseTimeMs > rule.latencyThresholdMs) {
        violations.push(
          `Latency ${responseTimeMs.toFixed(1)}ms > threshold ${rule.latencyThresholdMs}ms`
        );
      }
    }

    const isUp = errorMsg === null && violations.length === 0;

    return {
      endpointId: config.id,
      timestamp: Date.now(),
      statusCode,
      responseTimeMs,
      isUp,
      error: errorMsg,
      violations,
    };
  }

  private recordResult(endpointId: string, result: PingResult): void {
    const results = this.history.get(endpointId);
    if (results) {
      results.push(result);
      if (results.length > this.maxHistory) results.splice(0, results.length - this.maxHistory);
    }
    for (const listener of this.listeners) {
      try { listener(result); } catch { /* swallow listener errors */ }
    }
  }
}