'use strict';

function WiFiPeriodicScanTest(test, candidateFilter) {
  this.test = test;
  this.candidateFilter = candidateFilter;
  this.testDurationMs = 5 * 60 * 1000;
  this.sendIntervalMs = 100;
  this.delays = [];
  this.recvTimeStamps = [];
  this.running = false;
  this.call = null;
  this.senderChannel = null;
  this.receiveChannel = null;
}

WiFiPeriodicScanTest.prototype = {
  run: function() {
    Call.asyncCreateTurnConfig(this.start.bind(this),
        this.test.reportFatal.bind(this.test));
  },

  start: function(config) {
    this.running = true;
    this.call = new Call(config, this.test);
    this.chart = this.test.createLineChart();
    this.call.setIceCandidateFilter(this.candidateFilter);

    this.senderChannel = this.call.pc1.createDataChannel({ordered: false,
      maxRetransmits: 0});
    this.senderChannel.addEventListener('open', this.send.bind(this));
    this.call.pc2.addEventListener('datachannel',
        this.onReceiverChannel.bind(this));
    this.call.establishConnection();

    setTimeoutWithProgressBar(this.finishTest.bind(this),
        this.testDurationMs);
  },

  onReceiverChannel: function(event) {
    this.receiveChannel = event.channel;
    this.receiveChannel.addEventListener('message', this.receive.bind(this));
  },

  send: function() {
    if (!this.running) {
      return;
    }
    this.senderChannel.send('' + Date.now());
    setTimeout(this.send.bind(this), this.sendIntervalMs);
  },

  receive: function(event) {
    if (!this.running) {
      return;
    }
    var sendTime = parseInt(event.data);
    var delay = Date.now() - sendTime;
    this.recvTimeStamps.push(sendTime);
    this.delays.push(delay);
    this.chart.addDatapoint(sendTime + delay, delay);
  },

  finishTest: function() {
    report.traceEventInstant('periodic-delay', {delays: this.delays,
      recvTimeStamps: this.recvTimeStamps});
    this.running = false;
    this.call.close();
    this.call = null;
    this.chart.parentElement.removeChild(this.chart);

    var avg = arrayAverage(this.delays);
    var max = arrayMax(this.delays);
    var min = arrayMin(this.delays);
    this.test.reportInfo('Average delay: ' + avg + ' ms.');
    this.test.reportInfo('Min delay: ' + min + ' ms.');
    this.test.reportInfo('Max delay: ' + max + ' ms.');

    if (this.delays.length < 0.8 * this.testDurationMs / this.sendIntervalMs) {
      this.test.reportError('Not enough samples gathered. Keep the page on ' +
          ' the foreground while the test is running.');
    } else {
      this.test.reportSuccess('Collected ' + this.delays.length +
          ' delay samples.');
    }

    if (max > (min + 100) * 2) {
      this.test.reportError('There is a big difference between the min and ' +
          'max delay of packets. Your network appears unstable.');
    }
    this.test.done();
  }
};

export default WiFiPeriodicScanTest;