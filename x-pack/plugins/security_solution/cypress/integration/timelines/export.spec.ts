/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import _ from 'lodash';
import { exportTimeline, waitForTimelinesPanelToBeLoaded } from '../../tasks/timelines';
import { loginAndWaitForPageWithoutDateRange } from '../../tasks/login';

import { TIMELINES_URL } from '../../urls/navigation';
import { createTimeline } from '../../tasks/api_calls/timelines';
import { expectedExportedTimeline, getTimeline } from '../../objects/timeline';
import { cleanKibana } from '../../tasks/common';

describe('Export timelines', () => {
  beforeEach(() => {
    cleanKibana();
    cy.intercept('POST', '/api/timeline/_export?file_name=timelines_export.ndjson').as('export');
    createTimeline(getTimeline()).then((response) => {
      cy.wrap(response).as('timelineResponse');
      cy.wrap(response.body.data.persistTimeline.timeline.savedObjectId).as('timelineId');
    });
  });

  it('Exports a custom timeline', function () {
    loginAndWaitForPageWithoutDateRange(TIMELINES_URL);
    waitForTimelinesPanelToBeLoaded();
    exportTimeline(this.timelineId);

    cy.wait('@export').then(({ response }) => {
      cy.wrap(response!.statusCode).should('eql', 200);
      const parsedExport = JSON.parse(_.trimEnd(response!.body, '\n'));

      cy.wrap(parsedExport).should('eql', expectedExportedTimeline(this.timelineResponse));
    });
  });
});
