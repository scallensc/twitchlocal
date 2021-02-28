require('dotenv').config();
const express = require('express');
const app = require('express')();
const http = require('http').createServer(app);
const lights = require('./rgb');
const ngrok = require('ngrok');
const volleyball = require('volleyball');
const chalk = require('chalk');
const ora = require('ora');
const axios = require('axios');
const WebSocket = require('ws');

const AUTH_TOKEN = process.env.AUTH_TOKEN;
const port = 5000;

// Init server
const server = http.listen(port, () => {
  console.log(
    chalk.green(
      `Server listening at ` +
        chalk.whiteBright(`http://localhost:` + port + ' ✓ ') +
        chalk.green(`NGROK tunnel `) +
        chalk.whiteBright(`https://${process.env.NGROK_SUBD}.ngrok.io ✓`)
    )
  );
  console.log(chalk.greenBright(`Ready...`));
});

// Socket IO client
const io_client = require('socket.io-client');

// Init socket.io, pass server for connection
const io = require('socket.io')(server);

const { setTimeout } = require('timers');

// Timestamp console logs
require('console-stamp')(console, { pattern: 'dd/mm/yyyy HH:MM:ss' });

// Open NGROK tunnelling
(async function () {
  console.log(chalk.greenBright('NGROK tunneling requested.'));
  const url = await ngrok
    .connect({
      proto: 'http',
      addr: 5000,
      subdomain: process.env.NGROK_SUBD,
      authtoken: process.env.NGROK_KEY,
    })
    .catch((error) => {
      console.error(chalk.red(`NGROK Failed!`));
      console.error(chalk.red(error));
      console.error(error.details);
      process.exit();
    });
})();

/* RGB sometimes returns a short result which causes problems later
this function is used as a callback to delay part of that query to make
sure the strip has time to return the full result */
const sleeper = function (ms) {
  const promise = new Promise((resolve, reject) => {
    setTimeout(() => {
      resolve();
    }, ms);
  });
  return promise;
};

// Nonce generator
function nonce(length) {
  let text = '';
  const possible =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < length; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}

// Websocket ping -> Twitch
let ws;
function heartbeat() {
  message = {
    type: 'PING',
  };
  console.log(`WS. SENT: -> ${chalk.magenta('TWITCH')}: ${message.type}`);
  ws.send(JSON.stringify(message));
}

// Websocket listener -> Twitch
function listen(topic) {
  message = {
    type: 'LISTEN',
    nonce: nonce(15),
    data: {
      topics: topic,
      auth_token: process.env.PUBSUB_AUTH_TOKEN,
    },
  };
  console.log(
    `WS. SENT: -> ${chalk.magenta('TWITCH')}: listening to: ${topic}`
  );
  ws.send(JSON.stringify(message));
}

