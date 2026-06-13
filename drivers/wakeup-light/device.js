'use strict';

const { Device } = require('homey');
const somneoapi = require('../../api/somneo_api');


class WakeupLightDevice extends Device {

  async onInit() {
    this.log('Wakeup-Light: '+this.getName()+' - Device has been initialized');
    await this.fixCapabilities();
    this.start_update_loops();
  }

  async fixCapabilities()
  {
    if(!this.hasCapability('onoff'))
      await this.addCapability('onoff');
    if(!this.hasCapability('dim'))
      await this.addCapability('dim');
    if(!this.hasCapability('measure_humidity'))
      await this.addCapability('measure_humidity');
    if(!this.hasCapability('measure_luminance'))
      await this.addCapability('measure_luminance');
    if(!this.hasCapability('measure_temperature'))
      await this.addCapability('measure_temperature');
    if(!this.hasCapability('measure_noise'))
      await this.addCapability('measure_noise');
    if(!this.hasCapability('nightlight'))
      await this.addCapability('nightlight');
    if(!this.hasCapability('sunset'))
      await this.addCapability('sunset');
    if(!this.hasCapability('bedtime_tracking'))
      await this.addCapability('bedtime_tracking');
    if(!this.hasCapability('sunrise_preview'))
      await this.addCapability('sunrise_preview');
    if(!this.hasCapability('relax_breathe'))
      await this.addCapability('relax_breathe');

    this.registerCapabilityListener('onoff', this.onCapabilityOnoff.bind(this));
    this.registerCapabilityListener('dim', this.onCapabilityDim.bind(this));
    this.registerCapabilityListener('nightlight', this.onCapabilityNightlight.bind(this));
    this.setupFlowNightlightMode();
    this.registerCapabilityListener('sunset', this.onCapabilitySunset.bind(this));
    this.setupFlowSunsetMode();
    this.registerCapabilityListener('bedtime_tracking', this.onCapabilityBedtimeTracking.bind(this));
    this.registerCapabilityListener('sunrise_preview', this.onCapabilitySunrisePreview.bind(this));
    this.setupFlowSunrisePreviewMode();
    this.registerCapabilityListener('relax_breathe', this.onCapabilityRelaxBreathe.bind(this));
    this.setupFlowRelaxBreatheMode();
    this._alarmTriggeredCard = this.homey.flow.getDeviceTriggerCard('alarm_triggered');
    this._sunsetOnTrigger = this.homey.flow.getDeviceTriggerCard('sunset_true');
    this._sunsetOffTrigger = this.homey.flow.getDeviceTriggerCard('sunset_false');
    this._sunriseOnTrigger = this.homey.flow.getDeviceTriggerCard('sunrise_preview_true');
    this._sunriseOffTrigger = this.homey.flow.getDeviceTriggerCard('sunrise_preview_false');
    this._relaxOnTrigger = this.homey.flow.getDeviceTriggerCard('relax_breathe_true');
    this._relaxOffTrigger = this.homey.flow.getDeviceTriggerCard('relax_breathe_false');
  }

  //Reads a setting as an integer, falling back to a default when it is not set yet
  _num(val, def) {
    var n = parseInt(val);
    return isNaN(n) ? def : n;
  }


  start_update_loops() {
    this.update_loop_sensors();
    this.update_loop_mainlight();
    this.update_loop_bedtime();
    this.update_loop_events();
    this.update_loop_sunset();
    this.update_loop_relax();
    //this.update_loop_timers();
    this.refreshState();
  }
  update_loop_sensors() {
    let interval = 30000;
    this._timerSensors = setInterval(() => {
        this.updateSensors();
    }, interval);
  }
  update_loop_mainlight() {
    let interval = 31000;
    this._timerLight = setInterval(() => {
        this.updateMainLightState();
    }, interval);
  }
  update_loop_bedtime() {
    let interval = 32000;
    this._timerBedtime = setInterval(() => {
        this.updateBedtimeTracking();
    }, interval);
  }
  update_loop_events() {
    let interval = 20000;
    this._timerEvents = setInterval(() => {
        this.updateEvents();
    }, interval);
  }
  update_loop_sunset() {
    let interval = 33000;
    this._timerSunset = setInterval(() => {
        this.updateSunsetState();
    }, interval);
  }
  update_loop_relax() {
    let interval = 34000;
    this._timerRelax = setInterval(() => {
        this.updateRelaxBreatheState();
    }, interval);
  }
  update_loop_timers() {
    let interval = 60000;
    this._timerTimers = setInterval(() => {
        this.updateTimerState();
    }, interval);
  }

