import { debug } from '../utils/logger';
import {
  API_KEY_AUTH_METHOD,
  OAUTH_AUTH_METHOD,
  PERSONAL_ACCESS_KEY_AUTH_METHOD,
} from '../constants/auth';
import { CLIConfig_NEW, Environment } from '../types/Config';
import {
  AuthType,
  CLIAccount_NEW,
  APIKeyAccount_NEW,
  OAuthAccount_NEW,
  PersonalAccessKeyAccount_NEW,
} from '../types/CLIAccount';

const i18nKey = 'config.configUtils';

export function getOrderedAccount(
  unorderedAccount: CLIAccount_NEW
): CLIAccount_NEW {
  const { name, accountId, env, authType, ...rest } = unorderedAccount;

  return {
    name,
    accountId,
    env,
    authType,
    ...rest,
  };
}

export function getOrderedConfig(
  unorderedConfig: CLIConfig_NEW
): CLIConfig_NEW {
  const {
    defaultAccount,
    defaultMode,
    httpTimeout,
    allowUsageTracking,
    accounts,
    ...rest
  } = unorderedConfig;

  return {
    ...(defaultAccount && { defaultAccount }),
    defaultMode,
    httpTimeout,
    allowUsageTracking,
    ...rest,
    accounts: accounts.map(getOrderedAccount),
  };
}

type PersonalAccessKeyOptions = {
  accountId: number;
  personalAccessKey: string;
  env: Environment;
};

function generatePersonalAccessKeyAccountConfig({
  accountId,
  personalAccessKey,
  env,
}: PersonalAccessKeyOptions): PersonalAccessKeyAccount_NEW {
  return {
    authType: PERSONAL_ACCESS_KEY_AUTH_METHOD.value,
    accountId,
    personalAccessKey,
    env,
  };
}

type OAuthOptions = {
  accountId: number;
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  scopes: Array<string>;
  env: Environment;
};

function generateOauthAccountConfig({
  accountId,
  clientId,
  clientSecret,
  refreshToken,
  scopes,
  env,
}: OAuthOptions): OAuthAccount_NEW {
  return {
    authType: OAUTH_AUTH_METHOD.value,
    accountId,
    auth: {
      clientId,
      clientSecret,
      scopes,
      tokenInfo: {
        refreshToken,
      },
    },
    env,
  };
}

type APIKeyOptions = {
  accountId: number;
  apiKey: string;
  env: Environment;
};

function generateApiKeyAccountConfig({
  accountId,
  apiKey,
  env,
}: APIKeyOptions): APIKeyAccount_NEW {
  return {
    authType: API_KEY_AUTH_METHOD.value,
    accountId,
    apiKey,
    env,
  };
}

export function generateConfig(
  type: AuthType,
  options: PersonalAccessKeyOptions | OAuthOptions | APIKeyOptions
): CLIConfig_NEW | null {
  if (!options) {
    return null;
  }
  const config: CLIConfig_NEW = { accounts: [] };
  let configAccount: CLIAccount_NEW;

  switch (type) {
    case API_KEY_AUTH_METHOD.value:
      configAccount = generateApiKeyAccountConfig(options as APIKeyOptions);
      break;
    case PERSONAL_ACCESS_KEY_AUTH_METHOD.value:
      configAccount = generatePersonalAccessKeyAccountConfig(
        options as PersonalAccessKeyOptions
      );
      break;
    case OAUTH_AUTH_METHOD.value:
      configAccount = generateOauthAccountConfig(options as OAuthOptions);
      break;
    default:
      debug(`${i18nKey}.unknownType`, { type });
      return null;
  }

  if (configAccount) {
    config.accounts.push(configAccount);
  }

  return config;
}
