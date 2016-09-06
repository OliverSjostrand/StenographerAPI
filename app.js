//Author: Oliver Sjostrand
//Email: Oliver.Sjostrand@hotmail.se

var vcapServices = require('vcap_services'),
    extend = require('util')._extend,
    watson = require('watson-developer-cloud'),
    AlchemyAPI = require('./src/alchemyapi'),
    WebSocketClient = require('websocket').client,
    WebSocketServer = require('websocket').server,
    pkgcloud = require('pkgcloud'),
    fs = require('fs');

var alchemyapi = new AlchemyAPI();
var wsURI;
//websocket server
var wav = require('wav');
var http = require('http');



function getDateTime() {
    var now = new Date();
    var year = now.getFullYear();
    var month = now.getMonth() + 1;
    var day = now.getDate();
    var hour = now.getHours();
    var minute = now.getMinutes();
    var second = now.getSeconds();
    if (month.toString().length == 1) {
        var month = '0' + month;
    }
    if (day.toString().length == 1) {
        var day = '0' + day;
    }
    if (hour.toString().length == 1) {
        var hour = '0' + hour;
    }
    if (minute.toString().length == 1) {
        var minute = '0' + minute;
    }
    if (second.toString().length == 1) {
        var second = '0' + second;
    }
    var dateTime = year + '-' + month + '-' + day + '_' + hour + '.' + minute + '.' + second;
    return dateTime;
}

// Enter username and password for watson speech to text
var config = extend({
    version: 'v1',
    url: 'https://stream.watsonplatform.net/speech-to-text/api',
    username: 'XXXX',
    password: 'XXXX'
}, vcapServices.getCredentials('speech_to_text'));

function getTok() {
    authService.getToken({
        url: config.url
    }, function(err, token) {
        if (err) {
            console.log("error getting token");
        } else
            console.log("token recived");
        console.log(token);
        wsURI = "wss://stream.watsonplatform.net/speech-to-text/api/v1/recognize?watson-token=" + token + "&model=en-US_BroadbandModel"

        return token;
    });
};

var authService = watson.authorization(config);
var token = getTok();

var server = http.createServer(function(request, response) {
    console.log((new Date()) + ' Received request for ' + request.url);
    response.writeHead(404);
    response.end();
});


var server_port = process.env.VCAP_APP_PORT || 8080;
server.listen(server_port, function() {
    console.log((new Date()) + ' Server is listening on port 8080');
});

wsServer = new WebSocketServer({
    httpServer: server,
    autoAcceptConnections: false
});

function originIsAllowed(origin) {
    // put logic here to detect whether the specified origin is allowed. 
    return true;
}

