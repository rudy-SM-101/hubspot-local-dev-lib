import fs from 'fs-extra';
import yaml from 'js-yaml';
import findup from 'findup-sync';
import { getCwd } from '../lib/path';
import {
  DEFAULT_HUBSPOT_CONFIG_YAML_FILE_NAME,
  MIN_HTTP_TIMEOUT,
} from '../constants/config';
import { ENVIRONMENTS, ENVIRONMENT_VARIABLES } from '../constants/environments';
import {
  API_KEY_AUTH_METHOD,
  OAUTH_AUTH_METHOD,
  PERSONAL_ACCESS_KEY_AUTH_METHOD,
  OAUTH_SCOPES,
} from '../constants/auth';
import { MODE } from '../constants/files';
import { getValidEnv } from '../lib/environment';
import { isConfigPathInGitRepo } from '../utils/git';
import {
  logErrorInstance,
  logFileSystemErrorInstance,
} from '../errors/errors_DEPRECATED';
import { CLIConfig_DEPRECATED, Environment } from '../types/Config';
import { CLIAccount_DEPRECATED } from '../types/Accounts';
import { BaseError } from '../types/Error';
import { ValueOf } from '../types/Utils';

const ALL_MODES = Object.values(MODE);
let _config: CLIConfig_DEPRECATED | undefined;
let _configPath: string | null;
let environmentVariableConfigLoaded = false;

const commaSeparatedValues = (
  arr: Array<string>,
  conjunction = 'and',
  ifempty = ''
): string => {
  const l = arr.length;
  if (!l) return ifempty;
  if (l < 2) return arr[0];
  if (l < 3) return arr.join(` ${conjunction} `);
  arr = arr.slice();
  arr[l - 1] = `${conjunction} ${arr[l - 1]}`;
  return arr.join(', ');
};

const getConfig = () => _config;

function setConfig(
  updatedConfig?: CLIConfig_DEPRECATED
): CLIConfig_DEPRECATED | undefined {
  _config = updatedConfig;
  return _config;
}

function getConfigAccounts(
  config?: CLIConfig_DEPRECATED
): Array<CLIAccount_DEPRECATED> | undefined {
  const __config = config || getConfig();
  if (!__config) return;
  return __config.portals;
}

function getConfigDefaultAccount(
  config: CLIConfig_DEPRECATED
): string | number | undefined {
  const __config = config || getConfig();
  if (!__config) return;
  return __config.defaultPortal;
}

function getConfigAccountId(
  account: CLIAccount_DEPRECATED
): number | undefined {
  if (!account) return;
  return account.portalId;
}

function setConfigPath(path: string | null) {
  return (_configPath = path);
}

function getConfigPath(path: string | null): string | null {
  return path || (configFileExists() && _configPath) || findConfig(getCwd());
}

function validateConfig(): boolean {
  const config = getConfig();
  if (!config) {
    console.error('No config was found');
    return false;
  }
  const accounts = getConfigAccounts();
  if (!Array.isArray(accounts)) {
    console.error('config.portals[] is not defined');
    return false;
  }
  const accountIdsHash: { [id: number]: CLIAccount_DEPRECATED } = {};
  const accountNamesHash: { [name: string]: CLIAccount_DEPRECATED } = {};
  return accounts.every(cfg => {
    if (!cfg) {
      console.error('config.portals[] has an empty entry');
      return false;
    }

    const accountId = getConfigAccountId(cfg);
    if (!accountId) {
      console.error('config.portals[] has an entry missing portalId');
      return false;
    }
    if (accountIdsHash[accountId]) {
      console.error(
        `config.portals[] has multiple entries with portalId=${accountId}`
      );
      return false;
    }

    if (cfg.name) {
      if (accountNamesHash[cfg.name]) {
        console.error(
          `config.name has multiple entries with portalId=${accountId}`
        );
        return false;
      }
      if (/\s+/.test(cfg.name)) {
        console.error(`config.name '${cfg.name}' cannot contain spaces`);
        return false;
      }
      accountNamesHash[cfg.name] = cfg;
    }

    accountIdsHash[accountId] = cfg;
    return true;
  });
}

function accountNameExistsInConfig(name: string): boolean {
  const config = getConfig();
  const accounts = getConfigAccounts();

  if (!config || !Array.isArray(accounts)) {
    return false;
  }

  return accounts.some(cfg => cfg.name && cfg.name === name);
}