// Websocket connector -> Twitch
async function connect() {
  const heartbeatInterval = 1000 * 60; //ms between PING's
  const reconnectInterval = 1000 * 3; //ms to wait before reconnect
  let heartbeatHandle;

  ws = new WebSocket('wss://pubsub-edge.twitch.tv');

  // On socket open to Twitch, run heartbeat function to respond to PING messages
  ws.onopen = function (event) {
    console.log(
      chalk.green('WS. INFO: Socket Opened -> ') + chalk.magenta('TWITCH')
    );
    heartbeat();
    heartbeatHandle = setInterval(heartbeat, heartbeatInterval);
  };

  // Log errors to console
  ws.onerror = function (error) {
    console.log('WS. ERR:  ' + JSON.stringify(error));
  };

  // Logic for received WS messages
  ws.onmessage = function (event) {
    console.log(`WS. RECV: <- ${chalk.magenta('TWITCH')}: ${event.data}`);
    message = JSON.parse(event.data);
    if (message.type == 'MESSAGE') {
      console.log(message.data.topic);
      const response = JSON.parse(message.data.message);
      console.log(response.data);
    }

    // On WS message from bits events, fire purple strobe effect
    if (
      message.type == 'MESSAGE' &&
      message.data.topic ==
        `channel-bits-events-v1.${process.env.TWITCH_CHANNEL_ID}`
    ) {
      console.log(chalk.magenta('triggering purple strobe for bits event'));
      axios.get(`${process.env.NGROK_LOCAL}/newfollow`, {
        headers: {
          Authorization: process.env.AUTH_TOKEN,
        },
      });
    }

    // On WS message from sub events, fire purple strobe effect
    if (
      message.type == 'MESSAGE' &&
      message.data.topic ==
        `channel-subscribe-events-v1.${process.env.TWITCH_CHANNEL_ID}`
    ) {
      console.log(
        chalk.magenta('triggering purple strobe for subscription event')
      );
      axios.get(`${process.env.NGROK_LOCAL}/newfollow`, {
        headers: {
          Authorization: process.env.AUTH_TOKEN,
        },
      });
    }

    // On WS message from channel point redemption for light changes, trigger light change function and pass value
    if (
      message.type == 'MESSAGE' &&
      message.data.topic ==
        `channel-points-channel-v1.${process.env.TWITCH_CHANNEL_ID}`
    ) {
      const response = JSON.parse(message.data.message);
      if (response.data.redemption.user_input) {
        const options = [
          'white',
          'red',
          'green',
          'blue',
          'cyan',
          'orange',
          'purple',
          'aquatic',
          'synthwave',
        ];
        const value = response.data.redemption.user_input.toLowerCase();
        if (options.includes(value)) {
          console.log(`User redeemed "Change my lights", chose :${value}`);
          streamcolour = value;
          lights.rgbstrip.trigger(value);
        } else {
          console.error(
            'Light redemption: ' +
              chalk.redBright('invalid colour choice entered.')
          );
        }
      }
    }

    // Reconnect function
    if (message.type == 'RECONNECT') {
      console.log('WS. INFO: Reconnecting...');
      setTimeout(connect, reconnectInterval);
    }
  };

  // Kill interval timer for heartbeat PING handler on disconnect
  ws.onclose = function () {
    console.log('WS. INFO: Socket Closed');
    clearInterval(heartbeatHandle);
    console.log('WS. INFO: Reconnecting...');
    setTimeout(connect, reconnectInterval);
  };
}

// Function to trigger WS connector and listen functions, with timeout to ensure listen establishes after socket opened
// Pass topics for listener -> Twitch
function twitch() {
  connect();
  setTimeout(function () {
    listen([
      `channel-points-channel-v1.${process.env.TWITCH_CHANNEL_ID}`,
      `channel-bits-events-v1.${process.env.TWITCH_CHANNEL_ID}`,
      `channel-subscribe-events-v1.${process.env.TWITCH_CHANNEL_ID}`,
    ]);
  }, 3000);
}

