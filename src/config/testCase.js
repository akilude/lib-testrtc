class TestCase {
  constructor(suite, name, fn) {
    this.suite = suite;
    this.settings = this.suite.settings;
    this.name = name;
    this.fn = fn;
    this.progress = 0;
    this.status = 'waiting';
    this.logs = [];
    this.rawResults = {};
  }

  setProgress(value) {
    this.progress = value;
    this.callbacks.onTestProgress(this.suite.name, this.name, value);
  }

  getName() {
    return this.name;
  }
  getLogs() {
    return this.logs;
  }

  getRawResults() {
    return this.rawResults;
  }

  setRawResults(rawData) {
    this.rawResults = rawData;
  }

  run(callbacks, doneCallback) {
    this.logs = [];
    this.status = 'waiting';
    this.callbacks = callbacks;
    this.doneCallback = doneCallback;
    this.setProgress(0);
    this.fn(this);
  }

  reportInfo(m) {
    this.callbacks.onTestReport(this.suite.name, this.name, 'info', m);
    this.logs.push({ type: 'info', message: m });
  }
  reportSuccess(m) {
    this.callbacks.onTestReport(this.suite.name, this.name, 'success', m);
    this.logs.push({ type: 'success', message: m });
    this.status = 'success';
  }
  reportError(m) {
    this.callbacks.onTestReport(this.suite.name, this.name, 'error', m);
    this.logs.push({ type: 'error', message: m });
    this.status = 'error';
  }
  reportWarning(m) {
    this.callbacks.onTestReport(this.suite.name, this.name, 'warning', m);
    this.logs.push({ type: 'warning', message: m });
    this.status = 'warning';
  }
  reportFatal(m) {
    this.callbacks.onTestReport(this.suite.name, this.name, 'error', m);
    this.logs.push({ type: 'error', message: m });
    this.status = 'error';
  }
  done() {
    if (this.progress < 100) this.setProgress(100);
    this.callbacks.onTestResult(this.suite.name, this.name, this.status);
    this.doneCallback();
  }

  doGetUserMedia(constraints, onSuccess, onFail) {
    var self = this;
    try {
      // Call into getUserMedia via the polyfill (adapter.js).
      navigator.mediaDevices.getUserMedia(constraints)
          .then(function(stream) {
            var cam = self.getDeviceName_(stream.getVideoTracks());
            var mic = self.getDeviceName_(stream.getAudioTracks());
            onSuccess.apply(this, arguments);
          })
          .catch(function(error) {
            if (onFail) {
              onFail.apply(this, arguments);
            } else {
              self.reportFatal('Failed to get access to local media due to ' +
                  'error: ' + error.name);
            }
          });
    } catch (e) {
      return this.reportFatal('getUserMedia failed with exception: ' +
          e.message);
    }
  }

  setTimeoutWithProgressBar(timeoutCallback, timeoutMs) {
    var start = window.performance.now();
    var self = this;
    var updateProgressBar = setInterval(function() {
      var now = window.performance.now();
      self.setProgress((now - start) * 100 / timeoutMs);
    }, 100);
    var timeoutTask = function() {
      clearInterval(updateProgressBar);
      self.setProgress(100);
      timeoutCallback();
    };
    var timer = setTimeout(timeoutTask, timeoutMs);
    var finishProgressBar = function() {
      clearTimeout(timer);
      timeoutTask();
    };
    return finishProgressBar;
  }

  getDeviceName_(tracks) {
    if (tracks.length === 0) {
      return null;
    }
    return tracks[0].label;
  }
}

export default TestCase;
