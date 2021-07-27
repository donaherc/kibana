/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { cloneDeep } from 'lodash';
import axios from 'axios';
import { SavedObjectsClientContract } from 'kibana/server';
import { SearchRequest } from '@elastic/elasticsearch/api/types';
import { URL } from 'url';
import { CoreStart, ElasticsearchClient, Logger } from 'src/core/server';
import { TelemetryPluginStart, TelemetryPluginSetup } from 'src/plugins/telemetry/server';
import { transformDataToNdjson } from '../../utils/read_stream/create_stream_from_ndjson';
import {
  TaskManagerSetupContract,
  TaskManagerStartContract,
} from '../../../../task_manager/server';
import { TelemetryDiagTask } from './diagnostic_task';
import { TelemetryEndpointTask } from './endpoint_task';
import { EndpointAppContextService } from '../../endpoint/endpoint_app_context_services';
import { AgentService, AgentPolicyServiceInterface } from '../../../../fleet/server';
import {
  TelemetryEvent
} from './types';
import {
  AllowlistAlertEventFields,
  copyAllowlistedFields
} from './filters'



export class TelemetryEventsSender {
  private readonly initialCheckDelayMs = 10 * 1000;
  private readonly checkIntervalMs = 60 * 1000;
  private readonly max_records = 10_000;
  private readonly logger: Logger;
  private maxQueueSize = 100;
  private telemetryStart?: TelemetryPluginStart;
  private telemetrySetup?: TelemetryPluginSetup;
  private intervalId?: NodeJS.Timeout;
  private isSending = false;
  private queue: TelemetryEvent[] = [];
  private isOptedIn?: boolean = true; // Assume true until the first check
  private diagTask?: TelemetryDiagTask;
  private epMetricsTask?: TelemetryEndpointTask;
  private agentService?: AgentService;
  private agentPolicyService?: AgentPolicyServiceInterface;
  private esClient?: ElasticsearchClient;
  private savedObjectClient?: SavedObjectsClientContract;

  constructor(logger: Logger) {
    this.logger = logger.get('telemetry_events');
  }

  public setup(telemetrySetup?: TelemetryPluginSetup, taskManager?: TaskManagerSetupContract) {
    this.telemetrySetup = telemetrySetup;

    if (taskManager) {
      this.diagTask = new TelemetryDiagTask(this.logger, taskManager, this);
      this.epMetricsTask = new TelemetryEndpointTask(this.logger, taskManager, this);
    }
  }

  public start(
    core?: CoreStart,
    telemetryStart?: TelemetryPluginStart,
    taskManager?: TaskManagerStartContract,
    endpointContextService?: EndpointAppContextService
  ) {
    this.telemetryStart = telemetryStart;
    this.esClient = core?.elasticsearch.client.asInternalUser;
    this.agentService = endpointContextService?.getAgentService();
    this.agentPolicyService = endpointContextService?.getAgentPolicyService();
    this.savedObjectClient = (core?.savedObjects.createInternalRepository() as unknown) as SavedObjectsClientContract;

    if (taskManager && this.diagTask && this.epMetricsTask) {
      this.logger.debug(`Starting diagnostic and endpoint telemetry tasks`);
      this.diagTask.start(taskManager);
      this.epMetricsTask.start(taskManager);
    }

    this.logger.debug(`Starting local task`);
    setTimeout(() => {
      this.sendIfDue();
      this.intervalId = setInterval(() => this.sendIfDue(), this.checkIntervalMs);
    }, this.initialCheckDelayMs);
  }