function getOrderedAccount(
  unorderedAccount: CLIAccount_DEPRECATED
): CLIAccount_DEPRECATED {
  const { name, portalId, env, authType, ...rest } = unorderedAccount;

  return {
    name,
    ...(portalId && { portalId }),
    env,
    authType,
    ...rest,
  };
}

function getOrderedConfig(unorderedConfig: CLIConfig_DEPRECATED) {
  const {
    defaultPortal,
    defaultMode,
    httpTimeout,
    allowUsageTracking,
    portals,
    ...rest
  } = unorderedConfig;

  return {
    ...(defaultPortal && { defaultPortal }),
    defaultMode,
    httpTimeout,
    allowUsageTracking,
    ...rest,
    portals: portals.map(getOrderedAccount),
  };
}

type WriteConfigOptions = {
  path?: string;
  source?: string;
};

function writeConfig(options: WriteConfigOptions = {}): void {
  if (environmentVariableConfigLoaded) {
    return;
  }
  let source;
  try {
    source =
      typeof options.source === 'string'
        ? options.source
        : yaml.dump(
            JSON.parse(JSON.stringify(getOrderedConfig(getConfig()!), null, 2))
          );
  } catch (err) {
    logErrorInstance(err as BaseError);
    return;
  }
  const configPath = options.path || _configPath;
  try {
    console.debug(`Writing current config to ${configPath}`);
    fs.ensureFileSync(configPath || '');
    fs.writeFileSync(configPath || '', source);
    setConfig(parseConfig(source).parsed);
  } catch (err) {
    logFileSystemErrorInstance(err as BaseError, {
      filepath: configPath || '',
      write: true,
    });
  }
}

function readConfigFile(): { source?: string; error?: BaseError } {
  isConfigPathInGitRepo(_configPath);
  let source;
  let error;
  if (!_configPath) {
    return { source, error };
  }
  try {
    source = fs.readFileSync(_configPath);
  } catch (err) {
    error = err as BaseError;
    console.error('Config file could not be read "%s"', _configPath);
    logFileSystemErrorInstance(error, { filepath: _configPath, read: true });
  }
  return { source: source && source.toString(), error };
}

function parseConfig(configSource?: string): {
  parsed?: CLIConfig_DEPRECATED;
  error?: BaseError;
} {
  let parsed: CLIConfig_DEPRECATED | undefined = undefined;
  let error: BaseError | undefined = undefined;
  if (!configSource) {
    return { parsed, error };
  }
  try {
    parsed = yaml.load(configSource) as CLIConfig_DEPRECATED;
  } catch (err) {
    error = err as BaseError;
    console.error('Config file could not be parsed "%s"', _configPath);
    logErrorInstance(err as BaseError);
  }
  return { parsed, error };
}

type LoadConfigFromFileOptions = {
  silenceErrors?: boolean;
  useEnv?: boolean;
};

function loadConfigFromFile(
  path: string,
  options: LoadConfigFromFileOptions = {}
) {
  setConfigPath(getConfigPath(path));
  if (!_configPath) {
    if (!options.silenceErrors) {
      console.error(
        `A ${DEFAULT_HUBSPOT_CONFIG_YAML_FILE_NAME} file could not be found. To create a new config file, use the "hs init" command.`
      );
    } else {
      console.debug(
        `A ${DEFAULT_HUBSPOT_CONFIG_YAML_FILE_NAME} file could not be found`
      );
    }
    return;
  }

  console.debug(`Reading config from ${_configPath}`);
  const { source, error: sourceError } = readConfigFile();
  if (sourceError) return;
  const { parsed, error: parseError } = parseConfig(source);
  if (parseError) return;
  setConfig(parsed);

  if (!getConfig()) {
    console.debug('The config file was empty config');
    console.debug('Initializing an empty config');
    setConfig({ portals: [] });
  }

  return getConfig();
}

function loadConfig(
  path: string,
  options: LoadConfigFromFileOptions = {
    useEnv: false,
  }
) {
  if (options.useEnv && loadEnvironmentVariableConfig(options)) {
    console.debug('Loaded environment variable config');
    environmentVariableConfigLoaded = true;
  } else {
    console.debug(`Loading config from ${path}`);
    loadConfigFromFile(path, options);
    environmentVariableConfigLoaded = false;
  }

  return getConfig();
}

function isTrackingAllowed(): boolean {
  if (!configFileExists() || configFileIsBlank()) {
    return true;
  }
  const { allowUsageTracking } = getAndLoadConfigIfNeeded();
  return allowUsageTracking !== false;
}

