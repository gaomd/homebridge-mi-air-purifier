var miio = require('miio');
var Accessory, Service, Characteristic;
var devices = [];

module.exports = function (homebridge) {
  Accessory = homebridge.platformAccessory;
  Service = homebridge.hap.Service;
  Characteristic = homebridge.hap.Characteristic;

  homebridge.registerAccessory('homebridge-mi-air-purifier', 'MiAirPurifier', MiAirPurifier);
};

function MiAirPurifier(log, config) {
  this.log = log;
  this.name = config.name || 'Air Purifier';
  this.deviceId = config.device_id || '';
  this.deviceToken = config.device_token || '';
  this.showAirQuality = config.showAirQuality || false;
  this.showTemperature = config.showTemperature || false;
  this.showHumidity = config.showHumidity || false;

  if (this.deviceId === '' || this.deviceToken === '') {
    throw new Error('Configure both device_id and device_token required.')
  }

  this.services = [];

  this.airPurifierService = new Service.AirPurifier(this.name);

  this.airPurifierService
    .getCharacteristic(Characteristic.Active)
    .on('get', this.getPowerState.bind(this))
    .on('set', this.setPowerState.bind(this));

  this.airPurifierService
    .getCharacteristic(Characteristic.RotationSpeed)
    .on('get', this.getRotationSpeed.bind(this))
    .on('set', this.setRotationSpeed.bind(this));

  this.airPurifierService
    .getCharacteristic(Characteristic.TargetAirPurifierState)
    .on('get', this.getMode.bind(this))
    .on('set', this.setMode.bind(this));

  this.airPurifierService
    .getCharacteristic(Characteristic.CurrentAirPurifierState)
    .on('get', this.getCurrentAirPurifierState.bind(this));

  this.services.push(this.airPurifierService);

  this.serviceInfo = new Service.AccessoryInformation();

  this.serviceInfo
    .setCharacteristic(Characteristic.Manufacturer, 'Xiaomi')
    .setCharacteristic(Characteristic.Model, 'Air Purifier');

  this.services.push(this.serviceInfo);

  if (this.showAirQuality) {
    this.airQualitySensorService = new Service.AirQualitySensor('Air Quality Sensor');

    this.airQualitySensorService
      .getCharacteristic(Characteristic.AirQuality)
      .on('get', this.getAirQuality.bind(this));

    this.services.push(this.airQualitySensorService);
  }

  if (this.showTemperature) {
    this.temperatureSensorService = new Service.TemperatureSensor('Temperature');

    this.temperatureSensorService
      .getCharacteristic(Characteristic.CurrentTemperature)
      .on('get', this.getCurrentTemperature.bind(this));

    this.services.push(this.temperatureSensorService);
  }

  if (this.showHumidity) {
    this.humiditySensorService = new Service.HumiditySensor('Humidity');

    this.humiditySensorService
      .getCharacteristic(Characteristic.CurrentRelativeHumidity)
      .on('get', this.getCurrentRelativeHumidity.bind(this));

    this.services.push(this.humiditySensorService);
  }

  this.discover();
}

