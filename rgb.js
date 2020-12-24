const { Control, CustomMode } = require('magic-home');
const axios = require('axios');
const chalk = require('chalk');

// RGB Strip initialisation. Auto locate functionality seems to break sometimes,
// noticed this with Python library I tried previously, presume it is a hardware
// issue so hardcoding values here after setting a static IP for my lights on router

let strip_ip = '10.0.0.21';
let strip_control = new Control(strip_ip, {
  log_all_received: true,
  ack: { power: true, color: false, pattern: false, custom_pattern: false },
});
let elgato = 'http://10.0.0.19:9123';

// RGB sometimes returns a short result which causes problems later
// this function is used as a callback to delay part of that query to make
// sure the strip has time to return the full result
const sleeper = function (ms) {
  const promise = new Promise((resolve, reject) => {
    setTimeout(() => {
      resolve();
    }, ms);
  });
  return promise;
};

// Class for Elgato Keylight
class Elgato {
  constructor() {}
  trigger(command) {
    if (command == 'light_on') {
      keylight.light_on();
    }
    if (command == 'light_off') {
      keylight.light_off();
    }
  }

  // Check light configuration, firmware rev. etc.
  light_check() {
    return axios
      .get(`${elgato}/elgato/accessory-info`)
      .then((result) => {
        return result.data;
      })
      .catch(function (error) {
        console.log(error);
        return error;
      });
  }

  // Check current light settings
  light_settings() {
    return axios
      .get(`${elgato}/elgato/lights/settings`)
      .then((result) => {
        return result.data;
      })
      .catch(function (error) {
        console.log(error);
        return error;
      });
  }

  // Check current light options
  light_options() {
    return axios
      .get(`${elgato}/elgato/lights`)
      .then((result) => {
        return result.data;
      })
      .catch(function (error) {
        return error;
      });
  }

  // Reset light to my preferred default settings
  light_reset() {
    const options = {
      powerOnBehavior: 1,
      powerOnBrightness: 20,
      powerOnTemperature: 213,
      switchOnDurationMs: 300,
      switchOffDurationMs: 300,
      colorChangeDurationMs: 100,
    };
    axios
      .put(`${elgato}/elgato/lights/settings`, options)
      .then(function (response) {
        console.log(chalk.blue(`<Keylight> @${elgato}: defaults applied`));
        return response;
      })
      .catch(function (error) {
        console.log(error);
        return error;
      });
  }

  // Set keylight options as per payload (data)
  light_set(data) {
    console.log(
      chalk.green(`<Keylight> @:${elgato}: set to: `) +
        `${JSON.stringify(data)}`
    );
    axios.put(`${elgato}/elgato/lights`, data).catch(function (error) {
      console.log(error);
      return error;
    });
  }

  // Set keylight to ON
  light_on() {
    console.log(chalk.green(`<Keylight> @:${elgato}: set to ON`));
    axios
      .put(`${elgato}/elgato/lights`, {
        numberOfLights: 1,
        lights: [{ on: 1 }],
      })
      .catch(function (error) {
        console.log(error);
        return error;
      });
  }

  // Set keylight to OFF
  light_off() {
    console.log(chalk.green(`<Keylight> @:${elgato}: set to OFF`));
    axios
      .put(`${elgato}/elgato/lights`, {
        numberOfLights: 1,
        lights: [{ on: 0 }],
      })
      .catch(function (error) {
        console.log(error);
        return error;
      });
  }

  // Set keylight brightness as per payload (value)
  light_bright(value) {
    console.log(
      chalk.green(`<Keylight> @:${elgato}: brightness set to ${value}`)
    );
    axios
      .put(`${elgato}/elgato/lights`, {
        numberOfLights: 1,
        lights: [{ brightness: value }],
      })
      .catch(function (error) {
        console.log(error);
        return error;
      });
  }

  // Set keylight temperature as per payload (value)
  light_temp(value) {
    console.log(
      chalk.green(`<Keylight> @:${elgato}: temperature set to ${value}`)
    );
    axios
      .put(`${elgato}/elgato/lights`, {
        numberOfLights: 1,
        lights: [{ temperature: value }],
      })
      .catch(function (error) {
        console.log(error);
        return error;
      });
  }
}

// Custom pattern for RGB strip - Slow orange fade
let sloworange_pat = new CustomMode();
sloworange_pat
  .addColor(255, 35, 0)
  .addColor(128, 16, 0)
  .setTransitionType('fade');

// Custom pattern for RGB strip - Slow purple fade
let slowpurple_pat = new CustomMode();
slowpurple_pat
  .addColor(255, 0, 255)
  .addColor(128, 0, 72)
  .setTransitionType('fade');

// Custom pattern for RGB strip - White strobe
let whitestrobe_pat = new CustomMode();
whitestrobe_pat.addColor(255, 255, 255).setTransitionType('strobe');

// Custom pattern for RGB strip - Purple strobe
let purplestrobe_pat = new CustomMode();
purplestrobe_pat.addColor(255, 0, 255).setTransitionType('strobe');

// Custom pattern for RGB strip - Green strobe
let greenstrobe_pat = new CustomMode();
greenstrobe_pat.addColor(0, 255, 0).setTransitionType('strobe');

let orangestrobe_pat = new CustomMode();
orangestrobe_pat.addColor(255, 35, 0).setTransitionType('strobe');