function getAndLoadConfigIfNeeded(options = {}): Partial<CLIConfig_DEPRECATED> {
  if (!getConfig()) {
    loadConfig('', {
      silenceErrors: true,
      ...options,
    });
  }
  return getConfig() || { allowUsageTracking: undefined };
}

function findConfig(directory: string): string | null {
  return findup(
    [
      DEFAULT_HUBSPOT_CONFIG_YAML_FILE_NAME,
      DEFAULT_HUBSPOT_CONFIG_YAML_FILE_NAME.replace('.yml', '.yaml'),
    ],
    { cwd: directory }
  );
}

function getEnv(nameOrId: string | number) {
  let env: Environment = ENVIRONMENTS.PROD;
  const config = getAndLoadConfigIfNeeded();
  const accountId = getAccountId(nameOrId);

  if (accountId) {
    const accountConfig = getAccountConfig(accountId);
    if (accountConfig && accountConfig.env) {
      env = accountConfig.env;
    }
  } else if (config && config.env) {
    env = config.env;
  }
  return env;
}

const getAccountConfig = accountId =>
  getConfigAccounts(getAndLoadConfigIfNeeded()).find(
    account => account.portalId === accountId
  );

/*
 * Returns a portalId from the config if it exists, else returns null
 */
function getAccountId(nameOrId: string | number) {
  const config = getAndLoadConfigIfNeeded() as CLIConfig_DEPRECATED;
  let name: string | undefined = undefined;
  let accountId: number | undefined = undefined;
  let account: CLIAccount_DEPRECATED | undefined = undefined;

  function setNameOrAccountFromSuppliedValue(
    suppliedValue: string | number
  ): void {
    if (typeof suppliedValue === 'number') {
      accountId = suppliedValue;
    } else if (/^\d+$/.test(suppliedValue)) {
      accountId = parseInt(suppliedValue, 10);
    } else {
      name = suppliedValue;
    }
  }

  if (!nameOrId) {
    const defaultAccount = getConfigDefaultAccount(config);

    if (defaultAccount) {
      setNameOrAccountFromSuppliedValue(defaultAccount);
    }
  } else {
    setNameOrAccountFromSuppliedValue(nameOrId);
  }

  const accounts = getConfigAccounts(config);
  if (name && accounts) {
    account = accounts.find(p => p.name === name);
  } else if (accountId && accounts) {
    account = accounts.find(p => accountId === p.portalId);
  }

  if (account) {
    return account.portalId;
  }

  return null;
}

/**
 * @throws {Error}
 */
const removeSandboxAccountFromConfig = nameOrId => {
  const config = getAndLoadConfigIfNeeded();
  const accountId = getAccountId(nameOrId);
  let promptDefaultAccount = false;

  if (!accountId) {
    throw new Error(`Unable to find account for ${nameOrId}.`);
  }

  const accountConfig = getAccountConfig(accountId);

  if (accountConfig.sandboxAccountType === null) return promptDefaultAccount;

  if (config.defaultPortal === accountConfig.name) {
    promptDefaultAccount = true;
  }

  let accounts = getConfigAccounts(config);

  if (accountConfig) {
    console.debug(`Deleting config for ${accountId}`);
    const index = accounts.indexOf(accountConfig);
    accounts.splice(index, 1);
  }

  writeConfig();

  return promptDefaultAccount;
};

/**
 * @throws {Error}
 */
const updateAccountConfig = configOptions => {
  const {
    portalId,
    authType,
    environment,
    clientId,
    clientSecret,
    scopes,
    tokenInfo,
    defaultMode,
    name,
    apiKey,
    personalAccessKey,
    sandboxAccountType,
    parentAccountId,
  } = configOptions;

  if (!portalId) {
    throw new Error('A portalId is required to update the config');
  }

  const config = getAndLoadConfigIfNeeded();
  const accountConfig = getAccountConfig(portalId);

  let auth;
  if (clientId || clientSecret || scopes || tokenInfo) {
    auth = {
      ...(accountConfig ? accountConfig.auth : {}),
      clientId,
      clientSecret,
      scopes,
      tokenInfo,
    };
  }

  const env = getValidEnv(environment || (accountConfig && accountConfig.env), {
    maskedProductionValue: undefined,
  });
  const mode = defaultMode && defaultMode.toLowerCase();
  const nextAccountConfig = {
    ...accountConfig,
    name: name || (accountConfig && accountConfig.name),
    env,
    ...(portalId && { portalId }),
    authType,
    auth,
    apiKey,
    defaultMode: MODE[mode] ? mode : undefined,
    personalAccessKey,
    sandboxAccountType,
    parentAccountId,
  };

  let accounts = getConfigAccounts(config);
  if (accountConfig) {
    console.debug(`Updating config for ${portalId}`);
    const index = accounts.indexOf(accountConfig);
    accounts[index] = nextAccountConfig;
  } else {
    console.debug(`Adding config entry for ${portalId}`);
    if (accounts) {
      accounts.push(nextAccountConfig);
    } else {
      accounts = [nextAccountConfig];
    }
  }

  return nextAccountConfig;
};