  async refreshState()
  {
    //Expand this with the update methods of the other features of the device
    //this.updateAlarmState();
    //this.updateAlarmSchedules();
    //this.updateTimerState();
  }

  async onAdded() {
    this.log('Wakeup-Light: '+this.getName()+' - Device has been added');
  }

  async updateSensors()
  {
    somneoapi.getSensors(this.getStoreValue('address')).then(sensordata => {
        //this.log(JSON.stringify(sensordata))
        this.setCapabilityValue('measure_humidity', sensordata.msrhu);
        this.setCapabilityValue('measure_luminance', sensordata.mslux);
        this.setCapabilityValue('measure_temperature', sensordata.mstmp);
        this.setCapabilityValue('measure_noise', sensordata.mssnd);
    }).catch(e => { 
      this.log('Error on retrieving sensor data: '+e);
    });
  }

  // this method is called when the Device has requested a state change (turned on or off)
	async onCapabilityOnoff( value, opts ) {
    await this.setCapabilityValue('onoff', value);
    await this.setCapabilityValue('nightlight', false);
    await this.setCapabilityValue('sunrise_preview', false);
    return await this.setMainLightState();
  }
  // this method is called when the Device has requested a state change (dim)
  async onCapabilityDim( value, opts ) {
    await this.setCapabilityValue('dim', value);
    return await this.setMainLightState();
  }
  // this method is called when the Device has requested a state change (sunrise preview)
  async onCapabilitySunrisePreview( value, opts ) {
    await this.setCapabilityValue('sunrise_preview', value);
    if(value) {
      await this.setCapabilityValue('onoff', false);
      await this.setCapabilityValue('nightlight', false);
    }
    var settings = this.getSettings();
    somneoapi.putSunrisePreview(this.getStoreValue('address'), value, this._num(settings.sunrise_color_scheme, 0)).then(lightstatedata => {
      this.log(JSON.stringify(lightstatedata))
    }).catch(e => {
      this.log('Error on updating Sunrise preview status: '+e);
      return e;
    });
  }

  // this method is called when the Device has requested a state change (sunset)
  async onCapabilitySunset( value, opts ) {
    await this.setCapabilityValue('sunset', value);
    var settings = this.getSettings();
    var sound = this.getSunsetSound(settings);
    let body = {
      "durat": this._num(settings.sunset_duration, 30), //sunset duration in minutes
      "onoff": value, //sunset on off
      "curve": this._num(settings.sunset_light_intensity, 20), //sunset light level
      "ctype": this._num(settings.sunset_color_scheme, 0), //sunset color scheme
      "snddv": sound.snddv, //sound device ['off','dus','fmr','aux']
      "sndch": sound.sndch, //sound channel/preset
      "sndlv": this._num(settings.sunset_ambient_volume, 12) //ambient sound volume
    };
    somneoapi.putSunsetSettings(this.getStoreValue('address'), body).then(sunsetdata => {
      this.log(JSON.stringify(sunsetdata))
    }).catch(e => {
      this.log('Error on updating Sunset status: '+e);
      return e;
    });
  }

  //Maps the ambient sound setting onto the device's sound device and channel fields
  getSunsetSound(settings)
  {
    var sel = settings.sunset_ambient_sound;
    if(sel === 'fmr')
      return { snddv: 'fmr', sndch: String(settings.sunset_ambient_radio_channel || '1') };
    if(sel === 'aux')
      return { snddv: 'aux', sndch: '0' };
    if(sel === undefined || sel === 'off')
      return { snddv: 'off', sndch: '0' };
    return { snddv: 'dus', sndch: String(sel) };
  }

