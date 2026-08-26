import Fastify from 'fastify';
import WebSocket from 'ws';
import dotenv from 'dotenv';
import fastifyFormBody from '@fastify/formbody';
import fastifyWs from '@fastify/websocket';
import twilio from 'twilio'; 
import { google } from 'googleapis';
// Load environment variables from .env file
dotenv.config();
const googleOAuth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI
);

const GOOGLE_CONTACTS_SCOPE =
  'https://www.googleapis.com/auth/contacts.readonly';
// Retrieve the OpenAI API key from environment variables.
const { OPENAI_API_KEY } = process.env;

if (!OPENAI_API_KEY) {
    console.error('Missing OpenAI API key. Please set it in the .env file.');
    process.exit(1);
}
async function findContactByName(searchName) {
  const auth = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );

  auth.setCredentials({
    refresh_token: process.env.GOOGLE_REFRESH_TOKEN
  });

  const people = google.people({
    version: 'v1',
    auth
  });

  let pageToken;
  const matches = [];

  do {
    const result = await people.people.connections.list({
      resourceName: 'people/me',
      pageSize: 1000,
      pageToken,
      personFields: 'names,phoneNumbers'
    });

    const contacts = result.data.connections || [];

    for (const contact of contacts) {
      const names = contact.names || [];
      const phones = contact.phoneNumbers || [];

      const displayName = names[0]?.displayName;

      if (
        displayName &&
        displayName.toLowerCase().includes(searchName.toLowerCase()) &&
        phones.length > 0
      ) {
        matches.push({
          name: displayName,
          phone_number: phones[0].value
        });
      }
    }

    pageToken = result.data.nextPageToken;
  } while (pageToken);

  return matches;
}
// Initialize Fastify
const fastify = Fastify();
fastify.register(fastifyFormBody);
fastify.register(fastifyWs);
fastify.addContentTypeParser(
  'application/sdp',
  { parseAs: 'string' },
  (request, body, done) => {
    done(null, body);
  }
);
// Constants
const SYSTEM_MESSAGE = `
أنت المساعد التنفيذي الذكي الخاص بيانال.

تتحدث العربية والإنجليزية بطلاقة، وتتعرف تلقائيًا على لغة المتصل وترد بنفس اللغة. أسلوبك احترافي، طبيعي، هادئ، مختصر وواضح، ولا تبدو كروبوت.

ابدأ كل مكالمة بتحية قصيرة:
"مرحباً، معك المساعد الذكي الخاص بيانال، كيف يمكنني مساعدتك؟"

مهامك:
1. معرفة سبب الاتصال بسرعة.
2. أخذ اسم المتصل ورقم هاتفه عند الحاجة.
3. تسجيل الرسائل المهمة بوضوح.
4. المساعدة في تنسيق المواعيد والاجتماعات.
5. إذا طلب المتصل التحدث مع يانال، اسأله عن اسمه وسبب الاتصال قبل محاولة التحويل.
6. إذا كانت المكالمة عاجلة، اذكر أنك ستسجلها كأولوية عالية.
7. لا تخترع أي معلومة غير متأكد منها.
8. إذا لم تعرف الإجابة، قل:
"سأتأكد من هذه المعلومة وأطلب من يانال أو الفريق التواصل معك."
9. لا تكشف أي معلومات شخصية أو سرية عن يانال أو عمله.
10. اجعل الردود قصيرة ومناسبة للمحادثة الهاتفية، وتجنب الشرح الطويل.

إذا تحدث المتصل بالإنجليزية، تحدث معه بالإنجليزية بشكل طبيعي واحترافي.

في نهاية المكالمة، لخّص داخليًا:
- اسم المتصل
- رقم الهاتف إن توفر
- سبب الاتصال
- مستوى الأولوية
- أي موعد أو طلب متابعة
عند طلب المستخدم الاتصال بشخص بالاسم وليس برقم هاتف:
1. استخدم أداة find_contact للبحث عن الاسم داخل Google Contacts.
2. إذا وجدت نتيجة واحدة فقط، استخدم رقمها مع أداة make_phone_call.
3. إذا وجدت أكثر من نتيجة بنفس الاسم، اسأل المستخدم أي شخص يقصد قبل إجراء المكالمة.
4. إذا لم تجد الاسم، أخبر المستخدم أنك لم تجد جهة الاتصال.
5. لا تخمّن أرقام الهواتف ولا تختار شخصاً من تلقاء نفسك.
When the user asks to call a person by name:
1. ALWAYS use find_contact first.
2. Use the phone number returned by find_contact.
3. Then ALWAYS call make_phone_call with that phone number.
4. Never say that a call was made unless make_phone_call returns success.
5. Do not ask the user for the phone number if the contact can be found in Google Contacts.
إذا طلب المستخدم الاتصال بشخص بالاسم، استخدم find_contact أولاً دائماً، ثم استخدم الرقم الناتج مع make_phone_call. لا تقل إن الاتصال تم إلا بعد نجاح الأداة.
If this is an outbound phone call:
- You are calling on behalf of Yanal Ajilat.
- Immediately introduce yourself as Yanal's AI assistant.
- Clearly state that you are calling on Yanal's behalf.
- Deliver the user's requested message clearly and briefly.
- Do not behave as if the person answering is Yanal.
- Do not ask the recipient for commands or act like their personal assistant.
- After delivering the message, ask only if they would like to leave a short reply for Yanal.
- If there is no reply, politely end the call.
إذا كانت المكالمة صادرة:
أنت المساعد الذكي الخاص بينال عجيلات.
عرّف عن نفسك فورًا وقل إنك تتصل نيابةً عن ينال.
أوصل الرسالة المطلوبة بوضوح واختصار.
لا تتعامل مع الشخص الذي أجاب وكأنه ينال.
لا تنتظر منه أوامر كمساعد شخصي له.
بعد إيصال الرسالة اسأله فقط إذا كان يريد ترك رد قصير لينال.
ثم أنهِ المكالمة بأدب.
`;
const VOICE = 'alloy';
const TEMPERATURE = 0.8; // Controls the randomness of the AI's responses
const PORT = process.env.PORT || 5050; // Allow dynamic port assignment

