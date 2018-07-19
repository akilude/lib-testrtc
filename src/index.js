import * as Config from './config';

function runAllSequentially(tasks, callbacks, shouldStop) {
  var current = -1;
  var runNextAsync = setTimeout.bind(null, runNext);
  runNextAsync();
  function runNext() {
    if (shouldStop()) {
      callbacks.onStopped();
      return;
    }
    current++;
    if (current === tasks.length) {
      callbacks.onComplete();
      return;
    }
    tasks[current].run(callbacks, runNextAsync);
  }
}

class TestRTC {

  constructor(config = {}, filter = []) {
    this.SUITES = Config.SUITES;
    this.TESTS = Config.TESTS;
    this.config = config;
    this.callbacks = {
      onTestProgress: () => {},
      onTestResult: () => {},
      onTestReport: () => {},
      onStopped: () => {},
      onComplete: () => {},
    };

    this.suites = [];

    if (!filter.includes(this.SUITES.MICROPHONE)) {
      const micSuite = Config.buildMicroSuite(this.config, filter);
      this.suites.push(micSuite);
    }

    if (!filter.includes(this.SUITES.CAMERA)) {
      const cameraSuite = Config.buildCameraSuite(this.config, filter);
      this.suites.push(cameraSuite);
    }

    if (!filter.includes(this.SUITES.NETWORK)) {
      const networkSuite = Config.buildNetworkSuite(this.config, filter);
      this.suites.push(networkSuite);
    }

    if (!filter.includes(this.SUITES.CONNECTIVITY)) {
      const connectivitySuite = Config.buildConnectivitySuite(this.config, filter);
      this.suites.push(connectivitySuite);
    }

    if (!filter.includes(this.SUITES.THROUGHPUT)) {
      const throughputSuite = Config.buildThroughputSuite(this.config, filter);
      this.suites.push(throughputSuite);
    }
  }

  getSuites() {
    return this.suites;
  }

  getTests() {
    return this.suites.reduce((all, suite) => all.concat(suite.getTests()), []);
  }

  onTestProgress(callback = () => {}) {
    this.callbacks.onTestProgress = callback;
  }

  onTestResult(callback = () => {}) {
    this.callbacks.onTestResult = callback;
  }

  onTestReport(callback = () => {}) {
    this.callbacks.onTestReport = callback;
  }

  onStopped(callback = () => {}) {
    this.callbacks.onStopped = callback;
  }

  onComplete(callback = () => {}) {
    this.callbacks.onComplete = callback;
  }

  start() {
    const allTests = this.getTests();
    this.shouldStop = false;
    runAllSequentially(allTests, this.callbacks, () => { return this.shouldStop });
  }

  stop() {
    this.shouldStop = true;
  }
}

TestRTC.SUITES = Config.SUITES;
TestRTC.TESTS = Config.TESTS;
window.TestRTC = TestRTC;
export default TestRTC;