  public stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
    }
  }

  public async fetchDiagnosticAlerts(executeFrom: string, executeTo: string) {
    const query = {
      expand_wildcards: 'open,hidden',
      index: '.logs-endpoint.diagnostic.collection-*',
      ignore_unavailable: true,
      size: this.maxQueueSize,
      body: {
        query: {
          range: {
            'event.ingested': {
              gte: executeFrom,
              lt: executeTo,
            },
          },
        },
        sort: [
          {
            'event.ingested': {
              order: 'desc' as const,
            },
          },
        ],
      },
    };

    if (this.esClient === undefined) {
      throw Error('could not fetch diagnostic alerts. es client is not available');
    }

    return (await this.esClient.search<TelemetryEvent>(query)).body;
  }

  public async fetchEndpointMetrics(executeFrom: string, executeTo: string) {
    if (this.esClient === undefined) {
      throw Error('could not fetch policy responses. es client is not available');
    }

    const query: SearchRequest = {
      expand_wildcards: 'open,hidden',
      index: `.ds-metrics-endpoint.metrics-*`,
      ignore_unavailable: false,
      size: 0, // no query results required - only aggregation quantity
      body: {
        query: {
          range: {
            '@timestamp': {
              gte: executeFrom,
              lt: executeTo,
            },
          },
        },
        aggs: {
          endpoint_agents: {
            terms: {
              field: 'agent.id',
              size: this.max_records,
            },
            aggs: {
              latest_metrics: {
                top_hits: {
                  size: 1,
                  sort: [
                    {
                      '@timestamp': {
                        order: 'desc',
                      },
                    },
                  ],
                },
              },
            },
          },
        },
      },
    };

    return this.esClient.search(query);
  }

  public async fetchFleetAgents() {
    if (this.esClient === undefined) {
      throw Error('could not fetch policy responses. es client is not available');
    }

    return this.agentService?.listAgents(this.esClient, {
      perPage: this.max_records,
      showInactive: true,
      sortField: 'enrolled_at',
      sortOrder: 'desc',
    });
  }

  public async fetchPolicyConfigs(id: string) {
    if (this.savedObjectClient === undefined) {
      throw Error('could not fetch endpoint policy configs. saved object client is not available');
    }

    return this.agentPolicyService?.get(this.savedObjectClient, id);
  }

  public async fetchEndpointPolicyResponses(executeFrom: string, executeTo: string) {
    if (this.esClient === undefined) {
      throw Error('could not fetch policy responses. es client is not available');
    }

    const query: SearchRequest = {
      expand_wildcards: 'open,hidden',
      index: `.ds-metrics-endpoint.policy*`,
      ignore_unavailable: false,
      size: 0, // no query results required - only aggregation quantity
      body: {
        query: {
          range: {
            '@timestamp': {
              gte: executeFrom,
              lt: executeTo,
            },
          },
        },
        aggs: {
          policy_responses: {
            terms: {
              size: this.max_records,
              field: 'Endpoint.policy.applied.id',
            },
            aggs: {
              latest_response: {
                top_hits: {
                  size: 1,
                  sort: [
                    {
                      '@timestamp': {
                        order: 'desc',
                      },
                    },
                  ],
                },
              },
            },
          },
        },
      },
    };

    return this.esClient.search(query);
  }

  public queueTelemetryEvents(events: TelemetryEvent[]) {
    const qlength = this.queue.length;

    if (events.length === 0) {
      return;
    }

    this.logger.debug(`Queue events`);

    if (qlength >= this.maxQueueSize) {
      // we're full already
      return;
    }

    if (events.length > this.maxQueueSize - qlength) {
      this.queue.push(...this.processEvents(events.slice(0, this.maxQueueSize - qlength)));
    } else {
      this.queue.push(...this.processEvents(events));
    }
  }

  public processEvents(events: TelemetryEvent[]): TelemetryEvent[] {
    return events.map(function (obj: TelemetryEvent): TelemetryEvent {
      return copyAllowlistedFields(AllowlistAlertEventFields, obj);
    });
  }

  public async isTelemetryOptedIn() {
    this.isOptedIn = await this.telemetryStart?.getIsOptedIn();
    return this.isOptedIn === true;
  }

  private async sendIfDue() {
    if (this.isSending) {
      return;
    }

    if (this.queue.length === 0) {
      return;
    }

    try {
      this.isSending = true;

      this.isOptedIn = await this.isTelemetryOptedIn();
      if (!this.isOptedIn) {
        this.logger.debug(`Telemetry is not opted-in.`);
        this.queue = [];
        this.isSending = false;
        return;
      }

      const [telemetryUrl, clusterInfo, licenseInfo] = await Promise.all([
        this.fetchTelemetryUrl('alerts-endpoint'),
        this.fetchClusterInfo(),
        this.fetchLicenseInfo(),
      ]);

      this.logger.debug(`Telemetry URL: ${telemetryUrl}`);
      this.logger.debug(
        `cluster_uuid: ${clusterInfo?.cluster_uuid} cluster_name: ${clusterInfo?.cluster_name}`
      );

      const toSend: TelemetryEvent[] = cloneDeep(this.queue).map((event) => ({
        ...event,
        ...(licenseInfo ? { license: this.copyLicenseFields(licenseInfo) } : {}),
        cluster_uuid: clusterInfo.cluster_uuid,
        cluster_name: clusterInfo.cluster_name,
      }));
      this.queue = [];

      await this.sendEvents(
        toSend,
        telemetryUrl,
        clusterInfo.cluster_uuid,
        clusterInfo.version?.number,
        licenseInfo?.uid
      );
    } catch (err) {
      this.logger.warn(`Error sending telemetry events data: ${err}`);
      this.queue = [];
    }
    this.isSending = false;
  }

  /**
   * This function sends events to the elastic telemetry channel. Caution is required
   * because it does no allowlist filtering. The caller is responsible for making sure
   * that there is no sensitive material or PII in the records that are sent upstream.
   *
   * @param channel the elastic telemetry channel
   * @param toSend telemetry events
   */
  public async sendOnDemand(channel: string, toSend: unknown[]) {
    try {
      const [telemetryUrl, clusterInfo, licenseInfo] = await Promise.all([
        this.fetchTelemetryUrl(channel),
        this.fetchClusterInfo(),
        this.fetchLicenseInfo(),
      ]);

      this.logger.debug(`Telemetry URL: ${telemetryUrl}`);
      this.logger.debug(
        `cluster_uuid: ${clusterInfo?.cluster_uuid} cluster_name: ${clusterInfo?.cluster_name}`
      );

      await this.sendEvents(
        toSend,
        telemetryUrl,
        clusterInfo.cluster_uuid,
        clusterInfo.version?.number,
        licenseInfo?.uid
      );
    } catch (err) {
      this.logger.warn(`Error sending telemetry events data: ${err}`);
    }
  }

  private async fetchClusterInfo(): Promise<ESClusterInfo> {
    if (this.esClient === undefined) {
      throw Error("Couldn't fetch cluster info. es client is not available");
    }
    return getClusterInfo(this.esClient);
  }

  private async fetchTelemetryUrl(channel: string): Promise<string> {
    const telemetryUrl = await this.telemetrySetup?.getTelemetryUrl();
    if (!telemetryUrl) {
      throw Error("Couldn't get telemetry URL");
    }
    return getV3UrlFromV2(telemetryUrl.toString(), channel);
  }

  private async fetchLicenseInfo(): Promise<ESLicense | undefined> {
    if (!this.esClient) {
      return undefined;
    }
    try {
      const ret = await getLicense(this.esClient, true);
      return ret.license;
    } catch (err) {
      this.logger.warn(`Error retrieving license: ${err}`);
      return undefined;
    }
  }

  private copyLicenseFields(lic: ESLicense) {
    return {
      uid: lic.uid,
      status: lic.status,
      type: lic.type,
      ...(lic.issued_to ? { issued_to: lic.issued_to } : {}),
      ...(lic.issuer ? { issuer: lic.issuer } : {}),
    };
  }

  private async sendEvents(
    events: unknown[],
    telemetryUrl: string,
    clusterUuid: string,
    clusterVersionNumber: string | undefined,
    licenseId: string | undefined
  ) {
    const ndjson = transformDataToNdjson(events);
    // this.logger.debug(`NDJSON: ${ndjson}`);

    try {
      const resp = await axios.post(telemetryUrl, ndjson, {
        headers: {
          'Content-Type': 'application/x-ndjson',
          'X-Elastic-Cluster-ID': clusterUuid,
          'X-Elastic-Stack-Version': clusterVersionNumber ? clusterVersionNumber : '7.10.0',
          ...(licenseId ? { 'X-Elastic-License-ID': licenseId } : {}),
        },
      });
      this.logger.debug(`Events sent!. Response: ${resp.status} ${JSON.stringify(resp.data)}`);
    } catch (err) {
      this.logger.warn(
        `Error sending events: ${err.response.status} ${JSON.stringify(err.response.data)}`
      );
    }
  }
}



