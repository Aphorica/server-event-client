import axios from 'axios';

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

class ServerEventClient {
  constructor(name, appurl, cb, prefix) {
    this.cb = cb;
    this.APPURL = appurl;
    this.PREFIX = prefix || "/sse/";
    this.SSESource = null;
    this.myName = name;
    this.myID = null,
    this.submitTaskPending = null;
    this.mAxios = axios.create({
      baseURL: appurl
    });
  }

  getSSEState() {
    return this.SSESource.readyState;
  }

  getSSEStateText() {
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
      console.error("Error in makeID: " + err);
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
      console.error("Error in doSubmitTask: " + err);
      status = false;
    }

    return status;
  }

  async submitTask(taskname) {
    let status = true;
    let rsp;
    if (this.SSESource === null ||
        this.SSESource.readyState === EventSource.CLOSED) {
      status = await this.registerServerListener();

      if (status) 
        this.submitTaskPending = this.doSubmitTask.bind(this, taskname);
                // can't submit until the registration is complete...

      else {
        console.error("Can't re-register a ServerListener -- bailing");
        await this.unregisterServerListener();
        return;
      }          
    } else {
      status = await this.doSubmitTask(taskname);
                // registered - go ahead and submit
    }

    return status;
  }

  /**
   * Event listeners get bound to an instance at runtime,
   * so they have a valid 'this'.  Could pull these out of
   * the class, but that they are bound to an instance
   * really makes them dependent on the class definition.
   * 
   * @param {*} evt 
   */
  static notificationListener(evt) {
    let data = getNotificationData(evt.data);

    switch(data.response) {
      case "listeners-changed":
        this.cb.sseListenersChanged();
        break;

      case "completed":
        this.cb.sseTaskCompleted(data.info.id, data.info.taskid);
        break;

      case "registered":
        this.cb.sseRegistered(data.info);
        break;

      case "ad-hoc":
        this.cb.sseAdHockResponse();
        break;

      default:
        console.error("ServerEventClient:response:Unrecognized: " + data.response);
        break;
    }
  }

  static openListener(evt) {
            // registration is complete when this is called
            
    this.cb.sseOpened(this.SSESource.readyState, this.getSSEStateText());
            // notify the caller.

    if (this.submitTaskPending !== null) {
                // if we have a submission pending, finish it now.

      let _this = this;
      setTimeout(async ()=>{
        let status = await _this.submitTaskPending();
        _this.submitTaskPending = null;
        if (!status) {
          console.error('ServerEventClient:sseOpened:submitTaskPending failed');
        }
      });
    }
  }

  static errorListener(evt){
    this.cb.sseError(this.SSESource.readyState, this.getSSEStateText());
  };

  async registerServerListener() {
    let status;
    if (!!window.EventSource) {
      this.SSESource = new EventSource(
        this.APPURL + this.PREFIX + 'register-listener/' + this.myID);
      
      this.notificationListenerCB = ServerEventClient.notificationListener.bind(this);
      this.openListenerCB = ServerEventClient.openListener.bind(this);
      this.errorListenerCB = ServerEventClient.errorListener.bind(this);
            // define member listener funcs bound to this, so they
            // can be removed.

      this.SSESource.addEventListener('message', this.notificationListenerCB);
      this.SSESource.addEventListener('open', this.openListenerCB);
      this.SSESource.addEventListener('error', this.errorListenerCB);
      status = true;

    } else {
      console.error("Error in ServerEventClient:registerListener - SSE Not supported");
      status = false;
    }

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

  async triggerAdHocServerResponse() {
    try {
      let rsp = await this.mAxios.get(this.PREFIX +
                                     ['trigger-ad-hoc', this.myID].join('/'));
    } catch(err) {
      console.error("Error in ServerEventClient:triggerAdHocServerResponse");
    }

    return 'ok';
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