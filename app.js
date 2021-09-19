require('dotenv').config({ path: './.env' });
const { Client, Intents } = require('discord.js');
const tmi = require('tmi.js');
const fs = require('fs');
const p = require('./post');
const s = require('./scraper.js');

const discord_client = new Client({ intents: [Intents.FLAGS.GUILDS, Intents.FLAGS.GUILD_MESSAGES] });
const token = process.env.DISCORD_CLIENT_TOKEN;

//list of all channels that have this bot enabled on their channels; list loaded in from file (for now)
let streamers = [];

//the list of all channels; will hold each channel's prompt as to avoid prompts mixing together
let channel_list = [];

//read in list of channels from file and arrange them into array for use in options set
fs.readFile('./channels.json', 'utf8', (err, data) => {
	if (err) { console.error(err); }
	else {
		let temp = JSON.parse(data);
		temp.forEach(item => {
			//frame for what will be stored in each element of the prompt-holding array
			let frame = {
				channel: item.name,
				approved_channel: item.approved_channel,
				prompt: "",
				linesCount: 0
            }
			streamers.push(item.name);
			channel_list.push(frame);
		});
    }
});


//set of options for the bot's IRC client when it boots on Twitch
const opts = {
	identity: {//name and password of the account
		username: process.env.BOT_USERNAME,
		password: process.env.BOT_PASSWORD
	},
	connection: {//whether or not the channel will need to reconnect automatically
		reconnect: true
	},
	//what channels are we operating the bot on?
	channels: streamers
};

//lets us know that bot is connected to 
discord_client.once('ready', () => {
	console.log(`* Logged in as ${discord_client.user.tag} through Discord!`);
});

let twitch_client = new tmi.client(opts);

twitch_client.connect();

twitch_client.on('message', onMessageHandler);
twitch_client.on('connected', onConnectedHandler);

let poster = new p(twitch_client, discord_client);
let scraper = new s(discord_client);

//when a message is sent out, we will take it and push it out to its channel
discord_client.on('messageCreate', message => {
	//take the message and split it up into separate words
	const inputMsg = message.content.split(" ");
	let response = "";
	if (inputMsg[0] == '!send') {//the message generated was accepted by admin
		let filledFrames = poster.getFrameArray();

		//search through the list of responses and channels to find the correct one and then post that out
		filledFrames.forEach(item => {
			if (inputMsg[1] == item.channel) {
				response = item.output;
			}
		});
		if (response != "") {
			twitch_client.say(inputMsg[1], `MrDestructoid ${response}`);
		} else {
			twitch_client.say(inputMsg[1], `No response found for this channel`);
		}
	} else if (inputMsg[0] == '!reject') {//the message generated was rejected by admin

		twitch_client.say(inputMsg[1], `Message rejected by bot administrator :(`);

    } else if (inputMsg[0] == '!approvechannel') {//the admin has approved a channel for using this bot
		let approved_channel = inputMsg[1];

		addInNewChannelToList(approved_channel, true);//doing it this way to avoid having to do a rewrite rn
	} else if (inputMsg[0] == '!rejectchannel') {//admin is rejecting channel for using this bot due to chat behavior
		removeChannelFromList(inputMsg[1]);
	}
	
});

function onConnectedHandler(addy, prt) {
	console.log(`* Connected to ${addy}:${prt} through Twitch`);
}

function onMessageHandler(target, user, msg, self) {
	if (self) { return; }

	//split the message up into an array so we can see what's actually going on in it
	const inputMsg = msg.split(" ");

	//get the command name from the array as the first word in the message array
	const cmdName = inputMsg[0].toLowerCase();

	//make sure we don't get the bot's own messages here, dont want a feedback loop
	if (user.username != process.env.BOT_USERNAME) {
		if (cmdName == '!post' && (user.mod || ('#' + user.username) == target)) {//generate a post from the prompt

			//check to see if the channel is approved or not. If so, allow a post to go through
			if (channel_list[findThisPrompt(target)].approved_channel) {
				poster.generatePost(channel_list[findThisPrompt(target)]);
			}

		} else if (cmdName == '!adduser' && user.username == "pope_pontus") {//add in new channel to client
			
			addInNewChannelToList(target, false);

		} else if (cmdName == '!flush' && (user.mod || ('#' + user.username) == target)) {//flush the prompt for that specific channel
			
			flush(target);

		} else if (cmdName == '!testchat' && user.username == "pope_pontus") {//scrape the comments of the chat and get a score for how bad it may be

			//make sure that there is enough comments from the channel to warrant the test going through
			if (channel_list[findThisPrompt(target)].linesCount >= 100) {
				scraper.analyzeChatHistory(channel_list[findThisPrompt(target)]);
			} else {
				twitch_client.say(target, "Still need more comments to analyze for approval");
			}
			

		} else {//no applicable command, so we record the message into the appropriate prompt
			
			let i = findThisPrompt(target);
			channel_list[i].prompt += combineInput(inputMsg, true) + '\n';
			++channel_list[i].linesCount;

        }
    }
}

