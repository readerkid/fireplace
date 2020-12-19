import { promisify } from 'util';
import child_process from 'child_process';
const execFile = promisify(child_process.execFile);

import {
  AccessoryConfig,
  AccessoryPlugin,
  API,
  CharacteristicEventTypes,
  CharacteristicGetCallback,
  CharacteristicSetCallback,
  CharacteristicValue,
  HAP,
  Logging,
  Service
} from "homebridge";

import {
  Level,
  ServiceConfig,
  Credentials
} from './types';

import { ServiceClient } from './serviceClient';

/*
 * IMPORTANT NOTICE
 *
 * One thing you need to take care of is, that you never ever ever import anything directly from the "homebridge" module (or the "hap-nodejs" module).
 * The above import block may seem like, that we do exactly that, but actually those imports are only used for types and interfaces
 * and will disappear once the code is compiled to Javascript.
 * In fact you can check that by running `npm run build` and opening the compiled Javascript file in the `dist` folder.
 * You will notice that the file does not contain a `... = require("homebridge");` statement anywhere in the code.
 *
 * The contents of the above import statement MUST ONLY be used for type annotation or accessing things like CONST ENUMS,
 * which is a special case as they get replaced by the actual value and do not remain as a reference in the compiled code.
 * Meaning normal enums are bad, const enums can be used.
 *
 * You MUST NOT import anything else which remains as a reference in the code, as this will result in
 * a `... = require("homebridge");` to be compiled into the final Javascript code.
 * This typically leads to unexpected behavior at runtime, as in many cases it won't be able to find the module
 * or will import another instance of homebridge causing collisions.
 *
 * To mitigate this the {@link API | Homebridge API} exposes the whole suite of HAP-NodeJS inside the `hap` property
 * of the api object, which can be acquired for example in the initializer function. This reference can be stored
 * like this for example and used to access all exported variables and classes from HAP-NodeJS.
 */
let hap: HAP;

/*
 * Initializer function called when the plugin is loaded.
 */
export = (api: API) => {
  hap = api.hap;
  api.registerAccessory("ChaskaFireplace", Fireplace);
};

class Fireplace implements AccessoryPlugin {
  private readonly log: Logging;
  private readonly name: string;
  private on = false;
  private level: Level = 0;

  private readonly serviceClient: ServiceClient;

  private readonly fireplaceService: Service;
  private readonly informationService: Service;

  constructor(log: Logging, config: AccessoryConfig, api: API) {
    this.log = log;
    this.name = config.name;

    const serviceConfig = config.websocketService as ServiceConfig;
    const credentials = config.websocketServiceIAMCredentials as Credentials;

    this.serviceClient = new ServiceClient(serviceConfig, credentials, log);

    this.runService();
    
    this.fireplaceService = new hap.Service.Lightbulb(this.name);
    this.fireplaceService.getCharacteristic(hap.Characteristic.On)
      .on(CharacteristicEventTypes.GET, (callback: CharacteristicGetCallback) => {
        log.info(`Fireplace current state of 'On' characteristic is: ${this.on ? 'ON' : 'OFF'}`);
        callback(undefined, this.on);
      })
      .on(CharacteristicEventTypes.SET, async (value: CharacteristicValue, callback: CharacteristicSetCallback) => {
        if (this.on === value as boolean) {
          callback(null, this.on);
          return;
        }

        log.info(`Fireplace setting 'On' characteristic to: ${value as boolean ? 'ON' : 'OFF'}`);

        if (value as boolean) {
          try {
            this.sendCommand('flame-1');
            this.level = 1;
            this.on = true;
            callback(null, this.on);
          } catch (err) {
            log.error(`Failed to turn on fireplace: ${err}`);
            callback(err);
          }
        } else {
          try {
            this.sendCommand('off');
            this.level = 0;
            this.on = false;
            callback(null, this.on);
          } catch (err) {
            log.error(`Failed to turn off fireplace: ${err}`);
            callback(err);
          }
        }
      });

    this.fireplaceService.getCharacteristic(hap.Characteristic.Brightness)
      .on(CharacteristicEventTypes.GET, (callback: CharacteristicGetCallback) => {
        log.info(`Current state of the fireplace 'Brightness' characteristic was returned: ${percentFromLevel(this.level)}`);
        callback(undefined, percentFromLevel(this.level));
      })
      .on(CharacteristicEventTypes.SET, async (value: CharacteristicValue, callback: CharacteristicSetCallback) => {
        const level = this.levelFromPercent(value as number);

        if (this.level === level) {
          log.info(`Fireplace leaving 'Brightness' characteristic at level ${this.level}`);
          callback(null, percentFromLevel(this.level));
          return;
        }
    
        try {
          await this.setLevel(level);
        } catch (err) {
          callback(err);
          return;
        }

        this.serviceClient.setLevel(level);
        callback(null, value);
      });

    this.informationService = new hap.Service.AccessoryInformation()
      .setCharacteristic(hap.Characteristic.Manufacturer, "Kozy Heat")
      .setCharacteristic(hap.Characteristic.Model, "Chaska");

    log.info("Fireplace finished initializing!");
  }

  private async setLevel(level: Level) {
    if (level === 0) {
      this.log.info(`Fireplace turning off due to level 0`);
      try {
        await this.sendCommand('off');
        this.level = 0;
        this.on = false;
      } catch (err) {
        this.log.error(`Fireplace failed to turn off: ${err}`);
        throw err;
      }
    } else {
      this.log.info(`Fireplace turning on to level ${level}`);
      try {
        await this.sendCommand(`flame-${level}`);
        this.level = level;
        this.on = true;
      } catch (err) {
        this.log.error(`Fireplace failed to set flame to level ${level}: ${err}`);
        throw err;
      }
    }
  }

  private levelFromPercent(percent: number): Level {
    if (percent === 0) {
      return 0;
    }

    return (Math.round(percent * 6 / 100) || 1) as Level;
  }

  private async sendCommand(command: string) {
    await execFile('transmit.py', [command]);
    await execFile('transmit.py', [command]);
    await execFile('transmit.py', [command]);
  }

  private async runService() {
    for await (const { action, level } of this.serviceClient.nextCommand()) {
      this.log(`Received service command ${action} ${level}`)

      if (this.level === level) {
        this.log.info(`Fireplace leaving 'Brightness' characteristic at level ${this.level}`);
        continue;
      }

      if (action === 'currentLevel') {
        // Update the level now so we don't reissue the command when setting the characteristic
        this.level = level;
      }

      this.fireplaceService.setCharacteristic(hap.Characteristic.Brightness, percentFromLevel(level));
    }
  }

  /*
   * This method is called directly after creation of this instance.
   * It should return all services which should be added to the accessory.
   */
  getServices(): Service[] {
    return [
      this.informationService,
      this.fireplaceService,
    ];
  }
}

const percentFromLevel = (level: Level): number => {
  if (level === 0) {
    return 0;
  }

  return Math.round(level * 100 / 6);
}
