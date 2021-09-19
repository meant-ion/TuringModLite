# TuringBotLite

This is a fork of TuringMod, intended to be used on multiple channels and only including the !post and !flush commands from 
TuringMod. 

Main Idea of this bot is to have it become a commercial product somehow, i.e. making a website to show statistics of the bot's posts

COMMANDS USEABLE BY MODS/CHANNEL OWNER ONLY:

- !post: Called either the stream's moderators or the streamer proper. When called, response from API
		 is filtered through a separate engine to remove the chance of inappropriate/offensive tokens making it through
		 and into the chat. Afterwards, I must read the response and approve it before it can be posted. 

- !flush: cleans out the whole of the prompt for the bot's posting function through OpenAI's GPT-3 API and the number of lines
		  posted so far.

COMMANDS USEABLE ONLY BY THE BOT'S ADMINISTRATOR

- !adduser (most likely to be removed completely along with the rest of this section once an actual acct creation service is used)


TODO: 

	In order of highest priority:

  - Get Discord integration sorted (Done except for this last (undecided) option)
		* MAAAAYYYBEEE get approved moderators from the channels bot is on to server as well
			* Allow them to approve it? Need to record what gets approved or not by them to safeguard key access

  - Write out a Terms of Service for this bot
		* Need help for this one
			- Get a lawyer for this?
			- Get help from the old man?
			- Write w/o help and pray that I didn't screw it up (terrifying)

  - Begin creation of actual website for this project
		* Need account creation service/authenticator (Firebase?)
		* Change use of .json files over to a DB (SQL distro/MongoDB?)
		* Need way of identifying if a channel is safe to use the bot on
			- Watch chat culture myself and make the decision then? Gonna take a lot of time out of my day this way
			- Maybe have a scraper get comments into file that can be searched for naughty words/emotes/whatever

  - Set up payment handling and all that fun stuff
		* God this is intimidating even looking at it
		* Really far off goal here, need to get investors to this project maybe? (not likely imo)
		* classify if someone pays per attempted response or per approved response
			- Goes back to i.d.'ing a channel's chat culture as safe or not
		* Set rates for this bot
			- Probably gonna be something akin to a amt/response or a monthly fee
		* Tax stuff with this? (Ask old man for help on this one)