/**
 * @throws {Error}
 */
const updateDefaultAccount = defaultAccount => {
  if (
    !defaultAccount ||
    (typeof defaultAccount !== 'number' && typeof defaultAccount !== 'string')
  ) {
    throw new Error(
      `A 'defaultPortal' with value of number or string is required to update the config`
    );
  }

  const config = getAndLoadConfigIfNeeded();
  config.defaultPortal = defaultAccount;

  setDefaultConfigPathIfUnset();
  writeConfig();
};

/**
 * @throws {Error}
 */
const updateDefaultMode = defaultMode => {
  if (!defaultMode || !ALL_MODES.find(m => m === defaultMode)) {
    throw new Error(
      `The mode ${defaultMode} is invalid. Valid values are ${commaSeparatedValues(
        ALL_MODES
      )}.`
    );
  }

  const config = getAndLoadConfigIfNeeded();
  config.defaultMode = defaultMode;

  setDefaultConfigPathIfUnset();
  writeConfig();
};

/**
 * @throws {Error}
 */
const updateHttpTimeout = timeout => {
  const parsedTimeout = parseInt(timeout);
  if (isNaN(parsedTimeout) || parsedTimeout < MIN_HTTP_TIMEOUT) {
    throw new Error(
      `The value ${timeout} is invalid. The value must be a number greater than ${MIN_HTTP_TIMEOUT}.`
    );
  }

  const config = getAndLoadConfigIfNeeded();
  config.httpTimeout = parsedTimeout;

  setDefaultConfigPathIfUnset();
  writeConfig();
};

/**
 * @throws {Error}
 */
const updateAllowUsageTracking = isEnabled => {
  if (typeof isEnabled !== 'boolean') {
    throw new Error(
      `Unable to update allowUsageTracking. The value ${isEnabled} is invalid. The value must be a boolean.`
    );
  }

  const config = getAndLoadConfigIfNeeded();
  config.allowUsageTracking = isEnabled;

  setDefaultConfigPathIfUnset();
  writeConfig();
};

/**
 * @throws {Error}
 */
const renameAccount = async (currentName, newName) => {
  const accountId = getAccountId(currentName);
  const accountConfigToRename = getAccountConfig(accountId);
  const defaultAccount = getConfigDefaultAccount();

  if (!accountConfigToRename) {
    throw new Error(`Cannot find account with identifier ${currentName}`);
  }

  await updateAccountConfig({
    ...accountConfigToRename,
    name: newName,
  });

  if (accountConfigToRename.name === defaultAccount) {
    updateDefaultAccount(newName);
  }

  return writeConfig();
};

/**
 * @throws {Error}
 */
const deleteAccount = async accountName => {
  const config = getAndLoadConfigIfNeeded();
  let accounts = getConfigAccounts(config);
  const accountIdToDelete = getAccountId(accountName);

  if (!accountIdToDelete) {
    throw new Error(`Cannot find account with identifier ${accountName}`);
  }

  setConfig({
    ...config,
    defaultPortal:
      config.defaultPortal === accountName ||
      config.defaultPortal === accountIdToDelete
        ? null
        : config.defaultPortal,
    portals: accounts.filter(account => account.portalId !== accountIdToDelete),
  });

  return writeConfig();
};

const setDefaultConfigPathIfUnset = () => {
  if (!_configPath) {
    setDefaultConfigPath();
  }
};

const setDefaultConfigPath = () => {
  setConfigPath(`${getCwd()}/${DEFAULT_HUBSPOT_CONFIG_YAML_FILE_NAME}`);
};

const configFileExists = () => {
  return _configPath && fs.existsSync(_configPath);
};

const configFileIsBlank = () => {
  return _configPath && fs.readFileSync(_configPath).length === 0;
};

const createEmptyConfigFile = ({ path } = {}) => {
  if (!path) {
    setDefaultConfigPathIfUnset();

    if (configFileExists()) {
      return;
    }
  } else {
    setConfigPath(path);
  }

  writeConfig({ source: '', path });
};

