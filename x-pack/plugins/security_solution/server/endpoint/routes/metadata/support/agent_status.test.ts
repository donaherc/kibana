/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { ElasticsearchClient, SavedObjectsClientContract } from 'kibana/server';
import { findAgentIDsByStatus } from './agent_status';
import {
  elasticsearchServiceMock,
  savedObjectsClientMock,
} from '../../../../../../../../src/core/server/mocks';
import { AgentService } from '../../../../../../fleet/server/services';
import { createMockAgentService } from '../../../../../../fleet/server/mocks';
import { Agent } from '../../../../../../fleet/common/types/models';
import { AgentStatusKueryHelper } from '../../../../../../fleet/common/services';

describe('test filtering endpoint hosts by agent status', () => {
  let mockSavedObjectClient: jest.Mocked<SavedObjectsClientContract>;
  let mockElasticsearchClient: jest.Mocked<ElasticsearchClient>;
  let mockAgentService: jest.Mocked<AgentService>;
  beforeEach(() => {
    mockSavedObjectClient = savedObjectsClientMock.create();
    mockElasticsearchClient = elasticsearchServiceMock.createClusterClient().asInternalUser;
    mockAgentService = createMockAgentService();
  });

  it('will accept a valid status condition', async () => {
    mockAgentService.listAgents.mockImplementationOnce(() =>
      Promise.resolve({
        agents: [],
        total: 0,
        page: 1,
        perPage: 10,
      })
    );

    const result = await findAgentIDsByStatus(
      mockAgentService,
      mockSavedObjectClient,
      mockElasticsearchClient,
      ['healthy']
    );
    expect(result).toBeDefined();
  });

  it('will filter for offline hosts', async () => {
    mockAgentService.listAgents
      .mockImplementationOnce(() =>
        Promise.resolve({
          agents: [{ id: 'id1' } as unknown as Agent, { id: 'id2' } as unknown as Agent],
          total: 2,
          page: 1,
          perPage: 2,
        })
      )
      .mockImplementationOnce(() =>
        Promise.resolve({
          agents: [],
          total: 2,
          page: 2,
          perPage: 2,
        })
      );

    const result = await findAgentIDsByStatus(
      mockAgentService,
      mockSavedObjectClient,
      mockElasticsearchClient,
      ['offline']
    );
    const offlineKuery = AgentStatusKueryHelper.buildKueryForOfflineAgents();
    expect(mockAgentService.listAgents.mock.calls[0][1].kuery).toEqual(
      expect.stringContaining(offlineKuery)
    );
    expect(result).toBeDefined();
    expect(result).toEqual(['id1', 'id2']);
  });

  it('will filter for multiple statuses', async () => {
    mockAgentService.listAgents
      .mockImplementationOnce(() =>
        Promise.resolve({
          agents: [{ id: 'A' } as unknown as Agent, { id: 'B' } as unknown as Agent],
          total: 2,
          page: 1,
          perPage: 2,
        })
      )
      .mockImplementationOnce(() =>
        Promise.resolve({
          agents: [],
          total: 2,
          page: 2,
          perPage: 2,
        })
      );

    const result = await findAgentIDsByStatus(
      mockAgentService,
      mockSavedObjectClient,
      mockElasticsearchClient,
      ['updating', 'unhealthy']
    );
    const unenrollKuery = AgentStatusKueryHelper.buildKueryForUpdatingAgents();
    const errorKuery = AgentStatusKueryHelper.buildKueryForErrorAgents();
    expect(mockAgentService.listAgents.mock.calls[0][1].kuery).toEqual(
      expect.stringContaining(`${unenrollKuery} OR ${errorKuery}`)
    );
    expect(result).toBeDefined();
    expect(result).toEqual(['A', 'B']);
  });
});
