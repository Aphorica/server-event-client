import axios from 'axios';

const LISTEN_TYPE = 1;
const TASK_TYPE = 2;

if (!window.EventSource) {
  let EventSource = require('eventsource');
  window.EventSource = EventSource;
}

function getNotificationData(_data) {
  let data = _data.charAt(0) === '"'? _data.slice(1,-1) : _data;
            // dequote if quoted
  let retData;
  
  if (data.indexOf('^') !== -1) {
    let dataAry = data.split('^');

    retData = {
      response: dataAry[0],
      info: dataAry[1].charAt(0) === '{'?
            JSON.parse(dataAry[1].replace(/\\/g, '')) : dataAry[1]
    };
  }
  else
    retData = {response: data, info: null};

  return retData;
}

function submitPendingRequest(pendingRequest) {
  setTimeout(async ()=>{
    let status = await pendingRequest();
    if (!status) {
      console.error('pendingRequest failed');
    }
  });
}

class ServerEventClient {
  constructor(name, appurl, cb, prefix) {
    this.cb = cb;
    this.APPURL = appurl;
    this.PREFIX = prefix || "/sse/";
    this.SSESource = null;
    this.myName = name;
    this.myID = null,
    this.pendingRequests = {};
    this.mAxios = axios.create({
      baseURL: appurl
    });
  }

  
  async _queueSubmission(type, name, submissionFunc) {
    let status = true;
    let rsp;
    if (this.SSESource === null || this.SSESource.readyState !== EventSource.OPEN) {
      if (this.SSESource === null || this.SSESource.readyState === EventSource.CLOSED)
        status = await this.registerServerListener();

      if (status) 
        this.pendingRequests[name] = {type: type, func: submissionFunc};
                // can't submit until the registration is complete...

      else {
        console.error("SSEClient:submitTask, Can't re-register a ServerListener -- bailing");
        await this.unregisterServerListener();
      }          
    } else {
      status = await submissionFunc();
                // registered - go ahead and submit
    }

    return status;
  }

  get id() {
    return this.myID;
  }

  get SSEState() {
    return this.SSESource.readyState;
  }

  get SSEStateText() {
    return this.SSESource.readyState === EventSource.CLOSED? "Closed" :
           this.SSESource.readyState === EventSource.CONNECTING? "Connecting" :
           "Open";
  }  

  async makeID() {
    try {
      let rsp = await this.mAxios.get(this.PREFIX + 'make-id/' + this.myName);
      this.myID = rsp.data;
      status = true;
    } catch(err) {
      console.error("SSEClient:makeid, Error: " + err);
      status = false;
    }

    return status;
  }

  async doSubmitTask(taskname) {
    let status = true;
    try {        
      let rsp = await this.mAxios.put(
        this.PREFIX + ["submit-task", this.myID, taskname].join('/'));
    } catch(err) {
      console.error("SSEClient:doSubmitTask: " + err);
      status = false;
    }

    return status;
  }

  async submitTask(taskname) {
    status = await this._queueSubmission(TASK_TYPE, taskname, this.doSubmitTask.bind(this, taskname));
    return status;
  }

  async doListen(listenKey) {
    let status = true;
    try {
      let rsp = await this.mAxios.put(this.PREFIX + ['listen', this.myID, listenKey].join('/'));
    } catch(err) {
      console.error('SSEClient:listen, Error: ' + err);
    }

    return status;
  }

  async listen(listenKey) {
    let status = await this._queueSubmission(LISTEN_TYPE, listenKey, this.doListen.bind(this, listenKey));
    return status;
  }

  /**
   * Event listeners get bound to an instance at runtime,
   * so they have a valid 'this'.  Could pull these out of
   * the class, but that they are (eventually) bound to an instance
   * really makes them dependent on the class definition.
   * 
   * @param {*} evt 
   */
  static notificationListener(evt) {
    let data = getNotificationData(evt.data);

    switch(data.response) {
      case "notify":
        if (this.cb.sseNotify)
          this.cb.sseNotify(data.info);
        break;

      case "completed":
        if (this.cb.sseTaskCompleted)
          this.cb.sseTaskCompleted(data.info.taskid);
        break;

      case "registered":
        if (this.cb.sseRegistered)
          this.cb.sseRegistered(data.info);
        break;

      default:
        console.error("ServerEventClient:response:Unrecognized: " + data.response);
        break;
    }
  }

