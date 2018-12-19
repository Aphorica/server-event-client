# @aph/server-event-client

Client-side utility for registering and maintaining _EventSource_ connections.

See also:
 - [@aphorica/server-event-mgr][1] - server-side implentation of a server-event service.
 - [server-event-demo][2] - docker-compose file that sets up a development environment to test/demo.

## Overview
The EventSource object is provided by the browser (or a polyfill in the case of non-support (IE/Edge)) to manage long-lived _keep-alive_ connections with the server, and to keep them open until closed.

It is a tentatively simpler and less resource-intensive mechanism than web-sockets, however there are server considerations that add a certain amount of complication (see @aph/server-event-mgr, _Overview_ section.)

This utility provides a EventSource implementation that, in turn, is tuned to the server implementation provided by the @aph/server-event-mgr.

It also provides debugging invocations into the server to aid in development.

## Installation
`npm install @aphorica/server-event-client` _or_ `yarn add @aphorica/server-event-client`

## API
 The _EventSource_ object is created, retained, and
destroyed entirely within the `ServerEventClient` instance.  All interactions from the application are with the `ServerEventClient` instance.

Note also that the `ServerEventClient` instance is created via the `ServerEventClientFactory.create()` function.  The reason for this is that during the creation process, several async calls must be invoked with the server, and waiting for them within a constructor is not good practice, nor are errors detected and conveyed in a constructor easily.

### Creation API
<dl>
<dt>ServerEventClientFactory.create(name, appurl, cb, prefix)</dt>
<dd>
<em>name</em> - a name unique to the caller<br/>
<em>appurl</em> - the base url for calls to the server<br/>
<em>cb</em> - an object containing requisite callbacks<br/>
<em>prefix</em> - prepended to api calls to the server<br/>
returns - a `ServerEventClient` instance.<br/><br/>
Creates the `ServerEventClient` instance.  This instance contains the `ServerEvent` object and receives and sends requests to and from the server.

The _cb_ object can be anything that implements the set of required callbacks.  Callbacks are as follows:
<div style="margin-left:2em">
<dl>
<dt>sseOpened(readyState, readyStateText)</dt>
<dd>
<em>readyState</em> - the readyState value of the <em>EventSource</em> object. Can be one of:
<ul>
<li>EventSource.CONNECTING (0) ("Connecting")</li>
<li>EventSource.OPEN (1) ("Open")</li>
<li>EventSource.CLOSED(2) ("Closed")</li>
</ul>
<em>readyStateText</em> - text corresponding to the readyState<br/>
Called when the <em>EventSource</em> object establishes a
connection with the server.</dd>
<dt>sseClosed()</dt>
<dd>
Called when the <em>EventSource</em> object is closed.  At this
point, the object should remove itself as it is no longer
valid.</dd>
<dt>sseError(readyState, readyStateText)</dt>
<dd>
Called on error. (Actually haven't seen this.)</dd>
<dt>sseListenersChanged()</dt>
<dd>
Received on a <em>listeners-changed</em> notification from the server.</dd>
<dt>sseTaskCompleted(id, taskid)</dt>
<dd>
<em>id</em> - the unique id for this client<br/>
<em>taskid</em> - the taskid provided in the `submitTask` call.<br/>
Called when the specific task is completed.</dd>
<dt>sseRegistered(id)</dt>
<dd>
<em>id</em> - the unique id for this client<br/>
Called when the server registers the id.
<dd>
<dt>sseAdHocResponse()</dt>
<dd>
Called when the server sends an ad-hoc notification.</dd>
</dl>
</div>
</dd>
</dl>

### Operations API
<dl>
<dt>submitTask(taskname)</dt>
<dd>
<em>taskname</em> - name of the task.</em>
Submits a named task to the server to execute and then
send notification on completion.  The taskname will be provided in the sseTaskCompleted call.</dd>
<dt>getSSEState()</dt>
<dd>
Return the <em>EventSource.readyState</em> value.</dd>
<dt>getSSEStateText()</dt>
<dd>
Return the text corresponding to the <em>EventSource.readyState</em> value.</dd>
<dt>disconnect()</dt>
<dd>
Disconnect the <em>EventSource</em> object from the server. This will remove the <em>EventSource</em> object and invoke the <em>sseClosed</em> callback (which should trigger deletion of the <em>ServerEventClient</em> class.)</dd>
</dl>

### Debugging API
<dl>
<dt>fetchRegistrants()</dt>
<dd>
Fetch all the currently registered entries held by the server.  Returned as a JSON object.</dd>
<dt>triggerAdHocServerResponse()</dt>
<dd>
Invokes call to force the server to trigger an immediate reponse.</dd>
<dt>triggerCleanup()</dt>
<dd>
Invokes call to force the server to do an immediate cleanup pass.</dd>
</dl>
[1]:https://github.com/Aphorica/server-event-demo
