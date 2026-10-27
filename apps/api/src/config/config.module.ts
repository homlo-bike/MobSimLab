import {
  type DynamicModule,
  Global,
  Inject,
  Injectable,
  Module,
  type OnApplicationShutdown,
} from "@nestjs/common";
import { createDatabase, DATABASE, type Database } from "../db/database";
import type { AppConfig } from "./env";

/** Injection token for the validated configuration. */
export const APP_CONFIG = Symbol("APP_CONFIG");

/** Closes the connection pool when the app shuts down. */
@Injectable()
class DatabaseLifecycle implements OnApplicationShutdown {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async onApplicationShutdown(): Promise<void> {
    await this.db.destroy();
  }
}

/** Provides the configuration and the database to every module. */
@Global()
@Module({})
export class ConfigModule {
  /**
   * Purpose: register config and database providers.
   * Inputs: validated config. Output: a global dynamic module.
   */
  static forRoot(config: AppConfig): DynamicModule {
    return {
      module: ConfigModule,
      providers: [
        { provide: APP_CONFIG, useValue: config },
        { provide: DATABASE, useFactory: () => createDatabase(config) },
        DatabaseLifecycle,
      ],
      exports: [APP_CONFIG, DATABASE],
    };
  }
}