  // this method is called when the Device has requested a state change (relax breathe)
  async onCapabilityRelaxBreathe( value, opts ) {
    await this.setCapabilityValue('relax_breathe', value);
    var settings = this.getSettings();
    var rtype = this._num(settings.relax_guidance_type, 0);
    let body = {
      "durat": this._num(settings.relax_duration, 10), //program duration in minutes
      "onoff": value, //relax breathe on off
      "progr": this._num(settings.relax_breathing_pace, 4) - 3, //breathing pace (device stores bpm - 3)
      "rtype": rtype //guidance type [0 - Light, 1 - Sound]
    };
    if(rtype === 0)
      body.intny = this._num(settings.relax_light_intensity, 20); //light level when guided by light
    else
      body.sndlv = this._num(settings.relax_sound_intensity, 12); //volume when guided by sound
    somneoapi.putRelaxBreatheSettings(this.getStoreValue('address'), body).then(relaxdata => {
      this.log(JSON.stringify(relaxdata))
    }).catch(e => {
      this.log('Error on updating Relax breathe status: '+e);
      return e;
    });
  }
  // this method is called when the Device has requested a state change (nightlight)
  async onCapabilityNightlight( value, opts ) {
    await this.setCapabilityValue('nightlight', value);
    await this.setCapabilityValue('onoff', false);
    await this.setCapabilityValue('sunrise_preview', false);
    var dim = 25*this.getCapabilityValue('dim');
    somneoapi.putMainLightState(this.getStoreValue('address'), false, dim, false, value).then(lightstatedata => {
      this.log(JSON.stringify(lightstatedata))
    }).catch(e => { 
      this.log('Error on updating Light status: '+e);
      return e;
    });
  }

  // this method is called when the Device has requested a state change (sleep/bedtime tracking)
  async onCapabilityBedtimeTracking( value, opts ) {
    await this.setCapabilityValue('bedtime_tracking', value);
    somneoapi.putBedtimeTracking(this.getStoreValue('address'), value).then(bedtimedata => {
      this.log(JSON.stringify(bedtimedata))
    }).catch(e => {
      this.log('Error on updating Sleep tracking status: '+e);
      return e;
    });
  }

  async setMainLightState()
  {
    var onoff = this.getCapabilityValue('onoff');
    var dim = 25*this.getCapabilityValue('dim');
    console.info('send light update to device ['+onoff+'|'+dim+']');
    var sunrise = false;
    var nightlight = false;
    this.getStoreValue('address')
    somneoapi.putMainLightState(this.getStoreValue('address'), onoff, dim, sunrise, nightlight).then(lightstatedata => {
      this.log(JSON.stringify(lightstatedata))
    }).catch(e => { 
      this.log('Error on updating Light status: '+e);
      return e;
    });
  }

  async updateMainLightState()
  {
    somneoapi.getMainLightState(this.getStoreValue('address')).then(lightstatedata => {
      //this.log(JSON.stringify(lightstatedata))
      this.setCapabilityValue('onoff', lightstatedata.onoff);
      this.setCapabilityValue('dim', (lightstatedata.ltlvl/25));
      this.setCapabilityValue('nightlight', lightstatedata.ngtlt);
      var prevSunrise = this.getCapabilityValue('sunrise_preview');
      this.setCapabilityValue('sunrise_preview', lightstatedata.tempy);
      //Only fire on an actual change, not on the first poll after (re)start
      if(prevSunrise !== null && prevSunrise !== undefined && prevSunrise !== lightstatedata.tempy) {
        if(lightstatedata.tempy)
          this._sunriseOnTrigger.trigger(this).catch(e => { this.log('Error on firing sunrise_preview_true: '+e); });
        else
          this._sunriseOffTrigger.trigger(this).catch(e => { this.log('Error on firing sunrise_preview_false: '+e); });
      }
    }).catch(e => {
      this.log('Error on retrieving Light status: '+e);
    });
  }

