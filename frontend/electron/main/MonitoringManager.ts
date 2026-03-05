import * as Sentry from '@sentry/electron/main';
import { PostHog } from 'posthog-node';
import pino from 'pino';
import * as os from 'os';
import { app } from 'electron';

export interface HealthMetrics {
  timestamp: number;
  cpu: number;
  memory: {
    used: number;
    total: number;
    percentage: number;
  };
  uptime: number;
  wsConnected: boolean;
  lastTickTime?: number;
  tickLatency?: number;
}

export interface PerformanceMetric {
  name: string;
  duration: number;
  timestamp: number;
  metadata?: Record<string, any>;
}

export class MonitoringManager {
  private static instance: MonitoringManager;
  private logger: pino.Logger;
  private posthog: PostHog | null = null;
  private metrics: HealthMetrics[] = [];
  private readonly MAX_METRICS = 1000;
  private metricsInterval: NodeJS.Timeout | null = null;

  private constructor() {
    // Initialize logger with pretty print in dev
    this.logger = pino({
      level: process.env.NODE_ENV === 'development' ? 'debug' : 'info',
      transport: process.env.NODE_ENV === 'development' 
        ? {
            target: 'pino-pretty',
            options: {
              colorize: true,
              translateTime: 'SYS:standard',
              ignore: 'pid,hostname'
            }
          }
        : undefined
    });

    this.initializeSentry();
    this.initializePostHog();
    this.startMetricsCollection();
  }

  static getInstance(): MonitoringManager {
    if (!MonitoringManager.instance) {
      MonitoringManager.instance = new MonitoringManager();
    }
    return MonitoringManager.instance;
  }

  /**
   * Initialize Sentry for crash reporting
   */
  private initializeSentry(): void {
    if (process.env.SENTRY_DSN) {
      Sentry.init({
        dsn: process.env.SENTRY_DSN,
        environment: process.env.NODE_ENV || 'production',
        release: app.getVersion(),
        tracesSampleRate: 0.1,
        beforeSend(event) {
          // Remove sensitive data
          if (event.user) {
            delete event.user.email;
            delete event.user.ip_address;
          }
          return event;
        }
      });

      this.logger.info('Sentry initialized');
    }
  }

  /**
   * Initialize PostHog for analytics
   */
  private initializePostHog(): void {
    if (process.env.POSTHOG_API_KEY) {
      this.posthog = new PostHog(process.env.POSTHOG_API_KEY, {
        host: 'https://app.posthog.com',
        flushAt: 20,
        flushInterval: 10000
      });

      this.logger.info('PostHog initialized');
    }
  }

  /**
   * Start collecting system metrics
   */
  private startMetricsCollection(): void {
    this.metricsInterval = setInterval(() => {
      const metrics = this.collectMetrics();
      this.metrics.push(metrics);

      // Keep only last MAX_METRICS
      if (this.metrics.length > this.MAX_METRICS) {
        this.metrics.shift();
      }

      // Alert on high memory usage
      if (metrics.memory.percentage > 80) {
        this.logger.warn({
          memory: metrics.memory
        }, 'High memory usage detected');
      }

      // Alert on high CPU usage
      if (metrics.cpu > 80) {
        this.logger.warn({
          cpu: metrics.cpu
        }, 'High CPU usage detected');
      }
    }, 30000); // Every 30 seconds
  }

  /**
   * Collect current system metrics
   */
  private collectMetrics(): HealthMetrics {
    const cpus = os.cpus();
    const totalMemory = os.totalmem();
    const freeMemory = os.freemem();
    const usedMemory = totalMemory - freeMemory;

    // Calculate CPU usage (simplified)
    const cpuUsage = cpus.reduce((acc, cpu) => {
      const total = Object.values(cpu.times).reduce((a, b) => a + b, 0);
      const idle = cpu.times.idle;
      return acc + ((total - idle) / total) * 100;
    }, 0) / cpus.length;

    return {
      timestamp: Date.now(),
      cpu: cpuUsage,
      memory: {
        used: usedMemory,
        total: totalMemory,
        percentage: (usedMemory / totalMemory) * 100
      },
      uptime: process.uptime(),
      wsConnected: false // Will be updated by AngelOneAdapter
    };
  }

  /**
   * Get current metrics
   */
  getCurrentMetrics(): HealthMetrics {
    return this.collectMetrics();
  }

  /**
   * Get historical metrics
   */
  getHistoricalMetrics(limit: number = 100): HealthMetrics[] {
    return this.metrics.slice(-limit);
  }

  /**
   * Log info message
   */
  info(message: string, data?: any): void {
    this.logger.info(data || {}, message);
  }

  /**
   * Log warning message
   */
  warn(message: string, data?: any): void {
    this.logger.warn(data || {}, message);
  }

  /**
   * Log error message
   */
  error(message: string, error?: Error, data?: any): void {
    this.logger.error({
      ...(data || {}),
      error: error?.message,
      stack: error?.stack
    }, message);

    if (error) {
      Sentry.captureException(error);
    }
  }

  /**
   * Track event in analytics
   */
  trackEvent(event: string, properties?: Record<string, any>): void {
    if (this.posthog) {
      this.posthog.capture({
        distinctId: 'anonymous', // Will be replaced with actual user ID
        event,
        properties
      });
    }

    this.logger.debug({ event, properties }, 'Event tracked');
  }

  /**
   * Track performance metric
   */
  trackPerformance(metric: PerformanceMetric): void {
    this.logger.debug(metric, 'Performance metric');

    if (this.posthog) {
      this.posthog.capture({
        distinctId: 'anonymous',
        event: 'performance_metric',
        properties: metric
      });
    }
  }

  /**
   * Measure function execution time
   */
  async measure<T>(
    name: string,
    fn: () => Promise<T>,
    metadata?: Record<string, any>
  ): Promise<T> {
    const start = Date.now();
    
    try {
      const result = await fn();
      const duration = Date.now() - start;

      this.trackPerformance({
        name,
        duration,
        timestamp: start,
        metadata
      });

      return result;
    } catch (error) {
      const duration = Date.now() - start;

      this.trackPerformance({
        name: `${name}_error`,
        duration,
        timestamp: start,
        metadata: {
          ...metadata,
          error: (error as Error).message
        }
      });

      throw error;
    }
  }

  /**
   * Set user context for monitoring
   */
  setUser(userId: string, email?: string): void {
    Sentry.setUser({
      id: userId,
      email
    });

    if (this.posthog) {
      this.posthog.identify({
        distinctId: userId,
        properties: {
          email
        }
      });
    }
  }

  /**
   * Clear user context
   */
  clearUser(): void {
    Sentry.setUser(null);
  }

  /**
   * Add breadcrumb for debugging
   */
  addBreadcrumb(message: string, category: string, data?: any): void {
    Sentry.addBreadcrumb({
      message,
      category,
      data,
      level: 'info'
    });
  }

  /**
   * Shutdown monitoring
   */
  async shutdown(): Promise<void> {
    if (this.metricsInterval) {
      clearInterval(this.metricsInterval);
    }

    if (this.posthog) {
      await this.posthog.shutdown();
    }

    await Sentry.close(2000);
  }
}
