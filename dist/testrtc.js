(function(){function r(e,n,t){function o(i,f){if(!n[i]){if(!e[i]){var c="function"==typeof require&&require;if(!f&&c)return c(i,!0);if(u)return u(i,!0);var a=new Error("Cannot find module '"+i+"'");throw a.code="MODULE_NOT_FOUND",a}var p=n[i]={exports:{}};e[i][0].call(p.exports,function(r){var n=e[i][1][r];return o(n||r)},p,p.exports,r,e,n,t)}return n[i].exports}for(var u="function"==typeof require&&require,i=0;i<t.length;i++)o(t[i]);return o}return r})()({1:[function(require,module,exports){
'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
var cases = exports.cases = {
  AUDIOCAPTURE: 'Audio capture',
  CHECKRESOLUTION240: 'Check resolution 320x240',
  CHECKRESOLUTION480: 'Check resolution 640x480',
  CHECKRESOLUTION720: 'Check resolution 1280x720',
  CHECKSUPPORTEDRESOLUTIONS: 'Check supported resolutions',
  DATATHROUGHPUT: 'Data throughput',
  IPV6ENABLED: 'Ipv6 enabled',
  NETWORKLATENCY: 'Network latency',
  NETWORKLATENCYRELAY: 'Network latency - Relay',
  UDPENABLED: 'Udp enabled',
  TCPENABLED: 'Tcp enabled',
  VIDEOBANDWIDTH: 'Video bandwidth',
  RELAYCONNECTIVITY: 'Relay connectivity',
  REFLEXIVECONNECTIVITY: 'Reflexive connectivity',
  HOSTCONNECTIVITY: 'Host connectivity'
};

var suites = exports.suites = {
  CAMERA: 'Camera',
  MICROPHONE: 'Microphone',
  NETWORK: 'Network',
  CONNECTIVITY: 'Connectivity',
  THROUGHPUT: 'Throughput'
};

},{}],2:[function(require,module,exports){
'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});

var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }();

var _call = require('./util/call.js');

var _call2 = _interopRequireDefault(_call);

require('./util/stats.js');

require('./util/ssim.js');

require('./util/videoframechecker.js');

require('./util/util.js');

var _testNames = require('./config/testNames.js');

var _mic = require('./unit/mic.js');

var _mic2 = _interopRequireDefault(_mic);

var _conn = require('./unit/conn.js');

var _conn2 = _interopRequireDefault(_conn);

var _camresolutions = require('./unit/camresolutions.js');

var _camresolutions2 = _interopRequireDefault(_camresolutions);

var _net = require('./unit/net.js');

var _net2 = _interopRequireDefault(_net);

var _dataBandwidth = require('./unit/dataBandwidth.js');

var _dataBandwidth2 = _interopRequireDefault(_dataBandwidth);

var _videoBandwidth = require('./unit/videoBandwidth.js');

var _videoBandwidth2 = _interopRequireDefault(_videoBandwidth);

var _wifiPeriodicScan = require('./unit/wifiPeriodicScan.js');

var _wifiPeriodicScan2 = _interopRequireDefault(_wifiPeriodicScan);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

var TestRTC = function () {
  function TestRTC() {
    _classCallCheck(this, TestRTC);

    this.enumeratedTestSuites = [];
    this.enumeratedTestFilters = [];

    addTest(_testNames.suites.MICROPHONE, _testNames.cases.AUDIOCAPTURE, function (test) {
      var micTest = new _mic2.default(test);
      micTest.run();
    });

    // Set up a datachannel between two peers through a relay
    // and verify data can be transmitted and received
    // (packets travel through the public internet)
    addTest(_testNames.suites.CONNECTIVITY, _testNames.cases.RELAYCONNECTIVITY, function (test) {
      var runConnectivityTest = new _conn2.default(test, _call2.default.isRelay);
      runConnectivityTest.run();
    });

    // Set up a datachannel between two peers through a public IP address
    // and verify data can be transmitted and received
    // (packets should stay on the link if behind a router doing NAT)
    addTest(_testNames.suites.CONNECTIVITY, _testNames.cases.REFLEXIVECONNECTIVITY, function (test) {
      var runConnectivityTest = new _conn2.default(test, _call2.default.isReflexive);
      runConnectivityTest.run();
    });

    // Set up a datachannel between two peers through a local IP address
    // and verify data can be transmitted and received
    // (packets should not leave the machine running the test)
    addTest(_testNames.suites.CONNECTIVITY, _testNames.cases.HOSTCONNECTIVITY, function (test) {
      var runConnectivityTest = new _conn2.default(test, _call2.default.isHost);
      runConnectivityTest.start();
    });

    addTest(_testNames.suites.CAMERA, _testNames.cases.CHECKRESOLUTION240, function (test) {
      var camResolutionsTest = new _camresolutions2.default(test, [[320, 240]]);
      camResolutionsTest.run();
    });

    addTest(_testNames.suites.CAMERA, _testNames.cases.CHECKRESOLUTION480, function (test) {
      var camResolutionsTest = new _camresolutions2.default(test, [[640, 480]]);
      camResolutionsTest.run();
    });

    addTest(_testNames.suites.CAMERA, _testNames.cases.CHECKRESOLUTION720, function (test) {
      var camResolutionsTest = new _camresolutions2.default(test, [[1280, 720]]);
      camResolutionsTest.run();
    });

    addTest(_testNames.suites.CAMERA, _testNames.cases.CHECKSUPPORTEDRESOLUTIONS, function (test) {
      var resolutionArray = [[160, 120], [320, 180], [320, 240], [640, 360], [640, 480], [768, 576], [1024, 576], [1280, 720], [1280, 768], [1280, 800], [1920, 1080], [1920, 1200], [3840, 2160], [4096, 2160]];
      var camResolutionsTest = new _camresolutions2.default(test, resolutionArray);
      camResolutionsTest.run();
    });

    // Test whether it can connect via UDP to a TURN server
    // Get a TURN config, and try to get a relay candidate using UDP.
    addTest(_testNames.suites.NETWORK, _testNames.cases.UDPENABLED, function (test) {
      var networkTest = new _net2.default(test, 'udp', null, _call2.default.isRelay);
      networkTest.run();
    });

    // Test whether it can connect via TCP to a TURN server
    // Get a TURN config, and try to get a relay candidate using TCP.
    addTest(_testNames.suites.NETWORK, _testNames.cases.TCPENABLED, function (test) {
      var networkTest = new _net2.default(test, 'tcp', null, _call2.default.isRelay);
      networkTest.run();
    });

    // Test whether it is IPv6 enabled (TODO: test IPv6 to a destination).
    // Turn on IPv6, and try to get an IPv6 host candidate.
    addTest(_testNames.suites.NETWORK, _testNames.cases.IPV6ENABLED, function (test) {
      var params = { optional: [{ googIPv6: true }] };
      var networkTest = new _net2.default(test, null, params, _call2.default.isIpv6);
      networkTest.run();
    });

    // Creates a loopback via relay candidates and tries to send as many packets
    // with 1024 chars as possible while keeping dataChannel bufferedAmmount above
    // zero.
    addTest(_testNames.suites.THROUGHPUT, _testNames.cases.DATATHROUGHPUT, function (test) {
      var dataChannelThroughputTest = new _dataBandwidth2.default(test);
      dataChannelThroughputTest.run();
    });

    // Measures video bandwidth estimation performance by doing a loopback call via
    // relay candidates for 40 seconds. Computes rtt and bandwidth estimation
    // average and maximum as well as time to ramp up (defined as reaching 75% of
    // the max bitrate. It reports infinite time to ramp up if never reaches it.
    addTest(_testNames.suites.THROUGHPUT, _testNames.cases.VIDEOBANDWIDTH, function (test) {
      var videoBandwidthTest = new _videoBandwidth2.default(test);
      videoBandwidthTest.run();
    });

    addExplicitTest(_testNames.suites.THROUGHPUT, _testNames.cases.NETWORKLATENCY, function (test) {
      var wiFiPeriodicScanTest = new WiFiPeriodicScanTest(test, _call2.default.isNotHostCandidate);
      wiFiPeriodicScanTest.run();
    });

    addExplicitTest(_testNames.suites.THROUGHPUT, _testNames.cases.NETWORKLATENCYRELAY, function (test) {
      var wiFiPeriodicScanTest = new WiFiPeriodicScanTest(test, _call2.default.isRelay);
      wiFiPeriodicScanTest.run();
    });
  }

  _createClass(TestRTC, [{
    key: 'addTest',
    value: function addTest(suiteName, testName, func) {
      if (isTestDisabled(testName)) {
        return;
      }

      for (var i = 0; i !== enumeratedTestSuites.length; ++i) {
        if (enumeratedTestSuites[i].name === suiteName) {
          enumeratedTestSuites[i].addTest(testName, func);
          return;
        }
      }
    }

    // Add a test that only runs if it is explicitly enabled with
    // ?test_filter=<TEST NAME>

  }, {
    key: 'addExplicitTest',
    value: function addExplicitTest(suiteName, testName, func) {
      if (isTestExplicitlyEnabled(testName)) {
        addTest(suiteName, testName, func);
      }
    }
  }, {
    key: 'isTestDisabled',
    value: function isTestDisabled(testName) {
      if (enumeratedTestFilters.length === 0) {
        return false;
      }
      return !isTestExplicitlyEnabled(testName);
    }
  }, {
    key: 'isTestExplicitlyEnabled',
    value: function isTestExplicitlyEnabled(testName) {
      for (var i = 0; i !== enumeratedTestFilters.length; ++i) {
        if (enumeratedTestFilters[i] === testName) {
          return true;
        }
      }
      return false;
    }
  }]);

  return TestRTC;
}();

exports.default = TestRTC;

},{"./config/testNames.js":1,"./unit/camresolutions.js":5,"./unit/conn.js":6,"./unit/dataBandwidth.js":7,"./unit/mic.js":8,"./unit/net.js":9,"./unit/videoBandwidth.js":10,"./unit/wifiPeriodicScan.js":11,"./util/call.js":12,"./util/ssim.js":14,"./util/stats.js":15,"./util/util.js":16,"./util/videoframechecker.js":17}],3:[function(require,module,exports){
/*
 *  Copyright (c) 2015 The WebRTC project authors. All Rights Reserved.
 *
 *  Use of this source code is governed by a BSD-style license
 *  that can be found in the LICENSE file in the root of the source
 *  tree.
 */
'use strict';
/* exported addExplicitTest, addTest, audioContext */

// Global WebAudio context that can be shared by all tests.
// There is a very finite number of WebAudio contexts.

try {
  window.AudioContext = window.AudioContext || window.webkitAudioContext;
  var audioContext = new AudioContext();
} catch (e) {
  console.log('Failed to instantiate an audio context, error: ' + e);
}

var enumeratedTestSuites = [];
var enumeratedTestFilters = [];

function addTest(suiteName, testName, func) {
  if (isTestDisabled(testName)) {
    return;
  }

  for (var i = 0; i !== enumeratedTestSuites.length; ++i) {
    if (enumeratedTestSuites[i].name === suiteName) {
      enumeratedTestSuites[i].addTest(testName, func);
      return;
    }
  }
  // Non-existent suite create and attach to #content.
  var suite = document.createElement('testrtc-suite');
  suite.name = suiteName;
  suite.addTest(testName, func);
  enumeratedTestSuites.push(suite);
  document.getElementById('content').appendChild(suite);
}

// Add a test that only runs if it is explicitly enabled with
// ?test_filter=<TEST NAME>
function addExplicitTest(suiteName, testName, func) {
  if (isTestExplicitlyEnabled(testName)) {
    addTest(suiteName, testName, func);
  }
}

function isTestDisabled(testName) {
  if (enumeratedTestFilters.length === 0) {
    return false;
  }
  return !isTestExplicitlyEnabled(testName);
}

function isTestExplicitlyEnabled(testName) {
  for (var i = 0; i !== enumeratedTestFilters.length; ++i) {
    if (enumeratedTestFilters[i] === testName) {
      return true;
    }
  }
  return false;
}

var parameters = parseUrlParameters();
var filterParameterName = 'test_filter';
if (filterParameterName in parameters) {
  enumeratedTestFilters = parameters[filterParameterName].split(',');
}

},{}],4:[function(require,module,exports){
'use strict';

/*
 * In generic cameras using Chrome rescaler, all resolutions should be supported
 * up to a given one and none beyond there. Special cameras, such as digitizers,
 * might support only one resolution.
 */

/*
 * "Analyze performance for "resolution"" test uses getStats, canvas and the
 * video element to analyze the video frames from a capture device. It will
 * report number of black frames, frozen frames, tested frames and various stats
 * like average encode time and FPS. A test case will be created per mandatory
 * resolution found in the "resolutions" array.
 */

Object.defineProperty(exports, "__esModule", {
  value: true
});
function CamResolutionsTest(test, resolutions) {
  this.test = test;
  this.resolutions = resolutions;
  this.currentResolution = 0;
  this.isMuted = false;
  this.isShuttingDown = false;
}

CamResolutionsTest.prototype = {
  run: function run() {
    this.startGetUserMedia(this.resolutions[this.currentResolution]);
  },

  startGetUserMedia: function startGetUserMedia(resolution) {
    var constraints = {
      audio: false,
      video: {
        width: { exact: resolution[0] },
        height: { exact: resolution[1] }
      }
    };
    navigator.mediaDevices.getUserMedia(constraints).then(function (stream) {
      // Do not check actual video frames when more than one resolution is
      // provided.
      if (this.resolutions.length > 1) {
        this.test.reportSuccess('Supported: ' + resolution[0] + 'x' + resolution[1]);
        stream.getTracks().forEach(function (track) {
          track.stop();
        });
        this.maybeContinueGetUserMedia();
      } else {
        this.collectAndAnalyzeStats_(stream, resolution);
      }
    }.bind(this)).catch(function (error) {
      if (this.resolutions.length > 1) {
        this.test.reportInfo(resolution[0] + 'x' + resolution[1] + ' not supported');
      } else {
        this.test.reportError('getUserMedia failed with error: ' + error.name);
      }
      this.maybeContinueGetUserMedia();
    }.bind(this));
  },

  maybeContinueGetUserMedia: function maybeContinueGetUserMedia() {
    if (this.currentResolution === this.resolutions.length) {
      this.test.done();
      return;
    }
    this.startGetUserMedia(this.resolutions[this.currentResolution++]);
  },

  collectAndAnalyzeStats_: function collectAndAnalyzeStats_(stream, resolution) {
    var tracks = stream.getVideoTracks();
    if (tracks.length < 1) {
      this.test.reportError('No video track in returned stream.');
      this.maybeContinueGetUserMedia();
      return;
    }

    // Firefox does not support event handlers on mediaStreamTrack yet.
    // https://developer.mozilla.org/en-US/docs/Web/API/MediaStreamTrack
    // TODO: remove if (...) when event handlers are supported by Firefox.
    var videoTrack = tracks[0];
    if (typeof videoTrack.addEventListener === 'function') {
      // Register events.
      videoTrack.addEventListener('ended', function () {
        // Ignore events when shutting down the test.
        if (this.isShuttingDown) {
          return;
        }
        this.test.reportError('Video track ended, camera stopped working');
      }.bind(this));
      videoTrack.addEventListener('mute', function () {
        // Ignore events when shutting down the test.
        if (this.isShuttingDown) {
          return;
        }
        this.test.reportWarning('Your camera reported itself as muted.');
        // MediaStreamTrack.muted property is not wired up in Chrome yet,
        // checking isMuted local state.
        this.isMuted = true;
      }.bind(this));
      videoTrack.addEventListener('unmute', function () {
        // Ignore events when shutting down the test.
        if (this.isShuttingDown) {
          return;
        }
        this.test.reportInfo('Your camera reported itself as unmuted.');
        this.isMuted = false;
      }.bind(this));
    }

    var video = document.createElement('video');
    video.setAttribute('autoplay', '');
    video.setAttribute('muted', '');
    video.width = resolution[0];
    video.height = resolution[1];
    video.srcObject = stream;
    var frameChecker = new VideoFrameChecker(video);
    var call = new Call(null, this.test);
    call.pc1.addStream(stream);
    call.establishConnection();
    call.gatherStats(call.pc1, null, stream, this.onCallEnded_.bind(this, resolution, video, stream, frameChecker), 100);

    setTimeoutWithProgressBar(this.endCall_.bind(this, call, stream), 8000);
  },

  onCallEnded_: function onCallEnded_(resolution, videoElement, stream, frameChecker, stats, statsTime) {
    this.analyzeStats_(resolution, videoElement, stream, frameChecker, stats, statsTime);

    frameChecker.stop();

    this.test.done();
  },

  analyzeStats_: function analyzeStats_(resolution, videoElement, stream, frameChecker, stats, statsTime) {
    var googAvgEncodeTime = [];
    var googAvgFrameRateInput = [];
    var googAvgFrameRateSent = [];
    var statsReport = {};
    var frameStats = frameChecker.frameStats;

    for (var index in stats) {
      if (stats[index].type === 'ssrc') {
        // Make sure to only capture stats after the encoder is setup.
        if (parseInt(stats[index].googFrameRateInput) > 0) {
          googAvgEncodeTime.push(parseInt(stats[index].googAvgEncodeMs));
          googAvgFrameRateInput.push(parseInt(stats[index].googFrameRateInput));
          googAvgFrameRateSent.push(parseInt(stats[index].googFrameRateSent));
        }
      }
    }

    statsReport.cameraName = stream.getVideoTracks()[0].label || NaN;
    statsReport.actualVideoWidth = videoElement.videoWidth;
    statsReport.actualVideoHeight = videoElement.videoHeight;
    statsReport.mandatoryWidth = resolution[0];
    statsReport.mandatoryHeight = resolution[1];
    statsReport.encodeSetupTimeMs = this.extractEncoderSetupTime_(stats, statsTime);
    statsReport.avgEncodeTimeMs = arrayAverage(googAvgEncodeTime);
    statsReport.minEncodeTimeMs = arrayMin(googAvgEncodeTime);
    statsReport.maxEncodeTimeMs = arrayMax(googAvgEncodeTime);
    statsReport.avgInputFps = arrayAverage(googAvgFrameRateInput);
    statsReport.minInputFps = arrayMin(googAvgFrameRateInput);
    statsReport.maxInputFps = arrayMax(googAvgFrameRateInput);
    statsReport.avgSentFps = arrayAverage(googAvgFrameRateSent);
    statsReport.minSentFps = arrayMin(googAvgFrameRateSent);
    statsReport.maxSentFps = arrayMax(googAvgFrameRateSent);
    statsReport.isMuted = this.isMuted;
    statsReport.testedFrames = frameStats.numFrames;
    statsReport.blackFrames = frameStats.numBlackFrames;
    statsReport.frozenFrames = frameStats.numFrozenFrames;

    // TODO: Add a reportInfo() function with a table format to display
    // values clearer.
    report.traceEventInstant('video-stats', statsReport);

    this.testExpectations_(statsReport);
  },

  endCall_: function endCall_(callObject, stream) {
    this.isShuttingDown = true;
    stream.getTracks().forEach(function (track) {
      track.stop();
    });
    callObject.close();
  },

  extractEncoderSetupTime_: function extractEncoderSetupTime_(stats, statsTime) {
    for (var index = 0; index !== stats.length; index++) {
      if (stats[index].type === 'ssrc') {
        if (parseInt(stats[index].googFrameRateInput) > 0) {
          return JSON.stringify(statsTime[index] - statsTime[0]);
        }
      }
    }
    return NaN;
  },

  resolutionMatchesIndependentOfRotationOrCrop_: function resolutionMatchesIndependentOfRotationOrCrop_(aWidth, aHeight, bWidth, bHeight) {
    var minRes = Math.min(bWidth, bHeight);
    return aWidth === bWidth && aHeight === bHeight || aWidth === bHeight && aHeight === bWidth || aWidth === minRes && bHeight === minRes;
  },

  testExpectations_: function testExpectations_(info) {
    var notAvailableStats = [];
    for (var key in info) {
      if (info.hasOwnProperty(key)) {
        if (typeof info[key] === 'number' && isNaN(info[key])) {
          notAvailableStats.push(key);
        } else {
          this.test.reportInfo(key + ': ' + info[key]);
        }
      }
    }
    if (notAvailableStats.length !== 0) {
      this.test.reportInfo('Not available: ' + notAvailableStats.join(', '));
    }

    if (isNaN(info.avgSentFps)) {
      this.test.reportInfo('Cannot verify sent FPS.');
    } else if (info.avgSentFps < 5) {
      this.test.reportError('Low average sent FPS: ' + info.avgSentFps);
    } else {
      this.test.reportSuccess('Average FPS above threshold');
    }
    if (!this.resolutionMatchesIndependentOfRotationOrCrop_(info.actualVideoWidth, info.actualVideoHeight, info.mandatoryWidth, info.mandatoryHeight)) {
      this.test.reportError('Incorrect captured resolution.');
    } else {
      this.test.reportSuccess('Captured video using expected resolution.');
    }
    if (info.testedFrames === 0) {
      this.test.reportError('Could not analyze any video frame.');
    } else {
      if (info.blackFrames > info.testedFrames / 3) {
        this.test.reportError('Camera delivering lots of black frames.');
      }
      if (info.frozenFrames > info.testedFrames / 3) {
        this.test.reportError('Camera delivering lots of frozen frames.');
      }
    }
  }
};

exports.default = CamResolutionsTest;

},{}],5:[function(require,module,exports){
'use strict';

/*
 * In generic cameras using Chrome rescaler, all resolutions should be supported
 * up to a given one and none beyond there. Special cameras, such as digitizers,
 * might support only one resolution.
 */

/*
 * "Analyze performance for "resolution"" test uses getStats, canvas and the
 * video element to analyze the video frames from a capture device. It will
 * report number of black frames, frozen frames, tested frames and various stats
 * like average encode time and FPS. A test case will be created per mandatory
 * resolution found in the "resolutions" array.
 */

Object.defineProperty(exports, "__esModule", {
  value: true
});
function CamResolutionsTest(test, resolutions) {
  this.test = test;
  this.resolutions = resolutions;
  this.currentResolution = 0;
  this.isMuted = false;
  this.isShuttingDown = false;
}

CamResolutionsTest.prototype = {
  run: function run() {
    this.startGetUserMedia(this.resolutions[this.currentResolution]);
  },

  startGetUserMedia: function startGetUserMedia(resolution) {
    var constraints = {
      audio: false,
      video: {
        width: { exact: resolution[0] },
        height: { exact: resolution[1] }
      }
    };
    navigator.mediaDevices.getUserMedia(constraints).then(function (stream) {
      // Do not check actual video frames when more than one resolution is
      // provided.
      if (this.resolutions.length > 1) {
        this.test.reportSuccess('Supported: ' + resolution[0] + 'x' + resolution[1]);
        stream.getTracks().forEach(function (track) {
          track.stop();
        });
        this.maybeContinueGetUserMedia();
      } else {
        this.collectAndAnalyzeStats_(stream, resolution);
      }
    }.bind(this)).catch(function (error) {
      if (this.resolutions.length > 1) {
        this.test.reportInfo(resolution[0] + 'x' + resolution[1] + ' not supported');
      } else {
        this.test.reportError('getUserMedia failed with error: ' + error.name);
      }
      this.maybeContinueGetUserMedia();
    }.bind(this));
  },

  maybeContinueGetUserMedia: function maybeContinueGetUserMedia() {
    if (this.currentResolution === this.resolutions.length) {
      this.test.done();
      return;
    }
    this.startGetUserMedia(this.resolutions[this.currentResolution++]);
  },

  collectAndAnalyzeStats_: function collectAndAnalyzeStats_(stream, resolution) {
    var tracks = stream.getVideoTracks();
    if (tracks.length < 1) {
      this.test.reportError('No video track in returned stream.');
      this.maybeContinueGetUserMedia();
      return;
    }

    // Firefox does not support event handlers on mediaStreamTrack yet.
    // https://developer.mozilla.org/en-US/docs/Web/API/MediaStreamTrack
    // TODO: remove if (...) when event handlers are supported by Firefox.
    var videoTrack = tracks[0];
    if (typeof videoTrack.addEventListener === 'function') {
      // Register events.
      videoTrack.addEventListener('ended', function () {
        // Ignore events when shutting down the test.
        if (this.isShuttingDown) {
          return;
        }
        this.test.reportError('Video track ended, camera stopped working');
      }.bind(this));
      videoTrack.addEventListener('mute', function () {
        // Ignore events when shutting down the test.
        if (this.isShuttingDown) {
          return;
        }
        this.test.reportWarning('Your camera reported itself as muted.');
        // MediaStreamTrack.muted property is not wired up in Chrome yet,
        // checking isMuted local state.
        this.isMuted = true;
      }.bind(this));
      videoTrack.addEventListener('unmute', function () {
        // Ignore events when shutting down the test.
        if (this.isShuttingDown) {
          return;
        }
        this.test.reportInfo('Your camera reported itself as unmuted.');
        this.isMuted = false;
      }.bind(this));
    }

    var video = document.createElement('video');
    video.setAttribute('autoplay', '');
    video.setAttribute('muted', '');
    video.width = resolution[0];
    video.height = resolution[1];
    video.srcObject = stream;
    var frameChecker = new VideoFrameChecker(video);
    var call = new Call(null, this.test);
    call.pc1.addStream(stream);
    call.establishConnection();
    call.gatherStats(call.pc1, null, stream, this.onCallEnded_.bind(this, resolution, video, stream, frameChecker), 100);

    setTimeoutWithProgressBar(this.endCall_.bind(this, call, stream), 8000);
  },

  onCallEnded_: function onCallEnded_(resolution, videoElement, stream, frameChecker, stats, statsTime) {
    this.analyzeStats_(resolution, videoElement, stream, frameChecker, stats, statsTime);

    frameChecker.stop();

    this.test.done();
  },

  analyzeStats_: function analyzeStats_(resolution, videoElement, stream, frameChecker, stats, statsTime) {
    var googAvgEncodeTime = [];
    var googAvgFrameRateInput = [];
    var googAvgFrameRateSent = [];
    var statsReport = {};
    var frameStats = frameChecker.frameStats;

    for (var index in stats) {
      if (stats[index].type === 'ssrc') {
        // Make sure to only capture stats after the encoder is setup.
        if (parseInt(stats[index].googFrameRateInput) > 0) {
          googAvgEncodeTime.push(parseInt(stats[index].googAvgEncodeMs));
          googAvgFrameRateInput.push(parseInt(stats[index].googFrameRateInput));
          googAvgFrameRateSent.push(parseInt(stats[index].googFrameRateSent));
        }
      }
    }

    statsReport.cameraName = stream.getVideoTracks()[0].label || NaN;
    statsReport.actualVideoWidth = videoElement.videoWidth;
    statsReport.actualVideoHeight = videoElement.videoHeight;
    statsReport.mandatoryWidth = resolution[0];
    statsReport.mandatoryHeight = resolution[1];
    statsReport.encodeSetupTimeMs = this.extractEncoderSetupTime_(stats, statsTime);
    statsReport.avgEncodeTimeMs = arrayAverage(googAvgEncodeTime);
    statsReport.minEncodeTimeMs = arrayMin(googAvgEncodeTime);
    statsReport.maxEncodeTimeMs = arrayMax(googAvgEncodeTime);
    statsReport.avgInputFps = arrayAverage(googAvgFrameRateInput);
    statsReport.minInputFps = arrayMin(googAvgFrameRateInput);
    statsReport.maxInputFps = arrayMax(googAvgFrameRateInput);
    statsReport.avgSentFps = arrayAverage(googAvgFrameRateSent);
    statsReport.minSentFps = arrayMin(googAvgFrameRateSent);
    statsReport.maxSentFps = arrayMax(googAvgFrameRateSent);
    statsReport.isMuted = this.isMuted;
    statsReport.testedFrames = frameStats.numFrames;
    statsReport.blackFrames = frameStats.numBlackFrames;
    statsReport.frozenFrames = frameStats.numFrozenFrames;

    // TODO: Add a reportInfo() function with a table format to display
    // values clearer.
    report.traceEventInstant('video-stats', statsReport);

    this.testExpectations_(statsReport);
  },

  endCall_: function endCall_(callObject, stream) {
    this.isShuttingDown = true;
    stream.getTracks().forEach(function (track) {
      track.stop();
    });
    callObject.close();
  },

  extractEncoderSetupTime_: function extractEncoderSetupTime_(stats, statsTime) {
    for (var index = 0; index !== stats.length; index++) {
      if (stats[index].type === 'ssrc') {
        if (parseInt(stats[index].googFrameRateInput) > 0) {
          return JSON.stringify(statsTime[index] - statsTime[0]);
        }
      }
    }
    return NaN;
  },

  resolutionMatchesIndependentOfRotationOrCrop_: function resolutionMatchesIndependentOfRotationOrCrop_(aWidth, aHeight, bWidth, bHeight) {
    var minRes = Math.min(bWidth, bHeight);
    return aWidth === bWidth && aHeight === bHeight || aWidth === bHeight && aHeight === bWidth || aWidth === minRes && bHeight === minRes;
  },

  testExpectations_: function testExpectations_(info) {
    var notAvailableStats = [];
    for (var key in info) {
      if (info.hasOwnProperty(key)) {
        if (typeof info[key] === 'number' && isNaN(info[key])) {
          notAvailableStats.push(key);
        } else {
          this.test.reportInfo(key + ': ' + info[key]);
        }
      }
    }
    if (notAvailableStats.length !== 0) {
      this.test.reportInfo('Not available: ' + notAvailableStats.join(', '));
    }

    if (isNaN(info.avgSentFps)) {
      this.test.reportInfo('Cannot verify sent FPS.');
    } else if (info.avgSentFps < 5) {
      this.test.reportError('Low average sent FPS: ' + info.avgSentFps);
    } else {
      this.test.reportSuccess('Average FPS above threshold');
    }
    if (!this.resolutionMatchesIndependentOfRotationOrCrop_(info.actualVideoWidth, info.actualVideoHeight, info.mandatoryWidth, info.mandatoryHeight)) {
      this.test.reportError('Incorrect captured resolution.');
    } else {
      this.test.reportSuccess('Captured video using expected resolution.');
    }
    if (info.testedFrames === 0) {
      this.test.reportError('Could not analyze any video frame.');
    } else {
      if (info.blackFrames > info.testedFrames / 3) {
        this.test.reportError('Camera delivering lots of black frames.');
      }
      if (info.frozenFrames > info.testedFrames / 3) {
        this.test.reportError('Camera delivering lots of frozen frames.');
      }
    }
  }
};

exports.default = CamResolutionsTest;

},{}],6:[function(require,module,exports){
'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
function RunConnectivityTest(test, iceCandidateFilter) {
  this.test = test;
  this.iceCandidateFilter = iceCandidateFilter;
  this.timeout = null;
  this.parsedCandidates = [];
  this.call = null;
}

RunConnectivityTest.prototype = {
  run: function run() {
    Call.asyncCreateTurnConfig(this.start.bind(this), this.test.reportFatal.bind(this.test));
  },

  start: function start(config) {
    this.call = new Call(config, this.test);
    this.call.setIceCandidateFilter(this.iceCandidateFilter);

    // Collect all candidates for validation.
    this.call.pc1.addEventListener('icecandidate', function (event) {
      if (event.candidate) {
        var parsedCandidate = Call.parseCandidate(event.candidate.candidate);
        this.parsedCandidates.push(parsedCandidate);

        // Report candidate info based on iceCandidateFilter.
        if (this.iceCandidateFilter(parsedCandidate)) {
          this.test.reportInfo('Gathered candidate of Type: ' + parsedCandidate.type + ' Protocol: ' + parsedCandidate.protocol + ' Address: ' + parsedCandidate.address);
        }
      }
    }.bind(this));

    var ch1 = this.call.pc1.createDataChannel(null);
    ch1.addEventListener('open', function () {
      ch1.send('hello');
    });
    ch1.addEventListener('message', function (event) {
      if (event.data !== 'world') {
        this.test.reportError('Invalid data transmitted.');
      } else {
        this.test.reportSuccess('Data successfully transmitted between peers.');
      }
      this.hangup();
    }.bind(this));
    this.call.pc2.addEventListener('datachannel', function (event) {
      var ch2 = event.channel;
      ch2.addEventListener('message', function (event) {
        if (event.data !== 'hello') {
          this.hangup('Invalid data transmitted.');
        } else {
          ch2.send('world');
        }
      }.bind(this));
    }.bind(this));
    this.call.establishConnection();
    this.timeout = setTimeout(this.hangup.bind(this, 'Timed out'), 5000);
  },

  findParsedCandidateOfSpecifiedType: function findParsedCandidateOfSpecifiedType(candidateTypeMethod) {
    for (var candidate in this.parsedCandidates) {
      if (candidateTypeMethod(this.parsedCandidates[candidate])) {
        return candidateTypeMethod(this.parsedCandidates[candidate]);
      }
    }
  },

  hangup: function hangup(errorMessage) {
    if (errorMessage) {
      // Report warning for server reflexive test if it times out.
      if (errorMessage === 'Timed out' && this.iceCandidateFilter.toString() === Call.isReflexive.toString() && this.findParsedCandidateOfSpecifiedType(Call.isReflexive)) {
        this.test.reportWarning('Could not connect using reflexive ' + 'candidates, likely due to the network environment/configuration.');
      } else {
        this.test.reportError(errorMessage);
      }
    }
    clearTimeout(this.timeout);
    this.call.close();
    this.test.done();
  }
};

exports.default = RunConnectivityTest;

},{}],7:[function(require,module,exports){
'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
function DataChannelThroughputTest(test) {
  this.test = test;
  this.testDurationSeconds = 5.0;
  this.startTime = null;
  this.sentPayloadBytes = 0;
  this.receivedPayloadBytes = 0;
  this.stopSending = false;
  this.samplePacket = '';

  for (var i = 0; i !== 1024; ++i) {
    this.samplePacket += 'h';
  }

  this.maxNumberOfPacketsToSend = 1;
  this.bytesToKeepBuffered = 1024 * this.maxNumberOfPacketsToSend;
  this.lastBitrateMeasureTime = null;
  this.lastReceivedPayloadBytes = 0;

  this.call = null;
  this.senderChannel = null;
  this.receiveChannel = null;
}

DataChannelThroughputTest.prototype = {
  run: function run() {
    Call.asyncCreateTurnConfig(this.start.bind(this), this.test.reportFatal.bind(this.test));
  },

  start: function start(config) {
    this.call = new Call(config, this.test);
    this.call.setIceCandidateFilter(Call.isRelay);
    this.senderChannel = this.call.pc1.createDataChannel(null);
    this.senderChannel.addEventListener('open', this.sendingStep.bind(this));

    this.call.pc2.addEventListener('datachannel', this.onReceiverChannel.bind(this));

    this.call.establishConnection();
  },

  onReceiverChannel: function onReceiverChannel(event) {
    this.receiveChannel = event.channel;
    this.receiveChannel.addEventListener('message', this.onMessageReceived.bind(this));
  },

  sendingStep: function sendingStep() {
    var now = new Date();
    if (!this.startTime) {
      this.startTime = now;
      this.lastBitrateMeasureTime = now;
    }

    for (var i = 0; i !== this.maxNumberOfPacketsToSend; ++i) {
      if (this.senderChannel.bufferedAmount >= this.bytesToKeepBuffered) {
        break;
      }
      this.sentPayloadBytes += this.samplePacket.length;
      this.senderChannel.send(this.samplePacket);
    }

    if (now - this.startTime >= 1000 * this.testDurationSeconds) {
      this.test.setProgress(100);
      this.stopSending = true;
    } else {
      this.test.setProgress((now - this.startTime) / (10 * this.testDurationSeconds));
      setTimeout(this.sendingStep.bind(this), 1);
    }
  },

  onMessageReceived: function onMessageReceived(event) {
    this.receivedPayloadBytes += event.data.length;
    var now = new Date();
    if (now - this.lastBitrateMeasureTime >= 1000) {
      var bitrate = (this.receivedPayloadBytes - this.lastReceivedPayloadBytes) / (now - this.lastBitrateMeasureTime);
      bitrate = Math.round(bitrate * 1000 * 8) / 1000;
      this.test.reportSuccess('Transmitting at ' + bitrate + ' kbps.');
      this.lastReceivedPayloadBytes = this.receivedPayloadBytes;
      this.lastBitrateMeasureTime = now;
    }
    if (this.stopSending && this.sentPayloadBytes === this.receivedPayloadBytes) {
      this.call.close();
      this.call = null;

      var elapsedTime = Math.round((now - this.startTime) * 10) / 10000.0;
      var receivedKBits = this.receivedPayloadBytes * 8 / 1000;
      this.test.reportSuccess('Total transmitted: ' + receivedKBits + ' kilo-bits in ' + elapsedTime + ' seconds.');
      this.test.done();
    }
  }
};

exports.default = DataChannelThroughputTest;

},{}],8:[function(require,module,exports){
'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
function MicTest(test) {
  this.test = test;
  this.inputChannelCount = 6;
  this.outputChannelCount = 2;
  // Buffer size set to 0 to let Chrome choose based on the platform.
  this.bufferSize = 0;
  // Turning off echoCancellation constraint enables stereo input.
  this.constraints = {
    audio: {
      optional: [{ echoCancellation: false }]
    }
  };

  this.collectSeconds = 2.0;
  // At least one LSB 16-bit data (compare is on absolute value).
  this.silentThreshold = 1.0 / 32767;
  this.lowVolumeThreshold = -60;
  // Data must be identical within one LSB 16-bit to be identified as mono.
  this.monoDetectThreshold = 1.0 / 65536;
  // Number of consequtive clipThreshold level samples that indicate clipping.
  this.clipCountThreshold = 6;
  this.clipThreshold = 1.0;

  // Populated with audio as a 3-dimensional array:
  //   collectedAudio[channels][buffers][samples]
  this.collectedAudio = [];
  this.collectedSampleCount = 0;
  for (var i = 0; i < this.inputChannelCount; ++i) {
    this.collectedAudio[i] = [];
  }
}

MicTest.prototype = {
  run: function run() {
    if (typeof audioContext === 'undefined') {
      this.test.reportError('WebAudio is not supported, test cannot run.');
      this.test.done();
    } else {
      doGetUserMedia(this.constraints, this.gotStream.bind(this));
    }
  },

  gotStream: function gotStream(stream) {
    if (!this.checkAudioTracks(stream)) {
      this.test.done();
      return;
    }
    this.createAudioBuffer(stream);
  },

  checkAudioTracks: function checkAudioTracks(stream) {
    this.stream = stream;
    var audioTracks = stream.getAudioTracks();
    if (audioTracks.length < 1) {
      this.test.reportError('No audio track in returned stream.');
      return false;
    }
    this.test.reportSuccess('Audio track created using device=' + audioTracks[0].label);
    return true;
  },

  createAudioBuffer: function createAudioBuffer() {
    this.audioSource = audioContext.createMediaStreamSource(this.stream);
    this.scriptNode = audioContext.createScriptProcessor(this.bufferSize, this.inputChannelCount, this.outputChannelCount);
    this.audioSource.connect(this.scriptNode);
    this.scriptNode.connect(audioContext.destination);
    this.scriptNode.onaudioprocess = this.collectAudio.bind(this);
    this.stopCollectingAudio = setTimeoutWithProgressBar(this.onStopCollectingAudio.bind(this), 5000);
  },

  collectAudio: function collectAudio(event) {
    // Simple silence detection: check first and last sample of each channel in
    // the buffer. If both are below a threshold, the buffer is considered
    // silent.
    var sampleCount = event.inputBuffer.length;
    var allSilent = true;
    for (var c = 0; c < event.inputBuffer.numberOfChannels; c++) {
      var data = event.inputBuffer.getChannelData(c);
      var first = Math.abs(data[0]);
      var last = Math.abs(data[sampleCount - 1]);
      var newBuffer;
      if (first > this.silentThreshold || last > this.silentThreshold) {
        // Non-silent buffers are copied for analysis. Note that the silent
        // detection will likely cause the stored stream to contain discontinu-
        // ities, but that is ok for our needs here (just looking at levels).
        newBuffer = new Float32Array(sampleCount);
        newBuffer.set(data);
        allSilent = false;
      } else {
        // Silent buffers are not copied, but we store empty buffers so that the
        // analysis doesn't have to care.
        newBuffer = new Float32Array();
      }
      this.collectedAudio[c].push(newBuffer);
    }
    if (!allSilent) {
      this.collectedSampleCount += sampleCount;
      if (this.collectedSampleCount / event.inputBuffer.sampleRate >= this.collectSeconds) {
        this.stopCollectingAudio();
      }
    }
  },

  onStopCollectingAudio: function onStopCollectingAudio() {
    this.stream.getAudioTracks()[0].stop();
    this.audioSource.disconnect(this.scriptNode);
    this.scriptNode.disconnect(audioContext.destination);
    this.analyzeAudio(this.collectedAudio);
    this.test.done();
  },

  analyzeAudio: function analyzeAudio(channels) {
    var activeChannels = [];
    for (var c = 0; c < channels.length; c++) {
      if (this.channelStats(c, channels[c])) {
        activeChannels.push(c);
      }
    }
    if (activeChannels.length === 0) {
      this.test.reportError('No active input channels detected. Microphone ' + 'is most likely muted or broken, please check if muted in the ' + 'sound settings or physically on the device. Then rerun the test.');
    } else {
      this.test.reportSuccess('Active audio input channels: ' + activeChannels.length);
    }
    if (activeChannels.length === 2) {
      this.detectMono(channels[activeChannels[0]], channels[activeChannels[1]]);
    }
  },

  channelStats: function channelStats(channelNumber, buffers) {
    var maxPeak = 0.0;
    var maxRms = 0.0;
    var clipCount = 0;
    var maxClipCount = 0;
    for (var j = 0; j < buffers.length; j++) {
      var samples = buffers[j];
      if (samples.length > 0) {
        var s = 0;
        var rms = 0.0;
        for (var i = 0; i < samples.length; i++) {
          s = Math.abs(samples[i]);
          maxPeak = Math.max(maxPeak, s);
          rms += s * s;
          if (maxPeak >= this.clipThreshold) {
            clipCount++;
            maxClipCount = Math.max(maxClipCount, clipCount);
          } else {
            clipCount = 0;
          }
        }
        // RMS is calculated over each buffer, meaning the integration time will
        // be different depending on sample rate and buffer size. In practise
        // this should be a small problem.
        rms = Math.sqrt(rms / samples.length);
        maxRms = Math.max(maxRms, rms);
      }
    }

    if (maxPeak > this.silentThreshold) {
      var dBPeak = this.dBFS(maxPeak);
      var dBRms = this.dBFS(maxRms);
      this.test.reportInfo('Channel ' + channelNumber + ' levels: ' + dBPeak.toFixed(1) + ' dB (peak), ' + dBRms.toFixed(1) + ' dB (RMS)');
      if (dBRms < this.lowVolumeThreshold) {
        this.test.reportError('Microphone input level is low, increase input ' + 'volume or move closer to the microphone.');
      }
      if (maxClipCount > this.clipCountThreshold) {
        this.test.reportWarning('Clipping detected! Microphone input level ' + 'is high. Decrease input volume or move away from the microphone.');
      }
      return true;
    }
    return false;
  },

  detectMono: function detectMono(buffersL, buffersR) {
    var diffSamples = 0;
    for (var j = 0; j < buffersL.length; j++) {
      var l = buffersL[j];
      var r = buffersR[j];
      if (l.length === r.length) {
        var d = 0.0;
        for (var i = 0; i < l.length; i++) {
          d = Math.abs(l[i] - r[i]);
          if (d > this.monoDetectThreshold) {
            diffSamples++;
          }
        }
      } else {
        diffSamples++;
      }
    }
    if (diffSamples > 0) {
      this.test.reportInfo('Stereo microphone detected.');
    } else {
      this.test.reportInfo('Mono microphone detected.');
    }
  },

  dBFS: function dBFS(gain) {
    var dB = 20 * Math.log(gain) / Math.log(10);
    // Use Math.round to display up to one decimal place.
    return Math.round(dB * 10) / 10;
  }
};

exports.default = MicTest;

},{}],9:[function(require,module,exports){
'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
var NetworkTest = function NetworkTest(test, protocol, params, iceCandidateFilter) {
  this.test = test;
  this.protocol = protocol;
  this.params = params;
  this.iceCandidateFilter = iceCandidateFilter;
};

NetworkTest.prototype = {
  run: function run() {
    // Do not create turn config for IPV6 test.
    if (this.iceCandidateFilter.toString() === Call.isIpv6.toString()) {
      this.gatherCandidates(null, this.params, this.iceCandidateFilter);
    } else {
      Call.asyncCreateTurnConfig(this.start.bind(this), this.test.reportFatal.bind(this.test));
    }
  },

  start: function start(config) {
    this.filterConfig(config, this.protocol);
    this.gatherCandidates(config, this.params, this.iceCandidateFilter);
  },

  // Filter the RTCConfiguration |config| to only contain URLs with the
  // specified transport protocol |protocol|. If no turn transport is
  // specified it is added with the requested protocol.
  filterConfig: function filterConfig(config, protocol) {
    var transport = 'transport=' + protocol;
    var newIceServers = [];
    for (var i = 0; i < config.iceServers.length; ++i) {
      var iceServer = config.iceServers[i];
      var newUrls = [];
      for (var j = 0; j < iceServer.urls.length; ++j) {
        var uri = iceServer.urls[j];
        if (uri.indexOf(transport) !== -1) {
          newUrls.push(uri);
        } else if (uri.indexOf('?transport=') === -1 && uri.startsWith('turn')) {
          newUrls.push(uri + '?' + transport);
        }
      }
      if (newUrls.length !== 0) {
        iceServer.urls = newUrls;
        newIceServers.push(iceServer);
      }
    }
    config.iceServers = newIceServers;
  },

  // Create a PeerConnection, and gather candidates using RTCConfig |config|
  // and ctor params |params|. Succeed if any candidates pass the |isGood|
  // check, fail if we complete gathering without any passing.
  gatherCandidates: function gatherCandidates(config, params, isGood) {
    var pc;
    try {
      pc = new RTCPeerConnection(config, params);
    } catch (error) {
      if (params !== null && params.optional[0].googIPv6) {
        this.test.reportWarning('Failed to create peer connection, IPv6 ' + 'might not be setup/supported on the network.');
      } else {
        this.test.reportError('Failed to create peer connection: ' + error);
      }
      this.test.done();
      return;
    }

    // In our candidate callback, stop if we get a candidate that passes
    // |isGood|.
    pc.addEventListener('icecandidate', function (e) {
      // Once we've decided, ignore future callbacks.
      if (e.currentTarget.signalingState === 'closed') {
        return;
      }

      if (e.candidate) {
        var parsed = Call.parseCandidate(e.candidate.candidate);
        if (isGood(parsed)) {
          this.test.reportSuccess('Gathered candidate of Type: ' + parsed.type + ' Protocol: ' + parsed.protocol + ' Address: ' + parsed.address);
          pc.close();
          pc = null;
          this.test.done();
        }
      } else {
        pc.close();
        pc = null;
        if (params !== null && params.optional[0].googIPv6) {
          this.test.reportWarning('Failed to gather IPv6 candidates, it ' + 'might not be setup/supported on the network.');
        } else {
          this.test.reportError('Failed to gather specified candidates');
        }
        this.test.done();
      }
    }.bind(this));

    this.createAudioOnlyReceiveOffer(pc);
  },

  // Create an audio-only, recvonly offer, and setLD with it.
  // This will trigger candidate gathering.
  createAudioOnlyReceiveOffer: function createAudioOnlyReceiveOffer(pc) {
    var createOfferParams = { offerToReceiveAudio: 1 };
    pc.createOffer(createOfferParams).then(function (offer) {
      pc.setLocalDescription(offer).then(noop, noop);
    }, noop);

    // Empty function for callbacks requiring a function.
    function noop() {}
  }
};

exports.default = NetworkTest;

},{}],10:[function(require,module,exports){
'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
function VideoBandwidthTest(test) {
  this.test = test;
  this.maxVideoBitrateKbps = 2000;
  this.durationMs = 40000;
  this.statStepMs = 100;
  this.bweStats = new StatisticsAggregate(0.75 * this.maxVideoBitrateKbps * 1000);
  this.rttStats = new StatisticsAggregate();
  this.packetsLost = -1;
  this.nackCount = -1;
  this.pliCount = -1;
  this.qpSum = -1;
  this.packetsSent = -1;
  this.packetsReceived = -1;
  this.framesEncoded = -1;
  this.framesDecoded = -1;
  this.framesSent = -1;
  this.bytesSent = -1;
  this.videoStats = [];
  this.startTime = null;
  this.call = null;
  // Open the camera in 720p to get a correct measurement of ramp-up time.
  this.constraints = {
    audio: false,
    video: {
      optional: [{ minWidth: 1280 }, { minHeight: 720 }]
    }
  };
}

VideoBandwidthTest.prototype = {
  run: function run() {
    Call.asyncCreateTurnConfig(this.start.bind(this), this.test.reportFatal.bind(this.test));
  },

  start: function start(config) {
    this.call = new Call(config, this.test);
    this.call.setIceCandidateFilter(Call.isRelay);
    // FEC makes it hard to study bandwidth estimation since there seems to be
    // a spike when it is enabled and disabled. Disable it for now. FEC issue
    // tracked on: https://code.google.com/p/webrtc/issues/detail?id=3050
    this.call.disableVideoFec();
    this.call.constrainVideoBitrate(this.maxVideoBitrateKbps);
    doGetUserMedia(this.constraints, this.gotStream.bind(this));
  },

  gotStream: function gotStream(stream) {
    this.call.pc1.addStream(stream);
    this.call.establishConnection();
    this.startTime = new Date();
    this.localStream = stream.getVideoTracks()[0];
    setTimeout(this.gatherStats.bind(this), this.statStepMs);
  },

  gatherStats: function gatherStats() {
    var now = new Date();
    if (now - this.startTime > this.durationMs) {
      this.test.setProgress(100);
      this.hangup();
      return;
    } else if (!this.call.statsGatheringRunning) {
      this.call.gatherStats(this.call.pc1, this.call.pc2, this.localStream, this.gotStats.bind(this));
    }
    this.test.setProgress((now - this.startTime) * 100 / this.durationMs);
    setTimeout(this.gatherStats.bind(this), this.statStepMs);
  },

  gotStats: function gotStats(response, time, response2, time2) {
    // TODO: Remove browser specific stats gathering hack once adapter.js or
    // browsers converge on a standard.
    if (adapter.browserDetails.browser === 'chrome') {
      for (var i in response) {
        if (typeof response[i].connection !== 'undefined') {
          this.bweStats.add(response[i].connection.timestamp, parseInt(response[i].connection.availableOutgoingBitrate));
          this.rttStats.add(response[i].connection.timestamp, parseInt(response[i].connection.currentRoundTripTime * 1000));
          // Grab the last stats.
          this.videoStats[0] = response[i].video.local.frameWidth;
          this.videoStats[1] = response[i].video.local.frameHeight;
          this.nackCount = response[i].video.local.nackCount;
          this.packetsLost = response2[i].video.remote.packetsLost;
          this.qpSum = response2[i].video.remote.qpSum;
          this.pliCount = response[i].video.local.pliCount;
          this.packetsSent = response[i].video.local.packetsSent;
          this.packetsReceived = response2[i].video.remote.packetsReceived;
          this.framesEncoded = response[i].video.local.framesEncoded;
          this.framesDecoded = response2[i].video.remote.framesDecoded;
        }
      }
    } else if (adapter.browserDetails.browser === 'firefox') {
      for (var j in response) {
        if (response[j].id === 'outbound_rtcp_video_0') {
          this.rttStats.add(Date.parse(response[j].timestamp), parseInt(response[j].mozRtt));
          // Grab the last stats.
          this.jitter = response[j].jitter;
          this.packetsLost = response[j].packetsLost;
        } else if (response[j].id === 'outbound_rtp_video_0') {
          // TODO: Get dimensions from getStats when supported in FF.
          this.videoStats[0] = 'Not supported on Firefox';
          this.videoStats[1] = 'Not supported on Firefox';
          this.bitrateMean = response[j].bitrateMean;
          this.bitrateStdDev = response[j].bitrateStdDev;
          this.framerateMean = response[j].framerateMean;
        }
      }
    } else {
      this.test.reportError('Only Firefox and Chrome getStats implementations' + ' are supported.');
    }
    this.completed();
  },

  hangup: function hangup() {
    this.call.pc1.getLocalStreams()[0].getTracks().forEach(function (track) {
      track.stop();
    });
    this.call.close();
    this.call = null;
  },

  completed: function completed() {
    // TODO: Remove browser specific stats gathering hack once adapter.js or
    // browsers converge on a standard.
    if (adapter.browserDetails.browser === 'chrome') {
      // Checking if greater than 2 because Chrome sometimes reports 2x2 when
      // a camera starts but fails to deliver frames.
      if (this.videoStats[0] < 2 && this.videoStats[1] < 2) {
        this.test.reportError('Camera failure: ' + this.videoStats[0] + 'x' + this.videoStats[1] + '. Cannot test bandwidth without a working ' + ' camera.');
      } else {
        this.test.reportSuccess('Video resolution: ' + this.videoStats[0] + 'x' + this.videoStats[1]);
        this.test.reportInfo('Send bandwidth estimate average: ' + Math.round(this.bweStats.getAverage() / 1000) + ' kbps');
        this.test.reportInfo('Send bandwidth estimate max: ' + this.bweStats.getMax() / 1000 + ' kbps');
        this.test.reportInfo('Send bandwidth ramp-up time: ' + this.bweStats.getRampUpTime() + ' ms');
        this.test.reportInfo('Packets sent: ' + this.packetsSent);
        this.test.reportInfo('Packets received: ' + this.packetsReceived);
        this.test.reportInfo('NACK count: ' + this.nackCount);
        this.test.reportInfo('Picture loss indications: ' + this.pliCount);
        this.test.reportInfo('Quality predictor sum: ' + this.qpSum);
        this.test.reportInfo('Frames encoded: ' + this.framesEncoded);
        this.test.reportInfo('Frames decoded: ' + this.framesDecoded);
      }
    } else if (adapter.browserDetails.browser === 'firefox') {
      if (parseInt(this.framerateMean) > 0) {
        this.test.reportSuccess('Frame rate mean: ' + parseInt(this.framerateMean));
      } else {
        this.test.reportError('Frame rate mean is 0, cannot test bandwidth ' + 'without a working camera.');
      }
      this.test.reportInfo('Send bitrate mean: ' + parseInt(this.bitrateMean) / 1000 + ' kbps');
      this.test.reportInfo('Send bitrate standard deviation: ' + parseInt(this.bitrateStdDev) / 1000 + ' kbps');
    }
    this.test.reportInfo('RTT average: ' + this.rttStats.getAverage() + ' ms');
    this.test.reportInfo('RTT max: ' + this.rttStats.getMax() + ' ms');
    this.test.reportInfo('Packets lost: ' + this.packetsLost);
    this.test.done();
  }
};

exports.default = VideoBandwidthTest;

},{}],11:[function(require,module,exports){
'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
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
  run: function run() {
    Call.asyncCreateTurnConfig(this.start.bind(this), this.test.reportFatal.bind(this.test));
  },

  start: function start(config) {
    this.running = true;
    this.call = new Call(config, this.test);
    this.chart = this.test.createLineChart();
    this.call.setIceCandidateFilter(this.candidateFilter);

    this.senderChannel = this.call.pc1.createDataChannel({ ordered: false,
      maxRetransmits: 0 });
    this.senderChannel.addEventListener('open', this.send.bind(this));
    this.call.pc2.addEventListener('datachannel', this.onReceiverChannel.bind(this));
    this.call.establishConnection();

    setTimeoutWithProgressBar(this.finishTest.bind(this), this.testDurationMs);
  },

  onReceiverChannel: function onReceiverChannel(event) {
    this.receiveChannel = event.channel;
    this.receiveChannel.addEventListener('message', this.receive.bind(this));
  },

  send: function send() {
    if (!this.running) {
      return;
    }
    this.senderChannel.send('' + Date.now());
    setTimeout(this.send.bind(this), this.sendIntervalMs);
  },

  receive: function receive(event) {
    if (!this.running) {
      return;
    }
    var sendTime = parseInt(event.data);
    var delay = Date.now() - sendTime;
    this.recvTimeStamps.push(sendTime);
    this.delays.push(delay);
    this.chart.addDatapoint(sendTime + delay, delay);
  },

  finishTest: function finishTest() {
    report.traceEventInstant('periodic-delay', { delays: this.delays,
      recvTimeStamps: this.recvTimeStamps });
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
      this.test.reportError('Not enough samples gathered. Keep the page on ' + ' the foreground while the test is running.');
    } else {
      this.test.reportSuccess('Collected ' + this.delays.length + ' delay samples.');
    }

    if (max > (min + 100) * 2) {
      this.test.reportError('There is a big difference between the min and ' + 'max delay of packets. Your network appears unstable.');
    }
    this.test.done();
  }
};

exports.default = WiFiPeriodicScanTest;

},{}],12:[function(require,module,exports){
/*
 *  Copyright (c) 2014 The WebRTC project authors. All Rights Reserved.
 *
 *  Use of this source code is governed by a BSD-style license
 *  that can be found in the LICENSE file in the root of the source
 *  tree.
 */
'use strict';
/* global enumerateStats */

Object.defineProperty(exports, "__esModule", {
  value: true
});
function Call(config, test) {
  this.test = test;
  this.traceEvent = report.traceEventAsync('call');
  this.traceEvent({ config: config });
  this.statsGatheringRunning = false;

  this.pc1 = new RTCPeerConnection(config);
  this.pc2 = new RTCPeerConnection(config);

  this.pc1.addEventListener('icecandidate', this.onIceCandidate_.bind(this, this.pc2));
  this.pc2.addEventListener('icecandidate', this.onIceCandidate_.bind(this, this.pc1));

  this.iceCandidateFilter_ = Call.noFilter;
}

Call.prototype = {
  establishConnection: function establishConnection() {
    this.traceEvent({ state: 'start' });
    this.pc1.createOffer().then(this.gotOffer_.bind(this), this.test.reportFatal.bind(this.test));
  },

  close: function close() {
    this.traceEvent({ state: 'end' });
    this.pc1.close();
    this.pc2.close();
  },

  setIceCandidateFilter: function setIceCandidateFilter(filter) {
    this.iceCandidateFilter_ = filter;
  },

  // Constraint max video bitrate by modifying the SDP when creating an answer.
  constrainVideoBitrate: function constrainVideoBitrate(maxVideoBitrateKbps) {
    this.constrainVideoBitrateKbps_ = maxVideoBitrateKbps;
  },

  // Remove video FEC if available on the offer.
  disableVideoFec: function disableVideoFec() {
    this.constrainOfferToRemoveVideoFec_ = true;
  },

  // When the peerConnection is closed the statsCb is called once with an array
  // of gathered stats.
  gatherStats: function gatherStats(peerConnection, peerConnection2, localStream, statsCb) {
    var stats = [];
    var stats2 = [];
    var statsCollectTime = [];
    var statsCollectTime2 = [];
    var self = this;
    var statStepMs = 100;
    self.localTrackIds = {
      audio: '',
      video: ''
    };
    self.remoteTrackIds = {
      audio: '',
      video: ''
    };

    peerConnection.getSenders().forEach(function (sender) {
      if (sender.track.kind === 'audio') {
        self.localTrackIds.audio = sender.track.id;
      } else if (sender.track.kind === 'video') {
        self.localTrackIds.video = sender.track.id;
      }
    }.bind(self));

    if (peerConnection2) {
      peerConnection2.getReceivers().forEach(function (receiver) {
        if (receiver.track.kind === 'audio') {
          self.remoteTrackIds.audio = receiver.track.id;
        } else if (receiver.track.kind === 'video') {
          self.remoteTrackIds.video = receiver.track.id;
        }
      }.bind(self));
    }

    this.statsGatheringRunning = true;
    getStats_();

    function getStats_() {
      if (peerConnection.signalingState === 'closed') {
        self.statsGatheringRunning = false;
        statsCb(stats, statsCollectTime, stats2, statsCollectTime2);
        return;
      }
      peerConnection.getStats().then(gotStats_).catch(function (error) {
        self.test.reportError('Could not gather stats: ' + error);
        self.statsGatheringRunning = false;
        statsCb(stats, statsCollectTime);
      }.bind(self));
      if (peerConnection2) {
        peerConnection2.getStats().then(gotStats2_);
      }
    }
    // Stats for pc2, some stats are only available on the receiving end of a
    // peerconnection.
    function gotStats2_(response) {
      if (adapter.browserDetails.browser === 'chrome') {
        var enumeratedStats = enumerateStats(response, self.localTrackIds, self.remoteTrackIds);
        stats2.push(enumeratedStats);
        statsCollectTime2.push(Date.now());
      } else if (adapter.browserDetails.browser === 'firefox') {
        for (var h in response) {
          var stat = response[h];
          stats2.push(stat);
          statsCollectTime2.push(Date.now());
        }
      } else {
        self.test.reportError('Only Firefox and Chrome getStats ' + 'implementations are supported.');
      }
    }

    function gotStats_(response) {
      // TODO: Remove browser specific stats gathering hack once adapter.js or
      // browsers converge on a standard.
      if (adapter.browserDetails.browser === 'chrome') {
        var enumeratedStats = enumerateStats(response, self.localTrackIds, self.remoteTrackIds);
        stats.push(enumeratedStats);
        statsCollectTime.push(Date.now());
      } else if (adapter.browserDetails.browser === 'firefox') {
        for (var j in response) {
          var stat = response[j];
          stats.push(stat);
          statsCollectTime.push(Date.now());
        }
      } else {
        self.test.reportError('Only Firefox and Chrome getStats ' + 'implementations are supported.');
      }
      setTimeout(getStats_, statStepMs);
    }
  },

  gotOffer_: function gotOffer_(offer) {
    if (this.constrainOfferToRemoveVideoFec_) {
      offer.sdp = offer.sdp.replace(/(m=video 1 [^\r]+)(116 117)(\r\n)/g, '$1\r\n');
      offer.sdp = offer.sdp.replace(/a=rtpmap:116 red\/90000\r\n/g, '');
      offer.sdp = offer.sdp.replace(/a=rtpmap:117 ulpfec\/90000\r\n/g, '');
      offer.sdp = offer.sdp.replace(/a=rtpmap:98 rtx\/90000\r\n/g, '');
      offer.sdp = offer.sdp.replace(/a=fmtp:98 apt=116\r\n/g, '');
    }
    this.pc1.setLocalDescription(offer);
    this.pc2.setRemoteDescription(offer);
    this.pc2.createAnswer().then(this.gotAnswer_.bind(this), this.test.reportFatal.bind(this.test));
  },

  gotAnswer_: function gotAnswer_(answer) {
    if (this.constrainVideoBitrateKbps_) {
      answer.sdp = answer.sdp.replace(/a=mid:video\r\n/g, 'a=mid:video\r\nb=AS:' + this.constrainVideoBitrateKbps_ + '\r\n');
    }
    this.pc2.setLocalDescription(answer);
    this.pc1.setRemoteDescription(answer);
  },

  onIceCandidate_: function onIceCandidate_(otherPeer, event) {
    if (event.candidate) {
      var parsed = Call.parseCandidate(event.candidate.candidate);
      if (this.iceCandidateFilter_(parsed)) {
        otherPeer.addIceCandidate(event.candidate);
      }
    }
  }
};

Call.noFilter = function () {
  return true;
};

Call.isRelay = function (candidate) {
  return candidate.type === 'relay';
};

Call.isNotHostCandidate = function (candidate) {
  return candidate.type !== 'host';
};

Call.isReflexive = function (candidate) {
  return candidate.type === 'srflx';
};

Call.isHost = function (candidate) {
  return candidate.type === 'host';
};

Call.isIpv6 = function (candidate) {
  return candidate.address.indexOf(':') !== -1;
};

// Parse a 'candidate:' line into a JSON object.
Call.parseCandidate = function (text) {
  var candidateStr = 'candidate:';
  var pos = text.indexOf(candidateStr) + candidateStr.length;
  var fields = text.substr(pos).split(' ');
  return {
    'type': fields[7],
    'protocol': fields[2],
    'address': fields[4]
  };
};

// Store the ICE server response from the network traversal server.
Call.cachedIceServers_ = null;
// Keep track of when the request was made.
Call.cachedIceConfigFetchTime_ = null;

// Get a TURN config, either from settings or from network traversal server.
Call.asyncCreateTurnConfig = function (onSuccess, onError) {
  var settings = currentTest.settings;
  if (typeof settings.turnURI === 'string' && settings.turnURI !== '') {
    var iceServer = {
      'username': settings.turnUsername || '',
      'credential': settings.turnCredential || '',
      'urls': settings.turnURI.split(',')
    };
    var config = { 'iceServers': [iceServer] };
    report.traceEventInstant('turn-config', config);
    setTimeout(onSuccess.bind(null, config), 0);
  } else {
    Call.fetchTurnConfig_(function (response) {
      var config = { 'iceServers': response.iceServers };
      report.traceEventInstant('turn-config', config);
      onSuccess(config);
    }, onError);
  }
};

// Get a STUN config, either from settings or from network traversal server.
Call.asyncCreateStunConfig = function (onSuccess, onError) {
  var settings = currentTest.settings;
  if (typeof settings.stunURI === 'string' && settings.stunURI !== '') {
    var iceServer = {
      'urls': settings.stunURI.split(',')
    };
    var config = { 'iceServers': [iceServer] };
    report.traceEventInstant('stun-config', config);
    setTimeout(onSuccess.bind(null, config), 0);
  } else {
    Call.fetchTurnConfig_(function (response) {
      var config = { 'iceServers': response.iceServers.urls };
      report.traceEventInstant('stun-config', config);
      onSuccess(config);
    }, onError);
  }
};

// Ask network traversal API to give us TURN server credentials and URLs.
Call.fetchTurnConfig_ = function (onSuccess, onError) {
  // Check if credentials exist or have expired (and subtract testRuntTIme so
  // that the test can finish if near the end of the lifetime duration).
  // lifetimeDuration is in seconds.
  var testRunTime = 240; // Time in seconds to allow a test run to complete.
  if (Call.cachedIceServers_) {
    var isCachedIceConfigExpired = (Date.now() - Call.cachedIceConfigFetchTime_) / 1000 > parseInt(Call.cachedIceServers_.lifetimeDuration) - testRunTime;
    if (!isCachedIceConfigExpired) {
      report.traceEventInstant('fetch-ice-config', 'Using cached credentials.');
      onSuccess(Call.getCachedIceCredentials_());
      return;
    }
  }

  var xhr = new XMLHttpRequest();
  function onResult() {
    if (xhr.readyState !== 4) {
      return;
    }

    if (xhr.status !== 200) {
      onError('TURN request failed');
      return;
    }

    var response = JSON.parse(xhr.responseText);
    Call.cachedIceServers_ = response;
    Call.getCachedIceCredentials_ = function () {
      // Make a new object due to tests modifying the original response object.
      return JSON.parse(JSON.stringify(Call.cachedIceServers_));
    };
    Call.cachedIceConfigFetchTime_ = Date.now();
    report.traceEventInstant('fetch-ice-config', 'Fetching new credentials.');
    onSuccess(Call.getCachedIceCredentials_());
  }

  xhr.onreadystatechange = onResult;
  // API_KEY and TURN_URL is replaced with API_KEY environment variable via
  // Gruntfile.js during build time by uglifyJS.
  xhr.open('POST', TURN_URL + API_KEY, true);
  xhr.send();
};

exports.default = Call;

},{}],13:[function(require,module,exports){
/*
 *  Copyright (c) 2014 The WebRTC project authors. All Rights Reserved.
 *
 *  Use of this source code is governed by a BSD-style license
 *  that can be found in the LICENSE file in the root of the source
 *  tree.
 */
/* exported report */
'use strict';

function Report() {
  this.output_ = [];
  this.nextAsyncId_ = 0;

  // Hook console.log into the report, since that is the most common debug tool.
  this.nativeLog_ = console.log.bind(console);
  console.log = this.logHook_.bind(this);

  // Hook up window.onerror logs into the report.
  window.addEventListener('error', this.onWindowError_.bind(this));

  this.traceEventInstant('system-info', Report.getSystemInfo());
}

Report.prototype = {
  traceEventInstant: function traceEventInstant(name, args) {
    this.output_.push({ 'ts': Date.now(),
      'name': name,
      'args': args });
  },

  traceEventWithId: function traceEventWithId(name, id, args) {
    this.output_.push({ 'ts': Date.now(),
      'name': name,
      'id': id,
      'args': args });
  },

  traceEventAsync: function traceEventAsync(name) {
    return this.traceEventWithId.bind(this, name, this.nextAsyncId_++);
  },

  logTestRunResult: function logTestRunResult(testName, status) {
    // Google Analytics event for the test result to allow to track how the
    // test is doing in the wild.
    ga('send', {
      'hitType': 'event',
      'eventCategory': 'Test',
      'eventAction': status,
      'eventLabel': testName,
      'nonInteraction': 1
    });
  },

  generate: function generate(bugDescription) {
    var header = { 'title': 'WebRTC Troubleshooter bug report',
      'description': bugDescription || null };
    return this.getContent_(header);
  },

  // Returns the logs into a JSON formated string that is a list of events
  // similar to the way chrome devtools format uses. The final string is
  // manually composed to have newlines between the entries is being easier
  // to parse by human eyes. If a contentHead object argument is provided it
  // will be added at the top of the log file.
  getContent_: function getContent_(contentHead) {
    var stringArray = [];
    this.appendEventsAsString_([contentHead] || [], stringArray);
    this.appendEventsAsString_(this.output_, stringArray);
    return '[' + stringArray.join(',\n') + ']';
  },

  appendEventsAsString_: function appendEventsAsString_(events, output) {
    for (var i = 0; i !== events.length; ++i) {
      output.push(JSON.stringify(events[i]));
    }
  },

  onWindowError_: function onWindowError_(error) {
    this.traceEventInstant('error', { 'message': error.message,
      'filename': error.filename + ':' + error.lineno });
  },

  logHook_: function logHook_() {
    this.traceEventInstant('log', arguments);
    this.nativeLog_.apply(null, arguments);
  }
};

/*
 * Detects the running browser name, version and platform.
 */
Report.getSystemInfo = function () {
  // Code inspired by http://goo.gl/9dZZqE with
  // added support of modern Internet Explorer versions (Trident).
  var agent = navigator.userAgent;
  var browserName = navigator.appName;
  var version = '' + parseFloat(navigator.appVersion);
  var offsetName;
  var offsetVersion;
  var ix;

  if ((offsetVersion = agent.indexOf('Chrome')) !== -1) {
    browserName = 'Chrome';
    version = agent.substring(offsetVersion + 7);
  } else if ((offsetVersion = agent.indexOf('MSIE')) !== -1) {
    browserName = 'Microsoft Internet Explorer'; // Older IE versions.
    version = agent.substring(offsetVersion + 5);
  } else if ((offsetVersion = agent.indexOf('Trident')) !== -1) {
    browserName = 'Microsoft Internet Explorer'; // Newer IE versions.
    version = agent.substring(offsetVersion + 8);
  } else if ((offsetVersion = agent.indexOf('Firefox')) !== -1) {
    browserName = 'Firefox';
  } else if ((offsetVersion = agent.indexOf('Safari')) !== -1) {
    browserName = 'Safari';
    version = agent.substring(offsetVersion + 7);
    if ((offsetVersion = agent.indexOf('Version')) !== -1) {
      version = agent.substring(offsetVersion + 8);
    }
  } else if ((offsetName = agent.lastIndexOf(' ') + 1) < (offsetVersion = agent.lastIndexOf('/'))) {
    // For other browsers 'name/version' is at the end of userAgent
    browserName = agent.substring(offsetName, offsetVersion);
    version = agent.substring(offsetVersion + 1);
    if (browserName.toLowerCase() === browserName.toUpperCase()) {
      browserName = navigator.appName;
    }
  } // Trim the version string at semicolon/space if present.
  if ((ix = version.indexOf(';')) !== -1) {
    version = version.substring(0, ix);
  }
  if ((ix = version.indexOf(' ')) !== -1) {
    version = version.substring(0, ix);
  }
  return { 'browserName': browserName,
    'browserVersion': version,
    'platform': navigator.platform };
};

var report = new Report();

},{}],14:[function(require,module,exports){
/*
 *  Copyright (c) 2014 The WebRTC project authors. All Rights Reserved.
 *
 *  Use of this source code is governed by a BSD-style license
 *  that can be found in the LICENSE file in the root of the source
 *  tree.
 */
'use strict';

/* This is an implementation of the algorithm for calculating the Structural
 * SIMilarity (SSIM) index between two images. Please refer to the article [1],
 * the website [2] and/or the Wikipedia article [3]. This code takes the value
 * of the constants C1 and C2 from the Matlab implementation in [4].
 *
 * [1] Z. Wang, A. C. Bovik, H. R. Sheikh, and E. P. Simoncelli, "Image quality
 * assessment: From error measurement to structural similarity",
 * IEEE Transactions on Image Processing, vol. 13, no. 1, Jan. 2004.
 * [2] http://www.cns.nyu.edu/~lcv/ssim/
 * [3] http://en.wikipedia.org/wiki/Structural_similarity
 * [4] http://www.cns.nyu.edu/~lcv/ssim/ssim_index.m
 */

var _typeof = typeof Symbol === "function" && typeof Symbol.iterator === "symbol" ? function (obj) { return typeof obj; } : function (obj) { return obj && typeof Symbol === "function" && obj.constructor === Symbol && obj !== Symbol.prototype ? "symbol" : typeof obj; };

function Ssim() {}

Ssim.prototype = {
  // Implementation of Eq.2, a simple average of a vector and Eq.4., except the
  // square root. The latter is actually an unbiased estimate of the variance,
  // not the exact variance.
  statistics: function statistics(a) {
    var accu = 0;
    var i;
    for (i = 0; i < a.length; ++i) {
      accu += a[i];
    }
    var meanA = accu / (a.length - 1);
    var diff = 0;
    for (i = 1; i < a.length; ++i) {
      diff = a[i - 1] - meanA;
      accu += a[i] + diff * diff;
    }
    return { mean: meanA, variance: accu / a.length };
  },

  // Implementation of Eq.11., cov(Y, Z) = E((Y - uY), (Z - uZ)).
  covariance: function covariance(a, b, meanA, meanB) {
    var accu = 0;
    for (var i = 0; i < a.length; i += 1) {
      accu += (a[i] - meanA) * (b[i] - meanB);
    }
    return accu / a.length;
  },

  calculate: function calculate(x, y) {
    if (x.length !== y.length) {
      return 0;
    }

    // Values of the constants come from the Matlab code referred before.
    var K1 = 0.01;
    var K2 = 0.03;
    var L = 255;
    var C1 = K1 * L * (K1 * L);
    var C2 = K2 * L * (K2 * L);
    var C3 = C2 / 2;

    var statsX = this.statistics(x);
    var muX = statsX.mean;
    var sigmaX2 = statsX.variance;
    var sigmaX = Math.sqrt(sigmaX2);
    var statsY = this.statistics(y);
    var muY = statsY.mean;
    var sigmaY2 = statsY.variance;
    var sigmaY = Math.sqrt(sigmaY2);
    var sigmaXy = this.covariance(x, y, muX, muY);

    // Implementation of Eq.6.
    var luminance = (2 * muX * muY + C1) / (muX * muX + muY * muY + C1);
    // Implementation of Eq.10.
    var structure = (sigmaXy + C3) / (sigmaX * sigmaY + C3);
    // Implementation of Eq.9.
    var contrast = (2 * sigmaX * sigmaY + C2) / (sigmaX2 + sigmaY2 + C2);

    // Implementation of Eq.12.
    return luminance * contrast * structure;
  }
};

if ((typeof exports === 'undefined' ? 'undefined' : _typeof(exports)) === 'object') {
  module.exports = Ssim;
}

},{}],15:[function(require,module,exports){
/*
 *  Copyright (c) 2014 The WebRTC project authors. All Rights Reserved.
 *
 *  Use of this source code is governed by a BSD-style license
 *  that can be found in the LICENSE file in the root of the source
 *  tree.
 */
'use strict';

function StatisticsAggregate(rampUpThreshold) {
  this.startTime_ = 0;
  this.sum_ = 0;
  this.count_ = 0;
  this.max_ = 0;
  this.rampUpThreshold_ = rampUpThreshold;
  this.rampUpTime_ = Infinity;
}

StatisticsAggregate.prototype = {
  add: function add(time, datapoint) {
    if (this.startTime_ === 0) {
      this.startTime_ = time;
    }
    this.sum_ += datapoint;
    this.max_ = Math.max(this.max_, datapoint);
    if (this.rampUpTime_ === Infinity && datapoint > this.rampUpThreshold_) {
      this.rampUpTime_ = time;
    }
    this.count_++;
  },

  getAverage: function getAverage() {
    if (this.count_ === 0) {
      return 0;
    }
    return Math.round(this.sum_ / this.count_);
  },

  getMax: function getMax() {
    return this.max_;
  },

  getRampUpTime: function getRampUpTime() {
    return Math.round(this.rampUpTime_ - this.startTime_);
  }
};

},{}],16:[function(require,module,exports){
/*
 *  Copyright (c) 2014 The WebRTC project authors. All Rights Reserved.
 *
 *  Use of this source code is governed by a BSD-style license
 *  that can be found in the LICENSE file in the root of the source
 *  tree.
 */
'use strict';
/* exported arrayAverage, arrayMax, arrayMin, enumerateStats */

// array<function> returns the average (down to nearest int), max and min of
// an int array.

function arrayAverage(array) {
  var cnt = array.length;
  var tot = 0;
  for (var i = 0; i < cnt; i++) {
    tot += array[i];
  }
  return Math.floor(tot / cnt);
}

function arrayMax(array) {
  if (array.length === 0) {
    return NaN;
  }
  return Math.max.apply(Math, array);
}

function arrayMin(array) {
  if (array.length === 0) {
    return NaN;
  }
  return Math.min.apply(Math, array);
}

// Enumerates the new standard compliant stats using local and remote track ids.
function enumerateStats(stats, localTrackIds, remoteTrackIds) {
  // Create an object structure with all the needed stats and types that we care
  // about. This allows to map the getStats stats to other stats names.
  var statsObject = {
    audio: {
      local: {
        audioLevel: 0.0,
        bytesSent: 0,
        clockRate: 0,
        codecId: '',
        mimeType: '',
        packetsSent: 0,
        payloadType: 0,
        timestamp: 0.0,
        trackId: '',
        transportId: ''
      },
      remote: {
        audioLevel: 0.0,
        bytesReceived: 0,
        clockRate: 0,
        codecId: '',
        fractionLost: 0,
        jitter: 0,
        mimeType: '',
        packetsLost: -1,
        packetsReceived: 0,
        payloadType: 0,
        timestamp: 0.0,
        trackId: '',
        transportId: ''
      }
    },
    video: {
      local: {
        bytesSent: 0,
        clockRate: 0,
        codecId: '',
        firCount: 0,
        framesEncoded: 0,
        frameHeight: 0,
        framesSent: -1,
        frameWidth: 0,
        nackCount: 0,
        packetsSent: -1,
        payloadType: 0,
        pliCount: 0,
        qpSum: 0,
        timestamp: 0.0,
        trackId: '',
        transportId: ''
      },
      remote: {
        bytesReceived: -1,
        clockRate: 0,
        codecId: '',
        firCount: -1,
        fractionLost: 0,
        frameHeight: 0,
        framesDecoded: 0,
        framesDropped: 0,
        framesReceived: 0,
        frameWidth: 0,
        nackCount: -1,
        packetsLost: -1,
        packetsReceived: 0,
        payloadType: 0,
        pliCount: -1,
        qpSum: 0,
        timestamp: 0.0,
        trackId: '',
        transportId: ''
      }
    },
    connection: {
      availableOutgoingBitrate: 0,
      bytesReceived: 0,
      bytesSent: 0,
      consentRequestsSent: 0,
      currentRoundTripTime: 0.0,
      localCandidateId: '',
      localCandidateType: '',
      localIp: '',
      localPort: 0,
      localPriority: 0,
      localProtocol: '',
      remoteCandidateId: '',
      remoteCandidateType: '',
      remoteIp: '',
      remotePort: 0,
      remotePriority: 0,
      remoteProtocol: '',
      requestsReceived: 0,
      requestsSent: 0,
      responsesReceived: 0,
      responsesSent: 0,
      timestamp: 0.0,
      totalRoundTripTime: 0.0
    }
  };

  // Need to find the codec, local and remote ID's first.
  if (stats) {
    stats.forEach(function (report, stat) {
      switch (report.type) {
        case 'outbound-rtp':
          if (report.hasOwnProperty('trackId')) {
            if (report.trackId.indexOf(localTrackIds.audio) !== 1 & localTrackIds.audio !== '') {
              statsObject.audio.local.bytesSent = report.bytesSent;
              statsObject.audio.local.codecId = report.codecId;
              statsObject.audio.local.packetsSent = report.packetsSent;
              statsObject.audio.local.timestamp = report.timestamp;
              statsObject.audio.local.trackId = report.trackId;
              statsObject.audio.local.transportId = report.transportId;
            } else if (report.trackId.indexOf(localTrackIds.video) !== 1 & localTrackIds.video !== '') {
              statsObject.video.local.bytesSent = report.bytesSent;
              statsObject.video.local.codecId = report.codecId;
              statsObject.video.local.firCount = report.firCount;
              statsObject.video.local.framesEncoded = report.framesEncoded;
              statsObject.video.local.framesSent = report.framesSent;
              statsObject.video.local.packetsSent = report.packetsSent;
              statsObject.video.local.pliCount = report.pliCount;
              statsObject.video.local.qpSum = report.qpSum;
              statsObject.video.local.timestamp = report.timestamp;
              statsObject.video.local.trackId = report.trackId;
              statsObject.video.local.transportId = report.transportId;
            }
          }
          break;
        case 'inbound-rtp':
          if (report.hasOwnProperty('trackId')) {
            if (report.trackId.indexOf(remoteTrackIds.audio) !== 1 & remoteTrackIds.audio !== '') {
              statsObject.audio.remote.bytesReceived = report.bytesReceived;
              statsObject.audio.remote.codecId = report.codecId;
              statsObject.audio.remote.fractionLost = report.fractionLost;
              statsObject.audio.remote.jitter = report.jitter;
              statsObject.audio.remote.packetsLost = report.packetsLost;
              statsObject.audio.remote.packetsReceived = report.packetsReceived;
              statsObject.audio.remote.timestamp = report.timestamp;
              statsObject.audio.remote.trackId = report.trackId;
              statsObject.audio.remote.transportId = report.transportId;
            }
            if (report.trackId.indexOf(remoteTrackIds.video) !== 1 & remoteTrackIds.video !== '') {
              statsObject.video.remote.bytesReceived = report.bytesReceived;
              statsObject.video.remote.codecId = report.codecId;
              statsObject.video.remote.firCount = report.firCount;
              statsObject.video.remote.fractionLost = report.fractionLost;
              statsObject.video.remote.nackCount = report.nackCount;
              statsObject.video.remote.packetsLost = report.packetsLost;
              statsObject.video.remote.packetsReceived = report.packetsReceived;
              statsObject.video.remote.pliCount = report.pliCount;
              statsObject.video.remote.qpSum = report.qpSum;
              statsObject.video.remote.timestamp = report.timestamp;
              statsObject.video.remote.trackId = report.trackId;
              statsObject.video.remote.transportId = report.transportId;
            }
          }
          break;
        case 'candidate-pair':
          if (report.hasOwnProperty('availableOutgoingBitrate')) {
            statsObject.connection.availableOutgoingBitrate = report.availableOutgoingBitrate;
            statsObject.connection.bytesReceived = report.bytesReceived;
            statsObject.connection.bytesSent = report.bytesSent;
            statsObject.connection.consentRequestsSent = report.consentRequestsSent;
            statsObject.connection.currentRoundTripTime = report.currentRoundTripTime;
            statsObject.connection.localCandidateId = report.localCandidateId;
            statsObject.connection.remoteCandidateId = report.remoteCandidateId;
            statsObject.connection.requestsReceived = report.requestsReceived;
            statsObject.connection.requestsSent = report.requestsSent;
            statsObject.connection.responsesReceived = report.responsesReceived;
            statsObject.connection.responsesSent = report.responsesSent;
            statsObject.connection.timestamp = report.timestamp;
            statsObject.connection.totalRoundTripTime = report.totalRoundTripTime;
          }
          break;
        default:
          return;
      }
    }.bind());

    // Using the codec, local and remote candidate ID's to find the rest of the
    // relevant stats.
    stats.forEach(function (report) {
      switch (report.type) {
        case 'track':
          if (report.hasOwnProperty('trackIdentifier')) {
            if (report.trackIdentifier.indexOf(localTrackIds.video) !== 1 & localTrackIds.video !== '') {
              statsObject.video.local.frameHeight = report.frameHeight;
              statsObject.video.local.framesSent = report.framesSent;
              statsObject.video.local.frameWidth = report.frameWidth;
            }
            if (report.trackIdentifier.indexOf(remoteTrackIds.video) !== 1 & remoteTrackIds.video !== '') {
              statsObject.video.remote.frameHeight = report.frameHeight;
              statsObject.video.remote.framesDecoded = report.framesDecoded;
              statsObject.video.remote.framesDropped = report.framesDropped;
              statsObject.video.remote.framesReceived = report.framesReceived;
              statsObject.video.remote.frameWidth = report.frameWidth;
            }
            if (report.trackIdentifier.indexOf(localTrackIds.audio) !== 1 & localTrackIds.audio !== '') {
              statsObject.audio.local.audioLevel = report.audioLevel;
            }
            if (report.trackIdentifier.indexOf(remoteTrackIds.audio) !== 1 & remoteTrackIds.audio !== '') {
              statsObject.audio.remote.audioLevel = report.audioLevel;
            }
          }
          break;
        case 'codec':
          if (report.hasOwnProperty('id')) {
            if (report.id.indexOf(statsObject.audio.local.codecId) !== 1 & localTrackIds.audio !== '') {
              statsObject.audio.local.clockRate = report.clockRate;
              statsObject.audio.local.mimeType = report.mimeType;
              statsObject.audio.local.payloadType = report.payloadType;
            }
            if (report.id.indexOf(statsObject.audio.remote.codecId) !== 1 & remoteTrackIds.audio !== '') {
              statsObject.audio.remote.clockRate = report.clockRate;
              statsObject.audio.remote.mimeType = report.mimeType;
              statsObject.audio.remote.payloadType = report.payloadType;
            }
            if (report.id.indexOf(statsObject.video.local.codecId) !== 1 & localTrackIds.video !== '') {
              statsObject.video.local.clockRate = report.clockRate;
              statsObject.video.local.mimeType = report.mimeType;
              statsObject.video.local.payloadType = report.payloadType;
            }
            if (report.id.indexOf(statsObject.video.remote.codecId) !== 1 & remoteTrackIds.video !== '') {
              statsObject.video.remote.clockRate = report.clockRate;
              statsObject.video.remote.mimeType = report.mimeType;
              statsObject.video.remote.payloadType = report.payloadType;
            }
          }
          break;
        case 'local-candidate':
          if (report.hasOwnProperty('id')) {
            if (report.id.indexOf(statsObject.connection.localCandidateId) !== -1) {
              statsObject.connection.localIp = report.ip;
              statsObject.connection.localPort = report.port;
              statsObject.connection.localPriority = report.priority;
              statsObject.connection.localProtocol = report.protocol;
              statsObject.connection.localType = report.candidateType;
            }
          }
          break;
        case 'remote-candidate':
          if (report.hasOwnProperty('id')) {
            if (report.id.indexOf(statsObject.connection.remoteCandidateId) !== -1) {
              statsObject.connection.remoteIp = report.ip;
              statsObject.connection.remotePort = report.port;
              statsObject.connection.remotePriority = report.priority;
              statsObject.connection.remoteProtocol = report.protocol;
              statsObject.connection.remoteType = report.candidateType;
            }
          }
          break;
        default:
          return;
      }
    }.bind());
  }
  return statsObject;
}

},{}],17:[function(require,module,exports){
/*
 *  Copyright (c) 2017 The WebRTC project authors. All Rights Reserved.
 *
 *  Use of this source code is governed by a BSD-style license
 *  that can be found in the LICENSE file in the root of the source
 *  tree.
 */
'use strict';

var _typeof = typeof Symbol === "function" && typeof Symbol.iterator === "symbol" ? function (obj) { return typeof obj; } : function (obj) { return obj && typeof Symbol === "function" && obj.constructor === Symbol && obj !== Symbol.prototype ? "symbol" : typeof obj; };

function VideoFrameChecker(videoElement) {
  this.frameStats = {
    numFrozenFrames: 0,
    numBlackFrames: 0,
    numFrames: 0
  };

  this.running_ = true;

  this.nonBlackPixelLumaThreshold = 20;
  this.previousFrame_ = [];
  this.identicalFrameSsimThreshold = 0.985;
  this.frameComparator = new Ssim();

  this.canvas_ = document.createElement('canvas');
  this.videoElement_ = videoElement;
  this.listener_ = this.checkVideoFrame_.bind(this);
  this.videoElement_.addEventListener('play', this.listener_, false);
}

VideoFrameChecker.prototype = {
  stop: function stop() {
    this.videoElement_.removeEventListener('play', this.listener_);
    this.running_ = false;
  },

  getCurrentImageData_: function getCurrentImageData_() {
    this.canvas_.width = this.videoElement_.width;
    this.canvas_.height = this.videoElement_.height;

    var context = this.canvas_.getContext('2d');
    context.drawImage(this.videoElement_, 0, 0, this.canvas_.width, this.canvas_.height);
    return context.getImageData(0, 0, this.canvas_.width, this.canvas_.height);
  },

  checkVideoFrame_: function checkVideoFrame_() {
    if (!this.running_) {
      return;
    }
    if (this.videoElement_.ended) {
      return;
    }

    var imageData = this.getCurrentImageData_();

    if (this.isBlackFrame_(imageData.data, imageData.data.length)) {
      this.frameStats.numBlackFrames++;
    }

    if (this.frameComparator.calculate(this.previousFrame_, imageData.data) > this.identicalFrameSsimThreshold) {
      this.frameStats.numFrozenFrames++;
    }
    this.previousFrame_ = imageData.data;

    this.frameStats.numFrames++;
    setTimeout(this.checkVideoFrame_.bind(this), 20);
  },

  isBlackFrame_: function isBlackFrame_(data, length) {
    // TODO: Use a statistical, histogram-based detection.
    var thresh = this.nonBlackPixelLumaThreshold;
    var accuLuma = 0;
    for (var i = 4; i < length; i += 4) {
      // Use Luma as in Rec. 709: Y′709 = 0.21R + 0.72G + 0.07B;
      accuLuma += 0.21 * data[i] + 0.72 * data[i + 1] + 0.07 * data[i + 2];
      // Early termination if the average Luma so far is bright enough.
      if (accuLuma > thresh * i / 4) {
        return false;
      }
    }
    return true;
  }
};

if ((typeof exports === 'undefined' ? 'undefined' : _typeof(exports)) === 'object') {
  module.exports = VideoFrameChecker;
}

},{}]},{},[1,2,3,4,6,7,8,9,10,11,12,13,14,15,16,17])
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIm5vZGVfbW9kdWxlcy9icm93c2VyLXBhY2svX3ByZWx1ZGUuanMiLCJzcmMvY29uZmlnL3Rlc3ROYW1lcy5qcyIsInNyYy9pbmRleC5qcyIsInNyYy9tYWluLmpzIiwic3JjL3VuaXQvY2FtUmVzb2x1dGlvbnMuanMiLCJzcmMvdW5pdC9jYW1yZXNvbHV0aW9ucy5qcyIsInNyYy91bml0L2Nvbm4uanMiLCJzcmMvdW5pdC9kYXRhQmFuZHdpZHRoLmpzIiwic3JjL3VuaXQvbWljLmpzIiwic3JjL3VuaXQvbmV0LmpzIiwic3JjL3VuaXQvdmlkZW9CYW5kd2lkdGguanMiLCJzcmMvdW5pdC93aWZpUGVyaW9kaWNTY2FuLmpzIiwic3JjL3V0aWwvY2FsbC5qcyIsInNyYy91dGlsL3JlcG9ydC5qcyIsInNyYy91dGlsL3NzaW0uanMiLCJzcmMvdXRpbC9zdGF0cy5qcyIsInNyYy91dGlsL3V0aWwuanMiLCJzcmMvdXRpbC92aWRlb2ZyYW1lY2hlY2tlci5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQTtBQ0FBOzs7OztBQUVPLElBQU0sd0JBQVE7QUFDbkIsZ0JBQWMsZUFESztBQUVuQixzQkFBb0IsMEJBRkQ7QUFHbkIsc0JBQW9CLDBCQUhEO0FBSW5CLHNCQUFvQiwyQkFKRDtBQUtuQiw2QkFBMkIsNkJBTFI7QUFNbkIsa0JBQWdCLGlCQU5HO0FBT25CLGVBQWEsY0FQTTtBQVFuQixrQkFBZ0IsaUJBUkc7QUFTbkIsdUJBQXFCLHlCQVRGO0FBVW5CLGNBQVksYUFWTztBQVduQixjQUFZLGFBWE87QUFZbkIsa0JBQWdCLGlCQVpHO0FBYW5CLHFCQUFtQixvQkFiQTtBQWNuQix5QkFBdUIsd0JBZEo7QUFlbkIsb0JBQWtCO0FBZkMsQ0FBZDs7QUFrQkEsSUFBTSwwQkFBUztBQUNsQixVQUFRLFFBRFU7QUFFbEIsY0FBWSxZQUZNO0FBR2xCLFdBQVMsU0FIUztBQUlsQixnQkFBYyxjQUpJO0FBS2xCLGNBQVk7QUFMTSxDQUFmOzs7Ozs7Ozs7OztBQ3BC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Q3BDO0FBQ0EsUUFBSSxTQUFTLEtBQUssMEJBQWxCO0FBQ0EsUUFBSSxXQUFXLENBQWY7QUFDQSxTQUFLLElBQUksSUFBSSxDQUFiLEVBQWdCLElBQUksTUFBcEIsRUFBNEIsS0FBSyxDQUFqQyxFQUFvQztBQUNsQztBQUNBLGtCQUFZLE9BQU8sS0FBSyxDQUFMLENBQVAsR0FBaUIsT0FBTyxLQUFLLElBQUksQ0FBVCxDQUF4QixHQUFzQyxPQUFPLEtBQUssSUFBSSxDQUFULENBQXpEO0FBQ0E7QUFDQSxVQUFJLFdBQVksU0FBUyxDQUFULEdBQWEsQ0FBN0IsRUFBaUM7QUFDL0IsZUFBTyxLQUFQO0FBQ0Q7QUFDRjtBQUNELFdBQU8sSUFBUDtBQUNEO0FBckQyQixDQUE5Qjs7QUF3REEsSUFBSSxRQUFPLE9BQVAseUNBQU8sT0FBUCxPQUFtQixRQUF2QixFQUFpQztBQUMvQixTQUFPLE9BQVAsR0FBaUIsaUJBQWpCO0FBQ0QiLCJmaWxlIjoiZ2VuZXJhdGVkLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXNDb250ZW50IjpbIihmdW5jdGlvbigpe2Z1bmN0aW9uIHIoZSxuLHQpe2Z1bmN0aW9uIG8oaSxmKXtpZighbltpXSl7aWYoIWVbaV0pe3ZhciBjPVwiZnVuY3Rpb25cIj09dHlwZW9mIHJlcXVpcmUmJnJlcXVpcmU7aWYoIWYmJmMpcmV0dXJuIGMoaSwhMCk7aWYodSlyZXR1cm4gdShpLCEwKTt2YXIgYT1uZXcgRXJyb3IoXCJDYW5ub3QgZmluZCBtb2R1bGUgJ1wiK2krXCInXCIpO3Rocm93IGEuY29kZT1cIk1PRFVMRV9OT1RfRk9VTkRcIixhfXZhciBwPW5baV09e2V4cG9ydHM6e319O2VbaV1bMF0uY2FsbChwLmV4cG9ydHMsZnVuY3Rpb24ocil7dmFyIG49ZVtpXVsxXVtyXTtyZXR1cm4gbyhufHxyKX0scCxwLmV4cG9ydHMscixlLG4sdCl9cmV0dXJuIG5baV0uZXhwb3J0c31mb3IodmFyIHU9XCJmdW5jdGlvblwiPT10eXBlb2YgcmVxdWlyZSYmcmVxdWlyZSxpPTA7aTx0Lmxlbmd0aDtpKyspbyh0W2ldKTtyZXR1cm4gb31yZXR1cm4gcn0pKCkiLCIndXNlIHN0cmljdCc7XG5cbmV4cG9ydCBjb25zdCBjYXNlcyA9IHtcbiAgQVVESU9DQVBUVVJFOiAnQXVkaW8gY2FwdHVyZScsXG4gIENIRUNLUkVTT0xVVElPTjI0MDogJ0NoZWNrIHJlc29sdXRpb24gMzIweDI0MCcsXG4gIENIRUNLUkVTT0xVVElPTjQ4MDogJ0NoZWNrIHJlc29sdXRpb24gNjQweDQ4MCcsXG4gIENIRUNLUkVTT0xVVElPTjcyMDogJ0NoZWNrIHJlc29sdXRpb24gMTI4MHg3MjAnLFxuICBDSEVDS1NVUFBPUlRFRFJFU09MVVRJT05TOiAnQ2hlY2sgc3VwcG9ydGVkIHJlc29sdXRpb25zJyxcbiAgREFUQVRIUk9VR0hQVVQ6ICdEYXRhIHRocm91Z2hwdXQnLFxuICBJUFY2RU5BQkxFRDogJ0lwdjYgZW5hYmxlZCcsXG4gIE5FVFdPUktMQVRFTkNZOiAnTmV0d29yayBsYXRlbmN5JyxcbiAgTkVUV09SS0xBVEVOQ1lSRUxBWTogJ05ldHdvcmsgbGF0ZW5jeSAtIFJlbGF5JyxcbiAgVURQRU5BQkxFRDogJ1VkcCBlbmFibGVkJyxcbiAgVENQRU5BQkxFRDogJ1RjcCBlbmFibGVkJyxcbiAgVklERU9CQU5EV0lEVEg6ICdWaWRlbyBiYW5kd2lkdGgnLFxuICBSRUxBWUNPTk5FQ1RJVklUWTogJ1JlbGF5IGNvbm5lY3Rpdml0eScsXG4gIFJFRkxFWElWRUNPTk5FQ1RJVklUWTogJ1JlZmxleGl2ZSBjb25uZWN0aXZpdHknLFxuICBIT1NUQ09OTkVDVElWSVRZOiAnSG9zdCBjb25uZWN0aXZpdHknXG59O1xuXG5leHBvcnQgY29uc3Qgc3VpdGVzID0ge1xuICAgIENBTUVSQTogJ0NhbWVyYScsXG4gICAgTUlDUk9QSE9ORTogJ01pY3JvcGhvbmUnLFxuICAgIE5FVFdPUks6ICdOZXR3b3JrJyxcbiAgICBDT05ORUNUSVZJVFk6ICdDb25uZWN0aXZpdHknLFxuICAgIFRIUk9VR0hQVVQ6ICdUaHJvdWdocHV0J1xuICB9O1xuIiwiaW1wb3J0IENhbGwgZnJvbSAnLi91dGlsL2NhbGwuanMnO1xuaW1wb3J0ICcuL3V0aWwvc3RhdHMuanMnO1xuaW1wb3J0ICcuL3V0aWwvc3NpbS5qcyc7XG5pbXBvcnQgJy4vdXRpbC92aWRlb2ZyYW1lY2hlY2tlci5qcyc7XG5pbXBvcnQgJy4vdXRpbC91dGlsLmpzJztcbmltcG9ydCB7IGNhc2VzLCBzdWl0ZXMgfSBmcm9tICcuL2NvbmZpZy90ZXN0TmFtZXMuanMnO1xuXG5pbXBvcnQgTWljVGVzdCBmcm9tICcuL3VuaXQvbWljLmpzJztcbmltcG9ydCBSdW5Db25uZWN0aXZpdHlUZXN0IGZyb20gJy4vdW5pdC9jb25uLmpzJztcbmltcG9ydCBDYW1SZXNvbHV0aW9uc1Rlc3QgZnJvbSAnLi91bml0L2NhbXJlc29sdXRpb25zLmpzJztcbmltcG9ydCBOZXR3b3JrVGVzdCBmcm9tICcuL3VuaXQvbmV0LmpzJztcbmltcG9ydCBEYXRhQ2hhbm5lbFRocm91Z2hwdXRUZXN0IGZyb20gJy4vdW5pdC9kYXRhQmFuZHdpZHRoLmpzJztcbmltcG9ydCBWaWRlb0JhbmR3aWR0aFRlc3QgZnJvbSAnLi91bml0L3ZpZGVvQmFuZHdpZHRoLmpzJztcbmltcG9ydCB3aUZpUGVyaW9kaWNTY2FuVGVzdCBmcm9tICcuL3VuaXQvd2lmaVBlcmlvZGljU2Nhbi5qcyc7XG5cbmNsYXNzIFRlc3RSVEMge1xuXG4gIGNvbnN0cnVjdG9yKCkge1xuICAgIHRoaXMuZW51bWVyYXRlZFRlc3RTdWl0ZXMgPSBbXTtcbiAgICB0aGlzLmVudW1lcmF0ZWRUZXN0RmlsdGVycyA9IFtdO1xuXG4gICAgYWRkVGVzdChzdWl0ZXMuTUlDUk9QSE9ORSwgY2FzZXMuQVVESU9DQVBUVVJFLCAodGVzdCkgPT4ge1xuICAgICAgdmFyIG1pY1Rlc3QgPSBuZXcgTWljVGVzdCh0ZXN0KTtcbiAgICAgIG1pY1Rlc3QucnVuKCk7XG4gICAgfSk7XG5cbiAgICAvLyBTZXQgdXAgYSBkYXRhY2hhbm5lbCBiZXR3ZWVuIHR3byBwZWVycyB0aHJvdWdoIGEgcmVsYXlcbiAgICAvLyBhbmQgdmVyaWZ5IGRhdGEgY2FuIGJlIHRyYW5zbWl0dGVkIGFuZCByZWNlaXZlZFxuICAgIC8vIChwYWNrZXRzIHRyYXZlbCB0aHJvdWdoIHRoZSBwdWJsaWMgaW50ZXJuZXQpXG4gICAgYWRkVGVzdChzdWl0ZXMuQ09OTkVDVElWSVRZLCBjYXNlcy5SRUxBWUNPTk5FQ1RJVklUWSwgKHRlc3QpID0+IHtcbiAgICAgIHZhciBydW5Db25uZWN0aXZpdHlUZXN0ID0gbmV3IFJ1bkNvbm5lY3Rpdml0eVRlc3QodGVzdCwgQ2FsbC5pc1JlbGF5KTtcbiAgICAgIHJ1bkNvbm5lY3Rpdml0eVRlc3QucnVuKCk7XG4gICAgfSk7XG5cbiAgICAvLyBTZXQgdXAgYSBkYXRhY2hhbm5lbCBiZXR3ZWVuIHR3byBwZWVycyB0aHJvdWdoIGEgcHVibGljIElQIGFkZHJlc3NcbiAgICAvLyBhbmQgdmVyaWZ5IGRhdGEgY2FuIGJlIHRyYW5zbWl0dGVkIGFuZCByZWNlaXZlZFxuICAgIC8vIChwYWNrZXRzIHNob3VsZCBzdGF5IG9uIHRoZSBsaW5rIGlmIGJlaGluZCBhIHJvdXRlciBkb2luZyBOQVQpXG4gICAgYWRkVGVzdChzdWl0ZXMuQ09OTkVDVElWSVRZLCBjYXNlcy5SRUZMRVhJVkVDT05ORUNUSVZJVFksICh0ZXN0KSA9PiB7XG4gICAgICB2YXIgcnVuQ29ubmVjdGl2aXR5VGVzdCA9IG5ldyBSdW5Db25uZWN0aXZpdHlUZXN0KHRlc3QsIENhbGwuaXNSZWZsZXhpdmUpO1xuICAgICAgcnVuQ29ubmVjdGl2aXR5VGVzdC5ydW4oKTtcbiAgICB9KTtcblxuICAgIC8vIFNldCB1cCBhIGRhdGFjaGFubmVsIGJldHdlZW4gdHdvIHBlZXJzIHRocm91Z2ggYSBsb2NhbCBJUCBhZGRyZXNzXG4gICAgLy8gYW5kIHZlcmlmeSBkYXRhIGNhbiBiZSB0cmFuc21pdHRlZCBhbmQgcmVjZWl2ZWRcbiAgICAvLyAocGFja2V0cyBzaG91bGQgbm90IGxlYXZlIHRoZSBtYWNoaW5lIHJ1bm5pbmcgdGhlIHRlc3QpXG4gICAgYWRkVGVzdChzdWl0ZXMuQ09OTkVDVElWSVRZLCBjYXNlcy5IT1NUQ09OTkVDVElWSVRZLCAodGVzdCkgPT4ge1xuICAgICAgdmFyIHJ1bkNvbm5lY3Rpdml0eVRlc3QgPSBuZXcgUnVuQ29ubmVjdGl2aXR5VGVzdCh0ZXN0LCBDYWxsLmlzSG9zdCk7XG4gICAgICBydW5Db25uZWN0aXZpdHlUZXN0LnN0YXJ0KCk7XG4gICAgfSk7XG5cbiAgICBhZGRUZXN0KHN1aXRlcy5DQU1FUkEsIGNhc2VzLkNIRUNLUkVTT0xVVElPTjI0MCwgKHRlc3QpID0+IHtcbiAgICAgIHZhciBjYW1SZXNvbHV0aW9uc1Rlc3QgPSBuZXcgQ2FtUmVzb2x1dGlvbnNUZXN0KHRlc3QgLCBbWzMyMCwgMjQwXV0pO1xuICAgICAgY2FtUmVzb2x1dGlvbnNUZXN0LnJ1bigpO1xuICAgIH0pO1xuXG4gICAgYWRkVGVzdChzdWl0ZXMuQ0FNRVJBLCBjYXNlcy5DSEVDS1JFU09MVVRJT040ODAsICh0ZXN0KSA9PiB7XG4gICAgICB2YXIgY2FtUmVzb2x1dGlvbnNUZXN0ID0gbmV3IENhbVJlc29sdXRpb25zVGVzdCh0ZXN0LCBbWzY0MCwgNDgwXV0pO1xuICAgICAgY2FtUmVzb2x1dGlvbnNUZXN0LnJ1bigpO1xuICAgIH0pO1xuXG4gICAgYWRkVGVzdChzdWl0ZXMuQ0FNRVJBLCBjYXNlcy5DSEVDS1JFU09MVVRJT043MjAsICh0ZXN0KSA9PiB7XG4gICAgICB2YXIgY2FtUmVzb2x1dGlvbnNUZXN0ID0gbmV3IENhbVJlc29sdXRpb25zVGVzdCh0ZXN0LCBbWzEyODAsIDcyMF1dKTtcbiAgICAgIGNhbVJlc29sdXRpb25zVGVzdC5ydW4oKTtcbiAgICB9KTtcblxuICAgIGFkZFRlc3Qoc3VpdGVzLkNBTUVSQSwgY2FzZXMuQ0hFQ0tTVVBQT1JURURSRVNPTFVUSU9OUywgKHRlc3QpID0+IHtcbiAgICAgIHZhciByZXNvbHV0aW9uQXJyYXkgPSBbXG4gICAgICAgIFsxNjAsIDEyMF0sIFszMjAsIDE4MF0sIFszMjAsIDI0MF0sIFs2NDAsIDM2MF0sIFs2NDAsIDQ4MF0sIFs3NjgsIDU3Nl0sXG4gICAgICAgIFsxMDI0LCA1NzZdLCBbMTI4MCwgNzIwXSwgWzEyODAsIDc2OF0sIFsxMjgwLCA4MDBdLCBbMTkyMCwgMTA4MF0sXG4gICAgICAgIFsxOTIwLCAxMjAwXSwgWzM4NDAsIDIxNjBdLCBbNDA5NiwgMjE2MF1cbiAgICAgIF07XG4gICAgICB2YXIgY2FtUmVzb2x1dGlvbnNUZXN0ID0gbmV3IENhbVJlc29sdXRpb25zVGVzdCh0ZXN0LCByZXNvbHV0aW9uQXJyYXkpO1xuICAgICAgY2FtUmVzb2x1dGlvbnNUZXN0LnJ1bigpO1xuICAgIH0pO1xuXG4gICAgLy8gVGVzdCB3aGV0aGVyIGl0IGNhbiBjb25uZWN0IHZpYSBVRFAgdG8gYSBUVVJOIHNlcnZlclxuICAgIC8vIEdldCBhIFRVUk4gY29uZmlnLCBhbmQgdHJ5IHRvIGdldCBhIHJlbGF5IGNhbmRpZGF0ZSB1c2luZyBVRFAuXG4gICAgYWRkVGVzdChzdWl0ZXMuTkVUV09SSywgY2FzZXMuVURQRU5BQkxFRCwgKHRlc3QpID0+IHtcbiAgICAgIHZhciBuZXR3b3JrVGVzdCA9IG5ldyBOZXR3b3JrVGVzdCh0ZXN0LCAndWRwJywgbnVsbCwgQ2FsbC5pc1JlbGF5KTtcbiAgICAgIG5ldHdvcmtUZXN0LnJ1bigpO1xuICAgIH0pO1xuXG4gICAgLy8gVGVzdCB3aGV0aGVyIGl0IGNhbiBjb25uZWN0IHZpYSBUQ1AgdG8gYSBUVVJOIHNlcnZlclxuICAgIC8vIEdldCBhIFRVUk4gY29uZmlnLCBhbmQgdHJ5IHRvIGdldCBhIHJlbGF5IGNhbmRpZGF0ZSB1c2luZyBUQ1AuXG4gICAgYWRkVGVzdChzdWl0ZXMuTkVUV09SSywgY2FzZXMuVENQRU5BQkxFRCwgKHRlc3QpID0+IHtcbiAgICAgIHZhciBuZXR3b3JrVGVzdCA9IG5ldyBOZXR3b3JrVGVzdCh0ZXN0LCAndGNwJywgbnVsbCwgQ2FsbC5pc1JlbGF5KTtcbiAgICAgIG5ldHdvcmtUZXN0LnJ1bigpO1xuICAgIH0pO1xuXG4gICAgLy8gVGVzdCB3aGV0aGVyIGl0IGlzIElQdjYgZW5hYmxlZCAoVE9ETzogdGVzdCBJUHY2IHRvIGEgZGVzdGluYXRpb24pLlxuICAgIC8vIFR1cm4gb24gSVB2NiwgYW5kIHRyeSB0byBnZXQgYW4gSVB2NiBob3N0IGNhbmRpZGF0ZS5cbiAgICBhZGRUZXN0KHN1aXRlcy5ORVRXT1JLLCBjYXNlcy5JUFY2RU5BQkxFRCwgKHRlc3QpID0+IHtcbiAgICAgIHZhciBwYXJhbXMgPSB7b3B0aW9uYWw6IFt7Z29vZ0lQdjY6IHRydWV9XX07XG4gICAgICB2YXIgbmV0d29ya1Rlc3QgPSBuZXcgTmV0d29ya1Rlc3QodGVzdCwgbnVsbCwgcGFyYW1zLCBDYWxsLmlzSXB2Nik7XG4gICAgICBuZXR3b3JrVGVzdC5ydW4oKTtcbiAgICB9KTtcblxuICAgIC8vIENyZWF0ZXMgYSBsb29wYmFjayB2aWEgcmVsYXkgY2FuZGlkYXRlcyBhbmQgdHJpZXMgdG8gc2VuZCBhcyBtYW55IHBhY2tldHNcbiAgICAvLyB3aXRoIDEwMjQgY2hhcnMgYXMgcG9zc2libGUgd2hpbGUga2VlcGluZyBkYXRhQ2hhbm5lbCBidWZmZXJlZEFtbW91bnQgYWJvdmVcbiAgICAvLyB6ZXJvLlxuICAgIGFkZFRlc3Qoc3VpdGVzLlRIUk9VR0hQVVQsIGNhc2VzLkRBVEFUSFJPVUdIUFVULCAodGVzdCkgPT4ge1xuICAgICAgdmFyIGRhdGFDaGFubmVsVGhyb3VnaHB1dFRlc3QgPSBuZXcgRGF0YUNoYW5uZWxUaHJvdWdocHV0VGVzdCh0ZXN0KTtcbiAgICAgIGRhdGFDaGFubmVsVGhyb3VnaHB1dFRlc3QucnVuKCk7XG4gICAgfSk7XG5cbiAgICAvLyBNZWFzdXJlcyB2aWRlbyBiYW5kd2lkdGggZXN0aW1hdGlvbiBwZXJmb3JtYW5jZSBieSBkb2luZyBhIGxvb3BiYWNrIGNhbGwgdmlhXG4gICAgLy8gcmVsYXkgY2FuZGlkYXRlcyBmb3IgNDAgc2Vjb25kcy4gQ29tcHV0ZXMgcnR0IGFuZCBiYW5kd2lkdGggZXN0aW1hdGlvblxuICAgIC8vIGF2ZXJhZ2UgYW5kIG1heGltdW0gYXMgd2VsbCBhcyB0aW1lIHRvIHJhbXAgdXAgKGRlZmluZWQgYXMgcmVhY2hpbmcgNzUlIG9mXG4gICAgLy8gdGhlIG1heCBiaXRyYXRlLiBJdCByZXBvcnRzIGluZmluaXRlIHRpbWUgdG8gcmFtcCB1cCBpZiBuZXZlciByZWFjaGVzIGl0LlxuICAgIGFkZFRlc3Qoc3VpdGVzLlRIUk9VR0hQVVQsIGNhc2VzLlZJREVPQkFORFdJRFRILCAodGVzdCkgPT4ge1xuICAgICAgdmFyIHZpZGVvQmFuZHdpZHRoVGVzdCA9IG5ldyBWaWRlb0JhbmR3aWR0aFRlc3QodGVzdCk7XG4gICAgICB2aWRlb0JhbmR3aWR0aFRlc3QucnVuKCk7XG4gICAgfSk7XG5cbiAgICBhZGRFeHBsaWNpdFRlc3Qoc3VpdGVzLlRIUk9VR0hQVVQsIGNhc2VzLk5FVFdPUktMQVRFTkNZLCAodGVzdCkgPT4ge1xuICAgICAgdmFyIHdpRmlQZXJpb2RpY1NjYW5UZXN0ID0gbmV3IFdpRmlQZXJpb2RpY1NjYW5UZXN0KHRlc3QsXG4gICAgICAgICAgQ2FsbC5pc05vdEhvc3RDYW5kaWRhdGUpO1xuICAgICAgd2lGaVBlcmlvZGljU2NhblRlc3QucnVuKCk7XG4gICAgfSk7XG5cbiAgICBhZGRFeHBsaWNpdFRlc3Qoc3VpdGVzLlRIUk9VR0hQVVQsIGNhc2VzLk5FVFdPUktMQVRFTkNZUkVMQVksICh0ZXN0KSA9PiB7XG4gICAgICB2YXIgd2lGaVBlcmlvZGljU2NhblRlc3QgPSBuZXcgV2lGaVBlcmlvZGljU2NhblRlc3QodGVzdCwgQ2FsbC5pc1JlbGF5KTtcbiAgICAgIHdpRmlQZXJpb2RpY1NjYW5UZXN0LnJ1bigpO1xuICAgIH0pO1xuICB9XG5cbiAgYWRkVGVzdChzdWl0ZU5hbWUsIHRlc3ROYW1lLCBmdW5jKSB7XG4gICAgaWYgKGlzVGVzdERpc2FibGVkKHRlc3ROYW1lKSkge1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGZvciAodmFyIGkgPSAwOyBpICE9PSBlbnVtZXJhdGVkVGVzdFN1aXRlcy5sZW5ndGg7ICsraSkge1xuICAgICAgaWYgKGVudW1lcmF0ZWRUZXN0U3VpdGVzW2ldLm5hbWUgPT09IHN1aXRlTmFtZSkge1xuICAgICAgICBlbnVtZXJhdGVkVGVzdFN1aXRlc1tpXS5hZGRUZXN0KHRlc3ROYW1lLCBmdW5jKTtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIC8vIEFkZCBhIHRlc3QgdGhhdCBvbmx5IHJ1bnMgaWYgaXQgaXMgZXhwbGljaXRseSBlbmFibGVkIHdpdGhcbiAgLy8gP3Rlc3RfZmlsdGVyPTxURVNUIE5BTUU+XG4gIGFkZEV4cGxpY2l0VGVzdChzdWl0ZU5hbWUsIHRlc3ROYW1lLCBmdW5jKSB7XG4gICAgaWYgKGlzVGVzdEV4cGxpY2l0bHlFbmFibGVkKHRlc3ROYW1lKSkge1xuICAgICAgYWRkVGVzdChzdWl0ZU5hbWUsIHRlc3ROYW1lLCBmdW5jKTtcbiAgICB9XG4gIH1cblxuICBpc1Rlc3REaXNhYmxlZCh0ZXN0TmFtZSkge1xuICAgIGlmIChlbnVtZXJhdGVkVGVzdEZpbHRlcnMubGVuZ3RoID09PSAwKSB7XG4gICAgICByZXR1cm4gZmFsc2U7XG4gICAgfVxuICAgIHJldHVybiAhaXNUZXN0RXhwbGljaXRseUVuYWJsZWQodGVzdE5hbWUpO1xuICB9XG5cbiAgaXNUZXN0RXhwbGljaXRseUVuYWJsZWQodGVzdE5hbWUpIHtcbiAgICBmb3IgKHZhciBpID0gMDsgaSAhPT0gZW51bWVyYXRlZFRlc3RGaWx0ZXJzLmxlbmd0aDsgKytpKSB7XG4gICAgICBpZiAoZW51bWVyYXRlZFRlc3RGaWx0ZXJzW2ldID09PSB0ZXN0TmFtZSkge1xuICAgICAgICByZXR1cm4gdHJ1ZTtcbiAgICAgIH1cbiAgICB9XG4gICAgcmV0dXJuIGZhbHNlO1xuICB9XG59XG5cbmV4cG9ydCBkZWZhdWx0IFRlc3RSVEM7XG4iLCIvKlxuICogIENvcHlyaWdodCAoYykgMjAxNSBUaGUgV2ViUlRDIHByb2plY3QgYXV0aG9ycy4gQWxsIFJpZ2h0cyBSZXNlcnZlZC5cbiAqXG4gKiAgVXNlIG9mIHRoaXMgc291cmNlIGNvZGUgaXMgZ292ZXJuZWQgYnkgYSBCU0Qtc3R5bGUgbGljZW5zZVxuICogIHRoYXQgY2FuIGJlIGZvdW5kIGluIHRoZSBMSUNFTlNFIGZpbGUgaW4gdGhlIHJvb3Qgb2YgdGhlIHNvdXJjZVxuICogIHRyZWUuXG4gKi9cbid1c2Ugc3RyaWN0Jztcbi8qIGV4cG9ydGVkIGFkZEV4cGxpY2l0VGVzdCwgYWRkVGVzdCwgYXVkaW9Db250ZXh0ICovXG5cbi8vIEdsb2JhbCBXZWJBdWRpbyBjb250ZXh0IHRoYXQgY2FuIGJlIHNoYXJlZCBieSBhbGwgdGVzdHMuXG4vLyBUaGVyZSBpcyBhIHZlcnkgZmluaXRlIG51bWJlciBvZiBXZWJBdWRpbyBjb250ZXh0cy5cbnRyeSB7XG4gIHdpbmRvdy5BdWRpb0NvbnRleHQgPSB3aW5kb3cuQXVkaW9Db250ZXh0IHx8IHdpbmRvdy53ZWJraXRBdWRpb0NvbnRleHQ7XG4gIHZhciBhdWRpb0NvbnRleHQgPSBuZXcgQXVkaW9Db250ZXh0KCk7XG59IGNhdGNoIChlKSB7XG4gIGNvbnNvbGUubG9nKCdGYWlsZWQgdG8gaW5zdGFudGlhdGUgYW4gYXVkaW8gY29udGV4dCwgZXJyb3I6ICcgKyBlKTtcbn1cblxudmFyIGVudW1lcmF0ZWRUZXN0U3VpdGVzID0gW107XG52YXIgZW51bWVyYXRlZFRlc3RGaWx0ZXJzID0gW107XG5cbmZ1bmN0aW9uIGFkZFRlc3Qoc3VpdGVOYW1lLCB0ZXN0TmFtZSwgZnVuYykge1xuICBpZiAoaXNUZXN0RGlzYWJsZWQodGVzdE5hbWUpKSB7XG4gICAgcmV0dXJuO1xuICB9XG5cbiAgZm9yICh2YXIgaSA9IDA7IGkgIT09IGVudW1lcmF0ZWRUZXN0U3VpdGVzLmxlbmd0aDsgKytpKSB7XG4gICAgaWYgKGVudW1lcmF0ZWRUZXN0U3VpdGVzW2ldLm5hbWUgPT09IHN1aXRlTmFtZSkge1xuICAgICAgZW51bWVyYXRlZFRlc3RTdWl0ZXNbaV0uYWRkVGVzdCh0ZXN0TmFtZSwgZnVuYyk7XG4gICAgICByZXR1cm47XG4gICAgfVxuICB9XG4gIC8vIE5vbi1leGlzdGVudCBzdWl0ZSBjcmVhdGUgYW5kIGF0dGFjaCB0byAjY29udGVudC5cbiAgdmFyIHN1aXRlID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgndGVzdHJ0Yy1zdWl0ZScpO1xuICBzdWl0ZS5uYW1lID0gc3VpdGVOYW1lO1xuICBzdWl0ZS5hZGRUZXN0KHRlc3ROYW1lLCBmdW5jKTtcbiAgZW51bWVyYXRlZFRlc3RTdWl0ZXMucHVzaChzdWl0ZSk7XG4gIGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdjb250ZW50JykuYXBwZW5kQ2hpbGQoc3VpdGUpO1xufVxuXG4vLyBBZGQgYSB0ZXN0IHRoYXQgb25seSBydW5zIGlmIGl0IGlzIGV4cGxpY2l0bHkgZW5hYmxlZCB3aXRoXG4vLyA/dGVzdF9maWx0ZXI9PFRFU1QgTkFNRT5cbmZ1bmN0aW9uIGFkZEV4cGxpY2l0VGVzdChzdWl0ZU5hbWUsIHRlc3ROYW1lLCBmdW5jKSB7XG4gIGlmIChpc1Rlc3RFeHBsaWNpdGx5RW5hYmxlZCh0ZXN0TmFtZSkpIHtcbiAgICBhZGRUZXN0KHN1aXRlTmFtZSwgdGVzdE5hbWUsIGZ1bmMpO1xuICB9XG59XG5cbmZ1bmN0aW9uIGlzVGVzdERpc2FibGVkKHRlc3ROYW1lKSB7XG4gIGlmIChlbnVtZXJhdGVkVGVzdEZpbHRlcnMubGVuZ3RoID09PSAwKSB7XG4gICAgcmV0dXJuIGZhbHNlO1xuICB9XG4gIHJldHVybiAhaXNUZXN0RXhwbGljaXRseUVuYWJsZWQodGVzdE5hbWUpO1xufVxuXG5mdW5jdGlvbiBpc1Rlc3RFeHBsaWNpdGx5RW5hYmxlZCh0ZXN0TmFtZSkge1xuICBmb3IgKHZhciBpID0gMDsgaSAhPT0gZW51bWVyYXRlZFRlc3RGaWx0ZXJzLmxlbmd0aDsgKytpKSB7XG4gICAgaWYgKGVudW1lcmF0ZWRUZXN0RmlsdGVyc1tpXSA9PT0gdGVzdE5hbWUpIHtcbiAgICAgIHJldHVybiB0cnVlO1xuICAgIH1cbiAgfVxuICByZXR1cm4gZmFsc2U7XG59XG5cbnZhciBwYXJhbWV0ZXJzID0gcGFyc2VVcmxQYXJhbWV0ZXJzKCk7XG52YXIgZmlsdGVyUGFyYW1ldGVyTmFtZSA9ICd0ZXN0X2ZpbHRlcic7XG5pZiAoZmlsdGVyUGFyYW1ldGVyTmFtZSBpbiBwYXJhbWV0ZXJzKSB7XG4gIGVudW1lcmF0ZWRUZXN0RmlsdGVycyA9IHBhcmFtZXRlcnNbZmlsdGVyUGFyYW1ldGVyTmFtZV0uc3BsaXQoJywnKTtcbn1cbiIsIid1c2Ugc3RyaWN0JztcblxuLypcbiAqIEluIGdlbmVyaWMgY2FtZXJhcyB1c2luZyBDaHJvbWUgcmVzY2FsZXIsIGFsbCByZXNvbHV0aW9ucyBzaG91bGQgYmUgc3VwcG9ydGVkXG4gKiB1cCB0byBhIGdpdmVuIG9uZSBhbmQgbm9uZSBiZXlvbmQgdGhlcmUuIFNwZWNpYWwgY2FtZXJhcywgc3VjaCBhcyBkaWdpdGl6ZXJzLFxuICogbWlnaHQgc3VwcG9ydCBvbmx5IG9uZSByZXNvbHV0aW9uLlxuICovXG5cbi8qXG4gKiBcIkFuYWx5emUgcGVyZm9ybWFuY2UgZm9yIFwicmVzb2x1dGlvblwiXCIgdGVzdCB1c2VzIGdldFN0YXRzLCBjYW52YXMgYW5kIHRoZVxuICogdmlkZW8gZWxlbWVudCB0byBhbmFseXplIHRoZSB2aWRlbyBmcmFtZXMgZnJvbSBhIGNhcHR1cmUgZGV2aWNlLiBJdCB3aWxsXG4gKiByZXBvcnQgbnVtYmVyIG9mIGJsYWNrIGZyYW1lcywgZnJvemVuIGZyYW1lcywgdGVzdGVkIGZyYW1lcyBhbmQgdmFyaW91cyBzdGF0c1xuICogbGlrZSBhdmVyYWdlIGVuY29kZSB0aW1lIGFuZCBGUFMuIEEgdGVzdCBjYXNlIHdpbGwgYmUgY3JlYXRlZCBwZXIgbWFuZGF0b3J5XG4gKiByZXNvbHV0aW9uIGZvdW5kIGluIHRoZSBcInJlc29sdXRpb25zXCIgYXJyYXkuXG4gKi9cblxuZnVuY3Rpb24gQ2FtUmVzb2x1dGlvbnNUZXN0KHRlc3QsIHJlc29sdXRpb25zKSB7XG4gIHRoaXMudGVzdCA9IHRlc3Q7XG4gIHRoaXMucmVzb2x1dGlvbnMgPSByZXNvbHV0aW9ucztcbiAgdGhpcy5jdXJyZW50UmVzb2x1dGlvbiA9IDA7XG4gIHRoaXMuaXNNdXRlZCA9IGZhbHNlO1xuICB0aGlzLmlzU2h1dHRpbmdEb3duID0gZmFsc2U7XG59XG5cbkNhbVJlc29sdXRpb25zVGVzdC5wcm90b3R5cGUgPSB7XG4gIHJ1bjogZnVuY3Rpb24oKSB7XG4gICAgdGhpcy5zdGFydEdldFVzZXJNZWRpYSh0aGlzLnJlc29sdXRpb25zW3RoaXMuY3VycmVudFJlc29sdXRpb25dKTtcbiAgfSxcblxuICBzdGFydEdldFVzZXJNZWRpYTogZnVuY3Rpb24ocmVzb2x1dGlvbikge1xuICAgIHZhciBjb25zdHJhaW50cyA9IHtcbiAgICAgIGF1ZGlvOiBmYWxzZSxcbiAgICAgIHZpZGVvOiB7XG4gICAgICAgIHdpZHRoOiB7ZXhhY3Q6IHJlc29sdXRpb25bMF19LFxuICAgICAgICBoZWlnaHQ6IHtleGFjdDogcmVzb2x1dGlvblsxXX1cbiAgICAgIH1cbiAgICB9O1xuICAgIG5hdmlnYXRvci5tZWRpYURldmljZXMuZ2V0VXNlck1lZGlhKGNvbnN0cmFpbnRzKVxuICAgICAgICAudGhlbihmdW5jdGlvbihzdHJlYW0pIHtcbiAgICAgICAgICAvLyBEbyBub3QgY2hlY2sgYWN0dWFsIHZpZGVvIGZyYW1lcyB3aGVuIG1vcmUgdGhhbiBvbmUgcmVzb2x1dGlvbiBpc1xuICAgICAgICAgIC8vIHByb3ZpZGVkLlxuICAgICAgICAgIGlmICh0aGlzLnJlc29sdXRpb25zLmxlbmd0aCA+IDEpIHtcbiAgICAgICAgICAgIHRoaXMudGVzdC5yZXBvcnRTdWNjZXNzKCdTdXBwb3J0ZWQ6ICcgKyByZXNvbHV0aW9uWzBdICsgJ3gnICtcbiAgICAgICAgICAgIHJlc29sdXRpb25bMV0pO1xuICAgICAgICAgICAgc3RyZWFtLmdldFRyYWNrcygpLmZvckVhY2goZnVuY3Rpb24odHJhY2spIHtcbiAgICAgICAgICAgICAgdHJhY2suc3RvcCgpO1xuICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICB0aGlzLm1heWJlQ29udGludWVHZXRVc2VyTWVkaWEoKTtcbiAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgdGhpcy5jb2xsZWN0QW5kQW5hbHl6ZVN0YXRzXyhzdHJlYW0sIHJlc29sdXRpb24pO1xuICAgICAgICAgIH1cbiAgICAgICAgfS5iaW5kKHRoaXMpKVxuICAgICAgICAuY2F0Y2goZnVuY3Rpb24oZXJyb3IpIHtcbiAgICAgICAgICBpZiAodGhpcy5yZXNvbHV0aW9ucy5sZW5ndGggPiAxKSB7XG4gICAgICAgICAgICB0aGlzLnRlc3QucmVwb3J0SW5mbyhyZXNvbHV0aW9uWzBdICsgJ3gnICsgcmVzb2x1dGlvblsxXSArXG4gICAgICAgICAgICAnIG5vdCBzdXBwb3J0ZWQnKTtcbiAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgdGhpcy50ZXN0LnJlcG9ydEVycm9yKCdnZXRVc2VyTWVkaWEgZmFpbGVkIHdpdGggZXJyb3I6ICcgK1xuICAgICAgICAgICAgICAgIGVycm9yLm5hbWUpO1xuICAgICAgICAgIH1cbiAgICAgICAgICB0aGlzLm1heWJlQ29udGludWVHZXRVc2VyTWVkaWEoKTtcbiAgICAgICAgfS5iaW5kKHRoaXMpKTtcbiAgfSxcblxuICBtYXliZUNvbnRpbnVlR2V0VXNlck1lZGlhOiBmdW5jdGlvbigpIHtcbiAgICBpZiAodGhpcy5jdXJyZW50UmVzb2x1dGlvbiA9PT0gdGhpcy5yZXNvbHV0aW9ucy5sZW5ndGgpIHtcbiAgICAgIHRoaXMudGVzdC5kb25lKCk7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIHRoaXMuc3RhcnRHZXRVc2VyTWVkaWEodGhpcy5yZXNvbHV0aW9uc1t0aGlzLmN1cnJlbnRSZXNvbHV0aW9uKytdKTtcbiAgfSxcblxuICBjb2xsZWN0QW5kQW5hbHl6ZVN0YXRzXzogZnVuY3Rpb24oc3RyZWFtLCByZXNvbHV0aW9uKSB7XG4gICAgdmFyIHRyYWNrcyA9IHN0cmVhbS5nZXRWaWRlb1RyYWNrcygpO1xuICAgIGlmICh0cmFja3MubGVuZ3RoIDwgMSkge1xuICAgICAgdGhpcy50ZXN0LnJlcG9ydEVycm9yKCdObyB2aWRlbyB0cmFjayBpbiByZXR1cm5lZCBzdHJlYW0uJyk7XG4gICAgICB0aGlzLm1heWJlQ29udGludWVHZXRVc2VyTWVkaWEoKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICAvLyBGaXJlZm94IGRvZXMgbm90IHN1cHBvcnQgZXZlbnQgaGFuZGxlcnMgb24gbWVkaWFTdHJlYW1UcmFjayB5ZXQuXG4gICAgLy8gaHR0cHM6Ly9kZXZlbG9wZXIubW96aWxsYS5vcmcvZW4tVVMvZG9jcy9XZWIvQVBJL01lZGlhU3RyZWFtVHJhY2tcbiAgICAvLyBUT0RPOiByZW1vdmUgaWYgKC4uLikgd2hlbiBldmVudCBoYW5kbGVycyBhcmUgc3VwcG9ydGVkIGJ5IEZpcmVmb3guXG4gICAgdmFyIHZpZGVvVHJhY2sgPSB0cmFja3NbMF07XG4gICAgaWYgKHR5cGVvZiB2aWRlb1RyYWNrLmFkZEV2ZW50TGlzdGVuZXIgPT09ICdmdW5jdGlvbicpIHtcbiAgICAgIC8vIFJlZ2lzdGVyIGV2ZW50cy5cbiAgICAgIHZpZGVvVHJhY2suYWRkRXZlbnRMaXN0ZW5lcignZW5kZWQnLCBmdW5jdGlvbigpIHtcbiAgICAgICAgLy8gSWdub3JlIGV2ZW50cyB3aGVuIHNodXR0aW5nIGRvd24gdGhlIHRlc3QuXG4gICAgICAgIGlmICh0aGlzLmlzU2h1dHRpbmdEb3duKSB7XG4gICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICAgIHRoaXMudGVzdC5yZXBvcnRFcnJvcignVmlkZW8gdHJhY2sgZW5kZWQsIGNhbWVyYSBzdG9wcGVkIHdvcmtpbmcnKTtcbiAgICAgIH0uYmluZCh0aGlzKSk7XG4gICAgICB2aWRlb1RyYWNrLmFkZEV2ZW50TGlzdGVuZXIoJ211dGUnLCBmdW5jdGlvbigpIHtcbiAgICAgICAgLy8gSWdub3JlIGV2ZW50cyB3aGVuIHNodXR0aW5nIGRvd24gdGhlIHRlc3QuXG4gICAgICAgIGlmICh0aGlzLmlzU2h1dHRpbmdEb3duKSB7XG4gICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICAgIHRoaXMudGVzdC5yZXBvcnRXYXJuaW5nKCdZb3VyIGNhbWVyYSByZXBvcnRlZCBpdHNlbGYgYXMgbXV0ZWQuJyk7XG4gICAgICAgIC8vIE1lZGlhU3RyZWFtVHJhY2subXV0ZWQgcHJvcGVydHkgaXMgbm90IHdpcmVkIHVwIGluIENocm9tZSB5ZXQsXG4gICAgICAgIC8vIGNoZWNraW5nIGlzTXV0ZWQgbG9jYWwgc3RhdGUuXG4gICAgICAgIHRoaXMuaXNNdXRlZCA9IHRydWU7XG4gICAgICB9LmJpbmQodGhpcykpO1xuICAgICAgdmlkZW9UcmFjay5hZGRFdmVudExpc3RlbmVyKCd1bm11dGUnLCBmdW5jdGlvbigpIHtcbiAgICAgICAgLy8gSWdub3JlIGV2ZW50cyB3aGVuIHNodXR0aW5nIGRvd24gdGhlIHRlc3QuXG4gICAgICAgIGlmICh0aGlzLmlzU2h1dHRpbmdEb3duKSB7XG4gICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICAgIHRoaXMudGVzdC5yZXBvcnRJbmZvKCdZb3VyIGNhbWVyYSByZXBvcnRlZCBpdHNlbGYgYXMgdW5tdXRlZC4nKTtcbiAgICAgICAgdGhpcy5pc011dGVkID0gZmFsc2U7XG4gICAgICB9LmJpbmQodGhpcykpO1xuICAgIH1cblxuICAgIHZhciB2aWRlbyA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ3ZpZGVvJyk7XG4gICAgdmlkZW8uc2V0QXR0cmlidXRlKCdhdXRvcGxheScsICcnKTtcbiAgICB2aWRlby5zZXRBdHRyaWJ1dGUoJ211dGVkJywgJycpO1xuICAgIHZpZGVvLndpZHRoID0gcmVzb2x1dGlvblswXTtcbiAgICB2aWRlby5oZWlnaHQgPSByZXNvbHV0aW9uWzFdO1xuICAgIHZpZGVvLnNyY09iamVjdCA9IHN0cmVhbTtcbiAgICB2YXIgZnJhbWVDaGVja2VyID0gbmV3IFZpZGVvRnJhbWVDaGVja2VyKHZpZGVvKTtcbiAgICB2YXIgY2FsbCA9IG5ldyBDYWxsKG51bGwsIHRoaXMudGVzdCk7XG4gICAgY2FsbC5wYzEuYWRkU3RyZWFtKHN0cmVhbSk7XG4gICAgY2FsbC5lc3RhYmxpc2hDb25uZWN0aW9uKCk7XG4gICAgY2FsbC5nYXRoZXJTdGF0cyhjYWxsLnBjMSwgbnVsbCwgc3RyZWFtLFxuICAgICAgICB0aGlzLm9uQ2FsbEVuZGVkXy5iaW5kKHRoaXMsIHJlc29sdXRpb24sIHZpZGVvLFxuICAgICAgICAgICAgc3RyZWFtLCBmcmFtZUNoZWNrZXIpLFxuICAgICAgICAxMDApO1xuXG4gICAgc2V0VGltZW91dFdpdGhQcm9ncmVzc0Jhcih0aGlzLmVuZENhbGxfLmJpbmQodGhpcywgY2FsbCwgc3RyZWFtKSwgODAwMCk7XG4gIH0sXG5cbiAgb25DYWxsRW5kZWRfOiBmdW5jdGlvbihyZXNvbHV0aW9uLCB2aWRlb0VsZW1lbnQsIHN0cmVhbSwgZnJhbWVDaGVja2VyLFxuICAgIHN0YXRzLCBzdGF0c1RpbWUpIHtcbiAgICB0aGlzLmFuYWx5emVTdGF0c18ocmVzb2x1dGlvbiwgdmlkZW9FbGVtZW50LCBzdHJlYW0sIGZyYW1lQ2hlY2tlcixcbiAgICAgICAgc3RhdHMsIHN0YXRzVGltZSk7XG5cbiAgICBmcmFtZUNoZWNrZXIuc3RvcCgpO1xuXG4gICAgdGhpcy50ZXN0LmRvbmUoKTtcbiAgfSxcblxuICBhbmFseXplU3RhdHNfOiBmdW5jdGlvbihyZXNvbHV0aW9uLCB2aWRlb0VsZW1lbnQsIHN0cmVhbSxcbiAgICBmcmFtZUNoZWNrZXIsIHN0YXRzLCBzdGF0c1RpbWUpIHtcbiAgICB2YXIgZ29vZ0F2Z0VuY29kZVRpbWUgPSBbXTtcbiAgICB2YXIgZ29vZ0F2Z0ZyYW1lUmF0ZUlucHV0ID0gW107XG4gICAgdmFyIGdvb2dBdmdGcmFtZVJhdGVTZW50ID0gW107XG4gICAgdmFyIHN0YXRzUmVwb3J0ID0ge307XG4gICAgdmFyIGZyYW1lU3RhdHMgPSBmcmFtZUNoZWNrZXIuZnJhbWVTdGF0cztcblxuICAgIGZvciAodmFyIGluZGV4IGluIHN0YXRzKSB7XG4gICAgICBpZiAoc3RhdHNbaW5kZXhdLnR5cGUgPT09ICdzc3JjJykge1xuICAgICAgICAvLyBNYWtlIHN1cmUgdG8gb25seSBjYXB0dXJlIHN0YXRzIGFmdGVyIHRoZSBlbmNvZGVyIGlzIHNldHVwLlxuICAgICAgICBpZiAocGFyc2VJbnQoc3RhdHNbaW5kZXhdLmdvb2dGcmFtZVJhdGVJbnB1dCkgPiAwKSB7XG4gICAgICAgICAgZ29vZ0F2Z0VuY29kZVRpbWUucHVzaChcbiAgICAgICAgICAgICAgcGFyc2VJbnQoc3RhdHNbaW5kZXhdLmdvb2dBdmdFbmNvZGVNcykpO1xuICAgICAgICAgIGdvb2dBdmdGcmFtZVJhdGVJbnB1dC5wdXNoKFxuICAgICAgICAgICAgICBwYXJzZUludChzdGF0c1tpbmRleF0uZ29vZ0ZyYW1lUmF0ZUlucHV0KSk7XG4gICAgICAgICAgZ29vZ0F2Z0ZyYW1lUmF0ZVNlbnQucHVzaChcbiAgICAgICAgICAgICAgcGFyc2VJbnQoc3RhdHNbaW5kZXhdLmdvb2dGcmFtZVJhdGVTZW50KSk7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG5cbiAgICBzdGF0c1JlcG9ydC5jYW1lcmFOYW1lID0gc3RyZWFtLmdldFZpZGVvVHJhY2tzKClbMF0ubGFiZWwgfHwgTmFOO1xuICAgIHN0YXRzUmVwb3J0LmFjdHVhbFZpZGVvV2lkdGggPSB2aWRlb0VsZW1lbnQudmlkZW9XaWR0aDtcbiAgICBzdGF0c1JlcG9ydC5hY3R1YWxWaWRlb0hlaWdodCA9IHZpZGVvRWxlbWVudC52aWRlb0hlaWdodDtcbiAgICBzdGF0c1JlcG9ydC5tYW5kYXRvcnlXaWR0aCA9IHJlc29sdXRpb25bMF07XG4gICAgc3RhdHNSZXBvcnQubWFuZGF0b3J5SGVpZ2h0ID0gcmVzb2x1dGlvblsxXTtcbiAgICBzdGF0c1JlcG9ydC5lbmNvZGVTZXR1cFRpbWVNcyA9XG4gICAgICAgIHRoaXMuZXh0cmFjdEVuY29kZXJTZXR1cFRpbWVfKHN0YXRzLCBzdGF0c1RpbWUpO1xuICAgIHN0YXRzUmVwb3J0LmF2Z0VuY29kZVRpbWVNcyA9IGFycmF5QXZlcmFnZShnb29nQXZnRW5jb2RlVGltZSk7XG4gICAgc3RhdHNSZXBvcnQubWluRW5jb2RlVGltZU1zID0gYXJyYXlNaW4oZ29vZ0F2Z0VuY29kZVRpbWUpO1xuICAgIHN0YXRzUmVwb3J0Lm1heEVuY29kZVRpbWVNcyA9IGFycmF5TWF4KGdvb2dBdmdFbmNvZGVUaW1lKTtcbiAgICBzdGF0c1JlcG9ydC5hdmdJbnB1dEZwcyA9IGFycmF5QXZlcmFnZShnb29nQXZnRnJhbWVSYXRlSW5wdXQpO1xuICAgIHN0YXRzUmVwb3J0Lm1pbklucHV0RnBzID0gYXJyYXlNaW4oZ29vZ0F2Z0ZyYW1lUmF0ZUlucHV0KTtcbiAgICBzdGF0c1JlcG9ydC5tYXhJbnB1dEZwcyA9IGFycmF5TWF4KGdvb2dBdmdGcmFtZVJhdGVJbnB1dCk7XG4gICAgc3RhdHNSZXBvcnQuYXZnU2VudEZwcyA9IGFycmF5QXZlcmFnZShnb29nQXZnRnJhbWVSYXRlU2VudCk7XG4gICAgc3RhdHNSZXBvcnQubWluU2VudEZwcyA9IGFycmF5TWluKGdvb2dBdmdGcmFtZVJhdGVTZW50KTtcbiAgICBzdGF0c1JlcG9ydC5tYXhTZW50RnBzID0gYXJyYXlNYXgoZ29vZ0F2Z0ZyYW1lUmF0ZVNlbnQpO1xuICAgIHN0YXRzUmVwb3J0LmlzTXV0ZWQgPSB0aGlzLmlzTXV0ZWQ7XG4gICAgc3RhdHNSZXBvcnQudGVzdGVkRnJhbWVzID0gZnJhbWVTdGF0cy5udW1GcmFtZXM7XG4gICAgc3RhdHNSZXBvcnQuYmxhY2tGcmFtZXMgPSBmcmFtZVN0YXRzLm51bUJsYWNrRnJhbWVzO1xuICAgIHN0YXRzUmVwb3J0LmZyb3plbkZyYW1lcyA9IGZyYW1lU3RhdHMubnVtRnJvemVuRnJhbWVzO1xuXG4gICAgLy8gVE9ETzogQWRkIGEgcmVwb3J0SW5mbygpIGZ1bmN0aW9uIHdpdGggYSB0YWJsZSBmb3JtYXQgdG8gZGlzcGxheVxuICAgIC8vIHZhbHVlcyBjbGVhcmVyLlxuICAgIHJlcG9ydC50cmFjZUV2ZW50SW5zdGFudCgndmlkZW8tc3RhdHMnLCBzdGF0c1JlcG9ydCk7XG5cbiAgICB0aGlzLnRlc3RFeHBlY3RhdGlvbnNfKHN0YXRzUmVwb3J0KTtcbiAgfSxcblxuICBlbmRDYWxsXzogZnVuY3Rpb24oY2FsbE9iamVjdCwgc3RyZWFtKSB7XG4gICAgdGhpcy5pc1NodXR0aW5nRG93biA9IHRydWU7XG4gICAgc3RyZWFtLmdldFRyYWNrcygpLmZvckVhY2goZnVuY3Rpb24odHJhY2spIHtcbiAgICAgIHRyYWNrLnN0b3AoKTtcbiAgICB9KTtcbiAgICBjYWxsT2JqZWN0LmNsb3NlKCk7XG4gIH0sXG5cbiAgZXh0cmFjdEVuY29kZXJTZXR1cFRpbWVfOiBmdW5jdGlvbihzdGF0cywgc3RhdHNUaW1lKSB7XG4gICAgZm9yICh2YXIgaW5kZXggPSAwOyBpbmRleCAhPT0gc3RhdHMubGVuZ3RoOyBpbmRleCsrKSB7XG4gICAgICBpZiAoc3RhdHNbaW5kZXhdLnR5cGUgPT09ICdzc3JjJykge1xuICAgICAgICBpZiAocGFyc2VJbnQoc3RhdHNbaW5kZXhdLmdvb2dGcmFtZVJhdGVJbnB1dCkgPiAwKSB7XG4gICAgICAgICAgcmV0dXJuIEpTT04uc3RyaW5naWZ5KHN0YXRzVGltZVtpbmRleF0gLSBzdGF0c1RpbWVbMF0pO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuICAgIHJldHVybiBOYU47XG4gIH0sXG5cbiAgcmVzb2x1dGlvbk1hdGNoZXNJbmRlcGVuZGVudE9mUm90YXRpb25PckNyb3BfOiBmdW5jdGlvbihhV2lkdGgsIGFIZWlnaHQsXG4gICAgYldpZHRoLCBiSGVpZ2h0KSB7XG4gICAgdmFyIG1pblJlcyA9IE1hdGgubWluKGJXaWR0aCwgYkhlaWdodCk7XG4gICAgcmV0dXJuIChhV2lkdGggPT09IGJXaWR0aCAmJiBhSGVpZ2h0ID09PSBiSGVpZ2h0KSB8fFxuICAgICAgICAgICAoYVdpZHRoID09PSBiSGVpZ2h0ICYmIGFIZWlnaHQgPT09IGJXaWR0aCkgfHxcbiAgICAgICAgICAgKGFXaWR0aCA9PT0gbWluUmVzICYmIGJIZWlnaHQgPT09IG1pblJlcyk7XG4gIH0sXG5cbiAgdGVzdEV4cGVjdGF0aW9uc186IGZ1bmN0aW9uKGluZm8pIHtcbiAgICB2YXIgbm90QXZhaWxhYmxlU3RhdHMgPSBbXTtcbiAgICBmb3IgKHZhciBrZXkgaW4gaW5mbykge1xuICAgICAgaWYgKGluZm8uaGFzT3duUHJvcGVydHkoa2V5KSkge1xuICAgICAgICBpZiAodHlwZW9mIGluZm9ba2V5XSA9PT0gJ251bWJlcicgJiYgaXNOYU4oaW5mb1trZXldKSkge1xuICAgICAgICAgIG5vdEF2YWlsYWJsZVN0YXRzLnB1c2goa2V5KTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICB0aGlzLnRlc3QucmVwb3J0SW5mbyhrZXkgKyAnOiAnICsgaW5mb1trZXldKTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cbiAgICBpZiAobm90QXZhaWxhYmxlU3RhdHMubGVuZ3RoICE9PSAwKSB7XG4gICAgICB0aGlzLnRlc3QucmVwb3J0SW5mbygnTm90IGF2YWlsYWJsZTogJyArIG5vdEF2YWlsYWJsZVN0YXRzLmpvaW4oJywgJykpO1xuICAgIH1cblxuICAgIGlmIChpc05hTihpbmZvLmF2Z1NlbnRGcHMpKSB7XG4gICAgICB0aGlzLnRlc3QucmVwb3J0SW5mbygnQ2Fubm90IHZlcmlmeSBzZW50IEZQUy4nKTtcbiAgICB9IGVsc2UgaWYgKGluZm8uYXZnU2VudEZwcyA8IDUpIHtcbiAgICAgIHRoaXMudGVzdC5yZXBvcnRFcnJvcignTG93IGF2ZXJhZ2Ugc2VudCBGUFM6ICcgKyBpbmZvLmF2Z1NlbnRGcHMpO1xuICAgIH0gZWxzZSB7XG4gICAgICB0aGlzLnRlc3QucmVwb3J0U3VjY2VzcygnQXZlcmFnZSBGUFMgYWJvdmUgdGhyZXNob2xkJyk7XG4gICAgfVxuICAgIGlmICghdGhpcy5yZXNvbHV0aW9uTWF0Y2hlc0luZGVwZW5kZW50T2ZSb3RhdGlvbk9yQ3JvcF8oXG4gICAgICAgIGluZm8uYWN0dWFsVmlkZW9XaWR0aCwgaW5mby5hY3R1YWxWaWRlb0hlaWdodCwgaW5mby5tYW5kYXRvcnlXaWR0aCxcbiAgICAgICAgaW5mby5tYW5kYXRvcnlIZWlnaHQpKSB7XG4gICAgICB0aGlzLnRlc3QucmVwb3J0RXJyb3IoJ0luY29ycmVjdCBjYXB0dXJlZCByZXNvbHV0aW9uLicpO1xuICAgIH0gZWxzZSB7XG4gICAgICB0aGlzLnRlc3QucmVwb3J0U3VjY2VzcygnQ2FwdHVyZWQgdmlkZW8gdXNpbmcgZXhwZWN0ZWQgcmVzb2x1dGlvbi4nKTtcbiAgICB9XG4gICAgaWYgKGluZm8udGVzdGVkRnJhbWVzID09PSAwKSB7XG4gICAgICB0aGlzLnRlc3QucmVwb3J0RXJyb3IoJ0NvdWxkIG5vdCBhbmFseXplIGFueSB2aWRlbyBmcmFtZS4nKTtcbiAgICB9IGVsc2Uge1xuICAgICAgaWYgKGluZm8uYmxhY2tGcmFtZXMgPiBpbmZvLnRlc3RlZEZyYW1lcyAvIDMpIHtcbiAgICAgICAgdGhpcy50ZXN0LnJlcG9ydEVycm9yKCdDYW1lcmEgZGVsaXZlcmluZyBsb3RzIG9mIGJsYWNrIGZyYW1lcy4nKTtcbiAgICAgIH1cbiAgICAgIGlmIChpbmZvLmZyb3plbkZyYW1lcyA+IGluZm8udGVzdGVkRnJhbWVzIC8gMykge1xuICAgICAgICB0aGlzLnRlc3QucmVwb3J0RXJyb3IoJ0NhbWVyYSBkZWxpdmVyaW5nIGxvdHMgb2YgZnJvemVuIGZyYW1lcy4nKTtcbiAgICAgIH1cbiAgICB9XG4gIH1cbn07XG5cbmV4cG9ydCBkZWZhdWx0IENhbVJlc29sdXRpb25zVGVzdDtcbiIsIid1c2Ugc3RyaWN0JztcblxuLypcbiAqIEluIGdlbmVyaWMgY2FtZXJhcyB1c2luZyBDaHJvbWUgcmVzY2FsZXIsIGFsbCByZXNvbHV0aW9ucyBzaG91bGQgYmUgc3VwcG9ydGVkXG4gKiB1cCB0byBhIGdpdmVuIG9uZSBhbmQgbm9uZSBiZXlvbmQgdGhlcmUuIFNwZWNpYWwgY2FtZXJhcywgc3VjaCBhcyBkaWdpdGl6ZXJzLFxuICogbWlnaHQgc3VwcG9ydCBvbmx5IG9uZSByZXNvbHV0aW9uLlxuICovXG5cbi8qXG4gKiBcIkFuYWx5emUgcGVyZm9ybWFuY2UgZm9yIFwicmVzb2x1dGlvblwiXCIgdGVzdCB1c2VzIGdldFN0YXRzLCBjYW52YXMgYW5kIHRoZVxuICogdmlkZW8gZWxlbWVudCB0byBhbmFseXplIHRoZSB2aWRlbyBmcmFtZXMgZnJvbSBhIGNhcHR1cmUgZGV2aWNlLiBJdCB3aWxsXG4gKiByZXBvcnQgbnVtYmVyIG9mIGJsYWNrIGZyYW1lcywgZnJvemVuIGZyYW1lcywgdGVzdGVkIGZyYW1lcyBhbmQgdmFyaW91cyBzdGF0c1xuICogbGlrZSBhdmVyYWdlIGVuY29kZSB0aW1lIGFuZCBGUFMuIEEgdGVzdCBjYXNlIHdpbGwgYmUgY3JlYXRlZCBwZXIgbWFuZGF0b3J5XG4gKiByZXNvbHV0aW9uIGZvdW5kIGluIHRoZSBcInJlc29sdXRpb25zXCIgYXJyYXkuXG4gKi9cblxuZnVuY3Rpb24gQ2FtUmVzb2x1dGlvbnNUZXN0KHRlc3QsIHJlc29sdXRpb25zKSB7XG4gIHRoaXMudGVzdCA9IHRlc3Q7XG4gIHRoaXMucmVzb2x1dGlvbnMgPSByZXNvbHV0aW9ucztcbiAgdGhpcy5jdXJyZW50UmVzb2x1dGlvbiA9IDA7XG4gIHRoaXMuaXNNdXRlZCA9IGZhbHNlO1xuICB0aGlzLmlzU2h1dHRpbmdEb3duID0gZmFsc2U7XG59XG5cbkNhbVJlc29sdXRpb25zVGVzdC5wcm90b3R5cGUgPSB7XG4gIHJ1bjogZnVuY3Rpb24oKSB7XG4gICAgdGhpcy5zdGFydEdldFVzZXJNZWRpYSh0aGlzLnJlc29sdXRpb25zW3RoaXMuY3VycmVudFJlc29sdXRpb25dKTtcbiAgfSxcblxuICBzdGFydEdldFVzZXJNZWRpYTogZnVuY3Rpb24ocmVzb2x1dGlvbikge1xuICAgIHZhciBjb25zdHJhaW50cyA9IHtcbiAgICAgIGF1ZGlvOiBmYWxzZSxcbiAgICAgIHZpZGVvOiB7XG4gICAgICAgIHdpZHRoOiB7ZXhhY3Q6IHJlc29sdXRpb25bMF19LFxuICAgICAgICBoZWlnaHQ6IHtleGFjdDogcmVzb2x1dGlvblsxXX1cbiAgICAgIH1cbiAgICB9O1xuICAgIG5hdmlnYXRvci5tZWRpYURldmljZXMuZ2V0VXNlck1lZGlhKGNvbnN0cmFpbnRzKVxuICAgICAgICAudGhlbihmdW5jdGlvbihzdHJlYW0pIHtcbiAgICAgICAgICAvLyBEbyBub3QgY2hlY2sgYWN0dWFsIHZpZGVvIGZyYW1lcyB3aGVuIG1vcmUgdGhhbiBvbmUgcmVzb2x1dGlvbiBpc1xuICAgICAgICAgIC8vIHByb3ZpZGVkLlxuICAgICAgICAgIGlmICh0aGlzLnJlc29sdXRpb25zLmxlbmd0aCA+IDEpIHtcbiAgICAgICAgICAgIHRoaXMudGVzdC5yZXBvcnRTdWNjZXNzKCdTdXBwb3J0ZWQ6ICcgKyByZXNvbHV0aW9uWzBdICsgJ3gnICtcbiAgICAgICAgICAgIHJlc29sdXRpb25bMV0pO1xuICAgICAgICAgICAgc3RyZWFtLmdldFRyYWNrcygpLmZvckVhY2goZnVuY3Rpb24odHJhY2spIHtcbiAgICAgICAgICAgICAgdHJhY2suc3RvcCgpO1xuICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICB0aGlzLm1heWJlQ29udGludWVHZXRVc2VyTWVkaWEoKTtcbiAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgdGhpcy5jb2xsZWN0QW5kQW5hbHl6ZVN0YXRzXyhzdHJlYW0sIHJlc29sdXRpb24pO1xuICAgICAgICAgIH1cbiAgICAgICAgfS5iaW5kKHRoaXMpKVxuICAgICAgICAuY2F0Y2goZnVuY3Rpb24oZXJyb3IpIHtcbiAgICAgICAgICBpZiAodGhpcy5yZXNvbHV0aW9ucy5sZW5ndGggPiAxKSB7XG4gICAgICAgICAgICB0aGlzLnRlc3QucmVwb3J0SW5mbyhyZXNvbHV0aW9uWzBdICsgJ3gnICsgcmVzb2x1dGlvblsxXSArXG4gICAgICAgICAgICAnIG5vdCBzdXBwb3J0ZWQnKTtcbiAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgdGhpcy50ZXN0LnJlcG9ydEVycm9yKCdnZXRVc2VyTWVkaWEgZmFpbGVkIHdpdGggZXJyb3I6ICcgK1xuICAgICAgICAgICAgICAgIGVycm9yLm5hbWUpO1xuICAgICAgICAgIH1cbiAgICAgICAgICB0aGlzLm1heWJlQ29udGludWVHZXRVc2VyTWVkaWEoKTtcbiAgICAgICAgfS5iaW5kKHRoaXMpKTtcbiAgfSxcblxuICBtYXliZUNvbnRpbnVlR2V0VXNlck1lZGlhOiBmdW5jdGlvbigpIHtcbiAgICBpZiAodGhpcy5jdXJyZW50UmVzb2x1dGlvbiA9PT0gdGhpcy5yZXNvbHV0aW9ucy5sZW5ndGgpIHtcbiAgICAgIHRoaXMudGVzdC5kb25lKCk7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIHRoaXMuc3RhcnRHZXRVc2VyTWVkaWEodGhpcy5yZXNvbHV0aW9uc1t0aGlzLmN1cnJlbnRSZXNvbHV0aW9uKytdKTtcbiAgfSxcblxuICBjb2xsZWN0QW5kQW5hbHl6ZVN0YXRzXzogZnVuY3Rpb24oc3RyZWFtLCByZXNvbHV0aW9uKSB7XG4gICAgdmFyIHRyYWNrcyA9IHN0cmVhbS5nZXRWaWRlb1RyYWNrcygpO1xuICAgIGlmICh0cmFja3MubGVuZ3RoIDwgMSkge1xuICAgICAgdGhpcy50ZXN0LnJlcG9ydEVycm9yKCdObyB2aWRlbyB0cmFjayBpbiByZXR1cm5lZCBzdHJlYW0uJyk7XG4gICAgICB0aGlzLm1heWJlQ29udGludWVHZXRVc2VyTWVkaWEoKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICAvLyBGaXJlZm94IGRvZXMgbm90IHN1cHBvcnQgZXZlbnQgaGFuZGxlcnMgb24gbWVkaWFTdHJlYW1UcmFjayB5ZXQuXG4gICAgLy8gaHR0cHM6Ly9kZXZlbG9wZXIubW96aWxsYS5vcmcvZW4tVVMvZG9jcy9XZWIvQVBJL01lZGlhU3RyZWFtVHJhY2tcbiAgICAvLyBUT0RPOiByZW1vdmUgaWYgKC4uLikgd2hlbiBldmVudCBoYW5kbGVycyBhcmUgc3VwcG9ydGVkIGJ5IEZpcmVmb3guXG4gICAgdmFyIHZpZGVvVHJhY2sgPSB0cmFja3NbMF07XG4gICAgaWYgKHR5cGVvZiB2aWRlb1RyYWNrLmFkZEV2ZW50TGlzdGVuZXIgPT09ICdmdW5jdGlvbicpIHtcbiAgICAgIC8vIFJlZ2lzdGVyIGV2ZW50cy5cbiAgICAgIHZpZGVvVHJhY2suYWRkRXZlbnRMaXN0ZW5lcignZW5kZWQnLCBmdW5jdGlvbigpIHtcbiAgICAgICAgLy8gSWdub3JlIGV2ZW50cyB3aGVuIHNodXR0aW5nIGRvd24gdGhlIHRlc3QuXG4gICAgICAgIGlmICh0aGlzLmlzU2h1dHRpbmdEb3duKSB7XG4gICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICAgIHRoaXMudGVzdC5yZXBvcnRFcnJvcignVmlkZW8gdHJhY2sgZW5kZWQsIGNhbWVyYSBzdG9wcGVkIHdvcmtpbmcnKTtcbiAgICAgIH0uYmluZCh0aGlzKSk7XG4gICAgICB2aWRlb1RyYWNrLmFkZEV2ZW50TGlzdGVuZXIoJ211dGUnLCBmdW5jdGlvbigpIHtcbiAgICAgICAgLy8gSWdub3JlIGV2ZW50cyB3aGVuIHNodXR0aW5nIGRvd24gdGhlIHRlc3QuXG4gICAgICAgIGlmICh0aGlzLmlzU2h1dHRpbmdEb3duKSB7XG4gICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICAgIHRoaXMudGVzdC5yZXBvcnRXYXJuaW5nKCdZb3VyIGNhbWVyYSByZXBvcnRlZCBpdHNlbGYgYXMgbXV0ZWQuJyk7XG4gICAgICAgIC8vIE1lZGlhU3RyZWFtVHJhY2subXV0ZWQgcHJvcGVydHkgaXMgbm90IHdpcmVkIHVwIGluIENocm9tZSB5ZXQsXG4gICAgICAgIC8vIGNoZWNraW5nIGlzTXV0ZWQgbG9jYWwgc3RhdGUuXG4gICAgICAgIHRoaXMuaXNNdXRlZCA9IHRydWU7XG4gICAgICB9LmJpbmQodGhpcykpO1xuICAgICAgdmlkZW9UcmFjay5hZGRFdmVudExpc3RlbmVyKCd1bm11dGUnLCBmdW5jdGlvbigpIHtcbiAgICAgICAgLy8gSWdub3JlIGV2ZW50cyB3aGVuIHNodXR0aW5nIGRvd24gdGhlIHRlc3QuXG4gICAgICAgIGlmICh0aGlzLmlzU2h1dHRpbmdEb3duKSB7XG4gICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICAgIHRoaXMudGVzdC5yZXBvcnRJbmZvKCdZb3VyIGNhbWVyYSByZXBvcnRlZCBpdHNlbGYgYXMgdW5tdXRlZC4nKTtcbiAgICAgICAgdGhpcy5pc011dGVkID0gZmFsc2U7XG4gICAgICB9LmJpbmQodGhpcykpO1xuICAgIH1cblxuICAgIHZhciB2aWRlbyA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ3ZpZGVvJyk7XG4gICAgdmlkZW8uc2V0QXR0cmlidXRlKCdhdXRvcGxheScsICcnKTtcbiAgICB2aWRlby5zZXRBdHRyaWJ1dGUoJ211dGVkJywgJycpO1xuICAgIHZpZGVvLndpZHRoID0gcmVzb2x1dGlvblswXTtcbiAgICB2aWRlby5oZWlnaHQgPSByZXNvbHV0aW9uWzFdO1xuICAgIHZpZGVvLnNyY09iamVjdCA9IHN0cmVhbTtcbiAgICB2YXIgZnJhbWVDaGVja2VyID0gbmV3IFZpZGVvRnJhbWVDaGVja2VyKHZpZGVvKTtcbiAgICB2YXIgY2FsbCA9IG5ldyBDYWxsKG51bGwsIHRoaXMudGVzdCk7XG4gICAgY2FsbC5wYzEuYWRkU3RyZWFtKHN0cmVhbSk7XG4gICAgY2FsbC5lc3RhYmxpc2hDb25uZWN0aW9uKCk7XG4gICAgY2FsbC5nYXRoZXJTdGF0cyhjYWxsLnBjMSwgbnVsbCwgc3RyZWFtLFxuICAgICAgICB0aGlzLm9uQ2FsbEVuZGVkXy5iaW5kKHRoaXMsIHJlc29sdXRpb24sIHZpZGVvLFxuICAgICAgICAgICAgc3RyZWFtLCBmcmFtZUNoZWNrZXIpLFxuICAgICAgICAxMDApO1xuXG4gICAgc2V0VGltZW91dFdpdGhQcm9ncmVzc0Jhcih0aGlzLmVuZENhbGxfLmJpbmQodGhpcywgY2FsbCwgc3RyZWFtKSwgODAwMCk7XG4gIH0sXG5cbiAgb25DYWxsRW5kZWRfOiBmdW5jdGlvbihyZXNvbHV0aW9uLCB2aWRlb0VsZW1lbnQsIHN0cmVhbSwgZnJhbWVDaGVja2VyLFxuICAgIHN0YXRzLCBzdGF0c1RpbWUpIHtcbiAgICB0aGlzLmFuYWx5emVTdGF0c18ocmVzb2x1dGlvbiwgdmlkZW9FbGVtZW50LCBzdHJlYW0sIGZyYW1lQ2hlY2tlcixcbiAgICAgICAgc3RhdHMsIHN0YXRzVGltZSk7XG5cbiAgICBmcmFtZUNoZWNrZXIuc3RvcCgpO1xuXG4gICAgdGhpcy50ZXN0LmRvbmUoKTtcbiAgfSxcblxuICBhbmFseXplU3RhdHNfOiBmdW5jdGlvbihyZXNvbHV0aW9uLCB2aWRlb0VsZW1lbnQsIHN0cmVhbSxcbiAgICBmcmFtZUNoZWNrZXIsIHN0YXRzLCBzdGF0c1RpbWUpIHtcbiAgICB2YXIgZ29vZ0F2Z0VuY29kZVRpbWUgPSBbXTtcbiAgICB2YXIgZ29vZ0F2Z0ZyYW1lUmF0ZUlucHV0ID0gW107XG4gICAgdmFyIGdvb2dBdmdGcmFtZVJhdGVTZW50ID0gW107XG4gICAgdmFyIHN0YXRzUmVwb3J0ID0ge307XG4gICAgdmFyIGZyYW1lU3RhdHMgPSBmcmFtZUNoZWNrZXIuZnJhbWVTdGF0cztcblxuICAgIGZvciAodmFyIGluZGV4IGluIHN0YXRzKSB7XG4gICAgICBpZiAoc3RhdHNbaW5kZXhdLnR5cGUgPT09ICdzc3JjJykge1xuICAgICAgICAvLyBNYWtlIHN1cmUgdG8gb25seSBjYXB0dXJlIHN0YXRzIGFmdGVyIHRoZSBlbmNvZGVyIGlzIHNldHVwLlxuICAgICAgICBpZiAocGFyc2VJbnQoc3RhdHNbaW5kZXhdLmdvb2dGcmFtZVJhdGVJbnB1dCkgPiAwKSB7XG4gICAgICAgICAgZ29vZ0F2Z0VuY29kZVRpbWUucHVzaChcbiAgICAgICAgICAgICAgcGFyc2VJbnQoc3RhdHNbaW5kZXhdLmdvb2dBdmdFbmNvZGVNcykpO1xuICAgICAgICAgIGdvb2dBdmdGcmFtZVJhdGVJbnB1dC5wdXNoKFxuICAgICAgICAgICAgICBwYXJzZUludChzdGF0c1tpbmRleF0uZ29vZ0ZyYW1lUmF0ZUlucHV0KSk7XG4gICAgICAgICAgZ29vZ0F2Z0ZyYW1lUmF0ZVNlbnQucHVzaChcbiAgICAgICAgICAgICAgcGFyc2VJbnQoc3RhdHNbaW5kZXhdLmdvb2dGcmFtZVJhdGVTZW50KSk7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG5cbiAgICBzdGF0c1JlcG9ydC5jYW1lcmFOYW1lID0gc3RyZWFtLmdldFZpZGVvVHJhY2tzKClbMF0ubGFiZWwgfHwgTmFOO1xuICAgIHN0YXRzUmVwb3J0LmFjdHVhbFZpZGVvV2lkdGggPSB2aWRlb0VsZW1lbnQudmlkZW9XaWR0aDtcbiAgICBzdGF0c1JlcG9ydC5hY3R1YWxWaWRlb0hlaWdodCA9IHZpZGVvRWxlbWVudC52aWRlb0hlaWdodDtcbiAgICBzdGF0c1JlcG9ydC5tYW5kYXRvcnlXaWR0aCA9IHJlc29sdXRpb25bMF07XG4gICAgc3RhdHNSZXBvcnQubWFuZGF0b3J5SGVpZ2h0ID0gcmVzb2x1dGlvblsxXTtcbiAgICBzdGF0c1JlcG9ydC5lbmNvZGVTZXR1cFRpbWVNcyA9XG4gICAgICAgIHRoaXMuZXh0cmFjdEVuY29kZXJTZXR1cFRpbWVfKHN0YXRzLCBzdGF0c1RpbWUpO1xuICAgIHN0YXRzUmVwb3J0LmF2Z0VuY29kZVRpbWVNcyA9IGFycmF5QXZlcmFnZShnb29nQXZnRW5jb2RlVGltZSk7XG4gICAgc3RhdHNSZXBvcnQubWluRW5jb2RlVGltZU1zID0gYXJyYXlNaW4oZ29vZ0F2Z0VuY29kZVRpbWUpO1xuICAgIHN0YXRzUmVwb3J0Lm1heEVuY29kZVRpbWVNcyA9IGFycmF5TWF4KGdvb2dBdmdFbmNvZGVUaW1lKTtcbiAgICBzdGF0c1JlcG9ydC5hdmdJbnB1dEZwcyA9IGFycmF5QXZlcmFnZShnb29nQXZnRnJhbWVSYXRlSW5wdXQpO1xuICAgIHN0YXRzUmVwb3J0Lm1pbklucHV0RnBzID0gYXJyYXlNaW4oZ29vZ0F2Z0ZyYW1lUmF0ZUlucHV0KTtcbiAgICBzdGF0c1JlcG9ydC5tYXhJbnB1dEZwcyA9IGFycmF5TWF4KGdvb2dBdmdGcmFtZVJhdGVJbnB1dCk7XG4gICAgc3RhdHNSZXBvcnQuYXZnU2VudEZwcyA9IGFycmF5QXZlcmFnZShnb29nQXZnRnJhbWVSYXRlU2VudCk7XG4gICAgc3RhdHNSZXBvcnQubWluU2VudEZwcyA9IGFycmF5TWluKGdvb2dBdmdGcmFtZVJhdGVTZW50KTtcbiAgICBzdGF0c1JlcG9ydC5tYXhTZW50RnBzID0gYXJyYXlNYXgoZ29vZ0F2Z0ZyYW1lUmF0ZVNlbnQpO1xuICAgIHN0YXRzUmVwb3J0LmlzTXV0ZWQgPSB0aGlzLmlzTXV0ZWQ7XG4gICAgc3RhdHNSZXBvcnQudGVzdGVkRnJhbWVzID0gZnJhbWVTdGF0cy5udW1GcmFtZXM7XG4gICAgc3RhdHNSZXBvcnQuYmxhY2tGcmFtZXMgPSBmcmFtZVN0YXRzLm51bUJsYWNrRnJhbWVzO1xuICAgIHN0YXRzUmVwb3J0LmZyb3plbkZyYW1lcyA9IGZyYW1lU3RhdHMubnVtRnJvemVuRnJhbWVzO1xuXG4gICAgLy8gVE9ETzogQWRkIGEgcmVwb3J0SW5mbygpIGZ1bmN0aW9uIHdpdGggYSB0YWJsZSBmb3JtYXQgdG8gZGlzcGxheVxuICAgIC8vIHZhbHVlcyBjbGVhcmVyLlxuICAgIHJlcG9ydC50cmFjZUV2ZW50SW5zdGFudCgndmlkZW8tc3RhdHMnLCBzdGF0c1JlcG9ydCk7XG5cbiAgICB0aGlzLnRlc3RFeHBlY3RhdGlvbnNfKHN0YXRzUmVwb3J0KTtcbiAgfSxcblxuICBlbmRDYWxsXzogZnVuY3Rpb24oY2FsbE9iamVjdCwgc3RyZWFtKSB7XG4gICAgdGhpcy5pc1NodXR0aW5nRG93biA9IHRydWU7XG4gICAgc3RyZWFtLmdldFRyYWNrcygpLmZvckVhY2goZnVuY3Rpb24odHJhY2spIHtcbiAgICAgIHRyYWNrLnN0b3AoKTtcbiAgICB9KTtcbiAgICBjYWxsT2JqZWN0LmNsb3NlKCk7XG4gIH0sXG5cbiAgZXh0cmFjdEVuY29kZXJTZXR1cFRpbWVfOiBmdW5jdGlvbihzdGF0cywgc3RhdHNUaW1lKSB7XG4gICAgZm9yICh2YXIgaW5kZXggPSAwOyBpbmRleCAhPT0gc3RhdHMubGVuZ3RoOyBpbmRleCsrKSB7XG4gICAgICBpZiAoc3RhdHNbaW5kZXhdLnR5cGUgPT09ICdzc3JjJykge1xuICAgICAgICBpZiAocGFyc2VJbnQoc3RhdHNbaW5kZXhdLmdvb2dGcmFtZVJhdGVJbnB1dCkgPiAwKSB7XG4gICAgICAgICAgcmV0dXJuIEpTT04uc3RyaW5naWZ5KHN0YXRzVGltZVtpbmRleF0gLSBzdGF0c1RpbWVbMF0pO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuICAgIHJldHVybiBOYU47XG4gIH0sXG5cbiAgcmVzb2x1dGlvbk1hdGNoZXNJbmRlcGVuZGVudE9mUm90YXRpb25PckNyb3BfOiBmdW5jdGlvbihhV2lkdGgsIGFIZWlnaHQsXG4gICAgYldpZHRoLCBiSGVpZ2h0KSB7XG4gICAgdmFyIG1pblJlcyA9IE1hdGgubWluKGJXaWR0aCwgYkhlaWdodCk7XG4gICAgcmV0dXJuIChhV2lkdGggPT09IGJXaWR0aCAmJiBhSGVpZ2h0ID09PSBiSGVpZ2h0KSB8fFxuICAgICAgICAgICAoYVdpZHRoID09PSBiSGVpZ2h0ICYmIGFIZWlnaHQgPT09IGJXaWR0aCkgfHxcbiAgICAgICAgICAgKGFXaWR0aCA9PT0gbWluUmVzICYmIGJIZWlnaHQgPT09IG1pblJlcyk7XG4gIH0sXG5cbiAgdGVzdEV4cGVjdGF0aW9uc186IGZ1bmN0aW9uKGluZm8pIHtcbiAgICB2YXIgbm90QXZhaWxhYmxlU3RhdHMgPSBbXTtcbiAgICBmb3IgKHZhciBrZXkgaW4gaW5mbykge1xuICAgICAgaWYgKGluZm8uaGFzT3duUHJvcGVydHkoa2V5KSkge1xuICAgICAgICBpZiAodHlwZW9mIGluZm9ba2V5XSA9PT0gJ251bWJlcicgJiYgaXNOYU4oaW5mb1trZXldKSkge1xuICAgICAgICAgIG5vdEF2YWlsYWJsZVN0YXRzLnB1c2goa2V5KTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICB0aGlzLnRlc3QucmVwb3J0SW5mbyhrZXkgKyAnOiAnICsgaW5mb1trZXldKTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cbiAgICBpZiAobm90QXZhaWxhYmxlU3RhdHMubGVuZ3RoICE9PSAwKSB7XG4gICAgICB0aGlzLnRlc3QucmVwb3J0SW5mbygnTm90IGF2YWlsYWJsZTogJyArIG5vdEF2YWlsYWJsZVN0YXRzLmpvaW4oJywgJykpO1xuICAgIH1cblxuICAgIGlmIChpc05hTihpbmZvLmF2Z1NlbnRGcHMpKSB7XG4gICAgICB0aGlzLnRlc3QucmVwb3J0SW5mbygnQ2Fubm90IHZlcmlmeSBzZW50IEZQUy4nKTtcbiAgICB9IGVsc2UgaWYgKGluZm8uYXZnU2VudEZwcyA8IDUpIHtcbiAgICAgIHRoaXMudGVzdC5yZXBvcnRFcnJvcignTG93IGF2ZXJhZ2Ugc2VudCBGUFM6ICcgKyBpbmZvLmF2Z1NlbnRGcHMpO1xuICAgIH0gZWxzZSB7XG4gICAgICB0aGlzLnRlc3QucmVwb3J0U3VjY2VzcygnQXZlcmFnZSBGUFMgYWJvdmUgdGhyZXNob2xkJyk7XG4gICAgfVxuICAgIGlmICghdGhpcy5yZXNvbHV0aW9uTWF0Y2hlc0luZGVwZW5kZW50T2ZSb3RhdGlvbk9yQ3JvcF8oXG4gICAgICAgIGluZm8uYWN0dWFsVmlkZW9XaWR0aCwgaW5mby5hY3R1YWxWaWRlb0hlaWdodCwgaW5mby5tYW5kYXRvcnlXaWR0aCxcbiAgICAgICAgaW5mby5tYW5kYXRvcnlIZWlnaHQpKSB7XG4gICAgICB0aGlzLnRlc3QucmVwb3J0RXJyb3IoJ0luY29ycmVjdCBjYXB0dXJlZCByZXNvbHV0aW9uLicpO1xuICAgIH0gZWxzZSB7XG4gICAgICB0aGlzLnRlc3QucmVwb3J0U3VjY2VzcygnQ2FwdHVyZWQgdmlkZW8gdXNpbmcgZXhwZWN0ZWQgcmVzb2x1dGlvbi4nKTtcbiAgICB9XG4gICAgaWYgKGluZm8udGVzdGVkRnJhbWVzID09PSAwKSB7XG4gICAgICB0aGlzLnRlc3QucmVwb3J0RXJyb3IoJ0NvdWxkIG5vdCBhbmFseXplIGFueSB2aWRlbyBmcmFtZS4nKTtcbiAgICB9IGVsc2Uge1xuICAgICAgaWYgKGluZm8uYmxhY2tGcmFtZXMgPiBpbmZvLnRlc3RlZEZyYW1lcyAvIDMpIHtcbiAgICAgICAgdGhpcy50ZXN0LnJlcG9ydEVycm9yKCdDYW1lcmEgZGVsaXZlcmluZyBsb3RzIG9mIGJsYWNrIGZyYW1lcy4nKTtcbiAgICAgIH1cbiAgICAgIGlmIChpbmZvLmZyb3plbkZyYW1lcyA+IGluZm8udGVzdGVkRnJhbWVzIC8gMykge1xuICAgICAgICB0aGlzLnRlc3QucmVwb3J0RXJyb3IoJ0NhbWVyYSBkZWxpdmVyaW5nIGxvdHMgb2YgZnJvemVuIGZyYW1lcy4nKTtcbiAgICAgIH1cbiAgICB9XG4gIH1cbn07XG5cbmV4cG9ydCBkZWZhdWx0IENhbVJlc29sdXRpb25zVGVzdDtcbiIsIid1c2Ugc3RyaWN0JztcblxuZnVuY3Rpb24gUnVuQ29ubmVjdGl2aXR5VGVzdCh0ZXN0LCBpY2VDYW5kaWRhdGVGaWx0ZXIpIHtcbiAgdGhpcy50ZXN0ID0gdGVzdDtcbiAgdGhpcy5pY2VDYW5kaWRhdGVGaWx0ZXIgPSBpY2VDYW5kaWRhdGVGaWx0ZXI7XG4gIHRoaXMudGltZW91dCA9IG51bGw7XG4gIHRoaXMucGFyc2VkQ2FuZGlkYXRlcyA9IFtdO1xuICB0aGlzLmNhbGwgPSBudWxsO1xufVxuXG5SdW5Db25uZWN0aXZpdHlUZXN0LnByb3RvdHlwZSA9IHtcbiAgcnVuOiBmdW5jdGlvbigpIHtcbiAgICBDYWxsLmFzeW5jQ3JlYXRlVHVybkNvbmZpZyh0aGlzLnN0YXJ0LmJpbmQodGhpcyksXG4gICAgICAgIHRoaXMudGVzdC5yZXBvcnRGYXRhbC5iaW5kKHRoaXMudGVzdCkpO1xuICB9LFxuXG4gIHN0YXJ0OiBmdW5jdGlvbihjb25maWcpIHtcbiAgICB0aGlzLmNhbGwgPSBuZXcgQ2FsbChjb25maWcsIHRoaXMudGVzdCk7XG4gICAgdGhpcy5jYWxsLnNldEljZUNhbmRpZGF0ZUZpbHRlcih0aGlzLmljZUNhbmRpZGF0ZUZpbHRlcik7XG5cbiAgICAvLyBDb2xsZWN0IGFsbCBjYW5kaWRhdGVzIGZvciB2YWxpZGF0aW9uLlxuICAgIHRoaXMuY2FsbC5wYzEuYWRkRXZlbnRMaXN0ZW5lcignaWNlY2FuZGlkYXRlJywgZnVuY3Rpb24oZXZlbnQpIHtcbiAgICAgIGlmIChldmVudC5jYW5kaWRhdGUpIHtcbiAgICAgICAgdmFyIHBhcnNlZENhbmRpZGF0ZSA9IENhbGwucGFyc2VDYW5kaWRhdGUoZXZlbnQuY2FuZGlkYXRlLmNhbmRpZGF0ZSk7XG4gICAgICAgIHRoaXMucGFyc2VkQ2FuZGlkYXRlcy5wdXNoKHBhcnNlZENhbmRpZGF0ZSk7XG5cbiAgICAgICAgLy8gUmVwb3J0IGNhbmRpZGF0ZSBpbmZvIGJhc2VkIG9uIGljZUNhbmRpZGF0ZUZpbHRlci5cbiAgICAgICAgaWYgKHRoaXMuaWNlQ2FuZGlkYXRlRmlsdGVyKHBhcnNlZENhbmRpZGF0ZSkpIHtcbiAgICAgICAgICB0aGlzLnRlc3QucmVwb3J0SW5mbyhcbiAgICAgICAgICAgICAgJ0dhdGhlcmVkIGNhbmRpZGF0ZSBvZiBUeXBlOiAnICsgcGFyc2VkQ2FuZGlkYXRlLnR5cGUgK1xuICAgICAgICAgICAgJyBQcm90b2NvbDogJyArIHBhcnNlZENhbmRpZGF0ZS5wcm90b2NvbCArXG4gICAgICAgICAgICAnIEFkZHJlc3M6ICcgKyBwYXJzZWRDYW5kaWRhdGUuYWRkcmVzcyk7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9LmJpbmQodGhpcykpO1xuXG4gICAgdmFyIGNoMSA9IHRoaXMuY2FsbC5wYzEuY3JlYXRlRGF0YUNoYW5uZWwobnVsbCk7XG4gICAgY2gxLmFkZEV2ZW50TGlzdGVuZXIoJ29wZW4nLCBmdW5jdGlvbigpIHtcbiAgICAgIGNoMS5zZW5kKCdoZWxsbycpO1xuICAgIH0pO1xuICAgIGNoMS5hZGRFdmVudExpc3RlbmVyKCdtZXNzYWdlJywgZnVuY3Rpb24oZXZlbnQpIHtcbiAgICAgIGlmIChldmVudC5kYXRhICE9PSAnd29ybGQnKSB7XG4gICAgICAgIHRoaXMudGVzdC5yZXBvcnRFcnJvcignSW52YWxpZCBkYXRhIHRyYW5zbWl0dGVkLicpO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgdGhpcy50ZXN0LnJlcG9ydFN1Y2Nlc3MoJ0RhdGEgc3VjY2Vzc2Z1bGx5IHRyYW5zbWl0dGVkIGJldHdlZW4gcGVlcnMuJyk7XG4gICAgICB9XG4gICAgICB0aGlzLmhhbmd1cCgpO1xuICAgIH0uYmluZCh0aGlzKSk7XG4gICAgdGhpcy5jYWxsLnBjMi5hZGRFdmVudExpc3RlbmVyKCdkYXRhY2hhbm5lbCcsIGZ1bmN0aW9uKGV2ZW50KSB7XG4gICAgICB2YXIgY2gyID0gZXZlbnQuY2hhbm5lbDtcbiAgICAgIGNoMi5hZGRFdmVudExpc3RlbmVyKCdtZXNzYWdlJywgZnVuY3Rpb24oZXZlbnQpIHtcbiAgICAgICAgaWYgKGV2ZW50LmRhdGEgIT09ICdoZWxsbycpIHtcbiAgICAgICAgICB0aGlzLmhhbmd1cCgnSW52YWxpZCBkYXRhIHRyYW5zbWl0dGVkLicpO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIGNoMi5zZW5kKCd3b3JsZCcpO1xuICAgICAgICB9XG4gICAgICB9LmJpbmQodGhpcykpO1xuICAgIH0uYmluZCh0aGlzKSk7XG4gICAgdGhpcy5jYWxsLmVzdGFibGlzaENvbm5lY3Rpb24oKTtcbiAgICB0aGlzLnRpbWVvdXQgPSBzZXRUaW1lb3V0KHRoaXMuaGFuZ3VwLmJpbmQodGhpcywgJ1RpbWVkIG91dCcpLCA1MDAwKTtcbiAgfSxcblxuICBmaW5kUGFyc2VkQ2FuZGlkYXRlT2ZTcGVjaWZpZWRUeXBlOiBmdW5jdGlvbihjYW5kaWRhdGVUeXBlTWV0aG9kKSB7XG4gICAgZm9yICh2YXIgY2FuZGlkYXRlIGluIHRoaXMucGFyc2VkQ2FuZGlkYXRlcykge1xuICAgICAgaWYgKGNhbmRpZGF0ZVR5cGVNZXRob2QodGhpcy5wYXJzZWRDYW5kaWRhdGVzW2NhbmRpZGF0ZV0pKSB7XG4gICAgICAgIHJldHVybiBjYW5kaWRhdGVUeXBlTWV0aG9kKHRoaXMucGFyc2VkQ2FuZGlkYXRlc1tjYW5kaWRhdGVdKTtcbiAgICAgIH1cbiAgICB9XG4gIH0sXG5cbiAgaGFuZ3VwOiBmdW5jdGlvbihlcnJvck1lc3NhZ2UpIHtcbiAgICBpZiAoZXJyb3JNZXNzYWdlKSB7XG4gICAgICAvLyBSZXBvcnQgd2FybmluZyBmb3Igc2VydmVyIHJlZmxleGl2ZSB0ZXN0IGlmIGl0IHRpbWVzIG91dC5cbiAgICAgIGlmIChlcnJvck1lc3NhZ2UgPT09ICdUaW1lZCBvdXQnICYmXG4gICAgICAgICAgdGhpcy5pY2VDYW5kaWRhdGVGaWx0ZXIudG9TdHJpbmcoKSA9PT0gQ2FsbC5pc1JlZmxleGl2ZS50b1N0cmluZygpICYmXG4gICAgICAgICAgdGhpcy5maW5kUGFyc2VkQ2FuZGlkYXRlT2ZTcGVjaWZpZWRUeXBlKENhbGwuaXNSZWZsZXhpdmUpKSB7XG4gICAgICAgIHRoaXMudGVzdC5yZXBvcnRXYXJuaW5nKCdDb3VsZCBub3QgY29ubmVjdCB1c2luZyByZWZsZXhpdmUgJyArXG4gICAgICAgICAgICAnY2FuZGlkYXRlcywgbGlrZWx5IGR1ZSB0byB0aGUgbmV0d29yayBlbnZpcm9ubWVudC9jb25maWd1cmF0aW9uLicpO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgdGhpcy50ZXN0LnJlcG9ydEVycm9yKGVycm9yTWVzc2FnZSk7XG4gICAgICB9XG4gICAgfVxuICAgIGNsZWFyVGltZW91dCh0aGlzLnRpbWVvdXQpO1xuICAgIHRoaXMuY2FsbC5jbG9zZSgpO1xuICAgIHRoaXMudGVzdC5kb25lKCk7XG4gIH1cbn07XG5cbmV4cG9ydCBkZWZhdWx0IFJ1bkNvbm5lY3Rpdml0eVRlc3Q7XG4iLCIndXNlIHN0cmljdCc7XG5cbmZ1bmN0aW9uIERhdGFDaGFubmVsVGhyb3VnaHB1dFRlc3QodGVzdCkge1xuICB0aGlzLnRlc3QgPSB0ZXN0O1xuICB0aGlzLnRlc3REdXJhdGlvblNlY29uZHMgPSA1LjA7XG4gIHRoaXMuc3RhcnRUaW1lID0gbnVsbDtcbiAgdGhpcy5zZW50UGF5bG9hZEJ5dGVzID0gMDtcbiAgdGhpcy5yZWNlaXZlZFBheWxvYWRCeXRlcyA9IDA7XG4gIHRoaXMuc3RvcFNlbmRpbmcgPSBmYWxzZTtcbiAgdGhpcy5zYW1wbGVQYWNrZXQgPSAnJztcblxuICBmb3IgKHZhciBpID0gMDsgaSAhPT0gMTAyNDsgKytpKSB7XG4gICAgdGhpcy5zYW1wbGVQYWNrZXQgKz0gJ2gnO1xuICB9XG5cbiAgdGhpcy5tYXhOdW1iZXJPZlBhY2tldHNUb1NlbmQgPSAxO1xuICB0aGlzLmJ5dGVzVG9LZWVwQnVmZmVyZWQgPSAxMDI0ICogdGhpcy5tYXhOdW1iZXJPZlBhY2tldHNUb1NlbmQ7XG4gIHRoaXMubGFzdEJpdHJhdGVNZWFzdXJlVGltZSA9IG51bGw7XG4gIHRoaXMubGFzdFJlY2VpdmVkUGF5bG9hZEJ5dGVzID0gMDtcblxuICB0aGlzLmNhbGwgPSBudWxsO1xuICB0aGlzLnNlbmRlckNoYW5uZWwgPSBudWxsO1xuICB0aGlzLnJlY2VpdmVDaGFubmVsID0gbnVsbDtcbn1cblxuRGF0YUNoYW5uZWxUaHJvdWdocHV0VGVzdC5wcm90b3R5cGUgPSB7XG4gIHJ1bjogZnVuY3Rpb24oKSB7XG4gICAgQ2FsbC5hc3luY0NyZWF0ZVR1cm5Db25maWcodGhpcy5zdGFydC5iaW5kKHRoaXMpLFxuICAgICAgICB0aGlzLnRlc3QucmVwb3J0RmF0YWwuYmluZCh0aGlzLnRlc3QpKTtcbiAgfSxcblxuICBzdGFydDogZnVuY3Rpb24oY29uZmlnKSB7XG4gICAgdGhpcy5jYWxsID0gbmV3IENhbGwoY29uZmlnLCB0aGlzLnRlc3QpO1xuICAgIHRoaXMuY2FsbC5zZXRJY2VDYW5kaWRhdGVGaWx0ZXIoQ2FsbC5pc1JlbGF5KTtcbiAgICB0aGlzLnNlbmRlckNoYW5uZWwgPSB0aGlzLmNhbGwucGMxLmNyZWF0ZURhdGFDaGFubmVsKG51bGwpO1xuICAgIHRoaXMuc2VuZGVyQ2hhbm5lbC5hZGRFdmVudExpc3RlbmVyKCdvcGVuJywgdGhpcy5zZW5kaW5nU3RlcC5iaW5kKHRoaXMpKTtcblxuICAgIHRoaXMuY2FsbC5wYzIuYWRkRXZlbnRMaXN0ZW5lcignZGF0YWNoYW5uZWwnLFxuICAgICAgICB0aGlzLm9uUmVjZWl2ZXJDaGFubmVsLmJpbmQodGhpcykpO1xuXG4gICAgdGhpcy5jYWxsLmVzdGFibGlzaENvbm5lY3Rpb24oKTtcbiAgfSxcblxuICBvblJlY2VpdmVyQ2hhbm5lbDogZnVuY3Rpb24oZXZlbnQpIHtcbiAgICB0aGlzLnJlY2VpdmVDaGFubmVsID0gZXZlbnQuY2hhbm5lbDtcbiAgICB0aGlzLnJlY2VpdmVDaGFubmVsLmFkZEV2ZW50TGlzdGVuZXIoJ21lc3NhZ2UnLFxuICAgICAgICB0aGlzLm9uTWVzc2FnZVJlY2VpdmVkLmJpbmQodGhpcykpO1xuICB9LFxuXG4gIHNlbmRpbmdTdGVwOiBmdW5jdGlvbigpIHtcbiAgICB2YXIgbm93ID0gbmV3IERhdGUoKTtcbiAgICBpZiAoIXRoaXMuc3RhcnRUaW1lKSB7XG4gICAgICB0aGlzLnN0YXJ0VGltZSA9IG5vdztcbiAgICAgIHRoaXMubGFzdEJpdHJhdGVNZWFzdXJlVGltZSA9IG5vdztcbiAgICB9XG5cbiAgICBmb3IgKHZhciBpID0gMDsgaSAhPT0gdGhpcy5tYXhOdW1iZXJPZlBhY2tldHNUb1NlbmQ7ICsraSkge1xuICAgICAgaWYgKHRoaXMuc2VuZGVyQ2hhbm5lbC5idWZmZXJlZEFtb3VudCA+PSB0aGlzLmJ5dGVzVG9LZWVwQnVmZmVyZWQpIHtcbiAgICAgICAgYnJlYWs7XG4gICAgICB9XG4gICAgICB0aGlzLnNlbnRQYXlsb2FkQnl0ZXMgKz0gdGhpcy5zYW1wbGVQYWNrZXQubGVuZ3RoO1xuICAgICAgdGhpcy5zZW5kZXJDaGFubmVsLnNlbmQodGhpcy5zYW1wbGVQYWNrZXQpO1xuICAgIH1cblxuICAgIGlmIChub3cgLSB0aGlzLnN0YXJ0VGltZSA+PSAxMDAwICogdGhpcy50ZXN0RHVyYXRpb25TZWNvbmRzKSB7XG4gICAgICB0aGlzLnRlc3Quc2V0UHJvZ3Jlc3MoMTAwKTtcbiAgICAgIHRoaXMuc3RvcFNlbmRpbmcgPSB0cnVlO1xuICAgIH0gZWxzZSB7XG4gICAgICB0aGlzLnRlc3Quc2V0UHJvZ3Jlc3MoKG5vdyAtIHRoaXMuc3RhcnRUaW1lKSAvXG4gICAgICAgICAgKDEwICogdGhpcy50ZXN0RHVyYXRpb25TZWNvbmRzKSk7XG4gICAgICBzZXRUaW1lb3V0KHRoaXMuc2VuZGluZ1N0ZXAuYmluZCh0aGlzKSwgMSk7XG4gICAgfVxuICB9LFxuXG4gIG9uTWVzc2FnZVJlY2VpdmVkOiBmdW5jdGlvbihldmVudCkge1xuICAgIHRoaXMucmVjZWl2ZWRQYXlsb2FkQnl0ZXMgKz0gZXZlbnQuZGF0YS5sZW5ndGg7XG4gICAgdmFyIG5vdyA9IG5ldyBEYXRlKCk7XG4gICAgaWYgKG5vdyAtIHRoaXMubGFzdEJpdHJhdGVNZWFzdXJlVGltZSA+PSAxMDAwKSB7XG4gICAgICB2YXIgYml0cmF0ZSA9ICh0aGlzLnJlY2VpdmVkUGF5bG9hZEJ5dGVzIC1cbiAgICAgICAgICB0aGlzLmxhc3RSZWNlaXZlZFBheWxvYWRCeXRlcykgLyAobm93IC0gdGhpcy5sYXN0Qml0cmF0ZU1lYXN1cmVUaW1lKTtcbiAgICAgIGJpdHJhdGUgPSBNYXRoLnJvdW5kKGJpdHJhdGUgKiAxMDAwICogOCkgLyAxMDAwO1xuICAgICAgdGhpcy50ZXN0LnJlcG9ydFN1Y2Nlc3MoJ1RyYW5zbWl0dGluZyBhdCAnICsgYml0cmF0ZSArICcga2Jwcy4nKTtcbiAgICAgIHRoaXMubGFzdFJlY2VpdmVkUGF5bG9hZEJ5dGVzID0gdGhpcy5yZWNlaXZlZFBheWxvYWRCeXRlcztcbiAgICAgIHRoaXMubGFzdEJpdHJhdGVNZWFzdXJlVGltZSA9IG5vdztcbiAgICB9XG4gICAgaWYgKHRoaXMuc3RvcFNlbmRpbmcgJiZcbiAgICAgICAgdGhpcy5zZW50UGF5bG9hZEJ5dGVzID09PSB0aGlzLnJlY2VpdmVkUGF5bG9hZEJ5dGVzKSB7XG4gICAgICB0aGlzLmNhbGwuY2xvc2UoKTtcbiAgICAgIHRoaXMuY2FsbCA9IG51bGw7XG5cbiAgICAgIHZhciBlbGFwc2VkVGltZSA9IE1hdGgucm91bmQoKG5vdyAtIHRoaXMuc3RhcnRUaW1lKSAqIDEwKSAvIDEwMDAwLjA7XG4gICAgICB2YXIgcmVjZWl2ZWRLQml0cyA9IHRoaXMucmVjZWl2ZWRQYXlsb2FkQnl0ZXMgKiA4IC8gMTAwMDtcbiAgICAgIHRoaXMudGVzdC5yZXBvcnRTdWNjZXNzKCdUb3RhbCB0cmFuc21pdHRlZDogJyArIHJlY2VpdmVkS0JpdHMgK1xuICAgICAgICAgICcga2lsby1iaXRzIGluICcgKyBlbGFwc2VkVGltZSArICcgc2Vjb25kcy4nKTtcbiAgICAgIHRoaXMudGVzdC5kb25lKCk7XG4gICAgfVxuICB9XG59O1xuXG5leHBvcnQgZGVmYXVsdCBEYXRhQ2hhbm5lbFRocm91Z2hwdXRUZXN0O1xuIiwiJ3VzZSBzdHJpY3QnO1xuXG5mdW5jdGlvbiBNaWNUZXN0KHRlc3QpIHtcbiAgdGhpcy50ZXN0ID0gdGVzdDtcbiAgdGhpcy5pbnB1dENoYW5uZWxDb3VudCA9IDY7XG4gIHRoaXMub3V0cHV0Q2hhbm5lbENvdW50ID0gMjtcbiAgLy8gQnVmZmVyIHNpemUgc2V0IHRvIDAgdG8gbGV0IENocm9tZSBjaG9vc2UgYmFzZWQgb24gdGhlIHBsYXRmb3JtLlxuICB0aGlzLmJ1ZmZlclNpemUgPSAwO1xuICAvLyBUdXJuaW5nIG9mZiBlY2hvQ2FuY2VsbGF0aW9uIGNvbnN0cmFpbnQgZW5hYmxlcyBzdGVyZW8gaW5wdXQuXG4gIHRoaXMuY29uc3RyYWludHMgPSB7XG4gICAgYXVkaW86IHtcbiAgICAgIG9wdGlvbmFsOiBbXG4gICAgICAgIHtlY2hvQ2FuY2VsbGF0aW9uOiBmYWxzZX1cbiAgICAgIF1cbiAgICB9XG4gIH07XG5cbiAgdGhpcy5jb2xsZWN0U2Vjb25kcyA9IDIuMDtcbiAgLy8gQXQgbGVhc3Qgb25lIExTQiAxNi1iaXQgZGF0YSAoY29tcGFyZSBpcyBvbiBhYnNvbHV0ZSB2YWx1ZSkuXG4gIHRoaXMuc2lsZW50VGhyZXNob2xkID0gMS4wIC8gMzI3Njc7XG4gIHRoaXMubG93Vm9sdW1lVGhyZXNob2xkID0gLTYwO1xuICAvLyBEYXRhIG11c3QgYmUgaWRlbnRpY2FsIHdpdGhpbiBvbmUgTFNCIDE2LWJpdCB0byBiZSBpZGVudGlmaWVkIGFzIG1vbm8uXG4gIHRoaXMubW9ub0RldGVjdFRocmVzaG9sZCA9IDEuMCAvIDY1NTM2O1xuICAvLyBOdW1iZXIgb2YgY29uc2VxdXRpdmUgY2xpcFRocmVzaG9sZCBsZXZlbCBzYW1wbGVzIHRoYXQgaW5kaWNhdGUgY2xpcHBpbmcuXG4gIHRoaXMuY2xpcENvdW50VGhyZXNob2xkID0gNjtcbiAgdGhpcy5jbGlwVGhyZXNob2xkID0gMS4wO1xuXG4gIC8vIFBvcHVsYXRlZCB3aXRoIGF1ZGlvIGFzIGEgMy1kaW1lbnNpb25hbCBhcnJheTpcbiAgLy8gICBjb2xsZWN0ZWRBdWRpb1tjaGFubmVsc11bYnVmZmVyc11bc2FtcGxlc11cbiAgdGhpcy5jb2xsZWN0ZWRBdWRpbyA9IFtdO1xuICB0aGlzLmNvbGxlY3RlZFNhbXBsZUNvdW50ID0gMDtcbiAgZm9yICh2YXIgaSA9IDA7IGkgPCB0aGlzLmlucHV0Q2hhbm5lbENvdW50OyArK2kpIHtcbiAgICB0aGlzLmNvbGxlY3RlZEF1ZGlvW2ldID0gW107XG4gIH1cbn1cblxuTWljVGVzdC5wcm90b3R5cGUgPSB7XG4gIHJ1bjogZnVuY3Rpb24oKSB7XG4gICAgaWYgKHR5cGVvZiBhdWRpb0NvbnRleHQgPT09ICd1bmRlZmluZWQnKSB7XG4gICAgICB0aGlzLnRlc3QucmVwb3J0RXJyb3IoJ1dlYkF1ZGlvIGlzIG5vdCBzdXBwb3J0ZWQsIHRlc3QgY2Fubm90IHJ1bi4nKTtcbiAgICAgIHRoaXMudGVzdC5kb25lKCk7XG4gICAgfSBlbHNlIHtcbiAgICAgIGRvR2V0VXNlck1lZGlhKHRoaXMuY29uc3RyYWludHMsIHRoaXMuZ290U3RyZWFtLmJpbmQodGhpcykpO1xuICAgIH1cbiAgfSxcblxuICBnb3RTdHJlYW06IGZ1bmN0aW9uKHN0cmVhbSkge1xuICAgIGlmICghdGhpcy5jaGVja0F1ZGlvVHJhY2tzKHN0cmVhbSkpIHtcbiAgICAgIHRoaXMudGVzdC5kb25lKCk7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIHRoaXMuY3JlYXRlQXVkaW9CdWZmZXIoc3RyZWFtKTtcbiAgfSxcblxuICBjaGVja0F1ZGlvVHJhY2tzOiBmdW5jdGlvbihzdHJlYW0pIHtcbiAgICB0aGlzLnN0cmVhbSA9IHN0cmVhbTtcbiAgICB2YXIgYXVkaW9UcmFja3MgPSBzdHJlYW0uZ2V0QXVkaW9UcmFja3MoKTtcbiAgICBpZiAoYXVkaW9UcmFja3MubGVuZ3RoIDwgMSkge1xuICAgICAgdGhpcy50ZXN0LnJlcG9ydEVycm9yKCdObyBhdWRpbyB0cmFjayBpbiByZXR1cm5lZCBzdHJlYW0uJyk7XG4gICAgICByZXR1cm4gZmFsc2U7XG4gICAgfVxuICAgIHRoaXMudGVzdC5yZXBvcnRTdWNjZXNzKCdBdWRpbyB0cmFjayBjcmVhdGVkIHVzaW5nIGRldmljZT0nICtcbiAgICAgICAgYXVkaW9UcmFja3NbMF0ubGFiZWwpO1xuICAgIHJldHVybiB0cnVlO1xuICB9LFxuXG4gIGNyZWF0ZUF1ZGlvQnVmZmVyOiBmdW5jdGlvbigpIHtcbiAgICB0aGlzLmF1ZGlvU291cmNlID0gYXVkaW9Db250ZXh0LmNyZWF0ZU1lZGlhU3RyZWFtU291cmNlKHRoaXMuc3RyZWFtKTtcbiAgICB0aGlzLnNjcmlwdE5vZGUgPSBhdWRpb0NvbnRleHQuY3JlYXRlU2NyaXB0UHJvY2Vzc29yKHRoaXMuYnVmZmVyU2l6ZSxcbiAgICAgICAgdGhpcy5pbnB1dENoYW5uZWxDb3VudCwgdGhpcy5vdXRwdXRDaGFubmVsQ291bnQpO1xuICAgIHRoaXMuYXVkaW9Tb3VyY2UuY29ubmVjdCh0aGlzLnNjcmlwdE5vZGUpO1xuICAgIHRoaXMuc2NyaXB0Tm9kZS5jb25uZWN0KGF1ZGlvQ29udGV4dC5kZXN0aW5hdGlvbik7XG4gICAgdGhpcy5zY3JpcHROb2RlLm9uYXVkaW9wcm9jZXNzID0gdGhpcy5jb2xsZWN0QXVkaW8uYmluZCh0aGlzKTtcbiAgICB0aGlzLnN0b3BDb2xsZWN0aW5nQXVkaW8gPSBzZXRUaW1lb3V0V2l0aFByb2dyZXNzQmFyKFxuICAgICAgICB0aGlzLm9uU3RvcENvbGxlY3RpbmdBdWRpby5iaW5kKHRoaXMpLCA1MDAwKTtcbiAgfSxcblxuICBjb2xsZWN0QXVkaW86IGZ1bmN0aW9uKGV2ZW50KSB7XG4gICAgLy8gU2ltcGxlIHNpbGVuY2UgZGV0ZWN0aW9uOiBjaGVjayBmaXJzdCBhbmQgbGFzdCBzYW1wbGUgb2YgZWFjaCBjaGFubmVsIGluXG4gICAgLy8gdGhlIGJ1ZmZlci4gSWYgYm90aCBhcmUgYmVsb3cgYSB0aHJlc2hvbGQsIHRoZSBidWZmZXIgaXMgY29uc2lkZXJlZFxuICAgIC8vIHNpbGVudC5cbiAgICB2YXIgc2FtcGxlQ291bnQgPSBldmVudC5pbnB1dEJ1ZmZlci5sZW5ndGg7XG4gICAgdmFyIGFsbFNpbGVudCA9IHRydWU7XG4gICAgZm9yICh2YXIgYyA9IDA7IGMgPCBldmVudC5pbnB1dEJ1ZmZlci5udW1iZXJPZkNoYW5uZWxzOyBjKyspIHtcbiAgICAgIHZhciBkYXRhID0gZXZlbnQuaW5wdXRCdWZmZXIuZ2V0Q2hhbm5lbERhdGEoYyk7XG4gICAgICB2YXIgZmlyc3QgPSBNYXRoLmFicyhkYXRhWzBdKTtcbiAgICAgIHZhciBsYXN0ID0gTWF0aC5hYnMoZGF0YVtzYW1wbGVDb3VudCAtIDFdKTtcbiAgICAgIHZhciBuZXdCdWZmZXI7XG4gICAgICBpZiAoZmlyc3QgPiB0aGlzLnNpbGVudFRocmVzaG9sZCB8fCBsYXN0ID4gdGhpcy5zaWxlbnRUaHJlc2hvbGQpIHtcbiAgICAgICAgLy8gTm9uLXNpbGVudCBidWZmZXJzIGFyZSBjb3BpZWQgZm9yIGFuYWx5c2lzLiBOb3RlIHRoYXQgdGhlIHNpbGVudFxuICAgICAgICAvLyBkZXRlY3Rpb24gd2lsbCBsaWtlbHkgY2F1c2UgdGhlIHN0b3JlZCBzdHJlYW0gdG8gY29udGFpbiBkaXNjb250aW51LVxuICAgICAgICAvLyBpdGllcywgYnV0IHRoYXQgaXMgb2sgZm9yIG91ciBuZWVkcyBoZXJlIChqdXN0IGxvb2tpbmcgYXQgbGV2ZWxzKS5cbiAgICAgICAgbmV3QnVmZmVyID0gbmV3IEZsb2F0MzJBcnJheShzYW1wbGVDb3VudCk7XG4gICAgICAgIG5ld0J1ZmZlci5zZXQoZGF0YSk7XG4gICAgICAgIGFsbFNpbGVudCA9IGZhbHNlO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgLy8gU2lsZW50IGJ1ZmZlcnMgYXJlIG5vdCBjb3BpZWQsIGJ1dCB3ZSBzdG9yZSBlbXB0eSBidWZmZXJzIHNvIHRoYXQgdGhlXG4gICAgICAgIC8vIGFuYWx5c2lzIGRvZXNuJ3QgaGF2ZSB0byBjYXJlLlxuICAgICAgICBuZXdCdWZmZXIgPSBuZXcgRmxvYXQzMkFycmF5KCk7XG4gICAgICB9XG4gICAgICB0aGlzLmNvbGxlY3RlZEF1ZGlvW2NdLnB1c2gobmV3QnVmZmVyKTtcbiAgICB9XG4gICAgaWYgKCFhbGxTaWxlbnQpIHtcbiAgICAgIHRoaXMuY29sbGVjdGVkU2FtcGxlQ291bnQgKz0gc2FtcGxlQ291bnQ7XG4gICAgICBpZiAoKHRoaXMuY29sbGVjdGVkU2FtcGxlQ291bnQgLyBldmVudC5pbnB1dEJ1ZmZlci5zYW1wbGVSYXRlKSA+PVxuICAgICAgICAgIHRoaXMuY29sbGVjdFNlY29uZHMpIHtcbiAgICAgICAgdGhpcy5zdG9wQ29sbGVjdGluZ0F1ZGlvKCk7XG4gICAgICB9XG4gICAgfVxuICB9LFxuXG4gIG9uU3RvcENvbGxlY3RpbmdBdWRpbzogZnVuY3Rpb24oKSB7XG4gICAgdGhpcy5zdHJlYW0uZ2V0QXVkaW9UcmFja3MoKVswXS5zdG9wKCk7XG4gICAgdGhpcy5hdWRpb1NvdXJjZS5kaXNjb25uZWN0KHRoaXMuc2NyaXB0Tm9kZSk7XG4gICAgdGhpcy5zY3JpcHROb2RlLmRpc2Nvbm5lY3QoYXVkaW9Db250ZXh0LmRlc3RpbmF0aW9uKTtcbiAgICB0aGlzLmFuYWx5emVBdWRpbyh0aGlzLmNvbGxlY3RlZEF1ZGlvKTtcbiAgICB0aGlzLnRlc3QuZG9uZSgpO1xuICB9LFxuXG4gIGFuYWx5emVBdWRpbzogZnVuY3Rpb24oY2hhbm5lbHMpIHtcbiAgICB2YXIgYWN0aXZlQ2hhbm5lbHMgPSBbXTtcbiAgICBmb3IgKHZhciBjID0gMDsgYyA8IGNoYW5uZWxzLmxlbmd0aDsgYysrKSB7XG4gICAgICBpZiAodGhpcy5jaGFubmVsU3RhdHMoYywgY2hhbm5lbHNbY10pKSB7XG4gICAgICAgIGFjdGl2ZUNoYW5uZWxzLnB1c2goYyk7XG4gICAgICB9XG4gICAgfVxuICAgIGlmIChhY3RpdmVDaGFubmVscy5sZW5ndGggPT09IDApIHtcbiAgICAgIHRoaXMudGVzdC5yZXBvcnRFcnJvcignTm8gYWN0aXZlIGlucHV0IGNoYW5uZWxzIGRldGVjdGVkLiBNaWNyb3Bob25lICcgK1xuICAgICAgICAgICdpcyBtb3N0IGxpa2VseSBtdXRlZCBvciBicm9rZW4sIHBsZWFzZSBjaGVjayBpZiBtdXRlZCBpbiB0aGUgJyArXG4gICAgICAgICAgJ3NvdW5kIHNldHRpbmdzIG9yIHBoeXNpY2FsbHkgb24gdGhlIGRldmljZS4gVGhlbiByZXJ1biB0aGUgdGVzdC4nKTtcbiAgICB9IGVsc2Uge1xuICAgICAgdGhpcy50ZXN0LnJlcG9ydFN1Y2Nlc3MoJ0FjdGl2ZSBhdWRpbyBpbnB1dCBjaGFubmVsczogJyArXG4gICAgICAgICAgYWN0aXZlQ2hhbm5lbHMubGVuZ3RoKTtcbiAgICB9XG4gICAgaWYgKGFjdGl2ZUNoYW5uZWxzLmxlbmd0aCA9PT0gMikge1xuICAgICAgdGhpcy5kZXRlY3RNb25vKGNoYW5uZWxzW2FjdGl2ZUNoYW5uZWxzWzBdXSwgY2hhbm5lbHNbYWN0aXZlQ2hhbm5lbHNbMV1dKTtcbiAgICB9XG4gIH0sXG5cbiAgY2hhbm5lbFN0YXRzOiBmdW5jdGlvbihjaGFubmVsTnVtYmVyLCBidWZmZXJzKSB7XG4gICAgdmFyIG1heFBlYWsgPSAwLjA7XG4gICAgdmFyIG1heFJtcyA9IDAuMDtcbiAgICB2YXIgY2xpcENvdW50ID0gMDtcbiAgICB2YXIgbWF4Q2xpcENvdW50ID0gMDtcbiAgICBmb3IgKHZhciBqID0gMDsgaiA8IGJ1ZmZlcnMubGVuZ3RoOyBqKyspIHtcbiAgICAgIHZhciBzYW1wbGVzID0gYnVmZmVyc1tqXTtcbiAgICAgIGlmIChzYW1wbGVzLmxlbmd0aCA+IDApIHtcbiAgICAgICAgdmFyIHMgPSAwO1xuICAgICAgICB2YXIgcm1zID0gMC4wO1xuICAgICAgICBmb3IgKHZhciBpID0gMDsgaSA8IHNhbXBsZXMubGVuZ3RoOyBpKyspIHtcbiAgICAgICAgICBzID0gTWF0aC5hYnMoc2FtcGxlc1tpXSk7XG4gICAgICAgICAgbWF4UGVhayA9IE1hdGgubWF4KG1heFBlYWssIHMpO1xuICAgICAgICAgIHJtcyArPSBzICogcztcbiAgICAgICAgICBpZiAobWF4UGVhayA+PSB0aGlzLmNsaXBUaHJlc2hvbGQpIHtcbiAgICAgICAgICAgIGNsaXBDb3VudCsrO1xuICAgICAgICAgICAgbWF4Q2xpcENvdW50ID0gTWF0aC5tYXgobWF4Q2xpcENvdW50LCBjbGlwQ291bnQpO1xuICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBjbGlwQ291bnQgPSAwO1xuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgICAvLyBSTVMgaXMgY2FsY3VsYXRlZCBvdmVyIGVhY2ggYnVmZmVyLCBtZWFuaW5nIHRoZSBpbnRlZ3JhdGlvbiB0aW1lIHdpbGxcbiAgICAgICAgLy8gYmUgZGlmZmVyZW50IGRlcGVuZGluZyBvbiBzYW1wbGUgcmF0ZSBhbmQgYnVmZmVyIHNpemUuIEluIHByYWN0aXNlXG4gICAgICAgIC8vIHRoaXMgc2hvdWxkIGJlIGEgc21hbGwgcHJvYmxlbS5cbiAgICAgICAgcm1zID0gTWF0aC5zcXJ0KHJtcyAvIHNhbXBsZXMubGVuZ3RoKTtcbiAgICAgICAgbWF4Um1zID0gTWF0aC5tYXgobWF4Um1zLCBybXMpO1xuICAgICAgfVxuICAgIH1cblxuICAgIGlmIChtYXhQZWFrID4gdGhpcy5zaWxlbnRUaHJlc2hvbGQpIHtcbiAgICAgIHZhciBkQlBlYWsgPSB0aGlzLmRCRlMobWF4UGVhayk7XG4gICAgICB2YXIgZEJSbXMgPSB0aGlzLmRCRlMobWF4Um1zKTtcbiAgICAgIHRoaXMudGVzdC5yZXBvcnRJbmZvKCdDaGFubmVsICcgKyBjaGFubmVsTnVtYmVyICsgJyBsZXZlbHM6ICcgK1xuICAgICAgICAgIGRCUGVhay50b0ZpeGVkKDEpICsgJyBkQiAocGVhayksICcgKyBkQlJtcy50b0ZpeGVkKDEpICsgJyBkQiAoUk1TKScpO1xuICAgICAgaWYgKGRCUm1zIDwgdGhpcy5sb3dWb2x1bWVUaHJlc2hvbGQpIHtcbiAgICAgICAgdGhpcy50ZXN0LnJlcG9ydEVycm9yKCdNaWNyb3Bob25lIGlucHV0IGxldmVsIGlzIGxvdywgaW5jcmVhc2UgaW5wdXQgJyArXG4gICAgICAgICAgICAndm9sdW1lIG9yIG1vdmUgY2xvc2VyIHRvIHRoZSBtaWNyb3Bob25lLicpO1xuICAgICAgfVxuICAgICAgaWYgKG1heENsaXBDb3VudCA+IHRoaXMuY2xpcENvdW50VGhyZXNob2xkKSB7XG4gICAgICAgIHRoaXMudGVzdC5yZXBvcnRXYXJuaW5nKCdDbGlwcGluZyBkZXRlY3RlZCEgTWljcm9waG9uZSBpbnB1dCBsZXZlbCAnICtcbiAgICAgICAgICAgICdpcyBoaWdoLiBEZWNyZWFzZSBpbnB1dCB2b2x1bWUgb3IgbW92ZSBhd2F5IGZyb20gdGhlIG1pY3JvcGhvbmUuJyk7XG4gICAgICB9XG4gICAgICByZXR1cm4gdHJ1ZTtcbiAgICB9XG4gICAgcmV0dXJuIGZhbHNlO1xuICB9LFxuXG4gIGRldGVjdE1vbm86IGZ1bmN0aW9uKGJ1ZmZlcnNMLCBidWZmZXJzUikge1xuICAgIHZhciBkaWZmU2FtcGxlcyA9IDA7XG4gICAgZm9yICh2YXIgaiA9IDA7IGogPCBidWZmZXJzTC5sZW5ndGg7IGorKykge1xuICAgICAgdmFyIGwgPSBidWZmZXJzTFtqXTtcbiAgICAgIHZhciByID0gYnVmZmVyc1Jbal07XG4gICAgICBpZiAobC5sZW5ndGggPT09IHIubGVuZ3RoKSB7XG4gICAgICAgIHZhciBkID0gMC4wO1xuICAgICAgICBmb3IgKHZhciBpID0gMDsgaSA8IGwubGVuZ3RoOyBpKyspIHtcbiAgICAgICAgICBkID0gTWF0aC5hYnMobFtpXSAtIHJbaV0pO1xuICAgICAgICAgIGlmIChkID4gdGhpcy5tb25vRGV0ZWN0VGhyZXNob2xkKSB7XG4gICAgICAgICAgICBkaWZmU2FtcGxlcysrO1xuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgZGlmZlNhbXBsZXMrKztcbiAgICAgIH1cbiAgICB9XG4gICAgaWYgKGRpZmZTYW1wbGVzID4gMCkge1xuICAgICAgdGhpcy50ZXN0LnJlcG9ydEluZm8oJ1N0ZXJlbyBtaWNyb3Bob25lIGRldGVjdGVkLicpO1xuICAgIH0gZWxzZSB7XG4gICAgICB0aGlzLnRlc3QucmVwb3J0SW5mbygnTW9ubyBtaWNyb3Bob25lIGRldGVjdGVkLicpO1xuICAgIH1cbiAgfSxcblxuICBkQkZTOiBmdW5jdGlvbihnYWluKSB7XG4gICAgdmFyIGRCID0gMjAgKiBNYXRoLmxvZyhnYWluKSAvIE1hdGgubG9nKDEwKTtcbiAgICAvLyBVc2UgTWF0aC5yb3VuZCB0byBkaXNwbGF5IHVwIHRvIG9uZSBkZWNpbWFsIHBsYWNlLlxuICAgIHJldHVybiBNYXRoLnJvdW5kKGRCICogMTApIC8gMTA7XG4gIH0sXG59O1xuXG5leHBvcnQgZGVmYXVsdCBNaWNUZXN0O1xuIiwiJ3VzZSBzdHJpY3QnO1xuXG52YXIgTmV0d29ya1Rlc3QgPSBmdW5jdGlvbih0ZXN0LCBwcm90b2NvbCwgcGFyYW1zLCBpY2VDYW5kaWRhdGVGaWx0ZXIpIHtcbiAgdGhpcy50ZXN0ID0gdGVzdDtcbiAgdGhpcy5wcm90b2NvbCA9IHByb3RvY29sO1xuICB0aGlzLnBhcmFtcyA9IHBhcmFtcztcbiAgdGhpcy5pY2VDYW5kaWRhdGVGaWx0ZXIgPSBpY2VDYW5kaWRhdGVGaWx0ZXI7XG59O1xuXG5OZXR3b3JrVGVzdC5wcm90b3R5cGUgPSB7XG4gIHJ1bjogZnVuY3Rpb24oKSB7XG4gICAgLy8gRG8gbm90IGNyZWF0ZSB0dXJuIGNvbmZpZyBmb3IgSVBWNiB0ZXN0LlxuICAgIGlmICh0aGlzLmljZUNhbmRpZGF0ZUZpbHRlci50b1N0cmluZygpID09PSBDYWxsLmlzSXB2Ni50b1N0cmluZygpKSB7XG4gICAgICB0aGlzLmdhdGhlckNhbmRpZGF0ZXMobnVsbCwgdGhpcy5wYXJhbXMsIHRoaXMuaWNlQ2FuZGlkYXRlRmlsdGVyKTtcbiAgICB9IGVsc2Uge1xuICAgICAgQ2FsbC5hc3luY0NyZWF0ZVR1cm5Db25maWcodGhpcy5zdGFydC5iaW5kKHRoaXMpLFxuICAgICAgICAgIHRoaXMudGVzdC5yZXBvcnRGYXRhbC5iaW5kKHRoaXMudGVzdCkpO1xuICAgIH1cbiAgfSxcblxuICBzdGFydDogZnVuY3Rpb24oY29uZmlnKSB7XG4gICAgdGhpcy5maWx0ZXJDb25maWcoY29uZmlnLCB0aGlzLnByb3RvY29sKTtcbiAgICB0aGlzLmdhdGhlckNhbmRpZGF0ZXMoY29uZmlnLCB0aGlzLnBhcmFtcywgdGhpcy5pY2VDYW5kaWRhdGVGaWx0ZXIpO1xuICB9LFxuXG4gIC8vIEZpbHRlciB0aGUgUlRDQ29uZmlndXJhdGlvbiB8Y29uZmlnfCB0byBvbmx5IGNvbnRhaW4gVVJMcyB3aXRoIHRoZVxuICAvLyBzcGVjaWZpZWQgdHJhbnNwb3J0IHByb3RvY29sIHxwcm90b2NvbHwuIElmIG5vIHR1cm4gdHJhbnNwb3J0IGlzXG4gIC8vIHNwZWNpZmllZCBpdCBpcyBhZGRlZCB3aXRoIHRoZSByZXF1ZXN0ZWQgcHJvdG9jb2wuXG4gIGZpbHRlckNvbmZpZzogZnVuY3Rpb24oY29uZmlnLCBwcm90b2NvbCkge1xuICAgIHZhciB0cmFuc3BvcnQgPSAndHJhbnNwb3J0PScgKyBwcm90b2NvbDtcbiAgICB2YXIgbmV3SWNlU2VydmVycyA9IFtdO1xuICAgIGZvciAodmFyIGkgPSAwOyBpIDwgY29uZmlnLmljZVNlcnZlcnMubGVuZ3RoOyArK2kpIHtcbiAgICAgIHZhciBpY2VTZXJ2ZXIgPSBjb25maWcuaWNlU2VydmVyc1tpXTtcbiAgICAgIHZhciBuZXdVcmxzID0gW107XG4gICAgICBmb3IgKHZhciBqID0gMDsgaiA8IGljZVNlcnZlci51cmxzLmxlbmd0aDsgKytqKSB7XG4gICAgICAgIHZhciB1cmkgPSBpY2VTZXJ2ZXIudXJsc1tqXTtcbiAgICAgICAgaWYgKHVyaS5pbmRleE9mKHRyYW5zcG9ydCkgIT09IC0xKSB7XG4gICAgICAgICAgbmV3VXJscy5wdXNoKHVyaSk7XG4gICAgICAgIH0gZWxzZSBpZiAodXJpLmluZGV4T2YoJz90cmFuc3BvcnQ9JykgPT09IC0xICYmXG4gICAgICAgICAgICB1cmkuc3RhcnRzV2l0aCgndHVybicpKSB7XG4gICAgICAgICAgbmV3VXJscy5wdXNoKHVyaSArICc/JyArIHRyYW5zcG9ydCk7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICAgIGlmIChuZXdVcmxzLmxlbmd0aCAhPT0gMCkge1xuICAgICAgICBpY2VTZXJ2ZXIudXJscyA9IG5ld1VybHM7XG4gICAgICAgIG5ld0ljZVNlcnZlcnMucHVzaChpY2VTZXJ2ZXIpO1xuICAgICAgfVxuICAgIH1cbiAgICBjb25maWcuaWNlU2VydmVycyA9IG5ld0ljZVNlcnZlcnM7XG4gIH0sXG5cbiAgLy8gQ3JlYXRlIGEgUGVlckNvbm5lY3Rpb24sIGFuZCBnYXRoZXIgY2FuZGlkYXRlcyB1c2luZyBSVENDb25maWcgfGNvbmZpZ3xcbiAgLy8gYW5kIGN0b3IgcGFyYW1zIHxwYXJhbXN8LiBTdWNjZWVkIGlmIGFueSBjYW5kaWRhdGVzIHBhc3MgdGhlIHxpc0dvb2R8XG4gIC8vIGNoZWNrLCBmYWlsIGlmIHdlIGNvbXBsZXRlIGdhdGhlcmluZyB3aXRob3V0IGFueSBwYXNzaW5nLlxuICBnYXRoZXJDYW5kaWRhdGVzOiBmdW5jdGlvbihjb25maWcsIHBhcmFtcywgaXNHb29kKSB7XG4gICAgdmFyIHBjO1xuICAgIHRyeSB7XG4gICAgICBwYyA9IG5ldyBSVENQZWVyQ29ubmVjdGlvbihjb25maWcsIHBhcmFtcyk7XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIGlmIChwYXJhbXMgIT09IG51bGwgJiYgcGFyYW1zLm9wdGlvbmFsWzBdLmdvb2dJUHY2KSB7XG4gICAgICAgIHRoaXMudGVzdC5yZXBvcnRXYXJuaW5nKCdGYWlsZWQgdG8gY3JlYXRlIHBlZXIgY29ubmVjdGlvbiwgSVB2NiAnICtcbiAgICAgICAgICAgICdtaWdodCBub3QgYmUgc2V0dXAvc3VwcG9ydGVkIG9uIHRoZSBuZXR3b3JrLicpO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgdGhpcy50ZXN0LnJlcG9ydEVycm9yKCdGYWlsZWQgdG8gY3JlYXRlIHBlZXIgY29ubmVjdGlvbjogJyArIGVycm9yKTtcbiAgICAgIH1cbiAgICAgIHRoaXMudGVzdC5kb25lKCk7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgLy8gSW4gb3VyIGNhbmRpZGF0ZSBjYWxsYmFjaywgc3RvcCBpZiB3ZSBnZXQgYSBjYW5kaWRhdGUgdGhhdCBwYXNzZXNcbiAgICAvLyB8aXNHb29kfC5cbiAgICBwYy5hZGRFdmVudExpc3RlbmVyKCdpY2VjYW5kaWRhdGUnLCBmdW5jdGlvbihlKSB7XG4gICAgICAvLyBPbmNlIHdlJ3ZlIGRlY2lkZWQsIGlnbm9yZSBmdXR1cmUgY2FsbGJhY2tzLlxuICAgICAgaWYgKGUuY3VycmVudFRhcmdldC5zaWduYWxpbmdTdGF0ZSA9PT0gJ2Nsb3NlZCcpIHtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuXG4gICAgICBpZiAoZS5jYW5kaWRhdGUpIHtcbiAgICAgICAgdmFyIHBhcnNlZCA9IENhbGwucGFyc2VDYW5kaWRhdGUoZS5jYW5kaWRhdGUuY2FuZGlkYXRlKTtcbiAgICAgICAgaWYgKGlzR29vZChwYXJzZWQpKSB7XG4gICAgICAgICAgdGhpcy50ZXN0LnJlcG9ydFN1Y2Nlc3MoJ0dhdGhlcmVkIGNhbmRpZGF0ZSBvZiBUeXBlOiAnICsgcGFyc2VkLnR5cGUgK1xuICAgICAgICAgICAgICAnIFByb3RvY29sOiAnICsgcGFyc2VkLnByb3RvY29sICsgJyBBZGRyZXNzOiAnICsgcGFyc2VkLmFkZHJlc3MpO1xuICAgICAgICAgIHBjLmNsb3NlKCk7XG4gICAgICAgICAgcGMgPSBudWxsO1xuICAgICAgICAgIHRoaXMudGVzdC5kb25lKCk7XG4gICAgICAgIH1cbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHBjLmNsb3NlKCk7XG4gICAgICAgIHBjID0gbnVsbDtcbiAgICAgICAgaWYgKHBhcmFtcyAhPT0gbnVsbCAmJiBwYXJhbXMub3B0aW9uYWxbMF0uZ29vZ0lQdjYpIHtcbiAgICAgICAgICB0aGlzLnRlc3QucmVwb3J0V2FybmluZygnRmFpbGVkIHRvIGdhdGhlciBJUHY2IGNhbmRpZGF0ZXMsIGl0ICcgK1xuICAgICAgICAgICAgICAnbWlnaHQgbm90IGJlIHNldHVwL3N1cHBvcnRlZCBvbiB0aGUgbmV0d29yay4nKTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICB0aGlzLnRlc3QucmVwb3J0RXJyb3IoJ0ZhaWxlZCB0byBnYXRoZXIgc3BlY2lmaWVkIGNhbmRpZGF0ZXMnKTtcbiAgICAgICAgfVxuICAgICAgICB0aGlzLnRlc3QuZG9uZSgpO1xuICAgICAgfVxuICAgIH0uYmluZCh0aGlzKSk7XG5cbiAgICB0aGlzLmNyZWF0ZUF1ZGlvT25seVJlY2VpdmVPZmZlcihwYyk7XG4gIH0sXG5cbiAgLy8gQ3JlYXRlIGFuIGF1ZGlvLW9ubHksIHJlY3Zvbmx5IG9mZmVyLCBhbmQgc2V0TEQgd2l0aCBpdC5cbiAgLy8gVGhpcyB3aWxsIHRyaWdnZXIgY2FuZGlkYXRlIGdhdGhlcmluZy5cbiAgY3JlYXRlQXVkaW9Pbmx5UmVjZWl2ZU9mZmVyOiBmdW5jdGlvbihwYykge1xuICAgIHZhciBjcmVhdGVPZmZlclBhcmFtcyA9IHtvZmZlclRvUmVjZWl2ZUF1ZGlvOiAxfTtcbiAgICBwYy5jcmVhdGVPZmZlcihcbiAgICAgICAgY3JlYXRlT2ZmZXJQYXJhbXNcbiAgICApLnRoZW4oXG4gICAgICAgIGZ1bmN0aW9uKG9mZmVyKSB7XG4gICAgICAgICAgcGMuc2V0TG9jYWxEZXNjcmlwdGlvbihvZmZlcikudGhlbihcbiAgICAgICAgICAgICAgbm9vcCxcbiAgICAgICAgICAgICAgbm9vcFxuICAgICAgICAgICk7XG4gICAgICAgIH0sXG4gICAgICAgIG5vb3BcbiAgICApO1xuXG4gICAgLy8gRW1wdHkgZnVuY3Rpb24gZm9yIGNhbGxiYWNrcyByZXF1aXJpbmcgYSBmdW5jdGlvbi5cbiAgICBmdW5jdGlvbiBub29wKCkge31cbiAgfVxufTtcblxuZXhwb3J0IGRlZmF1bHQgTmV0d29ya1Rlc3Q7XG4iLCIndXNlIHN0cmljdCc7XG5cbmZ1bmN0aW9uIFZpZGVvQmFuZHdpZHRoVGVzdCh0ZXN0KSB7XG4gIHRoaXMudGVzdCA9IHRlc3Q7XG4gIHRoaXMubWF4VmlkZW9CaXRyYXRlS2JwcyA9IDIwMDA7XG4gIHRoaXMuZHVyYXRpb25NcyA9IDQwMDAwO1xuICB0aGlzLnN0YXRTdGVwTXMgPSAxMDA7XG4gIHRoaXMuYndlU3RhdHMgPSBuZXcgU3RhdGlzdGljc0FnZ3JlZ2F0ZSgwLjc1ICogdGhpcy5tYXhWaWRlb0JpdHJhdGVLYnBzICpcbiAgICAgIDEwMDApO1xuICB0aGlzLnJ0dFN0YXRzID0gbmV3IFN0YXRpc3RpY3NBZ2dyZWdhdGUoKTtcbiAgdGhpcy5wYWNrZXRzTG9zdCA9IC0xO1xuICB0aGlzLm5hY2tDb3VudCA9IC0xO1xuICB0aGlzLnBsaUNvdW50ID0gLTE7XG4gIHRoaXMucXBTdW0gPSAtMTtcbiAgdGhpcy5wYWNrZXRzU2VudCA9IC0xO1xuICB0aGlzLnBhY2tldHNSZWNlaXZlZCA9IC0xO1xuICB0aGlzLmZyYW1lc0VuY29kZWQgPSAtMTtcbiAgdGhpcy5mcmFtZXNEZWNvZGVkID0gLTE7XG4gIHRoaXMuZnJhbWVzU2VudCA9IC0xO1xuICB0aGlzLmJ5dGVzU2VudCA9IC0xO1xuICB0aGlzLnZpZGVvU3RhdHMgPSBbXTtcbiAgdGhpcy5zdGFydFRpbWUgPSBudWxsO1xuICB0aGlzLmNhbGwgPSBudWxsO1xuICAvLyBPcGVuIHRoZSBjYW1lcmEgaW4gNzIwcCB0byBnZXQgYSBjb3JyZWN0IG1lYXN1cmVtZW50IG9mIHJhbXAtdXAgdGltZS5cbiAgdGhpcy5jb25zdHJhaW50cyA9IHtcbiAgICBhdWRpbzogZmFsc2UsXG4gICAgdmlkZW86IHtcbiAgICAgIG9wdGlvbmFsOiBbXG4gICAgICAgIHttaW5XaWR0aDogMTI4MH0sXG4gICAgICAgIHttaW5IZWlnaHQ6IDcyMH1cbiAgICAgIF1cbiAgICB9XG4gIH07XG59XG5cblZpZGVvQmFuZHdpZHRoVGVzdC5wcm90b3R5cGUgPSB7XG4gIHJ1bjogZnVuY3Rpb24oKSB7XG4gICAgQ2FsbC5hc3luY0NyZWF0ZVR1cm5Db25maWcodGhpcy5zdGFydC5iaW5kKHRoaXMpLFxuICAgICAgICB0aGlzLnRlc3QucmVwb3J0RmF0YWwuYmluZCh0aGlzLnRlc3QpKTtcbiAgfSxcblxuICBzdGFydDogZnVuY3Rpb24oY29uZmlnKSB7XG4gICAgdGhpcy5jYWxsID0gbmV3IENhbGwoY29uZmlnLCB0aGlzLnRlc3QpO1xuICAgIHRoaXMuY2FsbC5zZXRJY2VDYW5kaWRhdGVGaWx0ZXIoQ2FsbC5pc1JlbGF5KTtcbiAgICAvLyBGRUMgbWFrZXMgaXQgaGFyZCB0byBzdHVkeSBiYW5kd2lkdGggZXN0aW1hdGlvbiBzaW5jZSB0aGVyZSBzZWVtcyB0byBiZVxuICAgIC8vIGEgc3Bpa2Ugd2hlbiBpdCBpcyBlbmFibGVkIGFuZCBkaXNhYmxlZC4gRGlzYWJsZSBpdCBmb3Igbm93LiBGRUMgaXNzdWVcbiAgICAvLyB0cmFja2VkIG9uOiBodHRwczovL2NvZGUuZ29vZ2xlLmNvbS9wL3dlYnJ0Yy9pc3N1ZXMvZGV0YWlsP2lkPTMwNTBcbiAgICB0aGlzLmNhbGwuZGlzYWJsZVZpZGVvRmVjKCk7XG4gICAgdGhpcy5jYWxsLmNvbnN0cmFpblZpZGVvQml0cmF0ZSh0aGlzLm1heFZpZGVvQml0cmF0ZUticHMpO1xuICAgIGRvR2V0VXNlck1lZGlhKHRoaXMuY29uc3RyYWludHMsIHRoaXMuZ290U3RyZWFtLmJpbmQodGhpcykpO1xuICB9LFxuXG4gIGdvdFN0cmVhbTogZnVuY3Rpb24oc3RyZWFtKSB7XG4gICAgdGhpcy5jYWxsLnBjMS5hZGRTdHJlYW0oc3RyZWFtKTtcbiAgICB0aGlzLmNhbGwuZXN0YWJsaXNoQ29ubmVjdGlvbigpO1xuICAgIHRoaXMuc3RhcnRUaW1lID0gbmV3IERhdGUoKTtcbiAgICB0aGlzLmxvY2FsU3RyZWFtID0gc3RyZWFtLmdldFZpZGVvVHJhY2tzKClbMF07XG4gICAgc2V0VGltZW91dCh0aGlzLmdhdGhlclN0YXRzLmJpbmQodGhpcyksIHRoaXMuc3RhdFN0ZXBNcyk7XG4gIH0sXG5cbiAgZ2F0aGVyU3RhdHM6IGZ1bmN0aW9uKCkge1xuICAgIHZhciBub3cgPSBuZXcgRGF0ZSgpO1xuICAgIGlmIChub3cgLSB0aGlzLnN0YXJ0VGltZSA+IHRoaXMuZHVyYXRpb25Ncykge1xuICAgICAgdGhpcy50ZXN0LnNldFByb2dyZXNzKDEwMCk7XG4gICAgICB0aGlzLmhhbmd1cCgpO1xuICAgICAgcmV0dXJuO1xuICAgIH0gZWxzZSBpZiAoIXRoaXMuY2FsbC5zdGF0c0dhdGhlcmluZ1J1bm5pbmcpIHtcbiAgICAgIHRoaXMuY2FsbC5nYXRoZXJTdGF0cyh0aGlzLmNhbGwucGMxLCB0aGlzLmNhbGwucGMyLCB0aGlzLmxvY2FsU3RyZWFtLFxuICAgICAgICAgIHRoaXMuZ290U3RhdHMuYmluZCh0aGlzKSk7XG4gICAgfVxuICAgIHRoaXMudGVzdC5zZXRQcm9ncmVzcygobm93IC0gdGhpcy5zdGFydFRpbWUpICogMTAwIC8gdGhpcy5kdXJhdGlvbk1zKTtcbiAgICBzZXRUaW1lb3V0KHRoaXMuZ2F0aGVyU3RhdHMuYmluZCh0aGlzKSwgdGhpcy5zdGF0U3RlcE1zKTtcbiAgfSxcblxuICBnb3RTdGF0czogZnVuY3Rpb24ocmVzcG9uc2UsIHRpbWUsIHJlc3BvbnNlMiwgdGltZTIpIHtcbiAgICAvLyBUT0RPOiBSZW1vdmUgYnJvd3NlciBzcGVjaWZpYyBzdGF0cyBnYXRoZXJpbmcgaGFjayBvbmNlIGFkYXB0ZXIuanMgb3JcbiAgICAvLyBicm93c2VycyBjb252ZXJnZSBvbiBhIHN0YW5kYXJkLlxuICAgIGlmIChhZGFwdGVyLmJyb3dzZXJEZXRhaWxzLmJyb3dzZXIgPT09ICdjaHJvbWUnKSB7XG4gICAgICBmb3IgKHZhciBpIGluIHJlc3BvbnNlKSB7XG4gICAgICAgIGlmICh0eXBlb2YgcmVzcG9uc2VbaV0uY29ubmVjdGlvbiAhPT0gJ3VuZGVmaW5lZCcpIHtcbiAgICAgICAgICB0aGlzLmJ3ZVN0YXRzLmFkZChyZXNwb25zZVtpXS5jb25uZWN0aW9uLnRpbWVzdGFtcCxcbiAgICAgICAgICAgICAgcGFyc2VJbnQocmVzcG9uc2VbaV0uY29ubmVjdGlvbi5hdmFpbGFibGVPdXRnb2luZ0JpdHJhdGUpKTtcbiAgICAgICAgICB0aGlzLnJ0dFN0YXRzLmFkZChyZXNwb25zZVtpXS5jb25uZWN0aW9uLnRpbWVzdGFtcCxcbiAgICAgICAgICAgICAgcGFyc2VJbnQocmVzcG9uc2VbaV0uY29ubmVjdGlvbi5jdXJyZW50Um91bmRUcmlwVGltZSAqIDEwMDApKTtcbiAgICAgICAgICAvLyBHcmFiIHRoZSBsYXN0IHN0YXRzLlxuICAgICAgICAgIHRoaXMudmlkZW9TdGF0c1swXSA9IHJlc3BvbnNlW2ldLnZpZGVvLmxvY2FsLmZyYW1lV2lkdGg7XG4gICAgICAgICAgdGhpcy52aWRlb1N0YXRzWzFdID0gcmVzcG9uc2VbaV0udmlkZW8ubG9jYWwuZnJhbWVIZWlnaHQ7XG4gICAgICAgICAgdGhpcy5uYWNrQ291bnQgPSByZXNwb25zZVtpXS52aWRlby5sb2NhbC5uYWNrQ291bnQ7XG4gICAgICAgICAgdGhpcy5wYWNrZXRzTG9zdCA9IHJlc3BvbnNlMltpXS52aWRlby5yZW1vdGUucGFja2V0c0xvc3Q7XG4gICAgICAgICAgdGhpcy5xcFN1bSA9IHJlc3BvbnNlMltpXS52aWRlby5yZW1vdGUucXBTdW07XG4gICAgICAgICAgdGhpcy5wbGlDb3VudCA9IHJlc3BvbnNlW2ldLnZpZGVvLmxvY2FsLnBsaUNvdW50O1xuICAgICAgICAgIHRoaXMucGFja2V0c1NlbnQgPSByZXNwb25zZVtpXS52aWRlby5sb2NhbC5wYWNrZXRzU2VudDtcbiAgICAgICAgICB0aGlzLnBhY2tldHNSZWNlaXZlZCA9IHJlc3BvbnNlMltpXS52aWRlby5yZW1vdGUucGFja2V0c1JlY2VpdmVkO1xuICAgICAgICAgIHRoaXMuZnJhbWVzRW5jb2RlZCA9IHJlc3BvbnNlW2ldLnZpZGVvLmxvY2FsLmZyYW1lc0VuY29kZWQ7XG4gICAgICAgICAgdGhpcy5mcmFtZXNEZWNvZGVkID0gcmVzcG9uc2UyW2ldLnZpZGVvLnJlbW90ZS5mcmFtZXNEZWNvZGVkO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfSBlbHNlIGlmIChhZGFwdGVyLmJyb3dzZXJEZXRhaWxzLmJyb3dzZXIgPT09ICdmaXJlZm94Jykge1xuICAgICAgZm9yICh2YXIgaiBpbiByZXNwb25zZSkge1xuICAgICAgICBpZiAocmVzcG9uc2Vbal0uaWQgPT09ICdvdXRib3VuZF9ydGNwX3ZpZGVvXzAnKSB7XG4gICAgICAgICAgdGhpcy5ydHRTdGF0cy5hZGQoRGF0ZS5wYXJzZShyZXNwb25zZVtqXS50aW1lc3RhbXApLFxuICAgICAgICAgICAgICBwYXJzZUludChyZXNwb25zZVtqXS5tb3pSdHQpKTtcbiAgICAgICAgICAvLyBHcmFiIHRoZSBsYXN0IHN0YXRzLlxuICAgICAgICAgIHRoaXMuaml0dGVyID0gcmVzcG9uc2Vbal0uaml0dGVyO1xuICAgICAgICAgIHRoaXMucGFja2V0c0xvc3QgPSByZXNwb25zZVtqXS5wYWNrZXRzTG9zdDtcbiAgICAgICAgfSBlbHNlIGlmIChyZXNwb25zZVtqXS5pZCA9PT0gJ291dGJvdW5kX3J0cF92aWRlb18wJykge1xuICAgICAgICAgIC8vIFRPRE86IEdldCBkaW1lbnNpb25zIGZyb20gZ2V0U3RhdHMgd2hlbiBzdXBwb3J0ZWQgaW4gRkYuXG4gICAgICAgICAgdGhpcy52aWRlb1N0YXRzWzBdID0gJ05vdCBzdXBwb3J0ZWQgb24gRmlyZWZveCc7XG4gICAgICAgICAgdGhpcy52aWRlb1N0YXRzWzFdID0gJ05vdCBzdXBwb3J0ZWQgb24gRmlyZWZveCc7XG4gICAgICAgICAgdGhpcy5iaXRyYXRlTWVhbiA9IHJlc3BvbnNlW2pdLmJpdHJhdGVNZWFuO1xuICAgICAgICAgIHRoaXMuYml0cmF0ZVN0ZERldiA9IHJlc3BvbnNlW2pdLmJpdHJhdGVTdGREZXY7XG4gICAgICAgICAgdGhpcy5mcmFtZXJhdGVNZWFuID0gcmVzcG9uc2Vbal0uZnJhbWVyYXRlTWVhbjtcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH0gZWxzZSB7XG4gICAgICB0aGlzLnRlc3QucmVwb3J0RXJyb3IoJ09ubHkgRmlyZWZveCBhbmQgQ2hyb21lIGdldFN0YXRzIGltcGxlbWVudGF0aW9ucycgK1xuICAgICAgICAnIGFyZSBzdXBwb3J0ZWQuJyk7XG4gICAgfVxuICAgIHRoaXMuY29tcGxldGVkKCk7XG4gIH0sXG5cbiAgaGFuZ3VwOiBmdW5jdGlvbigpIHtcbiAgICB0aGlzLmNhbGwucGMxLmdldExvY2FsU3RyZWFtcygpWzBdLmdldFRyYWNrcygpLmZvckVhY2goZnVuY3Rpb24odHJhY2spIHtcbiAgICAgIHRyYWNrLnN0b3AoKTtcbiAgICB9KTtcbiAgICB0aGlzLmNhbGwuY2xvc2UoKTtcbiAgICB0aGlzLmNhbGwgPSBudWxsO1xuICB9LFxuXG4gIGNvbXBsZXRlZDogZnVuY3Rpb24oKSB7XG4gICAgLy8gVE9ETzogUmVtb3ZlIGJyb3dzZXIgc3BlY2lmaWMgc3RhdHMgZ2F0aGVyaW5nIGhhY2sgb25jZSBhZGFwdGVyLmpzIG9yXG4gICAgLy8gYnJvd3NlcnMgY29udmVyZ2Ugb24gYSBzdGFuZGFyZC5cbiAgICBpZiAoYWRhcHRlci5icm93c2VyRGV0YWlscy5icm93c2VyID09PSAnY2hyb21lJykge1xuICAgICAgLy8gQ2hlY2tpbmcgaWYgZ3JlYXRlciB0aGFuIDIgYmVjYXVzZSBDaHJvbWUgc29tZXRpbWVzIHJlcG9ydHMgMngyIHdoZW5cbiAgICAgIC8vIGEgY2FtZXJhIHN0YXJ0cyBidXQgZmFpbHMgdG8gZGVsaXZlciBmcmFtZXMuXG4gICAgICBpZiAodGhpcy52aWRlb1N0YXRzWzBdIDwgMiAmJiB0aGlzLnZpZGVvU3RhdHNbMV0gPCAyKSB7XG4gICAgICAgIHRoaXMudGVzdC5yZXBvcnRFcnJvcignQ2FtZXJhIGZhaWx1cmU6ICcgKyB0aGlzLnZpZGVvU3RhdHNbMF0gKyAneCcgK1xuICAgICAgICAgICAgdGhpcy52aWRlb1N0YXRzWzFdICsgJy4gQ2Fubm90IHRlc3QgYmFuZHdpZHRoIHdpdGhvdXQgYSB3b3JraW5nICcgK1xuICAgICAgICAgICAgJyBjYW1lcmEuJyk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICB0aGlzLnRlc3QucmVwb3J0U3VjY2VzcygnVmlkZW8gcmVzb2x1dGlvbjogJyArIHRoaXMudmlkZW9TdGF0c1swXSArXG4gICAgICAgICAgICAneCcgKyB0aGlzLnZpZGVvU3RhdHNbMV0pO1xuICAgICAgICB0aGlzLnRlc3QucmVwb3J0SW5mbygnU2VuZCBiYW5kd2lkdGggZXN0aW1hdGUgYXZlcmFnZTogJyArXG4gICAgICAgICAgICBNYXRoLnJvdW5kKHRoaXMuYndlU3RhdHMuZ2V0QXZlcmFnZSgpIC8gMTAwMCkgKyAnIGticHMnKTtcbiAgICAgICAgdGhpcy50ZXN0LnJlcG9ydEluZm8oJ1NlbmQgYmFuZHdpZHRoIGVzdGltYXRlIG1heDogJyArXG4gICAgICAgICAgICB0aGlzLmJ3ZVN0YXRzLmdldE1heCgpIC8gMTAwMCArICcga2JwcycpO1xuICAgICAgICB0aGlzLnRlc3QucmVwb3J0SW5mbygnU2VuZCBiYW5kd2lkdGggcmFtcC11cCB0aW1lOiAnICtcbiAgICAgICAgICAgIHRoaXMuYndlU3RhdHMuZ2V0UmFtcFVwVGltZSgpICsgJyBtcycpO1xuICAgICAgICB0aGlzLnRlc3QucmVwb3J0SW5mbygnUGFja2V0cyBzZW50OiAnICsgdGhpcy5wYWNrZXRzU2VudCk7XG4gICAgICAgIHRoaXMudGVzdC5yZXBvcnRJbmZvKCdQYWNrZXRzIHJlY2VpdmVkOiAnICsgdGhpcy5wYWNrZXRzUmVjZWl2ZWQpO1xuICAgICAgICB0aGlzLnRlc3QucmVwb3J0SW5mbygnTkFDSyBjb3VudDogJyArIHRoaXMubmFja0NvdW50KTtcbiAgICAgICAgdGhpcy50ZXN0LnJlcG9ydEluZm8oJ1BpY3R1cmUgbG9zcyBpbmRpY2F0aW9uczogJyArIHRoaXMucGxpQ291bnQpO1xuICAgICAgICB0aGlzLnRlc3QucmVwb3J0SW5mbygnUXVhbGl0eSBwcmVkaWN0b3Igc3VtOiAnICsgdGhpcy5xcFN1bSk7XG4gICAgICAgIHRoaXMudGVzdC5yZXBvcnRJbmZvKCdGcmFtZXMgZW5jb2RlZDogJyArIHRoaXMuZnJhbWVzRW5jb2RlZCk7XG4gICAgICAgIHRoaXMudGVzdC5yZXBvcnRJbmZvKCdGcmFtZXMgZGVjb2RlZDogJyArIHRoaXMuZnJhbWVzRGVjb2RlZCk7XG4gICAgICB9XG4gICAgfSBlbHNlIGlmIChhZGFwdGVyLmJyb3dzZXJEZXRhaWxzLmJyb3dzZXIgPT09ICdmaXJlZm94Jykge1xuICAgICAgaWYgKHBhcnNlSW50KHRoaXMuZnJhbWVyYXRlTWVhbikgPiAwKSB7XG4gICAgICAgIHRoaXMudGVzdC5yZXBvcnRTdWNjZXNzKCdGcmFtZSByYXRlIG1lYW46ICcgK1xuICAgICAgICAgICAgcGFyc2VJbnQodGhpcy5mcmFtZXJhdGVNZWFuKSk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICB0aGlzLnRlc3QucmVwb3J0RXJyb3IoJ0ZyYW1lIHJhdGUgbWVhbiBpcyAwLCBjYW5ub3QgdGVzdCBiYW5kd2lkdGggJyArXG4gICAgICAgICAgICAnd2l0aG91dCBhIHdvcmtpbmcgY2FtZXJhLicpO1xuICAgICAgfVxuICAgICAgdGhpcy50ZXN0LnJlcG9ydEluZm8oJ1NlbmQgYml0cmF0ZSBtZWFuOiAnICtcbiAgICAgICAgICBwYXJzZUludCh0aGlzLmJpdHJhdGVNZWFuKSAvIDEwMDAgKyAnIGticHMnKTtcbiAgICAgIHRoaXMudGVzdC5yZXBvcnRJbmZvKCdTZW5kIGJpdHJhdGUgc3RhbmRhcmQgZGV2aWF0aW9uOiAnICtcbiAgICAgICAgICBwYXJzZUludCh0aGlzLmJpdHJhdGVTdGREZXYpIC8gMTAwMCArICcga2JwcycpO1xuICAgIH1cbiAgICB0aGlzLnRlc3QucmVwb3J0SW5mbygnUlRUIGF2ZXJhZ2U6ICcgKyB0aGlzLnJ0dFN0YXRzLmdldEF2ZXJhZ2UoKSArXG4gICAgICAgICAgICAnIG1zJyk7XG4gICAgdGhpcy50ZXN0LnJlcG9ydEluZm8oJ1JUVCBtYXg6ICcgKyB0aGlzLnJ0dFN0YXRzLmdldE1heCgpICsgJyBtcycpO1xuICAgIHRoaXMudGVzdC5yZXBvcnRJbmZvKCdQYWNrZXRzIGxvc3Q6ICcgKyB0aGlzLnBhY2tldHNMb3N0KTtcbiAgICB0aGlzLnRlc3QuZG9uZSgpO1xuICB9XG59O1xuXG5leHBvcnQgZGVmYXVsdCBWaWRlb0JhbmR3aWR0aFRlc3Q7IiwiJ3VzZSBzdHJpY3QnO1xuXG5mdW5jdGlvbiBXaUZpUGVyaW9kaWNTY2FuVGVzdCh0ZXN0LCBjYW5kaWRhdGVGaWx0ZXIpIHtcbiAgdGhpcy50ZXN0ID0gdGVzdDtcbiAgdGhpcy5jYW5kaWRhdGVGaWx0ZXIgPSBjYW5kaWRhdGVGaWx0ZXI7XG4gIHRoaXMudGVzdER1cmF0aW9uTXMgPSA1ICogNjAgKiAxMDAwO1xuICB0aGlzLnNlbmRJbnRlcnZhbE1zID0gMTAwO1xuICB0aGlzLmRlbGF5cyA9IFtdO1xuICB0aGlzLnJlY3ZUaW1lU3RhbXBzID0gW107XG4gIHRoaXMucnVubmluZyA9IGZhbHNlO1xuICB0aGlzLmNhbGwgPSBudWxsO1xuICB0aGlzLnNlbmRlckNoYW5uZWwgPSBudWxsO1xuICB0aGlzLnJlY2VpdmVDaGFubmVsID0gbnVsbDtcbn1cblxuV2lGaVBlcmlvZGljU2NhblRlc3QucHJvdG90eXBlID0ge1xuICBydW46IGZ1bmN0aW9uKCkge1xuICAgIENhbGwuYXN5bmNDcmVhdGVUdXJuQ29uZmlnKHRoaXMuc3RhcnQuYmluZCh0aGlzKSxcbiAgICAgICAgdGhpcy50ZXN0LnJlcG9ydEZhdGFsLmJpbmQodGhpcy50ZXN0KSk7XG4gIH0sXG5cbiAgc3RhcnQ6IGZ1bmN0aW9uKGNvbmZpZykge1xuICAgIHRoaXMucnVubmluZyA9IHRydWU7XG4gICAgdGhpcy5jYWxsID0gbmV3IENhbGwoY29uZmlnLCB0aGlzLnRlc3QpO1xuICAgIHRoaXMuY2hhcnQgPSB0aGlzLnRlc3QuY3JlYXRlTGluZUNoYXJ0KCk7XG4gICAgdGhpcy5jYWxsLnNldEljZUNhbmRpZGF0ZUZpbHRlcih0aGlzLmNhbmRpZGF0ZUZpbHRlcik7XG5cbiAgICB0aGlzLnNlbmRlckNoYW5uZWwgPSB0aGlzLmNhbGwucGMxLmNyZWF0ZURhdGFDaGFubmVsKHtvcmRlcmVkOiBmYWxzZSxcbiAgICAgIG1heFJldHJhbnNtaXRzOiAwfSk7XG4gICAgdGhpcy5zZW5kZXJDaGFubmVsLmFkZEV2ZW50TGlzdGVuZXIoJ29wZW4nLCB0aGlzLnNlbmQuYmluZCh0aGlzKSk7XG4gICAgdGhpcy5jYWxsLnBjMi5hZGRFdmVudExpc3RlbmVyKCdkYXRhY2hhbm5lbCcsXG4gICAgICAgIHRoaXMub25SZWNlaXZlckNoYW5uZWwuYmluZCh0aGlzKSk7XG4gICAgdGhpcy5jYWxsLmVzdGFibGlzaENvbm5lY3Rpb24oKTtcblxuICAgIHNldFRpbWVvdXRXaXRoUHJvZ3Jlc3NCYXIodGhpcy5maW5pc2hUZXN0LmJpbmQodGhpcyksXG4gICAgICAgIHRoaXMudGVzdER1cmF0aW9uTXMpO1xuICB9LFxuXG4gIG9uUmVjZWl2ZXJDaGFubmVsOiBmdW5jdGlvbihldmVudCkge1xuICAgIHRoaXMucmVjZWl2ZUNoYW5uZWwgPSBldmVudC5jaGFubmVsO1xuICAgIHRoaXMucmVjZWl2ZUNoYW5uZWwuYWRkRXZlbnRMaXN0ZW5lcignbWVzc2FnZScsIHRoaXMucmVjZWl2ZS5iaW5kKHRoaXMpKTtcbiAgfSxcblxuICBzZW5kOiBmdW5jdGlvbigpIHtcbiAgICBpZiAoIXRoaXMucnVubmluZykge1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICB0aGlzLnNlbmRlckNoYW5uZWwuc2VuZCgnJyArIERhdGUubm93KCkpO1xuICAgIHNldFRpbWVvdXQodGhpcy5zZW5kLmJpbmQodGhpcyksIHRoaXMuc2VuZEludGVydmFsTXMpO1xuICB9LFxuXG4gIHJlY2VpdmU6IGZ1bmN0aW9uKGV2ZW50KSB7XG4gICAgaWYgKCF0aGlzLnJ1bm5pbmcpIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgdmFyIHNlbmRUaW1lID0gcGFyc2VJbnQoZXZlbnQuZGF0YSk7XG4gICAgdmFyIGRlbGF5ID0gRGF0ZS5ub3coKSAtIHNlbmRUaW1lO1xuICAgIHRoaXMucmVjdlRpbWVTdGFtcHMucHVzaChzZW5kVGltZSk7XG4gICAgdGhpcy5kZWxheXMucHVzaChkZWxheSk7XG4gICAgdGhpcy5jaGFydC5hZGREYXRhcG9pbnQoc2VuZFRpbWUgKyBkZWxheSwgZGVsYXkpO1xuICB9LFxuXG4gIGZpbmlzaFRlc3Q6IGZ1bmN0aW9uKCkge1xuICAgIHJlcG9ydC50cmFjZUV2ZW50SW5zdGFudCgncGVyaW9kaWMtZGVsYXknLCB7ZGVsYXlzOiB0aGlzLmRlbGF5cyxcbiAgICAgIHJlY3ZUaW1lU3RhbXBzOiB0aGlzLnJlY3ZUaW1lU3RhbXBzfSk7XG4gICAgdGhpcy5ydW5uaW5nID0gZmFsc2U7XG4gICAgdGhpcy5jYWxsLmNsb3NlKCk7XG4gICAgdGhpcy5jYWxsID0gbnVsbDtcbiAgICB0aGlzLmNoYXJ0LnBhcmVudEVsZW1lbnQucmVtb3ZlQ2hpbGQodGhpcy5jaGFydCk7XG5cbiAgICB2YXIgYXZnID0gYXJyYXlBdmVyYWdlKHRoaXMuZGVsYXlzKTtcbiAgICB2YXIgbWF4ID0gYXJyYXlNYXgodGhpcy5kZWxheXMpO1xuICAgIHZhciBtaW4gPSBhcnJheU1pbih0aGlzLmRlbGF5cyk7XG4gICAgdGhpcy50ZXN0LnJlcG9ydEluZm8oJ0F2ZXJhZ2UgZGVsYXk6ICcgKyBhdmcgKyAnIG1zLicpO1xuICAgIHRoaXMudGVzdC5yZXBvcnRJbmZvKCdNaW4gZGVsYXk6ICcgKyBtaW4gKyAnIG1zLicpO1xuICAgIHRoaXMudGVzdC5yZXBvcnRJbmZvKCdNYXggZGVsYXk6ICcgKyBtYXggKyAnIG1zLicpO1xuXG4gICAgaWYgKHRoaXMuZGVsYXlzLmxlbmd0aCA8IDAuOCAqIHRoaXMudGVzdER1cmF0aW9uTXMgLyB0aGlzLnNlbmRJbnRlcnZhbE1zKSB7XG4gICAgICB0aGlzLnRlc3QucmVwb3J0RXJyb3IoJ05vdCBlbm91Z2ggc2FtcGxlcyBnYXRoZXJlZC4gS2VlcCB0aGUgcGFnZSBvbiAnICtcbiAgICAgICAgICAnIHRoZSBmb3JlZ3JvdW5kIHdoaWxlIHRoZSB0ZXN0IGlzIHJ1bm5pbmcuJyk7XG4gICAgfSBlbHNlIHtcbiAgICAgIHRoaXMudGVzdC5yZXBvcnRTdWNjZXNzKCdDb2xsZWN0ZWQgJyArIHRoaXMuZGVsYXlzLmxlbmd0aCArXG4gICAgICAgICAgJyBkZWxheSBzYW1wbGVzLicpO1xuICAgIH1cblxuICAgIGlmIChtYXggPiAobWluICsgMTAwKSAqIDIpIHtcbiAgICAgIHRoaXMudGVzdC5yZXBvcnRFcnJvcignVGhlcmUgaXMgYSBiaWcgZGlmZmVyZW5jZSBiZXR3ZWVuIHRoZSBtaW4gYW5kICcgK1xuICAgICAgICAgICdtYXggZGVsYXkgb2YgcGFja2V0cy4gWW91ciBuZXR3b3JrIGFwcGVhcnMgdW5zdGFibGUuJyk7XG4gICAgfVxuICAgIHRoaXMudGVzdC5kb25lKCk7XG4gIH1cbn07XG5cbmV4cG9ydCBkZWZhdWx0IFdpRmlQZXJpb2RpY1NjYW5UZXN0OyIsIi8qXG4gKiAgQ29weXJpZ2h0IChjKSAyMDE0IFRoZSBXZWJSVEMgcHJvamVjdCBhdXRob3JzLiBBbGwgUmlnaHRzIFJlc2VydmVkLlxuICpcbiAqICBVc2Ugb2YgdGhpcyBzb3VyY2UgY29kZSBpcyBnb3Zlcm5lZCBieSBhIEJTRC1zdHlsZSBsaWNlbnNlXG4gKiAgdGhhdCBjYW4gYmUgZm91bmQgaW4gdGhlIExJQ0VOU0UgZmlsZSBpbiB0aGUgcm9vdCBvZiB0aGUgc291cmNlXG4gKiAgdHJlZS5cbiAqL1xuJ3VzZSBzdHJpY3QnO1xuLyogZ2xvYmFsIGVudW1lcmF0ZVN0YXRzICovXG5cbmZ1bmN0aW9uIENhbGwoY29uZmlnLCB0ZXN0KSB7XG4gIHRoaXMudGVzdCA9IHRlc3Q7XG4gIHRoaXMudHJhY2VFdmVudCA9IHJlcG9ydC50cmFjZUV2ZW50QXN5bmMoJ2NhbGwnKTtcbiAgdGhpcy50cmFjZUV2ZW50KHtjb25maWc6IGNvbmZpZ30pO1xuICB0aGlzLnN0YXRzR2F0aGVyaW5nUnVubmluZyA9IGZhbHNlO1xuXG4gIHRoaXMucGMxID0gbmV3IFJUQ1BlZXJDb25uZWN0aW9uKGNvbmZpZyk7XG4gIHRoaXMucGMyID0gbmV3IFJUQ1BlZXJDb25uZWN0aW9uKGNvbmZpZyk7XG5cbiAgdGhpcy5wYzEuYWRkRXZlbnRMaXN0ZW5lcignaWNlY2FuZGlkYXRlJywgdGhpcy5vbkljZUNhbmRpZGF0ZV8uYmluZCh0aGlzLFxuICAgICAgdGhpcy5wYzIpKTtcbiAgdGhpcy5wYzIuYWRkRXZlbnRMaXN0ZW5lcignaWNlY2FuZGlkYXRlJywgdGhpcy5vbkljZUNhbmRpZGF0ZV8uYmluZCh0aGlzLFxuICAgICAgdGhpcy5wYzEpKTtcblxuICB0aGlzLmljZUNhbmRpZGF0ZUZpbHRlcl8gPSBDYWxsLm5vRmlsdGVyO1xufVxuXG5DYWxsLnByb3RvdHlwZSA9IHtcbiAgZXN0YWJsaXNoQ29ubmVjdGlvbjogZnVuY3Rpb24oKSB7XG4gICAgdGhpcy50cmFjZUV2ZW50KHtzdGF0ZTogJ3N0YXJ0J30pO1xuICAgIHRoaXMucGMxLmNyZWF0ZU9mZmVyKCkudGhlbihcbiAgICAgICAgdGhpcy5nb3RPZmZlcl8uYmluZCh0aGlzKSxcbiAgICAgICAgdGhpcy50ZXN0LnJlcG9ydEZhdGFsLmJpbmQodGhpcy50ZXN0KVxuICAgICk7XG4gIH0sXG5cbiAgY2xvc2U6IGZ1bmN0aW9uKCkge1xuICAgIHRoaXMudHJhY2VFdmVudCh7c3RhdGU6ICdlbmQnfSk7XG4gICAgdGhpcy5wYzEuY2xvc2UoKTtcbiAgICB0aGlzLnBjMi5jbG9zZSgpO1xuICB9LFxuXG4gIHNldEljZUNhbmRpZGF0ZUZpbHRlcjogZnVuY3Rpb24oZmlsdGVyKSB7XG4gICAgdGhpcy5pY2VDYW5kaWRhdGVGaWx0ZXJfID0gZmlsdGVyO1xuICB9LFxuXG4gIC8vIENvbnN0cmFpbnQgbWF4IHZpZGVvIGJpdHJhdGUgYnkgbW9kaWZ5aW5nIHRoZSBTRFAgd2hlbiBjcmVhdGluZyBhbiBhbnN3ZXIuXG4gIGNvbnN0cmFpblZpZGVvQml0cmF0ZTogZnVuY3Rpb24obWF4VmlkZW9CaXRyYXRlS2Jwcykge1xuICAgIHRoaXMuY29uc3RyYWluVmlkZW9CaXRyYXRlS2Jwc18gPSBtYXhWaWRlb0JpdHJhdGVLYnBzO1xuICB9LFxuXG4gIC8vIFJlbW92ZSB2aWRlbyBGRUMgaWYgYXZhaWxhYmxlIG9uIHRoZSBvZmZlci5cbiAgZGlzYWJsZVZpZGVvRmVjOiBmdW5jdGlvbigpIHtcbiAgICB0aGlzLmNvbnN0cmFpbk9mZmVyVG9SZW1vdmVWaWRlb0ZlY18gPSB0cnVlO1xuICB9LFxuXG4gIC8vIFdoZW4gdGhlIHBlZXJDb25uZWN0aW9uIGlzIGNsb3NlZCB0aGUgc3RhdHNDYiBpcyBjYWxsZWQgb25jZSB3aXRoIGFuIGFycmF5XG4gIC8vIG9mIGdhdGhlcmVkIHN0YXRzLlxuICBnYXRoZXJTdGF0czogZnVuY3Rpb24ocGVlckNvbm5lY3Rpb24scGVlckNvbm5lY3Rpb24yLCBsb2NhbFN0cmVhbSwgc3RhdHNDYikge1xuICAgIHZhciBzdGF0cyA9IFtdO1xuICAgIHZhciBzdGF0czIgPSBbXTtcbiAgICB2YXIgc3RhdHNDb2xsZWN0VGltZSA9IFtdO1xuICAgIHZhciBzdGF0c0NvbGxlY3RUaW1lMiA9IFtdO1xuICAgIHZhciBzZWxmID0gdGhpcztcbiAgICB2YXIgc3RhdFN0ZXBNcyA9IDEwMDtcbiAgICBzZWxmLmxvY2FsVHJhY2tJZHMgPSB7XG4gICAgICBhdWRpbzogJycsXG4gICAgICB2aWRlbzogJydcbiAgICB9O1xuICAgIHNlbGYucmVtb3RlVHJhY2tJZHMgPSB7XG4gICAgICBhdWRpbzogJycsXG4gICAgICB2aWRlbzogJydcbiAgICB9O1xuXG4gICAgcGVlckNvbm5lY3Rpb24uZ2V0U2VuZGVycygpLmZvckVhY2goZnVuY3Rpb24oc2VuZGVyKSB7XG4gICAgICBpZiAoc2VuZGVyLnRyYWNrLmtpbmQgPT09ICdhdWRpbycpIHtcbiAgICAgICAgc2VsZi5sb2NhbFRyYWNrSWRzLmF1ZGlvID0gc2VuZGVyLnRyYWNrLmlkO1xuICAgICAgfSBlbHNlIGlmIChzZW5kZXIudHJhY2sua2luZCA9PT0gJ3ZpZGVvJykge1xuICAgICAgICBzZWxmLmxvY2FsVHJhY2tJZHMudmlkZW8gPSBzZW5kZXIudHJhY2suaWQ7XG4gICAgICB9XG4gICAgfS5iaW5kKHNlbGYpKTtcblxuICAgIGlmIChwZWVyQ29ubmVjdGlvbjIpIHtcbiAgICAgIHBlZXJDb25uZWN0aW9uMi5nZXRSZWNlaXZlcnMoKS5mb3JFYWNoKGZ1bmN0aW9uKHJlY2VpdmVyKSB7XG4gICAgICAgIGlmIChyZWNlaXZlci50cmFjay5raW5kID09PSAnYXVkaW8nKSB7XG4gICAgICAgICAgc2VsZi5yZW1vdGVUcmFja0lkcy5hdWRpbyA9IHJlY2VpdmVyLnRyYWNrLmlkO1xuICAgICAgICB9IGVsc2UgaWYgKHJlY2VpdmVyLnRyYWNrLmtpbmQgPT09ICd2aWRlbycpIHtcbiAgICAgICAgICBzZWxmLnJlbW90ZVRyYWNrSWRzLnZpZGVvID0gcmVjZWl2ZXIudHJhY2suaWQ7XG4gICAgICAgIH1cbiAgICAgIH0uYmluZChzZWxmKSk7XG4gICAgfVxuXG4gICAgdGhpcy5zdGF0c0dhdGhlcmluZ1J1bm5pbmcgPSB0cnVlO1xuICAgIGdldFN0YXRzXygpO1xuXG4gICAgZnVuY3Rpb24gZ2V0U3RhdHNfKCkge1xuICAgICAgaWYgKHBlZXJDb25uZWN0aW9uLnNpZ25hbGluZ1N0YXRlID09PSAnY2xvc2VkJykge1xuICAgICAgICBzZWxmLnN0YXRzR2F0aGVyaW5nUnVubmluZyA9IGZhbHNlO1xuICAgICAgICBzdGF0c0NiKHN0YXRzLCBzdGF0c0NvbGxlY3RUaW1lLCBzdGF0czIsIHN0YXRzQ29sbGVjdFRpbWUyKTtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuICAgICAgcGVlckNvbm5lY3Rpb24uZ2V0U3RhdHMoKVxuICAgICAgICAgIC50aGVuKGdvdFN0YXRzXylcbiAgICAgICAgICAuY2F0Y2goZnVuY3Rpb24oZXJyb3IpIHtcbiAgICAgICAgICAgIHNlbGYudGVzdC5yZXBvcnRFcnJvcignQ291bGQgbm90IGdhdGhlciBzdGF0czogJyArIGVycm9yKTtcbiAgICAgICAgICAgIHNlbGYuc3RhdHNHYXRoZXJpbmdSdW5uaW5nID0gZmFsc2U7XG4gICAgICAgICAgICBzdGF0c0NiKHN0YXRzLCBzdGF0c0NvbGxlY3RUaW1lKTtcbiAgICAgICAgICB9LmJpbmQoc2VsZikpO1xuICAgICAgaWYgKHBlZXJDb25uZWN0aW9uMikge1xuICAgICAgICBwZWVyQ29ubmVjdGlvbjIuZ2V0U3RhdHMoKVxuICAgICAgICAgICAgLnRoZW4oZ290U3RhdHMyXyk7XG4gICAgICB9XG4gICAgfVxuICAgIC8vIFN0YXRzIGZvciBwYzIsIHNvbWUgc3RhdHMgYXJlIG9ubHkgYXZhaWxhYmxlIG9uIHRoZSByZWNlaXZpbmcgZW5kIG9mIGFcbiAgICAvLyBwZWVyY29ubmVjdGlvbi5cbiAgICBmdW5jdGlvbiBnb3RTdGF0czJfKHJlc3BvbnNlKSB7XG4gICAgICBpZiAoYWRhcHRlci5icm93c2VyRGV0YWlscy5icm93c2VyID09PSAnY2hyb21lJykge1xuICAgICAgICB2YXIgZW51bWVyYXRlZFN0YXRzID0gZW51bWVyYXRlU3RhdHMocmVzcG9uc2UsIHNlbGYubG9jYWxUcmFja0lkcyxcbiAgICAgICAgICAgIHNlbGYucmVtb3RlVHJhY2tJZHMpO1xuICAgICAgICBzdGF0czIucHVzaChlbnVtZXJhdGVkU3RhdHMpO1xuICAgICAgICBzdGF0c0NvbGxlY3RUaW1lMi5wdXNoKERhdGUubm93KCkpO1xuICAgICAgfSBlbHNlIGlmIChhZGFwdGVyLmJyb3dzZXJEZXRhaWxzLmJyb3dzZXIgPT09ICdmaXJlZm94Jykge1xuICAgICAgICBmb3IgKHZhciBoIGluIHJlc3BvbnNlKSB7XG4gICAgICAgICAgdmFyIHN0YXQgPSByZXNwb25zZVtoXTtcbiAgICAgICAgICBzdGF0czIucHVzaChzdGF0KTtcbiAgICAgICAgICBzdGF0c0NvbGxlY3RUaW1lMi5wdXNoKERhdGUubm93KCkpO1xuICAgICAgICB9XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBzZWxmLnRlc3QucmVwb3J0RXJyb3IoJ09ubHkgRmlyZWZveCBhbmQgQ2hyb21lIGdldFN0YXRzICcgK1xuICAgICAgICAgICAgJ2ltcGxlbWVudGF0aW9ucyBhcmUgc3VwcG9ydGVkLicpO1xuICAgICAgfVxuICAgIH1cblxuICAgIGZ1bmN0aW9uIGdvdFN0YXRzXyhyZXNwb25zZSkge1xuICAgICAgLy8gVE9ETzogUmVtb3ZlIGJyb3dzZXIgc3BlY2lmaWMgc3RhdHMgZ2F0aGVyaW5nIGhhY2sgb25jZSBhZGFwdGVyLmpzIG9yXG4gICAgICAvLyBicm93c2VycyBjb252ZXJnZSBvbiBhIHN0YW5kYXJkLlxuICAgICAgaWYgKGFkYXB0ZXIuYnJvd3NlckRldGFpbHMuYnJvd3NlciA9PT0gJ2Nocm9tZScpIHtcbiAgICAgICAgdmFyIGVudW1lcmF0ZWRTdGF0cyA9IGVudW1lcmF0ZVN0YXRzKHJlc3BvbnNlLCBzZWxmLmxvY2FsVHJhY2tJZHMsXG4gICAgICAgICAgICBzZWxmLnJlbW90ZVRyYWNrSWRzKTtcbiAgICAgICAgc3RhdHMucHVzaChlbnVtZXJhdGVkU3RhdHMpO1xuICAgICAgICBzdGF0c0NvbGxlY3RUaW1lLnB1c2goRGF0ZS5ub3coKSk7XG4gICAgICB9IGVsc2UgaWYgKGFkYXB0ZXIuYnJvd3NlckRldGFpbHMuYnJvd3NlciA9PT0gJ2ZpcmVmb3gnKSB7XG4gICAgICAgIGZvciAodmFyIGogaW4gcmVzcG9uc2UpIHtcbiAgICAgICAgICB2YXIgc3RhdCA9IHJlc3BvbnNlW2pdO1xuICAgICAgICAgIHN0YXRzLnB1c2goc3RhdCk7XG4gICAgICAgICAgc3RhdHNDb2xsZWN0VGltZS5wdXNoKERhdGUubm93KCkpO1xuICAgICAgICB9XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBzZWxmLnRlc3QucmVwb3J0RXJyb3IoJ09ubHkgRmlyZWZveCBhbmQgQ2hyb21lIGdldFN0YXRzICcgK1xuICAgICAgICAgICAgJ2ltcGxlbWVudGF0aW9ucyBhcmUgc3VwcG9ydGVkLicpO1xuICAgICAgfVxuICAgICAgc2V0VGltZW91dChnZXRTdGF0c18sIHN0YXRTdGVwTXMpO1xuICAgIH1cbiAgfSxcblxuICBnb3RPZmZlcl86IGZ1bmN0aW9uKG9mZmVyKSB7XG4gICAgaWYgKHRoaXMuY29uc3RyYWluT2ZmZXJUb1JlbW92ZVZpZGVvRmVjXykge1xuICAgICAgb2ZmZXIuc2RwID0gb2ZmZXIuc2RwLnJlcGxhY2UoLyhtPXZpZGVvIDEgW15cXHJdKykoMTE2IDExNykoXFxyXFxuKS9nLFxuICAgICAgICAgICckMVxcclxcbicpO1xuICAgICAgb2ZmZXIuc2RwID0gb2ZmZXIuc2RwLnJlcGxhY2UoL2E9cnRwbWFwOjExNiByZWRcXC85MDAwMFxcclxcbi9nLCAnJyk7XG4gICAgICBvZmZlci5zZHAgPSBvZmZlci5zZHAucmVwbGFjZSgvYT1ydHBtYXA6MTE3IHVscGZlY1xcLzkwMDAwXFxyXFxuL2csICcnKTtcbiAgICAgIG9mZmVyLnNkcCA9IG9mZmVyLnNkcC5yZXBsYWNlKC9hPXJ0cG1hcDo5OCBydHhcXC85MDAwMFxcclxcbi9nLCAnJyk7XG4gICAgICBvZmZlci5zZHAgPSBvZmZlci5zZHAucmVwbGFjZSgvYT1mbXRwOjk4IGFwdD0xMTZcXHJcXG4vZywgJycpO1xuICAgIH1cbiAgICB0aGlzLnBjMS5zZXRMb2NhbERlc2NyaXB0aW9uKG9mZmVyKTtcbiAgICB0aGlzLnBjMi5zZXRSZW1vdGVEZXNjcmlwdGlvbihvZmZlcik7XG4gICAgdGhpcy5wYzIuY3JlYXRlQW5zd2VyKCkudGhlbihcbiAgICAgICAgdGhpcy5nb3RBbnN3ZXJfLmJpbmQodGhpcyksXG4gICAgICAgIHRoaXMudGVzdC5yZXBvcnRGYXRhbC5iaW5kKHRoaXMudGVzdClcbiAgICApO1xuICB9LFxuXG4gIGdvdEFuc3dlcl86IGZ1bmN0aW9uKGFuc3dlcikge1xuICAgIGlmICh0aGlzLmNvbnN0cmFpblZpZGVvQml0cmF0ZUticHNfKSB7XG4gICAgICBhbnN3ZXIuc2RwID0gYW5zd2VyLnNkcC5yZXBsYWNlKFxuICAgICAgICAgIC9hPW1pZDp2aWRlb1xcclxcbi9nLFxuICAgICAgICAgICdhPW1pZDp2aWRlb1xcclxcbmI9QVM6JyArIHRoaXMuY29uc3RyYWluVmlkZW9CaXRyYXRlS2Jwc18gKyAnXFxyXFxuJyk7XG4gICAgfVxuICAgIHRoaXMucGMyLnNldExvY2FsRGVzY3JpcHRpb24oYW5zd2VyKTtcbiAgICB0aGlzLnBjMS5zZXRSZW1vdGVEZXNjcmlwdGlvbihhbnN3ZXIpO1xuICB9LFxuXG4gIG9uSWNlQ2FuZGlkYXRlXzogZnVuY3Rpb24ob3RoZXJQZWVyLCBldmVudCkge1xuICAgIGlmIChldmVudC5jYW5kaWRhdGUpIHtcbiAgICAgIHZhciBwYXJzZWQgPSBDYWxsLnBhcnNlQ2FuZGlkYXRlKGV2ZW50LmNhbmRpZGF0ZS5jYW5kaWRhdGUpO1xuICAgICAgaWYgKHRoaXMuaWNlQ2FuZGlkYXRlRmlsdGVyXyhwYXJzZWQpKSB7XG4gICAgICAgIG90aGVyUGVlci5hZGRJY2VDYW5kaWRhdGUoZXZlbnQuY2FuZGlkYXRlKTtcbiAgICAgIH1cbiAgICB9XG4gIH1cbn07XG5cbkNhbGwubm9GaWx0ZXIgPSBmdW5jdGlvbigpIHtcbiAgcmV0dXJuIHRydWU7XG59O1xuXG5DYWxsLmlzUmVsYXkgPSBmdW5jdGlvbihjYW5kaWRhdGUpIHtcbiAgcmV0dXJuIGNhbmRpZGF0ZS50eXBlID09PSAncmVsYXknO1xufTtcblxuQ2FsbC5pc05vdEhvc3RDYW5kaWRhdGUgPSBmdW5jdGlvbihjYW5kaWRhdGUpIHtcbiAgcmV0dXJuIGNhbmRpZGF0ZS50eXBlICE9PSAnaG9zdCc7XG59O1xuXG5DYWxsLmlzUmVmbGV4aXZlID0gZnVuY3Rpb24oY2FuZGlkYXRlKSB7XG4gIHJldHVybiBjYW5kaWRhdGUudHlwZSA9PT0gJ3NyZmx4Jztcbn07XG5cbkNhbGwuaXNIb3N0ID0gZnVuY3Rpb24oY2FuZGlkYXRlKSB7XG4gIHJldHVybiBjYW5kaWRhdGUudHlwZSA9PT0gJ2hvc3QnO1xufTtcblxuQ2FsbC5pc0lwdjYgPSBmdW5jdGlvbihjYW5kaWRhdGUpIHtcbiAgcmV0dXJuIGNhbmRpZGF0ZS5hZGRyZXNzLmluZGV4T2YoJzonKSAhPT0gLTE7XG59O1xuXG4vLyBQYXJzZSBhICdjYW5kaWRhdGU6JyBsaW5lIGludG8gYSBKU09OIG9iamVjdC5cbkNhbGwucGFyc2VDYW5kaWRhdGUgPSBmdW5jdGlvbih0ZXh0KSB7XG4gIHZhciBjYW5kaWRhdGVTdHIgPSAnY2FuZGlkYXRlOic7XG4gIHZhciBwb3MgPSB0ZXh0LmluZGV4T2YoY2FuZGlkYXRlU3RyKSArIGNhbmRpZGF0ZVN0ci5sZW5ndGg7XG4gIHZhciBmaWVsZHMgPSB0ZXh0LnN1YnN0cihwb3MpLnNwbGl0KCcgJyk7XG4gIHJldHVybiB7XG4gICAgJ3R5cGUnOiBmaWVsZHNbN10sXG4gICAgJ3Byb3RvY29sJzogZmllbGRzWzJdLFxuICAgICdhZGRyZXNzJzogZmllbGRzWzRdXG4gIH07XG59O1xuXG4vLyBTdG9yZSB0aGUgSUNFIHNlcnZlciByZXNwb25zZSBmcm9tIHRoZSBuZXR3b3JrIHRyYXZlcnNhbCBzZXJ2ZXIuXG5DYWxsLmNhY2hlZEljZVNlcnZlcnNfID0gbnVsbDtcbi8vIEtlZXAgdHJhY2sgb2Ygd2hlbiB0aGUgcmVxdWVzdCB3YXMgbWFkZS5cbkNhbGwuY2FjaGVkSWNlQ29uZmlnRmV0Y2hUaW1lXyA9IG51bGw7XG5cbi8vIEdldCBhIFRVUk4gY29uZmlnLCBlaXRoZXIgZnJvbSBzZXR0aW5ncyBvciBmcm9tIG5ldHdvcmsgdHJhdmVyc2FsIHNlcnZlci5cbkNhbGwuYXN5bmNDcmVhdGVUdXJuQ29uZmlnID0gZnVuY3Rpb24ob25TdWNjZXNzLCBvbkVycm9yKSB7XG4gIHZhciBzZXR0aW5ncyA9IGN1cnJlbnRUZXN0LnNldHRpbmdzO1xuICBpZiAodHlwZW9mKHNldHRpbmdzLnR1cm5VUkkpID09PSAnc3RyaW5nJyAmJiBzZXR0aW5ncy50dXJuVVJJICE9PSAnJykge1xuICAgIHZhciBpY2VTZXJ2ZXIgPSB7XG4gICAgICAndXNlcm5hbWUnOiBzZXR0aW5ncy50dXJuVXNlcm5hbWUgfHwgJycsXG4gICAgICAnY3JlZGVudGlhbCc6IHNldHRpbmdzLnR1cm5DcmVkZW50aWFsIHx8ICcnLFxuICAgICAgJ3VybHMnOiBzZXR0aW5ncy50dXJuVVJJLnNwbGl0KCcsJylcbiAgICB9O1xuICAgIHZhciBjb25maWcgPSB7J2ljZVNlcnZlcnMnOiBbaWNlU2VydmVyXX07XG4gICAgcmVwb3J0LnRyYWNlRXZlbnRJbnN0YW50KCd0dXJuLWNvbmZpZycsIGNvbmZpZyk7XG4gICAgc2V0VGltZW91dChvblN1Y2Nlc3MuYmluZChudWxsLCBjb25maWcpLCAwKTtcbiAgfSBlbHNlIHtcbiAgICBDYWxsLmZldGNoVHVybkNvbmZpZ18oZnVuY3Rpb24ocmVzcG9uc2UpIHtcbiAgICAgIHZhciBjb25maWcgPSB7J2ljZVNlcnZlcnMnOiByZXNwb25zZS5pY2VTZXJ2ZXJzfTtcbiAgICAgIHJlcG9ydC50cmFjZUV2ZW50SW5zdGFudCgndHVybi1jb25maWcnLCBjb25maWcpO1xuICAgICAgb25TdWNjZXNzKGNvbmZpZyk7XG4gICAgfSwgb25FcnJvcik7XG4gIH1cbn07XG5cbi8vIEdldCBhIFNUVU4gY29uZmlnLCBlaXRoZXIgZnJvbSBzZXR0aW5ncyBvciBmcm9tIG5ldHdvcmsgdHJhdmVyc2FsIHNlcnZlci5cbkNhbGwuYXN5bmNDcmVhdGVTdHVuQ29uZmlnID0gZnVuY3Rpb24ob25TdWNjZXNzLCBvbkVycm9yKSB7XG4gIHZhciBzZXR0aW5ncyA9IGN1cnJlbnRUZXN0LnNldHRpbmdzO1xuICBpZiAodHlwZW9mKHNldHRpbmdzLnN0dW5VUkkpID09PSAnc3RyaW5nJyAmJiBzZXR0aW5ncy5zdHVuVVJJICE9PSAnJykge1xuICAgIHZhciBpY2VTZXJ2ZXIgPSB7XG4gICAgICAndXJscyc6IHNldHRpbmdzLnN0dW5VUkkuc3BsaXQoJywnKVxuICAgIH07XG4gICAgdmFyIGNvbmZpZyA9IHsnaWNlU2VydmVycyc6IFtpY2VTZXJ2ZXJdfTtcbiAgICByZXBvcnQudHJhY2VFdmVudEluc3RhbnQoJ3N0dW4tY29uZmlnJywgY29uZmlnKTtcbiAgICBzZXRUaW1lb3V0KG9uU3VjY2Vzcy5iaW5kKG51bGwsIGNvbmZpZyksIDApO1xuICB9IGVsc2Uge1xuICAgIENhbGwuZmV0Y2hUdXJuQ29uZmlnXyhmdW5jdGlvbihyZXNwb25zZSkge1xuICAgICAgdmFyIGNvbmZpZyA9IHsnaWNlU2VydmVycyc6IHJlc3BvbnNlLmljZVNlcnZlcnMudXJsc307XG4gICAgICByZXBvcnQudHJhY2VFdmVudEluc3RhbnQoJ3N0dW4tY29uZmlnJywgY29uZmlnKTtcbiAgICAgIG9uU3VjY2Vzcyhjb25maWcpO1xuICAgIH0sIG9uRXJyb3IpO1xuICB9XG59O1xuXG4vLyBBc2sgbmV0d29yayB0cmF2ZXJzYWwgQVBJIHRvIGdpdmUgdXMgVFVSTiBzZXJ2ZXIgY3JlZGVudGlhbHMgYW5kIFVSTHMuXG5DYWxsLmZldGNoVHVybkNvbmZpZ18gPSBmdW5jdGlvbihvblN1Y2Nlc3MsIG9uRXJyb3IpIHtcbiAgLy8gQ2hlY2sgaWYgY3JlZGVudGlhbHMgZXhpc3Qgb3IgaGF2ZSBleHBpcmVkIChhbmQgc3VidHJhY3QgdGVzdFJ1bnRUSW1lIHNvXG4gIC8vIHRoYXQgdGhlIHRlc3QgY2FuIGZpbmlzaCBpZiBuZWFyIHRoZSBlbmQgb2YgdGhlIGxpZmV0aW1lIGR1cmF0aW9uKS5cbiAgLy8gbGlmZXRpbWVEdXJhdGlvbiBpcyBpbiBzZWNvbmRzLlxuICB2YXIgdGVzdFJ1blRpbWUgPSAyNDA7IC8vIFRpbWUgaW4gc2Vjb25kcyB0byBhbGxvdyBhIHRlc3QgcnVuIHRvIGNvbXBsZXRlLlxuICBpZiAoQ2FsbC5jYWNoZWRJY2VTZXJ2ZXJzXykge1xuICAgIHZhciBpc0NhY2hlZEljZUNvbmZpZ0V4cGlyZWQgPVxuICAgICAgKChEYXRlLm5vdygpIC0gQ2FsbC5jYWNoZWRJY2VDb25maWdGZXRjaFRpbWVfKSAvIDEwMDAgPlxuICAgICAgcGFyc2VJbnQoQ2FsbC5jYWNoZWRJY2VTZXJ2ZXJzXy5saWZldGltZUR1cmF0aW9uKSAtIHRlc3RSdW5UaW1lKTtcbiAgICBpZiAoIWlzQ2FjaGVkSWNlQ29uZmlnRXhwaXJlZCkge1xuICAgICAgcmVwb3J0LnRyYWNlRXZlbnRJbnN0YW50KCdmZXRjaC1pY2UtY29uZmlnJywgJ1VzaW5nIGNhY2hlZCBjcmVkZW50aWFscy4nKTtcbiAgICAgIG9uU3VjY2VzcyhDYWxsLmdldENhY2hlZEljZUNyZWRlbnRpYWxzXygpKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gIH1cblxuICB2YXIgeGhyID0gbmV3IFhNTEh0dHBSZXF1ZXN0KCk7XG4gIGZ1bmN0aW9uIG9uUmVzdWx0KCkge1xuICAgIGlmICh4aHIucmVhZHlTdGF0ZSAhPT0gNCkge1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGlmICh4aHIuc3RhdHVzICE9PSAyMDApIHtcbiAgICAgIG9uRXJyb3IoJ1RVUk4gcmVxdWVzdCBmYWlsZWQnKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICB2YXIgcmVzcG9uc2UgPSBKU09OLnBhcnNlKHhoci5yZXNwb25zZVRleHQpO1xuICAgIENhbGwuY2FjaGVkSWNlU2VydmVyc18gPSByZXNwb25zZTtcbiAgICBDYWxsLmdldENhY2hlZEljZUNyZWRlbnRpYWxzXyA9IGZ1bmN0aW9uKCkge1xuICAgICAgLy8gTWFrZSBhIG5ldyBvYmplY3QgZHVlIHRvIHRlc3RzIG1vZGlmeWluZyB0aGUgb3JpZ2luYWwgcmVzcG9uc2Ugb2JqZWN0LlxuICAgICAgcmV0dXJuIEpTT04ucGFyc2UoSlNPTi5zdHJpbmdpZnkoQ2FsbC5jYWNoZWRJY2VTZXJ2ZXJzXykpO1xuICAgIH07XG4gICAgQ2FsbC5jYWNoZWRJY2VDb25maWdGZXRjaFRpbWVfID0gRGF0ZS5ub3coKTtcbiAgICByZXBvcnQudHJhY2VFdmVudEluc3RhbnQoJ2ZldGNoLWljZS1jb25maWcnLCAnRmV0Y2hpbmcgbmV3IGNyZWRlbnRpYWxzLicpO1xuICAgIG9uU3VjY2VzcyhDYWxsLmdldENhY2hlZEljZUNyZWRlbnRpYWxzXygpKTtcbiAgfVxuXG4gIHhoci5vbnJlYWR5c3RhdGVjaGFuZ2UgPSBvblJlc3VsdDtcbiAgLy8gQVBJX0tFWSBhbmQgVFVSTl9VUkwgaXMgcmVwbGFjZWQgd2l0aCBBUElfS0VZIGVudmlyb25tZW50IHZhcmlhYmxlIHZpYVxuICAvLyBHcnVudGZpbGUuanMgZHVyaW5nIGJ1aWxkIHRpbWUgYnkgdWdsaWZ5SlMuXG4gIHhoci5vcGVuKCdQT1NUJywgVFVSTl9VUkwgKyBBUElfS0VZLCB0cnVlKTtcbiAgeGhyLnNlbmQoKTtcbn07XG5cbmV4cG9ydCBkZWZhdWx0IENhbGw7IiwiLypcbiAqICBDb3B5cmlnaHQgKGMpIDIwMTQgVGhlIFdlYlJUQyBwcm9qZWN0IGF1dGhvcnMuIEFsbCBSaWdodHMgUmVzZXJ2ZWQuXG4gKlxuICogIFVzZSBvZiB0aGlzIHNvdXJjZSBjb2RlIGlzIGdvdmVybmVkIGJ5IGEgQlNELXN0eWxlIGxpY2Vuc2VcbiAqICB0aGF0IGNhbiBiZSBmb3VuZCBpbiB0aGUgTElDRU5TRSBmaWxlIGluIHRoZSByb290IG9mIHRoZSBzb3VyY2VcbiAqICB0cmVlLlxuICovXG4vKiBleHBvcnRlZCByZXBvcnQgKi9cbid1c2Ugc3RyaWN0JztcblxuZnVuY3Rpb24gUmVwb3J0KCkge1xuICB0aGlzLm91dHB1dF8gPSBbXTtcbiAgdGhpcy5uZXh0QXN5bmNJZF8gPSAwO1xuXG4gIC8vIEhvb2sgY29uc29sZS5sb2cgaW50byB0aGUgcmVwb3J0LCBzaW5jZSB0aGF0IGlzIHRoZSBtb3N0IGNvbW1vbiBkZWJ1ZyB0b29sLlxuICB0aGlzLm5hdGl2ZUxvZ18gPSBjb25zb2xlLmxvZy5iaW5kKGNvbnNvbGUpO1xuICBjb25zb2xlLmxvZyA9IHRoaXMubG9nSG9va18uYmluZCh0aGlzKTtcblxuICAvLyBIb29rIHVwIHdpbmRvdy5vbmVycm9yIGxvZ3MgaW50byB0aGUgcmVwb3J0LlxuICB3aW5kb3cuYWRkRXZlbnRMaXN0ZW5lcignZXJyb3InLCB0aGlzLm9uV2luZG93RXJyb3JfLmJpbmQodGhpcykpO1xuXG4gIHRoaXMudHJhY2VFdmVudEluc3RhbnQoJ3N5c3RlbS1pbmZvJywgUmVwb3J0LmdldFN5c3RlbUluZm8oKSk7XG59XG5cblJlcG9ydC5wcm90b3R5cGUgPSB7XG4gIHRyYWNlRXZlbnRJbnN0YW50OiBmdW5jdGlvbihuYW1lLCBhcmdzKSB7XG4gICAgdGhpcy5vdXRwdXRfLnB1c2goeyd0cyc6IERhdGUubm93KCksXG4gICAgICAnbmFtZSc6IG5hbWUsXG4gICAgICAnYXJncyc6IGFyZ3N9KTtcbiAgfSxcblxuICB0cmFjZUV2ZW50V2l0aElkOiBmdW5jdGlvbihuYW1lLCBpZCwgYXJncykge1xuICAgIHRoaXMub3V0cHV0Xy5wdXNoKHsndHMnOiBEYXRlLm5vdygpLFxuICAgICAgJ25hbWUnOiBuYW1lLFxuICAgICAgJ2lkJzogaWQsXG4gICAgICAnYXJncyc6IGFyZ3N9KTtcbiAgfSxcblxuICB0cmFjZUV2ZW50QXN5bmM6IGZ1bmN0aW9uKG5hbWUpIHtcbiAgICByZXR1cm4gdGhpcy50cmFjZUV2ZW50V2l0aElkLmJpbmQodGhpcywgbmFtZSwgdGhpcy5uZXh0QXN5bmNJZF8rKyk7XG4gIH0sXG5cbiAgbG9nVGVzdFJ1blJlc3VsdDogZnVuY3Rpb24odGVzdE5hbWUsIHN0YXR1cykge1xuICAgIC8vIEdvb2dsZSBBbmFseXRpY3MgZXZlbnQgZm9yIHRoZSB0ZXN0IHJlc3VsdCB0byBhbGxvdyB0byB0cmFjayBob3cgdGhlXG4gICAgLy8gdGVzdCBpcyBkb2luZyBpbiB0aGUgd2lsZC5cbiAgICBnYSgnc2VuZCcsIHtcbiAgICAgICdoaXRUeXBlJzogJ2V2ZW50JyxcbiAgICAgICdldmVudENhdGVnb3J5JzogJ1Rlc3QnLFxuICAgICAgJ2V2ZW50QWN0aW9uJzogc3RhdHVzLFxuICAgICAgJ2V2ZW50TGFiZWwnOiB0ZXN0TmFtZSxcbiAgICAgICdub25JbnRlcmFjdGlvbic6IDFcbiAgICB9KTtcbiAgfSxcblxuICBnZW5lcmF0ZTogZnVuY3Rpb24oYnVnRGVzY3JpcHRpb24pIHtcbiAgICB2YXIgaGVhZGVyID0geyd0aXRsZSc6ICdXZWJSVEMgVHJvdWJsZXNob290ZXIgYnVnIHJlcG9ydCcsXG4gICAgICAnZGVzY3JpcHRpb24nOiBidWdEZXNjcmlwdGlvbiB8fCBudWxsfTtcbiAgICByZXR1cm4gdGhpcy5nZXRDb250ZW50XyhoZWFkZXIpO1xuICB9LFxuXG4gIC8vIFJldHVybnMgdGhlIGxvZ3MgaW50byBhIEpTT04gZm9ybWF0ZWQgc3RyaW5nIHRoYXQgaXMgYSBsaXN0IG9mIGV2ZW50c1xuICAvLyBzaW1pbGFyIHRvIHRoZSB3YXkgY2hyb21lIGRldnRvb2xzIGZvcm1hdCB1c2VzLiBUaGUgZmluYWwgc3RyaW5nIGlzXG4gIC8vIG1hbnVhbGx5IGNvbXBvc2VkIHRvIGhhdmUgbmV3bGluZXMgYmV0d2VlbiB0aGUgZW50cmllcyBpcyBiZWluZyBlYXNpZXJcbiAgLy8gdG8gcGFyc2UgYnkgaHVtYW4gZXllcy4gSWYgYSBjb250ZW50SGVhZCBvYmplY3QgYXJndW1lbnQgaXMgcHJvdmlkZWQgaXRcbiAgLy8gd2lsbCBiZSBhZGRlZCBhdCB0aGUgdG9wIG9mIHRoZSBsb2cgZmlsZS5cbiAgZ2V0Q29udGVudF86IGZ1bmN0aW9uKGNvbnRlbnRIZWFkKSB7XG4gICAgdmFyIHN0cmluZ0FycmF5ID0gW107XG4gICAgdGhpcy5hcHBlbmRFdmVudHNBc1N0cmluZ18oW2NvbnRlbnRIZWFkXSB8fCBbXSwgc3RyaW5nQXJyYXkpO1xuICAgIHRoaXMuYXBwZW5kRXZlbnRzQXNTdHJpbmdfKHRoaXMub3V0cHV0Xywgc3RyaW5nQXJyYXkpO1xuICAgIHJldHVybiAnWycgKyBzdHJpbmdBcnJheS5qb2luKCcsXFxuJykgKyAnXSc7XG4gIH0sXG5cbiAgYXBwZW5kRXZlbnRzQXNTdHJpbmdfOiBmdW5jdGlvbihldmVudHMsIG91dHB1dCkge1xuICAgIGZvciAodmFyIGkgPSAwOyBpICE9PSBldmVudHMubGVuZ3RoOyArK2kpIHtcbiAgICAgIG91dHB1dC5wdXNoKEpTT04uc3RyaW5naWZ5KGV2ZW50c1tpXSkpO1xuICAgIH1cbiAgfSxcblxuICBvbldpbmRvd0Vycm9yXzogZnVuY3Rpb24oZXJyb3IpIHtcbiAgICB0aGlzLnRyYWNlRXZlbnRJbnN0YW50KCdlcnJvcicsIHsnbWVzc2FnZSc6IGVycm9yLm1lc3NhZ2UsXG4gICAgICAnZmlsZW5hbWUnOiBlcnJvci5maWxlbmFtZSArICc6JyArXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgZXJyb3IubGluZW5vfSk7XG4gIH0sXG5cbiAgbG9nSG9va186IGZ1bmN0aW9uKCkge1xuICAgIHRoaXMudHJhY2VFdmVudEluc3RhbnQoJ2xvZycsIGFyZ3VtZW50cyk7XG4gICAgdGhpcy5uYXRpdmVMb2dfLmFwcGx5KG51bGwsIGFyZ3VtZW50cyk7XG4gIH1cbn07XG5cbi8qXG4gKiBEZXRlY3RzIHRoZSBydW5uaW5nIGJyb3dzZXIgbmFtZSwgdmVyc2lvbiBhbmQgcGxhdGZvcm0uXG4gKi9cblJlcG9ydC5nZXRTeXN0ZW1JbmZvID0gZnVuY3Rpb24oKSB7XG4gIC8vIENvZGUgaW5zcGlyZWQgYnkgaHR0cDovL2dvby5nbC85ZFpacUUgd2l0aFxuICAvLyBhZGRlZCBzdXBwb3J0IG9mIG1vZGVybiBJbnRlcm5ldCBFeHBsb3JlciB2ZXJzaW9ucyAoVHJpZGVudCkuXG4gIHZhciBhZ2VudCA9IG5hdmlnYXRvci51c2VyQWdlbnQ7XG4gIHZhciBicm93c2VyTmFtZSA9IG5hdmlnYXRvci5hcHBOYW1lO1xuICB2YXIgdmVyc2lvbiA9ICcnICsgcGFyc2VGbG9hdChuYXZpZ2F0b3IuYXBwVmVyc2lvbik7XG4gIHZhciBvZmZzZXROYW1lO1xuICB2YXIgb2Zmc2V0VmVyc2lvbjtcbiAgdmFyIGl4O1xuXG4gIGlmICgob2Zmc2V0VmVyc2lvbiA9IGFnZW50LmluZGV4T2YoJ0Nocm9tZScpKSAhPT0gLTEpIHtcbiAgICBicm93c2VyTmFtZSA9ICdDaHJvbWUnO1xuICAgIHZlcnNpb24gPSBhZ2VudC5zdWJzdHJpbmcob2Zmc2V0VmVyc2lvbiArIDcpO1xuICB9IGVsc2UgaWYgKChvZmZzZXRWZXJzaW9uID0gYWdlbnQuaW5kZXhPZignTVNJRScpKSAhPT0gLTEpIHtcbiAgICBicm93c2VyTmFtZSA9ICdNaWNyb3NvZnQgSW50ZXJuZXQgRXhwbG9yZXInOyAvLyBPbGRlciBJRSB2ZXJzaW9ucy5cbiAgICB2ZXJzaW9uID0gYWdlbnQuc3Vic3RyaW5nKG9mZnNldFZlcnNpb24gKyA1KTtcbiAgfSBlbHNlIGlmICgob2Zmc2V0VmVyc2lvbiA9IGFnZW50LmluZGV4T2YoJ1RyaWRlbnQnKSkgIT09IC0xKSB7XG4gICAgYnJvd3Nlck5hbWUgPSAnTWljcm9zb2Z0IEludGVybmV0IEV4cGxvcmVyJzsgLy8gTmV3ZXIgSUUgdmVyc2lvbnMuXG4gICAgdmVyc2lvbiA9IGFnZW50LnN1YnN0cmluZyhvZmZzZXRWZXJzaW9uICsgOCk7XG4gIH0gZWxzZSBpZiAoKG9mZnNldFZlcnNpb24gPSBhZ2VudC5pbmRleE9mKCdGaXJlZm94JykpICE9PSAtMSkge1xuICAgIGJyb3dzZXJOYW1lID0gJ0ZpcmVmb3gnO1xuICB9IGVsc2UgaWYgKChvZmZzZXRWZXJzaW9uID0gYWdlbnQuaW5kZXhPZignU2FmYXJpJykpICE9PSAtMSkge1xuICAgIGJyb3dzZXJOYW1lID0gJ1NhZmFyaSc7XG4gICAgdmVyc2lvbiA9IGFnZW50LnN1YnN0cmluZyhvZmZzZXRWZXJzaW9uICsgNyk7XG4gICAgaWYgKChvZmZzZXRWZXJzaW9uID0gYWdlbnQuaW5kZXhPZignVmVyc2lvbicpKSAhPT0gLTEpIHtcbiAgICAgIHZlcnNpb24gPSBhZ2VudC5zdWJzdHJpbmcob2Zmc2V0VmVyc2lvbiArIDgpO1xuICAgIH1cbiAgfSBlbHNlIGlmICgob2Zmc2V0TmFtZSA9IGFnZW50Lmxhc3RJbmRleE9mKCcgJykgKyAxKSA8XG4gICAgICAgICAgICAgIChvZmZzZXRWZXJzaW9uID0gYWdlbnQubGFzdEluZGV4T2YoJy8nKSkpIHtcbiAgICAvLyBGb3Igb3RoZXIgYnJvd3NlcnMgJ25hbWUvdmVyc2lvbicgaXMgYXQgdGhlIGVuZCBvZiB1c2VyQWdlbnRcbiAgICBicm93c2VyTmFtZSA9IGFnZW50LnN1YnN0cmluZyhvZmZzZXROYW1lLCBvZmZzZXRWZXJzaW9uKTtcbiAgICB2ZXJzaW9uID0gYWdlbnQuc3Vic3RyaW5nKG9mZnNldFZlcnNpb24gKyAxKTtcbiAgICBpZiAoYnJvd3Nlck5hbWUudG9Mb3dlckNhc2UoKSA9PT0gYnJvd3Nlck5hbWUudG9VcHBlckNhc2UoKSkge1xuICAgICAgYnJvd3Nlck5hbWUgPSBuYXZpZ2F0b3IuYXBwTmFtZTtcbiAgICB9XG4gIH0gLy8gVHJpbSB0aGUgdmVyc2lvbiBzdHJpbmcgYXQgc2VtaWNvbG9uL3NwYWNlIGlmIHByZXNlbnQuXG4gIGlmICgoaXggPSB2ZXJzaW9uLmluZGV4T2YoJzsnKSkgIT09IC0xKSB7XG4gICAgdmVyc2lvbiA9IHZlcnNpb24uc3Vic3RyaW5nKDAsIGl4KTtcbiAgfVxuICBpZiAoKGl4ID0gdmVyc2lvbi5pbmRleE9mKCcgJykpICE9PSAtMSkge1xuICAgIHZlcnNpb24gPSB2ZXJzaW9uLnN1YnN0cmluZygwLCBpeCk7XG4gIH1cbiAgcmV0dXJuIHsnYnJvd3Nlck5hbWUnOiBicm93c2VyTmFtZSxcbiAgICAnYnJvd3NlclZlcnNpb24nOiB2ZXJzaW9uLFxuICAgICdwbGF0Zm9ybSc6IG5hdmlnYXRvci5wbGF0Zm9ybX07XG59O1xuXG52YXIgcmVwb3J0ID0gbmV3IFJlcG9ydCgpO1xuIiwiLypcbiAqICBDb3B5cmlnaHQgKGMpIDIwMTQgVGhlIFdlYlJUQyBwcm9qZWN0IGF1dGhvcnMuIEFsbCBSaWdodHMgUmVzZXJ2ZWQuXG4gKlxuICogIFVzZSBvZiB0aGlzIHNvdXJjZSBjb2RlIGlzIGdvdmVybmVkIGJ5IGEgQlNELXN0eWxlIGxpY2Vuc2VcbiAqICB0aGF0IGNhbiBiZSBmb3VuZCBpbiB0aGUgTElDRU5TRSBmaWxlIGluIHRoZSByb290IG9mIHRoZSBzb3VyY2VcbiAqICB0cmVlLlxuICovXG4ndXNlIHN0cmljdCc7XG5cbi8qIFRoaXMgaXMgYW4gaW1wbGVtZW50YXRpb24gb2YgdGhlIGFsZ29yaXRobSBmb3IgY2FsY3VsYXRpbmcgdGhlIFN0cnVjdHVyYWxcbiAqIFNJTWlsYXJpdHkgKFNTSU0pIGluZGV4IGJldHdlZW4gdHdvIGltYWdlcy4gUGxlYXNlIHJlZmVyIHRvIHRoZSBhcnRpY2xlIFsxXSxcbiAqIHRoZSB3ZWJzaXRlIFsyXSBhbmQvb3IgdGhlIFdpa2lwZWRpYSBhcnRpY2xlIFszXS4gVGhpcyBjb2RlIHRha2VzIHRoZSB2YWx1ZVxuICogb2YgdGhlIGNvbnN0YW50cyBDMSBhbmQgQzIgZnJvbSB0aGUgTWF0bGFiIGltcGxlbWVudGF0aW9uIGluIFs0XS5cbiAqXG4gKiBbMV0gWi4gV2FuZywgQS4gQy4gQm92aWssIEguIFIuIFNoZWlraCwgYW5kIEUuIFAuIFNpbW9uY2VsbGksIFwiSW1hZ2UgcXVhbGl0eVxuICogYXNzZXNzbWVudDogRnJvbSBlcnJvciBtZWFzdXJlbWVudCB0byBzdHJ1Y3R1cmFsIHNpbWlsYXJpdHlcIixcbiAqIElFRUUgVHJhbnNhY3Rpb25zIG9uIEltYWdlIFByb2Nlc3NpbmcsIHZvbC4gMTMsIG5vLiAxLCBKYW4uIDIwMDQuXG4gKiBbMl0gaHR0cDovL3d3dy5jbnMubnl1LmVkdS9+bGN2L3NzaW0vXG4gKiBbM10gaHR0cDovL2VuLndpa2lwZWRpYS5vcmcvd2lraS9TdHJ1Y3R1cmFsX3NpbWlsYXJpdHlcbiAqIFs0XSBodHRwOi8vd3d3LmNucy5ueXUuZWR1L35sY3Yvc3NpbS9zc2ltX2luZGV4Lm1cbiAqL1xuXG5mdW5jdGlvbiBTc2ltKCkge31cblxuU3NpbS5wcm90b3R5cGUgPSB7XG4gIC8vIEltcGxlbWVudGF0aW9uIG9mIEVxLjIsIGEgc2ltcGxlIGF2ZXJhZ2Ugb2YgYSB2ZWN0b3IgYW5kIEVxLjQuLCBleGNlcHQgdGhlXG4gIC8vIHNxdWFyZSByb290LiBUaGUgbGF0dGVyIGlzIGFjdHVhbGx5IGFuIHVuYmlhc2VkIGVzdGltYXRlIG9mIHRoZSB2YXJpYW5jZSxcbiAgLy8gbm90IHRoZSBleGFjdCB2YXJpYW5jZS5cbiAgc3RhdGlzdGljczogZnVuY3Rpb24oYSkge1xuICAgIHZhciBhY2N1ID0gMDtcbiAgICB2YXIgaTtcbiAgICBmb3IgKGkgPSAwOyBpIDwgYS5sZW5ndGg7ICsraSkge1xuICAgICAgYWNjdSArPSBhW2ldO1xuICAgIH1cbiAgICB2YXIgbWVhbkEgPSBhY2N1IC8gKGEubGVuZ3RoIC0gMSk7XG4gICAgdmFyIGRpZmYgPSAwO1xuICAgIGZvciAoaSA9IDE7IGkgPCBhLmxlbmd0aDsgKytpKSB7XG4gICAgICBkaWZmID0gYVtpIC0gMV0gLSBtZWFuQTtcbiAgICAgIGFjY3UgKz0gYVtpXSArIChkaWZmICogZGlmZik7XG4gICAgfVxuICAgIHJldHVybiB7bWVhbjogbWVhbkEsIHZhcmlhbmNlOiBhY2N1IC8gYS5sZW5ndGh9O1xuICB9LFxuXG4gIC8vIEltcGxlbWVudGF0aW9uIG9mIEVxLjExLiwgY292KFksIFopID0gRSgoWSAtIHVZKSwgKFogLSB1WikpLlxuICBjb3ZhcmlhbmNlOiBmdW5jdGlvbihhLCBiLCBtZWFuQSwgbWVhbkIpIHtcbiAgICB2YXIgYWNjdSA9IDA7XG4gICAgZm9yICh2YXIgaSA9IDA7IGkgPCBhLmxlbmd0aDsgaSArPSAxKSB7XG4gICAgICBhY2N1ICs9IChhW2ldIC0gbWVhbkEpICogKGJbaV0gLSBtZWFuQik7XG4gICAgfVxuICAgIHJldHVybiBhY2N1IC8gYS5sZW5ndGg7XG4gIH0sXG5cbiAgY2FsY3VsYXRlOiBmdW5jdGlvbih4LCB5KSB7XG4gICAgaWYgKHgubGVuZ3RoICE9PSB5Lmxlbmd0aCkge1xuICAgICAgcmV0dXJuIDA7XG4gICAgfVxuXG4gICAgLy8gVmFsdWVzIG9mIHRoZSBjb25zdGFudHMgY29tZSBmcm9tIHRoZSBNYXRsYWIgY29kZSByZWZlcnJlZCBiZWZvcmUuXG4gICAgdmFyIEsxID0gMC4wMTtcbiAgICB2YXIgSzIgPSAwLjAzO1xuICAgIHZhciBMID0gMjU1O1xuICAgIHZhciBDMSA9IChLMSAqIEwpICogKEsxICogTCk7XG4gICAgdmFyIEMyID0gKEsyICogTCkgKiAoSzIgKiBMKTtcbiAgICB2YXIgQzMgPSBDMiAvIDI7XG5cbiAgICB2YXIgc3RhdHNYID0gdGhpcy5zdGF0aXN0aWNzKHgpO1xuICAgIHZhciBtdVggPSBzdGF0c1gubWVhbjtcbiAgICB2YXIgc2lnbWFYMiA9IHN0YXRzWC52YXJpYW5jZTtcbiAgICB2YXIgc2lnbWFYID0gTWF0aC5zcXJ0KHNpZ21hWDIpO1xuICAgIHZhciBzdGF0c1kgPSB0aGlzLnN0YXRpc3RpY3MoeSk7XG4gICAgdmFyIG11WSA9IHN0YXRzWS5tZWFuO1xuICAgIHZhciBzaWdtYVkyID0gc3RhdHNZLnZhcmlhbmNlO1xuICAgIHZhciBzaWdtYVkgPSBNYXRoLnNxcnQoc2lnbWFZMik7XG4gICAgdmFyIHNpZ21hWHkgPSB0aGlzLmNvdmFyaWFuY2UoeCwgeSwgbXVYLCBtdVkpO1xuXG4gICAgLy8gSW1wbGVtZW50YXRpb24gb2YgRXEuNi5cbiAgICB2YXIgbHVtaW5hbmNlID0gKDIgKiBtdVggKiBtdVkgKyBDMSkgL1xuICAgICAgICAoKG11WCAqIG11WCkgKyAobXVZICogbXVZKSArIEMxKTtcbiAgICAvLyBJbXBsZW1lbnRhdGlvbiBvZiBFcS4xMC5cbiAgICB2YXIgc3RydWN0dXJlID0gKHNpZ21hWHkgKyBDMykgLyAoc2lnbWFYICogc2lnbWFZICsgQzMpO1xuICAgIC8vIEltcGxlbWVudGF0aW9uIG9mIEVxLjkuXG4gICAgdmFyIGNvbnRyYXN0ID0gKDIgKiBzaWdtYVggKiBzaWdtYVkgKyBDMikgLyAoc2lnbWFYMiArIHNpZ21hWTIgKyBDMik7XG5cbiAgICAvLyBJbXBsZW1lbnRhdGlvbiBvZiBFcS4xMi5cbiAgICByZXR1cm4gbHVtaW5hbmNlICogY29udHJhc3QgKiBzdHJ1Y3R1cmU7XG4gIH1cbn07XG5cbmlmICh0eXBlb2YgZXhwb3J0cyA9PT0gJ29iamVjdCcpIHtcbiAgbW9kdWxlLmV4cG9ydHMgPSBTc2ltO1xufVxuIiwiLypcbiAqICBDb3B5cmlnaHQgKGMpIDIwMTQgVGhlIFdlYlJUQyBwcm9qZWN0IGF1dGhvcnMuIEFsbCBSaWdodHMgUmVzZXJ2ZWQuXG4gKlxuICogIFVzZSBvZiB0aGlzIHNvdXJjZSBjb2RlIGlzIGdvdmVybmVkIGJ5IGEgQlNELXN0eWxlIGxpY2Vuc2VcbiAqICB0aGF0IGNhbiBiZSBmb3VuZCBpbiB0aGUgTElDRU5TRSBmaWxlIGluIHRoZSByb290IG9mIHRoZSBzb3VyY2VcbiAqICB0cmVlLlxuICovXG4ndXNlIHN0cmljdCc7XG5cbmZ1bmN0aW9uIFN0YXRpc3RpY3NBZ2dyZWdhdGUocmFtcFVwVGhyZXNob2xkKSB7XG4gIHRoaXMuc3RhcnRUaW1lXyA9IDA7XG4gIHRoaXMuc3VtXyA9IDA7XG4gIHRoaXMuY291bnRfID0gMDtcbiAgdGhpcy5tYXhfID0gMDtcbiAgdGhpcy5yYW1wVXBUaHJlc2hvbGRfID0gcmFtcFVwVGhyZXNob2xkO1xuICB0aGlzLnJhbXBVcFRpbWVfID0gSW5maW5pdHk7XG59XG5cblN0YXRpc3RpY3NBZ2dyZWdhdGUucHJvdG90eXBlID0ge1xuICBhZGQ6IGZ1bmN0aW9uKHRpbWUsIGRhdGFwb2ludCkge1xuICAgIGlmICh0aGlzLnN0YXJ0VGltZV8gPT09IDApIHtcbiAgICAgIHRoaXMuc3RhcnRUaW1lXyA9IHRpbWU7XG4gICAgfVxuICAgIHRoaXMuc3VtXyArPSBkYXRhcG9pbnQ7XG4gICAgdGhpcy5tYXhfID0gTWF0aC5tYXgodGhpcy5tYXhfLCBkYXRhcG9pbnQpO1xuICAgIGlmICh0aGlzLnJhbXBVcFRpbWVfID09PSBJbmZpbml0eSAmJlxuICAgICAgICBkYXRhcG9pbnQgPiB0aGlzLnJhbXBVcFRocmVzaG9sZF8pIHtcbiAgICAgIHRoaXMucmFtcFVwVGltZV8gPSB0aW1lO1xuICAgIH1cbiAgICB0aGlzLmNvdW50XysrO1xuICB9LFxuXG4gIGdldEF2ZXJhZ2U6IGZ1bmN0aW9uKCkge1xuICAgIGlmICh0aGlzLmNvdW50XyA9PT0gMCkge1xuICAgICAgcmV0dXJuIDA7XG4gICAgfVxuICAgIHJldHVybiBNYXRoLnJvdW5kKHRoaXMuc3VtXyAvIHRoaXMuY291bnRfKTtcbiAgfSxcblxuICBnZXRNYXg6IGZ1bmN0aW9uKCkge1xuICAgIHJldHVybiB0aGlzLm1heF87XG4gIH0sXG5cbiAgZ2V0UmFtcFVwVGltZTogZnVuY3Rpb24oKSB7XG4gICAgcmV0dXJuIE1hdGgucm91bmQodGhpcy5yYW1wVXBUaW1lXyAtIHRoaXMuc3RhcnRUaW1lXyk7XG4gIH0sXG59O1xuIiwiLypcbiAqICBDb3B5cmlnaHQgKGMpIDIwMTQgVGhlIFdlYlJUQyBwcm9qZWN0IGF1dGhvcnMuIEFsbCBSaWdodHMgUmVzZXJ2ZWQuXG4gKlxuICogIFVzZSBvZiB0aGlzIHNvdXJjZSBjb2RlIGlzIGdvdmVybmVkIGJ5IGEgQlNELXN0eWxlIGxpY2Vuc2VcbiAqICB0aGF0IGNhbiBiZSBmb3VuZCBpbiB0aGUgTElDRU5TRSBmaWxlIGluIHRoZSByb290IG9mIHRoZSBzb3VyY2VcbiAqICB0cmVlLlxuICovXG4ndXNlIHN0cmljdCc7XG4vKiBleHBvcnRlZCBhcnJheUF2ZXJhZ2UsIGFycmF5TWF4LCBhcnJheU1pbiwgZW51bWVyYXRlU3RhdHMgKi9cblxuLy8gYXJyYXk8ZnVuY3Rpb24+IHJldHVybnMgdGhlIGF2ZXJhZ2UgKGRvd24gdG8gbmVhcmVzdCBpbnQpLCBtYXggYW5kIG1pbiBvZlxuLy8gYW4gaW50IGFycmF5LlxuZnVuY3Rpb24gYXJyYXlBdmVyYWdlKGFycmF5KSB7XG4gIHZhciBjbnQgPSBhcnJheS5sZW5ndGg7XG4gIHZhciB0b3QgPSAwO1xuICBmb3IgKHZhciBpID0gMDsgaSA8IGNudDsgaSsrKSB7XG4gICAgdG90ICs9IGFycmF5W2ldO1xuICB9XG4gIHJldHVybiBNYXRoLmZsb29yKHRvdCAvIGNudCk7XG59XG5cbmZ1bmN0aW9uIGFycmF5TWF4KGFycmF5KSB7XG4gIGlmIChhcnJheS5sZW5ndGggPT09IDApIHtcbiAgICByZXR1cm4gTmFOO1xuICB9XG4gIHJldHVybiBNYXRoLm1heC5hcHBseShNYXRoLCBhcnJheSk7XG59XG5cbmZ1bmN0aW9uIGFycmF5TWluKGFycmF5KSB7XG4gIGlmIChhcnJheS5sZW5ndGggPT09IDApIHtcbiAgICByZXR1cm4gTmFOO1xuICB9XG4gIHJldHVybiBNYXRoLm1pbi5hcHBseShNYXRoLCBhcnJheSk7XG59XG5cbi8vIEVudW1lcmF0ZXMgdGhlIG5ldyBzdGFuZGFyZCBjb21wbGlhbnQgc3RhdHMgdXNpbmcgbG9jYWwgYW5kIHJlbW90ZSB0cmFjayBpZHMuXG5mdW5jdGlvbiBlbnVtZXJhdGVTdGF0cyhzdGF0cywgbG9jYWxUcmFja0lkcywgcmVtb3RlVHJhY2tJZHMpIHtcbiAgLy8gQ3JlYXRlIGFuIG9iamVjdCBzdHJ1Y3R1cmUgd2l0aCBhbGwgdGhlIG5lZWRlZCBzdGF0cyBhbmQgdHlwZXMgdGhhdCB3ZSBjYXJlXG4gIC8vIGFib3V0LiBUaGlzIGFsbG93cyB0byBtYXAgdGhlIGdldFN0YXRzIHN0YXRzIHRvIG90aGVyIHN0YXRzIG5hbWVzLlxuICB2YXIgc3RhdHNPYmplY3QgPSB7XG4gICAgYXVkaW86IHtcbiAgICAgIGxvY2FsOiB7XG4gICAgICAgIGF1ZGlvTGV2ZWw6IDAuMCxcbiAgICAgICAgYnl0ZXNTZW50OiAwLFxuICAgICAgICBjbG9ja1JhdGU6IDAsXG4gICAgICAgIGNvZGVjSWQ6ICcnLFxuICAgICAgICBtaW1lVHlwZTogJycsXG4gICAgICAgIHBhY2tldHNTZW50OiAwLFxuICAgICAgICBwYXlsb2FkVHlwZTogMCxcbiAgICAgICAgdGltZXN0YW1wOiAwLjAsXG4gICAgICAgIHRyYWNrSWQ6ICcnLFxuICAgICAgICB0cmFuc3BvcnRJZDogJycsXG4gICAgICB9LFxuICAgICAgcmVtb3RlOiB7XG4gICAgICAgIGF1ZGlvTGV2ZWw6IDAuMCxcbiAgICAgICAgYnl0ZXNSZWNlaXZlZDogMCxcbiAgICAgICAgY2xvY2tSYXRlOiAwLFxuICAgICAgICBjb2RlY0lkOiAnJyxcbiAgICAgICAgZnJhY3Rpb25Mb3N0OiAwLFxuICAgICAgICBqaXR0ZXI6IDAsXG4gICAgICAgIG1pbWVUeXBlOiAnJyxcbiAgICAgICAgcGFja2V0c0xvc3Q6IC0xLFxuICAgICAgICBwYWNrZXRzUmVjZWl2ZWQ6IDAsXG4gICAgICAgIHBheWxvYWRUeXBlOiAwLFxuICAgICAgICB0aW1lc3RhbXA6IDAuMCxcbiAgICAgICAgdHJhY2tJZDogJycsXG4gICAgICAgIHRyYW5zcG9ydElkOiAnJyxcbiAgICAgIH1cbiAgICB9LFxuICAgIHZpZGVvOiB7XG4gICAgICBsb2NhbDoge1xuICAgICAgICBieXRlc1NlbnQ6IDAsXG4gICAgICAgIGNsb2NrUmF0ZTogMCxcbiAgICAgICAgY29kZWNJZDogJycsXG4gICAgICAgIGZpckNvdW50OiAwLFxuICAgICAgICBmcmFtZXNFbmNvZGVkOiAwLFxuICAgICAgICBmcmFtZUhlaWdodDogMCxcbiAgICAgICAgZnJhbWVzU2VudDogLTEsXG4gICAgICAgIGZyYW1lV2lkdGg6IDAsXG4gICAgICAgIG5hY2tDb3VudDogMCxcbiAgICAgICAgcGFja2V0c1NlbnQ6IC0xLFxuICAgICAgICBwYXlsb2FkVHlwZTogMCxcbiAgICAgICAgcGxpQ291bnQ6IDAsXG4gICAgICAgIHFwU3VtOiAwLFxuICAgICAgICB0aW1lc3RhbXA6IDAuMCxcbiAgICAgICAgdHJhY2tJZDogJycsXG4gICAgICAgIHRyYW5zcG9ydElkOiAnJyxcbiAgICAgIH0sXG4gICAgICByZW1vdGU6IHtcbiAgICAgICAgYnl0ZXNSZWNlaXZlZDogLTEsXG4gICAgICAgIGNsb2NrUmF0ZTogMCxcbiAgICAgICAgY29kZWNJZDogJycsXG4gICAgICAgIGZpckNvdW50OiAtMSxcbiAgICAgICAgZnJhY3Rpb25Mb3N0OiAwLFxuICAgICAgICBmcmFtZUhlaWdodDogMCxcbiAgICAgICAgZnJhbWVzRGVjb2RlZDogMCxcbiAgICAgICAgZnJhbWVzRHJvcHBlZDogMCxcbiAgICAgICAgZnJhbWVzUmVjZWl2ZWQ6IDAsXG4gICAgICAgIGZyYW1lV2lkdGg6IDAsXG4gICAgICAgIG5hY2tDb3VudDogLTEsXG4gICAgICAgIHBhY2tldHNMb3N0OiAtMSxcbiAgICAgICAgcGFja2V0c1JlY2VpdmVkOiAwLFxuICAgICAgICBwYXlsb2FkVHlwZTogMCxcbiAgICAgICAgcGxpQ291bnQ6IC0xLFxuICAgICAgICBxcFN1bTogMCxcbiAgICAgICAgdGltZXN0YW1wOiAwLjAsXG4gICAgICAgIHRyYWNrSWQ6ICcnLFxuICAgICAgICB0cmFuc3BvcnRJZDogJycsXG4gICAgICB9XG4gICAgfSxcbiAgICBjb25uZWN0aW9uOiB7XG4gICAgICBhdmFpbGFibGVPdXRnb2luZ0JpdHJhdGU6IDAsXG4gICAgICBieXRlc1JlY2VpdmVkOiAwLFxuICAgICAgYnl0ZXNTZW50OiAwLFxuICAgICAgY29uc2VudFJlcXVlc3RzU2VudDogMCxcbiAgICAgIGN1cnJlbnRSb3VuZFRyaXBUaW1lOiAwLjAsXG4gICAgICBsb2NhbENhbmRpZGF0ZUlkOiAnJyxcbiAgICAgIGxvY2FsQ2FuZGlkYXRlVHlwZTogJycsXG4gICAgICBsb2NhbElwOiAnJyxcbiAgICAgIGxvY2FsUG9ydDogMCxcbiAgICAgIGxvY2FsUHJpb3JpdHk6IDAsXG4gICAgICBsb2NhbFByb3RvY29sOiAnJyxcbiAgICAgIHJlbW90ZUNhbmRpZGF0ZUlkOiAnJyxcbiAgICAgIHJlbW90ZUNhbmRpZGF0ZVR5cGU6ICcnLFxuICAgICAgcmVtb3RlSXA6ICcnLFxuICAgICAgcmVtb3RlUG9ydDogMCxcbiAgICAgIHJlbW90ZVByaW9yaXR5OiAwLFxuICAgICAgcmVtb3RlUHJvdG9jb2w6ICcnLFxuICAgICAgcmVxdWVzdHNSZWNlaXZlZDogMCxcbiAgICAgIHJlcXVlc3RzU2VudDogMCxcbiAgICAgIHJlc3BvbnNlc1JlY2VpdmVkOiAwLFxuICAgICAgcmVzcG9uc2VzU2VudDogMCxcbiAgICAgIHRpbWVzdGFtcDogMC4wLFxuICAgICAgdG90YWxSb3VuZFRyaXBUaW1lOiAwLjAsXG4gICAgfVxuICB9O1xuXG4gIC8vIE5lZWQgdG8gZmluZCB0aGUgY29kZWMsIGxvY2FsIGFuZCByZW1vdGUgSUQncyBmaXJzdC5cbiAgaWYgKHN0YXRzKSB7XG4gICAgc3RhdHMuZm9yRWFjaChmdW5jdGlvbihyZXBvcnQsIHN0YXQpIHtcbiAgICAgIHN3aXRjaChyZXBvcnQudHlwZSkge1xuICAgICAgICBjYXNlICdvdXRib3VuZC1ydHAnOlxuICAgICAgICAgIGlmIChyZXBvcnQuaGFzT3duUHJvcGVydHkoJ3RyYWNrSWQnKSkge1xuICAgICAgICAgICAgaWYgKHJlcG9ydC50cmFja0lkLmluZGV4T2YobG9jYWxUcmFja0lkcy5hdWRpbykgIT09IDEgJlxuICAgICAgICAgICAgICAgIGxvY2FsVHJhY2tJZHMuYXVkaW8gIT09ICcnKSB7XG4gICAgICAgICAgICAgIHN0YXRzT2JqZWN0LmF1ZGlvLmxvY2FsLmJ5dGVzU2VudCA9IHJlcG9ydC5ieXRlc1NlbnQ7XG4gICAgICAgICAgICAgIHN0YXRzT2JqZWN0LmF1ZGlvLmxvY2FsLmNvZGVjSWQgPSByZXBvcnQuY29kZWNJZDtcbiAgICAgICAgICAgICAgc3RhdHNPYmplY3QuYXVkaW8ubG9jYWwucGFja2V0c1NlbnQgPSByZXBvcnQucGFja2V0c1NlbnQ7XG4gICAgICAgICAgICAgIHN0YXRzT2JqZWN0LmF1ZGlvLmxvY2FsLnRpbWVzdGFtcCA9IHJlcG9ydC50aW1lc3RhbXA7XG4gICAgICAgICAgICAgIHN0YXRzT2JqZWN0LmF1ZGlvLmxvY2FsLnRyYWNrSWQgPSByZXBvcnQudHJhY2tJZDtcbiAgICAgICAgICAgICAgc3RhdHNPYmplY3QuYXVkaW8ubG9jYWwudHJhbnNwb3J0SWQgPSByZXBvcnQudHJhbnNwb3J0SWQ7XG4gICAgICAgICAgICB9IGVsc2UgaWYgKHJlcG9ydC50cmFja0lkLmluZGV4T2YobG9jYWxUcmFja0lkcy52aWRlbykgIT09IDEgJlxuICAgICAgICAgICAgICAgIGxvY2FsVHJhY2tJZHMudmlkZW8gIT09ICcnKSB7XG4gICAgICAgICAgICAgIHN0YXRzT2JqZWN0LnZpZGVvLmxvY2FsLmJ5dGVzU2VudCA9IHJlcG9ydC5ieXRlc1NlbnQ7XG4gICAgICAgICAgICAgIHN0YXRzT2JqZWN0LnZpZGVvLmxvY2FsLmNvZGVjSWQgPSByZXBvcnQuY29kZWNJZDtcbiAgICAgICAgICAgICAgc3RhdHNPYmplY3QudmlkZW8ubG9jYWwuZmlyQ291bnQgPSByZXBvcnQuZmlyQ291bnQ7XG4gICAgICAgICAgICAgIHN0YXRzT2JqZWN0LnZpZGVvLmxvY2FsLmZyYW1lc0VuY29kZWQgPSByZXBvcnQuZnJhbWVzRW5jb2RlZDtcbiAgICAgICAgICAgICAgc3RhdHNPYmplY3QudmlkZW8ubG9jYWwuZnJhbWVzU2VudCA9IHJlcG9ydC5mcmFtZXNTZW50O1xuICAgICAgICAgICAgICBzdGF0c09iamVjdC52aWRlby5sb2NhbC5wYWNrZXRzU2VudCA9IHJlcG9ydC5wYWNrZXRzU2VudDtcbiAgICAgICAgICAgICAgc3RhdHNPYmplY3QudmlkZW8ubG9jYWwucGxpQ291bnQgPSByZXBvcnQucGxpQ291bnQ7XG4gICAgICAgICAgICAgIHN0YXRzT2JqZWN0LnZpZGVvLmxvY2FsLnFwU3VtID0gcmVwb3J0LnFwU3VtO1xuICAgICAgICAgICAgICBzdGF0c09iamVjdC52aWRlby5sb2NhbC50aW1lc3RhbXAgPSByZXBvcnQudGltZXN0YW1wO1xuICAgICAgICAgICAgICBzdGF0c09iamVjdC52aWRlby5sb2NhbC50cmFja0lkID0gcmVwb3J0LnRyYWNrSWQ7XG4gICAgICAgICAgICAgIHN0YXRzT2JqZWN0LnZpZGVvLmxvY2FsLnRyYW5zcG9ydElkID0gcmVwb3J0LnRyYW5zcG9ydElkO1xuICAgICAgICAgICAgfVxuICAgICAgICAgIH1cbiAgICAgICAgICBicmVhaztcbiAgICAgICAgY2FzZSAnaW5ib3VuZC1ydHAnOlxuICAgICAgICAgIGlmIChyZXBvcnQuaGFzT3duUHJvcGVydHkoJ3RyYWNrSWQnKSkge1xuICAgICAgICAgICAgaWYgKHJlcG9ydC50cmFja0lkLmluZGV4T2YocmVtb3RlVHJhY2tJZHMuYXVkaW8pICE9PSAxICZcbiAgICAgICAgICAgICAgICByZW1vdGVUcmFja0lkcy5hdWRpbyAhPT0gJycpIHtcbiAgICAgICAgICAgICAgc3RhdHNPYmplY3QuYXVkaW8ucmVtb3RlLmJ5dGVzUmVjZWl2ZWQgPSByZXBvcnQuYnl0ZXNSZWNlaXZlZDtcbiAgICAgICAgICAgICAgc3RhdHNPYmplY3QuYXVkaW8ucmVtb3RlLmNvZGVjSWQgPSByZXBvcnQuY29kZWNJZDtcbiAgICAgICAgICAgICAgc3RhdHNPYmplY3QuYXVkaW8ucmVtb3RlLmZyYWN0aW9uTG9zdCA9IHJlcG9ydC5mcmFjdGlvbkxvc3Q7XG4gICAgICAgICAgICAgIHN0YXRzT2JqZWN0LmF1ZGlvLnJlbW90ZS5qaXR0ZXIgPSByZXBvcnQuaml0dGVyO1xuICAgICAgICAgICAgICBzdGF0c09iamVjdC5hdWRpby5yZW1vdGUucGFja2V0c0xvc3QgPSByZXBvcnQucGFja2V0c0xvc3Q7XG4gICAgICAgICAgICAgIHN0YXRzT2JqZWN0LmF1ZGlvLnJlbW90ZS5wYWNrZXRzUmVjZWl2ZWQgPSByZXBvcnQucGFja2V0c1JlY2VpdmVkO1xuICAgICAgICAgICAgICBzdGF0c09iamVjdC5hdWRpby5yZW1vdGUudGltZXN0YW1wID0gcmVwb3J0LnRpbWVzdGFtcDtcbiAgICAgICAgICAgICAgc3RhdHNPYmplY3QuYXVkaW8ucmVtb3RlLnRyYWNrSWQgPSByZXBvcnQudHJhY2tJZDtcbiAgICAgICAgICAgICAgc3RhdHNPYmplY3QuYXVkaW8ucmVtb3RlLnRyYW5zcG9ydElkID0gcmVwb3J0LnRyYW5zcG9ydElkO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgaWYgKHJlcG9ydC50cmFja0lkLmluZGV4T2YocmVtb3RlVHJhY2tJZHMudmlkZW8pICE9PSAxICZcbiAgICAgICAgICAgICAgICByZW1vdGVUcmFja0lkcy52aWRlbyAhPT0gJycpIHtcbiAgICAgICAgICAgICAgc3RhdHNPYmplY3QudmlkZW8ucmVtb3RlLmJ5dGVzUmVjZWl2ZWQgPSByZXBvcnQuYnl0ZXNSZWNlaXZlZDtcbiAgICAgICAgICAgICAgc3RhdHNPYmplY3QudmlkZW8ucmVtb3RlLmNvZGVjSWQgPSByZXBvcnQuY29kZWNJZDtcbiAgICAgICAgICAgICAgc3RhdHNPYmplY3QudmlkZW8ucmVtb3RlLmZpckNvdW50ID0gcmVwb3J0LmZpckNvdW50O1xuICAgICAgICAgICAgICBzdGF0c09iamVjdC52aWRlby5yZW1vdGUuZnJhY3Rpb25Mb3N0ID0gcmVwb3J0LmZyYWN0aW9uTG9zdDtcbiAgICAgICAgICAgICAgc3RhdHNPYmplY3QudmlkZW8ucmVtb3RlLm5hY2tDb3VudCA9IHJlcG9ydC5uYWNrQ291bnQ7XG4gICAgICAgICAgICAgIHN0YXRzT2JqZWN0LnZpZGVvLnJlbW90ZS5wYWNrZXRzTG9zdCA9IHJlcG9ydC5wYWNrZXRzTG9zdDtcbiAgICAgICAgICAgICAgc3RhdHNPYmplY3QudmlkZW8ucmVtb3RlLnBhY2tldHNSZWNlaXZlZCA9IHJlcG9ydC5wYWNrZXRzUmVjZWl2ZWQ7XG4gICAgICAgICAgICAgIHN0YXRzT2JqZWN0LnZpZGVvLnJlbW90ZS5wbGlDb3VudCA9IHJlcG9ydC5wbGlDb3VudDtcbiAgICAgICAgICAgICAgc3RhdHNPYmplY3QudmlkZW8ucmVtb3RlLnFwU3VtID0gcmVwb3J0LnFwU3VtO1xuICAgICAgICAgICAgICBzdGF0c09iamVjdC52aWRlby5yZW1vdGUudGltZXN0YW1wID0gcmVwb3J0LnRpbWVzdGFtcDtcbiAgICAgICAgICAgICAgc3RhdHNPYmplY3QudmlkZW8ucmVtb3RlLnRyYWNrSWQgPSByZXBvcnQudHJhY2tJZDtcbiAgICAgICAgICAgICAgc3RhdHNPYmplY3QudmlkZW8ucmVtb3RlLnRyYW5zcG9ydElkID0gcmVwb3J0LnRyYW5zcG9ydElkO1xuICAgICAgICAgICAgfVxuICAgICAgICAgIH1cbiAgICAgICAgICBicmVhaztcbiAgICAgICAgY2FzZSAnY2FuZGlkYXRlLXBhaXInOlxuICAgICAgICAgIGlmIChyZXBvcnQuaGFzT3duUHJvcGVydHkoJ2F2YWlsYWJsZU91dGdvaW5nQml0cmF0ZScpKSB7XG4gICAgICAgICAgICBzdGF0c09iamVjdC5jb25uZWN0aW9uLmF2YWlsYWJsZU91dGdvaW5nQml0cmF0ZSA9XG4gICAgICAgICAgICAgICAgcmVwb3J0LmF2YWlsYWJsZU91dGdvaW5nQml0cmF0ZTtcbiAgICAgICAgICAgIHN0YXRzT2JqZWN0LmNvbm5lY3Rpb24uYnl0ZXNSZWNlaXZlZCA9IHJlcG9ydC5ieXRlc1JlY2VpdmVkO1xuICAgICAgICAgICAgc3RhdHNPYmplY3QuY29ubmVjdGlvbi5ieXRlc1NlbnQgPSByZXBvcnQuYnl0ZXNTZW50O1xuICAgICAgICAgICAgc3RhdHNPYmplY3QuY29ubmVjdGlvbi5jb25zZW50UmVxdWVzdHNTZW50ID1cbiAgICAgICAgICAgICAgICByZXBvcnQuY29uc2VudFJlcXVlc3RzU2VudDtcbiAgICAgICAgICAgIHN0YXRzT2JqZWN0LmNvbm5lY3Rpb24uY3VycmVudFJvdW5kVHJpcFRpbWUgPVxuICAgICAgICAgICAgICAgIHJlcG9ydC5jdXJyZW50Um91bmRUcmlwVGltZTtcbiAgICAgICAgICAgIHN0YXRzT2JqZWN0LmNvbm5lY3Rpb24ubG9jYWxDYW5kaWRhdGVJZCA9IHJlcG9ydC5sb2NhbENhbmRpZGF0ZUlkO1xuICAgICAgICAgICAgc3RhdHNPYmplY3QuY29ubmVjdGlvbi5yZW1vdGVDYW5kaWRhdGVJZCA9IHJlcG9ydC5yZW1vdGVDYW5kaWRhdGVJZDtcbiAgICAgICAgICAgIHN0YXRzT2JqZWN0LmNvbm5lY3Rpb24ucmVxdWVzdHNSZWNlaXZlZCA9IHJlcG9ydC5yZXF1ZXN0c1JlY2VpdmVkO1xuICAgICAgICAgICAgc3RhdHNPYmplY3QuY29ubmVjdGlvbi5yZXF1ZXN0c1NlbnQgPSByZXBvcnQucmVxdWVzdHNTZW50O1xuICAgICAgICAgICAgc3RhdHNPYmplY3QuY29ubmVjdGlvbi5yZXNwb25zZXNSZWNlaXZlZCA9IHJlcG9ydC5yZXNwb25zZXNSZWNlaXZlZDtcbiAgICAgICAgICAgIHN0YXRzT2JqZWN0LmNvbm5lY3Rpb24ucmVzcG9uc2VzU2VudCA9IHJlcG9ydC5yZXNwb25zZXNTZW50O1xuICAgICAgICAgICAgc3RhdHNPYmplY3QuY29ubmVjdGlvbi50aW1lc3RhbXAgPSByZXBvcnQudGltZXN0YW1wO1xuICAgICAgICAgICAgc3RhdHNPYmplY3QuY29ubmVjdGlvbi50b3RhbFJvdW5kVHJpcFRpbWUgPVxuICAgICAgICAgICAgICAgcmVwb3J0LnRvdGFsUm91bmRUcmlwVGltZTtcbiAgICAgICAgICB9XG4gICAgICAgICAgYnJlYWs7XG4gICAgICAgIGRlZmF1bHQ6XG4gICAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuICAgIH0uYmluZCgpKTtcblxuICAgIC8vIFVzaW5nIHRoZSBjb2RlYywgbG9jYWwgYW5kIHJlbW90ZSBjYW5kaWRhdGUgSUQncyB0byBmaW5kIHRoZSByZXN0IG9mIHRoZVxuICAgIC8vIHJlbGV2YW50IHN0YXRzLlxuICAgIHN0YXRzLmZvckVhY2goZnVuY3Rpb24ocmVwb3J0KSB7XG4gICAgICBzd2l0Y2gocmVwb3J0LnR5cGUpIHtcbiAgICAgICAgY2FzZSAndHJhY2snOlxuICAgICAgICAgIGlmIChyZXBvcnQuaGFzT3duUHJvcGVydHkoJ3RyYWNrSWRlbnRpZmllcicpKSB7XG4gICAgICAgICAgICBpZiAocmVwb3J0LnRyYWNrSWRlbnRpZmllci5pbmRleE9mKGxvY2FsVHJhY2tJZHMudmlkZW8pICE9PSAxICZcbiAgICAgICAgICAgICAgICBsb2NhbFRyYWNrSWRzLnZpZGVvICE9PSAnJykge1xuICAgICAgICAgICAgICBzdGF0c09iamVjdC52aWRlby5sb2NhbC5mcmFtZUhlaWdodCA9IHJlcG9ydC5mcmFtZUhlaWdodDtcbiAgICAgICAgICAgICAgc3RhdHNPYmplY3QudmlkZW8ubG9jYWwuZnJhbWVzU2VudCA9IHJlcG9ydC5mcmFtZXNTZW50O1xuICAgICAgICAgICAgICBzdGF0c09iamVjdC52aWRlby5sb2NhbC5mcmFtZVdpZHRoID0gcmVwb3J0LmZyYW1lV2lkdGg7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBpZiAocmVwb3J0LnRyYWNrSWRlbnRpZmllci5pbmRleE9mKHJlbW90ZVRyYWNrSWRzLnZpZGVvKSAhPT0gMSAmXG4gICAgICAgICAgICAgICAgcmVtb3RlVHJhY2tJZHMudmlkZW8gIT09ICcnKSB7XG4gICAgICAgICAgICAgIHN0YXRzT2JqZWN0LnZpZGVvLnJlbW90ZS5mcmFtZUhlaWdodCA9IHJlcG9ydC5mcmFtZUhlaWdodDtcbiAgICAgICAgICAgICAgc3RhdHNPYmplY3QudmlkZW8ucmVtb3RlLmZyYW1lc0RlY29kZWQgPSByZXBvcnQuZnJhbWVzRGVjb2RlZDtcbiAgICAgICAgICAgICAgc3RhdHNPYmplY3QudmlkZW8ucmVtb3RlLmZyYW1lc0Ryb3BwZWQgPSByZXBvcnQuZnJhbWVzRHJvcHBlZDtcbiAgICAgICAgICAgICAgc3RhdHNPYmplY3QudmlkZW8ucmVtb3RlLmZyYW1lc1JlY2VpdmVkID0gcmVwb3J0LmZyYW1lc1JlY2VpdmVkO1xuICAgICAgICAgICAgICBzdGF0c09iamVjdC52aWRlby5yZW1vdGUuZnJhbWVXaWR0aCA9IHJlcG9ydC5mcmFtZVdpZHRoO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgaWYgKHJlcG9ydC50cmFja0lkZW50aWZpZXIuaW5kZXhPZihsb2NhbFRyYWNrSWRzLmF1ZGlvKSAhPT0gMSAmXG4gICAgICAgICAgICAgICAgbG9jYWxUcmFja0lkcy5hdWRpbyAhPT0gJycpIHtcbiAgICAgICAgICAgICAgc3RhdHNPYmplY3QuYXVkaW8ubG9jYWwuYXVkaW9MZXZlbCA9IHJlcG9ydC5hdWRpb0xldmVsIDtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGlmIChyZXBvcnQudHJhY2tJZGVudGlmaWVyLmluZGV4T2YocmVtb3RlVHJhY2tJZHMuYXVkaW8pICE9PSAxICZcbiAgICAgICAgICAgICAgICByZW1vdGVUcmFja0lkcy5hdWRpbyAhPT0gJycpIHtcbiAgICAgICAgICAgICAgc3RhdHNPYmplY3QuYXVkaW8ucmVtb3RlLmF1ZGlvTGV2ZWwgPSByZXBvcnQuYXVkaW9MZXZlbDtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9XG4gICAgICAgICAgYnJlYWs7XG4gICAgICAgIGNhc2UgJ2NvZGVjJzpcbiAgICAgICAgICBpZiAocmVwb3J0Lmhhc093blByb3BlcnR5KCdpZCcpKSB7XG4gICAgICAgICAgICBpZiAocmVwb3J0LmlkLmluZGV4T2Yoc3RhdHNPYmplY3QuYXVkaW8ubG9jYWwuY29kZWNJZCkgIT09IDEgJlxuICAgICAgICAgICAgICAgIGxvY2FsVHJhY2tJZHMuYXVkaW8gIT09ICcnKSB7XG4gICAgICAgICAgICAgIHN0YXRzT2JqZWN0LmF1ZGlvLmxvY2FsLmNsb2NrUmF0ZSA9IHJlcG9ydC5jbG9ja1JhdGU7XG4gICAgICAgICAgICAgIHN0YXRzT2JqZWN0LmF1ZGlvLmxvY2FsLm1pbWVUeXBlID0gcmVwb3J0Lm1pbWVUeXBlO1xuICAgICAgICAgICAgICBzdGF0c09iamVjdC5hdWRpby5sb2NhbC5wYXlsb2FkVHlwZSA9IHJlcG9ydC5wYXlsb2FkVHlwZTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGlmIChyZXBvcnQuaWQuaW5kZXhPZihzdGF0c09iamVjdC5hdWRpby5yZW1vdGUuY29kZWNJZCkgIT09IDEgJlxuICAgICAgICAgICAgICAgIHJlbW90ZVRyYWNrSWRzLmF1ZGlvICE9PSAnJykge1xuICAgICAgICAgICAgICBzdGF0c09iamVjdC5hdWRpby5yZW1vdGUuY2xvY2tSYXRlID0gcmVwb3J0LmNsb2NrUmF0ZTtcbiAgICAgICAgICAgICAgc3RhdHNPYmplY3QuYXVkaW8ucmVtb3RlLm1pbWVUeXBlID0gcmVwb3J0Lm1pbWVUeXBlO1xuICAgICAgICAgICAgICBzdGF0c09iamVjdC5hdWRpby5yZW1vdGUucGF5bG9hZFR5cGUgPSByZXBvcnQucGF5bG9hZFR5cGU7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBpZiAocmVwb3J0LmlkLmluZGV4T2Yoc3RhdHNPYmplY3QudmlkZW8ubG9jYWwuY29kZWNJZCkgIT09IDEgJlxuICAgICAgICAgICAgICAgIGxvY2FsVHJhY2tJZHMudmlkZW8gIT09ICcnKSB7XG4gICAgICAgICAgICAgIHN0YXRzT2JqZWN0LnZpZGVvLmxvY2FsLmNsb2NrUmF0ZSA9IHJlcG9ydC5jbG9ja1JhdGU7XG4gICAgICAgICAgICAgIHN0YXRzT2JqZWN0LnZpZGVvLmxvY2FsLm1pbWVUeXBlID0gcmVwb3J0Lm1pbWVUeXBlO1xuICAgICAgICAgICAgICBzdGF0c09iamVjdC52aWRlby5sb2NhbC5wYXlsb2FkVHlwZSA9IHJlcG9ydC5wYXlsb2FkVHlwZTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGlmIChyZXBvcnQuaWQuaW5kZXhPZihzdGF0c09iamVjdC52aWRlby5yZW1vdGUuY29kZWNJZCkgIT09IDEgJlxuICAgICAgICAgICAgICAgIHJlbW90ZVRyYWNrSWRzLnZpZGVvICE9PSAnJykge1xuICAgICAgICAgICAgICBzdGF0c09iamVjdC52aWRlby5yZW1vdGUuY2xvY2tSYXRlID0gcmVwb3J0LmNsb2NrUmF0ZTtcbiAgICAgICAgICAgICAgc3RhdHNPYmplY3QudmlkZW8ucmVtb3RlLm1pbWVUeXBlID0gcmVwb3J0Lm1pbWVUeXBlO1xuICAgICAgICAgICAgICBzdGF0c09iamVjdC52aWRlby5yZW1vdGUucGF5bG9hZFR5cGUgPSByZXBvcnQucGF5bG9hZFR5cGU7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgfVxuICAgICAgICAgIGJyZWFrO1xuICAgICAgICBjYXNlICdsb2NhbC1jYW5kaWRhdGUnOlxuICAgICAgICAgIGlmIChyZXBvcnQuaGFzT3duUHJvcGVydHkoJ2lkJykpIHtcbiAgICAgICAgICAgIGlmIChyZXBvcnQuaWQuaW5kZXhPZihcbiAgICAgICAgICAgICAgICBzdGF0c09iamVjdC5jb25uZWN0aW9uLmxvY2FsQ2FuZGlkYXRlSWQpICE9PSAtMSkge1xuICAgICAgICAgICAgICBzdGF0c09iamVjdC5jb25uZWN0aW9uLmxvY2FsSXAgPSByZXBvcnQuaXA7XG4gICAgICAgICAgICAgIHN0YXRzT2JqZWN0LmNvbm5lY3Rpb24ubG9jYWxQb3J0ID0gcmVwb3J0LnBvcnQ7XG4gICAgICAgICAgICAgIHN0YXRzT2JqZWN0LmNvbm5lY3Rpb24ubG9jYWxQcmlvcml0eSA9IHJlcG9ydC5wcmlvcml0eTtcbiAgICAgICAgICAgICAgc3RhdHNPYmplY3QuY29ubmVjdGlvbi5sb2NhbFByb3RvY29sID0gcmVwb3J0LnByb3RvY29sO1xuICAgICAgICAgICAgICBzdGF0c09iamVjdC5jb25uZWN0aW9uLmxvY2FsVHlwZSA9IHJlcG9ydC5jYW5kaWRhdGVUeXBlO1xuICAgICAgICAgICAgfVxuICAgICAgICAgIH1cbiAgICAgICAgICBicmVhaztcbiAgICAgICAgY2FzZSAncmVtb3RlLWNhbmRpZGF0ZSc6XG4gICAgICAgICAgaWYgKHJlcG9ydC5oYXNPd25Qcm9wZXJ0eSgnaWQnKSkge1xuICAgICAgICAgICAgaWYgKHJlcG9ydC5pZC5pbmRleE9mKFxuICAgICAgICAgICAgICAgIHN0YXRzT2JqZWN0LmNvbm5lY3Rpb24ucmVtb3RlQ2FuZGlkYXRlSWQpICE9PSAtMSkge1xuICAgICAgICAgICAgICBzdGF0c09iamVjdC5jb25uZWN0aW9uLnJlbW90ZUlwID0gcmVwb3J0LmlwO1xuICAgICAgICAgICAgICBzdGF0c09iamVjdC5jb25uZWN0aW9uLnJlbW90ZVBvcnQgPSByZXBvcnQucG9ydDtcbiAgICAgICAgICAgICAgc3RhdHNPYmplY3QuY29ubmVjdGlvbi5yZW1vdGVQcmlvcml0eSA9IHJlcG9ydC5wcmlvcml0eTtcbiAgICAgICAgICAgICAgc3RhdHNPYmplY3QuY29ubmVjdGlvbi5yZW1vdGVQcm90b2NvbCA9IHJlcG9ydC5wcm90b2NvbDtcbiAgICAgICAgICAgICAgc3RhdHNPYmplY3QuY29ubmVjdGlvbi5yZW1vdGVUeXBlID0gcmVwb3J0LmNhbmRpZGF0ZVR5cGU7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgfVxuICAgICAgICAgIGJyZWFrO1xuICAgICAgICBkZWZhdWx0OlxuICAgICAgICAgIHJldHVybjtcbiAgICAgIH1cbiAgICB9LmJpbmQoKSk7XG4gIH1cbiAgcmV0dXJuIHN0YXRzT2JqZWN0O1xufVxuIiwiLypcbiAqICBDb3B5cmlnaHQgKGMpIDIwMTcgVGhlIFdlYlJUQyBwcm9qZWN0IGF1dGhvcnMuIEFsbCBSaWdodHMgUmVzZXJ2ZWQuXG4gKlxuICogIFVzZSBvZiB0aGlzIHNvdXJjZSBjb2RlIGlzIGdvdmVybmVkIGJ5IGEgQlNELXN0eWxlIGxpY2Vuc2VcbiAqICB0aGF0IGNhbiBiZSBmb3VuZCBpbiB0aGUgTElDRU5TRSBmaWxlIGluIHRoZSByb290IG9mIHRoZSBzb3VyY2VcbiAqICB0cmVlLlxuICovXG4ndXNlIHN0cmljdCc7XG5cbmZ1bmN0aW9uIFZpZGVvRnJhbWVDaGVja2VyKHZpZGVvRWxlbWVudCkge1xuICB0aGlzLmZyYW1lU3RhdHMgPSB7XG4gICAgbnVtRnJvemVuRnJhbWVzOiAwLFxuICAgIG51bUJsYWNrRnJhbWVzOiAwLFxuICAgIG51bUZyYW1lczogMFxuICB9O1xuXG4gIHRoaXMucnVubmluZ18gPSB0cnVlO1xuXG4gIHRoaXMubm9uQmxhY2tQaXhlbEx1bWFUaHJlc2hvbGQgPSAyMDtcbiAgdGhpcy5wcmV2aW91c0ZyYW1lXyA9IFtdO1xuICB0aGlzLmlkZW50aWNhbEZyYW1lU3NpbVRocmVzaG9sZCA9IDAuOTg1O1xuICB0aGlzLmZyYW1lQ29tcGFyYXRvciA9IG5ldyBTc2ltKCk7XG5cbiAgdGhpcy5jYW52YXNfID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnY2FudmFzJyk7XG4gIHRoaXMudmlkZW9FbGVtZW50XyA9IHZpZGVvRWxlbWVudDtcbiAgdGhpcy5saXN0ZW5lcl8gPSB0aGlzLmNoZWNrVmlkZW9GcmFtZV8uYmluZCh0aGlzKTtcbiAgdGhpcy52aWRlb0VsZW1lbnRfLmFkZEV2ZW50TGlzdGVuZXIoJ3BsYXknLCB0aGlzLmxpc3RlbmVyXywgZmFsc2UpO1xufVxuXG5WaWRlb0ZyYW1lQ2hlY2tlci5wcm90b3R5cGUgPSB7XG4gIHN0b3A6IGZ1bmN0aW9uKCkge1xuICAgIHRoaXMudmlkZW9FbGVtZW50Xy5yZW1vdmVFdmVudExpc3RlbmVyKCdwbGF5JyAsIHRoaXMubGlzdGVuZXJfKTtcbiAgICB0aGlzLnJ1bm5pbmdfID0gZmFsc2U7XG4gIH0sXG5cbiAgZ2V0Q3VycmVudEltYWdlRGF0YV86IGZ1bmN0aW9uKCkge1xuICAgIHRoaXMuY2FudmFzXy53aWR0aCA9IHRoaXMudmlkZW9FbGVtZW50Xy53aWR0aDtcbiAgICB0aGlzLmNhbnZhc18uaGVpZ2h0ID0gdGhpcy52aWRlb0VsZW1lbnRfLmhlaWdodDtcblxuICAgIHZhciBjb250ZXh0ID0gdGhpcy5jYW52YXNfLmdldENvbnRleHQoJzJkJyk7XG4gICAgY29udGV4dC5kcmF3SW1hZ2UodGhpcy52aWRlb0VsZW1lbnRfLCAwLCAwLCB0aGlzLmNhbnZhc18ud2lkdGgsXG4gICAgICAgIHRoaXMuY2FudmFzXy5oZWlnaHQpO1xuICAgIHJldHVybiBjb250ZXh0LmdldEltYWdlRGF0YSgwLCAwLCB0aGlzLmNhbnZhc18ud2lkdGgsIHRoaXMuY2FudmFzXy5oZWlnaHQpO1xuICB9LFxuXG4gIGNoZWNrVmlkZW9GcmFtZV86IGZ1bmN0aW9uKCkge1xuICAgIGlmICghdGhpcy5ydW5uaW5nXykge1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBpZiAodGhpcy52aWRlb0VsZW1lbnRfLmVuZGVkKSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgdmFyIGltYWdlRGF0YSA9IHRoaXMuZ2V0Q3VycmVudEltYWdlRGF0YV8oKTtcblxuICAgIGlmICh0aGlzLmlzQmxhY2tGcmFtZV8oaW1hZ2VEYXRhLmRhdGEsIGltYWdlRGF0YS5kYXRhLmxlbmd0aCkpIHtcbiAgICAgIHRoaXMuZnJhbWVTdGF0cy5udW1CbGFja0ZyYW1lcysrO1xuICAgIH1cblxuICAgIGlmICh0aGlzLmZyYW1lQ29tcGFyYXRvci5jYWxjdWxhdGUodGhpcy5wcmV2aW91c0ZyYW1lXywgaW1hZ2VEYXRhLmRhdGEpID5cbiAgICAgICAgdGhpcy5pZGVudGljYWxGcmFtZVNzaW1UaHJlc2hvbGQpIHtcbiAgICAgIHRoaXMuZnJhbWVTdGF0cy5udW1Gcm96ZW5GcmFtZXMrKztcbiAgICB9XG4gICAgdGhpcy5wcmV2aW91c0ZyYW1lXyA9IGltYWdlRGF0YS5kYXRhO1xuXG4gICAgdGhpcy5mcmFtZVN0YXRzLm51bUZyYW1lcysrO1xuICAgIHNldFRpbWVvdXQodGhpcy5jaGVja1ZpZGVvRnJhbWVfLmJpbmQodGhpcyksIDIwKTtcbiAgfSxcblxuICBpc0JsYWNrRnJhbWVfOiBmdW5jdGlvbihkYXRhLCBsZW5ndGgpIHtcbiAgICAvLyBUT0RPOiBVc2UgYSBzdGF0aXN0aWNhbCwgaGlzdG9ncmFtLWJhc2VkIGRldGVjdGlvbi5cbiAgICB2YXIgdGhyZXNoID0gdGhpcy5ub25CbGFja1BpeGVsTHVtYVRocmVzaG9sZDtcbiAgICB2YXIgYWNjdUx1bWEgPSAwO1xuICAgIGZvciAodmFyIGkgPSA0OyBpIDwgbGVuZ3RoOyBpICs9IDQpIHtcbiAgICAgIC8vIFVzZSBMdW1hIGFzIGluIFJlYy4gNzA5OiBZ4oCyNzA5ID0gMC4yMVIgKyAwLjcyRyArIDAuMDdCO1xuICAgICAgYWNjdUx1bWEgKz0gMC4yMSAqIGRhdGFbaV0gKyAwLjcyICogZGF0YVtpICsgMV0gKyAwLjA3ICogZGF0YVtpICsgMl07XG4gICAgICAvLyBFYXJseSB0ZXJtaW5hdGlvbiBpZiB0aGUgYXZlcmFnZSBMdW1hIHNvIGZhciBpcyBicmlnaHQgZW5vdWdoLlxuICAgICAgaWYgKGFjY3VMdW1hID4gKHRocmVzaCAqIGkgLyA0KSkge1xuICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICB9XG4gICAgfVxuICAgIHJldHVybiB0cnVlO1xuICB9XG59O1xuXG5pZiAodHlwZW9mIGV4cG9ydHMgPT09ICdvYmplY3QnKSB7XG4gIG1vZHVsZS5leHBvcnRzID0gVmlkZW9GcmFtZUNoZWNrZXI7XG59XG4iXX0=
