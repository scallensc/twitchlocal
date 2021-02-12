require('dotenv').config();
const express = require('express');
const app = express();
const port = 5000;
const lights = require('./rgb');
const ngrok = require('ngrok');
const volleyball = require('volleyball');
const chalk = require('chalk');
const ora = require('ora');
const axios = require('axios');
const WebSocket = require('ws');

const AUTH_TOKEN = process.env.AUTH_TOKEN;

// Socket IO instance for CONNECTIONS
const io = require('socket.io-client');

// Socket IO instance for SERVER
const http = require('http').Server(app);
const io2 = require('socket.io')(http);
const atob = require('atob');

const _ = require('lodash');

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

// Middleware for logging and parseing of data
app.use(volleyball);
app.use(express.json());

// Allow CORS
app.use(function (req, res, next) {
  res.header('Access-Control-Allow-Origin', '*');
  res.header(
    'Access-Control-Allow-Headers',
    'Origin, X-Requested-With, Content-Type, Accept'
  );
  res.header('Authorization', process.env.AUTH_TOKEN);
  next();
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
    res.sendStatus(401);
  } else {
    console.log(req.headers.authorization);
    setTimeout(() => {
      spinner.stopAndPersist({
        symbol: '✓',
        text: chalk.green('200 OK!'),
      });
      console.log(chalk.magenta(`New follower!`));
      console.log(chalk.magenta(`purplestrobe executed on RGB`));
      lights.rgbstrip.strobe('purple', streamcolour);
      res.sendStatus(200);
    }, 400);
  }
});

app.get('*', (req, res, next) => {
  res.sendStatus(401);
});

// POST Route for LED strip changes
app.post('/lights/rgbstrip', (req, res) => {
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
    if (req.body.data.command == '!disco') {
      lights.rgbstrip.strobe('white', streamcolour);
    } else {
      streamcolour = req.body.data.command;
      lights.rgbstrip.trigger(req.body.data.command);
    }
    res.sendStatus(200);
  }, 400);
});

// POST Route for adjusting Elgato keylight
app.post('/lights/keylight', (req, res) => {
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
    res.sendStatus(200);
  }, 400);
});

/* POST route for prize pool update, this is via manual !setprize command to twitch bot.
Emits the data via RL socket connection. React app will receive updated prize pool amount and alter state accordingly */
app.post(`/prizeupdate`, (req, res) => {
  let payload = req.body;
  rlsocket.emit('payload', payload);
});

// GET route for currently playing song from Spotify
app.get(`/song`, (req, res) => {
  let fs = require('fs'),
    filename = 'song.txt';
  fs.readFile(filename, 'utf8', function (err, data) {
    if (err) throw err;
    console.log(data);
    res.send(data);
  });
});

