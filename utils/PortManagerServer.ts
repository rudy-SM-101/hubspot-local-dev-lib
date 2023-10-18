import express, { Express, Request, Response } from 'express';
import { Server } from 'http';
import cors from 'cors';

import { detectPort } from './detectPort';
import {
  MIN_PORT_NUMBER,
  MAX_PORT_NUMBER,
  PORT_MANAGER_SERVER_PORT,
} from '../constants/ports';
import { throwErrorWithMessage } from '../errors/standardErrors';
import { debug } from './logger';
import { i18n } from './lang';
import { BaseError } from '../types/Error';

type ServerPortMap = {
  [instanceId: string]: number;
};

const i18nKey = 'utils.PortManagerServer';

class PortManagerServer {
  app?: Express;
  server?: Server;
  serverPortMap: ServerPortMap;

  constructor() {
    this.serverPortMap = {};
  }

  async init(): Promise<void> {
    if (this.app) {
      throwErrorWithMessage(`${i18nKey}.duplicateInstance`);
    }
    this.app = express();
    this.app.use(express.json());
    this.app.use(cors());
    this.setupRoutes();

    try {
      this.server = await this.listen();
    } catch (e) {
      const error = e as BaseError;
      if (error.code === 'EADDRINUSE') {
        throwErrorWithMessage(
          `${i18n}.portInUse`,
          {
            port: PORT_MANAGER_SERVER_PORT,
          },
          error
        );
      }
      throw error;
    }
  }

  listen(): Promise<Server> {
    return new Promise<Server>((resolve, reject) => {
      const server = this.app!.listen(PORT_MANAGER_SERVER_PORT, () => {
        debug(`${i18nKey}.started`, {
          port: PORT_MANAGER_SERVER_PORT,
        });
        resolve(server);
      }).on('error', err => {
        reject(err);
      });
    });
  }

  setupRoutes(): void {
    if (!this.app) {
      return;
    }

    this.app.get('/servers', this.getServers);
    this.app.get('/servers/:instanceId', this.getServerPortByInstanceId);
    this.app.post('/servers', this.assignPortsToServers);
    this.app.delete('/servers/:instanceId', this.deleteServerInstance);
    this.app.post('/close', this.closeServer);
  }

  setPort(instanceId: string, port: number) {
    debug(`${i18nKey}.setPort`, { instanceId, port });
    this.serverPortMap[instanceId] = port;
  }

  deletePort(instanceId: string) {
    debug(`${i18nKey}.deletePort`, {
      instanceId,
      port: this.serverPortMap[instanceId],
    });
    delete this.serverPortMap[instanceId];
  }

  send404(res: Response, instanceId: string) {
    res
      .status(404)
      .send(i18n(`errors.${i18nKey}.404`, { instanceId: instanceId }));
  }

  getServers = async (req: Request, res: Response): Promise<void> => {
    res.send({
      servers: this.serverPortMap,
      count: Object.keys(this.serverPortMap).length,
    });
  };

  getServerPortByInstanceId = (req: Request, res: Response): void => {
    const { instanceId } = req.params;
    const port = this.serverPortMap[instanceId];

    if (port) {
      res.send({ port });
    } else {
      this.send404(res, instanceId);
    }
  };

  assignPortsToServers = async (req: Request, res: Response): Promise<void> => {
    const { instanceIds, port } = req.body;

    const portPromises: Array<Promise<number>> = [];

    instanceIds.forEach((instanceId: number) => {
      if (this.serverPortMap[instanceId]) {
        res.status(409).send(
          i18n(`errors.${i18nKey}.409`, {
            instanceId,
            port: this.serverPortMap[instanceId],
          })
        );
        return;
      } else if (port && (port < MIN_PORT_NUMBER || port > MAX_PORT_NUMBER)) {
        res.status(400).send(i18n(`errors.${i18nKey}.400`));
        return;
      } else {
        portPromises.push(detectPort(port));
      }
    });

    const ports = await Promise.all(portPromises);

    ports.forEach((port: number, index: number) => {
      const instanceId = instanceIds[index];
      this.setPort(instanceId, port);
    });

    res.send({ ports });
  };

  deleteServerInstance = (req: Request, res: Response): void => {
    const { instanceId } = req.params;
    const port = this.serverPortMap[instanceId];

    if (port) {
      this.deletePort(instanceId);
      res.send(200);
    } else {
      this.send404(res, instanceId);
    }
  };

  closeServer = (req: Request, res: Response): void => {
    if (this.server) {
      debug(`${i18nKey}.close`);
      res.send(200);
      this.server.close();
    }
  };
}

export default new PortManagerServer();