// Connect to StreamElements via WS
async function streamelements() {
  let JWT = process.env.STREAMELEMENTS_TOKEN;
  const sesocket = io_client('https://realtime.streamelements.com', {
    transports: ['websocket'],
  });
  // Socket connected
  sesocket.on('connect', onConnect);

  // Socket got disconnected
  sesocket.on('disconnect', onDisconnect);

  // Socket is authenticated
  sesocket.on('authenticated', onAuthenticated);

  /* This is for SE 'TEST' events through overlay dashboard for testing certain events (sub/donate, etc). 
  tested using donation/tip system, seems like a different object structure comes through for
  an actual real, live donation though, might be similar with other functions. */
  sesocket.on('event:test', (data) => {
    if (data.listener == 'tip-points') {
      console.log(data.event);
      let payload;
      switch (data.event.message.toLowerCase()) {
        case '1':
        case '1st':
        case 'first':
          payload = {
            type: 'donation',
            data: {
              from: data.event.name,
              place: 'first',
              amount: parseFloat(data.event.amount).toFixed(2),
            },
          };
          sendIt(payload);
          break;
        case '2':
        case '2nd':
        case 'second':
          payload = {
            type: 'donation',
            data: {
              from: data.event.name,
              place: 'second',
              amount: parseFloat(data.event.amount).toFixed(2),
            },
          };
          sendIt(payload);
          break;
        case '3':
        case '3rd':
        case 'third':
          payload = {
            type: 'donation',
            data: {
              from: data.event.name,
              place: 'third',
              amount: parseFloat(data.event.amount).toFixed(2),
            },
          };
          sendIt(payload);
          break;
        default:
          console.log(data.event);
      }
      async function sendIt(payload) {
        rlsocket.emit('payload', payload);
        let remote = await axios.get(
          `${process.env.TWITCH_CALLBACK}/prizepool`,
          {
            headers: { Authorization: process.env.AUTH_TOKEN },
          }
        );
        newstate = {
          ...remote.data,
          [payload.data.place]: (parseFloat(remote.data[payload.data.place]) + parseFloat(payload.data.amount)).toFixed(2) /* prettier-ignore */,
        };
        console.log(newstate);
        const reply = await axios.post(
          `${process.env.TWITCH_CALLBACK}/prizepool`,
          newstate,
          {
            headers: {
              Authorization: process.env.AUTH_TOKEN,
            },
          }
        );
        const bot = await axios.post(
          `${process.env.TWITCH_CALLBACK}/donation`,
          payload,
          {
            headers: { Authorization: process.env.AUTH_TOKEN },
          }
        );
        if (reply.error || bot.error) {
          console.log('error');
        } else {
          console.log('donation payment sent to DB prizepool');
        }
      }
    }
    // Structure as on JSON Schema
  });

  // Live SE event message logic. Currently, functionality is limited to donations only.
  sesocket.on('event', (data) => {
    sesocket.on('event', (data) => {
      if (data.type === 'tip') {
        let payload;
        // Switch statement to check message on donation. 1/1st/first.. etc to denote which pool donation goes to
        switch (data.data.message.toLowerCase()) {
          case '1':
          case '1st':
          case 'first':
            payload = {
              type: 'donation',
              data: {
                from: data.data.username,
                place: 'first',
                amount: parseFloat(data.data.amount).toFixed(2),
              },
            };
            sendIt(payload);
            break;
          case '2':
          case '2nd':
          case 'second':
            payload = {
              type: 'donation',
              data: {
                from: data.data.username,
                place: 'second',
                amount: parseFloat(data.data.amount).toFixed(2),
              },
            };
            sendIt(payload);
            break;
          case '3':
          case '3rd':
          case 'third':
            payload = {
              type: 'donation',
              data: {
                from: data.data.username,
                place: 'third',
                amount: parseFloat(data.data.amount).toFixed(2),
              },
            };
            sendIt(payload);
            break;
          default:
            console.log(data.data);
        }

        /* Function for prize pool update, data comes from StreamElements socket, 'tip' event type.
        Firstly, sends GET request to retrieve current prize pool from bot server, which is linked to mongoDB atlas.
        Secondly, it will parse the values, and add the incoming donation payload to the requisite prize pool bucket.
        Thirdly, it will send the new values back to the bot for update on server.
        Finally, it emits the data via RL socket connection. React app will receive updated prize pool amount and alter state accordingly */
        async function sendIt(payload) {
          rlsocket.emit('payload', payload);
          let remote = await axios.get(
            `${process.env.TWITCH_CALLBACK}/prizepool`,
            {
              headers: {
                Authorization: process.env.AUTH_TOKEN,
              },
            }
          );
          newstate = {
            ...remote.data,
            [payload.data.place]: (parseFloat(remote.data[payload.data.place]) + parseFloat(payload.data.amount)).toFixed(2) /* prettier-ignore */,
          };
          console.log(newstate);
          const reply = await axios.post(
            `${process.env.TWITCH_CALLBACK}/prizepool`,
            newstate,
            {
              headers: {
                Authorization: process.env.AUTH_TOKEN,
              },
            }
          );
          const bot = await axios.post(
            `${process.env.TWITCH_CALLBACK}/donation`,
            payload,
            {
              headers: { Authorization: process.env.AUTH_TOKEN },
            }
          );
          if (reply.error || bot.error) {
            console.log('error');
          } else {
            console.log('donation payment sent to DB prizepool');
          }
        }
      }
      console.log(`WS. RECV: <- ${chalk.blue('STREAMELEMENTS')}: `);
      console.log(data);
      // Structure as on JSON Schema
    });
  });
  sesocket.on('event:update', (data) => {
    console.log(`WS. RECV: <- ${chalk.blue('STREAMELEMENTS')}: `);
    console.log(data);
    // Structure as on https://github.com/StreamElements/widgets/blob/master/CustomCode.md#on-session-update
  });
  sesocket.on('event:reset', (data) => {
    console.log(`WS. RECV: <- ${chalk.blue('STREAMELEMENTS')}: `);
    console.log(data);
    // Structure as on https://github.com/StreamElements/widgets/blob/master/CustomCode.md#on-session-update
  });

  // SE connect logic, run auth function on socket open
  function onConnect() {
    console.log(
      chalk.green('WS. INFO: Socket Opened -> ') + chalk.blue('STREAMELEMENTS')
    );
    sesocket.emit('authenticate', {
      method: 'jwt',
      token: JWT,
    });
  }

  // SE disconnect logic. !!TODO!!
  function onDisconnect() {
    console.log('Disconnected from websocket');
    // Reconnect
  }

  // After successful auth, log channel info to console
  function onAuthenticated(data) {
    const { channelId } = data;
    console.log(
      `WS. RECV: <- ${chalk.blue(
        'STREAMELEMENTS'
      )}: Successfully connected to channel ${chalk.yellowBright(channelId)}`
    );
  }
}

