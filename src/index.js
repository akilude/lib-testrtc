import Call from './util/call.js';
import './util/stats.js';
import './util/ssim.js';
import './util/videoframechecker.js';
import './util/util.js';
import { cases, suites } from './config/testNames.js';

import MicTest from './unit/mic.js';
import RunConnectivityTest from './unit/conn.js';
import CamResolutionsTest from './unit/camresolutions.js';
import NetworkTest from './unit/net.js';
import DataChannelThroughputTest from './unit/dataBandwidth.js';
import VideoBandwidthTest from './unit/videoBandwidth.js';
import wiFiPeriodicScanTest from './unit/wifiPeriodicScan.js';

class TestRTC {

  constructor() {
    this.enumeratedTestSuites = [];
    this.enumeratedTestFilters = [];

    addTest(suites.MICROPHONE, cases.AUDIOCAPTURE, (test) => {
      var micTest = new MicTest(test);
      micTest.run();
    });

    // Set up a datachannel between two peers through a relay
    // and verify data can be transmitted and received
    // (packets travel through the public internet)
    addTest(suites.CONNECTIVITY, cases.RELAYCONNECTIVITY, (test) => {
      var runConnectivityTest = new RunConnectivityTest(test, Call.isRelay);
      runConnectivityTest.run();
    });

    // Set up a datachannel between two peers through a public IP address
    // and verify data can be transmitted and received
    // (packets should stay on the link if behind a router doing NAT)
    addTest(suites.CONNECTIVITY, cases.REFLEXIVECONNECTIVITY, (test) => {
      var runConnectivityTest = new RunConnectivityTest(test, Call.isReflexive);
      runConnectivityTest.run();
    });

    // Set up a datachannel between two peers through a local IP address
    // and verify data can be transmitted and received
    // (packets should not leave the machine running the test)
    addTest(suites.CONNECTIVITY, cases.HOSTCONNECTIVITY, (test) => {
      var runConnectivityTest = new RunConnectivityTest(test, Call.isHost);
      runConnectivityTest.start();
    });

    addTest(suites.CAMERA, cases.CHECKRESOLUTION240, (test) => {
      var camResolutionsTest = new CamResolutionsTest(test , [[320, 240]]);
      camResolutionsTest.run();
    });

    addTest(suites.CAMERA, cases.CHECKRESOLUTION480, (test) => {
      var camResolutionsTest = new CamResolutionsTest(test, [[640, 480]]);
      camResolutionsTest.run();
    });

    addTest(suites.CAMERA, cases.CHECKRESOLUTION720, (test) => {
      var camResolutionsTest = new CamResolutionsTest(test, [[1280, 720]]);
      camResolutionsTest.run();
    });

    addTest(suites.CAMERA, cases.CHECKSUPPORTEDRESOLUTIONS, (test) => {
      var resolutionArray = [
        [160, 120], [320, 180], [320, 240], [640, 360], [640, 480], [768, 576],
        [1024, 576], [1280, 720], [1280, 768], [1280, 800], [1920, 1080],
        [1920, 1200], [3840, 2160], [4096, 2160]
      ];
      var camResolutionsTest = new CamResolutionsTest(test, resolutionArray);
      camResolutionsTest.run();
    });

    // Test whether it can connect via UDP to a TURN server
    // Get a TURN config, and try to get a relay candidate using UDP.
    addTest(suites.NETWORK, cases.UDPENABLED, (test) => {
      var networkTest = new NetworkTest(test, 'udp', null, Call.isRelay);
      networkTest.run();
    });

    // Test whether it can connect via TCP to a TURN server
    // Get a TURN config, and try to get a relay candidate using TCP.
    addTest(suites.NETWORK, cases.TCPENABLED, (test) => {
      var networkTest = new NetworkTest(test, 'tcp', null, Call.isRelay);
      networkTest.run();
    });

    // Test whether it is IPv6 enabled (TODO: test IPv6 to a destination).
    // Turn on IPv6, and try to get an IPv6 host candidate.
    addTest(suites.NETWORK, cases.IPV6ENABLED, (test) => {
      var params = {optional: [{googIPv6: true}]};
      var networkTest = new NetworkTest(test, null, params, Call.isIpv6);
      networkTest.run();
    });

    // Creates a loopback via relay candidates and tries to send as many packets
    // with 1024 chars as possible while keeping dataChannel bufferedAmmount above
    // zero.
    addTest(suites.THROUGHPUT, cases.DATATHROUGHPUT, (test) => {
      var dataChannelThroughputTest = new DataChannelThroughputTest(test);
      dataChannelThroughputTest.run();
    });

    // Measures video bandwidth estimation performance by doing a loopback call via
    // relay candidates for 40 seconds. Computes rtt and bandwidth estimation
    // average and maximum as well as time to ramp up (defined as reaching 75% of
    // the max bitrate. It reports infinite time to ramp up if never reaches it.
    addTest(suites.THROUGHPUT, cases.VIDEOBANDWIDTH, (test) => {
      var videoBandwidthTest = new VideoBandwidthTest(test);
      videoBandwidthTest.run();
    });

    addExplicitTest(suites.THROUGHPUT, cases.NETWORKLATENCY, (test) => {
      var wiFiPeriodicScanTest = new WiFiPeriodicScanTest(test,
          Call.isNotHostCandidate);
      wiFiPeriodicScanTest.run();
    });

    addExplicitTest(suites.THROUGHPUT, cases.NETWORKLATENCYRELAY, (test) => {
      var wiFiPeriodicScanTest = new WiFiPeriodicScanTest(test, Call.isRelay);
      wiFiPeriodicScanTest.run();
    });
  }

  addTest(suiteName, testName, func) {
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
  addExplicitTest(suiteName, testName, func) {
    if (isTestExplicitlyEnabled(testName)) {
      addTest(suiteName, testName, func);
    }
  }

  isTestDisabled(testName) {
    if (enumeratedTestFilters.length === 0) {
      return false;
    }
    return !isTestExplicitlyEnabled(testName);
  }

  isTestExplicitlyEnabled(testName) {
    for (var i = 0; i !== enumeratedTestFilters.length; ++i) {
      if (enumeratedTestFilters[i] === testName) {
        return true;
      }
    }
    return false;
  }
}

export default TestRTC;
