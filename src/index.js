import * as Config from './config';
import adapter from 'webrtc-adapter';

function runAllSequentially(
  tasks = this.getTests(),
  callbacks = this.callbacks,
  shouldStop = () => this.shouldStop
) {
  const runNext = () => {
    if (shouldStop()) {
      this.shouldStop = false;
      callbacks.onStopped();
      return;
    }
    this._current += 1;
    callbacks.onGlobalProgress(this._current, tasks.length - this._current);
    if (this._current === tasks.length) {
      this.state = 'completed';
      callbacks.onComplete();
      return;
    }
    tasks[this._current].run(callbacks, runNextAsync);
  };

  const runNextAsync = setTimeout.bind(null, runNext);
  runNextAsync();
}

function initTests() {
  this._current = -1;
  this.suites = [];

  if (!this.filter.includes(this.SUITES.MICROPHONE)) {
    const micSuite = Config.buildMicroSuite(this.config, this.filter);
    this.suites.push(micSuite);
  }

  if (!this.filter.includes(this.SUITES.CAMERA)) {
    const cameraSuite = Config.buildCameraSuite(this.config, this.filter);
    this.suites.push(cameraSuite);
  }

  if (!this.filter.includes(this.SUITES.NETWORK)) {
    const networkSuite = Config.buildNetworkSuite(this.config, this.filter);
    this.suites.push(networkSuite);
  }

  if (!this.filter.includes(this.SUITES.CONNECTIVITY)) {
    const connectivitySuite = Config.buildConnectivitySuite(
      this.config,
      this.filter
    );
    this.suites.push(connectivitySuite);
  }

  if (!this.filter.includes(this.SUITES.THROUGHPUT)) {
    const throughputSuite = Config.buildThroughputSuite(
      this.config,
      this.filter
    );
    this.suites.push(throughputSuite);
  }
}

class TestRTC {
  constructor(config = {}, filter = []) {
    this.SUITES = Config.SUITES;
    this.TESTS = Config.TESTS;
    this.config = config;
    this.filter = filter;
    this.state = 'stopped';
    this._current = -1;
    this.suites = [];
    this._runAllSequentially = runAllSequentially;
    this._initTests = initTests;
    this.callbacks = {
      onTestProgress: () => {},
      onGlobalProgress: () => {},
      onTestResult: () => {},
      onTestReport: () => {},
      onStopped: () => {},
      onComplete: () => {}
    };
    this._initTests();
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

  onGlobalProgress(callback = () => {}) {
    this.callbacks.onGlobalProgress = callback;
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
    this._current = -1;
    this.state = 'started';
    this._runAllSequentially();
  }

  pause() {
    this.shouldStop = true;
    this.state = 'paused';
  }

  resume() {
    this.shouldStop = false;
    this.state = 'started';
    this._runAllSequentially();
  }

  stop() {
    this.shouldStop = true;
    this._current = -1;
    this.state = 'stopped';
    this._initTests();
  }
}

TestRTC.ADAPTER = adapter;
TestRTC.SUITES = Config.SUITES;
TestRTC.TESTS = Config.TESTS;
window.TestRTC = TestRTC;
export default TestRTC;