wsServer.on('request', function(request) {

    var entities = null;
    var output = "";
    var outputBuilder = "";
    var userID = "noUserID";
    var clientConnection;
    var client = new WebSocketClient();
    var filename = getDateTime();


    //save a copy of the recived audio locally
    var fileWriter = new wav.FileWriter("./" + filename + ".wav", {
        channels: 1,
        sampleRate: 16000,
        bitDepth: 16
    });

    var readStream = fs.createReadStream(filename + '.wav');
    var writeStream = storageClient.upload({
        container: userID,
        remote: userID + '_' + filename + '.wav'
    });

    //Object storage container options
    var options = {
        name: userID,
        metadata: {
            color: "blue",
            flower: "daisy"
        }
    };



    writeStream.on('error', function(err) {
        console.log("error: " + err);
        // handle your error case 
    });

    writeStream.on('success', function(file) {
        console.log("file uploaded");
        //delete local file
        fs.unlink(filename + '.wav');
    });

    if (!originIsAllowed(request.origin)) {
        // Make sure we only accept requests from an allowed origin 
        request.reject();
        console.log((new Date()) + ' Connection from origin ' + request.origin + ' rejected.');
        return;
    }


    var serverConnection = request.accept('echo-protocol', request.origin);
    console.log((new Date()) + ' User connection to server accepted.');


    //open client connection to Watson STT

    function sendMessage(message, client) {
        // Wait until the state of the socket is not ready and send the message when it is...
        waitForSocketConnection(client, function() {
            console.log("message sent!!!");
            clientConnection.sendUTF(message.utf8Data);
            if (JSON.parse(message.utf8Data).action == "stop") {
                clientConnection.close();
            }
        });
    }

    // Make the function wait until the connection is made...
    function waitForSocketConnection(socket, callback) {
        setTimeout(
            function() {
                if (clientConnection != null) {
                    if (callback != null) {
                        callback();
                    }
                    return;
                } else {
                    console.log("waiting for connection to Watson Speech to Text...");
                    waitForSocketConnection(socket, callback);
                }
            }, 100);
    }


    client.on('connectFailed', function(error) {
        console.log('Connection to Watson Speech to Text Error: ' + error.toString());
    });
    client.on('connect', function(connection) {
        clientConnection = connection;
        console.log('WebSocket connected to Watson Speech to Text');

        connection.on('error', function(error) {
            console.log("Connection to Watson Speech to Text Error: " + error.toString());
        });
        connection.on('close', function() {
            clientConnection = null;
            console.log('Connection to Watson Speech to Text Closed');
        });
        connection.on('message', function(message) {
            //console.log("message from Watson STT: " +  message.utf8Data);
            //serverConnection.send(JSON.stringify(message));
            //console.log("this is a test printout of the message" + JSON.parse(message.utf8Data).results);
            if (message.type === 'utf8') {
                var jsonMessage = JSON.parse(message.utf8Data);
                serverConnection.sendUTF(message.utf8Data);

                if (jsonMessage.results && jsonMessage.results.length > 0) {
                    if (jsonMessage.results[0].final) {
                        var text = (jsonMessage.results[0].alternatives, jsonMessage.results[0].alternatives[0].transcript || "");
                        text = text.replace(/%HESITATION\s/g, "");
                        text = text.replace(/([^*])\1{2,}/g, "");
                        text = text.replace(/D_[^\s]+/g, "");
                        text = text.charAt(0).toUpperCase() + text.substring(1);
                        text = text.trim() + ". "
                        output += text;

                        console.log("output : " + output);
                    }
                    //if (text = text.replace(/%HESITATION\s/g, ""), text = text.replace(/([^*])\1{2,}/g, ""), jsonMessage.results[0]["final"], text = text.replace(/D_[^\s]+/g, ""), 0 == text.length || /^\s+$/.test(text)) 
                }

            } else if (message.type === 'binary') {
                serverConnection.sendBytes(message.binaryData);
            }

        });

    });

    client.connect(wsURI);

// send the text to alchemy entity extraction
    function getAlchemyEntities(text, sendHashtagsInText) {

        alchemyapi.entities("text", text, {}, function(response) {
            // sending alchemy response to the user
            console.log(response);
            var hashtagText = text;
            var hashtags = {
                entity: []
            };
            var index;
            for (index = 0; index < response.entities.length; ++index) {
                //print results
                var entityType = response.entities[index].type;
                if (entityType == "Person" || entityType == "Organization" || entityType == "Holiday" || entityType == "Company") {

                    var tag = response.entities[index];
                    var tagtext = "#" + tag.text.replace(/\s+|\\n/g, '');
                    console.log("tag.text =  " + tag.text + "   " + "tagtext  = " + tagtext)
                    hashtags.entity.push({
                        "type": tag.type,
                        "tag": tagtext
                    });
                    hashtagText = hashtagText.replace(tag.text, tagtext);
                }
            }

            if (sendHashtagsInText) {
                console.log("sending text with hashtags" + hashtagText);
                serverConnection.sendUTF(hashtagText);

            } else {
                console.log("sending extracted hashtags " + JSON.stringify(hashtags));
                serverConnection.sendUTF(hashtags);
            }

            return response;
        });
    }

    serverConnection.on('message', function(message) {

        if (message.type === 'utf8') {
            console.log(message.utf8Data);
            var action = JSON.parse(message.utf8Data).action

            if (typeof action !== "undefined") {
                action = action.toLowerCase();
            }
            var user = JSON.parse(message.utf8Data).userID;
            if (typeof user !== "undefined") {
                userID = user;
                //Object storage container options
                options = {
                    name: userID,
                    metadata: {
                        color: "blue",
                        flower: "daisy"
                    }
                };
                console.log(userID);
            }
            if (action == "start" || action == "stop") {
                sendMessage(message, client);
            } else if (action == "alchemy") {
                getAlchemyEntities(output, false);
                outputBuilder += output;
                output = "";
            } else if (action == "alchemyall") {

                outputBuilder += output;
                getAlchemyEntities(outputBuilder, false);
                output = "";

            } else if (action == "hashtagsintext") {
                outputBuilder += output;
                getAlchemyEntities(outputBuilder, true);
            }

        } else if (message.type === 'binary') {
            //send audio to watson
            clientConnection.sendBytes(message.binaryData);
            //Write audio to wav file
            fileWriter.write(message.binaryData);

        }
    });
    serverConnection.on('close', function(reasonCode, description) {

        fileWriter.end();
        readStream.pipe(writeStream);
        //upload file to Object Storage

        getAlchemyEntities(output, false);
        console.log((new Date()) + ' user ' + serverConnection.remoteAddress + ' disconnected from server');
    });
});


// Object Store configuration
var config = {};
config.provider = "openstack";
config.authUrl = 'https://lon-identity.open.softlayer.com';
// Use the service catalog
config.useServiceCatalog = true;
// true for applications running inside Bluemix, otherwise false
config.useInternal = true;
// projectId 
config.tenantId = 'XXXXX';
config.userId = 'XXXXX';
config.password = 'XXXXX';
config.region = 'XXXXX';
// Create a pkgcloud storage client
var storageClient = pkgcloud.storage.createClient(config);
// Authenticate to OpenStack
storageClient.auth(function(error) {
    if (error) {
        console.error("storageClient.auth() : error creating storage client: ", error);
    } else {
        // Print the identity object which contains your Keystone token.
        console.log("Object storage connected and authenticated")
    }
});
