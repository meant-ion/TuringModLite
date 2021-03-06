//Scraper for a twitch chat. Ideally, it should gather all comments within a time period and process them to test for danger
//Danger being bad behavior in chat, use of certain words that could cause issues with the bot's text generation, etc. 
//It will generate a confidence report on the channel's culture and present that to the administrator through a Discord message
//If high enough, automatic approval for the bot. If not, either automatic rejection (i.e. paying per attempt at a post rather than per successful
//post) or admin will have to personally watch the stream and see what that culture is like

import dotenv from 'dotenv';
dotenv.config({ path: './.env'});
import fetch from 'node-fetch';

export class ChatScraper {

    //@params d_c Discord client
    constructor(d_c) {
        this.discord_client = d_c;
    }

    //@param channel_messages The combined messages of the chat room in one single prompt; what we will be using to test for approval
    //@return                 A confidence value of the chatroom being safe to use the bot on
    async analyzeChatHistory(channel_messages) {

        let total_words = channel_messages.split(" ");

        const testing_url = 'https://api.openai.com/v1/engines/content-filter-alpha-c4/completions';

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
        let bad_items_list = [];

        const toxic_threshold = -0.355;//probability that a "2" is real or discarded as false pos

        //loop through each token and see if we can include it in the final output
        for (let i = 0; i < total_words.length; ++i) {
            //get the rating of the token from the content filter engine
            let probs_output = "";
            let output_label = undefined;
            await fetch(testing_url,  { method: 'POST', headers: headers, body: JSON.stringify(testing_params) })
                .then(result => result.json())
                .then(body => {
                    probs_output = body;
                    output_label = body.choices[0].text;
                }).catch(err => {
                    console.log("Error in getting suitability rating for this channel");
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
                        if (logprob_0 >= logprob_1) output_label = "0";
                        else output_label = "1";
                        
                    } else if (logprob_0 != null) output_label = "0";
                    else if (logprob_1 != null) output_label = "1";
                }
            }

            //if the output is not 0, 1, or 2, we set it as 2 for safety
            if ((output_label != "0") && (output_label != "1") && (output_label != "2")) 
                output_label = "2";

            //if the token has been proven to not fall into a bad area/level of toxicity, 
            //we add it to the output text and send that out for approval for the bot's administrator
            if (output_label == "2") {
                bad_items_list.push(total_words[i]);
                total_bad_items++;
            }

            testing_params.prompt = "<|endoftext|>" + total_words[i] + "\n--\nLabel:";
        }

        //messages we send out to the server for admin's review of the channel
        let response_msg = `Total suspect words discovered in chat is ${total_bad_items} \n`;
        let list_msg = `This is the list of words found that were suspect: \n`;
        bad_items_list.forEach(word => {
            list_msg += word + '\n';
        });
        let askMsg = "Apply this channel to the bot? (Y/N): ";

        //send out the stats gained from this scraping and send out query to apply bot to channel 
        this.discord_client.channels.cache.get(process.env.SERVER_ID).send(response_msg);
        this.discord_client.channels.cache.get(process.env.SERVER_ID).send(list_msg);
        this.discord_client.channels.cache.get(process.env.SERVER_ID).send(askMsg);
        return true;
    }

}
export default ChatScraper;