// Middleware for logging and parseing of data
app.use(volleyball);
app.use(express.json());

// Allow CORS
app.use(function (req, res, next) {
  res.header('Access-Control-Allow-Origin', '*');
  res.header(
    'Access-Control-Allow-Headers',
    'Origin, X-Requested-With, Content-Type, Accept, Authorization'
  );
  next();
});

const responses = [
  `¯\\_(ツ)_/¯`,
  `ಠ_ಠ`,
  `¯\\(°_o)/¯`,
  `¯\\_( ͡° ͜ʖ ͡°)_/¯`,
  `[̲̅$̲̅(ツ)$̲̅]`,
  `ᕦ(ツ)ᕤ`,
];

// Routing for serving up React app as overlay from build folder
const path = require('path');
app.use(express.static('build'));
app.use(express.static('src'));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'build', 'index.html'));
});

app.get('/src/styles.scss', (req, res) => {
  res.sendFile(path.join(__dirname, 'src', 'styles.scss'));
});

// GET Route for new twitch follower -> Twitch
app.get('/newfollow', (req, res) => {
  const spinner = ora(`Processing twitch request... \n`).start();
  if (
    req.headers.authorization !== process.env.AUTH_TOKEN ||
    !req.headers.authorization
  ) {
    console.log(req.headers);
    spinner.stopAndPersist({
      symbol: 'X',
      text: chalk.red('401 Unauthorised!'),
    });
    res.send(responses[Math.floor(Math.random() * responses.length)]);
  } else {
    console.log(req.headers.authorization);
    setTimeout(() => {
      spinner.stopAndPersist({
        symbol: '✓',
        text: chalk.green('200 OK!'),
      });
      console.log(chalk.magenta(`New follower!`));
      console.log(chalk.magenta(`purplestrobe executed on RGB`));
      res.send(responses[Math.floor(Math.random() * responses.length)]);
    }, 400);
  }
});

// GET route for currently playing song from Spotify
app.get(`/song`, (req, res) => {
  if (
    req.headers.authorization !== process.env.AUTH_TOKEN ||
    !req.headers.authorization
  ) {
    console.log(req.headers);
    spinner.stopAndPersist({
      symbol: 'X',
      text: chalk.red('401 Unauthorised!'),
    });
    res.send(responses[Math.floor(Math.random() * responses.length)]);
  } else {
    let fs = require('fs'),
      filename = 'song.txt';
    fs.readFile(filename, 'utf8', function (err, data) {
      if (err) throw err;
      console.log(data);
      res.send(data);
    });
  }
});

app.get('*', (req, res, next) => {
  res.send(responses[Math.floor(Math.random() * responses.length)]);
  console.log(chalk.red('401 Unauthorized!'));
});

// POST Route for LED strip changes
app.post('/lights/rgbstrip', (req, res) => {
  if (
    req.headers.authorization !== process.env.AUTH_TOKEN ||
    !req.headers.authorization
  ) {
    console.log(req.headers);
    spinner.stopAndPersist({
      symbol: 'X',
      text: chalk.red('401 Unauthorised!'),
    });
    res.send(responses[Math.floor(Math.random() * responses.length)]);
  } else {
    const spinner = ora(`Processing request... \n`).start();
    setTimeout(() => {
      spinner.stopAndPersist({
        symbol: '✓',
        text: chalk.green('200 OK!'),
      });
      console.log(
        chalk.whiteBright(
          `${Object.keys(req.body.data)}: ${Object.values(
            req.body.data
          )} received`
        )
      );
      if (req.body.data.command == 'disco') {
        lights.rgbstrip.strobe('white', streamcolour);
      } else {
        streamcolour = req.body.data.command;
        lights.rgbstrip.trigger(req.body.data.command);
      }
      res.send(responses[Math.floor(Math.random() * responses.length)]);
    }, 400);
  }
});

