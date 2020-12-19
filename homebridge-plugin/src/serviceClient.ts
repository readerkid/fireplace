import { sign } from 'aws4';
import WebSocket from 'ws';
import { Logging } from 'homebridge';
import {
  Level,
  ServiceConfig,
  Credentials
} from './types';

interface SignConfig extends ServiceConfig {
  signQuery: boolean;
}

type Timestamp = Number;

type Message = {
  action: 'currentState' | 'reconnect';
}

interface CurrentStateMessage extends Message {
  action: 'currentState';
  level: Level;
  timestamp: Timestamp
}

type Command = {
  action: 'currentLevel' | 'setLevel';
  level: Level;
}

export class ServiceClient {
  private readonly signConfig: SignConfig;
  private readonly credentials: Credentials;
  private readonly log: Logging;
  private lastMessageTimestamp: Timestamp = 0;
  private lastLevel: Level = 0;
  private ws: WebSocket | null = null;

  constructor(serviceConfig: ServiceConfig, credentials: Credentials, log: Logging) {
    this.signConfig = {
      ...serviceConfig,
      signQuery: true
    };

    this.credentials = credentials;

    this.log = log;
  }

  private getSignedConnectionURL(): string {
    const _signConfig = { ...this.signConfig };

    sign(_signConfig, this.credentials);

    this.log.info(`Websocket url: wss://${_signConfig.host}${_signConfig.path}`)

    return `wss://${_signConfig.host}${_signConfig.path}`;
  }

  async * nextCommand(): AsyncGenerator<Command> {
    while (true) {
      try {
        for await (const message of this.listen()) {
          if (message.action === 'reconnect') {
            break;
          }

          const currentStateMessage = message as CurrentStateMessage;

          if (!this.lastMessageTimestamp) {
            this.lastMessageTimestamp = currentStateMessage.timestamp;
            this.lastLevel = currentStateMessage.level;

            yield {
              action: 'currentLevel',
              level: currentStateMessage.level
            };
          }

          if (this.lastMessageTimestamp === currentStateMessage.timestamp) {
            continue;
          }

          this.lastMessageTimestamp = currentStateMessage.timestamp;
          this.lastLevel = currentStateMessage.level;

          yield {
            action: 'setLevel',
            level: currentStateMessage.level
          };
        }
      } catch (err) {
        this.ws = null;
        this.log.error(`Error during service client operation: ${err}`);
  
        // Wait 1 second before restarting the client
        await new Promise(resolve => setTimeout(resolve, 1000));
      }  
    }
  }

  private async * listen(): AsyncGenerator<Message> {
    let resolver: (value: Message) => void;
    let thrower: (reason?: any) => void;
    const promises: Promise<Message>[] = [
      new Promise((r, t) => {
        resolver = r;
        thrower = t;
      })
    ];

    this.ws = new WebSocket(this.getSignedConnectionURL());

    let pingTimer: NodeJS.Timeout;

    this.ws.on('open', () => {
      this.log.info(`Connected to websocket service`);

      const ws = this.ws as WebSocket;

      pingTimer = setInterval(() => {
        ws.ping();
      }, 60 * 1000);
    });

    this.ws.on('message', messageString => {
      let message: Message;
      this.log.debug(`Received message ${messageString}`);

      let _message;
      try {
        _message = JSON.parse(messageString.toString());
      } catch (err) {
        this.log.warn(`Ignoring non-JSON message: '${messageString.toString()}'`);
        return;
      }

      if (_message.status === 'success') {
        this.lastMessageTimestamp = _message.timestamp;
        return;
      }

      if (_message.action !== 'currentState') {
        this.log.warn(`Ignoring invalid message ${messageString}`);
      }

      if (_message.timestamp <= this.lastMessageTimestamp) {
        this.log.info(`Received old message (message timestamp: ${_message.timestamp}, last timestamp: ${this.lastMessageTimestamp})`);
        return;
      }

      _message.level = parseInt(_message.level);
      message = _message;

      const _resolver = resolver;
      promises.push(new Promise((r, t) => {
        resolver = r;
        thrower = t;
      }));
      _resolver(message);
    });

    this.ws.on('err', (err: any) => {
      clearInterval(pingTimer);
      thrower(err);
    });

    this.ws.on('close', () => {
      clearInterval(pingTimer);
      resolver({
        action: 'reconnect'
      });
      this.log.info(`Websocket connection closed`);
    });

    while (true) {
      const promise = promises.shift();
      if (!promise) {
        return;
      }

      yield await promise;
    }
  }

  async setLevel(level: Level): Promise<undefined> {
    if (level === this.lastLevel) {
      this.log.debug(`Not sending level ${level} that matches last level ${this.lastLevel} to service`);
      return;
    }

    this.log.debug(`Sending level ${level.toString()} to service`);

    if (this.ws) {
      const ws = this.ws;
      return new Promise((resolve, reject) => {
        ws.send(JSON.stringify({
          action: 'setState',
          level: level.toString()
        }), err => {
          if (err) {
            reject(err);
          } else {
            this.lastLevel = level;
            resolve(undefined);
          }
        });
      });
    }
  }
};