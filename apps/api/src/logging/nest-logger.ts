import type { LoggerService } from "@nestjs/common";
import type { AppLogger, LogLevel } from "./logger";

/**
 * Sends NestJS's own messages and every `new Logger(name)` in the API through Winston. Nest's context (the name
 * given to the Logger) becomes the entry's `module`. Nest `verbose` is TRACE and `fatal` is CRITICAL.
 */
export class NestWinstonLogger implements LoggerService {
  constructor(private readonly logger: AppLogger) {}

  log(message: unknown, ...rest: unknown[]): void {
    this.write("info", message, rest);
  }

  error(message: unknown, ...rest: unknown[]): void {
    // Nest passes (message, stack?, context?).
    const [stack, ...more] = rest.length > 1 ? rest : [undefined, ...rest];
    this.write("error", message, more, typeof stack === "string" ? { stack } : undefined);
  }

  warn(message: unknown, ...rest: unknown[]): void {
    this.write("warn", message, rest);
  }

  debug(message: unknown, ...rest: unknown[]): void {
    this.write("debug", message, rest);
  }

  verbose(message: unknown, ...rest: unknown[]): void {
    this.write("trace", message, rest);
  }

  fatal(message: unknown, ...rest: unknown[]): void {
    this.write("critical", message, rest);
  }

  private write(level: LogLevel, message: unknown, rest: unknown[], extra?: Record<string, unknown>): void {
    const last = rest[rest.length - 1];
    const module = typeof last === "string" ? last : undefined;
    const fields = { module, ...extra };
    if (message instanceof Error) {
      this.logger.log(level, message.message, { ...fields, error: message });
    } else if (typeof message === "string") {
      this.logger.log(level, message, fields);
    } else {
      this.logger.log(level, "", { ...fields, data: message });
    }
  }
}
