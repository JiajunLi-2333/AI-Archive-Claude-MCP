import express from "express";
import bodyParser, { json } from "body-parser";
import cors from "cors";


const app = express();
const PORT = 8000;

//Middle wares
app.use(cors());
app.use(bodyParser.json());

const  AIARCHIVES_API_URL = 'http://localhost:3000/api/conversation'; //the MCP server and the aiarchives server are running on the same machine



//? the function defined to save the conversation and pass it to AIARCHIVES_API_URL
async function saveConversationToAPI(htmlContent, model = "Claude") {
    try{
        console.log(`Saving conversation to API: ${AIARCHIVES_API_URL}`);
        console.log(`Model: ${model}, HTML size: ${htmlContent.length} bytes`);

        //save the file and the model information as formData 
        const formData = new FormData();
        formData.append('htmlDoc', new Blob([htmlDoc], { type: 'text/plain; charset=utf-8' }));
        formData.append('model', model);
        //Add the skipScraping key to the formData
        formData.append('skipScraping');

        const response = await fetch(AIARCHIVES_API_URL, {method: 'POST', formData});
        if(!response.ok){
            const errorText = await response.text();
            console.error(`API request failed: ${response.status} ${response.statusText}`);
            console.error('Error response:', errorText);
            throw new Error(`API request failed: ${response.status} ${errorText}`);
        }
    }
    catch(error){
        console.error('Error saving conversation to API:', error);
        throw error;
    }
}

app.post('/mcp', async(req, res) => {
    console.log("Received MCP request", JSON.stringify(req.body, null, 2));

    // array destructuring the request body
    const {method, params, id, jsonrpc} = req.body;

    try{

        //handle notifications that do not require a response id === undefined
        if(id === undefined && method){
            console.log(`Handling notofication: ${method}}`);
            switch(method){
                case 'notifications/initialized':
                    console.log("MCP server initialized successfully");
                    break;
                case 'notifications/cancelled':
                    console.log("MCP server canceled by the client");
                    break;
                default:
                    console.log(`Unknown notification: ${method}`);
            }
            res.status(204).end(); // No content response for notifications
            return;
        }

        //handle that we need required fields for method calls
        if(!method || !params || !jsonrpc){
            res.status(400).json({
                jsonrpc: "2.0",
                id: id || null,
                error: {
                    code: -32600,
                    message: "Invalid Request",
                    data: "Missing required fields: method, params, or jsonrpc"
                }
            })
            return;
        }

        //handle the method calls
        switch(method){
            case 'initialize':
                console.log("MCP server initialized successfully");
                res.json({
                    jsonrpc: "2.0",
                    id: id,
                    result:{
                       protocolVersion: '2025-06-18',
                       capabilities:{
                        tools: {}
                       },
                       serverInfo:{
                        name: "AI Archives MCP Server",
                        version: "1.0.0" 
                       }

                    }

                });
                break;
            case 'tools/list':
                console.log("Listing available tools");
                res.json({
                    jsonrpc: "2.0",
                    id: id,
                    result:{
                        tools:[
                            {
                                name: "save_conversation",
                                description: "Saves your entire LLM conversation to aiarchives.duckdns.org and returns a shareable URL. Please Provide the full convesation content as HTML in the conversation parameter. Use this after completing a conversation to create a permanent, shareable link",
                                inputSchema:{
                                    type: 'object',
                                    properties:{
                                        conversation: {
                                            type: "string",
                                            description: "Compelete the conversation content formatted as HTML with all messages and proper structure" 
                                        }
                                    },
                                    required: ['conversation']
                                }
                            }
                        ]
                    } 
                });
                break;
            case 'tools/call':
                if(!params || !params.name){
                    res.status(400).json({
                        jsonrpc: '2.0',
                        id: id,
                        error:{
                            code: -32602,
                            message: 'Invalid parameters - client tools/call request missing tool name to be used'
                        }

                    });
                    return;
                };
                //get the tool name and schema input
                const {name, arguments: args} = params;
                //TODO message to declare tools to be used selected by the LLM and the input schema is also provided by the LLM
                console.log(`Calling tool: ${name} with arguments:`, JSON.stringify(args, null, 2));

                switch(name){
                    case 'save_conversation':
                        try{
                            //Validate required arguments

                            //! If no conversation as html string is provided
                            if(!args.conversation){
                                res.status(400).json({
                                    jsonrpc: '2.0',
                                    id: id,
                                    error: {
                                        code: -32602,
                                        message: "Invalid Params: no conversation (HTML string) provided"
                                    }
                                })
                                return;
                            }
                            //! Validate if  the conversation is correctly passed to MCP server as string
                            if(typeof args.conversation !== 'string' || args.conversation.trim().length === 0){
                                res.status(400).json({
                                    jsonrpc : '2.0',
                                    id: id,
                                    error: {
                                        code: -32602,
                                        message: "Invalid Params: Converation data type not as string or empty conversation" 
                                    }
                                });
                                return;
                            };

                            //TODO save the conversation and pass it to API
                            const htmlContent = args.conversation;
                            const result = await saveConversationToAPI(htmlContent, "Claude");
                            const successMessage = `✅ Conversation saved successfully to aiarchives.duckdns.org!\n🔗 Shareable URL: ${result.url}\n📄 HTML content processed and archived`;

                            res.json({
                                jsonrpc: '2.0',
                                id: id,
                                result: {
                                    content: [{
                                        type: 'text',
                                        text: successMessage
                                    }]
                                }
                            });
                        }catch(error){
                            console.error('Error in save_conversation tool:', error);
                            res.status(500).json({
                                jsonrpc: '2.0',
                                id: id,
                                error:{
                                    code: -32603,
                                    message: `Failed to save conversation to aiarchives: ${error.message}`,
                                }
                            })
                        }
                        break;
                    default:
                        res.status(400).json({
                        jsonrpc:'2.0',
                        id: id,
                        error: {
                            code: -32601,
                            message: `Unknown tool: ${name}. Available tools: save_conversation`,
                        }
                    });
                }
            default:
                res.status(400).json({
                    jsonrpc: '2.0',
                    id: id,
                    error: {
                        code: -32601,
                        message: `Method not found: ${method}. Available methods: initialize, tools/list, tools/call`,
                    },
                });
        }
    }catch(error){
        console.error('Unexpected error processing MCP request:', error);
        res.status(500).json({
      jsonrpc: '2.0',
      id: id || null,
      error: {
        code: -32603,
        message: `Internal server error: ${error.message}`,
      },
    });
    }
})