app.post('*', (req, res, next) => {
  res.sendStatus(401);
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

// Connect to StreamElements via WS
async function streamelements() {
  let JWT = process.env.STREAMELEMENTS_TOKEN;
  const sesocket = io('https://realtime.streamelements.com', {
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
    console.log(data.event);
    // if (data.listener == 'tip-points') {
    //   let payload;
    //   switch (data.event.message.toLowerCase()) {
    //     case '1':
    //     case '1st':
    //     case 'first':
    //       payload = {
    //         type: 'donation',
    //         data: {
    //           from: data.event.name,
    //           place: 'first',
    //           amount: data.event.amount,
    //         },
    //       };
    //       sendIt(payload);
    //       break;
    //     case '2':
    //     case '2nd':
    //     case 'second':
    //       payload = {
    //         type: 'donation',
    //         data: {
    //           from: data.event.name,
    //           place: 'second',
    //           amount: data.event.amount,
    //         },
    //       };
    //       sendIt(payload);
    //       break;
    //     case '3':
    //     case '3rd':
    //     case 'third':
    //       payload = {
    //         type: 'donation',
    //         data: {
    //           from: data.event.name,
    //           place: 'third',
    //           amount: data.event.amount,
    //         },
    //       };
    //       sendIt(payload);
    //       break;
    //     default:
    //       console.log(data.event);
    //   }
    //   async function sendIt(payload) {
    //     rlsocket.emit('payload', payload);
    //     let remote = await axios.get(
    //       `${process.env.TWITCH_CALLBACK}/prizepool`
    //     );
    //     oldstate = remote.data;
    //     newstate = {
    //       data: {
    //         ...oldstate['0'].prize,
    //         [payload.data.place]: (
    //           parseFloat(oldstate['0'].prize[payload.data.place]) +
    //           payload.data.amount
    //         ).toFixed(2),
    //       },
    //     };
    //     console.log(newstate);
    //     const reply = await axios.post(
    //       `${process.env.TWITCH_CALLBACK}/prizepool`,
    //       newstate
    //     );
    //     if (reply.error) {
    //       console.log('error');
    //     } else {
    //       console.log('donation payment sent to DB prizepool');
    //     }
    //   }
    // }
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
                amount: data.data.amount,
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
                amount: data.data.amount,
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
                amount: data.data.amount,
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
          oldstate = remote.data;
          newstate = {
            data: {
              ...oldstate['0'].prize,
              [payload.data.place]: (
                parseFloat(oldstate['0'].prize[payload.data.place]) +
                payload.data.amount
              ).toFixed(2),
            },
          };
          console.log(newstate);
          const reply = await axios.post(
            `${process.env.TWITCH_CALLBACK}/prizepool`,
            {
              headers: {
                Authorization: process.env.AUTH_TOKEN,
              },
            },
            newstate
          );
          if (reply.error) {
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

// Connect to SOS plugin in Rocket League
function sos() {
  let RlHost = 'ws://10.0.0.23:49122';
  let rlWsClientReady = false;
  let wsClient;
  let gameStreams = {};

  // On receipt of connection message, declare _id and watching
  io2.on('connection', (socket) => {
    socket._id;
    socket.watching;

    // Assign socket ID to client on client join message
    socket.on('join', (id) => {
      if (socket._id) {
        console.log(socket._id);
      }
      if (!!socket._id) {
        socket.leave(socket._id);
        endGameStream(socket._id);
        console.log(`User: ${chalk.blueBright(id)} left`);
      }
      socket.join(id);
      socket._id = id;
      console.log(`User: ${chalk.blueBright(id)} watching`);
    });

    // Run createGameStream function on client watchGame message
    socket.on('watchGame', () => {
      if (!socket.watching) {
        createGameStream(socket._id);
        socket.watching = true;
      }
    });

    // Run endGameStream function on client disconnect message
    socket.on('disconnect', () => {
      console.log(chalk.red('socket.io disconnection'));
      if (socket._id && socket.watching) {
        endGameStream(socket._id);
      }
    });

    // Emit tournament data to client on updateTournament message
    socket.on('updateTournament', (tournament) => {
      socket.to(socket._id).emit('tournament', tournament);
    });

    // Emit payload data only to REACTLOCAL client, for updating state of prize pool, etc
    socket.on('payload', (payload) => {
      socket.to('REACTLOCAL').emit('payload', payload);
    });
  });

  // Start HTTP listen server for inbound connection
  http.listen(3002, () =>
    console.log(`listening on: ${chalk.yellowBright('http://localhost:3002/')}`)
  );

  // Function to create game stream for a given client ID, to allow sending specific data to specific client
  createGameStream = (id) => {
    if (gameStreams[id]) {
      gameStreams[id].connected++;
      return gameStreams[id];
    }

    // Run initWS function to connect to Rocket League, on error, attempt a reconnect continuously every 10s till connected
    initWs(RlHost);
    setInterval(function () {
      if (wsClient.readyState === WebSocket.CLOSED) {
        console.error(
          chalk.redBright(
            'Rocket League WebSocket Server Closed. Attempting to reconnect'
          )
        );
        initWs(RlHost);
      }
    }, 10000);

    // Function to connect to, and emit messages from, Rocket League plugin (SOS)
    function initWs(RlHost) {
      wsClient = new WebSocket(RlHost);
      rlWsClientReady = false;

      // Set ready state to true when connected to Rocket League plugin
      wsClient.onopen = function open() {
        rlWsClientReady = true;
        console.log(
          `Connected to Rocket League on ${chalk.yellowBright(RlHost)}`
        );
      };

      /* SOS Plugin is set to Base64 encode, on receipt of message, decode with atob and send through socket to 
      connected ID's */
      wsClient.onmessage = function (message) {
        let sendMessage = message.data;
        if (sendMessage.substr(0, 1) !== '{') {
          sendMessage = atob(message.data);
        }
        io2.in(id).emit('update', sendMessage);
      };

      // Throw connection error in console. When this function is called, it is called recursively every 10s
      wsClient.onerror = function (err) {
        rlWsClientReady = false;
        console.error(
          `Error connecting to Rocket League. Is the plugin loaded into Rocket League? Run the command "plugin load sos" from the BakkesMod console to make sure`
        );
      };
      gameStreams[id] = {
        ws: wsClient,
        connected: 1,
      };
    }
  };

  // Destroy socket when client leaves
  endGameStream = (id) => {
    if (gameStreams[id]) {
      gameStreams[id].connected--;
      if (gameStreams[id].connected < 1) {
        console.log('User left, closing websocket');
        gameStreams[id].ws.close();
        delete gameStreams[id];
        rlWsClientReady = false;
      }
    }
  };
}

// Declare this socket outside of function body to allow
const rlsocket = io('ws://localhost:3002');

// Connect back to the SOS relay on this server to receive Rocket League game data, control lights from certain events, etc.
function rocketleague() {
  rlsocket.emit('join', 'TWITCHLOCAL');
  rlsocket.emit('watchGame');

  // Logic for each game tick update event
  rlsocket.on('update', (response) => {
    let data = JSON.parse(response);
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

// Start express server, open NGROK tunnel
app.listen(port, () => {
  chalk.green(
    `Server up at ` +
      chalk.whiteBright(`http://localhost:` + port + '\n✓ ') +
      chalk.green(`NGROK tunnel `) +
      chalk.whiteBright(`https://${process.env.NGROK_SUBD}.ngrok.io`)
  );
  console.log(chalk.greenBright(`Ready...`));
});

twitch(); // -> Call connection to Twitch

// Initialise websocket connection
sos(); // -> Call SOS socket server logic
rocketleague(); // -> Call connection to SOS socket
streamelements(); // -> Call connection to StreamElements

// Kill server, make sure NGROK shuts down on SIGINT
process.on('SIGINT', async function () {
  await ngrok
    .kill()
    .then(console.log(chalk.yellow('NGROK shutting down')))
    .then(console.log(chalk.yellow('Server shutting down')));
  process.exit();
});