// List of Event Types to log to the console. See the OpenAI Realtime API Documentation: https://platform.openai.com/docs/api-reference/realtime
const LOG_EVENT_TYPES = [
    'error',
    'response.content.done',
    'rate_limits.updated',
    'response.done',
    'input_audio_buffer.committed',
    'input_audio_buffer.speech_stopped',
    'input_audio_buffer.speech_started',
    'session.created',
    'session.updated'
];

// Show AI response elapsed timing calculations
const SHOW_TIMING_MATH = false;

// Root Route
fastify.get('/', async (request, reply) => {
    reply.send({ message: 'Twilio Media Stream Server is running!' });
});
fastify.get('/realtime-token', async (request, reply) => {
  try {
    const response = await fetch(
      'https://api.openai.com/v1/realtime/client_secrets',
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${OPENAI_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          session: {
            type: 'realtime',
            model: 'gpt-realtime',
            instructions: SYSTEM_MESSAGE,
            audio: {
              output: {
                voice: VOICE
              }
            }
          }
        })
      }
    );

    const data = await response.json();

    if (!response.ok) {
      console.error('Realtime token error:', data);
      return reply.code(response.status).send(data);
    }

    return reply.send(data);

  } catch (error) {
    console.error('Realtime token creation failed:', error);
    return reply.code(500).send({
      error: error.message
    });
  }
});
fastify.get('/assistant', async (request, reply) => {
  return reply
    .type('text/html')
    .send(`<!doctype html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Yanal AI Assistant</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      text-align: center;
      padding: 60px 20px;
      background-color: #0f172a;
      color: #f8fafc;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      min-height: 80vh;
    }
    button {
      font-size: 20px;
      padding: 16px 36px;
      border-radius: 50px;
      border: none;
      background-color: #2563eb;
      color: white;
      cursor: pointer;
      font-weight: bold;
      box-shadow: 0 4px 15px rgba(37, 99, 235, 0.4);
      transition: all 0.2s ease;
    }
    button:active { transform: scale(0.96); }
    #status {
      margin-top: 25px;
      font-size: 18px;
      color: #94a3b8;
    }
  </style>
</head>
<body>
  <h2>Yanal AI Assistant</h2>
  <button id="talkBtn">تحدث مع المساعد</button>
  <div id="status">جاهز للاستخدام</div>

  <script>
    let pc = null;
    let localStream = null;
    const talkBtn = document.getElementById('talkBtn');
    const statusEl = document.getElementById('status');

    // عنصر الصوت
    const audioEl = document.createElement('audio');
    audioEl.autoplay = true;
    audioEl.playsInline = true;
    document.body.appendChild(audioEl);

    talkBtn.onclick = async () => {
      if (pc) {
        if (localStream) localStream.getTracks().forEach(t => t.stop());
        pc.close();
        pc = null;
        statusEl.textContent = 'جاهز للاستخدام';
        talkBtn.textContent = 'تحدث مع المساعد';
        talkBtn.style.backgroundColor = '#2563eb';
        return;
      }

      try {
        statusEl.textContent = 'جاري الاتصال...';
        talkBtn.disabled = true;

        // 1. طلب الميكروفون
        localStream = await navigator.mediaDevices.getUserMedia({ audio: true });

        // 2. إنشاء اتصال WebRTC
        pc = new RTCPeerConnection();

        // 3. ربط مسار الصوت القادم
        pc.ontrack = (event) => {
          audioEl.srcObject = event.streams[0];
          audioEl.play().catch(e => console.error('Audio play error:', e));
        };

        // 4. إضافة مسار الميكروفون
        localStream.getTracks().forEach(track => pc.addTrack(track, localStream));

        // 5. Data Channel
        const dc = pc.createDataChannel('oai-events');
        dc.onopen = () => {
          statusEl.textContent = '🟢 متصل — تفضل بالتحدث الآن';
          talkBtn.textContent = 'إنهاء المكالمة';
          talkBtn.style.backgroundColor = '#dc2626';
          talkBtn.disabled = false;
        };
dc.onmessage = async (event) => {
  try {
    const response = JSON.parse(event.data);

    console.log('Realtime event:', response.type, response.name || '');

    // البحث عن شخص في Google Contacts
    if (
      response.type === 'response.function_call_arguments.done' &&
      response.name === 'find_contact'
    ) {
      const args = JSON.parse(response.arguments);

      statusEl.textContent = '🔎 جاري البحث عن ' + args.contact_name;

      const r = await fetch('/assistant/find-contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contact_name: args.contact_name
        })
      });

      const result = await r.json();

      dc.send(JSON.stringify({
        type: 'conversation.item.create',
        item: {
          type: 'function_call_output',
          call_id: response.call_id,
          output: JSON.stringify(result)
        }
      }));

      dc.send(JSON.stringify({
        type: 'response.create'
      }));
    }

    // إجراء المكالمة
    if (
      response.type === 'response.function_call_arguments.done' &&
      response.name === 'make_phone_call'
    ) {
      const args = JSON.parse(response.arguments);

      statusEl.textContent = '📞 جاري الاتصال...';

      const r = await fetch('/assistant/make-phone-call', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phone_number: args.phone_number,
          message: args.message
        })
      });

      const result = await r.json();

      dc.send(JSON.stringify({
        type: 'conversation.item.create',
        item: {
          type: 'function_call_output',
          call_id: response.call_id,
          output: JSON.stringify(result)
        }
      }));

      dc.send(JSON.stringify({
        type: 'response.create'
      }));

      statusEl.textContent =
        result.success ? '✅ تم بدء الاتصال' : '❌ فشل الاتصال';
    }

  } catch (error) {
    console.error('Data channel tool error:', error);
    statusEl.textContent = '❌ خطأ بتنفيذ الأمر';
  }
};
        // 6. إنشاء Offer وإرساله للسيرفر
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);

        const sdpResponse = await fetch('/session', {
          method: 'POST',
          body: offer.sdp,
          headers: { 'Content-Type': 'application/sdp' }
        });

        if (!sdpResponse.ok) {
          throw new Error('Server returned status: ' + sdpResponse.status);
        }

        const answerSdp = await sdpResponse.text();
        await pc.setRemoteDescription({ type: 'answer', sdp: answerSdp });

      } catch (err) {
        console.error('Error:', err);
        statusEl.textContent = 'فشل الاتصال: ' + err.message;
        talkBtn.disabled = false;
        if (pc) { pc.close(); pc = null; }
      }
    };
  </script>
</body>
</html>`);
});
fastify.post('/session', async (request, reply) => {
  try {
    const form = new FormData();

    // IMPORTANT: SDP must be a normal multipart field
    form.append('sdp', request.body);

    form.append(
  'session',
  JSON.stringify({
    type: 'realtime',
    model: 'gpt-realtime',
    instructions: SYSTEM_MESSAGE,

    tools: [
      {
        type: 'function',
        name: 'find_contact',
        description: 'Search the user Google Contacts by person name before making a call.',
        parameters: {
          type: 'object',
          properties: {
            contact_name: {
              type: 'string',
              description: 'Name of the person to search for'
            }
          },
          required: ['contact_name']
        }
      },
     {
  type: 'function',
  name: 'make_phone_call',
  description: 'Call a person on behalf of Yanal and deliver a specific message.',
  parameters: {
    type: 'object',
    properties: {
      phone_number: {
        type: 'string',
        description: 'Phone number in international E.164 format, for example +96279...'
      },
      message: {
        type: 'string',
        description: 'The exact message Yanal wants the assistant to deliver to the person.'
      }
    },
    required: ['phone_number', 'message']
  }
}
    ],

    tool_choice: 'auto',

    audio: {
      output: {
        voice: VOICE
      }
    }
  })
);
    const response = await fetch(
      'https://api.openai.com/v1/realtime/calls',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY}`
        },
        body: form
      }
    );

    const responseText = await response.text();

    if (!response.ok) {
      console.error(
        'OpenAI WebRTC error:',
        response.status,
        responseText
      );

      return reply
        .code(response.status)
        .type('text/plain')
        .send(responseText);
    }

    return reply
      .type('application/sdp')
      .send(responseText);

  } catch (error) {
    console.error('/session error:', error);

    return reply.code(500).send({
      error: error.message
    });
  }
});
fastify.post('/assistant/find-contact', async (request, reply) => {
  try {
    const { contact_name } = request.body;

    console.log('Browser assistant searching for:', contact_name);

    const contacts = await findContactByName(contact_name);

    console.log('Contact search result:', contacts);

    return reply.send({
      success: true,
      contacts: contacts
    });

  } catch (error) {
    console.error('Browser contact search failed:', error);

    return reply.code(500).send({
      success: false,
      error: error.message
    });
  }
});
fastify.post('/assistant/make-phone-call', async (request, reply) => {
  try {
    const { phone_number, message } = request.body;

    if (!phone_number) {
      return reply.code(400).send({
        success: false,
        error: 'Missing phone number'
      });
    }

    console.log('Browser assistant requested call to:', phone_number);

    const call = await twilioClient.calls.create({
      to: phone_number,
      from: '+962796677176',
url: 'https://speech-assistant-openai-realtime-api-syjo.onrender.com/outgoing-call?message='
  + encodeURIComponent(message || '')   
    });

    console.log('Browser outbound call started:', call.sid);

    return reply.send({
      success: true,
      phone_number: phone_number,
      call_sid: call.sid
    });

  } catch (error) {
    console.error('Browser outbound call failed:', error);

    return reply.code(500).send({
      success: false,
      error: error.message
    });
  }
});
// Route for Twilio to handle incoming calls
// <Say> punctuation to improve text-to-speech translation
fastify.all('/incoming-call', async (request, reply) => {
    const twimlResponse = `<?xml version="1.0" encoding="UTF-8"?>
                          <Response>
                              <Connect>
                                  <Stream url="wss://${request.headers.host}/media-stream" />
                              </Connect>
                          </Response>`;

    reply.type('text/xml').send(twimlResponse);
});

// WebSocket route for media-stream
fastify.register(async (fastify) => {
    fastify.get('/media-stream', { websocket: true }, (connection, req) => {
        console.log('Client connected');

        // Connection-specific state
        let streamSid = null;
        let latestMediaTimestamp = 0;
        let lastAssistantItem = null;
        let markQueue = [];
        let responseStartTimestampTwilio = null;

        const openAiWs = new WebSocket(`wss://api.openai.com/v1/realtime?model=gpt-realtime&temperature=${TEMPERATURE}`, {
            headers: {
                Authorization: `Bearer ${OPENAI_API_KEY}`,
            }
        });

        // Control initial session with OpenAI
        const initializeSession = () => {
            const sessionUpdate = {
            type: 'session.update',
            session: {
                type: 'realtime',
                model: "gpt-realtime",
                output_modalities: ["audio"],
                audio: {
                    input: { format: { type: 'audio/pcmu' }, turn_detection: { type: "server_vad" } },
                    output: { format: { type: 'audio/pcmu' }, voice: VOICE },
                },
                instructions: SYSTEM_MESSAGE,
                tools: [
                  {
  type: "function",
  name: "find_contact",
  description: "Search the user's Google Contacts for a person by name before making a phone call.",
  parameters: {
    type: "object",
    properties: {
      contact_name: {
        type: "string",
        description: "The person's name, for example Ahmad, Mohammad, Rami, يوسف, محمد"
      }
    },
    required: ["contact_name"]
  }
},
  {
    type: "function",
    name: "make_phone_call",
    description: "Make an outbound phone call when the user asks to call a phone number.",
    parameters: {
      type: "object",
      properties: {
        phone_number: {
          type: "string",
          description: "Phone number in international E.164 format, for example +962791234567"
        }
      },
      required: ["phone_number"]
    }
  }
],
tool_choice: "auto",
            },
        };

        console.log('Sending session update:', JSON.stringify(sessionUpdate));
        openAiWs.send(JSON.stringify(sessionUpdate));

        // إرسال الترحيب العربي فوراً عند فتح الاتصال
        const greetingItem = {
            type: 'conversation.item.create',
            item: {
                type: 'message',
                role: 'user',
                content: [
                    {
                        type: 'input_text',
                        text: "قل الآن باللغة العربية: أهلاً بك، معك المساعد الذكي للأستاذ ينال. كيف يمكنني مساعدتك اليوم؟"
                    }
                ]
            }
        };
        openAiWs.send(JSON.stringify(greetingItem));
        openAiWs.send(JSON.stringify({ type: 'response.create' }));
    };
        

        // Handle interruption when the caller's speech starts
        const handleSpeechStartedEvent = () => {
            if (markQueue.length > 0 && responseStartTimestampTwilio != null) {
                const elapsedTime = latestMediaTimestamp - responseStartTimestampTwilio;
                if (SHOW_TIMING_MATH) console.log(`Calculating elapsed time for truncation: ${latestMediaTimestamp} - ${responseStartTimestampTwilio} = ${elapsedTime}ms`);

                if (lastAssistantItem) {
                    const truncateEvent = {
                        type: 'conversation.item.truncate',
                        item_id: lastAssistantItem,
                        content_index: 0,
                        audio_end_ms: elapsedTime
                    };
                    if (SHOW_TIMING_MATH) console.log('Sending truncation event:', JSON.stringify(truncateEvent));
                    // openAiWs.send(JSON.stringify(truncateEvent));
                }

                connection.send(JSON.stringify({
                    event: 'clear',
                    streamSid: streamSid
                }));

                // Reset
                markQueue = [];
                lastAssistantItem = null;
                responseStartTimestampTwilio = null;
            }
        };

        // Send mark messages to Media Streams so we know if and when AI response playback is finished
        const sendMark = (connection, streamSid) => {
            if (streamSid) {
                const markEvent = {
                    event: 'mark',
                    streamSid: streamSid,
                    mark: { name: 'responsePart' }
                };
                connection.send(JSON.stringify(markEvent));
                markQueue.push('responsePart');
            }
        };

        // Open event for OpenAI WebSocket
        openAiWs.on('open', () => {
            console.log('Connected to the OpenAI Realtime API');
            setTimeout(initializeSession, 100);
        });

        // Listen for messages from the OpenAI WebSocket (and send to Twilio if necessary)
        openAiWs.on('message', async (data) => {
            try {
                const response = JSON.parse(data);

                if (LOG_EVENT_TYPES.includes(response.type)) {
                    console.log(`Received event: ${response.type}`, response);
                }

                if (response.type === 'response.output_audio.delta' && response.delta) {
                    const audioDelta = {
                        event: 'media',
                        streamSid: streamSid,
                        media: { payload: response.delta }
                    };
                    connection.send(JSON.stringify(audioDelta));

                    // First delta from a new response starts the elapsed time counter
                    if (!responseStartTimestampTwilio) {
                        responseStartTimestampTwilio = latestMediaTimestamp;
                        if (SHOW_TIMING_MATH) console.log(`Setting start timestamp for new response: ${responseStartTimestampTwilio}ms`);
                    }

                    if (response.item_id) {
                        lastAssistantItem = response.item_id;
                    }
                    
                    sendMark(connection, streamSid);
                }
              if (
  response.type === 'response.function_call_arguments.done' &&
  response.name === 'find_contact'
) {
  try {
    const args = JSON.parse(response.arguments);
    const contactName = args.contact_name;

    console.log(`Searching Google Contacts for: ${contactName}`);

    const contacts = await findContactByName(contactName);

    openAiWs.send(JSON.stringify({
      type: 'conversation.item.create',
      item: {
        type: 'function_call_output',
        call_id: response.call_id,
        output: JSON.stringify({
          success: true,
          search_name: contactName,
          contacts
        })
      }
    }));

    openAiWs.send(JSON.stringify({
      type: 'response.create'
    }));

  } catch (error) {
    console.error('Google Contacts search failed:', error);

    openAiWs.send(JSON.stringify({
      type: 'conversation.item.create',
      item: {
        type: 'function_call_output',
        call_id: response.call_id,
        output: JSON.stringify({
          success: false,
          error: error.message
        })
      }
    }));

    openAiWs.send(JSON.stringify({
      type: 'response.create'
    }));
  }
}
if (
  response.type === 'response.function_call_arguments.done' &&
  response.name === 'make_phone_call'
) {
  try {
    const args = JSON.parse(response.arguments);
    const phoneNumber = args.phone_number;

    console.log('AI requested phone call to:', phoneNumber);

    if (!phoneNumber) {
      throw new Error('No phone number received from AI');
    }

    const call = await twilioClient.calls.create({
      to: phoneNumber,
      from: process.env.TWILIO_PHONE_NUMBER,
      url: 'https://speech-assistant-openai-realtime-api-syjo.onrender.com/outgoing-call'
    });

    console.log('Outbound call started:', call.sid);

    openAiWs.send(JSON.stringify({
      type: 'conversation.item.create',
      item: {
        type: 'function_call_output',
        call_id: response.call_id,
        output: JSON.stringify({
          success: true,
          call_sid: call.sid,
          phone_number: phoneNumber
        })
      }
    }));

    openAiWs.send(JSON.stringify({
      type: 'response.create'
    }));

  } catch (error) {
    console.error('MAKE PHONE CALL ERROR:', error);

    openAiWs.send(JSON.stringify({
      type: 'conversation.item.create',
      item: {
        type: 'function_call_output',
        call_id: response.call_id,
        output: JSON.stringify({
          success: false,
          error: error.message
        })
      }
    }));

    openAiWs.send(JSON.stringify({
      type: 'response.create'
    }));
  }
}
  
                if (response.type === 'input_audio_buffer.speech_started') {
                    handleSpeechStartedEvent();
                }
            } catch (error) {
                console.error('Error processing OpenAI message:', error, 'Raw message:', data);
            }
        });

        // Handle incoming messages from Twilio
        connection.on('message', (message) => {
            try {
                const data = JSON.parse(message);

                switch (data.event) {
                    case 'media':
                        latestMediaTimestamp = data.media.timestamp;
                        if (SHOW_TIMING_MATH) console.log(`Received media message with timestamp: ${latestMediaTimestamp}ms`);
                        if (openAiWs.readyState === WebSocket.OPEN) {
                            const audioAppend = {
                                type: 'input_audio_buffer.append',
                                audio: data.media.payload
                            };
                            openAiWs.send(JSON.stringify(audioAppend));
                        }
                        break;
                   case 'start': {
    streamSid = data.start.streamSid;

    const customParameters = data.start.customParameters || {};
    const callType = customParameters.callType || 'incoming';
    const outboundMessage = customParameters.message || '';

    console.log('Stream started:', streamSid);
    console.log('Call type:', callType);
    console.log('Message to deliver:', outboundMessage);

    // Reset timestamps on a new stream
    responseStartTimestampTwilio = null;
    latestMediaTimestamp = 0;

    if (
        callType === 'outbound' &&
        openAIWs.readyState === WebSocket.OPEN
    ) {
        const outboundInstructions = `
أنت الآن تجري مكالمة هاتفية صادرة نيابة عن ينال عجيلات.

مهم جداً:
- الشخص الذي أجاب على الهاتف ليس ينال.
- عرّف عن نفسك بوضوح بأنك المساعد الذكي الخاص بينال عجيلات.
- أخبره أنك تتصل نيابة عن ينال.
- أوصل الرسالة التالية بوضوح وباختصار:
"${outboundMessage}"

- لا تطلب من الشخص أوامر.
- لا تتصرف كمساعد شخصي له.
- بعد توصيل الرسالة اسأله إن كان يريد ترك رد قصير لينال.
- كن مهذباً وطبيعياً.
- لا تدّعي أنك إنسان.
`;

        openAIWs.send(JSON.stringify({
            type: 'session.update',
            session: {
                instructions: outboundInstructions
            }
        }));

        // اجعل المساعد يبدأ الكلام فوراً عند الرد
        openAIWs.send(JSON.stringify({
            type: 'response.create'
        }));
    }

    break;
}
            } catch (error) {
                console.error('Error parsing message:', error, 'Message:', message);
            }
        });

        // Handle connection close
        connection.on('close', () => {
            if (openAiWs.readyState === WebSocket.OPEN) openAiWs.close();
            console.log('Client disconnected.');
        });

        // Handle WebSocket close and errors
        openAiWs.on('close', () => {
            console.log('Disconnected from the OpenAI Realtime API');
        });

        openAiWs.on('error', (error) => {
            console.error('Error in the OpenAI WebSocket:', error);
        });
    });
});
const twilioClient = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