// Forms URLs like:
// https://telemetry.elastic.co/v3/send/my-channel-name or
// https://telemetry-staging.elastic.co/v3-dev/send/my-channel-name
export function getV3UrlFromV2(v2url: string, channel: string): string {
  const url = new URL(v2url);
  if (!url.hostname.includes('staging')) {
    url.pathname = `/v3/send/${channel}`;
  } else {
    url.pathname = `/v3-dev/send/${channel}`;
  }
  return url.toString();
}

// For getting cluster info. Copied from telemetry_collection/get_cluster_info.ts
export interface ESClusterInfo {
  cluster_uuid: string;
  cluster_name: string;
  version?: {
    number: string;
    build_flavor: string;
    build_type: string;
    build_hash: string;
    build_date: string;
    build_snapshot?: boolean;
    lucene_version: string;
    minimum_wire_compatibility_version: string;
    minimum_index_compatibility_version: string;
  };
}

/**
 * Get the cluster info from the connected cluster.
 * Copied from:
 * src/plugins/telemetry/server/telemetry_collection/get_cluster_info.ts
 * This is the equivalent to GET /
 *
 * @param {function} esClient The asInternalUser handler (exposed for testing)
 */
export async function getClusterInfo(esClient: ElasticsearchClient) {
  const { body } = await esClient.info();
  return body;
}

// From https://www.elastic.co/guide/en/elasticsearch/reference/current/get-license.html
export interface ESLicense {
  status: string;
  uid: string;
  type: string;
  issue_date?: string;
  issue_date_in_millis?: number;
  expiry_date?: string;
  expirty_date_in_millis?: number;
  max_nodes?: number;
  issued_to?: string;
  issuer?: string;
  start_date_in_millis?: number;
}

async function getLicense(
  esClient: ElasticsearchClient,
  local: boolean
): Promise<{ license: ESLicense }> {
  return (
    await esClient.transport.request({
      method: 'GET',
      path: '/_license',
      querystring: {
        local,
        // For versions >= 7.6 and < 8.0, this flag is needed otherwise 'platinum' is returned for 'enterprise' license.
        accept_enterprise: 'true',
      },
    })
  ).body as Promise<{ license: ESLicense }>; // Note: We have to as cast since transport.request doesn't have generics
}
