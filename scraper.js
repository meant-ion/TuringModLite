//Scraper for a twitch chat. Ideally, it should gather all comments within a time period and process them to test for danger
//Danger being bad behavior in chat, use of certain words that could cause issues with the bot's text generation, etc. 
//It will generate a confidence report on the channel's culture and present that to the administrator through a Discord message
//If high enough, automatic approval for the bot. If not, either automatic rejection (i.e. paying per attempt at a post rather than per successful
//post) or admin will have to personally watch the stream and see what that culture is like

require('dotenv').config({ path: './.env' });
const got = require('got');

class ChatScraper {

    //@params d_c Discord client
    constructor(d_c) {
        this.discord_client = d_c;
        this.scraped_chat_history = "";
    }

    //@param channel_messages The combined messages of the chat room in one single prompt; what we will be using to test for approval
    //@return                 A confidence value of the chatroom being safe to use the bot on
    async analyzeChatHistory(channel_messages) {
        this.scraped_chat_history = channel_messages.prompt;

        let total_words = this.scraped_chat_history.split(" ");

        //the headers, which is effectively the API key for GPT-3 to be sent for model access
        const headers = {
            'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
            'Content-Type': 'application/json',
        };

        let testing_params = {
            "prompt": "<|endoftext|>" + total_words[0] + "\n--\nLabel:",
            "max_tokens": 1,
            "temperature": 0.0,
            "top_p": 1,
            "frequency_penalty": 0.3,
            "presence_penalty": 0.3,
            "logprobs": 10
        };

        let total_bad_items = 0;

        //loop through each token and see if we can include it in the final output
        for (let i = 0; i < total_words.length; ++i) {
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
            if (output_label == "2") {
                total_bad_items++;
            }

            testing_params.prompt = "<|endoftext|>" + total_words[i] + "\n--\nLabel:";
        }

        let responseMsg = `Total suspect words discovered in chat is ${total_bad_items} `;
        let askMsg = "Apply this channel to the bot? (Y/N): ";

        this.discord_client.channels.cache.get(process.env.SERVER_ID).send(responseMsg);
        if (tested_output == "" || tested_output == "\n" || this.#seeIfNothingButNewlines(tested_output)) {
            this.discord_client.channels.cache.get(process.env.SERVER_ID).send("Empty Response");
        } else {
            this.discord_client.channels.cache.get(process.env.SERVER_ID).send(tested_output);
        }
        
        this.discord_client.channels.cache.get(process.env.SERVER_ID).send(askMsg);


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

}
module.exports = ChatScraper;

