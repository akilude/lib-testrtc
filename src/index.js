import * as Config from './config';

function runAllSequentially(tasks, progressCallback, resultCallback, doneCallback) {
  var current = -1;
  var runNextAsync = setTimeout.bind(null, runNext);
  runNextAsync();
  function runNext() {
    current++;
    if (current === tasks.length) {
      doneCallback();
      return;
    }
    tasks[current].run(progressCallback, resultCallback, runNextAsync);
  }
}

class TestRTC {

  constructor(config = {}, filter = []) {
    this.SUITES = Config.SUITES;
    this.TESTS = Config.TESTS;
    this.config = config;

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

  start(onTestProgress = () => {}, onTestResult = () => {}, onComplete = () => {}) {
    const allTests = this.getTests();
    runAllSequentially(allTests, onTestProgress, onTestResult, onComplete);
  }
}

TestRTC.SUITES = Config.SUITES;
TestRTC.TESTS = Config.TESTS;
window.TestRTC = TestRTC;
export default TestRTC;