let bluestrobe_pat = new CustomMode();
bluestrobe_pat.addColor(0, 0, 255).setTransitionType('strobe');

// Custom pattern for RGB strip - Slow orange/purple crossfade
let opfade_pat = new CustomMode();
opfade_pat.addColor(255, 35, 0).addColor(255, 0, 255).setTransitionType('fade');

// Custom pattern for RGB strip - Slow green/blue crossfade
let gbfade_pat = new CustomMode();
gbfade_pat.addColor(0, 255, 75).addColor(0, 75, 255).setTransitionType('fade');

// Class for RGB strip
class Rgbstrip {
  constructor() {}
  // Trigger allows a single command to be sent to this function which will then trigger more complex actions by calling other functions
  trigger(command) {
    if (command === 'setoff') {
      rgbstrip.setoff();
    }
    if (command === 'seton') {
      rgbstrip.seton();
    }
    if (command === '!red' || command === 'red') {
      const value = [255, 0, 0, 255];
      rgbstrip.setcolour(command, value);
    }
    if (command === '!green' || command === 'green') {
      const value = [0, 255, 0, 255];
      rgbstrip.setcolour(command, value);
    }
    if (command === '!blue' || command === 'blue') {
      const value = [0, 0, 255, 255];
      rgbstrip.setcolour(command, value);
    }
    if (command === '!orange' || command === 'orange') {
      const value = [255, 35, 0, 255];
      rgbstrip.setcolour(command, value);
    }
    if (command === '!cyan' || command === 'cyan') {
      const value = [0, 255, 255, 255];
      rgbstrip.setcolour(command, value);
    }
    if (command === '!purple' || command === 'purple') {
      const value = [255, 0, 255, 255];
      rgbstrip.setcolour(command, value);
    }
    if (command === '!white' || command === 'white') {
      const value = [255, 255, 255, 255];
      rgbstrip.setcolour(command, value);
    }
    if (command === '!disco') {
      rgbstrip.strobe('white');
    }
    if (command === 'purplestrobe') {
      rgbstrip.strobe('purple');
    }
    if (command === 'greenstrobe') {
      rgbstrip.strobe('green');
    }
    if (command === 'sloworange') {
      const value = [sloworange_pat, 50];
      rgbstrip.fade(command, value);
    }
    if (command === 'slowpurple') {
      const value = [slowpurple_pat, 50];
      rgbstrip.fade(command, value);
    }
    if (command === '!synthwave' || command === 'synthwave') {
      const value = [opfade_pat, 70];
      rgbstrip.fade(command, value);
    }
    if (command === '!aquatic' || command === 'aquatic') {
      const value = [gbfade_pat, 70];
      rgbstrip.fade(command, value);
    }
  }
  // Set RGB strip to ON
  seton() {
    strip_control.turnOn().catch((err) => console.log('error: ' + err.message));
    console.log(chalk.whiteBright(`<RGB Strip> @:${strip_ip}: set to ON`));
  }

  // Set RGB strip to OFF
  setoff() {
    strip_control
      .turnOff()
      .catch((err) => console.log('error: ' + err.message));
    console.log(chalk.whiteBright(`<RGB Strip> @:${strip_ip}: set to OFF`));
  }

  report(command) {
    console.log(
      chalk.white(`<RGB Strip> @:${strip_ip}: ${command} command triggered`)
    );
  }

  // Set RGB strip colour, takes command name and array with values
  setcolour(command, value) {
    strip_control
      .setColorWithBrightness(value[0], value[1], value[2], value[3])
      .then(() => {
        this.report(chalk.white(command));
      })
      .catch(function (error) {
        console.log(error);
        return error;
      });
  }

  // RGB strobe function, takes colour value, orange and blue added for RL tournies
  async strobe(colour, secondary) {
    let pattern = null;
    if (colour == 'white') {
      pattern = whitestrobe_pat;
    }
    if (colour == 'orange' || colour == 1) {
      pattern = orangestrobe_pat;
    }
    if (colour == 'blue' || colour == 0) {
      pattern = bluestrobe_pat;
    }
    if (colour == 'purple') {
      pattern = purplestrobe_pat;
    }
    keylight.light_off(),
      strip_control
        .turnOff()
        .then(() => sleeper(100))
        .then(() => {
          strip_control
            .setCustomPattern(pattern, 100)
            .then(() => sleeper(3000))
            .then(() => {
              console.log(
                chalk.whiteBright(
                  `<RGB Strip> @:${strip_ip}: ${colour} strobe effect triggered`
                )
              );
              rgbstrip.trigger(secondary);
              keylight.light_on();
            });
        })
        .catch((err) => {
          console.log(err);
        });
  }

  // RGB strip function for demo during RL match
  demo(currentcolour) {
    keylight.light_off();
    rgbstrip.trigger('red');

    setTimeout(() => {
      rgbstrip.trigger(currentcolour);
      keylight.light_on();
    }, 1000);
  }

  // RGB strip function for fade patterns, takes command name and array of values
  fade(command, value) {
    strip_control
      .setCustomPattern(value[0], value[1])
      .then(() => {
        this.report(chalk.white(command));
      })
      .catch(function (error) {
        console.log(error);
        return error;
      });
  }
}

// Instantiate new keylight
let keylight = new Elgato();

// Instantiate new strip
let rgbstrip = new Rgbstrip();

module.exports = {
  keylight: keylight,
  rgbstrip: rgbstrip,
};
