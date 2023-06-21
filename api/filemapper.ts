import fs from 'fs';
import path from 'path';
import contentDisposition from 'content-disposition';
import { FullResponse } from 'request-promise-native';
import http from '../http';
import { getCwd } from '../lib/path';
import CLIConfiguration from '../config/CLIConfiguration';
import { FileMapperNode } from '../types/Files';
import { HttpOptions } from '../types/Http';

const FILE_MAPPER_API_PATH = 'content/filemapper/v1';

// https://github.com/request/request-promise#the-transform-function}
function createFileMapperNodeFromStreamResponse(
  filePath: string,
  response: FullResponse
): FileMapperNode {
  if (filePath[0] !== '/') {
    filePath = `/${filePath}`;
  }
  if (filePath[filePath.length - 1] === '/') {
    filePath = filePath.slice(0, filePath.length - 1);
  }
  const node = {
    source: null,
    path: filePath,
    name: path.basename(filePath),
    folder: false,
    children: [],
    createdAt: 0,
    updatedAt: 0,
  };
  if (!(response.headers && response.headers['content-disposition'])) {
    return node;
  }
  const { parameters } = contentDisposition.parse(
    response.headers['content-disposition']
  );
  return {
    ...node,
    name: parameters.filename,
    createdAt: parseInt(parameters['creation-date'], 10) || 0,
    updatedAt: parseInt(parameters['modification-date'], 10) || 0,
  };
}

async function upload(
  accountId: number,
  src: string,
  dest: string,
  options: Omit<HttpOptions, 'uri'> = {}
) {
  return http.post(accountId, {
    uri: `${FILE_MAPPER_API_PATH}/upload/${encodeURIComponent(dest)}`,
    formData: {
      file: fs.createReadStream(path.resolve(getCwd(), src)),
    },
    ...options,
  });
}

// Fetch a module by moduleId
async function fetchModule(
  accountId: number,
  moduleId: number,
  options: Omit<HttpOptions, 'uri'> = {}
) {
  return http.get(accountId, {
    uri: `${FILE_MAPPER_API_PATH}/modules/${moduleId}`,
    ...options,
  });
}

//Fetch a file by file path.
async function fetchFileStream(
  accountId: number,
  filePath: string,
  destination: string,
  options: Omit<HttpOptions, 'uri'> = {}
): Promise<FileMapperNode> {
  const response = await http.getOctetStream(
    accountId,
    {
      uri: `${FILE_MAPPER_API_PATH}/stream/${encodeURIComponent(filePath)}`,
      ...options,
    },
    destination
  );
  return createFileMapperNodeFromStreamResponse(filePath, response);
}

/**
 * Fetch a folder or file node by path.
 *
 * @async
 * @param {number} accountId
 * @param {string} filepath
 * @param {object} options
 * @returns {Promise<FileMapperNode>}
 */
async function download(accountId, filepath, options = {}) {
  return http.get(accountId, {
    uri: `${FILE_MAPPER_API_PATH}/download/${encodeURIComponent(filepath)}`,
    ...options,
  });
}

/**
 * Fetch a folder or file node by path.
 *
 * @async
 * @param {number} accountId
 * @param {string} filepath
 * @param {object} options
 * @returns {Promise<FileMapperNode>}
 */
async function downloadDefault(accountId, filepath, options = {}) {
  return http.get(accountId, {
    uri: `${FILE_MAPPER_API_PATH}/download-default/${filepath}`,
    ...options,
  });
}

/**
 * Delete a file or folder by path
 *
 * @async
 * @param {number} accountId
 * @param {string} filePath
 * @param {object} options
 * @returns {Promise}
 */
async function deleteFile(accountId, filePath, options = {}) {
  return http.delete(accountId, {
    uri: `${FILE_MAPPER_API_PATH}/delete/${encodeURIComponent(filePath)}`,
    ...options,
  });
}

/**
 * Delete folder by path
 *
 * @deprecated since 1.0.1 - use `deleteFile()` instead.
 * @async
 * @param {number} accountId
 * @param {string} folderPath
 * @param {object} options
 * @returns {Promise}
 */
async function deleteFolder(accountId, folderPath, options = {}) {
  logger.warn(
    '`cli-lib/api/fileMapper#deleteFolder()` is deprecated. Use `cli-lib/api/fileMapper#deleteFile()` instead.'
  );
  return http.delete(accountId, {
    uri: `${FILE_MAPPER_API_PATH}/delete/folder/${folderPath}`,
    ...options,
  });
}

/**
 * Track CMS CLI usage
 *
 * @async
 * @returns {Promise}
 */
async function trackUsage(eventName, eventClass, meta = {}, accountId) {
  const usageEvent = {
    accountId,
    eventName,
    eventClass,
    meta,
  };
  const EVENT_TYPES = {
    VSCODE_EXTENSION_INTERACTION: 'vscode-extension-interaction',
    CLI_INTERACTION: 'cli-interaction',
  };

  let analyticsEndpoint;

  switch (eventName) {
    case EVENT_TYPES.CLI_INTERACTION:
      analyticsEndpoint = 'cms-cli-usage';
      break;
    case EVENT_TYPES.VSCODE_EXTENSION_INTERACTION:
      analyticsEndpoint = 'vscode-extension-usage';
      break;
    default:
      logger.debug(
        `Usage tracking event '${eventName}' is not a valid event type.`
      );
  }

  const path = `${FILE_MAPPER_API_PATH}/${analyticsEndpoint}`;

  const accountConfig = accountId && getAccountConfig(accountId);

  if (accountConfig && accountConfig.authType === 'personalaccesskey') {
    logger.debug('Sending usage event to authenticated endpoint');
    return http.post(accountId, {
      uri: `${path}/authenticated`,
      body: usageEvent,
      resolveWithFullResponse: true,
    });
  }

  const env = getEnv(accountId);
  const requestOptions = http.getRequestOptions(
    { env },
    {
      uri: path,
      body: usageEvent,
      resolveWithFullResponse: true,
    }
  );
  logger.debug('Sending usage event to unauthenticated endpoint');
  return http.request.post(requestOptions);
}

/**
 * Moves file from srcPath to destPath
 *
 * @async
 * @param {number} portalId
 * @param {string} srcPath
 * @param {string} destPath
 * @returns {Promise}
 */
async function moveFile(portalId, srcPath, destPath) {
  return http.put(portalId, {
    uri: `${FILE_MAPPER_API_PATH}/rename/${srcPath}?path=${destPath}`,
  });
}

/**
 * Get directory contents
 *
 * @async
 * @param {string} path
 * @returns {Promise}
 */
async function getDirectoryContentsByPath(portalId, path) {
  return http.get(portalId, {
    uri: `${FILE_MAPPER_API_PATH}/meta/${path}`,
  });
}

module.exports = {
  deleteFile,
  deleteFolder,
  download,
  downloadDefault,
  fetchFileStream,
  fetchModule,
  trackUsage,
  upload,
  createFileMapperNodeFromStreamResponse,
  moveFile,
  getDirectoryContentsByPath,
};
