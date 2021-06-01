/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0 and the Server Side Public License, v 1; you may not use this file except
 * in compliance with, at your election, the Elastic License 2.0 or the Server
 * Side Public License, v 1.
 */

import { inspect } from 'util';
import { Client } from '@elastic/elasticsearch';
import url from 'url';
import { Either, fromNullable, chain, getOrElse } from 'fp-ts/Either';
import { flow } from 'fp-ts/function';
import { FtrService } from '../ftr_provider_context';

const pluck = (key: string) => (obj: any): Either<Error, string> =>
  fromNullable(new Error(`Missing ${key}`))(obj[key]);

const types = (node: string) => async (index: string = '.kibana') => {
  let res: unknown;
  try {
    const { body } = await new Client({ node }).search({
      index,
      body: {
        aggs: {
          savedobjs: {
            terms: {
              field: 'type',
            },
          },
        },
      },
    });

    res = flow(
      pluck('aggregations'),
      chain(pluck('savedobjs')),
      chain(pluck('buckets')),
      getOrElse((err) => `${err.message}`)
    )(body);
  } catch (err) {
    throw new Error(`Error while searching for saved object types: ${err}`);
  }

  return res;
};

export class SavedObjectInfoService extends FtrService {
  private readonly config = this.ctx.getService('config');

  public getTypes() {
    return types(url.format(this.config.get('servers.elasticsearch')));
  }

  public async getTypesPretty() {
    const xs = await this.getTypes()();
    return inspect(xs, {
      compact: false,
      depth: 99,
      breakLength: 80,
      sorted: true,
    });
  }
}
