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

  constructor(config = {}) {
    this.SUITES = Config.SUITES;
    this.TESTS = Config.TESTS;
    this.config = config;

    this.suites = [];

    const micSuite = Config.buildMicroSuite(this.config);
    const cameraSuite = Config.buildCameraSuite(this.config);
    const networkSuite = Config.buildNetworkSuite(this.config);
    const connectivitySuite = Config.buildConnectivitySuite(this.config);
    const throughputSuite = Config.buildThroughputSuite(this.config);

    this.suites.push(micSuite);
    this.suites.push(cameraSuite);
    this.suites.push(networkSuite);
    this.suites.push(connectivitySuite);
    this.suites.push(throughputSuite);
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

window.TestRTC = TestRTC;
export default TestRTC;