const TWILIO_PHONE_NUMBER = process.env.TWILIO_PHONE_NUMBER;

fastify.post('/make-call', async (request, reply) => {
  try {
    const { to } = request.body;

    if (!to) {
      return reply.code(400).send({ error: 'Missing phone number' });
    }

    const call = await twilioClient.calls.create({
      to: to,
      from: TWILIO_PHONE_NUMBER,
      url: `https://${request.headers.host}/outgoing-call`
    });

    return {
      success: true,
      callSid: call.sid
    };

  } catch (error) {
    console.error('Error making outbound call:', error);

    return reply.code(500).send({
      success: false,
      error: error.message
    });
  }
});

fastify.all('/outgoing-call', async (request, reply) => {
  const rawMessage = String(request.query?.message || '');

  // حماية النص حتى يدخل داخل TwiML بدون كسر XML
  const message = rawMessage
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  console.log('Outbound message to deliver:', rawMessage);

  const twimlResponse = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <Stream url="wss://${request.headers.host}/media-stream">
      <Parameter name="callType" value="outbound" />
      <Parameter name="message" value="${message}" />
    </Stream>
  </Connect>
</Response>`;

  reply.type('text/xml').send(twimlResponse);
});
fastify.get('/auth/google', async (request, reply) => {
  const authUrl = googleOAuth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: [GOOGLE_CONTACTS_SCOPE]
  });

  return reply.redirect(authUrl);
});

fastify.get('/auth/google/callback', async (request, reply) => {
  try {
    const { code } = request.query;

    if (!code) {
      return reply.code(400).send('Missing authorization code.');
    }

    const { tokens } = await googleOAuth2Client.getToken(code);

    if (!tokens.refresh_token) {
      return reply.send(
        'Google connected, but no refresh token was returned. Please authorize again.'
      );
    }

    return reply.type('text/html').send(`
      <h2>Google Contacts connected successfully</h2>
      <p>Copy this refresh token and save it in Render as GOOGLE_REFRESH_TOKEN:</p>
      <textarea style="width:90%;height:120px;">${tokens.refresh_token}</textarea>
      <p>Keep this token private.</p>
    `);

  } catch (error) {
    console.error('Google OAuth error:', error);
    return reply.code(500).send('Google authorization failed.');
  }
});
fastify.listen({ port: PORT, host: '0.0.0.0' }, (err) => {    
    if (err) {
        console.error(err);
        process.exit(1);
    }
    console.log(`Server is listening on port ${PORT}`);
});