  static openListener(evt) {
            // registration is complete when this is called
    let pendingKeys = Object.keys(this.pendingRequests), ix, name, pendingReq;

    if (this.cb.sseOpened)
      this.cb.sseOpened(this.SSESource.readyState, this.SSEStateText);
            // notify the caller we received the open event

    for (ix = 0; ix < pendingKeys.length; ++ix) {
                  // if we have submissions pending, we can do them now.
      name = pendingKeys[ix];
      pendingReq = this.pendingRequests[name];
      submitPendingRequest(pendingReq.func);

      // if (pendingReq.type === TASK_TYPE)
        delete this.pendingRequests[name];
            // remove tasks from the pendingRequests map -
            // (listen requests will get resubmitted
            //   if opened again.)
    }
  }

  static errorListener(evt){
    if (this.cb.sseError)
      this.cb.sseError(this.SSESource.readyState, this.SSEStateText);
  }

  async registerServerListener() {
    let status = false;
    if (!!window.EventSource) {
      this.SSESource = new EventSource(
        this.APPURL + this.PREFIX + 'register-listener/' + this.myID,
        {
         https: {rejectUnauthorized: false}
        });

      if (this.SSESource) { 
        this.notificationListenerCB = ServerEventClient.notificationListener.bind(this);
        this.openListenerCB = ServerEventClient.openListener.bind(this);
        this.errorListenerCB = ServerEventClient.errorListener.bind(this);
              // define member listener funcs bound to 'this', so the
              // listeners will have a valid 'this' and they can be removed.

        this.SSESource.addEventListener('message', this.notificationListenerCB);
        this.SSESource.addEventListener('open', this.openListenerCB);
        this.SSESource.addEventListener('error', this.errorListenerCB);
        status = true;
      }
    }
    
    if (!status)
      console.error("Error in ServerEventClient:registerListener - SSE Not supported");

    return status;
  }

  async disconnect() {
    try {
      let status;
      let rsp = await this.mAxios.get(
        this.PREFIX + 'disconnect-registrant/' + this.myID);
        this.SSESource.removeEventListener('message', this.notificationListenerCB);
        this.SSESource.removeEventListener('open', this.openListenerCB);
        this.SSESource.removeEventListener('error', this.errorListenerCB);
                  // remove listeners to prevent 'ghost' calls after
                  // the instance has been assigned to null, but not
                  // gc'ed, yet.
    
        this.SSESource = null;
                  // now assign to null
    
        this.cb.sseClosed();
                  // notify the caller we're disconnected.
        status = true;
    } catch(err) {
      console.error('ServerEventClient:disconnect, error: ' + err);
      status = false;
    }

    return status;
  }

  async fetchRegistrants() {
    let data = null;
    try {
      let rsp = await this.mAxios.get(this.PREFIX + 'list-registrants');
      data = rsp.data;
    } catch(err) {
      console.error("Error in ServerEventClient:fetchRegistrants: " + err);
    }
    return data;
  }

  async triggerCleanup() {
    try {
      let rsp = await this.mAxios.get(this.PREFIX + 'trigger-cleanup');
    } catch(err) {
      console.error("Error in ServerEventClient:triggerCleanup");
    }

    return 'ok';
  }
}

class ServerEventClientFactory {
  static async create(name, appurl, cb, prefix) {
    if (appurl.charAt(appurl.length - 1) === '/')
      appurl = appurl.slice(0, -1);
                    // remove any trailing slashes.

    let client = new ServerEventClient(name, appurl, cb, prefix, true);
    let status;
    status = await client.makeID();
    if (status)
      status = await client.registerServerListener();
    
    if (!status)
      client = null;

    return client;
  }
}

export default ServerEventClientFactory;