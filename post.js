//file that holds the post generating class; will also send this out to the private Discord server so that it can be read
require('dotenv').config({ path: './.env' });
const got = require('got');

class Post {

	frameArray;

    /*
     * @param c the Twitch client that handles the posting for the bot
	 * @param d the Discord client that will send the response to the admin to be reviewed and approved
     */
    constructor(c, d) {
		this.client = c;
		this.discordClient = d;
		this.frameArray = [];
    }

    /* generates a response from comments read in as a prompt from twitch chat
     * As of August 01, 2021, I have received approval from OpenAI to use GPT-3 for this bot
	 * Officially, this function is now live and I cannot be happier about it
     * 
     * @param  user       the user that asked for the response from the bot (may be removed in the future)
     * @param  prompt     the combined total comments from the chatroom that will be used to generate the prompt
     * @param  linesCount total lines within the prompt; needs to be over certain value to generate a post
     * @param  target     chatroom that the command was called from and response will be posted into
     * 
     * @return            whether the prompt was able to be posted to the target room or not
     */
	async generatePost(prompt_frame) {
		let linesCount = prompt_frame.linesCount;
		let target = prompt_frame.channel;
		let prompt = prompt_frame.prompt;

		//check first if minimum posting requirements have been met (enough comments made to post)
		console.log("Number of lines in prompt: " + linesCount);
		//there weren't enough comments to generate a post
		if (linesCount < 10) {
			this.client.say(target, `Not enough comments yet :(`);
		} else {

			//the urls for GPT-3's engines; we will use the the content filter to keep compliance with OpenAI's TOS
			const gen_url = 'https://api.openai.com/v1/engines/davinci/completions';
			const testing_url = 'https://api.openai.com/v1/engines/content-filter-alpha-c4/completions';

			//we are getting access to the model through simple https requests, so we will use the Got library to do so
			try {
				//set up the parameters for the model, which will be:
				//  - prompt: input text (so just the logs from the chat)
				//  - max_tokens: how long the response is (1 token = ~4 characters)
				//  - temperature: the level of creative freedom for responses
				//  - frequency_penalty: how much effort the model will have in not repeating itself (0 - 1)
				//  - presence_penalty: the effort the model will make for intro-ing new topics (0 - 1)
				//  - stop: what the API will stop generation when it sees these (punctuation for this one)
				//  - logprobs: many functions, use it here to get a list of all tokens
				const content_params = {
					"prompt": prompt,
					"max_tokens": 80,
					"temperature": 0.7,
					"frequency_penalty": 0.3,
					"presence_penalty": 0.3,
					"stop": ["!", "?", ".", "\n"],
					"logprobs": 10
				};

				//the headers, which is effectively the API key for GPT-3 to be sent for model access
				const headers = {
					'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
					'Content-Type': 'application/json',
				};

				let output_text = await got.post(gen_url, { json: content_params, headers: headers }).json();

				//now, we construct the vars necessary to test the response for naughtiness

				let toxic_threshold = -0.355;//probability that a "2" is real or discarded as false pos

				let token_list = output_text.choices[0].logprobs.tokens;//list of all tokens generated from original prompt

				//how we will call the content filter
				let testing_params = {
					"prompt": "<|endoftext|>" + token_list[0] + "\n--\nLabel:",
					"max_tokens": 1,
					"temperature": 0.0,
					"top_p": 1,
					"frequency_penalty": 0.3,
					"presence_penalty": 0.3,
					"logprobs": 10
				};

				let tested_output = "";

				//loop through each token and see if we can include it in the final output
				for (let i = 0; i < token_list.length; ++i) {
					//get the rating of the token from the content filter engine
					let probs_output = await got.post(testing_url, { json: testing_params, headers: headers }).json();
					let output_label = probs_output.choices[0].text;

					//if the output label is 2 (meaning a risky output), we test it to confirm a high level of 
					//confidence in the rating and substitute the token as needed
					if (output_label == "2") {
						let logprobs = probs_output.choices[0].logprobs.top_logprobs[0];

						if (logprobs["2"] < toxic_threshold) {
							let logprob_0 = logprobs || "0";
							let logprob_1 = logprobs || "1";

							if ((logprob_0 != null) && (logprob_1 != null)) {
								if (logprob_0 >= logprob_1) {
									output_label = "0";
								} else {
									output_label = "1";
								}
							} else if (logprob_0 != null) {
								output_label = "0";
							} else if (logprob_1 != null) {
								output_label = "1";
							}
						}
					}

					//if the output is not 0, 1, or 2, we set it as 2 for safety
					if ((output_label != "0") && (output_label != "1") && (output_label != "2")) {
						output_label = "2";
					}

					//if the token has been proven to not fall into a bad area/level of toxicity, 
					//we add it to the output text and send that out for approval for the bot's administrator
					if (output_label != "2") {
						tested_output += token_list[i];
					}

					testing_params.prompt = "<|endoftext|>" + token_list[i] + "\n--\nLabel:";
				}

				let responseMsg = `Generated response for ${target} is `;
				let askMsg = "Pass this message through? (Y/N): ";

				this.discordClient.channels.cache.get(process.env.SERVER_ID).send(responseMsg);
				if (tested_output == "" || tested_output == "\n" || this.#seeIfNothingButNewlines(tested_output)) {
					this.discordClient.channels.cache.get(process.env.SERVER_ID).send("Empty Response");
				} else {
					this.discordClient.channels.cache.get(process.env.SERVER_ID).send(tested_output);
                }
				
				this.discordClient.channels.cache.get(process.env.SERVER_ID).send(askMsg);

				//the object that will be used for sending out approved messages to the twich chat channel
				let frame = {
					output: tested_output,
					channel: target,
				}

				//push the object into the array
				this.frameArray.push(frame);

			} catch (err) {//in case of a screwup, post an error message to chat and print error
				this.client.say(target, `Error in text generation`);
				console.error(err);
			}
		}
		return;
	}

	//checks to see if there are nothing but newline characters in the text.
	//@returns true or false depending on whether or not the message is made up entirely of '\n'
	#seeIfNothingButNewlines(response) {
		let msg = response.split('');
		msg.forEach(item => {
			console.log(item);
			if (item != '\n') {
				return false;
			}
		});
		return true;
    }

	//sends out the frame array for searching
	//@returns frameArray
	getFrameArray() { return this.frameArray; }

}

module.exports = Post;