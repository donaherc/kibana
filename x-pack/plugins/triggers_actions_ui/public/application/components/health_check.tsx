/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import React from 'react';
import { Option, none, some, fold } from 'fp-ts/lib/Option';
import { pipe } from 'fp-ts/lib/pipeable';
import { FormattedMessage } from '@kbn/i18n/react';

import { EuiLink, EuiSpacer } from '@elastic/eui';
import { i18n } from '@kbn/i18n';

import { EuiEmptyPrompt, EuiCode } from '@elastic/eui';
import { DocLinksStart } from 'kibana/public';
import './health_check.scss';
import { useHealthContext } from '../context/health_context';
import { useKibana } from '../../common/lib/kibana';
import { CenterJustifiedSpinner } from './center_justified_spinner';
import { triggersActionsUiHealth } from '../../common/lib/health_api';
import { alertingFrameworkHealth } from '../lib/alert_api';

interface Props {
  inFlyout?: boolean;
  waitForCheck: boolean;
}

interface HealthStatus {
  isAlertsAvailable: boolean;
  isSufficientlySecure: boolean;
  hasPermanentEncryptionKey: boolean;
}

export const HealthCheck: React.FunctionComponent<Props> = ({
  children,
  waitForCheck,
  inFlyout = false,
}) => {
  const { http, docLinks } = useKibana().services;
  const { setLoadingHealthCheck } = useHealthContext();
  const [alertingHealth, setAlertingHealth] = React.useState<Option<HealthStatus>>(none);

  React.useEffect(() => {
    (async function () {
      setLoadingHealthCheck(true);
      const triggersActionsUiHealthStatus = await triggersActionsUiHealth({ http });
      const healthStatus: HealthStatus = {
        ...triggersActionsUiHealthStatus,
        isSufficientlySecure: false,
        hasPermanentEncryptionKey: false,
      };
      if (healthStatus.isAlertsAvailable) {
        const alertingHealthResult = await alertingFrameworkHealth({ http });
        healthStatus.isSufficientlySecure = alertingHealthResult.isSufficientlySecure;
        healthStatus.hasPermanentEncryptionKey = alertingHealthResult.hasPermanentEncryptionKey;
      }

      setAlertingHealth(some(healthStatus));
      setLoadingHealthCheck(false);
    })();
  }, [http, setLoadingHealthCheck]);

  const className = inFlyout ? 'alertingFlyoutHealthCheck' : 'alertingHealthCheck';

  return pipe(
    alertingHealth,
    fold(
      () =>
        waitForCheck ? (
          <>
            <EuiSpacer size="m" />
            <CenterJustifiedSpinner />
          </>
        ) : (
          <>{children}</>
        ),
      (healthCheck) => {
        return healthCheck?.isSufficientlySecure && healthCheck?.hasPermanentEncryptionKey ? (
          <>{children}</>
        ) : !healthCheck.isAlertsAvailable ? (
          <AlertsError docLinks={docLinks} className={className} />
        ) : !healthCheck.isSufficientlySecure && !healthCheck.hasPermanentEncryptionKey ? (
          <TlsAndEncryptionError docLinks={docLinks} className={className} />
        ) : !healthCheck.hasPermanentEncryptionKey ? (
          <EncryptionError docLinks={docLinks} className={className} />
        ) : (
          <TlsError docLinks={docLinks} className={className} />
        );
      }
    )
  );
};

interface PromptErrorProps {
  docLinks: DocLinksStart;
  className?: string;
}

