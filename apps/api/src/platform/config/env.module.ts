import { Global, Injectable, Module } from '@nestjs/common';
import { integrationModes, validateEnv, type Env } from './env';

/**
 * Typed, validated environment. Injected everywhere instead of reading process.env so a
 * missing or malformed variable fails at boot, once, with a readable message.
 */
@Injectable()
export class EnvService {
  readonly env: Env;

  constructor() {
    this.env = validateEnv(process.env);
  }

  get integrations() {
    return integrationModes(this.env);
  }
}

@Global()
@Module({ providers: [EnvService], exports: [EnvService] })
export class EnvModule {}