const deleteEmptyConfigFile = () => {
  return (
    configFileExists() && configFileIsBlank() && fs.unlinkSync(_configPath)
  );
};

const deleteConfigFile = () => {
  return configFileExists() && fs.unlinkSync(_configPath);
};

const getConfigVariablesFromEnv = () => {
  const env = process.env;

  return {
    apiKey: env[ENVIRONMENT_VARIABLES.HUBSPOT_API_KEY],
    clientId: env[ENVIRONMENT_VARIABLES.HUBSPOT_CLIENT_ID],
    clientSecret: env[ENVIRONMENT_VARIABLES.HUBSPOT_CLIENT_SECRET],
    personalAccessKey: env[ENVIRONMENT_VARIABLES.HUBSPOT_PERSONAL_ACCESS_KEY],
    portalId: parseInt(env[ENVIRONMENT_VARIABLES.HUBSPOT_PORTAL_ID], 10),
    refreshToken: env[ENVIRONMENT_VARIABLES.HUBSPOT_REFRESH_TOKEN],
    env: getValidEnv(env[ENVIRONMENT_VARIABLES.HUBSPOT_ENVIRONMENT]),
  };
};

const generatePersonalAccessKeyConfig = (portalId, personalAccessKey, env) => {
  return {
    portals: [
      {
        authType: PERSONAL_ACCESS_KEY_AUTH_METHOD.value,
        portalId,
        personalAccessKey,
        env,
      },
    ],
  };
};

const generateOauthConfig = (
  portalId,
  clientId,
  clientSecret,
  refreshToken,
  scopes,
  env
) => {
  return {
    portals: [
      {
        authType: OAUTH_AUTH_METHOD.value,
        portalId,
        auth: {
          clientId,
          clientSecret,
          scopes,
          tokenInfo: {
            refreshToken,
          },
        },
        env,
      },
    ],
  };
};

const generateApiKeyConfig = (portalId, apiKey, env) => {
  return {
    portals: [
      {
        authType: API_KEY_AUTH_METHOD.value,
        portalId,
        apiKey,
        env,
      },
    ],
  };
};

const loadConfigFromEnvironment = ({ useEnv = false } = {}) => {
  const {
    apiKey,
    clientId,
    clientSecret,
    personalAccessKey,
    portalId,
    refreshToken,
    env,
  } = getConfigVariablesFromEnv();
  const unableToLoadEnvConfigError =
    'Unable to load config from environment variables.';

  if (!portalId) {
    useEnv && console.error(unableToLoadEnvConfigError);
    return;
  }

  if (personalAccessKey) {
    return generatePersonalAccessKeyConfig(portalId, personalAccessKey, env);
  } else if (clientId && clientSecret && refreshToken) {
    return generateOauthConfig(
      portalId,
      clientId,
      clientSecret,
      refreshToken,
      OAUTH_SCOPES.map(scope => scope.value),
      env
    );
  } else if (apiKey) {
    return generateApiKeyConfig(portalId, apiKey, env);
  } else {
    useEnv && console.error(unableToLoadEnvConfigError);
    return;
  }
};

const loadEnvironmentVariableConfig = options => {
  const envConfig = loadConfigFromEnvironment(options);

  if (!envConfig) {
    return;
  }
  const { portalId } = getConfigVariablesFromEnv();

  console.debug(
    `Loaded config from environment variables for account ${portalId}`
  );

  return setConfig(envConfig);
};

const isConfigFlagEnabled = flag => {
  if (!configFileExists() || configFileIsBlank()) {
    return false;
  }

  const config = getAndLoadConfigIfNeeded();

  return config[flag] || false;
};

module.exports = {
  getAndLoadConfigIfNeeded,
  getEnv,
  getConfig,
  getConfigAccounts,
  getConfigDefaultAccount,
  getConfigAccountId,
  getConfigPath,
  getOrderedAccount,
  getOrderedConfig,
  isConfigFlagEnabled,
  setConfig,
  setConfigPath,
  loadConfig,
  findConfig,
  loadConfigFromEnvironment,
  getAccountConfig,
  getAccountId,
  removeSandboxAccountFromConfig,
  updateAccountConfig,
  updateDefaultAccount,
  updateDefaultMode,
  updateHttpTimeout,
  updateAllowUsageTracking,
  renameAccount,
  deleteAccount,
  createEmptyConfigFile,
  deleteEmptyConfigFile,
  deleteConfigFile,
  isTrackingAllowed,
  validateConfig,
  writeConfig,
  accountNameExistsInConfig,
};