// POST Route for adjusting Elgato keylight
app.post('/lights/keylight', (req, res) => {
  if (
    req.headers.authorization !== process.env.AUTH_TOKEN ||
    !req.headers.authorization
  ) {
    console.log(req.headers);
    spinner.stopAndPersist({
      symbol: 'X',
      text: chalk.red('401 Unauthorised!'),
    });
    res.send(responses[Math.floor(Math.random() * responses.length)]);
  } else {
    const spinner = ora(`Processing request... \n`).start();
    setTimeout(() => {
      spinner.stopAndPersist({
        symbol: '✓',
        text: chalk.green('200 OK!'),
      });
      console.log(
        chalk.whiteBright(
          `${Object.keys(req.body.data)}: ${Object.values(
            req.body.data
          )} received`
        )
      );
      lights.keylight.trigger(req.body.data.command);
      res.send(responses[Math.floor(Math.random() * responses.length)]);
    }, 400);
  }
});

/* POST route for prize pool update, this is via manual !setprize command to twitch bot.
Emits the data via RL socket connection. React app will receive updated prize pool amount and alter state accordingly */
app.post(`/prizeupdate`, (req, res) => {
  if (
    req.headers.authorization !== process.env.AUTH_TOKEN ||
    !req.headers.authorization
  ) {
    console.log(req.headers);
    spinner.stopAndPersist({
      symbol: 'X',
      text: chalk.red('401 Unauthorised!'),
    });
    res.send(responses[Math.floor(Math.random() * responses.length)]);
  } else {
    let payload = { type: 'prizeupdate', data: { ...req.body } };
    console.log(payload);
    rlsocket.emit('payload', payload);
    res.send(responses[Math.floor(Math.random() * responses.length)]);
  }
});

app.post('*', (req, res, next) => {
  res.send(responses[Math.floor(Math.random() * responses.length)]);
  console.log(chalk.red('401 Unauthorized!'));
});

/* ROCKET LEAGUE STUFF:

Variables to hold information about players and score
Blue team data */
let team0name = null;
let team0score = 0;

// Orange team data
let team1name = null;
let team1score = 0;

// Player data
let players = null;

/* Variables to store current light colour info
Colour based on current RL team score, default white */
let currentcolour = 'white';

// Colour based on Twitch channel point redemption or bot command, default purple
let streamcolour = 'purple';

// Activate default lighting on server start
lights.keylight.light_on();
lights.rgbstrip.trigger(streamcolour);

let gameStreams = {};
let rlHost = 'http://localhost:49122';

io.on('connection', (socket) => {
  socket._id;
  socket.watching;

  socket.on('join', (id) => {
    socketId = id;
    if (!!socket._id) {
      socket.leave('game');
      endGameStream(socket._id);
      console.log(`Client ${id} left`);
    }
    socket.join('game');
    socket._id = id;
    console.log(`Client ${id} connected, ID: ${socket.id}`);
  });

  socket.on('watchGame', () => {
    if (!socket.watching) {
      createGameStream(socket._id);
      socket.watching = true;
      console.log(
        `Client ${socket._id} in rooms: ${JSON.stringify(socket.rooms)}`
      );
    }
  });

  socket.on('disconnect', () => {
    if (socket._id && socket.watching) {
      endGameStream(socket._id);
    }
  });

  // Emit tournament data to clients
  socket.on('updateTournament', (tournament) => {
    socket.to('game').emit('tournament', tournament);
  });

  // Emit payload data to clients
  socket.on('payload', (payload) => {
    // socket.to('REACTLOCAL').emit('payload', payload);
    socket.to('game').emit('payload', payload);
  });
});

let wsClient;
const initWsClient = () => {
  wsClient = new WebSocket(rlHost);

  wsClient.onclose = function () {
    delete wsClient;
    setTimeout(() => {
      console.error('Rocket League WebSocket Server Closed!');
      console.log('Attempting reconnection...');
      initWsClient(rlHost);
    }, 10000);
  };

  wsClient.onopen = function open() {
    console.log(`Connected to Rocket League on ${rlHost}`);
  };

  wsClient.onmessage = function (message) {
    let data = JSON.parse(message.data);
    io.in('game').emit('update', data);
    // Log WS messages here
    // console.info(data.event);
  };

  wsClient.onerror = function (err) {
    console.error(
      'Error connecting to SOS, is the plugin running? Try plugin load SOS from BakkesMod console to be sure'
    );
    wsClient.close();
  };
};
initWsClient();

createGameStream = (id) => {
  if (gameStreams[id]) {
    gameStreams[id].connected++;
    return gameStreams[id];
  }
  gameStreams[id] = {
    ws: wsClient,
    connected: 1,
  };
};

