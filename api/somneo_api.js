'use strict'
const http = require('http.min');

//We are keeping it simple
async function getResponseData(address,path)
{
  var options = {
    protocol: 'https:',
    host: address,
    path: '/di/v1/products/1/'+path,
    headers: {
      'content-type': 'application/json'
    }
  }
  console.info('Getting data from wakeup light')
  return new Promise((resolve, reject) => {(
    http.get(options)).then(res => {
      resolve(JSON.parse(res.data));
    }).catch(e => {reject(e)});
  });
}

async function putResponseData(address,path,body)
{
  var options = {
    protocol: 'https:',
    host: address,
    path: '/di/v1/products/1/'+path,
    headers: {
      'content-type': 'application/json'
    }
  }
  console.log(body)
  console.info('Sending data to wakeup light')
  return new Promise((resolve, reject) => {(
    http.put(options, body)).then(res => {
      resolve(JSON.parse(res.data));
    }).catch(e => {reject(e)});
  });
}

async function getSensors(address)
{
    console.info('Retrieving Sensor data')
    return new Promise((resolve, reject) => {(
      getResponseData(address,'wusrd')).then(data => {
        resolve(data);
      }).catch(e => {reject(e)});
    });
}

async function getMainLightState(address)
{
  console.info('Retrieving Main Light data')
  return new Promise((resolve, reject) => {(
    getResponseData(address,'wulgt')).then(data => {
      resolve(data);
    }).catch(e => {reject(e)});
  });  
}
async function putMainLightState(address,mainlight,dim,sunrise,nightlight)
{
  console.info('Updating Main Light data')
  var otherlights
  let body = {
    "ltlvl": parseInt(dim), //light level
    "onoff": mainlight, //On off
    "tempy": sunrise, //sunrise
    "ngtlt": nightlight //night light
  };
  return new Promise((resolve, reject) => {(
    putResponseData(address,'wulgt', body)).then(data => {
      resolve(data);
    }).catch(e => {reject(e)});
  });  
}

async function getTimersState(address)
{
  console.info('Retrieving Timers data')
  return new Promise((resolve, reject) => {(
    getResponseData(address,'wutmr')).then(data => {
      resolve(data);
    }).catch(e => {reject(e)});
  });  
}

async function getAlarmState(address)
{
  console.info('Retrieving Alarm data')
  return new Promise((resolve, reject) => {(
    getResponseData(address,'wualm/aenvs')).then(data => {
      resolve(data);
    }).catch(e => {reject(e)});
  });  
}

async function getAlarmSchedules(address)
{
  console.info('Retrieving Alarm schedules')
  return new Promise((resolve, reject) => {(
    getResponseData(address,'wualm/aalms')).then(data => {
      resolve(data);
    }).catch(e => {reject(e)});
  });
}

async function getRelaxBreatheSettings(address)
{
  console.info('Retrieving Relax breathe settings')
  return new Promise((resolve, reject) => {(
    getResponseData(address,'wurlx')).then(data => {
      resolve(data);
    }).catch(e => {reject(e)});
  });
}

async function putRelaxBreatheSettings(address,body)
{
  console.info('Updating Relax breathe settings')
  return new Promise((resolve, reject) => {(
    putResponseData(address,'wurlx', body)).then(data => {
      resolve(data);
    }).catch(e => {reject(e)});
  });
}

async function putSunrisePreview(address,enabled,colorScheme)
{
  console.info('Updating Sunrise preview data')
  let body = {
    "onoff": enabled, //turns the light on to show the preview
    "tempy": enabled, //sunrise preview flag
    "ctype": parseInt(colorScheme), //sunrise color scheme
    "ngtlt": false //make sure the night light is off
  };
  return new Promise((resolve, reject) => {(
    putResponseData(address,'wulgt', body)).then(data => {
      resolve(data);
    }).catch(e => {reject(e)});
  });
}

async function getSunsetSettings(address)
{
  console.info('Retrieving Sunset settings')
  return new Promise((resolve, reject) => {(
    getResponseData(address,'wudsk')).then(data => {
      resolve(data);
    }).catch(e => {reject(e)});
  });
}

async function putSunsetSettings(address,body)
{
  console.info('Updating Sunset settings')
  return new Promise((resolve, reject) => {(
    putResponseData(address,'wudsk', body)).then(data => {
      resolve(data);
    }).catch(e => {reject(e)});
  });
}

async function getBedtimeTracking(address)
{
  console.info('Retrieving Sleep tracking data')
  return new Promise((resolve, reject) => {(
    getResponseData(address,'wungt')).then(data => {
      resolve(data);
    }).catch(e => {reject(e)});
  });
}

async function putBedtimeTracking(address,enabled)
{
  console.info('Updating Sleep tracking data')
  let body = {
    "night": enabled //sleep/bedtime tracking on off
  };
  return new Promise((resolve, reject) => {(
    putResponseData(address,'wungt', body)).then(data => {
      resolve(data);
    }).catch(e => {reject(e)});
  });
}

async function getLastEvent(address)
{
  console.info('Retrieving last device event')
  return new Promise((resolve, reject) => {(
    getResponseData(address,'dataupload/event.1/data')).then(data => {
      resolve(data);
    }).catch(e => {reject(e)});
  });
}

module.exports.putMainLightState = putMainLightState;
module.exports.getRelaxBreatheSettings = getRelaxBreatheSettings;
module.exports.putRelaxBreatheSettings = putRelaxBreatheSettings;
module.exports.putSunrisePreview = putSunrisePreview;
module.exports.getSunsetSettings = getSunsetSettings;
module.exports.putSunsetSettings = putSunsetSettings;
module.exports.getBedtimeTracking = getBedtimeTracking;
module.exports.putBedtimeTracking = putBedtimeTracking;
module.exports.getLastEvent = getLastEvent;
module.exports.getAlarmSchedules = getAlarmSchedules;
module.exports.getAlarmState = getAlarmState;
module.exports.getTimersState = getTimersState;
module.exports.getSensors = getSensors;
module.exports.getMainLightState = getMainLightState;