MiAirPurifier.prototype = {
  discover: function () {
    var accessory = this;
    var log = this.log;

    log.debug('Discovering Mi air purifier devices...');

    // Discover device in the network
    var browser = miio.browse();

    browser.on('available', function (reg) {
      if (reg.id !== accessory.deviceId) {
        return;
      }

      reg.token = accessory.deviceToken;

      miio.device(reg).then(function (device) {
        if (device.type != 'air-purifier')
          return;

        devices[reg.id] = device;
        accessory.device = device;

        log.debug('Discovered "%s" (ID: %s) on %s:%s.', reg.hostname, device.id, device.address, device.port);
      });
    });

    browser.on('unavailable', function (reg) {
      if (reg.id !== accessory.deviceId) {
        return;
      }

      var device = devices[reg.id];

      if (!device)
        return;

      device.destroy();
      delete devices[reg.id];
    });
  },

  getPowerState: function (callback) {
    if (!this.device) {
      callback(null, Characteristic.Active.INACTIVE);
      return;
    }

    callback(null, this.device.power ? Characteristic.Active.ACTIVE : Characteristic.Active.INACTIVE);
  },

  setPowerState: function (state, callback) {
    if (!this.device) {
      callback(new Error('No air purifier is discovered.'));
      return;
    }

    this.device.setPower((Characteristic.Active.ACTIVE === state));

    callback();
  },

  getMode: function (callback) {
    if (!this.device) {
      callback(null, Characteristic.TargetAirPurifierState.AUTO);
      return;
    }

    switch (this.device.mode) {
      case 'favorite':
        callback(null, Characteristic.TargetAirPurifierState.MANUAL);
        break;
      case 'auto':
      default:
        callback(null, Characteristic.TargetAirPurifierState.AUTO);
    }
  },

  setMode: function (state, callback) {
    if (!this.device) {
      callback(new Error('No air purifier is discovered.'));
      return;
    }

    switch (state) {
      case Characteristic.TargetAirPurifierState.AUTO:
        this.device.setMode('auto');
        break;
      case Characteristic.TargetAirPurifierState.MANUAL:
        this.device.setMode('favorite');
        break;
      default:
        // Ignore other states (i.e. night mode), put device into idle mode
        this.device.setMode('idle');
    }

    callback();
  },

  getCurrentRelativeHumidity: function (callback) {
    if (!this.device) {
      callback(null, 0);
      return;
    }

    callback(null, this.device.humidity);
  },

  // Unused exp method
  reportRotationSpeed: function () {
    var rotationSpeed;

    // Device disconnected or turned off
    if (!this.device || !this.device.power) {
      rotationSpeed = 0;
    } else {
      rotationSpeed = Math.min(1, (this.device.favoriteLevel / 16) * 100);
    }

    this.airPurifierService.getCharacteristic(Characteristic.RotationSpeed).updateValue(rotationSpeed);
  },

  // Unused exp method
  reportPowerState: function () {
    var powerState;

    // Device disconnected or turned off
    if (!this.device || !this.device.power) {
      powerState = Characteristic.Active.INACTIVE;
    } else {
      powerState = Characteristic.Active.ACTIVE;
    }

    this.airPurifierService.getCharacteristic(Characteristic.Active).updateValue(powerState);
  },

  getRotationSpeed: function (callback) {
    // Device disconnected or turned off
    if (!this.device || !this.device.power) {
      callback(null, 0);
      return;
    }

    // At least 1% when devices are working
    var rotationSpeed = Math.min(1, (this.device.favoriteLevel / 16) * 100);
    this.log.debug('Pass rotation speed to HomeKit: ' + rotationSpeed);

    callback(null, rotationSpeed);
  },

  // TODO: Try to understand three states
  getCurrentAirPurifierState: function (callback) {
    if (!this.device || !this.device.power) {
      callback(null, Characteristic.CurrentAirPurifierState.INACTIVE);
      return;
    }

    // No matched states to Mi devices?
    // callback(null, Characteristic.CurrentAirPurifierState.IDLE);

    callback(null, Characteristic.CurrentAirPurifierState.PURIFYING_AIR);
  },

  setRotationSpeed: function (speed, callback) {
    if (!this.device) {
      callback(new Error('No air purifier is discovered.'));
      return;
    }

    // 17 levels: https://github.com/aholstenson/miio/blob/master/docs/devices/air-purifier.md
    var favLevel = Math.round(speed / 100 * 16);
    this.device.setFavoriteLevel(favLevel);
    this.log.debug('Set favorite level: ' + favLevel);

    callback();
  },

  getAirQuality: function (callback) {
    if (!this.device) {
      callback(null, Characteristic.AirQuality.UNKNOWN);
      return;
    }

    var levels = [
      [200, Characteristic.AirQuality.POOR],
      [150, Characteristic.AirQuality.INFERIOR],
      [100, Characteristic.AirQuality.FAIR],
      [50, Characteristic.AirQuality.GOOD],
      [0, Characteristic.AirQuality.EXCELLENT],
    ];

    var quality = Characteristic.AirQuality.UNKNOWN;

    for (var item of levels) {
      if (this.device.aqi >= item[0]) {
        quality = item[1];
        break;
      }
    }

    callback(null, quality);
  },

  getCurrentTemperature: function (callback) {
    if (!this.device) {
      callback(null, 0);
      return;
    }

    callback(null, this.device.temperature);
  },

  identify: function (callback) {
    callback();
  },

  getServices: function () {
    return this.services;
  }
};