//adds in a new channel to list of channels bot is enabled on and restarts the client with that new option set
//@param   target     The name of the channel the command was called from
//@param   inputMsg   The total message that was captured when the command was detected as an array of words
function addInNewChannelToList(target, isApproved) {
	//add in channel and push confirmation
	opts.channels.push(target);

	//make a new data object for the twich chat client, and stuff it with the old values and new ones
	let data = [];
	for (let i = 0; i < opts.channels.length; ++i) {
		let json_obj = {
			"name": "",
			"approved_channel": false
		};
		json_obj.name = opts.channels[i];
		//check to see if we need to have this go through approval first and foremost
		if (isApproved) {
			json_obj.approved_channel = true;
		}
		data.push(json_obj);
    }

	//pretty stringify the new list of channels and write them to file
	data = JSON.stringify(data, null, 4);

	//rewrite the file with the new option set
	writeChannelsToFile(data);
}

//removes a channel from the list of channels for the bot
//usually will be used when rejecting a channel after testing, maybe afterwards if it becomes an issue
//@param   target   The channel we are going to be removing from the list
function removeChannelFromList(target) {
	//first, find the channel in the arrays and remove it from the program altogether
	let channels_index = opts.channels.indexOf(target);
	let prompt_index = channel_list.indexOf(target);

	//make sure that the channel exists in both the opts and as a part of the channels list
	if (channels_index > -1 && prompt_index > -1) {
		opts.channels.splice(channels_index, 1);
		channel_list.splice(prompt_index, 1);
	}

	//rewrite the list of channels to file and restart the bot
	let new_opts = JSON.stringify(opts.channels, null, 4);
	writeChannelsToFile(new_opts);
}

//flushes the prompt for the target channel (resets it back to "")
//@params   target    The channel the command was called from
function flush(target) {
	let i = findThisPrompt(target);
	channel_list[i].prompt = "";
	let msg = "";
	if (i != -1) {
		msg = `Prompt for @${target.slice(1)} has been successfully flushed!`;
	} else {
		msg = `Unknown channel. Cannot flush prompt`;
	}
	twitch_client.say(target, msg);
}

//gets the index of the channel prompt that needs to be swirlied out of existance
//@param    target     The channel that the command was called from
//@returns             Either the index of the channel in channel_list, or -1 if channel not found
function findThisPrompt(target) {
	let t = target.slice(1);
	for (let i = 0; i < channel_list.length; ++i) {
		if (channel_list[i].channel == t) {
			return i;
        }
    }
	return -1;
}

//combines the input into a single string
//@params   inputMsg         The total message that was captured when the command was detected as an array of words
//@params   needWhiteSpace   Whether the message needs to have white space included between words
//@returns                   The combined input of the twitch message with all comments included
function combineInput(inputMsg, needWhiteSpace) {
	let combinedMsg = '';
	for (let i = 0; i < inputMsg.length; ++i) {
		if (i != 0) {
			combinedMsg += inputMsg[i];
		} else if (inputMsg.length == 1) {
			return inputMsg[i];
        }
		if (needWhiteSpace && (i + 1 != inputMsg.length)) {
			combinedMsg += ' ';
		}
	}
	return combinedMsg;
}

//writes the currently approved channels to file and restarts the client with the new list
//@param   data   A stringified JSON object holding all the channels and their approved status
function writeChannelsToFile(data) {
	//rewrite the file with the new option set
	fs.truncate('./channels.json', 0, function () {
		fs.writeFile('./channels.json', data, 'utf8', function (err) {
			if (err) {
				console.error(err);
				twitch_client.say(target, "Error adding in new channel to bot options");
			} else {
				try {
					//disconnect the old client and remake it with the new opts
					twitch_client.disconnect();
					twitch_client = new tmi.client(opts);

					//reconnect with new client and add on all handlers to it
					twitch_client.connect();
					twitch_client.on('message', onMessageHandler);
					twitch_client.on('connected', onConnectedHandler);

					twitch_client.say(target, "Added in this user to list of enabled channels").catch(console.error);
				} catch (err) { console.error(err); }
			}
		})
	});
}

//this goes last to prevent any issues on discord's end
discord_client.login(token);
