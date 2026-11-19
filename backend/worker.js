
const MODEL = "gemini-3.1-flash-lite";

const CORS_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type"
};

// Current Indian date and time
function getIndiaDateTime() {
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    dateStyle: "full",
    timeStyle: "long"
  }).format(new Date());
}

// ABHI AI personality
function buildSystemPrompt() {
  return `
You are ABHI AI, a personal AI companion.

YOUR IDENTITY:
- Your name is ABHI AI.
- Never call yourself My AI Friend.
- You are an AI, not a real human.
- Your purpose is to help, listen and communicate naturally.

CURRENT DATE AND TIME:
${getIndiaDateTime()}

TIMEZONE: Asia/Kolkata (IST, UTC+5:30).

IMPORTANT DATE RULES:
- Always use the current date and time provided above.
- Give the correct date and weekday when asked.
- Never guess dates or times.
- Never use outdated training information for today's date.
- Understand yesterday, today and tomorrow correctly.
- All dates must follow Indian Standard Time.

PERSONALITY:
- Talk like a caring and understanding friend.
- Show emotional intelligence.
- Respect the user in every situation.
- Understand sadness, happiness, frustration and excitement.
- Never judge or insult the user.
- Do not blindly agree with everything.
- Give honest and logical answers.
- Avoid robotic and repetitive responses.
- Do not overuse emojis.

LANGUAGE:
- Understand Bengali, English and Banglish.
- Reply in the language used by the user.
- Speak natural conversational Bengali.
- Understand informal spelling and everyday language.

CONVERSATION:
- Carefully understand previous messages.
- Maintain conversation context.
- Ask meaningful follow-up questions.
- Never give unrelated answers.
- Keep simple answers short.
- Explain complex topics clearly.
- Do not repeat unnecessary introductions.

FRIENDLY BEHAVIOUR:
- Listen patiently.
- Respond with empathy.
- Respect personal opinions.
- Be supportive without pretending to have human feelings.
- Never claim to remember information that is not available.

Your name is ABHI AI. Always maintain this identity.
`;
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: CORS_HEADERS
  });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export default {
  async fetch(request, env) {

    // Handle browser CORS
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: CORS_HEADERS
      });
    }

    if (request.method !== "POST") {
      return jsonResponse({
        error: "POST request required"
      }, 405);
    }

    try {

      // API Key check
      if (!env.GEMINI_API_KEY) {
        return jsonResponse({
          error: "Gemini API Key is missing."
        }, 500);
      }

      // Read user request
      let body;

      try {
        body = await request.json();
      } catch {
        return jsonResponse({
          error: "Invalid JSON request."
        }, 400);
      }

      // Support conversation history
      let inputMessages = [];

      if (Array.isArray(body.messages)) {
        inputMessages = body.messages;
      } else if (typeof body.message === "string") {
        inputMessages = [{
          role: "user",
          text: body.message
        }];
      } else if (typeof body.prompt === "string") {
        inputMessages = [{
          role: "user",
          text: body.prompt
        }];
      }

      // Convert frontend messages to Gemini format
      const messages = inputMessages
        .filter(item =>
          item &&
          typeof (item.text || item.content) === "string"
        )
        .slice(-20)
        .map(item => {

          let role = item.role;

          if (role === "assistant" || role === "ai") {
            role = "model";
          }

          if (role !== "user" && role !== "model") {
            return null;
          }

          return {
            role,
            parts: [{
              text: String(
                item.text || item.content
              ).trim().slice(0, 10000)
            }]
          };

        })
        .filter(Boolean)
        .filter(item => item.parts[0].text.length > 0);

      // Gemini requires conversation to start with user
      while (
        messages.length &&
        messages[0].role !== "user"
      ) {
        messages.shift();
      }

      if (!messages.length) {
        return jsonResponse({
          error: "Please enter a valid message."
        }, 400);
      }

      // Merge consecutive messages with same role
      const normalizedMessages = [];

      for (const message of messages) {

        const previous =
          normalizedMessages[normalizedMessages.length - 1];

        if (previous && previous.role === message.role) {
          previous.parts[0].text +=
            "\n" + message.parts[0].text;
        } else {
          normalizedMessages.push(message);
        }
      }

      // Gemini request
      const payload = {

        systemInstruction: {
          parts: [{
            text: buildSystemPrompt()
          }]
        },

        contents: normalizedMessages,

        generationConfig: {
          temperature: 0.85,
          topP: 0.95,
          maxOutputTokens: 1200
        }

      };

      const API_URL =
        `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

      let response;
      let data;

      // Retry temporary server overload
      for (let attempt = 0; attempt < 3; attempt++) {

        try {

          response = await fetch(API_URL, {
            method: "POST",

            headers: {
              "Content-Type": "application/json",
              "x-goog-api-key": env.GEMINI_API_KEY
            },

            body: JSON.stringify(payload)
          });

          const raw = await response.text();

          try {
            data = JSON.parse(raw);
          } catch {
            data = {
              error: {
                message: "Invalid Gemini response."
              }
            };
          }

        } catch (error) {

          if (attempt === 2) {
            throw new Error(
              "Unable to connect to Gemini API."
            );
          }

          await sleep(1500 * (attempt + 1));
          continue;
        }

        if (response.status !== 503) {
          break;
        }

        if (attempt < 2) {
          await sleep(1500 * (attempt + 1));
        }
      }

      // Handle Gemini errors
      if (!response || !response.ok) {

        const status = response?.status || 502;

        let message =
          data?.error?.message || "Gemini API Error.";

        if (status === 429) {
          message =
            "API quota exceeded. Please try again later.";
        }

        if (status === 503) {
          message =
            "Gemini is experiencing high demand. Please try again later.";
        }

        return jsonResponse({
          success: false,
          error: message,
          status
        }, status);
      }

      // Extract answer
      const answer = data.candidates?.[0]
        ?.content?.parts
        ?.map(part => part.text || "")
        .join("")
        .trim();

      if (!answer) {
        return jsonResponse({
          success: false,
          error: "ABHI AI could not generate a response."
        }, 502);
      }

      // Successful response
      return jsonResponse({
        success: true,
        answer: answer,
        model: MODEL,
        assistant: "ABHI AI"
      });

    } catch (error) {

      return jsonResponse({
        success: false,
        error: error.message || "Internal server error."
      }, 500);

    }
  }
};
  
