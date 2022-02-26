import dotenv from 'dotenv';
dotenv.config({ path: './.env'});

import { Client, Intents } from 'discord.js';
import { client } from 'tmi.js';
import fs from 'fs';
import { Post as p } from './post.js';
import { ChatScraper as s} from './scraper.js';
import { exit } from 'process';

const discord_client = new Client({ intents: [Intents.FLAGS.GUILDS, Intents.FLAGS.GUILD_MESSAGES] });
const token = process.env.DISCORD_CLIENT_TOKEN;

//list of all channels that have this bot enabled on their channels; list loaded in from file (for now)
let streamers = [];

//the list of all channels; will hold each channel's prompt as to avoid prompts mixing together
let channel_list = {};

//read in list of channels from file and arrange them into array for use in options set
fs.readFile('./channels.json', 'utf8', (err, data) => {
	if (err) console.error(err);
	else {
		let temp = JSON.parse(data);
		//get the list of channel names from the json file
		let names = Object.keys(temp);
		names.forEach(name => {
			//frame for what will be stored in each element of the prompt-holding array
			streamers.push(name);
			let frame = {
				approved_channel: temp[name].approved_channel,
				prompt: "",
				lines_count: 0,
				current_bill: temp[name].current_bill
            }
			channel_list[name] = frame;
		});
    }
});


//set of options for the bot's IRC client when it boots on Twitch
const opts = {
	identity: {//name and password of the account
		username: process.env.ACCT_USERNAME,
		password: process.env.ACCT_PASSWRD
	},
	connection: {//whether or not the channel will need to reconnect automatically
		reconnect: true
	},
	//what channels are we operating the bot on?
	channels: streamers
};

//lets us know that bot is connected to 
discord_client.once('ready', () => console.log(`* Logged in as ${discord_client.user.tag} through Discord!`));

let twitch_client = new client(opts);

twitch_client.connect();

twitch_client.on('message', onMessageHandler);
twitch_client.on('connected', (addy, prt) => console.log(`* Connected to ${addy}:${prt} through Twitch`));

let poster = new p(twitch_client, discord_client);
let scraper = new s(discord_client);

let channel_name = undefined;

//when a message is sent out, we will take it and push it out to its channel
discord_client.on('messageCreate', message => {
	//take the message and split it up into separate words
	const inputMsg = message.content.split(" ");
	//the channel name will not have a '#' in front of it, so we need to add it to the front if we need to post something to
	//the client's channel
	if (inputMsg[0] == 'Generated') channel_name = inputMsg[3].substring(0, inputMsg[3].length - 2);
	const target_channel = "#" + channel_name; 
	let response = "";
	let filledFrames = poster.getFrameArray();
	if (inputMsg[0] == '!send') {//the message generated was accepted by admin

		//search through the list of responses and channels to find the correct one and then post that out
		if(filledFrames[channel_name] != undefined) {
			response = filledFrames[channel_name].output;
			channel_list[channel_name].current_bill += filledFrames[channel_name].curr_bill;
		}

		if (response != "") 
			twitch_client.say(target_channel, `MrDestructoid ${response}`);
		else
			twitch_client.say(target_channel, `No response found for this channel`);

		poster.removeResponseFrame(channel_name);

		writeChannelsToFile(JSON.stringify(channel_list, null, 4), 1);
		
	} else if (inputMsg[0] == '!reject') {//the message generated was rejected by admin

		twitch_client.say(target_channel, `Message rejected by bot administrator :(`);
		channel_list[channel_name].current_bill += filledFrames[channel_name].curr_bill;
		poster.removeResponseFrame(channel_name);
		writeChannelsToFile(JSON.stringify(channel_list, null, 4), 1);

    } else if (inputMsg[0] == '!approvechannel') {//the admin has approved a channel for using this bot
		let approved_channel = channel_name;

		addInNewChannelToList(approved_channel, true);//doing it this way to avoid having to do a rewrite rn
	} else if (inputMsg[0] == '!rejectchannel') {//admin is rejecting channel for using this bot due to chat behavior
		removeChannelFromList(channel_name);
	}
	
});

