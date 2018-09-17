# lib-testrtc

Turns [TestRTC](https://github.com/webrtc/testrtc) into a library to make tests embeddable in any page.

## TestRTC

[WebRTC troubleshooter](https://test.webrtc.org/) provides a set of tests that can be easily run by a user to help diagnose WebRTC related issues. The user can then download a report containing all the gathered information or upload the log and create a temporary link with the report result.

## Usage

Install with npm / yarn
`npm install lib-testrtc`
`yarn add lib-testrtc`

Or import [the script](dist/testrtc-min.js) into your page and use the global object `TestRTC`.

```html
<script type="text/javascript" src="testrtc-min.js"></script>
<script type="text/javascript">
    const testRTC = new TestRTC({
      turnUsername: 'USERNAME',
      turnCredential: 'PASSWORD',
      turnURI: 'YOUR_TURN_URL',
      strunURI: 'YOUR_STUN_URI',
    });

    testRTC.start();
</script>
```

### Callbacks

You can suscribe to different callbacks to get the tests reports:

```javascript
// Test Progress
testRTC.onTestProgress((suiteName, testName, progress) => {});
// Global Progress
testRTC.onGlobalProgress((finishedCount, remainingCount) => {});
// Result
testRTC.onTestProgress((suiteName, testName, result) => {});
// Logs
testRTC.onTestReport((suite, test, level, message) => {});
// Tests completed
testRTC.onComplete(() => {});
// Tests stopped
testRTC.onStopped(() => {});
```

### Suite control

The following commands are available:

`testRTC.start()` (Start from the beggining)
`testRTC.pause()`
`testRTC.resume()`
`testRTC.stop()` (Stop the test suite)

`testRTC.state` gives an indication of the current state of the suite: stopped/started/paused.

### Filtering tests

You can prevent the execution of a suites or a test case by passing it through a filter array in parameter:

```javascript
const testRTC = new TestRTC(
  {
    turnUsername: 'USERNAME',
    turnCredential: 'PASSWORD',
    turnURI: 'YOUR_TURN_URL',
    strunURI: 'YOUR_STUN_URI'
  },
  (filter = [TestRTC.SUITES.CAMERA, TestRTC.TESTS.IPV6ENABLED])
);
```

The accepted values can be found [here](./src/config/index.js#L15)

## Tests descriptions

- Microphone
  - Audio capture
    - Checks the microphone is able to produce 2 seconds of non-silent audio
    - Computes peak level and maximum RMS
    - Clip detection
    - Mono mic detection
- Camera
  - Check WxH resolution
    - Checks the camera is able to capture at the requested resolution for 5 seconds
    - Checks if the frames are frozen or muted/black
    - Detects how long to start encode frames
    - Reports encode time and average framerate
  - Check supported resolutions
    - Lists resolutions that appear to be supported
- Network
  - Udp/Tcp
    - Verifies it can talk with a turn server with the given protocol
  - IPv6 connectivity
    - Verifies it can gather at least one IPv6 candidate
- Connectivity
  - Relay
    - Verifies connections can be established between peers through a TURN server
  - Reflexive
    - Verifies connections can be established between peers through NAT
  - Host
    - Verifies connections can be established between peers with the same IP address
- Throughput
  - Data throughput
    - Establishes a loopback call and tests data channels throughput on the link
  - Video bandwidth
    - Establishes a loopback call and tests video performance on the link
    - Measures rtt on media channels.
    - Measures bandwidth estimation performance (rampup time, max, average)
  - Network latency
    - Establishs a loopback call and sends very small packets (via data channels) during 5 minutes plotting them to the user. It can be used to identify issues on the network.

## Build lib-testrtc

```bash
yarn && grunt build
```

Feel free to contribute by opening a pull request.
