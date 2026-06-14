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
    if(!this.hasCapability('media_input'))
      await this.addCapability('media_input');
    if(!this.hasCapability('volume_set'))
      await this.addCapability('volume_set');
    if(!this.hasCapability('speaker_playing'))
      await this.addCapability('speaker_playing');
    if(!this.hasCapability('speaker_next'))
      await this.addCapability('speaker_next');
    if(!this.hasCapability('speaker_prev'))
      await this.addCapability('speaker_prev');
    if(!this.hasCapability('speaker_track'))
      await this.addCapability('speaker_track');
    if(!this.hasCapability('alarm_connectivity'))
      await this.addCapability('alarm_connectivity');
    if(this.getCapabilityValue('alarm_connectivity') === null)
      this._set('alarm_connectivity', false);
    if(!this.hasCapability('alarm_active'))
      await this.addCapability('alarm_active');
    if(this.getCapabilityValue('alarm_active') === null)
      this._set('alarm_active', false);

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
    this.registerCapabilityListener('alarm_active', this.onCapabilityAlarmActive.bind(this));
    this.registerCapabilityListener('media_input', this.onCapabilityMediaInput.bind(this));
    this.registerCapabilityListener('volume_set', this.onCapabilityVolume.bind(this));
    this.registerCapabilityListener('speaker_playing', this.onCapabilitySpeakerPlaying.bind(this));
    this.registerCapabilityListener('speaker_next', this.onCapabilitySpeakerNext.bind(this));
    this.registerCapabilityListener('speaker_prev', this.onCapabilitySpeakerPrev.bind(this));
    this._currentRadioChannel = 1;
    this._alarmTriggeredCard = this.homey.flow.getDeviceTriggerCard('alarm_triggered');
    this._alarmEndedCard = this.homey.flow.getDeviceTriggerCard('alarm_ended');
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

  //Safely reflects a polled value onto a capability. Skips missing/NaN values (the device can
  //return partial data under load) and ignores writes to a device that was removed mid-poll,
  //which avoids the "Expected number, got undefined" and "Device not found" errors.
  _set(cap, value) {
    if(this._deleted)
      return;
    if(value === undefined || value === null)
      return;
    if(typeof value === 'number' && isNaN(value))
      return;
    this.setCapabilityValue(cap, value).catch(e => {
      this.log('Could not set '+cap+': '+e);
    });
  }


  start_update_loops(settings) {
    settings = settings || this.getSettings();
    if(settings.polling_enabled === false) {
      this.log('Polling is disabled in the device settings');
      return;
    }
    this._polling = true;
    this._pollTick = 0;
    this._pollConfiguredInterval = this._num(settings.polling_interval, 15) * 1000;
    this._pollBaseInterval = this._pollConfiguredInterval;
    this._consecutiveFailures = 0;
    this.poll_loop();
  }

  //Tracks reachability from the core light poll. After a few failures the device is marked
  //unavailable and the poll interval backs off so we stop hammering an unreachable device;
  //the first success restores normal cadence and availability.
  _reportHealth(ok) {
    if(ok) {
      if(this._consecutiveFailures > 0) {
        this._consecutiveFailures = 0;
        this._eventFailures = 0;
        this._pollBaseInterval = this._pollConfiguredInterval || 15000;
        this._set('alarm_connectivity', false);
        if(!this.getAvailable())
          this.setAvailable().catch(() => {});
      }
      return;
    }
    this._consecutiveFailures = (this._consecutiveFailures || 0) + 1;
    if(this._consecutiveFailures >= 3) {
      this._set('alarm_connectivity', true);
      if(this.getAvailable())
        this.setUnavailable('Device unreachable').catch(() => {});
      this._pollBaseInterval = Math.min(this._pollBaseInterval * 2, 120000);
    }
  }

  //Single self-paced poll loop. Each pass runs its requests sequentially and only reschedules
  //after it finishes, so a slow Somneo can never cause overlapping polls to pile up. All device
  //I/O is additionally serialized and spaced by the request queue in the api module.
  async poll_loop() {
    while(this._polling) {
      try {
        await this.poll_once();
      } catch(e) {
        this.log('Error in poll loop: '+e);
      }
      await this.sleep(this._pollBaseInterval);
    }
  }

  async poll_once() {
    var tick = this._pollTick;
    //Fast tier (every pass): the event stream drives alarm detection and, where supported,
    //the sunset/relax/bedtime state. Skips itself on devices without the event endpoint.
    await this.updateEvents();
    //Medium tier (every 2nd pass): sensors and main light state (one /wulgt call covers
    //main light, dim, night light and sunrise preview)
    if(tick % 2 === 0) {
      await this.updateSensors();
      await this.updateMainLightState();
    }
    //Slow tier: the heavier per-mode endpoints. When the event system works they are only
    //reconciled occasionally (self-heals any missed event); otherwise they are the state source.
    var reconcile = (this._eventsSupported === false) ? (tick % 4 === 0) : (tick % 20 === 0);
    if(reconcile) {
      await this.updateSunsetState();
      await this.updateRelaxBreatheState();
      await this.updateBedtimeTracking();
      await this.updatePlayerState();
    }
    this._pollTick = (tick + 1) % 1000;
  }

  sleep(ms) {
    return new Promise(resolve => { this._pollTimeout = setTimeout(resolve, ms); });
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
    return somneoapi.getSensors(this.getStoreValue('address')).then(sensordata => {
        //this.log(JSON.stringify(sensordata))
        this._set('measure_humidity', sensordata.msrhu);
        this._set('measure_luminance', sensordata.mslux);
        this._set('measure_temperature', sensordata.mstmp);
        this._set('measure_noise', sensordata.mssnd);
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
    //Coalesce rapid slider changes into a single trailing device write
    this._debounce('mainlight', () => this.setMainLightState(), 400);
  }

  //Coalesces rapid capability changes (e.g. dragging a slider) into one trailing device write
  _debounce(key, fn, ms) {
    if(!this._debounceTimers)
      this._debounceTimers = {};
    if(this._debounceTimers[key])
      clearTimeout(this._debounceTimers[key]);
    this._debounceTimers[key] = setTimeout(() => {
      this._debounceTimers[key] = null;
      fn();
    }, ms);
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

  // Audio player: source selection (FM Radio / AUX)
  async onCapabilityMediaInput( value, opts ) {
    await this.setCapabilityValue('media_input', value);
    somneoapi.putPlayerSettings(this.getStoreValue('address'), { "snddv": value }).then(player => {
      if(value === 'aux')
        this._set('speaker_track', '');
    }).catch(e => {
      this.log('Error on changing player source: '+e);
    });
  }

  // Audio player: volume (Homey 0..1 maps onto the device's 0-25 scale)
  async onCapabilityVolume( value, opts ) {
    await this.setCapabilityValue('volume_set', value);
    //Coalesce rapid slider changes into a single trailing device write
    this._debounce('player_volume', () => {
      var devVolume = Math.round(value * 25);
      somneoapi.putPlayerSettings(this.getStoreValue('address'), { "sdvol": devVolume }).then(player => {
        this.log(JSON.stringify(player))
      }).catch(e => {
        this.log('Error on changing player volume: '+e);
      });
    }, 400);
  }

  // Audio player: play/pause
  async onCapabilitySpeakerPlaying( value, opts ) {
    if(this.getCapabilityValue('media_input') === null) {
      await this.setWarning('First select the media input source').catch(() => {});
      await this.unsetWarning().catch(() => {});
      await this.setCapabilityValue('speaker_playing', false);
      return;
    }
    await this.setCapabilityValue('speaker_playing', value);
    somneoapi.putPlayerSettings(this.getStoreValue('address'), { "onoff": value }).then(player => {
      if(this.getCapabilityValue('media_input') === 'fmr' && player.sndch) {
        this._currentRadioChannel = parseInt(player.sndch);
        this._updateRadioTrack(player.sndch);
      }
    }).catch(e => {
      this.log('Error on toggling player: '+e);
    });
  }

  // Audio player: next FM preset (wraps 1-5)
  async onCapabilitySpeakerNext( value, opts ) {
    if(this.getCapabilityValue('media_input') !== 'fmr')
      return;
    this._currentRadioChannel = (this._currentRadioChannel >= 5) ? 1 : this._currentRadioChannel + 1;
    this._changeRadioChannel(this._currentRadioChannel);
  }

  // Audio player: previous FM preset (wraps 1-5)
  async onCapabilitySpeakerPrev( value, opts ) {
    if(this.getCapabilityValue('media_input') !== 'fmr')
      return;
    this._currentRadioChannel = (this._currentRadioChannel <= 1) ? 5 : this._currentRadioChannel - 1;
    this._changeRadioChannel(this._currentRadioChannel);
  }

  _changeRadioChannel(channel)
  {
    somneoapi.putPlayerSettings(this.getStoreValue('address'), { "sndch": String(channel) }).then(player => {
      this._updateRadioTrack(String(channel));
    }).catch(e => {
      this.log('Error on changing radio channel: '+e);
    });
  }

  //Shows the configured channel name and frequency on the track display
  _updateRadioTrack(channel)
  {
    var settings = this.getSettings();
    var name = settings['name_ch'+channel] || ('Channel '+channel);
    var freq = settings['frequency_ch'+channel];
    this._set('speaker_track', freq ? (name+' ('+freq+' FM)') : name);
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
    return somneoapi.getMainLightState(this.getStoreValue('address')).then(lightstatedata => {
      //this.log(JSON.stringify(lightstatedata))
      this._reportHealth(true);
      this._set('onoff', lightstatedata.onoff);
      this._set('dim', (lightstatedata.ltlvl/25));
      this._set('nightlight', lightstatedata.ngtlt);
      var prevSunrise = this.getCapabilityValue('sunrise_preview');
      this._set('sunrise_preview', lightstatedata.tempy);
      //Only fire on an actual change, not on the first poll after (re)start
      if(prevSunrise !== null && prevSunrise !== undefined && prevSunrise !== lightstatedata.tempy) {
        if(lightstatedata.tempy)
          this._sunriseOnTrigger.trigger(this).catch(e => { this.log('Error on firing sunrise_preview_true: '+e); });
        else
          this._sunriseOffTrigger.trigger(this).catch(e => { this.log('Error on firing sunrise_preview_false: '+e); });
      }
    }).catch(e => {
      this._reportHealth(false);
      this.log('Error on retrieving Light status: '+e);
    });
  }

  //Applies a mode state and fires its on/off triggers only on an actual change (shared by the
  //per-endpoint polls and the event stream, so either source updates state the same way)
  _setSunsetState(active)
  {
    var prev = this.getCapabilityValue('sunset');
    this._set('sunset', active);
    if(prev !== null && prev !== undefined && prev !== active) {
      if(active)
        this._sunsetOnTrigger.trigger(this).catch(e => { this.log('Error on firing sunset_true: '+e); });
      else
        this._sunsetOffTrigger.trigger(this).catch(e => { this.log('Error on firing sunset_false: '+e); });
    }
  }

  _setRelaxState(active)
  {
    var prev = this.getCapabilityValue('relax_breathe');
    this._set('relax_breathe', active);
    if(prev !== null && prev !== undefined && prev !== active) {
      if(active)
        this._relaxOnTrigger.trigger(this).catch(e => { this.log('Error on firing relax_breathe_true: '+e); });
      else
        this._relaxOffTrigger.trigger(this).catch(e => { this.log('Error on firing relax_breathe_false: '+e); });
    }
  }

  _setBedtimeState(active)
  {
    this._set('bedtime_tracking', active);
  }

  async updateSunsetState()
  {
    return somneoapi.getSunsetSettings(this.getStoreValue('address')).then(sunsetdata => {
      this._setSunsetState(sunsetdata.onoff);
    }).catch(e => {
      this.log('Error on retrieving Sunset status: '+e);
    });
  }

  async updateRelaxBreatheState()
  {
    return somneoapi.getRelaxBreatheSettings(this.getStoreValue('address')).then(relaxdata => {
      this._setRelaxState(relaxdata.onoff);
    }).catch(e => {
      this.log('Error on retrieving Relax breathe status: '+e);
    });
  }

  async updateBedtimeTracking()
  {
    return somneoapi.getBedtimeTracking(this.getStoreValue('address')).then(bedtimedata => {
      this._setBedtimeState(bedtimedata.night);
    }).catch(e => {
      this.log('Error on retrieving Sleep tracking status: '+e);
    });
  }

  //The player has no event support, so its state is read here (on connect and in the slow tier)
  async updatePlayerState()
  {
    return somneoapi.getPlayerSettings(this.getStoreValue('address')).then(player => {
      if(player.snddv === 'fmr' || player.snddv === 'aux')
        this._set('media_input', player.snddv);
      if(player.sdvol !== undefined && player.sdvol !== null)
        this._set('volume_set', player.sdvol / 25);
      this._set('speaker_playing', player.onoff);
      if(player.snddv === 'fmr' && player.sndch) {
        this._currentRadioChannel = parseInt(player.sndch);
        this._updateRadioTrack(player.sndch);
      }
    }).catch(e => {
      this.log('Error on retrieving player status: '+e);
    });
  }

  //Reads the device's FM presets into the settings so the UI reflects what is on the device
  async initRadioChannels()
  {
    somneoapi.getRadioFrequencies(this.getStoreValue('address')).then(freqs => {
      var s = {};
      for(var i = 1; i <= 5; i++) {
        if(freqs[String(i)] !== undefined)
          s['frequency_ch'+i] = parseFloat(freqs[String(i)]);
      }
      if(Object.keys(s).length > 0)
        this.setSettings(s).catch(e => { this.log('Error storing radio frequencies: '+e); });
    }).catch(e => {
      this.log('Error on retrieving radio frequencies: '+e);
    });
  }

  async updateEvents()
  {
    //Older Somneo devices do not expose the event endpoint, stop polling once we are sure
    if(this._eventsSupported === false)
      return;
    return somneoapi.getLastEvent(this.getStoreValue('address')).then(eventdata => {
      this._eventFailures = 0;
      var event = eventdata.event;
      //On the first poll we only store a baseline, so we do not fire on app/device restart
      if(this._lastEvent === undefined) {
        this._lastEvent = event;
        return;
      }
      if(event !== this._lastEvent) {
        this._lastEvent = event;
        this._handleEvent(event);
      }
    }).catch(e => {
      //When the whole device is unreachable, don't blame the event endpoint (that would
      //permanently disable alarm detection after a temporary outage). Only count failures
      //while the device is otherwise responding.
      if(this._consecutiveFailures > 0)
        return;
      this._eventFailures = (this._eventFailures || 0) + 1;
      this.log('Error on retrieving device events ('+this._eventFailures+'): '+e);
      if(this._eventFailures >= 3) {
        this._eventsSupported = false;
        this.log('Device does not support the event system, falling back to per-endpoint polling');
      }
    });
  }

  //The 'Active alarm' button: it turns true when an alarm goes off; tapping it to false (or
  //trying to set it true by hand) dismisses the running wake-up. You cannot arm an alarm here.
  async onCapabilityAlarmActive( value, opts ) {
    await this.setCapabilityValue('alarm_active', false);
    if(value === false)
      await this.dismissWakeup();
  }

  //Dismisses a running wake-up by turning off the light and the sound (shared with the flow action)
  async dismissWakeup() {
    var addr = this.getStoreValue('address');
    await somneoapi.putMainLightState(addr, false, 0, false, false);
    await somneoapi.putPlayerSettings(addr, { "onoff": false });
  }

  //Fires an alarm trigger card, tagging it with the alarm that most likely fired so flows can filter
  async _fireAlarmCard(card, label)
  {
    this.log(label);
    var tokens = { alarm_id: 0, alarm_time: '' };
    var state = { id: 0 };
    try {
      var fired = await this._guessFiredAlarm();
      if(fired) {
        tokens = { alarm_id: fired.id, alarm_time: this.driver._fmtTime(fired.hour, fired.minute) };
        state = { id: fired.id };
      }
    } catch(e) {
      this.log('Could not determine which alarm fired: '+e);
    }
    card.trigger(this, tokens, state).catch(e => { this.log('Error on firing alarm trigger: '+e); });
  }

  //The device does not report which alarm fired, so infer it: the enabled alarm scheduled for
  //today whose time is nearest now (the wake-up/sunrise starts shortly before the set time).
  async _guessFiredAlarm()
  {
    var alarms = await this.driver._buildAlarms(this.getStoreValue('address'));
    var now = new Date();
    var nowMin = now.getHours() * 60 + now.getMinutes();
    var jsDay = now.getDay();
    var best = null;
    var bestDiff = 1440;
    alarms.forEach(a => {
      if(!a.enabled) return;
      if(!this._alarmAppliesToday(a.days, jsDay)) return;
      var amin = a.hour * 60 + a.minute;
      var diff = Math.abs(amin - nowMin);
      if(diff > 720) diff = 1440 - diff;
      if(diff < bestDiff) { bestDiff = diff; best = a; }
    });
    return best;
  }

  _alarmAppliesToday(days, jsDay)
  {
    var anySet = days.mon || days.tue || days.wed || days.thu || days.fri || days.sat || days.sun;
    if(!anySet) return true; //one-time alarm
    var keys = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
    return !!days[keys[jsDay]];
  }

  //Translates a device event into a state change. While the event system works this replaces the
  //separate sunset/relax/bedtime polls; the slow tier only reconciles occasionally.
  _handleEvent(event)
  {
    switch(event) {
      //'startwakeup' is sent the moment an alarm starts the wake-up sequence
      case 'startwakeup':
        this._set('alarm_active', true);
        this._fireAlarmCard(this._alarmTriggeredCard, 'An alarm started the wake-up sequence');
        break;
      case 'endwakeup':
        this._set('alarm_active', false);
        this._fireAlarmCard(this._alarmEndedCard, 'An alarm wake-up sequence ended');
        break;
      //'endalarm' is sent when a sounding alarm is dismissed on the device
      case 'endalarm':
        this._set('alarm_active', false);
        break;
      case 'startdusk': this._setSunsetState(true); break;
      case 'enddusk': this._setSunsetState(false); break;
      case 'startrelax': this._setRelaxState(true); break;
      case 'endrelax': this._setRelaxState(false); break;
      case 'go2bed': this._setBedtimeState(true); break;
      case 'endbed': this._setBedtimeState(false); break;
    }
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
    if(changedKeys.some(k => k.indexOf('frequency_ch') === 0)) {
      await somneoapi.putRadioFrequencies(this.getStoreValue('address'), {
        "1": String(newSettings.frequency_ch1),
        "2": String(newSettings.frequency_ch2),
        "3": String(newSettings.frequency_ch3),
        "4": String(newSettings.frequency_ch4),
        "5": String(newSettings.frequency_ch5)
      }).catch(e => {
        this.log('Error on updating radio frequencies: '+e);
      });
    }
    if(changedKeys.includes('polling_interval')) {
      this._pollConfiguredInterval = this._num(newSettings.polling_interval, 15) * 1000;
      this._pollBaseInterval = this._pollConfiguredInterval;
    }
    if(changedKeys.includes('polling_enabled')) {
      if(newSettings.polling_enabled && !this._polling)
        this.start_update_loops(newSettings);
      else if(!newSettings.polling_enabled && this._polling) {
        this._polling = false;
        if(this._pollTimeout) clearTimeout(this._pollTimeout);
        this.log('Polling stopped by settings change');
      }
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
    this._deleted = true;
    this._polling = false;
    if(this._pollTimeout) clearTimeout(this._pollTimeout);
    if(this._debounceTimers) {
      for(var k in this._debounceTimers) {
        if(this._debounceTimers[k]) clearTimeout(this._debounceTimers[k]);
      }
    }
  }

  onDiscoveryResult(discoveryResult) {
    return discoveryResult.id === this.getData().id;
  }

  async onDiscoveryAvailable(discoveryResult) {
    this.log('Located device and ready to retrieve data...');
    this.log('Device: '+this.getName()+' was located with address '+discoveryResult.address);
    this.setStoreValue('address',discoveryResult.address);
    this.applyDisplaySettings();
    this.initRadioChannels();
    this.updatePlayerState();
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
