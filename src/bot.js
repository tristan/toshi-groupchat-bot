const Bot = require('./lib/Bot');
const SOFA = require('sofa-js');
const Logger = require('./lib/Logger');
const PsqlStore = require('./PsqlStore');
const Session = require('./lib/Session');

let bot = new Bot();
let botAddress = bot.client.toshiIdAddress;

const DATABASE_TABLES = `
CREATE TABLE IF NOT EXISTS registered_users (
    toshi_id VARCHAR PRIMARY KEY,
    messages_sent BIGINT DEFAULT 0,
    first_joined TIMESTAMP WITHOUT TIME ZONE DEFAULT (now() AT TIME ZONE 'utc'),
    last_seen TIMESTAMP WITHOUT TIME ZONE DEFAULT (now() AT TIME ZONE 'utc'),
    registered BOOLEAN DEFAULT TRUE,
    ban_release_date TIMESTAMP WITHOUT TIME ZONE DEFAULT NULL,
    state INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS message_history (
    message_id BIGSERIAL PRIMARY KEY,
    toshi_id VARCHAR NOT NULL,
    message VARCHAR,
    date TIMESTAMP WITHOUT TIME ZONE DEFAULT (now() AT TIME ZONE 'utc')
);

CREATE TABLE IF NOT EXISTS reports (
    report_id BIGSERIAL PRIMARY KEY,
    reporter VARCHAR NOT NULL,
    reportee VARCHAR NOT NULL,
    report VARCHAR
);
`;

bot.onReady = () => {
  bot.dbStore = new PsqlStore(bot.client.config.storage.postgres.url, process.env.STAGE || 'development');
  bot.dbStore.initialize(DATABASE_TABLES).then(() => {}).catch((err) => {
    Logger.error(err);
  });
};

const FAQ = {
  'faq:about': {
    label: 'About',
    message: `Group chat is a bot that emulates a group chat on the Toshi platform by forwarding any messages it receives to all the users who have joined the chat.

This was simply built as a fun experiment to provide a place for people using Toshi to engage with other people while the community is growing.`
  },
  'faq:rooms': {
    label: "Can I have a private group chat?",
    message: `With this bot, no. Group chat will eventually be available natively in Toshi, but until then, this bot is open source so you can deploy it yourself and tell all your friends to join! see the Source Code section`
  },
  'faq:payment': {
    label: "Where do payments go?",
    message: `Since this is simply a bot, any payments send to the group just go to the bot itself. I count anything sent to the bot as a donation \uD83D\uDCB0 \uD83D\uDE0D` // :money_bags: :heart_eyes:
  },
  'faq:sourcecode': {
    label: "Can I see the source code?",
    message: `Yup! Check https://github.com/tristan/toshi-groupchat-bot`
  },
  'faq:suggestions': {
    label: "I have a suggestion...",
    message: `Great! just post it into the chat, I'll see it in there!
Alternatively you can make the change yourself and send a Pull Request on github! (see the Source Code section)`
  },
  'faq:who': {
    label: "Who's the idiot who made this?",
    message: "@tristan \uD83D\uDE05 \uD83D\uDE05 \uD83D\uDE05" // :sweat_smile: :sweat_smile: :sweat_smile:
  }
};

const FAQ_MENU = {
  type: "group",
  label: "FAQ",
  controls: Object.keys(FAQ).map((value) => {
    let option = FAQ[value];
    return {type: "button", label: option.label, value: value};
  })
};

const UNREGISTERED_CONTROLS = [
  {type: "button", label: "Join Chat", value: "join"},
  FAQ_MENU
];

const REGISTERED_CONTROLS = [
  {type: "button", label: "Leave Chat", value: "leave"},
  {type: "button", label: "Stats", value: "stats"},
  FAQ_MENU,
  //{type: "button", label: "Report", value: "report"}
];

bot.onEvent = (session, message) => {
  if (session.user.is_app) {
    return;
  }

  if (message.type == 'Message') {
    handleMessage(session, message);
  } else if (message.type == 'Command') {
    handleCommand(session, message);
  } else if (message.type == 'Init') {
    handleInit(session);
  } else if (message.type == 'Payment') {
    handlePayment(session, message);
  } else {
    handleInvalid(session);
  }
};

function handleInit(session) {
  bot.dbStore.fetchrow("SELECT * FROM registered_users where toshi_id = $1",
                       [session.user.toshi_id])
    .then((user) => {
      bot.dbStore.fetchval("SELECT COUNT(*) FROM registered_users where registered = TRUE AND (ban_release_date IS NULL OR ban_release_date < (now() AT TIME ZONE 'utc'))").then((count) => {
        // :wave:
        let msg = `\uD83D\uDC4B Welcome to Group chat bot!\nThere are currently ${count} users chatting`;
        let controls;
        if (user == null || user.registered == false) {
          controls = UNREGISTERED_CONTROLS;
          msg += ', click "Join" to join in the fun!';
        } else {
          controls = REGISTERED_CONTROLS;
          msg += ', have fun!';
        }
        session.reply(SOFA.Message({
          body: msg,
          controls: controls
        }));
      }).catch((err) => {
        Logger.error(err);
      });
    }).catch((err) => {
      Logger.error(err);
    });
}

function handleMessage(session, message) {
  bot.dbStore.fetchrow("SELECT * FROM registered_users where toshi_id = $1",
                       [session.user.toshi_id])
    .then((user) => {
      if (user == null || user.registered == false) {
        handleInit(session);
      } else if (user.ban_release_date > Date.now()) {
        // user is banned
        session.reply(SOFA.Message({
          // :rage:
          body: `\uD83D\uDE21 You've been banned until ${user.ban_release_date.toString()}`,
          controls: REGISTERED_CONTROLS
        }));
      } else {
        sendMessage(session.user, SOFA.Message({
          body: message.body
        }));
        // session.reply(SOFA.Message({
        //   controls: REGISTERED_CONTROLS
        // }));
      }
    }).catch((err) => {
      Logger.error(err);
    });
}

