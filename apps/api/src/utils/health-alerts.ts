import { logWarn, logInfo } from './logger.js';
// Bounded rolling windows; expected 4xx/lock/user cancellation never page operators.
export class HealthAlerts {
  private samples: { time: number; operation: string; failed: boolean }[] = [];
  private active = new Set<string>();
  constructor(private emit = (event: string, alert: string) =>
    (event === 'health_alert' ? logWarn : logInfo)(event, { alert })) {}
  record(operation: 'api' | 'sync' | 'backup', status: number, now = Date.now()) {
    this.samples = this.samples.filter(s => now - s.time < 300000).slice(-9999);
    this.samples.push({ time: now, operation, failed: status >= 500 });
    for (const op of ['api', 'sync', 'backup']) {
      const group = this.samples.filter(s => s.operation === op);
      const failures = group.filter(s => s.failed).length;
      const min = op === 'backup' ? 5 : 20;
      const bad = group.length >= min && failures >= (op === 'backup' ? 3 : 5) && failures / group.length >= (op === 'backup' ? 0.5 : 0.2);
      const alert = `${op}_errors`;
      if (bad && !this.active.has(alert)) { this.active.add(alert); this.emit('health_alert', alert); }
      if (group.length >= min && failures / group.length < 0.05 && this.active.delete(alert)) this.emit('health_recovered', alert);
    }
  }
}
export const healthAlerts = new HealthAlerts();