const EncryptionError = ({ docLinks, className }: PromptErrorProps) => (
  <EuiEmptyPrompt
    iconType="watchesApp"
    data-test-subj="actionNeededEmptyPrompt"
    className={className}
    titleSize="xs"
    title={
      <h2>
        <FormattedMessage
          id="xpack.triggersActionsUI.components.healthCheck.encryptionErrorTitle"
          defaultMessage="Encrypted saved objects are not available"
        />
      </h2>
    }
    body={
      <div className={`${className}__body`}>
        <p role="banner">
          {i18n.translate(
            'xpack.triggersActionsUI.components.healthCheck.encryptionErrorBeforeKey',
            {
              defaultMessage: 'To create a rule, set a value for ',
            }
          )}
          <EuiCode>{'xpack.encryptedSavedObjects.encryptionKey'}</EuiCode>
          {i18n.translate(
            'xpack.triggersActionsUI.components.healthCheck.encryptionErrorAfterKey',
            {
              defaultMessage:
                ' in your kibana.yml file and ensure the Encrypted Saved Objects plugin is enabled. ',
            }
          )}
          <EuiLink href={docLinks.links.alerting.generalSettings} external target="_blank">
            {i18n.translate(
              'xpack.triggersActionsUI.components.healthCheck.encryptionErrorAction',
              {
                defaultMessage: 'Learn how.',
              }
            )}
          </EuiLink>
        </p>
      </div>
    }
  />
);

const TlsError = ({ docLinks, className }: PromptErrorProps) => (
  <EuiEmptyPrompt
    iconType="watchesApp"
    data-test-subj="actionNeededEmptyPrompt"
    className={className}
    titleSize="xs"
    title={
      <h2>
        <FormattedMessage
          id="xpack.triggersActionsUI.components.healthCheck.tlsErrorTitle"
          defaultMessage="You must enable Transport Layer Security and API keys"
        />
      </h2>
    }
    body={
      <div className={`${className}__body`}>
        <p role="banner">
          {i18n.translate('xpack.triggersActionsUI.components.healthCheck.tlsError', {
            defaultMessage:
              'Alerting relies on API keys, which require TLS between Elasticsearch and Kibana. ',
          })}
          <EuiLink href={docLinks.links.security.kibanaTLS} external target="_blank">
            {i18n.translate('xpack.triggersActionsUI.components.healthCheck.tlsErrorAction', {
              defaultMessage: 'Learn how to enable TLS.',
            })}
          </EuiLink>
        </p>
      </div>
    }
  />
);

const AlertsError = ({ docLinks, className }: PromptErrorProps) => (
  <EuiEmptyPrompt
    iconType="watchesApp"
    data-test-subj="alertsNeededEmptyPrompt"
    className={className}
    titleSize="xs"
    title={
      <h2>
        <FormattedMessage
          id="xpack.triggersActionsUI.components.healthCheck.alertsErrorTitle"
          defaultMessage="You must enable Alerting and Actions"
        />
      </h2>
    }
    body={
      <div className={`${className}__body`}>
        <p role="banner">
          {i18n.translate('xpack.triggersActionsUI.components.healthCheck.alertsError', {
            defaultMessage: 'To create a rule, you must enable the alerting and actions plugins. ',
          })}
          <EuiLink href={docLinks.links.alerting.generalSettings} external target="_blank">
            {i18n.translate('xpack.triggersActionsUI.components.healthCheck.alertsErrorAction', {
              defaultMessage: 'Learn how.',
            })}
          </EuiLink>
        </p>
      </div>
    }
  />
);

const TlsAndEncryptionError = ({ docLinks, className }: PromptErrorProps) => (
  <EuiEmptyPrompt
    iconType="watchesApp"
    data-test-subj="actionNeededEmptyPrompt"
    className={className}
    titleSize="xs"
    title={
      <h2>
        <FormattedMessage
          id="xpack.triggersActionsUI.components.healthCheck.tlsAndEncryptionErrorTitle"
          defaultMessage="Additional setup required"
        />
      </h2>
    }
    body={
      <div className={`${className}__body`}>
        <p role="banner">
          {i18n.translate('xpack.triggersActionsUI.components.healthCheck.tlsAndEncryptionError', {
            defaultMessage:
              'You must enable Transport Layer Security between Kibana and Elasticsearch and configure an encryption key in your kibana.yml file. ',
          })}
          <EuiLink href={docLinks.links.alerting.setupPrerequisites} external target="_blank">
            {i18n.translate(
              'xpack.triggersActionsUI.components.healthCheck.tlsAndEncryptionErrorAction',
              {
                defaultMessage: 'Learn how.',
              }
            )}
          </EuiLink>
        </p>
      </div>
    }
  />
);