  async updateSunsetState()
  {
    somneoapi.getSunsetSettings(this.getStoreValue('address')).then(sunsetdata => {
      var active = sunsetdata.onoff;
      var prev = this.getCapabilityValue('sunset');
      this.setCapabilityValue('sunset', active);
      //Only fire on an actual change, not on the first poll after (re)start
      if(prev !== null && prev !== undefined && prev !== active) {
        if(active)
          this._sunsetOnTrigger.trigger(this).catch(e => { this.log('Error on firing sunset_true: '+e); });
        else
          this._sunsetOffTrigger.trigger(this).catch(e => { this.log('Error on firing sunset_false: '+e); });
      }
    }).catch(e => {
      this.log('Error on retrieving Sunset status: '+e);
    });
  }

  async updateRelaxBreatheState()
  {
    somneoapi.getRelaxBreatheSettings(this.getStoreValue('address')).then(relaxdata => {
      var active = relaxdata.onoff;
      var prev = this.getCapabilityValue('relax_breathe');
      this.setCapabilityValue('relax_breathe', active);
      //Only fire on an actual change, not on the first poll after (re)start
      if(prev !== null && prev !== undefined && prev !== active) {
        if(active)
          this._relaxOnTrigger.trigger(this).catch(e => { this.log('Error on firing relax_breathe_true: '+e); });
        else
          this._relaxOffTrigger.trigger(this).catch(e => { this.log('Error on firing relax_breathe_false: '+e); });
      }
    }).catch(e => {
      this.log('Error on retrieving Relax breathe status: '+e);
    });
  }

  async updateBedtimeTracking()
  {
    somneoapi.getBedtimeTracking(this.getStoreValue('address')).then(bedtimedata => {
      this.setCapabilityValue('bedtime_tracking', bedtimedata.night);
    }).catch(e => {
      this.log('Error on retrieving Sleep tracking status: '+e);
    });
  }

  async updateEvents()
  {
    //Older Somneo devices do not expose the event endpoint, stop polling once we are sure
    if(this._eventsSupported === false)
      return;
    somneoapi.getLastEvent(this.getStoreValue('address')).then(eventdata => {
      this._eventFailures = 0;
      var event = eventdata.event;
      //On the first poll we only store a baseline, so we do not fire on app/device restart
      if(this._lastEvent === undefined) {
        this._lastEvent = event;
        return;
      }
      if(event !== this._lastEvent) {
        this._lastEvent = event;
        //'startwakeup' is sent the moment an alarm starts the wake-up sequence
        if(event === 'startwakeup') {
          this.log('An alarm went off, firing the alarm trigger');
          this._alarmTriggeredCard.trigger(this).catch(e => {
            this.log('Error on firing alarm trigger: '+e);
          });
        }
      }
    }).catch(e => {
      this._eventFailures = (this._eventFailures || 0) + 1;
      this.log('Error on retrieving device events ('+this._eventFailures+'): '+e);
      if(this._eventFailures >= 3) {
        this._eventsSupported = false;
        this.log('Device does not support the event system, disabling alarm trigger polling');
      }
    });
  }

  async updateTimerState()
  {
    somneoapi.getTimersState(this.getStoreValue('address')).then(timerstatedata => {
      this.log(JSON.stringify(timerstatedata))
    }).catch(e => { 
      this.log('Error on retrieving Timer status: '+e);
    });
  }

  async updateAlarmState()
  {
    somneoapi.getAlarmState(this.getStoreValue('address')).then(alarmstatedata => {
      this.log(JSON.stringify(alarmstatedata))
    }).catch(e => { 
      this.log('Error on retrieving Alarm status: '+e);
    });
  }

  async updateAlarmSchedules()
  {
    somneoapi.getAlarmSchedules(this.getStoreValue('address')).then(alarmscheduledata => {
      this.log(JSON.stringify(alarmscheduledata))
    }).catch(e => { 
      this.log('Error on retrieving Alarm schedules: '+e);
    });
  }

  async onSettings({ oldSettings, newSettings, changedKeys }) {
    this.log('Wakeup-Light: '+this.getName()+' - Device settings where changed');
    if(changedKeys.includes('display_always_on') || changedKeys.includes('display_brightness')) {
      await somneoapi.putDisplaySettings(this.getStoreValue('address'), newSettings.display_always_on, this._num(newSettings.display_brightness, 3)).catch(e => {
        this.log('Error on updating Display settings: '+e);
      });
    }
  }