function onMessageHandler(target, user, msg, self) {

	target = target.slice(1);

	if (self) return; 

	//split the message up into an array so we can see what's actually going on in it
	const inputMsg = msg.split(" ");

	//get the command name from the array as the first word in the message array
	const cmdName = inputMsg[0].toLowerCase();

	//make sure we don't get the bot's own messages here, dont want a feedback loop
	if (user.username != process.env.BOT_USERNAME) {
		if (cmdName == '!post' && (user.mod || (user.username) == target)) {//generate a post from the prompt

			//check to see if the channel is approved or not. If so, allow a post to go through
			//make sure that the prompt for the channel is cleared after response is generated as well
			if (channel_list[target]['approved_channel'] != undefined) {
				poster.generatePost(target, channel_list[target], process.env.OPENAI_API_KEY,
				process.env.SERVER_ID);
				flush(target);
			}

		} else if (cmdName == '!adduser' && user.username == "pope_pontus") {//add in new channel to client
			
			addInNewChannelToList('#saint_isidore_bot', false);

		} else if (cmdName == '!flush' && (user.mod || (user.username) == target)) {//flush the prompt for that specific channel
			
			flush(target);

		} else if (cmdName == '!testchat' && user.username == "pope_pontus") {//scrape the comments of the chat and get a score for how bad it may be

			//make sure that there is enough comments from the channel to warrant the test going through
			if (channel_list[target]['lines_count'] >= 10) 
				scraper.analyzeChatHistory(channel_list[target].prompt);
			else 
				twitch_client.say(target, "Still need more comments to analyze for approval");

		} else {//no applicable command, so we record the message into the appropriate prompt
			
			channel_list[target]['prompt'] += combineInput(inputMsg, true) + '\n';
			++channel_list[target]['lines_count'];

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
			"approved_channel": false,
			"current_bill": 0.0
		};
		json_obj.name = opts.channels[i];
		//check to see if we need to have this go through approval first and foremost
		if (isApproved) json_obj.approved_channel = true;
		data.push(json_obj);
    }

	//pretty stringify the new list of channels and write them to file
	data = JSON.stringify(data, null, 4);

	//rewrite the file with the new option set
	writeChannelsToFile(data, 0);
}

//removes a channel from the list of channels for the bot
//usually will be used when rejecting a channel after testing, maybe afterwards if it becomes an issue
//@param   target   The channel we are going to be removing from the list
function removeChannelFromList(target) {
	//first, find the channel in the arrays and remove it from the program altogether
	let channels_index = opts.channels.indexOf(target);
	let prompt_index = channel_list[target];

	//make sure that the channel exists in both the opts and as a part of the channels list
	if (channels_index > -1 && prompt_index != undefined) {
		opts.channels.splice(channels_index, 1);
		//if there is still a balance left over, grab the frame and store it into billing.json
		if (channel_list[target].current_bill != 0) {
			let removed_channel = {};
			removed_channel[target] = channel_list[target].current_bill;
			writeRemovedChannelBillsToFile(JSON.stringify(removed_channel, null, 4));
		}
		delete channel_list[target];
	}

	//rewrite the list of channels to file and restart the bot
	let new_opts = JSON.stringify(opts.channels, null, 4);
	writeChannelsToFile(new_opts, 0);
}

//flushes the prompt for the target channel (resets it back to "")
//@params   target    The channel the command was called from
function flush(target) {
	channel_list[target]['prompt'] = "";
	channel_list[target].lines_count = 0;
	let msg = "";
	if (channel_list[target] != undefined) 
		msg = `Prompt for @${target} has been successfully flushed!`;
	else 
		msg = `Unknown channel. Cannot flush prompt`;
	twitch_client.say(target, msg);
}

//combines the input into a single string
//@params   inputMsg         The total message that was captured when the command was detected as an array of words
//@params   needWhiteSpace   Whether the message needs to have white space included between words
//@returns                   The combined input of the twitch message with all comments included
function combineInput(inputMsg, needWhiteSpace) {
	let combinedMsg = '';
	for (let i = 0; i < inputMsg.length; ++i) {
		combinedMsg += inputMsg[i];
		if (inputMsg.length == 1) return inputMsg[i];
		if (needWhiteSpace && (i + 1 != inputMsg.length)) combinedMsg += ' ';
	}
	return combinedMsg;
}

//writes the currently approved channels to file and restarts the client with the new list
//@param   data     A stringified JSON object holding all the channels and their approved status
//@param   option   Number to specify if new user added to bot (0), updating current bill (1), or complete shutdown (2)
function writeChannelsToFile(data, option) {
	//rewrite the file with the new option set
	fs.truncate('./channels.json', 0, function () {
		fs.writeFile('./channels.json', data, 'utf8', function (err) {
			if (err) {
				console.error(err);
				twitch_client.say(target, "Error adding in new channel to bot options");
			} else {
				try {
					switch (option) {
						case 0:
							//disconnec client and reconnect with new client and add on all handlers to it
							twitch_client.disconnect();
							twitch_client = new client(opts);
							twitch_client.connect();
							twitch_client.on('message', onMessageHandler);
							twitch_client.on('connected', (addy, prt) => console.log(`* Connected to ${addy}:${prt} through Twitch`));
							break;
						case 1:
							console.log("* Billing totals for all users updated");
							break;
						case 2:
							//disconnect from all channels and shutdown bot completely
							twitch_client.disconnect();
							exit(0);
					}
				} catch (err) { console.error(err); }
			}
		})
	});
}

function writeRemovedChannelBillsToFile(data) {
	fs.appendFile('./channels.json', data, (err) => {
		if (err) {
			console.error(err);
			//change below when possible, need to figure out how to do dump files and such
			console.log("WRITE THIS DOWN FOR SAFE KEEPING");
			console.log(data);
		} else {
			console.log("Bill written successfully");
		}
	});
}

//this goes last to prevent any issues on discord's end
discord_client.login(token);
