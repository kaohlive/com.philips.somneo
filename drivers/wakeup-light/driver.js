'use strict';

const { Driver } = require('homey');
const somneoapi = require('../../api/somneo_api');

class WakeupLightDriver extends Driver {

  /**
   * onInit is called when the driver is initialized.
   */
  async onInit() {
    this.log('Wakeup-light driver has been initialized');
    this._registerFlowCards();
  }

  //Flow cards are registered on the driver (not per device) and scoped with args.device,
  //so they always act on the device chosen in the flow. The alarm argument is an autocomplete
  //populated live from the device, all via the rate-limited somneo api.
  _registerFlowCards() {
    const auto = (query, args) => this._alarmAutocomplete(query, args);

    const filterMatch = (args, state) => {
      //No specific alarm chosen (or "any") -> fire for every alarm
      if(!args.alarm || args.alarm.id === undefined || args.alarm.id === 'any')
        return true;
      return Number(args.alarm.id) === Number(state.id);
    };

    const triggered = this.homey.flow.getDeviceTriggerCard('alarm_triggered');
    triggered.registerRunListener(async (args, state) => filterMatch(args, state));
    triggered.registerArgumentAutocompleteListener('alarm', (query, args) => this._alarmAutocomplete(query, args, true));

    const ended = this.homey.flow.getDeviceTriggerCard('alarm_ended');
    ended.registerRunListener(async (args, state) => filterMatch(args, state));
    ended.registerArgumentAutocompleteListener('alarm', (query, args) => this._alarmAutocomplete(query, args, true));

    const condition = this.homey.flow.getConditionCard('alarm_enabled');
    condition.registerRunListener(async (args) => {
      const alarms = await this._buildAlarms(args.device.getStoreValue('address'));
      const match = alarms.find((a) => Number(a.id) === Number(args.alarm.id));
      return !!(match && match.enabled);
    });
    condition.registerArgumentAutocompleteListener('alarm', auto);

    const anyAlarm = this.homey.flow.getConditionCard('any_alarm_enabled');
    anyAlarm.registerRunListener(async (args) => {
      const alarms = await this._buildAlarms(args.device.getStoreValue('address'));
      return alarms.some((a) => a.enabled);
    });

    //Mode conditions read the cached capability value, so they add no device traffic
    const modeCondition = this.homey.flow.getConditionCard('mode_enabled');
    modeCondition.registerRunListener(async (args) => !!args.device.getCapabilityValue(args.mode));

    const action = this.homey.flow.getActionCard('set_alarm_enabled');
    action.registerRunListener(async (args) => {
      await somneoapi.putAlarm(args.device.getStoreValue('address'), {
        prfnr: Number(args.alarm.id),
        prfen: args.state === 'true',
      });
    });
    action.registerArgumentAutocompleteListener('alarm', auto);

    const stop = this.homey.flow.getActionCard('stop_wakeup');
    stop.registerRunListener(async (args) => args.device.dismissWakeup());
  }

  //Returns alarm options for an autocomplete argument; includeAny prepends an "Any alarm" entry
  async _alarmAutocomplete(query, args, includeAny) {
    const results = [];
    if(includeAny)
      results.push({ id: 'any', name: 'Any alarm' });
    try {
      const alarms = await this._buildAlarms(args.device.getStoreValue('address'));
      alarms.forEach((a) => {
        results.push({
          id: String(a.id),
          name: this._fmtTime(a.hour, a.minute) + '  ·  ' + this._daysLabel(a.days) + (a.enabled ? '' : '  (off)'),
        });
      });
    } catch(e) {
      this.log('Alarm autocomplete failed: '+e);
    }
    if(query) {
      const q = query.toLowerCase();
      return results.filter((r) => r.name.toLowerCase().indexOf(q) !== -1);
    }
    return results;
  }

  /**
   * onPairListDevices is called when a user is adding a device
   * and the 'list_devices' view is called.
   * This should return an array with the data of devices that are available for pairing.
   */
  async onPairListDevices() {
    this.log('Wakeup-light device discovery started...');
    const discoveryStrategy = this.getDiscoveryStrategy();
    const discoveryResults = discoveryStrategy.getDiscoveryResults();
    
    const devices = Object.values(discoveryResults).map(discoveryResult => {
      this.log(JSON.stringify(discoveryResult.headers.location));
      this.log(JSON.stringify(discoveryResult));
      return {
        name: 'Wake-up light',
        data: {
          location: discoveryResult.headers.location,
          address: discoveryResult.address,
          id: discoveryResult.id
        },
      };
    });
    return devices;
  }