  //Pushes the configured display settings to the device (settings are the source of truth)
  async applyDisplaySettings()
  {
    var settings = this.getSettings();
    if(settings.display_always_on === undefined)
      return;
    somneoapi.putDisplaySettings(this.getStoreValue('address'), settings.display_always_on, this._num(settings.display_brightness, 3)).then(displaydata => {
      this.log(JSON.stringify(displaydata))
    }).catch(e => {
      this.log('Error on applying Display settings: '+e);
    });
  }

  async onRenamed(name) {
    this.log('Wakeup-Light: '+this.getName()+' - Device was renamed');
  }

  async onDeleted() {
    this.log('Wakeup-Light: '+this.getName()+' - has been deleted');
    if(this._timerSensors) clearInterval(this._timerSensors);
    if(this._timerLight) clearInterval(this._timerLight);
    if(this._timerBedtime) clearInterval(this._timerBedtime);
    if(this._timerEvents) clearInterval(this._timerEvents);
    if(this._timerSunset) clearInterval(this._timerSunset);
    if(this._timerRelax) clearInterval(this._timerRelax);
  }

  onDiscoveryResult(discoveryResult) {
    return discoveryResult.id === this.getData().id;
  }

  async onDiscoveryAvailable(discoveryResult) {
    this.log('Located device and ready to retrieve data...');
    this.log('Device: '+this.getName()+' was located with address '+discoveryResult.address);
    this.setStoreValue('address',discoveryResult.address);
    this.applyDisplaySettings();
    // This method will be executed once when the device has been found (onDiscoveryResult returned true)
  }

  onDiscoveryAddressChanged(discoveryResult) {
    // Update your connection details here, reconnect when the device is offline
    this.log('Device: '+this.getName()+' changed its address to '+discoveryResult.address);
    this.setStoreValue('address',discoveryResult.address);
  }

  onDiscoveryLastSeenChanged(discoveryResult) {
    // When the device is offline, try to reconnect here
    //this.api.reconnect().catch(this.error); 
  }

  async setupFlowSunsetMode()
  {
    this._setSunsetMode = await this.homey.flow.getActionCard('set-sunset'); 
    this._setSunsetMode
      .registerRunListener(async (args, state) => {
        this.log('attempt to set sunset mode: '+JSON.stringify(args.start));
        return new Promise((resolve, reject) => {
          this.log('now send the capability command');
          args.device.onCapabilitySunset(args.start).then(() => {
            resolve(true);
          }, (_error) => {
            reject(_error);
          });
        });
      });
  }

  async setupFlowRelaxBreatheMode()
  {
    this._setRelaxBreatheMode = await this.homey.flow.getActionCard('set-relax-breathe');
    this._setRelaxBreatheMode
      .registerRunListener(async (args, state) => {
        this.log('attempt to set relax breathe mode: '+JSON.stringify(args.mode));
        return new Promise((resolve, reject) => {
          args.device.onCapabilityRelaxBreathe(args.mode).then(() => {
            resolve(true);
          }, (_error) => {
            reject(_error);
          });
        });
      });
  }

  async setupFlowSunrisePreviewMode()
  {
    this._setSunrisePreviewMode = await this.homey.flow.getActionCard('set-sunrise-preview');
    this._setSunrisePreviewMode
      .registerRunListener(async (args, state) => {
        this.log('attempt to set sunrise preview mode: '+JSON.stringify(args.mode));
        return new Promise((resolve, reject) => {
          args.device.onCapabilitySunrisePreview(args.mode).then(() => {
            resolve(true);
          }, (_error) => {
            reject(_error);
          });
        });
      });
  }

  async setupFlowNightlightMode()
  {
    this._setNighlightMode = await this.homey.flow.getActionCard('set-nightlight'); 
    this._setNighlightMode
      .registerRunListener(async (args, state) => {
        this.log('attempt to set nightlight mode: '+JSON.stringify(args.mode));
        return new Promise((resolve, reject) => {
          this.log('now send the capability command');
          args.device.onCapabilityNightlight(args.mode).then(() => {
            resolve(true);
          }, (_error) => {
            reject(_error);
          });
        });
      });
    }
}

module.exports = WakeupLightDevice;
