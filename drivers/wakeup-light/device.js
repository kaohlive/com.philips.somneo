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

    this.registerCapabilityListener('onoff', this.onCapabilityOnoff.bind(this));
    this.registerCapabilityListener('dim', this.onCapabilityDim.bind(this));
    this.registerCapabilityListener('nightlight', this.onCapabilityNightlight.bind(this));
    this.setupFlowNightlightMode();
    this.registerCapabilityListener('sunset', this.onCapabilitySunset.bind(this));
    this.setupFlowSunsetMode();
    this.registerCapabilityListener('bedtime_tracking', this.onCapabilityBedtimeTracking.bind(this));
    this._alarmTriggeredCard = this.homey.flow.getDeviceTriggerCard('alarm_triggered');
  }


  start_update_loops() {
    this.update_loop_sensors();
    this.update_loop_mainlight();
    this.update_loop_bedtime();
    this.update_loop_events();
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
    await this.setCapabilityValue('sunset', false);
    return await this.setMainLightState();
  }
  // this method is called when the Device has requested a state change (dim)
  async onCapabilityDim( value, opts ) {
    await this.setCapabilityValue('dim', value);
    return await this.setMainLightState();
  }
  // this method is called when the Device has requested a state change (sunset)
  async onCapabilitySunset( value, opts ) {
    await this.setCapabilityValue('sunset', value);
    await this.setCapabilityValue('onoff', false);
    await this.setCapabilityValue('nightlight', false);
    var dim = 25*this.getCapabilityValue('dim');
    somneoapi.putMainLightState(this.getStoreValue('address'), false, dim, value, false).then(lightstatedata => {
      this.log(JSON.stringify(lightstatedata))
    }).catch(e => { 
      this.log('Error on updating Light status: '+e);
      return e;
    });
  }
  // this method is called when the Device has requested a state change (nightlight)
  async onCapabilityNightlight( value, opts ) {
    await this.setCapabilityValue('nightlight', value);
    await this.setCapabilityValue('sunset', false);
    await this.setCapabilityValue('onoff', false);
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
      this.setCapabilityValue('sunset', lightstatedata.tempy);
      this.setCapabilityValue('nightlight', lightstatedata.ngtlt);
    }).catch(e => { 
      this.log('Error on retrieving Light status: '+e);
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
  }

  onDiscoveryResult(discoveryResult) {
    return discoveryResult.id === this.getData().id;
  }

  async onDiscoveryAvailable(discoveryResult) {
    this.log('Located device and ready to retrieve data...');
    this.log('Device: '+this.getName()+' was located with address '+discoveryResult.address);
    this.setStoreValue('address',discoveryResult.address);
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
