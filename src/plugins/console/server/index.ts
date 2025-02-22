/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0 and the Server Side Public License, v 1; you may not use this file except
 * in compliance with, at your election, the Elastic License 2.0 or the Server
 * Side Public License, v 1.
 */

import { PluginConfigDescriptor, PluginInitializerContext } from 'kibana/server';

import { ConfigType, config as configSchema } from './config';
import { ConsoleServerPlugin } from './plugin';

export { ConsoleSetup, ConsoleStart } from './types';

export const plugin = (ctx: PluginInitializerContext) => new ConsoleServerPlugin(ctx);

export const config: PluginConfigDescriptor<ConfigType> = {
  deprecations: ({ deprecate, unused, rename }) => [deprecate('enabled', '8.0.0'), unused('ssl')],
  schema: configSchema,
};
