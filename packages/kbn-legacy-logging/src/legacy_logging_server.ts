/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0 and the Server Side Public License, v 1; you may not use this file except
 * in compliance with, at your election, the Elastic License 2.0 or the Server
 * Side Public License, v 1.
 */

import { ServerExtType, Server } from '@hapi/hapi';
import Podium from '@hapi/podium';
import { setupLogging } from './setup_logging';
import { attachMetaData } from './metadata';
import { legacyLoggingConfigSchema } from './schema';

// these LogXXX types are duplicated to avoid a cross dependency with the @kbn/logging package.
// typescript will error if they diverge at some point.
type LogLevelId = 'all' | 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'off';

interface LogLevel {
  id: LogLevelId;
  value: number;
}

export interface LogRecord {
  timestamp: Date;
  level: LogLevel;
  context: string;
  message: string;
  error?: Error;
  meta?: { [name: string]: any };
  pid: number;
}

const isEmptyObject = (obj: object) => Object.keys(obj).length === 0;

function getDataToLog(error: Error | undefined, metadata: object, message: string) {
  if (error) {
    return error;
  }
  if (!isEmptyObject(metadata)) {
    return attachMetaData(message, metadata);
  }
  return message;
}

interface PluginRegisterParams {
  plugin: {
    register: (
      server: LegacyLoggingServer,
      options: PluginRegisterParams['options']
    ) => Promise<void>;
  };
  options: Record<string, any>;
}

/**
 * Converts core log level to a one that's known to the legacy platform.
 * @param level Log level from the core.
 */
function getLegacyLogLevel(level: LogLevel) {
  const logLevel = level.id.toLowerCase();
  if (logLevel === 'warn') {
    return 'warning';
  }

  if (logLevel === 'trace') {
    return 'debug';
  }

  return logLevel;
}

/**
 *  The "legacy" Kibana uses Hapi server + even-better plugin to log, so we should
 *  use the same approach here to make log records generated by the core to look the
 *  same as the rest of the records generated by the "legacy" Kibana. But to reduce
 *  overhead of having full blown Hapi server instance we create our own "light" version.
 *  @internal
 */
export class LegacyLoggingServer {
  public connections = [];
  // Emulates Hapi's usage of the podium event bus.
  public events: Podium = new Podium(['log', 'request', 'response']);

  private onPostStopCallback?: () => void;

  constructor(legacyLoggingConfig: any) {
    // We set `ops.interval` to max allowed number and `ops` filter to value
    // that doesn't exist to avoid logging of ops at all, if turned on it will be
    // logged by the "legacy" Kibana.
    const loggingConfig = legacyLoggingConfigSchema.validate({
      ...legacyLoggingConfig,
      events: {
        ...legacyLoggingConfig.events,
        ops: '__no-ops__',
      },
    });

    setupLogging(this as unknown as Server, loggingConfig, 2147483647);
  }

  public register({ plugin: { register }, options }: PluginRegisterParams): Promise<void> {
    return register(this, options);
  }

  public log({ level, context, message, error, timestamp, meta = {} }: LogRecord) {
    const { tags = [], ...metadata } = meta;

    this.events
      .emit('log', {
        data: getDataToLog(error, metadata, message),
        tags: [getLegacyLogLevel(level), ...context.split('.'), ...tags],
        timestamp: timestamp.getTime(),
      })
      // @ts-expect-error @hapi/podium emit is actually an async function
      .catch((err) => {
        // eslint-disable-next-line no-console
        console.error('An unexpected error occurred while writing to the log:', err.stack);
        process.exit(1);
      });
  }

  public stop() {
    // Tell the plugin we're stopping.
    if (this.onPostStopCallback !== undefined) {
      this.onPostStopCallback();
    }
  }

  public ext(eventName: ServerExtType, callback: () => void) {
    // method is called by plugin that's being registered.
    if (eventName === 'onPostStop') {
      this.onPostStopCallback = callback;
    }
    // We don't care about any others the plugin registers
  }

  public expose() {
    // method is called by plugin that's being registered.
  }
}
