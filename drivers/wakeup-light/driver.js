'use strict';

const { Driver } = require('homey');
const somneoapi = require('../../api/somneo_api');

class WakeupLightDriver extends Driver {

  /**
   * onInit is called when the driver is initialized.
   */
  async onInit() {
    this.log('Wakeup-light driver has been initialized');
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
      const addr = address();
      const states = await somneoapi.getAlarmState(addr);      // { prfen[], prfvs[], pwrsv[] }
      const schedules = await somneoapi.getAlarmSchedules(addr); // { almhr[], almmn[], daynm[] }
      const alarms = [];
      let freeSlots = 0;
      for(let i = 0; i < 16; i++) {
        if(!states.prfvs[i]) { freeSlots++; continue; }
        alarms.push({
          id: i + 1,
          enabled: !!states.prfen[i],
          hour: schedules.almhr[i],
          minute: schedules.almmn[i],
          days: this._daysFromMask(schedules.daynm[i]),
          powerWake: states.pwrsv[i * 3] === 255,
        });
      }
      return { alarms, freeSlots };
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