endGameStream = (id) => {
  if (gameStreams[id]) {
    gameStreams[id].connected--;
    if (gameStreams[id].connected < 1) {
      console.log(`Client ${id} disconnected`);
      gameStreams[id].ws.close();
      delete gameStreams[id];
    }
  }
};

// Declare this socket outside of function body to allow other functions to emit messages
const rlsocket = io_client('ws://localhost:5000');

// Connect back to the SOS relay on this server to receive Rocket League game data, control lights from certain events, etc.
function rocketleague() {
  rlsocket.emit('join', 'TWITCHLOCAL');
  rlsocket.emit('watchGame');

  // Logic for each game tick update event
  rlsocket.on('update', (data) => {
    let event = data.event;
    let stats = data.data;

    /* Logic for 'game:update_state' events, this will contain all the game data, such as time, team numbers/names, player data,
    score, statistics, etc etc. */
    if (event == 'game:update_state') {
      players = stats['players'];
      team0name = stats.game.teams[0].name;
      team0score = stats.game.teams[0].score;
      team1name = stats.game.teams[1].name;
      team1score = stats.game.teams[1].score;
    }

    // Trigger lighting on goal event
    if (event == 'game:goal_scored') {
      console.log(stats);
      console.log(`Goal scored by ${stats.scorer.name}!`);
      sleeper(100).then(() => {
        reactivelight('goal', stats.scorer.teamnum);
      });
    }

    // Trigger white lighting state on match creation/destruction
    if (
      event == 'game:match_destroyed' ||
      event == 'game:match_ended' ||
      event == 'game:match_created'
    ) {
      console.log(
        chalk.whiteBright('Match Started/Ended - Default White set!')
      );
      currentcolour = 'white';
      lights.rgbstrip.trigger('white');
      lights.keylight.light_on();
    }

    // Trigger red lighting on demolition
    if (event == 'game:statfeed_event') {
      console.log(stats);
      if (stats.type == 'Demolition') {
        console.log(
          `${stats.secondary_target.name} demolished by ${stats.main_target.name}`
        );
        reactivelight('demo', currentcolour);
      }
    }
  });
}

// Function for light changes on receipt of certain game data via websocket subscriptions
function reactivelight(command, id) {
  if (command == 'demo') {
    lights.rgbstrip.demo(currentcolour);
  }

  // Goal event lighting conditions
  if (command == 'goal') {
    let strobecolour;
    // Strobe lighting with colour of scoring team
    id == 0 ? (strobecolour = 'blue') : (strobecolour = 'orange');
    console.log(
      chalk.blueBright(`Blue Team: '${team0name}' Score: ${team0score}`)
    );
    console.log(
      chalk.redBright(`Orange Team: '${team1name}' Score: ${team1score}`)
    );

    // Change static lighting colour to match currently winning team, or white on tied game
    if (team0score == team1score) {
      console.log(chalk.whiteBright('Teams are even.'));
      currentcolour = 'white';
      lights.rgbstrip.trigger(currentcolour);
      sleeper(100).then(() => {
        try {
          lights.rgbstrip.strobe(strobecolour, currentcolour);
        } catch {
          lights.rgbstrip.strobe('white', 'white');
        }
      });
    }

    // Blue ahead -> set lighting to blue, catch errors and use default white in that case
    if (team0score > team1score) {
      console.log(chalk.blueBright('Blue ahead.'));
      currentcolour = 'blue';
      lights.rgbstrip.trigger('blue');
      sleeper(100).then(() => {
        try {
          lights.rgbstrip.strobe(strobecolour, currentcolour);
        } catch {
          lights.rgbstrip.strobe('white', 'white');
        }
      });
    }

    // Orange ahead -> set lighting to orange, catch errors and use default white in that case
    if (team1score > team0score) {
      console.log(chalk.redBright('Orange ahead.'));
      currentcolour = 'orange';
      lights.rgbstrip.trigger('orange');
      sleeper(100).then(() => {
        try {
          lights.rgbstrip.strobe(strobecolour, currentcolour);
        } catch {
          lights.rgbstrip.strobe('white', 'white');
        }
      });
    }
  }
}

twitch(); // -> Call connection to Twitch

// Initialise websocket connection
rocketleague();
streamelements(); // -> Call connection to StreamElements

// Kill server, make sure NGROK shuts down on SIGINT
process.on('SIGINT', async function () {
  await ngrok
    .kill()
    .then(console.log(chalk.yellow('NGROK shutting down')))
    .then(console.log(chalk.yellow('Server shutting down')));
  process.exit();
});
