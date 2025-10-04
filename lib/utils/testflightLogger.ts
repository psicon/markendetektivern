/**
 * TestFlight Console Logger
 * Sammelt alle console.log/error/warn Ausgaben für TestFlight Debugging
 */

interface LogEntry {
  type: 'log' | 'error' | 'warn';
  timestamp: string;
  message: string;
  args: any[];
}

class TestFlightLogger {
  private static instance: TestFlightLogger;
  private logs: LogEntry[] = [];
  private maxLogs = 100;
  private originalConsole: {
    log: typeof console.log;
    error: typeof console.error;
    warn: typeof console.warn;
  };

  private constructor() {
    // Speichere Original-Console-Funktionen
    this.originalConsole = {
      log: console.log,
      error: console.error,
      warn: console.warn,
    };
  }

  static getInstance(): TestFlightLogger {
    if (!TestFlightLogger.instance) {
      TestFlightLogger.instance = new TestFlightLogger();
    }
    return TestFlightLogger.instance;
  }

  /**
   * Aktiviere Console-Überwachung für TestFlight
   */
  enable() {
    // Nur in Production aktivieren
    if (__DEV__) return;

    // Überschreibe console.log
    console.log = (...args: any[]) => {
      this.addLog('log', args);
      this.originalConsole.log(...args);
    };

    // Überschreibe console.error
    console.error = (...args: any[]) => {
      this.addLog('error', args);
      this.originalConsole.error(...args);
    };

    // Überschreibe console.warn
    console.warn = (...args: any[]) => {
      this.addLog('warn', args);
      this.originalConsole.warn(...args);
    };

    // Globaler Error Handler
    if (typeof global !== 'undefined') {
      const originalHandler = global.ErrorUtils?.getGlobalHandler();
      global.ErrorUtils?.setGlobalHandler((error: Error, isFatal?: boolean) => {
        this.addLog('error', [`🚨 Global Error (Fatal: ${isFatal}):`, error.message, error.stack]);
        if (originalHandler) {
          originalHandler(error, isFatal);
        }
      });
    }
  }

  /**
   * Log hinzufügen
   */
  private addLog(type: LogEntry['type'], args: any[]) {
    const entry: LogEntry = {
      type,
      timestamp: new Date().toISOString(),
      message: args.map(arg => {
        if (typeof arg === 'object') {
          try {
            return JSON.stringify(arg, null, 2);
          } catch {
            return String(arg);
          }
        }
        return String(arg);
      }).join(' '),
      args,
    };

    this.logs.push(entry);

    // Begrenze die Anzahl der Logs
    if (this.logs.length > this.maxLogs) {
      this.logs.shift();
    }
  }

  /**
   * Alle Logs abrufen
   */
  getLogs(): LogEntry[] {
    return [...this.logs];
  }

  /**
   * Logs als formatierten String
   */
  getLogsAsString(): string {
    return this.logs.map(log => {
      const icon = log.type === 'error' ? '❌' : log.type === 'warn' ? '⚠️' : '📝';
      return `${icon} [${log.timestamp}] ${log.message}`;
    }).join('\n');
  }

  /**
   * Letzte Fehlermeldungen abrufen
   */
  getLastErrors(count: number = 5): string[] {
    return this.logs
      .filter(log => log.type === 'error')
      .slice(-count)
      .map(log => log.message);
  }

  /**
   * Logs löschen
   */
  clearLogs() {
    this.logs = [];
  }
}

export const testFlightLogger = TestFlightLogger.getInstance();