app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    server: 'Aiarchives MCP Server',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    endpoints: {
      mcp: '/mcp',
      health: '/health'
    }
  });
});


app.get('/mcp', (req, res) => {
  res.json({
    message: 'Aiarchives MCP Server is running',
    note: 'Use POST requests for MCP protocol communication',
    server: 'Aiarchives MCP Server v1.0.0',
    protocol: 'JSON-RPC 2.0 over HTTP',
    availableTools: [
      {
        name: 'save_conversation',
        description: 'Save LLM conversations to aiarchives.duckdns.org with shareable URLs'
      }
    ],
    usage: 'Tell Claude: "Save this conversation" - Claude will automatically format as HTML',
    examples: [
      'Save this conversation',
      'Please save our chat to aiarchives',
      'Archive this conversation with a shareable link'
    ]
  });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Aiarchives MCP Server started successfully!`);
  console.log(`📡 Server listening on: http://0.0.0.0:${PORT}`);
  console.log(`🏥 Health check endpoint: http://0.0.0.0:${PORT}/health`);
  console.log(`🔌 MCP protocol endpoint: http://0.0.0.0:${PORT}/mcp`);
  console.log(`🎯 Connected to aiarchives API: ${AIARCHIVES_API_URL}`);
  console.log(`⏰ Started at: ${new Date().toISOString()}`);
  console.log('');
  console.log('🔧 Available tools: save_conversation');
  console.log('💬 Usage: Tell Claude to "Save this conversation as [title]"');
});
