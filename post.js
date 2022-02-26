//file that holds the post generating class; will also send this out to the private Discord server so that it can be read
//require('dotenv').config({ path: './.env' });
import fetch from 'node-fetch';
import { encode, decode } from 'gpt-3-encoder';

export class Post {

	frameArray;

    /*
     * @param c the Twitch client that handles the posting for the bot
	 * @param d the Discord client that will send the response to the admin to be reviewed and approved
     */
    constructor(c, d) {
		this.twitch_client = c;
		this.discord_client = d;
		this.frameArray = {};
    }

    /* generates a response from comments read in as a prompt from twitch chat
     * As of August 01, 2021, I have received approval from OpenAI to use GPT-3 for this bot
	 * Officially, this function is now live and I cannot be happier about it
     * 
     * @param  target        the name of the channel requesting a prompt
     * @param  prompt        the combined total comments from the chatroom that will be used to generate the prompt
     * @param  lines_count   total lines within the prompt; needs to be over certain value to generate a post
     * @param  target        chatroom that the command was called from and response will be posted into
     * 
     * @return               whether the prompt was able to be posted to the target room or not
     */
	async generatePost(target, prompt_frame, key, server_id) {

		let lines_count = prompt_frame.lines_count;
		let prompt = prompt_frame.prompt;

		const encoded = encode(prompt);

		//the cost per token sent into the API for the prompt in USD
		const base_token_cost = 0.025;

		//this is now the total cost of this response being sent through
		const curr_bill = encoded.length * base_token_cost;

		//check first if minimum posting requirements have been met (enough comments made to post)
		console.log("Number of lines in prompt: " + lines_count);
		if (lines_count >= 10) {

			//the urls for GPT-3's engines; we will use the the content filter to keep compliance with OpenAI's TOS
			const gen_url = 'https://api.openai.com/v1/engines/davinci/completions';
			const testing_url = 'https://api.openai.com/v1/engines/content-filter-alpha-c4/completions';

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
				'Authorization': `Bearer ${key}`,
				'Content-Type': 'application/json',
			};

			let output_text = "";
			let tested_output = "";
			let token_list = undefined;

			await fetch(gen_url, { method: 'POST', headers: headers, body: JSON.stringify(content_params)} )
				.then(result => result.json()).then(body => {
					output_text = body.choices[0].text;
					token_list = body.choices[0].logprobs.tokens;
				}).catch(err => {
					this.twitch_client.say(target, `Error in text generation`);
					console.error(err);
					return false;
				});

			const toxic_threshold = -0.355;//probability that a "2" is real or discarded as false pos

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

			//loop through each token and see if we can include it in the final output
		 	for (let token of token_list) {
				let output_label = "";
				let probs_output = undefined;
		 		//get the rating of the token from the content filter engine
				await fetch(testing_url, { method: 'POST', headers: headers, body: JSON.stringify(testing_params) })
					.then(result => result.json()).then(body => {
						probs_output = body;
						output_label = body.choices[0].text;
					}).catch(err => {
						this.twitch_client.say(target, `Error in text filtering`);
						console.error(err);
						return false;
					});

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
							} else 
								output_label = "1";
						} else if (logprob_0 != null) output_label = "0";
						else if (logprob_1 != null) output_label = "1";
					}
		 		}

		 		//if the output is not 0, 1, or 2, we set it as 2 for safety
		 		if ((output_label != "0") && (output_label != "1") && (output_label != "2")) output_label = "2";

		 		//if the token has been proven to not fall into a bad area/level of toxicity, 
		 		//we add it to the output text and send that out for approval for the bot's administrator
		 		if (output_label != "2") tested_output += token;

				testing_params.prompt = "<|endoftext|>" + token + "\n--\nLabel:";
		 	}

			const responseMsg = `Generated response for ${target}'s channel is `;
			const askMsg = "Pass this message through? (!send to send, !reject to reject): ";

			this.discord_client.channels.cache.get(server_id).send(responseMsg);
			if (tested_output == "" || tested_output == "\n" || this.#seeIfNothingButNewlines(tested_output)) 
				this.discord_client.channels.cache.get(server_id).send("Empty Response");
			else this.discord_client.channels.cache.get(server_id).send(tested_output);
			
			this.discord_client.channels.cache.get(server_id).send(askMsg);

			//the object that will be used for sending out approved messages to the twich chat channel
			let frame = {
				output: tested_output,
				curr_bill: curr_bill
			};

			//push the object into the array
			this.frameArray[target] = frame;
			return true;
	}
		this.twitch_client.say(target, `Not enough comments yet :(`); 
		return false;
	}

	//sends out the frame object for searching
	//@returns frameArray
	getFrameArray() { return this.frameArray; }

	//removes an old, already processed frame from the frame object
	//@param   target   the specific frame to remove, identified as the name of a channel
	removeResponseFrame(target) { delete this.frameArray[target]; }

	//checks to see if there are nothing but newline characters in the text.
	//@returns true or false depending on whether or not the message is made up entirely of '\n'
	#seeIfNothingButNewlines(response) {
		let msg = response.split('');
		let is_empty = true;
		msg.forEach(item => {
			if (item != '\n') is_empty = false;
		});
		return is_empty;
    }
}

export default Post;