  /**
   * onRepair backs the alarm configuration page (drivers/wakeup-light/repair/alarms.html).
   * Every device call goes through the somneo api, so it shares the same per-host request
   * queue (single in-flight, spaced, timed out) used by the device polling.
   */
  async onRepair(session, device) {
    this.log('Alarm configuration session started for '+device.getName());

    const address = () => {
      const addr = device.getStoreValue('address');
      if(!addr)
        throw new Error('Device has no known address yet. Make sure it is online and try again.');
      return addr;
    };

    session.setHandler('get-alarms', async () => {
      const alarms = await this._buildAlarms(address());
      return { alarms, freeSlots: 16 - alarms.length };
    });

    session.setHandler('save-alarm', async (alarm) => {
      const addr = address();
      let id = alarm.id;
      if(!id) {
        const states = await somneoapi.getAlarmState(addr);
        const free = states.prfvs.findIndex((used) => !used);
        if(free === -1)
          throw new Error('All 16 alarm slots are in use. Delete one first.');
        id = free + 1;
      }
      const pw = this._powerWakeTime(alarm.hour, alarm.minute);
      await somneoapi.putAlarm(addr, {
        prfnr: id,
        prfen: alarm.enabled !== false,
        prfvs: true,
        almhr: alarm.hour,
        almmn: alarm.minute,
        daynm: this._maskFromDays(alarm.days),
        pwrsz: alarm.powerWake ? 255 : 0,
        pszhr: pw.hour,
        pszmn: pw.minute,
      });
      return { ok: true, id };
    });

    session.setHandler('toggle-alarm', async (alarm) => {
      await somneoapi.putAlarm(address(), { prfnr: alarm.id, prfen: !!alarm.enabled });
      return { ok: true };
    });

    session.setHandler('delete-alarm', async (alarm) => {
      await somneoapi.putAlarm(address(), { prfnr: alarm.id, prfvs: false });
      return { ok: true };
    });
  }

  //Reads the used alarms from the device (shared by the repair UI and the flow autocompletes)
  async _buildAlarms(address) {
    if(!address)
      throw new Error('Device has no known address yet. Make sure it is online and try again.');
    const states = await somneoapi.getAlarmState(address);      // { prfen[], prfvs[], pwrsv[] }
    const schedules = await somneoapi.getAlarmSchedules(address); // { almhr[], almmn[], daynm[] }
    const alarms = [];
    for(let i = 0; i < 16; i++) {
      if(!states.prfvs[i]) continue;
      alarms.push({
        id: i + 1,
        enabled: !!states.prfen[i],
        hour: schedules.almhr[i],
        minute: schedules.almmn[i],
        days: this._daysFromMask(schedules.daynm[i]),
        powerWake: states.pwrsv[i * 3] === 255,
      });
    }
    return alarms;
  }

  _fmtTime(hour, minute) {
    return (hour < 10 ? '0' : '') + hour + ':' + (minute < 10 ? '0' : '') + minute;
  }

  _daysLabel(days) {
    const keys = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
    const labels = { mon: 'Mo', tue: 'Tu', wed: 'We', thu: 'Th', fri: 'Fr', sat: 'Sa', sun: 'Su' };
    const on = keys.filter((k) => days[k]);
    if(on.length === 0) return 'Once';
    if(on.length === 7) return 'Daily';
    return on.map((k) => labels[k]).join(' ');
  }

  _daysFromMask(mask) {
    mask = mask || 0;
    return {
      mon: (mask & 2) !== 0,
      tue: (mask & 4) !== 0,
      wed: (mask & 8) !== 0,
      thu: (mask & 16) !== 0,
      fri: (mask & 32) !== 0,
      sat: (mask & 64) !== 0,
      sun: (mask & 128) !== 0,
    };
  }

  _maskFromDays(d) {
    d = d || {};
    return (d.mon ? 2 : 0) | (d.tue ? 4 : 0) | (d.wed ? 8 : 0) | (d.thu ? 16 : 0)
      | (d.fri ? 32 : 0) | (d.sat ? 64 : 0) | (d.sun ? 128 : 0);
  }

  //PowerWake is a second, louder wake-up; default it to 9 minutes after the alarm
  _powerWakeTime(hour, minute) {
    let m = minute + 9;
    let h = hour;
    if(m >= 60) { m -= 60; h = (h + 1) % 24; }
    return { hour: h, minute: m };
  }
}

module.exports = WakeupLightDriver;