function handleCommand(session, command) {
  if (command.value == 'join') {
    bot.dbStore.execute("INSERT INTO registered_users (toshi_id, last_seen, registered) VALUES ($1, now() AT TIME ZONE 'utc', TRUE) ON CONFLICT (toshi_id) DO UPDATE SET last_seen = EXCLUDED.last_seen, registered = EXCLUDED.registered", [session.user.toshi_id])
      .then(() => {

        session.reply(SOFA.Message({
          // :tada:
          body: "\uD83C\uDF89 You've joined the chat, have fun!",
          controls: REGISTERED_CONTROLS
        }));

        // let name = "@" + session.user.username;
        // if (session.user.name) {
        //   name = session.user.name + " (" + name + ")";
        // }
        // sendMessage(null, SOFA.Message({
        //   body: name + " has joined the chat!"
        // }), [session.user.toshi_id]);

      }).catch((err) => {
        Logger.error(err);
      });
  }
  else if (command.value == 'leave') {
    bot.dbStore.execute("INSERT INTO registered_users (toshi_id, last_seen, registered) VALUES ($1, now() AT TIME ZONE 'utc', FALSE) ON CONFLICT (toshi_id) DO UPDATE SET last_seen = EXCLUDED.last_seen, registered = EXCLUDED.registered", [session.user.toshi_id])
      .then(() => {

        session.reply(SOFA.Message({
          // :door:
          body: "\uD83D\uDEAA You've left the chat, come back any time!",
          controls: UNREGISTERED_CONTROLS
        }));

        // let name = "@" + session.user.username;
        // if (session.user.name) {
        //   name = session.user.name + " (" + name + ")";
        // }
        // sendMessage(null, SOFA.Message({
        //   body: name + " has left the chat!"
        // }), [session.user.toshi_id]);

      }).catch((err) => {
        Logger.error(err);
      });
  }
  else if (command.value == 'stats') {
    bot.dbStore.fetchval("SELECT COUNT(*) FROM registered_users where registered = TRUE AND (ban_release_date IS NULL OR ban_release_date < (now() AT TIME ZONE 'utc'))").then((count) => {
      // :bulb:
      let msg = `\uD83D\uDCA1 There are currently ${count} users chatting`;
      session.reply(SOFA.Message({
        body: msg,
        controls: REGISTERED_CONTROLS
      }));
    }).catch((err) => {
      Logger.error(err);
    });
  }

  else if (command.value in FAQ) {

    bot.dbStore.fetchrow("SELECT * FROM registered_users where toshi_id = $1",
                       [session.user.toshi_id])
    .then((user) => {
      session.reply(SOFA.Message({
        body: FAQ[command.value].message,
        controls: user == null || user.registered == false ? UNREGISTERED_CONTROLS : REGISTERED_CONTROLS
      }));
    }).catch((err) => Logger.error(err));

  }
}

function handlePayment(session, payment) {

  bot.dbStore.fetchrow("SELECT * FROM registered_users where toshi_id = $1",
                       [session.user.toshi_id])
    .then((user) => {
      session.reply(SOFA.Message({
        // :moneybag:
        body: "\uD83D\uDCB0 Thanks for the donation!",
        controls: user == null || user.registered == false ? UNREGISTERED_CONTROLS : REGISTERED_CONTROLS
      }));
    }).catch((err) => Logger.error(err));

}

function handleInvalid(session) {
  bot.dbStore.fetchrow("SELECT * FROM registered_users where toshi_id = $1",
                       [session.user.toshi_id])
    .then((user) => {
      session.reply(SOFA.Message({
        // :no_entry:
        body: "\uD83C\uDF89 That's not allowed!",
        controls: user == null || user.registered == false ? UNREGISTERED_CONTROLS : REGISTERED_CONTROLS
      }));
    }).catch((err) => Logger.error(err));
}

function sendMessage(from, message, excludes) {
  let body;
  if (from == null) {
    // system message: :loudspeaker:
    body = "\uD83D\uDCE2 " + message.body;
  } else {
    bot.dbStore.execute("UPDATE registered_users SET messages_sent = messages_sent + 1 WHERE toshi_id = $1",
                        [from.toshi_id]);
    bot.dbStore.execute("INSERT INTO message_history (toshi_id, message) VALUES ($1, $2)",
                        [from.toshi_id, message.body]);
    if (!excludes) {
      excludes = [from.toshi_id];
    } else {
      excludes.push(from.toshi_id);
    }
    // user message :speach_balloon:
    body = "\uD83D\uDCAC ";
    if (from.name) {
      body += from.name + " (@" + from.username + ")";
    } else {
      body += "@" + from.username;
    }
    body += "\n" + message.body;
  }
  message = SOFA.Message({
    body: body,
    controls: REGISTERED_CONTROLS
  });

  // send message to all users
  bot.dbStore.fetch("SELECT toshi_id FROM registered_users where registered = TRUE").then((rows) => {
    let toshiIds = rows
        .map((row) => row.toshi_id);
    if (excludes && excludes.length > 0) {
      toshiIds = toshiIds
        .filter((toshiId) => !excludes.includes(toshiId));
    }

    toshiIds.forEach((toshiId) => {
      bot.client.send(toshiId, message);
    });

  }).catch((err) => Logger.error(err));
}
